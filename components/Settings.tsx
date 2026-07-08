'use client';

// Sidebar settings: model selection (grouped by provider) and the BYOK API key
// for the SELECTED model's provider (each provider has its own localStorage
// slot, managed by the parent — switching model switches which key is shown
// and sent; the others stay saved in this browser). Collapsible.

import { useState } from 'react';
import { MODELS, PROVIDERS, providerInfo, type ProviderId } from '@/lib/types';

interface SettingsProps {
  providerKeys: Record<ProviderId, string>;
  model: string;
  /** provider of the selected model — its key input is the one shown */
  activeProvider: ProviderId;
  /** True when an invited-access session covers the active provider — the key is then optional. */
  demoCovers: boolean;
  onProviderKeyChange: (provider: ProviderId, value: string) => void;
  onModelChange: (value: string) => void;
}

export default function Settings({
  providerKeys,
  model,
  activeProvider,
  demoCovers,
  onProviderKeyChange,
  onModelChange,
}: SettingsProps) {
  // Collapsed by default: invited users never need this section, and BYOK
  // users open it once. The API-key box must not be the first thing shown.
  const [open, setOpen] = useState(false);

  const active = providerInfo(activeProvider);
  const savedElsewhere = PROVIDERS.filter(
    (p) => p.id !== activeProvider && providerKeys[p.id].trim().length > 0
  );

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
            <label htmlFor="model" className="mb-1 block text-sm font-medium">
              Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-950"
            >
              {PROVIDERS.map((p) => {
                const models = MODELS.filter((m) => m.provider === p.id);
                if (models.length === 0) return null;
                return (
                  <optgroup key={p.id} label={p.label}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <div>
            <label htmlFor="api-key" className="mb-1 block text-sm font-medium">
              {active.label} API key
            </label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={providerKeys[activeProvider]}
              onChange={(e) => onProviderKeyChange(activeProvider, e.target.value)}
              placeholder={active.keyPlaceholder}
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Stored only in this browser. Sent per-request to your own backend, never saved
              server-side.{' '}
              <a
                href={active.keyConsoleUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                Get a {active.label} key
              </a>
            </p>
            {demoCovers && (
              <p className="mt-1 text-xs leading-5 text-teal-700 dark:text-teal-300">
                Not needed while invited access is active.
              </p>
            )}
            {savedElsewhere.length > 0 && (
              <p className="mt-1 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
                Also saved here: {savedElsewhere.map((p) => p.label).join(', ')} — shown when a
                model from that provider is selected.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
