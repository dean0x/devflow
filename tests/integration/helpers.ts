import { execFileSync, execSync, spawn, spawnSync, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { encodeProjectDir } from '../../scripts/token-audit/discover.js';
import { removeCaptureHooks, countCaptureHooks } from '../../src/cli/commands/capture.js';
import { countMemoryHooks } from '../../src/cli/commands/memory.js';
import { ROOT, requireBuiltCli, sandboxEnv } from '../helpers.js';
import { REDIRECT_ENV_VARS } from '../setup/home-isolation.js';

/**
 * Check if the `claude` CLI is available on this machine.
 *
 * This is a capability gate on an external binary, not a build gate — skipping when
 * `claude` is absent is correct here. Build artifacts (dist/cli.js, dist/commands/)
 * use `requireBuiltCli()` / `requireDistFile(s)` instead, which throw rather than skip.
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
// Credential and skip reason
// ---------------------------------------------------------------------------

/** The two variables a live session can sign in with, in the order they are tried. */
export const CREDENTIAL_NAMES = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const;
export type CredentialName = (typeof CREDENTIAL_NAMES)[number];

export interface Credential {
  readonly name: CredentialName;
  readonly value: string;
}

/**
 * The one credential a live session carries: the OAuth token first, else the API key.
 * A blank value counts as unset. Looks nowhere but `env` — no keychain, no file.
 */
export function pickCredential(env: NodeJS.ProcessEnv): Credential | null {
  for (const name of CREDENTIAL_NAMES) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') return { name, value };
  }
  return null;
}

/**
 * Why a live file must skip, or `null` when it can run. The text names variables and
 * their state ("not set"), never a value.
 */
export function liveSkipReason(credential: Credential | null, claudeAvailable: boolean): string | null {
  if (!claudeAvailable) return 'the claude CLI is not on PATH';
  if (credential === null) {
    return (
      `no credential for the temp HOME (${CREDENTIAL_NAMES.map((name) => `${name} not set`).join(', ')}); ` +
      'a temp HOME cannot use the login stored in the real HOME'
    );
  }
  return null;
}

/** Print the skip reason of a live file, so a skipped run says why. */
export function printLiveSkip(file: string, reason: string | null): void {
  if (reason !== null) console.log(`[live-claude] ${file} skipped: ${reason}`);
}

// ---------------------------------------------------------------------------
// Spawn context: a temp HOME and a temp git repository
// ---------------------------------------------------------------------------

/**
 * Where a live session runs. `home` and `cwd` are real paths of two new directories under
 * the OS temp dir; `cwd` is a new git repository with no remote. `env` is the whole child
 * environment: an allowlist plus HOME, plus the one credential when there is one.
 */
export interface SpawnContext {
  readonly home: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Runs one git command and returns its stdout. Injected so a failed setup can be tested. */
export type GitRunner = (args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => string;

const GIT_TIMEOUT_MS = 30_000;

/**
 * The default {@link GitRunner}. Turns `core.fsmonitor` off for the call, as every git call
 * that reads an index does, and runs under the env it is given (a sandboxed one).
 */
export const sandboxGit: GitRunner = (args, cwd, env) =>
  execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Every directory the live tests create starts with this, so a leak is easy to find. */
const LIVE_PREFIX = 'devflow-live-';

/** Resolve symlinks where the path exists (macOS `/var` -> `/private/var`), else normalise. */
function canonical(dir: string): string {
  const resolved = path.resolve(dir);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

/** Throw unless `dir` lies strictly under the OS temp dir. Guards every recursive removal. */
function assertUnderTempRoot(dir: string): void {
  const root = canonical(os.tmpdir());
  if (!canonical(dir).startsWith(root + path.sep)) {
    throw new Error(`refusing to touch ${dir}: it is not under ${root}`);
  }
}

/** Throw when `dir` is the checkout or lies inside it. */
function assertOutsideCheckout(dir: string): void {
  const rel = path.relative(realpathSync(ROOT), dir);
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))) {
    throw new Error(`refusing to use ${dir}: it is inside the checkout`);
  }
}

/** Remove each directory; every one is tried, and the first error is returned. */
function removeTempDirs(dirs: readonly string[]): unknown {
  let first: unknown;
  for (const dir of dirs) {
    try {
      assertUnderTempRoot(dir);
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      first ??= error;
    }
  }
  return first;
}

/**
 * Build the place a live session runs in.
 *
 * - `home`: a new temp directory (real path) with `.claude/settings.json` set to `{}`.
 * - `cwd`: a new temp directory (real path), outside the checkout, made a git repository
 *   with a repository identity and no remote. Nothing is copied from the checkout's `.git`
 *   or `.devflow`. Every git call runs under the sandboxed env, never the real global config.
 * - `env`: {@link sandboxEnv} of `home`, plus `credential` when given.
 *
 * The call asserts the HOME, the absence of every redirect variable, at most one credential,
 * a `cwd` outside the checkout, and empty `git remote` output. When any step fails, both
 * directories are removed before the error is rethrown.
 */
export function createSpawnContext(credential: Credential | null = null, git: GitRunner = sandboxGit): SpawnContext {
  const created: string[] = [];
  const makeDir = (label: string): string => {
    const raw = mkdtempSync(path.join(os.tmpdir(), `${LIVE_PREFIX}${label}-`));
    created.push(raw);
    return realpathSync(raw);
  };

  try {
    const home = makeDir('home');
    mkdirSync(path.join(home, '.claude'), { recursive: true });
    writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n', 'utf-8');

    const cwd = makeDir('repo');
    assertOutsideCheckout(cwd);

    const gitEnv = sandboxEnv(home);
    git(['init', '-q', '-b', 'main'], cwd, gitEnv);
    git(['config', 'user.name', 'Devflow Live Test'], cwd, gitEnv);
    git(['config', 'user.email', 'live-test@devflow.invalid'], cwd, gitEnv);
    const remote = git(['remote'], cwd, gitEnv).trim();
    if (remote !== '') throw new Error('the temp repository has a remote; it must have none');
    const toplevel = realpathSync(git(['rev-parse', '--show-toplevel'], cwd, gitEnv).trim());
    if (toplevel !== cwd) throw new Error(`the temp repository root is ${toplevel}, expected ${cwd}`);
    if (existsSync(path.join(cwd, '.devflow'))) throw new Error('the temp repository holds a .devflow directory');

    const env = sandboxEnv(home, credential === null ? {} : { [credential.name]: credential.value });
    if (env['HOME'] !== home) throw new Error('the child env HOME is not the temp home');
    for (const key of REDIRECT_ENV_VARS) {
      if (env[key] !== undefined) throw new Error(`the child env holds the redirect variable ${key}`);
    }
    if (CREDENTIAL_NAMES.filter((name) => env[name] !== undefined).length > (credential === null ? 0 : 1)) {
      throw new Error('the child env holds more credentials than the one given');
    }

    return { home, cwd, env };
  } catch (error) {
    removeTempDirs(created);
    throw error;
  }
}

/** Remove the temp HOME and the temp repository. Both are tried even when one removal fails. */
export function disposeSpawnContext(ctx: Pick<SpawnContext, 'home' | 'cwd'>): void {
  const failure = removeTempDirs([ctx.cwd, ctx.home]);
  if (failure !== undefined) throw failure;
}

/** The one line a live file prints about its context: the resolved HOME, nothing else. */
export function describeSpawnContext(ctx: Pick<SpawnContext, 'home'>): string {
  return `HOME=${ctx.home}`;
}

// ---------------------------------------------------------------------------
// devflow install into the temp HOME
// ---------------------------------------------------------------------------

/** Ceiling for the `devflow init` spawn. */
export const INIT_TIMEOUT_MS = 120_000;
/** Ceiling for a live file's `beforeAll`, which runs the install. */
export const BEFORE_ALL_TIMEOUT_MS = 180_000;

/**
 * The init arguments for a live run: the plugins whose agents and skills the tests use,
 * with ambient, memory, learning, knowledge, rules and proxy off, and the security deny
 * list in the (temp) user settings. `--security user` keeps init away from the
 * machine-wide managed settings file, which no temp HOME redirects.
 */
export const INIT_ARGS: readonly string[] = [
  'init',
  '--plugin', 'implement,code-review,resolve,plan,research,bug-analysis',
  '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules', '--no-proxy',
  '--security', 'user',
];

export interface InitRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the built CLI with `args`. Injected so the failure paths can be tested. */
export type InitRunner = (
  args: readonly string[],
  opts: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly timeout: number },
) => InitRun;

const spawnInit: InitRunner = (args, opts) => {
  const result = spawnSync(process.execPath, [requireBuiltCli(), ...args], {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf-8',
    timeout: opts.timeout,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/** Reads the checkout's `git status --porcelain --ignored`. Injected so the comparison can be tested. */
export type CheckoutStatusReader = (env: NodeJS.ProcessEnv) => string;

const checkoutStatus: CheckoutStatusReader = (env) => sandboxGit(['status', '--porcelain', '--ignored'], ROOT, env);

/**
 * The top-level paths `devflow init` could create or change in the repository it starts in:
 * the root ignore files, the project config and docs, and the legacy project directories its
 * migrations and its memory drain touch. Only these are compared before and after an install,
 * so another writer in the checkout (a hook, a worker, an editor) cannot fail a live run.
 */
export const INIT_WRITTEN_PATHS: readonly string[] = ['.devflow', '.claudeignore', '.gitignore', '.claude', '.memory', '.docs'];

function namesInitWrittenPath(file: string): boolean {
  return INIT_WRITTEN_PATHS.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

/**
 * The lines of `git status --porcelain` output that name a path init writes. A rename line
 * (`R  old -> new`) counts when either side does.
 */
export function initWrittenStatus(porcelain: string): string[] {
  return porcelain.split('\n').filter((line) => line.length > 3 && line.slice(3).split(' -> ').some(namesInitWrittenPath));
}

/** The lines that differ between two status listings, each marked `removed` or `added`. */
export function statusChange(before: readonly string[], after: readonly string[]): string[] {
  const was = new Set(before);
  const is = new Set(after);
  return [
    ...before.filter((line) => !is.has(line)).map((line) => `removed ${line}`),
    ...after.filter((line) => !was.has(line)).map((line) => `added   ${line}`),
  ];
}

const TAIL_CHARS = 600;
const tail = (text: string): string => text.slice(Math.max(0, text.length - TAIL_CHARS));

/**
 * Install devflow into `ctx.home` with the built CLI.
 *
 * `init` runs in a second new temp directory that is not a repository: it drains the memory
 * and learning queues of the repository it starts in, and the checkout must stay untouched.
 * The child env carries no credential. After the install the call checks that the Validate
 * and Test agent files exist, that no path init writes ({@link INIT_WRITTEN_PATHS}) changed in
 * the checkout, and that settings.json holds no memory hook and no capture hook. `init`
 * registers the capture bundle on every install (each script gates itself on the machine
 * switches, which are off here), so the bundle is removed from the temp settings before that
 * check. Throws on any failure; a checkout change names the differing status lines.
 */
export function installDevflow(
  ctx: Pick<SpawnContext, 'home'>,
  run: InitRunner = spawnInit,
  readStatus: CheckoutStatusReader = checkoutStatus,
): void {
  const env = sandboxEnv(ctx.home);
  const statusBefore = initWrittenStatus(readStatus(env));

  const initCwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), `${LIVE_PREFIX}init-`)));
  try {
    const result = run(INIT_ARGS, { cwd: initCwd, env, timeout: INIT_TIMEOUT_MS });
    if (result.status !== 0) {
      throw new Error(
        `devflow init exited with status ${String(result.status)} (null means a signal or the timeout).\n` +
        `stderr tail: ${tail(result.stderr)}\nstdout tail: ${tail(result.stdout)}`,
      );
    }
  } finally {
    removeTempDirs([initCwd]);
  }

  const agentsDir = path.join(ctx.home, '.claude', 'agents', 'devflow');
  for (const file of ['validate.md', 'test.md']) {
    if (!existsSync(path.join(agentsDir, file))) throw new Error(`devflow init did not install ${path.join(agentsDir, file)}`);
  }

  const settingsPath = path.join(ctx.home, '.claude', 'settings.json');
  const settings = removeCaptureHooks(readFileSync(settingsPath, 'utf-8'));
  writeFileSync(settingsPath, settings, 'utf-8');
  if (countMemoryHooks(settings) !== 0) throw new Error('settings.json holds a memory hook');
  if (countCaptureHooks(settings) !== 0) throw new Error('settings.json holds a capture hook');

  const changed = statusChange(statusBefore, initWrittenStatus(readStatus(env)));
  if (changed.length > 0) {
    throw new Error(`the checkout changed in a path devflow init writes, during the devflow install:\n${changed.join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// Session path helpers
// ---------------------------------------------------------------------------

/**
 * Build the absolute path to the `subagents/` directory for a given session.
 *
 * Pure function — no filesystem access — so it can be unit-tested in isolation.
 * The encoding mirrors Claude Code's own layout:
 *   ~/.claude/projects/{encoded-cwd}/{sessionId}/subagents/
 * where `encodeProjectDir` replaces every character outside [A-Za-z0-9] with '-' (so a
 * leading '/' becomes the leading '-', and '.' maps too).
 */
export function buildSubagentsPath(homeDir: string, cwd: string, sessionId: string): string {
  return path.resolve(homeDir, '.claude', 'projects', encodeProjectDir(cwd), sessionId, 'subagents');
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
 * The directory is read from the spawn context's temp HOME and the real path of its
 * working directory, the pair the live session ran with. Distinguishes "parent spawned
 * no subagent" (no-session-dir) from "transcripts exist but contain no preload lines"
 * (no-transcripts), enabling targeted error messages in the test. The session ID is
 * always known in advance via --session-id, so this never needs the directory-diff heuristic.
 */
export function getSubagentPreloadResult(
  location: Pick<SpawnContext, 'home' | 'cwd'>,
  sessionId: string,
): SubagentPreloadResult {
  const subagentsDir = buildSubagentsPath(location.home, location.cwd, sessionId);
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
  const transcripts = files.map((f) => parsePreloadedSkills(path.resolve(subagentsDir, f)));
  return { kind: 'ok', transcripts };
}

// ---------------------------------------------------------------------------
// Argument lists
// ---------------------------------------------------------------------------

/** The tools no live spawn may use. A live prompt stays read-only whatever the model does. */
export const DENIED_TOOLS = 'Bash Edit Write NotebookEdit WebFetch WebSearch';
/** An MCP config with no servers: with `--strict-mcp-config`, no MCP tool reaches the session. */
export const EMPTY_MCP_CONFIG = '{"mcpServers":{}}';

/**
 * The shared argument list: `-p`, the prompt, the plain flags, then the permission design.
 *
 * Order matters. `--allowedTools`, `--disallowedTools` and `--mcp-config` take a list of
 * values, so a prompt placed after one of them is read as one more value and never reaches
 * claude as the prompt. The prompt therefore sits directly after `-p`, and the list flags
 * come last, each followed by a flag or the end. The mode is `dontAsk`: a tool that is not
 * in the allow list is denied without a prompt, so no session needs a skip-permissions flag.
 */
function buildClaudeArgs(prompt: string, plainFlags: readonly string[], allowedTools: string): string[] {
  return [
    '-p', prompt,
    ...plainFlags,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--allowedTools', allowedTools,
    '--disallowedTools', DENIED_TOOLS,
    '--mcp-config', EMPTY_MCP_CONFIG,
  ];
}

/** The arguments of a run that waits for exit (the subagent preload tests). */
export function buildPreloadArgs(
  prompt: string,
  options: { model: string; allowedTools: string; sessionId: string },
): string[] {
  return buildClaudeArgs(prompt, ['--model', options.model, '--session-id', options.sessionId], options.allowedTools);
}

/** The arguments of a stream-json run that stops at the first Skill call (the ambient tests). */
export function buildStreamingArgs(
  prompt: string,
  options: { model: string; allowedTools: string; systemPrompt: string | false },
): string[] {
  return buildClaudeArgs(
    prompt,
    [
      '--output-format', 'stream-json', '--verbose',
      '--model', options.model,
      ...(options.systemPrompt !== false ? ['--append-system-prompt', options.systemPrompt] : []),
    ],
    options.allowedTools,
  );
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
 * Runs in the spawn context: its cwd and its env (temp HOME, one credential). Allows the
 * Skill tool by default so it actually executes (appears as tool_use events).
 */
export function runClaudeStreaming(
  ctx: Pick<SpawnContext, 'cwd' | 'env'>,
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

    const args = buildStreamingArgs(prompt, { model, allowedTools, systemPrompt });

    const proc: ChildProcess = spawn('claude', args, {
      cwd: ctx.cwd,
      env: ctx.env,
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
 *
 * Runs in the spawn context: its cwd and its env (temp HOME, one credential), with the
 * permission design of {@link buildPreloadArgs}.
 */
export function runClaudeAndWait(
  ctx: Pick<SpawnContext, 'cwd' | 'env'>,
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

    const proc = spawn('claude', buildPreloadArgs(prompt, { model, allowedTools, sessionId }), {
      cwd: ctx.cwd,
      env: ctx.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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

