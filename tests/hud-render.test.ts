import { describe, it, expect } from 'vitest';
import { render } from '../src/cli/hud/render.js';
import {
  PRESETS,
  loadConfig,
  resolveComponents,
} from '../src/cli/hud/config.js';
import { stripAnsi } from '../src/cli/hud/colors.js';
import type { GatherContext, HudConfig } from '../src/cli/hud/types.js';

function makeCtx(
  config: HudConfig,
  overrides: Partial<GatherContext> = {},
): GatherContext {
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
      ahead: 2,
      behind: 0,
      filesChanged: 3,
      additions: 50,
      deletions: 10,
    },
    transcript: null,
    usage: null,
    speed: null,
    configCounts: null,
    config,
    devflowDir: '/test/.devflow',
    sessionStartTime: null,
    terminalWidth: 120,
    ...overrides,
  };
}

describe('render', () => {
  it('minimal preset produces single line', async () => {
    const config: HudConfig = {
      preset: 'minimal',
      components: PRESETS.minimal,
    };
    const ctx = makeCtx(config);
    const output = await render(ctx);
    const lines = output.split('\n').filter((l) => l.length > 0);

    expect(lines).toHaveLength(1);
    const raw = stripAnsi(output);
    expect(raw).toContain('project');
    expect(raw).toContain('feat/test');
    expect(raw).toContain('Claude Opus 4');
    expect(raw).toContain('20%');
  });

  it('classic preset produces single line', async () => {
    const config: HudConfig = {
      preset: 'classic',
      components: PRESETS.classic,
    };
    const ctx = makeCtx(config);
    const output = await render(ctx);
    const lines = output.split('\n').filter((l) => l.length > 0);

    // All classic components are in LINE_1
    expect(lines).toHaveLength(1);
    const raw = stripAnsi(output);
    expect(raw).toContain('project');
    expect(raw).toContain('feat/test');
    expect(raw).toContain('2\u2191'); // ahead arrows
    expect(raw).toContain('+50');
    expect(raw).toContain('-10');
    expect(raw).toContain('Claude Opus 4');
    expect(raw).toContain('20%');
  });

  it('standard preset produces 2 lines with session data', async () => {
    const config: HudConfig = {
      preset: 'standard',
      components: PRESETS.standard,
    };
    const ctx = makeCtx(config, {
      sessionStartTime: Date.now() - 15 * 60 * 1000,
      usage: { dailyUsagePercent: 30, weeklyUsagePercent: null },
    });
    const output = await render(ctx);
    const lines = output.split('\n').filter((l) => l.length > 0);

    // Line 1: core info, Line 2: session + usage
    expect(lines).toHaveLength(2);
    const raw = stripAnsi(output);
    expect(raw).toContain('15m');
    expect(raw).toContain('30%');
  });

  it('full preset produces 2+ lines with transcript data', async () => {
    const config: HudConfig = {
      preset: 'full',
      components: PRESETS.full,
    };
    const ctx = makeCtx(config, {
      sessionStartTime: Date.now() - 5 * 60 * 1000,
      usage: { dailyUsagePercent: 20, weeklyUsagePercent: null },
      transcript: {
        tools: [
          { name: 'Read', status: 'completed' },
          { name: 'Bash', status: 'running' },
        ],
        agents: [{ name: 'Reviewer', status: 'completed' }],
        todos: { completed: 2, total: 4 },
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

    // Should have multiple lines
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const raw = stripAnsi(output);
    expect(raw).toContain('Read');
    expect(raw).toContain('Reviewer');
    expect(raw).toContain('2/4 todos');
    expect(raw).toContain('2 CLAUDE.md');
    expect(raw).toContain('3 rules');
    expect(raw).toContain('1 MCPs');
    expect(raw).toContain('4 hooks');
  });

  it('components that return null are excluded', async () => {
    const config: HudConfig = {
      preset: 'minimal',
      components: PRESETS.minimal,
    };
    // No cwd, no model, no context — all components return null
    const ctx = makeCtx(config, {
      stdin: {},
      git: null,
    });
    const output = await render(ctx);

    expect(output).toBe('');
  });

  it('handles custom preset with subset of components', async () => {
    const config: HudConfig = {
      preset: 'custom',
      components: ['directory', 'model'],
    };
    const ctx = makeCtx(config);
    const output = await render(ctx);
    const raw = stripAnsi(output);

    expect(raw).toContain('project');
    expect(raw).toContain('Claude Opus 4');
    // Should not contain git info
    expect(raw).not.toContain('feat/test');
  });
});

describe('config', () => {
  it('loadConfig returns default when no file exists', () => {
    // Point to a non-existent directory
    const originalEnv = process.env.DEVFLOW_DIR;
    process.env.DEVFLOW_DIR = '/tmp/nonexistent-devflow-test-dir';
    try {
      const config = loadConfig();
      expect(config.preset).toBe('standard');
      expect(config.components).toEqual(PRESETS.standard);
    } finally {
      if (originalEnv !== undefined) {
        process.env.DEVFLOW_DIR = originalEnv;
      } else {
        delete process.env.DEVFLOW_DIR;
      }
    }
  });

  it('resolveComponents returns preset components', () => {
    const config: HudConfig = { preset: 'minimal', components: [] };
    expect(resolveComponents(config)).toEqual(PRESETS.minimal);
  });

  it('resolveComponents returns custom components', () => {
    const config: HudConfig = {
      preset: 'custom',
      components: ['directory', 'model'],
    };
    expect(resolveComponents(config)).toEqual(['directory', 'model']);
  });

  it('PRESETS.minimal has 4 components', () => {
    expect(PRESETS.minimal).toHaveLength(4);
  });

  it('PRESETS.classic has 7 components', () => {
    expect(PRESETS.classic).toHaveLength(7);
  });

  it('PRESETS.standard has 9 components', () => {
    expect(PRESETS.standard).toHaveLength(9);
  });

  it('PRESETS.full has 14 components', () => {
    expect(PRESETS.full).toHaveLength(14);
  });
});
