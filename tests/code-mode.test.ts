import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as codeMode from '../src/core/code-mode.js';
import * as proxyState from '../src/core/proxy-state.js';

const CODE_ENV = 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE';
const TRAFFIC_ENV = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
const proxyBlocker = 'Code Mode does not start while the Devflow proxy is on.';
const trafficBlocker = 'Code Mode does not start while disable-nonessential-traffic is on. Run `devflow flags --disable code-mode`.';
const onRecord = { 'code-mode': true };

const bothBlockers = { codeModeOn: true, proxyOn: true, trafficOn: true };
const codeModeOff = { ...bothBlockers, codeModeOn: false };

describe('Code Mode and traffic state', () => {
  it.each(['0', 'true', '', 1, null, false])('counts a settings value of %j as off despite an on record', (value) => {
    expect(codeMode.isCodeModeOn(onRecord, { [CODE_ENV]: value })).toBe(false);
  });

  it('counts the owned payload as active even if the recorded flag is off', () => {
    expect(codeMode.isCodeModeOn({ 'code-mode': false }, { [CODE_ENV]: '1' })).toBe(true);
  });

  it('uses the record when the settings key is absent', () => {
    expect(codeMode.isCodeModeOn(onRecord, {})).toBe(true);
  });

  it('counts Code Mode as off when no source has a value', () => {
    expect(codeMode.isCodeModeOn(null, undefined)).toBe(false);
  });

  it.each(['1', 'FALSE', 'no', '', 0, false, null])('counts a present traffic value of %j as on', (value) => {
    expect(codeMode.isTrafficOn(null, { [TRAFFIC_ENV]: value })).toBe(true);
  });

  it.each(['0', 'false'])('counts a traffic value of %j as off without a record', (value) => {
    expect(codeMode.isTrafficOn(null, { [TRAFFIC_ENV]: value })).toBe(false);
  });

  it('counts missing traffic settings and record as off', () => {
    expect(codeMode.isTrafficOn(null, {})).toBe(false);
  });

  it('counts a true traffic record as on even if the settings value is off', () => {
    expect(codeMode.isTrafficOn({ 'disable-nonessential-traffic': true }, { [TRAFFIC_ENV]: '0' })).toBe(true);
  });
});

describe('Code Mode refusals and warnings', () => {
  it.each([
    [false, true, true],
    [true, true, false],
    [false, false, false],
    [true, false, false],
  ])('detects a transition from %s to %s: %s', (beforeOn, requestedOn, turnsOn) => {
    expect(codeMode.turnsOnCodeMode(beforeOn, requestedOn)).toBe(turnsOn);
  });

  it('directs an off-to-on request to disable the proxy when the proxy is on', () => {
    expect(codeMode.codeModeRefusal({ proxyOn: true }, true)).toContain('devflow proxy --disable');
  });

  it.each([[false, true], [true, false], [false, false]])('does not refuse with proxy %s and transition %s', (proxyOn, turnsOn) => {
    expect(codeMode.codeModeRefusal({ proxyOn }, turnsOn)).toBeUndefined();
  });

  it('does not print blocker lines while Code Mode is off', () => {
    expect(codeMode.codeModeBlockers(codeModeOff)).toEqual([]);
  });

  it('returns both blocker lines once while Code Mode and both blockers are on', () => {
    expect(codeMode.codeModeBlockers(bothBlockers)).toEqual([
      expect.stringContaining(proxyBlocker),
      trafficBlocker,
    ]);
  });

  it('returns no blocker line when Code Mode is on alone', () => {
    expect(codeMode.codeModeBlockers({ codeModeOn: true, proxyOn: false, trafficOn: false })).toEqual([]);
  });

  it('warns about the final blockers even when they were present before the write', () => {
    expect(codeMode.writeTimeWarnings(bothBlockers, bothBlockers)).toEqual([
      expect.stringContaining(proxyBlocker),
      trafficBlocker,
    ]);
  });

  it('does not warn when the write turns Code Mode off', () => {
    expect(codeMode.writeTimeWarnings(bothBlockers, codeModeOff)).toEqual([]);
  });

  it('warns once about the proxy when init keeps both features on', () => {
    expect(codeMode.initCodeModeWarnings({ proxyEnabled: true, record: onRecord, env: {} })).toEqual([
      expect.stringContaining(proxyBlocker),
    ]);
  });

  it('does not warn when the user settings override an on record at init', () => {
    expect(codeMode.initCodeModeWarnings({
      proxyEnabled: true, record: onRecord, env: { [CODE_ENV]: '0' },
    })).toEqual([]);
  });

  it('does not warn about the proxy when init preflight turns it off', () => {
    expect(codeMode.initCodeModeWarnings({ proxyEnabled: false, record: onRecord, env: {} })).toEqual([]);
  });

  it('warns about traffic alone when init ends with the proxy off', () => {
    expect(codeMode.initCodeModeWarnings({
      proxyEnabled: false, record: onRecord, env: { [TRAFFIC_ENV]: '1' },
    })).toEqual([trafficBlocker]);
  });

  it('says that a successful change applies to new sessions only', () => {
    expect(codeMode.CODE_MODE_NEW_SESSIONS_SUFFIX).toContain('applies to new sessions only');
  });

  it('directs a proxy enable request to disable Code Mode', () => {
    expect(codeMode.PROXY_ENABLE_REFUSAL).toContain('devflow flags --disable code-mode');
  });

  it.each([
    ['CODE_MODE_USER_VALUE_NOTE', 'your settings override the flag'],
    ['CODE_MODE_RECORD_FALSE_NOTE', 'the flag record is off'],
    ['CODE_MODE_READ_FAILURE', 'could not check the Code Mode and proxy state'],
  ] as const)('includes the reason in %s', (name, reason) => {
    expect(codeMode[name]).toContain(reason);
  });

  it('does not name the routing runtime in any exported message', () => {
    for (const value of Object.values(codeMode)) {
      if (typeof value === 'string') expect(value).not.toMatch(/subswitch/i);
    }
  });
});

describe('readCodeModeSignals', () => {
  let root: string;
  let settingsPath: string;
  let claudeDir: string;
  let devflowDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'code-mode-test-'));
    claudeDir = join(root, 'claude');
    devflowDir = join(root, 'devflow');
    settingsPath = join(claudeDir, 'settings.json');
    await Promise.all([fs.mkdir(claudeDir), fs.mkdir(devflowDir)]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writeSettings(env: Record<string, unknown>): Promise<void> {
    await fs.writeFile(settingsPath, JSON.stringify({ env }));
  }

  async function read() {
    return codeMode.readCodeModeSignals(claudeDir, devflowDir);
  }

  async function expectRefusal(shouldRefuse: boolean): Promise<void> {
    const signals = await read();
    expect(signals).toMatchObject({ ok: true, value: { proxyOn: shouldRefuse } });
    if (signals.ok) {
      expect(Boolean(codeMode.codeModeRefusal(signals.value, true))).toBe(shouldRefuse);
    }
  }

  it('refuses when only proxy.json says the proxy is on', async () => {
    await fs.writeFile(join(devflowDir, 'proxy.json'), '{"enabled":true}');
    await expectRefusal(true);
  });

  it('refuses when proxy.json exceeds the local state size limit', async () => {
    await fs.writeFile(join(devflowDir, 'proxy.json'), JSON.stringify({ enabled: false, padding: ' '.repeat(1024 * 1024) }));
    await expectRefusal(true);
  });

  it('refuses when proxy.json is not a regular file', async () => {
    await fs.mkdir(join(devflowDir, 'proxy.json'));
    await expectRefusal(true);
  });

  it('refuses when proxy.json cannot be parsed', async () => {
    await fs.writeFile(join(devflowDir, 'proxy.json'), '{');
    await expectRefusal(true);
  });

  it('refuses when the Devflow directory path is a file', async () => {
    await fs.rmdir(devflowDir);
    await fs.writeFile(devflowDir, 'x');
    await expectRefusal(true);
  });

  it.each([
    ['http://127.0.0.1:4141', true],
    ['http://127.0.0.1:4123', true],
    ['https://gateway.example', false],
  ])('uses the settings URL %s as a proxy signal: %s', async (url, shouldRefuse) => {
    await writeSettings({ ANTHROPIC_BASE_URL: url });
    await expectRefusal(shouldRefuse);
  });

  it('reports no proxy signal when all files are absent', async () => {
    expect(await read()).toEqual({ ok: true, value: { record: null, env: {}, proxyOn: false } });
    expect(await fs.readdir(devflowDir)).toEqual([]);
    expect(await fs.readdir(claudeDir)).toEqual([]);
  });

  it.each(['{', 'null', '[]', '42'])('reports unavailable settings for a root of %s', async (body) => {
    await fs.writeFile(settingsPath, body);
    expect(await read()).toMatchObject({ ok: true, value: { env: undefined, proxyOn: false } });
  });

  it('reports unavailable settings when a JSON string has invalid UTF-8 bytes', async () => {
    const bytes = Buffer.concat([Buffer.from('{"value":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    await fs.writeFile(settingsPath, bytes);
    expect(await read()).toMatchObject({ ok: true, value: { env: undefined } });
  });

  it('reports unavailable settings when the path is a directory', async () => {
    await fs.mkdir(settingsPath);
    expect(await read()).toMatchObject({ ok: true, value: { env: undefined } });
  });

  it('reports unavailable settings when the Claude directory path is a file', async () => {
    await fs.rmdir(claudeDir);
    await fs.writeFile(claudeDir, 'x');
    expect(await read()).toMatchObject({ ok: true, value: { env: undefined, proxyOn: false } });
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')('reports unavailable settings for permission errors', async () => {
    await writeSettings({ [CODE_ENV]: '1' });
    await fs.chmod(settingsPath, 0o000);
    expect(await read()).toMatchObject({ ok: true, value: { env: undefined } });
  });

  it('reports unavailable settings when the file exceeds the read limit', async () => {
    await writeSettings({ [CODE_ENV]: '1', OTHER: 'x'.repeat(1024 * 1024) });
    expect(await read()).toMatchObject({ ok: true, value: { env: undefined } });
  });

  it.each(['{}', '{"env":null}', '{"env":[]}', '{"env":"1"}'])('reports an empty env for %s', async (body) => {
    await fs.writeFile(settingsPath, body);
    expect(await read()).toMatchObject({ ok: true, value: { env: {} } });
  });

  it.each([
    ['accepted', { version: '1', plugins: [], installedAt: 'before', updatedAt: 'after' }],
    ['rejected', {}],
  ])('reads flags and proxy from a %s manifest without a write', async (_status, rootFields) => {
    const body = JSON.stringify({
      ...rootFields,
      features: { ambient: false, memory: false, flags: onRecord, proxy: true },
    });
    const manifestPath = join(devflowDir, 'manifest.json');
    await fs.writeFile(manifestPath, body);
    expect(await read()).toMatchObject({ ok: true, value: { record: onRecord, proxyOn: true } });
    await expectRefusal(true);
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(body);
  });

  it.each(['{', '{"features":false}', '{"features":{"flags":[],"proxy":"true"}}'])(
    'does not adopt invalid flag or proxy signals from %s', async (body) => {
      await fs.writeFile(join(devflowDir, 'manifest.json'), body);
      expect(await read()).toMatchObject({ ok: true, value: { record: null, proxyOn: false } });
    },
  );

  it('ignores the machine files when no Devflow directory is given', async () => {
    await fs.writeFile(join(devflowDir, 'proxy.json'), '{"enabled":true}');
    await fs.writeFile(join(devflowDir, 'manifest.json'), '{"features":{"proxy":true,"flags":{"code-mode":true}}}');
    const env = { [CODE_ENV]: '1' };
    await writeSettings(env);
    expect(await codeMode.readCodeModeSignals(claudeDir, null)).toEqual({
      ok: true, value: { record: null, env, proxyOn: false },
    });
  });

  it('still sees a settings relay URL when no Devflow directory is given', async () => {
    await writeSettings({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4123' });
    expect(await codeMode.readCodeModeSignals(claudeDir, null)).toMatchObject({
      ok: true, value: { record: null, proxyOn: true },
    });
  });

  it('returns a fixed error without the cause if a reader rejects', async () => {
    vi.spyOn(proxyState, 'readProxyState').mockRejectedValueOnce(new Error('private details'));
    expect(await read()).toEqual({ ok: false, error: codeMode.CODE_MODE_READ_FAILURE });
  });
});
