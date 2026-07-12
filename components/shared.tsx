'use client';

// Shared client-side helpers for the PACES frontend.
// Skill names, transcript entry shape, token formatting, tiny badge + minimal-markdown renderers.

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { MarkSheet, PublicCaseMeta, RevealedImage, SkillId, TokenUsage } from '@/lib/types';

/** Official MRCP PACES skill names, keyed by skill letter. */
export const SKILL_NAMES: Record<SkillId, string> = {
  A: 'Physical examination',
  B: 'Identifying physical signs',
  C: 'Clinical communication',
  D: 'Differential diagnosis',
  E: 'Clinical judgement',
  F: "Managing patients' concerns",
  G: 'Maintaining patient welfare',
};

/** Literal first user message that starts an encounter (rendered as a divider, not a bubble). */
export const BEGIN_MESSAGE = '[BEGIN ENCOUNTER]';

/**
 * One turn of the client-held transcript. `role`/`content` map 1:1 onto the
 * ChatMessage wire type; usage/kbLookups are display-only metadata kept locally.
 */
export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  usage?: TokenUsage;
  kbLookups?: number;
  /** photos the examiner revealed on this turn (assistant turns only) */
  images?: RevealedImage[];
}

// --- localStorage-backed string state (SSR-safe, works without an effect) ---

const STORAGE_EVENT = 'paces:localstorage';
/** In-memory fallback so the app still works when localStorage is unavailable (private mode). */
const memoryStore = new Map<string, string>();

function subscribeToStorage(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

/**
 * String state persisted under a localStorage key. Server snapshot is the
 * fallback, so SSR/hydration stay consistent and the stored value appears
 * right after hydration.
 */
export function useLocalStorage(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribeToStorage,
    () => {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored !== null) return stored;
      } catch {
        // fall through to the in-memory store
      }
      return memoryStore.get(key) ?? fallback;
    },
    () => fallback,
  );
  const setValue = useCallback(
    (next: string) => {
      memoryStore.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // in-memory only
      }
      window.dispatchEvent(new Event(STORAGE_EVENT));
    },
    [key],
  );
  return [value, setValue];
}

// --- Crash-safe encounter autosave (versioned localStorage blob) ---

const LS_ENCOUNTER = 'paces.encounter';

/**
 * Snapshot of the live encounter, autosaved on every change so a reload
 * (accidental pull-to-refresh, crash) can restore it. Carries the stem so
 * restore needs no network fetch; meta is rebuilt fresh from the manifest.
 * API keys live in their own per-provider slots (`paces.apiKey`,
 * `paces.apiKey.<provider>`) and must NEVER be folded into this blob.
 */
export interface SavedEncounter {
  v: 1;
  caseId: string;
  /** the stem as served when the encounter ran */
  stem: string;
  /** meta snapshot at save time — lets the blob restore even when the case id
   *  has left the manifest (content redeploy) or the manifest fetch fails.
   *  Optional for blobs written before this field existed. */
  meta?: PublicCaseMeta;
  entries: TranscriptEntry[];
  marksheet: MarkSheet | null;
  markUsage: TokenUsage | null;
  /** Transcript position the marksheet is pinned to (see EncounterPayload). */
  marksheetAt?: number | null;
  savedAt: string;
}

/**
 * The meta fields the UI actually renders / the engine needs. Narrower than
 * PublicCaseMeta's full shape by design (unchecked fields are display-unused);
 * the cast is deliberate.
 */
export function isRenderableMeta(meta: unknown): meta is PublicCaseMeta {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as PublicCaseMeta;
  return (
    typeof m.id === 'string' &&
    typeof m.caseCode === 'string' &&
    typeof m.displayTitle === 'string' &&
    typeof m.sittingLabel === 'string' &&
    typeof m.timing === 'string'
  );
}

function isTokenUsage(x: unknown): x is TokenUsage {
  if (!x || typeof x !== 'object') return false;
  const u = x as TokenUsage;
  return [u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens].every(
    (n) => typeof n === 'number' && Number.isFinite(n),
  );
}

/** Every rendered field must be render-safe: MarksheetCard indexes GRADE meta by grade and sorts on skill. */
function isMarkSheet(x: unknown): x is MarkSheet {
  if (!x || typeof x !== 'object') return false;
  const s = x as MarkSheet;
  return (
    Array.isArray(s.skills) &&
    s.skills.every(
      (m) =>
        m !== null &&
        typeof m === 'object' &&
        typeof m.skill === 'string' &&
        m.skill in SKILL_NAMES &&
        (m.grade === 0 || m.grade === 1 || m.grade === 2) &&
        typeof m.justification === 'string',
    ) &&
    typeof s.total === 'number' &&
    typeof s.maxTotal === 'number' &&
    typeof s.overallImpression === 'string' &&
    typeof s.biggestImprovement === 'string'
  );
}

/**
 * Rebuild one transcript entry from untrusted JSON, or null if the turn itself
 * (role/content) is unusable. Malformed optional display fields are dropped
 * rather than sinking the transcript; image URLs must be same-origin relative.
 */
function sanitizeEntry(x: unknown): TranscriptEntry | null {
  if (!x || typeof x !== 'object') return null;
  const e = x as TranscriptEntry;
  if ((e.role !== 'user' && e.role !== 'assistant') || typeof e.content !== 'string') return null;
  const out: TranscriptEntry = { role: e.role, content: e.content };
  if (isTokenUsage(e.usage)) out.usage = e.usage;
  if (typeof e.kbLookups === 'number' && Number.isFinite(e.kbLookups)) out.kbLookups = e.kbLookups;
  if (Array.isArray(e.images)) {
    const images = e.images
      .filter(
        (im): im is RevealedImage =>
          !!im &&
          typeof im === 'object' &&
          typeof im.url === 'string' &&
          im.url.startsWith('/') &&
          !im.url.startsWith('//') &&
          typeof im.caption === 'string',
      )
      .map((im) => ({ url: im.url, caption: im.caption }));
    if (images.length > 0) out.images = images;
  }
  return out;
}

/** Validated encounter payload common to the autosave blob and History records. */
export interface EncounterPayload {
  stem: string;
  entries: TranscriptEntry[];
  marksheet: MarkSheet | null;
  markUsage: TokenUsage | null;
  /**
   * How many transcript entries existed when the marksheet was produced — the
   * position the card is PINNED to in the transcript. Marking does not close
   * the encounter (the examiner debriefs and takes follow-ups afterwards), and
   * rendering the card last pushed those later turns ABOVE it, so a candidate
   * who didn't scroll up thought their question hadn't sent (owner report
   * 2026-07-12). null = unmarked, or a blob written before this field existed —
   * the card then falls to the end, exactly as it used to.
   */
  marksheetAt: number | null;
}

/**
 * Rebuild an encounter payload from untrusted data (localStorage blob or an
 * IndexedDB history record), or null if it is unusable. A marksheet/markUsage
 * that fails validation (e.g. schema drift across deploys) is nulled rather
 * than sinking the transcript; a broken transcript turn rejects the whole
 * payload (the conversation can't be trusted).
 */
export function sanitizeEncounterPayload(p: {
  stem?: unknown;
  entries?: unknown;
  marksheet?: unknown;
  markUsage?: unknown;
  marksheetAt?: unknown;
}): EncounterPayload | null {
  if (typeof p.stem !== 'string' || p.stem.length === 0) return null;
  if (!Array.isArray(p.entries)) return null;
  const entries: TranscriptEntry[] = [];
  for (const e of p.entries) {
    const clean = sanitizeEntry(e);
    if (!clean) return null;
    entries.push(clean);
  }
  // Clamped into the transcript: a corrupt or foreign anchor must not be able
  // to hide turns or push the card out of the list.
  const at = p.marksheetAt;
  const marksheetAt =
    typeof at === 'number' && Number.isInteger(at) && at >= 0
      ? Math.min(at, entries.length)
      : null;
  return {
    stem: p.stem,
    entries,
    marksheet: isMarkSheet(p.marksheet) ? p.marksheet : null,
    markUsage: isTokenUsage(p.markUsage) ? p.markUsage : null,
    marksheetAt,
  };
}

/**
 * Parse + validate the saved encounter; a malformed/foreign blob reads as
 * "nothing saved".
 */
export function loadSavedEncounter(): SavedEncounter | null {
  try {
    const raw = window.localStorage.getItem(LS_ENCOUNTER);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedEncounter;
    if (!p || typeof p !== 'object' || p.v !== 1) return null;
    if (typeof p.caseId !== 'string' || p.caseId.length === 0) return null;
    const payload = sanitizeEncounterPayload(p);
    if (!payload) return null;
    return {
      v: 1,
      caseId: p.caseId,
      ...(isRenderableMeta(p.meta) ? { meta: p.meta } : {}),
      ...payload,
      savedAt: typeof p.savedAt === 'string' ? p.savedAt : '',
    };
  } catch {
    return null;
  }
}

export function saveEncounter(snapshot: SavedEncounter): void {
  try {
    window.localStorage.setItem(LS_ENCOUNTER, JSON.stringify(snapshot));
  } catch {
    // quota exceeded / private mode — autosave is best-effort
  }
}

export function clearSavedEncounter(): void {
  try {
    window.localStorage.removeItem(LS_ENCOUNTER);
  } catch {
    // ignore
  }
}

/** 1234 -> "1.2k", 340 -> "340", 123456 -> "123k". */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}k`;
  return `${k.toFixed(1).replace(/\.0$/, '')}k`;
}

/** Subtle per-reply usage line, e.g. "↑1.2k ↓340 · cache 8.1k · 1 ref lookup". */
export function usageLine(u: TokenUsage, kbLookups?: number): string {
  let s = `↑${fmtTokens(u.inputTokens)} ↓${fmtTokens(u.outputTokens)}`;
  const cache = u.cacheReadTokens + u.cacheWriteTokens;
  if (cache > 0) s += ` · cache ${fmtTokens(cache)}`;
  if (kbLookups && kbLookups > 0) s += ` · ${kbLookups} ref lookup${kbLookups === 1 ? '' : 's'}`;
  return s;
}

/**
 * Whitespace-preserving text with minimal **bold** handling only — no markdown
 * library per spec. Unbalanced markers are rendered as plain text.
 */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const nodes: ReactNode[] = [];
  // **bold** first (so it wins over italic), then single-asterisk *italic*
  // within one line — the corpus uses both; anything else renders as plain text.
  const re = /\*\*([^*][\s\S]*?)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {m[1]}
        </strong>,
      );
    } else {
      nodes.push(<em key={key++}>{m[2]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <div className={`whitespace-pre-wrap ${className}`}>{nodes}</div>;
}
