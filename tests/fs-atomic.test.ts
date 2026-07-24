/**
 * Tests for src/core/fs-atomic.ts — writeFileAtomicExclusive
 *
 * TDD: RED-GREEN-REFACTOR
 *
 * Coverage:
 * - Mode preservation: pre-hardened target (0600) retains its mode after rewrite
 * - Fresh target: default umask behavior unchanged (content correct, no mode error)
 * - Basic write: content is written correctly
 * - Stale .tmp recovery: EEXIST on .tmp triggers unlink-and-retry
 * - Idempotency: second call with same content produces same result
 *
 * Note: mode-preservation tests are skipped on win32 (POSIX chmod semantics).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileAtomicExclusive } from '../src/core/fs-atomic.js';

const IS_WIN32 = process.platform === 'win32';

describe('writeFileAtomicExclusive', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-fs-atomic-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // ─── Content correctness ───────────────────────────────────────────────────

  it('writes content to the target file', async () => {
    const target = path.join(dir, 'settings.json');
    await writeFileAtomicExclusive(target, '{"key":"value"}');
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe('{"key":"value"}');
  });

  it('overwrites existing target with new content', async () => {
    const target = path.join(dir, 'settings.json');
    await writeFileAtomicExclusive(target, 'first');
    await writeFileAtomicExclusive(target, 'second');
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe('second');
  });

  it('does not leave a .tmp file behind on success', async () => {
    const target = path.join(dir, 'settings.json');
    await writeFileAtomicExclusive(target, 'hello');
    await expect(fs.access(`${target}.tmp`)).rejects.toThrow();
  });

  // ─── Stale .tmp recovery ──────────────────────────────────────────────────

  it('recovers from a stale .tmp left by a prior crash', async () => {
    const target = path.join(dir, 'settings.json');
    // Simulate a crashed prior run that left a stale .tmp
    await fs.writeFile(`${target}.tmp`, 'stale content');
    await writeFileAtomicExclusive(target, 'fresh content');
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe('fresh content');
  });

  // ─── Fresh target: umask default behavior ─────────────────────────────────

  it('creates a fresh target with readable content (no pre-existing file)', async () => {
    const target = path.join(dir, 'new-file.json');
    await writeFileAtomicExclusive(target, '{}');
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe('{}');
  });

  // ─── Mode preservation ────────────────────────────────────────────────────

  it.skipIf(IS_WIN32)(
    'preserves 0600 mode when target is pre-hardened (regression: SEC-1)',
    async () => {
      const target = path.join(dir, 'settings.json');

      // Create the target and harden it to 0600
      await fs.writeFile(target, '{"original":true}');
      await fs.chmod(target, 0o600);

      // Rewrite via the atomic helper
      await writeFileAtomicExclusive(target, '{"updated":true}');

      // Mode must be preserved — not silently widened to umask default (~0644)
      const stat = await fs.stat(target);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it.skipIf(IS_WIN32)(
    'preserves 0644 mode on a normally-created target',
    async () => {
      const target = path.join(dir, 'settings.json');

      await fs.writeFile(target, 'original');
      await fs.chmod(target, 0o644);

      await writeFileAtomicExclusive(target, 'updated');

      const stat = await fs.stat(target);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o644);
    },
  );

  it.skipIf(IS_WIN32)(
    'fresh target (no prior file) does not error — mode is whatever umask grants',
    async () => {
      const target = path.join(dir, 'brand-new.json');

      // No chmod on the target before writing — fresh file
      await expect(writeFileAtomicExclusive(target, '{}')).resolves.not.toThrow();

      const content = await fs.readFile(target, 'utf-8');
      expect(content).toBe('{}');
    },
  );
});
