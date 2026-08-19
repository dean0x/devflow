import { execFile } from 'node:child_process';
import { isTrunkBranch } from '../core/git.js';
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

  // Dirty check — porcelain v1: two-char XY status prefix per path.
  // Note: --no-optional-locks is not supported on Apple git and causes the command to
  // exit non-zero (returning empty string from shellExec). Omit it for portability.
  const statusOutput = await gitExec(
    ['status', '--porcelain'],
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
      // rev-list and merge-base are independent — run in parallel.
      // Ahead/behind: three-dot range is merge-base-equivalent (commit count only, no working tree).
      const [revList, mergeBase] = await Promise.all([
        gitExec(['rev-list', '--left-right', '--count', `${baseRef}...HEAD`], cwd),
        gitExec(['merge-base', baseRef, 'HEAD'], cwd),
      ]);

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
 * Resolve the comparison ref for a given branch, using a pre-built Set of known refs.
 *
 * CONTRACT: when the current branch IS the repo's default branch, or is any
 * canonical trunk branch (per isTrunkBranch), and origin/<branch> exists as a
 * remote ref, compare against origin/<branch> so the status line shows unpushed
 * commits rather than a zero diff.
 *
 * Do NOT use @{upstream} for all branches — pushed feature branches would
 * self-compare (rev-list A...A = 0 ahead/behind) and the HUD would render nothing
 * useful. The trunk-name predicate is the correct discriminant: feature branches
 * compare against the repo default; trunk branches compare against themselves.
 *
 * This function is pure/sync — the refs Set answers existence without spawning.
 * Called from all three remote detection layers so the trunk-self-compare rule
 * applies consistently regardless of how the default branch was discovered.
 */
function resolveComparisonRef(
  branch: string,
  defaultRef: string,
  refs: Set<string>,
): string {
  const defaultShort = defaultRef.replace(/^origin\//, '');
  if ((branch === defaultShort || isTrunkBranch(branch)) && refs.has(`origin/${branch}`)) {
    return `origin/${branch}`;
  }
  return defaultRef;
}

/**
 * Detect the base (default) branch for this repository using exactly two git spawns.
 *
 * Resolution order:
 *   (a) git symbolic-ref --short refs/remotes/origin/HEAD — authoritative when set by
 *       `git clone` or `git remote set-head`. Absence is common (only set by those two
 *       operations) and is treated as a normal fallback, not an error.
 *   (b) First of origin/main, origin/master, origin/develop, origin/trunk that exists
 *       as a ref in the fetched Set.
 *   (c) No remote configured — first of main, master, develop, trunk that exists
 *       locally (in the fetched Set). Never compare a branch against itself.
 *   (d) Nothing resolves — return null; caller renders the counter absent rather than
 *       wrong. Rendering nothing is strictly better than a confidently wrong number.
 *
 * Both spawns run in parallel:
 *   1. git symbolic-ref --short refs/remotes/origin/HEAD
 *   2. git for-each-ref --format=%(refname:short) refs/heads/ refs/remotes/origin/
 *      → builds a Set<string> of all known local and remote branch names.
 *
 * The Set answers all existence queries (layers a–c) without additional spawns.
 * This replaces the previous design of up to 11 sequential git rev-parse calls.
 *
 * resolveComparisonRef is called from all three remote layers to ensure that any
 * canonical trunk branch (develop, staging, production, release/*) self-compares
 * against origin/<branch> when that ref exists — fixing the prior asymmetry where
 * only the single detected default branch (e.g. 'main') got this treatment.
 *
 * Note on tag-DWIM: for-each-ref limits scope to refs/heads/ and refs/remotes/origin/,
 * so tag objects never appear in the Set. The prior design used git rev-parse --verify
 * which can DWIM-expand names to tags; this approach is stricter.
 */
async function detectBaseBranch(branch: string, cwd: string): Promise<string | null> {
  // Two parallel spawns replace the previous ≤11 sequential rev-parse calls.
  const [originHead, refsOutput] = await Promise.all([
    gitExec(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd),
    gitExec(
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/origin/'],
      cwd,
    ),
  ]);

  const refs = new Set(refsOutput ? refsOutput.split('\n').filter(Boolean) : []);

  // (a) Authoritative when present: set by git clone or git remote set-head.
  //     Absence is common — do not treat as exceptional, just fall through.
  if (originHead && refs.has(originHead)) {
    return resolveComparisonRef(branch, originHead, refs);
  }

  // (b) Scan common remote branch names when origin/HEAD is absent.
  for (const candidate of ['origin/main', 'origin/master', 'origin/develop', 'origin/trunk']) {
    if (refs.has(candidate)) {
      return resolveComparisonRef(branch, candidate, refs);
    }
  }

  // (c) No remote configured — fall back to local default branches.
  for (const candidate of ['main', 'master', 'develop', 'trunk']) {
    if (candidate === branch) continue; // Never compare a branch against itself
    if (refs.has(candidate)) {
      return candidate;
    }
  }

  // (d) Cannot determine base — degrade gracefully; caller renders counter as absent.
  return null;
}
