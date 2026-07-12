'use client';

// Lab experiment 1 — voice dictation playground. Record once, transcribe on
// one or two lanes (A/B on the same clip is the decision-maker for the
// default model), inspect duration/latency/cost, diff the two transcripts,
// and score a take against a "golden sentence" read aloud. The bias-context
// box maps to the whisper `prompt` parameter — CLIENT-VISIBLE content only
// (a static PACES glossary by default); the server never adds case material.
//
// Dictation needs a managed sign-in: it spends the project's server-held STT
// credit (SPEC invariant 9 — no anonymous server-key path, ever). The page
// itself is open to everyone.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import LabRecorder, { type RecordedClip } from '@/components/LabRecorder';
import {
  MAX_STT_PROMPT_CHARS,
  type SttModelPublic,
  type TranscribeOk,
  type TranscribeStatus,
} from '@/lib/stt-shared';

// Static PACES glossary (~200 tokens — at whisper's prompt budget). Exact
// casing on purpose: whisper mirrors the prompt's casing in its output.
const DEFAULT_GLOSSARY =
  'MRCP PACES dictation. Glossary: pan-systolic murmur, slow-rising pulse, ' +
  'hepatosplenomegaly, spider naevi, polycystic kidney disease, arteriovenous fistula, ' +
  'idiopathic pulmonary fibrosis, fine end-inspiratory crackles, bronchiectasis, ' +
  'spastic paraparesis, peripheral neuropathy, dysdiadochokinesia, fasciculations, ' +
  "myotonic dystrophy, acromegaly, bitemporal hemianopia, Graves' disease, " +
  "systemic sclerosis, sclerodactyly, telangiectasia, Raynaud's phenomenon, " +
  'rheumatoid arthritis, infective endocarditis, tacrolimus, methotrexate, ' +
  'hydroxychloroquine, prednisolone, eGFR, HbA1c';

// Read one aloud, then compare the take against it on the result card —
// a single-speaker accuracy eval on exactly the vocabulary that matters.
const GOLDEN_SENTENCES = [
  'There is a pan-systolic murmur loudest at the apex, radiating to the axilla, consistent with mitral regurgitation.',
  'The pulse is slow rising, and there is an ejection systolic murmur radiating to the carotids, suggesting severe aortic stenosis.',
  'She has a midline sternotomy scar with a metallic first heart sound, in keeping with a mechanical mitral valve replacement.',
  'The abdomen shows hepatosplenomegaly with spider naevi and palmar erythema, suggesting chronic liver disease.',
  'There are bilateral ballotable flank masses and an arteriovenous fistula, consistent with polycystic kidney disease on haemodialysis.',
  'He has a renal transplant in the right iliac fossa and takes tacrolimus and prednisolone for immunosuppression.',
  'Fine end-inspiratory crackles at both bases suggest idiopathic pulmonary fibrosis.',
  'There is stony dullness at the right base with reduced vocal resonance, consistent with a pleural effusion.',
  'Coarse crackles with clubbing raise the possibility of bronchiectasis.',
  'Tone is increased with brisk reflexes and upgoing plantars, in keeping with a spastic paraparesis.',
  'There is glove and stocking sensory loss with absent ankle jerks, suggesting a peripheral neuropathy.',
  'Past-pointing, dysdiadochokinesia, and an ataxic gait localise to the cerebellum.',
  'Bilateral ptosis, frontal balding, and myotonia suggest myotonic dystrophy.',
  'Wasting of the first dorsal interosseous with fasciculations raises motor neurone disease.',
  'Prominent supraorbital ridges, macroglossia, and spade-like hands suggest acromegaly; I would check for bitemporal hemianopia.',
  "She has sclerodactyly, telangiectasia, and Raynaud's phenomenon, consistent with limited cutaneous systemic sclerosis.",
  'There is a symmetrical deforming polyarthropathy with ulnar deviation, consistent with rheumatoid arthritis, managed with methotrexate and hydroxychloroquine.',
  'I would start intravenous ceftriaxone after taking blood cultures, and monitor the creatinine and inflammatory markers.',
  'I would counsel her about driving, alcohol, and adherence, and arrange follow-up with the epilepsy nurse specialist.',
  'The eGFR is forty-five, the creatinine one hundred and eighty micromoles per litre, and the HbA1c sixty-nine millimoles per mole.',
];

interface Run {
  modelId: string;
  label: string;
  state: 'loading' | 'done' | 'error';
  result?: TranscribeOk;
  error?: string;
  goldenIdx: number | null;
}

interface ClipEntry {
  id: number;
  url: string;
  seconds: number;
  interrupted: boolean;
  runs: Run[];
}

type Gate =
  | { state: 'loading' }
  | { state: 'signin' }
  | { state: 'unavailable' }
  | { state: 'ready'; status: TranscribeStatus };

export default function LabPlayground() {
  const [gate, setGate] = useState<Gate>({ state: 'loading' });
  const [primary, setPrimary] = useState('');
  const [abEnabled, setAbEnabled] = useState(false);
  const [second, setSecond] = useState('');
  const [context, setContext] = useState(DEFAULT_GLOSSARY);
  const [draft, setDraft] = useState('');
  const [clips, setClips] = useState<ClipEntry[]>([]);
  /** A session that expired MID-session. Shown as a banner ABOVE the intact
   *  workspace — swapping the whole page for the sign-in panel destroyed the
   *  user's clips, transcripts and draft (review 2026-07-12). */
  const [sessionLost, setSessionLost] = useState(false);
  const nextId = useRef(1);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/transcribe');
        if (!alive) return;
        if (res.status === 401) {
          setGate({ state: 'signin' });
          return;
        }
        if (!res.ok) {
          setGate({ state: 'unavailable' });
          return;
        }
        const status = (await res.json()) as TranscribeStatus;
        if (!alive) return;
        setGate({ state: 'ready', status });
        const first = status.models[0]?.id ?? '';
        setPrimary(first);
        setSecond(status.models.find((m) => m.id !== first)?.id ?? '');
      } catch {
        if (alive) setGate({ state: 'unavailable' });
      }
    })();
    const urls = urlsRef.current;
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // Memoised: a fresh [] each render would re-create every callback below it.
  const models: SttModelPublic[] = useMemo(
    () => (gate.state === 'ready' ? gate.status.models : []),
    [gate]
  );
  const labelFor = useCallback(
    (id: string) => models.find((m) => m.id === id)?.label ?? id,
    [models]
  );

  const runTranscription = useCallback(
    async (clipId: number, blob: Blob, modelId: string, biasContext: string) => {
      const form = new FormData();
      form.append('file', blob);
      form.append('model', modelId);
      if (biasContext.trim()) form.append('prompt', biasContext.trim());
      let update: Partial<Run>;
      try {
        const res = await fetch('/api/transcribe', { method: 'POST', body: form });
        if (res.ok) {
          const result = (await res.json()) as TranscribeOk;
          update = { state: 'done', result };
        } else {
          if (res.status === 401) setSessionLost(true);
          let message = 'Transcription failed — try again';
          try {
            const body = (await res.json()) as { error?: string };
            if (typeof body.error === 'string' && body.error) message = body.error;
          } catch {
            // keep the generic message
          }
          update = { state: 'error', error: message };
        }
      } catch {
        update = { state: 'error', error: 'Network error — check your connection and retry' };
      }
      setClips((prev) =>
        prev.map((c) =>
          c.id !== clipId
            ? c
            : { ...c, runs: c.runs.map((r) => (r.modelId === modelId ? { ...r, ...update } : r)) }
        )
      );
    },
    []
  );

  const onClip = useCallback(
    (clip: RecordedClip) => {
      const id = nextId.current++;
      const url = URL.createObjectURL(clip.blob);
      urlsRef.current.push(url);
      const lanes = [primary, ...(abEnabled && second && second !== primary ? [second] : [])];
      const runs: Run[] = lanes.map((modelId) => ({
        modelId,
        label: labelFor(modelId),
        state: 'loading',
        goldenIdx: null,
      }));
      setClips((prev) => [
        { id, url, seconds: clip.seconds, interrupted: clip.interrupted, runs },
        ...prev,
      ]);
      lanes.forEach((modelId) => void runTranscription(id, clip.blob, modelId, context));
    },
    [primary, second, abEnabled, context, labelFor, runTranscription]
  );

  const setGolden = useCallback((clipId: number, modelId: string, goldenIdx: number | null) => {
    setClips((prev) =>
      prev.map((c) =>
        c.id !== clipId
          ? c
          : { ...c, runs: c.runs.map((r) => (r.modelId === modelId ? { ...r, goldenIdx } : r)) }
      )
    );
  }, []);

  if (gate.state === 'loading') {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking availability…</p>;
  }

  if (gate.state === 'signin') {
    return (
      <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        <p>
          <strong className="text-zinc-800 dark:text-zinc-200">Sign in to try dictation.</strong>{' '}
          Voice transcription runs on the project&apos;s server-held credit, so it needs the same
          free sign-in as practice — there is no anonymous access to the project&apos;s keys.
        </p>
        <p className="mt-2">
          <Link href="/" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Open PACES Buddy
          </Link>
          , sign in from the sidebar (<em>Account</em>), then come back to this page.
        </p>
      </div>
    );
  }

  if (gate.state === 'unavailable' || models.length === 0) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Transcription is not available right now — no lane is configured, or the service is
        temporarily down. Try again later.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sessionLost && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          Your sign-in has expired, so new transcriptions will fail — everything already on this
          page is safe. Sign in again in{' '}
          <Link href="/" className="underline">
            the app
          </Link>{' '}
          (in another tab), then{' '}
          <button
            type="button"
            onClick={() => {
              void fetch('/api/transcribe').then((r) => {
                if (r.ok) setSessionLost(false);
              });
            }}
            className="underline"
          >
            re-check
          </button>
          .
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Model</span>
          <select
            value={primary}
            onChange={(e) => {
              const next = e.target.value;
              setPrimary(next);
              // Keep the A/B arm distinct: if the new primary IS the second
              // lane, move the second lane (or drop A/B when there is no other
              // lane) — otherwise the A/B box stays ticked while only one lane
              // actually runs (review 2026-07-12).
              if (next === second) {
                const alt = models.find((m) => m.id !== next);
                if (alt) setSecond(alt.id);
                else {
                  setSecond('');
                  setAbEnabled(false);
                }
              }
            }}
            className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-base md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {models.length > 1 && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={abEnabled}
                onChange={(e) => setAbEnabled(e.target.checked)}
                className="h-4 w-4 accent-teal-700"
              />
              A/B: also transcribe the same clip with
            </label>
            {abEnabled && (
              <select
                value={second}
                onChange={(e) => setSecond(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-base md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
                aria-label="Second model for A/B"
              >
                {models
                  .filter((m) => m.id !== primary)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </select>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Bias context{' '}
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              (steers spelling of medical terms; edit freely)
            </span>
          </span>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={MAX_STT_PROMPT_CHARS}
            rows={4}
            className="resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-base leading-6 md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {context.length}/{MAX_STT_PROMPT_CHARS}
          </span>
        </label>
        <LabRecorder onClip={onClip} disabled={!primary} />
      </div>

      {/* Composer simulation — transcripts land here like typed text */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Draft{' '}
          <span className="font-normal text-zinc-500 dark:text-zinc-400">
            (where a dictation would land in the real composer)
          </span>
        </span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Insert a transcript below, or type here…"
          className="resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-base leading-6 md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>

      {/* Golden sentences */}
      <details className="rounded-md border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer font-medium">
          Golden sentences — read one aloud, then score the take
        </summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-6 text-zinc-600 dark:text-zinc-300">
          {GOLDEN_SENTENCES.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </details>

      {/* Results, newest first */}
      {clips.map((clip) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          onInsert={(text) => setDraft((d) => (d ? d + ' ' : '') + text)}
          onGolden={setGolden}
        />
      ))}
    </div>
  );
}

function ClipCard({
  clip,
  onInsert,
  onGolden,
}: {
  clip: ClipEntry;
  onInsert: (text: string) => void;
  onGolden: (clipId: number, modelId: string, goldenIdx: number | null) => void;
}) {
  const ab = clip.runs.length === 2 && clip.runs.every((r) => r.state === 'done');
  const abFlags = ab
    ? diffFlags(tokenize(clip.runs[0].result!.text), tokenize(clip.runs[1].result!.text))
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>Clip · {clip.seconds.toFixed(1)}s</span>
        {clip.interrupted && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            interrupted — partial take
          </span>
        )}
      </div>
      <audio controls src={clip.url} className="w-full" preload="metadata" />
      {clip.runs.map((run, i) => (
        <RunBlock
          key={run.modelId}
          clipId={clip.id}
          run={run}
          highlight={abFlags ? abFlags[i === 0 ? 0 : 1] : null}
          onInsert={onInsert}
          onGolden={onGolden}
        />
      ))}
      {ab && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Highlighted words differ between the two transcripts.
        </p>
      )}
    </div>
  );
}

function RunBlock({
  clipId,
  run,
  highlight,
  onInsert,
  onGolden,
}: {
  clipId: number;
  run: Run;
  highlight: boolean[] | null;
  onInsert: (text: string) => void;
  onGolden: (clipId: number, modelId: string, goldenIdx: number | null) => void;
}) {
  return (
    <div className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{run.label}</p>
      {run.state === 'loading' && (
        <p className="mt-1 animate-pulse text-sm text-zinc-400 dark:text-zinc-500">Transcribing…</p>
      )}
      {run.state === 'error' && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{run.error}</p>
      )}
      {run.state === 'done' && run.result && (
        <>
          <TranscriptText text={run.result.text} highlight={highlight} />
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
            {run.result.durationSeconds !== null && <>{run.result.durationSeconds.toFixed(1)}s audio · </>}
            {(run.result.latencyMs / 1000).toFixed(1)}s latency · ${run.result.costUsd.toFixed(4)}
          </p>
          {run.result.warnings?.map((w, i) => (
            <p key={i} className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              ⚠ {w}
            </p>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onInsert(run.result!.text)}
              disabled={!run.result.text}
              className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Insert into draft
            </button>
            <select
              value={run.goldenIdx === null ? '' : String(run.goldenIdx)}
              onChange={(e) =>
                onGolden(clipId, run.modelId, e.target.value === '' ? null : Number(e.target.value))
              }
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              aria-label="Score against a golden sentence"
            >
              <option value="">Score vs golden sentence…</option>
              {GOLDEN_SENTENCES.map((_, i) => (
                <option key={i} value={i}>
                  Sentence {i + 1}
                </option>
              ))}
            </select>
          </div>
          {run.goldenIdx !== null && (
            <GoldenScore expected={GOLDEN_SENTENCES[run.goldenIdx]} actual={run.result.text} />
          )}
        </>
      )}
    </div>
  );
}

function TranscriptText({ text, highlight }: { text: string; highlight: boolean[] | null }) {
  if (!text.trim()) {
    return <p className="mt-1 text-sm italic text-zinc-400 dark:text-zinc-500">(no speech detected)</p>;
  }
  if (!highlight) {
    return <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{text}</p>;
  }
  // Same trim+split as tokenize(), so word indices align with the flags.
  const words = text.trim().split(/\s+/);
  return (
    <p className="mt-1 text-sm leading-6">
      {words.map((w, i) => (
        <span key={i}>
          <span
            className={
              highlight[i] === false
                ? 'rounded bg-amber-200 px-0.5 dark:bg-amber-800/60'
                : undefined
            }
          >
            {w}
          </span>{' '}
        </span>
      ))}
    </p>
  );
}

function GoldenScore({ expected, actual }: { expected: string; actual: string }) {
  const expTokens = tokenize(expected);
  const actTokens = tokenize(actual);
  const [expFlags] = diffFlags(expTokens, actTokens);
  const matched = expFlags.filter(Boolean).length;
  // Same trim+split as tokenize(), so word indices align with the flags.
  const missed = expected
    .trim()
    .split(/\s+/)
    .filter((_, i) => expFlags[i] === false);
  const pct = expTokens.length ? Math.round((matched / expTokens.length) * 100) : 0;
  return (
    <div className="mt-2 rounded-md bg-zinc-50 p-2 text-xs leading-5 dark:bg-zinc-950">
      <p>
        <strong>
          {matched}/{expTokens.length}
        </strong>{' '}
        expected words matched ({pct}%).
      </p>
      {missed.length > 0 && (
        <p className="mt-1 text-red-600 dark:text-red-400">Missed: {missed.join(' ')}</p>
      )}
    </div>
  );
}

// ── word-level diff (LCS) ────────────────────────────────────────────────────

/**
 * Number words → digits, so a take is not marked WRONG for correctly writing
 * "45" where the golden sentence says "forty-five" (whisper emits digits;
 * scoring that as a miss would skew the very A/B decision this page exists to
 * make — review 2026-07-12). Only the values used in the golden sentences.
 */
const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40',
  fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
  hundred: '100', fortyfive: '45', sixtynine: '69',
};

/** One normalized token per whitespace-separated word — deliberately NOT
 *  filtered, so indices stay aligned with the raw word array used for
 *  display highlighting (a pure-punctuation word normalizes to ''). */
function tokenize(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).map((raw) => {
    const t = raw
      .toLowerCase()
      .replace(/[‘’]/g, "'") // typographic → ASCII apostrophe
      .replace(/[^a-z0-9']/g, '');
    return NUMBER_WORDS[t] ?? t;
  });
}

/** For token arrays a and b, flags[i] = true when that token is part of the
 *  longest common subsequence (i.e. "matched"). */
function diffFlags(a: string[], b: string[]): [boolean[], boolean[]] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aFlags = new Array<boolean>(n).fill(false);
  const bFlags = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      aFlags[i] = true;
      bFlags[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return [aFlags, bFlags];
}
