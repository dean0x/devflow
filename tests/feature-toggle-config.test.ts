/**
 * `devflow memory|learning|knowledge --enable|--disable`, run through the
 * compiled CLI (D-FEATURES-MACHINE-WIDE): each toggle writes the one
 * machine-wide switch, `features.<feature>` in ~/.devflow/manifest.json, and
 * never the per-repo `.devflow/config.json` — whose memory/learning/knowledge
 * keys are retired. The config file round-trips byte-for-byte (PF-071: seed,
 * run the toggle, re-read the file), and the manifest changes only in the one
 * key and `updatedAt`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli } from './helpers.js';
import { assertTempHome } from './setup/home-isolation.js';

const CLI = requireBuiltCli();

const TOGGLES = [
  { feature: 'memory', flag: '--enable', enabled: true },
  { feature: 'memory', flag: '--disable', enabled: false },
  { feature: 'learning', flag: '--enable', enabled: true },
  { feature: 'learning', flag: '--disable', enabled: false },
  { feature: 'knowledge', flag: '--enable', enabled: true },
  { feature: 'knowledge', flag: '--disable', enabled: false },
] as const;

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

const configPath = (): string => path.join(tmpRepo, '.devflow', 'config.json');
const manifestPath = (): string => path.join(tmpHome, '.devflow', 'manifest.json');

function seedConfig(body: string): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), body, 'utf-8');
}

/** A manifest carrying a key devflow does not know, so a whole-file rewrite would show. */
function seedManifest(features: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(manifestPath()), { recursive: true });
  fs.writeFileSync(manifestPath(), JSON.stringify({
    version: '2.0.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    teamNote: 'kept',
    features: { ambient: true, hud: false, tracker: { provider: 'jira' }, ...features },
  }), 'utf-8');
}

function readManifest(): Record<string, unknown> & { features: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')) as Record<string, unknown> & { features: Record<string, unknown> };
}

function runToggle(feature: string, flag: string): { status: number | null; out: string } {
  // PF-060: `memory --enable` writes ~/.claude/settings.json, so the sandbox is
  // asserted at the call site rather than trusted — a spawn against the real
  // HOME never starts. Every path the CLI resolves from the environment derives
  // from HOME (the setup file has already unset CLAUDE_CONFIG_DIR).
  // `os.homedir()` is the setup file's temp HOME, so the real home comes from assertTempHome.
  assertTempHome(tmpHome);
  const result = spawnSync(process.execPath, [CLI, feature, flag], {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd: tmpRepo,
    env: {
      ...process.env,
      HOME: tmpHome,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
    },
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('feature toggles write the machine-wide switch, never the per-repo config', () => {
  it.each(TOGGLES)('★ devflow $feature $flag writes features.$feature and leaves config.json byte-identical', ({ feature, flag, enabled }) => {
    // The switch starts opposite to the toggle, so the write is a real change;
    // the repo config holds stale opposite values a pre-#378 toggle wrote.
    seedManifest({ memory: !enabled, learning: !enabled, knowledge: !enabled });
    const configBody = JSON.stringify({
      memory: !enabled, learning: !enabled, knowledge: !enabled, reviewPublication: 'full', tracker: 'jira',
    });
    seedConfig(configBody);

    const result = runToggle(feature, flag);

    expect(result.status, `devflow ${feature} ${flag} failed:\n${result.out}`).toBe(0);
    expect(fs.readFileSync(configPath(), 'utf-8')).toBe(configBody);
    const after = readManifest();
    expect(after.features).toEqual({
      ambient: true, hud: false, tracker: { provider: 'jira' },
      memory: !enabled, learning: !enabled, knowledge: !enabled,
      [feature]: enabled,
    });
    expect(after.teamNote).toBe('kept');
    expect(after.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  }, 60_000);

  it.each(TOGGLES)('devflow $feature $flag refuses without a manifest and creates none', ({ feature, flag }) => {
    const result = runToggle(feature, flag);

    expect(result.status).toBe(1);
    expect(result.out).toContain('devflow init');
    expect(fs.existsSync(manifestPath())).toBe(false);
  }, 60_000);
});
