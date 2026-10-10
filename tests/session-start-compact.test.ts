/**
 * Behavioural tests for Sections 5 and 6 of the session-start-context hook:
 * the compaction resume directive (D-COMPACT-RESUME-DIRECTIVE) and the CLAUDE.md
 * import audit with its stamp and systemMessage (D-CLAUDE-MD-IMPORT-AUDIT,
 * D-AUDIT-STAMP, D-SYSTEMMESSAGE-ENVELOPE). Covers AC-401 to AC-405 and AC-421 to
 * AC-427, and AC-431's hook half. Modelled on session-start-legacy-install.test.ts.
 *
 * Every run gets its own temp HOME (whose `.devflow` is the machine root, D-ONE-HOME)
 * and a neutral CLAUDE_CONFIG_DIR, so the developer's own install and CLAUDE.md never
 * decide an outcome. Node and the other tools the hook forks are reached through an
 * additive PATH farm of recording wrappers, so "no node process" is counted, not
 * assumed. A test that sabotages the audit script runs a COPY of the scripts tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HOOK_RUN_ALLOWANCE_MS, HOOKS_DIR, NODE_EXEC_STALL_MS, runHook } from './shell-hooks-helpers.js';
import {
  claudeMdAuditRoots,
  loadClaudeMdAuditModule,
  runClaudeMdAudit,
  writeClaudeMdAuditStamp,
} from '../src/core/claude-md-audit.js';

/** The ceiling the numeric-floors manifest pins (`compact-directive-max-chars`). */
const COMPACT_DIRECTIVE_MAX_CHARS = 250;

const SCRIPTS_DIR = path.resolve(HOOKS_DIR, '..');
const STAMP_NAME = '.claude-md-audit';
const AUDIT_SCRIPT_NAME = 'claude-md-audit.cjs';
const HAS_JQ = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
/** A run that execs node pays the macOS exec stall at most once. */
const NODE_RUN_MS = HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS;

const filler = (n: number): string => 'x'.repeat(n);

interface Farm {
  readonly path: string;
  readonly log: string;
}

/**
 * An ADDITIVE PATH farm: symlinks to the system tools the hook needs, and recording
 * wrappers (`NAME ARGS` appended to the log, then exec of the real binary) for the
 * tools whose forks a test counts. `node` and `jq` are present only when asked, so a
 * run can hide either. Nothing is subtracted from the inherited PATH.
 */
function buildFarm(base: string, opts: { jq: boolean; node: boolean }): Farm {
  const dir = fs.mkdtempSync(path.join(base, 'farm-'));
  const log = path.join(dir, 'invocations.log');
  const plain = [
    'wc', 'head', 'tail', 'tr', 'touch', 'sed', 'cut', 'find', 'grep', 'mktemp', 'dirname', 'basename',
    'bash', 'cat', 'chmod', 'cp', 'echo', 'ls', 'mkdir', 'mv', 'rm', 'rmdir', 'sleep', 'printf', 'pwd',
    'uname', 'env', 'id', 'sort', 'awk', 'readlink', 'ln', 'tee', 'true', 'false', 'test', 'hostname',
  ];
  const system = (name: string): string | undefined =>
    ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'].map(d => path.join(d, name)).find(p => fs.existsSync(p));
  for (const name of plain) {
    const real = system(name);
    if (real) fs.symlinkSync(real, path.join(dir, name));
  }
  const wrap = (name: string, real: string): void => {
    const wrapper = path.join(dir, name);
    fs.writeFileSync(wrapper, `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`);
    fs.chmodSync(wrapper, 0o755);
  };
  for (const name of ['git', 'stat', 'date']) {
    const real = system(name);
    if (real) wrap(name, real);
  }
  if (opts.node) wrap('node', process.execPath);
  if (opts.jq) {
    const real = system('jq');
    if (!real) throw new Error('buildFarm: jq is not installed');
    wrap('jq', real);
  }
  return { path: dir, log };
}

const invocations = (farm: Farm): string[] =>
  fs.existsSync(farm.log) ? fs.readFileSync(farm.log, 'utf-8').split('\n').filter(Boolean) : [];
const nodeAuditRuns = (farm: Farm): string[] => invocations(farm).filter(l => l.startsWith('node ') && l.includes(AUDIT_SCRIPT_NAME));

describe('session-start-context: Sections 5 and 6', () => {
  let tmp: string;
  let home: string;
  let repo: string;
  let plain: string;
  let machine: string;
  let hook: string;
  let scriptsRoot: string;
  let farm: Farm;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-sc-compact-')));
    home = path.join(tmp, 'home');
    machine = path.join(home, '.devflow');
    fs.mkdirSync(path.join(machine, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    repo = path.join(tmp, 'repo');
    const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf-8' });
    expect(init.status, `git init failed: ${init.stderr}`).toBe(0);
    plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    scriptsRoot = SCRIPTS_DIR;
    hook = path.join(HOOKS_DIR, 'session-start-context');
    farm = buildFarm(tmp, { jq: HAS_JQ, node: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const stamp = (): string => path.join(machine, STAMP_NAME);
  const readStamp = (): string => fs.readFileSync(stamp(), 'utf-8');
  const write = (abs: string, content: string): string => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  };

  /** Run the hook from `cwd` with `source`; `env` extends the neutral environment. */
  function run(cwd: string, source: string | undefined, env: Record<string, string> = {}, pathValue: string = farm.path) {
    const payload: Record<string, unknown> = { cwd, session_id: 'test-session' };
    if (source !== undefined) payload.source = source;
    return runHook(hook, payload, home, { CLAUDE_CONFIG_DIR: '', PATH: pathValue, ...env });
  }

  interface Envelope {
    hookSpecificOutput?: { hookEventName: string; additionalContext: string };
    systemMessage?: string;
  }
  const envelopeOf = (stdout: string): Envelope | null => (stdout.trim() === '' ? null : (JSON.parse(stdout) as Envelope));
  const contextOf = (stdout: string): string => envelopeOf(stdout)?.hookSpecificOutput?.additionalContext ?? '';
  const messageOf = (stdout: string): string => envelopeOf(stdout)?.systemMessage ?? '';

  /** Seed a flagged global import: ~/.claude/CLAUDE.md -> ~/big.md (10,001 bytes). */
  function seedFlaggedGlobal(size = 10001): string {
    write(path.join(home, '.claude', 'CLAUDE.md'), '@~/big.md\n');
    return write(path.join(home, 'big.md'), filler(size));
  }
  const findingLine = (file: string, size = 10001): string =>
    `CLAUDE.md import audit: ${file} is ${size.toLocaleString('en-US')} bytes (over the 10,000-byte import threshold).`;

  /** Move a file's mtime well past the stamp's (whole-second resolution) without touching its bytes. */
  function bumpMtime(file: string, secondsAhead = 5): void {
    const when = Math.floor(Date.now() / 1000) + secondsAhead;
    fs.utimesSync(file, when, when);
  }

  // ═══ Section 5: the compaction resume directive ═══════════════════════════════

  describe('Section 5: the compaction resume directive', () => {
    const directive = (stdout: string): string => contextOf(stdout);

    it('AC-401: a compact start emits an ASCII directive of at most 250 characters, in additionalContext', () => {
      const { stdout, exitCode } = run(plain, 'compact');
      expect(exitCode).toBe(0);
      const env = envelopeOf(stdout);
      expect(env?.hookSpecificOutput?.hookEventName).toBe('SessionStart');
      const text = directive(stdout);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/^[\x20-\x7e]+$/);
      expect(text.length).toBeLessThanOrEqual(COMPACT_DIRECTIVE_MAX_CHARS);
    }, NODE_RUN_MS);

    it('AC-401: the ceiling in numeric-floors.json is 250 and is pinned by this file\'s constant', () => {
      const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures', 'numeric-floors.json'), 'utf-8')) as {
        ceilings: Array<Record<string, unknown>>;
      };
      const entry = manifest.ceilings.find(e => e.id === 'compact-directive-max-chars');
      expect(entry).toMatchObject({
        ceiling: COMPACT_DIRECTIVE_MAX_CHARS,
        pattern: `const COMPACT_DIRECTIVE_MAX_CHARS = ${COMPACT_DIRECTIVE_MAX_CHARS};`,
        sourceFile: 'tests/session-start-compact.test.ts',
      });
      expect(directive(run(plain, 'compact').stdout).length).toBeLessThanOrEqual(Number(entry?.ceiling));
    }, NODE_RUN_MS);

    it('AC-402: the directive carries each required element (a) to (e)', () => {
      const text = directive(run(plain, 'compact').stdout);
      // (a) conditional on a devflow command having been running, with an ignore clause
      expect(text).toMatch(/^If a devflow command was running:/);
      expect(text).toMatch(/Else ignore\.$/);
      // (b) the command file by rule: commands/devflow/ under the Claude config directory
      expect(text).toContain('commands/devflow/<name>.md');
      expect(text).toContain('$CLAUDE_CONFIG_DIR');
      expect(text).toContain('~/.claude');
      // (c) read mechanics: list the headings, read from the phase in progress
      expect(text).toContain('list headings');
      expect(text).toMatch(/read from (the )?current phase/);
      // (d) the input comes from the summary, under either name the commands use
      expect(text).toMatch(/take input \(COMMAND_INPUT[/ ]+(or )?ARGUMENTS\) from the summary/);
      // (e) resume after the last finished phase
      expect(text).toContain('resume after the last finished phase');
    }, NODE_RUN_MS);

    it('AC-403: byte-identical across different HOMEs and absolute CLAUDE_CONFIG_DIR values; nothing interpolated', () => {
      const first = directive(run(plain, 'compact', { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude-a') }).stdout);
      const otherHome = fs.mkdtempSync(path.join(tmp, 'other-home-'));
      fs.mkdirSync(path.join(otherHome, '.devflow', 'logs'), { recursive: true });
      const second = directive(
        runHook(hook, { cwd: plain, session_id: 's', source: 'compact' }, otherHome, { PATH: farm.path, CLAUDE_CONFIG_DIR: path.join(tmp, 'claude-b') }).stdout,
      );
      expect(first).toBe(second);
      expect(first).not.toContain(tmp);
      expect(first).not.toContain(home);
      expect(first).not.toContain('claude-a');
    }, NODE_RUN_MS * 2);

    it('AC-403: no $ARGUMENTS placeholder, no unconditional running-command claim, no whole-file read order', () => {
      const text = directive(run(plain, 'compact').stdout);
      expect(text).not.toContain('$ARGUMENTS');
      // Every mention of a running command sits behind the if-clause.
      expect(text.replace(/^If a devflow command was running:/, '')).not.toMatch(/command (is|was) running/);
      expect(text).not.toMatch(/\b(read|re-read) (the )?(whole|entire|full) /i);
      expect(text).not.toMatch(/read (it|the file|the command) (in full|fully)/i);
    }, NODE_RUN_MS);

    it('AC-404: shares one valid additionalContext envelope with the Section 1 decisions block when learning is on', () => {
      fs.mkdirSync(path.join(repo, '.devflow', 'learning'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.devflow', 'learning', 'decisions.md'), '<!-- TL;DR: 2 decisions. Key: ADR-001 -->\n# Decisions\n');
      const { stdout } = run(repo, 'compact');
      const ctx = contextOf(stdout);
      expect(ctx).toContain('--- PROJECT DECISIONS (TL;DR) ---');
      expect(ctx).toContain('If a devflow command was running:');
      expect(ctx.indexOf('--- PROJECT DECISIONS')).toBeLessThan(ctx.indexOf('If a devflow command was running:'));
      expect(stdout.trim().split('\n').length).toBeGreaterThan(1); // one pretty JSON document
      expect(() => JSON.parse(stdout)).not.toThrow();
    }, NODE_RUN_MS);

    it('emits in a non-git directory too: the directive does no project work (OQ5)', () => {
      expect(directive(run(plain, 'compact').stdout)).toContain('If a devflow command was running:');
    }, NODE_RUN_MS);

    it.each([
      ['startup', 'startup'], ['resume', 'resume'], ['clear', 'clear'],
      ['an absent source', undefined], ['an unrecognised source', 'bogus'], ['an empty source', ''],
      ['a near miss', 'compacted'], ['a differently cased source', 'COMPACT'],
    ])('AC-405: %s emits no directive', (_label, source) => {
      expect(directive(run(plain, source as string | undefined).stdout)).not.toContain('If a devflow command was running:');
    }, NODE_RUN_MS);

    it('AC-405: Sections 3 and 4 still gate on startup and clear only, and compact adds only the directive', () => {
      write(path.join(repo, '.claude', 'settings.json'), JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${repo}/.devflow/scripts/hooks/run-hook session-start-context`, timeout: 10 }] }] },
      }));
      const notice = 'retired project-local devflow install';
      expect(contextOf(run(repo, 'startup').stdout)).toContain(notice);
      expect(contextOf(run(repo, 'clear').stdout)).toContain(notice);
      const compact = contextOf(run(repo, 'compact').stdout);
      expect(compact).not.toContain(notice);
      expect(compact).toContain('If a devflow command was running:');
    }, NODE_RUN_MS * 3);

    it('still emits when the audit cannot run (no node on PATH)', () => {
      const noNode = buildFarm(tmp, { jq: HAS_JQ, node: false });
      if (!HAS_JQ) return; // with neither tool the hook returns before Section 5 (documented)
      const { stdout, exitCode } = run(plain, 'compact', {}, noNode.path);
      expect(exitCode).toBe(0);
      expect(directive(stdout)).toContain('If a devflow command was running:');
      expect(fs.existsSync(stamp())).toBe(false);
    }, NODE_RUN_MS);

    it('with neither jq nor node the hook exits 0 with nothing (Section 5 cannot emit; accepted and documented)', () => {
      const neither = buildFarm(tmp, { jq: false, node: false });
      const { stdout, exitCode } = run(plain, 'compact', {}, neither.path);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    }, NODE_RUN_MS);
  });

  // ═══ Section 6: the audit, its systemMessage and its stamp ═════════════════════

  describe('Section 6: the audit and its systemMessage', () => {
    const backends: Array<{ name: string; skip: boolean; jq: boolean }> = [
      { name: 'jq', skip: !HAS_JQ, jq: true },
      { name: 'no-jq (json-helper.cjs)', skip: false, jq: false },
    ];

    describe.each(backends)('on the $name path', ({ skip, jq }) => {
      let backendFarm: Farm;
      beforeEach(() => {
        backendFarm = buildFarm(tmp, { jq, node: true });
      });
      const go = (cwd: string, source = 'startup') => run(cwd, source, {}, backendFarm.path);

      it.skipIf(skip)('AC-421: a flagged import with no stamp makes the first start emit a top-level systemMessage naming file and size', () => {
        const big = seedFlaggedGlobal();
        const { stdout, exitCode } = go(plain);
        expect(exitCode).toBe(0);
        expect(messageOf(stdout)).toBe(findingLine(big));
        // No context at all in a plain directory: the envelope carries systemMessage alone.
        const env = envelopeOf(stdout) as Envelope;
        expect(Object.keys(env)).toEqual(['systemMessage']);
      }, NODE_RUN_MS * 2);

      it.skipIf(skip)('AC-421: with a context to inject the envelope carries both keys, and the audit text is not in the context (AC-422)', () => {
        const big = seedFlaggedGlobal();
        const { stdout } = go(repo, 'compact');
        const env = envelopeOf(stdout) as Envelope;
        expect(Object.keys(env)).toEqual(['hookSpecificOutput', 'systemMessage']);
        expect(env.systemMessage).toBe(findingLine(big));
        expect(env.hookSpecificOutput?.additionalContext).toContain('If a devflow command was running:');
        expect(env.hookSpecificOutput?.additionalContext).not.toContain('import audit');
        expect(env.hookSpecificOutput?.additionalContext).not.toContain('big.md');
      }, NODE_RUN_MS * 2);

      it.skipIf(skip)('writes the stamp after the first run and records the displayed key', () => {
        const big = seedFlaggedGlobal();
        go(plain);
        const text = readStamp();
        expect(text.split('\n')[0]).toBe('V 1');
        expect(text).toContain(`R ${path.join(home, '.claude', 'CLAUDE.md')}`);
        expect(text).toContain(`P 1 ${big}`);
        expect(text).toMatch(new RegExp(`^K file 10001 \\d+ ${big.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
        expect(text).not.toContain('E audit-failed');
      }, NODE_RUN_MS * 2);
    });

    it.skipIf(!HAS_JQ)('AC-422: a second start with the same file, size and mtime emits no systemMessage and starts no node process', () => {
      seedFlaggedGlobal();
      expect(messageOf(run(plain, 'startup').stdout)).not.toBe('');
      expect(nodeAuditRuns(farm)).toHaveLength(1);
      fs.rmSync(farm.log);
      const second = run(plain, 'startup');
      expect(second.exitCode).toBe(0);
      expect(messageOf(second.stdout)).toBe('');
      expect(invocations(farm).filter(l => l.startsWith('node '))).toEqual([]);
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('an unchanged start forks nothing for the audit: it costs what a start without node costs', () => {
      seedFlaggedGlobal();
      run(plain, 'startup'); // the changed start: writes the stamp
      fs.rmSync(farm.log);
      run(plain, 'startup');
      const unchanged = invocations(farm).map(l => l.split(' ')[0]).sort();

      // Control: the same start with the audit unable to run at all (no node on PATH).
      const noNode = buildFarm(tmp, { jq: true, node: false });
      run(plain, 'startup', {}, noNode.path);
      const withoutAudit = invocations(noNode).map(l => l.split(' ')[0]).sort();
      expect(unchanged).toEqual(withoutAudit);
      // Non-vacuity: the counter sees forks at all.
      expect(unchanged.length).toBeGreaterThan(0);
    }, NODE_RUN_MS * 3);

    it.skipIf(!HAS_JQ)('with no CLAUDE.md anywhere there is nothing to audit: the stamp is recorded with builtins and node is never started', () => {
      const first = run(plain, 'startup');
      expect(first.exitCode).toBe(0);
      expect(first.stdout.trim()).toBe('');
      const globalRoot = path.join(home, '.claude', 'CLAUDE.md');
      expect(readStamp()).toBe(`V 1\nR ${globalRoot}\nP 0 ${globalRoot}\n`);
      expect(invocations(farm).filter(l => l.startsWith('node '))).toEqual([]);
      fs.rmSync(farm.log);
      run(plain, 'startup');
      expect(invocations(farm).filter(l => l.startsWith('node '))).toEqual([]);
      // A CLAUDE.md appearing at a recorded-absent root is a change: the audit runs.
      write(globalRoot, '# hello\n');
      run(plain, 'startup');
      expect(nodeAuditRuns(farm)).toHaveLength(1);
      expect(readStamp()).toContain(`P 1 ${globalRoot}`);
    }, NODE_RUN_MS * 3);

    it.skipIf(!HAS_JQ)('the stamp the shell writes for absent roots is the stamp the script would render, keys kept', () => {
      const loaded = loadClaudeMdAuditModule();
      if (!loaded.ok) throw new Error('audit script does not load');
      const globalRoot = path.join(home, '.claude', 'CLAUDE.md');
      fs.writeFileSync(stamp(), loaded.value.renderStamp({ roots: ['/elsewhere/CLAUDE.md'], examined: [], keys: ['file 1 2 /kept', 'chain 3 4 /kept-too'] }));
      run(plain, 'startup');
      expect(readStamp()).toBe(loaded.value.renderStamp({
        roots: [globalRoot],
        examined: [{ path: globalRoot, flag: 0 }],
        keys: ['file 1 2 /kept', 'chain 3 4 /kept-too'],
      }));
    }, NODE_RUN_MS);

    it.skipIf(!HAS_JQ)('a CLAUDE.md with nothing flagged still records the stamp, so the next unchanged start is free', () => {
      const claude = write(path.join(home, '.claude', 'CLAUDE.md'), '# small\n');
      const first = run(plain, 'startup');
      expect(first.stdout.trim()).toBe('');
      expect(readStamp()).toContain(`P 1 ${claude}`);
      expect(nodeAuditRuns(farm)).toHaveLength(1);
      fs.rmSync(farm.log);
      run(plain, 'startup');
      expect(invocations(farm).filter(l => l.startsWith('node '))).toEqual([]);
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('AC-423: after the flagged file\'s size changes, the next start emits the message again', () => {
      const big = seedFlaggedGlobal();
      expect(messageOf(run(plain, 'startup').stdout)).toBe(findingLine(big));
      expect(messageOf(run(plain, 'startup').stdout)).toBe('');
      write(big, filler(10500));
      bumpMtime(big);
      expect(messageOf(run(plain, 'startup').stdout)).toBe(findingLine(big, 10500));
      expect(nodeAuditRuns(farm)).toHaveLength(2);
    }, NODE_RUN_MS * 4);

    it.skipIf(!HAS_JQ)('AC-423: after only the flagged file\'s mtime changes, the next start emits the message again', () => {
      const big = seedFlaggedGlobal();
      run(plain, 'startup');
      expect(messageOf(run(plain, 'startup').stdout)).toBe('');
      bumpMtime(big);
      expect(messageOf(run(plain, 'startup').stdout)).toBe(findingLine(big));
    }, NODE_RUN_MS * 3);

    it.skipIf(!HAS_JQ)('a file imported into the chain being created, edited or removed re-runs the audit', () => {
      write(path.join(home, '.claude', 'CLAUDE.md'), '@~/later.md\n');
      run(plain, 'startup'); // later.md is absent: recorded as a P 0 row
      fs.rmSync(farm.log);
      run(plain, 'startup');
      expect(invocations(farm).filter(l => l.startsWith('node '))).toEqual([]);
      const later = write(path.join(home, 'later.md'), filler(10001));
      expect(messageOf(run(plain, 'startup').stdout)).toBe(findingLine(later));
      fs.rmSync(later);
      run(plain, 'startup');
      expect(nodeAuditRuns(farm).length).toBeGreaterThanOrEqual(2);
    }, NODE_RUN_MS * 5);

    it.skipIf(!HAS_JQ)('AC-424: a flagged CLAUDE.md in git project B is reported on the first start in B, after an audit in a non-git directory', () => {
      write(path.join(repo, 'CLAUDE.md'), '@big.md\n');
      const big = write(path.join(repo, 'big.md'), filler(10001));
      expect(messageOf(run(plain, 'startup').stdout)).toBe('');
      expect(readStamp()).not.toContain(repo); // the first audit saw only the global root
      expect(messageOf(run(repo, 'startup').stdout)).toBe(findingLine(big));
      expect(readStamp()).toContain(`R ${repo}/CLAUDE.md`);
    }, NODE_RUN_MS * 4);

    it.skipIf(!HAS_JQ)('the three project roots are audited in a git project: .claude/CLAUDE.md and CLAUDE.local.md too', () => {
      write(path.join(repo, '.claude', 'CLAUDE.md'), '@../a.md\n');
      write(path.join(repo, 'CLAUDE.local.md'), '@b.md\n');
      const a = write(path.join(repo, 'a.md'), filler(10001));
      const b = write(path.join(repo, 'b.md'), filler(10002));
      const lines = messageOf(run(repo, 'startup').stdout).split('\n');
      expect(lines).toContain(findingLine(a));
      expect(lines).toContain(findingLine(b, 10002));
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('AC-425: a finding already shown is not shown again after a session in another project and a return', () => {
      write(path.join(repo, 'CLAUDE.md'), '@big.md\n');
      const big = write(path.join(repo, 'big.md'), filler(10001));
      const other = path.join(tmp, 'other');
      spawnSync('git', ['init', '-q', other], { encoding: 'utf-8' });
      expect(messageOf(run(repo, 'startup').stdout)).toBe(findingLine(big));
      expect(messageOf(run(other, 'startup').stdout)).toBe('');
      fs.rmSync(farm.log);
      const back = run(repo, 'startup');
      expect(messageOf(back.stdout)).toBe('');
      // The root set differs from the one recorded last, so the audit ran again; the key held back the message.
      expect(nodeAuditRuns(farm)).toHaveLength(1);
      expect(readStamp()).toContain(`K file 10001 `);
    }, NODE_RUN_MS * 5);

    it.skipIf(!HAS_JQ)('a project\'s roots are not audited outside a git project, or at the home directory itself', () => {
      write(path.join(plain, 'CLAUDE.md'), '@big.md\n');
      write(path.join(plain, 'big.md'), filler(10001));
      expect(messageOf(run(plain, 'startup').stdout)).toBe('');
      expect(readStamp()).not.toContain(plain);
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('AC-431: a stamp written by the init-side facade means the first start emits no message for that key', async () => {
      const big = seedFlaggedGlobal();
      const claudeDir = path.join(home, '.claude');
      const audit = await runClaudeMdAudit({ claudeDir, projectRoot: null, home, devflowDir: machine });
      expect(audit.ok && audit.value.lines).toEqual([findingLine(big)]);
      if (!audit.ok) return;
      expect((await writeClaudeMdAuditStamp(machine, audit.value.stamp)).ok).toBe(true);
      const { stdout } = run(plain, 'startup');
      expect(messageOf(stdout)).toBe('');
      // The facade recorded the same root set the hook computes, so even the audit was skipped.
      expect(nodeAuditRuns(farm)).toEqual([]);
      expect(audit.value.stamp).toContain(`R ${claudeMdAuditRoots(claudeDir, null)[0]}`);
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('honours an absolute CLAUDE_CONFIG_DIR for the global root and ignores a relative one', () => {
      const custom = path.join(tmp, 'custom-claude');
      write(path.join(custom, 'CLAUDE.md'), '@~/big.md\n');
      const big = write(path.join(home, 'big.md'), filler(10001));
      expect(messageOf(run(plain, 'startup', { CLAUDE_CONFIG_DIR: custom }).stdout)).toBe(findingLine(big));
      fs.rmSync(stamp());
      expect(messageOf(run(plain, 'startup', { CLAUDE_CONFIG_DIR: 'relative/dir' }).stdout)).toBe('');
      expect(readStamp()).toContain(`R ${path.join(home, '.claude', 'CLAUDE.md')}`);
    }, NODE_RUN_MS * 3);
  });

  // ═══ Failure modes (AC-426) ═══════════════════════════════════════════════════

  describe('AC-426: Sections 5 and 6 add no new exit path', () => {
    /** A private copy of the scripts tree whose audit script can be sabotaged. */
    function copyScripts(): string {
      const root = path.join(tmp, 'scripts-copy');
      fs.cpSync(SCRIPTS_DIR, root, { recursive: true });
      hook = path.join(root, 'hooks', 'session-start-context');
      scriptsRoot = root;
      return root;
    }
    const auditScript = (): string => path.join(scriptsRoot, AUDIT_SCRIPT_NAME);

    it.skipIf(!HAS_JQ)('a throwing audit script: exit 0, valid JSON, Section 5 still emits, nothing shown, and a second start forks no node', () => {
      copyScripts();
      fs.writeFileSync(auditScript(), "throw new Error('boom');\n");
      seedFlaggedGlobal();
      const first = run(plain, 'compact');
      expect(first.exitCode).toBe(0);
      expect(contextOf(first.stdout)).toContain('If a devflow command was running:');
      expect(messageOf(first.stdout)).toBe('');
      expect(nodeAuditRuns(farm)).toHaveLength(1);
      const text = readStamp();
      expect(text).toContain('E audit-failed');
      expect(text).toContain(`R ${path.join(home, '.claude', 'CLAUDE.md')}`);
      expect(text).not.toMatch(/^P /m);
      const loaded = loadClaudeMdAuditModule();
      if (!loaded.ok) throw new Error('audit script does not load');
      expect(text).toBe(loaded.value.renderStamp({ roots: [path.join(home, '.claude', 'CLAUDE.md')], examined: [], keys: [], error: true }));

      fs.rmSync(farm.log);
      const second = run(plain, 'compact');
      expect(second.exitCode).toBe(0);
      expect(contextOf(second.stdout)).toContain('If a devflow command was running:');
      expect(invocations(farm).filter(l => l.startsWith('node '))).toEqual([]);
    }, NODE_RUN_MS * 3);

    it.skipIf(!HAS_JQ)('a missing audit script: the same, and a changed root set retries', () => {
      copyScripts();
      fs.rmSync(auditScript());
      write(path.join(home, '.claude', 'CLAUDE.md'), '# present\n');
      const first = run(plain, 'startup');
      expect(first.exitCode).toBe(0);
      expect(first.stdout.trim()).toBe('');
      expect(readStamp()).toContain('E audit-failed');
      fs.rmSync(farm.log);
      run(plain, 'startup');
      expect(nodeAuditRuns(farm)).toEqual([]);
      // A changed root set (now a git project) is a change to the recorded root rows: one retry.
      run(repo, 'startup');
      expect(nodeAuditRuns(farm)).toHaveLength(1);
    }, NODE_RUN_MS * 4);

    it.skipIf(!HAS_JQ)('a failure keeps the finding keys already displayed', () => {
      const big = seedFlaggedGlobal();
      run(plain, 'startup'); // shows and records the key
      const keyRow = readStamp().split('\n').find(l => l.startsWith('K '));
      expect(keyRow).toContain(big);
      copyScripts();
      fs.writeFileSync(auditScript(), "throw new Error('boom');\n");
      run(repo, 'startup'); // changed root set -> runs the broken script
      const text = readStamp();
      expect(text).toContain('E audit-failed');
      expect(text).toContain(keyRow as string);
    }, NODE_RUN_MS * 4);

    it.skipIf(!HAS_JQ)('a script that exits 0 but prints no framed block is a failure, not a message', () => {
      copyScripts();
      fs.writeFileSync(auditScript(), "console.log('M CLAUDE.md import audit: forged');\n");
      write(path.join(home, '.claude', 'CLAUDE.md'), '# present\n');
      const { stdout, exitCode } = run(plain, 'startup');
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
      expect(readStamp()).toContain('E audit-failed');
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('an unreadable CLAUDE.md fails nothing: exit 0, Section 5 emits, no message', () => {
      if (process.getuid?.() === 0) return;
      const claude = write(path.join(home, '.claude', 'CLAUDE.md'), '@~/big.md\n');
      write(path.join(home, 'big.md'), filler(10001));
      fs.chmodSync(claude, 0o000);
      try {
        const { stdout, exitCode } = run(plain, 'compact');
        expect(exitCode).toBe(0);
        expect(contextOf(stdout)).toContain('If a devflow command was running:');
        expect(messageOf(stdout)).toBe('');
        expect(readStamp()).not.toContain('E audit-failed');
      } finally {
        fs.chmodSync(claude, 0o644);
      }
    }, NODE_RUN_MS * 2);

    it('no node on PATH: the audit is skipped silently, no stamp is written, and the hook exits 0', () => {
      if (!HAS_JQ) return;
      seedFlaggedGlobal();
      const noNode = buildFarm(tmp, { jq: true, node: false });
      const { stdout, exitCode } = run(plain, 'startup', {}, noNode.path);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
      expect(fs.existsSync(stamp())).toBe(false);
    }, NODE_RUN_MS);
  });

  // ═══ The stamp's safety (AC-437's hook half, D-AUDIT-STAMP) ═══════════════════

  describe('the stamp file', () => {
    it.skipIf(!HAS_JQ)('the stamp logic never creates the machine root: where ~/.devflow is not a directory the audit is skipped', () => {
      // The hook's own logging makes ~/.devflow/logs on a bare machine (existing behaviour), so a
      // missing root cannot be staged; a root that is not a directory is the same `-d` test failing.
      fs.rmSync(machine, { recursive: true });
      fs.writeFileSync(machine, 'not a directory\n');
      seedFlaggedGlobal();
      const { stdout, exitCode } = run(plain, 'startup');
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
      expect(fs.readFileSync(machine, 'utf-8')).toBe('not a directory\n');
      expect(nodeAuditRuns(farm)).toEqual([]);
    }, NODE_RUN_MS);

    it('Section 6 holds no mkdir of the machine root', () => {
      const text = fs.readFileSync(path.join(HOOKS_DIR, 'session-start-context'), 'utf-8');
      const section = text.slice(text.indexOf('# --- Section 6'), text.indexOf('# --- Output ---'));
      expect(section).not.toMatch(/\bmkdir\b/);
    });

    it.skipIf(!HAS_JQ)('a symlinked stamp path: the audit is skipped and nothing is written through the link', () => {
      seedFlaggedGlobal();
      const victim = write(path.join(tmp, 'victim.txt'), 'precious\n');
      fs.symlinkSync(victim, stamp());
      const { stdout, exitCode } = run(plain, 'startup');
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
      expect(fs.readFileSync(victim, 'utf-8')).toBe('precious\n');
      expect(fs.lstatSync(stamp()).isSymbolicLink()).toBe(true);
      expect(nodeAuditRuns(farm)).toEqual([]);
    }, NODE_RUN_MS);

    it.skipIf(!HAS_JQ)('a stamp path that is a directory: the audit is skipped and the directory is left alone', () => {
      seedFlaggedGlobal();
      fs.mkdirSync(stamp());
      const { stdout, exitCode } = run(plain, 'startup');
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
      expect(fs.readdirSync(stamp())).toEqual([]);
      expect(nodeAuditRuns(farm)).toEqual([]);
    }, NODE_RUN_MS);

    it.skipIf(!HAS_JQ)('a link planted at the stamp path WHILE the audit runs is still refused at the write', () => {
      seedFlaggedGlobal();
      const victim = write(path.join(tmp, 'victim.txt'), 'precious\n');
      // The node wrapper runs the real audit, then plants the link: the window between the fast-path check and the write.
      const wrapper = path.join(farm.path, 'node');
      fs.writeFileSync(
        wrapper,
        `#!/bin/bash\n${JSON.stringify(process.execPath)} "$@"\nrc=$?\nln -s ${JSON.stringify(victim)} ${JSON.stringify(stamp())}\nexit $rc\n`,
      );
      const { exitCode } = run(plain, 'startup');
      expect(exitCode).toBe(0);
      expect(fs.readFileSync(victim, 'utf-8')).toBe('precious\n');
      expect(fs.lstatSync(stamp()).isSymbolicLink()).toBe(true);
      expect(fs.readdirSync(machine).filter(n => n.includes('.tmp.'))).toEqual([]);
    }, NODE_RUN_MS);

    it.skipIf(!HAS_JQ)('a dangling symlink at the stamp path is a link: refused', () => {
      seedFlaggedGlobal();
      fs.symlinkSync(path.join(tmp, 'not-there'), stamp());
      run(plain, 'startup');
      expect(fs.existsSync(path.join(tmp, 'not-there'))).toBe(false);
      expect(nodeAuditRuns(farm)).toEqual([]);
    }, NODE_RUN_MS);

    it.skipIf(!HAS_JQ)('a stamp over 256 KiB is read as absent: the audit runs and the stamp is replaced', () => {
      seedFlaggedGlobal();
      fs.writeFileSync(stamp(), `V 1\n${'K file 1 1 /old\n'.repeat(20000)}`);
      expect(fs.statSync(stamp()).size).toBeGreaterThan(262144);
      expect(messageOf(run(plain, 'startup').stdout)).not.toBe('');
      expect(fs.statSync(stamp()).size).toBeLessThan(2000);
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('a stamp that does not open with the version row is read as absent', () => {
      seedFlaggedGlobal();
      fs.writeFileSync(stamp(), 'R /somewhere\nnot a stamp\n');
      expect(messageOf(run(plain, 'startup').stdout)).not.toBe('');
      expect(readStamp().split('\n')[0]).toBe('V 1');
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('is written owner-only whatever the runner\'s umask, through a temp file that does not linger', () => {
      const previous = process.umask(0o022);
      try {
        seedFlaggedGlobal();
        run(plain, 'startup');
        expect(fs.statSync(stamp()).mode & 0o777).toBe(0o600);
        expect(fs.readdirSync(machine).filter(n => n.includes('.tmp.'))).toEqual([]);
      } finally {
        process.umask(previous);
      }
    }, NODE_RUN_MS * 2);

    it.skipIf(!HAS_JQ)('a stale temp file of the same name makes the write give way rather than clobber it', () => {
      seedFlaggedGlobal();
      // Pre-plant every plausible temp name: the hook's pid is unknown, so occupy a FIFO-free decoy set.
      const decoy = write(path.join(machine, `${STAMP_NAME}.tmp.decoy`), 'untouched\n');
      run(plain, 'startup');
      expect(fs.readFileSync(decoy, 'utf-8')).toBe('untouched\n');
      expect(fs.existsSync(stamp())).toBe(true);
    }, NODE_RUN_MS);

    it.skipIf(!HAS_JQ)('rewrites an existing regular stamp in place of its name', () => {
      seedFlaggedGlobal();
      run(plain, 'startup');
      const firstInode = fs.statSync(stamp()).ino;
      const big = path.join(home, 'big.md');
      write(big, filler(10600));
      bumpMtime(big);
      run(plain, 'startup');
      expect(readStamp()).toContain('file 10600 ');
      expect(fs.statSync(stamp()).isFile()).toBe(true);
      expect(typeof firstInode).toBe('number');
    }, NODE_RUN_MS * 3);

    it.skipIf(!HAS_JQ)('a root path holding a control byte is never recorded: the project re-audits at every start', () => {
      const odd = path.join(tmp, 'od\nd');
      spawnSync('git', ['init', '-q', odd], { encoding: 'utf-8' });
      write(path.join(odd, 'CLAUDE.md'), '@big.md\n');
      write(path.join(odd, 'big.md'), filler(10001));
      run(odd, 'startup');
      expect(readStamp()).not.toContain('od');
      fs.rmSync(farm.log);
      const second = run(odd, 'startup');
      expect(second.exitCode).toBe(0);
      expect(nodeAuditRuns(farm)).toHaveLength(1);
    }, NODE_RUN_MS * 3);
  });

  // ═══ Static pins ═════════════════════════════════════════════════════════════

  describe('the hook source', () => {
    const source = (): string => fs.readFileSync(path.join(HOOKS_DIR, 'session-start-context'), 'utf-8');

    it('AC-436: carries the D-names at its code sites', () => {
      const text = source();
      for (const name of ['D-COMPACT-RESUME-DIRECTIVE', 'D-CLAUDE-MD-IMPORT-AUDIT', 'D-AUDIT-STAMP', 'D-SYSTEMMESSAGE-ENVELOPE']) {
        expect(text, name).toContain(name);
      }
    });

    it('AC-436: every D-name sits at the code site that implements it', () => {
      const root = path.resolve(import.meta.dirname, '..');
      const sites: Array<[string, string[]]> = [
        ['src/core/flags.ts', ['D-AUTO-COMPACT-WINDOW-OPT-IN']],
        ['src/assets/scripts/claude-md-audit.cjs', ['D-CLAUDE-MD-IMPORT-AUDIT', 'D-AUDIT-STAMP']],
        ['src/core/claude-md-audit.ts', ['D-CLAUDE-MD-IMPORT-AUDIT', 'D-AUDIT-STAMP']],
        ['src/assets/scripts/hooks/json-parse', ['D-SYSTEMMESSAGE-ENVELOPE']],
        ['src/assets/scripts/hooks/json-helper.cjs', ['D-SYSTEMMESSAGE-ENVELOPE']],
      ];
      for (const [file, names] of sites) {
        const text = fs.readFileSync(path.join(root, file), 'utf-8');
        for (const name of names) expect(text, `${file} carries ${name}`).toContain(name);
      }
    });

    it('its header lists Sections 5 and 6 and states that they add no exit path', () => {
      const header = source().slice(0, source().indexOf('# Safe no-op fallback'));
      expect(header).toContain('# Section 5:');
      expect(header).toContain('# Section 6:');
      expect(header).toMatch(/add NO new exit path/);
    });

    it('Section 5 is a positive compact case; Sections 3 and 4 keep their startup|clear cases', () => {
      const text = source();
      expect(text).toMatch(/case "\$SESSION_SOURCE" in\n  compact\)/);
      expect(text).toContain('startup|clear) ;;');
      expect(text).toContain('        startup|clear)\n          dbg "legacy project-local install notice emitted"');
    });

    it('the directive is single-quoted, so $CLAUDE_CONFIG_DIR is not expanded', () => {
      const line = source().split('\n').find(l => l.trim().startsWith("COMPACT_SECTION='"));
      expect(line).toBeDefined();
      expect(line).toContain("{$CLAUDE_CONFIG_DIR or ~/.claude}");
    });

    it('Sections 5 and 6 and the audit helpers contain no `exit`', () => {
      const text = source();
      const from = text.indexOf('# --- Section 5');
      const to = text.indexOf('# --- Output ---');
      expect(from).toBeGreaterThan(-1);
      expect(text.slice(from, to)).not.toMatch(/^\s*exit\b/m);
    });

    it('every audit helper ends in an explicit return, so a caller under errexit survives the normal path', () => {
      const text = source();
      for (const fn of ['_sc_audit_stamp_blocked', '_sc_audit_stamp_fresh', '_sc_audit_shell_stamp', '_sc_audit_no_root', '_sc_audit_run', '_sc_audit_record']) {
        const start = text.indexOf(`${fn}() {`);
        expect(start, fn).toBeGreaterThan(-1);
        const body = text.slice(start, text.indexOf('\n}\n', start));
        // The predicate answers with its own status; every other helper reports success.
        expect(body, fn).toMatch(fn === '_sc_audit_stamp_blocked' ? /return 1\s*$/ : /return 0\s*$/);
      }
    });
  });
});
