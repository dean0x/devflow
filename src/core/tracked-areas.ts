/**
 * @file tracked-areas.ts
 *
 * The CLI's view of the tracked-areas check — a typed seam onto the package's own
 * `hooks/lib/tracked-areas.cjs`, never a second implementation of it.
 *
 * The check answers whether git tracks any entry under one of devflow's data folders at
 * a root, one area at a time: the curation area (the curation folder, the legacy
 * learning folder and the backup folders), the memory area (the memory folder) or both. The
 * one-time ledger move and the backup sweep ask it before they change anything, and so
 * does the drain of a switched-off curation (src/core/curation-queue-cleanup.ts). The
 * module is loaded with the evidence-policy seam's `loadScript` from the package's own
 * scripts directory and shape-checked against TRACKED_AREAS_SURFACE; the interface below
 * is TRANSCRIBED from the module's JSDoc and is this side's only shape authority (as for
 * the move, see curation-move.ts).
 *
 * `probeTrackedArea` is the asynchronous runner for the HUD, the CLI and uninstall: it
 * takes the call the leaf describes (`trackedAreaCall`), runs it with a time bound that
 * cannot be outlived, and hands the result to the leaf's judge (`judgeTrackedAreas`), so
 * it answers as the leaf's own synchronous check does.
 */

import { execFile, type ExecFileException } from 'child_process';
import { join } from 'path';
import { scriptsDir } from './assets.js';
import { loadScript, type EvidencePolicyLoadError, type Result, type SurfaceKind } from './evidence-policy.js';

/** The check module, relative to src/assets/scripts/ (and ~/.devflow/scripts/). */
export const TRACKED_AREAS_SCRIPT_NAME = join('hooks', 'lib', 'tracked-areas.cjs');

/**
 * The check's answer. `untracked`: no `.git` entry at the root (no git call was made),
 * or git listed nothing. `tracked`: git lists an entry under a data folder, a backup
 * folder or the `.devflow` entry itself. `unknown`: a `.git` entry stands and git did
 * not answer, or the root is not an absolute path.
 */
export type TrackedAreasAnswer = 'tracked' | 'untracked' | 'unknown';

/**
 * The areas the check knows: the leaf's AREA_PATHSPECS keys. `both` is the union of the
 * two data areas, answered by one git call, for a caller that serves both at one root.
 */
export type TrackedArea = 'curation' | 'memory' | 'both';

/**
 * An answer with the reason for an `unknown` one: a fixed word from the leaf's
 * UNKNOWN_CAUSES (it names a spawn error, a time out, a signal, an exit status or the step
 * that failed, and never carries git's text or a path); null for the other two answers.
 */
export interface TrackedAreaInspection {
  readonly answer: TrackedAreasAnswer;
  readonly cause: string | null;
}

/** The git call the leaf describes: run `git` with `argv` and `env` in `cwd`, with no shell. */
export interface TrackedAreaCommand {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/** What `trackedAreaCall` answers: the answer itself when no git call is due, or the call. */
export type TrackedAreaCall = TrackedAreaInspection | TrackedAreaCommand;

/** The part of the check module's `module.exports` the CLI calls. It never throws. */
export interface TrackedAreasModule {
  /** Whether git tracks any entry under the curation area's folders at `root` (an absolute path). */
  checkTrackedAreas(root: unknown): TrackedAreasAnswer;
  /** Whether git tracks any entry under the folders of `area` at `root`; an unknown area answers `unknown`. */
  checkTrackedArea(root: unknown, area: unknown): TrackedAreasAnswer;
  /** Whether a git call is due for `area` at `root`, and the call (cwd, argv, env) when it is. Starts no process. */
  trackedAreaCall(root: unknown, area: unknown, baseEnv?: NodeJS.ProcessEnv): TrackedAreaCall;
  /** The answer, with its cause, of the result `spawnSync` (or a runner shaped like it) gave for the call. */
  judgeTrackedAreas(result: unknown): TrackedAreaInspection;
}

/**
 * Every key of TrackedAreasModule and the runtime kind the loader requires of it.
 * `satisfies` makes the compiler reject an interface key missing here.
 */
export const TRACKED_AREAS_SURFACE = Object.freeze({
  checkTrackedAreas: 'function',
  checkTrackedArea: 'function',
  trackedAreaCall: 'function',
  judgeTrackedAreas: 'function',
} as const satisfies Record<keyof TrackedAreasModule, SurfaceKind>);

export type TrackedAreasLoad = Result<TrackedAreasModule, EvidencePolicyLoadError>;

/**
 * Load the tracked-areas module from `dir` (default: the package's own scripts
 * directory) and shape-check its surface. Never throws: a missing file is
 * `not-found`; a module that throws on load or lacks a surface key is `unusable`.
 */
export function loadTrackedAreas(dir: string = scriptsDir()): TrackedAreasLoad {
  return loadScript<TrackedAreasModule>(join(dir, TRACKED_AREAS_SCRIPT_NAME), TRACKED_AREAS_SURFACE);
}

/**
 * The longest a probe waits for git (ms) when the caller names no bound: the leaf's
 * TRACKED_AREAS_GIT_TIMEOUT_MS (tests/core/tracked-areas-seam.test.ts pins the two equal).
 */
export const TRACKED_AREA_PROBE_TIMEOUT_MS = 5000;

/**
 * The most output a probe takes from git, in bytes: the leaf's TRACKED_AREAS_GIT_MAX_BUFFER
 * (pinned equal). A normal answer is empty; more output than this means entries exist.
 */
export const TRACKED_AREA_PROBE_MAX_BUFFER = 4096;

/**
 * How long past its timeout a probe waits for git to die before it stops waiting and
 * kills it: the timeout's own kill needs the process to end, and a process stuck in I/O
 * on a hung mount may not (the pattern of runGit in ledger-root.ts).
 */
const KILL_GRACE_MS = 500;

/** The cause a probe gives when it can not run the leaf's check at all: the leaf's `check-failed`. */
const CHECK_FAILED_CAUSE = 'check-failed';

const CHECK_FAILED: TrackedAreaInspection = Object.freeze({ answer: 'unknown', cause: CHECK_FAILED_CAUSE });

export interface ProbeTrackedAreaOptions {
  /** Stop waiting for git after this many ms (a positive finite number; otherwise TRACKED_AREA_PROBE_TIMEOUT_MS). */
  readonly timeoutMs?: number;
  /** The scripts directory to load the leaf from (default: the package's own). */
  readonly dir?: string;
}

/** The result of one git run, in the shape the leaf's judge reads (spawnSync's). */
interface SpawnShapedResult {
  readonly error?: { readonly code: string };
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
}

/**
 * Run the leaf's described call, bounded twice: Node kills git at `timeoutMs`, and the
 * run stops waiting KILL_GRACE_MS later even if git is still alive (and kills it then).
 * The result is spawnSync-shaped for the leaf's judge: a timeout is `ETIMEDOUT`, an output
 * overflow `ENOBUFS`, a spawn failure carries its own code, a signal its name and a normal
 * exit its status. Never rejects.
 */
function runCall(call: TrackedAreaCommand, timeoutMs: number): Promise<SpawnShapedResult> {
  return new Promise((resolve) => {
    let settled = false;
    let backstop: NodeJS.Timeout | undefined;
    const settle = (result: SpawnShapedResult): void => {
      if (settled) return;
      settled = true;
      if (backstop !== undefined) clearTimeout(backstop);
      resolve(result);
    };
    const child = execFile(
      'git',
      [...call.argv],
      { cwd: call.cwd, env: call.env, timeout: timeoutMs, maxBuffer: TRACKED_AREA_PROBE_MAX_BUFFER, encoding: 'utf-8', windowsHide: true },
      (err, stdout) => {
        if (!err) {
          settle({ status: 0, signal: null, stdout });
          return;
        }
        const failure: ExecFileException = err;
        if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          settle({ error: { code: 'ENOBUFS' }, status: null, signal: null, stdout });
        } else if (failure.killed === true) {
          settle({ error: { code: 'ETIMEDOUT' }, status: null, signal: failure.signal ?? null, stdout });
        } else if (typeof failure.code === 'number') {
          settle({ status: failure.code, signal: null, stdout });
        } else if (typeof failure.code === 'string') {
          settle({ error: { code: failure.code }, status: null, signal: null, stdout });
        } else {
          settle({ status: null, signal: failure.signal ?? null, stdout });
        }
      },
    );
    backstop = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ error: { code: 'ETIMEDOUT' }, status: null, signal: 'SIGKILL', stdout: '' });
    }, timeoutMs + KILL_GRACE_MS);
    backstop.unref();
  });
}

/**
 * Whether git tracks any entry under the folders of `area` at `root`, with the reason
 * for an `unknown` answer. The three-state answer of the leaf's own check, for a caller
 * that must not block: the HUD (which bounds it at one second), the CLI and uninstall.
 *
 * It asks the leaf whether a call is due (`trackedAreaCall`: no `.git` entry at the root
 * answers `untracked` with no git process), runs the call it describes, and has the leaf
 * judge the result. A git that does not answer in time answers `unknown`; a leaf that can
 * not be loaded answers `unknown` with the cause `check-failed`. Never rejects.
 */
export async function probeTrackedArea(
  root: unknown,
  area: TrackedArea,
  options: ProbeTrackedAreaOptions = {},
): Promise<TrackedAreaInspection> {
  const loaded = loadTrackedAreas(options.dir);
  if (!loaded.ok) return CHECK_FAILED;
  const { trackedAreaCall, judgeTrackedAreas } = loaded.value;
  try {
    const call = trackedAreaCall(root, area);
    if (!('argv' in call)) return call;
    const requested = options.timeoutMs;
    const timeoutMs = typeof requested === 'number' && Number.isFinite(requested) && requested > 0 ? requested : TRACKED_AREA_PROBE_TIMEOUT_MS;
    return judgeTrackedAreas(await runCall(call, timeoutMs));
  } catch {
    return CHECK_FAILED;
  }
}
