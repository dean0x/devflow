// tests/ledger-folder-helpers.test.ts
//
// The creator helpers and the global tuning-file helper, which take the old and the
// new ledger folder names as arguments. The places that create the ledger folder (the
// session-start heal, the ensure-devflow-init scaffold, queue append and the configure
// writer) create the new folder only when the old name is absent at the ledger root,
// and never the old folder. The shell creators call these helpers with the old and the
// new name. The helpers take the names as arguments, so the tests below run on made-up
// names.
//
// The probe helpers run from the hooks' git-marker library in a bash process with an
// empty PATH, so a helper that forked any external command would fail: the hot-path
// hooks stay fork-free. The creator, which makes a folder, runs with the system PATH.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
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

describe('df_make_ledger_folder (shell)', () => {
  const devflow = () => path.join(tmp, '.devflow');

  /** Run the creator with the system PATH (it makes a folder). Prints its status and DF_LEDGER_FOLDER, and whatever it logged. */
  const make = (...args: string[]): { stdout: string; status: number | null } => {
    const res = spawnSync(BASH, ['-c', 'source "$1"; shift; log() { printf "LOG:%s\\n" "$1"; }; df_make_ledger_folder "$@"; rc=$?; printf "RC:%s\\nFOLDER:%s\\n" "$rc" "$DF_LEDGER_FOLDER"', '_', GIT_MARKER, ...args], {
      encoding: 'utf-8',
    });
    return { stdout: res.stdout, status: res.status };
  };

  it('makes the new folder, and not the old one, when the old name is absent', () => {
    fs.mkdirSync(devflow());

    const res = make(tmp, devflow(), 'oldname', 'newname');

    expect(res.stdout).toBe(`RC:0\nFOLDER:${path.join(devflow(), 'newname')}\n`);
    expect(fs.readdirSync(devflow())).toEqual(['newname']);
  });

  it('makes nothing while the old name is present, and answers the old folder', () => {
    fs.mkdirSync(path.join(devflow(), 'oldname'), { recursive: true });

    const res = make(tmp, devflow(), 'oldname', 'newname');

    expect(res.stdout).toBe(`RC:0\nFOLDER:${path.join(devflow(), 'oldname')}\n`);
    expect(fs.readdirSync(devflow())).toEqual(['oldname']);
  });

  it('makes nothing where a dangling link stands at the old name, and nothing where it points', () => {
    const created = path.join(tmp, 'created-through-the-link');
    fs.mkdirSync(devflow());
    fs.symlinkSync(created, path.join(devflow(), 'oldname'));

    const res = make(tmp, devflow(), 'oldname', 'newname');

    expect(res.stdout).toBe(`RC:0\nFOLDER:${path.join(devflow(), 'oldname')}\n`);
    expect(fs.existsSync(created)).toBe(false);
    expect(fs.existsSync(path.join(devflow(), 'newname'))).toBe(false);
  });

  it('leaves an existing new folder and its files as they are', () => {
    fs.mkdirSync(path.join(devflow(), 'newname'), { recursive: true });
    fs.writeFileSync(path.join(devflow(), 'newname', 'kept.txt'), 'kept\n');

    const res = make(tmp, devflow(), 'oldname', 'newname');

    expect(res.stdout).toBe(`RC:0\nFOLDER:${path.join(devflow(), 'newname')}\n`);
    expect(fs.readFileSync(path.join(devflow(), 'newname', 'kept.txt'), 'utf-8')).toBe('kept\n');
  });

  it('refuses a link at the new name with status 2, makes nothing through it, and logs nothing itself', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-folder-outside-'));
    try {
      fs.mkdirSync(devflow());
      fs.symlinkSync(path.join(outside, 'absent'), path.join(devflow(), 'newname'));

      const res = make(tmp, devflow(), 'oldname', 'newname');

      expect(res.stdout).toBe(`RC:2\nFOLDER:${path.join(devflow(), 'newname')}\n`);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a linked .devflow and makes nothing in the folder it names', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-folder-outside-'));
    try {
      fs.symlinkSync(outside, devflow());

      const res = make(tmp, devflow(), 'oldname', 'newname');

      expect(res.stdout).toMatch(/^RC:2\n/);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a call with an empty name or root, and makes nothing', () => {
    fs.mkdirSync(devflow());

    for (const args of [[tmp, devflow(), '', 'newname'], [tmp, devflow(), 'oldname', ''], ['', devflow(), 'oldname', 'newname'], [tmp, '', 'oldname', 'newname']]) {
      expect(make(...args).stdout, JSON.stringify(args)).toMatch(/^RC:1\n/);
    }
    expect(fs.readdirSync(devflow())).toEqual([]);
  });

  it('under set -e, a caller that ends the call with || true keeps running after a refusal', () => {
    fs.mkdirSync(devflow());
    fs.symlinkSync(path.join(tmp, 'absent'), path.join(devflow(), 'newname'));

    const res = spawnSync(BASH, ['-c', 'set -e; source "$1"; df_make_ledger_folder "$2" "$3" oldname newname || true; echo after', '_', GIT_MARKER, tmp, devflow()], { encoding: 'utf-8' });

    expect(res.stdout).toBe('after\n');
  });
});
