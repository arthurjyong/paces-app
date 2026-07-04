'use client';

// PACES Practice — single-page client app.
// Holds all state (settings, manifest, selected case, transcript, marksheet)
// and talks to the backend exclusively via GET /api/manifest, GET /api/case/[id],
// and POST /api/examiner, per lib/types.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BEGIN_MESSAGE, useLocalStorage, type TranscriptEntry } from '@/components/shared';
import {
  API_KEY_HEADER,
  DEFAULT_MODEL,
  MODEL_ALLOWLIST,
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
import Settings from '@/components/Settings';
import CasePicker from '@/components/CasePicker';
import ChatPane from '@/components/ChatPane';

const LS_API_KEY = 'paces.apiKey';
const LS_MODEL = 'paces.model';

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

export default function Home() {
  // Settings (persisted to localStorage).
  const [apiKey, updateApiKey] = useLocalStorage(LS_API_KEY, '');
  const [storedModel, setStoredModel] = useLocalStorage(LS_MODEL, DEFAULT_MODEL);
  const model = (MODEL_ALLOWLIST as readonly string[]).includes(storedModel) ? storedModel : DEFAULT_MODEL;

  // Case list + selection.
  const [manifest, setManifest] = useState<PublicManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [publicCase, setPublicCase] = useState<PublicCase | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);

  // Encounter state (React only — no persistence).
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [pending, setPending] = useState<'chat' | 'mark' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marksheet, setMarksheet] = useState<MarkSheet | null>(null);
  const [markUsage, setMarkUsage] = useState<TokenUsage | null>(null);

  // Mobile sidebar drawer.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Tracks the currently selected case so in-flight examiner replies for a
  // previous case are discarded instead of contaminating a new transcript
  // (select-during-flight race).
  const caseIdRef = useRef<string | null>(null);
  useEffect(() => {
    caseIdRef.current = publicCase?.meta.id ?? null;
  }, [publicCase]);

  const hasKey = apiKey.trim().length > 0;

  const updateModel = useCallback(
    (value: string) => {
      if (!(MODEL_ALLOWLIST as readonly string[]).includes(value)) return;
      setStoredModel(value);
    },
    [setStoredModel],
  );

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

  const selectCase = useCallback(
    async (id: string) => {
      if (pending || caseLoading) return;
      if (publicCase?.meta.id === id) {
        setSidebarOpen(false);
        return;
      }
      if (entries.length > 0 && !window.confirm('Leave this encounter? The transcript will be discarded.')) {
        return;
      }
      setSidebarOpen(false);
      setCaseLoading(true);
      setError(null);
      try {
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
        setCaseLoading(false);
      }
    },
    [pending, caseLoading, publicCase, entries.length],
  );

  /** POST /api/examiner action:'chat' with the given transcript; appends the reply on success. */
  const runChat = useCallback(
    async (transcript: TranscriptEntry[]) => {
      if (!publicCase) return;
      const key = apiKey.trim();
      if (!key) {
        setError('Add your Anthropic API key in Settings to start.');
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
          headers: { 'Content-Type': 'application/json', [API_KEY_HEADER]: key },
          body: JSON.stringify(body),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(errorFrom(data, `Request failed (${res.status})`));
        // Discard replies that resolve after the user switched case — appending
        // them would put case A's examiner turn into case B's transcript.
        if (caseIdRef.current !== caseId) return;
        const chat = data as ExaminerChatResponse;
        if (!chat.reply) return; // defence in depth: never store an empty assistant turn
        setEntries((cur) => [
          ...cur,
          { role: 'assistant', content: chat.reply, usage: chat.usage, kbLookups: chat.kbLookups },
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
    [publicCase, apiKey, model],
  );

  const send = useCallback(
    (text: string) => {
      // caseLoading guard: while a new case is being fetched the old pane is
      // still rendered — sending then would target the outgoing case.
      if (!publicCase || pending || caseLoading) return;
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
    if (!publicCase || pending || caseLoading || entries.length === 0) return;
    const key = apiKey.trim();
    if (!key) {
      setError('Add your Anthropic API key in Settings to start.');
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
        headers: { 'Content-Type': 'application/json', [API_KEY_HEADER]: key },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorFrom(data, `Request failed (${res.status})`));
      const marked = data as ExaminerMarkResponse;
      setMarksheet(marked.marksheet);
      setMarkUsage(marked.usage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setPending(null);
    }
  }, [publicCase, pending, caseLoading, entries, apiKey, model]);

  const newCase = useCallback(() => {
    if (pending) return;
    if (!window.confirm('End this encounter and choose a new case? The transcript will be discarded.')) return;
    setPublicCase(null);
    setEntries([]);
    setMarksheet(null);
    setMarkUsage(null);
    setError(null);
    setSidebarOpen(true);
  }, [pending]);

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
          <h1 className="text-base font-semibold tracking-tight">PACES Practice</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">AI examiner · bring your own key</p>
        </div>
        <Settings apiKey={apiKey} model={model} onApiKeyChange={updateApiKey} onModelChange={updateModel} />
        <CasePicker
          manifest={manifest}
          manifestError={manifestError}
          selectedId={publicCase?.meta.id ?? null}
          onSelect={(id) => void selectCase(id)}
        />
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
