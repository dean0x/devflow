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
import { drainCurationQueue, drainDisabledCurationQueue, formatCurationNotDrained } from '../../src/core/curation-queue-cleanup.js';
import { MOVE_SKIP_NOTICE } from '../../src/core/curation-move-skip.js';
import { loadCurationMove, type CurationMoveLoad } from '../../src/core/curation-move.js';
import { AREA_PAUSE_NOTICE } from '../../src/core/area-pause-notice.js';
import { drainMemoryQueue, formatMemoryNotDrained } from '../../src/cli/commands/memory.js';
import { initGitRepo, pathWithFailingGit, snapshotTree, trackInGit } from '../decisions/curation-fixtures.js';

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

  describe('a backup list that cannot be made never stops the drain of the live and the old folder', () => {
    const oldDir = (): string => path.join(root, '.devflow', 'learning');
    const seedLive = async (): Promise<void> => {
      await seed(newDir(), FILES);
      await seed(oldDir(), FILES);
    };
    const bothDrained = async (): Promise<void> => {
      expect(await present(newDir(), FILES), 'the live queue is drained').toEqual([false, false, false]);
      expect(await present(oldDir(), FILES), 'the old folder queue is drained').toEqual([false, false, false]);
    };

    it('a move module that cannot be loaded: drains both folders and returns a warning, never a throw', async () => {
      await seedLive();
      await seed(backup(), PENDING);

      const result = await drainDisabledCurationQueue(root, () => ({ ok: false, error: { kind: 'not-found', path: '/pkg/curation-move.cjs' } }));

      await bothDrained();
      expect(result).toEqual({ drained: true, warning: expect.stringMatching(/backup.*not drained.*curation store not found/) });
      expect(await present(backup(), PENDING), 'a backup that could not be listed is left as it is').toEqual([true, true, true, true, true]);
    });

    it('an io-error from the backup list: drains both folders and returns a warning with the reason, never a throw', async () => {
      await seedLive();
      const failing: CurationMoveLoad = {
        ok: true,
        value: {
          ...(loadCurationMove() as Extract<CurationMoveLoad, { ok: true }>).value,
          backupQueueFiles: () => ({ ok: false, error: { kind: 'io-error', message: 'EACCES: permission denied, scandir backup' } }),
        },
      };

      const result = await drainDisabledCurationQueue(root, () => failing);

      await bothDrained();
      expect(result).toEqual({ drained: true, warning: expect.stringContaining('EACCES: permission denied, scandir backup') });
    });

    it.skipIf(process.getuid?.() === 0)('a backup folder that cannot be read: drains both folders and returns a warning', async () => {
      await seedLive();
      await seed(backup(), PENDING);
      await fs.chmod(backup(), 0o000);
      try {
        const result = await drainDisabledCurationQueue(root);

        await bothDrained();
        expect(result.drained).toBe(true);
        expect(result.drained && result.warning).toMatch(/backup.*not drained/);
      } finally {
        await fs.chmod(backup(), 0o755);
      }
    });

    it('a link is still a refusal: nothing is drained, and no warning is returned', async () => {
      await seedLive();
      await seed(outside, PENDING);
      await fs.symlink(outside, backup());

      expect(await drainDisabledCurationQueue(root)).toEqual({ drained: false, linkedFolder: backup() });
      expect(await present(newDir(), FILES)).toEqual([true, true, true]);
    });

    it('a drain that listed every backup returns no warning', async () => {
      await seed(newDir(), FILES);
      expect(await drainDisabledCurationQueue(root)).toEqual({ drained: true });
    });

    it('a root that is not absolute: the tracked-folder check cannot answer, so nothing is deleted and the answer is a skip, not a throw', async () => {
      const result = await drainDisabledCurationQueue('relative/path');
      expect(result).toEqual({ drained: false, skipped: 'unknown' });
    });
  });
});

describe('drainDisabledCurationQueue leaves a project alone when git tracks a data folder or does not answer', () => {
  const STAMP = '20261017T020304Z';
  const FILES = ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'] as const;
  const oldDir = (): string => path.join(root, '.devflow', 'learning');
  const newDir = (): string => path.join(root, '.devflow', 'curation');
  const backupDir = (): string => path.join(root, '.devflow', `learning.backup-${STAMP}-00000001`);
  const devflowTree = (): Map<string, string> => snapshotTree(path.join(root, '.devflow'));

  /** Queue files in the old folder, the new folder and a backup folder. */
  async function seedEveryFolder(): Promise<void> {
    for (const dir of [oldDir(), newDir(), backupDir()]) await seed(dir, FILES);
  }

  const TRACKED_PATHS = [
    ['a queue file of the old folder', '.devflow/learning/.pending-turns.jsonl'],
    ['a ledger file of the old folder', '.devflow/learning/decisions-ledger.jsonl'],
    ['a queue file of the new folder', '.devflow/curation/.pending-turns.jsonl'],
    ['a queue file of a backup folder', `.devflow/learning.backup-${STAMP}-00000001/.pending-turns.jsonl`],
  ] as const;

  it.each(TRACKED_PATHS)('git tracks %s: nothing is deleted in either folder or any backup, and the answer is a tracked skip', async (_name, tracked) => {
    initGitRepo(root);
    await seedEveryFolder();
    await seed(oldDir(), ['decisions-ledger.jsonl']);
    trackInGit(root, tracked);
    const before = devflowTree();

    const result = await drainDisabledCurationQueue(root);

    expect(result).toEqual({ drained: false, skipped: 'tracked' });
    expect(devflowTree()).toEqual(before);
  });

  it('git tracks a file that is only staged: the same skip', async () => {
    initGitRepo(root);
    await seedEveryFolder();
    trackInGit(root, '.devflow/curation/.pending-turns.processing');
    const before = devflowTree();

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: false, skipped: 'tracked' });
    expect(devflowTree()).toEqual(before);
  });

  it('a .git entry stands and git does not answer: nothing is deleted, and the answer is an unknown skip', async () => {
    initGitRepo(root);
    await seedEveryFolder();
    const before = devflowTree();
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: false, skipped: 'unknown' });
    expect(devflowTree()).toEqual(before);
  });

  it('a check that cannot be loaded cannot answer: nothing is deleted, and the answer is an unknown skip', async () => {
    await seedEveryFolder();
    const before = devflowTree();

    const result = await drainDisabledCurationQueue(
      root,
      loadCurationMove,
      () => ({ ok: false, error: { kind: 'not-found', path: '/pkg/tracked-areas.cjs' } }),
    );

    expect(result).toEqual({ drained: false, skipped: 'unknown' });
    expect(devflowTree()).toEqual(before);
  });

  it('a repository that tracks nothing in the data folders drains every folder and backup, and keeps the tracked files elsewhere', async () => {
    initGitRepo(root, { 'README.md': 'content of the repository\n', '.devflow/notes.md': 'a tracked note\n' });
    await seedEveryFolder();

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: true });

    for (const dir of [oldDir(), newDir(), backupDir()]) {
      expect(await present(dir, ['.pending-turns.jsonl', '.pending-turns.processing'])).toEqual([false, false]);
    }
    expect(await present(root, ['README.md', '.devflow/notes.md'])).toEqual([true, true]);
  });

  it('a project with no .git entry drains as usual and makes no git call', async () => {
    await seedEveryFolder();
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    expect(await drainDisabledCurationQueue(root)).toEqual({ drained: true });

    expect(await present(oldDir(), ['.pending-turns.jsonl', '.pending-turns.processing'])).toEqual([false, false]);
    expect(await present(newDir(), ['.pending-turns.jsonl', '.pending-turns.processing'])).toEqual([false, false]);
  });
});

describe('drainCurationQueue (devflow curation --clear) asks the same question as the disable drain', () => {
  const STAMP = '20261017T020304Z';
  const FILES = ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'] as const;
  const oldDir = (): string => path.join(root, '.devflow', 'learning');
  const newDir = (): string => path.join(root, '.devflow', 'curation');
  const backupDir = (): string => path.join(root, '.devflow', `learning.backup-${STAMP}-00000001`);
  const devflowTree = (): Map<string, string> => snapshotTree(path.join(root, '.devflow'), { stat: true });

  async function seedEveryFolder(): Promise<void> {
    for (const dir of [oldDir(), newDir(), backupDir()]) await seed(dir, FILES);
  }

  it.each([
    ['a queue file of the old folder', '.devflow/learning/.pending-turns.jsonl'],
    ['a queue file of the new folder', '.devflow/curation/.pending-turns.jsonl'],
    ['a queue file of a backup folder', `.devflow/learning.backup-${STAMP}-00000001/.pending-turns.jsonl`],
  ] as const)('git tracks %s: nothing is deleted, and the answer is a tracked skip', async (_name, tracked) => {
    initGitRepo(root);
    await seedEveryFolder();
    trackInGit(root, tracked);
    const before = devflowTree();

    expect(await drainCurationQueue(root)).toEqual({ drained: false, skipped: 'tracked' });
    expect(devflowTree()).toEqual(before);
  });

  it('a .git entry stands and git does not answer: nothing is deleted, and the answer is an unknown skip', async () => {
    initGitRepo(root);
    await seedEveryFolder();
    const before = devflowTree();
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    expect(await drainCurationQueue(root)).toEqual({ drained: false, skipped: 'unknown' });
    expect(devflowTree()).toEqual(before);
  });

  it('a check that cannot be loaded cannot answer: nothing is deleted, and the answer is an unknown skip', async () => {
    await seedEveryFolder();
    const before = devflowTree();

    const result = await drainCurationQueue(root, () => ({ ok: false, error: { kind: 'not-found', path: '/pkg/tracked-areas.cjs' } }));

    expect(result).toEqual({ drained: false, skipped: 'unknown' });
    expect(devflowTree()).toEqual(before);
  });

  it('a repository that tracks nothing in the data folders drains the live folders and leaves every backup', async () => {
    initGitRepo(root, { 'README.md': 'content of the repository\n' });
    await seedEveryFolder();

    expect(await drainCurationQueue(root)).toEqual({ drained: true });

    for (const dir of [oldDir(), newDir()]) expect(await present(dir, FILES)).toEqual([false, false, false]);
    expect(await present(backupDir(), FILES)).toEqual([true, true, true]);
  });
});

describe('formatCurationNotDrained', () => {
  const SENTENCE = 'The curation queue was not drained.';

  it.each(['tracked', 'unknown'] as const)('says the %s notice in full when the caller printed none', (reason) => {
    expect(formatCurationNotDrained({ drained: false, skipped: reason })).toBe(`${SENTENCE} ${MOVE_SKIP_NOTICE[reason]}`);
    expect(formatCurationNotDrained({ drained: false, skipped: reason }, null)).toBe(`${SENTENCE} ${MOVE_SKIP_NOTICE[reason]}`);
  });

  it.each(['tracked', 'unknown'] as const)('does not repeat the %s notice the caller just printed', (reason) => {
    expect(formatCurationNotDrained({ drained: false, skipped: reason }, reason)).toBe(SENTENCE);
  });

  it('says the notice in full when the caller printed the notice of the other reason', () => {
    expect(formatCurationNotDrained({ drained: false, skipped: 'tracked' }, 'unknown')).toBe(`${SENTENCE} ${MOVE_SKIP_NOTICE.tracked}`);
  });

  it('names the link of a refused drain, whatever the caller printed', () => {
    const refused = formatCurationNotDrained({ drained: false, linkedFolder: '/repo/.devflow' }, 'tracked');
    expect(refused).toContain('/repo/.devflow');
    expect(refused).not.toContain(MOVE_SKIP_NOTICE.tracked);
  });
});

describe('drainMemoryQueue leaves a project alone when git tracks the memory folder or does not answer', () => {
  const FILES = ['.pending-turns.jsonl', '.pending-turns.processing'] as const;
  const memoryDir = (): string => path.join(root, '.devflow', 'memory');
  const devflowTree = (): Map<string, string> => snapshotTree(path.join(root, '.devflow'), { stat: true });

  it.each([
    ['a queue file of the memory folder', '.devflow/memory/.pending-turns.jsonl'],
    ['a working memory file', '.devflow/memory/WORKING-MEMORY.md'],
  ] as const)('git tracks %s: nothing is deleted, and the answer is a tracked skip', async (_name, tracked) => {
    initGitRepo(root);
    await seed(memoryDir(), FILES);
    trackInGit(root, tracked);
    const before = devflowTree();

    expect(await drainMemoryQueue(root)).toEqual({ drained: false, skipped: 'tracked' });
    expect(devflowTree()).toEqual(before);
  });

  it('a .git entry stands and git does not answer: nothing is deleted, and the answer is an unknown skip', async () => {
    initGitRepo(root);
    await seed(memoryDir(), FILES);
    const before = devflowTree();
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    expect(await drainMemoryQueue(root)).toEqual({ drained: false, skipped: 'unknown' });
    expect(devflowTree()).toEqual(before);
  });

  it('a root that is not absolute cannot be checked: the answer is an unknown skip', async () => {
    expect(await drainMemoryQueue('relative/path')).toEqual({ drained: false, skipped: 'unknown' });
  });

  it('a repository that tracks nothing in the memory folder drains the queue, and keeps the tracked files elsewhere', async () => {
    initGitRepo(root, { 'README.md': 'content of the repository\n', '.devflow/notes.md': 'a tracked note\n' });
    await seed(memoryDir(), FILES);

    expect(await drainMemoryQueue(root)).toEqual({ drained: true });

    expect(await present(memoryDir(), FILES)).toEqual([false, false]);
    expect(await present(root, ['README.md', '.devflow/notes.md'])).toEqual([true, true]);
  });

  it('tracked curation files do not pause the memory queue: the areas are separate', async () => {
    initGitRepo(root);
    await seed(memoryDir(), FILES);
    trackInGit(root, '.devflow/curation/decisions-ledger.jsonl');

    expect(await drainMemoryQueue(root)).toEqual({ drained: true });
    expect(await present(memoryDir(), FILES)).toEqual([false, false]);
  });

  it('a project with no .git entry makes no git call and drains as usual', async () => {
    await seed(memoryDir(), FILES);
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    expect(await drainMemoryQueue(root)).toEqual({ drained: true });
    expect(await present(memoryDir(), FILES)).toEqual([false, false]);
  });
});

describe('formatMemoryNotDrained', () => {
  const SENTENCE = 'The memory queue was not drained.';

  it.each(['tracked', 'unknown'] as const)('says the %s notice of the memory area in full', (reason) => {
    expect(formatMemoryNotDrained({ drained: false, skipped: reason })).toBe(`${SENTENCE} ${AREA_PAUSE_NOTICE.memory[reason]}`);
  });

  it('names the link of a refused drain', () => {
    const refused = formatMemoryNotDrained({ drained: false, linkedFolder: '/repo/.devflow' });
    expect(refused).toContain('/repo/.devflow');
    expect(refused).not.toContain(AREA_PAUSE_NOTICE.memory.tracked);
  });
});
