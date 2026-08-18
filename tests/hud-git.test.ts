/**
 * Real-repo integration tests for src/hud/git.ts.
 *
 * All tests create genuine temporary git repositories so they exercise the actual
 * git command surface rather than re-implementing the logic under test as mocks.
 *
 * The vitest mock at the top intercepts execFile calls in pass-through mode so we
 * can also assert that no `gh` network call is ever issued during gatherGitStatus.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── pass-through spy on execFile ────────────────────────────────────────────
// We mock the module once, wrapping the real execFile. This lets:
//   • all git commands run for real (real repos, real results)
//   • test assertions inspect which program names were invoked
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    execFile: vi.fn(original.execFile),
  };
});

import { execFile } from 'node:child_process';
const mockedExecFile = vi.mocked(execFile);

// Import AFTER the mock is hoisted so git.ts sees the wrapped execFile.
import { gatherGitStatus } from '../src/hud/git.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: GIT_ENV,
    }).trim();
  } catch {
    return '';
  }
}

function addCommit(dir: string, filename: string): void {
  writeFileSync(join(dir, filename), filename);
  git(dir, ['add', filename]);
  git(dir, ['commit', '-m', `add ${filename}`]);
}

/** Create a local git repo with one initial commit on `main`. */
function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test.com']);
  git(dir, ['config', 'user.name', 'Test']);
  addCommit(dir, 'README.md');
  return dir;
}

/** Create a bare repo and wire it to `localDir` as `origin`. Returns the bare path. */
function addBareRemote(localDir: string): string {
  const bare = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
  git(bare, ['init', '--bare', '-b', 'main']);
  git(localDir, ['remote', 'add', 'origin', bare]);
  git(localDir, ['push', '-u', 'origin', 'main']);
  return bare;
}

// ─── temp dirs collected for cleanup ─────────────────────────────────────────
const allTempDirs: string[] = [];

afterAll(() => {
  for (const dir of allTempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ─── helper: simulate old reflog-based Layer 2 logic ─────────────────────────
/**
 * Reproduces the pre-fix Layer 2 heuristic verbatim (from src/hud/git.ts before this commit).
 * Used in the regression test to demonstrate that the old code WOULD have selected the wrong
 * base branch, while the new code selects the correct one.
 */
function oldLayer2ReflogBase(cwd: string, branch: string): string | null {
  const headLog = (() => {
    try {
      return execFileSync('git', ['-C', cwd, 'reflog', 'show', 'HEAD', '--format=%gs'], {
        encoding: 'utf8',
        env: GIT_ENV,
      }).trim();
    } catch {
      return '';
    }
  })();

  const escapedBranch = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checkoutPattern = new RegExp(`checkout: moving from (\\S+) to ${escapedBranch}`);
  for (const line of headLog.split('\n')) {
    const match = line.match(checkoutPattern);
    if (match) {
      const candidate = match[1];
      if (candidate === branch || /^[0-9a-f]{7,}$/.test(candidate)) continue;
      const exists = (() => {
        try {
          execFileSync('git', ['-C', cwd, 'rev-parse', '--verify', candidate], {
            encoding: 'utf8',
            env: GIT_ENV,
          });
          return true;
        } catch {
          return false;
        }
      })();
      if (exists) return candidate;
    }
  }
  return null;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('gatherGitStatus — base branch resolution', () => {
  describe('(a) origin/HEAD is set (git clone / git remote set-head)', () => {
    let dir: string;

    beforeAll(() => {
      dir = createRepo();
      allTempDirs.push(dir);
      allTempDirs.push(addBareRemote(dir));
      // Explicitly set origin/HEAD, mirroring what git clone does.
      git(dir, ['remote', 'set-head', 'origin', 'main']);
      // Feature branch with 3 commits (3 files).
      git(dir, ['checkout', '-b', 'feat/layer-a']);
      addCommit(dir, 'layer-a-1.txt');
      addCommit(dir, 'layer-a-2.txt');
      addCommit(dir, 'layer-a-3.txt');
    });

    it('resolves base to origin/main via symbolic-ref', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      expect(status?.branch).toBe('feat/layer-a');
      expect(status?.filesChanged).toBe(3);
      expect(status?.ahead).toBe(3);
      expect(status?.behind).toBe(0);
    });
  });

  describe('(b) origin/HEAD absent but origin/main exists', () => {
    let dir: string;

    beforeAll(() => {
      dir = createRepo();
      allTempDirs.push(dir);
      // addBareRemote uses `git push -u` but does NOT call remote set-head.
      allTempDirs.push(addBareRemote(dir));
      git(dir, ['checkout', '-b', 'feat/layer-b']);
      addCommit(dir, 'layer-b-1.txt');
      addCommit(dir, 'layer-b-2.txt');
    });

    it('origin/HEAD is absent (confirming the test scenario)', () => {
      const symRef = git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      expect(symRef).toBe('');
    });

    it('resolves base to origin/main by scanning remote refs', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      expect(status?.filesChanged).toBe(2);
      expect(status?.ahead).toBe(2);
    });
  });

  describe('(c) no remote at all — fall back to local main', () => {
    let dir: string;

    beforeAll(() => {
      dir = createRepo(); // no addBareRemote — purely local
      allTempDirs.push(dir);
      git(dir, ['checkout', '-b', 'feat/layer-c']);
      addCommit(dir, 'layer-c-1.txt');
    });

    it('resolves base to local main', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      expect(status?.filesChanged).toBe(1);
      expect(status?.ahead).toBe(1);
    });
  });

  describe('(d) nothing resolves — degrade gracefully', () => {
    let dir: string;

    beforeAll(() => {
      // Repo whose only branch has a name not in the main/master/develop/trunk fallback list.
      dir = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dir);
      git(dir, ['init', '-b', 'orphan-xyz']);
      git(dir, ['config', 'user.email', 'test@test.com']);
      git(dir, ['config', 'user.name', 'Test']);
      addCommit(dir, 'init.txt');
    });

    it('returns status with filesChanged === 0 and no crash', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      expect(status?.filesChanged).toBe(0);
      expect(status?.ahead).toBe(0);
    });
  });

  describe('current branch IS the default branch', () => {
    let dir: string;

    beforeAll(() => {
      dir = createRepo();
      allTempDirs.push(dir);
      allTempDirs.push(addBareRemote(dir));
      // Add 2 commits locally — not pushed — to create ahead count.
      addCommit(dir, 'unpushed-1.txt');
      addCommit(dir, 'unpushed-2.txt');
      // Stay on main
    });

    it('compares against origin/main to show unpushed commits', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      expect(status?.branch).toBe('main');
      expect(status?.ahead).toBe(2);
      expect(status?.filesChanged).toBe(2);
    });
  });
});

describe('gatherGitStatus — regression: fast-forwarded branch in reflog', () => {
  /**
   * Regression scenario that produced the wave/agent-roster bug:
   *
   *   main: A (1 file = README.md), pushed to origin
   *   wave/big: branches from A, adds 6 files (D, E, F, G, H, I)
   *   feature/old: a branch pointer set to commit F (mid-way through wave/big)
   *                F is an ancestor of wave/big — it was "fast-forwarded in"
   *
   *   Checkout sequence: wave/big → feature/old → wave/big
   *   This seeds the HEAD reflog with "checkout: moving from feature/old to wave/big".
   *
   * OLD code (Layer 2 reflog heuristic):
   *   Finds "moving from feature/old to wave/big" in HEAD reflog.
   *   feature/old exists and its tip is an ancestor of wave/big.
   *   git diff feature/old (working tree vs its tip) shows only 3 files (G, H, I — after F).
   *   BUG: reports 3 files instead of the correct 6.
   *
   * NEW code (deterministic default-branch detection):
   *   Ignores reflog entirely → picks origin/main.
   *   git merge-base origin/main HEAD = commit A.
   *   git diff A (working tree vs A) shows all 6 files (D, E, F, G, H, I).
   *   CORRECT: reports 6 files.
   */
  let dir: string;
  let featureOldSha: string; // SHA of commit F (where feature/old points)

  beforeAll(() => {
    dir = createRepo(); // creates README.md on main, pushed to origin via addBareRemote
    allTempDirs.push(dir);
    allTempDirs.push(addBareRemote(dir));

    // wave/big: 6 commits on top of main
    git(dir, ['checkout', '-b', 'wave/big']);
    addCommit(dir, 'big-d.txt');
    addCommit(dir, 'big-e.txt');
    addCommit(dir, 'big-f.txt');
    featureOldSha = git(dir, ['rev-parse', 'HEAD']); // commit F — 3 files deep into wave/big
    addCommit(dir, 'big-g.txt');
    addCommit(dir, 'big-h.txt');
    addCommit(dir, 'big-i.txt');

    // feature/old: points to commit F (an ancestor of wave/big's tip — "fast-forwarded in").
    git(dir, ['branch', 'feature/old', featureOldSha]);

    // Simulate the misleading checkout sequence that seeds the HEAD reflog:
    //   "checkout: moving from feature/old to wave/big"
    git(dir, ['checkout', 'feature/old']);
    git(dir, ['checkout', 'wave/big']);
  });

  it('HEAD reflog contains the misleading entry (verifying the scenario is real)', () => {
    const reflog = git(dir, ['reflog', 'show', 'HEAD', '--format=%gs']);
    const hasEntry = reflog
      .split('\n')
      .some(l => l.includes('checkout: moving from feature/old to wave/big'));
    expect(hasEntry).toBe(true);
  });

  it('old reflog heuristic (Layer 2) would have selected the WRONG base', () => {
    // Demonstrate what the pre-fix code would return.
    const wrongBase = oldLayer2ReflogBase(dir, 'wave/big');
    expect(wrongBase).toBe('feature/old');

    // feature/old's tip IS an ancestor of wave/big (it was fast-forwarded in).
    const mergeBaseWithWrong = git(dir, ['merge-base', 'feature/old', 'HEAD']);
    expect(mergeBaseWithWrong).toBe(featureOldSha);

    // Diff against feature/old shows only the 3 commits AFTER F (G, H, I).
    const wrongDiff = git(dir, ['diff', '--shortstat', featureOldSha]);
    const wrongFileCount = Number(wrongDiff.match(/(\d+)\s+file/)?.[1] ?? 0);
    expect(wrongFileCount).toBe(3); // only G, H, I — the bug that produced "3 instead of 119"
  });

  it('new code picks origin/main and reports the FULL 6-file surface (red→green)', async () => {
    // This is the regression assertion. Against the OLD implementation, this test would
    // fail (filesChanged would be 3). Against the new code it must pass with 6.
    const status = await gatherGitStatus(dir);
    expect(status).not.toBeNull();
    expect(status?.branch).toBe('wave/big');
    expect(status?.filesChanged).toBe(6); // D, E, F, G, H, I — the full branch surface
    expect(status?.ahead).toBe(6);
    expect(status?.behind).toBe(0);
  });
});

describe('gatherGitStatus — worktree equivalence', () => {
  /**
   * Verifies that gatherGitStatus gives correct results when called from a linked
   * worktree directory. The old reflog-based code could give different results across
   * worktrees because logs/HEAD is per-worktree. The new code uses origin/main (a
   * remote ref), which is worktree-path-independent.
   */
  let primaryDir: string;
  let worktreeDir: string;

  beforeAll(() => {
    primaryDir = createRepo();
    allTempDirs.push(primaryDir);
    allTempDirs.push(addBareRemote(primaryDir));

    // Create the feature branch and populate it, then switch primary back to main.
    // git worktree add requires the branch not be checked out in any other worktree.
    git(primaryDir, ['checkout', '-b', 'feat/worktree-test']);
    addCommit(primaryDir, 'wt-a.txt');
    addCommit(primaryDir, 'wt-b.txt');
    git(primaryDir, ['checkout', 'main']); // free the branch for worktree add

    worktreeDir = mkdtempSync(join(tmpdir(), 'devflow-hud-git-wt-'));
    allTempDirs.push(worktreeDir);
    git(primaryDir, ['worktree', 'add', worktreeDir, 'feat/worktree-test']);
  });

  it('linked worktree gives correct filesChanged for its branch', async () => {
    const linked = await gatherGitStatus(worktreeDir);
    expect(linked).not.toBeNull();
    expect(linked?.branch).toBe('feat/worktree-test');
    // 2 files added on feat/worktree-test relative to main/origin/main
    expect(linked?.filesChanged).toBe(2);
    expect(linked?.ahead).toBe(2);
  });

  it('primary worktree (on main) is independent of the linked worktree state', async () => {
    // Primary is on main — pushed to origin → 0 ahead, 0 diff
    const primary = await gatherGitStatus(primaryDir);
    expect(primary).not.toBeNull();
    expect(primary?.branch).toBe('main');
    expect(primary?.filesChanged).toBe(0);
    expect(primary?.ahead).toBe(0);
  });
});

describe('gatherGitStatus — edge cases', () => {
  describe('detached HEAD', () => {
    let dir: string;

    beforeAll(() => {
      dir = createRepo();
      allTempDirs.push(dir);
      addCommit(dir, 'extra.txt');
      // Detach HEAD to the first commit.
      const firstSha = git(dir, ['rev-parse', 'HEAD~1']);
      git(dir, ['checkout', firstSha]);
    });

    it('returns a result with branch === HEAD and no crash', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      // Detached HEAD — branch field is the literal string 'HEAD'
      expect(status?.branch).toBe('HEAD');
      // No base branch comparison in detached state
      expect(status?.filesChanged).toBe(0);
      expect(status?.ahead).toBe(0);
    });
  });

  describe('no remote configured', () => {
    let dir: string;

    beforeAll(() => {
      dir = createRepo(); // no addBareRemote — purely local
      allTempDirs.push(dir);
      git(dir, ['checkout', '-b', 'feat/no-remote']);
      addCommit(dir, 'no-remote.txt');
    });

    it('falls back to local main and does not crash', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      expect(status?.filesChanged).toBe(1);
    });
  });

  describe('no origin/HEAD symbolic ref', () => {
    let dir: string;

    beforeAll(() => {
      dir = createRepo();
      allTempDirs.push(dir);
      allTempDirs.push(addBareRemote(dir));
      // Do NOT call remote set-head — origin/HEAD is absent (common with git remote add + push).
      git(dir, ['checkout', '-b', 'feat/no-origin-head']);
      addCommit(dir, 'noh-1.txt');
    });

    it('origin/HEAD is confirmed absent', () => {
      const symRef = git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      expect(symRef).toBe('');
    });

    it('falls back to scanning origin/main and does not crash', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).not.toBeNull();
      expect(status?.filesChanged).toBe(1);
    });
  });

  describe('brand-new repo with no commits', () => {
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'devflow-hud-git-empty-'));
      allTempDirs.push(dir);
      git(dir, ['init', '-b', 'main']);
      git(dir, ['config', 'user.email', 'test@test.com']);
      git(dir, ['config', 'user.name', 'Test']);
      // No commits — HEAD is unborn
    });

    it('returns null gracefully (no commits yet)', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).toBeNull();
    });
  });

  describe('not a git repo at all', () => {
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'devflow-hud-git-notgit-'));
      allTempDirs.push(dir);
      // Plain directory — no git init
    });

    it('returns null without throwing', async () => {
      const status = await gatherGitStatus(dir);
      expect(status).toBeNull();
    });
  });
});

describe('gatherGitStatus — diff and ahead/behind share reference point', () => {
  let dir: string;

  beforeAll(() => {
    dir = createRepo();
    allTempDirs.push(dir);
    allTempDirs.push(addBareRemote(dir));

    // main: 1 file (README.md). Feature branch adds 3 more.
    git(dir, ['checkout', '-b', 'feat/reference-point']);
    addCommit(dir, 'rp-1.txt');
    addCommit(dir, 'rp-2.txt');
    addCommit(dir, 'rp-3.txt');
  });

  it('ahead count equals number of commits on feature branch', async () => {
    const status = await gatherGitStatus(dir);
    expect(status?.ahead).toBe(3);
    expect(status?.behind).toBe(0);
  });

  it('filesChanged matches the number of files added on feature branch', async () => {
    const status = await gatherGitStatus(dir);
    expect(status?.filesChanged).toBe(3);
  });

  it('diff and ahead/behind agree on reference point', async () => {
    // Both ahead/behind and diff use origin/main as their base.
    // On a linear history, merge-base IS the tip of origin/main.
    const mainSha = git(dir, ['rev-parse', 'origin/main']);
    const mergeBase = git(dir, ['merge-base', 'origin/main', 'HEAD']);
    expect(mergeBase).toBe(mainSha);

    // Manual diff count against merge base must match gatherGitStatus.
    const rawDiff = git(dir, ['diff', '--shortstat', mergeBase]);
    const manualFiles = Number(rawDiff.match(/(\d+)\s+file/)?.[1] ?? 0);

    const status = await gatherGitStatus(dir);
    expect(status?.filesChanged).toBe(manualFiles);
  });
});

describe('gatherGitStatus — no gh network call on render path', () => {
  let dir: string;

  beforeAll(() => {
    dir = createRepo();
    allTempDirs.push(dir);
    allTempDirs.push(addBareRemote(dir));
    git(dir, ['checkout', '-b', 'feat/no-gh']);
    addCommit(dir, 'no-gh.txt');
  });

  it('never invokes gh during gatherGitStatus', async () => {
    mockedExecFile.mockClear();
    await gatherGitStatus(dir);

    const ghCalls = mockedExecFile.mock.calls.filter(([cmd]) => cmd === 'gh');
    expect(ghCalls).toHaveLength(0);
  });
});
