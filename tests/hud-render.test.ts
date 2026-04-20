import { describe, it, expect } from 'vitest';
import { render } from '../src/cli/hud/render.js';
import {
  HUD_COMPONENTS,
  loadConfig,
  resolveComponents,
} from '../src/cli/hud/config.js';
import { stripAnsi } from '../src/cli/hud/colors.js';
import type { GatherContext, HudConfig, ComponentId } from '../src/cli/hud/types.js';

function makeCtx(
  overrides: Partial<GatherContext> & { config?: Partial<HudConfig> & { components?: ComponentId[] } } = {},
): GatherContext {
  const { config: configOverride, ...rest } = overrides;
  return {
    stdin: {
      cwd: '/home/user/project',
      model: { display_name: 'Claude Opus 4' },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 40000 },
      },
    },
    git: {
      branch: 'feat/test',
      dirty: false,
      staged: false,
      ahead: 2,
      behind: 0,
      filesChanged: 3,
      additions: 50,
      deletions: 10,
      lastTag: null,
      commitsSinceTag: 0,
      worktreeCount: 1,
    },
    transcript: null,
    usage: null,
    configCounts: null,
    learningCounts: null,
    costHistory: null,
    config: {
      enabled: true,
      detail: false,
      components: [...HUD_COMPONENTS],
      ...configOverride,
    },
    devflowDir: '/test/.devflow',
    sessionStartTime: null,
    terminalWidth: 120,
    ...rest,
  };
}

describe('render', () => {
  it('all components produces three lines', async () => {
    const ctx = makeCtx();
    const output = await render(ctx);
    const lines = output.split('\n').filter((l) => l.length > 0);

    // Line 1: git, Line 2: context, Line 3: model
    expect(lines).toHaveLength(3);
    const raw = stripAnsi(output);
    expect(raw).toContain('project');
    expect(raw).toContain('feat/test');
    expect(raw).toContain('Opus 4 [200k]');
    expect(raw).toContain('20%');
  });

  it('uses dot separator between components', async () => {
    const ctx = makeCtx();
    const output = await render(ctx);
    const raw = stripAnsi(output);
    expect(raw).toContain('\u00B7');
  });

  it('shows session data when available', async () => {
    const ctx = makeCtx({
      sessionStartTime: Date.now() - 15 * 60 * 1000,
      usage: { fiveHourPercent: 30, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const output = await render(ctx);
    const lines = output.split('\n').filter((l) => l.length > 0);

    expect(lines).toHaveLength(3);
    const raw = stripAnsi(output);
    expect(raw).toContain('15m');
    expect(raw).toContain('5h');
    expect(raw).toContain('30%');
  });

  it('shows activity section with todos and config counts', async () => {
    const ctx = makeCtx({
      sessionStartTime: Date.now() - 5 * 60 * 1000,
      usage: { fiveHourPercent: 20, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
      transcript: {
        tools: [],
        agents: [],
        todos: { completed: 2, total: 4 },
        skills: [],
      },
      configCounts: {
        claudeMdFiles: 2,
        rules: 3,
        mcpServers: 1,
        hooks: 4,
      },
    });
    const output = await render(ctx);
    const lines = output.split('\n').filter((l) => l.length > 0);

    // 3 info lines + blank + todo line = 4+
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const raw = stripAnsi(output);
    expect(raw).toContain('2/4 todos');
    expect(raw).toContain('2 CLAUDE.md');
    expect(raw).toContain('3 rules');
    expect(raw).toContain('1 MCPs');
    expect(raw).toContain('4 hooks');
    expect(raw).toContain('5h');
  });

  it('components that return null are excluded', async () => {
    const ctx = makeCtx({
      stdin: {},
      git: null,
    });
    const output = await render(ctx);

    expect(output).toBe('');
  });

  it('handles subset of components', async () => {
    const ctx = makeCtx({
      config: { enabled: true, detail: false, components: ['directory', 'model'] },
    });
    const output = await render(ctx);
    const raw = stripAnsi(output);

    expect(raw).toContain('project');
    expect(raw).toContain('Opus 4 [200k]');
    // Should not contain git info
    expect(raw).not.toContain('feat/test');
  });

  it('inserts blank line between info and activity sections', async () => {
    const ctx = makeCtx({
      sessionStartTime: Date.now() - 5 * 60 * 1000,
      usage: { fiveHourPercent: 20, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
      transcript: {
        tools: [],
        agents: [],
        todos: { completed: 1, total: 3 },
        skills: [],
      },
    });
    const output = await render(ctx);
    const lines = output.split('\n');

    // Should contain an empty line between info and activity sections
    expect(lines).toContain('');
    // Empty line should be between non-empty lines
    const emptyIdx = lines.indexOf('');
    expect(emptyIdx).toBeGreaterThan(0);
    expect(emptyIdx).toBeLessThan(lines.length - 1);
  });

  it('no blank line when activity section is empty', async () => {
    const ctx = makeCtx({
      sessionStartTime: Date.now() - 5 * 60 * 1000,
      usage: { fiveHourPercent: 20, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const output = await render(ctx);
    const lines = output.split('\n');

    // No empty lines — no activity components have data
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });
});

describe('config', () => {
  it('loadConfig returns default when no file exists', () => {
    // Point to a non-existent directory
    const originalEnv = process.env.DEVFLOW_DIR;
    process.env.DEVFLOW_DIR = '/tmp/nonexistent-devflow-test-dir';
    try {
      const config = loadConfig();
      expect(config.enabled).toBe(true);
      expect(config.detail).toBe(false);
    } finally {
      if (originalEnv !== undefined) {
        process.env.DEVFLOW_DIR = originalEnv;
      } else {
        delete process.env.DEVFLOW_DIR;
      }
    }
  });

  it('resolveComponents returns all components when enabled', () => {
    const config: HudConfig = { enabled: true, detail: false };
    expect(resolveComponents(config)).toEqual([...HUD_COMPONENTS]);
  });

  it('resolveComponents returns only versionBadge when disabled', () => {
    const config: HudConfig = { enabled: false, detail: false };
    expect(resolveComponents(config)).toEqual(['versionBadge']);
  });

  it('HUD_COMPONENTS has 16 components', () => {
    expect(HUD_COMPONENTS).toHaveLength(16);
  });
});
