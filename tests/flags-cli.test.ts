/**
 * Phase 3 — flags CLI rewrite (createFlagsCommand factory).
 *
 * Harness follows the hud-enable-selfheal pattern:
 *   - vi.mock @clack/prompts (declared before imports — vitest hoisting requirement)
 *   - vi.stubEnv CLAUDE_CODE_DIR/DEVFLOW_DIR to temp dirs
 *   - Fresh Command instance per test via createFlagsCommand()
 *   - Real temp files on disk; async fs operations
 *
 * Whole-post-state asserts (full JSON deep-equal, not key-picking) per PF-015:
 * both settings.json and manifest.features.flags are checked as complete objects.
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
import { createFlagsCommand } from '../src/cli/commands/flags.js';
import { makeManifest } from './helpers.js';
import type { FlagsRecord } from '../src/core/flags.js';

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

      // settings.json: tui=fullscreen (the onPayload for the tui boolean flag)
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings.tui).toBe('fullscreen');

      // manifest: flags record has tui: true
      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags.tui).toBe(true);
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

      // tui=false is neutral for boolean flags → key is deleted from settings
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect(settings.tui).toBeUndefined();

      // manifest: tui: false (recorded as deliberately disabled — not absent)
      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags.tui).toBe(false);
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

      // Env flag: value stringified for env target
      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect((settings.env as Record<string, string>)?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe('50');

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['max-concurrent-subagents']).toBe(50);
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

      const settings = parseSettings(await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8'));
      expect((settings.env as Record<string, string> | undefined)?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS)
        .toBeUndefined();

      const flags = parseFlagsRecord(await fs.readFile(path.join(tmpDevflowDir, 'manifest.json'), 'utf-8'));
      expect(flags['max-concurrent-subagents']).toBeNull();
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
});
