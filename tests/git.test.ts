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
import { getGitRoot } from '../src/cli/utils/git.js';

const mockedExec = vi.mocked(exec);

beforeEach(() => {
  vi.clearAllMocks();
});

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
