# PACES Practice — AI examiner

A shareable, BYOK (bring-your-own-key) web app for practising MRCP PACES with an AI examiner. Pick one of 296 past-year mock encounters; the AI plays examiner (and simulated patient/relative for communication and consultation stations), reveals findings only as you examine, runs the viva, then marks you against the official PACES rubric with a structured per-skill marksheet.

Built on Next.js (App Router) + the Anthropic API. The candidate's browser only ever sees the case stem and the examiner's replies — expected findings, model answers, and the answer key stay server-side.

## Run it locally

```bash
npm install
node scripts/build-content.mjs   # builds content/ from the PACES corpus (parent directory)
npm run dev                      # http://localhost:3000
```

Then open the app, paste your Anthropic API key in **Settings** (stored only in your browser, sent per-request, never saved server-side), pick a case, and begin.

`content/` is generated and gitignored — it contains the full hidden corpus (answer keys included), so it must never be committed. Regenerate it any time with the build script; the source corpus lives in the parent PACES directory (`5_Carousels_PACES23/`, `_index/`).

## How it works

- **`scripts/build-content.mjs`** — copies the 296 enriched encounters, 156 canonical grounding notes, and the marking rubric into `content/`, builds a spoiler-free `manifest.json` (display titles are filename-derived; the case H1 names the diagnosis and stays hidden), and matches each case to its canonical notes for direct-fetch grounding.
- **`POST /api/examiner`** — the one backend function: assembles the examiner brief (persona + rubric in one prompt-cached block, full case file + grounding notes in a second), calls Claude with a `search_kb` tool over the reference index as fallback grounding, and for marking forces a structured `submit_marksheet` tool call (per-skill A–G grades, totals recomputed server-side).
- **Model picker** — Sonnet 4.6 by default; Opus 4.8 and Haiku 4.5 selectable. Cost is the user's dial; retrieval quality, not model size, does the heavy lifting.

`SPEC.md` is the binding design contract (security invariants, prompt text, API shapes). Deployable to Vercel as-is (`outputFileTracingIncludes` bundles `content/` into the serverless functions — run the content build before deploying).
