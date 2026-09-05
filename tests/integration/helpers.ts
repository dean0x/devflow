import { execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

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

// ---------------------------------------------------------------------------
// Session path helpers
// ---------------------------------------------------------------------------

/**
 * Build the absolute path to the `subagents/` directory for a given session.
 *
 * Pure function — no filesystem access — so it can be unit-tested in isolation
 * (PF-043 shape requirement). The encoding mirrors Claude Code's own layout:
 *   ~/.claude/projects/-{encoded-cwd}/{sessionId}/subagents/
 * where the cwd encoding replaces every '/' with '-' and ensures a leading '-'.
 */
export function buildSubagentsPath(homeDir: string, cwd: string, sessionId: string): string {
  const encodedPath = '-' + cwd.replace(/\//g, '-').replace(/^-/, '');
  return resolve(homeDir, '.claude', 'projects', encodedPath, sessionId, 'subagents');
}

// ---------------------------------------------------------------------------
// Preload outcome classification
// ---------------------------------------------------------------------------

/**
 * Outcome of a subagent preload lookup:
 *  - 'no-session-dir': the subagents/ directory does not exist → parent spawned no subagent
 *  - 'no-transcripts': directory exists but holds no agent-*.jsonl files
 *  - 'ok': one or more transcripts found; `transcripts` carries the parsed skill lists
 */
export type SubagentPreloadResult =
  | { kind: 'no-session-dir' }
  | { kind: 'no-transcripts' }
  | { kind: 'ok'; transcripts: string[][] };

/**
 * Return a classified result for the given session's subagent transcript directory.
 *
 * Distinguishes "parent spawned no subagent" (no-session-dir) from "transcripts
 * exist but contain no preload lines" (no-transcripts), enabling targeted error
 * messages in the test. The session ID is always known in advance via --session-id,
 * so this never needs the directory-diff heuristic.
 */
export function getSubagentPreloadResult(sessionId: string): SubagentPreloadResult {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const subagentsDir = buildSubagentsPath(homeDir, process.cwd(), sessionId);
  if (!existsSync(subagentsDir)) return { kind: 'no-session-dir' };
  let files: string[];
  try {
    files = readdirSync(subagentsDir).filter(
      (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
    );
  } catch {
    return { kind: 'no-session-dir' };
  }
  if (files.length === 0) return { kind: 'no-transcripts' };
  const transcripts = files.map((f) => parsePreloadedSkills(resolve(subagentsDir, f)));
  return { kind: 'ok', transcripts };
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

/** Maximum bytes of combined stdout+stderr to retain for diagnostics. */
const OUTPUT_TAIL_BYTES = 2048;

/**
 * Run a prompt through claude CLI and wait for completion. No early-exit logic —
 * just spawns the process and resolves when it exits. Used for subagent tests
 * where we need the process to finish so transcripts are written to disk.
 *
 * Session identity is deterministic: a UUID is generated before spawning and
 * passed via `--session-id <uuid>`. The subagents/ directory for this session
 * is then read by path rather than by directory-diff. This eliminates the race
 * where concurrent background Claude sessions (e.g., devflow memory worker)
 * create new UUID directories that the diff picks up instead of ours.
 *
 * The 3 s post-SIGTERM wait is retained: the spawned subagent runs independently
 * and may still be writing its initialization transcript (skill preloads appear
 * in the first JSONL lines) after the parent is killed. Resolving immediately
 * races with that write.
 *
 * `stdoutTail` carries the last {@link OUTPUT_TAIL_BYTES} bytes of combined
 * stdout+stderr for use in diagnostic failure messages.
 */
export function runClaudeAndWait(
  prompt: string,
  options?: { timeout?: number; model?: string; allowedTools?: string },
): Promise<{ durationMs: number; exitCode: number | null; sessionId: string; stdoutTail: string }> {
  const timeout = options?.timeout ?? 45000;
  const model = options?.model ?? 'haiku';
  const allowedTools = options?.allowedTools ?? 'Agent';
  const sessionId = randomUUID();

  return new Promise((resolve) => {
    const startTime = Date.now();
    let outputTail = '';

    const appendToTail = (chunk: string): void => {
      outputTail += chunk;
      if (outputTail.length > OUTPUT_TAIL_BYTES) {
        outputTail = outputTail.slice(outputTail.length - OUTPUT_TAIL_BYTES);
      }
    };

    const proc = spawn('claude', [
      '-p', '--model', model,
      '--allowedTools', allowedTools,
      '--dangerously-skip-permissions',
      '--session-id', sessionId,
      prompt,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout?.on('data', (chunk: Buffer) => appendToTail(chunk.toString()));
    proc.stderr?.on('data', (chunk: Buffer) => appendToTail(chunk.toString()));

    const finish = (code: number | null): void => {
      resolve({ durationMs: Date.now() - startTime, exitCode: code, sessionId, stdoutTail: outputTail });
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      // Wait 3 s after SIGTERM: the spawned subagent runs independently and may
      // still be writing its initialization transcript (skill preloads appear in
      // the first JSONL lines). Resolving immediately races with that write.
      setTimeout(() => finish(null), 3000);
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      finish(code);
    });

    proc.on('error', () => {
      clearTimeout(timer);
      finish(null);
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
  const result = getSubagentPreloadResult(sessionId);
  if (result.kind !== 'ok') return [];
  return result.transcripts;
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
