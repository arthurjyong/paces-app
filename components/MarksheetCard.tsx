'use client';

// Marksheet rendering: one row per marked skill (letter, name, coloured grade
// chip, justification), then total, overall impression, biggest improvement.

import type { Grade, MarkSheet, TokenUsage } from '@/lib/types';
import { SKILL_NAMES, usageLine } from './shared';

const GRADE_META: Record<Grade, { label: string; chip: string }> = {
  2: {
    label: 'Satisfactory',
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  },
  1: {
    label: 'Borderline',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  },
  0: {
    label: 'Unsatisfactory',
    chip: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  },
};

interface MarksheetCardProps {
  marksheet: MarkSheet;
  usage: TokenUsage | null;
}

export default function MarksheetCard({ marksheet, usage }: MarksheetCardProps) {
  const rows = [...marksheet.skills].sort((a, b) => a.skill.localeCompare(b.skill));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Marksheet
        </h3>
        <span className="text-lg font-semibold tabular-nums">
          {marksheet.total}
          <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400"> / {marksheet.maxTotal}</span>
        </span>
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((row) => {
          const meta = GRADE_META[row.grade];
          return (
            <li key={row.skill} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {row.skill}
                </span>
                <span className="flex-1 truncate text-sm font-medium">{SKILL_NAMES[row.skill]}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}>
                  {meta.label}
                </span>
              </div>
              {row.justification && (
                <p className="mt-1.5 pl-8 text-sm leading-5 text-zinc-600 dark:text-zinc-400">
                  {row.justification}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Overall impression
          </h4>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{marksheet.overallImpression}</p>
        </div>
        <div className="rounded-md border-l-2 border-teal-600 bg-teal-50/60 px-3 py-2 dark:border-teal-400 dark:bg-teal-950/40">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
            Biggest improvement
          </h4>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{marksheet.biggestImprovement}</p>
        </div>
        {usage && (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{usageLine(usage)}</p>
        )}
      </div>
    </div>
  );
}
