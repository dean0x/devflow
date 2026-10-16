// tests/ledger-folder-helpers.test.ts
//
// The creator helpers and the global tuning-file helper, which take the old and the
// new ledger folder names as arguments. The four places that create the ledger
// folder (the session-start heal, the ensure-devflow-init scaffold, queue append and
// the configure writer) create the new folder only when the old name is absent at the
// ledger root. They call these helpers with the old and the new name. The helpers take
// the names as arguments, so the tests below run on made-up names.
//
// The shell half runs the helpers from the hooks' git-marker library in a bash
// process with an empty PATH, so a helper that forked any external command would fail:
// the hot-path hooks stay fork-free. The TypeScript half runs on temp folders.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ledgerFolderToCreate } from '../src/core/ledger-root.js';
import { getGlobalCurateTuningConfigPath } from '../src/core/project-paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GIT_MARKER = path.join(HERE, '..', 'src', 'assets', 'scripts', 'hooks', 'git-marker');
const BASH = '/bin/bash';

/** Run a bash snippet that sources git-marker, with no external command on PATH; answer its stdout. */
function bash(snippet: string, ...args: string[]): { stdout: string; status: number | null; stderr: string } {
  const res = spawnSync(BASH, ['-c', `source "$1"; shift; ${snippet}`, '_', GIT_MARKER, ...args], {
    encoding: 'utf-8',
    env: { PATH: '/nonexistent' },
  });
  return { stdout: res.stdout, status: res.status, stderr: res.stderr };
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-folder-helpers-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('df_ledger_folder (shell)', () => {
  const folderOf = (devflowDir: string, ...names: string[]) =>
    bash('df_ledger_folder "$@"; printf %s "$DF_LEDGER_FOLDER"', devflowDir, ...names);

  it('answers the old folder while the old name is present', () => {
    fs.mkdirSync(path.join(tmp, 'oldname'));
    const res = folderOf(tmp, 'oldname', 'newname');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(path.join(tmp, 'oldname'));
  });

  it('answers the new folder when the old name is absent', () => {
    expect(folderOf(tmp, 'oldname', 'newname').stdout).toBe(path.join(tmp, 'newname'));
  });

  it('answers the old folder when called with the old name only', () => {
    expect(folderOf(tmp, 'oldname').stdout).toBe(path.join(tmp, 'oldname'));
    fs.mkdirSync(path.join(tmp, 'oldname'));
    expect(folderOf(tmp, 'oldname').stdout).toBe(path.join(tmp, 'oldname'));
  });

  it('keeps the old name when both folders exist, so a creator never writes beside the old folder', () => {
    fs.mkdirSync(path.join(tmp, 'oldname'));
    fs.mkdirSync(path.join(tmp, 'newname'));
    expect(folderOf(tmp, 'oldname', 'newname').stdout).toBe(path.join(tmp, 'oldname'));
  });

  it('counts a dangling link at the old name as present', () => {
    fs.symlinkSync(path.join(tmp, 'nowhere'), path.join(tmp, 'oldname'));
    expect(folderOf(tmp, 'oldname', 'newname').stdout).toBe(path.join(tmp, 'oldname'));
  });

  it('counts a plain file at the old name as present', () => {
    fs.writeFileSync(path.join(tmp, 'oldname'), '');
    expect(folderOf(tmp, 'oldname', 'newname').stdout).toBe(path.join(tmp, 'oldname'));
  });

  it('creates nothing', () => {
    folderOf(tmp, 'oldname', 'newname');
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('keeps a devflow directory with spaces and shell characters literal', () => {
    const odd = path.join(tmp, 'a b$(touch pwned)`x`');
    fs.mkdirSync(odd);
    const res = folderOf(odd, 'oldname', 'newname');
    expect(res.stdout).toBe(path.join(odd, 'newname'));
    expect(fs.existsSync(path.join(tmp, 'pwned'))).toBe(false);
  });
});

describe('df_ledger_queue (shell)', () => {
  const queueOf = (file: string, ...names: string[]) =>
    bash('df_ledger_queue "$@"; printf %s "$DF_LEDGER_QUEUE"', file, ...names);

  it('leaves a queue file in the old folder as it is when called with the old name only', () => {
    fs.mkdirSync(path.join(tmp, 'oldname'));
    const file = path.join(tmp, 'oldname', '.pending-turns.jsonl');
    expect(queueOf(file, 'oldname').stdout).toBe(file);
  });

  it('leaves a queue file in the old folder as it is when the old folder is absent and no new name is given', () => {
    const file = path.join(tmp, 'oldname', '.pending-turns.jsonl');
    expect(queueOf(file, 'oldname').stdout).toBe(file);
  });

  it('points a queue file named under the new folder at the old folder while the old folder exists', () => {
    fs.mkdirSync(path.join(tmp, 'oldname'));
    const file = path.join(tmp, 'newname', '.pending-turns.jsonl');
    expect(queueOf(file, 'oldname', 'newname').stdout).toBe(path.join(tmp, 'oldname', '.pending-turns.jsonl'));
  });

  it('keeps a queue file under the new folder when the old folder is absent', () => {
    const file = path.join(tmp, 'newname', '.pending-turns.jsonl');
    expect(queueOf(file, 'oldname', 'newname').stdout).toBe(file);
  });

  it('keeps a queue file under the old folder as it is while the old folder exists, whether or not the new folder does', () => {
    fs.mkdirSync(path.join(tmp, 'oldname'));
    const file = path.join(tmp, 'oldname', '.pending-turns.jsonl');
    expect(queueOf(file, 'oldname', 'newname').stdout).toBe(file);
    fs.mkdirSync(path.join(tmp, 'newname'));
    expect(queueOf(file, 'oldname', 'newname').stdout).toBe(file);
  });

  it('points a queue file named under the old folder at the new folder once the old folder is gone', () => {
    const file = path.join(tmp, 'oldname', '.pending-turns.jsonl');
    expect(queueOf(file, 'oldname', 'newname').stdout).toBe(path.join(tmp, 'newname', '.pending-turns.jsonl'));
  });

  it('leaves a queue in another folder alone, even when the old folder exists', () => {
    fs.mkdirSync(path.join(tmp, 'oldname'));
    const file = path.join(tmp, 'memory', '.pending-turns.jsonl');
    expect(queueOf(file, 'oldname', 'newname').stdout).toBe(file);
    expect(queueOf(file, 'oldname').stdout).toBe(file);
  });

  it('does not create a folder', () => {
    queueOf(path.join(tmp, 'newname', '.pending-turns.jsonl'), 'oldname', 'newname');
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it.each(['', 'queue', 'dir/queue', '/queue'])('answers a path with too few parts unchanged: %j', (file) => {
    const res = queueOf(file, 'oldname', 'newname');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(file);
  });

  it('keeps spaces and shell characters in the queue path literal', () => {
    const odd = path.join(tmp, 'p $(touch pwned) `x`');
    fs.mkdirSync(path.join(odd, 'oldname'), { recursive: true });
    const res = queueOf(path.join(odd, 'newname', 'q file.jsonl'), 'oldname', 'newname');
    expect(res.stdout).toBe(path.join(odd, 'oldname', 'q file.jsonl'));
    expect(fs.existsSync(path.join(tmp, 'pwned'))).toBe(false);
  });
});

describe('df_global_tuning_file (shell) and getGlobalCurateTuningConfigPath (TypeScript)', () => {
  it('name the same file in the machine directory', () => {
    const machineDir = path.join(tmp, '.devflow');
    const res = bash('df_global_tuning_file "$1"; printf %s "$DF_GLOBAL_TUNING_FILE"', machineDir);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(getGlobalCurateTuningConfigPath(machineDir));
  });

  it('keeps a machine directory with spaces and shell characters literal', () => {
    const machineDir = path.join(tmp, 'm $(touch pwned) `x`', '.devflow');
    const res = bash('df_global_tuning_file "$1"; printf %s "$DF_GLOBAL_TUNING_FILE"', machineDir);
    expect(res.stdout).toBe(getGlobalCurateTuningConfigPath(machineDir));
    expect(fs.existsSync(path.join(tmp, 'pwned'))).toBe(false);
  });
});

describe('ledgerFolderToCreate (TypeScript)', () => {
  const devflow = () => path.join(tmp, '.devflow');

  it('answers the old folder while the old name is present', async () => {
    fs.mkdirSync(path.join(devflow(), 'oldname'), { recursive: true });
    expect(await ledgerFolderToCreate(tmp, 'oldname', 'newname')).toBe(path.join(devflow(), 'oldname'));
  });

  it('answers the new folder when the old name is absent', async () => {
    fs.mkdirSync(devflow());
    expect(await ledgerFolderToCreate(tmp, 'oldname', 'newname')).toBe(path.join(devflow(), 'newname'));
  });

  it('answers the new folder when .devflow itself is absent', async () => {
    expect(await ledgerFolderToCreate(tmp, 'oldname', 'newname')).toBe(path.join(devflow(), 'newname'));
  });

  it('answers the old folder when called with the old name only', async () => {
    expect(await ledgerFolderToCreate(tmp, 'oldname')).toBe(path.join(devflow(), 'oldname'));
    fs.mkdirSync(path.join(devflow(), 'oldname'), { recursive: true });
    expect(await ledgerFolderToCreate(tmp, 'oldname')).toBe(path.join(devflow(), 'oldname'));
  });

  it('keeps the old name when both folders exist', async () => {
    fs.mkdirSync(path.join(devflow(), 'oldname'), { recursive: true });
    fs.mkdirSync(path.join(devflow(), 'newname'));
    expect(await ledgerFolderToCreate(tmp, 'oldname', 'newname')).toBe(path.join(devflow(), 'oldname'));
  });

  it('counts a dangling link at the old name as present', async () => {
    fs.mkdirSync(devflow());
    fs.symlinkSync(path.join(tmp, 'nowhere'), path.join(devflow(), 'oldname'));
    expect(await ledgerFolderToCreate(tmp, 'oldname', 'newname')).toBe(path.join(devflow(), 'oldname'));
  });

  it('answers the new folder when .devflow is a file, so the old name is absent', async () => {
    fs.writeFileSync(devflow(), '');
    expect(await ledgerFolderToCreate(tmp, 'oldname', 'newname')).toBe(path.join(devflow(), 'newname'));
  });

  it.skipIf(process.getuid?.() === 0)('answers the old folder when the probe cannot tell, so it never starts a second folder', async () => {
    fs.mkdirSync(devflow());
    fs.chmodSync(devflow(), 0o000);
    try {
      expect(await ledgerFolderToCreate(tmp, 'oldname', 'newname')).toBe(path.join(devflow(), 'oldname'));
    } finally {
      fs.chmodSync(devflow(), 0o700);
    }
  });

  it('creates nothing', async () => {
    await ledgerFolderToCreate(tmp, 'oldname', 'newname');
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});
