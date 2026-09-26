/**
 * `devflow memory|learning|knowledge --enable|--disable`, run through the
 * compiled CLI: each toggle rewrites `.devflow/config.json`, and every key it
 * does not manage must survive the write (D-CONFIG-PRESERVE-UNMANAGED, avoids
 * PF-071). tests/core/feature-config-managed-write.test.ts drives updateFeature
 * directly; this suite proves each command's own write path, by the file round
 * trip PF-071 prescribes — seed, run the toggle, re-read the file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli } from './helpers.js';

const CLI = requireBuiltCli();

const TOGGLES = [
  { feature: 'memory', flag: '--enable', enabled: true },
  { feature: 'memory', flag: '--disable', enabled: false },
  { feature: 'learning', flag: '--enable', enabled: true },
  { feature: 'learning', flag: '--disable', enabled: false },
  { feature: 'knowledge', flag: '--enable', enabled: true },
  { feature: 'knowledge', flag: '--disable', enabled: false },
] as const;

/** Keys devflow does not manage: the hand-written override and one it does not know. */
const UNMANAGED = {
  tracker: 'jira',
  teamNote: { owner: 'platform', tags: ['a', 'b'] },
};

let tmpHome: string;
let tmpRepo: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'df-toggle-home-'));
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'df-toggle-repo-'));
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: tmpRepo });
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

function configPath(): string {
  return path.join(tmpRepo, '.devflow', 'config.json');
}

function seedConfig(body: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(body), 'utf-8');
}

function readRaw(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as Record<string, unknown>;
}

function runToggle(feature: string, flag: string): { status: number | null; out: string } {
  // PF-060: `memory --enable` writes ~/.claude/settings.json, so the sandbox is
  // asserted at the call site rather than trusted — a spawn against the real
  // HOME never starts. Every path the CLI resolves from the environment is
  // pinned under it, so an inherited CLAUDE_CODE_DIR or DEVFLOW_DIR cannot leak.
  expect(path.resolve(tmpHome), 'a toggle must never run against the real HOME').not.toBe(
    path.resolve(os.homedir()),
  );
  expect(tmpHome.startsWith(os.tmpdir() + path.sep), `HOME ${tmpHome} is not a scratch dir`).toBe(true);
  const result = spawnSync(process.execPath, [CLI, feature, flag], {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd: tmpRepo,
    env: {
      ...process.env,
      HOME: tmpHome,
      DEVFLOW_DIR: path.join(tmpHome, '.devflow'),
      CLAUDE_CODE_DIR: path.join(tmpHome, '.claude'),
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
    },
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('feature toggles keep the per-repo config keys they do not manage', () => {
  it.each(TOGGLES)('★ devflow $feature $flag keeps the tracker override and an unknown key', ({ feature, flag, enabled }) => {
    // Every boolean starts opposite to the toggle, so the write is a real change.
    seedConfig({
      memory: !enabled,
      learning: !enabled,
      knowledge: !enabled,
      reviewPublication: 'full',
      ...UNMANAGED,
    });

    const result = runToggle(feature, flag);

    expect(result.status, `devflow ${feature} ${flag} failed:\n${result.out}`).toBe(0);
    expect(readRaw()).toEqual({
      memory: !enabled,
      learning: !enabled,
      knowledge: !enabled,
      reviewPublication: 'full',
      [feature]: enabled,
      ...UNMANAGED,
    });
  }, 60_000);
});
