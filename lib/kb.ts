// search_kb implementation — server-side only. Results (queries + matched
// slugs) must never be echoed to the client; the chat response exposes only a
// lookup count (invariant 4).

import fs from 'node:fs';
import path from 'node:path';
import type { KbLookup } from './types';
import { getCanonicalNote } from './content';

const KB_PATH = path.join(process.cwd(), 'content', 'kb_lookup.json');

const MAX_NOTES = 2;
const MAX_TEXT_CHARS = 20_000;
/** Substring matches need this much overlap — stops 2-char terms like "uc"/"as"
 *  junk-matching mid-word. Exact-term hits are unaffected. Deliberate deviation
 *  from SPEC's bare bidirectional-substring rule: queries/terms shorter than
 *  this are exact-match-only, then fall through to the no-match message (the
 *  model answers from the brief per Golden Rule 5). */
const MIN_SUBSTRING_OVERLAP = 4;

const EMPTY_RESULT_TEXT =
  'No canonical note matched. Answer from the case brief and general medical knowledge, flagging uncertainty.';

let kbCache: KbLookup | null = null;

function getKb(): KbLookup | null {
  if (kbCache) return kbCache;
  try {
    kbCache = JSON.parse(fs.readFileSync(KB_PATH, 'utf8')) as KbLookup;
  } catch {
    // Defensive: a missing/corrupt kb file mid-conversation degrades to
    // "no match" instead of failing the whole examiner call.
    return null;
  }
  return kbCache;
}

function normalize(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function searchKb(query: string): { slugs: string[]; text: string } {
  const q = normalize(query);
  const kb = getKb();
  if (!q || !kb) return { slugs: [], text: EMPTY_RESULT_TEXT };

  // Score every term: exact hit first, then bidirectional substring matches
  // scored by overlap length (the length of the contained string).
  const scored: { term: string; score: number }[] = [];
  for (const term of Object.keys(kb)) {
    if (term === q) {
      scored.push({ term, score: Number.MAX_SAFE_INTEGER });
    } else if (term.includes(q) || q.includes(term)) {
      const overlap = Math.min(term.length, q.length);
      if (overlap >= MIN_SUBSTRING_OVERLAP) scored.push({ term, score: overlap });
    }
  }
  // Highest score first; tie-break on shorter term (tighter match).
  scored.sort((a, b) => b.score - a.score || a.term.length - b.term.length);

  // Collect the top distinct canonical slugs (max 2 notes that actually exist).
  const slugs: string[] = [];
  for (const { term } of scored) {
    for (const slug of kb[term] ?? []) {
      if (slugs.length >= MAX_NOTES) break;
      if (!slugs.includes(slug) && getCanonicalNote(slug) !== undefined) {
        slugs.push(slug);
      }
    }
    if (slugs.length >= MAX_NOTES) break;
  }

  if (slugs.length === 0) return { slugs: [], text: EMPTY_RESULT_TEXT };

  let text = slugs
    .map((slug) => `--- canonical/${slug}.md ---\n${getCanonicalNote(slug)}`)
    .join('\n\n');
  if (text.length > MAX_TEXT_CHARS) {
    text = `${text.slice(0, MAX_TEXT_CHARS)}\n[...truncated]`;
  }
  return { slugs, text };
}
