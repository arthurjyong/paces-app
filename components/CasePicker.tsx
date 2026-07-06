'use client';

// Sidebar case picker. Nomenclature (see SPEC.md): CLASSIFICATION = consultation /
// communication / examination; THEME = clinical topic. Both filter as tick-box
// multi-selects with Select all. SOURCE = where the case came from (a sitting or
// pooled bank — the row/group label). Two groupings: by type (classification,
// default) or by source. Rows are deliberately blind: title only, no encounter
// number, no theme. Selection is delegated to the parent, which fetches
// /api/case/[id].

import { useMemo, useState, type ReactNode } from 'react';
import type { EncounterType, PublicCaseMeta, PublicManifest } from '@/lib/types';

const CLASSIFICATIONS: Array<[EncounterType, string]> = [
  ['consultation', 'Consultation'],
  ['communication', 'Communication'],
  ['examination', 'Examination'],
];

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

// The pooled standalone banks (see SPEC.md nomenclature): pinned after the
// carousel sittings in the by-source view, in this order. Empty banks (e.g.
// "Examination bank" today) still render as placeholders when browsing
// unfiltered.
const BANK_ORDER = ['Consult bank', 'Communication bank', 'Examination bank'];

function typeGroupOf(c: PublicCaseMeta): string {
  if (c.encounterType === 'consultation') return 'Consultation';
  if (c.encounterType === 'communication') return 'Communication';
  return `Examination · ${c.specialty}`;
}

/**
 * Collapsible tick-box multi-select. `sel === null` means "all selected" (the
 * default — also keeps newly added options included); an explicit Set tracks
 * partial selections.
 */
function TickFilter({
  title,
  options,
  sel,
  onToggle,
  onToggleAll,
}: {
  title: string;
  options: Array<{ key: string; label: ReactNode; count: number }>;
  sel: Set<string> | null;
  onToggle: (key: string) => void;
  onToggleAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const allSelected = sel === null || sel.size === options.length;
  return (
    <div className="mt-2 rounded-md border border-zinc-200 dark:border-zinc-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <span className="font-medium">{title}</span>
        <span className="ml-2 flex shrink-0 items-center gap-1 text-zinc-400 dark:text-zinc-500">
          {allSelected ? 'All' : `${sel?.size ?? 0}/${options.length}`}
          <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
            ›
          </span>
        </span>
      </button>
      {open && (
        <div className="max-h-52 overflow-y-auto border-t border-zinc-200 px-2 py-1 dark:border-zinc-700">
          <label className="flex cursor-pointer items-center gap-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                // Tri-state: partial selections show as indeterminate, so
                // 15/16 ticked is distinguishable from none ticked.
                if (el) el.indeterminate = !allSelected && (sel?.size ?? 0) > 0;
              }}
              onChange={onToggleAll}
              className="accent-teal-600"
            />
            Select all
          </label>
          {options.map((o) => (
            <label
              key={o.key}
              className="flex cursor-pointer items-center gap-2 py-1 text-xs text-zinc-600 dark:text-zinc-300"
            >
              <input
                type="checkbox"
                checked={sel === null || sel.has(o.key)}
                onChange={() => onToggle(o.key)}
                className="accent-teal-600"
              />
              <span className="flex-1 truncate">{o.label}</span>
              <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{o.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface CasePickerProps {
  manifest: PublicManifest | null;
  manifestError: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function CasePicker({ manifest, manifestError, selectedId, onSelect }: CasePickerProps) {
  const [view, setView] = useState<View>('type');
  // null = all selected, for both filters (see TickFilter).
  const [classSel, setClassSel] = useState<Set<string> | null>(null);
  const [themeSel, setThemeSel] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const themes = useMemo<string[]>(() => {
    if (!manifest) return [];
    return Array.from(new Set(manifest.cases.map((c) => c.theme).filter(Boolean) as string[])).sort();
  }, [manifest]);

  const classCounts = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>();
    for (const c of manifest?.cases ?? []) counts.set(c.encounterType, (counts.get(c.encounterType) ?? 0) + 1);
    return counts;
  }, [manifest]);

  const classFiltered = useMemo<PublicCaseMeta[]>(() => {
    if (!manifest) return [];
    if (classSel === null) return manifest.cases;
    return manifest.cases.filter((c) => classSel.has(c.encounterType));
  }, [manifest, classSel]);

  // Per-theme counts within the current classification filter, shown beside each tick box.
  const themeCounts = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>();
    for (const c of classFiltered) {
      if (c.theme) counts.set(c.theme, (counts.get(c.theme) ?? 0) + 1);
    }
    return counts;
  }, [classFiltered]);

  const filtered = useMemo<PublicCaseMeta[]>(() => {
    if (themeSel === null) return classFiltered;
    // Untagged cases (none today) fail open — a theme filter should never hide them.
    return classFiltered.filter((c) => (c.theme ? themeSel.has(c.theme) : true));
  }, [classFiltered, themeSel]);

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
      return entries;
    }
    // Source view: carousel sittings first (manifest order), then the pooled
    // banks in fixed order — including empty placeholders when unfiltered.
    const sittings = entries.filter(([l]) => !BANK_ORDER.includes(l));
    const banks = entries.filter(([l]) => BANK_ORDER.includes(l));
    if (classSel === null && themeSel === null && manifest) {
      for (const b of BANK_ORDER) {
        if (!banks.some(([l]) => l === b)) banks.push([b, []]);
      }
    }
    banks.sort((a, b) => BANK_ORDER.indexOf(a[0]) - BANK_ORDER.indexOf(b[0]));
    return [...sittings, ...banks];
  }, [filtered, view, classSel, themeSel, manifest]);

  function switchView(v: View) {
    if (v === view) return;
    setView(v);
    setExpanded(new Set());
  }

  function makeToggle(
    all: string[],
    setter: React.Dispatch<React.SetStateAction<Set<string> | null>>
  ) {
    return (key: string) =>
      setter((prev) => {
        const next = new Set(prev ?? all);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next.size === all.length ? null : next;
      });
  }

  function makeToggleAll(
    sel: Set<string> | null,
    allCount: number,
    setter: React.Dispatch<React.SetStateAction<Set<string> | null>>
  ) {
    return () => setter(sel === null || sel.size === allCount ? new Set() : null);
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
        <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700" role="group" aria-label="Group cases by">
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
        <TickFilter
          title="Classification"
          options={CLASSIFICATIONS.map(([key, label]) => ({
            key,
            label,
            count: classCounts.get(key) ?? 0,
          }))}
          sel={classSel}
          onToggle={makeToggle(
            CLASSIFICATIONS.map(([k]) => k),
            setClassSel
          )}
          onToggleAll={makeToggleAll(classSel, CLASSIFICATIONS.length, setClassSel)}
        />
        {themes.length > 0 && (
          <TickFilter
            title="Themes"
            options={themes.map((t) => ({
              key: t,
              label: <span className="capitalize">{t.replace(/_/g, ' ')}</span>,
              count: themeCounts.get(t) ?? 0,
            }))}
            sel={themeSel}
            onToggle={makeToggle(themes, setThemeSel)}
            onToggleAll={makeToggleAll(themeSel, themes.length, setThemeSel)}
          />
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
                {isOpen && cases.length === 0 && (
                  <p className="mb-1 ml-2 border-l border-zinc-200 py-1 pl-3 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                    No cases yet.
                  </p>
                )}
                {isOpen && cases.length > 0 && (
                  <ul className="mb-1 ml-2 border-l border-zinc-200 pl-1 dark:border-zinc-800">
                    {cases.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(c.id)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                            c.id === selectedId
                              ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200'
                              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {/* Just the title — no encounter number (internal ordering) and no
                              theme (kept to the filter, so browsing stays exam-blind). Rows
                              within a group are deliberately interchangeable blind picks. */}
                          <span className="min-w-0 flex-1 truncate">
                            {view === 'type' ? c.sittingLabel : c.displayTitle}
                          </span>
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
