/**
 * D-CLI-NO-SYMLINK — the queue drains delete nothing through a symbolic link.
 *
 * `devflow curation --disable`, `devflow memory --disable` and `devflow init
 * --no-curation|--no-memory` delete a project's queue files. A repository can commit
 * `.devflow`, `.devflow/curation` or `.devflow/memory` as a link to a folder
 * elsewhere, and an unlink through it would delete same-named files wherever it
 * points. A refused drain deletes nothing and names the link.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { drainCurationQueue, drainDisabledCurationQueue } from '../../src/core/curation-queue-cleanup.js';
import { drainMemoryQueue } from '../../src/cli/commands/memory.js';

const KEEP = 'a file outside the project, which no drain may delete\n';

let tmp: string;
let root: string;
let outside: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-queue-drain-'));
  root = path.join(tmp, 'repo');
  outside = path.join(tmp, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  vi.stubEnv('HOME', path.join(tmp, 'home'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seed(dir: string, files: readonly string[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const file of files) await fs.writeFile(path.join(dir, file), KEEP);
}

async function present(dir: string, files: readonly string[]): Promise<boolean[]> {
  return Promise.all(files.map(file => fs.lstat(path.join(dir, file)).then(() => true, () => false)));
}

const QUEUES = [
  {
    name: 'drainCurationQueue',
    folder: 'curation',
    files: ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'],
    drain: drainCurationQueue,
  },
  {
    name: 'drainMemoryQueue',
    folder: 'memory',
    files: ['.pending-turns.jsonl', '.pending-turns.processing'],
    drain: drainMemoryQueue,
  },
] as const;

for (const { name, folder, files, drain } of QUEUES) {
  describe(`${name} (D-CLI-NO-SYMLINK)`, () => {
    const queueDir = (): string => path.join(root, '.devflow', folder);
    const none = files.map(() => false);
    const all = files.map(() => true);

    it('drains a real queue folder', async () => {
      await seed(queueDir(), files);

      const result = await drain(root);

      expect(await present(queueDir(), files)).toEqual(none);
      expect(result).toEqual({ drained: true });
    });

    it('a queue that is already empty is drained', async () => {
      expect(await drain(root)).toEqual({ drained: true });
    });

    it('a linked .devflow: deletes nothing where the link points, and names the link', async () => {
      await seed(path.join(outside, folder), files);
      await fs.symlink(outside, path.join(root, '.devflow'));

      const result = await drain(root);

      expect(await present(path.join(outside, folder), files), 'nothing is deleted through the link').toEqual(all);
      expect(result).toEqual({ drained: false, linkedFolder: path.join(root, '.devflow') });
    });

    it(`a linked .devflow/${folder}: deletes nothing where the link points, and names the link`, async () => {
      await seed(outside, files);
      await fs.mkdir(path.join(root, '.devflow'));
      await fs.symlink(outside, queueDir());

      const result = await drain(root);

      expect(await present(outside, files), 'nothing is deleted through the link').toEqual(all);
      expect(result).toEqual({ drained: false, linkedFolder: queueDir() });
    });

    it('a queue file that is itself a link is removed as a link: the file it names is kept', async () => {
      await fs.mkdir(queueDir(), { recursive: true });
      await fs.writeFile(path.join(outside, 'target'), KEEP);
      await fs.symlink(path.join(outside, 'target'), path.join(queueDir(), files[0]));

      expect(await drain(root)).toEqual({ drained: true });

      expect(await fs.readFile(path.join(outside, 'target'), 'utf-8')).toBe(KEEP);
      expect(await present(queueDir(), files)).toEqual(none);
    });
  });
}

describe('drainCurationQueue drains each ledger folder that exists, the old name and the new (#529)', () => {
  const FILES = ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'] as const;
  const newDir = (): string => path.join(root, '.devflow', 'curation');
  const oldDir = (): string => path.join(root, '.devflow', 'learning');

  it('drains the queue of an old folder that a busy or refused move left in place', async () => {
    await seed(oldDir(), FILES);

    expect(await drainCurationQueue(root)).toEqual({ drained: true });

    expect(await present(oldDir(), FILES)).toEqual([false, false, false]);
  });

  it('drains both folders when both exist', async () => {
    await seed(oldDir(), FILES);
    await seed(newDir(), FILES);

    expect(await drainCurationQueue(root)).toEqual({ drained: true });

    expect(await present(oldDir(), FILES)).toEqual([false, false, false]);
    expect(await present(newDir(), FILES)).toEqual([false, false, false]);
  });

  it('deletes only queue files: the ledger and the tuning file in the old folder stay', async () => {
    await seed(oldDir(), [...FILES, 'decisions-ledger.jsonl', 'learning.json']);

    await drainCurationQueue(root);

    expect(await present(oldDir(), ['decisions-ledger.jsonl', 'learning.json'])).toEqual([true, true]);
  });

  it('a linked old folder: deletes nothing in either folder, and names the link', async () => {
    await seed(outside, FILES);
    await seed(newDir(), FILES);
    await fs.symlink(outside, oldDir());

    const result = await drainCurationQueue(root);

    expect(result).toEqual({ drained: false, linkedFolder: oldDir() });
    expect(await present(outside, FILES), 'nothing is deleted through the link').toEqual([true, true, true]);
    expect(await present(newDir(), FILES), 'a refused drain deletes nothing').toEqual([true, true, true]);
  });

  it('a linked .devflow with an old folder behind it: deletes nothing and names .devflow', async () => {
    await seed(path.join(outside, 'learning'), FILES);
    await fs.symlink(outside, path.join(root, '.devflow'));

    expect(await drainCurationQueue(root)).toEqual({ drained: false, linkedFolder: path.join(root, '.devflow') });
    expect(await present(path.join(outside, 'learning'), FILES)).toEqual([true, true, true]);
  });
});

describe('drainDisabledCurationQueue also drains the pending rows of the backups a move left (#529)', () => {
  const STAMP = '20261017T020304Z';
  const FILES = ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'] as const;
  const PENDING = [
    '.pending-turns.jsonl',
    '.pending-turns.processing',
    `.pending-turns.jsonl.merging-${STAMP}-00000001`,
    `.pending-turns.processing.merging-${STAMP}-00000002`,
    `.pending-turns.jsonl.overflow-${STAMP}-00000003`,
  ] as const;
  const STAYING = [
    `.pending-turns.jsonl.swept-${STAMP}-00000004`,
    '.pending-turns.owner',
    'decisions-ledger.jsonl',
    'learning.json',
  ] as const;
  const newDir = (): string => path.join(root, '.devflow', 'curation');
  const backup = (n = 1): string => path.join(root, '.devflow', `learning.backup-${STAMP}-0000000${n}`);

  it('removes the queue, claim, private and overflow files of every backup, and keeps its ledger files', async () => {
    await seed(backup(1), [...PENDING, ...STAYING]);
    await seed(backup(2), [PENDING[0], PENDING[4]]);

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: true });

    expect(await present(backup(1), PENDING)).toEqual([false, false, false, false, false]);
    expect(await present(backup(1), STAYING), 'a swept file, the owner file and the ledger files stay').toEqual([true, true, true, true]);
    expect(await present(backup(2), [PENDING[0], PENDING[4]])).toEqual([false, false]);
  });

  it('drains the live and the old folder in the same run', async () => {
    await seed(newDir(), FILES);
    await seed(path.join(root, '.devflow', 'learning'), FILES);
    await seed(backup(), PENDING);

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: true });

    expect(await present(newDir(), FILES)).toEqual([false, false, false]);
    expect(await present(path.join(root, '.devflow', 'learning'), FILES)).toEqual([false, false, false]);
    expect(await present(backup(), PENDING)).toEqual([false, false, false, false, false]);
  });

  it('drains a project that has no backup, as drainCurationQueue does', async () => {
    await seed(newDir(), FILES);
    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: true });
    expect(await present(newDir(), FILES)).toEqual([false, false, false]);
  });

  it('drainCurationQueue alone (devflow curation --clear) leaves the backups as they are', async () => {
    await seed(backup(), PENDING);
    await seed(newDir(), FILES);

    expect(await drainCurationQueue(root)).toEqual({ drained: true });

    expect(await present(backup(), PENDING)).toEqual([true, true, true, true, true]);
  });

  it('a queue file in a backup that is a link: deletes nothing, in the backups or the live folder, and names the link', async () => {
    await seed(newDir(), FILES);
    await seed(backup(1), PENDING.slice(1));
    await seed(backup(2), ['decisions-ledger.jsonl']);
    await seed(outside, ['queue']);
    await fs.symlink(path.join(outside, 'queue'), path.join(backup(2), '.pending-turns.jsonl'));

    const result = await drainDisabledCurationQueue(root);

    expect(result).toEqual({ drained: false, linkedFolder: path.join(backup(2), '.pending-turns.jsonl') });
    expect(await present(backup(1), PENDING.slice(1)), 'no backup file is deleted').toEqual([true, true, true, true]);
    expect(await present(newDir(), FILES), 'a refused drain deletes nothing in the live folder').toEqual([true, true, true]);
    expect(await present(outside, ['queue']), 'nothing is deleted through the link').toEqual([true]);
  });

  it('a backup folder that is a link: deletes nothing and names the link', async () => {
    await seed(newDir(), FILES);
    await seed(outside, PENDING);
    await fs.symlink(outside, backup());

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: false, linkedFolder: backup() });
    expect(await present(outside, PENDING), 'nothing is deleted where the link points').toEqual([true, true, true, true, true]);
    expect(await present(newDir(), FILES)).toEqual([true, true, true]);
  });

  it('a linked live folder: deletes nothing in the backups either, and names the link', async () => {
    await seed(outside, FILES);
    await seed(backup(), PENDING);
    await fs.symlink(outside, newDir());

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: false, linkedFolder: newDir() });
    expect(await present(backup(), PENDING)).toEqual([true, true, true, true, true]);
    expect(await present(outside, FILES)).toEqual([true, true, true]);
  });

  it('a linked .devflow: deletes nothing and names .devflow', async () => {
    await seed(path.join(outside, `learning.backup-${STAMP}-00000001`), PENDING);
    await fs.symlink(outside, path.join(root, '.devflow'));

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: false, linkedFolder: path.join(root, '.devflow') });
    expect(await present(path.join(outside, `learning.backup-${STAMP}-00000001`), PENDING)).toEqual([true, true, true, true, true]);
  });

  it('a root the backups cannot be listed for is an error the command reports, not a silent skip', async () => {
    await expect(drainDisabledCurationQueue('relative/path')).rejects.toThrow(/absolute/);
  });
});
