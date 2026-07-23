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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { hudCommand } from '../src/cli/commands/hud.js';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hud --enable self-healing (WS6b)', () => {
  let tmpClaudeDir: string;
  let tmpDevflowDir: string;
  let prevClaudeCodeDir: string | undefined;
  let prevDevflowDir: string | undefined;

  beforeEach(async () => {
    tmpClaudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hud-enable-claude-'));
    tmpDevflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hud-enable-devflow-'));

    // Point env vars at temp dirs so all path resolution picks them up
    prevClaudeCodeDir = process.env.CLAUDE_CODE_DIR;
    prevDevflowDir = process.env.DEVFLOW_DIR;
    process.env.CLAUDE_CODE_DIR = tmpClaudeDir;
    process.env.DEVFLOW_DIR = tmpDevflowDir;

    // Reset Commander option state between tests to prevent cross-test bleed
    (hudCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  });

  afterEach(async () => {
    if (prevClaudeCodeDir === undefined) {
      delete process.env.CLAUDE_CODE_DIR;
    } else {
      process.env.CLAUDE_CODE_DIR = prevClaudeCodeDir;
    }
    if (prevDevflowDir === undefined) {
      delete process.env.DEVFLOW_DIR;
    } else {
      process.env.DEVFLOW_DIR = prevDevflowDir;
    }
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

    await hudCommand.parseAsync(['--enable'], { from: 'user' });

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

    await hudCommand.parseAsync(['--enable'], { from: 'user' });

    // statusLine must have been written to settings.json
    const settingsContent = await fs.readFile(
      path.join(tmpClaudeDir, 'settings.json'),
      'utf-8',
    );
    const settings = JSON.parse(settingsContent) as { statusLine?: { command: string } };
    expect(settings.statusLine).toBeDefined();
    expect(settings.statusLine!.command).toContain('hud.sh');
  });
});
