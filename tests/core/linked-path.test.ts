/**
 * D-CLI-NO-SYMLINK — firstSymbolicLink names the first of its paths that is itself
 * a symbolic link, seen with lstat rather than followed, so the CLI can refuse a
 * write or delete under a project's .devflow before it starts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { firstSymbolicLink } from '../../src/core/linked-path.js';

let tmp: string;
let root: string;
let outside: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-linked-path-'));
  root = path.join(tmp, 'repo');
  outside = path.join(tmp, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  vi.stubEnv('HOME', path.join(tmp, 'home'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.chmod(root, 0o755).catch(() => undefined);
  await fs.rm(tmp, { recursive: true, force: true });
});

const devflow = (): string => path.join(root, '.devflow');
const learning = (): string => path.join(root, '.devflow', 'learning');

describe('firstSymbolicLink (D-CLI-NO-SYMLINK)', () => {
  it('is null when nothing stands at any path', async () => {
    expect(await firstSymbolicLink([devflow(), learning()])).toBeNull();
  });

  it('is null for real folders and files', async () => {
    await fs.mkdir(learning(), { recursive: true });
    await fs.writeFile(path.join(learning(), 'queue'), '');
    expect(await firstSymbolicLink([devflow(), learning(), path.join(learning(), 'queue')])).toBeNull();
  });

  it('names a linked .devflow, the outermost link, before anything below it', async () => {
    await fs.mkdir(path.join(outside, 'learning'));
    await fs.symlink(outside, devflow());
    expect(await firstSymbolicLink([devflow(), learning()])).toBe(devflow());
  });

  it('names a linked folder below a real .devflow', async () => {
    await fs.mkdir(devflow());
    await fs.symlink(outside, learning());
    expect(await firstSymbolicLink([devflow(), learning()])).toBe(learning());
  });

  it('names a dangling link too: it is seen, never followed', async () => {
    await fs.symlink(path.join(outside, 'missing'), devflow());
    expect(await firstSymbolicLink([devflow()])).toBe(devflow());
  });

  it('is null when a file stands where a folder was expected on the way', async () => {
    await fs.writeFile(devflow(), 'a file, not a folder\n');
    expect(await firstSymbolicLink([devflow(), learning()])).toBeNull();
  });

  // Root ignores permission bits, so there the check can always look: skipped, never
  // silently green.
  it.skipIf(process.getuid?.() === 0)('throws when a path cannot be checked, so the caller acts on nothing', async () => {
    await fs.mkdir(learning(), { recursive: true });
    await fs.chmod(root, 0o000);
    try {
      await expect(firstSymbolicLink([learning()])).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      await fs.chmod(root, 0o755);
    }
  });
});
