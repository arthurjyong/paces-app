# PACES AI-Examiner MVP — build spec (binding contract)

One screen (chat + case picker + BYOK key box) + one examiner backend function + the existing 503-case corpus (287 carousel encounters + 216 standalone library cases). A candidate picks a case, the AI plays PACES examiner/patient grounded on the case file + canonical notes, reveals findings manoeuvre-by-manoeuvre, runs the viva, and marks against the official rubric with structured output. Stack: Next.js 16 (App Router, TypeScript, Tailwind v4) + `@anthropic-ai/sdk`. Deployable to Vercel; runs locally with `npm run dev`.

**App root:** `/Volumes/Acer FA200 4TB/Work/Exams-&-Training/PACES/paces-app` (path contains spaces — always quote in shell commands).
**Corpus root (source data):** the parent directory, i.e. `..` from the app root.

## Nomenclature (binding — the three case axes; locked with Arthur 2026-07-06)

Every case is described by three INDEPENDENT axes. Never mix them in labels, filters, or copy:

1. **Classification** — what kind of encounter it is: `consultation` | `communication` | `examination` (the `encounterType` field). This is the picker's default grouping and its filter chips. (Consult = old "Station 5" = brief clinical consultation — one skill; station numbers are format artifacts and never appear on consult labels.)
2. **Theme** — the clinical topic (`theme` field: cardiology, ophthalmology, nephrology, endocrine, …; curated in `../_index/case_themes.json`). An attribute, not a station. The four exam systems are both a station format and a theme. UI: tick-box multi-select with Select all.
3. **Source** — for carousel cases: the real sitting ("NUH · Mar 2026"). For ALL standalone cases: one pooled type-named bank — "Consult bank" / "Communication bank" / "Examination bank" (per Arthur 2026-07-06: collection provenance is deliberately NOT user-visible; it stays internal). Source labels must never smuggle in content/topic ("Eye OSCEs" was wrong — the eye-ness is theme=ophthalmology), author names, or initials — and collection dir names flow into served `id`/`sitting`/`file` fields, so the DIR names must be neutral too.

`specialty` (filename-derived: Cardiovascular/…/Communication/Consultation) is a legacy field that mixes axes 1 and 2 — keep it server/meta-only for exam-station grouping; don't build new UI on it.
**Shared types:** `lib/types.ts` (already written — code against it, never redefine its types).

## Security invariants (any violation is a critical bug)

1. **Hidden content never reaches the client.** The client may only ever receive: the manifest (`PublicCaseMeta` fields — `CaseMeta` minus `canonicalSlugs` and `file`; `canonicalSlugs` is matched from the case H1 title so the slugs name the diagnosis, per invariant 4's rationale), the `stem` of a case, Claude's chat replies, and the marksheet. The case H1 title, expected findings, model presentation, viva answers, answer key, surrogate brief, canonical notes, and assembled prompts must NEVER appear in any client-visible payload, including error messages. `displayTitle` is built from filename metadata only (the H1 title names the diagnosis — it is a spoiler).
2. **The user's API key is never stored or logged server-side.** It arrives per-request in the `API_KEY_HEADER` header, is passed straight to the Anthropic SDK constructor, and is never written to disk, console, or error output.
3. **No path traversal.** `caseId` and slugs from the client are resolved ONLY via lookup in the parsed manifest / canonical listing — never by joining user input into a filesystem path.
4. **`search_kb` results stay server-side.** The chat response exposes only `kbLookups` (a count). Queries and matched slugs would leak the diagnosis.
5. **Dry-run mode** (`POST /api/examiner?dryRun=1`, returns assembled system blocks without calling Anthropic) must be gated to `process.env.NODE_ENV === 'development'` — return 404 otherwise.
6. **The server-held demo key never reaches the client** and is only ever used server-side behind a valid signed demo session — see the "Demo access" section below for the gate's own invariants.

## File ownership (agents work ONLY in their own files)

| Owner | Files |
|---|---|
| pre-written | `SPEC.md`, `lib/types.ts` |
| Agent A — content | `scripts/build-content.mjs`, generated `content/**` |
| Agent B — backend | `lib/content.ts`, `lib/kb.ts`, `lib/prompt.ts`, `app/api/manifest/route.ts`, `app/api/case/[id]/route.ts`, `app/api/examiner/route.ts`, `next.config.ts` (add `outputFileTracingIncludes` only) |
| Agent C — frontend | `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/**` |
| Integrator | anything, to make it build + pass smoke tests |

## Agent A — content pipeline (`scripts/build-content.mjs`, plain Node ESM, no deps)

Reads the corpus and emits `content/` in the app root. Must be re-runnable (idempotent, wipes and rebuilds `content/`). Run it once at the end and report stats.

Sources (relative to app root):
- Carousel cases: `../5_Carousels_PACES23/Carousels/_enriched/<sitting>/<N>_Station<S>_<Specialty>.md` — 37 sitting dirs × 8 files = 296 slots; the 9 forgotten/placeholder slots are recorded in `content/placeholders.json` and NOT served (assert served 287 + placeholders 9 === 296).
- Library cases: `../_case_library/<collection>/<NNN>_Station<S>_<Specialty>.md` — 216 standalone cases in 6 collections; ALL pool into type-named banks (`BANK_LABELS`: "Consult bank" / "Communication bank" / "Examination bank") with `encounterNo` renumbered sequentially per bank; the stable id keys off the collection + FILE number. Collection dir names flow into served `id`/`sitting`/`file` fields, so dir names must be neutral (no author names/initials). Served total: 503.
- Canonical notes: `../_index/canonical/*.md` — 211 files (assert ≥ 156), YAML-ish front matter between `---` lines with `condition:`, `aliases:` (YAML list, inline `[a, b]` or `- item` lines), `systems:`, `sources_used:`.
- Master index: `../_index/MASTER_INDEX.json` — use `topic_lookup` (term → array of `{corpus, file, location}`).
- Rubric: `../5_Carousels_PACES23/MARKING_RUBRIC_PACES23.md`.

Outputs:
- `content/cases/<sitting>__<filename>` — verbatim copy of each case file, flattened name, e.g. `content/cases/2024-03_CGH_Cx__4_Station3_Cardiovascular.md`.
- `content/canonical/<slug>.md` — verbatim copies.
- `content/rubric.md` — verbatim copy.
- `content/kb_lookup.json` — `KbLookup`: from `topic_lookup`, keep only refs with `corpus === "canonical"`, map lowercased term → array of canonical slugs (basename of `file` without `.md`). Drop terms with no canonical ref.
- `content/manifest.json` — `Manifest` (see `lib/types.ts`), cases sorted by sitting then encounterNo.

Per-case parsing rules:
- `encounterNo`, `station`, `specialty` from the filename (`4_Station3_Cardiovascular.md` → 4, 3, "Cardiovascular").
- `encounterType`: specialty "Communication" → `communication`; "Consultation" → `consultation`; else `examination`.
- `skills`: parse the line-2 blockquote `skills: A·B·D·E·G` (middot-separated). Fallback by type: examination → A,B,D,E,G; communication → C,E,F,G; consultation → A–G. Report any file where parsed skills differ from the fallback expectation (informational, not fatal).
- `timing` by encounterType: examination → "6 min exam + 4 min Q&A"; communication → "5 min reading + 10 min"; consultation → "5 min reading + 15 min + 5 min Q&A".
- `sittingLabel`: from sitting dir name — `2024-03_CGH_Cx` → "CGH · Mar 2024". Format: `<HOSPITAL> · <Mon> <YYYY>`; the dir-name suffix (`_Cx` / `_CycleN` / `_AM` / `_PM`) is validated but DROPPED (a format artifact — same-month sittings share a label and merge in the picker). Library cases use the collection's `LIBRARY_LABELS` source name instead.
- `displayTitle`: `Station <S> · <Specialty>` for examination/communication; every `consultation` case (carousel + library) is plain `"Consultation"` (no station number — consult / "Station 5" / brief clinical consultation are the same skill; the number is a format artifact). From filename metadata ONLY (invariant 1).
- Stem extraction (validation only — the stem is served at runtime by Agent B's parser, but Agent A must verify every file HAS one): section from the `## Candidate stem` heading (prefix match) to the next `## ` heading. Fail the build loudly listing any file without a non-empty stem.
- `canonicalSlugs`: match the case's H1 title (+ first blockquote line) against every canonical note's `condition` + `aliases`: case-insensitive, word-boundary-ish substring (alias appears in title text); consider only aliases/conditions ≥ 6 chars to avoid junk matches; score by matched-string length; keep top 3 slugs max. Empty is fine (most communication cases). Report the match-rate per encounterType.

Report back: case count (must be 503 = 287 carousel + 216 library, with carousel 287 + placeholders 9 === 296), canonical count (must be ≥ 156), kb term count, stem-extraction failures (must be 0), canonical match-rate by type, and 3 sample manifest entries.

## Agent B — backend

### `lib/content.ts` — server-only loaders (fs reads from `path.join(process.cwd(), 'content')`), each cached in a module-level variable:
- `getManifest(): Manifest`, `getCaseMeta(id): CaseMeta | undefined`
- `getCaseFull(id): string` — full case markdown (server-side only)
- `getCaseStem(id): string` — the `## Candidate stem` section only (heading prefix-match to next `## `), stripped of the heading line itself
- `getCanonicalNote(slug): string | undefined` — only slugs present in the canonical dir listing (build a Set at startup; invariant 3)
- `getRubric(): string`

### `lib/kb.ts` — the `search_kb` implementation:
- Load `content/kb_lookup.json` once. `searchKb(query: string): { slugs: string[], text: string }`.
- Normalize query (lowercase, trim, collapse spaces). Match: exact term hit first; else terms that contain the query or vice-versa (substring, both directions); score by overlap length; collect top canonical slugs (max 2 distinct notes).
- Return the concatenated note contents (each prefixed `--- canonical/<slug>.md ---`), total capped at ~20,000 chars; empty-result message "No canonical note matched. Answer from the case brief and general medical knowledge, flagging uncertainty." if nothing matches.

### `lib/prompt.ts` — prompt assembly:
`buildSystem(meta: CaseMeta): TextBlockParam[]` returning exactly two system blocks, each with `cache_control: { type: 'ephemeral' }`:

**Block 1 (static across all cases):** the examiner persona below, with the rubric (from `getRubric()`) appended verbatim under the heading `# MARKING RUBRIC (apply exactly)`.

The persona text (verbatim, this is the product's core — do not paraphrase):

```
You are an MRCP PACES examiner running one practice encounter with a candidate, over text chat. For communication and consultation encounters you ALSO play the simulated patient, relative, or colleague. The human is always the candidate — never speak for them. Realistic, professional, exam-standard throughout. British English, standard PACES conventions.

THE ENCOUNTER BRIEF in the next system block contains: the encounter type and skills marked, the full case file (stem, expected findings keyed to examination manoeuvres, model presentation, viva questions with model answers, hidden answer key), and reference grounding notes. The candidate has already read the candidate stem — do not re-read it to them.

YOUR ROLE BY ENCOUNTER TYPE:
- EXAMINATION encounter (Respiratory / Cardiovascular / Neurology / Abdominal; skills A·B·D·E·G): you are the examiner invigilating a 6-minute physical examination. The candidate tells you what they examine or look for, step by step. For each manoeuvre they actually perform, reveal EXACTLY the findings the case file keys to that manoeuvre — nothing more, nothing sooner, faithful to the file's wording of the clinical signs. If they perform a manoeuvre the file doesn't cover, give a realistic noncontributory/normal finding without inventing diagnostic facts. Do not volunteer findings for steps they skipped; missed signs are marked, not rescued (do not prompt or hint, beyond a single neutral "is there anything else you wish to examine?" when they say they are done). When they finish (or the exchange clearly reaches examination's end), ask them to present their findings and diagnosis. Then run the viva from the case file's questions, adapting to what they missed. Keep each of your turns short and examiner-like.
- COMMUNICATION encounter (skills C·E·F·G): play the character in the case file's surrogate brief — their knowledge, emotions, and behavioural rules (including how they respond to a good vs poor approach). Stay strictly in character; reveal facts only as the brief allows and only when the candidate's approach earns them. Press with the character's scripted questions and concerns at natural moments. Do NOT slip into examiner voice until the candidate says they are finished (or clearly closes the conversation) — then debrief.
- CONSULTATION encounter (all 7 skills A–G): play the patient from the brief for the history; answer only from the brief's facts ("I'm not sure, doctor" for anything not covered). When the candidate examines, reveal findings per the examination rules above. After their presentation, switch to examiner Q&A from the case file.

GOLDEN RULES:
1. NEVER reveal, hint at, or confirm the diagnosis, the answer key, the model presentation, or model viva answers until the candidate has committed to a presentation and diagnosis (or explicitly ends the encounter). This includes indirect leaks: over-specific vocabulary, leading questions, or confirming a guess mid-encounter.
2. Use only the facts in the encounter brief. Never invent new clinical facts, results, or history. Patients don't know medical terminology they wouldn't plausibly know.
3. Findings are earned: reveal strictly manoeuvre-by-manoeuvre / question-by-question.
4. Once the candidate has presented and the viva is done (or they give up), switch to TUTOR DEBRIEF: state the diagnosis and key discriminators, compare their presentation with the model presentation, list what they found, missed, or invented, and give focused teaching from the viva material and grounding notes.
5. In viva and debrief, ground factual specifics (management, investigations, guidelines) in the encounter brief and grounding notes; use the search_kb tool for tangents they don't cover rather than answering from memory. Flag any residual uncertainty honestly.
6. When asked to mark (the marksheet request), grade per the rubric below: ONLY the skills marked for this encounter; apply the "skip the courtesies" rules exactly (never score or nag about hand hygiene, introductions, consent, draping); weight B (signs) and D (diagnosis) heavily for examination encounters; every Borderline or Unsatisfactory needs a one-line justification tied to the descriptors; name the single change that would most improve the weakest skill.
7. If the candidate types "[BEGIN ENCOUNTER]", open the encounter in role: examinations → invite them to begin examining; communication/consultation → open with the scene and, where the brief scripts one, the character's opening line.
```

**Block 2 (per case):** header lines `ENCOUNTER: <displayTitle> · <sittingLabel> · type=<encounterType> · skills=<skills> · timing=<timing>`, then `# CASE FILE (hidden from candidate — the candidate has seen ONLY the "Candidate stem" section)` + full case markdown, then for each canonical slug `# REFERENCE GROUNDING: <slug> (for viva/debrief accuracy; never read out verbatim)` + note text. Cap block 2 at ~150,000 chars (truncate grounding notes first, never the case file).

### API routes (all `export const runtime = 'nodejs'`):
- `GET /api/manifest` → `PublicManifest` (200) — the full `Manifest` (with `canonicalSlugs`) stays server-side for prompt assembly (invariant 1).
- `GET /api/case/[id]` → `PublicCase` or 404 `ApiError`.
- `POST /api/examiner` → body `ExaminerRequest`, key from `API_KEY_HEADER` (401 `ApiError` if missing/blank; 400 on unknown caseId, model not in `MODEL_ALLOWLIST`, empty messages, messages > 400, or any message > 30,000 chars).
  - `action: 'chat'`: `messages.create` with the two system blocks, transcript as-is, `max_tokens: 1500`, tools: [`search_kb` — description: "Look up a condition, sign, or topic in the PACES reference library. Returns the canonical grounding note. Use for viva/debrief tangents not covered by the encounter brief."; input schema `{ query: string }`]. Tool-use loop: while `stop_reason === 'tool_use'` (max 3 iterations) run `searchKb`, append tool_result, re-call. Reply = concatenated text blocks. Respond `ExaminerChatResponse` with real `usage` (sum across iterations; map `cache_read_input_tokens`/`cache_creation_input_tokens`).
  - `action: 'mark'`: same system blocks; append user turn "Please complete the marksheet for this encounter now, based strictly on the transcript so far."; single tool `submit_marksheet` (input schema mirroring `MarkSheet`; skills enum A–G, grade enum 0/1/2), `tool_choice: { type: 'tool', name: 'submit_marksheet' }`, `max_tokens: 2500`. Validate: skills ⊆ the case's marked skills, recompute `total`/`maxTotal` server-side. Respond `ExaminerMarkResponse`.
  - Anthropic errors: map 401 → 401 "Invalid API key", 429 → 429 "Rate limited by Anthropic", else 502 with the SDK's error message ONLY if it cannot contain case content (use a generic message otherwise). Never include prompts in errors.
  - `?dryRun=1` (dev only, invariant 5): return `{ systemBlocks, toolNames }` without calling Anthropic.
- `next.config.ts`: add `outputFileTracingIncludes: { '/api/**': ['./content/**'] }` so Vercel bundles the content dir.

## Demo access (whitelisted magic-link sign-in)

Purpose: let a small set of invited users (whitelisted by email) practise on a **server-held, spend-capped** Anthropic key with zero BYOK friction, while keeping that key unusable by anyone else. Entirely optional: with the env unset the feature is invisible and the app stays BYOK-only. Implementation: `lib/demo.ts` (server-only), `app/api/demo/{request,verify,status}/route.ts`, `components/DemoAccess.tsx`; `nodemailer` is the feature's only dependency. In the UI the sidebar section is labelled **"Invited access"** ("demo" is the owner's framing, not the invitee's) and it renders ABOVE Settings; the `?demo=active|invalid` flag appended by verify's redirect is handled by `page.tsx` as a main-pane banner (visible on mobile, where the sidebar is off-canvas), and a keyless 401 from `/api/examiner` is surfaced as sign-in-expired guidance plus a demo-status re-fetch, never the raw "Missing API key".

**Env** (documented in `.env.example` / README): `DEMO_WHITELIST` (comma-separated emails, matched case-insensitive + trimmed), `DEMO_ANTHROPIC_API_KEY` (server-held key; unset = demo mode off), `AUTH_SECRET` (HMAC secret, required), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (unset ⇒ **in development** the magic link is logged to the server console instead of emailed; **in production** a missing or partial SMTP config logs a loud error and the link is NOT sent and NOT logged — a live sign-in credential must never land in deployment logs; never a hard failure either way), `APP_BASE_URL` (magic-link base; **required in production** — emailed links are never built from the request-derived origin there, because Host / x-forwarded-host is sender-controlled and a poisoned host would deliver a whitelisted victim's real link token to an attacker domain; if unset in production, link generation fails closed with a server-side error while the generic 200 still goes out. Development falls back to the request origin so the local flow needs no config. The request-derived origin remains fine for verify's same-origin redirects).

**Tokens** are stateless HMAC signatures (no DB): `base64url(JSON{email, purpose, exp}) + '.' + base64url(HMAC-SHA256(AUTH_SECRET, payload))`. Two disjoint purposes, checked on verification: `link` (emailed, 15 min) and `session` (httpOnly cookie `demo_session`, 30 days) — so a captured session cookie can never be replayed through `/api/demo/verify` to mint fresh sessions.

**Flow**
1. `POST /api/demo/request` `{email}` → **always** the same generic 200 (`DEMO_REQUEST_MESSAGE` in `lib/types.ts`), whitelisted or not, configured or not. If (and only if) demo mode is fully configured, the email is whitelisted, AND a trusted link base is available (`APP_BASE_URL`, or the request origin in dev — see env above), a `link` token is signed and the magic link `{base}/api/demo/verify?token=…` is emailed — inside `after()`, so response timing can't leak the branch. Best-effort in-memory rate limit: 5/hour per email and 30/hour per IP (looser per-IP because hospital NATs put many invitees behind one address, and `x-forwarded-for` is only meaningful behind a trusted proxy such as Vercel), applied *before* the whitelist check (a 429 carries no membership signal). Both buckets are checked before either consumes a slot, so an IP-rejected burst can't drain an email's allowance. Known, accepted tradeoff: a third party who knows an invited address can fill that email's bucket (temporary sign-in lockout) — scoping the count to whitelisted emails would turn the 429 threshold into a membership oracle. Acceptable as best-effort in serverless because the tokens are unguessable anyway.
2. `GET /api/demo/verify?token=` → constant-time signature check (both comparands SHA-256-hashed first, then `timingSafeEqual`), expiry check, purpose=`link` check, and the email must **still** be whitelisted at verify time. Success: set `demo_session` (httpOnly, Secure in production, SameSite=Lax, 30 d) containing a fresh `session` token and redirect to `/?demo=active`. **Every** failure redirects to `/?demo=invalid` — no detail about which check failed.
3. `GET /api/demo/status` → `{active: boolean, email?: masked "c***@domain"}` from the cookie, for UI state only. `active` requires the full working path: valid signed cookie + still whitelisted + `DEMO_ANTHROPIC_API_KEY` set.
4. `POST /api/examiner`: a client-supplied BYOK key (`API_KEY_HEADER`) takes precedence exactly as before; else a **valid** `demo_session` cookie (signed, unexpired, still-whitelisted) + `DEMO_ANTHROPIC_API_KEY` set ⇒ the server key is used; else the existing 401 "Missing API key". An upstream Anthropic 401 on the demo key maps to a 502 "demo access key rejected" (owner's problem), not 401 "Invalid API key" (which would send a keyless user hunting for a key).

**Invariants (violations are critical bugs, same standing as the list at the top)**
- The whitelist is enforced at request time AND verify time AND every use of the session (status + examiner) — removing an email from `DEMO_WHITELIST` revokes outstanding links and cookies immediately.
- All demo endpoints answer generically: no response (status code, body, redirect target, or timing) may reveal whether an email is whitelisted or why a token failed.
- `DEMO_ANTHROPIC_API_KEY` is never sent to, or readable by, the client in any form — it goes from `process.env` straight into the Anthropic SDK constructor server-side, under invariant 2's no-store/no-log rules, and only behind a valid signed cookie.
- BYOK precedence is absolute: a request carrying `API_KEY_HEADER` never touches the server key.
- The demo gate changes nothing else: answer-key hiding (invariant 1), `PublicCaseMeta` projection, model allowlist, and all other existing invariants hold unchanged with or without a demo session.

## Agent C — frontend (client components; talk to the backend ONLY via the three API routes)

Single-page app in `app/page.tsx` + `components/`. Clean, calm, clinical look (Tailwind v4 classes; the scaffold's `globals.css` already wires Tailwind — extend, don't fight it). Dark-mode friendly (the scaffold defaults handle it). No extra npm deps (no markdown lib — render replies as whitespace-preserving text with minimal bold handling if trivial, else plain `whitespace-pre-wrap`).

Layout: left sidebar + main chat pane.
- **Sidebar — Settings** (collapsible): password-type input for the Anthropic API key (persist to `localStorage` key `paces.apiKey`; note under it: "Stored only in this browser. Sent per-request to your own backend, never saved server-side."), model `<select>` from `MODEL_ALLOWLIST` with `MODEL_LABELS` (persist `paces.model`).
- **Sidebar — Case picker**: fetch `/api/manifest` on load. Classification filter chips (All / Consultation / Communication / Examination, on `encounterType`), a collapsible **Themes** tick-box panel (Select-all + one checkbox per theme with counts; default all selected), + a "Random case" button. Two groupings (segmented toggle, collapsible groups): default **"By type"** — Consultation / Communication / Examination · `<system>`, each row = `sittingLabel` (the source tag) + `#encounterNo` + theme; **"By source"** — grouped by `sittingLabel`: carousel sittings first (same-month sittings merge), then the pooled banks pinned last in fixed order (Consult / Communication / Examination bank; empty banks render as "No cases yet." placeholders when unfiltered), each row = `displayTitle` + `#encounterNo` + theme. The A–G skill letters appear NOWHERE in the browsing/pre-case UI (per Arthur 2026-07-06 — unexplained letter badges confuse; they're also near-constant within a classification). Skills surface only in the final marksheet, where each letter carries its full name, grade, and justification. Selecting a case fetches `/api/case/[id]`.
- **Main pane**: on case select, show a stem card (distinct styling, the `stem` markdown as pre-wrapped text) with a "Begin encounter" button. Begin sends the literal user message `[BEGIN ENCOUNTER]` (render this turn in the transcript as a system-y "Encounter started" divider, not as a user bubble). Then a normal chat: user input (textarea, Enter to send, Shift+Enter newline), assistant/user bubbles, a subtle per-reply token-usage line (e.g. "↑1.2k ↓340 · cache 8.1k"), loading indicator while awaiting. Buttons in a top bar: "Finish & marksheet" (sends `action:'mark'`, then renders the marksheet as a card: one row per skill — skill letter, name, grade as a coloured chip (2 green "Satisfactory" / 1 amber "Borderline" / 0 red "Unsatisfactory"), justification; then total/maxTotal, overall impression, biggest improvement) and "New case" (confirm, then reset).
- All examiner calls: `POST /api/examiner` with the full transcript (client holds state; `[BEGIN ENCOUNTER]` included as the first user message), key in `API_KEY_HEADER`, chosen model. Missing key → inline banner "Add your Anthropic API key in Settings to start." Errors → red inline notice with the server's `error` string, transcript preserved, input re-enabled.
- No streaming in MVP (plain JSON round-trip). Keep state in React only (no persistence of transcripts).

## Integration & smoke tests (Integrator agent)

1. `node scripts/build-content.mjs` → verify content/ outputs + manifest count 503.
2. `npx tsc --noEmit` and `npm run build` → fix until clean (any file).
3. `npm run dev` on a free port (e.g. 3199), then:
   - `GET /api/manifest` → 200, 503 cases, spot-check a `CaseMeta` for spoiler-free `displayTitle`.
   - `GET /api/case/2024-03_CGH_Cx__4` → stem present, no "Expected findings"/"Answer key" text in payload.
   - `POST /api/examiner?dryRun=1` for the same case → two system blocks; block 1 contains "MARKING RUBRIC"; block 2 contains "Answer key"; `toolNames` = ["search_kb"].
   - `POST /api/examiner` without key → 401. With key `sk-ant-invalid` → 401 mapped cleanly (proves the Anthropic call path executes).
4. Kill the dev server. Report every check's result.
