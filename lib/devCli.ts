// Dev-only subscription bridge: with DEV_CLAUDE_CLI=1 in development, keyless
// /api/examiner calls are served by shelling out to the local `claude -p` CLI
// (headless Claude Code) instead of the Anthropic API — local tuning then
// draws on the developer's own claude.ai subscription quota, not API credits.
//
// Differences vs the SDK path (accepted for dev iteration; final validation
// must still run through the real API path with a key):
// - No forced tool use: marking asks for strict JSON and reuses the shared
//   validation in lib/marksheet.ts.
// - No search_kb fallback: the bridge note tells the examiner to answer from
//   the grounding notes already in the brief and flag uncertainty.
// - No prompt-caching semantics; usage numbers are notional (subscription
//   quota, not billed dollars).
//
// Security: gated to NODE_ENV === 'development' AND DEV_CLAUDE_CLI === '1'
// (same style as invariant 5's dryRun gate) — a production build never takes
// this path. The CLI runs with the developer's own logged-in Claude Code
// credentials, entirely on their machine; no key or prompt content is ever
// sent anywhere except Anthropic via the CLI itself.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type {
  CaseImage,
  CaseMeta,
  ChatMessage,
  ExaminerChatResponse,
  ExaminerMarkResponse,
  TokenUsage,
} from './types';
import { buildMarkSheet } from './marksheet';
import { extractRevealedImages } from './images';

const execFileAsync = promisify(execFile);

/** Marking can run long on bigger models; generous local ceiling. */
const CLI_TIMEOUT_MS = 240_000;
const CLI_MAX_BUFFER = 32 * 1024 * 1024;

export function devCliEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.DEV_CLAUDE_CLI === '1';
}

// ---------------------------------------------------------------------------
// Prompt shaping
// ---------------------------------------------------------------------------

const BRIDGE_NOTE = `# DEV BRIDGE NOTE
You are running through a local development bridge without tools. The search_kb tool is NOT available: for viva/debrief tangents not covered by the brief, answer carefully from the encounter brief and grounding notes above, and flag uncertainty honestly instead of inventing specifics.
The user message contains the full encounter transcript so far, with turns marked [CANDIDATE] (the human) and [EXAMINER] (you). Reply with your next examiner turn ONLY — plain text, no [EXAMINER] marker, no meta-commentary about the transcript format.`;

function joinSystem(system: TextBlockParam[]): string {
  return [...system.map((b) => b.text), BRIDGE_NOTE].join('\n\n---\n\n');
}

function serializeTranscript(transcript: ChatMessage[]): string {
  return transcript
    .map((m) => `[${m.role === 'user' ? 'CANDIDATE' : 'EXAMINER'}]: ${m.content}`)
    .join('\n\n');
}

function markInstruction(meta: CaseMeta): string {
  return `The encounter is over. Complete the marksheet now, based strictly on the transcript above and graded per the marking rubric.
Respond with ONLY a JSON object — no prose, no code fences — of exactly this shape:
{"skills":[{"skill":"A","grade":2,"justification":"..."}],"overallImpression":"...","biggestImprovement":"..."}
Rules: one "skills" entry per marked skill — this encounter marks exactly: ${meta.skills.join(', ')}. "grade" is an integer: 2 = Satisfactory, 1 = Borderline, 0 = Unsatisfactory. Every Borderline or Unsatisfactory needs a one-line justification tied to the rubric descriptors. "biggestImprovement" names the single change that would most improve the weakest skill.`;
}

// ---------------------------------------------------------------------------
// CLI invocation
// ---------------------------------------------------------------------------

interface CliOk {
  text: string;
  usage: TokenUsage;
}

async function runCli(
  model: string,
  systemPrompt: string,
  prompt: string
): Promise<CliOk | { error: string; status: number }> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--tools',
    '',
    '--no-session-persistence',
    '--system-prompt',
    systemPrompt,
  ];

  let stdout: string;
  try {
    // Prompt goes via stdin (transcripts can be large; argv is reserved for
    // the system prompt, which is bounded by BLOCK2_MAX_CHARS).
    const pending = execFileAsync('claude', args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: CLI_MAX_BUFFER,
    });
    pending.child.stdin?.end(prompt, 'utf8');
    stdout = (await pending).stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        error: 'Dev bridge: `claude` CLI not found on PATH — is Claude Code installed?',
        status: 502,
      };
    }
    // Dev-only: log to the dev server console (the developer's own terminal).
    console.error('[devCli] claude -p failed:', err instanceof Error ? err.message : err);
    return {
      error: 'Dev bridge: the claude CLI call failed — see the dev server console',
      status: 502,
    };
  }

  let parsed: {
    is_error?: unknown;
    subtype?: unknown;
    result?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return { error: 'Dev bridge: could not parse claude CLI output', status: 502 };
  }
  if (parsed.is_error === true || parsed.subtype !== 'success' || typeof parsed.result !== 'string') {
    console.error('[devCli] claude -p returned an error result (subtype:', parsed.subtype, ')');
    return { error: 'Dev bridge: the claude CLI returned an error — see the dev server console', status: 502 };
  }

  return {
    text: parsed.result,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Actions (mirror runChat / runMark in app/api/examiner/route.ts)
// ---------------------------------------------------------------------------

export async function runCliChat(
  model: string,
  system: TextBlockParam[],
  transcript: ChatMessage[],
  images: CaseImage[]
): Promise<ExaminerChatResponse | { error: string; status: number }> {
  const result = await runCli(model, joinSystem(system), serializeTranscript(transcript));
  if ('error' in result) return result;
  // Same {{IMG:id}} reveal handling as the Anthropic path (findings-gated).
  const { text: reply, images: revealed } = extractRevealedImages(result.text.trim(), images);
  if (!reply) {
    return { error: 'The examiner returned no reply — try again', status: 502 };
  }
  return { reply, kbLookups: 0, usage: result.usage, images: revealed.length ? revealed : undefined };
}

/** Pull the outermost JSON object out of a possibly fenced / prefixed reply. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function runCliMark(
  model: string,
  system: TextBlockParam[],
  transcript: ChatMessage[],
  meta: CaseMeta
): Promise<ExaminerMarkResponse | { error: string; status: number }> {
  const prompt = `${serializeTranscript(transcript)}\n\n${markInstruction(meta)}`;
  const result = await runCli(model, joinSystem(system), prompt);
  if ('error' in result) return result;

  const parsed = extractJson(result.text);
  if (parsed === null) {
    return { error: 'The examiner did not return a marksheet — try again', status: 502 };
  }
  const built = buildMarkSheet(parsed, meta);
  if ('error' in built) return { error: built.error, status: 502 };
  return { marksheet: built, usage: result.usage };
}
