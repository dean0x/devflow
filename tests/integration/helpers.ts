import { execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

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

/** Parsed fields from a single streaming event */
export interface ParsedStreamEvent {
  skills: string[];
  textFragments: string[];
}

/**
 * Extract skill invocations and text fragments from a single streaming event.
 * Only processes assistant messages with content arrays.
 */
export function parseStreamEvent(event: unknown): ParsedStreamEvent {
  const skills: string[] = [];
  const textFragments: string[] = [];

  if (
    typeof event !== 'object' || event === null ||
    (event as Record<string, unknown>).type !== 'assistant' ||
    !Array.isArray((event as { message?: { content?: unknown } }).message?.content)
  ) {
    return { skills, textFragments };
  }

  const msg = event as { type: string; message: { content: Record<string, unknown>[] } };
  for (const block of msg.message.content) {
    if (block.type === 'tool_use' && block.name === 'Skill' && typeof (block.input as Record<string, unknown>)?.skill === 'string') {
      skills.push((block.input as Record<string, unknown>).skill as string);
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      textFragments.push(block.text as string);
    }
  }

  return { skills, textFragments };
}

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
  const systemPrompt = options?.systemPrompt !== undefined ? options.systemPrompt : false;

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
          const parsed = parseStreamEvent(event);
          skills.push(...parsed.skills);
          textFragments.push(...parsed.textFragments);

          // Once we have skills, give a brief window for more, then finish
          if (skills.length > 0 && !graceTimer) {
            graceTimer = setTimeout(() => finish(true), 8000);
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

// --- Detection helpers ---

export function hasSkillInvocations(result: StreamResult): boolean {
  return result.skills.length > 0;
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
 *
 * D33 — session-scoped transcript filtering: captures the sessionId via a
 * directory-diff snapshot rather than --output-format json. The diff approach
 * works even when the process is killed by the timeout: the session directory
 * is created at session start (before any work begins), so it is always present
 * by the time the close/timeout handler runs. This avoids the brittle requirement
 * that the process exit normally to produce JSON output.
 *
 * If exactly one new UUID session directory appears, it is ours. If multiple
 * appear (concurrent background agents), the most-recently-modified one is
 * returned as a best-effort heuristic; in sequential test runs this is correct.
 */
export function runClaudeAndWait(
  prompt: string,
  options?: { timeout?: number; model?: string; allowedTools?: string },
): Promise<{ durationMs: number; exitCode: number | null; sessionId: string | null }> {
  const timeout = options?.timeout ?? 45000;
  const model = options?.model ?? 'haiku';
  const allowedTools = options?.allowedTools ?? 'Agent';

  // Snapshot existing session directories before spawning (D33).
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const cwdPath = process.cwd();
  const encodedPath = '-' + cwdPath.replace(/\//g, '-').replace(/^-/, '');
  const projectDir = resolve(homeDir, '.claude', 'projects', encodedPath);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  let existingDirs: Set<string>;
  try {
    existingDirs = new Set(readdirSync(projectDir).filter((d) => uuidRe.test(d)));
  } catch {
    existingDirs = new Set();
  }

  /**
   * Find the session directory created by OUR spawn (D33). Called after close or
   * timeout so the directory is guaranteed to exist if claude started successfully.
   */
  const findSessionId = (): string | null => {
    try {
      const newDirs = readdirSync(projectDir).filter((d) => uuidRe.test(d) && !existingDirs.has(d));
      if (newDirs.length === 0) return null;
      if (newDirs.length === 1) return newDirs[0] ?? null;
      // Multiple new dirs — concurrent background sessions. Pick most recently
      // modified (our spawn is most recent relative to pre-spawn snapshot).
      const withMtime = newDirs.map((d) => {
        try {
          return { d, mtime: statSync(resolve(projectDir, d)).mtimeMs };
        } catch {
          return { d, mtime: 0 };
        }
      });
      withMtime.sort((a, b) => b.mtime - a.mtime);
      return withMtime[0]?.d ?? null;
    } catch {
      return null;
    }
  };

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
      // Wait 3 s after SIGTERM: the spawned subagent runs independently and may
      // still be writing its initialization transcript (skill preloads appear in
      // the first JSONL lines). Resolving immediately races with that write and
      // produces [[]] in getSessionSubagentPreloadedSkills (D33 timing fix).
      setTimeout(() => {
        resolve({ durationMs: Date.now() - startTime, exitCode: null, sessionId: findSessionId() });
      }, 3000);
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ durationMs: Date.now() - startTime, exitCode: code, sessionId: findSessionId() });
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ durationMs: Date.now() - startTime, exitCode: null, sessionId: findSessionId() });
    });
  });
}

// COUPLING: depends on Claude Code's internal transcript layout:
//   ~/.claude/projects/-{encoded-project-path}/{sessionId}/subagents/agent-{agentId}.jsonl
// Each JSONL line is a streaming event; the first user message contains <command-name>
// tags listing preloaded skills. If Claude Code changes this format, these helpers
// return empty arrays (graceful degradation via catch).

/** A parsed subagent transcript record with preloaded skill names. */
export interface TranscriptRecord {
  /** Absolute path to the agent-*.jsonl file. */
  path: string;
  /** The session ID extracted from the transcript's parent directory name. */
  sessionId: string;
  /** Skill names preloaded via <command-name> tags in the first user message. */
  preloadedSkills: string[];
}

/**
 * Pure selector — returns only the records whose sessionId matches the target.
 *
 * Extracted as an injectable function so it can be unit-tested with synthetic
 * fixture data without touching the filesystem (per PF-043 shape requirement).
 *
 * D33 — session-scoped transcript filtering: the unfiltered scan over all
 * recent sessions was nondeterministic when concurrent agents ran in the same
 * cwd (observed in CI when the pipeline's Code/Validate agents contaminated
 * the Simplify preload assertion). Scoping to the spawned session ID fixes
 * the isolation defect.
 */
export function selectTranscriptsBySession(
  records: TranscriptRecord[],
  sessionId: string,
): TranscriptRecord[] {
  return records.filter((r) => r.sessionId === sessionId);
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
 * Return all subagent transcripts from a specific session directory and parse
 * the preloaded skill names from each transcript's initial user message.
 *
 * Scoped to the exact sessionId returned by runClaudeAndWait, so concurrent
 * agents in the same cwd cannot contaminate the result (D33). The mtime bound
 * used by getAllSubagentPreloadedSkills is intentionally absent: session scoping
 * makes time-based bounding dead weight (ADR-003 — end-state, no belt-and-braces
 * residue without a reason).
 *
 * Returns an empty array if no transcripts are found or the directory structure
 * has changed (graceful degradation).
 */
export function getSessionSubagentPreloadedSkills(sessionId: string): string[][] {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const cwd = process.cwd();
  // Claude Code encodes the project path by replacing / with -
  const encodedPath = '-' + cwd.replace(/\//g, '-').replace(/^-/, '');
  const subagentsDir = resolve(homeDir, '.claude', 'projects', encodedPath, sessionId, 'subagents');

  try {
    const files = readdirSync(subagentsDir).filter(
      (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
    );
    return files.map((file) => parsePreloadedSkills(resolve(subagentsDir, file)));
  } catch {
    // Session directory doesn't exist or structure changed — return empty gracefully
    return [];
  }
}

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
    .filter((d) => !d.endsWith('.jsonl'))
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
 * Find all subagent transcripts written at or after `since` and return the
 * preloaded skill names from each transcript's initial user message.
 *
 * Returns one string[] per transcript. The caller can assert that at least one
 * transcript contains the expected skills — this avoids a race condition where
 * Claude spawns auxiliary subagents (e.g., Git) alongside the target agent,
 * and the auxiliary transcript has a later mtime.
 *
 * Returns an empty array if no transcripts are found or the directory structure
 * has changed (graceful degradation).
 *
 * @deprecated Use getSessionSubagentPreloadedSkills(sessionId) instead — it is
 *   hermetically scoped to the spawned session (D33). This function remains for
 *   reference; nothing in the test suite imports it after the D33 fix.
 */
export function getAllSubagentPreloadedSkills(since: Date): string[][] {
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
    return transcripts.map((t) => parsePreloadedSkills(t.path));
  } catch {
    // Project dir doesn't exist or structure changed — return empty gracefully
    return [];
  }
}
