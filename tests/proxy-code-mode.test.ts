import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as p from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODE_MODE_PROXY_BLOCKER,
  CODE_MODE_READ_FAILURE,
  CODE_MODE_TRAFFIC_BLOCKER,
  PROXY_ENABLE_REFUSAL,
} from '../src/core/code-mode.js';
import type { FlagsRecord } from '../src/core/flags.js';
import { makeManifest } from './helpers.js';
import { excludeGit, readTree } from './install-snapshot-helpers.js';

const { binUnavailable, resolveBin } = vi.hoisted(() => {
  const binUnavailable = 'Fixture: routing executable unavailable';
  return { binUnavailable, resolveBin: vi.fn(async () => ({ ok: false, error: binUnavailable })) };
});

vi.mock('../src/core/proxy-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/core/proxy-state.js')>(),
  resolveProxyBin: resolveBin,
}));

vi.mock('net', async (importOriginal) => {
  const net = await importOriginal<typeof import('node:net')>();
  return {
    ...net,
    createConnection: () => {
      const socket = new net.Socket();
      queueMicrotask(() => socket.destroy(new Error('Fixture: port closed')));
      return socket;
    },
  };
});

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  note: vi.fn(),
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
}));

const codeKey = 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE';
const trafficKey = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
const codeOn = { 'code-mode': true };
const fixtureUrl = 'https://gateway.example.test';
const fixtureAuth = 'fixture-auth-value';
const fixtureHelper = 'fixture-helper-command';

let home: string;
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  home = mkdtempSync(join(tmpdir(), 'proxy-code-mode-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, '.claude'));
  previousExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  vi.doUnmock('../src/core/code-mode.js');
  vi.unstubAllEnvs();
  process.exitCode = previousExitCode;
  rmSync(home, { recursive: true, force: true });
});

function seedFile(relative: string, contents: string) {
  const file = join(home, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function seedManifest(flags: FlagsRecord, proxy = false) {
  // The legacy fixture exposes any accidental manifest heal write.
  const base = makeManifest();
  seedFile('.devflow/manifest.json', JSON.stringify({ ...base, features: { ...base.features, flags, proxy } }));
}

function seedSettings(env: Record<string, string>) {
  seedFile('.claude/settings.json', JSON.stringify({
    env: { ANTHROPIC_BASE_URL: fixtureUrl, ANTHROPIC_AUTH_TOKEN: fixtureAuth, ...env },
    apiKeyHelper: fixtureHelper,
  }));
}

async function run(...args: string[]) {
  const { proxyCommand } = await import('../src/cli/commands/proxy.js');
  await proxyCommand.parseAsync(args, { from: 'user' });
}

function snapshot() {
  return readTree(home, excludeGit, true);
}

async function expectRefusal(message = PROXY_ENABLE_REFUSAL) {
  const before = snapshot();
  await run('--enable');
  expect(vi.mocked(p.log.error).mock.calls).toEqual([[message]]);
  expect(process.exitCode).toBe(1);
  expect(p.spinner).not.toHaveBeenCalled();
  expect(resolveBin).not.toHaveBeenCalled();
  expect(snapshot()).toEqual(before);
}

describe('proxy --enable with Code Mode', () => {
  it('refuses a recorded enable before writes or the spinner', async () => {
    seedManifest(codeOn);
    seedSettings({});
    await expectRefusal();
  });

  it('refuses a hand-set enable without a manifest', async () => {
    seedSettings({ [codeKey]: '1' });
    await expectRefusal();
  });

  it('refuses drift repair when proxy.json is on and the manifest proxy is off', async () => {
    seedManifest(codeOn);
    seedFile('.devflow/proxy.json', '{"enabled":true}');
    await expectRefusal();
  });

  it('refuses a hand-set enable if the manifest is corrupt', async () => {
    seedFile('.devflow/manifest.json', '{');
    seedSettings({ [codeKey]: '1' });
    await expectRefusal();
  });

  it.each([false, true])('continues to proxy preflight with a user "0" (record on: %s)', async (recorded) => {
    if (recorded) seedManifest(codeOn);
    seedSettings({ [codeKey]: '0' });
    await run('--enable');
    expect(vi.mocked(p.log.error).mock.calls).toEqual([[binUnavailable]]);
    expect(resolveBin).toHaveBeenCalledOnce();
  });

  it('refuses without side effects if the signal reader fails', async () => {
    vi.doMock('../src/core/code-mode.js', async (importOriginal) => ({
      ...await importOriginal<typeof import('../src/core/code-mode.js')>(),
      readCodeModeSignals: async () => ({ ok: false, error: CODE_MODE_READ_FAILURE }),
    }));
    await expectRefusal(CODE_MODE_READ_FAILURE);
  });

  it('refuses without side effects if settings cannot be parsed', async () => {
    seedFile('.claude/settings.json', '{');
    await expectRefusal(CODE_MODE_READ_FAILURE);
  });
});

describe('proxy --status Code Mode warnings', () => {
  it('warns once per blocker after the env line, without writes or settings values in output', async () => {
    seedManifest(codeOn, true);
    seedFile('.devflow/proxy.json', '{"enabled":true}');
    seedSettings({ [trafficKey]: '1' });
    const before = snapshot();

    await run('--status');

    expect(vi.mocked(p.log.warn).mock.calls).toEqual([[CODE_MODE_PROXY_BLOCKER], [CODE_MODE_TRAFFIC_BLOCKER]]);
    const info = vi.mocked(p.log.info).mock;
    const envLine = info.calls.findIndex(([line]) => line.startsWith('ANTHROPIC_BASE_URL:'));
    expect(vi.mocked(p.log.warn).mock.invocationCallOrder[0]).toBeGreaterThan(info.invocationCallOrder[envLine] ?? Infinity);
    const output = [p.log.info, p.log.error, p.log.warn, p.note].flatMap(fn => vi.mocked(fn).mock.calls).flat().join('\n');
    for (const value of [fixtureUrl, fixtureAuth, fixtureHelper]) expect(output).not.toContain(value);
    expect(process.exitCode).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it('uses a relay URL on another port as a proxy signal', async () => {
    seedSettings({ [codeKey]: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:4142' });
    await run('--status');
    expect(vi.mocked(p.log.warn).mock.calls).toEqual([[CODE_MODE_PROXY_BLOCKER]]);
  });

  it('uses the recorded traffic flag without a proxy signal', async () => {
    seedManifest({ ...codeOn, 'disable-nonessential-traffic': true });
    seedFile('.claude/settings.json', '{"env":[]}');
    await run('--status');
    expect(vi.mocked(p.log.warn).mock.calls).toEqual([[CODE_MODE_TRAFFIC_BLOCKER]]);
  });

  it('uses unreadable proxy state as a proxy signal', async () => {
    seedManifest(codeOn);
    seedFile('.devflow/proxy.json', '{');
    await run('--status');
    expect(vi.mocked(p.log.warn).mock.calls).toEqual([[CODE_MODE_PROXY_BLOCKER]]);
  });

  it('does not warn about Code Mode when a user "0" overrides it', async () => {
    seedManifest(codeOn, true);
    seedFile('.devflow/proxy.json', '{"enabled":true}');
    seedSettings({ [codeKey]: '0', [trafficKey]: '1' });
    await run('--status');
    expect(p.log.warn).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});
