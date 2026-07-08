'use client';

// PACES Practice — single-page client app.
// Holds all state (settings, manifest, selected case, transcript, marksheet)
// and talks to the backend exclusively via GET /api/manifest, GET /api/case/[id],
// and POST /api/examiner, per lib/types.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BEGIN_MESSAGE,
  clearSavedEncounter,
  loadSavedEncounter,
  saveEncounter,
  useLocalStorage,
  type TranscriptEntry,
} from '@/components/shared';
import {
  API_KEY_HEADER,
  DEFAULT_MODEL,
  MODEL_ALLOWLIST,
  modelProvider,
  providerInfo,
  type ProviderId,
  type ApiError,
  type ChatMessage,
  type DemoStatus,
  type ExaminerChatResponse,
  type ExaminerMarkResponse,
  type ExaminerRequest,
  type MarkSheet,
  type PublicCase,
  type PublicManifest,
  type TokenUsage,
} from '@/lib/types';
import Settings from '@/components/Settings';
import DemoAccess from '@/components/DemoAccess';
import CasePicker from '@/components/CasePicker';
import ChatPane from '@/components/ChatPane';
import HistoryList from '@/components/HistoryList';
import {
  archiveEncounter,
  deleteArchived,
  listArchived,
  type ArchivedEncounter,
} from '@/components/historyStore';

// Per-provider BYOK key slots. The Anthropic key keeps its historical
// un-suffixed slot so existing users' keys survive this change.
const LS_API_KEY = 'paces.apiKey';
const LS_MODEL = 'paces.model';

function noKeyError(provider: ProviderId): string {
  return `Invited by the app owner? Sign in under "Invited access" in the sidebar — no API key needed. Otherwise add your ${providerInfo(provider).label} API key in Settings.`;
}

/** A signed-in invited user whose session doesn't cover this model's provider needs "switch model" guidance, not a sign-in prompt (mirrors the server's 403). */
function demoUncoveredError(provider: ProviderId): string {
  const label = providerInfo(provider).label;
  return `Invited access doesn't cover ${label} models — pick a different model in Settings, or add your own ${label} API key.`;
}

const SESSION_EXPIRED_ERROR =
  'Your sign-in has expired or been revoked — request a new sign-in link under "Invited access" in the sidebar.';

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorFrom(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as ApiError).error === 'string') {
    return (data as ApiError).error;
  }
  return fallback;
}

/**
 * A rehydrated transcript ending in an unanswered user turn (parked or
 * reloaded mid-reply) gets a notice that lights the existing Retry path.
 * With a marksheet the encounter is effectively over — no nag.
 */
function retryNotice(entries: TranscriptEntry[], marksheet: MarkSheet | null): string | null {
  const last = entries[entries.length - 1];
  if (!last || last.role !== 'user' || marksheet) return null;
  return last.content === BEGIN_MESSAGE
    ? 'Encounter restored — it had not yet begun when it was put down. Press Retry to open it.'
    : 'Encounter restored — the examiner had not yet replied to your last message. Press Retry to resend it.';
}

export default function Home() {
  // Settings (persisted to localStorage). One BYOK key slot per provider —
  // fixed hooks (never map over PROVIDERS here: hook order must be static).
  const [anthropicKey, setAnthropicKey] = useLocalStorage(LS_API_KEY, '');
  const [deepseekKey, setDeepseekKey] = useLocalStorage('paces.apiKey.deepseek', '');
  const [moonshotKey, setMoonshotKey] = useLocalStorage('paces.apiKey.moonshot', '');
  const [minimaxKey, setMinimaxKey] = useLocalStorage('paces.apiKey.minimax', '');
  const providerKeys: Record<ProviderId, string> = {
    anthropic: anthropicKey,
    deepseek: deepseekKey,
    moonshot: moonshotKey,
    minimax: minimaxKey,
  };
  const setProviderKey = (provider: ProviderId, value: string) => {
    if (provider === 'anthropic') setAnthropicKey(value);
    else if (provider === 'deepseek') setDeepseekKey(value);
    else if (provider === 'moonshot') setMoonshotKey(value);
    else setMinimaxKey(value);
  };
  const [storedModel, setStoredModel] = useLocalStorage(LS_MODEL, DEFAULT_MODEL);
  const model = (MODEL_ALLOWLIST as readonly string[]).includes(storedModel) ? storedModel : DEFAULT_MODEL;

  // Case list + selection.
  const [manifest, setManifest] = useState<PublicManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [publicCase, setPublicCase] = useState<PublicCase | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);

  // Encounter state (autosaved to localStorage so a reload can't wipe it — see
  // the restore + autosave effects below; backend stays stateless).
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [pending, setPending] = useState<'chat' | 'mark' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marksheet, setMarksheet] = useState<MarkSheet | null>(null);
  const [markUsage, setMarkUsage] = useState<TokenUsage | null>(null);

  // Demo access (httpOnly cookie session — the client only sees this status).
  const [demoStatus, setDemoStatus] = useState<DemoStatus | null>(null);
  // One-shot ?demo=active|invalid flag from /api/demo/verify's redirect,
  // surfaced as a MAIN-PANE banner (the sidebar is off-canvas on mobile, where
  // the emailed link is most likely opened).
  const [demoNotice, setDemoNotice] = useState<'active' | 'invalid' | null>(null);

  // Mobile sidebar drawer.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // History archive (IndexedDB) — past encounters, newest first.
  const [history, setHistory] = useState<ArchivedEncounter[]>([]);
  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listArchived());
    } catch {
      // IndexedDB unavailable (rare) — History simply stays hidden
    }
  }, []);
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Tracks the currently selected case so in-flight examiner replies for a
  // previous case are discarded instead of contaminating a new transcript
  // (select-during-flight race).
  const caseIdRef = useRef<string | null>(null);
  useEffect(() => {
    caseIdRef.current = publicCase?.meta.id ?? null;
  }, [publicCase]);

  // Crash-safe autosave gating: restore runs once (after the manifest arrives),
  // and autosave stays off until that attempt finishes — otherwise the initial
  // empty state would clobber the saved encounter before it could be read.
  const restoreAttemptedRef = useRef(false);
  const autosaveEnabledRef = useRef(false);
  // State twin of the gate, for the UI: History rows stay disabled until the
  // restore attempt completes (opening one sooner would let the autosave
  // clobber a not-yet-restored live blob).
  const [restoreDone, setRestoreDone] = useState(false);
  // Synchronous in-flight flag for the async leave transitions (open a History
  // record / New case / switch case). State like caseLoading only takes effect
  // after a re-render — this ref closes the same-tick window where a second
  // click could interleave and destroy or duplicate an archived record.
  const transitionRef = useRef(false);

  // Dev-only `claude -p` subscription bridge (local tuning without an API
  // key). /api/dev-status 404s in production, so this stays false there.
  const [cliBridge, setCliBridge] = useState(false);

  const demoActive = demoStatus?.active === true;
  // The selected model picks the provider, which picks the BYOK key slot the
  // examiner calls send. `apiKey` everywhere below = the ACTIVE provider's key.
  // (Explicit ternary, not providerKeys[activeProvider]: computed member
  // access on the fresh record makes React Compiler bail on the whole
  // component — 16 preserve-manual-memoization errors.)
  const activeProvider: ProviderId = modelProvider(model) ?? 'anthropic';
  const apiKey =
    activeProvider === 'anthropic'
      ? anthropicKey
      : activeProvider === 'deepseek'
        ? deepseekKey
        : activeProvider === 'moonshot'
          ? moonshotKey
          : minimaxKey;
  // With demo access active, the chat works without a BYOK key — but only for
  // models whose provider the server-held keys cover. A missing or empty
  // providers list means an older server: assume the historical Anthropic-only
  // setup. The dev CLI bridge serves keyless requests (dev-only), Claude only.
  const demoProviderList = demoStatus?.providers;
  const demoCovers =
    demoActive &&
    (demoProviderList?.length ? demoProviderList : ['anthropic']).includes(activeProvider);
  const cliBridgeCovers = cliBridge && activeProvider === 'anthropic';
  const hasKey = apiKey.trim().length > 0 || demoCovers || cliBridgeCovers;
  // Precomputed at render scope: helper calls with component-scope args inside
  // the callbacks defeat React Compiler memoization preservation.
  const keyMissingError =
    demoActive && !demoCovers ? demoUncoveredError(activeProvider) : noKeyError(activeProvider);

  const updateModel = useCallback(
    (value: string) => {
      if (!(MODEL_ALLOWLIST as readonly string[]).includes(value)) return;
      setStoredModel(value);
    },
    [setStoredModel],
  );

  // Fetch demo-access status (best-effort: failures just mean the BYOK-only
  // experience). Also re-invoked when an examiner call 401s without a BYOK key,
  // so the sidebar can't keep claiming "access active" after expiry/revocation.
  const refreshDemoStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/demo/status');
      const data = await readJson(res);
      if (res.ok && data && typeof (data as DemoStatus).active === 'boolean') {
        setDemoStatus(data as DemoStatus);
      }
    } catch {
      // ignore — demo access simply stays inactive
    }
  }, []);

  useEffect(() => {
    void refreshDemoStatus();
  }, [refreshDemoStatus]);

  // Probe the dev-only CLI bridge once on load (best-effort; 404 in prod).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dev-status');
        if (!res.ok) return;
        const data = await readJson(res);
        if (!cancelled && data && typeof (data as { cliBridge?: unknown }).cliBridge === 'boolean') {
          setCliBridge((data as { cliBridge: boolean }).cliBridge);
        }
      } catch {
        // ignore — the bridge simply stays off
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One-shot read of the ?demo= flag appended by /api/demo/verify's redirect,
  // then strip it from the URL so a reload doesn't re-show the notice.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('demo');
    if (flag === null) return;
    if (flag === 'active' || flag === 'invalid') setDemoNotice(flag);
    params.delete('demo');
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );
  }, []);

  // Fetch the manifest on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/manifest');
        const data = await readJson(res);
        if (!res.ok) throw new Error(errorFrom(data, `Failed to load case list (${res.status})`));
        if (!cancelled) setManifest(data as PublicManifest);
      } catch (e) {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : 'Failed to load case list.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the autosaved encounter once the manifest settles (loaded OR
  // failed) — synchronous (the blob carries stem + a meta snapshot), so there
  // is no failure path that could strand or destroy a saved encounter. Meta
  // comes fresh from the manifest when the case still exists, else from the
  // blob's own snapshot (so an encounter on a redeploy-removed case, or a
  // manifest outage, still restores). Runs once; the ref also guards React
  // StrictMode's dev double-invoke.
  useEffect(() => {
    if ((!manifest && !manifestError) || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const saved = loadSavedEncounter();
    if (!saved) {
      clearSavedEncounter(); // drop unreadable blobs; no-op on an empty slot
      autosaveEnabledRef.current = true;
      setRestoreDone(true);
      return;
    }
    const meta = manifest?.cases.find((c) => c.id === saved.caseId) ?? saved.meta;
    if (!meta) {
      if (manifest) {
        // Manifest is live and doesn't know the case, and the blob predates
        // the meta snapshot — genuinely stale; drop it.
        clearSavedEncounter();
        autosaveEnabledRef.current = true;
        setRestoreDone(true);
      }
      // Manifest failed AND the blob has no meta snapshot: keep the blob for
      // a later reload. Autosave + History stay disabled so nothing can
      // clobber it this session.
      return;
    }
    setPublicCase({ meta, stem: saved.stem });
    setEntries(saved.entries);
    setMarksheet(saved.marksheet);
    setMarkUsage(saved.markUsage);
    setError(retryNotice(saved.entries, saved.marksheet));
    autosaveEnabledRef.current = true;
    setRestoreDone(true);
  }, [manifest, manifestError]);

  // Autosave the live encounter on every change (case id + stem + transcript
  // incl. revealed images + marksheet). The API key is NOT part of this blob —
  // it stays in its own localStorage slot.
  useEffect(() => {
    if (!autosaveEnabledRef.current || !publicCase) return;
    saveEncounter({
      v: 1,
      caseId: publicCase.meta.id,
      stem: publicCase.stem,
      meta: publicCase.meta,
      entries,
      marksheet,
      markUsage,
      savedAt: new Date().toISOString(),
    });
  }, [publicCase, entries, marksheet, markUsage]);

  /**
   * Park the live encounter (if it has any transcript) into the History
   * archive. Returns whether the encounter is safe to replace: true unless an
   * actual write failed. newCase/selectCase treat failure as best-effort (the
   * user chose to leave; degrading to the old discard behaviour), but
   * openArchived aborts on failure — History manipulation must not destroy a
   * transcript it failed to park.
   */
  const archiveCurrent = useCallback(async (): Promise<boolean> => {
    if (!publicCase || entries.length === 0) return true;
    const archivedAt = new Date().toISOString();
    try {
      await archiveEncounter({
        id: `${archivedAt}_${publicCase.meta.id}`,
        archivedAt,
        meta: publicCase.meta,
        stem: publicCase.stem,
        entries,
        marksheet,
        markUsage,
      });
      return true;
    } catch {
      return false;
    }
  }, [publicCase, entries, marksheet, markUsage]);

  const selectCase = useCallback(
    async (id: string) => {
      if (pending || caseLoading || transitionRef.current) return;
      if (publicCase?.meta.id === id) {
        setSidebarOpen(false);
        return;
      }
      if (entries.length > 0 && !window.confirm('Leave this encounter? It will be saved to History.')) {
        return;
      }
      transitionRef.current = true;
      setSidebarOpen(false);
      setCaseLoading(true);
      setError(null);
      try {
        // Archive before the fetch: if the fetch then fails the encounter
        // stays live AND archived (harmless duplicate later) — never lost.
        await archiveCurrent();
        void refreshHistory();
        const res = await fetch(`/api/case/${encodeURIComponent(id)}`);
        const data = await readJson(res);
        if (!res.ok) throw new Error(errorFrom(data, `Failed to load case (${res.status})`));
        setPublicCase(data as PublicCase);
        setEntries([]);
        setMarksheet(null);
        setMarkUsage(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load case.');
      } finally {
        transitionRef.current = false;
        setCaseLoading(false);
      }
    },
    [pending, caseLoading, publicCase, entries.length, archiveCurrent, refreshHistory],
  );

  /**
   * Reopen an archived encounter as the live one (move semantics: the record
   * leaves History and re-archives when next parked, so no duplicates). The
   * backend is stateless, so an unmarked encounter simply continues.
   */
  const openArchived = useCallback(
    async (rec: ArchivedEncounter) => {
      if (pending || caseLoading || transitionRef.current) return;
      if (entries.length > 0 && !window.confirm('Open this past encounter? The current one will be saved to History.')) {
        return;
      }
      transitionRef.current = true;
      setCaseLoading(true);
      setSidebarOpen(false);
      try {
        const parked = await archiveCurrent();
        if (!parked) {
          // Never trade a live transcript for a record we failed to park.
          setError(
            'Could not save the current encounter to History (storage unavailable?), so it stays open.',
          );
          return;
        }
        try {
          await deleteArchived(rec.id);
        } catch {
          // record stays listed; opening it again is idempotent
        }
        setPublicCase({ meta: rec.meta, stem: rec.stem });
        setEntries(rec.entries);
        setMarksheet(rec.marksheet);
        setMarkUsage(rec.markUsage);
        setError(retryNotice(rec.entries, rec.marksheet));
        void refreshHistory();
      } finally {
        transitionRef.current = false;
        setCaseLoading(false);
      }
    },
    [pending, caseLoading, entries.length, archiveCurrent, refreshHistory],
  );

  const deleteFromHistory = useCallback(
    async (id: string) => {
      try {
        await deleteArchived(id);
      } catch {
        // leave the row; user can retry
      }
      void refreshHistory();
    },
    [refreshHistory],
  );

  /** POST /api/examiner action:'chat' with the given transcript; appends the reply on success. */
  const runChat = useCallback(
    async (transcript: TranscriptEntry[]) => {
      if (!publicCase) return;
      // BYOK key takes precedence; with none, a demo session covering this
      // model's provider (or the dev-only CLI bridge, Anthropic models only)
      // lets the server handle the call without a client key.
      const key = apiKey.trim();
      if (!key && !demoCovers && !cliBridgeCovers) {
        setError(keyMissingError);
        return;
      }
      const caseId = publicCase.meta.id;
      setPending('chat');
      setError(null);
      try {
        const body: ExaminerRequest = {
          caseId,
          model,
          messages: transcript.map(({ role, content }): ChatMessage => ({ role, content })),
          action: 'chat',
        };
        const res = await fetch('/api/examiner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { [API_KEY_HEADER]: key } : {}) },
          body: JSON.stringify(body),
        });
        const data = await readJson(res);
        if (res.status === 401 && !key && !cliBridgeCovers) {
          // Keyless request means we relied on the demo session, so a 401 is
          // expiry/revocation — the server's "Missing API key" would send a
          // keyless invited user hunting for a key. Re-sync the sidebar too.
          void refreshDemoStatus();
          throw new Error(SESSION_EXPIRED_ERROR);
        }
        if (!res.ok) throw new Error(errorFrom(data, `Request failed (${res.status})`));
        // Discard replies that resolve after the user switched case — appending
        // them would put case A's examiner turn into case B's transcript.
        if (caseIdRef.current !== caseId) return;
        const chat = data as ExaminerChatResponse;
        if (!chat.reply) return; // defence in depth: never store an empty assistant turn
        setEntries((cur) => [
          ...cur,
          {
            role: 'assistant',
            content: chat.reply,
            usage: chat.usage,
            kbLookups: chat.kbLookups,
            images: chat.images,
          },
        ]);
      } catch (e) {
        // Transcript is preserved; the error notice offers a retry.
        if (caseIdRef.current === caseId) {
          setError(e instanceof Error ? e.message : 'Request failed.');
        }
      } finally {
        setPending(null);
      }
    },
    [publicCase, apiKey, demoCovers, cliBridgeCovers, keyMissingError, model, refreshDemoStatus],
  );

  const send = useCallback(
    (text: string) => {
      // caseLoading/transition guard: while a new case is being fetched (or a
      // leave transition is archiving) the old pane is still rendered —
      // sending then would target the outgoing case or miss the archive.
      if (!publicCase || pending || caseLoading || transitionRef.current) return;
      const next: TranscriptEntry[] = [...entries, { role: 'user', content: text }];
      setEntries(next);
      void runChat(next);
    },
    [publicCase, pending, caseLoading, entries, runChat],
  );

  const begin = useCallback(() => {
    if (entries.length > 0) return;
    send(BEGIN_MESSAGE);
  }, [entries.length, send]);

  /** Re-send the current transcript after a failed chat call (last turn is an unanswered user message). */
  const retry = useCallback(() => {
    if (pending || caseLoading || entries.length === 0 || entries[entries.length - 1].role !== 'user') return;
    void runChat(entries);
  }, [pending, caseLoading, entries, runChat]);

  const mark = useCallback(async () => {
    if (!publicCase || pending || caseLoading || transitionRef.current || entries.length === 0) return;
    const key = apiKey.trim();
    if (!key && !demoCovers && !cliBridgeCovers) {
      setError(keyMissingError);
      return;
    }
    setPending('mark');
    setError(null);
    try {
      const body: ExaminerRequest = {
        caseId: publicCase.meta.id,
        model,
        messages: entries.map(({ role, content }): ChatMessage => ({ role, content })),
        action: 'mark',
      };
      const res = await fetch('/api/examiner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { [API_KEY_HEADER]: key } : {}) },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (res.status === 401 && !key && !cliBridgeCovers) {
        // See runChat: keyless 401 = demo session expired/revoked.
        void refreshDemoStatus();
        throw new Error(SESSION_EXPIRED_ERROR);
      }
      if (!res.ok) throw new Error(errorFrom(data, `Request failed (${res.status})`));
      const marked = data as ExaminerMarkResponse;
      setMarksheet(marked.marksheet);
      setMarkUsage(marked.usage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setPending(null);
    }
  }, [publicCase, pending, caseLoading, entries, apiKey, demoCovers, cliBridgeCovers, keyMissingError, model, refreshDemoStatus]);

  const newCase = useCallback(() => {
    if (pending || caseLoading || transitionRef.current) return;
    if (entries.length > 0 && !window.confirm('End this encounter and choose a new case? It will be saved to History.')) {
      return;
    }
    transitionRef.current = true;
    setCaseLoading(true);
    void (async () => {
      try {
        await archiveCurrent();
        clearSavedEncounter();
        setPublicCase(null);
        setEntries([]);
        setMarksheet(null);
        setMarkUsage(null);
        setError(null);
        setSidebarOpen(true);
        void refreshHistory();
      } finally {
        transitionRef.current = false;
        setCaseLoading(false);
      }
    })();
  }, [pending, caseLoading, entries.length, archiveCurrent, refreshHistory]);

  const canRetry = error !== null && entries.length > 0 && entries[entries.length - 1].role === 'user';

  // Main-pane banner for the one-shot ?demo= verify-redirect flag. Lives here
  // (not in the sidebar) because on mobile the sidebar is off-canvas and the
  // emailed link is most likely tapped on a phone. For 'active', the wording
  // tracks /api/demo/status so a dropped cookie (some in-app browsers) doesn't
  // leave a success message lying about a session that never stuck.
  let demoBanner: { warn: boolean; text: string } | null = null;
  if (demoNotice === 'invalid') {
    demoBanner = {
      warn: true,
      text: 'That sign-in link is invalid or has expired. Request a new one under "Invited access" in the sidebar.',
    };
  } else if (demoNotice === 'active') {
    demoBanner =
      demoStatus === null
        ? { warn: false, text: 'Sign-in received — checking access…' }
        : demoStatus.active
          ? { warn: false, text: 'Sign-in successful — invited access is active on this device. No API key needed.' }
          : {
              warn: true,
              text: 'The sign-in did not stick on this browser — cookies may be blocked, or the link opened inside another app. Try opening the link in Safari or Chrome, or request a new one under "Invited access" in the sidebar.',
            };
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-80 shrink-0 transform flex-col border-r border-zinc-200 bg-white transition-transform dark:border-zinc-800 dark:bg-zinc-900 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h1 className="text-base font-semibold tracking-tight">PACES Practice</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {demoActive
              ? 'AI examiner · invited access active'
              : cliBridgeCovers && !apiKey.trim()
                ? 'AI examiner · dev bridge (subscription quota)'
                : 'AI examiner for MRCP PACES'}
          </p>
        </div>
        {/* Invited access sits above Settings: an invited consultant's first
            task is signing in, not pasting an API key. */}
        <DemoAccess status={demoStatus} />
        <Settings
          providerKeys={providerKeys}
          model={model}
          activeProvider={activeProvider}
          demoCovers={demoCovers}
          onProviderKeyChange={setProviderKey}
          onModelChange={updateModel}
        />
        <HistoryList
          records={history}
          disabled={pending !== null || caseLoading || !restoreDone}
          onOpen={(rec) => void openArchived(rec)}
          onDelete={(id) => void deleteFromHistory(id)}
        />
        <CasePicker
          manifest={manifest}
          manifestError={manifestError}
          selectedId={publicCase?.meta.id ?? null}
          onSelect={(id) => void selectCase(id)}
        />
        {/* Build stamp: the quick answer to "is my browser on the latest deploy?"
            (stale mobile tabs kept running pre-autosave code invisibly). */}
        <p className="border-t border-zinc-200 px-4 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          build {process.env.NEXT_PUBLIC_BUILD_STAMP}
        </p>
      </aside>

      {/* Main pane */}
      <main className="flex min-w-0 flex-1 flex-col">
        {demoBanner && (
          <div
            className={`flex items-start justify-between gap-3 border-b px-4 py-2.5 text-sm ${
              demoBanner.warn
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200'
            }`}
          >
            <span className="leading-6">{demoBanner.text}</span>
            <div className="flex shrink-0 items-center gap-2">
              {demoBanner.warn && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="rounded border border-current px-2 py-0.5 text-xs font-medium md:hidden"
                >
                  Open sidebar
                </button>
              )}
              <button
                type="button"
                onClick={() => setDemoNotice(null)}
                aria-label="Dismiss notice"
                className="rounded px-1 text-base leading-none opacity-70 hover:opacity-100"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <ChatPane
          publicCase={publicCase}
          caseLoading={caseLoading}
          entries={entries}
          pending={pending}
          error={error}
          canRetry={canRetry}
          marksheet={marksheet}
          markUsage={markUsage}
          hasKey={hasKey}
          keyNotice={keyMissingError}
          onBegin={begin}
          onSend={send}
          onMark={() => void mark()}
          onNewCase={newCase}
          onRetry={retry}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      </main>
    </div>
  );
}
