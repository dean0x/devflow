import { execFile } from 'node:child_process';
import type { GitStatus } from './types.js';

const GIT_TIMEOUT = 1000; // 1s per command

function shellExec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: GIT_TIMEOUT }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

function gitExec(args: string[], cwd: string): Promise<string> {
  return shellExec('git', args, cwd);
}

/**
 * Gather git status for the given working directory.
 * Returns null if not in a git repo or on error.
 */
export async function gatherGitStatus(cwd: string): Promise<GitStatus | null> {
  // Check if in a git repo
  const topLevel = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (!topLevel) return null;

  // Branch name — 'HEAD' means detached HEAD state
  const branch = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (!branch) return null;

  // Dirty check
  const statusOutput = await gitExec(
    ['status', '--porcelain', '--no-optional-locks'],
    cwd,
  );
  let dirty = false;
  let staged = false;
  for (const line of statusOutput.split('\n')) {
    if (line.length < 2) continue;
    const index = line[0];
    const worktree = line[1];
    // Index column: staged change (A/M/D/R/C)
    if (index !== ' ' && index !== '?') staged = true;
    // Worktree column: unstaged change (M/D), or untracked (??)
    if (worktree !== ' ' || index === '?') dirty = true;
  }

  let ahead = 0;
  let behind = 0;
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;

  // Detached HEAD ('HEAD') has no branch reference to compare against — skip ahead/behind and diff.
  if (branch !== 'HEAD') {
    const baseRef = await detectBaseBranch(branch, cwd);
    if (baseRef) {
      // Ahead/behind: three-dot range is merge-base-equivalent (commit count only, no working tree).
      const revList = await gitExec(
        ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`],
        cwd,
      );
      const parts = revList.split(/\s+/);
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10) || 0;
        ahead = parseInt(parts[1], 10) || 0;
      }

      // Diff stats: resolve the explicit merge base so the diff covers only this branch's changes
      // relative to the default branch. git diff --shortstat <mergeBase> compares the working tree
      // against the merge base, intentionally including uncommitted working-tree changes in the figure.
      // NOTE: diff includes the working tree; ahead/behind counts commits only. This asymmetry is
      // deliberate — both reference the same merge base but differ in working-tree inclusion.
      const mergeBase = await gitExec(['merge-base', baseRef, 'HEAD'], cwd);
      if (mergeBase) {
        const diffStat = await gitExec(['diff', '--shortstat', mergeBase], cwd);
        const filesMatch = diffStat.match(/(\d+)\s+file/);
        const addMatch = diffStat.match(/(\d+)\s+insertion/);
        const delMatch = diffStat.match(/(\d+)\s+deletion/);
        filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
        additions = addMatch ? parseInt(addMatch[1], 10) : 0;
        deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
      }
    }
  }

  // Tag and worktree info (parallel)
  const [tagOutput, worktreeOutput] = await Promise.all([
    gitExec(['describe', '--tags', '--abbrev=0'], cwd),
    gitExec(['worktree', 'list'], cwd),
  ]);

  const lastTag = tagOutput || null;
  let commitsSinceTag = 0;
  if (lastTag) {
    const countOutput = await gitExec(['rev-list', `${lastTag}..HEAD`, '--count'], cwd);
    commitsSinceTag = parseInt(countOutput, 10) || 0;
  }

  const worktreeCount = worktreeOutput
    ? worktreeOutput.split('\n').filter(l => l.trim().length > 0).length
    : 1;

  return {
    branch,
    dirty,
    staged,
    ahead,
    behind,
    filesChanged,
    additions,
    deletions,
    lastTag,
    commitsSinceTag,
    worktreeCount,
  };
}

/**
 * Detect the base (default) branch for this repository deterministically, with no
 * network call.
 *
 * Resolution order:
 *   (a) git symbolic-ref --short refs/remotes/origin/HEAD — authoritative when set by
 *       `git clone` or `git remote set-head`. Absence is common (only set by those two
 *       operations) and is treated as a normal fallback, not an error.
 *   (b) First of origin/main, origin/master, origin/develop, origin/trunk that exists as a ref.
 *   (c) No remote configured — first of main, master, develop, trunk that exists locally.
 *   (d) Nothing resolves — return null; caller renders the counter absent rather than wrong.
 *       Rendering nothing is strictly better than rendering a confidently wrong number.
 *
 * When the current branch IS the detected default branch, returns origin/<branch> so the
 * counter reflects unpushed commits rather than a zero diff (correct existing behaviour).
 */
async function detectBaseBranch(branch: string, cwd: string): Promise<string | null> {
  // (a) Authoritative when present: set by git clone or git remote set-head.
  //     Absence is common — do not treat as exceptional, just fall through.
  const originHead = await gitExec(
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    cwd,
  );
  if (originHead) {
    const exists = await gitExec(['rev-parse', '--verify', originHead], cwd);
    if (exists) return applyDefaultBranchRule(branch, originHead, cwd);
  }

  // (b) Scan common remote branch names when origin/HEAD is absent.
  for (const candidate of ['origin/main', 'origin/master', 'origin/develop', 'origin/trunk']) {
    const exists = await gitExec(['rev-parse', '--verify', candidate], cwd);
    if (exists) return applyDefaultBranchRule(branch, candidate, cwd);
  }

  // (c) No remote configured — fall back to local default branches.
  for (const candidate of ['main', 'master', 'develop', 'trunk']) {
    if (candidate === branch) continue; // Never compare a branch against itself
    const exists = await gitExec(['rev-parse', '--verify', candidate], cwd);
    if (exists) return candidate;
  }

  // (d) Cannot determine base — degrade gracefully; caller renders counter as absent.
  return null;
}

/**
 * Given a detected default remote ref (e.g. "origin/main"), return the ref to use for
 * comparisons. When the current branch IS the default branch, compares against the remote
 * tracking ref so the status line shows unpushed commits rather than a zero diff.
 */
async function applyDefaultBranchRule(
  branch: string,
  defaultRef: string,
  cwd: string,
): Promise<string> {
  const defaultShort = defaultRef.replace(/^origin\//, '');
  if (branch === defaultShort) {
    // We ARE on the default branch — compare against origin/<branch> for unpushed-commit count.
    const tracking = await gitExec(['rev-parse', '--verify', `origin/${branch}`], cwd);
    return tracking ? `origin/${branch}` : defaultRef;
  }
  return defaultRef;
}
