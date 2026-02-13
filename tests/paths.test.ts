import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock git.ts before importing paths.ts
vi.mock('../src/cli/utils/git.js', () => ({
  getGitRoot: vi.fn(),
}));

import { getHomeDirectory, getClaudeDirectory, getDevFlowDirectory, getInstallationPaths } from '../src/cli/utils/paths.js';
import { getGitRoot } from '../src/cli/utils/git.js';

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

describe('getClaudeDirectory', () => {
  it('respects CLAUDE_CODE_DIR env var', () => {
    vi.stubEnv('CLAUDE_CODE_DIR', '/custom/claude');
    expect(getClaudeDirectory()).toBe('/custom/claude');
  });

  it('validates CLAUDE_CODE_DIR is absolute', () => {
    vi.stubEnv('CLAUDE_CODE_DIR', 'relative/path');
    expect(() => getClaudeDirectory()).toThrow('must be an absolute path');
  });

  it('defaults to ~/.claude when CLAUDE_CODE_DIR is unset', () => {
    vi.stubEnv('CLAUDE_CODE_DIR', '');
    const result = getClaudeDirectory();
    expect(result).toBe(path.join(getHomeDirectory(), '.claude'));
  });
});

describe('getDevFlowDirectory', () => {
  it('respects DEVFLOW_DIR env var', () => {
    vi.stubEnv('DEVFLOW_DIR', '/custom/devflow');
    expect(getDevFlowDirectory()).toBe('/custom/devflow');
  });

  it('validates DEVFLOW_DIR is absolute', () => {
    vi.stubEnv('DEVFLOW_DIR', 'relative/path');
    expect(() => getDevFlowDirectory()).toThrow('must be an absolute path');
  });

  it('defaults to ~/.devflow when DEVFLOW_DIR is unset', () => {
    vi.stubEnv('DEVFLOW_DIR', '');
    const result = getDevFlowDirectory();
    expect(result).toBe(path.join(getHomeDirectory(), '.devflow'));
  });
});

describe('getInstallationPaths', () => {
  it('user scope returns home-based paths with null gitRoot', async () => {
    vi.stubEnv('CLAUDE_CODE_DIR', '');
    vi.stubEnv('DEVFLOW_DIR', '');
    const { claudeDir, devflowDir, gitRoot } = await getInstallationPaths('user');
    const home = getHomeDirectory();
    expect(claudeDir).toBe(path.join(home, '.claude'));
    expect(devflowDir).toBe(path.join(home, '.devflow'));
    expect(gitRoot).toBeNull();
  });

  it('local scope requires git root', async () => {
    const mockedGetGitRoot = vi.mocked(getGitRoot);
    mockedGetGitRoot.mockResolvedValue(null);
    await expect(getInstallationPaths('local')).rejects.toThrow('requires a git repository');
  });

  it('local scope returns git-root-based paths with gitRoot', async () => {
    const mockedGetGitRoot = vi.mocked(getGitRoot);
    mockedGetGitRoot.mockResolvedValue('/repo/root');
    const { claudeDir, devflowDir, gitRoot } = await getInstallationPaths('local');
    expect(claudeDir).toBe('/repo/root/.claude');
    expect(devflowDir).toBe('/repo/root/.devflow');
    expect(gitRoot).toBe('/repo/root');
  });
});
