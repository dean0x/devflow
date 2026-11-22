import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCache } from '../src/core/cache.js';
import { stripAnsi } from '../src/hud/colors.js';
import { render } from '../src/hud/render.js';
import { gatherTokenmeterUsage } from '../src/hud/tokenmeter.js';

vi.mock('node:child_process', { spy: true });
vi.mock('../src/core/cache.js', { spy: true });

const NOW = 1_800_000_000_000;
// One child took about 33 ms in isolation. Allow for 7 s Node start stalls.
const CHILD_DEADLINE_MS = 10_000;
// Cache expiry tests can start two children in sequence.
const TEST_TIMEOUT_MS = 25_000;
const ROOT = await fs.realpath(tmpdir());
let root: string;
let bin: string;
let cache: string;
let setClock: (now: number) => void;

beforeEach(async () => {
  root = await fs.mkdtemp(join(ROOT, 'hud-tokenmeter-'));
  bin = join(root, 'node_modules', '@dean0x', 'tokenmeter', 'bin', 'tokenmeter.cjs');
  cache = join(root, 'cache', 'tokenmeter-hud.json');
  vi.clearAllMocks();
  // The package fixture uses owner-only modes, independent of a permissive umask.
  await fs.mkdir(dirname(bin), { recursive: true, mode: 0o700 });
  await fs.mkdir(join(dirname(dirname(bin)), 'dist'), { mode: 0o700 });
  await fs.writeFile(join(root, 'tokenmeter.json'), JSON.stringify({ version: 1, binPath: bin }), { mode: 0o600 });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  setClock = (now) => { clock.mockReturnValue(now); };
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

function windowOf(minutes = 300, at = NOW) {
  return { window_minutes: minutes, pct: 47.5, resets_at: NOW + 600_123, at, source: 'rollouts' };
}

const envelope = (at = NOW, windows: readonly unknown[] = [windowOf(300, at)], reached: unknown = true) => ({
  schema: 'tokenmeter.v1', ok: true, data: { hud: 1, codex: { at, limit_reached: reached, windows } },
});
const window = { minutes: 300, usedPercent: 47.5, resetsAt: NOW / 1000 + 600 };
const usage = { windows: [window], limitReached: 'reached', observedAt: NOW };
const noCodex = { schema: 'tokenmeter.v1', ok: true, data: { hud: 1, codex: null } };

async function stub(output: unknown, before = ''): Promise<string> {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  await fs.writeFile(bin, `${before}\nprocess.stdout.write(${JSON.stringify(text)});`, { mode: 0o600 });
  return text;
}

const gather = (waitForCache = true) =>
  gatherTokenmeterUsage(root, Date.now(), { deadlineMs: CHILD_DEADLINE_MS, waitForCache });

async function renderHud(waitForCache = true): Promise<string> {
  return render({
    stdin: { model: { display_name: 'HUD test model' } },
    git: null, transcript: null, usage: null, codexUsage: await gather(waitForCache),
    configCounts: null, curationCounts: null, costHistory: null, sessionStartTime: null,
    config: { enabled: true, detail: false, components: ['model', 'codexQuota'] },
    devflowDir: root, terminalWidth: 120,
  });
}

describe.skipIf(process.getuid === undefined)('tokenmeter HUD client', { timeout: TEST_TIMEOUT_MS }, () => {
  it('accepts a reading that arrives after the default 700 ms deadline', async () => {
    await fs.writeFile(bin, `
      setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(envelope()))}), 750);
    `, { mode: 0o600 });
    expect(await gather()).toEqual(usage);
  });

  it('maps rollout windows to the HUD with the reading time and the reached flag', async () => {
    await stub(envelope(NOW, [windowOf(), windowOf(10080, NOW - 1000)]));
    expect(await gather()).toEqual({ ...usage, windows: [window, { ...window, minutes: 10080 }] });
  });

  it('renders the rollout quota, its age, and a red marker before reset', async () => {
    await stub(envelope(NOW - 3 * 3_600_000));
    const output = await renderHud();
    expect(stripAnsi(output)).toMatch(/^Codex 5h .{8} 48% \(10m\) limited · data 3h old\nHUD test model$/);
    expect(output).toContain('\x1b[31mlimited');
  });

  it('renders the rest of the HUD when Codex data is absent', async () => {
    await stub(noCodex);
    expect(stripAnsi(await renderHud())).toBe('HUD test model');
  });

  it('passes only the intended environment and closes stdin without data', async () => {
    const home = homedir();
    const shared = join(root, 'shared');
    await fs.mkdir(shared);
    await fs.chmod(shared, 0o777);
    const env = {
      HOME: home, PATH: dirname(bin), TMPDIR: root, LANG: 'C', LC_ALL: 'C',
      TOKENMETER_DATA_DIR: root, XDG_STATE_HOME: root, CODEX_HOME: root,
      HTTP_PROXY: 'proxy', HTTPS_PROXY: 'proxy', NO_PROXY: 'none', ALL_PROXY: 'proxy',
      http_proxy: 'proxy', https_proxy: 'proxy', no_proxy: 'none', all_proxy: 'proxy',
      SSL_CERT_FILE: 'ca-file', SSL_CERT_DIR: 'ca-dir',
    };
    for (const [key, val] of Object.entries(env)) vi.stubEnv(key, val);
    vi.stubEnv('PATH', [dirname(bin), '', '.', shared, join(root, 'missing'), dirname(bin)].join(delimiter));
    vi.stubEnv('NODE_OPTIONS', '--no-warnings');
    vi.stubEnv('TEST_UNRELATED', 'not for the child');
    const marker = join(root, 'invocation.json');
    await stub(envelope(), `
      const stdin = require('node:fs').readFileSync(0, 'utf8');
      const env = { ...process.env };
      // macOS adds this value at process start, outside the caller's env.
      if (process.platform === 'darwin') delete env.__CF_USER_TEXT_ENCODING;
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
        cwd: process.cwd(), args: process.argv.slice(2), env, stdin,
      }));
    `);
    expect(await gather()).toEqual(usage);
    expect(JSON.parse(await fs.readFile(marker, 'utf8'))).toEqual({ cwd: await fs.realpath(home), args: ['hud'], env, stdin: '' });
  });

  it('kills and reaps a slow child even when it ignores SIGTERM', async () => {
    const marker = join(root, 'pid');
    await fs.writeFile(bin, `
      process.on('SIGTERM', () => undefined);
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(envelope()))}), 3000);
    `, { mode: 0o600 });

    expect(await gatherTokenmeterUsage(root)).toBeNull();
    expect(execFile).toHaveBeenCalledWith(process.execPath, [bin, 'hud'],
      expect.objectContaining({ timeout: 700 }), expect.any(Function));
    const pidText = await fs.readFile(marker, 'utf8').catch(() => '');
    expect(pidText, 'the child must start before the default deadline').toMatch(/^[1-9]\d+$/);
    const pid = Number(pidText);
    expect(pid).toBeGreaterThan(1);
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  });

  it.each([
    ['non-JSON', 'not JSON'],
    ['empty stdout', ''],
    ['wrong schema', { ...envelope(), schema: 'tokenmeter.v2' }],
    ['ok false', { ...envelope(), ok: false }],
    ['hud version 2', { ...envelope(), data: { ...envelope().data, hud: 2 } }],
    ['non-boolean limit flag', envelope(NOW, [windowOf()], 'true')],
    ['missing windows', { ...envelope(), data: { hud: 1, codex: { at: NOW, limit_reached: false } } }],
    ['non-numeric window length', envelope(NOW, [{ ...windowOf(), window_minutes: '300' }])],
    ['percent 101', envelope(NOW, [windowOf(), { ...windowOf(10080), pct: 101 }])],
    ['fractional reset time', envelope(NOW, [{ ...windowOf(), resets_at: NOW + 0.5 }])],
    ['future quota time', envelope(NOW + 300_001, [windowOf()])],
    ['future window time', envelope(NOW, [windowOf(300, NOW + 300_001)])],
    ['duplicate length', envelope(NOW, [windowOf(), windowOf()])],
    ['no supported window', envelope(NOW, [windowOf(60)])],
  ])('treats %s as absence', async (_name, output) => {
    const text = await stub(output);
    const parse = vi.spyOn(JSON, 'parse');
    expect(await gather()).toBeNull();
    expect(parse).toHaveBeenCalledWith(text);
    expect(JSON.parse(await fs.readFile(cache, 'utf8')).data).toEqual({ usage: null });
  });

  it('rejects output above the byte cap before it parses JSON', async () => {
    const text = await stub(JSON.stringify(envelope()) + ' '.repeat(16_384));
    const parse = vi.spyOn(JSON, 'parse');
    const result = gather();
    const child = vi.mocked(execFile).mock.results[0]?.value;
    let bytes = 0;
    child?.stdout?.on('data', (chunk: Buffer) => { bytes += chunk.length; });

    expect(await result).toBeNull();
    expect(bytes).toBeGreaterThan(16_384);
    expect(parse).not.toHaveBeenCalledWith(text);
  });

  it('treats a non-zero exit with otherwise valid stdout as absence', async () => {
    await stub(envelope(), 'process.exitCode = 1;');
    expect(await gather()).toBeNull();
    expect(vi.mocked(execFile).mock.results[0]?.value?.exitCode).toBe(1);
  });

  it('drops unsupported windows and extra keys before it writes the cache', async () => {
    const { data, ...head } = envelope(NOW, [windowOf(60), { ...windowOf(), extra: 'window' }], false);
    await stub({
      ...head, extra: 'envelope', data: { ...data, extra: 'data', codex: { ...data.codex, extra: 'quota' } },
    });
    expect(await gather()).toEqual({ ...usage, limitReached: null });
    expect(JSON.parse(await fs.readFile(cache, 'utf8')).data).toEqual({ usage: { ...usage, limitReached: null } });
  });

  it('does not use a saved bin that fails validation', async () => {
    await stub(envelope());
    await fs.chmod(bin, 0o666);
    expect(await gather()).toBeNull();
  });

  it('caches absence when the state file is missing', async () => {
    await fs.unlink(join(root, 'tokenmeter.json'));
    expect(await gather()).toBeNull();
    expect(JSON.parse(await fs.readFile(cache, 'utf8')).data).toEqual({ usage: null });
  });

  it.each([
    ['fresh', NOW - 59_999, 30_000],
    ['near stale', NOW - 60_000, 5_000],
    ['at the cutoff minus one millisecond', NOW - 599_999, 1],
    ['stale', NOW - 600_000, 30_000],
  ])('reuses a %s reading until its cache expires', async (_name, at, ttl) => {
    const initial = { ...usage, observedAt: at };
    await stub(envelope(at));
    expect(await gather()).toEqual(initial);
    await stub(noCodex);
    setClock(NOW + ttl - 1);
    expect(await gather()).toEqual(initial);
    setClock(NOW + ttl);
    expect(await gather()).toBeNull();
  });

  it('reuses an explicit absence for 30 seconds', async () => {
    await stub(noCodex);
    expect(await gather()).toBeNull();
    await stub(envelope());
    setClock(NOW + 29_999);
    expect(await gather()).toBeNull();
    setClock(NOW + 30_000);
    expect(await gather()).toEqual(usage);
  });

  it.each(['oversize', 'linked'])('fetches again for a valid but %s cache entry', async (kind) => {
    await fs.mkdir(dirname(cache));
    const absent = JSON.stringify({ timestamp: NOW, ttl: 30_000, data: { usage: null } });
    if (kind === 'oversize') {
      await fs.writeFile(cache, absent.padEnd(2 * 1024 * 1024 + 1, ' '));
    } else {
      const other = join(root, 'other.json');
      await fs.writeFile(other, absent);
      await fs.symlink(other, cache);
    }
    await stub(envelope());
    expect(await gather()).toEqual(usage);
  });

  const week = { ...window, minutes: 10080 };
  it.each([
    ['an invalid limit label', { limitReached: 'unexpected' }],
    ['no windows', { windows: [] }],
    ['too many windows', { windows: [window, week, week] }],
    ['an unsupported length', { windows: [{ ...window, minutes: 60 }] }],
    ['windows out of order', { windows: [week, window] }],
    ['a negative percentage', { windows: [{ ...window, usedPercent: -1 }] }],
    ['a percentage above 100', { windows: [{ ...window, usedPercent: 101 }] }],
    ['a fractional reset time', { windows: [{ ...window, resetsAt: window.resetsAt + 0.5 }] }],
    ['a negative reset time', { windows: [{ ...window, resetsAt: -1 }] }],
    ['a reset time too large to convert to milliseconds', {
      windows: [{ ...window, resetsAt: Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1 }],
    }],
    ['a future reading time', { observedAt: NOW + 300_001 }],
  ])('fetches a new reading when fresh cache data has %s', async (_name, override) => {
    await writeCache(dirname(cache), 'tokenmeter-hud', {
      usage: { ...usage, observedAt: NOW - 1000, ...override },
    }, 30_000, NOW);
    expect(await fs.readFile(cache, 'utf8')).not.toBe('');
    await stub(envelope());
    expect(await gather()).toEqual(usage);
  });

  it('renders while the cache write stays pending when waitForCache is false', async () => {
    // Use an absent bin so this test controls the only asynchronous boundary.
    let releaseWrite: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const write = vi.mocked(writeCache).mockReturnValueOnce(pending);
    let output: string | undefined;
    const rendered = renderHud(false).then((line) => { output = stripAnsi(line); });
    try {
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      expect(write).toHaveBeenCalledTimes(1);
      expect(output).toBe('HUD test model');
    } finally {
      releaseWrite();
      await rendered;
    }
  });
});
