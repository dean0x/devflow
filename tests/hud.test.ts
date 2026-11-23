import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  addHudStatusLine,
  removeHudStatusLine,
  hasHudStatusLine,
  hasNonDevFlowStatusLine,
  createHudCommand,
} from '../src/cli/commands/hud.js';
import { runCleanupPhase } from '../src/cli/commands/uninstall.js';
import * as hudConfig from '../src/hud/config.js';
import type { HudConfig } from '../src/hud/types.js';
import { stripAnsi } from '../src/hud/colors.js';

describe('hud config flags', () => {
  let tmpHome: string;
  const runHud = (...args: string[]) => createHudCommand().exitOverride().parseAsync(args, { from: 'user' });
  const settingsPath = () => path.join(tmpHome, '.claude', 'settings.json');
  const statusLine = () => ({ type: 'command', command: path.join(tmpHome, '.devflow', 'scripts', 'hud.sh') });
  const readConfig = async (): Promise<unknown> => JSON.parse(await fs.readFile(hudConfig.getConfigPath(), 'utf-8'));
  const readSettings = async (): Promise<unknown> => JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-hud-flags-'));
    vi.stubEnv('HOME', tmpHome);
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.dirname(settingsPath()));
    await fs.mkdir(path.dirname(settingsPath()));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it.each([
    ['--forecast', { enabled: false, detail: true, forecast: false }],
    ['--no-forecast', { enabled: true, detail: false, forecast: true }],
  ] as const)('%s saves only the forecast change', async (flag, config) => {
    hudConfig.saveConfig(config);

    await runHud(flag);

    expect(await readConfig()).toEqual({ ...config, forecast: !config.forecast });
  });

  it.each([
    [true, 'on', '--no-forecast'],
    [false, 'off', '--forecast'],
  ] as const)('--status reports forecast %s without a config change', async (forecast, label, flag) => {
    const config: HudConfig = { enabled: true, detail: false, forecast };
    hudConfig.saveConfig(config);
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await runHud('--status', flag);

    expect(stripAnsi(output.mock.calls.map(([text]) => String(text)).join(''))).toMatch(
      new RegExp(`Forecast:\\s+${label}\\b`),
    );
    expect(await readConfig()).toEqual(config);
  });

  it('lists both forecast flags without a change flag', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await runHud();

    const text = stripAnsi(output.mock.calls.map(([chunk]) => String(chunk)).join(''));
    expect(text).toContain('devflow hud --forecast');
    expect(text).toContain('devflow hud --no-forecast');
    expect(text).not.toContain('weekForecast');
  });

  it('saves both detail and forecast in one write', async () => {
    hudConfig.saveConfig({ enabled: false, detail: false, forecast: false });
    const save = vi.spyOn(hudConfig, 'saveConfig');

    await runHud('--detail', '--forecast');

    expect(save).toHaveBeenCalledTimes(1);
    expect(await readConfig()).toEqual({ enabled: false, detail: true, forecast: true });
  });

  it('--enable with --forecast saves both and registers the status line', async () => {
    hudConfig.saveConfig({ enabled: false, detail: true, forecast: false });

    await runHud('--enable', '--forecast');

    expect(await readConfig()).toEqual({ enabled: true, detail: true, forecast: true });
    expect(await readSettings()).toEqual({ statusLine: statusLine() });
  });

  it('--detail with --enable saves both and registers the status line', async () => {
    hudConfig.saveConfig({ enabled: false, detail: false, forecast: true });

    await runHud('--detail', '--enable');

    expect(await readConfig()).toEqual({ enabled: true, detail: true, forecast: true });
    expect(await readSettings()).toEqual({ statusLine: statusLine() });
  });

  it('--detail with --disable saves both and removes the status line', async () => {
    hudConfig.saveConfig({ enabled: true, detail: false, forecast: true });
    await fs.writeFile(settingsPath(), JSON.stringify({ statusLine: statusLine(), model: 'opus' }));

    await runHud('--detail', '--disable');

    expect(await readConfig()).toEqual({ enabled: false, detail: true, forecast: true });
    expect(await readSettings()).toEqual({ model: 'opus' });
  });

  it('saves and reports both options when non-interactive --enable leaves a foreign status line', async () => {
    const settings = { statusLine: { type: 'command', command: 'custom-status' } };
    await fs.writeFile(settingsPath(), JSON.stringify(settings));
    hudConfig.saveConfig({ enabled: false, detail: false, forecast: false });
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(Object.create(process.stdin, { isTTY: { value: false } }));
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await runHud('--enable', '--detail', '--forecast');

    expect(await readConfig()).toEqual({ enabled: false, detail: true, forecast: true });
    expect(await readSettings()).toEqual(settings);
    expect(stripAnsi(output.mock.calls.map(([text]) => String(text)).join(''))).toMatch(
      /HUD detail enabled[\s\S]*HUD forecast enabled[\s\S]*Non-interactive mode/,
    );
  });
});

describe('addHudStatusLine', () => {
  it('adds statusLine to empty settings', () => {
    const result = addHudStatusLine('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeDefined();
    expect(settings.statusLine.type).toBe('command');
    expect(settings.statusLine.command).toContain('hud.sh');
    expect(settings.statusLine.command).toContain('/home/user/.devflow');
  });

  it('uses correct devflowDir path', () => {
    const result = addHudStatusLine('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe(
      '/custom/path/.devflow/scripts/hud.sh',
    );
  });

  it('is idempotent — does not duplicate', () => {
    const first = addHudStatusLine('{}', '/home/user/.devflow');
    const second = addHudStatusLine(first, '/home/user/.devflow');

    expect(second).toBe(first);
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
      env: { SOME_VAR: '1' },
    });
    const result = addHudStatusLine(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.statusLine.command).toContain('hud.sh');
  });

  it('replaces the legacy devflow statusline.sh with HUD', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/old/path/.devflow/scripts/statusline.sh' },
    });
    const result = addHudStatusLine(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('/home/user/.devflow/scripts/hud.sh');
  });

  it('leaves a foreign statusline.sh outside a .devflow/scripts directory alone (D-HUD-EXACT-OWNER)', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/old/path/statusline.sh' },
    });
    const result = addHudStatusLine(input, '/home/user/.devflow');

    expect(result).toBe(input);
  });
});

describe('removeHudStatusLine', () => {
  it('removes HUD statusLine', () => {
    const withHud = addHudStatusLine('{}', '/home/user/.devflow');
    const result = removeHudStatusLine(withHud);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
  });

  it('removes the legacy devflow statusline.sh', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/.devflow/scripts/statusline.sh' },
    });
    const result = removeHudStatusLine(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
  });

  it('keeps a bare statusline.sh — the name alone is not devflow\'s (D-HUD-EXACT-OWNER)', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/statusline.sh' },
    });

    expect(removeHudStatusLine(input)).toBe(input);
  });

  it('does not remove non-Devflow statusLine', () => {
    const input = JSON.stringify({
      statusLine: {
        type: 'command',
        command: '/some/other/tool/status.sh',
      },
    });
    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
  });

  it('is idempotent — safe when no statusLine', () => {
    const input = JSON.stringify({ hooks: {} });
    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/.devflow/scripts/hud.sh' },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    });
    const result = removeHudStatusLine(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
    expect(settings.hooks.Stop).toHaveLength(1);
  });
});

describe('hasHudStatusLine', () => {
  it('returns true when HUD is present', () => {
    const withHud = addHudStatusLine('{}', '/home/user/.devflow');
    expect(hasHudStatusLine(withHud)).toBe(true);
  });

  it('returns true for the legacy devflow statusline.sh', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/.devflow/scripts/statusline.sh' },
    });
    expect(hasHudStatusLine(input)).toBe(true);
  });

  it('returns false for a bare statusline.sh (D-HUD-EXACT-OWNER)', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/path/statusline.sh' },
    });
    expect(hasHudStatusLine(input)).toBe(false);
  });

  it('returns false when absent', () => {
    expect(hasHudStatusLine('{}')).toBe(false);
  });

  it('returns false for non-Devflow statusLine', () => {
    const input = JSON.stringify({
      statusLine: {
        type: 'command',
        command: '/other/tool/status.sh',
      },
    });
    expect(hasHudStatusLine(input)).toBe(false);
  });
});

/**
 * Drift self-healing contract tests.
 *
 * The --disable command is now idempotent end-to-end: it always attempts to
 * strip a lingering Devflow statusLine from settings.json even when hud.json
 * already says disabled. The pure-function layer that --disable delegates to
 * (removeHudStatusLine) must satisfy these properties for the self-healing
 * to be correct.
 */
describe('--disable drift self-healing (via removeHudStatusLine)', () => {
  it('removes a lingering Devflow hud.sh statusLine when config was already disabled', () => {
    // Simulates: hud.json says enabled=false but settings.json still has the statusLine
    // (drift from a partial prior state such as a crash between config-write and settings-write).
    const driftedSettings = JSON.stringify({
      statusLine: { type: 'command', command: '/home/user/.devflow/scripts/hud.sh' },
      env: { FOO: 'bar' },
    });

    const result = removeHudStatusLine(driftedSettings);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
    // Other settings must survive
    expect(settings.env.FOO).toBe('bar');
  });

  it('removes a lingering legacy statusline.sh when config was already disabled', () => {
    const driftedSettings = JSON.stringify({
      statusLine: { type: 'command', command: '/old/path/.devflow/scripts/statusline.sh' },
    });

    const result = removeHudStatusLine(driftedSettings);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toBeUndefined();
  });

  it('does NOT remove a non-Devflow statusLine — third-party statusLine must survive --disable', () => {
    // A user may have their own statusLine from another tool.
    // --disable must never remove it (removeHudStatusLine returns unchanged JSON).
    const input = JSON.stringify({
      statusLine: { type: 'command', command: '/usr/local/bin/my-custom-statusbar.sh' },
    });

    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
    expect(JSON.parse(result).statusLine.command).toBe('/usr/local/bin/my-custom-statusbar.sh');
  });

  it('is a no-op (returns identical JSON) when no statusLine is present', () => {
    // When config is already disabled AND settings has no statusLine,
    // removeHudStatusLine must return the same string (content unchanged).
    // The --disable command uses changed-content detection (updated !== settingsContent)
    // to decide whether to write; unchanged means no write.
    const input = JSON.stringify({ env: { FOO: 'bar' } });

    const result = removeHudStatusLine(input);

    expect(result).toBe(input);
  });
});

describe('hasNonDevFlowStatusLine', () => {
  it('returns true for external statusLine', () => {
    const input = JSON.stringify({
      statusLine: {
        type: 'command',
        command: '/other/tool/my-status.sh',
      },
    });
    expect(hasNonDevFlowStatusLine(input)).toBe(true);
  });

  it('returns false for Devflow HUD', () => {
    const withHud = addHudStatusLine('{}', '/home/user/.devflow');
    expect(hasNonDevFlowStatusLine(withHud)).toBe(false);
  });

  it('returns false when no statusLine', () => {
    expect(hasNonDevFlowStatusLine('{}')).toBe(false);
  });
});

describe('a hand-edited statusLine whose command is not a string', () => {
  const NON_STRING_COMMANDS: readonly unknown[] = [42, true, ['/home/user/.devflow/scripts/hud.sh'], { path: 'hud.sh' }];
  const settingsWith = (command: unknown): string =>
    JSON.stringify({ statusLine: { type: 'command', command }, model: 'opus' }, null, 2) + '\n';

  it.each(NON_STRING_COMMANDS)('is not devflow\'s (command %j)', (command) => {
    const input = settingsWith(command);
    expect(hasHudStatusLine(input)).toBe(false);
    expect(hasNonDevFlowStatusLine(input)).toBe(true);
  });

  it.each(NON_STRING_COMMANDS)('is left byte-identical by addHudStatusLine and removeHudStatusLine (command %j)', (command) => {
    const input = settingsWith(command);
    expect(addHudStatusLine(input, '/home/user/.devflow')).toBe(input);
    expect(removeHudStatusLine(input)).toBe(input);
  });
});

/**
 * TP-23 (AC-19, D-HUD-EXACT-OWNER): a statusLine is devflow's only when its command
 * ends in `/.devflow/scripts/hud.sh` or the legacy `/.devflow/scripts/statusline.sh`.
 * Every other command — the Claude Code docs' own `~/.claude/statusline.sh`, a tool
 * installed under an `/opt/devflow/` directory — is the user's, and survives each
 * caller that converges the statusLine:
 *   - `addHudStatusLine`: init's settings pass with the HUD on, `init --hud-only`,
 *     `hud --enable`;
 *   - `removeHudStatusLine`: init's settings pass with `--no-hud`, `hud --disable`,
 *     and uninstall's `runCleanupPhase`.
 * The two in-process runs below drive `hud --disable` and `runCleanupPhase` for real.
 */
describe('TP-23: statusLine ownership is exact (AC-19)', () => {
  const FOREIGN_COMMANDS = [
    '~/.claude/statusline.sh',
    '/home/user/.claude/statusline.sh',
    '/opt/devflow/statusline.sh',
    '/opt/devflow/scripts/hud.sh',
    'bash /usr/local/share/devflow/hud.sh',
    'C:\\tools\\devflow\\statusline.sh',
    '/home/user/.devflow/scripts/hud.sh.bak',
  ];
  const DEVFLOW_COMMANDS = [
    '/home/user/.devflow/scripts/hud.sh',
    '/Users/someone/.devflow/scripts/statusline.sh',
    '~/.devflow/scripts/statusline.sh',
    '/srv/repo/.devflow/scripts/hud.sh',
    'C:\\Users\\user\\.devflow\\scripts\\hud.sh',
  ];
  const settingsWith = (command: string): string =>
    JSON.stringify({ statusLine: { type: 'command', command }, model: 'opus' }, null, 2) + '\n';

  it.each(FOREIGN_COMMANDS)('a foreign statusLine %s is not devflow\'s', (command) => {
    const input = settingsWith(command);
    expect(hasHudStatusLine(input)).toBe(false);
    expect(hasNonDevFlowStatusLine(input)).toBe(true);
  });

  it.each(FOREIGN_COMMANDS)('init with the HUD on (addHudStatusLine) leaves %s byte-identical', (command) => {
    const input = settingsWith(command);
    expect(addHudStatusLine(input, '/home/user/.devflow')).toBe(input);
  });

  it.each(FOREIGN_COMMANDS)('init --no-hud, hud --disable and uninstall (removeHudStatusLine) leave %s byte-identical', (command) => {
    const input = settingsWith(command);
    expect(removeHudStatusLine(input)).toBe(input);
  });

  it.each(DEVFLOW_COMMANDS)('devflow\'s own statusLine %s is replaced by init with the HUD on', (command) => {
    const input = settingsWith(command);
    expect(hasHudStatusLine(input)).toBe(true);
    const settings = JSON.parse(addHudStatusLine(input, '/home/user/.devflow'));
    expect(settings.statusLine.command).toBe('/home/user/.devflow/scripts/hud.sh');
    expect(settings.model).toBe('opus');
  });

  it.each(DEVFLOW_COMMANDS)('devflow\'s own statusLine %s is removed by init --no-hud, hud --disable and uninstall', (command) => {
    const settings = JSON.parse(removeHudStatusLine(settingsWith(command)));
    expect(settings.statusLine).toBeUndefined();
    expect(settings.model).toBe('opus');
  });

  describe('in-process: hud --disable and the uninstall cleanup phase', () => {
    let tmpHome: string;
    let settingsPath: string;

    beforeEach(async () => {
      tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-hud-owner-'));
      vi.stubEnv('HOME', tmpHome);
      // detectShell() reads PSModulePath (set on GitHub's Ubuntu runners) before
      // SHELL; pin both so the uninstall's safe-delete probe stays on a known shell.
      vi.stubEnv('PSModulePath', '');
      vi.stubEnv('SHELL', '/bin/zsh');
      await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
      await fs.mkdir(path.join(tmpHome, '.devflow'), { recursive: true });
      settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await fs.rm(tmpHome, { recursive: true, force: true });
    });

    it('hud --disable leaves a foreign ~/.claude/statusline.sh byte-identical', async () => {
      const input = settingsWith(path.join(tmpHome, '.claude', 'statusline.sh'));
      await fs.writeFile(settingsPath, input, 'utf-8');

      await createHudCommand().parseAsync(['--disable'], { from: 'user' });

      expect(await fs.readFile(settingsPath, 'utf-8')).toBe(input);
    });

    it('hud --disable removes devflow\'s own hud.sh (non-vacuity)', async () => {
      await fs.writeFile(settingsPath, settingsWith(path.join(tmpHome, '.devflow', 'scripts', 'hud.sh')), 'utf-8');

      await createHudCommand().parseAsync(['--disable'], { from: 'user' });

      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(settings.statusLine).toBeUndefined();
      expect(settings.model).toBe('opus');
    });

    it('uninstall (runCleanupPhase) keeps a foreign /opt/devflow statusLine and removes devflow\'s', async () => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-hud-owner-cwd-'));
      try {
        await fs.writeFile(settingsPath, settingsWith('/opt/devflow/statusline.sh'), 'utf-8');
        await runCleanupPhase({ scopesToUninstall: ['user'], keepDocs: true, verbose: false, cwd, isTTY: false });
        const kept = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        expect(kept.statusLine).toEqual({ type: 'command', command: '/opt/devflow/statusline.sh' });

        await fs.writeFile(settingsPath, settingsWith(path.join(tmpHome, '.devflow', 'scripts', 'hud.sh')), 'utf-8');
        await runCleanupPhase({ scopesToUninstall: ['user'], keepDocs: true, verbose: false, cwd, isTTY: false });
        const removed = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        expect(removed.statusLine).toBeUndefined();
        expect(removed.model, 'the file was parsed and rewritten, not deleted').toBe('opus');
      } finally {
        await fs.rm(cwd, { recursive: true, force: true });
      }
    });
  });
});
