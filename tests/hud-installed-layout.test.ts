// tests/hud-installed-layout.test.ts
// The status line runs from the scripts directory the installer lays out under
// ~/.devflow/scripts/ (hud/, core/, hooks/lib/), with no package.json above it. These
// tests compose that layout in a temp directory and run the HUD from there: it prints a
// status line, shows the curation counts for a project that git does not track, and
// hides them for one that git tracks. A tracked-areas check that can not find its
// scripts answers unknown and never rejects.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { composeScripts } from '../src/targets/claude-code/installer.js';
import { stripAnsi } from '../src/hud/colors.js';
import { probeTrackedArea, TRACKED_AREAS_SCRIPT_NAME } from '../src/core/tracked-areas.js';
import type { StdinData } from '../src/hud/types.js';
import { sandboxEnv } from './helpers.js';

const ROW = JSON.stringify({
  id: 'obs_installed_layout',
  type: 'decision',
  pattern: 'p',
  details: 'd',
  anchor_id: 'ADR-001',
  decisions_status: 'Accepted',
});

let tmp: string;
let scripts: string;
let home: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, stdio: 'ignore' });
}

/** A git work tree holding one ledger row; `track` makes git track the ledger file. */
function makeProject(name: string, track: boolean): string {
  const root = path.join(tmp, name);
  const curation = path.join(root, '.devflow', 'curation');
  fs.mkdirSync(curation, { recursive: true });
  fs.writeFileSync(path.join(curation, 'decisions-ledger.jsonl'), ROW + '\n');
  git(root, 'init', '-q');
  if (track) git(root, 'add', '-f', path.join('.devflow', 'curation', 'decisions-ledger.jsonl'));
  return root;
}

/** Run the installed HUD entry point (hud.sh's `node hud/index.js`) for a session in `cwd`. */
function runInstalledHud(cwd: string, options: {
  home?: string;
  lookupPath?: string;
  preload?: string;
  stdin?: StdinData;
} = {}): string {
  const args = options.preload === undefined ? [] : ['--require', options.preload];
  const result = spawnSync(process.execPath, [...args, path.join(scripts, 'hud', 'index.js')], {
    cwd: scripts,
    input: JSON.stringify({ cwd, model: { display_name: 'Test' }, ...options.stdin }),
    env: sandboxEnv(options.home ?? home, { PATH: options.lookupPath ?? process.env.PATH ?? '' }),
    encoding: 'utf-8',
    // The cache-miss case took 64 ms with process startup. Allow for a 7 s Node start stall.
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return stripAnsi(result.stdout);
}

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-installed-layout-')));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  scripts = path.join(tmp, 'installed', '.devflow', 'scripts');
  await composeScripts(scripts);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the HUD run from the installed scripts directory', { timeout: 30_000 }, () => {
  it('is laid out with the check module beside hud/ and core/, and no package.json above', () => {
    expect(fs.existsSync(path.join(scripts, TRACKED_AREAS_SCRIPT_NAME))).toBe(true);
    expect(fs.existsSync(path.join(scripts, 'core', 'tracked-areas.js'))).toBe(true);
    expect(fs.existsSync(path.join(scripts, 'core', 'cache.js'))).toBe(true);
    expect(fs.existsSync(path.join(scripts, 'hud', 'tokenmeter.js'))).toBe(true);
    expect(fs.existsSync(path.join(scripts, 'core', 'tokenmeter-bin-state.js'))).toBe(true);
    expect(fs.existsSync(path.join(scripts, 'core', 'tokenmeter-bin.js'))).toBe(false);
    expect(fs.existsSync(path.join(scripts, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(scripts, '..', 'package.json'))).toBe(false);
    expect(fs.existsSync(path.join(scripts, '..', '..', 'package.json'))).toBe(false);
  });

  it('prints a status line with the curation counts for a project git does not track', () => {
    const line = runInstalledHud(makeProject('untracked', false));
    expect(line).not.toBe('');
    expect(line).toContain('Curation: 1 decision');
  });

  it('prints a status line without the curation counts for a project git tracks', () => {
    const line = runInstalledHud(makeProject('tracked', true));
    expect(line).not.toBe('');
    expect(line).not.toContain('Curation');
  });

  it('renders Claude context, quotas and cost without Codex or tokenmeter state', () => {
    const emptyPath = path.join(tmp, 'empty-path');
    const emptyHome = path.join(tmp, 'empty-home');
    fs.mkdirSync(emptyPath, { mode: 0o700 });
    fs.mkdirSync(emptyHome, { mode: 0o700 });

    const line = runInstalledHud(tmp, {
      home: emptyHome,
      lookupPath: emptyPath,
      stdin: {
        context_window: { used_percentage: 20 },
        rate_limits: { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 60 } },
        cost: { total_cost_usd: 1.25 },
      },
    });

    expect(line).toMatch(/Context .{8} 20% · 5h .{8} 30% · 7d .{8} 60%/);
    expect(line).toContain('$1.25');
    expect(line).not.toContain('Codex');
  });

  it('renders within its own two-second budget and saves a cache miss before exit', () => {
    const cacheHome = path.join(tmp, 'cache-home');
    const marker = path.join(cacheHome, 'render-ms');
    const preload = path.join(cacheHome, 'measure-render.cjs');
    fs.mkdirSync(cacheHome, { mode: 0o700 });
    // The first timer starts the HUD budget in main. Stop the clock at stdout, not process exit.
    fs.writeFileSync(preload, `
      const { writeFileSync } = require('node:fs');
      const setTimer = global.setTimeout;
      let start;
      global.setTimeout = (...args) => {
        start = performance.now();
        global.setTimeout = setTimer;
        return setTimer(...args);
      };
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = (...args) => {
        const result = write(...args);
        writeFileSync(${JSON.stringify(marker)}, String(performance.now() - start), { mode: 0o600 });
        return result;
      };
    `, { mode: 0o600 });

    const line = runInstalledHud(tmp, { home: cacheHome, lookupPath: cacheHome, preload });

    expect(line.split('\n')).toContain('Test');
    expect(line).not.toContain('Codex');
    const elapsed = Number(fs.readFileSync(marker, 'utf-8'));
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
    const cache = path.join(cacheHome, '.devflow', 'cache', 'tokenmeter-hud.json');
    expect(fs.existsSync(cache), 'the cache entry must survive process exit').toBe(true);
    const entry: unknown = JSON.parse(fs.readFileSync(cache, 'utf-8'));
    expect(entry).toMatchObject({ data: { usage: null } });
  });
});

describe('probeTrackedArea when the check can not be loaded', () => {
  it('answers unknown with the cause check-failed, and does not reject, when the scripts directory can not be found', async () => {
    vi.resetModules();
    vi.doMock('../src/core/assets.js', () => ({
      scriptsDir: () => {
        throw new Error('package root not found');
      },
    }));
    try {
      const { probeTrackedArea: probe } = await import('../src/core/tracked-areas.js');
      await expect(probe(tmp, 'curation')).resolves.toEqual({ answer: 'unknown', cause: 'check-failed' });
    } finally {
      vi.doUnmock('../src/core/assets.js');
      vi.resetModules();
    }
  });

  it('answers unknown with the cause check-failed for a directory that holds no check module', async () => {
    await expect(probeTrackedArea(tmp, 'curation', { dir: path.join(tmp, 'empty') })).resolves.toEqual({
      answer: 'unknown',
      cause: 'check-failed',
    });
  });
});
