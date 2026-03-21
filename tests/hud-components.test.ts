import { describe, it, expect } from 'vitest';
import type { GatherContext, GitStatus, TranscriptData } from '../src/cli/hud/types.js';

// Import components
import directory from '../src/cli/hud/components/directory.js';
import gitBranch from '../src/cli/hud/components/git-branch.js';
import gitAheadBehind from '../src/cli/hud/components/git-ahead-behind.js';
import diffStats from '../src/cli/hud/components/diff-stats.js';
import model from '../src/cli/hud/components/model.js';
import contextUsage from '../src/cli/hud/components/context-usage.js';
import sessionDuration from '../src/cli/hud/components/session-duration.js';
import usageQuota from '../src/cli/hud/components/usage-quota.js';
import toolActivity from '../src/cli/hud/components/tool-activity.js';
import agentActivity from '../src/cli/hud/components/agent-activity.js';
import todoProgress from '../src/cli/hud/components/todo-progress.js';
import speed from '../src/cli/hud/components/speed.js';
import { stripAnsi } from '../src/cli/hud/colors.js';

function makeCtx(overrides: Partial<GatherContext> = {}): GatherContext {
  return {
    stdin: {},
    git: null,
    transcript: null,
    usage: null,
    speed: null,
    configCounts: null,
    config: { preset: 'standard', components: [] },
    devflowDir: '/test/.devflow',
    sessionStartTime: null,
    terminalWidth: 120,
    ...overrides,
  };
}

function makeGit(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: 'main',
    dirty: false,
    ahead: 0,
    behind: 0,
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    ...overrides,
  };
}

describe('directory component', () => {
  it('returns directory name from cwd', async () => {
    const ctx = makeCtx({ stdin: { cwd: '/home/user/projects/my-app' } });
    const result = await directory(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('my-app');
  });

  it('returns null when no cwd', async () => {
    const ctx = makeCtx();
    const result = await directory(ctx);
    expect(result).toBeNull();
  });
});

describe('gitBranch component', () => {
  it('returns branch name', async () => {
    const ctx = makeCtx({ git: makeGit({ branch: 'feat/my-feature' }) });
    const result = await gitBranch(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('feat/my-feature');
  });

  it('shows dirty indicator', async () => {
    const ctx = makeCtx({
      git: makeGit({ branch: 'main', dirty: true }),
    });
    const result = await gitBranch(ctx);
    expect(result!.raw).toBe('main*');
  });

  it('returns null when no git', async () => {
    const ctx = makeCtx();
    const result = await gitBranch(ctx);
    expect(result).toBeNull();
  });
});

describe('gitAheadBehind component', () => {
  it('shows ahead arrow', async () => {
    const ctx = makeCtx({ git: makeGit({ ahead: 3 }) });
    const result = await gitAheadBehind(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('3\u2191');
  });

  it('shows behind arrow', async () => {
    const ctx = makeCtx({ git: makeGit({ behind: 2 }) });
    const result = await gitAheadBehind(ctx);
    expect(result!.raw).toContain('2\u2193');
  });

  it('shows both arrows', async () => {
    const ctx = makeCtx({ git: makeGit({ ahead: 1, behind: 4 }) });
    const result = await gitAheadBehind(ctx);
    expect(result!.raw).toContain('1\u2191');
    expect(result!.raw).toContain('4\u2193');
  });

  it('returns null when both zero', async () => {
    const ctx = makeCtx({ git: makeGit() });
    const result = await gitAheadBehind(ctx);
    expect(result).toBeNull();
  });

  it('returns null when no git', async () => {
    const ctx = makeCtx();
    const result = await gitAheadBehind(ctx);
    expect(result).toBeNull();
  });
});

describe('diffStats component', () => {
  it('shows file count and additions/deletions', async () => {
    const ctx = makeCtx({
      git: makeGit({ filesChanged: 5, additions: 100, deletions: 30 }),
    });
    const result = await diffStats(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('5');
    expect(result!.raw).toContain('+100');
    expect(result!.raw).toContain('-30');
  });

  it('returns null when all zeros', async () => {
    const ctx = makeCtx({ git: makeGit() });
    const result = await diffStats(ctx);
    expect(result).toBeNull();
  });

  it('returns null when no git', async () => {
    const ctx = makeCtx();
    const result = await diffStats(ctx);
    expect(result).toBeNull();
  });
});

describe('model component', () => {
  it('returns model display name', async () => {
    const ctx = makeCtx({
      stdin: { model: { display_name: 'Claude Sonnet 4' } },
    });
    const result = await model(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Claude Sonnet 4');
  });

  it('returns null when no model', async () => {
    const ctx = makeCtx();
    const result = await model(ctx);
    expect(result).toBeNull();
  });
});

describe('contextUsage component', () => {
  it('shows percentage with green for low usage', async () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 50000 },
        },
      },
    });
    const result = await contextUsage(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('25%');
    // Green color for < 50%
    expect(result!.text).toContain('\x1b[32m');
  });

  it('shows yellow for medium usage', async () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 120000 },
        },
      },
    });
    const result = await contextUsage(ctx);
    expect(result!.raw).toBe('60%');
    // Yellow for 50-80%
    expect(result!.text).toContain('\x1b[33m');
  });

  it('shows red for high usage', async () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 180000 },
        },
      },
    });
    const result = await contextUsage(ctx);
    expect(result!.raw).toBe('90%');
    // Red for > 80%
    expect(result!.text).toContain('\x1b[31m');
  });

  it('returns null when no context window data', async () => {
    const ctx = makeCtx();
    const result = await contextUsage(ctx);
    expect(result).toBeNull();
  });
});

describe('sessionDuration component', () => {
  it('shows minutes', async () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const ctx = makeCtx({ sessionStartTime: tenMinutesAgo });
    const result = await sessionDuration(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('10m');
  });

  it('shows hours and minutes', async () => {
    const ninetyMinutesAgo = Date.now() - 90 * 60 * 1000;
    const ctx = makeCtx({ sessionStartTime: ninetyMinutesAgo });
    const result = await sessionDuration(ctx);
    expect(result!.raw).toContain('1h 30m');
  });

  it('returns null when no start time', async () => {
    const ctx = makeCtx();
    const result = await sessionDuration(ctx);
    expect(result).toBeNull();
  });
});

describe('usageQuota component', () => {
  it('shows bar with percentage', async () => {
    const ctx = makeCtx({ usage: { dailyUsagePercent: 45, weeklyUsagePercent: null } });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('45%');
  });

  it('falls back to weekly when daily is null', async () => {
    const ctx = makeCtx({ usage: { dailyUsagePercent: null, weeklyUsagePercent: 70 } });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('70%');
  });

  it('returns null when no usage data', async () => {
    const ctx = makeCtx();
    const result = await usageQuota(ctx);
    expect(result).toBeNull();
  });

  it('returns null when both percentages are null', async () => {
    const ctx = makeCtx({ usage: { dailyUsagePercent: null, weeklyUsagePercent: null } });
    const result = await usageQuota(ctx);
    expect(result).toBeNull();
  });
});

describe('toolActivity component', () => {
  it('shows completed tools', async () => {
    const transcript: TranscriptData = {
      tools: [
        { name: 'Read', status: 'completed' },
        { name: 'Read', status: 'completed' },
        { name: 'Bash', status: 'completed' },
      ],
      agents: [],
      todos: { completed: 0, total: 0 },
    };
    const ctx = makeCtx({ transcript });
    const result = await toolActivity(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('Read');
    expect(result!.raw).toContain('Bash');
  });

  it('shows running tools', async () => {
    const transcript: TranscriptData = {
      tools: [{ name: 'Bash', status: 'running' }],
      agents: [],
      todos: { completed: 0, total: 0 },
    };
    const ctx = makeCtx({ transcript });
    const result = await toolActivity(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('\u25D0 Bash');
  });

  it('returns null when no tools', async () => {
    const transcript: TranscriptData = {
      tools: [],
      agents: [],
      todos: { completed: 0, total: 0 },
    };
    const ctx = makeCtx({ transcript });
    const result = await toolActivity(ctx);
    expect(result).toBeNull();
  });

  it('returns null when no transcript', async () => {
    const ctx = makeCtx();
    const result = await toolActivity(ctx);
    expect(result).toBeNull();
  });
});

describe('agentActivity component', () => {
  it('shows agent status', async () => {
    const transcript: TranscriptData = {
      tools: [],
      agents: [
        { name: 'Reviewer', status: 'completed' },
        { name: 'Coder', model: 'haiku', status: 'running' },
      ],
      todos: { completed: 0, total: 0 },
    };
    const ctx = makeCtx({ transcript });
    const result = await agentActivity(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('\u2713 Reviewer');
    expect(result!.raw).toContain('\u25D0 Coder');
    expect(result!.raw).toContain('[haiku]');
  });

  it('returns null when no agents', async () => {
    const transcript: TranscriptData = {
      tools: [],
      agents: [],
      todos: { completed: 0, total: 0 },
    };
    const ctx = makeCtx({ transcript });
    const result = await agentActivity(ctx);
    expect(result).toBeNull();
  });
});

describe('todoProgress component', () => {
  it('shows progress', async () => {
    const transcript: TranscriptData = {
      tools: [],
      agents: [],
      todos: { completed: 3, total: 5 },
    };
    const ctx = makeCtx({ transcript });
    const result = await todoProgress(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('3/5 todos');
  });

  it('returns null when no todos', async () => {
    const transcript: TranscriptData = {
      tools: [],
      agents: [],
      todos: { completed: 0, total: 0 },
    };
    const ctx = makeCtx({ transcript });
    const result = await todoProgress(ctx);
    expect(result).toBeNull();
  });
});

describe('speed component', () => {
  it('shows tokens per second', async () => {
    const ctx = makeCtx({
      speed: { tokensPerSecond: 42 },
    });
    const result = await speed(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('42 tok/s');
  });

  it('returns null when no speed data', async () => {
    const ctx = makeCtx();
    const result = await speed(ctx);
    expect(result).toBeNull();
  });
});

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    const colored = '\x1b[31mred\x1b[0m text';
    expect(stripAnsi(colored)).toBe('red text');
  });

  it('handles strings without ANSI codes', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});
