# PACES Buddy — AI practice partner

A shareable, BYOK (bring-your-own-key) web app for practising MRCP PACES with an AI practice partner that plays examiner during each case. Pick one of 503 practice encounters (past-year carousel recalls plus standalone case banks); the AI plays examiner (and simulated patient/relative for communication and consultation stations), reveals findings only as you examine, runs the viva, then marks you against the official PACES rubric with a structured per-skill marksheet.

Built on Next.js (App Router) + the Anthropic Messages API. Models are served through one multi-provider adapter: the managed door routes server-side through **Vercel AI Gateway** (one operator top-up, zero markup), while BYOK users bring their own **Anthropic (Claude)** key (the same adapter can also speak directly to DeepSeek / Moonshot / MiniMax endpoints for off-Vercel use, though those aren't surfaced in the UI). The candidate's browser only ever sees the case stem and the examiner's replies — expected findings, model answers, and the answer key stay server-side.

## Features

- **503 practice encounters** across consultation, communication, and examination stations, filterable by classification / clinical theme / source, browsable by type or by past-year sitting. Every case has a stable opaque code (`#c0001…`).
- **AI examiner + simulated patient** grounded on the hidden case file and per-condition reference notes: reveals findings only as you examine, runs the viva, then marks against the official PACES rubric as a structured per-skill (A–G) marksheet with justifications.
- **Clinical-image reveal** — for cases where a sign is something you *see*, the examiner surfaces a real photo in-chat once you examine that region (same discipline as text findings; never on the stem).
- **Crash-safe transcripts** — the live encounter (case, transcript, revealed photos, marksheet) autosaves to the browser and restores on reload, so an accidental refresh never wipes your work. Fully client-side; the backend stores no transcripts.
- **History** — finished or parked encounters are archived in the browser (IndexedDB); reopen one read-only or continue an unmarked case where you left off. Signed-in users' archives also sync across devices.
- **Feedback & contact** — an in-app feedback form (sidebar footer; anonymous, no account needed) plus per-case "report an issue" from every marksheet; `/about` and `/privacy` tell the project's story; mail to any address `@pacesbuddy.com` (e.g. hello@) is forwarded to the maintainers via Resend Inbound.
- **Two doors** — the managed door is a single **free practice** option (routed server-side through **Vercel AI Gateway** — one operator key, one top-up, zero markup; the model is never named to the user). BYOK adds the direct Claude lineup (Sonnet 4.6 / Opus 4.8 / Haiku 4.5 on your own Anthropic key) — BYOK is Claude-only.
- **Two access doors** — bring your own API key (kept only in your browser, one saved slot per provider, no account needed), or sign in with your email + a 6-digit code and practise on the app's own metered allowance (see *Managed access* below).
- **Voice dictation** — signed-in users can speak instead of typing: a microphone beside Send records a short take, transcribes it (Whisper-large-v3, English forced, biased with a station-specific medical glossary plus the visible transcript), and drops the text into the composer to edit before sending. Dictation, not conversation — nothing reaches the examiner until you press Send. It needs the managed sign-in because it spends a server-held transcription key (the app never exposes server keys anonymously); clips are transcribed by the provider and never stored by us.
- **Transcription playground** (`/lab/dictation`, unlisted) — the workbench behind the mic, not a user feature: record once, transcribe the same clip on two models side by side, and score a take against a set of PACES sentences. This is how the app's speech model was chosen, and how the next one gets compared against it.

All study state — transcripts, history, keys — lives in the candidate's own browser by default. A managed sign-in adds a minimal server-side account (email, tier, a monthly usage meter) and, so history can follow you across devices, a copy of your archived encounters — your own transcript and marksheet only, never the hidden case files or answer keys.

## Run it locally

```bash
npm install
node scripts/build-content.mjs   # builds content/ from the PACES corpus (parent directory)
npm run dev                      # http://localhost:3000
```

Then open the app and either sign in for managed access (once you've configured it — see below), or pick a Claude model in **Settings** and paste your own **Anthropic (Claude)** key (Sonnet 4.6 / Opus 4.8 / Haiku 4.5 all ride the one key). BYOK is Claude-only; the key is stored only in your browser, sent per-request, never saved server-side. Then pick a case and begin.

`content/` is generated and gitignored — it contains the full hidden corpus (answer keys included), so it must never be committed. Regenerate it any time with the build script; the source corpus lives in the parent PACES directory (`5_Carousels_PACES23/`, `_index/`).

## Managed access (Phase 1 — sign in with your email, practise on the app's allowance)

Two doors, different rules:

- **BYOK** — free forever, no login, no account. Your key lives only in your browser and rides each request; the server never stores it.
- **Managed** — sign in with your email and a 6-digit code; the server then spends its own Vercel AI Gateway key on your behalf, within a tiered monthly allowance. Login-gated because the operator pays — there is deliberately **no anonymous access to the server key**.

Your tier is decided by your email domain:

| Tier | Who qualifies | Free practice | Allowance |
|---|---|---|---|
| **Public** | Major consumer email providers (gmail.com, outlook.com, yahoo.com, icloud.com, …) | Free practice | US$1 / month |
| **Institutional** | Approved SG-healthcare domains (mohh.com.sg, singhealth.com.sg, nuhs.edu.sg, nhg.com.sg, and major hospitals incl. NTFGH, AH, …) | Free practice | US$1 / month |

Both tiers are the same today — free practice on the app's allowance, US$1 / month; the two names only decide which emails may register (consumer vs SG-healthcare domains) and are kept for possible future differentiation. Any other domain (unknown, disposable, personal) can't use the managed door — BYOK still works for everyone. Allowances are per-user USD spend caps per **calendar month, Singapore time**, metered against the app's own ledger; per-address exceptions (a different tier, or a custom allowance) go in `email_overrides`.

**Sign-in is a 6-digit emailed code, not a link, on purpose:** institutional mail security gateways (Mimecast/Proofpoint-style) rewrite or strip links, which silently breaks link-based sign-in for exactly the users the institutional tier serves. A code is plain body text and survives. Codes are single-use, valid for 10 minutes, and limited to 5 attempts; a session lasts 30 days per browser.

**Managing who gets in** is plain SQL against the `allowed_domains` and `email_overrides` tables — edits apply immediately (eligibility is re-checked from the database on every sign-in *and* every examiner call; no redeploy):

```sql
-- Approve a new institutional domain:
INSERT INTO allowed_domains (domain, tier, note) VALUES ('ah.com.sg', 'institutional', 'Alexandra Hospital');

-- Remove a domain (revokes outstanding sessions on that domain immediately):
DELETE FROM allowed_domains WHERE domain = 'ah.com.sg';

-- Grant one address institutional access with a custom monthly allowance (USD):
INSERT INTO email_overrides (email, tier, monthly_allowance_usd, note) VALUES ('colleague@gmail.com', 'institutional', 5, 'study partner')
ON CONFLICT (email) DO UPDATE SET tier = EXCLUDED.tier, monthly_allowance_usd = EXCLUDED.monthly_allowance_usd, note = EXCLUDED.note;
```

**Setup runbook** (the whole feature is off — and the app BYOK-only — until all of this is in place; see `.env.example` for the annotated variable list):

1. Provision Neon Postgres on Vercel: `vercel integration add neon` (adds `DATABASE_URL` to the project's env), then `vercel env pull .env.local` for local dev — or point `DATABASE_URL` at any plain Postgres yourself.
2. Apply the schema (idempotent, seeds the starter domain lists): `node scripts/migrate.mjs`.
3. Set the remaining env vars: `AUTH_SECRET` (`openssl rand -hex 32`), `DEMO_GATEWAY_API_KEY` (the Vercel AI Gateway key the tier spends — top up its balance manually and leave auto-top-up off, so the balance is a hard ceiling), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (sends the codes; in local dev leave them unset and the code prints to the server console), and optionally `MANAGED_DAILY_CAP_USD` (global backstop across all managed users per Singapore day; default 5).
4. Curate the domain lists to taste with the SQL above.

Using Gmail for SMTP: Gmail blocks plain passwords, so create an **app password** — Google Account → Security → turn on 2-Step Verification → then visit <https://myaccount.google.com/apppasswords>, create one named e.g. "PACES Buddy", and use the 16-character code as `SMTP_PASS` with `SMTP_USER=your@gmail.com`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.

## How it works

- **`scripts/build-content.mjs`** — copies the 287 served carousel encounters (9 forgotten slots are recorded in `placeholders.json`, not served) plus the 216 standalone `_case_library` cases and the 211 canonical grounding notes + marking rubric into `content/`, builds a spoiler-free `manifest.json` (display titles are filename-derived; the case H1 names the diagnosis and stays hidden), and matches each case to its canonical notes for direct-fetch grounding.
- **`POST /api/examiner`** — the examiner function: assembles the examiner brief (persona + rubric in one prompt-cached block, full case file + grounding notes in a second), calls the model with a `search_kb` tool over the reference index as fallback grounding, and for marking gets a structured marksheet (a forced `submit_marksheet` tool call on Anthropic/DeepSeek; a strict-JSON reply on Moonshot/MiniMax, whose endpoints can't force a tool) — per-skill A–G grades, totals recomputed server-side either way.
- **Multi-provider adapter** — every provider speaks the Anthropic Messages API, so one SDK code path serves all of them; the server switches only baseURL + key by the selected model (fixed server-side map — the client never supplies a URL). Budget providers get an extra per-turn examiner-discipline reminder (weaker instruction-following models drift on the reveal rules). Retrieval quality, not model size, does the heavy lifting.
- **Managed access (Phase 1)** — the stateful layer over the Phase-0 gateway: email + 6-digit-code sign-in, domain-tiered eligibility (Postgres `allowed_domains` / `email_overrides`, editable without a redeploy), and per-user reserve-then-settle USD metering (append-only `usage_events` ledger + monthly `user_balances`, plus a global daily backstop). Self top-up / payments are a parked later phase.

`SPEC.md` is the binding design contract (security invariants, prompt text, API shapes). Deployable to Vercel as-is (`outputFileTracingIncludes` bundles `content/` into the serverless functions — run the content build before deploying).

## License & what this repo does (and doesn't) contain

MIT — see `LICENSE`. This repository is the **app only**: engine, UI, content pipeline, and design contract. The clinical case corpus it grounds on is **not** in the repo and never has been — `content/` is generated locally by `scripts/build-content.mjs` from a private source corpus (parent directory) and is gitignored, along with the clinical photos (`public/case-images/`) and all env files. To run your own instance you bring your own case bank in the format `build-content.mjs` expects (or adapt the script), then deploy from your machine with `npx vercel deploy` so your local `content/` uploads with it.
