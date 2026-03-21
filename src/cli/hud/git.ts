import { execFile } from 'node:child_process';
import type { GitStatus } from './types.js';

const GIT_TIMEOUT = 1000; // 1s per command

function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
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
  const dirty = statusOutput.length > 0;

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

  return { branch, dirty, ahead, behind, filesChanged, additions, deletions };
}

/**
 * Detect the base branch for ahead/behind calculations.
 * Uses a 3-layer fallback: branch reflog, HEAD reflog, main/master.
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

  // Layer 3: main/master fallback
  for (const candidate of ['main', 'master']) {
    const exists = await gitExec(['rev-parse', '--verify', candidate], cwd);
    if (exists) return candidate;
  }

  return null;
}
