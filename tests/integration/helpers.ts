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
  const rulesPath = resolve(import.meta.dirname, '../../shared/skills/router/references/classification-rules.md');
  return readFileSync(rulesPath, 'utf-8').trim();
}

// Simulates SessionStart injection (classification rules) + per-message preamble
const DEVFLOW_PREAMBLE = loadRouterContext() +
  '\nClassify this request\'s intent and depth, then load devflow:router via Skill tool.';

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
  options?: { timeout?: number; model?: string },
): Promise<StreamResult> {
  const timeout = options?.timeout ?? 45000;
  const model = options?.model ?? 'haiku';

  return new Promise((resolve) => {
    const startTime = Date.now();
    const skills: string[] = [];
    const textFragments: string[] = [];
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const args = [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--model', model,
      '--allowedTools', 'Skill',
      '--append-system-prompt', DEVFLOW_PREAMBLE,
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
 * Find the most recent subagent transcript written after `since` and return
 * the set of preloaded skill names (parsed from <command-name> tags in the
 * initial user message).
 *
 * Claude Code writes subagent transcripts to:
 *   ~/.claude/projects/-{encoded-project-path}/{sessionId}/subagents/agent-{agentId}.jsonl
 *
 * Returns an empty array if no transcript is found or the structure changes.
 */
export function getLatestSubagentPreloadedSkills(since: Date): string[] {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const cwd = process.cwd();
  // Claude Code encodes the project path by replacing / with -
  const encodedPath = '-' + cwd.replace(/\//g, '-').replace(/^-/, '');
  const projectDir = resolve(homeDir, '.claude', 'projects', encodedPath);

  try {
    // Walk sessionId directories
    const sessionDirs = readdirSync(projectDir)
      .map(d => resolve(projectDir, d))
      .filter(d => {
        try { return statSync(d).isDirectory(); } catch { return false; }
      });

    // Collect all subagent transcript files newer than `since`
    const transcripts: Array<{ path: string; mtime: Date }> = [];
    for (const sessionDir of sessionDirs) {
      const subagentsDir = resolve(sessionDir, 'subagents');
      try {
        const files = readdirSync(subagentsDir).filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));
        for (const file of files) {
          const filePath = resolve(subagentsDir, file);
          const stat = statSync(filePath);
          if (stat.mtime > since) {
            transcripts.push({ path: filePath, mtime: stat.mtime });
          }
        }
      } catch {
        // No subagents dir in this session — skip
      }
    }

    if (transcripts.length === 0) return [];

    // Sort by mtime descending — most recent first
    transcripts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Parse the most recent transcript for preloaded skills
    const content = readFileSync(transcripts[0].path, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    // Find the first user message (contains preloaded skills)
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'user' || (event.role === 'user')) {
          // Extract skill names from <command-name> tags
          const text = typeof event.message === 'string'
            ? event.message
            : JSON.stringify(event.message?.content ?? event.content ?? '');
          const skillMatches = text.matchAll(/<command-name>([\w:/-]+)<\/command-name>/g);
          return [...skillMatches].map(m => {
            const name = m[1];
            // Strip devflow: prefix for consistency with test assertions
            return name.replace(/^devflow:/, '');
          });
        }
      } catch {
        // Malformed line — skip
      }
    }

    return [];
  } catch {
    // Project dir doesn't exist or structure changed — return empty gracefully
    return [];
  }
}
