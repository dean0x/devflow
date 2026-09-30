import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import { isContainedIn } from '../src/core/paths.js';

import {
  getHomeDirectory,
  getClaudeDirectory,
  getDevFlowDirectory,
  getInstallationPaths,
  readHomeDirectory,
  resolveInstallationPaths,
} from '../src/targets/claude-code/claude-paths.js';

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('getHomeDirectory', () => {
  it('returns HOME env var when set', () => {
    vi.stubEnv('HOME', '/custom/home');
    expect(getHomeDirectory()).toBe('/custom/home');
  });

  it('throws when HOME is empty and os.homedir() returns empty', () => {
    // On most systems, os.homedir() reads HOME env var, so clearing HOME
    // can cause both to be empty, triggering the error path.
    vi.stubEnv('HOME', '');
    // Behavior depends on OS — homedir() may still resolve from /etc/passwd.
    // We test the contract: either it returns a non-empty string or throws.
    try {
      const result = getHomeDirectory();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    } catch (e) {
      expect((e as Error).message).toContain('Unable to determine home directory');
    }
  });
});

describe('resolveInstallationPaths — the paths as a Result', () => {
  it('returns the home directory and the install locations under it', () => {
    vi.stubEnv('HOME', '/custom/home');
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    expect(resolveInstallationPaths()).toEqual({
      ok: true,
      value: { homeDir: '/custom/home', claudeDir: '/custom/home/.claude', devflowDir: '/custom/home/.devflow' },
    });
  });

  it('readHomeDirectory is null, never a throw, when neither HOME nor the passwd entry names one', () => {
    const throwing = (): string => { throw new Error('no passwd entry'); };
    expect(readHomeDirectory({}, throwing)).toBeNull();
    expect(readHomeDirectory({ HOME: '' }, () => '')).toBeNull();
    expect(readHomeDirectory({ HOME: '' }, () => '/from/passwd')).toBe('/from/passwd');
    expect(readHomeDirectory({ HOME: '/from/env' }, throwing)).toBe('/from/env');
  });

  it('resolveInstallationPaths reports the missing home directory as an error', () => {
    vi.stubEnv('HOME', '');
    // os.homedir() may still answer from the passwd entry; either outcome is a
    // Result, never a throw.
    const resolved = resolveInstallationPaths();
    if (resolved.ok) {
      expect(path.isAbsolute(resolved.value.homeDir)).toBe(true);
    } else {
      expect(resolved.error).toContain('Unable to determine home directory');
    }
  });
});

describe('getClaudeDirectory (D-CLAUDE-CONFIG-DIR)', () => {
  it('honours an absolute CLAUDE_CONFIG_DIR', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/custom/claude');
    expect(getClaudeDirectory()).toBe('/custom/claude');
  });

  it('ignores a relative CLAUDE_CONFIG_DIR and falls back to ~/.claude (never throws)', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', 'relative/path');
    expect(getClaudeDirectory()).toBe(path.join(getHomeDirectory(), '.claude'));
  });

  it('treats a `~`-prefixed CLAUDE_CONFIG_DIR as relative (no shell expansion) and falls back to ~/.claude', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '~/custom-claude');
    expect(getClaudeDirectory()).toBe(path.join(getHomeDirectory(), '.claude'));
  });

  it('defaults to ~/.claude when CLAUDE_CONFIG_DIR is unset or empty', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    expect(getClaudeDirectory()).toBe(path.join(getHomeDirectory(), '.claude'));
  });

  it('ignores the retired CLAUDE_CODE_DIR variable', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    vi.stubEnv('CLAUDE_CODE_DIR', '/retired/claude');
    expect(getClaudeDirectory()).toBe(path.join(getHomeDirectory(), '.claude'));
  });
});

describe('getDevFlowDirectory (D-ONE-HOME)', () => {
  it('is always ~/.devflow', () => {
    expect(getDevFlowDirectory()).toBe(path.join(getHomeDirectory(), '.devflow'));
  });

  it('ignores an exported DEVFLOW_DIR (AC-10)', () => {
    vi.stubEnv('DEVFLOW_DIR', '/custom/devflow');
    expect(getDevFlowDirectory()).toBe(path.join(getHomeDirectory(), '.devflow'));
  });
});

describe('isContainedIn', () => {
  const parent = '/base/dir';

  it('returns true for a simple filename inside parent', () => {
    expect(isContainedIn(parent, 'file.md')).toBe(true);
  });

  it('returns true for a nested path inside parent', () => {
    expect(isContainedIn(parent, 'sub/file.md')).toBe(true);
  });

  it('returns false for a single ..-escape', () => {
    expect(isContainedIn(parent, '../file.md')).toBe(false);
  });

  it('returns false for a double ..-escape', () => {
    expect(isContainedIn(parent, '../../file.md')).toBe(false);
  });

  it('returns false for an absolute path outside parent', () => {
    expect(isContainedIn(parent, '/other/path/file.md')).toBe(false);
  });

  it('returns false for an empty candidate', () => {
    expect(isContainedIn(parent, '')).toBe(false);
  });

  it('returns false for a dot (same-as-parent)', () => {
    expect(isContainedIn(parent, '.')).toBe(false);
  });

  it('works with relative parent path (resolved internally)', () => {
    // A relative parent is resolved to an absolute path — containment still holds.
    const rel = 'some/relative/parent';
    // A direct child of the resolved parent must be contained.
    expect(isContainedIn(rel, 'child.md')).toBe(true);
    // Escaping still fails even with a relative parent.
    expect(isContainedIn(rel, '../../../evil.md')).toBe(false);
    // Resolution is anchored on the absolute form of the relative parent.
    expect(isContainedIn(rel, 'child.md')).toBe(isContainedIn(path.resolve(rel), 'child.md'));
  });
});

describe('getInstallationPaths (D-SCOPE-RETIRED)', () => {
  it('returns the machine-wide Claude and devflow directories and takes no scope', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    const home = getHomeDirectory();
    expect(getInstallationPaths()).toEqual({
      claudeDir: path.join(home, '.claude'),
      devflowDir: path.join(home, '.devflow'),
    });
  });

  it('follows CLAUDE_CONFIG_DIR for the Claude directory and never relocates the devflow root', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/custom/claude');
    vi.stubEnv('DEVFLOW_DIR', '/custom/devflow');
    expect(getInstallationPaths()).toEqual({
      claudeDir: '/custom/claude',
      devflowDir: path.join(getHomeDirectory(), '.devflow'),
    });
  });
});
