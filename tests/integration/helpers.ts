import { execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const CLASSIFICATION_PATTERN = /devflow:\s*(CHAT|EXPLORE|PLAN|IMPLEMENT|DEBUG|REVIEW|RESOLVE|PIPELINE)\s*\/\s*(QUICK|GUIDED|ORCHESTRATED)/i;

/**
 * Check if the `claude` CLI is available on this machine.
 */
export function isClaudeAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read classification-rules.md from disk.
 * Simulates SessionStart injection for integration tests.
 */
function loadRouterContext(): string {
  const rulesPath = resolve(import.meta.dirname, '../../shared/skills/router/classification-rules.md');
  return readFileSync(rulesPath, 'utf-8').trim();
}

// Simulates SessionStart injection (classification rules) + per-message preamble
const DEVFLOW_PREAMBLE = loadRouterContext() +
  '\nClassify this request\'s intent and depth. If GUIDED or ORCHESTRATED, load devflow:router via Skill tool.';

/** Result from a streaming claude invocation */
export interface StreamResult {
  /** Skill tool invocations detected (skill names) */
  skills: string[];
  /** Text fragments captured from assistant messages */
  textFragments: string[];
  /** Whether the process completed or was killed */
  killedEarly: boolean;
  /** Duration in ms */
  durationMs: number;
}

/**
 * Run a prompt through claude CLI with stream-json output.
 *
 * Reads events line-by-line as they stream. Resolves as soon as we detect
 * Skill tool invocations OR the timeout expires. Kills the process immediately
 * after detection — no waiting for completion.
 *
 * Uses --allowedTools Skill so the Skill tool actually executes (appears as tool_use events).
 */
export function runClaudeStreaming(
  prompt: string,
  options?: { timeout?: number; model?: string; allowedTools?: string; systemPrompt?: string | false },
): Promise<StreamResult> {
  const timeout = options?.timeout ?? 45000;
  const model = options?.model ?? 'haiku';
  const allowedTools = options?.allowedTools ?? 'Skill';
  const systemPrompt = options?.systemPrompt !== undefined ? options.systemPrompt : DEVFLOW_PREAMBLE;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const skills: string[] = [];
    const textFragments: string[] = [];
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const args = [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--model', model,
      '--allowedTools', allowedTools,
      ...(systemPrompt !== false ? ['--append-system-prompt', systemPrompt] : []),
      prompt,
    ];

    const proc: ChildProcess = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';

    const finish = (killedEarly: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      resolve({
        skills: [...new Set(skills)],
        textFragments,
        killedEarly,
        durationMs: Date.now() - startTime,
      });
    };

    // Safety timeout
    const timer = setTimeout(() => finish(true), timeout);

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event: unknown = JSON.parse(line);

          // Detect Skill tool_use in assistant messages
          if (
            typeof event === 'object' && event !== null &&
            (event as Record<string, unknown>).type === 'assistant' &&
            Array.isArray((event as Record<string, unknown>).message?.content)
          ) {
            const msg = event as { type: string; message: { content: Record<string, unknown>[] } };
            for (const block of msg.message.content) {
              // tool_use block for Skill
              if (block.type === 'tool_use' && block.name === 'Skill' && typeof (block.input as Record<string, unknown>)?.skill === 'string') {
                skills.push((block.input as Record<string, unknown>).skill as string);
              }
              // text block — capture for classification detection
              if (block.type === 'text' && typeof block.text === 'string') {
                textFragments.push(block.text);
              }
            }

            // Once we have skills, give a brief window for more, then finish
            if (skills.length > 0 && !graceTimer) {
              graceTimer = setTimeout(() => {
                finish(true);
              }, 8000); // 8s grace for additional skill loads after first detection
            }
          }

        } catch {
          // Partial JSON line, skip
        }
      }
    });

    proc.on('close', () => {
      clearTimeout(timer);
      finish(false);
    });

    proc.on('error', () => {
      clearTimeout(timer);
      finish(true);
    });
  });
}

/**
 * Run a prompt with single-shot model fallback.
 *
 * One attempt with Haiku. If predicate fails, one attempt with Sonnet.
 * No retries — if the prompt doesn't work first try, the prompt needs fixing.
 */
export async function runClaudeStreamingWithRetry(
  prompt: string,
  predicate: (result: StreamResult) => boolean,
  options?: { timeout?: number; model?: string },
): Promise<{ result: StreamResult; attempts: number; passed: boolean; model: string }> {
  const timeout = options?.timeout ?? 45000;
  const primaryModel = options?.model ?? 'haiku';

  // Single shot with primary model
  const primaryResult = await runClaudeStreaming(prompt, { timeout, model: primaryModel });
  if (predicate(primaryResult)) {
    return { result: primaryResult, attempts: 1, passed: true, model: primaryModel };
  }

  // Single shot fallback to sonnet
  if (primaryModel === 'haiku') {
    const fallbackResult = await runClaudeStreaming(prompt, { timeout, model: 'sonnet' });
    if (predicate(fallbackResult)) {
      return { result: fallbackResult, attempts: 2, passed: true, model: 'sonnet' };
    }
    return { result: fallbackResult, attempts: 2, passed: false, model: 'sonnet' };
  }

  return { result: primaryResult, attempts: 1, passed: false, model: primaryModel };
}

// --- Detection helpers ---

export function hasSkillInvocations(result: StreamResult): boolean {
  return result.skills.length > 0;
}

export function getSkillInvocations(result: StreamResult): string[] {
  return result.skills;
}

export function hasClassification(result: StreamResult): boolean {
  const text = result.textFragments.join(' ');
  return CLASSIFICATION_PATTERN.test(text);
}

export function extractIntent(result: StreamResult): string | null {
  const text = result.textFragments.join(' ');
  const match = text.match(CLASSIFICATION_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

export function extractDepth(result: StreamResult): string | null {
  const text = result.textFragments.join(' ');
  const match = text.match(CLASSIFICATION_PATTERN);
  return match ? match[2].toUpperCase() : null;
}

/**
 * Check whether the result contains a Devflow classification tag.
 *
 * @see hasClassification — functionally identical after both helpers were
 * unified on {@link CLASSIFICATION_PATTERN}. Kept as a distinct export so
 * existing test assertions that describe "branding presence" (vs. "a
 * classification exists") remain self-documenting at the call site.
 */
export function hasDevFlowBranding(result: StreamResult): boolean {
  const text = result.textFragments.join(' ');
  return CLASSIFICATION_PATTERN.test(text);
}

/**
 * Check if required skills are present in the result.
 * Uses bounded matching: exact match, namespace-suffixed, or devflow-prefixed.
 */
export function hasRequiredSkills(result: StreamResult, required: string[]): boolean {
  return required.every((name) =>
    result.skills.some((s) => s === name || s.endsWith(`:${name}`) || s === `devflow:${name}`),
  );
}

/**
 * Run a prompt through claude CLI and wait for completion. No early-exit logic —
 * just spawns the process and resolves when it exits. Used for subagent tests
 * where we need the process to finish so transcripts are written to disk.
 */
export function runClaudeAndWait(
  prompt: string,
  options?: { timeout?: number; model?: string; allowedTools?: string },
): Promise<{ durationMs: number; exitCode: number | null }> {
  const timeout = options?.timeout ?? 45000;
  const model = options?.model ?? 'haiku';
  const allowedTools = options?.allowedTools ?? 'Agent';

  return new Promise((resolve) => {
    const startTime = Date.now();

    const proc = spawn('claude', [
      '-p', '--model', model,
      '--allowedTools', allowedTools,
      '--dangerously-skip-permissions',
      prompt,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      resolve({ durationMs: Date.now() - startTime, exitCode: null });
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ durationMs: Date.now() - startTime, exitCode: code });
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ durationMs: Date.now() - startTime, exitCode: null });
    });
  });
}

// COUPLING: depends on Claude Code's internal transcript layout:
//   ~/.claude/projects/-{encoded-project-path}/{sessionId}/subagents/agent-{agentId}.jsonl
// Each JSONL line is a streaming event; the first user message contains <command-name>
// tags listing preloaded skills. If Claude Code changes this format, these helpers
// return empty arrays (graceful degradation via catch).

/** Max session directories to scan. Transcripts are in recent sessions only. */
const SESSION_SCAN_LIMIT = 20;

/**
 * Walk the project directory and collect subagent transcript paths written at or
 * after `since`. Only the most recent {@link SESSION_SCAN_LIMIT} session directories
 * are examined to keep this fast on machines with many sessions.
 */
function findRecentSubagentTranscripts(
  projectDir: string,
  since: Date,
): Array<{ path: string; mtime: Date }> {
  const sessionEntries = readdirSync(projectDir)
    .map((d) => {
      const full = resolve(projectDir, d);
      try {
        const s = statSync(full);
        return s.isDirectory() ? { path: full, mtime: s.mtime } : null;
      } catch {
        return null;
      }
    })
    .filter((e): e is { path: string; mtime: Date } => e !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, SESSION_SCAN_LIMIT);

  const transcripts: Array<{ path: string; mtime: Date }> = [];
  for (const session of sessionEntries) {
    const subagentsDir = resolve(session.path, 'subagents');
    try {
      const files = readdirSync(subagentsDir).filter(
        (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
      );
      for (const file of files) {
        const filePath = resolve(subagentsDir, file);
        const stat = statSync(filePath);
        if (stat.mtime >= since) {
          transcripts.push({ path: filePath, mtime: stat.mtime });
        }
      }
    } catch {
      // No subagents dir in this session — skip
    }
  }
  return transcripts;
}

/**
 * Read a subagent transcript and return the skill names declared in the first
 * user message via `<command-name>` tags. The `devflow:` namespace prefix is
 * stripped for consistency with test assertions.
 */
function parsePreloadedSkills(transcriptPath: string): string[] {
  const content = readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const skills: string[] = [];

  for (const line of lines) {
    try {
      const event: unknown = JSON.parse(line);
      if (typeof event !== 'object' || event === null) continue;
      const e = event as Record<string, unknown>;
      // Skills are injected as isMeta user messages with <command-name> tags.
      // Skills appear only at the top, before any assistant turn.
      if (e.type !== 'user') break;

      const text =
        typeof e.message === 'string'
          ? e.message
          : JSON.stringify((e.message as Record<string, unknown>)?.content ?? e.content ?? '');
      for (const m of text.matchAll(/<command-name>([\w:/-]+)<\/command-name>/g)) {
        skills.push(m[1].replace(/^devflow:/, ''));
      }
    } catch {
      // Malformed line — skip
    }
  }
  return skills;
}

/**
 * Find the most recent subagent transcript written at or after `since` and
 * return the preloaded skill names from its initial user message.
 *
 * Returns an empty array if no transcript is found or the directory structure
 * has changed (graceful degradation).
 */
export function getLatestSubagentPreloadedSkills(since: Date): string[] {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const cwd = process.cwd();
  // Claude Code encodes the project path by replacing / with -
  const encodedPath = '-' + cwd.replace(/\//g, '-').replace(/^-/, '');
  const projectDir = resolve(homeDir, '.claude', 'projects', encodedPath);

  try {
    const transcripts = findRecentSubagentTranscripts(projectDir, since);
    if (transcripts.length === 0) return [];

    // Most recent transcript first
    transcripts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return parsePreloadedSkills(transcripts[0].path);
  } catch {
    // Project dir doesn't exist or structure changed — return empty gracefully
    return [];
  }
}
