# PACES Practice — AI examiner

A shareable, BYOK (bring-your-own-key) web app for practising MRCP PACES with an AI examiner. Pick one of 503 practice encounters (past-year carousel recalls plus standalone case banks); the AI plays examiner (and simulated patient/relative for communication and consultation stations), reveals findings only as you examine, runs the viva, then marks you against the official PACES rubric with a structured per-skill marksheet.

Built on Next.js (App Router) + the Anthropic Messages API — served by Anthropic itself or, for the budget tier, by providers with Anthropic-compatible endpoints (DeepSeek, Moonshot/Kimi, MiniMax). The candidate's browser only ever sees the case stem and the examiner's replies — expected findings, model answers, and the answer key stay server-side.

## Features

- **503 practice encounters** across consultation, communication, and examination stations, filterable by classification / clinical theme / source, browsable by type or by past-year sitting. Every case has a stable opaque code (`#c0001…`).
- **AI examiner + simulated patient** grounded on the hidden case file and per-condition reference notes: reveals findings only as you examine, runs the viva, then marks against the official PACES rubric as a structured per-skill (A–G) marksheet with justifications.
- **Clinical-image reveal** — for cases where a sign is something you *see*, the examiner surfaces a real photo in-chat once you examine that region (same discipline as text findings; never on the stem).
- **Crash-safe transcripts** — the live encounter (case, transcript, revealed photos, marksheet) autosaves to the browser and restores on reload, so an accidental refresh never wipes your work. Fully client-side; the backend stays stateless.
- **History** — finished or parked encounters are archived in the browser (IndexedDB); reopen one read-only or continue an unmarked case where you left off.
- **Two models via one managed key (Phase 0)** — Claude Sonnet 4.6 (premium, ~$0.30/case) and DeepSeek V4 Pro (budget, ~$0.02/case), both routed through **Vercel AI Gateway**: one key, one top-up, zero markup. (The multi-provider adapter underneath also supports direct Anthropic/DeepSeek/Kimi/MiniMax endpoints for BYOK-direct or off-Vercel use.)
- **Two access paths** — bring your own API key for the provider of the model you pick (kept only in your browser, one saved slot per provider), or, for owner-invited users, a passwordless email sign-in that spends server-held, spend-capped keys (see *Demo access* below).

All state a user creates lives in their own browser; the server stores nothing and never sees a stored transcript.

## Run it locally

```bash
npm install
node scripts/build-content.mjs   # builds content/ from the PACES corpus (parent directory)
npm run dev                      # http://localhost:3000
```

Then open the app, pick a model in **Settings**, and paste a **Vercel AI Gateway** API key (created at Vercel → AI Gateway → API Keys; stored only in your browser, sent per-request, never saved server-side). One gateway key + top-up covers both offered models. Then pick a case and begin.

`content/` is generated and gitignored — it contains the full hidden corpus (answer keys included), so it must never be committed. Regenerate it any time with the build script; the source corpus lives in the parent PACES directory (`5_Carousels_PACES23/`, `_index/`).

## Demo access (optional — let an invited user practise without their own key)

The app owner can whitelist a handful of email addresses; those users sign in via an emailed magic link and the server then uses a server-held key for them. Everyone else still needs their own key — the server keys are unusable without a signed session cookie, and the whole feature is off unless configured. Coverage is per provider: set a key for each provider invited users may pick (e.g. only `DEMO_DEEPSEEK_API_KEY` for a near-free pilot tier — a DeepSeek case costs ~$0.01); models from uncovered providers politely ask the user to switch or bring their own key. Full design in `SPEC.md` → "Demo access" + "Multi-provider rules".

Setup (see `.env.example` for the full annotated list; locally put these in `.env.local`, on Vercel set them as project env vars):

- `DEMO_WHITELIST` — comma-separated emails allowed in (case-insensitive, trimmed).
- `DEMO_GATEWAY_API_KEY` — the recommended server-held key: a Vercel AI Gateway key covering both offered models under one balance (the AI Gateway credit balance, with auto-top-up, is the spend cap). Direct-provider keys `DEMO_ANTHROPIC_API_KEY` / `DEMO_DEEPSEEK_API_KEY` / `DEMO_MOONSHOT_API_KEY` / `DEMO_MINIMAX_API_KEY` still work (BYOK-direct / off-Vercel); demo mode is on when at least one of any of these is set. **Use spend-capped keys.**
- `AUTH_SECRET` — signs the magic-link tokens and the session cookie. Generate with `openssl rand -hex 32`. Required for demo mode.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — how the sign-in link is emailed. **In dev you can leave all four unset: the link is printed to the server console instead of being emailed**, so you can test the whole flow without a mail account. In production, a missing or partial SMTP config means the link is NOT sent — an error is logged (never the link itself), so set all four and watch the logs after the first invite.
- `APP_BASE_URL` — public base URL used inside the magic link. **Required in production**: emailed links are never built from the incoming request's host there (that header is forgeable, and a forged host would deliver a victim's real sign-in link to an attacker's domain), so if it's unset no link is sent and an error is logged. In local dev it falls back to the request origin.

Using Gmail for SMTP: Gmail blocks plain passwords, so create an **app password** — Google Account → Security → turn on 2-Step Verification → then visit <https://myaccount.google.com/apppasswords>, create one named e.g. "PACES Practice", and use the 16-character code as `SMTP_PASS` with `SMTP_USER=your@gmail.com`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.

Flow for the invited user: open the app → sidebar **Invited access** → enter their email → click the link in their inbox (valid 15 minutes) → "Access active — no API key needed" (session lasts 30 days per browser). Revoke anyone by removing their email from `DEMO_WHITELIST` — existing sessions stop working immediately.

## How it works

- **`scripts/build-content.mjs`** — copies the 287 served carousel encounters (9 forgotten slots are recorded in `placeholders.json`, not served) plus the 216 standalone `_case_library` cases and the 211 canonical grounding notes + marking rubric into `content/`, builds a spoiler-free `manifest.json` (display titles are filename-derived; the case H1 names the diagnosis and stays hidden), and matches each case to its canonical notes for direct-fetch grounding.
- **`POST /api/examiner`** — the one backend function: assembles the examiner brief (persona + rubric in one prompt-cached block, full case file + grounding notes in a second), calls the model with a `search_kb` tool over the reference index as fallback grounding, and for marking gets a structured marksheet (a forced `submit_marksheet` tool call on Anthropic/DeepSeek; a strict-JSON reply on Moonshot/MiniMax, whose endpoints can't force a tool) — per-skill A–G grades, totals recomputed server-side either way.
- **Multi-provider adapter** — every provider speaks the Anthropic Messages API, so one SDK code path serves all of them; the server switches only baseURL + key by the selected model (fixed server-side map — the client never supplies a URL). Budget providers get an extra per-turn examiner-discipline reminder (weaker instruction-following models drift on the reveal rules). Retrieval quality, not model size, does the heavy lifting.
- **Managed gateway (Phase 0)** — the two offered models are fronted by Vercel AI Gateway (one operator top-up, zero token markup). Per-user accounts, institutional (e.g. `@mohh.com.sg`) gating, usage metering, and self top-up are a planned stateful layer, not yet built.

`SPEC.md` is the binding design contract (security invariants, prompt text, API shapes). Deployable to Vercel as-is (`outputFileTracingIncludes` bundles `content/` into the serverless functions — run the content build before deploying).

## License & what this repo does (and doesn't) contain

MIT — see `LICENSE`. This repository is the **app only**: engine, UI, content pipeline, and design contract. The clinical case corpus it grounds on is **not** in the repo and never has been — `content/` is generated locally by `scripts/build-content.mjs` from a private source corpus (parent directory) and is gitignored, along with the clinical photos (`public/case-images/`) and all env files. To run your own instance you bring your own case bank in the format `build-content.mjs` expects (or adapt the script), then deploy from your machine with `npx vercel deploy` so your local `content/` uploads with it.
