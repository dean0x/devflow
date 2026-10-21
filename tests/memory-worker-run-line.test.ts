/**
 * The memory worker writes exactly one `Run:` line per run, from the worker process only.
 *
 * The worker starts subshells (the probes' watchdogs, the claude spawn, the main watchdog)
 * while its exit trap is set. A subshell that a signal reaches before it has reset the
 * trap runs that trap. The trap acts only in the shell whose real PID is the worker's, so
 * such a subshell writes no `Run:` line and releases no lock. The worker also cancels each
 * subshell with SIGKILL, which runs no trap.
 *
 * Three tests pin the rule. The source check pins every kill in the worker. The guard
 * test runs the worker's own trap code in subshells that a signal ends. The stress test
 * runs many workers at once; it takes 20 to 25 s, so DEVFLOW_RUN_LINE_STRESS=1 turns it
 * on, and only the macOS bash 3.2 CI job sets it.
 */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveOnPath } from './shell-hooks-helpers.js';

const WORKER = path.resolve(__dirname, '../src/assets/scripts/hooks/background-memory-update');
const STRESS = process.env.DEVFLOW_RUN_LINE_STRESS === '1';

/** Lines of the worker that run code: comment lines are dropped. */
function workerCodeLines(): string[] {
  return fs.readFileSync(WORKER, 'utf-8')
    .split('\n')
    .filter(line => !/^\s*#/.test(line));
}

describe('the memory worker writes one Run line per run', () => {
  it('every kill is a SIGKILL cancel of one subshell, or a group signal on the line after a watchdog sleep', () => {
    const code = workerCodeLines();
    const killIndexes = code.flatMap((line, i) =>
      /(^|[\s;&|(`/\\])(kill|pkill|killall)(\s|$)/.test(line) ? [i] : []);
    const cancel = /^\s*kill -KILL "\$[A-Za-z_]+"( 2>\/dev\/null)?( \|\| true)?$/;
    const group = /^\s*kill -(TERM|KILL) -"\$[A-Za-z_]+"( 2>\/dev\/null)?( \|\| true)?$/;

    const cancels = killIndexes.filter(i => cancel.test(code[i]));
    const groups = killIndexes.filter(i => group.test(code[i]));
    const other = killIndexes.filter(i => !cancel.test(code[i]) && !group.test(code[i]));

    expect(other.map(i => code[i]), 'no kill other than the two forms above').toEqual([]);
    expect(cancels.length, 'the three watchdog cancels').toBe(3);
    expect(groups.length, 'two group signals in each of the two long watchdogs, one in the area probe').toBe(5);
    for (const i of groups) {
      expect(code[i - 1], `the group signal "${code[i].trim()}" follows a sleep`).toMatch(/^\s*sleep\s/);
    }
  });

  describe('the exit trap', () => {
    /** The worker's own trap code: `own_pid`, the worker PID, `finish_run` and the `trap` line. */
    function trapCode(): string {
      const source = fs.readFileSync(WORKER, 'utf-8');
      const start = source.indexOf('\nown_pid() {');
      const endMark = '\ntrap finish_run EXIT\n';
      const end = source.indexOf(endMark);
      expect(start, 'the worker defines own_pid').toBeGreaterThan(-1);
      expect(end, 'the worker sets the finish_run trap after own_pid').toBeGreaterThan(start);
      return source.slice(start + 1, end + endMark.length);
    }

    /**
     * Runs the trap code in a harness: a plain subshell, and two background subshells that a
     * signal ends, each holding the exit trap. `prelude` and `transform` shape the harness;
     * the lines it prints say, per case, whether the lock is still held.
     */
    function runHarness(prelude: string[], transform: (trap: string) => string): { status: number | null; stderr: string; lines: string[]; lockLeft: boolean } {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-trap-'));
      try {
        const lock = path.join(root, 'lock');
        fs.mkdirSync(lock);
        const harness = path.join(root, 'harness.sh');
        // Each subshell sets the exit trap itself, as a forked subshell holds it before bash
        // resets it, then sends itself SIGTERM through a child (`sh -c 'kill -TERM $PPID'`).
        const subshell = [
          'trap finish_run EXIT',
          "trap 'exit 143' TERM",
          "/bin/sh -c 'kill -TERM $PPID'",
        ].join('; ');
        fs.writeFileSync(harness, [
          'set -e',
          ...prelude,
          'log() { echo "LOG $*"; }',
          'RUN_CLI="unknown"; RUN_ARGV="none"; RUN_RESULT="skip"; RUN_DENIALS="n/a"; RUN_REMOVED="none"; RUN_FLOOR=""',
          'RESULT_FILE=""',
          `LOCK_DIR='${lock}'`,
          'LOCK_HELD="true"',
          transform(trapCode()),
          'state() { if [ -d "$LOCK_DIR" ]; then echo "$1: lock held"; else echo "$1: lock released"; fi; }',
          '( trap finish_run EXIT; exit 0 )',
          'state "a plain subshell"',
          `( ${subshell} ) &`,
          'wait $! || true',
          'state "a background subshell that a signal ends"',
          'set -m',
          `( ${subshell} ) &`,
          'set +m',
          'wait $! || true',
          'state "a background subshell in its own group that a signal ends"',
          '',
        ].join('\n'));

        const result = spawnSync('bash', [harness], { encoding: 'utf-8', timeout: 60000 });
        return {
          status: result.status,
          stderr: result.stderr,
          lines: result.stdout.trim().split('\n'),
          lockLeft: fs.existsSync(lock),
        };
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }

    const EXPECTED = [
      'a plain subshell: lock held',
      'a background subshell that a signal ends: lock held',
      'a background subshell in its own group that a signal ends: lock held',
      'LOG Run: cli=unknown argv=none result=skip denials=n/a removed=none',
    ];

    it('writes the Run line and releases the lock only in the worker, not in a subshell that a signal ends', () => {
      const run = runHarness([], trap => trap);
      expect(run.status, `the harness ended cleanly: ${run.stderr}`).toBe(0);
      expect(run.lines).toEqual(EXPECTED);
      expect(run.lockLeft, 'the worker itself released the lock when it ended').toBe(false);
    });

    it('keeps that rule when the read of the real PID fails: a subshell writes no line, the worker writes one', () => {
      // BASHPID is unset so the read path runs on every bash, and the shell the read execs
      // is a path that does not exist, so the read fails in the worker and in every subshell.
      const run = runHarness(['unset BASHPID'], trap => {
        const failing = trap.replace('exec /bin/sh -c', 'exec /nonexistent/sh -c');
        expect(failing, 'the read execs /bin/sh').not.toBe(trap);
        return failing;
      });
      expect(run.status, `the harness ended cleanly: ${run.stderr}`).toBe(0);
      expect(run.lines).toEqual(EXPECTED);
      expect(run.lockLeft, 'the worker itself released the lock when it ended').toBe(false);
    });
  });

  /**
   * One worker run in a fresh project, home and fake claude; resolves to the Run lines it
   * wrote, each without its timestamp and hook name.
   */
  async function runOnce(withFolderAtStagedPath: boolean): Promise<string[]> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-runline-'));
    try {
      const project = path.join(root, 'project');
      const home = path.join(root, 'home');
      const shim = path.join(root, 'shim');
      const memory = path.join(project, '.devflow', 'memory');
      const staged = path.join(memory, 'WORKING-MEMORY.md.new');
      fs.mkdirSync(memory, { recursive: true });
      fs.mkdirSync(home);
      fs.mkdirSync(shim);
      const ts = Math.floor(Date.now() / 1000);
      fs.writeFileSync(
        path.join(memory, '.pending-turns.jsonl'),
        `${JSON.stringify({ role: 'user', content: 'a', ts })}\n${JSON.stringify({ role: 'assistant', content: 'b', ts: ts + 1 })}\n`,
      );
      if (withFolderAtStagedPath) {
        fs.mkdirSync(path.join(staged, 'a', 'b'), { recursive: true });
        fs.writeFileSync(path.join(staged, 'inside'), 'x');
      }
      fs.writeFileSync(
        path.join(shim, 'claude'),
        [
          '#!/bin/bash',
          'if [ "${1:-}" = "--version" ]; then echo "2.1.293 (Claude Code)"; exit 0; fi',
          'cat >/dev/null',
          `echo '<!-- memory-head: testsha branch: main -->' > '${staged}'`,
          `echo '## Now' >> '${staged}'`,
          'exit 0',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      const runPath = `${shim}:${process.env.PATH ?? '/usr/bin:/bin'}`;
      expect(resolveOnPath('claude', runPath), 'the fake claude resolves first on PATH').toBe(path.join(shim, 'claude'));

      await new Promise<void>((resolve, reject) => {
        const child = spawn('bash', [WORKER, project], {
          env: { ...process.env, HOME: home, PATH: runPath },
          stdio: 'ignore',
        });
        child.on('error', reject);
        child.on('close', () => resolve());
      });

      const logs = path.join(home, '.devflow', 'logs');
      return fs.readdirSync(logs)
        .flatMap(slug =>
          fs.readFileSync(path.join(logs, slug, '.background-memory-update.log'), 'utf-8').split('\n'))
        .flatMap(line => (/^\[[^\]]*\] \[[^\]]*\] (Run: .*)$/.exec(line) ?? []).slice(1));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it.skipIf(!STRESS)('writes the expected single Run line in each of many workers that run at once', async () => {
    const total = 64;
    const width = 8;
    const wrong: string[] = [];
    let failure: unknown;
    let next = 0;
    const lane = async (): Promise<void> => {
      while (failure === undefined && next < total) {
        const i = next++;
        const withFolder = i % 2 === 0;
        try {
          const lines = await runOnce(withFolder);
          const expected = `Run: cli=2.1.293 argv=lean result=updated denials=unknown removed=${withFolder ? 'dir' : 'none'}`;
          if (lines.length !== 1 || lines[0] !== expected) {
            wrong.push(`run ${i}: ${lines.length} Run lines, expected one "${expected}":\n${lines.join('\n')}`);
          }
        } catch (e) {
          if (failure === undefined) failure = e;
        }
      }
    };
    await Promise.all(Array.from({ length: width }, lane));

    expect(failure, 'every run started and its log could be read').toBeUndefined();
    expect(wrong, 'every run wrote its one expected Run line').toEqual([]);
  }, 180000);
});
