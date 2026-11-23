import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { render } from '../src/hud/render.js';
import {
  HUD_COMPONENTS,
  getConfigPath,
  loadConfig,
  resolveComponents,
} from '../src/hud/config.js';
import { stripAnsi } from '../src/hud/colors.js';
import type { GatherContext, HudConfig, ComponentId, StdinData } from '../src/hud/types.js';

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
    codexUsage: null,
    configCounts: null,
    curationCounts: null,
    costHistory: null,
    config: {
      enabled: true,
      detail: false,
      forecast: false,
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

  it('shows usage quota when available', async () => {
    const ctx = makeCtx({
      usage: { fiveHourPercent: 30, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
    });
    const output = await render(ctx);
    const lines = output.split('\n').filter((l) => l.length > 0);

    expect(lines).toHaveLength(3);
    const raw = stripAnsi(output);
    expect(raw).toContain('5h');
    expect(raw).toContain('30%');
  });

  it('puts Codex quota on the capacity line right after the Claude quota', async () => {
    const ctx = makeCtx({
      usage: { fiveHourPercent: 30, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
      codexUsage: {
        windows: [{ minutes: 10080, usedPercent: 12, resetsAt: Math.floor(Date.now() / 1000) + 86400 + 30 }],
        limitReached: null,
        observedAt: Date.now(),
      },
      transcript: { tools: [], agents: [], todos: { completed: 1, total: 2 }, skills: [] },
    });
    const output = await render(ctx);
    const lines = output.split('\n').map((l) => stripAnsi(l));

    expect(lines).toHaveLength(3);
    const capacityLine = lines.find((l) => l.includes('Context'));
    expect(capacityLine).toMatch(/5h .{8} 30% \u00B7 Codex 7d .{8} 12% \(1d\) \u00B7 1\/2 todos$/);
  });

  it('keeps the Claude capacity line and session cost when Codex data is absent', async () => {
    const ctx = makeCtx({
      stdin: {
        model: { display_name: 'Claude Opus 4' },
        context_window: { context_window_size: 200000, used_percentage: 20 },
        cost: { total_cost_usd: 1.25 },
      },
      usage: { fiveHourPercent: 30, sevenDayPercent: 60, fiveHourResetsAt: null, sevenDayResetsAt: null },
      codexUsage: null,
    });
    const lines = stripAnsi(await render(ctx)).split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^Context .{8} 20% · 5h .{8} 30% · 7d .{8} 60%$/);
    expect(lines[2]).toBe('Opus 4 [200k] · $1.25');
    expect(lines.join('\n')).not.toContain('Codex');
  });

  it('renders todos at the end of the capacity line', async () => {
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
    const lines = output.split('\n').map((l) => stripAnsi(l));

    expect(lines).toHaveLength(3);
    const capacityLine = lines.find((l) => l.includes('Context'));
    expect(capacityLine).toBeDefined();
    expect(capacityLine).toContain('5h');
    expect(capacityLine!.endsWith('2/4 todos')).toBe(true);
    const raw = stripAnsi(output);
    expect(raw).toContain('2 CLAUDE.md');
    expect(raw).toContain('3 rules');
    expect(raw).toContain('1 MCPs');
    expect(raw).toContain('4 hooks');
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
      config: { enabled: true, detail: false, forecast: false, components: ['directory', 'model'] },
    });
    const output = await render(ctx);
    const raw = stripAnsi(output);

    expect(raw).toContain('project');
    expect(raw).toContain('Opus 4 [200k]');
    // Should not contain git info
    expect(raw).not.toContain('feat/test');
  });

  it('emits no blank lines between groups', async () => {
    const ctx = makeCtx({
      sessionStartTime: Date.now() - 5 * 60 * 1000,
      usage: { fiveHourPercent: 20, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null },
      transcript: {
        tools: [],
        agents: [],
        todos: { completed: 1, total: 3 },
        skills: [],
      },
      curationCounts: { decisions: 3, pitfalls: 1 },
    });
    const output = await render(ctx);
    const lines = output.split('\n');

    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.every((l) => l.length > 0)).toBe(true);
    expect(stripAnsi(lines[lines.length - 1])).toBe('Curation: 3 decisions, 1 pitfall');
  });
});

describe('week forecast on the capacity line', () => {
  const nowMs = Date.parse('2026-11-23T12:00:00Z');
  const resetIn = (hours: number) => nowMs / 1000 + hours * 3600;
  const week = (percent: unknown, reset: unknown = resetIn(84)) => ({
    rate_limits: { seven_day: { used_percentage: percent, resets_at: reset } },
  });

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
  });
  afterEach(() => vi.restoreAllMocks());

  function renderWeek(forecast: boolean, stdin: unknown, percent = 40, reset = resetIn(84)) {
    const config: HudConfig = { enabled: true, detail: false, forecast };
    return render(makeCtx({
      stdin: stdin as StdinData,
      // The version badge can query npm. It is not part of the capacity line.
      config: { ...config, components: resolveComponents(config).filter((id) => id !== 'versionBadge') },
      usage: { fiveHourPercent: 30, sevenDayPercent: percent, fiveHourResetsAt: null, sevenDayResetsAt: reset },
      codexUsage: {
        windows: [{ minutes: 10080, usedPercent: 12, resetsAt: resetIn(24) }],
        limitReached: null,
        observedAt: nowMs,
      },
    }));
  }

  it('keeps the pre-forecast capacity line byte for byte when off', async () => {
    const line = (await renderWeek(false, week(40))).split('\n')[1];

    expect(line).toBe(
      '\x1b[2m5h \x1b[0m\x1b[32m██\x1b[0m\x1b[2m░░░░░░\x1b[0m \x1b[32m30%\x1b[0m' +
      '\x1b[2m · \x1b[0m\x1b[2m7d \x1b[0m\x1b[32m███\x1b[0m\x1b[2m░░░░░\x1b[0m \x1b[32m40%\x1b[0m\x1b[2m (3d 12h)\x1b[0m' +
      '\x1b[2m · \x1b[0m\x1b[2mCodex \x1b[0m\x1b[2m7d \x1b[0m\x1b[32m█\x1b[0m\x1b[2m░░░░░░░\x1b[0m \x1b[32m12%\x1b[0m\x1b[2m (1d)\x1b[0m',
    );
  });

  it.each([
    [40, 84, '→ 80% by reset'],
    [70, 84, '→ 140% by reset, runs out in 1d 12h'],
    [99, 162, '→ >999% by reset, runs out in 3m'],
    [100, 84, '→ 200% by reset'],
    [0, 84, '→ 0% by reset'],
  ] as const)('adds a dim forecast after 7d and keeps each quota at %s%% used', async (percent, hours, text) => {
    const reset = resetIn(hours);
    const line = (await renderWeek(true, week(percent, reset), percent, reset)).split('\n')[1] ?? '';

    expect(stripAnsi(line).split(' · ')).toEqual([
      expect.stringMatching(/^5h .{8} 30%$/),
      expect.stringMatching(new RegExp(`^7d .{8} ${percent}% \\(`)),
      text,
      expect.stringMatching(/^Codex 7d .{8} 12% \(1d\)$/),
    ]);
    expect(line).toContain(`\x1b[2m${text}\x1b[0m`);
  });

  it.each([
    ['no rate_limits', {}],
    ['no seven_day', { rate_limits: {} }],
    ['a null seven_day', { rate_limits: { seven_day: null } }],
    ['a string seven_day', { rate_limits: { seven_day: '40' } }],
    ['an array seven_day', { rate_limits: { seven_day: [] } }],
    ['a string percent', week('40')],
    ['NaN percent', week(NaN)],
    ['negative percent', week(-1)],
    ['percent above 100', week(101)],
    ['no reset', { rate_limits: { seven_day: { used_percentage: 40 } } }],
    ['a string reset', week(40, String(resetIn(84)))],
    ['a reset at now', week(40, resetIn(0))],
    ['a past reset', week(40, resetIn(-1))],
    ['a reset more than 8 days away', week(40, resetIn(8 * 24) + 1)],
    ['a reset in milliseconds', week(40, resetIn(84) * 1000)],
    ['only 5 hours elapsed', week(40, resetIn(163))],
  ] as const)('keeps the output byte-identical to off with %s', async (_label, stdin) => {
    // The forecast must not fall back to the gathered quota when raw stdin is invalid.
    const off = await renderWeek(false, stdin);

    expect(off).toContain('Codex');
    expect(await renderWeek(true, stdin)).toBe(off);
  });
});

describe('config', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-hud-config-'));
    vi.stubEnv('HOME', tmpHome);
    fs.mkdirSync(path.join(tmpHome, '.devflow'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('loadConfig returns defaults when no file exists', () => {
    expect(loadConfig()).toEqual({ enabled: true, detail: false, forecast: false });
  });

  it.each([
    ['{"forecast":true}', true],
    ['{"forecast":false}', false],
    ['{}', false],
    ['{"forecast":"true"}', false],
    ['{"forecast":1}', false],
    ['{"forecast":true', false],
  ] as const)('loads the forecast opt-in from %s as %s', (json, forecast) => {
    fs.writeFileSync(getConfigPath(), json);

    expect(loadConfig().forecast).toBe(forecast);
  });

  it('getConfigPath resolves under $HOME/.devflow and ignores an exported DEVFLOW_DIR (D-ONE-HOME, AC-10)', () => {
    const canary = fs.mkdtempSync(path.join(tmpHome, 'hud-config-canary-'));
    vi.stubEnv('DEVFLOW_DIR', canary);

    expect(getConfigPath()).toBe(path.join(tmpHome, '.devflow', 'hud.json'));
    loadConfig();
    expect(fs.readdirSync(canary)).toEqual([]);
  });

  it('resolveComponents returns the default components when forecast is off', () => {
    const config: HudConfig = { enabled: true, detail: false, forecast: false };
    expect(resolveComponents(config)).toEqual(HUD_COMPONENTS);
  });

  it('resolveComponents adds weekForecast when HUD and forecast are on', () => {
    const config: HudConfig = { enabled: true, detail: false, forecast: true };
    expect(resolveComponents(config)).toEqual([...HUD_COMPONENTS, 'weekForecast']);
  });

  it('resolveComponents returns only versionBadge when HUD is off even with forecast on', () => {
    const config: HudConfig = { enabled: false, detail: false, forecast: true };
    expect(resolveComponents(config)).toEqual(['versionBadge']);
  });

  it('HUD_COMPONENTS has 15 components (sessionDuration retained but omitted from defaults)', () => {
    expect(HUD_COMPONENTS).toHaveLength(15);
  });

  it('HUD_COMPONENTS lists codexQuota right after usageQuota', () => {
    expect(HUD_COMPONENTS.indexOf('codexQuota')).toBe(HUD_COMPONENTS.indexOf('usageQuota') + 1);
  });
});
