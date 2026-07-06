# PACES Practice — AI examiner

A shareable, BYOK (bring-your-own-key) web app for practising MRCP PACES with an AI examiner. Pick one of 503 practice encounters (past-year carousel recalls plus standalone case banks); the AI plays examiner (and simulated patient/relative for communication and consultation stations), reveals findings only as you examine, runs the viva, then marks you against the official PACES rubric with a structured per-skill marksheet.

Built on Next.js (App Router) + the Anthropic API. The candidate's browser only ever sees the case stem and the examiner's replies — expected findings, model answers, and the answer key stay server-side.

## Run it locally

```bash
npm install
node scripts/build-content.mjs   # builds content/ from the PACES corpus (parent directory)
npm run dev                      # http://localhost:3000
```

Then open the app, paste your Anthropic API key in **Settings** (stored only in your browser, sent per-request, never saved server-side), pick a case, and begin.

`content/` is generated and gitignored — it contains the full hidden corpus (answer keys included), so it must never be committed. Regenerate it any time with the build script; the source corpus lives in the parent PACES directory (`5_Carousels_PACES23/`, `_index/`).

## Demo access (optional — let an invited user practise without their own key)

The app owner can whitelist a handful of email addresses; those users sign in via an emailed magic link and the server then uses a server-held Anthropic key for them. Everyone else still needs their own key — the server key is unusable without a signed session cookie, and the whole feature is off unless configured. Full design in `SPEC.md` → "Demo access".

Setup (see `.env.example` for the full annotated list; locally put these in `.env.local`, on Vercel set them as project env vars):

- `DEMO_WHITELIST` — comma-separated emails allowed in (case-insensitive, trimmed).
- `DEMO_ANTHROPIC_API_KEY` — the server-held key. **Use a spend-capped workspace key** (Anthropic Console → Workspaces → spend limit) so the worst case is bounded. Unset = demo mode off.
- `AUTH_SECRET` — signs the magic-link tokens and the session cookie. Generate with `openssl rand -hex 32`. Required for demo mode.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — how the sign-in link is emailed. **In dev you can leave all four unset: the link is printed to the server console instead of being emailed**, so you can test the whole flow without a mail account. In production, a missing or partial SMTP config means the link is NOT sent — an error is logged (never the link itself), so set all four and watch the logs after the first invite.
- `APP_BASE_URL` — public base URL used inside the magic link. **Required in production**: emailed links are never built from the incoming request's host there (that header is forgeable, and a forged host would deliver a victim's real sign-in link to an attacker's domain), so if it's unset no link is sent and an error is logged. In local dev it falls back to the request origin.

Using Gmail for SMTP: Gmail blocks plain passwords, so create an **app password** — Google Account → Security → turn on 2-Step Verification → then visit <https://myaccount.google.com/apppasswords>, create one named e.g. "PACES Practice", and use the 16-character code as `SMTP_PASS` with `SMTP_USER=your@gmail.com`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.

Flow for the invited user: open the app → sidebar **Invited access** → enter their email → click the link in their inbox (valid 15 minutes) → "Access active — no API key needed" (session lasts 30 days per browser). Revoke anyone by removing their email from `DEMO_WHITELIST` — existing sessions stop working immediately.

## How it works

- **`scripts/build-content.mjs`** — copies the 287 served carousel encounters (9 forgotten slots are recorded in `placeholders.json`, not served) plus the 216 standalone `_case_library` cases and the 211 canonical grounding notes + marking rubric into `content/`, builds a spoiler-free `manifest.json` (display titles are filename-derived; the case H1 names the diagnosis and stays hidden), and matches each case to its canonical notes for direct-fetch grounding.
- **`POST /api/examiner`** — the one backend function: assembles the examiner brief (persona + rubric in one prompt-cached block, full case file + grounding notes in a second), calls Claude with a `search_kb` tool over the reference index as fallback grounding, and for marking forces a structured `submit_marksheet` tool call (per-skill A–G grades, totals recomputed server-side).
- **Model picker** — Sonnet 4.6 by default; Opus 4.8 and Haiku 4.5 selectable. Cost is the user's dial; retrieval quality, not model size, does the heavy lifting.

`SPEC.md` is the binding design contract (security invariants, prompt text, API shapes). Deployable to Vercel as-is (`outputFileTracingIncludes` bundles `content/` into the serverless functions — run the content build before deploying).

## License & what this repo does (and doesn't) contain

MIT — see `LICENSE`. This repository is the **app only**: engine, UI, content pipeline, and design contract. The clinical case corpus it grounds on is **not** in the repo and never has been — `content/` is generated locally by `scripts/build-content.mjs` from a private source corpus (parent directory) and is gitignored, along with the clinical photos (`public/case-images/`) and all env files. To run your own instance you bring your own case bank in the format `build-content.mjs` expects (or adapt the script), then deploy from your machine with `npx vercel deploy` so your local `content/` uploads with it.
