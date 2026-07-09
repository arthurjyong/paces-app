// Server-only price table + cost math for the MANAGED door (models run on the
// server-held gateway key). Our own ledger meters real-time spend — the
// gateway's per-generation reporting is Pro-only and lags, so it is used for
// periodic reconciliation only (plan §7).
//
// Prices are the gateway's zero-markup list prices, USD per MILLION tokens,
// verified on the gateway models API 2026-07-09 (see lib/types.ts MODELS).
// Rules:
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
    inputPerM: 0.435,
    outputPerM: 0.87,
    cacheReadPerM: 0.0435,
    cacheWritePerM: 0.435,
    reasoningFactor: 2.5,
  },
};

export function isMeteredModel(model: string): boolean {
  return model in PRICING;
}

/** Actual USD for a settled call, from real response usage. */
export function actualCallUsd(model: string, usage: TokenUsage): number {
  const p = PRICING[model];
  if (!p) throw new Error(`No price entry for model ${model}`);
  return (
    (usage.inputTokens * p.inputPerM +
      usage.outputTokens * p.outputPerM +
      usage.cacheReadTokens * p.cacheReadPerM +
      usage.cacheWriteTokens * p.cacheWritePerM) /
    1_000_000
  );
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
 * - output = max_tokens (chat 1500 / mark 2500) × reasoningFactor per call,
 * - all × the call count (chat 4, mark 1), +10% headroom, floored at $0.005.
 * This over-reserves an in-flight call (settle immediately releases down to the
 * REAL cost via actualCallUsd), so a single serialized user barely notices; the
 * payoff is that the cap can never be overshot by an admitted call.
 */
export function estimateCallUsd(
  model: string,
  action: 'chat' | 'mark',
  transcriptChars: number
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
  return Math.max(perCallUsd * calls * 1.1, 0.005);
}
