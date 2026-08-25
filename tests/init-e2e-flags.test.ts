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
 *      → FlagsRecord in manifest, viewMode preserved, adopted flags materialised in
 *        settings.json, deliberate prior disables preserved, no knownFlags/features.viewMode residue
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
import { existsSync } from 'fs';
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

/**
 * PF-018 vacuous-coverage guard: true when dist/cli.js exists.
 *
 * Uses existsSync (not async access) so it can be used with it.skipIf at
 * module evaluation time — it.skipIf requires a synchronous boolean.
 * Silent green (early `return`) is the forbidden state; it.skipIf produces an
 * explicit SKIP mark in the vitest output instead.
 */
const CLI_BUILT = existsSync(CLI_PATH);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('init e2e — flags Phase 6 integration', () => {
  it.skipIf(!CLI_BUILT)('old-format manifest (flags:[]) + viewMode in settings → FlagsRecord + viewMode preserved', async () => {
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

    // Seed settings.json with viewMode + a custom env var + custom hook.
    //
    // The hook entry MUST use Claude Code's real shape — `{ matcher, hooks: [...] }`.
    // A flattened `{ matcher, command }` entry is not just unrealistic, it makes this
    // test vacuous: removeCaptureHooks does `entry.hooks.some(...)`, which throws on a
    // missing `hooks` array, and init.ts wraps its ENTIRE settings pass (ambient hooks,
    // capture hooks, memory hooks, HUD, flags, proxy env) in one try/catch that only
    // warns. With a malformed entry the whole pass aborts, settings.json is never
    // touched, and every settings assertion below passes because nothing ran —
    // the PF-018 shape: a green test that proves nothing.
    const seedSettings = {
      viewMode: 'focus',
      env: { CUSTOM_USER_VAR: 'preserved' },
      hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo custom-hook' }] }] },
    };
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify(seedSettings, null, 2) + '\n',
    );

    const result = runInit(tmpHome);
    expect(result.status, `init failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    // PF-018 non-vacuity gate: init.ts swallows any failure in its settings pass with a
    // warning and a zero exit code. Assert the warning is ABSENT — otherwise every
    // settings assertion below would pass for the wrong reason (the pass never ran).
    expect(
      result.stdout + result.stderr,
      'init warned that it could not configure settings.json — the settings pass aborted, ' +
      'so the settings assertions in this test would be vacuous',
    ).not.toContain('Could not configure settings.json');

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
    // The seeded user hook survives the remove-then-add hook passes
    expect(settings['hooks']).toBeDefined();

    // Manifest ↔ settings convergence — the invariant this whole feature exists to hold.
    // An adopted value in the manifest MUST have its payload materialised in settings.json;
    // a manifest that says 40 while settings.json says nothing is exactly the desync the
    // typed-registry work is meant to prevent.
    const env = settings['env'] as Record<string, string>;
    expect(flagsRecord['max-concurrent-subagents']).toBe(40);
    expect(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe('40');

    // Other adopted default-ON flags materialise too (proves applyFlags ran over the
    // whole adopted record, not just the one flag asserted above).
    expect(env.ENABLE_TOOL_SEARCH).toBe('true');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-6');

    // Deliberate prior disables are PRESERVED, not re-adopted (ADR-014): the old manifest
    // recorded knownFlags ['tui','lsp'] with an empty enabled list, so both stay off and
    // neither writes its payload — while genuinely-new flags above adopt their defaults.
    expect(flagsRecord['tui']).toBe(false);
    expect(flagsRecord['lsp']).toBe(false);
    expect(settings).not.toHaveProperty('tui');
    expect(env.ENABLE_LSP_TOOL).toBeUndefined();
  }, SUBPROCESS_TIMEOUT_MS);

  it.skipIf(!CLI_BUILT)('fresh install (no manifest) → FlagsRecord with all flags + number flag defaults applied', async () => {

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
  }, SUBPROCESS_TIMEOUT_MS);

  it.skipIf(!CLI_BUILT)('REG-H1 probe: hand-set managed keys survive init when manifest never owned them', async () => {
    // Scenario: user has an existing devflow install that predates the newly-registered flags
    // (max-concurrent-subagents, default-model, spellcheck, workflowSizeGuideline).
    // The user hand-set these keys in settings.json; on upgrade + reinit they must survive.
    //
    // Mechanism: ownedRecord = existingManifest.features.flags (no new keys)
    // → convergeFlagsIntoSettings folds the settings values into the record
    // → the folded record is written to manifest + applied to settings
    // Net: concurrency stays '8' (not overridden by registry default 40).

    // Existing manifest: FlagsRecord format, no new flags (pre-upgrade state)
    const priorManifest = {
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
        flags: {
          // Only the flags devflow previously wrote — no new valued flags
          tui: true,
          lsp: true,
          'tool-search': true,
        },
        security: 'user' as const,
        compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(
      path.join(tmpHome, '.devflow', 'manifest.json'),
      JSON.stringify(priorManifest, null, 2) + '\n',
    );

    // Settings.json with hand-set managed keys that devflow didn't previously own
    const seedSettings = {
      spellcheck: { command: 'hunspell' },           // string flag with wrapKey
      workflowSizeGuideline: 'large',                 // enum flag
      hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo hi' }] }] },
      env: {
        CUSTOM_USER_VAR: 'preserved',
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '8',   // number flag: must stay '8', not become '40'
        ANTHROPIC_DEFAULT_MODEL: 'claude-opus-4',    // string flag
        CLAUDE_CODE_GOAL_CHECKIN_MINUTES: '15',      // number flag
        CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5',   // number flag
      },
    };
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify(seedSettings, null, 2) + '\n',
    );

    const result = runInit(tmpHome);
    expect(result.status, `init failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    // Non-vacuity guard: settings pass must not have silently aborted
    expect(
      result.stdout + result.stderr,
      'settings pass aborted — assertions below would be vacuous',
    ).not.toContain('Could not configure settings.json');

    const manifest = await readManifest(tmpHome);
    const settings = await readSettings(tmpHome);
    const flagsRecord = manifest.features.flags as Record<string, unknown>;
    const env = settings['env'] as Record<string, string>;

    // Whole-post-state: all six hand-set managed keys must survive
    // concurrency: hand-set '8' must NOT become '40' (core REG-H1 probe)
    expect(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, 'concurrency hand-set "8" survived').toBe('8');
    expect(flagsRecord['max-concurrent-subagents'], 'manifest concurrency is 8').toBe(8);

    // default-model preserved
    expect(env.ANTHROPIC_DEFAULT_MODEL, 'default-model "claude-opus-4" survived').toBe('claude-opus-4');
    expect(flagsRecord['default-model'], 'manifest default-model is "claude-opus-4"').toBe('claude-opus-4');

    // goal-checkin-minutes preserved
    expect(env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES, 'goal-checkin-minutes "15" survived').toBe('15');
    expect(flagsRecord['goal-checkin-minutes'], 'manifest goal-checkin-minutes is 15').toBe(15);

    // subagent-spawn-depth preserved
    expect(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, 'spawn-depth "5" survived').toBe('5');
    expect(flagsRecord['subagent-spawn-depth'], 'manifest subagent-spawn-depth is 5').toBe(5);

    // spellcheck preserved (wrapKey path: { command: 'hunspell' } → 'hunspell' → back to { command: 'hunspell' })
    expect(settings['spellcheck'], 'spellcheck { command: "hunspell" } survived').toEqual({ command: 'hunspell' });
    expect(flagsRecord['spellcheck'], 'manifest spellcheck is "hunspell"').toBe('hunspell');

    // workflowSizeGuideline preserved
    expect(settings['workflowSizeGuideline'], 'workflowSizeGuideline "large" survived').toBe('large');
    expect(flagsRecord['workflow-size-guideline'], 'manifest workflow-size-guideline is "large"').toBe('large');

    // User keys unrelated to devflow flags must survive too
    expect(env.CUSTOM_USER_VAR, 'custom user env var preserved').toBe('preserved');
  }, SUBPROCESS_TIMEOUT_MS);

  it.skipIf(!CLI_BUILT)('idempotency: second run produces content-stable settings (no viewMode thrash)', async () => {
    // content-stable = deep-equal parsed objects (not byte-equal strings): stripFlags
    // removes managed keys from their original positions and applyFlags re-appends them
    // at the end, so key order can legitimately differ between runs while content is identical.

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
  }, SUBPROCESS_TIMEOUT_MS);
});
