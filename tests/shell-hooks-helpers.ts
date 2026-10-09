/**
 * Hook-invocation primitives shared by the shell-hook test files.
 *
 * `runHook` drives one hook script through its real interface — a JSON object on
 * stdin, a HOME override, and whatever extra env the case needs — and returns
 * stdout/stderr/exitCode instead of throwing, so a non-zero exit is a value the
 * caller asserts on rather than a failure the caller has to catch. `execHook` is
 * the same run with `execSync`'s contract: stdout on success, a throw otherwise.
 *
 * Both sit on `spawnWithStdin`, which is where the stdin-EPIPE race is settled.
 *
 * `makeFifo`, `releaseFifo` and `FIFO_RUN_BOUND_MS` serve the tests that plant a
 * FIFO where a hook creates a file: an open of one for writing waits for a reader,
 * so each such run is bounded and the FIFO released after it.
 */

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** The hook scripts as authored (source tree), never as installed. */
export const HOOKS_DIR = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'scripts', 'hooks');

/**
 * One hook-script run's own work — bash, git, jq, the queue appends — on a
 * loaded machine: the 5 s vitest default that the hook tests which exec no node
 * already run within.
 */
export const HOOK_RUN_ALLOWANCE_MS = 5_000;

/**
 * On macOS a node exec that follows fork-heavy tests is held until syspolicyd
 * drains the reports those forks raised: 5-7 s measured on macOS 26.2 for the
 * first exec, ~30 ms for the next (the full account is D-PROXY-EXEC-BARRIER in
 * shell-hooks.test.ts). Linux has no such queue. This is the top of the
 * measured range, paid at most once per test by a test that execs node once.
 */
export const NODE_EXEC_STALL_MS = 7_000;

/**
 * The bound on a run that meets a FIFO a test planted: far above a hook's own work
 * on a loaded machine, node exec stall included, so only a run that waits on the
 * FIFO reaches it. A test that runs under it allows itself FIFO_TEST_TIMEOUT_MS.
 */
export const FIFO_RUN_BOUND_MS = 20_000;
export const FIFO_TEST_TIMEOUT_MS = FIFO_RUN_BOUND_MS + 10_000;

/**
 * D-MEMORY-WORKER-LEAN: the version every fake `claude` in the memory worker's
 * tests reports to `--version`. background-memory-update runs that probe before it
 * takes the lock and picks its argv form from the answer, so a fake that did not
 * answer it would run its whole body on the probe: a staged write, a stdin capture,
 * an invocation marker. The version sits above the worker's floor, so a fake that
 * says nothing more gets the lean argv.
 */
export const FAKE_CLAUDE_VERSION = '2.1.293';

/**
 * A fake `claude` script that answers `--version` the way the real CLI does and
 * exits, before its own body runs. `script` is the whole fake, shebang line
 * included; the answer goes in right after that line, so every other argument
 * reaches the body untouched. A script without a shebang line is a harness error.
 */
export function answersVersion(script: string, version: string = FAKE_CLAUDE_VERSION): string {
  const eol = script.indexOf('\n');
  if (!script.startsWith('#!') || eol < 0) {
    throw new Error('answersVersion: the fake claude must open with a shebang line');
  }
  const answer = `case "\${1:-}" in --version) echo "${version} (Claude Code)"; exit 0 ;; esac\n`;
  return script.slice(0, eol + 1) + answer + script.slice(eol + 1);
}

/**
 * The first executable file `name` on `pathValue`, searched in order as a shell
 * resolves a bare command, or undefined when none is. A test that fakes a binary
 * the code under test reaches by bare name asserts that this returns the fake: a
 * fake in a directory that is not first on the PATH, or no fake at all, would let
 * the machine's own binary run.
 */
export function resolveOnPath(name: string, pathValue: string): string | undefined {
  for (const dir of pathValue.split(':')) {
    if (dir === '') continue;
    const candidate = path.join(dir, name);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return candidate;
    } catch {
      // Not there; the next directory.
    }
  }
  return undefined;
}

/** A FIFO at `file`: no regular file, and an open of it for writing waits for a reader. */
export function makeFifo(file: string): void {
  execFileSync('mkfifo', [file]);
}

/**
 * Open `fifo`'s read end without waiting, then close it: a writer still waiting to
 * open the FIFO, left behind when a bound killed the run that started it, is let go,
 * so no process outlives its test. Nothing at `fifo` is no error.
 */
export function releaseFifo(fifo: string): void {
  let fd: number;
  try {
    fd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch {
    return;
  }
  fs.closeSync(fd);
}

/** What one child run left behind, whatever its verdict. */
export interface ChildExit {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The parent's write of `input` failed because the child had already closed stdin. */
  readonly stdinEpipe: boolean;
}

/** The child ran and exited; `clean` is status 0 with no signal, anything else `failed`. */
export type ChildVerdict = (ChildExit & { readonly kind: 'clean' }) | (ChildExit & { readonly kind: 'failed' });

/** The harness itself failed (missing executable, timeout, output overflow) — not the child. */
export type StdinRunVerdict = ChildVerdict | { readonly kind: 'harness-error'; readonly error: Error };

/** The fields of a `spawnSync` result the verdict is decided from. */
export interface SpawnOutcome {
  readonly error?: Error;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function isEpipe(error: Error | undefined): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EPIPE';
}

/**
 * Decide one stdin-fed run. Pure: the rule, separate from the process it judges.
 *
 * D-STDIN-EPIPE: an EPIPE on the stdin write is benign ONLY when the child
 * otherwise exited normally — status 0 and no signal. A hook guard (e.g.
 * DEVFLOW_BG_UPDATER=1) may exit 0 before reading stdin; whether Node's write of
 * `input` lands before that exit is scheduling, so `execSync` throws EPIPE on a
 * child that behaved correctly. The EPIPE never decides the verdict either way:
 * a non-zero status or a signal is `failed` with or without it, so a failing
 * child cannot be laundered into a pass. Every other spawn error (ENOENT,
 * ETIMEDOUT, ENOBUFS) is the harness failing and is never classified as a
 * child exit at all.
 */
export function classifyStdinRun(outcome: SpawnOutcome): StdinRunVerdict {
  const { error, status, signal, stdout, stderr } = outcome;
  if (error !== undefined && !isEpipe(error)) return { kind: 'harness-error', error };
  const exit: ChildExit = { stdout, stderr, status, signal, stdinEpipe: isEpipe(error) };
  return status === 0 && signal === null ? { kind: 'clean', ...exit } : { kind: 'failed', ...exit };
}

export interface StdinRunOptions {
  readonly input: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly timeout?: number;
}

/**
 * Run `file args` (no shell) with `input` on stdin and return the child's verdict.
 * Throws only for a harness error: the test could not run, so it must not pass.
 */
export function spawnWithStdin(file: string, args: readonly string[], options: StdinRunOptions): ChildVerdict {
  const result = spawnSync(file, [...args], {
    input: options.input,
    env: options.env,
    cwd: options.cwd,
    timeout: options.timeout,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const verdict = classifyStdinRun({
    error: result.error,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  });
  if (verdict.kind === 'harness-error') throw verdict.error;
  return verdict;
}

/**
 * `execSync(\`bash "${hookPath}"\`, { input, ... }).toString()` without the
 * stdin-EPIPE race: stdout when the hook exits cleanly, a throw naming the
 * status, signal and stderr when it does not.
 */
export function execHook(
  hookPath: string,
  input: string,
  options: { readonly env?: NodeJS.ProcessEnv; readonly cwd?: string } = {},
): string {
  const run = spawnWithStdin('bash', [hookPath], { input, ...options });
  if (run.kind === 'failed') {
    throw new Error(
      `hook ${path.basename(hookPath)} exited with status ${run.status} (signal ${run.signal})\n` +
        `stderr: ${run.stderr}`,
    );
  }
  return run.stdout;
}

export function runHook(
  hookPath: string,
  input: object,
  homeDir: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  const run = spawnWithStdin('bash', [hookPath], {
    input: JSON.stringify(input),
    env: { ...process.env, HOME: homeDir, ...extraEnv },
  });
  // stderr on a non-clean exit only — the contract callers were written against
  // (shell-hooks-tracker.test.ts's runCapturingStderr exists because of it).
  return run.kind === 'clean'
    ? { stdout: run.stdout, stderr: '', exitCode: 0 }
    : { stdout: run.stdout, stderr: run.stderr, exitCode: run.status ?? 1 };
}
