/**
 * The HUD's fsmonitor carve-out (D-NO-FSMONITOR in src/hud/git.ts), pinned at
 * the argv level through a scripted execFile — no real git, no real daemon.
 *
 * Before its index reads (`status`, `diff`) the HUD reads `core.fsmonitor` once
 * per refresh with `git config --type=bool --get`, which never touches the
 * index. Only a value git reads as boolean true — the built-in daemon, git's
 * own code — lets the index reads run without `-c core.fsmonitor=false`. A hook
 * path, any other value, an unset key and a failed read all fail closed to the
 * override. Every other HUD git call carries the override unconditionally.
 *
 * A repository whose `core.fsmonitor` names a real hook script is covered with
 * real git in tests/integration/hud-git.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** What the fake git answers for one call: stdout, or a failure. */
type FakeAnswer = { stdout: string } | { fail: string };

/** How the fake answers the `core.fsmonitor` read, per scenario. */
let fsmonitorAnswers: FakeAnswer[] = [];

/** argv of every git call, in order. */
const calls: string[][] = [];

const OVERRIDE = ['-c', 'core.fsmonitor=false'];
const CONFIG_READ = ['config', '--type=bool', '--get', 'core.fsmonitor'];

/** The subcommand argv with a leading override removed. */
function bare(args: readonly string[]): string[] {
  return args[0] === OVERRIDE[0] && args[1] === OVERRIDE[1] ? args.slice(2) : [...args];
}

/** A repository on `feature` with one unstaged edit, compared against local `main`. */
function answer(args: readonly string[]): FakeAnswer {
  const a = bare(args);
  const sub = a.find(x => !x.startsWith('-')) ?? '';
  if (a.join(' ') === CONFIG_READ.join(' ')) {
    return fsmonitorAnswers.shift() ?? { fail: 'unexpected extra config read' };
  }
  switch (sub) {
    case 'rev-parse':
      return a.includes('--show-toplevel') ? { stdout: '/repo\n' } : { stdout: 'feature\n' };
    case 'status':
      return { stdout: '?? untracked.txt\n' };
    case 'symbolic-ref':
      return { fail: 'no origin/HEAD' };
    case 'for-each-ref':
      return { stdout: 'feature\nmain\n' };
    case 'rev-list':
      return { stdout: '0\t1\n' };
    case 'merge-base':
      return { stdout: 'abc123\n' };
    case 'diff':
      return { stdout: ' 1 file changed, 1 insertion(+)\n' };
    case 'describe':
      return { fail: 'no tags' };
    case 'worktree':
      return { stdout: '/repo abc123 [feature]\n' };
    default:
      return { fail: `unscripted: ${a.join(' ')}` };
  }
}

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: vi.fn((file: string, args: string[], _opts: object, cb: (err: unknown, stdout: string) => void) => {
    expect(file).toBe('git');
    calls.push([...args]);
    const res = answer(args);
    // Async like the real execFile, so Promise.all ordering stays realistic.
    setImmediate(() => ('fail' in res
      ? cb(Object.assign(new Error(res.fail), { code: 1 }), '')
      : cb(null, res.stdout)));
  }),
}));

import { gatherGitStatus, fsmonitorOverride } from '../src/hud/git.js';

/** argv of the calls whose subcommand is `sub`. */
function callsTo(sub: string): string[][] {
  return calls.filter(args => bare(args).find(x => !x.startsWith('-')) === sub);
}

describe('HUD fsmonitor carve-out (D-NO-FSMONITOR)', () => {
  beforeEach(() => {
    calls.length = 0;
    fsmonitorAnswers = [];
  });

  it('reads core.fsmonitor once per refresh, without the override that would answer for it', async () => {
    fsmonitorAnswers = [{ stdout: 'true\n' }];
    await gatherGitStatus('/repo');
    expect(calls.filter(args => bare(args).join(' ') === CONFIG_READ.join(' '))).toEqual([CONFIG_READ]);
  });

  it('core.fsmonitor=true (the built-in daemon): status and diff run without the override', async () => {
    fsmonitorAnswers = [{ stdout: 'true\n' }];
    const status = await gatherGitStatus('/repo');
    expect(callsTo('status')).toEqual([['--no-optional-locks', 'status', '--porcelain']]);
    expect(callsTo('diff')).toEqual([['diff', '--shortstat', 'abc123']]);
    expect(status?.dirty).toBe(true);
    expect(status?.filesChanged).toBe(1);
  });

  const FAIL_CLOSED: ReadonlyArray<{ name: string; read: FakeAnswer }> = [
    { name: 'unset (git config exits 1, prints nothing)', read: { fail: 'exit 1' } },
    { name: 'a hook path (--type=bool refuses it, exit 128)', read: { fail: 'bad boolean config value' } },
    { name: 'false', read: { stdout: 'false\n' } },
    { name: 'a failed read (timeout)', read: { fail: 'ETIMEDOUT' } },
  ];

  for (const { name, read } of FAIL_CLOSED) {
    it(`core.fsmonitor ${name}: status and diff carry the override`, async () => {
      fsmonitorAnswers = [read];
      await gatherGitStatus('/repo');
      expect(callsTo('status')).toEqual([[...OVERRIDE, '--no-optional-locks', 'status', '--porcelain']]);
      expect(callsTo('diff')).toEqual([[...OVERRIDE, 'diff', '--shortstat', 'abc123']]);
    });
  }

  it('re-reads the setting on every refresh: no cached carve-out outlives a config change', async () => {
    fsmonitorAnswers = [{ stdout: 'true\n' }, { fail: 'bad boolean config value' }];
    await gatherGitStatus('/repo');
    await gatherGitStatus('/repo');
    expect(callsTo('status')).toEqual([
      ['--no-optional-locks', 'status', '--porcelain'],
      [...OVERRIDE, '--no-optional-locks', 'status', '--porcelain'],
    ]);
  });

  it('every call other than the config read carries the override whatever the setting', async () => {
    fsmonitorAnswers = [{ stdout: 'true\n' }];
    await gatherGitStatus('/repo');
    const others = calls.filter(args => {
      const sub = bare(args).find(x => !x.startsWith('-'));
      return sub !== 'config' && sub !== 'status' && sub !== 'diff';
    });
    expect(others.length).toBeGreaterThan(0);
    for (const args of others) expect(args.slice(0, 2)).toEqual(OVERRIDE);
  });
});

describe('fsmonitorOverride — the classifier the carve-out rests on', () => {
  it('drops the override only for the literal boolean true git config prints', () => {
    expect(fsmonitorOverride('true')).toEqual([]);
  });

  it('keeps the override for everything else', () => {
    for (const value of ['', 'false', 'TRUE', 'yes', '1', ' true', 'true\n', '/tmp/hook.sh', 'true; rm']) {
      expect(fsmonitorOverride(value), JSON.stringify(value)).toEqual(OVERRIDE);
    }
  });
});
