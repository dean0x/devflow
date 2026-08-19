import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing git.ts
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// We need to also mock the promisify wrapper
vi.mock('util', async (importOriginal) => {
  const original = await importOriginal<typeof import('util')>();
  return {
    ...original,
    promisify: (fn: unknown) => {
      // Return a function that calls our mocked exec and wraps it in a promise
      return (...args: unknown[]) => {
        return new Promise((resolve, reject) => {
          (fn as Function)(...args, (err: Error | null, result: unknown) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      };
    },
  };
});

import { exec } from 'child_process';
import { getGitRoot, TRUNK_BRANCHES, isTrunkBranch } from '../src/core/git.js';

const mockedExec = vi.mocked(exec);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TRUNK_BRANCHES / isTrunkBranch — canonical list guards
// ---------------------------------------------------------------------------

describe('TRUNK_BRANCHES', () => {
  /**
   * These guards ensure TRUNK_BRANCHES stays in sync with the canonical list
   * in the worktree-support SKILL.md (Protected Branches section).
   *
   * The SKILL.md canonical list: main, master, develop, integration, trunk,
   * release/*, staging, production.
   *
   * TRUNK_BRANCHES covers the exact literals; TRUNK_BRANCH_PREFIXES covers `release/`.
   */

  it('contains every branch from the worktree-support canonical list', () => {
    // These are the exact names from the worktree-support SKILL.md Protected Branches list.
    // `release/*` is covered by isTrunkBranch via TRUNK_BRANCH_PREFIXES — not a literal.
    const canonicalLiterals = [
      'main', 'master', 'develop', 'integration', 'trunk', 'staging', 'production',
    ];
    for (const name of canonicalLiterals) {
      expect(
        (TRUNK_BRANCHES as readonly string[]).includes(name),
        `TRUNK_BRANCHES should include '${name}' from the worktree-support canonical list`,
      ).toBe(true);
    }
  });

  it('does NOT contain bare "release" (only the release/ prefix is canonical)', () => {
    expect((TRUNK_BRANCHES as readonly string[]).includes('release')).toBe(false);
  });

  it('does NOT contain "stable" (not in the worktree-support canonical list)', () => {
    expect((TRUNK_BRANCHES as readonly string[]).includes('stable')).toBe(false);
  });
});

describe('isTrunkBranch', () => {
  it('returns true for develop', () => {
    expect(isTrunkBranch('develop')).toBe(true);
  });

  it('returns true for main', () => {
    expect(isTrunkBranch('main')).toBe(true);
  });

  it('returns true for staging', () => {
    expect(isTrunkBranch('staging')).toBe(true);
  });

  it('returns true for production', () => {
    expect(isTrunkBranch('production')).toBe(true);
  });

  it('returns true for release/1.2 (release/ prefix)', () => {
    expect(isTrunkBranch('release/1.2')).toBe(true);
  });

  it('returns true for release/2.0.0 (release/ prefix)', () => {
    expect(isTrunkBranch('release/2.0.0')).toBe(true);
  });

  it('returns false for bare "release" (no trailing slash)', () => {
    expect(isTrunkBranch('release')).toBe(false);
  });

  it('returns false for feat/my-feature', () => {
    expect(isTrunkBranch('feat/my-feature')).toBe(false);
  });

  it('returns false for fix/bug-42', () => {
    expect(isTrunkBranch('fix/bug-42')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isTrunkBranch('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getGitRoot
// ---------------------------------------------------------------------------

describe('getGitRoot', () => {
  it('returns trimmed path on success', async () => {
    mockedExec.mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, { stdout: '  /home/user/project  \n', stderr: '' });
      return {} as ReturnType<typeof exec>;
    });

    const result = await getGitRoot();
    expect(result).toBe('/home/user/project');
  });

  it('returns null when not in a git repo', async () => {
    mockedExec.mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(new Error('not a git repository'), { stdout: '', stderr: '' });
      return {} as ReturnType<typeof exec>;
    });

    const result = await getGitRoot();
    expect(result).toBeNull();
  });

  it('returns null on injection characters (newlines)', async () => {
    mockedExec.mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, { stdout: '/home/user\n; rm -rf /', stderr: '' });
      return {} as ReturnType<typeof exec>;
    });

    const result = await getGitRoot();
    expect(result).toBeNull();
  });

  it('returns null on injection characters (semicolons)', async () => {
    mockedExec.mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, { stdout: '/home/user; rm -rf /', stderr: '' });
      return {} as ReturnType<typeof exec>;
    });

    const result = await getGitRoot();
    expect(result).toBeNull();
  });

  it('returns null on injection characters (&&)', async () => {
    mockedExec.mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, { stdout: '/home/user && rm -rf /', stderr: '' });
      return {} as ReturnType<typeof exec>;
    });

    const result = await getGitRoot();
    expect(result).toBeNull();
  });

  it('returns null on empty output', async () => {
    mockedExec.mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, { stdout: '', stderr: '' });
      return {} as ReturnType<typeof exec>;
    });

    const result = await getGitRoot();
    expect(result).toBeNull();
  });
});
