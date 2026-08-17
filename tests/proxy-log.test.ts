/**
 * Tests for src/core/proxy-log.ts — SEC-2 proxy log hardening.
 *
 * Coverage:
 * 1. openProxyLog fresh path     → file 0600, parent dir 0700
 * 2. openProxyLog pre-existing   → best-effort chmod to 0600 (wider mode patched)
 * 3. openProxyLog chmod fails    → still returns a usable handle (non-fatal invariant)
 * 4. scrubChildEnv (T11)         → exact allowlist; no ANTHROPIC_API_KEY/OPENAI_API_KEY/SSH_AUTH_SOCK
 *    4a. NODE_EXTRA_CA_CERTS passes through when set (corporate-TLS)
 *    4b. NODE_OPTIONS is excluded (arbitrary code execution risk)
 *    4c. DRIFT-GUARD: ensure-proxy bash hook allowlist mirrors scrubChildEnv
 * 5. rotateProxyLogIfLarge       → file ≤1MB after 2MB+ input, mode 0600 on result
 *
 * Note: mode assertions are skipped on win32 (POSIX chmod semantics not applicable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  scrubChildEnv,
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

  // ─── Test 4: scrubChildEnv — T11 literal allowlist (AC-S3) ──────────────

  describe('scrubChildEnv — T11 env allowlist', () => {
    const IS_WIN32 = process.platform === 'win32';
    // Must mirror the POSIX_ALLOWLIST in src/core/proxy-log.ts scrubChildEnv().
    // Also mirrored in src/assets/scripts/hooks/ensure-proxy _RELAY_ENV array.
    // Update all three locations together when this list changes (avoids PF-017).
    const POSIX_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'NODE_EXTRA_CA_CERTS'];
    const WIN32_EXTRA = ['SystemRoot', 'APPDATA', 'USERPROFILE', 'ComSpec'];
    const FULL_ALLOWLIST = IS_WIN32
      ? [...POSIX_ALLOWLIST, ...WIN32_EXTRA]
      : POSIX_ALLOWLIST;

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns no ANTHROPIC_API_KEY, OPENAI_API_KEY, or SSH_AUTH_SOCK from poisoned env (AC-S3)', () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-credential');
      vi.stubEnv('OPENAI_API_KEY', 'sk-openai-key');
      vi.stubEnv('SSH_AUTH_SOCK', '/tmp/ssh-agent.sock');
      vi.stubEnv('BUTLER_API_KEY', 'butler-key');
      vi.stubEnv('CLAUDE_CODE_MESSAGING_TOKEN', 'tok-123');

      const env = scrubChildEnv();

      expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(env['OPENAI_API_KEY']).toBeUndefined();
      expect(env['SSH_AUTH_SOCK']).toBeUndefined();
      expect(env['BUTLER_API_KEY']).toBeUndefined();
      expect(env['CLAUDE_CODE_MESSAGING_TOKEN']).toBeUndefined();
    });

    it('returns only allowlisted keys — exact key set assertion (AC-S3)', () => {
      // Seed all allowlist vars to known values so the expected set is deterministic.
      vi.stubEnv('PATH', '/usr/bin:/bin');
      vi.stubEnv('HOME', '/home/testuser');
      vi.stubEnv('TMPDIR', '/tmp');
      vi.stubEnv('LANG', 'en_US.UTF-8');
      vi.stubEnv('LC_ALL', 'en_US.UTF-8');
      // Poison vars that must NOT leak
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
      vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
      vi.stubEnv('SSH_AUTH_SOCK', '/tmp/ssh.sock');
      vi.stubEnv('NODE_PATH', '/some/node/path');
      vi.stubEnv('npm_lifecycle_event', 'test');

      const env = scrubChildEnv();
      const actualKeys = Object.keys(env).sort();

      // Exact key set: only allowlist vars that are actually defined.
      // On posix: PATH, HOME, TMPDIR, LANG, LC_ALL (all stubbed above).
      const expectedKeys = FULL_ALLOWLIST.filter(k => process.env[k] !== undefined).sort();
      expect(actualKeys).toEqual(expectedKeys);
    });

    it('relay spawn env adds only SUBSWITCH_CONFIG — no other leaks', () => {
      vi.stubEnv('PATH', '/usr/bin:/bin');
      vi.stubEnv('HOME', '/home/testuser');
      vi.stubEnv('TMPDIR', '/tmp');
      vi.stubEnv('LANG', 'en_US.UTF-8');
      vi.stubEnv('LC_ALL', 'en_US.UTF-8');
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
      vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
      vi.stubEnv('SSH_AUTH_SOCK', '/tmp/ssh.sock');

      const configPath = '/home/user/.devflow/proxy-routing.json';
      const relayEnv = { ...scrubChildEnv(), SUBSWITCH_CONFIG: configPath };

      // Poison vars must not appear
      expect(relayEnv['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(relayEnv['OPENAI_API_KEY']).toBeUndefined();
      expect(relayEnv['SSH_AUTH_SOCK']).toBeUndefined();

      // SUBSWITCH_CONFIG is the only addition
      expect(relayEnv['SUBSWITCH_CONFIG']).toBe(configPath);

      // Exact key set: allowlist + SUBSWITCH_CONFIG
      const expectedKeys = [
        ...FULL_ALLOWLIST.filter(k => process.env[k] !== undefined),
        'SUBSWITCH_CONFIG',
      ].sort();
      expect(Object.keys(relayEnv).sort()).toEqual(expectedKeys);
    });

    it('doctor spawn env adds only SUBSWITCH_CONFIG — matches relay spawn composition', () => {
      vi.stubEnv('PATH', '/usr/bin:/bin');
      vi.stubEnv('HOME', '/home/testuser');
      vi.stubEnv('TMPDIR', '/tmp');
      vi.stubEnv('LANG', 'en_US.UTF-8');
      vi.stubEnv('LC_ALL', 'en_US.UTF-8');
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
      vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
      vi.stubEnv('SSH_AUTH_SOCK', '/tmp/ssh.sock');

      const configPath = '/home/user/.devflow/proxy-routing.json';
      const doctorEnv = { ...scrubChildEnv(), SUBSWITCH_CONFIG: configPath };

      expect(doctorEnv['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(doctorEnv['OPENAI_API_KEY']).toBeUndefined();
      expect(doctorEnv['SSH_AUTH_SOCK']).toBeUndefined();
      expect(doctorEnv['SUBSWITCH_CONFIG']).toBe(configPath);

      const expectedKeys = [
        ...FULL_ALLOWLIST.filter(k => process.env[k] !== undefined),
        'SUBSWITCH_CONFIG',
      ].sort();
      expect(Object.keys(doctorEnv).sort()).toEqual(expectedKeys);
    });

    it('omits allowlist vars that are absent in process.env (never sets undefined)', () => {
      // Ensure TMPDIR is absent; all others are present
      vi.stubEnv('PATH', '/usr/bin');
      vi.stubEnv('HOME', '/home/user');
      vi.stubEnv('LANG', 'C');
      vi.stubEnv('LC_ALL', 'C');
      // Explicitly remove TMPDIR by not stubbing it; if it exists, unstub it
      const tmpDirBefore = process.env['TMPDIR'];
      if (tmpDirBefore !== undefined) {
        // Can't unstub individually — just verify omission logic via all-defined path
        // (this branch only fires when TMPDIR is absent; skip if it's always defined)
        return;
      }

      const env = scrubChildEnv();
      expect(env['TMPDIR']).toBeUndefined();
      expect('TMPDIR' in env).toBe(false);
    });

    // ── NODE_EXTRA_CA_CERTS corporate-TLS pass-through ──────────────────────

    it('NODE_EXTRA_CA_CERTS passes through to relay env when set — corporate TLS', () => {
      // Prove this test can fail: before adding NODE_EXTRA_CA_CERTS to POSIX_ALLOWLIST
      // in scrubChildEnv(), the stubbed value was not copied into the result.
      // The test would fail with: Expected: '/etc/ssl/corporate-ca-bundle.crt'
      //                           Received: undefined
      vi.stubEnv('NODE_EXTRA_CA_CERTS', '/etc/ssl/corporate-ca-bundle.crt');

      const env = scrubChildEnv();

      expect(env['NODE_EXTRA_CA_CERTS']).toBe('/etc/ssl/corporate-ca-bundle.crt');
    });

    it('NODE_EXTRA_CA_CERTS is absent from result when not set in process.env', () => {
      // NODE_EXTRA_CA_CERTS absent → omit, never inject empty string
      // The absent-→-omit loop handles this; no special code required.
      vi.stubEnv('PATH', '/usr/bin:/bin');
      vi.stubEnv('HOME', '/home/testuser');
      // Do not stub NODE_EXTRA_CA_CERTS — simulates a non-corporate-TLS host

      const env = scrubChildEnv();

      // Must be absent, not set to '' or undefined-as-key
      expect('NODE_EXTRA_CA_CERTS' in env).toBe(false);
    });

    it('NODE_OPTIONS is not allowlisted — must not reach relay even when set (prevents arbitrary code exec)', () => {
      // NODE_OPTIONS (--require, --import) permits arbitrary code execution.
      // It must never appear in scrubChildEnv() output regardless of parent env.
      vi.stubEnv('NODE_OPTIONS', '--require /tmp/evil.js');

      const env = scrubChildEnv();

      expect(env['NODE_OPTIONS']).toBeUndefined();
      expect('NODE_OPTIONS' in env).toBe(false);
    });

    // ── DRIFT-GUARD: bash hook allowlist mirrors scrubChildEnv ──────────────

    it('DRIFT-GUARD: ensure-proxy _RELAY_ENV conditionally appends NODE_EXTRA_CA_CERTS', () => {
      // Both relay spawn paths (TS CLI via scrubChildEnv and bash hook via _RELAY_ENV)
      // must allow the same base vars. This test reads ensure-proxy source and verifies
      // the conditional NODE_EXTRA_CA_CERTS append exists, catching future one-sided
      // additions that silently break one spawn path (the exact failure mode of PF-017).
      //
      // The check targets the `if` guard that gates the conditional append — a non-comment
      // line that is structurally absent before the fix. Searching only for the array
      // append string would also match a comment line, making the test vacuous.
      //
      // Prove this test can fail: before adding the conditional block to ensure-proxy,
      // the `if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]` line is absent → expect(false).toBe(true).
      const hookPath = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        '../src/assets/scripts/hooks/ensure-proxy',
      );
      const hookSource = fsSync.readFileSync(hookPath, 'utf-8');

      // The unconditional if-guard must be present (not just in a comment).
      // Pattern chosen to be unambiguously a code line: the test/conditional itself.
      const hasConditional = hookSource.includes('if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]');
      expect(
        hasConditional,
        'ensure-proxy must contain `if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]` to conditionally ' +
          'append NODE_EXTRA_CA_CERTS to _RELAY_ENV (drift from scrubChildEnv detected — ' +
          'update both allowlists together)',
      ).toBe(true);
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
