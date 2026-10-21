// src/assets/scripts/hooks/lib/tracked-areas.cjs
//
// Does git track any entry under one of devflow's data folders at a root? One
// `git ls-files` call over a fixed set of pathspecs answers `tracked`, `untracked` or
// `unknown`, for one area at a time: `curation` (the curation folder, the old ledger
// folder and the backup folders), `memory` (the memory folder) or `both` (the union of the
// two, one call, for a caller that serves both areas at one root). The one-time ledger move
// and the backup sweep ask it for the curation area before they lock, read or rename
// anything: a folder that git tracks is the repository's content, so they leave it alone.
//
// DESIGN: a leaf. It loads node built-ins and project-paths.cjs (which loads node
// built-ins only) and requires neither the store nor the move module (the move requires
// the store; the store never requires the move), so either of them, and a check for
// another folder, can use it. No function here prints or exits, and nothing throws:
// every failure is the answer `unknown`, with a cause from the closed set UNKNOWN_CAUSES.
//
// The folder names come from project-paths.cjs, which owns them: AREA_FOLDERS lists the
// curation area's data folders, the backup prefix names the folders the move leaves
// behind, and the memory folder is the one getMemoryDir names. To cover another folder of
// an area, add it to that area's pathspecs.
//
// The decision is the repository's index, never the disk. A root with no `.git` entry
// (a file or a folder) is not a git working tree and gets no git call. A root with one
// gets exactly one call, and every failure of that call (git missing, a timeout, a
// non-zero exit with nothing listed) is `unknown`: the caller cannot tell what git
// tracks and must change nothing. git's error text is never read.
//
// trackedAreaCall splits the check in two: it decides whether a call is due and, when it
// is, describes it (working directory, argv, environment); a caller that runs git in
// another way (the TypeScript seam's bounded async runner, the settings resolver's
// injected exec) executes that description and hands the result to judgeTrackedAreas, so
// every runner gives the answer this leaf gives.

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { LEGACY_NAMES, CURATION_DIR_NAME, getMemoryDir } = require('./project-paths.cjs');

/** The curation data folders under `.devflow` that the check covers, by the names the path helpers hold. */
const AREA_FOLDERS = Object.freeze([LEGACY_NAMES.folder, CURATION_DIR_NAME]);

/** The memory folder under `.devflow`, by the name getMemoryDir gives it. */
const MEMORY_FOLDER = path.basename(getMemoryDir(path.sep));

/**
 * The spellings a case-folding file system opens as `.devflow` beyond ASCII letter case.
 * git's `icase` folds ASCII letters only, but APFS (the macOS default) compares names by
 * full Unicode case folding, so it also opens `.devﬂow` (U+FB02 folds to "fl"). The code
 * is written with an escape, so the code point is named.
 */
const DEVFLOW_SPELLINGS = Object.freeze(['.devflow', '.dev\u{FB02}ow']);

/**
 * The pathspecs of the curation area, each matched without regard to ASCII letter case,
 * whatever the file system or `core.ignorecase`, and each spelled every way
 * DEVFLOW_SPELLINGS lists:
 *   - each folder of AREA_FOLDERS, as a literal path: an index entry at the folder, or
 *     anywhere below it, matches
 *   - an entry named like a backup folder (`<backup prefix>*`), and every entry below one
 *     (`<backup prefix>*` + `/**`): the move leaves its old folder there, and the sweep
 *     merges the queue files in it into the new folder. The prefix has no glob character.
 *   - an index entry named `.devflow` ITSELF, which git records only for a symlink, a
 *     gitlink (submodule) or a plain file, never for a directory: the character class
 *     keeps `glob` from matching as a leading directory, so the many files under a
 *     normal `.devflow/` are not listed. Committed content then stands at the path where
 *     the folders are opened.
 * The ledger move and the backup sweep ask for this set, and its order and spelling stay
 * as they are.
 */
const TRACKED_AREA_PATHSPECS = Object.freeze([
  ...DEVFLOW_SPELLINGS.flatMap(dir => [
    ...AREA_FOLDERS.map(area => ':(icase,literal)' + dir + '/' + area),
    ':(icase,glob)' + dir + '/' + LEGACY_NAMES.backupPrefix + '*',
    ':(icase,glob)' + dir + '/' + LEGACY_NAMES.backupPrefix + '*/**',
  ]),
  ...DEVFLOW_SPELLINGS.map(dir => ':(icase,glob)[.]' + dir.slice(1)),
]);

/**
 * The pathspecs of the memory area, matched and spelled as the curation area's are: the
 * memory folder as a literal path (an entry at the folder, or anywhere below it), and the
 * `.devflow` entry itself.
 */
const MEMORY_AREA_PATHSPECS = Object.freeze([
  ...DEVFLOW_SPELLINGS.map(dir => ':(icase,literal)' + dir + '/' + MEMORY_FOLDER),
  ...DEVFLOW_SPELLINGS.map(dir => ':(icase,glob)[.]' + dir.slice(1)),
]);

/**
 * The pathspecs of the two areas together: the curation set, then the memory set, each
 * pathspec once (the `.devflow` entry forms stand in both sets). One call over this set
 * answers `tracked` when git tracks anything either area covers.
 */
const BOTH_AREAS_PATHSPECS = Object.freeze([...new Set([...TRACKED_AREA_PATHSPECS, ...MEMORY_AREA_PATHSPECS])]);

/** The pathspecs of each area, by the area's name: the closed set of areas the check knows. */
const AREA_PATHSPECS = Object.freeze({
  curation: TRACKED_AREA_PATHSPECS,
  memory: MEMORY_AREA_PATHSPECS,
  both: BOTH_AREAS_PATHSPECS,
});

/**
 * Why a check answered `unknown`, as one fixed word. The words come from this list
 * alone: they name a spawn error code, a time out, a signal, an exit status or the step
 * that failed, and never carry git's own text or a path.
 */
const UNKNOWN_CAUSES = Object.freeze({
  rootNotAbsolute: 'root-not-absolute',
  gitEntryUnreadable: 'git-entry-unreadable',
  ceilingUnusable: 'ceiling-unusable',
  checkFailed: 'check-failed',
  gitNotFound: 'git-not-found',
  gitTimedOut: 'git-timed-out',
  gitStopped: 'git-stopped',
  gitExitStatus: 'git-exit-status',
  gitNotRun: 'git-not-run',
});

/** The longest the git call may run (ms). */
const TRACKED_AREAS_GIT_TIMEOUT_MS = 5000;

/**
 * The most output the git call may return, in bytes. A normal answer is empty; a
 * listing past this bound (ENOBUFS) means entries exist, which reads as tracked.
 */
const TRACKED_AREAS_GIT_MAX_BUFFER = 4096;

/**
 * The variables that make git read another repository, another index or other pathspec
 * rules than the root's own. The call runs without them.
 */
const GIT_REDIRECT_VARIABLES = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
]);

/**
 * A copy of `base` without the redirecting variables (GIT_REDIRECT_VARIABLES): git then
 * reads the repository, index and pathspec rules of the directory it runs in. Nothing else
 * changes. For a caller that runs git for its own purpose and needs only the scrub.
 *
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
function gitEnvWithoutRedirects(base) {
  const env = { ...base };
  for (const name of GIT_REDIRECT_VARIABLES) delete env[name];
  return env;
}

/**
 * The environment of the git call: the process environment without the redirecting
 * variables, with a fixed locale, no optional lock and a ceiling directory. Answers a new
 * object. The ceiling is the folder that holds the root: git reads the root's own `.git`
 * and never looks in a folder above it, so an empty or broken `.git` at the root is not
 * answered from a work tree around the project.
 *
 * @param {NodeJS.ProcessEnv} base
 * @param {string} ceiling - an absolute path with no list separator in it
 * @returns {NodeJS.ProcessEnv}
 */
function trackedAreasGitEnv(base, ceiling) {
  const env = gitEnvWithoutRedirects(base);
  env.LC_ALL = 'C';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_CEILING_DIRECTORIES = ceiling;
  return env;
}

/**
 * The answer of one `git ls-files` call, from the result `spawnSync` gave, with the
 * cause when the answer is `unknown` (null otherwise):
 *   tracked    any output byte, whatever the exit status or error (the call listed an
 *              entry), and an output past the buffer cap (ENOBUFS)
 *   untracked  exit 0 with nothing listed
 *   unknown    every other result, with the cause: git-not-found (spawn error ENOENT),
 *              git-timed-out (ETIMEDOUT), git-not-run (another spawn error, or a result
 *              of the wrong shape), git-stopped (a signal ended it), git-exit-status (a
 *              non-zero exit with nothing listed)
 * Pure: it reads only the fields `error.code`, `status`, `signal` and `stdout`.
 *
 * @param {unknown} result
 * @returns {{ answer: 'tracked' | 'untracked' | 'unknown', cause: string | null }}
 */
function judgeTrackedAreas(result) {
  if (result === null || typeof result !== 'object') return unknownBecause(UNKNOWN_CAUSES.gitNotRun);
  const { error, status, signal, stdout } = /** @type {{ error?: { code?: unknown }, status?: unknown, signal?: unknown, stdout?: unknown }} */ (result);
  if (error && error.code === 'ENOBUFS') return { answer: 'tracked', cause: null };
  const listed = (typeof stdout === 'string' || Buffer.isBuffer(stdout)) && stdout.length > 0;
  if (listed) return { answer: 'tracked', cause: null };
  if (error) {
    if (error.code === 'ENOENT') return unknownBecause(UNKNOWN_CAUSES.gitNotFound);
    return unknownBecause(error.code === 'ETIMEDOUT' ? UNKNOWN_CAUSES.gitTimedOut : UNKNOWN_CAUSES.gitNotRun);
  }
  if (status === 0) return { answer: 'untracked', cause: null };
  if (typeof status === 'number') return unknownBecause(UNKNOWN_CAUSES.gitExitStatus);
  return unknownBecause(typeof signal === 'string' ? UNKNOWN_CAUSES.gitStopped : UNKNOWN_CAUSES.gitNotRun);
}

/**
 * @param {string} cause - a value of UNKNOWN_CAUSES
 * @returns {{ answer: 'unknown', cause: string }}
 */
function unknownBecause(cause) {
  return { answer: 'unknown', cause };
}

/**
 * The answer of {@link judgeTrackedAreas}, without its cause.
 *
 * @param {unknown} result
 * @returns {'tracked' | 'untracked' | 'unknown'}
 */
function classifyTrackedAreas(result) {
  return judgeTrackedAreas(result).answer;
}

/**
 * Whether anything (a file, a folder, a link) stands at `target`: true, false, or null
 * when the probe failed for a reason other than absence.
 *
 * @param {string} target
 * @returns {boolean | null}
 */
function entryExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (err) {
    return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? false : null;
  }
}

/**
 * The pathspecs of `area`, or null when the leaf does not know the area. Only the own
 * names of AREA_PATHSPECS count: a name from the object prototype is no area.
 *
 * @param {unknown} area
 * @returns {readonly string[] | null}
 */
function pathspecsOf(area) {
  if (typeof area !== 'string' || !Object.prototype.hasOwnProperty.call(AREA_PATHSPECS, area)) return null;
  return AREA_PATHSPECS[/** @type {'curation' | 'memory' | 'both'} */ (area)];
}

/**
 * Whether a git call is due for `area` at `root`, and the call when it is. Makes no
 * call and starts no process: it reads only the `.git` entry at the root and the root's
 * real path. Answers one of:
 *
 *   {answer, cause}      no call is due: `untracked` (no `.git` entry at the root), or
 *                        `unknown` with a cause from UNKNOWN_CAUSES (an area the leaf does
 *                        not know, a root that is not an absolute path string, a `.git`
 *                        entry that could not be probed, a folder above the root that
 *                        holds the list separator, or a failure)
 *   {cwd, argv, env}     the call: run `git` with `argv` and `env` in `cwd` with no shell,
 *                        bound its time (TRACKED_AREAS_GIT_TIMEOUT_MS) and its output
 *                        (TRACKED_AREAS_GIT_MAX_BUFFER), and give the result to
 *                        judgeTrackedAreas
 *
 * The call is `git --no-literal-pathspecs -c core.fsmonitor=false ls-files -z -- <paths>`.
 * `--no-literal-pathspecs` leads the argv, so a forced literal-pathspec setting cannot
 * turn the magic off and hide an entry. Reading the index makes git run the command a
 * repository's config names in `core.fsmonitor`, so the call turns that off for itself and
 * stays a pure read. The folder above the root's real path is a ceiling directory
 * (trackedAreasGitEnv); a parent path that holds the list separator can not be named as
 * one, and answers `unknown`. Each answer is a new object.
 *
 * @param {unknown} root - an absolute path
 * @param {unknown} area - 'curation', 'memory' or 'both'
 * @param {NodeJS.ProcessEnv} [baseEnv] - the environment the call's own derives from (default: the process environment)
 * @returns {{ answer: 'tracked' | 'untracked' | 'unknown', cause: string | null } | { cwd: string, argv: string[], env: NodeJS.ProcessEnv }}
 */
function trackedAreaCall(root, area, baseEnv = process.env) {
  const pathspecs = pathspecsOf(area);
  if (typeof root !== 'string' || !path.isAbsolute(root)) return unknownBecause(UNKNOWN_CAUSES.rootNotAbsolute);
  if (pathspecs === null) return unknownBecause(UNKNOWN_CAUSES.checkFailed);
  try {
    const gitEntry = entryExists(path.join(root, '.git'));
    if (gitEntry === null) return unknownBecause(UNKNOWN_CAUSES.gitEntryUnreadable);
    if (gitEntry === false) return { answer: 'untracked', cause: null };
    const ceiling = path.dirname(fs.realpathSync(root));
    if (ceiling.includes(path.delimiter)) return unknownBecause(UNKNOWN_CAUSES.ceilingUnusable);
    return {
      cwd: root,
      argv: ['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...pathspecs],
      env: trackedAreasGitEnv(baseEnv, ceiling),
    };
  } catch (_) {
    return unknownBecause(UNKNOWN_CAUSES.checkFailed);
  }
}

/**
 * The time bound of one check: `options.timeoutMs` when it is a positive finite number of
 * milliseconds, otherwise TRACKED_AREAS_GIT_TIMEOUT_MS. A zero would mean no bound at all
 * to the spawn call, so it is never passed on.
 *
 * @param {unknown} options
 * @returns {number}
 */
function timeoutOf(options) {
  const timeoutMs = options !== null && typeof options === 'object' ? /** @type {{ timeoutMs?: unknown }} */ (options).timeoutMs : undefined;
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TRACKED_AREAS_GIT_TIMEOUT_MS;
}

/**
 * Whether git tracks any entry under the folders of `area` ('curation', 'memory' or 'both',
 * the union of the two) at `root`, or an entry named `.devflow` itself (a link, a gitlink or
 * a file). The index
 * decides, not the disk, and a staged entry counts. The answer carries the cause (a value
 * of UNKNOWN_CAUSES) when it is `unknown`, and null otherwise.
 *
 *   untracked  no `.git` entry at the root (no git call is made), or git listed nothing
 *   tracked    git listed an entry
 *   unknown    a `.git` entry stands and git did not answer (see judgeTrackedAreas),
 *              the `.git` entry could not be probed, the root is not an absolute path
 *              string, or the area is not one the leaf knows (no git call is made)
 *
 * The call is the one trackedAreaCall describes, run with a time bound (`options.timeoutMs`,
 * default TRACKED_AREAS_GIT_TIMEOUT_MS) and an output bound.
 *
 * @param {unknown} root - an absolute path
 * @param {unknown} area - 'curation', 'memory' or 'both'
 * @param {{ timeoutMs?: number }} [options]
 * @returns {{ answer: 'tracked' | 'untracked' | 'unknown', cause: string | null }}
 */
function inspectTrackedArea(root, area, options) {
  const call = trackedAreaCall(root, area);
  if (!('argv' in call)) return call;
  try {
    const result = childProcess.spawnSync('git', call.argv, {
      cwd: call.cwd,
      env: call.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutOf(options),
      maxBuffer: TRACKED_AREAS_GIT_MAX_BUFFER,
      windowsHide: true,
      shell: false,
    });
    return judgeTrackedAreas(result);
  } catch (_) {
    return unknownBecause(UNKNOWN_CAUSES.checkFailed);
  }
}

/**
 * The answer of {@link inspectTrackedArea}, without its cause.
 *
 * @param {unknown} root - an absolute path
 * @param {unknown} area - 'curation', 'memory' or 'both'
 * @returns {'tracked' | 'untracked' | 'unknown'}
 */
function checkTrackedArea(root, area) {
  return inspectTrackedArea(root, area).answer;
}

/** The most answers the per-process memo of inspectTrackedAreaOnce holds. */
const ANSWER_MEMO_MAX_ENTRIES = 64;

/** The answers inspectTrackedAreaOnce has given in this process, by area and root, oldest first. */
const answerMemo = new Map();

/**
 * {@link inspectTrackedArea}, asked once per root and area for the life of the process: a
 * later ask for the same root and area gets the first answer and makes no git call, even if
 * the project changed meanwhile. For a one-shot process (json-helper, the render check)
 * whose steps each ask before they read or write: together they cost one git call. A
 * long-lived caller, or one that changes what git tracks, asks inspectTrackedArea. The
 * memo holds at most ANSWER_MEMO_MAX_ENTRIES answers; past that the oldest goes. Each
 * answer is a new object.
 *
 * @param {unknown} root - an absolute path
 * @param {unknown} area - 'curation', 'memory' or 'both'
 * @returns {{ answer: 'tracked' | 'untracked' | 'unknown', cause: string | null }}
 */
function inspectTrackedAreaOnce(root, area) {
  const key = typeof root === 'string' && typeof area === 'string' ? area + '\0' + root : null;
  const known = key === null ? undefined : answerMemo.get(key);
  if (known !== undefined) return { answer: known.answer, cause: known.cause };
  const answer = inspectTrackedArea(root, area);
  if (key !== null) {
    if (answerMemo.size >= ANSWER_MEMO_MAX_ENTRIES) answerMemo.delete(answerMemo.keys().next().value);
    answerMemo.set(key, Object.freeze({ answer: answer.answer, cause: answer.cause }));
  }
  return answer;
}

/**
 * Whether git tracks any entry under the curation area's folders at `root`: the check the
 * ledger move, the backup sweep and the drains ask. {@link inspectTrackedArea} for the
 * curation area.
 *
 * @param {unknown} root - an absolute path
 * @returns {{ answer: 'tracked' | 'untracked' | 'unknown', cause: string | null }}
 */
function inspectTrackedAreas(root) {
  return inspectTrackedArea(root, 'curation');
}

/**
 * The answer of {@link inspectTrackedAreas}, without its cause.
 *
 * @param {unknown} root - an absolute path
 * @returns {'tracked' | 'untracked' | 'unknown'}
 */
function checkTrackedAreas(root) {
  return inspectTrackedAreas(root).answer;
}

module.exports = {
  TRACKED_AREA_PATHSPECS,
  MEMORY_AREA_PATHSPECS,
  AREA_PATHSPECS,
  DEVFLOW_SPELLINGS,
  GIT_REDIRECT_VARIABLES,
  TRACKED_AREAS_GIT_TIMEOUT_MS,
  TRACKED_AREAS_GIT_MAX_BUFFER,
  ANSWER_MEMO_MAX_ENTRIES,
  UNKNOWN_CAUSES,
  gitEnvWithoutRedirects,
  judgeTrackedAreas,
  classifyTrackedAreas,
  trackedAreaCall,
  inspectTrackedArea,
  inspectTrackedAreaOnce,
  checkTrackedArea,
  inspectTrackedAreas,
  checkTrackedAreas,
};
