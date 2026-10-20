/**
 * `backupPendingRows`: the read-only count behind `devflow curation --status` (#529).
 *
 * A move that finds ledgers in both folders keeps the old one as a backup,
 * `.devflow/learning.backup-<stamp>-<random>`. The backup is inert: no hook, drain or
 * claim reads it. Status counts what a later init would still merge out of it, the rows
 * of the pending and processing files and of the unswept private and overflow files, so
 * the user can tell when deleting it loses nothing. The count reads without following a
 * link, takes no lock and writes nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireCurationMove, snapshotTree } from './curation-fixtures.js';

const store = requireCurationMove();

const STAMP = '20261017T020304Z';
const rows = (count: number): string => '{"role":"user"}\n'.repeat(count);
/** The answer's count of backups past the listing limit, when there are none. */
const NO_MORE = { backups: 0, pendingRows: 0 };

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-rows-')));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const devflow = (): string => path.join(root, '.devflow');

function seedBackup(name: string, files: Record<string, string> = {}): string {
  const dir = path.join(devflow(), name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
  return dir;
}

describe('backupPendingRows', () => {
  it('answers no backups when .devflow is absent or holds none', () => {
    expect(store.backupPendingRows(root)).toEqual({ ok: true, value: { backups: [], beyondLimit: NO_MORE } });
    fs.mkdirSync(path.join(devflow(), 'curation'), { recursive: true });
    fs.mkdirSync(path.join(devflow(), 'learning'), { recursive: true });
    expect(store.backupPendingRows(root)).toEqual({ ok: true, value: { backups: [], beyondLimit: NO_MORE } });
  });

  it('counts the rows of the pending, processing, private and overflow files, and no swept file', () => {
    seedBackup(`learning.backup-${STAMP}-ab12cd34`, {
      '.pending-turns.jsonl': rows(2),
      '.pending-turns.processing': rows(1),
      [`.pending-turns.jsonl.merging-${STAMP}-00000001`]: rows(1),
      [`.pending-turns.processing.merging-${STAMP}-00000002`]: rows(1),
      [`.pending-turns.jsonl.overflow-${STAMP}-00000003`]: rows(3),
      [`.pending-turns.jsonl.swept-${STAMP}-00000004`]: rows(5),
      [`.pending-turns.processing.swept-${STAMP}-00000005`]: rows(4),
      '.pending-turns.owner': '0123456789abcdef\n',
      'decisions-ledger.jsonl': rows(9),
      'unknown.txt': rows(9),
    });

    expect(store.backupPendingRows(root)).toEqual({
      ok: true,
      value: { backups: [{ name: `learning.backup-${STAMP}-ab12cd34`, pendingRows: 8 }], beyondLimit: NO_MORE },
    });
  });

  it('counts an unfinished last line as a row and skips blank lines', () => {
    seedBackup(`learning.backup-${STAMP}-ab12cd34`, { '.pending-turns.jsonl': `${rows(1)}\n  \n{"role":"us` });
    expect(store.backupPendingRows(root)).toMatchObject({ value: { backups: [{ pendingRows: 2 }] } });
  });

  it('answers 0 for a backup whose files are all swept or absent', () => {
    seedBackup(`learning.backup-${STAMP}-aaaaaaaa`, { [`.pending-turns.jsonl.swept-${STAMP}-00000001`]: rows(5) });
    seedBackup(`learning.backup-${STAMP}-bbbbbbbb`);
    expect(store.backupPendingRows(root)).toEqual({
      ok: true,
      value: {
        backups: [
          { name: `learning.backup-${STAMP}-aaaaaaaa`, pendingRows: 0 },
          { name: `learning.backup-${STAMP}-bbbbbbbb`, pendingRows: 0 },
        ],
        beyondLimit: NO_MORE,
      },
    });
  });

  it('lists the backups in name order and ignores other folders and files', () => {
    seedBackup('learning.backup-20261018T000000Z-00000002', { '.pending-turns.jsonl': rows(2) });
    seedBackup('learning.backup-20261017T000000Z-00000001', { '.pending-turns.jsonl': rows(1) });
    seedBackup('learning.old', { '.pending-turns.jsonl': rows(7) });
    fs.writeFileSync(path.join(devflow(), 'learning.backup-file'), rows(3));

    const answer = store.backupPendingRows(root);

    expect(answer.ok && answer.value.backups).toEqual([
      { name: 'learning.backup-20261017T000000Z-00000001', pendingRows: 1 },
      { name: 'learning.backup-20261018T000000Z-00000002', pendingRows: 2 },
    ]);
  });

  it('writes nothing and takes no lock', () => {
    seedBackup(`learning.backup-${STAMP}-ab12cd34`, { '.pending-turns.jsonl': rows(2) });
    const before = snapshotTree(root);
    store.backupPendingRows(root);
    expect(snapshotTree(root)).toEqual(before);
  });

  describe('never follows a link', () => {
    it('skips a backup that is a symbolic link', () => {
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-rows-out-')));
      try {
        fs.writeFileSync(path.join(outside, '.pending-turns.jsonl'), rows(4));
        fs.mkdirSync(devflow(), { recursive: true });
        fs.symlinkSync(outside, path.join(devflow(), `learning.backup-${STAMP}-ab12cd34`));
        expect(store.backupPendingRows(root)).toEqual({ ok: true, value: { backups: [], beyondLimit: NO_MORE } });
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('counts 0 rows for a queue file that is a symbolic link', () => {
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-rows-out-')));
      try {
        fs.writeFileSync(path.join(outside, 'queue'), rows(4));
        const dir = seedBackup(`learning.backup-${STAMP}-ab12cd34`);
        fs.symlinkSync(path.join(outside, 'queue'), path.join(dir, '.pending-turns.jsonl'));
        expect(store.backupPendingRows(root)).toMatchObject({ value: { backups: [{ pendingRows: 0 }] } });
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('answers no backups when .devflow itself is a symbolic link', () => {
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-rows-out-')));
      try {
        fs.mkdirSync(path.join(outside, `learning.backup-${STAMP}-ab12cd34`));
        fs.symlinkSync(outside, devflow());
        expect(store.backupPendingRows(root)).toEqual({ ok: true, value: { backups: [], beyondLimit: NO_MORE } });
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('is bounded', () => {
    it('lists at most 50 backup folders and counts the others in one total', () => {
      for (let i = 0; i < 55; i++) seedBackup(`learning.backup-${STAMP}-${String(i).padStart(8, '0')}`);
      const answer = store.backupPendingRows(root);
      expect(answer.ok && answer.value.backups).toHaveLength(50);
      expect(answer.ok && answer.value.beyondLimit).toEqual({ backups: 5, pendingRows: 0 });
    });

    it('accounts for every backup: the rows of those past the listing limit are summed, whatever their position', () => {
      for (let i = 0; i < 52; i++) {
        seedBackup(`learning.backup-${STAMP}-${String(i).padStart(8, '0')}`, i >= 50 ? { '.pending-turns.jsonl': rows(i - 48) } : {});
      }
      const answer = store.backupPendingRows(root);
      expect(answer.ok && answer.value.backups.map(entry => entry.pendingRows)).toEqual(new Array(50).fill(0));
      expect(answer.ok && answer.value.beyondLimit).toEqual({ backups: 2, pendingRows: 2 + 3 });
    });

    it('reads at most 200 queue files in one backup', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 210; i++) files[`.pending-turns.jsonl.overflow-${STAMP}-${String(i).padStart(8, '0')}`] = rows(1);
      seedBackup(`learning.backup-${STAMP}-ab12cd34`, files);
      expect(store.backupPendingRows(root)).toMatchObject({ value: { backups: [{ pendingRows: 200 }] } });
    });
  });

  it('refuses a root that is not an absolute path', () => {
    expect(store.backupPendingRows('relative/path')).toMatchObject({ ok: false, error: { kind: 'refused' } });
    expect(store.backupPendingRows('')).toMatchObject({ ok: false, error: { kind: 'refused' } });
  });
});
