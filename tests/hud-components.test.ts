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
import usageQuota, { formatCountdown } from '../src/cli/hud/components/usage-quota.js';
import todoProgress from '../src/cli/hud/components/todo-progress.js';
import sessionCost from '../src/cli/hud/components/session-cost.js';
import releaseInfo from '../src/cli/hud/components/release-info.js';
import worktreeCount from '../src/cli/hud/components/worktree-count.js';
import configCounts from '../src/cli/hud/components/config-counts.js';
import { stripAnsi } from '../src/cli/hud/colors.js';

function makeCtx(overrides: Partial<GatherContext> = {}): GatherContext {
  return {
    stdin: {},
    git: null,
    transcript: null,
    usage: null,
    configCounts: null,
    learningCounts: null,
    costHistory: null,
    config: { enabled: true, detail: false, components: [] },
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
    staged: false,
    ahead: 0,
    behind: 0,
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    lastTag: null,
    commitsSinceTag: 0,
    worktreeCount: 1,
    ...overrides,
  };
}

function makeTranscript(overrides: Partial<TranscriptData> = {}): TranscriptData {
  return {
    tools: [],
    agents: [],
    todos: { completed: 0, total: 0 },
    skills: [],
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

  it('shows dirty indicator for unstaged changes', async () => {
    const ctx = makeCtx({
      git: makeGit({ branch: 'main', dirty: true }),
    });
    const result = await gitBranch(ctx);
    expect(result!.raw).toBe('main*');
  });

  it('shows staged indicator', async () => {
    const ctx = makeCtx({
      git: makeGit({ branch: 'main', staged: true }),
    });
    const result = await gitBranch(ctx);
    expect(result!.raw).toBe('main+');
    // Green for staged
    expect(result!.text).toContain('\x1b[32m');
  });

  it('shows both dirty and staged indicators', async () => {
    const ctx = makeCtx({
      git: makeGit({ branch: 'main', dirty: true, staged: true }),
    });
    const result = await gitBranch(ctx);
    expect(result!.raw).toBe('main*+');
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
    expect(result!.raw).toContain('5 files');
    expect(result!.raw).toContain('+100');
    expect(result!.raw).toContain('-30');
    // File count separated from line stats by dot
    expect(result!.raw).toContain('5 files \u00B7 +100');
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
  it('strips Claude prefix and shows name', async () => {
    const ctx = makeCtx({
      stdin: { model: { display_name: 'Claude Sonnet 4' } },
    });
    const result = await model(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Sonnet 4');
  });

  it('shows context window size in parens', async () => {
    const ctx = makeCtx({
      stdin: {
        model: { display_name: 'Opus 4.6' },
        context_window: { context_window_size: 1000000 },
      },
    });
    const result = await model(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Opus 4.6 [1m]');
  });

  it('shows sub-million context as k', async () => {
    const ctx = makeCtx({
      stdin: {
        model: { display_name: 'Claude Haiku 4.5' },
        context_window: { context_window_size: 200000 },
      },
    });
    const result = await model(ctx);
    expect(result!.raw).toBe('Haiku 4.5 [200k]');
  });

  it('strips existing context info from display_name', async () => {
    const ctx = makeCtx({
      stdin: {
        model: { display_name: 'Opus 4.6 (1M context)' },
        context_window: { context_window_size: 1000000 },
      },
    });
    const result = await model(ctx);
    expect(result!.raw).toBe('Opus 4.6 [1m]');
  });

  it('handles names without Claude prefix', async () => {
    const ctx = makeCtx({
      stdin: { model: { display_name: 'Opus 4.6' } },
    });
    const result = await model(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Opus 4.6');
  });

  it('returns null when no model', async () => {
    const ctx = makeCtx();
    const result = await model(ctx);
    expect(result).toBeNull();
  });
});

describe('contextUsage component', () => {
  it('shows green for low usage (<50%)', async () => {
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
    expect(result!.raw).toContain('Context ');
    expect(result!.raw).toContain('25%');
    expect(result!.raw).toContain('\u2588'); // filled bar
    expect(result!.raw).toContain('\u2591'); // empty bar
    // Green for < 50%
    expect(result!.text).toContain('\x1b[32m');
  });

  it('shows yellow for 50-79% usage', async () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 110000 },
        },
      },
    });
    const result = await contextUsage(ctx);
    expect(result!.raw).toContain('55%');
    // Yellow for 50-79%
    expect(result!.text).toContain('\x1b[33m');
  });

  it('shows red for 80%+ with token breakdown', async () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 180000 },
        },
      },
    });
    const result = await contextUsage(ctx);
    expect(result!.raw).toContain('90%');
    expect(result!.raw).toContain('(in: 180k)');
    // Red for 80%+
    expect(result!.text).toContain('\x1b[31m');
  });

  it('prefers used_percentage over computed value', async () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 50000 },
          used_percentage: 42,
        },
      },
    });
    const result = await contextUsage(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('42%');
  });

  it('renders 0% as valid green bar', async () => {
    const ctx = makeCtx({
      stdin: {
        context_window: {
          context_window_size: 200000,
          used_percentage: 0,
        },
      },
    });
    const result = await contextUsage(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('0%');
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
  it('shows both windows when available (no Session prefix)', async () => {
    const ctx = makeCtx({
      usage: { fiveHourPercent: 45, sevenDayPercent: 70, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).not.toContain('Session');
    expect(result!.raw).toContain('5h');
    expect(result!.raw).toContain('45%');
    expect(result!.raw).toContain('7d');
    expect(result!.raw).toContain('70%');
    expect(result!.raw).toContain('\u2588'); // filled bar
  });

  it('shows only 5h window when 7d is null', async () => {
    const ctx = makeCtx({
      usage: { fiveHourPercent: 30, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).not.toContain('Session');
    expect(result!.raw).toContain('5h');
    expect(result!.raw).toContain('30%');
    expect(result!.raw).not.toContain('7d');
  });

  it('shows only 7d window when 5h is null', async () => {
    const ctx = makeCtx({
      usage: { fiveHourPercent: null, sevenDayPercent: 70, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).not.toContain('Session');
    expect(result!.raw).toContain('7d');
    expect(result!.raw).toContain('70%');
    expect(result!.raw).not.toContain('5h');
  });

  it('returns null when no usage data', async () => {
    const ctx = makeCtx();
    const result = await usageQuota(ctx);
    expect(result).toBeNull();
  });

  it('returns null when both percentages are null', async () => {
    const ctx = makeCtx({
      usage: { fiveHourPercent: null, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).toBeNull();
  });

  it('shows countdown with hours+minutes for 5h window', async () => {
    // Add 30 extra seconds as buffer to avoid off-by-one-minute edge cases
    const twoHours15MinFromNow = Math.floor(Date.now() / 1000) + 2 * 3600 + 15 * 60 + 30;
    const ctx = makeCtx({
      usage: { fiveHourPercent: 45, sevenDayPercent: null, fiveHourResetsAt: twoHours15MinFromNow, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('(2h 15m)');
  });

  it('shows countdown with days+hours for 7d window', async () => {
    // Add 30 extra seconds as buffer
    const threeDays12HoursFromNow = Math.floor(Date.now() / 1000) + 3 * 86400 + 12 * 3600 + 30;
    const ctx = makeCtx({
      usage: { fiveHourPercent: null, sevenDayPercent: 70, fiveHourResetsAt: null, sevenDayResetsAt: threeDays12HoursFromNow },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('(3d 12h)');
  });

  it('shows countdown with minutes only', async () => {
    // Add 30 extra seconds as buffer
    const fortyFiveMinFromNow = Math.floor(Date.now() / 1000) + 45 * 60 + 30;
    const ctx = makeCtx({
      usage: { fiveHourPercent: 20, sevenDayPercent: null, fiveHourResetsAt: fortyFiveMinFromNow, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('(45m)');
  });

  it('countdown is placed after percent in parentheses', async () => {
    const twoHoursFromNow = Math.floor(Date.now() / 1000) + 2 * 3600;
    const ctx = makeCtx({
      usage: { fiveHourPercent: 45, sevenDayPercent: null, fiveHourResetsAt: twoHoursFromNow, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    const raw = result!.raw;
    const percentIdx = raw.indexOf('45%');
    const parenIdx = raw.indexOf('(');
    expect(percentIdx).toBeLessThan(parenIdx);
  });

  it('expired resets_at shows no countdown', async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const ctx = makeCtx({
      usage: { fiveHourPercent: 45, sevenDayPercent: null, fiveHourResetsAt: oneHourAgo, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).not.toContain('(');
  });

  it('null resets_at shows no countdown', async () => {
    const ctx = makeCtx({
      usage: { fiveHourPercent: 45, sevenDayPercent: 70, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const result = await usageQuota(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).not.toContain('(');
  });
});

describe('formatCountdown', () => {
  it('returns empty string for a past timestamp', () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    expect(formatCountdown(oneHourAgo)).toBe('');
  });

  it('returns hours and minutes for a 2h 30m remaining timestamp', () => {
    const twoHours30Min = Math.floor(Date.now() / 1000) + 2 * 3600 + 30 * 60 + 30;
    expect(formatCountdown(twoHours30Min)).toBe('2h 30m');
  });

  it('returns days and hours for a 2d 5h remaining timestamp', () => {
    const twoDays5Hours = Math.floor(Date.now() / 1000) + 2 * 86400 + 5 * 3600 + 30;
    expect(formatCountdown(twoDays5Hours)).toBe('2d 5h');
  });

  it('returns minutes only when under 1 hour remaining', () => {
    const fortyFiveMin = Math.floor(Date.now() / 1000) + 45 * 60 + 30;
    expect(formatCountdown(fortyFiveMin)).toBe('45m');
  });

  it('omits zero-minute sub-unit for exact day counts', () => {
    // Exactly 3 days: no leftover hours
    const exactlyThreeDays = Math.floor(Date.now() / 1000) + 3 * 86400 + 30;
    expect(formatCountdown(exactlyThreeDays)).toBe('3d');
  });

  it('omits zero-minute sub-unit for exact hour counts', () => {
    // Exactly 2 hours: no leftover minutes
    const exactlyTwoHours = Math.floor(Date.now() / 1000) + 2 * 3600 + 30;
    expect(formatCountdown(exactlyTwoHours)).toBe('2h');
  });
});

describe('todoProgress component', () => {
  it('shows progress in dim', async () => {
    const transcript = makeTranscript({
      todos: { completed: 3, total: 5 },
    });
    const ctx = makeCtx({ transcript });
    const result = await todoProgress(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('3/5 todos');
    // Dim styling
    expect(result!.text).toContain('\x1b[2m');
  });

  it('returns null when no todos', async () => {
    const transcript = makeTranscript();
    const ctx = makeCtx({ transcript });
    const result = await todoProgress(ctx);
    expect(result).toBeNull();
  });
});

describe('sessionCost component', () => {
  it('shows cost formatted as dollars', async () => {
    const ctx = makeCtx({
      stdin: { cost: { total_cost_usd: 0.42 } },
    });
    const result = await sessionCost(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('$0.42');
    // Dim styling
    expect(result!.text).toContain('\x1b[2m');
  });

  it('formats to two decimal places', async () => {
    const ctx = makeCtx({
      stdin: { cost: { total_cost_usd: 1.5 } },
    });
    const result = await sessionCost(ctx);
    expect(result!.raw).toBe('$1.50');
  });

  it('returns null when no cost data', async () => {
    const ctx = makeCtx();
    const result = await sessionCost(ctx);
    expect(result).toBeNull();
  });

  it('returns null when cost field exists but total_cost_usd is missing', async () => {
    const ctx = makeCtx({
      stdin: { cost: {} },
    });
    const result = await sessionCost(ctx);
    expect(result).toBeNull();
  });

  it('shows weekly and monthly cost when costHistory is present', async () => {
    const ctx = makeCtx({
      stdin: { cost: { total_cost_usd: 1.42 } },
      costHistory: { weeklyCost: 18.50, monthlyCost: 62.30 },
    });
    const result = await sessionCost(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('$1.42');
    expect(result!.raw).toContain('$18.50/wk');
    expect(result!.raw).toContain('$62.30/mo');
  });

  it('shows session cost only when costHistory is null', async () => {
    const ctx = makeCtx({
      stdin: { cost: { total_cost_usd: 1.42 } },
      costHistory: null,
    });
    const result = await sessionCost(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('$1.42');
    expect(result!.raw).not.toContain('/wk');
    expect(result!.raw).not.toContain('/mo');
  });

  it('shows weekly but not monthly when only weeklyCost is present', async () => {
    const ctx = makeCtx({
      stdin: { cost: { total_cost_usd: 1.42 } },
      costHistory: { weeklyCost: 18.50, monthlyCost: null },
    });
    const result = await sessionCost(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('$18.50/wk');
    expect(result!.raw).not.toContain('/mo');
  });
});

describe('releaseInfo component', () => {
  it('shows tag and commits since', async () => {
    const ctx = makeCtx({
      git: makeGit({ lastTag: 'v1.7.0', commitsSinceTag: 5 }),
    });
    const result = await releaseInfo(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('v1.7.0 +5');
  });

  it('shows tag only when count is 0', async () => {
    const ctx = makeCtx({
      git: makeGit({ lastTag: 'v1.7.0', commitsSinceTag: 0 }),
    });
    const result = await releaseInfo(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('v1.7.0');
  });

  it('returns null when no tags', async () => {
    const ctx = makeCtx({ git: makeGit() });
    const result = await releaseInfo(ctx);
    expect(result).toBeNull();
  });

  it('returns null when no git', async () => {
    const ctx = makeCtx();
    const result = await releaseInfo(ctx);
    expect(result).toBeNull();
  });
});

describe('worktreeCount component', () => {
  it('shows count when greater than 1', async () => {
    const ctx = makeCtx({
      git: makeGit({ worktreeCount: 3 }),
    });
    const result = await worktreeCount(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('3 worktrees');
  });

  it('returns null when only 1 worktree', async () => {
    const ctx = makeCtx({ git: makeGit() });
    const result = await worktreeCount(ctx);
    expect(result).toBeNull();
  });

  it('returns null when no git', async () => {
    const ctx = makeCtx();
    const result = await worktreeCount(ctx);
    expect(result).toBeNull();
  });
});

describe('configCounts component', () => {
  it('includes skills count from transcript', async () => {
    const transcript = makeTranscript({
      skills: ['software-design', 'testing', 'patterns'],
    });
    const ctx = makeCtx({
      transcript,
      configCounts: { claudeMdFiles: 1, rules: 0, mcpServers: 2, hooks: 3 },
    });
    const result = await configCounts(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).toContain('3 skills');
    expect(result!.raw).toContain('1 CLAUDE.md');
    expect(result!.raw).toContain('2 MCPs');
    expect(result!.raw).toContain('3 hooks');
  });

  it('omits skills when transcript has none', async () => {
    const ctx = makeCtx({
      configCounts: { claudeMdFiles: 1, rules: 0, mcpServers: 0, hooks: 0 },
    });
    const result = await configCounts(ctx);
    expect(result).not.toBeNull();
    expect(result!.raw).not.toContain('skills');
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
