// POST /api/examiner — the AI-examiner backend.
//
// Security invariants enforced here:
// - The user's API key (API_KEY_HEADER) goes straight into the Anthropic SDK
//   constructor. It is never stored, logged, or echoed (invariant 2).
// - Error payloads are spoiler-free: upstream Anthropic errors are mapped to
//   fixed generic strings; assembled prompts never appear in errors (invariant 1).
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
  MODEL_ALLOWLIST,
  type ApiError,
  type CaseMeta,
  type ChatMessage,
  type ExaminerChatResponse,
  type ExaminerMarkResponse,
  type ExaminerRequest,
  type Grade,
  type MarkSheet,
  type SkillId,
  type SkillMark,
  type TokenUsage,
} from '@/lib/types';
import { ContentError, getCaseMeta } from '@/lib/content';
import { buildSystem } from '@/lib/prompt';
import { searchKb } from '@/lib/kb';

export const runtime = 'nodejs';
// Claude calls (especially marking) can run well past Vercel's default function
// timeout; without this the platform kills the request mid-generation.
export const maxDuration = 60;

const MAX_MESSAGES = 400;
const MAX_MESSAGE_CHARS = 30_000;
const MAX_TOOL_ITERATIONS = 3;

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
 * Map upstream Anthropic errors to spoiler-free client payloads. SDK error
 * messages are never forwarded (they could quote request content); every
 * branch returns a fixed generic string. Nothing is logged (invariant 2).
 */
function mapAnthropicError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: 'Invalid API key' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Rate limited by Anthropic' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: 'Could not reach the Anthropic API' };
  }
  if (err instanceof Anthropic.APIError) {
    const s = typeof err.status === 'number' ? err.status : 0;
    if (s === 400) return { status: 502, message: 'Anthropic rejected the request as invalid' };
    if (s === 403) return { status: 502, message: 'The API key lacks permission for this model' };
    if (s === 404) return { status: 502, message: 'Model not found at Anthropic' };
    if (s === 413) return { status: 502, message: 'Request too large for the Anthropic API' };
    if (s === 529 || s >= 500) return { status: 502, message: 'The Anthropic API is overloaded or unavailable — try again shortly' };
    return { status: 502, message: 'Unexpected error from the Anthropic API' };
  }
  return { status: 502, message: 'Unexpected error while calling the Anthropic API' };
}

function isChatMessage(m: unknown): m is ChatMessage {
  if (typeof m !== 'object' || m === null) return false;
  const msg = m as Record<string, unknown>;
  return (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function runChat(
  client: Anthropic,
  model: string,
  system: TextBlockParam[],
  transcript: ChatMessage[]
): Promise<ExaminerChatResponse | { error: string; status: number }> {
  const messages: MessageParam[] = transcript.map((m) => ({ role: m.role, content: m.content }));
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

  const reply = textParts.join('\n\n').trim();
  if (!reply) {
    // Tool-loop exhaustion or a max_tokens cut inside a tool_use block can end
    // with no text at all. A 200 with an empty reply would be stored in the
    // client transcript and poison every subsequent Anthropic call (empty
    // assistant content is rejected upstream) — fail loudly instead, mirroring
    // runMark, so the client keeps the transcript and offers a retry.
    return { error: 'The examiner returned no reply — try again', status: 502 };
  }
  return { reply, kbLookups, usage };
}

async function runMark(
  client: Anthropic,
  model: string,
  system: TextBlockParam[],
  transcript: ChatMessage[],
  meta: CaseMeta
): Promise<ExaminerMarkResponse | { error: string; status: number }> {
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
  });

  const usage = emptyUsage();
  accumulateUsage(usage, response.usage);

  const toolUse = response.content.find(
    (b) => b.type === 'tool_use' && b.name === 'submit_marksheet'
  );
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { error: 'The examiner did not return a marksheet — try again', status: 502 };
  }

  const input = toolUse.input as {
    skills?: unknown;
    overallImpression?: unknown;
    biggestImprovement?: unknown;
  };

  // Validate server-side: only the case's marked skills count, each at most
  // once; total/maxTotal are recomputed, never trusted from the model.
  const allowed = new Set<SkillId>(meta.skills);
  const seen = new Set<SkillId>();
  const skills: SkillMark[] = [];
  if (Array.isArray(input.skills)) {
    for (const raw of input.skills) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as { skill?: unknown; grade?: unknown; justification?: unknown };
      const skill = entry.skill as SkillId;
      if (!allowed.has(skill) || seen.has(skill)) continue;
      const grade = entry.grade;
      if (grade !== 0 && grade !== 1 && grade !== 2) continue;
      seen.add(skill);
      skills.push({
        skill,
        grade: grade as Grade,
        justification: typeof entry.justification === 'string' ? entry.justification : '',
      });
    }
  }
  if (skills.length === 0) {
    return { error: 'The examiner returned an empty marksheet — try again', status: 502 };
  }
  if (skills.length !== meta.skills.length) {
    // Every marked skill must have a graded, justified row — a partial
    // marksheet would silently zero the missing skills in the total.
    return { error: 'The examiner returned an incomplete marksheet — try again', status: 502 };
  }

  const marksheet: MarkSheet = {
    skills,
    total: skills.reduce((sum, s) => sum + s.grade, 0),
    maxTotal: meta.skills.length * 2,
    overallImpression:
      typeof input.overallImpression === 'string' ? input.overallImpression : '',
    biggestImprovement:
      typeof input.biggestImprovement === 'string' ? input.biggestImprovement : '',
  };

  return { marksheet, usage };
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
    if (!(MODEL_ALLOWLIST as readonly string[]).includes(model)) {
      return jsonError('Model not allowed', 400);
    }

    // Dev-only dry run: return the assembled system blocks without calling
    // Anthropic (no API key required — no upstream call is made).
    if (wantsDryRun) {
      const systemBlocks = buildSystem(meta);
      const toolNames = action === 'mark' ? ['submit_marksheet'] : ['search_kb'];
      return NextResponse.json({ systemBlocks, toolNames });
    }

    // Invariant 2: the key is read from the header and passed straight to the
    // SDK constructor. It is never stored, logged, or included in any output.
    const apiKey = request.headers.get(API_KEY_HEADER)?.trim();
    if (!apiKey) {
      return jsonError('Missing API key', 401);
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

    const system = buildSystem(meta);
    const client = new Anthropic({ apiKey });

    try {
      if (action === 'chat') {
        const result = await runChat(client, model, system, rawMessages);
        if ('error' in result) return jsonError(result.error, result.status);
        return NextResponse.json(result);
      }
      const result = await runMark(client, model, system, rawMessages, meta);
      if ('error' in result) return jsonError(result.error, result.status);
      return NextResponse.json(result);
    } catch (err) {
      const mapped = mapAnthropicError(err);
      return jsonError(mapped.message, mapped.status);
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
