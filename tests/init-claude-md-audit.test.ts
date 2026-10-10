/**
 * `devflow init` and the CLAUDE.md import audit (D-CLAUDE-MD-IMPORT-AUDIT,
 * D-AUDIT-STAMP, D-INIT-REAL-OUTCOME). Covers AC-428 to AC-431.
 *
 * The audit prints after the install, as one note, on BOTH init paths: the Recommended
 * summary note prints before the install runs, and the Advanced path prints no
 * end-of-wizard summary, so the audit is neither's row. Both paths reach the one call
 * site, whose text comes from the one pure function `claudeMdAuditStep`, unit-tested here
 * the way `trackerOverrideMessage` is in init-logic.test.ts. The end-to-end half drives the
 * built CLI (`npm run build` first) under a temp HOME with the environment built from the
 * sandbox allowlist, never spread from the developer's own. A non-TTY `--advanced` run
 * exits 1 at the TTY guard, so no end-to-end Advanced run is asserted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { claudeMdAuditStep } from '../src/cli/commands/init.js';
import {
  CLAUDE_MD_AUDIT_STAMP_FILE,
  auditAndRecordClaudeMd,
  loadClaudeMdAuditModule,
  runClaudeMdAudit,
  type ClaudeMdAuditResult,
} from '../src/core/claude-md-audit.js';
import { requireBuiltCli, sandboxEnv } from './helpers.js';
import { HOOKS_DIR, runHook } from './shell-hooks-helpers.js';

const CLI = requireBuiltCli();
const INIT_TIMEOUT_MS = 120_000;
const filler = (n: number): string => 'x'.repeat(n);

describe('claudeMdAuditStep (the one pure function both init paths use)', () => {
  const resultWith = (lines: string[]): ClaudeMdAuditResult => ({
    ok: true, roots: [], findings: [], examined: [], filesExamined: 0, pathsExamined: 0,
    bytesRead: 0, truncated: false, lines, shown: [], stamp: 'V 1\n',
  });

  it('AC-429: the note names the file and its size', () => {
    const line = 'CLAUDE.md import audit: /home/me/big.md is 14,220 bytes (over the 10,000-byte import threshold).';
    const step = claudeMdAuditStep({ ok: true, value: resultWith([line]) });
    expect(step.degraded).toBeNull();
    expect(step.note).toContain('/home/me/big.md');
    expect(step.note).toContain('14,220 bytes');
  });

  it('several findings are one note, one line each', () => {
    const step = claudeMdAuditStep({ ok: true, value: resultWith(['one', 'two']) });
    expect(step.note).toBe('one\ntwo');
  });

  it('prints nothing when nothing is flagged (AC-428)', () => {
    expect(claudeMdAuditStep({ ok: true, value: resultWith([]) })).toEqual({ note: null, degraded: null });
  });

  it.each([
    [{ kind: 'load', detail: { kind: 'not-found', path: '/x/claude-md-audit.cjs' } } as const, /script not found/],
    [{ kind: 'load', detail: { kind: 'unusable', path: '/x/claude-md-audit.cjs', detail: 'boom' } } as const, /failed to load/],
    [{ kind: 'failed', detail: 'audit exploded' } as const, /the audit failed$/],
  ])('AC-430: a failure is exactly one degraded line and no note (%#)', (error, pattern) => {
    const step = claudeMdAuditStep({ ok: false, error });
    expect(step.note).toBeNull();
    expect(step.degraded).toMatch(/^CLAUDE\.md import audit unavailable: /);
    expect(step.degraded).toMatch(pattern);
    expect(step.degraded?.split('\n')).toHaveLength(1);
  });

  it('AC-430: the facade turns a broken script into a Result error, writes no stamp, and the step stays one line', async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-init-audit-unit-')));
    try {
      const scripts = path.join(tmp, 'scripts');
      fs.mkdirSync(scripts);
      fs.writeFileSync(path.join(scripts, 'claude-md-audit.cjs'), "throw new Error('boom');\n");
      const devflowDir = path.join(tmp, 'home', '.devflow');
      fs.mkdirSync(devflowDir, { recursive: true });
      const outcome = await auditAndRecordClaudeMd({ claudeDir: path.join(tmp, 'claude'), projectRoot: null, home: path.join(tmp, 'home'), devflowDir, scriptsDir: scripts });
      expect(outcome.ok).toBe(false);
      expect(claudeMdAuditStep(outcome).degraded).toMatch(/failed to load/);
      expect(fs.existsSync(path.join(devflowDir, CLAUDE_MD_AUDIT_STAMP_FILE))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('init.ts wiring (static)', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'cli', 'commands', 'init.ts'), 'utf-8');

  it('the audit step has ONE call site, after the install and after both path branches', () => {
    const calls = [...source.matchAll(/claudeMdAuditStep\(/g)].map(m => m.index as number);
    // The definition and the single use.
    expect(calls).toHaveLength(2);
    const use = calls[1];
    expect(use).toBeGreaterThan(source.indexOf("s.stop('Installation complete')"));
    expect(use).toBeGreaterThan(source.indexOf("p.note(summaryLines + `\\n\\nCustomize later"));
    expect(use).toBeGreaterThan(source.indexOf('Advanced path: full interactive flow'));
    expect(source.indexOf('auditAndRecordClaudeMd({')).toBeGreaterThan(source.indexOf("s.stop('Installation complete')"));
    expect(source.indexOf('auditAndRecordClaudeMd({')).toBeGreaterThan(source.indexOf('persistManifestThenConvergeTracker({'));
  });

  it('it audits the git toplevel the run targets (null at HOME), not the working directory', () => {
    expect(source).toMatch(/projectRoot: gitRoot,/);
  });
});

describe('devflow init: the audit note (end to end)', () => {
  let tmp: string;
  let home: string;
  let plain: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-init-audit-')));
    home = path.join(tmp, 'home');
    plain = path.join(tmp, 'plain');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(plain);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const write = (abs: string, content: string): string => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  };

  /** `init --recommended` in `cwd` under the temp HOME. */
  function runInit(cwd: string, extraArgs: string[] = []) {
    const result = spawnSync(
      process.execPath,
      [CLI, 'init', '--recommended', '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules', ...extraArgs],
      { cwd, encoding: 'utf-8', timeout: INIT_TIMEOUT_MS, env: sandboxEnv(home), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.error) throw result.error;
    return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }
  const stamp = (): string => path.join(home, '.devflow', CLAUDE_MD_AUDIT_STAMP_FILE);
  const seedFlaggedGlobal = (size = 10001): string => {
    write(path.join(home, '.claude', 'CLAUDE.md'), '@~/big.md\n');
    return write(path.join(home, 'big.md'), filler(size));
  };
  /** The stdout of a SessionStart hook run, parsed. */
  function hookEnvelope(cwd: string): { systemMessage?: string } | null {
    const { stdout, exitCode } = runHook(path.join(HOOKS_DIR, 'session-start-context'), { cwd, session_id: 'after-init', source: 'startup' }, home, { CLAUDE_CONFIG_DIR: '' });
    expect(exitCode).toBe(0);
    return stdout.trim() === '' ? null : JSON.parse(stdout);
  }

  it('AC-428: a flagged import is named, with its size, in one note after the install', () => {
    const big = seedFlaggedGlobal();
    const { status, out } = runInit(plain);
    expect(status, out).toBe(0);
    expect(out).toContain('CLAUDE.md import audit');
    expect(out).toContain(`${big} is 10,001 bytes`);
    expect(out).toContain('over the 10,000-byte import threshold');
    // After the install: past the Recommended summary note, the spinner's completion and the tracker lines.
    expect(out.indexOf('Recommended settings applied')).toBeLessThan(out.indexOf('CLAUDE.md import audit'));
    expect(out.indexOf('Installation complete')).toBeLessThan(out.indexOf('CLAUDE.md import audit'));
    // One note, once.
    expect(out.split(big).length - 1).toBe(1);
  }, INIT_TIMEOUT_MS);

  it('AC-428: with nothing over threshold init prints no audit line', () => {
    write(path.join(home, '.claude', 'CLAUDE.md'), '@~/small.md\n');
    write(path.join(home, 'small.md'), filler(10000));
    const { status, out } = runInit(plain);
    expect(status, out).toBe(0);
    expect(out).not.toContain('import audit');
    expect(out).not.toContain('unavailable');
  }, INIT_TIMEOUT_MS);

  it('AC-428: inside a git project the project roots are audited too, at the toplevel', () => {
    const repo = path.join(tmp, 'repo');
    spawnSync('git', ['init', '-q', repo], { encoding: 'utf-8' });
    write(path.join(repo, 'CLAUDE.md'), '@docs/guide.md\n');
    const guide = write(path.join(repo, 'docs', 'guide.md'), filler(11000));
    write(path.join(repo, 'CLAUDE.local.md'), '@docs/other.md\n');
    const other = write(path.join(repo, 'docs', 'other.md'), filler(12000));
    const sub = path.join(repo, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    const { status, out } = runInit(sub);
    expect(status, out).toBe(0);
    expect(out).toContain(`${guide} is 11,000 bytes`);
    expect(out).toContain(`${other} is 12,000 bytes`);
    expect(fs.readFileSync(stamp(), 'utf-8')).toContain(`R ${repo}/CLAUDE.local.md`);
  }, INIT_TIMEOUT_MS);

  it('a repository rooted at HOME is no project: its CLAUDE.md is not audited', () => {
    spawnSync('git', ['init', '-q', home], { encoding: 'utf-8' });
    write(path.join(home, 'CLAUDE.md'), '@big.md\n');
    write(path.join(home, 'big.md'), filler(10001));
    const { status, out } = runInit(home);
    expect(status, out).toBe(0);
    expect(out).not.toContain('import audit');
    expect(fs.readFileSync(stamp(), 'utf-8')).not.toContain(`R ${home}/CLAUDE.md`);
  }, INIT_TIMEOUT_MS);

  it('AC-431: a finding init printed is in the stamp, so the first SessionStart afterwards shows nothing for it', () => {
    const big = seedFlaggedGlobal();
    const { status, out } = runInit(plain);
    expect(status, out).toBe(0);
    const text = fs.readFileSync(stamp(), 'utf-8');
    expect(text.split('\n')[0]).toBe('V 1');
    expect(text).toContain(`R ${path.join(home, '.claude', 'CLAUDE.md')}`);
    expect(text).toMatch(new RegExp(`^K file 10001 \\d+ ${big.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    expect(hookEnvelope(plain)).toBeNull();
    // Non-vacuity: change the file and the same hook does show it.
    write(big, filler(10500));
    const when = Math.floor(Date.now() / 1000) + 5;
    fs.utimesSync(big, when, when);
    expect(hookEnvelope(plain)?.systemMessage).toContain('10,500 bytes');
  }, INIT_TIMEOUT_MS);

  it('a second init states what is still flagged, and keeps the keys earlier runs recorded', () => {
    seedFlaggedGlobal();
    const first = runInit(plain);
    expect(first.out).toContain('10,001 bytes');
    const keysBefore = fs.readFileSync(stamp(), 'utf-8').split('\n').filter(l => l.startsWith('K '));
    write(path.join(home, '.devflow', CLAUDE_MD_AUDIT_STAMP_FILE), fs.readFileSync(stamp(), 'utf-8') + 'K file 9 9 /earlier/project/file.md\n');
    const second = runInit(plain);
    expect(second.status, second.out).toBe(0);
    expect(second.out).toContain('10,001 bytes');
    const keysAfter = fs.readFileSync(stamp(), 'utf-8').split('\n').filter(l => l.startsWith('K '));
    expect(keysAfter).toEqual(expect.arrayContaining([...keysBefore, 'K file 9 9 /earlier/project/file.md']));
    expect(new Set(keysAfter).size).toBe(keysAfter.length);
  }, INIT_TIMEOUT_MS * 2);

  it('AC-420: a path that cannot be shown is printed as <path not shown>, with its size', () => {
    // A HOME whose name holds a non-ASCII letter: every path under it fails the printable-ASCII gate.
    home = path.join(tmp, 'h\u00f3me');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    write(path.join(home, '.claude', 'CLAUDE.md'), '@~/big.md\n');
    write(path.join(home, 'big.md'), filler(10001));
    const { status, out } = runInit(plain);
    expect(status, out).toBe(0);
    expect(out).toContain('<path not shown> is 10,001 bytes');
    // Other init lines name the HOME (the shell profile it edited); the audit's own line must not.
    const auditLines = out.split('\n').filter(line => line.includes('import audit'));
    expect(auditLines.length).toBeGreaterThan(0);
    for (const line of auditLines) {
      expect(line).not.toContain('big.md');
      expect(line).not.toContain('h\u00f3me');
    }
  }, INIT_TIMEOUT_MS);

  it('a symlinked stamp path is refused: init succeeds and writes nothing through the link', () => {
    seedFlaggedGlobal();
    const victim = write(path.join(tmp, 'victim.txt'), 'precious\n');
    fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
    fs.symlinkSync(victim, stamp());
    const { status, out } = runInit(plain);
    expect(status, out).toBe(0);
    expect(fs.readFileSync(victim, 'utf-8')).toBe('precious\n');
    expect(fs.lstatSync(stamp()).isSymbolicLink()).toBe(true);
    expect(out).toContain('10,001 bytes'); // the audit still ran and still printed
  }, INIT_TIMEOUT_MS);

  it('AC-429: a non-TTY --advanced run exits 1 at the TTY guard, before any audit', () => {
    seedFlaggedGlobal();
    const result = spawnSync(process.execPath, [CLI, 'init', '--advanced'], {
      cwd: plain, encoding: 'utf-8', timeout: INIT_TIMEOUT_MS, env: sandboxEnv(home), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status).toBe(1);
    expect(out).toContain('--advanced requires an interactive terminal');
    expect(out).not.toContain('import audit');
    expect(fs.existsSync(stamp())).toBe(false);
  }, INIT_TIMEOUT_MS);

  it('AC-434: `devflow uninstall` removes the stamp init (and the hook) wrote, under the temp HOME', () => {
    seedFlaggedGlobal();
    const init = runInit(plain);
    expect(init.status, init.out).toBe(0);
    fs.writeFileSync(path.join(home, '.devflow', `${CLAUDE_MD_AUDIT_STAMP_FILE}.tmp.4242`), 'V 1\n');
    expect(fs.existsSync(stamp())).toBe(true);

    const uninstall = spawnSync(process.execPath, [CLI, 'uninstall', '--scope', 'user'], {
      cwd: plain, encoding: 'utf-8', timeout: INIT_TIMEOUT_MS, env: sandboxEnv(home), stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(uninstall.status, `${uninstall.stdout}${uninstall.stderr}`).toBe(0);
    expect(fs.existsSync(stamp())).toBe(false);
    expect(fs.existsSync(path.join(home, '.devflow', `${CLAUDE_MD_AUDIT_STAMP_FILE}.tmp.4242`))).toBe(false);
    // The user's own files are not the stamp's business.
    expect(fs.readFileSync(path.join(home, 'big.md'), 'utf-8')).toBe(filler(10001));
    expect(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf-8')).toBe('@~/big.md\n');
  }, INIT_TIMEOUT_MS * 2);

  it('the facade, run as init runs it, returns the same lines the SessionStart script shows', async () => {
    const big = seedFlaggedGlobal();
    const loaded = loadClaudeMdAuditModule();
    if (!loaded.ok) throw new Error('audit script does not load');
    fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
    const viaFacade = await runClaudeMdAudit({ claudeDir: path.join(home, '.claude'), projectRoot: null, home, devflowDir: path.join(home, '.devflow') });
    const direct = loaded.value.audit({ roots: [path.join(home, '.claude', 'CLAUDE.md')], home, keys: [] });
    expect(viaFacade.ok && viaFacade.value.lines).toEqual(direct.lines);
    expect(direct.lines).toEqual([`CLAUDE.md import audit: ${big} is 10,001 bytes (over the 10,000-byte import threshold).`]);
  });
});
