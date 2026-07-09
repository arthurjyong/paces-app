'use client';

// Sidebar History: past encounters archived in IndexedDB (see historyStore.ts).
// Collapsible, matching the Settings/DemoAccess section pattern. A row click
// reopens the encounter as the live one (read it back, or keep going — the
// backend is stateless, so resuming is just re-sending the transcript);
// the × deletes the record after a confirm.

import { useState } from 'react';
import type { ArchivedEncounter } from './historyStore';

interface HistoryListProps {
  records: ArchivedEncounter[];
  /** blocks open/delete while an examiner call or case load is in flight */
  disabled: boolean;
  onOpen: (record: ArchivedEncounter) => void;
  onDelete: (id: string) => void;
}

/** "2026-07-07T03:12:00.000Z" -> "7 Jul, 11:12" in the viewer's locale/zone. */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function HistoryList({ records, disabled, onOpen, onDelete }: HistoryListProps) {
  const [open, setOpen] = useState(false);
  if (records.length === 0) return null;

  return (
    <section className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <span>
          History <span className="font-normal normal-case tracking-normal">· {records.length}</span>
        </span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <ul className="max-h-64 overflow-y-auto overscroll-y-contain px-2 pb-2">
          {records.map((r) => (
            <li key={r.id} className="flex items-stretch">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(r)}
                title="Reopen this encounter — review it, or continue where you left off"
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm">{r.meta.displayTitle}</span>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">#{r.meta.caseCode}</span>
                </span>
                <span className="flex items-baseline gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{fmtWhen(r.archivedAt)}</span>
                  {r.marksheet ? (
                    <span className="font-medium text-teal-700 dark:text-teal-300">
                      {r.marksheet.total}/{r.marksheet.maxTotal}
                    </span>
                  ) : (
                    <span className="italic">unmarked</span>
                  )}
                </span>
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Delete ${r.meta.displayTitle} #${r.meta.caseCode} from history`}
                onClick={() => {
                  if (window.confirm('Delete this encounter from History? This cannot be undone.')) onDelete(r.id);
                }}
                className="shrink-0 rounded-md px-2 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
