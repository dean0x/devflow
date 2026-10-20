// src/assets/scripts/hooks/lib/tracked-areas.cjs
//
// Does git track any entry under one of devflow's data folders at a root? One
// `git ls-files` call over a fixed set of pathspecs answers `tracked`, `untracked` or
// `unknown`. The one-time ledger move asks it before it locks, reads or renames
// anything: a folder that git tracks is the repository's content, so the move leaves
// it alone.
//
// DESIGN: a leaf. It loads node built-ins only and requires neither the store nor the
// move module (the move requires the store; the store never requires the move), so
// either of them, and a later check for another folder, can use it. No function here
// prints or exits, and nothing throws: every failure is the answer `unknown`.
//
// The folders are listed once, in AREA_FOLDERS. A later change adds a folder there.
//
// The decision is the repository's index, never the disk. A root with no `.git` entry
// (a file or a folder) is not a git working tree and gets no git call. A root with one
// gets exactly one call, and every failure of that call (git missing, a timeout, a
// non-zero exit with nothing listed) is `unknown`: the caller cannot tell what git
// tracks and must change nothing. git's error text is never read.

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

/** The folders under `.devflow` that the check covers. */
const AREA_FOLDERS = Object.freeze(['learning', 'curation']);

/**
 * The spellings a case-folding file system opens as `.devflow` beyond ASCII letter case.
 * git's `icase` folds ASCII letters only, but APFS (the macOS default) compares names by
 * full Unicode case folding, so it also opens `.devﬂow` (U+FB02 folds to "fl"). The code
 * is written with an escape, so the code point is named.
 */
const DEVFLOW_SPELLINGS = Object.freeze(['.devflow', '.dev\u{FB02}ow']);

/**
 * The pathspecs of the check, each matched without regard to ASCII letter case, whatever
 * the file system or `core.ignorecase`, and each spelled every way DEVFLOW_SPELLINGS lists:
 *   - each folder of AREA_FOLDERS, as a literal path: an index entry at the folder, or
 *     anywhere below it, matches
 *   - an index entry named `.devflow` ITSELF, which git records only for a symlink, a
 *     gitlink (submodule) or a plain file, never for a directory: the character class
 *     keeps `glob` from matching as a leading directory, so the many files under a
 *     normal `.devflow/` are not listed. Committed content then stands at the path where
 *     the folders are opened.
 */
const TRACKED_AREA_PATHSPECS = Object.freeze([
  ...DEVFLOW_SPELLINGS.flatMap(dir => AREA_FOLDERS.map(area => ':(icase,literal)' + dir + '/' + area)),
  ...DEVFLOW_SPELLINGS.map(dir => ':(icase,glob)[.]' + dir.slice(1)),
]);

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
 * The environment of the git call: the process environment without the redirecting
 * variables, with a fixed locale and no optional lock. Answers a new object.
 *
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
function trackedAreasGitEnv(base) {
  const env = { ...base };
  for (const name of GIT_REDIRECT_VARIABLES) delete env[name];
  env.LC_ALL = 'C';
  env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}

/**
 * The answer of one `git ls-files` call, from the result `spawnSync` gave:
 *   tracked    any output byte, whatever the exit status or error (the call listed an
 *              entry), and an output past the buffer cap (ENOBUFS)
 *   untracked  exit 0 with nothing listed
 *   unknown    every other result: a spawn error, a timeout, a signal, a non-zero exit
 *              with nothing listed, or a result of the wrong shape
 * Pure: it reads only the fields `error.code`, `status` and `stdout`.
 *
 * @param {unknown} result
 * @returns {'tracked' | 'untracked' | 'unknown'}
 */
function classifyTrackedAreas(result) {
  if (result === null || typeof result !== 'object') return 'unknown';
  const { error, status, stdout } = /** @type {{ error?: { code?: unknown }, status?: unknown, stdout?: unknown }} */ (result);
  if (error && error.code === 'ENOBUFS') return 'tracked';
  const listed = (typeof stdout === 'string' || Buffer.isBuffer(stdout)) && stdout.length > 0;
  if (listed) return 'tracked';
  if (error || status !== 0) return 'unknown';
  return 'untracked';
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
 * Whether git tracks any entry under the covered folders at `root`, or an entry named
 * `.devflow` itself (a link, a gitlink or a file). The index decides, not the disk, and
 * a staged entry counts.
 *
 *   untracked  no `.git` entry at the root (no git call is made), or git listed nothing
 *   tracked    git listed an entry
 *   unknown    a `.git` entry stands and git did not answer (see classifyTrackedAreas),
 *              or the `.git` entry could not be probed
 *
 * The call is `git --no-literal-pathspecs -c core.fsmonitor=false ls-files -z -- <paths>`
 * with the root as its working directory: an argv with no shell, a time bound and an
 * output bound. `--no-literal-pathspecs` leads the argv, so a forced literal-pathspec
 * setting cannot turn the magic off and hide an entry. Reading the index makes git run
 * the command a repository's config names in `core.fsmonitor`, so the call turns that off
 * for itself and stays a pure read.
 *
 * @param {string} root - an absolute path
 * @returns {'tracked' | 'untracked' | 'unknown'}
 */
function checkTrackedAreas(root) {
  const gitEntry = entryExists(path.join(root, '.git'));
  if (gitEntry === null) return 'unknown';
  if (gitEntry === false) return 'untracked';
  try {
    const result = childProcess.spawnSync('git', ['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...TRACKED_AREA_PATHSPECS], {
      cwd: root,
      env: trackedAreasGitEnv(process.env),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: TRACKED_AREAS_GIT_TIMEOUT_MS,
      maxBuffer: TRACKED_AREAS_GIT_MAX_BUFFER,
      windowsHide: true,
      shell: false,
    });
    return classifyTrackedAreas(result);
  } catch (_) {
    return 'unknown';
  }
}

module.exports = {
  TRACKED_AREA_PATHSPECS,
  classifyTrackedAreas,
  checkTrackedAreas,
};
