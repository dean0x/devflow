import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTokenmeterState } from '../src/core/tokenmeter-bin.js';
import { gatherTokenmeterUsage } from '../src/hud/tokenmeter.js';

// Both contract cases took 744 ms total in isolation. Allow a 7 s Node start stall per process.
const CHILD_DEADLINE_MS = 10_000;
// The app-server case starts the refresher and two fake Codex processes in sequence.
const REFRESH_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 45_000;
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'tokenmeter-contract-')));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const quoteSh = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

async function installFakeCodex(binDir: string): Promise<string> {
  const codex = join(binDir, 'codex');
  const record = join(binDir, 'record.cjs');
  await mkdir(binDir, { mode: 0o700 });
  await writeFile(codex, `#!/bin/sh\nexec ${quoteSh(process.execPath)} ${quoteSh(record)} "$0" "$@"\n`, { mode: 0o700 });
  await writeFile(record, `
    const { appendFileSync } = require('node:fs');
    const { join } = require('node:path');
    const [, , path, arg] = process.argv;
    appendFileSync(join(__dirname, 'invocations.jsonl'), JSON.stringify({
      path, arg, home: process.env.HOME, lookupPath: process.env.PATH,
      hasCodexHome: Object.hasOwn(process.env, 'CODEX_HOME'),
    }) + '\\n');
    if (arg === '--version') process.stdout.write('codex-cli 0.165.0\\n');
  `, { mode: 0o600 });
  return codex;
}

async function waitForRefresh(dataDir: string): Promise<void> {
  await vi.waitFor(() => {
    // The detached refresher writes state under this lock. Check state first to
    // distinguish completion from a child that has not acquired the lock yet.
    expect(existsSync(join(dataDir, 'refresh-state.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'refresh.lock'))).toBe(false);
  }, { interval: 25, timeout: REFRESH_TIMEOUT_MS });
}

async function runContract(setting: 'off' | 'on') {
  const binDir = join(root, 'bin');
  const home = join(root, 'home');
  const devflowDir = join(home, '.devflow');
  const dataDir = join(root, 'data');
  const codex = await installFakeCodex(binDir);
  await mkdir(devflowDir, { recursive: true, mode: 0o700 });
  await mkdir(dataDir, { mode: 0o700 });
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ version: 1, app_server: setting }), { mode: 0o600 });
  expect(await installTokenmeterState(devflowDir)).toMatchObject({ ok: true });
  vi.stubEnv('PATH', binDir);
  vi.stubEnv('HOME', home);
  vi.stubEnv('CODEX_HOME', undefined);
  vi.stubEnv('TOKENMETER_DATA_DIR', dataDir);

  const at = Date.now() - 90_000; // Old enough to start a refresh, recent enough to keep.
  const resetsAt = at + 3_600_000;
  await writeFile(join(dataDir, 'quota-latest.json'), JSON.stringify({
    version: 1,
    claude: {},
    codex: { five_hour: { usedPercent: 47.5, resetsAt, at, src: 'rollouts', reached: true } },
  }), { mode: 0o600 });

  const usage = await gatherTokenmeterUsage(devflowDir, Date.now(), { deadlineMs: CHILD_DEADLINE_MS });
  expect(usage).toEqual({
    observedAt: at,
    limitReached: 'reached',
    windows: [{ minutes: 300, usedPercent: 47.5, resetsAt: Math.floor(resetsAt / 1000) }],
  });

  await waitForRefresh(dataDir);
  const state: unknown = JSON.parse(await readFile(join(dataDir, 'refresh-state.json'), 'utf-8'));
  return { state, marker: join(binDir, 'invocations.jsonl'), codex, home, binDir };
}

// The real npm bin runs via the HUD client. Only Codex is a test double.
describe.skipIf(process.platform === 'win32')('pinned tokenmeter HUD contract', { timeout: TEST_TIMEOUT_MS }, () => {
  it('accepts the rollout reading and starts no Codex process with app_server off', async () => {
    const { state, marker } = await runContract('off');
    expect(state).toMatchObject({ codexFound: true, outcome: 'off' });
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('runs the resolved Codex with an isolated environment with app_server on', async () => {
    const { state, marker, codex, home, binDir } = await runContract('on');
    expect(state).toMatchObject({ codexFound: true });
    const calls: unknown[] = (await readFile(marker, 'utf-8')).trimEnd().split('\n')
      .map((line): unknown => JSON.parse(line));
    const expected = { path: codex, home, lookupPath: binDir, hasCodexHome: false };
    expect(calls).toEqual([
      { ...expected, arg: '--version' },
      { ...expected, arg: 'app-server' },
    ]);
  });
});
