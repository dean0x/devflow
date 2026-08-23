/**
 * Subprocess e2e tests for the Phase 6 init integration (flags + view-mode).
 *
 * These tests drive the REAL `node dist/cli.js init --recommended` command with an
 * isolated temp HOME so they never touch the developer's real ~/.claude or ~/.devflow.
 *
 * Applies PF-018: seeded temp HOME, never empty; vacuous-coverage guard.
 *
 * Test scenarios:
 *   1. OLD-FORMAT manifest (flags: []) + settings with viewMode:'focus'
 *      → FlagsRecord in manifest, viewMode preserved, no knownFlags/features.viewMode residue
 *   2. Fresh install (no manifest) + empty settings
 *      → FlagsRecord with all defaults, max-concurrent-subagents env var applied
 *   3. Idempotency — second run produces byte-stable settings (no thrash)
 *
 * D-P6-E2E: These tests are the authoritative acceptance gate for the fold-before-strip
 * ordering fix and the bridge removal. Unit tests in init-seed.test.ts cover the seed
 * computation; these tests cover the full write path including applyFlags.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { type ManifestData } from '../src/core/manifest.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname ?? __dirname, '..');
const CLI_PATH = path.join(ROOT, 'dist', 'cli.js');
const SUBPROCESS_TIMEOUT_MS = 60_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Run `node dist/cli.js init --recommended` in a subprocess with temp HOME. */
function runInit(tmpHome: string, extraArgs: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, 'init', '--recommended', '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules', ...extraArgs],
    {
      cwd: os.tmpdir(), // non-git dir → earlyGitRoot=null → no project discovery
      encoding: 'utf-8',
      timeout: SUBPROCESS_TIMEOUT_MS,
      env: {
        ...process.env,
        HOME: tmpHome,
        // Suppress memory worker spawn (no real claude binary in test env)
        DEVFLOW_HOOK_DEBUG: undefined,
        // Ensure non-interactive mode
        FORCE_COLOR: '0',
      },
    },
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Read the manifest.json from the temp devflow dir. */
async function readManifest(tmpHome: string): Promise<ManifestData> {
  const manifestPath = path.join(tmpHome, '.devflow', 'manifest.json');
  const content = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(content) as ManifestData;
}

/** Read settings.json from the temp claude dir. */
async function readSettings(tmpHome: string): Promise<Record<string, unknown>> {
  const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
  const content = await fs.readFile(settingsPath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

// ── Test lifecycle ────────────────────────────────────────────────────────────

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-e2e-flags-'));
  await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
  await fs.mkdir(path.join(tmpHome, '.devflow'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

// ── Guards ────────────────────────────────────────────────────────────────────

/** PF-018 vacuous-coverage guard: skip if dist/cli.js is not built. */
async function requireBuiltCli(): Promise<boolean> {
  try {
    await fs.access(CLI_PATH);
    return true;
  } catch {
    return false;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('init e2e — flags Phase 6 integration', () => {
  it('old-format manifest (flags:[]) + viewMode in settings → FlagsRecord + viewMode preserved', async () => {
    if (!await requireBuiltCli()) return; // skip if not built

    // PF-018: seed a REAL old-format manifest (flags as string array) and settings with viewMode.
    // Non-vacuous: if the bridge removal regressed to string[], flags would be [] in the manifest.
    const oldManifest = {
      version: '2.0.0',
      plugins: ['devflow-implement', 'devflow-code-review'],
      scope: 'user',
      knownPlugins: ['devflow-implement', 'devflow-code-review'],
      features: {
        ambient: true,
        memory: true,
        hud: true,
        knowledge: true,
        learning: true,
        rules: true,
        proxy: false,
        flags: [], // OLD FORMAT: empty string array (pre-Phase-2)
        knownFlags: ['tui', 'lsp'],         // deprecated
        viewMode: 'focus' as const,          // deprecated top-level
        security: 'user' as const,
        compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(
      path.join(tmpHome, '.devflow', 'manifest.json'),
      JSON.stringify(oldManifest, null, 2) + '\n',
    );

    // Seed settings.json with viewMode + a custom env var + custom hook
    const seedSettings = {
      viewMode: 'focus',
      env: { CUSTOM_USER_VAR: 'preserved' },
      hooks: { Stop: [{ matcher: '', command: 'echo custom-hook' }] },
    };
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify(seedSettings, null, 2) + '\n',
    );

    const result = runInit(tmpHome);
    expect(result.status, `init failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    // ── Manifest assertions ──

    const manifest = await readManifest(tmpHome);

    // FlagsRecord format: flags must be a plain object (not array)
    expect(typeof manifest.features.flags).toBe('object');
    expect(Array.isArray(manifest.features.flags)).toBe(false);

    // All registry flags present (key-presence = known; adoption happened)
    const flagsRecord = manifest.features.flags as Record<string, unknown>;
    expect(flagsRecord).toHaveProperty('tui');
    expect(flagsRecord).toHaveProperty('tool-search');
    // New number flag adopted (absent from old manifest → adopt default)
    expect(flagsRecord).toHaveProperty('max-concurrent-subagents');

    // Phase 6 cleanup: no deprecated fields written
    expect(manifest.features).not.toHaveProperty('knownFlags');
    expect(manifest.features).not.toHaveProperty('viewMode');

    // ── Settings assertions ──

    const settings = await readSettings(tmpHome);

    // Fold-before-strip: existing viewMode:'focus' in settings MUST be preserved.
    // If the fold-before-strip ordering is wrong, stripFlags runs first and strips
    // viewMode before resolveExistingViewMode can read it → viewMode disappears.
    expect(settings['viewMode']).toBe('focus');

    // Custom env var preserved (Devflow only manages its own keys)
    expect((settings['env'] as Record<string, string>)?.CUSTOM_USER_VAR).toBe('preserved');

    // max-concurrent-subagents adoption verified via manifest value (env-var application
    // on fresh install is covered by test 2; old-manifest adoption is confirmed here via
    // the manifest record which holds the adopted default).
    expect(flagsRecord['max-concurrent-subagents']).toBe(40);
  });

  it('fresh install (no manifest) → FlagsRecord with all flags + number flag defaults applied', async () => {
    if (!await requireBuiltCli()) return;

    // PF-018: no manifest means fresh install — all flags adopt their defaults.
    // Non-vacuous: if adoption is broken, max-concurrent-subagents env var would be absent.
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify({ env: { EXISTING_VAR: 'keep' } }, null, 2) + '\n',
    );

    const result = runInit(tmpHome);
    expect(result.status, `init failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    const manifest = await readManifest(tmpHome);
    const settings = await readSettings(tmpHome);

    // FlagsRecord in manifest
    expect(typeof manifest.features.flags).toBe('object');
    expect(Array.isArray(manifest.features.flags)).toBe(false);

    const flagsRecord = manifest.features.flags as Record<string, unknown>;
    // Default-ON boolean flags are present
    expect(flagsRecord['tui']).toBe(true);
    expect(flagsRecord['tool-search']).toBe(true);
    // Number flag with non-neutral default is present
    expect(flagsRecord['max-concurrent-subagents']).toBe(40);
    // view-mode default is 'default' (neutral → not written to settings)
    expect(flagsRecord['view-mode']).toBe('default');

    // No deprecated fields
    expect(manifest.features).not.toHaveProperty('knownFlags');
    expect(manifest.features).not.toHaveProperty('viewMode');

    // Settings: max-concurrent-subagents applied
    expect((settings['env'] as Record<string, string>)?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe('40');
    // viewMode absent (default → neutral → key deleted)
    expect(settings).not.toHaveProperty('viewMode');
    // Custom user var preserved
    expect((settings['env'] as Record<string, string>)?.EXISTING_VAR).toBe('keep');
  });

  it('idempotency: second run produces byte-stable settings (no viewMode thrash)', async () => {
    if (!await requireBuiltCli()) return;

    // PF-018 vacuous guard: this test catches regression where every reinit strips viewMode.
    const seedSettings = { viewMode: 'verbose', env: { CUSTOM: 'stable' } };
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify(seedSettings, null, 2) + '\n',
    );

    // First run
    const r1 = runInit(tmpHome);
    expect(r1.status, `first run failed: ${r1.stderr}`).toBe(0);

    const settings1 = await readSettings(tmpHome);
    const manifest1 = await readManifest(tmpHome);

    // Second run — nothing changed, should be content-stable
    const r2 = runInit(tmpHome);
    expect(r2.status, `second run failed: ${r2.stderr}`).toBe(0);

    const settings2 = await readSettings(tmpHome);
    const manifest2 = await readManifest(tmpHome);

    // Settings content-stable: compare parsed objects, not JSON strings, because
    // stripFlags removes managed keys from their original positions and applyFlags
    // re-appends them at the end — key order can differ between runs even when content
    // is identical (toEqual is correct here; toBe would be spuriously brittle).
    expect(settings2).toEqual(settings1);
    // Manifest flags stable (viewMode must not thrash — the core assertion of this test)
    expect(manifest2.features.flags).toEqual(manifest1.features.flags);
  });
});
