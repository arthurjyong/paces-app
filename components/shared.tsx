'use client';

// Shared client-side helpers for the PACES frontend.
// Skill names, transcript entry shape, token formatting, tiny badge + minimal-markdown renderers.

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { SkillId, TokenUsage } from '@/lib/types';

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
