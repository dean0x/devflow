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

  // Branch name
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

  // Ahead/behind — detect base branch with layered fallback (ported from statusline.sh)
  const baseBranch = await detectBaseBranch(branch, cwd);
  let ahead = 0;
  let behind = 0;
  if (baseBranch) {
    const revList = await gitExec(
      ['rev-list', '--left-right', '--count', `${baseBranch}...HEAD`],
      cwd,
    );
    const parts = revList.split(/\s+/);
    if (parts.length === 2) {
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }
  }

  // Diff stats against base
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;
  if (baseBranch) {
    const diffStat = await gitExec(['diff', '--shortstat', baseBranch], cwd);
    const filesMatch = diffStat.match(/(\d+)\s+file/);
    const addMatch = diffStat.match(/(\d+)\s+insertion/);
    const delMatch = diffStat.match(/(\d+)\s+deletion/);
    filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
    additions = addMatch ? parseInt(addMatch[1], 10) : 0;
    deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
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
 * Detect the base branch for ahead/behind calculations.
 * Uses a 4-layer fallback (ported from statusline.sh):
 *   1. Branch reflog ("Created from")
 *   2. HEAD reflog ("checkout: moving from X to branch")
 *   3. GitHub PR base branch (gh pr view, cached)
 *   4. main/master fallback
 */
async function detectBaseBranch(
  branch: string,
  cwd: string,
): Promise<string | null> {
  // Layer 1: branch reflog — look for "branch: Created from"
  const branchLog = await gitExec(
    ['reflog', 'show', branch, '--format=%gs', '-n', '1'],
    cwd,
  );
  const createdMatch = branchLog.match(/branch: Created from (.+)/);
  if (createdMatch) {
    const candidate = createdMatch[1];
    if (candidate !== 'HEAD' && !candidate.includes('~')) {
      const exists = await gitExec(
        ['rev-parse', '--verify', candidate],
        cwd,
      );
      if (exists) return candidate;
    }
  }

  // Layer 2: HEAD reflog — look for "checkout: moving from X to branch"
  const headLog = await gitExec(
    ['reflog', 'show', 'HEAD', '--format=%gs'],
    cwd,
  );
  const escapedBranch = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checkoutPattern = new RegExp(
    `checkout: moving from (\\S+) to ${escapedBranch}`,
  );
  for (const line of headLog.split('\n')) {
    const match = line.match(checkoutPattern);
    if (match) {
      const candidate = match[1];
      if (candidate !== branch) {
        const exists = await gitExec(
          ['rev-parse', '--verify', candidate],
          cwd,
        );
        if (exists) return candidate;
      }
    }
  }

  // Layer 3: GitHub PR base branch via gh CLI
  const prBase = await shellExec(
    'gh', ['pr', 'view', '--json', 'baseRefName', '-q', '.baseRefName'],
    cwd,
  );
  if (prBase) {
    const exists = await gitExec(['rev-parse', '--verify', prBase], cwd);
    if (exists) return prBase;
  }

  // Layer 4: main/master fallback
  for (const candidate of ['main', 'master']) {
    const exists = await gitExec(['rev-parse', '--verify', candidate], cwd);
    if (exists) return candidate;
  }

  return null;
}
