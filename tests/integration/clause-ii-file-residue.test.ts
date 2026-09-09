/**
 * Clause (ii) file-residue integration guard.
 *
 * Mechanises the FILE-RESIDUE half of the prefix-shippability acceptance criterion (ii):
 *   "a fresh install from the tarball drives /plan → /implement → /code-review → /resolve →
 *    /release on a GitHub project with no new prompt and no new file in `git status`"
 *
 * What this file covers:
 *   Pack the real tarball → install into a scratch HOME → run `devflow init --recommended`
 *   in a throwaway git repo → assert `git status --porcelain` has no untracked (`??`) entries.
 *
 * What this file does NOT cover (remains manual):
 *   - The "no new prompt" half (requires a live model session).
 *   - The five-command walk-through (/plan → /implement → /code-review → /resolve → /release)
 *     — requires a live model + authenticated GitHub project.
 *
 * Composition step neither existing test performs:
 *   pack-install.test.ts   — installs tarball into temp node_modules, no scratch HOME, no init
 *   init-e2e-flags.test.ts — runs init from pre-built dist/, no tarball, asserts manifest state
 *   This file              — packs the real tarball, installs into a scratch HOME, runs
 *                            `devflow init --recommended` in a target git repo, and asserts
 *                            the file-residue property (no untracked files left behind).
 *
 * Expected legitimate churn:
 *   - `.gitignore` is MODIFIED (` M`) — devflow appends its carve-out block. That is a
 *     reviewed, committed-file change, not an untracked leak. The test asserts its presence
 *     as a positive proof that init ran.
 *   - `.devflow/` directory — gitignored by the carve-out; does not appear in `git status`.
 *
 * Skip guard: all tests skip when `dist/cli.js` is absent — the tarball needs a working
 * compiled CLI to be meaningful. Uses `existsSync` (synchronous) for `it.skipIf`.
 *
 * Runtime: ~90–180 s on a warm machine (npm pack ~30s + npm install ~60s + init ~15s).
 * Lives in tests/integration/ — run via:
 *   npx vitest run --config vitest.integration.config.ts tests/integration/clause-ii-file-residue.test.ts
 * Timeout governed by vitest.integration.config.ts (300 000 ms).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execSync, execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Skip guard — synchronous so it can be used with it.skipIf at module evaluation time.
 * A skipped test produces an explicit SKIP mark rather than silently passing (PF-018).
 */
const CLI_BUILT = existsSync(path.join(ROOT, 'dist', 'cli.js'));

// Module-level state shared across sequential tests.
let PACK_DIR: string;
let INSTALL_DIR: string;
let SCRATCH_HOME: string;
let TARGET_REPO: string;

afterAll(async () => {
  // Best-effort cleanup — never throw; the test is already done at this point.
  for (const dir of [PACK_DIR, INSTALL_DIR, SCRATCH_HOME, TARGET_REPO]) {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a shell command synchronously.
 * Returns { stdout, stderr, exitCode, signal }.
 * Never throws — callers check exitCode explicitly (PF-008).
 *
 * `signal` is populated when execSync kills the process due to a timeout.
 */
function runSync(
  command: string,
  options: { cwd?: string; timeout?: number } = {},
): { stdout: string; stderr: string; exitCode: number; signal?: string } {
  try {
    const stdout = execSync(command, {
      cwd: options.cwd ?? ROOT,
      timeout: options.timeout ?? 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number | null; signal?: string };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      exitCode: e.status ?? 1,
      ...(e.signal !== undefined && e.signal !== null ? { signal: e.signal } : {}),
    };
  }
}

/**
 * Run `devflow init --recommended` in a subprocess with a fully isolated HOME.
 * Uses spawnSync rather than execSync so we can pass a clean env with HOME overridden
 * without inheriting the current session's ~/.devflow state.
 */
function runDevflowInit(opts: {
  cliPath: string;
  cwd: string;
  home: string;
}): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [opts.cliPath, 'init', '--recommended'], {
    cwd: opts.cwd,
    encoding: 'utf-8',
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: opts.home,
      DEVFLOW_DIR: path.join(opts.home, '.devflow'),
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
    },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ---------------------------------------------------------------------------
// Clause (ii) file-residue guard
// ---------------------------------------------------------------------------

describe('Clause (ii) file-residue: tarball install into scratch HOME → devflow init → git status', () => {
  /** Path to the installed devflow CLI inside the scratch node_modules tree. */
  let installedCliPath: string;

  // ── Step 1: pack the real tarball ─────────────────────────────────────────

  it.skipIf(!CLI_BUILT)('npm pack exits 0 and produces a .tgz file', async () => {
    PACK_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'dfpk2-pack-'));
    const result = runSync(`npm pack --pack-destination "${PACK_DIR}"`, {
      cwd: ROOT,
      timeout: 90_000,
    });

    const exitDetail = result.signal
      ? `TIMEOUT/signal=${result.signal} (exit ${result.exitCode})`
      : `exit ${result.exitCode}`;
    expect(result.exitCode, `npm pack failed (${exitDetail}):\n${result.stderr}`).toBe(0);

    const entries = await fs.readdir(PACK_DIR);
    const tgzFiles = entries.filter(f => f.endsWith('.tgz'));
    expect(
      tgzFiles.length,
      `npm pack produced no .tgz in ${PACK_DIR}. Entries: ${entries.join(', ')}`,
    ).toBe(1);
  });

  // ── Step 2: install tarball into a scratch node_modules tree ──────────────

  it.skipIf(!CLI_BUILT)('npm install from tarball into scratch node_modules exits 0', async () => {
    const entries = await fs.readdir(PACK_DIR);
    const tgzPath = path.join(PACK_DIR, entries.find(f => f.endsWith('.tgz'))!);

    INSTALL_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'dfpk2-install-'));
    await fs.writeFile(
      path.join(INSTALL_DIR, 'package.json'),
      JSON.stringify({ name: 'dfpk2-smoke', version: '0.0.0', private: true }),
    );

    const result = runSync(`npm install --no-save "${tgzPath}"`, {
      cwd: INSTALL_DIR,
      timeout: 120_000,
    });
    expect(result.exitCode, `npm install failed (exit ${result.exitCode}):\n${result.stderr}`).toBe(0);

    installedCliPath = path.join(INSTALL_DIR, 'node_modules', 'devflow-kit', 'dist', 'cli.js');
    await expect(
      fs.access(installedCliPath),
      `dist/cli.js not found in installed package at ${installedCliPath} — verify dist/ is in package.json files[]`,
    ).resolves.toBeUndefined();
  });

  // ── Step 3: create throwaway git repo in a clean, non-empty tracked state ─

  it.skipIf(!CLI_BUILT)('throwaway git repo starts from a clean committed state', async () => {
    TARGET_REPO = await fs.mkdtemp(path.join(os.tmpdir(), 'dfpk2-repo-'));

    execFileSync('git', ['init', '-q'], { cwd: TARGET_REPO });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: TARGET_REPO });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: TARGET_REPO });

    // Minimal .gitignore and a source file — no `.claudeignore` pre-exclusion so that
    // any file devflow creates in the repo is visible as an untracked entry.
    await fs.writeFile(path.join(TARGET_REPO, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(TARGET_REPO, 'index.js'), '// placeholder\n');

    execFileSync('git', ['add', '.gitignore', 'index.js'], { cwd: TARGET_REPO });
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: TARGET_REPO });

    // Precondition: repo must start clean. Fail loudly if not — proceeding from a
    // dirty state would make the clause-(ii) assertion meaningless.
    const statusResult = runSync('git status --porcelain', { cwd: TARGET_REPO });
    expect(statusResult.exitCode, `git status failed in target repo: ${statusResult.stderr}`).toBe(0);
    expect(
      statusResult.stdout.trim(),
      `Target repo must start from a clean state before devflow init runs. ` +
      `Unexpected git status:\n${statusResult.stdout}`,
    ).toBe('');
  });

  // ── Step 4: prepare scratch HOME ──────────────────────────────────────────

  it.skipIf(!CLI_BUILT)('scratch HOME is isolated from real HOME', async () => {
    SCRATCH_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'dfpk2-home-'));
    // devflow init checks for ~/.claude and bails with "Claude Code not detected" if absent.
    await fs.mkdir(path.join(SCRATCH_HOME, '.claude'), { recursive: true });

    // Confirm the scratch HOME is not the developer's real HOME.
    expect(SCRATCH_HOME, 'Scratch HOME must not be the real HOME').not.toBe(os.homedir());
  });

  // ── Step 5: run devflow init --recommended ─────────────────────────────────

  it.skipIf(!CLI_BUILT)('devflow init --recommended exits 0 from the installed tarball CLI', () => {
    const result = runDevflowInit({
      cliPath: installedCliPath,
      cwd: TARGET_REPO,
      home: SCRATCH_HOME,
    });

    const exitDetail = `exit ${result.exitCode}`;
    expect(
      result.exitCode,
      `devflow init --recommended failed (${exitDetail}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  // ── Step 6: clause-(ii) file-residue assertion ────────────────────────────

  // FIX: `.claudeignore` is now listed in the devflow-managed gitignore block (v4), so it
  // is ignored by git and does not appear as an untracked entry. The clause-(ii) violation
  // is resolved: `git status --porcelain` now shows only ` M .gitignore` (the block update).
  it.skipIf(!CLI_BUILT)('git status shows no untracked (??) entries after devflow init [clause-ii file-residue]', () => {
    const statusResult = runSync('git status --porcelain', { cwd: TARGET_REPO });
    expect(statusResult.exitCode, `git status failed: ${statusResult.stderr}`).toBe(0);

    const lines = statusResult.stdout.split('\n').filter(l => l.trim());
    const qqEntries = lines.filter(l => l.startsWith('??'));

    // Snapshot the full porcelain output — the primary deliverable from this run.
    // Whether the assertion passes or fails, the output is visible in the test report.
    console.log(
      `[clause-ii] git status --porcelain after devflow init --recommended:\n` +
      (lines.length > 0 ? lines.join('\n') : '(empty — no changes)'),
    );

    // Clause-(ii) file-residue assertion: no untracked entries.
    // A modified tracked file (e.g., `.gitignore`) is acceptable; a new untracked file is
    // a clause-(ii) violation and must be reported.
    expect(
      qqEntries,
      `Clause (ii) VIOLATED: devflow init --recommended left untracked files in the target repo.\n` +
      `Untracked paths: ${qqEntries.join(', ')}\n` +
      `Full git status:\n${statusResult.stdout}`,
    ).toEqual([]);
  });

  // ── Step 7: positive assertion — init did its job ─────────────────────────

  it.skipIf(!CLI_BUILT)('.gitignore was modified by devflow init (positive: init ran and wrote the carve-out)', () => {
    const statusResult = runSync('git status --porcelain', { cwd: TARGET_REPO });
    expect(statusResult.exitCode, `git status failed: ${statusResult.stderr}`).toBe(0);

    const lines = statusResult.stdout.split('\n').filter(l => l.trim());

    // The devflow gitignore carve-out must have been appended to .gitignore.
    // If this assertion fails, init did not run (or the carve-out logic regressed).
    const hasGitignoreModification = lines.some(l => l.includes('.gitignore'));
    expect(
      hasGitignoreModification,
      `Expected .gitignore to be modified by devflow init (carve-out block not appended?).\n` +
      `Full git status:\n${statusResult.stdout}`,
    ).toBe(true);
  });

  // ── Step 8: nothing leaked to the real HOME ───────────────────────────────

  it.skipIf(!CLI_BUILT)('devflow init wrote to scratch HOME, not the real developer HOME', async () => {
    // Verify the scratch HOME received the devflow manifest (proof init wrote there).
    const scratchManifestPath = path.join(SCRATCH_HOME, '.devflow', 'manifest.json');
    await expect(
      fs.access(scratchManifestPath),
      `devflow manifest not found at scratch HOME path ${scratchManifestPath} — init may have written to real HOME`,
    ).resolves.toBeUndefined();

    // Verify the scratch HOME is not the real HOME (belt-and-suspenders).
    expect(SCRATCH_HOME).not.toBe(os.homedir());
  });

  // ── Step 9: the installed Git agent came from dist/agents/ (AC-1.9) ────────

  it.skipIf(!CLI_BUILT)('the installed Git agent is byte-identical to dist/agents/git.md (AC-1.9)', async () => {
    // The Git agent ships only as a compiled artifact now. The installer resolves
    // agents dist-first, but nothing observed that end to end: this compares the
    // file `devflow init` wrote under the scratch HOME against the compiled
    // artifact inside the installed tarball. A src-first installer, or a publish
    // built with `npm run build:cli` alone, fails here.
    const compiled = path.join(
      INSTALL_DIR, 'node_modules', 'devflow-kit', 'dist', 'agents', 'git.md',
    );
    const installed = path.join(SCRATCH_HOME, '.claude', 'agents', 'devflow', 'git.md');

    const compiledContent = await fs.readFile(compiled, 'utf-8');
    const installedContent = await fs.readFile(installed, 'utf-8');

    expect(
      compiledContent.length,
      'compiled agent is empty — the guard would compare nothing',
    ).toBeGreaterThan(0);
    expect(
      installedContent,
      `The installed Git agent must be the compiled artifact.\n` +
      `  compiled: ${compiled}\n  installed: ${installed}\n` +
      `A mismatch means the installer resolved a source file instead, or the tarball\n` +
      `was built without \`npm run build:mds\`.`,
    ).toBe(compiledContent);
  });
});
