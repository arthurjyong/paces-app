# PACES AI-Examiner MVP — build spec (binding contract)

One screen (chat + case picker + BYOK key box) + one examiner backend function + the existing 296-case corpus. A candidate picks a case, the AI plays PACES examiner/patient grounded on the case file + canonical notes, reveals findings manoeuvre-by-manoeuvre, runs the viva, and marks against the official rubric with structured output. Stack: Next.js 16 (App Router, TypeScript, Tailwind v4) + `@anthropic-ai/sdk`. Deployable to Vercel; runs locally with `npm run dev`.

**App root:** `/Volumes/Acer FA200 4TB/Work/Exams-&-Training/PACES/paces-app` (path contains spaces — always quote in shell commands).
**Corpus root (source data):** the parent directory, i.e. `..` from the app root.
**Shared types:** `lib/types.ts` (already written — code against it, never redefine its types).

## Security invariants (any violation is a critical bug)

1. **Hidden content never reaches the client.** The client may only ever receive: the manifest (`PublicCaseMeta` fields — `CaseMeta` minus `canonicalSlugs` and `file`; `canonicalSlugs` is matched from the case H1 title so the slugs name the diagnosis, per invariant 4's rationale), the `stem` of a case, Claude's chat replies, and the marksheet. The case H1 title, expected findings, model presentation, viva answers, answer key, surrogate brief, canonical notes, and assembled prompts must NEVER appear in any client-visible payload, including error messages. `displayTitle` is built from filename metadata only (the H1 title names the diagnosis — it is a spoiler).
2. **The user's API key is never stored or logged server-side.** It arrives per-request in the `API_KEY_HEADER` header, is passed straight to the Anthropic SDK constructor, and is never written to disk, console, or error output.
3. **No path traversal.** `caseId` and slugs from the client are resolved ONLY via lookup in the parsed manifest / canonical listing — never by joining user input into a filesystem path.
4. **`search_kb` results stay server-side.** The chat response exposes only `kbLookups` (a count). Queries and matched slugs would leak the diagnosis.
5. **Dry-run mode** (`POST /api/examiner?dryRun=1`, returns assembled system blocks without calling Anthropic) must be gated to `process.env.NODE_ENV === 'development'` — return 404 otherwise.

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
- Cases: `../5_Carousels_PACES23/Carousels/_enriched/<sitting>/<N>_Station<S>_<Specialty>.md` — 37 sitting dirs × 8 files = 296.
- Canonical notes: `../_index/canonical/*.md` — 156 files, YAML-ish front matter between `---` lines with `condition:`, `aliases:` (YAML list, inline `[a, b]` or `- item` lines), `systems:`, `sources_used:`.
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
- `sittingLabel`: from sitting dir name — `2024-03_CGH_Cx` → "CGH · Mar 2024"; suffixes: `_Cx` → "" (drop), `_Cycle1` → " · Cycle 1", `_AM`/`_PM` → " · AM"/" · PM". Format: `<HOSPITAL> · <Mon> <YYYY><suffix>`.
- `displayTitle`: `Station <S> · <Specialty>` — from filename metadata ONLY (invariant 1).
- Stem extraction (validation only — the stem is served at runtime by Agent B's parser, but Agent A must verify every file HAS one): section from the `## Candidate stem` heading (prefix match) to the next `## ` heading. Fail the build loudly listing any file without a non-empty stem.
- `canonicalSlugs`: match the case's H1 title (+ first blockquote line) against every canonical note's `condition` + `aliases`: case-insensitive, word-boundary-ish substring (alias appears in title text); consider only aliases/conditions ≥ 6 chars to avoid junk matches; score by matched-string length; keep top 3 slugs max. Empty is fine (most communication cases). Report the match-rate per encounterType.

Report back: case count (must be 296), canonical count (must be 156), kb term count, stem-extraction failures (must be 0), canonical match-rate by type, and 3 sample manifest entries.

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

## Agent C — frontend (client components; talk to the backend ONLY via the three API routes)

Single-page app in `app/page.tsx` + `components/`. Clean, calm, clinical look (Tailwind v4 classes; the scaffold's `globals.css` already wires Tailwind — extend, don't fight it). Dark-mode friendly (the scaffold defaults handle it). No extra npm deps (no markdown lib — render replies as whitespace-preserving text with minimal bold handling if trivial, else plain `whitespace-pre-wrap`).

Layout: left sidebar + main chat pane.
- **Sidebar — Settings** (collapsible): password-type input for the Anthropic API key (persist to `localStorage` key `paces.apiKey`; note under it: "Stored only in this browser. Sent per-request to your own backend, never saved server-side."), model `<select>` from `MODEL_ALLOWLIST` with `MODEL_LABELS` (persist `paces.model`).
- **Sidebar — Case picker**: fetch `/api/manifest` on load. Filter chips by specialty (All / Cardiovascular / Respiratory / Neurology / Abdominal / Communication / Consultation) + a "Random case" button. Cases grouped by `sittingLabel` (collapsible groups), each row = `displayTitle` (+ skills as tiny badges). Selecting a case fetches `/api/case/[id]`.
- **Main pane**: on case select, show a stem card (distinct styling, the `stem` markdown as pre-wrapped text) with a "Begin encounter" button. Begin sends the literal user message `[BEGIN ENCOUNTER]` (render this turn in the transcript as a system-y "Encounter started" divider, not as a user bubble). Then a normal chat: user input (textarea, Enter to send, Shift+Enter newline), assistant/user bubbles, a subtle per-reply token-usage line (e.g. "↑1.2k ↓340 · cache 8.1k"), loading indicator while awaiting. Buttons in a top bar: "Finish & marksheet" (sends `action:'mark'`, then renders the marksheet as a card: one row per skill — skill letter, name, grade as a coloured chip (2 green "Satisfactory" / 1 amber "Borderline" / 0 red "Unsatisfactory"), justification; then total/maxTotal, overall impression, biggest improvement) and "New case" (confirm, then reset).
- All examiner calls: `POST /api/examiner` with the full transcript (client holds state; `[BEGIN ENCOUNTER]` included as the first user message), key in `API_KEY_HEADER`, chosen model. Missing key → inline banner "Add your Anthropic API key in Settings to start." Errors → red inline notice with the server's `error` string, transcript preserved, input re-enabled.
- No streaming in MVP (plain JSON round-trip). Keep state in React only (no persistence of transcripts).

## Integration & smoke tests (Integrator agent)

1. `node scripts/build-content.mjs` → verify content/ outputs + manifest count 296.
2. `npx tsc --noEmit` and `npm run build` → fix until clean (any file).
3. `npm run dev` on a free port (e.g. 3199), then:
   - `GET /api/manifest` → 200, 296 cases, spot-check a `CaseMeta` for spoiler-free `displayTitle`.
   - `GET /api/case/2024-03_CGH_Cx__4` → stem present, no "Expected findings"/"Answer key" text in payload.
   - `POST /api/examiner?dryRun=1` for the same case → two system blocks; block 1 contains "MARKING RUBRIC"; block 2 contains "Answer key"; `toolNames` = ["search_kb"].
   - `POST /api/examiner` without key → 401. With key `sk-ant-invalid` → 401 mapped cleanly (proves the Anthropic call path executes).
4. Kill the dev server. Report every check's result.
