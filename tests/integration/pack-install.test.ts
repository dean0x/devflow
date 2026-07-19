/**
 * Pack-install integration guard.
 *
 * Guard 6 (pack-install): `npm pack` produces a valid tarball, installing it
 * into a fresh directory brings up the CLI, and all runtime-critical assets are
 * present in the install tree.
 *
 * Per PF-008: assert on explicit exit codes and file existence, never on
 * pipeline tails or partial stdout fragments. Every step captures its own
 * exit code; a non-zero code is a hard failure with a descriptive message.
 *
 * This test is slow (40-90s on a cold build) and lives in tests/integration/
 * so it runs via `npm run test:integration` rather than the default `npm test`.
 *
 * Timeout is set by vitest.integration.config.ts (300 000 ms).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

// Temp directories for the pack output and install tree; cleaned up in afterAll.
let PACK_DIR: string;
let INSTALL_DIR: string;

afterAll(async () => {
  // Best-effort cleanup — do not throw if the dirs are already gone.
  if (PACK_DIR) await fs.rm(PACK_DIR, { recursive: true, force: true }).catch(() => undefined);
  if (INSTALL_DIR) await fs.rm(INSTALL_DIR, { recursive: true, force: true }).catch(() => undefined);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a shell command synchronously.
 * Returns { stdout, stderr, exitCode }.
 * Never throws — callers check exitCode explicitly (PF-008).
 */
function runSync(
  command: string,
  options: { cwd?: string; timeout?: number } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(command, {
      cwd: options.cwd ?? ROOT,
      timeout: options.timeout ?? 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Guard 6: pack → install → smoke
// ---------------------------------------------------------------------------

describe('Guard 6 (pack-install): npm pack produces a working installable package', () => {
  let tgzPath: string;

  it('npm pack exits 0 and produces a .tgz file', async () => {
    PACK_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-pack-'));
    const result = runSync(`npm pack --pack-destination "${PACK_DIR}"`, { cwd: ROOT, timeout: 90_000 });

    expect(result.exitCode, `npm pack failed (exit ${result.exitCode}):\n${result.stderr}`).toBe(0);

    const packDirEntries = await fs.readdir(PACK_DIR);
    const tgzFiles = packDirEntries.filter(f => f.endsWith('.tgz'));

    expect(
      tgzFiles.length,
      `npm pack ran but produced no .tgz file in ${PACK_DIR}. entries: ${packDirEntries.join(', ')}`,
    ).toBe(1);

    tgzPath = path.join(PACK_DIR, tgzFiles[0]);
  });

  it('npm install from tarball exits 0', async () => {
    INSTALL_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-install-'));

    // Write a minimal package.json so npm install doesn't complain about no package.json.
    await fs.writeFile(
      path.join(INSTALL_DIR, 'package.json'),
      JSON.stringify({ name: 'devflow-pack-smoke', version: '0.0.0', private: true }),
    );

    const result = runSync(`npm install --no-save "${tgzPath}"`, { cwd: INSTALL_DIR, timeout: 120_000 });

    expect(result.exitCode, `npm install failed (exit ${result.exitCode}):\n${result.stderr}`).toBe(0);
  });

  it('installed package has dist/cli.js (main CLI entry point)', async () => {
    const cliPath = path.join(INSTALL_DIR, 'node_modules', 'devflow-kit', 'dist', 'cli.js');
    await expect(
      fs.access(cliPath),
      `dist/cli.js not found in the installed package at ${cliPath}. ` +
      `Verify 'dist/' is in the package.json files[] array.`,
    ).resolves.toBeUndefined();
  });

  it('installed CLI exits 0 with --version flag', async () => {
    const cliPath = path.join(INSTALL_DIR, 'node_modules', 'devflow-kit', 'dist', 'cli.js');
    const result = runSync(`node "${cliPath}" --version`, { timeout: 15_000 });

    expect(
      result.exitCode,
      `node dist/cli.js --version failed (exit ${result.exitCode}):\n${result.stderr}`,
    ).toBe(0);

    // Version string should look like a semver (e.g. "2.3.0").
    expect(
      result.stdout.trim(),
      `version output '${result.stdout.trim()}' is not a valid semver-like string`,
    ).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('installed package has src/assets/ tree with hook scripts', async () => {
    const hooksDir = path.join(INSTALL_DIR, 'node_modules', 'devflow-kit', 'src', 'assets', 'scripts', 'hooks');

    await expect(
      fs.access(hooksDir),
      `src/assets/scripts/hooks/ not found in the installed package. ` +
      `Verify 'src/assets/' is in the package.json files[] array.`,
    ).resolves.toBeUndefined();

    const hooksEntries = await fs.readdir(hooksDir);
    const hasCaptureTurn = hooksEntries.includes('capture-turn');
    const hasMemoryWorker = hooksEntries.includes('memory-worker');

    expect(hasCaptureTurn, 'capture-turn hook is missing from the installed package').toBe(true);
    expect(hasMemoryWorker, 'memory-worker hook is missing from the installed package').toBe(true);
  });

  it('installed package has src/assets/agents/ with at least one shared agent', async () => {
    const agentsDir = path.join(INSTALL_DIR, 'node_modules', 'devflow-kit', 'src', 'assets', 'agents');

    await expect(
      fs.access(agentsDir),
      `src/assets/agents/ not found in the installed package. ` +
      `Verify 'src/assets/' is in the package.json files[] array.`,
    ).resolves.toBeUndefined();

    const agentFiles = await fs.readdir(agentsDir);
    const hasCoder = agentFiles.includes('coder.md');
    const hasReviewer = agentFiles.includes('reviewer.md');

    expect(hasCoder, 'coder.md agent is missing from the installed package').toBe(true);
    expect(hasReviewer, 'reviewer.md agent is missing from the installed package').toBe(true);
  });

  it('installed package has src/targets/claude-code/templates/ with settings.json', async () => {
    const templatesDir = path.join(
      INSTALL_DIR, 'node_modules', 'devflow-kit',
      'src', 'targets', 'claude-code', 'templates',
    );

    await expect(
      fs.access(templatesDir),
      `src/targets/claude-code/templates/ not found in the installed package. ` +
      `Verify 'src/targets/claude-code/templates/' is in the package.json files[] array.`,
    ).resolves.toBeUndefined();

    const templateFiles = await fs.readdir(templatesDir);
    expect(
      templateFiles.includes('settings.json'),
      `settings.json template is missing from the installed package`,
    ).toBe(true);
  });
});
