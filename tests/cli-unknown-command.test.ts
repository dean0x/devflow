/**
 * CLI process-level guard: unknown subcommands must exit non-zero.
 *
 * Spawns dist/cli.js as a real child process so we can observe the actual exit
 * code and stderr output. This covers the regression where Commander's root
 * `.action()` swallowed unknown subcommands (e.g. the removed `devflow list`)
 * and exited 0 instead of emitting an error.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

const CLI = path.resolve(import.meta.dirname, '..', 'dist', 'cli.js');

// Guard: skip all tests when dist/cli.js has not been built.
// npm test has no pretest build step — a missing or stale dist would validate wrong output.
// Mirrors the graceful-skip pattern used in Guards 4/5 of registry-integrity.test.ts.
const distExists = await fs.access(CLI).then(() => true).catch(() => false);

function runCli(...args: string[]) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
}

describe.skipIf(!distExists)('CLI: bare invocation exits 0 with help', () => {
  it('devflow (no args) exits 0 and prints usage', () => {
    const result = runCli();
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain('Usage: devflow');
  });

  it('devflow --help exits 0', () => {
    const result = runCli('--help');
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain('Usage: devflow');
  });
});

describe.skipIf(!distExists)('CLI: unknown subcommand exits 1 with error message', () => {
  it('devflow list (removed command) exits 1', () => {
    const result = runCli('list');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown command');
  });

  it('devflow no-such-cmd exits 1', () => {
    const result = runCli('no-such-cmd');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown command');
  });

  it('error message names the bad subcommand', () => {
    const result = runCli('list');
    expect(result.stderr).toContain("'list'");
  });
});

describe.skipIf(!distExists)('CLI: real subcommands are unaffected', () => {
  it('devflow init --help exits 0', () => {
    const result = runCli('init', '--help');
    expect(result.status).toBe(0);
  });

  it('devflow flags --help exits 0', () => {
    const result = runCli('flags', '--help');
    expect(result.status).toBe(0);
  });

  it('devflow rules --help exits 0', () => {
    const result = runCli('rules', '--help');
    expect(result.status).toBe(0);
  });
});
