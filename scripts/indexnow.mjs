#!/usr/bin/env node
// IndexNow ping — instantly tells Bing / Yandex / Seznam (and their IndexNow
// partners) which URLs changed, so new pages get crawled in hours, not weeks.
// Google does NOT use IndexNow (it has its own sitemap/Search Console path),
// so this complements — never replaces — the Search Console sitemap.
//
// Usage (run AFTER a prod deploy so the URLs actually resolve):
//   node scripts/indexnow.mjs
// It reads the LIVE sitemap as the source of truth for what to submit, so it
// always pings exactly the pages that shipped.
//
// The key is public by design: it is verified via the matching file served at
// https://pacesbuddy.com/<key>.txt (in public/). Rotating it = generate a new
// hex key, drop the old public/<key>.txt, add the new one, update KEY here.

const HOST = 'pacesbuddy.com';
const KEY = process.env.INDEXNOW_KEY || '1bfac838d33a02465b674aa09c654d07';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP = `https://${HOST}/sitemap.xml`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

async function main() {
  const res = await fetch(SITEMAP, { headers: { 'user-agent': 'paces-indexnow/1' } });
  if (!res.ok) {
    console.error(`Failed to fetch sitemap (${res.status}). Is the site deployed?`);
    process.exit(1);
  }
  const xml = await res.text();
  const urlList = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (urlList.length === 0) {
    console.error('No <loc> URLs found in the sitemap — nothing to submit.');
    process.exit(1);
  }

  console.log(`Submitting ${urlList.length} URLs to IndexNow:`);
  for (const u of urlList) console.log(`  ${u}`);

  const submit = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });
  // IndexNow returns 200 (accepted) or 202 (accepted, key validation pending).
  console.log(`\nIndexNow responded ${submit.status} ${submit.statusText}`);
  if (submit.status !== 200 && submit.status !== 202) {
    console.error('Unexpected status — check the key file is live at', KEY_LOCATION);
    process.exit(1);
  }
  console.log('OK — Bing/Yandex will crawl these shortly.');
}

main().catch((err) => {
  console.error('IndexNow ping failed:', err?.message || err);
  process.exit(1);
});
