// POST /api/examiner — the AI-examiner backend.
//
// Multi-provider: every allowlisted model maps to a provider whose endpoint
// speaks the Anthropic Messages API, so ONE @anthropic-ai/sdk code path serves
// them all — the server switches only baseURL (fixed map in lib/providers.ts,
// never client-supplied) and API key per provider. The upstream call sends the
// model's WIRE id (modelWireId — OpenRouter registry ids are prefixed
// 'openrouter/…' to stay unique across providers); the REGISTRY id drives
// everything else server-side: allowlist, provider selection, tier gate, pricing.
//
// Security invariants enforced here:
// - The user's API key (API_KEY_HEADER) goes straight into the Anthropic SDK
//   constructor. It is never stored, logged, or echoed (invariant 2). A BYOK
//   key always takes precedence and is NEVER metered (the user's own money).
// - The server-held gateway key is reachable ONLY through the MANAGED door
//   (email+OTP sign-in — lib/managed.ts), behind the full chain: valid signed
//   session cookie → tier grant re-resolved LIVE from the database (removing a
//   domain/override revokes outstanding sessions immediately) → tier model
//   gate → reserve-then-settle spend meter. There is NO anonymous path to the
//   server key (the Phase-1 abuse fix): a keyless, sessionless request gets a
//   plain 401 that reveals nothing about server configuration.
// - Metering is reserve-then-settle (lib/managed.ts): the estimate is reserved
//   only AFTER all request validation (a 400 can never consume allowance), and
//   every exit path settles exactly once — success moves the REAL usage cost
//   into spent, any failure releases the reservation uncharged (try/finally —
//   no path may leak a reservation).
// - Error payloads are spoiler-free: upstream provider errors are mapped to
//   fixed generic strings; assembled prompts never appear in errors
//   (invariant 1). DB/driver error text is likewise never forwarded — a
//   metering failure surfaces as a fixed 503 string.
// - caseId resolves via manifest lookup only (invariant 3).
// - search_kb queries/slugs stay server-side; only a count is returned (invariant 4).
// - dryRun is gated to NODE_ENV === 'development', 404 otherwise (invariant 5).

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  TextBlockParam,
  Tool,
  ToolResultBlockParam,
  Usage,
} from '@anthropic-ai/sdk/resources/messages';
import {
  API_KEY_HEADER,
  DEFAULT_MODEL,
  MODELS,
  modelProvider,
  modelWireId,
  providerInfo,
  type ApiError,
  type CaseImage,
  type CaseMeta,
  type ChatMessage,
  type ExaminerChatResponse,
  type ExaminerMarkResponse,
  type ExaminerRequest,
  type TokenUsage,
} from '@/lib/types';
import { PROVIDER_CONFIG } from '@/lib/providers';
import { ContentError, getCaseImages, getCaseMeta } from '@/lib/content';
import {
  managedEnabled,
  managedGatewayKey,
  readManagedSession,
  reserveSpend,
  resolveTier,
  settleSpend,
  type TierGrant,
} from '@/lib/managed';
import { actualCallUsd, estimateCallUsd } from '@/lib/pricing';
import { TIER_LABELS, TIER_MODELS, type Tier } from '@/lib/tiers';
import { buildSystem } from '@/lib/prompt';
import { searchKb } from '@/lib/kb';
import { buildMarkSheet, extractJson, markInstruction } from '@/lib/marksheet';
import { extractRevealedImages } from '@/lib/images';
import { devCliEnabled, runCliChat, runCliMark } from '@/lib/devCli';

export const runtime = 'nodejs';
// Claude calls (especially marking) can run well past Vercel's default function
// timeout; without this the platform kills the request mid-generation.
export const maxDuration = 60;

const MAX_MESSAGES = 400;
const MAX_MESSAGE_CHARS = 30_000;
const MAX_TOOL_ITERATIONS = 3;

/**
 * Fixed client string for any database failure on the managed path (tier
 * resolution / reservation). Driver error text is never forwarded — it can
 * name hosts, tables, or connection-string fragments.
 */
const MANAGED_UNAVAILABLE =
  'Managed access is temporarily unavailable — try again shortly, or add your own API key in Settings';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const SEARCH_KB_TOOL: Tool = {
  name: 'search_kb',
  description:
    'Look up a condition, sign, or topic in the PACES reference library. Returns the canonical grounding note. Use for viva/debrief tangents not covered by the encounter brief.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The condition, sign, or topic to look up.' },
    },
    required: ['query'],
  },
};

const SUBMIT_MARKSHEET_TOOL: Tool = {
  name: 'submit_marksheet',
  description:
    'Submit the completed PACES marksheet for this encounter, graded strictly per the marking rubric.',
  input_schema: {
    type: 'object',
    properties: {
      skills: {
        type: 'array',
        description: 'One entry per skill marked for this encounter.',
        items: {
          type: 'object',
          properties: {
            skill: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
            grade: {
              type: 'integer',
              enum: [0, 1, 2],
              description: '2 = Satisfactory, 1 = Borderline, 0 = Unsatisfactory',
            },
            justification: {
              type: 'string',
              description: 'One-line justification tied to the rubric descriptors.',
            },
          },
          required: ['skill', 'grade', 'justification'],
        },
      },
      total: { type: 'number' },
      maxTotal: { type: 'number' },
      overallImpression: { type: 'string' },
      biggestImprovement: {
        type: 'string',
        description: 'The single change that would most improve the weakest skill.',
      },
    },
    required: ['skills', 'total', 'maxTotal', 'overallImpression', 'biggestImprovement'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(message: string, status: number) {
  const body: ApiError = { error: message };
  return NextResponse.json(body, { status });
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function accumulateUsage(total: TokenUsage, usage: Usage): void {
  total.inputTokens += usage.input_tokens ?? 0;
  total.outputTokens += usage.output_tokens ?? 0;
  total.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
}

/**
 * "Claude Sonnet 4.6 and DeepSeek V4 Pro" — the models a tier covers, for the
 * model-gate 403. The public tier's common mistake is selecting Sonnet, so the
 * message must NAME what IS covered, not just refuse. Labels come from the
 * MODELS registry with the picker's cost hint ("(premium · ~$0.30/case)")
 * stripped — it is noise inside an error sentence.
 */
function tierModelSummary(tier: Tier): string {
  return TIER_MODELS[tier]
    .map((id) => (MODELS.find((m) => m.id === id)?.label ?? id).replace(/\s*\(.*\)\s*$/, ''))
    .join(' and ');
}

/**
 * Map upstream provider errors to spoiler-free client payloads. SDK error
 * messages are never forwarded (they could quote request content); every
 * branch returns a fixed generic string, parameterised only by the provider's
 * display label. Nothing is logged (invariant 2). The SDK classifies by HTTP
 * status, so the same classes apply to every Anthropic-compatible endpoint.
 */
function mapUpstreamError(
  err: unknown,
  provider: string,
  usingManagedKey: boolean
): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    // A BYOK 401 is the user's key; a managed-key 401 is the owner's
    // server-held gateway key — saying "Invalid API key" would send a keyless
    // signed-in user hunting for a key they don't have.
    return usingManagedKey
      ? { status: 502, message: `The managed-access key was rejected by ${provider} — contact the app owner` }
      : { status: 401, message: `Invalid ${provider} API key` };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: `Rate limited by ${provider}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: `Could not reach the ${provider} API` };
  }
  if (err instanceof Anthropic.APIError) {
    const s = typeof err.status === 'number' ? err.status : 0;
    if (s === 400) return { status: 502, message: `${provider} rejected the request as invalid` };
    if (s === 402) {
      // DeepSeek (prepaid top-up) documents 402 = insufficient balance — the
      // most likely failure a budget-tier user hits. Same owner/user split as
      // the 401 mapping: on the managed path the empty account is the owner's
      // gateway balance (manual top-up only — it CAN hit zero), never the user's.
      return usingManagedKey
        ? { status: 502, message: `The managed-access ${provider} account is out of balance — contact the app owner` }
        : { status: 402, message: `Your ${provider} account balance is insufficient — top up in the provider's console` };
    }
    if (s === 403) return { status: 502, message: 'The API key lacks permission for this model' };
    if (s === 404) return { status: 502, message: `Model not found at ${provider}` };
    if (s === 413) return { status: 502, message: `Request too large for the ${provider} API` };
    if (s === 529 || s >= 500) return { status: 502, message: `The ${provider} API is overloaded or unavailable — try again shortly` };
    return { status: 502, message: `Unexpected error from the ${provider} API` };
  }
  return { status: 502, message: `Unexpected error while calling the ${provider} API` };
}

function isChatMessage(m: unknown): m is ChatMessage {
  if (typeof m !== 'object' || m === null) return false;
  const msg = m as Record<string, unknown>;
  return (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Appended (transiently, server-side — the client transcript is never mutated)
 * to the last user turn for providers flagged revealReminder: weaker
 * instruction-followers drift on the reveal discipline over a long encounter,
 * and a reminder adjacent to the newest turn holds better than one buried in
 * the system prompt. Spoiler-free by construction: it restates the golden
 * rules and names no case content.
 */
const REVEAL_REMINDER =
  '\n\n[Automatic per-turn reminder to the examiner — never mention or quote this note: reveal findings ONLY for manoeuvres or questions the candidate has actually performed or asked this encounter; never name, hint at, or confirm the diagnosis, the answer key, or model answers before the candidate commits to their presentation and diagnosis; stay strictly in the role for this encounter type; keep your turn short and examiner-like.]';

/** Per-provider request shaping (derived from PROVIDER_CONFIG, never the client). */
interface CallOpts {
  revealReminder: boolean;
  forcedToolChoice: boolean;
  /** send thinking:{type:'disabled'} — for endpoints where it defaults ON */
  thinkingOff: boolean;
}

function thinkingParam(opts: CallOpts): { thinking?: { type: 'disabled' } } {
  return opts.thinkingOff ? { thinking: { type: 'disabled' } } : {};
}

/**
 * INTERNAL action results: the client payload plus `lastResponseId` — the id
 * of the LAST upstream response of the call (chat loops tools, so the final
 * iteration's id; marking is a single call). It is the settlement idempotency
 * key for the managed meter and MUST be stripped before NextResponse.json:
 * the wire shapes (ExaminerChatResponse / ExaminerMarkResponse) are unchanged,
 * so the handler builds each response body as an explicit object — never a
 * spread of these.
 */
type ChatResult = ExaminerChatResponse & { lastResponseId: string | null };
type MarkResult = ExaminerMarkResponse & { lastResponseId: string | null };

async function runChat(
  client: Anthropic,
  model: string,
  system: string | TextBlockParam[],
  transcript: ChatMessage[],
  images: CaseImage[],
  opts: CallOpts
): Promise<ChatResult | { error: string; status: number }> {
  const messages: MessageParam[] = transcript.map((m) => ({ role: m.role, content: m.content }));
  const last = messages[messages.length - 1];
  if (opts.revealReminder && last && last.role === 'user' && typeof last.content === 'string') {
    last.content += REVEAL_REMINDER;
  }
  const usage = emptyUsage();
  const textParts: string[] = [];
  let kbLookups = 0;

  const call = () =>
    client.messages.create({
      model,
      max_tokens: 1500,
      system,
      messages,
      tools: [SEARCH_KB_TOOL],
      ...thinkingParam(opts),
    });

  let response = await call();
  accumulateUsage(usage, response.usage);
  for (const block of response.content) {
    if (block.type === 'text' && block.text) textParts.push(block.text);
  }

  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });
    const results: ToolResultBlockParam[] = toolUses.map((tu) => {
      let resultText = 'Unknown tool.';
      if (tu.name === 'search_kb') {
        kbLookups++;
        const q = (tu.input as { query?: unknown } | null)?.query;
        // slugs stay server-side (invariant 4) — only .text goes to the model.
        resultText = searchKb(typeof q === 'string' ? q : '').text;
      }
      return { type: 'tool_result', tool_use_id: tu.id, content: resultText };
    });
    messages.push({ role: 'user', content: results });

    response = await call();
    accumulateUsage(usage, response.usage);
    for (const block of response.content) {
      if (block.type === 'text' && block.text) textParts.push(block.text);
    }
  }

  const raw = textParts.join('\n\n').trim();
  // Resolve any {{IMG:id}} markers into revealed photos and strip them from the
  // shown text. Runs before the empty check so a marker-only reply still counts
  // as empty (nothing for the candidate to read).
  const { text: reply, images: revealed } = extractRevealedImages(raw, images);
  if (!reply) {
    // Tool-loop exhaustion or a max_tokens cut inside a tool_use block can end
    // with no text at all. A 200 with an empty reply would be stored in the
    // client transcript and poison every subsequent Anthropic call (empty
    // assistant content is rejected upstream) — fail loudly instead, mirroring
    // runMark, so the client keeps the transcript and offers a retry.
    return { error: 'The examiner returned no reply — try again', status: 502 };
  }
  // `response` here is the final iteration's — its id keys the settle.
  return {
    reply,
    kbLookups,
    usage,
    images: revealed.length ? revealed : undefined,
    lastResponseId: response.id,
  };
}

async function runMark(
  client: Anthropic,
  model: string,
  system: string | TextBlockParam[],
  transcript: ChatMessage[],
  meta: CaseMeta,
  opts: CallOpts
): Promise<MarkResult | { error: string; status: number }> {
  const usage = emptyUsage();
  // Marking is a single upstream call either way — its id keys the settle.
  let lastResponseId: string | null = null;
  // Raw marksheet payload, from one of two strategies. Either way it is
  // validated server-side by the shared buildMarkSheet (only the case's marked
  // skills count, each at most once; total/maxTotal recomputed, never trusted).
  let rawMarksheet: unknown;

  if (opts.forcedToolChoice) {
    // Forced tool use — the structured-output path (Anthropic, DeepSeek).
    const messages: MessageParam[] = [
      ...transcript.map((m): MessageParam => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content:
          'Please complete the marksheet for this encounter now, based strictly on the transcript so far.',
      },
    ];
    const response = await client.messages.create({
      model,
      max_tokens: 2500,
      system,
      messages,
      tools: [SUBMIT_MARKSHEET_TOOL],
      tool_choice: { type: 'tool', name: 'submit_marksheet' },
      ...thinkingParam(opts),
    });
    accumulateUsage(usage, response.usage);
    lastResponseId = response.id;
    const toolUse = response.content.find(
      (b) => b.type === 'tool_use' && b.name === 'submit_marksheet'
    );
    if (!toolUse || toolUse.type !== 'tool_use') {
      return { error: 'The examiner did not return a marksheet — try again', status: 502 };
    }
    rawMarksheet = toolUse.input;
  } else {
    // Strict-JSON path for endpoints whose tool_choice can't force a call
    // (Moonshot / MiniMax allow only auto/none) — same instruction + parsing
    // as the dev CLI bridge, shared in lib/marksheet.ts.
    const messages: MessageParam[] = [
      ...transcript.map((m): MessageParam => ({ role: m.role, content: m.content })),
      { role: 'user', content: markInstruction(meta) },
    ];
    const response = await client.messages.create({
      model,
      max_tokens: 2500,
      system,
      messages,
      ...thinkingParam(opts),
    });
    accumulateUsage(usage, response.usage);
    lastResponseId = response.id;
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    rawMarksheet = extractJson(text);
    if (rawMarksheet === null) {
      return { error: 'The examiner did not return a marksheet — try again', status: 502 };
    }
  }

  const built = buildMarkSheet(rawMarksheet, meta);
  if ('error' in built) return { error: built.error, status: 502 };

  return { marksheet: built, usage, lastResponseId };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const wantsDryRun = url.searchParams.get('dryRun') === '1';
    // Invariant 5: dry-run exists only in development. In any other env the
    // parameter 404s before anything else happens.
    if (wantsDryRun && process.env.NODE_ENV !== 'development') {
      return jsonError('Not found', 404);
    }

    let body: Partial<ExaminerRequest>;
    try {
      body = (await request.json()) as Partial<ExaminerRequest>;
    } catch {
      return jsonError('Invalid JSON body', 400);
    }

    const { caseId } = body;
    if (typeof caseId !== 'string' || !caseId) {
      return jsonError('Missing caseId', 400);
    }
    const action = body.action ?? 'chat';
    if (action !== 'chat' && action !== 'mark') {
      return jsonError("action must be 'chat' or 'mark'", 400);
    }

    // Invariant 3: manifest lookup only — never a path join from user input.
    const meta = getCaseMeta(caseId);
    if (!meta) return jsonError('Unknown caseId', 400);

    const model = body.model ?? DEFAULT_MODEL;
    // The model id doubles as the provider selector: an allowlisted model maps
    // to exactly one provider, whose baseURL comes from the fixed server-side
    // map — the client can never steer a request anywhere else.
    const provider = modelProvider(model);
    if (!provider) {
      return jsonError('Model not allowed', 400);
    }
    const providerCfg = PROVIDER_CONFIG[provider];
    const providerLabel = providerInfo(provider).label;
    // Registry id vs wire id: `model` (the registry id) stays authoritative
    // for everything server-side — allowlist, tier gate, pricing, the settle
    // ledger, error paths — while EVERY upstream messages.create sends the
    // wire id (OpenRouter registry ids are prefixed 'openrouter/…' to stay
    // unique in the registry; gateway/Anthropic ids pass through unchanged).
    const wireModel = modelWireId(model);

    // Photos available for this case (server-side map, keyed by caseCode). Only
    // sign-level captions + urls ever reach the client, and only via a reveal.
    const caseImages = getCaseImages(meta.caseCode);

    // Dev-only dry run: return the assembled system blocks without calling
    // Anthropic (no API key required — no upstream call is made).
    if (wantsDryRun) {
      const systemBlocks = buildSystem(meta, caseImages);
      const toolNames = action === 'mark' ? ['submit_marksheet'] : ['search_kb'];
      return NextResponse.json({ systemBlocks, toolNames });
    }

    // Invariant 2: a key is read from the header and passed straight to the
    // SDK constructor. It is never stored, logged, or included in any output.
    // BYOK precedence is absolute: a request carrying API_KEY_HEADER runs on
    // the user's own money — any allowlisted model, no metering, and it never
    // touches the server key. With no header key, the MANAGED door is the ONLY
    // route to the server-held gateway key, behind the full chain checked
    // below: valid signed session cookie → tier grant re-resolved live from
    // the DB → tier model gate → spend meter (after request validation). No
    // session (or managed door unconfigured) → the plain 401 "Missing API key"
    // (the client maps keyless 401s to sign-in guidance; an anonymous probe
    // learns nothing about server configuration from it).
    //
    // Dev-only exception: with the local `claude -p` subscription bridge
    // enabled (NODE_ENV=development + DEV_CLAUDE_CLI=1 — see lib/devCli.ts), a
    // keyless request FOR AN ANTHROPIC MODEL is served by the CLI instead (the
    // CLI can only run Claude). A BYOK key still takes precedence, so the real
    // API path stays testable locally.
    const byokKey = request.headers.get(API_KEY_HEADER)?.trim();
    const useDevCli = !byokKey && provider === 'anthropic' && devCliEnabled();
    let apiKey: string | null = null;
    let usingManagedKey = false;
    // Set only on the managed path — the meter's identity + allowance, carried
    // to the reserve step below (which runs after ALL request validation).
    let managed: { userId: string; allowanceUsd: number } | null = null;
    if (!useDevCli) {
      if (byokKey) {
        apiKey = byokKey;
      } else {
        // THE MANAGED PATH. Fail closed to the plain 401 when the door is not
        // fully configured OR there is no valid session — indistinguishable on
        // purpose (no config oracle pre-auth).
        const session = managedEnabled() ? await readManagedSession() : null;
        if (!session) {
          return jsonError('Missing API key', 401);
        }
        // Authorization is re-derived from the database on EVERY call — a
        // domain/override removed since sign-in revokes the session right here.
        let grant: TierGrant | null;
        try {
          grant = await resolveTier(session.email);
        } catch {
          // DB failure — fixed string only, nothing from the driver.
          return jsonError(MANAGED_UNAVAILABLE, 503);
        }
        if (!grant) {
          return jsonError(
            'Managed access is no longer available for this account — add your own API key in Settings, or contact the app owner',
            403
          );
        }
        // Tier model gate: the managed door only ever routes through the
        // gateway, and only to the tier's covered models. The common case is
        // a public-tier user selecting Sonnet — name what IS covered.
        if (provider !== 'gateway' || !TIER_MODELS[grant.tier].includes(model)) {
          return jsonError(
            `Managed access (${TIER_LABELS[grant.tier]} tier) covers ${tierModelSummary(grant.tier)} — pick one of those in Settings, or add your own API key`,
            403
          );
        }
        apiKey = managedGatewayKey();
        if (!apiKey) {
          // Config drift (managedEnabled() implies the key, but never assume):
          // fail closed with the same generic 401 as an anonymous request.
          return jsonError('Missing API key', 401);
        }
        usingManagedKey = true;
        managed = { userId: session.sub, allowanceUsd: grant.allowanceUsd };
      }
    }

    const rawMessages = body.messages;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return jsonError('messages must be a non-empty array', 400);
    }
    if (rawMessages.length > MAX_MESSAGES) {
      return jsonError(`messages must not exceed ${MAX_MESSAGES} entries`, 400);
    }
    if (!rawMessages.every(isChatMessage)) {
      return jsonError('Each message needs role "user" | "assistant" and string content', 400);
    }
    if (rawMessages.some((m) => m.content.length > MAX_MESSAGE_CHARS)) {
      return jsonError(`Each message must be at most ${MAX_MESSAGE_CHARS} characters`, 400);
    }

    const systemBlocks = buildSystem(meta, caseImages);

    if (useDevCli) {
      const result =
        action === 'chat'
          ? await runCliChat(model, systemBlocks, rawMessages, caseImages)
          : await runCliMark(model, systemBlocks, rawMessages, meta);
      if ('error' in result) return jsonError(result.error, result.status);
      return NextResponse.json(result);
    }

    // Anthropic gets the two cache_control blocks; compat providers whose docs
    // only specify the string form get one flattened string (their prompt
    // caching is automatic, so the blocks buy nothing there anyway). The '---'
    // separator (same as the dev CLI bridge) keeps the persona's "next system
    // block" reference pointing at a visible boundary before the case file.
    const system: string | TextBlockParam[] = providerCfg.systemAsString
      ? systemBlocks.map((b) => b.text).join('\n\n---\n\n')
      : systemBlocks;

    // Same SDK for every provider — only baseURL (fixed server-side map), key,
    // and auth style differ. 'bearer' sends Authorization: Bearer via
    // authToken. The unused credential option is pinned to null and baseURL is
    // always explicit: the SDK falls back to ANTHROPIC_API_KEY /
    // ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL env vars for any option left
    // undefined, and a stray env var must never inject a credential or
    // redirect traffic.
    const client =
      providerCfg.auth === 'bearer'
        ? new Anthropic({ apiKey: null, authToken: apiKey as string, baseURL: providerCfg.baseURL })
        : new Anthropic({ apiKey: apiKey as string, authToken: null, baseURL: providerCfg.baseURL });

    const callOpts: CallOpts = {
      revealReminder: providerCfg.revealReminder,
      forcedToolChoice: providerCfg.forcedToolChoice,
      thinkingOff: providerCfg.thinkingOff,
    };

    // METERING — managed path only (never BYOK, never the dev CLI, and dryRun
    // returned long ago). Reserve-then-settle (lib/managed.ts): the estimate
    // is reserved here, AFTER every request validation above, so a 400 can
    // never consume allowance. `openReservation` is the settle obligation —
    // cleared by the success settle, released uncharged by the finally on
    // every other exit. Cap refusals are pre-call: nothing was reserved, so
    // there is nothing to settle.
    // The reservation carries the exact period/day it was booked against, so
    // the settle updates the SAME meter rows even if the call crosses an SGT
    // midnight/month boundary between reserve and settle (recomputing the keys
    // at settle would strand the reservation and lose the charge).
    let openReservation: { userId: string; estUsd: number; period: string; day: string } | null =
      null;
    if (managed) {
      const estUsd = estimateCallUsd(
        model,
        action,
        rawMessages.reduce((chars, m) => chars + m.content.length, 0)
      );
      let reserved: Awaited<ReturnType<typeof reserveSpend>>;
      try {
        reserved = await reserveSpend(managed.userId, estUsd, managed.allowanceUsd);
      } catch {
        // DB failure — fixed string only, nothing from the driver.
        return jsonError(MANAGED_UNAVAILABLE, 503);
      }
      if (reserved.result === 'user_cap') {
        return jsonError(
          `You've used this month's managed allowance (US$${managed.allowanceUsd.toFixed(2)}) — it resets at the start of next month (Singapore time). Add your own API key in Settings to keep practising`,
          402
        );
      }
      if (reserved.result === 'global_cap') {
        return jsonError(
          'The app-wide daily managed budget is used up — try again tomorrow, or add your own API key in Settings',
          429
        );
      }
      openReservation = {
        userId: managed.userId,
        estUsd,
        period: reserved.period,
        day: reserved.day,
      };
    }

    /**
     * Success-path settle: move the reservation into real spend at the ACTUAL
     * cost from our own price table, keyed idempotent on the last upstream
     * response id, against the reservation's own period/day. settleSpend never
     * throws (it logs), so the meter can never turn a delivered examiner reply
     * into a user-facing error.
     */
    const settleSuccess = async (usage: TokenUsage, generationId: string | null) => {
      const reservation = openReservation;
      if (!reservation) return;
      await settleSpend(
        reservation.userId,
        reservation.estUsd,
        {
          model,
          action,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costUsd: actualCallUsd(model, usage),
          generationId,
        },
        reservation.period,
        reservation.day
      );
      openReservation = null;
    };

    try {
      // Response bodies are built as EXPLICIT objects (never a spread of the
      // internal result): the internal lastResponseId must not leak, and the
      // wire shapes ExaminerChatResponse / ExaminerMarkResponse are unchanged.
      if (action === 'chat') {
        const result = await runChat(client, wireModel, system, rawMessages, caseImages, callOpts);
        if ('error' in result) return jsonError(result.error, result.status);
        await settleSuccess(result.usage, result.lastResponseId);
        const payload: ExaminerChatResponse = {
          reply: result.reply,
          kbLookups: result.kbLookups,
          usage: result.usage,
          images: result.images,
        };
        return NextResponse.json(payload);
      }
      const result = await runMark(client, wireModel, system, rawMessages, meta, callOpts);
      if ('error' in result) return jsonError(result.error, result.status);
      await settleSuccess(result.usage, result.lastResponseId);
      const payload: ExaminerMarkResponse = { marksheet: result.marksheet, usage: result.usage };
      return NextResponse.json(payload);
    } catch (err) {
      const mapped = mapUpstreamError(err, providerLabel, usingManagedKey);
      return jsonError(mapped.message, mapped.status);
    } finally {
      // Every exit that did not settle successfully — an upstream throw, an
      // unusable-reply {error} result, even an unexpected throw while building
      // the response — releases the reservation uncharged. No path may leak a
      // reservation (it would silently eat the user's monthly allowance).
      const leftover = openReservation;
      if (leftover) {
        await settleSpend(leftover.userId, leftover.estUsd, null, leftover.period, leftover.day);
      }
    }
  } catch (err) {
    // Never log the error object (it could reference request internals);
    // return a spoiler-free message.
    return jsonError(
      err instanceof ContentError ? err.message : 'Internal server error',
      500
    );
  }
}
