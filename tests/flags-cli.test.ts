/**
 * Phase 3 — flags CLI rewrite (createFlagsCommand factory).
 *
 * Harness follows the hud-enable-selfheal pattern:
 *   - vi.mock @clack/prompts (declared before imports — vitest hoisting requirement)
 *   - vi.stubEnv CLAUDE_CODE_DIR/DEVFLOW_DIR to temp dirs
 *   - Fresh Command instance per test via createFlagsCommand()
 *   - Real temp files on disk; async fs operations
 *
 * Whole-post-state discipline (applies PF-015 + ADR-003): ONE representative test
 * per mutation verb (--enable, --disable, --set, --unset) asserts the COMPLETE
 * settings.json object and COMPLETE manifest.features.flags record via toEqual.
 * Other tests use key-picks for brevity on non-representative paths.
 *
 * Applies PF-014 (process.exitCode, never process.exit) — every error path sets
 * process.exitCode = 1 and returns; tests reset exitCode in beforeEach/afterEach.
 */

// ---------------------------------------------------------------------------
// Mocks — declared before module imports (vitest hoisting requirement)
// ---------------------------------------------------------------------------

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
  note: vi.fn(),
  confirm: vi.fn(async () => false),
  select: vi.fn(async () => 'cancel'),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as p from '@clack/prompts';
import type { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PassThrough } from 'stream';
import { createFlagsCommand, applyTuiResult } from '../src/cli/commands/flags.js';
import { makeManifest } from './helpers.js';
import type { FlagsRecord } from '../src/core/flags.js';
import { readManifest } from '../src/core/manifest.js';
// Direct import from terminal.js (not index.js) so the REL-M3 mock of index.js
// does not affect the seam test's runFlagsTui reference (PF-017(c)).
import { runFlagsTui } from '../src/cli/flags-view/terminal.js';
import { buildFlagRows } from '../src/cli/flags-view/state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canonical minimal manifest JSON for flags tests — flags: {} (fresh install). */
function makeEmptyFlagsManifest(): string {
  const m = makeManifest({ features: { ...makeManifest().features, flags: {} } });
  return JSON.stringify(m, null, 2) + '\n';
}

/** Manifest with a specific FlagsRecord. */
function makeManifestWithFlags(flags: FlagsRecord): string {
  const m = makeManifest({ features: { ...makeManifest().features, flags } });
  return JSON.stringify(m, null, 2) + '\n';
}

/** Parse a manifest JSON string and return features.flags. */
function parseFlagsRecord(json: string): FlagsRecord {
  return (JSON.parse(json) as { features: { flags: FlagsRecord } }).features.flags;
}

/** Parse a settings JSON string and return the full parsed object. */
function parseSettings(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('flags CLI — createFlagsCommand factory', () => {
  let tmpClaudeDir: string;
  let tmpDevflowDir: string;
  let flagsCmd: Command;

  beforeEach(async () => {
    tmpClaudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flags-cli-claude-'));
    tmpDevflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flags-cli-devflow-'));

    // vi.stubEnv tracks mutations; vi.unstubAllEnvs() in afterEach restores.
    vi.stubEnv('CLAUDE_CODE_DIR', tmpClaudeDir);
    vi.stubEnv('DEVFLOW_DIR', tmpDevflowDir);

    // Fresh command per test — avoids Commander option-value leakage between tests.
    flagsCmd = createFlagsCommand();

    // Reset exit code before each test (PF-014: commands set exitCode, not process.exit).
    process.exitCode = 0;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    process.exitCode = 0;
    await fs.rm(tmpClaudeDir, { recursive: true, force: true });
    await fs.rm(tmpDevflowDir, { recursive: true, force: true });
  });

  // ─── --list ───────────────────────────────────────────────────────────────────

  describe('--list', () => {
    it('runs without error (no manifest required)', async () => {
      // --list must work without a manifest — registry only
      await flagsCmd.parseAsync(['--list'], { from: 'user' });
      expect(process.exitCode).toBe(0);
    });

    it('runs without error even when settings.json is absent', async () => {
      // No settings.json, no manifest — still must succeed
      await flagsCmd.parseAsync(['--list'], { from: 'user' });
      expect(process.exitCode).toBe(0);
    });
  });

  // ─── --status ─────────────────────────────────────────────────────────────────

  describe('--status', () => {
    it('degrades gracefully when no manifest exists', async () => {
      // No manifest.json — status must not set exitCode = 1 (degrade gracefully)
      await flagsCmd.parseAsync(['--status'], { from: 'user' });
      expect(process.exitCode).toBe(0);
    });

    it('runs successfully with a manifest', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ tui: true, lsp: false }),
        'utf-8',
      );
      await flagsCmd.parseAsync(['--status'], { from: 'user' });
      expect(process.exitCode).toBe(0);
    });

    it('whole-post-state: does not mutate files', async () => {
      const initialManifest = makeManifestWithFlags({ tui: true });
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), initialManifest, 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), '{}', 'utf-8');

      await flagsCmd.parseAsync(['--status'], { from: 'user' });

      // Files must be byte-identical — status is read-only
      const manifestAfter = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');
      const settingsAfter = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
      expect(manifestAfter).toBe(initialManifest);
      expect(JSON.parse(settingsAfter)).toEqual({});
    });
  });

  // ─── --enable (boolean only) ──────────────────────────────────────────────────

  describe('--enable', () => {
    it('whole-post-state: enables a boolean flag (tui)', async () => {
      // Start: empty manifest flags, no settings.json
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      // Whole-post-state: complete settings.json and complete flags record (PF-015).
      // convergeFlagsIntoSettings always writes view-mode via resolveFinalViewMode,
      // so the flags record also contains 'view-mode':'default' (neutral → not written
      // to settings.json). toEqual on both artifacts catches unexpected extra writes.
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings).toEqual({ tui: 'fullscreen' });

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags).toEqual({ tui: true, 'view-mode': 'default' });
    });

    it('whole-post-state: enabling an already-enabled flag is idempotent', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ tui: true }),
        'utf-8',
      );
      // Apply tui setting to simulate already-enabled state
      await fs.writeFile(
        path.join(tmpClaudeDir, 'settings.json'),
        JSON.stringify({ tui: 'fullscreen' }, null, 2) + '\n',
        'utf-8',
      );

      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });
      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings.tui).toBe('fullscreen');
    });

    it('error on valued (non-boolean) flag via --enable', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      // 'max-concurrent-subagents' is a number flag — --enable must reject it
      await flagsCmd.parseAsync(['--enable', 'max-concurrent-subagents'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      // Files must be byte-untouched (settings.json absent = no new file created)
      const settingsExists = await fs.access(path.join(tmpClaudeDir, 'settings.json'))
        .then(() => true)
        .catch(() => false);
      expect(settingsExists).toBe(false);
    });

    it('error on enum flag via --enable', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      await flagsCmd.parseAsync(['--enable', 'view-mode'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });

    it('error: no manifest → abort with exit code 1', async () => {
      // No manifest.json at all
      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });

    it('error: unknown flag id → exit code 1', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      await flagsCmd.parseAsync(['--enable', 'not-a-real-flag'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });
  });

  // ─── --disable (boolean only) ─────────────────────────────────────────────────

  describe('--disable', () => {
    it('whole-post-state: disabling tui removes the setting key (false = neutral)', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ tui: true }),
        'utf-8',
      );
      // Pre-apply the tui setting so strip has something to remove
      await fs.writeFile(
        path.join(tmpClaudeDir, 'settings.json'),
        JSON.stringify({ tui: 'fullscreen' }, null, 2) + '\n',
        'utf-8',
      );

      await flagsCmd.parseAsync(['--disable', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      // Whole-post-state: complete settings.json and complete flags record (PF-015).
      // tui=false is neutral for boolean flags → tui key deleted from settings;
      // empty result is {} (applyFlags cleans up empty env, same logic applies to root).
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings).toEqual({});

      // manifest: tui: false (deliberately disabled — not absent)
      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags).toEqual({ tui: false, 'view-mode': 'default' });
    });

    it('error on valued flag via --disable', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      await flagsCmd.parseAsync(['--disable', 'workflow-size-guideline'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });

    it('error: no manifest → abort', async () => {
      await flagsCmd.parseAsync(['--disable', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });
  });

  // ─── --set id=value ───────────────────────────────────────────────────────────

  describe('--set', () => {
    it('whole-post-state: set a number flag (max-concurrent-subagents=50)', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=50'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      // Whole-post-state: complete settings.json and complete flags record (PF-015).
      // Starting from flags:{} with no settings.json → only the env entry is written.
      // toEqual on the full object catches any unexpected keys written or omitted.
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings).toEqual({ env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '50' } });

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags).toEqual({ 'max-concurrent-subagents': 50, 'view-mode': 'default' });
    });

    it('whole-post-state: set an enum flag (workflow-size-guideline=large)', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'workflow-size-guideline=large'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings.workflowSizeGuideline).toBe('large');

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['workflow-size-guideline']).toBe('large');
    });

    it('whole-post-state: set a string flag (default-model)', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'default-model=claude-haiku-4-5'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect((settings.env as Record<string, string>)?.ANTHROPIC_DEFAULT_MODEL).toBe('claude-haiku-4-5');

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['default-model']).toBe('claude-haiku-4-5');
    });

    it('whole-post-state: set a boolean flag to true', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'brief=true'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect((settings.env as Record<string, string>)?.CLAUDE_CODE_BRIEF).toBe('true');

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['brief']).toBe(true);
    });

    it('view-mode=focus: writes viewMode setting + record entry', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'view-mode=focus'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings.viewMode).toBe('focus');

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['view-mode']).toBe('focus');
    });

    it('view-mode=default: key deleted from settings (default is neutral for view-mode)', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ 'view-mode': 'verbose' }),
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmpClaudeDir, 'settings.json'),
        JSON.stringify({ viewMode: 'verbose' }, null, 2) + '\n',
        'utf-8',
      );

      await flagsCmd.parseAsync(['--set', 'view-mode=default'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      // 'default' is neutralValue for view-mode → key deleted
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings.viewMode).toBeUndefined();

      // Record: 'default' stored (neutral value is still recorded)
      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['view-mode']).toBe('default');
    });

    it('split on first = only: spellcheck=a=b → value is "a=b"', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'spellcheck=a=b'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      // spellcheck has wrapKey: 'command' → written as { command: 'a=b' }
      expect((settings.spellcheck as Record<string, string>)?.command).toBe('a=b');

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['spellcheck']).toBe('a=b');
    });

    it('idempotent: second identical --set produces byte-identical settings.json', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=60'], { from: 'user' });
      const settingsAfterFirst = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');

      // Fresh command instance to avoid state leakage
      const flagsCmd2 = createFlagsCommand();
      vi.stubEnv('CLAUDE_CODE_DIR', tmpClaudeDir);
      vi.stubEnv('DEVFLOW_DIR', tmpDevflowDir);
      await flagsCmd2.parseAsync(['--set', 'max-concurrent-subagents=60'], { from: 'user' });
      const settingsAfterSecond = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');

      expect(settingsAfterSecond).toBe(settingsAfterFirst);
    });

    // ─── Hostile inputs — exit code 1 AND files byte-untouched ───────────────

    it('hostile: __proto__=x → unknown id → exit code 1, no files written', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      // No settings.json initially
      await flagsCmd.parseAsync(['--set', '__proto__=x'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      // settings.json must not have been created
      const settingsExists = await fs.access(path.join(tmpClaudeDir, 'settings.json'))
        .then(() => true).catch(() => false);
      expect(settingsExists).toBe(false);
    });

    it('hostile: max-concurrent-subagents=1e309 → not finite → exit code 1, files untouched', async () => {
      const initialManifest = makeEmptyFlagsManifest();
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), initialManifest, 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), '{}', 'utf-8');

      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=1e309'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      // Both files must be byte-identical to their initial state
      const manifestAfter = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');
      const settingsAfter = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
      expect(manifestAfter).toBe(initialManifest);
      expect(settingsAfter).toBe('{}');
    });

    it('hostile: max-concurrent-subagents=12; rm -rf / → NaN → exit code 1, files untouched', async () => {
      const initialManifest = makeEmptyFlagsManifest();
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), initialManifest, 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), '{}', 'utf-8');

      // Semicolon is passed through by Commander as part of the value string
      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=12; rm -rf /'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      const manifestAfter = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');
      const settingsAfter = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
      expect(manifestAfter).toBe(initialManifest);
      expect(settingsAfter).toBe('{}');
    });

    it('unknown id → exit code 1, files untouched', async () => {
      const initialManifest = makeEmptyFlagsManifest();
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), initialManifest, 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), '{}', 'utf-8');

      await flagsCmd.parseAsync(['--set', 'no-such-flag=foo'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      const manifestAfter = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');
      const settingsAfter = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
      expect(manifestAfter).toBe(initialManifest);
      expect(settingsAfter).toBe('{}');
    });

    it('malformed settings.json → exit code 1, manifest untouched', async () => {
      const initialManifest = makeEmptyFlagsManifest();
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), initialManifest, 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), 'not valid json', 'utf-8');

      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=50'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      // Manifest must be untouched
      const manifestAfter = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');
      expect(manifestAfter).toBe(initialManifest);
    });

    it('no manifest → exit code 1', async () => {
      // No manifest.json
      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=50'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });
  });

  // ─── --unset ids ──────────────────────────────────────────────────────────────

  describe('--unset', () => {
    it('whole-post-state: unset a number flag → null in record, key deleted from settings', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ 'max-concurrent-subagents': 50 }),
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmpClaudeDir, 'settings.json'),
        JSON.stringify({ env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '50' } }, null, 2) + '\n',
        'utf-8',
      );

      await flagsCmd.parseAsync(['--unset', 'max-concurrent-subagents'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      // Whole-post-state: complete settings.json and complete flags record (PF-015).
      // null is neutral for number flags → env key deleted; empty env block deleted too
      // → settings becomes {} (applyFlags cleanup, line ~960-963 in flags.ts).
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings).toEqual({});

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags).toEqual({ 'max-concurrent-subagents': null, 'view-mode': 'default' });
    });

    it('whole-post-state: unset a boolean flag → false in record, key deleted from settings', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ tui: true }),
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmpClaudeDir, 'settings.json'),
        JSON.stringify({ tui: 'fullscreen' }, null, 2) + '\n',
        'utf-8',
      );

      await flagsCmd.parseAsync(['--unset', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings.tui).toBeUndefined();

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      // boolean flag unset → false (neutral for boolean)
      expect(flags['tui']).toBe(false);
    });

    it('error: no manifest → exit code 1', async () => {
      await flagsCmd.parseAsync(['--unset', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });

    it('error: unknown flag id → exit code 1', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      await flagsCmd.parseAsync(['--unset', 'no-such-flag'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    });
  });

  // ─── bare TTY invocation — manifest guard (TS-H2 / ARCH-H2 / REL-H2 pin) ──────
  //
  // When BOTH process.stdin.isTTY and process.stdout.isTTY are true and the
  // manifest is absent or corrupt, handleBare must hard-refuse BEFORE importing
  // or launching the TUI. The fix: reuse loadFlagContext (the same guard mutating
  // handlers use) at the top of the TTY branch. settings.json must NOT be touched.
  //
  // REL-H1: the predicate now requires BOTH stdin and stdout to be TTYs.
  //
  // RED proof: before the fix, handleBare seeds from {} and proceeds into the TUI
  // import (or tries to), possibly writing settings.json; exitCode stays 0.

  describe('bare TTY invocation — manifest guard', () => {
    let origStdoutIsTTY: boolean | undefined;
    let origStdinIsTTY: boolean | undefined;

    beforeEach(() => {
      origStdoutIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
      origStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY;
      // REL-H1: both stdin AND stdout must be TTYs for the interactive path to engage.
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      vi.mocked(p.log.error).mockClear();
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: origStdinIsTTY, configurable: true });
    });

    it('no manifest → hard-refuse, exitCode 1, p.log.error, settings.json not written', async () => {
      // No manifest.json — loadFlagContext must fire before the TUI import.
      await flagsCmd.parseAsync([], { from: 'user' });

      expect(process.exitCode).toBe(1);
      expect(vi.mocked(p.log.error)).toHaveBeenCalledWith(
        expect.stringContaining('No devflow installation found'),
      );
      // settings.json must NOT have been created — the guard fires before any write.
      const settingsExists = await fs.access(path.join(tmpClaudeDir, 'settings.json'))
        .then(() => true).catch(() => false);
      expect(settingsExists, 'settings.json must not be written when manifest is absent').toBe(false);
    });

    it('corrupt manifest → hard-refuse, exitCode 1, p.log.error, settings.json not written', async () => {
      // readManifest returns null for malformed JSON — same as absent (avoids PF-023).
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), 'not valid json', 'utf-8');

      await flagsCmd.parseAsync([], { from: 'user' });

      expect(process.exitCode).toBe(1);
      expect(vi.mocked(p.log.error)).toHaveBeenCalledWith(
        expect.stringContaining('No devflow installation found'),
      );
      const settingsExists = await fs.access(path.join(tmpClaudeDir, 'settings.json'))
        .then(() => true).catch(() => false);
      expect(settingsExists, 'settings.json must not be written when manifest is unreadable').toBe(false);
    });
  });

  // ─── bare invocation — stdout TTY but stdin non-TTY → non-TTY path (REL-H1) ──
  //
  // REL-H1: the TUI predicate requires BOTH stdin AND stdout to be TTYs.
  // When only stdout is a TTY (e.g. output redirected from a script that sets
  // process.stdout.isTTY = true but pipes stdin), the non-TTY path is taken:
  // status table to stdout, note to stderr, exitCode = 1, zero writes.
  //
  // RED proof: before the fix, the predicate checked only process.stdout.isTTY,
  // so this scenario entered the interactive branch and attempted to open the TUI.

  describe('bare invocation — stdout TTY but stdin non-TTY → non-TTY path (REL-H1)', () => {
    let origStdoutIsTTY: boolean | undefined;

    beforeEach(() => {
      origStdoutIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
      // Set stdout TTY but do NOT set stdin (stays undefined = falsy in vitest).
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutIsTTY, configurable: true });
    });

    it('status table to stdout, note to stderr, exitCode 1, zero writes', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      const manifestBefore = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');

      const captured = { stdout: '', stderr: '' };
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
        if (typeof c === 'string') captured.stdout += c;
        return true;
      });
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
        if (typeof c === 'string') captured.stderr += c;
        return true;
      });

      try {
        await flagsCmd.parseAsync([], { from: 'user' });
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }

      // Non-TTY path: status table to stdout + note to stderr
      expect(captured.stdout).toContain('tui');
      expect(captured.stderr).toContain('Note:');
      expect(process.exitCode).toBe(1);
      // Zero writes — manifest must be byte-identical
      const manifestAfter = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');
      expect(manifestAfter).toBe(manifestBefore);
    });
  });

  // ─── --set no-manifest: REG-SF2 pin ──────────────────────────────────────────
  //
  // --set must hard-error via loadFlagContext when no manifest exists, and
  // settings.json must remain unwritten. This is REG-SF2: discriminated-result
  // truthfulness covers the --set/--unset no-manifest surface.

  describe('--set no-manifest (REG-SF2)', () => {
    it('no manifest → exitCode 1, settings.json not written', async () => {
      // No manifest.json — loadFlagContext must abort before any write.
      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=50'], { from: 'user' });

      expect(process.exitCode).toBe(1);
      const settingsExists = await fs.access(path.join(tmpClaudeDir, 'settings.json'))
        .then(() => true).catch(() => false);
      expect(settingsExists, 'settings.json must not be written when manifest is absent').toBe(false);
    });
  });

  // ─── bare non-TTY invocation ──────────────────────────────────────────────────
  //
  // src/cli/commands/flags.ts:509-520: when no args are passed and the terminal is not
  // a TTY, the command prints a status table to stdout, one note to stderr, sets
  // exitCode = 1, and writes NOTHING to disk.
  //
  // In the vitest environment process.stdout.isTTY is undefined (falsy) so the non-TTY
  // branch is taken automatically when no other option flag is present.

  describe('bare non-TTY invocation', () => {
    it('zero args → status table to stdout, note to stderr, exitCode 1, zero writes', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      const manifestBefore = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');

      const captured = { stdout: '', stderr: '' };
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
        if (typeof c === 'string') captured.stdout += c;
        return true;
      });
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
        if (typeof c === 'string') captured.stderr += c;
        return true;
      });

      try {
        await flagsCmd.parseAsync([], { from: 'user' });
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }

      // Status table: one line per registry flag — stdout must contain a known flag id
      expect(captured.stdout).toContain('tui');
      // Exactly one stderr note line
      expect(captured.stderr).toContain('Note:');
      // Exit code must be 1 (non-TTY path always fails with a hint)
      expect(process.exitCode).toBe(1);
      // Zero writes — manifest must be byte-for-byte identical after the run
      const manifestAfter = await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8');
      expect(manifestAfter).toBe(manifestBefore);
    });
  });

  // ─── malformed settings.json guard ───────────────────────────────────────────

  describe('malformed settings.json guard', () => {
    it('--enable aborts on malformed settings.json (never silently clobbers)', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), 'not valid json at all', 'utf-8');

      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      // settings.json must remain untouched (not silently clobbered with {})
      const settingsAfter = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
      expect(settingsAfter).toBe('not valid json at all');
    });

    it('--set aborts on malformed settings.json (never silently clobbers)', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), 'not valid json at all', 'utf-8');

      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=25'], { from: 'user' });
      expect(process.exitCode).toBe(1);

      // settings.json must remain byte-untouched (anti-clobber guard, same as --enable)
      const settingsAfter = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
      expect(settingsAfter).toBe('not valid json at all');
    });

    it('ENOENT settings.json → treated as {} (not an error)', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');
      // No settings.json — should succeed (ENOENT starts from {})

      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });
      expect(process.exitCode).toBe(0);
    });
  });

  // ─── confirmation output under the REAL initial exitCode ─────────────────────
  //
  // Regression guard. Every other test in this file sets `process.exitCode = 0`
  // in beforeEach, which does not reproduce a real CLI invocation: Node starts a
  // process with `process.exitCode === undefined`, NOT 0. The mutating paths used
  // to gate their confirmation output on `process.exitCode === 0`, so on a real
  // run that test was false and `devflow flags --enable X` completed silently —
  // it wrote both artifacts and told the user nothing. The harness normalised away
  // the exact condition under which production failed (the PF-018 shape: a green
  // test that cannot observe the defect it is meant to guard).
  //
  // These tests restore exitCode to `undefined` to reproduce a real invocation and
  // assert on the emitted confirmation rather than on the exit code.

  describe('confirmation output (exitCode starts undefined, as in a real process)', () => {
    beforeEach(() => {
      vi.mocked(p.log.success).mockClear();
      process.exitCode = undefined;
    });

    /** Success lines emitted by the command under test. */
    function successLines(): string[] {
      return vi.mocked(p.log.success).mock.calls.map(c => String(c[0]));
    }

    it('--enable emits a success line on a clean run', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });

      expect(successLines()).toContain('tui enabled');
      expect(process.exitCode).toBeFalsy(); // undefined or 0 — never 1
    });

    it('--disable emits a success line on a clean run', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ tui: true }),
        'utf-8',
      );

      await flagsCmd.parseAsync(['--disable', 'tui'], { from: 'user' });

      expect(successLines()).toContain('tui disabled');
    });

    it('--set emits a success line on a clean run', async () => {
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--set', 'max-concurrent-subagents=25'], { from: 'user' });

      expect(successLines()).toContain('max-concurrent-subagents = 25');
    });

    it('--unset emits a success line on a clean run', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({ 'max-concurrent-subagents': 40 }),
        'utf-8',
      );

      await flagsCmd.parseAsync(['--unset', 'max-concurrent-subagents'], { from: 'user' });

      expect(successLines()).toContain('max-concurrent-subagents unset');
    });

    it("a pre-existing unrelated exitCode=1 does not suppress this run's confirmation", async () => {
      // Success is tracked in locals, never read back off the process-global exit
      // code — an earlier unrelated failure must not misreport this operation.
      process.exitCode = 1;
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), makeEmptyFlagsManifest(), 'utf-8');

      await flagsCmd.parseAsync(['--enable', 'tui'], { from: 'user' });

      expect(successLines()).toContain('tui enabled');
    });
  });

  // ─── view-mode preservation through persistFlagConfig (SEC-M3 / ARCH-H1) ─────
  //
  // Pinning: any mutation (--enable, --set non-view-mode) must NOT destroy a
  // user-set viewMode:'focus' that devflow does not own (absent from manifest).

  describe('view-mode preservation through persistFlagConfig', () => {
    it('--enable brief: viewMode:"focus" survives when manifest has no view-mode entry', async () => {
      // Scenario: user ran /focus in Claude Code → settings.json has viewMode:'focus'
      // Manifest: no 'view-mode' key (devflow never wrote it)
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({}),   // no view-mode entry
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmpClaudeDir, 'settings.json'),
        JSON.stringify({ viewMode: 'focus', hooks: {} }, null, 2) + '\n',
        'utf-8',
      );

      await flagsCmd.parseAsync(['--enable', 'brief'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      // whole-post-state: viewMode must survive the strip+apply pass
      const settings = parseSettings(
        await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'),
      );
      expect(settings.viewMode, 'viewMode:"focus" must survive --enable brief').toBe('focus');
    });

    it('--set view-mode=verbose: explicitly overrides the /focus-set viewMode', async () => {
      // When the user explicitly targets view-mode, the record value wins over settings
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeManifestWithFlags({}),
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmpClaudeDir, 'settings.json'),
        JSON.stringify({ viewMode: 'focus', hooks: {} }, null, 2) + '\n',
        'utf-8',
      );

      await flagsCmd.parseAsync(['--set', 'view-mode=verbose'], { from: 'user' });
      expect(process.exitCode).toBe(0);

      const settings = parseSettings(
        await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'),
      );
      expect(settings.viewMode, '--set view-mode=verbose must override /focus').toBe('verbose');
    });
  });

  // ─── REL-M3: concurrent settings.json write during TUI session survives ───────
  //
  // handleBare re-reads settings.json AFTER runFlagsTui returns, not before.
  // A concurrent writer (e.g. `devflow proxy --enable` setting ANTHROPIC_BASE_URL)
  // that ran while the TUI was open would be silently clobbered by the stale
  // pre-TUI snapshot if the re-read were absent (applies PF-022).
  //
  // vi.doMock + vi.resetModules() isolate the mock to this describe block; the
  // mock's runFlagsTui simulates a concurrent write before returning {action:'save'}.

  describe('bare TUI save — concurrent settings.json write survives (REL-M3)', () => {
    let origStdoutIsTTY: boolean | undefined;
    let origStdinIsTTY: boolean | undefined;

    beforeEach(() => {
      origStdoutIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
      origStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: origStdinIsTTY, configurable: true });
      // Remove the doMock registration and clear module cache so subsequent tests
      // get the real flags-view implementation.
      vi.unmock('../src/cli/flags-view/index.js');
      vi.resetModules();
    });

    it('ANTHROPIC_BASE_URL written during TUI session is not clobbered by stale pre-TUI snapshot', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeEmptyFlagsManifest(),
        'utf-8',
      );
      // settings.json starts empty — the concurrent write will add the env key.
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), '{}', 'utf-8');

      const settingsPath = path.join(tmpClaudeDir, 'settings.json');

      // Mock flags-view so runFlagsTui simulates a concurrent write before returning.
      // buildFlagRows/collectFlagRecord return minimal stubs; only the concurrent
      // write timing matters for this regression.
      vi.doMock('../src/cli/flags-view/index.js', () => ({
        buildFlagRows: () => [],
        collectFlagRecord: () => ({}),
        runFlagsTui: async () => {
          // Concurrent write — simulates `devflow proxy --enable` running while the
          // TUI was open (applies PF-022: file state is reality, not config state).
          await fs.writeFile(
            settingsPath,
            JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://localhost:9090' } }, null, 2) + '\n',
            'utf-8',
          );
          return { action: 'save' as const, rows: [] as never[] };
        },
      }));
      // Clear the module cache so the fresh import of flags.ts picks up the mock
      // when its handleBare calls await import('../flags-view/index.js').
      vi.resetModules();

      const { createFlagsCommand } = await import('../src/cli/commands/flags.js');
      const freshCmd = createFlagsCommand();

      // Suppress any residual process.stdout.write calls (p.outro is already mocked).
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        await freshCmd.parseAsync([], { from: 'user' });
      } finally {
        stdoutSpy.mockRestore();
      }

      // REL-M3 regression: ANTHROPIC_BASE_URL written by the concurrent writer
      // must survive the re-read+persist in handleBare — not clobbered by the
      // stale pre-TUI snapshot.
      const settings = parseSettings(await fs.readFile(settingsPath, 'utf-8'));
      expect(
        (settings.env as Record<string, string> | undefined)?.ANTHROPIC_BASE_URL,
        'concurrent ANTHROPIC_BASE_URL must not be clobbered by stale pre-TUI snapshot',
      ).toBe('http://localhost:9090');

      // TUI save succeeded → exitCode must not be 1.
      expect(process.exitCode).toBeFalsy();
    });
  });

  // ─── bare TUI rejection — runFlagsTui rejects → log.error + exitCode 1 ─────────
  //
  // REG-SF1 hardening: runTui can reject on initial-render failure or handler throw.
  // handleBare must catch the rejection, emit p.log.error, set exitCode=1, and NOT
  // write settings.json. Uses vi.doMock to make runFlagsTui reject (C3 precedent).

  describe('bare TUI rejection — runFlagsTui rejects → log.error + exitCode 1', () => {
    let origStdoutIsTTY: boolean | undefined;
    let origStdinIsTTY: boolean | undefined;

    beforeEach(() => {
      origStdoutIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
      origStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: origStdinIsTTY, configurable: true });
      vi.unmock('../src/cli/flags-view/index.js');
      vi.resetModules();
    });

    it('runFlagsTui rejection → p.log.error, exitCode 1, settings.json not written', async () => {
      await fs.writeFile(
        path.join(tmpDevflowDir, 'manifest.json'),
        makeEmptyFlagsManifest(),
        'utf-8',
      );
      // No settings.json written before — absence is evidence no write occurred.

      vi.doMock('../src/cli/flags-view/index.js', () => ({
        buildFlagRows: () => [],
        collectFlagRecord: () => ({}),
        runFlagsTui: async () => {
          throw new Error('render failed: raw-mode unsupported');
        },
      }));
      vi.resetModules();

      const { createFlagsCommand } = await import('../src/cli/commands/flags.js');
      const freshCmd = createFlagsCommand();

      vi.mocked(p.log.error).mockClear();
      await freshCmd.parseAsync([], { from: 'user' });

      expect(process.exitCode).toBe(1);
      expect(vi.mocked(p.log.error)).toHaveBeenCalledWith(
        expect.stringContaining('render failed: raw-mode unsupported'),
      );
      // settings.json must NOT have been created.
      const settingsExists = await fs.access(path.join(tmpClaudeDir, 'settings.json'))
        .then(() => true).catch(() => false);
      expect(settingsExists, 'settings.json must not be written on TUI rejection').toBe(false);
    });
  });

  // ─── applyTuiResult seam — TUI→persist wiring (TEST-M5) ──────────────────────
  //
  // PF-017(c): an interactive surface has no automated test until a human runs it
  // in a real TTY. applyTuiResult closes this coverage gap: the extracted save
  // handler is called directly with a PassThrough-driven TUI result.
  //
  // PF-015: both save and cancel paths assert the WHOLE post-state of both
  // artifacts (manifest.features.flags + settings.json) — not per-key picks.

  describe('applyTuiResult seam — TUI→persist wiring (PF-015 + PF-017(c))', () => {
    function makeStreams() {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      (stdin as unknown as { isTTY: boolean }).isTTY = false;
      (stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode = (_m: boolean) => {};
      (stdout as unknown as { rows: number }).rows = 24;
      (stdout as unknown as { columns: number }).columns = 80;
      return { stdin, stdout };
    }

    function sendKey(stdin: PassThrough, key: string): void {
      stdin.push(key);
    }

    it('save path: TUI toggle+enter → applyTuiResult → whole post-state matches expected flags', async () => {
      // Arrange: tui=true in manifest; settings.json empty
      const initialFlags: FlagsRecord = { tui: true };
      const manifestContent = makeManifestWithFlags(initialFlags);
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), manifestContent, 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), '{}', 'utf-8');

      const manifest = (await readManifest(tmpDevflowDir))!;

      // Drive runFlagsTui with PassThrough streams: space toggles tui true→false,
      // then enter on a boolean row triggers save intent.
      const { stdin, stdout } = makeStreams();
      const rowsIn = buildFlagRows(initialFlags);
      const tui = runFlagsTui(rowsIn, { stdin, stdout });

      await new Promise(r => setTimeout(r, 10));
      sendKey(stdin, ' ');   // toggle tui: true → false
      await new Promise(r => setTimeout(r, 5));
      sendKey(stdin, '\r');  // enter on boolean row = save intent

      const tuiResult = await tui;
      expect(tuiResult.action).toBe('save');

      // Act: applyTuiResult (the seam) — freshSettingsContent is the re-read value
      // that handleBare would provide in production (caller owns the re-read per REL-M3).
      const outcome = await applyTuiResult(tuiResult, '{}', manifest, tmpClaudeDir, tmpDevflowDir);
      expect(outcome).toBe('saved');

      // Assert whole post-state of both artifacts (PF-015)
      const manifestAfter = JSON.parse(
        await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'),
      ) as { features: { flags: FlagsRecord } };
      // tui=false is recorded in manifest (deliberately disabled — not absent)
      expect(manifestAfter.features.flags.tui).toBe(false);

      const settingsAfter = JSON.parse(
        await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'),
      ) as Record<string, unknown>;
      // tui=false is the neutral value for a boolean flag → the key is deleted from settings
      expect(settingsAfter.tui).toBeUndefined();
    });

    it('cancel path: TUI esc → applyTuiResult → returns unchanged, both artifacts untouched', async () => {
      // Arrange: non-trivial initial state so we can verify nothing was mutated
      const initialFlags: FlagsRecord = { tui: true };
      const manifestContent = makeManifestWithFlags(initialFlags);
      const settingsContent = JSON.stringify({ tui: 'fullscreen' }, null, 2) + '\n';
      await fs.writeFile(path.join(tmpDevflowDir, 'manifest.json'), manifestContent, 'utf-8');
      await fs.writeFile(path.join(tmpClaudeDir, 'settings.json'), settingsContent, 'utf-8');

      const manifest = (await readManifest(tmpDevflowDir))!;

      // Drive runFlagsTui to cancel via esc
      const { stdin, stdout } = makeStreams();
      const rowsIn = buildFlagRows(initialFlags);
      const tui = runFlagsTui(rowsIn, { stdin, stdout });

      await new Promise(r => setTimeout(r, 10));
      sendKey(stdin, '\x1b');  // esc = cancel

      const tuiResult = await tui;
      expect(tuiResult.action).toBe('cancel');

      // Act
      const outcome = await applyTuiResult(tuiResult, settingsContent, manifest, tmpClaudeDir, tmpDevflowDir);
      expect(outcome).toBe('unchanged');

      // Assert whole post-state — both artifacts must be byte-identical (PF-015)
      expect(
        await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'),
      ).toBe(manifestContent);
      expect(
        await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'),
      ).toBe(settingsContent);
    });
  });
});
