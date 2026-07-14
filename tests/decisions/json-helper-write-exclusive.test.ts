// tests/learning/json-helper-write-exclusive.test.ts
//
// TOCTOU hardening tests for json-helper.cjs writeExclusive (via writeFileAtomic).
//
// writeExclusive uses O_EXCL (wx flag) so the kernel rejects the open if a file or
// symlink already exists at the .tmp path. On EEXIST it unlinks and retries once.
// These tests mirror the pattern in legacy-decisions-purge.test.ts:218-244.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// @ts-expect-error — CJS module without type declarations
const helpers = require('../../scripts/hooks/json-helper.cjs');

describe('writeFileAtomic (writeExclusive TOCTOU hardening)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-exclusive-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes content to the target file successfully', () => {
    const targetFile = path.join(tmpDir, 'output.json');
    helpers.writeFileAtomic(targetFile, '{"ok":true}\n');

    const content = fs.readFileSync(targetFile, 'utf-8');
    expect(content).toBe('{"ok":true}\n');
  });

  it('overwrites an existing file correctly', () => {
    const targetFile = path.join(tmpDir, 'output.json');
    fs.writeFileSync(targetFile, 'old-content', 'utf-8');
    helpers.writeFileAtomic(targetFile, 'new-content');

    expect(fs.readFileSync(targetFile, 'utf-8')).toBe('new-content');
  });

  it('does not follow a symlink placed at the .tmp path (TOCTOU hardening)', () => {
    // Arrange: place a symlink at the .tmp location pointing to a sentinel file.
    // An attacker who can predict the .tmp path may pre-place a symlink to redirect
    // the write to a sensitive file. writeExclusive's O_EXCL flag rejects such
    // pre-existing paths, then unlinks and retries — the sentinel must remain intact.
    const targetFile = path.join(tmpDir, 'target.json');
    const tmpPath = targetFile + '.tmp';

    const sentinelPath = path.join(tmpDir, 'attacker-controlled.txt');
    fs.writeFileSync(sentinelPath, 'original-content', 'utf-8');
    fs.symlinkSync(sentinelPath, tmpPath);

    // Act: writeFileAtomic should unlink the stale symlink and complete successfully.
    helpers.writeFileAtomic(targetFile, '{"written":true}\n');

    // Assert 1: sentinel was NOT overwritten — the symlink was not followed.
    expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('original-content');

    // Assert 2: target file was written correctly.
    expect(fs.readFileSync(targetFile, 'utf-8')).toBe('{"written":true}\n');

    // Assert 3: the .tmp file is cleaned up (renamed to target by renameSync).
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('handles stale .tmp file left from a previous crashed write', () => {
    // A stale .tmp (not a symlink) from a previous crash should be cleaned and retried.
    const targetFile = path.join(tmpDir, 'target.json');
    const tmpPath = targetFile + '.tmp';

    fs.writeFileSync(tmpPath, 'stale-tmp-content', 'utf-8');

    helpers.writeFileAtomic(targetFile, 'fresh-content');

    expect(fs.readFileSync(targetFile, 'utf-8')).toBe('fresh-content');
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});
