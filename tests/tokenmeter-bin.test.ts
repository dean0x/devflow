import { lstatSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTokenmeterState, resolvePackageBin } from '../src/core/tokenmeter-bin.js';
import { readTokenmeterBin } from '../src/hud/tokenmeter-bin.js';

vi.mock('node:module', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:module')>();
  return { ...original, createRequire: vi.fn(original.createRequire) };
});

const PACKAGE_NAME = '@dean0x/tokenmeter';
const BIN_NAME = 'tokenmeter';
const BIN_ENTRY = 'bin/tokenmeter.js';
let dir: string;
let packageDir: string;
let binPath: string;
let statePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'devflow-tokenmeter-bin-'));
  packageDir = join(dir, 'node_modules', PACKAGE_NAME);
  binPath = join(packageDir, BIN_ENTRY);
  statePath = join(dir, 'tokenmeter.json');
  await fs.mkdir(join(packageDir, 'bin'), { recursive: true, mode: 0o755 });
  await fs.mkdir(join(packageDir, 'dist'), { mode: 0o755 });
  await fs.writeFile(binPath, '', { mode: 0o644 });
});

afterEach(async () => {
  vi.mocked(createRequire).mockReset();
  await fs.rm(dir, { recursive: true, force: true });
});

async function setPackageBin(bin: unknown, from = dir, pkg = packageDir): Promise<void> {
  await fs.writeFile(join(pkg, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, bin }));
  const fixtureRequire = createRequire(join(from, 'package.json'));
  vi.mocked(createRequire).mockReturnValueOnce(fixtureRequire);
}

async function setState(path = binPath): Promise<void> {
  await fs.writeFile(statePath, JSON.stringify({ version: 1, binPath: path }), { mode: 0o600 });
}

describe('resolvePackageBin', () => {
  it('resolves the named bin in the pinned package', async () => {
    const manifest = createRequire(import.meta.url).resolve(`${PACKAGE_NAME}/package.json`);
    const expected = await fs.realpath(join(manifest, '..', BIN_ENTRY));
    expect(await resolvePackageBin(PACKAGE_NAME, BIN_NAME)).toEqual({
      ok: true,
      value: { binPath: expected, npxWarning: false },
    });
  });

  it('resolves a string bin entry', async () => {
    await setPackageBin(BIN_ENTRY);
    expect(await resolvePackageBin(PACKAGE_NAME, BIN_NAME)).toEqual({
      ok: true,
      value: { binPath, npxWarning: false },
    });
  });

  it.each([{}, { other: BIN_ENTRY }, { tokenmeter: 5 }, { tokenmeter: '' }])(
    'refuses an absent or invalid named bin entry: %j',
    async (bin) => {
      await setPackageBin(bin);
      expect(await resolvePackageBin(PACKAGE_NAME, BIN_NAME)).toMatchObject({ ok: false });
    },
  );

  it('refuses a relative bin entry that leaves the package folder', async () => {
    const outside = join(dir, 'other.js');
    await fs.writeFile(outside, '');
    await setPackageBin({ tokenmeter: relative(packageDir, outside) });
    expect(await resolvePackageBin(PACKAGE_NAME, BIN_NAME)).toMatchObject({ ok: false });
  });

  it('refuses a bin entry that links outside the package folder', async () => {
    const outside = join(dir, 'other.js');
    await fs.writeFile(outside, '');
    await fs.symlink(outside, join(packageDir, 'bin', 'link.js'));
    await setPackageBin({ tokenmeter: 'bin/link.js' });
    expect(await resolvePackageBin(PACKAGE_NAME, BIN_NAME)).toMatchObject({ ok: false });
  });
});

describe('installTokenmeterState', () => {
  it('writes version 1 state with mode 0600 and a usable bin path', async () => {
    expect(await installTokenmeterState(dir)).toEqual({ ok: true, value: {} });
    const chosen = readTokenmeterBin(dir);
    const manifest = createRequire(import.meta.url).resolve(`${PACKAGE_NAME}/package.json`);
    const expected = await fs.realpath(join(manifest, '..', BIN_ENTRY));
    expect(chosen).toBe(expected);
    expect(JSON.parse(await fs.readFile(statePath, 'utf8'))).toEqual({ version: 1, binPath: expected });
    expect((await fs.lstat(statePath)).mode & 0o777).toBe(0o600);
  });

  it('replaces old state atomically and sets the new inode to mode 0600', async () => {
    const oldLink = join(dir, 'old-state.json');
    await fs.writeFile(statePath, 'old state');
    await fs.chmod(statePath, 0o644);
    await fs.link(statePath, oldLink);

    expect(await installTokenmeterState(dir)).toEqual({ ok: true, value: {} });
    expect(await fs.readFile(oldLink, 'utf8')).toBe('old state');
    expect((await fs.lstat(statePath)).mode & 0o777).toBe(0o600);
    expect(readTokenmeterBin(dir)).not.toBeNull();
  });

  it('gives one warning result when the bin cannot resolve', async () => {
    await setPackageBin({ other: BIN_ENTRY });
    expect(await installTokenmeterState(dir)).toEqual({
      ok: false,
      error: 'Could not find the Codex usage tool. Reinstall devflow-kit.',
    });
    await expect(fs.lstat(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('gives one warning result when it cannot write state', async () => {
    await fs.mkdir(statePath);
    expect(await installTokenmeterState(dir)).toEqual({
      ok: false,
      error: 'Could not save the Codex usage tool path. Run devflow init again.',
    });
    expect((await fs.readdir(dir)).sort()).toEqual(['node_modules', 'tokenmeter.json']);
  });

  it('warns that a bin path in the npx cache can disappear', async () => {
    const cached = join(dir, '_npx', 'entry');
    const cachedPkg = join(cached, 'node_modules', PACKAGE_NAME);
    await fs.mkdir(cached, { recursive: true });
    await fs.rename(join(dir, 'node_modules'), join(cached, 'node_modules'));
    await setPackageBin({ tokenmeter: BIN_ENTRY }, cached, cachedPkg);

    expect(await installTokenmeterState(dir)).toEqual({
      ok: true,
      value: { warning: 'Codex usage can stop if the npx cache clears. Run devflow init again.' },
    });
    expect(readTokenmeterBin(dir)).toBe(join(cachedPkg, BIN_ENTRY));
  });
});

describe('readTokenmeterBin', () => {
  it('accepts a regular bin file without execute bits', async () => {
    await setState();
    expect(readTokenmeterBin(dir)).toBe(binPath);
  });

  it('accepts root ownership of the file and directories', async () => {
    await setState();
    const lstat = (path: string) => {
      const stat = lstatSync(path);
      return { ...stat, uid: 0, isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory() };
    };
    expect(readTokenmeterBin(dir, { lstat })).toBe(binPath);
  });

  it('returns absence when state is missing', () => {
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it.each(['{', 'null', '{"version":2}', '{"version":1,"binPath":7}', '{"version":1}'])(
    'returns absence for invalid state: %s',
    async (text) => {
      await fs.writeFile(statePath, text);
      expect(readTokenmeterBin(dir)).toBeNull();
    },
  );

  it('rejects state larger than 4 KiB even if it contains valid JSON', async () => {
    const state = JSON.stringify({ version: 1, binPath });
    await fs.writeFile(statePath, state.padEnd(4096, ' '));
    expect(readTokenmeterBin(dir)).toBe(binPath);
    await fs.appendFile(statePath, ' ');
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it('rejects a symlink to otherwise valid state', async () => {
    const linkedState = join(dir, 'linked-state.json');
    await setState();
    await fs.rename(statePath, linkedState);
    await fs.symlink(linkedState, statePath);
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it('rejects a directory instead of a state file', async () => {
    await fs.mkdir(statePath);
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it('rejects a relative bin path', async () => {
    await setState(relative(dir, binPath));
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it('rejects a file under a different package', async () => {
    const otherPackage = `${packageDir}-other`;
    await fs.rename(packageDir, otherPackage);
    await setState(join(otherPackage, BIN_ENTRY));
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it('rejects a path that traverses out of the package', async () => {
    const outside = join(dir, 'node_modules', '@dean0x', 'other.js');
    await fs.writeFile(outside, '');
    await setState(`${packageDir}/../other.js`);
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it('rejects a nested bin if an intermediate folder is world-writable', async () => {
    const intermediate = join(packageDir, 'bin', 'internal');
    const nestedBin = join(intermediate, 'tokenmeter.js');
    await fs.mkdir(intermediate, { mode: 0o755 });
    await fs.writeFile(nestedBin, '');
    await setState(nestedBin);
    expect(readTokenmeterBin(dir)).toBe(nestedBin);

    await fs.chmod(intermediate, 0o757);
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  const targets = [BIN_ENTRY, '.', 'bin', 'dist', '..', '../..'];
  it.each(targets)('rejects a symlink instead of %s', async (target) => {
    await setState();
    const path = join(packageDir, target);
    const moved = `${path}-moved`;
    await fs.rename(path, moved);
    await fs.symlink(moved, path);
    expect(readTokenmeterBin(dir)).toBeNull();
  });

  it.each(targets)('rejects another user as the owner of %s', async (target) => {
    await setState();
    const foreignUid = process.getuid?.() === 1 ? 2 : 1;
    const lstat = (path: string) => {
      const stat = lstatSync(path);
      const uid = path === join(packageDir, target) ? foreignUid : stat.uid;
      return { ...stat, uid, isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory() };
    };
    expect(readTokenmeterBin(dir, { lstat })).toBeNull();
  });

  it.each(targets.flatMap(target => [[target, 0o020], [target, 0o002]] as const))(
    'rejects %s with write bit %i',
    async (target, bit) => {
      await setState();
      const path = join(packageDir, target);
      const { mode } = await fs.lstat(path);
      await fs.chmod(path, (mode & 0o777) | bit);
      expect(readTokenmeterBin(dir)).toBeNull();
    },
  );
});
