/**
 * Tests for src/core/proxy-log.ts — SEC-2 proxy log hardening.
 *
 * TDD RED-GREEN: all five tests were written before the implementation existed
 * and confirmed RED against the pre-SEC-2 code (fs.open(logFile, 'a') with no
 * mode argument, process.env spread with no ANTHROPIC_API_KEY removal).
 *
 * Coverage:
 * 1. openProxyLog fresh path     → file 0600, parent dir 0700
 * 2. openProxyLog pre-existing   → best-effort chmod to 0600 (wider mode patched)
 * 3. openProxyLog chmod fails    → still returns a usable handle (non-fatal invariant)
 * 4. buildChildEnv               → ANTHROPIC_API_KEY absent; SUBSWITCH_CONFIG + PATH present
 * 5. rotateProxyLogIfLarge       → file ≤1MB after 2MB+ input, mode 0600 on result
 *
 * Note: mode assertions are skipped on win32 (POSIX chmod semantics not applicable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildChildEnv,
  openProxyLog,
  rotateProxyLogIfLarge,
  PROXY_LOG_MAX_BYTES,
  PROXY_LOG_TAIL_BYTES,
} from '../src/core/proxy-log.js';

const IS_WIN32 = process.platform === 'win32';

describe('proxy-log', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-proxy-log-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── Test 1: openProxyLog fresh path ──────────────────────────────────────

  describe('openProxyLog — fresh path', () => {
    it.skipIf(IS_WIN32)(
      'creates parent directory at mode 0700',
      async () => {
        const logPath = path.join(dir, 'logs', 'proxy.log');

        const handle = await openProxyLog(logPath);
        await handle.close();

        const stat = await fs.stat(path.join(dir, 'logs'));
        expect(stat.mode & 0o777).toBe(0o700);
      },
    );

    it.skipIf(IS_WIN32)(
      'creates log file at mode 0600 when it does not exist',
      async () => {
        const logPath = path.join(dir, 'logs', 'proxy.log');

        const handle = await openProxyLog(logPath);
        await handle.close();

        const stat = await fs.stat(logPath);
        expect(stat.mode & 0o777).toBe(0o600);
      },
    );

    it('returns a writable FileHandle (fresh path)', async () => {
      const logPath = path.join(dir, 'logs2', 'proxy.log');

      const handle = await openProxyLog(logPath);
      try {
        // Should be able to write to the opened handle
        await handle.write('hello SEC-2');
      } finally {
        await handle.close();
      }

      const content = await fs.readFile(logPath, 'utf-8');
      expect(content).toBe('hello SEC-2');
    });
  });

  // ─── Test 2: openProxyLog pre-existing 0644 file ──────────────────────────

  describe('openProxyLog — pre-existing wider-mode file', () => {
    it.skipIf(IS_WIN32)(
      'chmod-s a pre-existing 0644 file to 0600',
      async () => {
        const logDir = path.join(dir, 'logs3');
        const logPath = path.join(logDir, 'proxy.log');

        // Pre-create the file with a wider mode
        await fs.mkdir(logDir, { recursive: true });
        await fs.writeFile(logPath, 'existing content');
        await fs.chmod(logPath, 0o644);

        const handle = await openProxyLog(logPath);
        await handle.close();

        const stat = await fs.stat(logPath);
        expect(stat.mode & 0o777).toBe(0o600);
      },
    );

    it('appends to a pre-existing file without destroying its content', async () => {
      const logDir = path.join(dir, 'logs4');
      const logPath = path.join(logDir, 'proxy.log');

      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(logPath, 'existing line\n');

      const handle = await openProxyLog(logPath);
      try {
        await handle.write('appended line\n');
      } finally {
        await handle.close();
      }

      const content = await fs.readFile(logPath, 'utf-8');
      expect(content).toBe('existing line\nappended line\n');
    });
  });

  // ─── Test 3: openProxyLog when chmod fails (non-fatal invariant) ───────────

  describe('openProxyLog — chmod failure is non-fatal', () => {
    it('still returns a usable handle when fs.chmod rejects (EPERM simulation)', async () => {
      const logPath = path.join(dir, 'logs5', 'proxy.log');

      // Simulate chmod failure (e.g. EPERM on a network mount or immutable fs)
      vi.spyOn(fs, 'chmod').mockRejectedValueOnce(
        Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }),
      );

      let handle: Awaited<ReturnType<typeof openProxyLog>> | undefined;
      try {
        // Must not throw despite chmod failure
        handle = await openProxyLog(logPath);
        expect(handle).toBeDefined();

        // Handle must be usable — write and verify content
        await handle.write('non-fatal chmod test');
      } finally {
        if (handle) await handle.close();
      }

      const content = await fs.readFile(logPath, 'utf-8');
      expect(content).toBe('non-fatal chmod test');
    });
  });

  // ─── Test 4: buildChildEnv strips ANTHROPIC_API_KEY ──────────────────────

  describe('buildChildEnv', () => {
    it('removes ANTHROPIC_API_KEY when parent env has it', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        process.env.ANTHROPIC_API_KEY = 'sk-test-credential';
        const env = buildChildEnv('/path/to/proxy-routing.json');
        expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
      } finally {
        if (original === undefined) {
          delete process.env.ANTHROPIC_API_KEY;
        } else {
          process.env.ANTHROPIC_API_KEY = original;
        }
      }
    });

    it('preserves SUBSWITCH_CONFIG set to the given configPath', () => {
      const configPath = '/home/user/.devflow/proxy-routing.json';
      const env = buildChildEnv(configPath);
      expect(env['SUBSWITCH_CONFIG']).toBe(configPath);
    });

    it('preserves PATH from the parent env', () => {
      const env = buildChildEnv('/some/config.json');
      // PATH must be present — the relay needs to resolve node itself in some contexts.
      // (process.env.PATH may be undefined on headless test runners; we accept that.)
      if (process.env.PATH !== undefined) {
        expect(env['PATH']).toBe(process.env.PATH);
      }
    });

    it('does not throw when ANTHROPIC_API_KEY is not in parent env', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        expect(() => buildChildEnv('/config.json')).not.toThrow();
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original;
        }
      }
    });
  });

  // ─── Test 5: rotateProxyLogIfLarge ────────────────────────────────────────

  describe('rotateProxyLogIfLarge', () => {
    it.skipIf(IS_WIN32)(
      'file > 2MB: rotates to ≤1MB tail and mode is 0600 after rotation',
      async () => {
        const logDir = path.join(dir, 'logs6');
        const logPath = path.join(logDir, 'proxy.log');
        await fs.mkdir(logDir, { recursive: true });

        // Write a >2MB file using a repeated pattern
        const chunkSize = 1024;
        const chunk = Buffer.alloc(chunkSize, 'A');
        const totalBytes = PROXY_LOG_MAX_BYTES + chunkSize; // just over 2MB
        const handle = await fs.open(logPath, 'w', 0o600);
        try {
          let written = 0;
          while (written < totalBytes) {
            const toWrite = Math.min(chunkSize, totalBytes - written);
            await handle.write(chunk, 0, toWrite);
            written += toWrite;
          }
        } finally {
          await handle.close();
        }

        const beforeStat = await fs.stat(logPath);
        expect(beforeStat.size).toBeGreaterThan(PROXY_LOG_MAX_BYTES);

        await rotateProxyLogIfLarge(logPath);

        const afterStat = await fs.stat(logPath);
        // File must be ≤1MB after rotation
        expect(afterStat.size).toBeLessThanOrEqual(PROXY_LOG_TAIL_BYTES);

        // Mode must be 0600 — tmp was written at 0600, rename carries that inode's mode
        expect(afterStat.mode & 0o777).toBe(0o600);
      },
    );

    it('no-op when file does not exist', async () => {
      const logPath = path.join(dir, 'logs7', 'proxy.log');
      // Must not throw
      await expect(rotateProxyLogIfLarge(logPath)).resolves.not.toThrow();
    });

    it('no-op when file is below the threshold', async () => {
      const logDir = path.join(dir, 'logs8');
      const logPath = path.join(logDir, 'proxy.log');
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(logPath, 'small content');

      const beforeStat = await fs.stat(logPath);
      await rotateProxyLogIfLarge(logPath);
      const afterStat = await fs.stat(logPath);

      // Content and size unchanged
      expect(afterStat.size).toBe(beforeStat.size);
    });

    it.skipIf(IS_WIN32)(
      'rotation result contains the tail of the original content',
      async () => {
        const logDir = path.join(dir, 'logs9');
        const logPath = path.join(logDir, 'proxy.log');
        await fs.mkdir(logDir, { recursive: true });

        // Write known content: fill over 2MB then append a known tail marker
        const padding = Buffer.alloc(PROXY_LOG_MAX_BYTES + 1024, 'X');
        const tailMarker = 'TAIL_MARKER_END\n';
        const handle = await fs.open(logPath, 'w', 0o600);
        try {
          await handle.write(padding);
          await handle.write(tailMarker);
        } finally {
          await handle.close();
        }

        await rotateProxyLogIfLarge(logPath);

        const result = await fs.readFile(logPath, 'utf-8');
        // The known tail marker must appear in the rotated result
        expect(result).toContain(tailMarker);
      },
    );
  });
});
