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
function runInstalledHud(cwd: string): string {
  const result = spawnSync(process.execPath, [path.join(scripts, 'hud', 'index.js')], {
    input: JSON.stringify({ cwd, model: { display_name: 'Test' } }),
    env: { PATH: process.env.PATH ?? '', HOME: home },
    encoding: 'utf-8',
    timeout: 15_000,
  });
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
