// Server-only price table + cost math for the MANAGED door (models run on the
// server-held gateway key). Our own ledger meters real-time spend — the
// gateway's per-generation reporting is Pro-only and lags, so it is used for
// periodic reconciliation only (plan §7).
//
// Prices are the gateway's zero-markup list prices, USD per MILLION tokens,
// re-verified on the gateway models API 2026-09-28 (see lib/types.ts MODELS).
// Rules:
// - Peak pricing: DeepSeek V4 Pro doubles its list prices (peakMultiplier 2)
//   Monday to Friday during UTC minutes-of-day 60 to 240 and 360 to 600 (that
//   is 01:00 to 04:00 and 06:00 to 10:00 UTC). Both actualCallUsd and
//   estimateCallUsd scale by peakMultiplier() for the moment of the call, so
//   reserve and settle use the same rate and the ledger stops under-counting.
// - DeepSeek V4 Pro on the gateway has thinking ALWAYS ON and bills reasoning
//   as output — response.usage.output_tokens already includes it, so the
//   SETTLE side needs no special casing; only the reserve ESTIMATE inflates
//   output by reasoningFactor.
// - Cache pricing: Anthropic bills reads at 0.1x input and 5-minute writes at
//   1.25x input. DeepSeek's caching is automatic (hits ~0.1x, no documented
//   write premium) — we charge writes at 1x input, deliberately conservative:
//   the ledger must never under-charge the owner's balance.

import type { TokenUsage } from './types';

interface ModelPricing {
  /** USD per 1M tokens */
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
  /** reserve-estimate multiplier on max_tokens for always-on-reasoning models */
  reasoningFactor: number;
  /** peak-hour price multiplier (DeepSeek doubles Mon-Fri peak windows); absent = never peaks */
  peakMultiplier?: number;
}

/** Keyed by MODELS registry id. Only managed (gateway) models belong here. */
const PRICING: Record<string, ModelPricing> = {
  'anthropic/claude-sonnet-4.6': {
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
    reasoningFactor: 1,
  },
  'deepseek/deepseek-v4-pro': {
    inputPerM: 0.66,
    outputPerM: 1.98,
    cacheReadPerM: 0.022,
    cacheWritePerM: 0.66,
    reasoningFactor: 2.5,
    peakMultiplier: 2,
  },
};

export function isMeteredModel(model: string): boolean {
  return model in PRICING;
}

/**
 * Peak-hour price multiplier for `model` at instant `at`. DeepSeek doubles its
 * list prices Monday to Friday during UTC minutes-of-day 60 to 240 and 360 to
 * 600 (both inclusive, as the gateway defines the windows). Returns the entry's
 * peakMultiplier inside a window, else 1, including 1 for any model with no
 * peakMultiplier field. (getUTCDay: 0 = Sunday, 6 = Saturday.)
 */
export function peakMultiplier(model: string, at: Date = new Date()): number {
  const p = PRICING[model];
  if (!p || !p.peakMultiplier) return 1;
  const day = at.getUTCDay();
  if (day < 1 || day > 5) return 1;
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  const inPeak =
    (minute >= 60 && minute <= 240) || (minute >= 360 && minute <= 600);
  return inPeak ? p.peakMultiplier : 1;
}

/** Actual USD for a settled call, from real response usage. */
export function actualCallUsd(
  model: string,
  usage: TokenUsage,
  at: Date = new Date()
): number {
  const p = PRICING[model];
  if (!p) throw new Error(`No price entry for model ${model}`);
  const base =
    (usage.inputTokens * p.inputPerM +
      usage.outputTokens * p.outputPerM +
      usage.cacheReadTokens * p.cacheReadPerM +
      usage.cacheWriteTokens * p.cacheWritePerM) /
    1_000_000;
  return base * peakMultiplier(model, at);
}

/**
 * The most upstream calls ONE examiner request can make. A chat request runs a
 * tool loop (1 initial call + up to MAX_TOOL_ITERATIONS search_kb rounds in
 * app/api/examiner/route.ts), each re-sending the full system prompt and able
 * to emit another full max_tokens; marking is a single call. MUST stay in sync
 * with MAX_TOOL_ITERATIONS there (the estimate is only a safe ceiling if it
 * accounts for every call the loop can make).
 */
const MAX_CHAT_UPSTREAM_CALLS = 4; // 1 + MAX_TOOL_ITERATIONS(3)

/**
 * The search_kb results a chat request re-sends, in tokens. Each tool-loop call
 * after the first carries every earlier lookup result in its messages: call k
 * (k = 2 to MAX_CHAT_UPSTREAM_CALLS) carries k - 1 results of up to
 * MAX_KB_RESULT_CHARS each, so across the 4 calls that is (1 + 2 + 3) x 20,000
 * characters, at 3.5 characters a token. Priced at the input rate once per chat
 * request. This assumes one lookup per round (the usual case); a round with
 * several parallel lookups can exceed it, and the settle clamp in the examiner
 * route then still keeps the meters at the reservation. MUST stay in sync with
 * MAX_TEXT_CHARS in lib/kb.ts and with MAX_CHAT_UPSTREAM_CALLS above.
 */
const MAX_KB_RESULT_CHARS = 20_000; // = MAX_TEXT_CHARS in lib/kb.ts
const KB_RESEND_TOKENS = Math.ceil(((1 + 2 + 3) * MAX_KB_RESULT_CHARS) / 3.5); // about 34,286

/**
 * Pre-call reserve estimate, USD — a genuine UPPER BOUND on what this one
 * request can settle, so the per-user allowance and the global daily cap are
 * HARD bounds on real spend, not soft ones (security invariant 5; review
 * finding 2026-07-09). The earlier "price the system block at the cache-read
 * rate" estimate under-reserved two real, steady-state cases — the cache-WRITE
 * first call of a case, and the up-to-4-call chat tool loop — letting settled
 * spend run several times the reserved estimate and past the cap. The ceiling
 * here removes that:
 * - system blocks (~45k tokens: persona+rubric ~8k + case+grounding capped at
 *   150k chars ≈ 37k) priced at the cache-WRITE rate for EVERY call (the
 *   absolute worst case — first call writes, and if caching ever misses a
 *   later call it still can't exceed this),
 * - transcript (chars/3.5, English prose lower bound) at the input rate per call,
 * - output = (chat 1,500 / mark 2,500) × reasoningFactor per call. The chat
 *   room (max_tokens) is now 2,500 and DeepSeek's thinking counts inside it,
 *   so the 1,500 figure still bounds a full chat reply for DeepSeek
 *   (1,500 × 2.5 = 3,750 > 2,500); the Sonnet entry (factor 1) would not be
 *   bounded, but no managed tier serves it (lib/tiers.ts TIER_MODELS),
 * - all × the call count (chat 4, mark 1),
 * - chat only: + the re-sent search_kb results (KB_RESEND_TOKENS) at the input
 *   rate, once per request,
 * - all × peakMultiplier, +10% headroom, floored at $0.005.
 * This over-reserves an in-flight call (settle immediately releases down to the
 * REAL cost via actualCallUsd), so a single serialized user barely notices; the
 * payoff is that the cap can never be overshot by an admitted call. The reserve
 * is taken seconds before the upstream call, so peakMultiplier at `at` matches
 * what settle will charge, no double-reserve.
 */
export function estimateCallUsd(
  model: string,
  action: 'chat' | 'mark',
  transcriptChars: number,
  at: Date = new Date()
): number {
  const p = PRICING[model];
  if (!p) throw new Error(`No price entry for model ${model}`);
  const calls = action === 'mark' ? 1 : MAX_CHAT_UPSTREAM_CALLS;
  const systemTokens = 45_000;
  const transcriptTokens = Math.ceil(transcriptChars / 3.5);
  const outputTokens = (action === 'mark' ? 2_500 : 1_500) * p.reasoningFactor;
  const perCallUsd =
    (systemTokens * p.cacheWritePerM +
      transcriptTokens * p.inputPerM +
      outputTokens * p.outputPerM) /
    1_000_000;
  const kbResendUsd = action === 'chat' ? (KB_RESEND_TOKENS * p.inputPerM) / 1_000_000 : 0;
  return Math.max(
    (perCallUsd * calls + kbResendUsd) * peakMultiplier(model, at) * 1.1,
    0.005
  );
}
