import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
import { getGitRoot, TRUNK_BRANCHES, TRUNK_BRANCH_PREFIXES, isTrunkBranch } from '../src/core/git.js';

const mockedExec = vi.mocked(exec);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses the Protected Branches canonical list from the worktree-support
 * SKILL.md at test time so the guard test is driven by the actual source of
 * truth rather than a third hardcoded copy.
 *
 * Locates the heading `## Protected Branches (Canonical List)`, takes the
 * first non-empty line after it, and extracts all backtick-delimited tokens.
 * Tokens without a trailing `*` are literals; tokens with a trailing `*` are
 * wildcard prefixes (stripped: `release/*` → `release/`).
 *
 * Throws with a descriptive message when the heading or list line is absent —
 * a structural change in SKILL.md should be a loud, actionable failure.
 */
function parseSkillMdBranches(): { literals: string[]; prefixes: string[] } {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const skillPath = resolve(
    __dirname,
    '../src/assets/skills/worktree-support/SKILL.md',
  );
  const lines = readFileSync(skillPath, 'utf-8').split('\n');

  const headingIndex = lines.findIndex(
    line => line === '## Protected Branches (Canonical List)',
  );
  if (headingIndex === -1) {
    throw new Error(
      'SKILL.md is missing "## Protected Branches (Canonical List)" heading — ' +
        'update this test to match the new section structure',
    );
  }

  // First non-empty line after the heading is the canonical list line.
  const relativeIndex = lines
    .slice(headingIndex + 1)
    .findIndex(line => line.trim() !== '');
  if (relativeIndex === -1) {
    throw new Error(
      'SKILL.md "## Protected Branches (Canonical List)" section has no ' +
        'content line after the heading',
    );
  }
  const listLine = lines[headingIndex + 1 + relativeIndex];

  const literals: string[] = [];
  const prefixes: string[] = [];
  const tokenRe = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(listLine)) !== null) {
    const token = match[1];
    if (token.endsWith('*')) {
      prefixes.push(token.slice(0, -1)); // 'release/*' → 'release/'
    } else {
      literals.push(token);
    }
  }

  return { literals, prefixes };
}

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

  it('matches SKILL.md literal branches exactly — set equality in both directions', () => {
    const { literals: skillLiterals } = parseSkillMdBranches();
    const trunkSet = new Set(TRUNK_BRANCHES as readonly string[]);
    const skillSet = new Set(skillLiterals);

    // SKILL.md → TRUNK_BRANCHES: every SKILL.md literal must appear in TRUNK_BRANCHES
    for (const name of skillLiterals) {
      expect(
        trunkSet.has(name),
        `TRUNK_BRANCHES is missing '${name}' from SKILL.md canonical list`,
      ).toBe(true);
    }

    // TRUNK_BRANCHES → SKILL.md: every TRUNK_BRANCHES entry must appear in SKILL.md
    for (const name of TRUNK_BRANCHES as readonly string[]) {
      expect(
        skillSet.has(name),
        `TRUNK_BRANCHES has '${name}' but SKILL.md canonical list does not`,
      ).toBe(true);
    }
  });

  it('TRUNK_BRANCH_PREFIXES matches SKILL.md wildcard prefixes exactly — set equality in both directions', () => {
    const { prefixes: skillPrefixes } = parseSkillMdBranches();
    const trunkPrefixSet = new Set(TRUNK_BRANCH_PREFIXES as readonly string[]);
    const skillPrefixSet = new Set(skillPrefixes);

    // SKILL.md → TRUNK_BRANCH_PREFIXES: every SKILL.md wildcard prefix must appear
    for (const prefix of skillPrefixes) {
      expect(
        trunkPrefixSet.has(prefix),
        `TRUNK_BRANCH_PREFIXES is missing '${prefix}' from SKILL.md canonical list`,
      ).toBe(true);
    }

    // TRUNK_BRANCH_PREFIXES → SKILL.md: every entry must appear in SKILL.md
    for (const prefix of TRUNK_BRANCH_PREFIXES as readonly string[]) {
      expect(
        skillPrefixSet.has(prefix),
        `TRUNK_BRANCH_PREFIXES has '${prefix}' but SKILL.md canonical list does not`,
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
