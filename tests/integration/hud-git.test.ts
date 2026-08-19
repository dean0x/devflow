/**
 * Real-repo integration tests for src/hud/git.ts.
 *
 * All tests create genuine temporary git repositories so they exercise the actual
 * git command surface rather than re-implementing the logic under test as mocks.
 *
 * The vitest mock at the top intercepts execFile calls in pass-through mode so we
 * can also assert that no `gh` network call is ever issued during gatherGitStatus.
 *
 * Fixture strategy:
 *   • Repos are built ONCE per shape in a single module-level beforeAll, and shared
 *     across describe blocks that need the same shape (describe (a) + diff/ahead-behind
 *     share dirA; describe (c) + edge "no remote configured" share dirNoRemote;
 *     edge "no origin/HEAD symref" + "no gh network call" share dirNoOriginHead1).
 *
 *   • All 11 shape IIFEs launch concurrently in one Promise.all. Git calls are
 *     unserialized; concurrent setup completes in under a second.
 *
 *   • One exception: the "no gh network call" test must call gatherGitStatus live so it
 *     can observe mockedExecFile.mock.calls. It does so after mockClear(), isolated from
 *     the pre-computation results.
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
    execFile: vi.fn(function passThrough(
      file: string,
      args: string[],
      options: object,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (original.execFile as any)(file, args, options, cb);
    // Cast bridges void → ChildProcess; callers never use the return value.
    }) as unknown as typeof original.execFile,
  };
});

import { execFile } from 'node:child_process';
const mockedExecFile = vi.mocked(execFile);

// Import AFTER the mock is hoisted so git.ts sees the wrapped execFile.
import { gatherGitStatus } from '../../src/hud/git.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
  GIT_CONFIG_NOSYSTEM: '1',
  // Suppress global git config — a real ~/.gitconfig with commit.gpgsign=true or
  // core.hooksPath can silently break every fixture; gitAsync swallows errors so the
  // suite stays green by local-config luck rather than design. /dev/null is an empty
  // config that satisfies git's "user.email required for commits" path via env vars.
  GIT_CONFIG_GLOBAL: '/dev/null',
};

// Async git helper for concurrent shape setup.
// Uses execFile (non-blocking) so multiple shapes can run git calls simultaneously.
// GIT_AUTHOR_*/GIT_COMMITTER_* env vars make explicit `git config` calls unnecessary.
function gitAsync(cwd: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve) => {
    execFile('git', args, { cwd, env: GIT_ENV }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

// Async addCommit for use in concurrent shape setup.
async function addCommitAsync(dir: string, filename: string): Promise<void> {
  writeFileSync(join(dir, filename), filename);
  await gitAsync(dir, ['add', filename]);
  await gitAsync(dir, ['commit', '-m', `add ${filename}`]);
}

// Sync git helper retained for test bodies, which run after beforeAll completes
// (zero subprocess pressure at that point) and for oldLayer2ReflogBase.
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

// ─── module-level fixture variables ──────────────────────────────────────────
//
// Repos — one per distinct shape; several describes share a single repo.
//
// Shape A — remote + origin/HEAD set + feat/layer-a with 3 commits.
//           Shared by: describe (a) and describe "diff and ahead/behind".
let dirA: string;

// Shape B — remote + NO origin/HEAD + feat/layer-b with 2 commits.
//           Used by: describe (b).
let dirB: string;

// Shape C — no remote + feat/no-remote with 1 commit.
//           Shared by: describe (c) and edge "no remote configured".
let dirNoRemote: string;

// Shape D — orphan-xyz branch, 1 commit, no remote.
//           Used by: describe (d).
let dirOrphan: string;

// Shape E — remote + NO origin/HEAD + main with 2 unpushed commits.
//           Used by: "current branch IS the default branch".
let dirOnMain: string;

// Shape F — complex regression setup: wave/big (6 commits), feature/old pointer,
//           misleading checkout sequence.
//           Used by: regression describe.
let dirRegression: string;
let featureOldSha: string; // SHA of commit F (where feature/old points)

// Shape G — primary worktree repo + linked worktree on feat/worktree-test.
//           Used by: worktree equivalence describe.
let dirWorktreePrimary: string;
let dirWorktreeLinked: string;

// Shape H — repo with detached HEAD at HEAD~1.
//           Used by: edge "detached HEAD".
let dirDetachedHead: string;

// Shape I — remote + NO origin/HEAD + feat/no-origin-head with 1 commit.
//           Shared by: edge "no origin/HEAD symbolic ref" and "no gh network call".
let dirNoOriginHead1: string;

// Shape J — brand-new repo with no commits (unborn branch).
//           Used by: edge "brand-new repo with no commits".
let dirBrandNew: string;

// Shape K — plain directory that is NOT a git repo.
//           Used by: edge "not a git repo at all".
let dirNotGit: string;

// Shape L — remote + origin/HEAD set to origin/main + develop pushed to origin/develop.
//           Two variants: fully-pushed develop (L1) and develop +1 unpushed commit (L2).
//           Used by: "trunk branch (develop) self-compare" describe.
//
//           Verifies: isTrunkBranch('develop') causes develop branches to self-compare
//           against origin/develop rather than the repo default (origin/main).
let dirLPushed: string;    // fully-pushed develop
let dirLUnpushed: string;  // develop +1 unpushed commit

// Shape M — remote + origin/HEAD set + feature branch with:
//     • 1 committed file  (→ ahead=1)
//     • 1 unstaged tracked change
//     • 1 staged change
//     • 1 untracked file (excluded from diff count by design)
//   Expected: ahead=1, filesChanged=3 (diff vs mergeBase includes committed+staged+unstaged,
//   not untracked). Used by: "dirty-tree asymmetry" describe.
//
//   This pins the DELIBERATE ASYMMETRY documented in gatherGitStatus:
//   • ahead counts only committed-but-not-in-base commits (no working tree)
//   • filesChanged uses `git diff --shortstat <mergeBase>` (working tree vs merge base)
let dirM: string;

// ─── pre-computed gatherGitStatus results ────────────────────────────────────
//
// ALL gatherGitStatus calls are executed in the module-level beforeAll so that
// every git subprocess finishes during setup. Test bodies then run as
// pure assertions — no subprocess pressure on parallel workers during test execution.
//
// Exception: "no gh network call" must call gatherGitStatus live to observe mock
// calls; it does so after mockClear() and is not included here.

type GitStatusResult = Awaited<ReturnType<typeof gatherGitStatus>>;

let statusA: GitStatusResult;           // describe (a) + diff/ahead-behind
let statusB: GitStatusResult;           // describe (b)
let statusNoRemote: GitStatusResult;    // describe (c) + edge "no remote configured"
let statusOrphan: GitStatusResult;      // describe (d)
let statusOnMain: GitStatusResult;      // "current branch IS the default branch"
let statusRegression: GitStatusResult;  // regression "new code picks origin/main"
let statusWorktreeLinked: GitStatusResult;   // worktree/linked
let statusWorktreePrimary: GitStatusResult;  // worktree/primary
let statusDetachedHead: GitStatusResult;     // edge "detached HEAD"
let statusNoOriginHead1: GitStatusResult;    // edge "no origin/HEAD symbolic ref"
let statusBrandNew: GitStatusResult;    // edge "brand-new repo with no commits"
let statusNotGit: GitStatusResult;      // edge "not a git repo at all"
let statusLPushed: GitStatusResult;     // Shape L1: fully-pushed develop
let statusLUnpushed: GitStatusResult;   // Shape L2: develop +1 unpushed
let statusM: GitStatusResult;           // Shape M: dirty-tree asymmetry

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

// ─── single module-level fixture setup + gatherGitStatus pre-computation ─────
beforeAll(async () => {
  // All 11 shapes launch concurrently. Each IIFE creates its own temp directory,
  // runs git setup, then calls gatherGitStatus so all subprocess work is done
  // before any test body runs. Concurrent setup completes in under a second.
  //
  // GIT_AUTHOR_*/GIT_COMMITTER_* env vars eliminate explicit `git config` calls.

  await Promise.all([

    // Shape A: remote + origin/HEAD set + feat/layer-a with 3 commits
    // Shared by: describe (a) and describe "diff and ahead/behind"
    (async () => {
      dirA = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirA);
      await gitAsync(dirA, ['init', '-b', 'main']);
      await addCommitAsync(dirA, 'README.md');
      const bareA = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareA);
      await gitAsync(bareA, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirA, ['remote', 'add', 'origin', bareA]);
      await gitAsync(dirA, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirA, ['remote', 'set-head', 'origin', 'main']);
      await gitAsync(dirA, ['checkout', '-b', 'feat/layer-a']);
      await addCommitAsync(dirA, 'layer-a-1.txt');
      await addCommitAsync(dirA, 'layer-a-2.txt');
      await addCommitAsync(dirA, 'layer-a-3.txt');
      statusA = await gatherGitStatus(dirA);
    })(),

    // Shape B: remote + no origin/HEAD + feat/layer-b with 2 commits
    (async () => {
      dirB = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirB);
      await gitAsync(dirB, ['init', '-b', 'main']);
      await addCommitAsync(dirB, 'README.md');
      const bareB = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareB);
      await gitAsync(bareB, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirB, ['remote', 'add', 'origin', bareB]);
      await gitAsync(dirB, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirB, ['checkout', '-b', 'feat/layer-b']);
      await addCommitAsync(dirB, 'layer-b-1.txt');
      await addCommitAsync(dirB, 'layer-b-2.txt');
      statusB = await gatherGitStatus(dirB);
    })(),

    // Shape C: no remote + feat/no-remote with 1 commit
    // Shared by: describe (c) and edge "no remote configured"
    (async () => {
      dirNoRemote = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirNoRemote);
      await gitAsync(dirNoRemote, ['init', '-b', 'main']);
      await addCommitAsync(dirNoRemote, 'README.md');
      await gitAsync(dirNoRemote, ['checkout', '-b', 'feat/no-remote']);
      await addCommitAsync(dirNoRemote, 'no-remote.txt');
      statusNoRemote = await gatherGitStatus(dirNoRemote);
    })(),

    // Shape D: orphan-xyz branch, 1 commit, no remote
    (async () => {
      dirOrphan = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirOrphan);
      await gitAsync(dirOrphan, ['init', '-b', 'orphan-xyz']);
      await addCommitAsync(dirOrphan, 'init.txt');
      statusOrphan = await gatherGitStatus(dirOrphan);
    })(),

    // Shape E: remote + no origin/HEAD + main with 2 unpushed commits
    (async () => {
      dirOnMain = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirOnMain);
      await gitAsync(dirOnMain, ['init', '-b', 'main']);
      await addCommitAsync(dirOnMain, 'README.md');
      const bareE = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareE);
      await gitAsync(bareE, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirOnMain, ['remote', 'add', 'origin', bareE]);
      await gitAsync(dirOnMain, ['push', '-u', 'origin', 'main']);
      await addCommitAsync(dirOnMain, 'unpushed-1.txt');
      await addCommitAsync(dirOnMain, 'unpushed-2.txt');
      statusOnMain = await gatherGitStatus(dirOnMain);
    })(),

    // Shape F: complex regression — wave/big (6 commits), feature/old, misleading checkout
    (async () => {
      dirRegression = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirRegression);
      await gitAsync(dirRegression, ['init', '-b', 'main']);
      await addCommitAsync(dirRegression, 'README.md');
      const bareF = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareF);
      await gitAsync(bareF, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirRegression, ['remote', 'add', 'origin', bareF]);
      await gitAsync(dirRegression, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirRegression, ['checkout', '-b', 'wave/big']);
      await addCommitAsync(dirRegression, 'big-d.txt');
      await addCommitAsync(dirRegression, 'big-e.txt');
      await addCommitAsync(dirRegression, 'big-f.txt');
      featureOldSha = await gitAsync(dirRegression, ['rev-parse', 'HEAD']);
      await addCommitAsync(dirRegression, 'big-g.txt');
      await addCommitAsync(dirRegression, 'big-h.txt');
      await addCommitAsync(dirRegression, 'big-i.txt');
      await gitAsync(dirRegression, ['branch', 'feature/old', featureOldSha]);
      await gitAsync(dirRegression, ['checkout', 'feature/old']);
      await gitAsync(dirRegression, ['checkout', 'wave/big']);
      statusRegression = await gatherGitStatus(dirRegression);
    })(),

    // Shape G: primary worktree + linked worktree on feat/worktree-test
    (async () => {
      dirWorktreePrimary = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirWorktreePrimary);
      await gitAsync(dirWorktreePrimary, ['init', '-b', 'main']);
      await addCommitAsync(dirWorktreePrimary, 'README.md');
      const bareG = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareG);
      await gitAsync(bareG, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirWorktreePrimary, ['remote', 'add', 'origin', bareG]);
      await gitAsync(dirWorktreePrimary, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirWorktreePrimary, ['checkout', '-b', 'feat/worktree-test']);
      await addCommitAsync(dirWorktreePrimary, 'wt-a.txt');
      await addCommitAsync(dirWorktreePrimary, 'wt-b.txt');
      await gitAsync(dirWorktreePrimary, ['checkout', 'main']);
      dirWorktreeLinked = mkdtempSync(join(tmpdir(), 'devflow-hud-git-wt-'));
      allTempDirs.push(dirWorktreeLinked);
      await gitAsync(dirWorktreePrimary, ['worktree', 'add', dirWorktreeLinked, 'feat/worktree-test']);
      [statusWorktreePrimary, statusWorktreeLinked] = await Promise.all([
        gatherGitStatus(dirWorktreePrimary),
        gatherGitStatus(dirWorktreeLinked),
      ]);
    })(),

    // Shape H: detached HEAD at HEAD~1
    (async () => {
      dirDetachedHead = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirDetachedHead);
      await gitAsync(dirDetachedHead, ['init', '-b', 'main']);
      await addCommitAsync(dirDetachedHead, 'README.md');
      await addCommitAsync(dirDetachedHead, 'extra.txt');
      const firstSha = await gitAsync(dirDetachedHead, ['rev-parse', 'HEAD~1']);
      await gitAsync(dirDetachedHead, ['checkout', firstSha]);
      statusDetachedHead = await gatherGitStatus(dirDetachedHead);
    })(),

    // Shape I: remote + no origin/HEAD + feat/no-origin-head with 1 commit
    // Shared by: edge "no origin/HEAD symbolic ref" and "no gh network call"
    (async () => {
      dirNoOriginHead1 = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirNoOriginHead1);
      await gitAsync(dirNoOriginHead1, ['init', '-b', 'main']);
      await addCommitAsync(dirNoOriginHead1, 'README.md');
      const bareI = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareI);
      await gitAsync(bareI, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirNoOriginHead1, ['remote', 'add', 'origin', bareI]);
      await gitAsync(dirNoOriginHead1, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirNoOriginHead1, ['checkout', '-b', 'feat/no-origin-head']);
      await addCommitAsync(dirNoOriginHead1, 'noh-1.txt');
      statusNoOriginHead1 = await gatherGitStatus(dirNoOriginHead1);
    })(),

    // Shape J: brand-new repo with no commits (unborn branch)
    (async () => {
      dirBrandNew = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirBrandNew);
      await gitAsync(dirBrandNew, ['init', '-b', 'main']);
      statusBrandNew = await gatherGitStatus(dirBrandNew);
    })(),

    // Shape K: plain directory — not a git repo
    (async () => {
      dirNotGit = mkdtempSync(join(tmpdir(), 'devflow-hud-git-notgit-'));
      allTempDirs.push(dirNotGit);
      statusNotGit = await gatherGitStatus(dirNotGit);
    })(),

    // Shape L1: remote + origin/HEAD → origin/main + develop pushed to origin/develop
    // fully-pushed develop → ahead=0, filesChanged=0 (vs origin/develop, NOT origin/main)
    // Comparing vs origin/main would give ahead=1 (the one commit on develop).
    (async () => {
      dirLPushed = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirLPushed);
      await gitAsync(dirLPushed, ['init', '-b', 'main']);
      await addCommitAsync(dirLPushed, 'README.md');
      const bareL1 = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareL1);
      await gitAsync(bareL1, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirLPushed, ['remote', 'add', 'origin', bareL1]);
      await gitAsync(dirLPushed, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirLPushed, ['remote', 'set-head', 'origin', 'main']); // origin/HEAD → origin/main
      await gitAsync(dirLPushed, ['checkout', '-b', 'develop']);
      await addCommitAsync(dirLPushed, 'develop-1.txt');
      await gitAsync(dirLPushed, ['push', '-u', 'origin', 'develop']); // push develop → origin/develop
      statusLPushed = await gatherGitStatus(dirLPushed);
    })(),

    // Shape L2: same setup as L1 + one extra unpushed commit on develop
    // develop +1 unpushed → ahead=1, filesChanged=1 (vs origin/develop)
    // Comparing vs origin/main would give ahead=2 (1 on develop + 1 unpushed).
    (async () => {
      dirLUnpushed = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirLUnpushed);
      await gitAsync(dirLUnpushed, ['init', '-b', 'main']);
      await addCommitAsync(dirLUnpushed, 'README.md');
      const bareL2 = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareL2);
      await gitAsync(bareL2, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirLUnpushed, ['remote', 'add', 'origin', bareL2]);
      await gitAsync(dirLUnpushed, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirLUnpushed, ['remote', 'set-head', 'origin', 'main']);
      await gitAsync(dirLUnpushed, ['checkout', '-b', 'develop']);
      await addCommitAsync(dirLUnpushed, 'develop-1.txt');
      await gitAsync(dirLUnpushed, ['push', '-u', 'origin', 'develop']); // push 1 commit
      await addCommitAsync(dirLUnpushed, 'develop-2.txt'); // extra unpushed commit
      statusLUnpushed = await gatherGitStatus(dirLUnpushed);
    })(),

    // Shape M: origin/HEAD set + feature branch + dirty working tree.
    // Pins the deliberate ahead/filesChanged asymmetry in gatherGitStatus:
    //   ahead = 1  (one committed-but-not-in-base commit)
    //   filesChanged = 3  (committed file + unstaged tracked change + staged change;
    //                      untracked file excluded from git diff --shortstat)
    // git diff --shortstat <mergeBase> compares the working tree against the merge base
    // and includes staged + unstaged tracked changes + committed changes — but NOT untracked.
    (async () => {
      dirM = mkdtempSync(join(tmpdir(), 'devflow-hud-git-'));
      allTempDirs.push(dirM);
      await gitAsync(dirM, ['init', '-b', 'main']);
      // Seed main with 2 tracked files so we can modify one later
      await addCommitAsync(dirM, 'tracked-a.txt');
      await addCommitAsync(dirM, 'tracked-b.txt');
      const bareM = mkdtempSync(join(tmpdir(), 'devflow-hud-git-bare-'));
      allTempDirs.push(bareM);
      await gitAsync(bareM, ['init', '--bare', '-b', 'main']);
      await gitAsync(dirM, ['remote', 'add', 'origin', bareM]);
      await gitAsync(dirM, ['push', '-u', 'origin', 'main']);
      await gitAsync(dirM, ['remote', 'set-head', 'origin', 'main']);
      await gitAsync(dirM, ['checkout', '-b', 'feat/dirty']);
      // 1 committed file (→ ahead=1)
      await addCommitAsync(dirM, 'm-committed.txt');
      // 1 unstaged tracked change (modify tracked-a.txt already in the index)
      writeFileSync(join(dirM, 'tracked-a.txt'), 'modified');
      // 1 staged change (stage tracked-b.txt modification)
      writeFileSync(join(dirM, 'tracked-b.txt'), 'staged');
      await gitAsync(dirM, ['add', 'tracked-b.txt']);
      // 1 untracked file (must NOT appear in filesChanged)
      writeFileSync(join(dirM, 'untracked.txt'), 'untracked');
      // filesChanged = committed(1) + unstaged(1) + staged(1) = 3
      // ahead = 1 (only the committed commit)
      statusM = await gatherGitStatus(dirM);
    })(),

  ]);
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe('gatherGitStatus — base branch resolution', () => {
  describe('(a) origin/HEAD is set (git clone / git remote set-head)', () => {
    // Uses dirA / statusA: remote + origin/HEAD set + feat/layer-a with 3 commits.

    it('resolves base to origin/main via symbolic-ref', () => {
      expect(statusA).not.toBeNull();
      expect(statusA?.branch).toBe('feat/layer-a');
      expect(statusA?.filesChanged).toBe(3);
      expect(statusA?.ahead).toBe(3);
      expect(statusA?.behind).toBe(0);
    });
  });

  describe('(b) origin/HEAD absent but origin/main exists', () => {
    // Uses dirB / statusB: remote + no origin/HEAD + feat/layer-b with 2 commits.

    it('origin/HEAD is absent (confirming the test scenario)', () => {
      const symRef = git(dirB, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      expect(symRef).toBe('');
    });

    it('resolves base to origin/main by scanning remote refs', () => {
      expect(statusB).not.toBeNull();
      expect(statusB?.filesChanged).toBe(2);
      expect(statusB?.ahead).toBe(2);
    });
  });

  describe('(c) no remote at all — fall back to local main', () => {
    // Uses dirNoRemote / statusNoRemote (shared with edge "no remote configured").

    it('resolves base to local main', () => {
      expect(statusNoRemote).not.toBeNull();
      expect(statusNoRemote?.filesChanged).toBe(1);
      expect(statusNoRemote?.ahead).toBe(1);
    });
  });

  describe('(d) nothing resolves — degrade gracefully', () => {
    // Uses dirOrphan / statusOrphan: orphan-xyz branch, no remote, no main/master/develop/trunk.

    it('returns status with filesChanged === 0 and no crash', () => {
      expect(statusOrphan).not.toBeNull();
      expect(statusOrphan?.filesChanged).toBe(0);
      expect(statusOrphan?.ahead).toBe(0);
    });
  });

  describe('current branch IS the default branch', () => {
    // Uses dirOnMain / statusOnMain: remote + no origin/HEAD + main with 2 unpushed commits.

    it('compares against origin/main to show unpushed commits', () => {
      expect(statusOnMain).not.toBeNull();
      expect(statusOnMain?.branch).toBe('main');
      expect(statusOnMain?.ahead).toBe(2);
      expect(statusOnMain?.filesChanged).toBe(2);
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
   *
   * The regression assertion (last test) verifies the real gatherGitStatus implementation
   * against the pre-computed statusRegression. Against the OLD implementation the
   * pre-computation would have returned filesChanged=3, so the assertion would fail.
   */

  it('HEAD reflog contains the misleading entry (verifying the scenario is real)', () => {
    const reflog = git(dirRegression, ['reflog', 'show', 'HEAD', '--format=%gs']);
    const hasEntry = reflog
      .split('\n')
      .some(l => l.includes('checkout: moving from feature/old to wave/big'));
    expect(hasEntry).toBe(true);
  });

  it('old reflog heuristic (Layer 2) would have selected the WRONG base', () => {
    // Demonstrate what the pre-fix code would return.
    const wrongBase = oldLayer2ReflogBase(dirRegression, 'wave/big');
    expect(wrongBase).toBe('feature/old');

    // feature/old's tip IS an ancestor of wave/big (it was fast-forwarded in).
    const mergeBaseWithWrong = git(dirRegression, ['merge-base', 'feature/old', 'HEAD']);
    expect(mergeBaseWithWrong).toBe(featureOldSha);

    // Diff against feature/old shows only the 3 commits AFTER F (G, H, I).
    const wrongDiff = git(dirRegression, ['diff', '--shortstat', featureOldSha]);
    const wrongFileCount = Number(wrongDiff.match(/(\d+)\s+file/)?.[1] ?? 0);
    expect(wrongFileCount).toBe(3); // only G, H, I — the bug that produced "3 instead of 119"
  });

  it('new code picks origin/main and reports the FULL 6-file surface (red→green)', () => {
    // This is the regression assertion. Against the OLD implementation, this test would
    // fail (statusRegression.filesChanged would be 3). Against the new code it must pass with 6.
    expect(statusRegression).not.toBeNull();
    expect(statusRegression?.branch).toBe('wave/big');
    expect(statusRegression?.filesChanged).toBe(6); // D, E, F, G, H, I — the full branch surface
    expect(statusRegression?.ahead).toBe(6);
    expect(statusRegression?.behind).toBe(0);
  });
});

describe('gatherGitStatus — worktree equivalence', () => {
  /**
   * Verifies that gatherGitStatus gives correct results when called from a linked
   * worktree directory. The old reflog-based code could give different results across
   * worktrees because logs/HEAD is per-worktree. The new code uses origin/main (a
   * remote ref), which is worktree-path-independent.
   */

  it('linked worktree gives correct filesChanged for its branch', () => {
    expect(statusWorktreeLinked).not.toBeNull();
    expect(statusWorktreeLinked?.branch).toBe('feat/worktree-test');
    // 2 files added on feat/worktree-test relative to main/origin/main
    expect(statusWorktreeLinked?.filesChanged).toBe(2);
    expect(statusWorktreeLinked?.ahead).toBe(2);
  });

  it('primary worktree (on main) is independent of the linked worktree state', () => {
    // Primary is on main — pushed to origin → 0 ahead, 0 diff
    expect(statusWorktreePrimary).not.toBeNull();
    expect(statusWorktreePrimary?.branch).toBe('main');
    expect(statusWorktreePrimary?.filesChanged).toBe(0);
    expect(statusWorktreePrimary?.ahead).toBe(0);
  });
});

describe('gatherGitStatus — edge cases', () => {
  describe('detached HEAD', () => {
    // Uses dirDetachedHead / statusDetachedHead: HEAD detached at HEAD~1.

    it('returns a result with branch === HEAD and no crash', () => {
      expect(statusDetachedHead).not.toBeNull();
      // Detached HEAD — branch field is the literal string 'HEAD'
      expect(statusDetachedHead?.branch).toBe('HEAD');
      // No base branch comparison in detached state
      expect(statusDetachedHead?.filesChanged).toBe(0);
      expect(statusDetachedHead?.ahead).toBe(0);
    });
  });

  describe('no remote configured', () => {
    // Uses dirNoRemote / statusNoRemote (shared with describe (c)).

    it('falls back to local main and does not crash', () => {
      expect(statusNoRemote).not.toBeNull();
      expect(statusNoRemote?.filesChanged).toBe(1);
    });
  });

  describe('no origin/HEAD symbolic ref', () => {
    // Uses dirNoOriginHead1 / statusNoOriginHead1 (shared with "no gh network call").

    it('origin/HEAD is confirmed absent', () => {
      const symRef = git(dirNoOriginHead1, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      expect(symRef).toBe('');
    });

    it('falls back to scanning origin/main and does not crash', () => {
      expect(statusNoOriginHead1).not.toBeNull();
      expect(statusNoOriginHead1?.filesChanged).toBe(1);
    });
  });

  describe('brand-new repo with no commits', () => {
    // Uses dirBrandNew / statusBrandNew: git init, no commits — HEAD is unborn.

    it('returns null gracefully (no commits yet)', () => {
      expect(statusBrandNew).toBeNull();
    });
  });

  describe('not a git repo at all', () => {
    // Uses dirNotGit / statusNotGit: plain mkdtempSync, no git init.

    it('returns null without throwing', () => {
      expect(statusNotGit).toBeNull();
    });
  });
});

describe('gatherGitStatus — diff and ahead/behind share reference point', () => {
  // Uses dirA / statusA (shared with describe (a)):
  // origin/HEAD set + feat/layer-a + 3 commits.
  // All three tests use the pre-computed statusA — no additional gatherGitStatus calls.

  it('ahead count equals number of commits on feature branch', () => {
    expect(statusA?.ahead).toBe(3);
    expect(statusA?.behind).toBe(0);
  });

  it('filesChanged matches the number of files added on feature branch', () => {
    expect(statusA?.filesChanged).toBe(3);
  });

  it('diff and ahead/behind agree on reference point', () => {
    // Both ahead/behind and diff use origin/main as their base.
    // On a linear history, merge-base IS the tip of origin/main.
    const mainSha = git(dirA, ['rev-parse', 'origin/main']);
    const mergeBase = git(dirA, ['merge-base', 'origin/main', 'HEAD']);
    expect(mergeBase).toBe(mainSha);

    // Manual diff count against merge base must match gatherGitStatus.
    const rawDiff = git(dirA, ['diff', '--shortstat', mergeBase]);
    const manualFiles = Number(rawDiff.match(/(\d+)\s+file/)?.[1] ?? 0);

    expect(statusA?.filesChanged).toBe(manualFiles);
  });
});

describe('gatherGitStatus — no gh network call on render path', () => {
  // Uses dirOrphan — the only shape where a gh-based fallback would have fired
  // in the old code (no remote, no common refs to fall back to). The old Layer 2
  // reflog-based code used dirNoOriginHead1 but its reflog satisfied the heuristic
  // so it never actually discriminated. dirOrphan is the correct regression target:
  // if gh were ever (re-)added as a fallback, it would fire here first.
  //
  // This test MUST call gatherGitStatus live because it needs to observe which
  // execFile calls were made. It clears the mock first so pre-computation calls
  // do not contaminate the assertion.

  it('never invokes gh during gatherGitStatus', async () => {
    mockedExecFile.mockClear();
    await gatherGitStatus(dirOrphan);

    const ghCalls = mockedExecFile.mock.calls.filter(([cmd]) => cmd === 'gh');
    expect(ghCalls).toHaveLength(0);
  });
});

describe('gatherGitStatus — dirty-tree ahead/filesChanged asymmetry (Shape M)', () => {
  /**
   * Pins the deliberate design in gatherGitStatus where ahead/behind counts
   * only committed-but-not-in-base commits, while filesChanged uses
   * `git diff --shortstat <mergeBase>` which includes the working tree.
   *
   * Shape M: 1 committed file, 1 unstaged tracked change, 1 staged change,
   * 1 untracked file (excluded). Expected: ahead=1, filesChanged=3.
   *
   * This asymmetry is documented in the diff-stats comment in gatherGitStatus
   * (~line 69-73 of src/hud/git.ts): "diff includes the working tree;
   * ahead/behind counts commits only. This asymmetry is deliberate."
   *
   * The dirty/staged porcelain parsing (~line 36-46) is also exercised here —
   * dirty=true because of unstaged tracked change, staged=true because of staged change.
   */

  it('ahead counts only committed-but-not-in-base commits, not working-tree changes', () => {
    expect(statusM).not.toBeNull();
    expect(statusM?.branch).toBe('feat/dirty');
    expect(statusM?.ahead).toBe(1); // only the committed file
  });

  it('filesChanged includes committed + staged + unstaged tracked, but not untracked', () => {
    // git diff --shortstat <mergeBase> shows: committed file + unstaged tracked + staged = 3
    // The untracked file is excluded (diff only sees tracked content)
    expect(statusM?.filesChanged).toBe(3);
  });

  it('dirty=true and staged=true because of working-tree modifications', () => {
    expect(statusM?.dirty).toBe(true);   // unstaged tracked change + untracked file
    expect(statusM?.staged).toBe(true);  // staged change
  });

  /**
   * --no-optional-locks is a GIT-LEVEL option: it must sit before the subcommand.
   * `git status --porcelain --no-optional-locks` exits non-zero with "unknown option",
   * shellExec swallows that into '', and every tree then reports clean. The flag keeps
   * the HUD — which runs on every prompt — from writing .git/index as a side effect.
   *
   * Falsification: moving the flag after 'status' makes the argv assertion pass the
   * `.includes` check but fail the ordering check, AND flips dirty to false; dropping
   * the flag entirely fails the ordering check alone.
   */
  it('runs the dirty check with --no-optional-locks BEFORE the status subcommand', async () => {
    mockedExecFile.mockClear();
    const live = await gatherGitStatus(dirM);

    const statusCalls = mockedExecFile.mock.calls
      .map(([, args]) => args as string[])
      .filter(args => args.includes('status'));

    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]).toEqual(['--no-optional-locks', 'status', '--porcelain']);
    // The flag must not break the command: a rejected option would yield '' → clean.
    expect(live?.dirty).toBe(true);
    expect(live?.staged).toBe(true);
  });
});

describe('gatherGitStatus — trunk branch (develop) self-compare (Shape L)', () => {
  /**
   * Regression guard: trunk branches (develop, staging, production) must self-compare
   * against their own remote counterpart (origin/<branch>) rather than the repo's
   * default branch (origin/main).
   *
   * A fully-pushed develop branch shows ahead=0, filesChanged=0 when compared against
   * origin/develop. A develop branch with one unpushed commit shows ahead=1.
   *
   * isTrunkBranch() covers all canonical trunk branches. Non-trunk feature branches
   * continue to compare against the repo's default branch (origin/main).
   */

  it('fully-pushed develop compares against origin/develop (not origin/main) → ahead=0', () => {
    // isTrunkBranch('develop') && origin/develop in refs → base = origin/develop.
    // develop is fully pushed → ahead=0, filesChanged=0.
    expect(statusLPushed).not.toBeNull();
    expect(statusLPushed?.branch).toBe('develop');
    expect(statusLPushed?.ahead).toBe(0);
    expect(statusLPushed?.filesChanged).toBe(0);
  });

  it('develop +1 unpushed commit → ahead=1 vs origin/develop (not ahead=2 vs origin/main)', () => {
    // RED against old code: old code uses origin/main as base → ahead=2 (2 commits
    // past origin/main: the pushed one + the unpushed one). New code uses origin/develop
    // as base → ahead=1 (only the unpushed commit).
    expect(statusLUnpushed).not.toBeNull();
    expect(statusLUnpushed?.branch).toBe('develop');
    expect(statusLUnpushed?.ahead).toBe(1);
    expect(statusLUnpushed?.filesChanged).toBe(1);
  });
});

describe('gatherGitStatus — maxBuffer overflow degrades gracefully', () => {
  /**
   * Simulates a repo where `git for-each-ref` output exceeds maxBuffer, killing the
   * child process with ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
   *
   * Without an explicit maxBuffer cap, Node's 1 MiB default applies. On overflow:
   *   • shellExec resolves to '' (catch-all: resolve(err ? '' : stdout.trim()))
   *   • detectBaseBranch receives an empty refs Set → returns null
   *   • gatherGitStatus skips ahead/behind and diff-stats → returns a degraded GitStatus
   *
   * This test injects the error Node would emit at the overflow boundary, verifying
   * the degraded path: branch is still populated; ahead and behind are both 0.
   *
   * dirA (remote + origin/HEAD set + feat/layer-a) is the fixture so all other git
   * commands (rev-parse, status --porcelain, describe, worktree list) resolve normally.
   */

  it('returns degraded status (ahead=0, behind=0) without crashing when for-each-ref exceeds maxBuffer', async () => {
    // Save the current pass-through implementation so we can restore it in finally.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const passthroughImpl = mockedExecFile.getMockImplementation() as any;

    // Extract the interceptor so the `as any` cast is on a named reference — not on
    // a closing brace — which esbuild can parse without error.
    const interceptImpl = (
      file: string,
      args: string[],
      options: object,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      if (file === 'git' && args.includes('for-each-ref')) {
        const err = Object.assign(new Error('stdout maxBuffer length exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        });
        cb(err, '', '');
        return undefined as unknown as ReturnType<typeof execFile>;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (passthroughImpl as any)(file, args, options, cb);
    };
    mockedExecFile.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedExecFile.mockImplementation(interceptImpl as any);

    try {
      const status = await gatherGitStatus(dirA);

      expect(status).not.toBeNull();
      expect(status?.branch).toBeTruthy();  // branch name still populated
      expect(status?.ahead).toBe(0);        // degraded: no base branch resolved → 0
      expect(status?.behind).toBe(0);       // degraded: no base branch resolved → 0
    } finally {
      // Restore pass-through so subsequent tests are unaffected.
      mockedExecFile.mockImplementation(passthroughImpl);
      mockedExecFile.mockClear();
    }
  });
});
