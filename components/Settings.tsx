'use client';

// Sidebar settings: the model picker + the BYOK Claude key. Two clean lanes,
// no provider jargon (the audience is clinicians):
//   • "Free with sign-in" — the signed-in tier's models (routed on the app's
//     managed key; shown only when signed in). No key field for these.
//   • "Your own Claude key" — Claude Sonnet 4.6 (default) / Opus 4.8 / Haiku 4.5,
//     run on the user's own Anthropic key.
// The key input is Claude-only and appears solely for a Claude (BYOK) model.
// Collapsible.

import { useState } from 'react';
import { BYOK_MODELS, modelProvider, providerInfo } from '@/lib/types';

interface SettingsProps {
  /** the user's own Claude (Anthropic) key — the only BYOK key now */
  claudeKey: string;
  model: string;
  /** true when a managed session is active (shows the free-models group) */
  signedIn: boolean;
  /** the signed-in tier's free (gateway) model ids, in preference order */
  freeModels: readonly string[];
  /** true when the signed-in session covers the selected model — the key is then optional */
  managedCovers: boolean;
  onClaudeKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

export default function Settings({
  claudeKey,
  model,
  signedIn,
  freeModels,
  managedCovers,
  onClaudeKeyChange,
  onModelChange,
}: SettingsProps) {
  // Collapsed by default: signed-in users never need this section, and BYOK
  // users open it once. The API-key box must not be the first thing shown.
  const [open, setOpen] = useState(false);

  const claude = providerInfo('anthropic');
  // A Claude (BYOK) model is selected → show the key field. A free/gateway
  // model is selected → the managed session covers it (or the user should sign
  // in); either way we never ask for a key.
  const isByokModel = modelProvider(model) === 'anthropic';

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
              {signedIn && freeModels.length > 0 && (
                // Free practice runs on a fixed model server-side; we never
                // surface which one (owner decision) — a single "Free practice"
                // option, whatever the tier's model id is.
                <optgroup label="Signed in">
                  <option value={freeModels[0]}>Free practice</option>
                </optgroup>
              )}
              <optgroup label="Your own Claude key">
                {BYOK_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {isByokModel ? (
            <div>
              <label htmlFor="api-key" className="mb-1 block text-sm font-medium">
                Your Claude API key
              </label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={claudeKey}
                onChange={(e) => onClaudeKeyChange(e.target.value)}
                placeholder={claude.keyPlaceholder}
                className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Stored only in this browser, sent per-request, never saved on our server. You pay
                Anthropic directly for what you use.{' '}
                <a
                  href={claude.keyConsoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Get a Claude key
                </a>
              </p>
            </div>
          ) : managedCovers ? (
            <p className="text-xs leading-5 text-teal-700 dark:text-teal-300">
              This model is free while you&apos;re signed in — no API key needed.
            </p>
          ) : (
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Sign in under Account to practise free on this model, or pick a Claude model to use
              your own key.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
