// tests/hud-main.test.ts
// The statusline entry point (src/hud/index.ts) runs main() on import. These tests
// import it under fake timers with its data gatherers and renderer stubbed, and
// assert the overall-timeout contract: a finished render leaves no timer that keeps
// node alive, and a render that outlasts the 2 s budget prints nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OVERALL_TIMEOUT_MS = 2000;

describe('statusline entry point', () => {
  let written: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    written = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    vi.doMock('../src/hud/stdin.js', () => ({ readStdin: async () => ({}) }));
    vi.doMock('../src/hud/git.js', () => ({ gatherGitStatus: async () => null }));
    vi.doMock('../src/hud/components/learning-counts.js', () => ({
      gatherLedgerLearningCounts: async () => null,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../src/hud/render.js');
  });

  it('prints the render and leaves no pending timer once it finishes', async () => {
    vi.doMock('../src/hud/render.js', () => ({ render: async () => 'status line' }));
    await import('../src/hud/index.js');
    await vi.advanceTimersByTimeAsync(0);

    expect(written).toEqual(['status line']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prints nothing when the render outlasts the overall timeout', async () => {
    vi.doMock('../src/hud/render.js', () => ({ render: () => new Promise<string>(() => {}) }));
    await import('../src/hud/index.js');
    await vi.advanceTimersByTimeAsync(OVERALL_TIMEOUT_MS - 1);
    expect(written).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(written).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prints nothing and leaves no pending timer when the render fails', async () => {
    vi.doMock('../src/hud/render.js', () => ({
      render: async () => {
        throw new Error('component crashed');
      },
    }));
    await import('../src/hud/index.js');
    await vi.advanceTimersByTimeAsync(0);

    expect(written).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
