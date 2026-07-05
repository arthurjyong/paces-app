'use client';

// Sidebar case picker: specialty filter chips, a random-case button, and the
// case list in two groupings — by encounter TYPE (default: Consultation /
// Communication / Examination · system, with the source sitting/collection as
// the row label) or by SOURCE (the original sitting/collection groups, for
// browsing a carousel as a unit). Selection is delegated to the parent, which
// fetches /api/case/[id].

import { useMemo, useState } from 'react';
import type { PublicCaseMeta, PublicManifest } from '@/lib/types';
import { SkillBadges } from './shared';

const FILTERS = [
  'All',
  'Cardiovascular',
  'Respiratory',
  'Neurology',
  'Abdominal',
  'Communication',
  'Consultation',
] as const;

type Filter = (typeof FILTERS)[number];
type View = 'type' | 'source';

// Fixed ordering for the by-type groups; any exam specialty not listed here
// (none today) sorts after these, alphabetically.
const TYPE_GROUP_ORDER = [
  'Consultation',
  'Communication',
  'Examination · Cardiovascular',
  'Examination · Respiratory',
  'Examination · Neurology',
  'Examination · Abdominal',
];

function typeGroupOf(c: PublicCaseMeta): string {
  if (c.encounterType === 'consultation') return 'Consultation';
  if (c.encounterType === 'communication') return 'Communication';
  return `Examination · ${c.specialty}`;
}

interface CasePickerProps {
  manifest: PublicManifest | null;
  manifestError: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function CasePicker({ manifest, manifestError, selectedId, onSelect }: CasePickerProps) {
  const [view, setView] = useState<View>('type');
  const [filter, setFilter] = useState<Filter>('All');
  const [theme, setTheme] = useState<string>('All');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const themes = useMemo<string[]>(() => {
    if (!manifest) return [];
    return Array.from(new Set(manifest.cases.map((c) => c.theme).filter(Boolean) as string[])).sort();
  }, [manifest]);

  const filtered = useMemo<PublicCaseMeta[]>(() => {
    if (!manifest) return [];
    return manifest.cases.filter(
      (c) => (filter === 'All' || c.specialty === filter) && (theme === 'All' || c.theme === theme)
    );
  }, [manifest, filter, theme]);

  // Group by type group or by sittingLabel. Within a group, manifest order is
  // preserved (sorted by sitting then encounterNo); same-label sittings (e.g.
  // two same-month cycles at one hospital) merge into one group by design.
  const groups = useMemo<Array<[string, PublicCaseMeta[]]>>(() => {
    const map = new Map<string, PublicCaseMeta[]>();
    for (const c of filtered) {
      const key = view === 'type' ? typeGroupOf(c) : c.sittingLabel;
      const g = map.get(key);
      if (g) g.push(c);
      else map.set(key, [c]);
    }
    const entries = Array.from(map.entries());
    if (view === 'type') {
      const rank = (label: string) => {
        const i = TYPE_GROUP_ORDER.indexOf(label);
        return i === -1 ? TYPE_GROUP_ORDER.length : i;
      };
      entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
    }
    return entries;
  }, [filtered, view]);

  function switchView(v: View) {
    if (v === view) return;
    setView(v);
    setExpanded(new Set());
  }

  function toggleGroup(label: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function pickRandom() {
    if (filtered.length === 0) return;
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    onSelect(pick.id);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Cases{manifest ? ` · ${filtered.length}` : ''}
          </h2>
          <button
            type="button"
            onClick={pickRandom}
            disabled={filtered.length === 0}
            className="rounded-md border border-teal-600/40 px-2 py-0.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-teal-400/40 dark:text-teal-300 dark:hover:bg-teal-950/40"
          >
            Random case
          </button>
        </div>
        <div className="mb-2 flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700" role="group" aria-label="Group cases by">
          {(
            [
              ['type', 'By type'],
              ['source', 'By source'],
            ] as Array<[View, string]>
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => switchView(v)}
              aria-pressed={view === v}
              className={`flex-1 rounded px-2 py-0.5 text-xs transition-colors ${
                view === v
                  ? 'bg-teal-700 text-white dark:bg-teal-500 dark:text-teal-950'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                filter === f
                  ? 'bg-teal-700 text-white dark:bg-teal-500 dark:text-teal-950'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {themes.length > 0 && (
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            aria-label="Filter by clinical theme"
            className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="All">All themes</option>
            {themes.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {manifestError ? (
          <p className="mx-2 mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {manifestError}
          </p>
        ) : !manifest ? (
          <p className="mx-2 mt-2 text-sm text-zinc-500 dark:text-zinc-400">Loading cases…</p>
        ) : groups.length === 0 ? (
          <p className="mx-2 mt-2 text-sm text-zinc-500 dark:text-zinc-400">No cases match this filter.</p>
        ) : (
          groups.map(([label, cases]) => {
            const isOpen = expanded.has(label);
            const containsSelected = selectedId !== null && cases.some((c) => c.id === selectedId);
            return (
              <div key={label} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(label)}
                  aria-expanded={isOpen}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    containsSelected ? 'font-medium text-teal-700 dark:text-teal-300' : 'text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <span className="truncate">{label}</span>
                  <span className="ml-2 flex shrink-0 items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                    {cases.length}
                    <span className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden>
                      ›
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <ul className="mb-1 ml-2 border-l border-zinc-200 pl-1 dark:border-zinc-800">
                    {cases.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(c.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm ${
                            c.id === selectedId
                              ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200'
                              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{view === 'type' ? c.sittingLabel : c.displayTitle}</span>
                          <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">#{c.encounterNo}</span>
                          <SkillBadges skills={c.skills} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
