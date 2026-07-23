/**
 * WS6b: --enable self-healing contract test
 *
 * Verifies that `devflow hud --enable` is symmetric with `--disable`:
 *   - Even when config.enabled is already true, the action must still
 *     call syncManifestFeature (manifest drift repair) and ensure the
 *     statusLine is set (settings.json drift repair).
 *
 * The prior bug was an early-return in the --enable path that exited
 * after logging "HUD already enabled", bypassing syncManifestFeature
 * entirely. This test pins the repaired behavior.
 *
 * Also covers the non-Devflow statusLine confirm/skip branch:
 *   - non-interactive mode skips without overwriting
 *   - user declining the confirm prompt preserves the existing statusLine
 *   - user confirming the prompt replaces it with the Devflow HUD
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

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

import { createHudCommand } from '../src/cli/commands/hud.js';
// Static import of the mocked @clack/prompts so vi.mocked() targets the
// same mock instance that hud.ts's action closure captures. Both resolve
// via the module registry at file-load time — no vi.resetModules() needed.
import * as clack from '@clack/prompts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid manifest.json */
function makeManifest(hudEnabled: boolean): string {
  return JSON.stringify({
    version: '2.0.0',
    plugins: ['devflow-implement'],
    scope: 'user',
    features: {
      ambient: false,
      memory: false,
      hud: hudEnabled,
      knowledge: false,
      learning: false,
      rules: false,
      flags: [],
    },
    installedAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }, null, 2) + '\n';
}

/** Settings.json with a Devflow HUD statusLine already set */
function makeSettingsWithStatusLine(devflowDir: string): string {
  return JSON.stringify({
    statusLine: {
      type: 'command',
      command: path.join(devflowDir, 'scripts', 'hud.sh'),
    },
  }, null, 2) + '\n';
}

/** Minimal hud.json representing already-enabled state */
function makeHudConfig(enabled: boolean): string {
  return JSON.stringify({ enabled, detail: false }, null, 2) + '\n';
}

/** Settings.json with a non-Devflow statusLine */
function makeSettingsWithNonDevflowStatusLine(command: string): string {
  return JSON.stringify({
    statusLine: { type: 'command', command },
  }, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hud --enable self-healing (WS6b)', () => {
  let tmpClaudeDir: string;
  let tmpDevflowDir: string;

  // Fresh Command per test via the exported factory — avoids coupling to
  // Commander's private _optionValues field for cross-test option isolation.
  // A Commander internal rename would silently no-op a _optionValues = {}
  // reset and let cross-test option bleed return undetected; the factory
  // approach is impervious to such renames.
  let hudCmd: Command;

  beforeEach(async () => {
    tmpClaudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hud-enable-claude-'));
    tmpDevflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hud-enable-devflow-'));

    // vi.stubEnv tracks mutations; vi.unstubAllEnvs() in afterEach restores
    // them unconditionally — leak-proof even when the test throws.
    vi.stubEnv('CLAUDE_CODE_DIR', tmpClaudeDir);
    vi.stubEnv('DEVFLOW_DIR', tmpDevflowDir);

    hudCmd = createHudCommand();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tmpClaudeDir, { recursive: true, force: true });
    await fs.rm(tmpDevflowDir, { recursive: true, force: true });
  });

  it('already-enabled --enable still updates manifest.hud to true when manifest is drifted', async () => {
    // Set up: config says enabled=true, manifest says hud=false (drifted)
    // Simulates a crash between config-write and manifest-write on a prior run.

    // settings.json: statusLine already set (so the statusLine-ensure block is a no-op)
    await fs.writeFile(
      path.join(tmpClaudeDir, 'settings.json'),
      makeSettingsWithStatusLine(tmpDevflowDir),
      'utf-8',
    );

    // hud.json: enabled=true (the "already enabled" state)
    await fs.writeFile(
      path.join(tmpDevflowDir, 'hud.json'),
      makeHudConfig(true),
      'utf-8',
    );

    // manifest.json: hud=false (drifted — should be repaired by --enable)
    await fs.writeFile(
      path.join(tmpDevflowDir, 'manifest.json'),
      makeManifest(false),
      'utf-8',
    );

    await hudCmd.parseAsync(['--enable'], { from: 'user' });

    // syncManifestFeature must have updated hud to true
    const manifestContent = await fs.readFile(
      path.join(tmpDevflowDir, 'manifest.json'),
      'utf-8',
    );
    const manifest = JSON.parse(manifestContent) as { features: { hud: boolean } };
    expect(manifest.features.hud).toBe(true);
  });

  it('already-enabled --enable adds missing statusLine to settings.json (self-heal)', async () => {
    // Set up: config says enabled=true, but statusLine is missing from settings.json.
    // --enable must repair the statusLine even when already enabled.

    // settings.json: empty (no statusLine)
    await fs.writeFile(
      path.join(tmpClaudeDir, 'settings.json'),
      '{}',
      'utf-8',
    );

    // hud.json: enabled=true
    await fs.writeFile(
      path.join(tmpDevflowDir, 'hud.json'),
      makeHudConfig(true),
      'utf-8',
    );

    // No manifest.json — syncManifestFeature is a no-op without a manifest (fine here)

    await hudCmd.parseAsync(['--enable'], { from: 'user' });

    // statusLine must have been written to settings.json
    const settingsContent = await fs.readFile(
      path.join(tmpClaudeDir, 'settings.json'),
      'utf-8',
    );
    const settings = JSON.parse(settingsContent) as { statusLine?: { command: string } };
    expect(settings.statusLine).toBeDefined();
    expect(settings.statusLine!.command).toContain('hud.sh');
  });

  // ---------------------------------------------------------------------------
  // TEST-7: non-Devflow statusLine confirm/skip branch
  // ---------------------------------------------------------------------------

  it('skips in non-interactive mode when non-Devflow statusLine is present', async () => {
    // Set up: settings.json has a non-Devflow statusLine.
    // process.stdin.isTTY is falsy in the test runner — the non-interactive
    // branch fires automatically without any stub.
    await fs.writeFile(
      path.join(tmpClaudeDir, 'settings.json'),
      makeSettingsWithNonDevflowStatusLine('/usr/local/bin/other-tool.sh'),
      'utf-8',
    );

    await hudCmd.parseAsync(['--enable'], { from: 'user' });

    // Non-interactive path returns early — existing statusLine must be unchanged.
    const content = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
    const settings = JSON.parse(content) as { statusLine?: { command: string } };
    expect(settings.statusLine?.command).toBe('/usr/local/bin/other-tool.sh');
  });

  it('skips when user declines to overwrite existing non-Devflow statusLine', async () => {
    // Set up: settings.json has a non-Devflow statusLine; stdin is interactive.
    // The confirm mock returns false (default) — user declines.
    await fs.writeFile(
      path.join(tmpClaudeDir, 'settings.json'),
      makeSettingsWithNonDevflowStatusLine('/usr/local/bin/other-tool.sh'),
      'utf-8',
    );

    // Make stdin appear interactive so the confirm prompt fires instead of the
    // non-interactive skip path. Restored in finally so the stub cannot leak.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      await hudCmd.parseAsync(['--enable'], { from: 'user' });
    } finally {
      delete (process.stdin as unknown as Record<string, unknown>).isTTY;
    }

    // User declined (confirm=false, isCancel=false) → statusLine preserved.
    const content = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
    const settings = JSON.parse(content) as { statusLine?: { command: string } };
    expect(settings.statusLine?.command).toBe('/usr/local/bin/other-tool.sh');
  });

  it('replaces existing non-Devflow statusLine when user confirms', async () => {
    // Set up: settings.json has a non-Devflow statusLine; stdin is interactive.
    // The confirm mock is configured to return true — user accepts the overwrite.
    await fs.writeFile(
      path.join(tmpClaudeDir, 'settings.json'),
      makeSettingsWithNonDevflowStatusLine('/usr/local/bin/other-tool.sh'),
      'utf-8',
    );

    // Configure confirm to return true for this one call. Both this test and
    // hud.ts's action use the same mock instance (static import, no resetModules).
    vi.mocked(clack.confirm).mockResolvedValueOnce(true);

    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      await hudCmd.parseAsync(['--enable'], { from: 'user' });
    } finally {
      delete (process.stdin as unknown as Record<string, unknown>).isTTY;
    }

    // User confirmed → non-Devflow statusLine replaced with Devflow HUD.
    const content = await fs.readFile(path.join(tmpClaudeDir, 'settings.json'), 'utf-8');
    const settings = JSON.parse(content) as { statusLine?: { command: string } };
    expect(settings.statusLine?.command).toContain('hud.sh');
    expect(settings.statusLine?.command).not.toBe('/usr/local/bin/other-tool.sh');
  });
});
