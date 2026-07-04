'use client';

// Sidebar settings: BYOK Anthropic API key (localStorage-persisted by the parent)
// and model selection from the shared allowlist. Collapsible.

import { useState } from 'react';
import { MODEL_ALLOWLIST, MODEL_LABELS } from '@/lib/types';

interface SettingsProps {
  apiKey: string;
  model: string;
  /** True when a demo (invited-access) session is active — the key is then optional. */
  demoActive: boolean;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

export default function Settings({
  apiKey,
  model,
  demoActive,
  onApiKeyChange,
  onModelChange,
}: SettingsProps) {
  // Collapsed by default: invited users never need this section, and BYOK
  // users open it once. The API-key box must not be the first thing shown.
  const [open, setOpen] = useState(false);

  return (
    <section className="border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <span>Settings</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          <div>
            <label htmlFor="api-key" className="mb-1 block text-sm font-medium">
              Anthropic API key
            </label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="sk-ant-…"
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Stored only in this browser. Sent per-request to your own backend, never saved server-side.
            </p>
            {demoActive && (
              <p className="mt-1 text-xs leading-5 text-teal-700 dark:text-teal-300">
                Not needed while invited access is active.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="model" className="mb-1 block text-sm font-medium">
              Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-950"
            >
              {MODEL_ALLOWLIST.map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </section>
  );
}
