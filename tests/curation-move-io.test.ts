// tests/curation-move-io.test.ts
//
// The real I/O behind the global tuning file's rename (src/cli/commands/curation-move-io.ts).
// The rename never replaces a file: it links the new name, then removes the old one.
// A file system that cannot link (EPERM, ENOTSUP) falls back to a rename after an
// absence check, the same rule the store's claim code uses. Any other link error,
// EXDEV included, fails the rename: a rename would fail the same way. Tests work in a
// temp directory under the per-file temp HOME and inject link errors by spy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NO_HARD_LINK_CODES, realGlobalTuningMoveIO } from '../src/cli/commands/curation-move-io.js';
import { CURATION_STORE } from './decisions/curation-fixtures.js';

let dir: string;
let from: string;
let to: string;

/** A link error as fs.link reports it: an Error with a code. */
function linkError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: link failed`), { code });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-move-io-'));
  from = path.join(dir, 'learning.json');
  to = path.join(dir, 'curation.json');
  await fs.writeFile(from, '{"model":"opus"}\n');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('realGlobalTuningMoveIO renameIfAbsent', () => {
  it('links the new name, removes the old one and answers renamed', async () => {
    const result = await realGlobalTuningMoveIO().renameIfAbsent(from, to);
    expect(result).toEqual({ state: 'renamed' });
    expect(await fs.readFile(to, 'utf-8')).toBe('{"model":"opus"}\n');
    await expect(fs.lstat(from)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('answers exists and changes nothing when the new name is taken', async () => {
    await fs.writeFile(to, '{"model":"sonnet"}\n');
    const result = await realGlobalTuningMoveIO().renameIfAbsent(from, to);
    expect(result).toEqual({ state: 'exists' });
    expect(await fs.readFile(to, 'utf-8')).toBe('{"model":"sonnet"}\n');
    expect(await fs.readFile(from, 'utf-8')).toBe('{"model":"opus"}\n');
  });

  it('a link error of EXDEV answers failed, attempts no rename and leaves both names as they were', async () => {
    vi.spyOn(fs, 'link').mockRejectedValueOnce(linkError('EXDEV'));
    const rename = vi.spyOn(fs, 'rename');

    const result = await realGlobalTuningMoveIO().renameIfAbsent(from, to);

    expect(result.state).toBe('failed');
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(from, 'utf-8')).toBe('{"model":"opus"}\n');
    await expect(fs.lstat(to)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['EPERM', 'ENOTSUP'])('a link error of %s renames when the new name is absent', async (code) => {
    vi.spyOn(fs, 'link').mockRejectedValueOnce(linkError(code));

    const result = await realGlobalTuningMoveIO().renameIfAbsent(from, to);

    expect(result).toEqual({ state: 'renamed' });
    expect(await fs.readFile(to, 'utf-8')).toBe('{"model":"opus"}\n');
    await expect(fs.lstat(from)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['EPERM', 'ENOTSUP'])('a link error of %s answers exists, with no rename, when the new name is taken', async (code) => {
    await fs.writeFile(to, '{"model":"sonnet"}\n');
    vi.spyOn(fs, 'link').mockRejectedValueOnce(linkError(code));
    const rename = vi.spyOn(fs, 'rename');

    const result = await realGlobalTuningMoveIO().renameIfAbsent(from, to);

    expect(result).toEqual({ state: 'exists' });
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(to, 'utf-8')).toBe('{"model":"sonnet"}\n');
    expect(await fs.readFile(from, 'utf-8')).toBe('{"model":"opus"}\n');
  });
});

describe('the no-hard-link fallback rule', () => {
  it('is the same list in the CLI and in the store', () => {
    const store = createRequire(import.meta.url)(CURATION_STORE) as { NO_HARD_LINK_CODES: readonly string[] };
    expect([...NO_HARD_LINK_CODES].sort()).toEqual([...store.NO_HARD_LINK_CODES].sort());
  });
});
