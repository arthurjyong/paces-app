'use client';

// PACES Buddy — single-page client app.
// Holds all state (settings, manifest, selected case, transcript, marksheet,
// managed-session status) and talks to the backend exclusively via
// GET /api/manifest, GET /api/case/[id], POST /api/examiner, and the
// /api/auth/* managed-door endpoints, per lib/types.ts + lib/tiers.ts.

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
  BYOK_MODELS,
  DEFAULT_MODEL,
  MODEL_ALLOWLIST,
  modelProvider,
  providerInfo,
  type ProviderId,
  type ApiError,
  type ChatMessage,
  type ExaminerChatResponse,
  type ExaminerMarkResponse,
  type ExaminerRequest,
  type MarkSheet,
  type PublicCase,
  type PublicManifest,
  type TokenUsage,
} from '@/lib/types';
import type { ManagedStatus } from '@/lib/tiers';
import Settings from '@/components/Settings';
import AccountPanel from '@/components/AccountPanel';
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
  return `Sign in under "Account" in the sidebar to practise on the app's managed access — or add your ${providerInfo(provider).label} API key in Settings.`;
}

/** A signed-in managed user whose tier doesn't cover this model needs "switch model" guidance, not a sign-in prompt (mirrors the server's 403). */
function managedUncoveredError(provider: ProviderId): string {
  const label = providerInfo(provider).label;
  return `Managed access on your tier doesn't cover this model — pick a covered model in Settings, or add your own ${label} API key.`;
}

const SESSION_EXPIRED_ERROR =
  'Your sign-in has expired or been revoked — sign in again under "Account" in the sidebar.';

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
  // BYOK is Claude-only now, so a single key slot — kept at the historical
  // `paces.apiKey` localStorage key so existing users' keys survive.
  const [claudeKey, setClaudeKey] = useLocalStorage(LS_API_KEY, '');
  // storedModel starts EMPTY = "not explicitly chosen": a fresh signed-in user
  // then defaults to their free tier model, a fresh BYOK user to Claude Sonnet.
  const [storedModel, setStoredModel] = useLocalStorage(LS_MODEL, '');

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

  // Managed access (httpOnly cookie session — the client only ever sees the
  // ManagedStatus projection: masked email, tier, covered models, this
  // month's meter).
  const [managedStatus, setManagedStatus] = useState<ManagedStatus | null>(null);

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

  const managedActive = managedStatus?.active === true;
  // The tier's free (gateway) models are selectable only while signed in; the
  // BYOK Claude lineup is always selectable. If the stored choice isn't
  // available (empty/unchosen, or a free model kept from a prior session now
  // signed out), fall back to the tier's first free model when signed in
  // (MOHH → Sonnet, consumer → DeepSeek) else Claude Sonnet.
  const freeModels = managedActive ? (managedStatus?.models ?? []) : [];
  const explicitModel = (MODEL_ALLOWLIST as readonly string[]).includes(storedModel) ? storedModel : '';
  const model =
    explicitModel && [...freeModels, ...BYOK_MODELS.map((m) => m.id)].includes(explicitModel)
      ? explicitModel
      : freeModels.length > 0
        ? freeModels[0]
        : DEFAULT_MODEL;
  // A Claude model runs on the user's own key; a free/gateway model runs on the
  // managed session (no client key). BYOK is Claude-only now.
  const activeProvider: ProviderId = modelProvider(model) ?? 'anthropic';
  const apiKey = activeProvider === 'anthropic' ? claudeKey : '';
  // With a managed session active, the chat works without a BYOK key — but only
  // for the tier's free models (status.models mirrors the server's own tier
  // gate; the server re-checks every call). Dev CLI bridge: keyless, Claude only.
  const managedCovers = managedActive && freeModels.includes(model);
  const cliBridgeCovers = cliBridge && activeProvider === 'anthropic';
  const hasKey = apiKey.trim().length > 0 || managedCovers || cliBridgeCovers;
  // Precomputed at render scope: helper calls with component-scope args inside
  // the callbacks defeat React Compiler memoization preservation.
  const keyMissingError =
    managedActive && !managedCovers ? managedUncoveredError(activeProvider) : noKeyError(activeProvider);

  const updateModel = useCallback(
    (value: string) => {
      if (!(MODEL_ALLOWLIST as readonly string[]).includes(value)) return;
      setStoredModel(value);
    },
    [setStoredModel],
  );

  // Fetch managed-access status (best-effort: failures just mean the
  // BYOK-only experience). Also re-invoked when an examiner call 401s without
  // a BYOK key (so the sidebar can't keep claiming "signed in" after
  // expiry/revocation) and after every successful keyless-managed call (so
  // the sidebar's usage meter tracks spend live).
  const refreshManagedStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await readJson(res);
      if (res.ok && data && typeof (data as ManagedStatus).active === 'boolean') {
        setManagedStatus(data as ManagedStatus);
      }
    } catch {
      // ignore — managed access simply stays inactive
    }
  }, []);

  useEffect(() => {
    void refreshManagedStatus();
  }, [refreshManagedStatus]);

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
      // BYOK key takes precedence; with none, a managed session covering this
      // model (or the dev-only CLI bridge, Anthropic models only) lets the
      // server handle the call without a client key.
      const key = apiKey.trim();
      if (!key && !managedCovers && !cliBridgeCovers) {
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
          // Keyless request means we relied on the managed session, so a 401
          // is expiry/revocation — the server's "Missing API key" would send
          // a keyless managed user hunting for a key. Re-sync the sidebar too.
          void refreshManagedStatus();
          throw new Error(SESSION_EXPIRED_ERROR);
        }
        if (!res.ok) throw new Error(errorFrom(data, `Request failed (${res.status})`));
        // A keyless-managed call just settled real spend against this month's
        // allowance — re-sync the sidebar meter (best-effort; runs even if the
        // reply is discarded below, because the money moved regardless).
        if (!key && managedCovers) void refreshManagedStatus();
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
    [publicCase, apiKey, managedCovers, cliBridgeCovers, keyMissingError, model, refreshManagedStatus],
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
    if (!key && !managedCovers && !cliBridgeCovers) {
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
        // See runChat: keyless 401 = managed session expired/revoked.
        void refreshManagedStatus();
        throw new Error(SESSION_EXPIRED_ERROR);
      }
      if (!res.ok) throw new Error(errorFrom(data, `Request failed (${res.status})`));
      // See runChat: keyless-managed spend settled — keep the meter live.
      if (!key && managedCovers) void refreshManagedStatus();
      const marked = data as ExaminerMarkResponse;
      setMarksheet(marked.marksheet);
      setMarkUsage(marked.usage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setPending(null);
    }
  }, [publicCase, pending, caseLoading, entries, apiKey, managedCovers, cliBridgeCovers, keyMissingError, model, refreshManagedStatus]);

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
          <h1 className="text-base font-semibold tracking-tight">PACES Buddy</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {managedActive
              ? 'AI examiner · signed in'
              : cliBridgeCovers && !apiKey.trim()
                ? 'AI examiner · dev bridge (subscription quota)'
                : 'AI examiner for MRCP PACES'}
          </p>
        </div>
        {/* The Account panel sits above Settings: a signed-in user's first task
            is signing in, not pasting an API key. */}
        <AccountPanel status={managedStatus} onRefresh={refreshManagedStatus} />
        <Settings
          claudeKey={claudeKey}
          model={model}
          signedIn={managedActive}
          freeModels={freeModels}
          managedCovers={managedCovers}
          onClaudeKeyChange={setClaudeKey}
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
