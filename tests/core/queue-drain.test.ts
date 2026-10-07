/**
 * D-CLI-NO-SYMLINK — the queue drains delete nothing through a symbolic link.
 *
 * `devflow learning --disable`, `devflow memory --disable` and `devflow init
 * --no-learning|--no-memory` delete a project's queue files. A repository can commit
 * `.devflow`, `.devflow/learning` or `.devflow/memory` as a link to a folder
 * elsewhere, and an unlink through it would delete same-named files wherever it
 * points. A refused drain deletes nothing and names the link.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { drainLearningQueue } from '../../src/core/learning-queue-cleanup.js';
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
    name: 'drainLearningQueue',
    folder: 'learning',
    files: ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'],
    drain: drainLearningQueue,
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
