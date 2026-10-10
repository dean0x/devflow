/**
 * Subprocess e2e tests for the Phase 6 init integration (flags + view-mode).
 *
 * These tests drive the REAL `node dist/cli.js init --recommended` command with an
 * isolated temp HOME so they never touch the developer's real ~/.claude or ~/.devflow.
 *
 * Seeded temp HOME, never empty; vacuous-coverage guard.
 *
 * Test scenarios:
 *   1. OLD-FORMAT manifest (flags: []) + settings with viewMode:'focus'
 *      → FlagsRecord in manifest, viewMode preserved, adopted flags materialised in
 *        settings.json, deliberate prior disables preserved, no knownFlags/features.viewMode residue
 *   2. Fresh install (no manifest) + empty settings
 *      → FlagsRecord with all defaults, max-concurrent-subagents env var applied;
 *        init does NOT open the flags TUI (D40); outcome line present in transcript
 *   3. Re-init preserves a modified flag value; adopts defaults only for absent flags
 *   4. Idempotency — second run produces byte-stable settings (no thrash)
 *
 * D-P6-E2E: These tests are the authoritative acceptance gate for the fold-before-strip
 * ordering fix and the bridge removal. Unit tests in init-seed.test.ts cover the seed
 * computation; these tests cover the full write path including applyFlags.
 *
 * Requires a build: these tests spawn dist/cli.js as a subprocess, so `npm run build`
 * must run first.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, readdirSync, readFileSync, lstatSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync, execFileSync } from 'child_process';
import { type ManifestData } from '../src/core/manifest.js';
import { resolveRetiredScopeOption } from '../src/cli/commands/init.js';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CLI_PATH = requireBuiltCli();
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('init e2e — flags Phase 6 integration', () => {
  it('old-format manifest (flags:[]) + viewMode in settings → FlagsRecord + viewMode preserved', async () => {
    // Seed a REAL old-format manifest (flags as string array) and settings with viewMode.
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
    // a green test that proves nothing.
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

    // Non-vacuity gate: init.ts swallows any failure in its settings pass with a
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
    expect(env.ENABLE_PROMPT_CACHING_1H).toBe('true');

    // Adopted default-OFF flags write nothing: pin-sonnet-4-6 and disable-bundled-skills
    // are optional (opt-in via `devflow flags --enable`), so a fresh adoption leaves
    // the Sonnet alias and Claude Code's bundled skills untouched.
    expect(flagsRecord['pin-sonnet-4-6']).toBe(false);
    expect(flagsRecord['disable-bundled-skills']).toBe(false);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(settings).not.toHaveProperty('disableBundledSkills');

    // Deliberate prior disables are PRESERVED, not re-adopted: the old manifest
    // recorded knownFlags ['tui','lsp'] with an empty enabled list, so both stay off and
    // neither writes its payload — while genuinely-new flags above adopt their defaults.
    expect(flagsRecord['tui']).toBe(false);
    expect(flagsRecord['lsp']).toBe(false);
    expect(settings).not.toHaveProperty('tui');
    expect(env.ENABLE_LSP_TOOL).toBeUndefined();
  }, SUBPROCESS_TIMEOUT_MS);

  it('fresh install (no manifest) → FlagsRecord with all flags + number flag defaults applied; no TUI entered', async () => {

    // No manifest means fresh install — all flags adopt their defaults.
    // Non-vacuous: if adoption is broken, max-concurrent-subagents env var would be absent.
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify({ env: { EXISTING_VAR: 'keep' } }, null, 2) + '\n',
    );

    const result = runInit(tmpHome);
    expect(result.status, `init failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    // (c) D40: init must never open the flags TUI — absence of the editor banner confirms this.
    const transcript = result.stdout + result.stderr;
    expect(transcript, 'flags TUI must not open during init (D40)').not.toContain('Opening the flags editor');

    // (c) D40: Recommended path emits the flag count in its summary note (non-interactive).
    expect(transcript, 'Recommended summary must include the flags count').toContain('Claude Code flags:');

    const manifest = await readManifest(tmpHome);
    const settings = await readSettings(tmpHome);

    // (a) FlagsRecord in manifest — registry defaults written on fresh install
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
    // AC-408 (D-AUTO-COMPACT-WINDOW-OPT-IN): the opt-in flag is recorded as unset and never written unseen.
    expect(flagsRecord, 'record names the flag').toHaveProperty('auto-compact-window', null);
    expect((settings['env'] as Record<string, string>)).not.toHaveProperty('CLAUDE_CODE_AUTO_COMPACT_WINDOW');
    // viewMode absent (default → neutral → key deleted)
    expect(settings).not.toHaveProperty('viewMode');
    // Custom user var preserved
    expect((settings['env'] as Record<string, string>)?.EXISTING_VAR).toBe('keep');
  }, SUBPROCESS_TIMEOUT_MS);

  it('(b) re-init preserves a modified flag value; adopts defaults only for absent flags', async () => {
    // Regression guard for D40: re-init must not overwrite a flag value the user
    // set via `devflow flags`. The manifest already owns the flag; init preserves it and
    // adopts registry defaults only for flags absent from the manifest record.

    // Prior manifest: tui deliberately set to false (user disabled it), lsp present,
    // max-concurrent-subagents absent (new flag added since the manifest was written).
    const priorManifest = {
      version: '2.0.0',
      plugins: ['devflow-implement'],
      scope: 'user',
      knownPlugins: ['devflow-implement'],
      features: {
        ambient: true,
        memory: true,
        hud: true,
        knowledge: true,
        learning: true,
        rules: true,
        proxy: false,
        flags: {
          tui: false,          // deliberately disabled — must survive re-init
          lsp: true,
          'tool-search': true,
          // max-concurrent-subagents absent → will be adopted with registry default (40)
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
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify({}) + '\n',
    );

    const result = runInit(tmpHome);
    expect(result.status, `re-init failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    // Non-vacuity guard
    expect(result.stdout + result.stderr).not.toContain('Could not configure settings.json');

    const manifest = await readManifest(tmpHome);
    const flagsRecord = manifest.features.flags as Record<string, unknown>;

    // (b) Modified flag preserved: tui=false was set by user, must not revert to default (true)
    expect(flagsRecord['tui'], 'user-set tui=false preserved after re-init').toBe(false);

    // (b) Present flag preserved: lsp=true explicitly written, must not change
    expect(flagsRecord['lsp'], 'existing lsp=true preserved').toBe(true);

    // (b) Absent flag adopted: max-concurrent-subagents was absent → adopt registry default 40
    expect(flagsRecord['max-concurrent-subagents'], 'absent flag adopts registry default').toBe(40);

    // (c) Still no TUI opened
    expect(result.stdout + result.stderr).not.toContain('Opening the flags editor');
  }, SUBPROCESS_TIMEOUT_MS);

  it('REG-H1 probe: hand-set managed keys survive init when manifest never owned them', async () => {
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
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '250000',   // number flag added after this manifest was written (AC-410)
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

    // Whole-post-state: all seven hand-set managed keys must survive
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

    // auto-compact-window preserved: the first init after an upgrade folds it into the record (AC-410)
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, 'auto-compact-window "250000" survived').toBe('250000');
    expect(flagsRecord['auto-compact-window'], 'manifest auto-compact-window is 250000').toBe(250000);

    // spellcheck preserved (wrapKey path: { command: 'hunspell' } → 'hunspell' → back to { command: 'hunspell' })
    expect(settings['spellcheck'], 'spellcheck { command: "hunspell" } survived').toEqual({ command: 'hunspell' });
    expect(flagsRecord['spellcheck'], 'manifest spellcheck is "hunspell"').toBe('hunspell');

    // workflowSizeGuideline preserved
    expect(settings['workflowSizeGuideline'], 'workflowSizeGuideline "large" survived').toBe('large');
    expect(flagsRecord['workflow-size-guideline'], 'manifest workflow-size-guideline is "large"').toBe('large');

    // User keys unrelated to devflow flags must survive too
    expect(env.CUSTOM_USER_VAR, 'custom user env var preserved').toBe('preserved');
  }, SUBPROCESS_TIMEOUT_MS);

  it('idempotency: second run produces content-stable settings (no viewMode thrash)', async () => {
    // content-stable = deep-equal parsed objects (not byte-equal strings): stripFlags
    // removes managed keys from their original positions and applyFlags re-appends them
    // at the end, so key order can legitimately differ between runs while content is identical.

    // Vacuous-coverage guard: this test catches regression where every reinit strips viewMode.
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

// ---------------------------------------------------------------------------
// D27 / R3: suppress-attribution through the REAL init settings pass.
//
// Every other attribution test in the suite is a pure call to applyFlags,
// stripFlags, or resolveExistingAttributionSuppression. None of them proves that
// init writes the block, that the shape guard survives init's strip-then-apply
// double pass (convergeFlagsIntoSettings runs stripFlags THEN applyFlags), that
// the value survives the proxy JSON round-trip and the later security-deny-list
// rewrite, or that the `content !== original` write guard actually fires.
//
// Each case asserts BOTH artifacts — manifest features.flags and
// settings.json — so a divergence between the two cannot pass.
// ---------------------------------------------------------------------------

/** Build a current-format manifest with the given flags record. */
function manifestWithFlags(flags: Record<string, unknown>) {
  return {
    version: '2.0.0',
    plugins: ['devflow-implement'],
    scope: 'user',
    knownPlugins: ['devflow-implement'],
    features: {
      ambient: false, memory: false, hud: true, knowledge: false,
      learning: false, rules: false, proxy: false,
      flags,
      security: 'user' as const,
      compliance: { enabled: false, frameworks: [] },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const DEVFLOW_ATTRIBUTION = { commit: '', pr: '' };

describe('init e2e — suppress-attribution convergence (D27, production path)', () => {
  /** Seed manifest + settings, run init, and assert the settings pass did not abort. */
  async function seedAndInit(
    flags: Record<string, unknown>,
    settings: Record<string, unknown>,
    extraArgs: string[] = [],
  ) {
    await fs.writeFile(
      path.join(tmpHome, '.devflow', 'manifest.json'),
      JSON.stringify(manifestWithFlags(flags), null, 2) + '\n',
    );
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n',
    );

    const result = runInit(tmpHome, extraArgs);
    expect(result.status, `init failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    // Non-vacuity gate: init swallows settings-pass failures with a warning
    // and still exits 0. Without this, every assertion below could pass unrun.
    expect(
      result.stdout + result.stderr,
      'init warned it could not configure settings.json — the settings pass aborted, ' +
      'so the assertions in this test would be vacuous',
    ).not.toContain('Could not configure settings.json');

    return {
      settings: await readSettings(tmpHome),
      flags: (await readManifest(tmpHome)).features.flags as Record<string, unknown>,
    };
  }

  it('off→on: manifest flag true materialises the attribution block in settings.json', async () => {
    const out = await seedAndInit(
      { 'suppress-attribution': true },
      { env: { CUSTOM_USER_VAR: 'preserved' } },   // no attribution key on disk
    );

    // On-side convergence: manifest says on, settings must carry the payload.
    expect(out.flags['suppress-attribution']).toBe(true);
    expect(out.settings.attribution).toEqual(DEVFLOW_ATTRIBUTION);
    // Non-vacuity: the settings pass really ran over this file.
    expect((out.settings.env as Record<string, unknown>).CUSTOM_USER_VAR).toBe('preserved');
  }, SUBPROCESS_TIMEOUT_MS);

  it('on→off via --reset: the devflow block is removed and the manifest agrees', async () => {
    // --reset null-seeds the manifest and empties the settings snapshot, so the flag
    // seeds to the registry default (false) even though the block is on disk. This is
    // the only init path that turns attribution off — a plain re-init preserves it.
    const out = await seedAndInit(
      { 'suppress-attribution': true },
      { attribution: { ...DEVFLOW_ATTRIBUTION }, env: { CUSTOM_USER_VAR: 'preserved' } },
      ['--reset'],
    );

    // Off-side convergence: manifest says off, the key must be gone from settings.
    expect(out.flags['suppress-attribution']).toBe(false);
    expect(out.settings).not.toHaveProperty('attribution');
    // Non-vacuity anchor: a deletion assertion passes silently when the file
    // is never rewritten. The seeded CUSTOM_USER_VAR must survive the init pass,
    // proving settings.json was actually rewritten around the deletion.
    expect((out.settings.env as Record<string, unknown>).CUSTOM_USER_VAR).toBe('preserved');
  }, SUBPROCESS_TIMEOUT_MS);

  it('a user-customised attribution survives init untouched (shape guard)', async () => {
    // The highest-value case: convergeFlagsIntoSettings runs stripFlags THEN
    // applyFlags, so the guard has to hold on BOTH passes within a single init.
    // Falsification: dropping settingDeleteGuard from the registry entry makes the
    // stripFlags pass erase this value and this test fails.
    const custom = { commit: 'Acme Corp', pr: 'Acme' };
    const out = await seedAndInit(
      { 'suppress-attribution': false },
      { attribution: { ...custom }, env: { CUSTOM_USER_VAR: 'preserved' } },
    );

    expect(out.settings.attribution).toEqual(custom);
    // devflow does not claim a key it did not write.
    expect(out.flags['suppress-attribution']).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);

  it('upgrade path: an existing devflow block seeds the flag ON and is preserved', async () => {
    // Every install predating D27 has the block, written by the old template merge,
    // with no manifest entry for the flag. Init must adopt it as ON rather than
    // silently reverting the user's git attribution behaviour.
    const out = await seedAndInit(
      {},                                                   // flag absent → adopt-on-init
      { attribution: { ...DEVFLOW_ATTRIBUTION }, env: { CUSTOM_USER_VAR: 'preserved' } },
    );

    expect(out.flags['suppress-attribution']).toBe(true);
    expect(out.settings.attribution).toEqual(DEVFLOW_ATTRIBUTION);
  }, SUBPROCESS_TIMEOUT_MS);

  it('fresh install writes no attribution key and records the flag off', async () => {
    await fs.writeFile(
      path.join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify({ env: { CUSTOM_USER_VAR: 'preserved' } }, null, 2) + '\n',
    );
    const result = runInit(tmpHome);   // no manifest at all
    expect(result.status, `init failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('Could not configure settings.json');

    const settings = await readSettings(tmpHome);
    const flags = (await readManifest(tmpHome)).features.flags as Record<string, unknown>;

    // Default OFF: init must not put attribution into a fresh settings.json.
    expect(settings).not.toHaveProperty('attribution');
    expect(flags['suppress-attribution']).toBe(false);
    expect((settings.env as Record<string, unknown>).CUSTOM_USER_VAR).toBe('preserved');
  }, SUBPROCESS_TIMEOUT_MS);
});

// ── One home: --scope retired, CLAUDE_CONFIG_DIR honoured, DEVFLOW_DIR ignored ──
//
// #389 (D-SCOPE-RETIRED, D-CLAUDE-CONFIG-DIR, D-ONE-HOME). Each init spawn is ~0.5 s;
// the block adds six (TP-9: 1, TP-10: 3, TP-12/13: 2).

/** Every path under `root` with its bytes and mode, sorted — the byte-identity oracle. */
function treeState(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(abs);
      if (st.isDirectory()) {
        out.push(`${r}/ ${st.mode.toString(8)}`);
        walk(abs, r);
      } else {
        out.push(`${r} ${st.mode.toString(8)} ${readFileSync(abs).toString('base64')}`);
      }
    }
  };
  walk(root, '');
  return out;
}

/** Paths only (no bytes), sorted — for comparing two installs made under different HOMEs. */
function treePaths(root: string): string[] {
  return treeState(root).map(line => line.split(' ')[0]);
}

/** Spawn the built CLI under a sandboxed env (sandboxEnv asserts HOME is temp). */
function runCli(
  args: string[],
  home: string,
  opts: { cwd: string; extraEnv?: Record<string, string> },
): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: opts.cwd,
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    env: sandboxEnv(home, opts.extraEnv ?? {}),
  });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const MINIMAL_INIT = ['init', '--recommended', '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules'];

describe('resolveRetiredScopeOption (D-SCOPE-RETIRED)', () => {
  it('no flag and `user` in any case proceed', () => {
    expect(resolveRetiredScopeOption(undefined)).toEqual({ kind: 'proceed' });
    expect(resolveRetiredScopeOption('user')).toEqual({ kind: 'proceed' });
    expect(resolveRetiredScopeOption('USER')).toEqual({ kind: 'proceed' });
  });

  it('`local` in any case is refused with the uninstall pointer', () => {
    for (const value of ['local', 'Local']) {
      const decision = resolveRetiredScopeOption(value);
      expect(decision.kind).toBe('refuse');
      expect(decision.kind === 'refuse' && decision.message).toContain('devflow uninstall --scope local');
    }
  });

  it('any other value is refused rather than read as `user`', () => {
    expect(resolveRetiredScopeOption('project').kind).toBe('refuse');
  });
});

describe('init --scope is retired (TP-9, TP-10)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-e2e-scope-repo-')));
    execFileSync('git', ['init', '-q'], { cwd: repo });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('TP-9: `init --scope local` exits 1 with the uninstall pointer and writes nothing', async () => {
    await fs.writeFile(path.join(repo, 'README.md'), 'repo\n');
    const homeBefore = treeState(tmpHome);
    const repoBefore = treeState(repo);

    const run = runCli([...MINIMAL_INIT, '--scope', 'local'], tmpHome, { cwd: repo });

    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain('devflow uninstall --scope local');
    expect(treeState(tmpHome), 'HOME must be untouched').toEqual(homeBefore);
    expect(treeState(repo), 'the repo must be untouched').toEqual(repoBefore);
  }, SUBPROCESS_TIMEOUT_MS);

  it('TP-10: `init --help` no longer offers --scope', () => {
    const run = runCli(['init', '--help'], tmpHome, { cwd: repo });
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('--recommended');
    expect(run.out).not.toContain('--scope');
  }, SUBPROCESS_TIMEOUT_MS);

  it('TP-10: `init --scope user` produces exactly the install of no flag', async () => {
    const plainHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-e2e-scope-plain-'));
    try {
      await fs.mkdir(path.join(plainHome, '.claude'), { recursive: true });
      const withFlag = runCli([...MINIMAL_INIT, '--scope', 'user'], tmpHome, { cwd: os.tmpdir() });
      const without = runCli(MINIMAL_INIT, plainHome, { cwd: os.tmpdir() });
      expect(withFlag.status, withFlag.out).toBe(0);
      expect(without.status, without.out).toBe(0);

      expect(treePaths(tmpHome)).toEqual(treePaths(plainHome));
      const settingsOf = async (home: string): Promise<string> =>
        (await fs.readFile(path.join(home, '.claude', 'settings.json'), 'utf-8')).split(home).join('<HOME>');
      expect(await settingsOf(tmpHome)).toBe(await settingsOf(plainHome));
      const manifestOf = async (home: string): Promise<Record<string, unknown>> => {
        const m = JSON.parse(await fs.readFile(path.join(home, '.devflow', 'manifest.json'), 'utf-8')) as Record<string, unknown>;
        return { ...m, installedAt: '<T>', updatedAt: '<T>' };
      };
      const flagged = await manifestOf(tmpHome);
      expect(flagged).toEqual(await manifestOf(plainHome));
      expect(flagged.scope).toBe('user');
    } finally {
      await fs.rm(plainHome, { recursive: true, force: true });
    }
  }, SUBPROCESS_TIMEOUT_MS * 2);
});

describe('one home: init and uninstall under exported CLAUDE_CONFIG_DIR and DEVFLOW_DIR (TP-12, TP-13)', () => {
  let configDir: string;
  let canary: string;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-e2e-claude-config-'));
    canary = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-e2e-devflow-canary-'));
    // The shared lifecycle seeds $HOME/.claude; this block proves init never needs it.
    await fs.rm(path.join(tmpHome, '.claude'), { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(canary, { recursive: true, force: true });
  });

  it('init installs into CLAUDE_CONFIG_DIR and $HOME/.devflow; uninstall removes from there; ~/.claude and DEVFLOW_DIR stay empty', async () => {
    const env = { CLAUDE_CONFIG_DIR: configDir, DEVFLOW_DIR: canary };
    const devflowDir = path.join(tmpHome, '.devflow');

    const init = runCli(MINIMAL_INIT, tmpHome, { cwd: os.tmpdir(), extraEnv: env });
    expect(init.status, init.out).toBe(0);

    // TP-12: the Claude assets and settings land in CLAUDE_CONFIG_DIR...
    const settingsPath = path.join(configDir, 'settings.json');
    const settings = await fs.readFile(settingsPath, 'utf-8');
    expect(readdirSync(path.join(configDir, 'agents', 'devflow')).length).toBeGreaterThan(0);
    // TP-13: ...and every installed hook points at the machine root, $HOME/.devflow.
    expect(settings).toContain(`${devflowDir}/scripts/hooks/run-hook`);
    expect(settings).not.toContain(canary);
    await expect(fs.access(path.join(devflowDir, 'manifest.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tmpHome, '.claude')), 'no Claude directory under HOME').rejects.toThrow();
    expect(readdirSync(canary), 'an exported DEVFLOW_DIR is never written').toEqual([]);

    // TP-10: `--scope user` is the no-flag uninstall; plain `uninstall` is held strictly by install-snapshot.
    const uninstall = runCli(['uninstall', '--scope', 'user'], tmpHome, { cwd: os.tmpdir(), extraEnv: env });
    expect(uninstall.status, uninstall.out).toBe(0);
    await expect(fs.access(path.join(configDir, 'agents', 'devflow'))).rejects.toThrow();
    await expect(fs.access(path.join(configDir, 'commands', 'devflow'))).rejects.toThrow();
    expect(await fs.readFile(settingsPath, 'utf-8')).not.toContain('run-hook');
    await expect(fs.access(path.join(devflowDir, 'manifest.json'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpHome, '.claude'))).rejects.toThrow();
    expect(readdirSync(canary)).toEqual([]);
  }, SUBPROCESS_TIMEOUT_MS * 2);
});
