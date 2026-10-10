/**
 * Behavioural tests for the CLAUDE.md import audit (D-CLAUDE-MD-IMPORT-AUDIT,
 * D-AUDIT-STAMP): the pure `.cjs` module (import grammar, thresholds, hop bound,
 * file handling, bounds, display gate, stamp format), the typed facade
 * (src/core/claude-md-audit.ts: load seam, roots, the stamp write's lstat refusal)
 * and the hook-mode CLI. Covers AC-412 to AC-420 and AC-437.
 *
 * Every fixture lives under its own temp directory; HOME is a directory inside it,
 * never the developer's. FIFOs are made with `mkfifo`; a run that opened one would
 * hang, so those tests carry a bound.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CLAUDE_MD_AUDIT_MODULE_SURFACE,
  CLAUDE_MD_AUDIT_SCRIPT_NAME,
  CLAUDE_MD_AUDIT_STAMP_FILE,
  claudeMdAuditRoots,
  formatClaudeMdAuditNote,
  formatClaudeMdAuditUnavailable,
  loadClaudeMdAuditModule,
  runClaudeMdAudit,
  writeClaudeMdAuditStamp,
  type ClaudeMdAuditModule,
  type ClaudeMdAuditResult,
} from '../../src/core/claude-md-audit.js';
import { scriptsDir } from '../../src/core/assets.js';

const loaded = loadClaudeMdAuditModule();
if (!loaded.ok) throw new Error(`the audit script does not load: ${JSON.stringify(loaded.error)}`);
const A: ClaudeMdAuditModule = loaded.value;
const SCRIPT = path.join(scriptsDir(), CLAUDE_MD_AUDIT_SCRIPT_NAME);

/** A string of exactly `n` bytes that holds no import. */
const filler = (n: number): string => 'x'.repeat(n);

describe('claude-md-audit', () => {
  let tmp: string;
  let home: string;
  let project: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-md-audit-')));
    home = path.join(tmp, 'home');
    project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(project, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const write = (rel: string, content: string | Buffer): string => {
    const abs = path.isAbsolute(rel) ? rel : path.join(project, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  };

  /** Audit the single root `root` (default: the project's CLAUDE.md) with HOME as the temp home. */
  const run = (root = path.join(project, 'CLAUDE.md'), keys: string[] = []): ClaudeMdAuditResult =>
    A.audit({ roots: [root], home, keys });

  const fileFindings = (r: ClaudeMdAuditResult) => r.findings.filter(f => f.kind === 'file');
  const chainFindings = (r: ClaudeMdAuditResult) => r.findings.filter(f => f.kind === 'chain');

  // ── The loader seam ──────────────────────────────────────────────────────────

  describe('facade load seam', () => {
    it('loads the package script and every surface key is present', () => {
      expect(Object.keys(CLAUDE_MD_AUDIT_MODULE_SURFACE).sort()).toEqual(Object.keys(A).sort());
    });

    it('a missing script is a not-found Result, never a throw', () => {
      const result = loadClaudeMdAuditModule(path.join(tmp, 'nowhere'));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('not-found');
    });

    it('a script that throws on load is an unusable Result', () => {
      const dir = path.join(tmp, 'broken');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, CLAUDE_MD_AUDIT_SCRIPT_NAME), "throw new Error('boom');\n");
      const result = loadClaudeMdAuditModule(dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unusable');
        expect(formatClaudeMdAuditUnavailable({ kind: 'load', detail: result.error })).toMatch(/failed to load — reinstall devflow-kit$/);
      }
    });

    it('a script lacking part of the surface is an unusable Result naming the key', () => {
      const dir = path.join(tmp, 'partial');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, CLAUDE_MD_AUDIT_SCRIPT_NAME), 'module.exports = { audit() {} };\n');
      const result = loadClaudeMdAuditModule(dir);
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.kind === 'unusable') expect(result.error.detail).toContain('extractImports');
    });

    it('runClaudeMdAudit reports a broken script as a Result error and never throws', async () => {
      const dir = path.join(tmp, 'throwing');
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, CLAUDE_MD_AUDIT_SCRIPT_NAME),
        // Right surface, an audit() that throws.
        `const keys = ${JSON.stringify(Object.keys(CLAUDE_MD_AUDIT_MODULE_SURFACE))};
         const kinds = ${JSON.stringify(CLAUDE_MD_AUDIT_MODULE_SURFACE)};
         const m = {};
         for (const k of keys) m[k] = kinds[k] === 'number' ? 1 : kinds[k] === 'string' ? 's' : () => { throw new Error('audit exploded'); };
         m.parseStamp = () => ({ keys: [] });
         module.exports = m;`,
      );
      const result = await runClaudeMdAudit({ claudeDir: path.join(home, '.claude'), projectRoot: null, home, devflowDir: path.join(home, '.devflow'), scriptsDir: dir });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('failed');
        expect(formatClaudeMdAuditUnavailable(result.error)).toBe('CLAUDE.md import audit unavailable: the audit failed');
      }
    });
  });

  describe('roots', () => {
    it('the global root alone outside a project', () => {
      expect(claudeMdAuditRoots('/c', null)).toEqual(['/c/CLAUDE.md']);
    });

    it('the three project roots follow the global one, and nothing else is a root', () => {
      expect(claudeMdAuditRoots('/c', '/p')).toEqual([
        '/c/CLAUDE.md', '/p/CLAUDE.md', '/p/.claude/CLAUDE.md', '/p/CLAUDE.local.md',
      ]);
    });
  });

  // ── The import grammar (AC-414) ──────────────────────────────────────────────

  describe('extractImports', () => {
    it('reads an @path at the start of a line and after whitespace', () => {
      expect(A.extractImports('@a.md\nsee @b.md and\t@c/d.md\n- @e.md')).toEqual(['a.md', 'b.md', 'c/d.md', 'e.md']);
    });

    it('an email address is not an import', () => {
      expect(A.extractImports('write to user@example.com or a@b')).toEqual([]);
    });

    it('an @ glued to a preceding character is not an import', () => {
      expect(A.extractImports('(@a.md) "@b.md" x@c.md')).toEqual([]);
    });

    it('the path is the run of A-Za-z0-9._/~+- with trailing dots dropped', () => {
      expect(A.extractImports('@docs/a-b_c+d.md. and @x.md... then @~/y.md,')).toEqual(['docs/a-b_c+d.md', 'x.md', '~/y.md']);
    });

    it('an empty token is not an import', () => {
      expect(A.extractImports('@ alone and @. and @.. and @')).toEqual([]);
    });

    it('stops a token at a character outside the set (a space, a backslash)', () => {
      expect(A.extractImports('@Design\\ Docs/api.md')).toEqual(['Design']);
    });

    it('skips a backtick fence, a tilde fence, and resumes after the closer', () => {
      const text = ['@before.md', '```', '@in-backtick.md', '```', '~~~ts', '@in-tilde.md', '~~~', '@after.md'].join('\n');
      expect(A.extractImports(text)).toEqual(['before.md', 'after.md']);
    });

    it('a fence is closed only by the same character, at least as long, and nothing after it', () => {
      const text = ['````', '@one.md', '```', '@two.md', '~~~~', '@three.md', '```not a closer', '@four.md', '````', '@out.md'].join('\n');
      expect(A.extractImports(text)).toEqual(['out.md']);
    });

    it('a fence is allowed up to three spaces of indent, four is indented code and not a fence', () => {
      expect(A.extractImports('   ```\n@in.md\n   ```\n@out.md')).toEqual(['out.md']);
      expect(A.extractImports('    ```\n@still-an-import.md')).toEqual(['still-an-import.md']);
    });

    it('a backtick fence whose info string holds a backtick is not a fence', () => {
      expect(A.extractImports('``` `x`\n@import.md')).toEqual(['import.md']);
    });

    it('an unclosed fence runs to the end of the text', () => {
      expect(A.extractImports('@a.md\n```\n@b.md\n@c.md')).toEqual(['a.md']);
    });

    it('skips an inline code span, of any run length, and reads the rest of the line', () => {
      expect(A.extractImports('`@a.md` then @b.md and ``@c.md`` and ```@d.md``` end @e.md')).toEqual(['b.md', 'e.md']);
    });

    it('skips an @path that follows whitespace INSIDE an inline code span', () => {
      expect(A.extractImports('run `see @a.md now` then @b.md')).toEqual(['b.md']);
      expect(A.extractImports('``x @c.md`` and ```y @d.md``` end')).toEqual([]);
      expect(A.extractImports('`a` @e.md `b @f.md`')).toEqual(['e.md']);
    });

    it('a shorter or longer backtick run inside a span does not close it', () => {
      expect(A.extractImports('``a ` @g.md `` @h.md')).toEqual(['h.md']);
      expect(A.extractImports('`a `` @i.md ` @j.md')).toEqual(['j.md']);
    });

    it('a backtick run with no closer on its line is literal text', () => {
      expect(A.extractImports('a ` @b.md')).toEqual(['b.md']);
      expect(A.extractImports('`` @c.md `')).toEqual(['c.md']);
    });

    it('an @ right after a code span does not follow whitespace', () => {
      expect(A.extractImports('`x`@a.md')).toEqual([]);
    });

    it('a span does not cross a line', () => {
      expect(A.extractImports('`open\n@a.md close`')).toEqual(['a.md']);
    });

    it('four-space indented code is not exempted (OQ10)', () => {
      expect(A.extractImports('    @indented.md')).toEqual(['indented.md']);
    });

    it('reads CRLF text', () => {
      expect(A.extractImports('@a.md\r\n```\r\n@b.md\r\n```\r\n@c.md\r\n')).toEqual(['a.md', 'c.md']);
    });
  });

  // ── Thresholds (AC-412, AC-413) ──────────────────────────────────────────────

  describe('file threshold', () => {
    it('an import of 10,001 bytes is flagged, naming the file and its size', () => {
      write('CLAUDE.md', '@big.md\n');
      const big = write('big.md', filler(10001));
      const r = run();
      expect(fileFindings(r)).toMatchObject([{ kind: 'file', path: big, size: 10001, hop: 1 }]);
      expect(r.lines).toEqual([
        `CLAUDE.md import audit: ${big} is 10,001 bytes (over the 10,000-byte import threshold).`,
      ]);
    });

    it('the same import at exactly 10,000 bytes is not flagged', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10000));
      const r = run();
      expect(r.findings).toEqual([]);
      expect(r.lines).toEqual([]);
    });

    it('a root has no file finding, however large (it is not an import)', () => {
      write('CLAUDE.md', filler(30000));
      const r = run();
      expect(fileFindings(r)).toEqual([]);
      expect(chainFindings(r)).toEqual([]);
    });

    it('formats thousands separators the same whatever the locale', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(1234567 > A.SKIP_FILE_BYTES ? 20000 : 1234567));
      expect(run().lines[0]).toMatch(/is 1,234,567 bytes/);
    });
  });

  describe('chain threshold', () => {
    it('a root whose chain totals 40,001 bytes is flagged, naming the root, the total and the largest member', () => {
      const root = write('CLAUDE.md', `@a.md @b.md @c.md\n${filler(40001 - 3 * 9000 - 18)}`);
      const rootSize = fs.statSync(root).size;
      write('a.md', filler(9000));
      write('b.md', filler(9000));
      write('c.md', filler(40001 - rootSize - 18000));
      const r = run();
      const total = rootSize + 9000 + 9000 + fs.statSync(path.join(project, 'c.md')).size;
      expect(total).toBe(40001);
      expect(chainFindings(r)).toMatchObject([{ kind: 'chain', path: root, total: 40001, truncated: false }]);
      const chain = chainFindings(r)[0];
      expect(chain.kind === 'chain' && chain.largest.size).toBe(Math.max(rootSize, 9000, fs.statSync(path.join(project, 'c.md')).size));
      expect(r.lines.some(l => l.includes(root) && l.includes('40,001 bytes') && l.includes('chain threshold'))).toBe(true);
      expect(r.lines.every(l => !l.includes('at least'))).toBe(true);
    });

    it('a total of exactly 40,000 bytes is not flagged', () => {
      const header = '@a.md @b.md\n';
      write('CLAUDE.md', header + filler(40000 - 9000 - 9000 - header.length));
      write('a.md', filler(9000));
      write('b.md', filler(9000));
      const r = run();
      expect(r.roots[0].total).toBe(40000);
      expect(chainFindings(r)).toEqual([]);
    });

    it('the largest member may be the root itself', () => {
      const header = '@a.md\n';
      const root = write('CLAUDE.md', header + filler(39000));
      write('a.md', filler(5000));
      const r = run();
      const chain = chainFindings(r)[0];
      expect(chain.kind === 'chain' && chain.largest.path).toBe(root);
    });
  });

  // ── Path resolution (AC-414) ─────────────────────────────────────────────────

  describe('resolution', () => {
    it('a relative import in a nested file resolves from that file\'s directory', () => {
      write('CLAUDE.md', '@docs/guide.md\n');
      write('docs/guide.md', '@more/deep.md\n');
      const deep = write('docs/more/deep.md', filler(10001));
      const stray = write('more/deep.md', filler(10001));
      const r = run();
      expect(fileFindings(r).map(f => f.path)).toEqual([deep]);
      expect(fileFindings(r).map(f => f.path)).not.toContain(stray);
    });

    it('a ~/ import resolves from HOME', () => {
      write('CLAUDE.md', '@~/notes/mine.md\n');
      const mine = write(path.join(home, 'notes', 'mine.md'), filler(10001));
      expect(fileFindings(run()).map(f => f.path)).toEqual([mine]);
    });

    it('an absolute import stays absolute', () => {
      const abs = write(path.join(tmp, 'elsewhere', 'abs.md'), filler(10001));
      write('CLAUDE.md', `@${abs}\n`);
      expect(fileFindings(run()).map(f => f.path)).toEqual([abs]);
    });

    it('paths inside a fence, a code span and an email are not followed', () => {
      write('CLAUDE.md', '```\n@fenced.md\n```\n`@spanned.md` mail me@mail.md\n');
      write('fenced.md', filler(10001));
      write('spanned.md', filler(10001));
      write('mail.md', filler(10001));
      const r = run();
      expect(r.findings).toEqual([]);
      expect(r.examined.map(e => path.basename(e.path))).toEqual(['CLAUDE.md']);
    });
  });

  describe('missing and non-regular targets (AC-415)', () => {
    it('a missing target and a directory are ignored without error', () => {
      write('CLAUDE.md', '@missing.md @dir @dir/ @~ @/tmp\n');
      fs.mkdirSync(path.join(project, 'dir'));
      const r = run();
      expect(r.findings).toEqual([]);
      const flags = new Map(r.examined.map(e => [path.basename(e.path), e.flag]));
      expect(flags.get('missing.md')).toBe(0);
      expect(flags.get('dir')).toBe(2);
    });

    it('a missing root is recorded as absent and fails nothing', () => {
      const r = run(path.join(project, 'CLAUDE.md'));
      expect(r.roots[0].exists).toBe(false);
      expect(r.examined).toEqual([{ path: path.join(project, 'CLAUDE.md'), flag: 0 }]);
      expect(r.stamp).toContain(`P 0 ${path.join(project, 'CLAUDE.md')}`);
    });

    it('an unreadable file contributes its size but no imports, and fails nothing', () => {
      if (process.getuid?.() === 0) return; // root reads everything
      write('CLAUDE.md', '@locked.md\n');
      const locked = write('locked.md', `@inner.md\n${filler(10001)}`);
      write('inner.md', filler(10001));
      fs.chmodSync(locked, 0o000);
      try {
        const r = run();
        expect(fileFindings(r).map(f => f.path)).toEqual([locked]);
        expect(r.examined.map(e => path.basename(e.path))).not.toContain('inner.md');
      } finally {
        fs.chmodSync(locked, 0o644);
      }
    });
  });

  // ── Hop bound (AC-416) ───────────────────────────────────────────────────────

  describe('hop bound', () => {
    /** root -> h1 -> h2 -> h3 -> h4 -> h5 -> h6, every file over the file threshold. */
    const buildChain = (): void => {
      write('CLAUDE.md', '@h1.md\n');
      for (let hop = 1; hop <= 6; hop++) {
        const next = hop < 6 ? `@h${hop + 1}.md\n` : '';
        write(`h${hop}.md`, next + filler(10001));
      }
    };

    it('MAX_HOPS is five', () => {
      expect(A.MAX_HOPS).toBe(5);
    });

    it('counts hops 1 to 5, and neither reads nor counts the hop-6 file', () => {
      buildChain();
      const r = run();
      const names = fileFindings(r).map(f => path.basename(f.path));
      expect(names).toEqual(['h1.md', 'h2.md', 'h3.md', 'h4.md', 'h5.md']);
      expect(r.filesExamined).toBe(6); // root + hops 1..5
      const sizeOf = (name: string): number => fs.statSync(path.join(project, name)).size;
      expect(r.roots[0].total).toBe(['CLAUDE.md', 'h1.md', 'h2.md', 'h3.md', 'h4.md', 'h5.md'].reduce((sum, n) => sum + sizeOf(n), 0));
      // The hop-6 path is never even looked at: it is not an examined path.
      expect(r.examined.map(e => path.basename(e.path))).not.toContain('h6.md');
      // The hop-5 file is sized but not read: only hops 0 to 4 are scanned.
      const scanned = fs.statSync(path.join(project, 'CLAUDE.md')).size
        + [1, 2, 3, 4].reduce((sum, hop) => sum + fs.statSync(path.join(project, `h${hop}.md`)).size, 0);
      expect(r.bytesRead).toBe(scanned);
    });

    it('a file reached by a shorter route is judged at its shortest hop count (breadth-first)', () => {
      // CLAUDE.md -> long1 -> long2 -> long3 -> long4 -> target, and CLAUDE.md -> target directly.
      write('CLAUDE.md', '@long1.md @target.md\n');
      write('long1.md', '@long2.md\n');
      write('long2.md', '@long3.md\n');
      write('long3.md', '@long4.md\n');
      write('long4.md', '@target.md\n');
      write('target.md', `@beyond.md\n${filler(100)}`);
      write('beyond.md', filler(10001));
      const r = run();
      // target at hop 1 reaches beyond at hop 2; a depth-first walk reaching target at hop 5 first would not.
      expect(fileFindings(r).map(f => path.basename(f.path))).toEqual(['beyond.md']);
    });
  });

  describe('diamond and cycle (AC-417)', () => {
    it('a diamond counts the shared file once', () => {
      write('CLAUDE.md', '@left.md @right.md\n');
      write('left.md', '@shared.md\n');
      write('right.md', '@shared.md\n');
      write('shared.md', filler(10001));
      const r = run();
      expect(fileFindings(r)).toHaveLength(1);
      const sizes = ['CLAUDE.md', 'left.md', 'right.md', 'shared.md'].map(n => fs.statSync(path.join(project, n)).size);
      expect(r.roots[0].total).toBe(sizes.reduce((a, b) => a + b, 0));
    });

    it('a cycle terminates and each file is counted once', () => {
      write('CLAUDE.md', '@a.md\n');
      write('a.md', `@b.md\n${filler(10001)}`);
      write('b.md', `@a.md @CLAUDE.md\n${filler(10001)}`);
      const r = run();
      expect(fileFindings(r).map(f => path.basename(f.path))).toEqual(['a.md', 'b.md']);
      expect(r.filesExamined).toBe(3);
    });

    it('two spellings of one file (a symlink) count it once', () => {
      write('CLAUDE.md', '@real.md @alias.md\n');
      write('real.md', filler(10001));
      fs.symlinkSync(path.join(project, 'real.md'), path.join(project, 'alias.md'));
      const r = run();
      expect(fileFindings(r)).toHaveLength(1);
      expect(r.filesExamined).toBe(2);
    });
  });

  // ── Bounds (AC-418) ──────────────────────────────────────────────────────────

  describe('FIFOs, devices and size bounds', () => {
    const FIFO_TEST_MS = 20_000;

    const mkfifo = (p: string): void => {
      const made = spawnSync('mkfifo', [p]);
      expect(made.status, `mkfifo failed: ${made.stderr}`).toBe(0);
    };

    it('a FIFO import and a symlink to a FIFO are never opened, and the run finishes at once', () => {
      const fifo = path.join(project, 'pipe');
      mkfifo(fifo);
      fs.symlinkSync(fifo, path.join(project, 'pipe-link'));
      write('CLAUDE.md', '@pipe @pipe-link @/dev/null\n');
      const started = Date.now();
      const r = run();
      expect(Date.now() - started).toBeLessThan(FIFO_TEST_MS / 2);
      expect(r.findings).toEqual([]);
      expect(r.bytesRead).toBe(fs.statSync(path.join(project, 'CLAUDE.md')).size);
      const flags = new Map(r.examined.map(e => [path.basename(e.path), e.flag]));
      expect(flags.get('pipe')).toBe(2);
      expect(flags.get('pipe-link')).toBe(2);
      expect(flags.get('null')).toBe(2);
    }, FIFO_TEST_MS);

    it('a FIFO as the root is never opened', () => {
      const fifo = path.join(project, 'CLAUDE.md');
      mkfifo(fifo);
      const r = run(fifo);
      expect(r.roots[0].exists).toBe(false);
      expect(r.bytesRead).toBe(0);
    }, FIFO_TEST_MS);

    it('readStampFile never opens a FIFO or a symlink at the stamp path', () => {
      const fifo = path.join(tmp, 'stamp-fifo');
      mkfifo(fifo);
      expect(A.readStampFile(fifo)).toBeNull();
      const real = write(path.join(tmp, 'real-stamp'), 'V 1\n');
      const link = path.join(tmp, 'stamp-link');
      fs.symlinkSync(real, link);
      expect(A.readStampFile(link)).toBeNull();
      expect(A.readStampFile(real)).toBe('V 1\n');
    }, FIFO_TEST_MS);

    it('a 2 MB import is scanned only to 65,536 bytes: an @path after that point is not seen', () => {
      write('CLAUDE.md', '@huge.md\n');
      write('huge.md', `${filler(A.SCAN_BYTES)}\n@late.md\n${filler(2_000_000)}`);
      write('late.md', filler(10001));
      const r = run();
      expect(fileFindings(r).map(f => path.basename(f.path))).toEqual(['huge.md']);
      expect(r.bytesRead).toBe(fs.statSync(path.join(project, 'CLAUDE.md')).size + A.SCAN_BYTES);
    });

    it('a 2 MB import is still sized in full', () => {
      write('CLAUDE.md', '@huge.md\n');
      write('huge.md', filler(2_000_000));
      expect(fileFindings(run())[0]).toMatchObject({ size: 2_000_000 });
    });

    it('one run reads at most 1,048,576 bytes, whatever the number of large files', () => {
      const names = Array.from({ length: 40 }, (_, i) => `big${i}.md`);
      write('CLAUDE.md', names.map(n => `@${n}`).join(' ') + '\n');
      for (const n of names) write(n, filler(100_000));
      const r = run();
      expect(r.bytesRead).toBeLessThanOrEqual(A.MAX_BYTES_READ);
      expect(r.bytesRead).toBe(A.MAX_BYTES_READ);
      expect(r.truncated).toBe(true);
    });

    it('the byte budget is shared by the roots of one run', () => {
      for (const root of ['one', 'two']) {
        const names = Array.from({ length: 12 }, (_, i) => `${root}${i}.md`);
        write(`${root}/CLAUDE.md`, names.map(n => `@${n}`).join(' ') + '\n');
        for (const n of names) write(`${root}/${n}`, filler(100_000));
      }
      const r = A.audit({ roots: [path.join(project, 'one', 'CLAUDE.md'), path.join(project, 'two', 'CLAUDE.md')], home });
      expect(r.bytesRead).toBeLessThanOrEqual(A.MAX_BYTES_READ);
    });

    it('examines at most 64 paths per root, absent ones included, and marks the result truncated', () => {
      const names = Array.from({ length: 70 }, (_, i) => `missing${i}.md`);
      write('CLAUDE.md', names.map(n => `@${n}`).join(' ') + '\n');
      const r = run();
      expect(r.pathsExamined).toBe(A.MAX_PATHS_PER_ROOT);
      expect(r.examined).toHaveLength(64);
      expect(r.roots[0].truncated).toBe(true);
      expect(r.truncated).toBe(true);
    });

    it('a truncated chain total is shown as "at least"', () => {
      const names = Array.from({ length: 70 }, (_, i) => `part${i}.md`);
      write('CLAUDE.md', names.map(n => `@${n}`).join(' ') + '\n');
      for (const n of names) write(n, filler(900));
      const r = run();
      expect(chainFindings(r)).toHaveLength(1);
      expect(r.lines[0]).toMatch(/loads at least [\d,]+ bytes through its imports/);
    });

    it('a file over 4 MiB is neither counted nor followed (Claude Code skips it)', () => {
      write('CLAUDE.md', '@vast.md\n');
      const vast = path.join(project, 'vast.md');
      fs.writeFileSync(vast, '@after.md\n');
      fs.truncateSync(vast, A.SKIP_FILE_BYTES + 1);
      write('after.md', filler(10001));
      const r = run();
      expect(r.findings).toEqual([]);
      expect(r.examined.map(e => path.basename(e.path))).not.toContain('after.md');
      expect(r.roots[0].total).toBe(fs.statSync(path.join(project, 'CLAUDE.md')).size);
    });
  });

  // ── Read-only (AC-419) ───────────────────────────────────────────────────────

  describe('the audit writes nothing (AC-419)', () => {
    /** Every path under `dir` with its bytes and mtime, recursively (symlinks not followed). */
    const snapshot = (dir: string): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (d: string): void => {
        for (const name of fs.readdirSync(d)) {
          const abs = path.join(d, name);
          const st = fs.lstatSync(abs);
          if (st.isDirectory()) { out[abs] = `dir ${st.mtimeMs}`; walk(abs); }
          else if (st.isSymbolicLink()) out[abs] = `link ${fs.readlinkSync(abs)}`;
          else if (st.isFile()) out[abs] = `file ${st.mtimeMs} ${fs.readFileSync(abs).toString('base64')}`;
          else out[abs] = `other ${st.mtimeMs}`;
        }
      };
      walk(dir);
      return out;
    };

    it('audited files keep their bytes and mtime, and no file is created under HOME or the project', () => {
      write('CLAUDE.md', '@docs/a.md @~/b.md @missing.md\n');
      write('docs/a.md', `@c.md\n${filler(10001)}`);
      write('docs/c.md', filler(500));
      write(path.join(home, 'b.md'), filler(20000));
      fs.utimesSync(path.join(project, 'CLAUDE.md'), 1_600_000_000, 1_600_000_000);
      const before = snapshot(tmp);
      const r = A.audit({ roots: [path.join(project, 'CLAUDE.md'), path.join(home, '.claude', 'CLAUDE.md')], home });
      expect(r.findings.length).toBeGreaterThan(0);
      expect(snapshot(tmp)).toEqual(before);
    });

    it('the hook-mode CLI writes nothing either; the stamp text goes to stdout only', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10001));
      const before = snapshot(tmp);
      const out = spawnSync(process.execPath, [SCRIPT, 'hook', home, path.join(home, '.devflow', CLAUDE_MD_AUDIT_STAMP_FILE), path.join(project, 'CLAUDE.md')], { encoding: 'utf-8' });
      expect(out.status).toBe(0);
      expect(snapshot(tmp)).toEqual(before);
    });
  });

  // ── Display gate (AC-420) ────────────────────────────────────────────────────

  describe('display gate (AC-420)', () => {
    it.each([
      ['an ESC byte', 'esc\u001b[31m'],
      ['a newline', 'new\nline'],
      ['a bidi control', 'bidi\u202e'],
      ['a non-ASCII letter', 'caf\u00e9'],
    ])('an import under a directory with %s is shown as <path not shown>, with its size', (_label, dirName) => {
      const root = write(path.join(project, dirName, 'CLAUDE.md'), '@big.md\n');
      write(path.join(project, dirName, 'big.md'), filler(12345));
      const r = A.audit({ roots: [root], home });
      expect(r.findings).toHaveLength(1);
      expect(r.lines).toEqual(['CLAUDE.md import audit: <path not shown> is 12,345 bytes (over the 10,000-byte import threshold).']);
      for (const line of r.lines) expect(line).toMatch(/^[ -~]+$/);
    });

    it('a chain finding hides an undisplayable root and an undisplayable largest member alike', () => {
      const line = A.formatFinding({
        kind: 'chain', path: '/p/\u001b[2Jroot', total: 50000, mtime: 1, truncated: false,
        largest: { path: '/p/\u202ebig.md', size: 20000 },
      });
      expect(line).toBe(
        'CLAUDE.md import audit: <path not shown> loads 50,000 bytes through its imports (over the 40,000-byte chain threshold); the largest file is <path not shown> at 20,000 bytes.',
      );
    });

    it('a root whose own name holds a control byte is shown as <path not shown> end to end', () => {
      const root = write(path.join(project, 'dir\u001bx', 'CLAUDE.md'), `@big.md\n${filler(41000)}`);
      write(path.join(project, 'dir\u001bx', 'big.md'), filler(12000));
      const r = A.audit({ roots: [root], home });
      expect(r.lines.length).toBeGreaterThan(0);
      for (const line of r.lines) {
        expect(line).toMatch(/^[ -~]+$/);
        expect(line).toContain('<path not shown>');
      }
    });

    it('every displayed line of an ordinary run is printable ASCII', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10001));
      for (const line of run().lines) expect(line).toMatch(/^[ -~]+$/);
    });

    it('isDisplayable admits printable ASCII and nothing else', () => {
      expect(A.isDisplayable('/a b/c-d_e.md')).toBe(true);
      for (const bad of ['', 'a\nb', 'a\u001bb', 'caf\u00e9', 'a\u202eb', 'a\u007fb', 'a\tb']) {
        expect(A.isDisplayable(bad), JSON.stringify(bad)).toBe(false);
      }
    });
  });

  // ── Once-per-key and the stamp ───────────────────────────────────────────────

  describe('once per key', () => {
    it('a finding whose key is already in the stamp is not displayed again', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10001));
      const first = run();
      expect(first.lines).toHaveLength(1);
      expect(first.shown).toHaveLength(1);
      const second = run(path.join(project, 'CLAUDE.md'), A.parseStamp(first.stamp).keys as string[]);
      expect(second.lines).toEqual([]);
      expect(second.findings).toHaveLength(1);
      expect(A.parseStamp(second.stamp).keys).toEqual(A.parseStamp(first.stamp).keys);
    });

    it('a changed size or mtime is a new key and shows again', () => {
      write('CLAUDE.md', '@big.md\n');
      const big = write('big.md', filler(10001));
      const keys = A.parseStamp(run().stamp).keys as string[];
      write('big.md', filler(10002));
      expect(run(path.join(project, 'CLAUDE.md'), keys).lines).toHaveLength(1);
      fs.utimesSync(big, 1_500_000_000, 1_500_000_000);
      expect(run(path.join(project, 'CLAUDE.md'), keys).lines).toHaveLength(1);
    });

    it('the key of a file finding is (size, mtime, path) and of a chain finding (total, mtime, root)', () => {
      write('CLAUDE.md', `@big.md\n${filler(40000)}`);
      const big = write('big.md', filler(10001));
      fs.utimesSync(big, 1_700_000_000, 1_700_000_000);
      const r = run();
      expect(r.shown).toContain(`file 10001 1700000000 ${big}`);
      const rootMtime = Math.floor(fs.statSync(path.join(project, 'CLAUDE.md')).mtimeMs / 1000);
      expect(r.shown.some(k => k.startsWith('chain ') && k.endsWith(` ${rootMtime} ${path.join(project, 'CLAUDE.md')}`))).toBe(true);
    });

    it('two roots reaching the same finding show one line', () => {
      write('a/CLAUDE.md', '@../shared.md\n');
      write('b/CLAUDE.md', '@../shared.md\n');
      write('shared.md', filler(10001));
      const r = A.audit({ roots: [path.join(project, 'a', 'CLAUDE.md'), path.join(project, 'b', 'CLAUDE.md')], home });
      expect(r.findings).toHaveLength(2);
      expect(r.lines).toHaveLength(1);
    });

    it('keeps at most 256 keys, dropping the oldest', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10001));
      const old = Array.from({ length: 300 }, (_, i) => `file ${i} 1 /old/${i}`);
      const r = run(path.join(project, 'CLAUDE.md'), old);
      const keys = A.parseStamp(r.stamp).keys;
      expect(keys).toHaveLength(256);
      expect(keys[keys.length - 1]).toContain('big.md');
      expect(keys).not.toContain(old[0]);
    });
  });

  describe('stamp format (D-AUDIT-STAMP)', () => {
    it('round-trips roots, examined paths and keys', () => {
      write('CLAUDE.md', '@a.md @gone.md @.\n');
      write('a.md', 'hi');
      const r = run();
      const parsed = A.parseStamp(r.stamp);
      expect(parsed.valid).toBe(true);
      expect(parsed.roots).toEqual([path.join(project, 'CLAUDE.md')]);
      expect(parsed.examined).toEqual([
        { path: path.join(project, 'CLAUDE.md'), flag: 1 },
        { path: path.join(project, 'a.md'), flag: 1 },
        { path: path.join(project, 'gone.md'), flag: 0 },
      ]);
      expect(r.stamp.split('\n')[0]).toBe('V 1');
      expect(r.stamp.endsWith('\n')).toBe(true);
    });

    it('records the root exactly as the caller spelled it', () => {
      const spelled = `${project}//CLAUDE.md`;
      const r = A.audit({ roots: [spelled], home });
      expect(A.parseStamp(r.stamp).roots).toEqual([spelled]);
    });

    it('never records a path or key holding a control byte', () => {
      const text = A.renderStamp({
        roots: ['/ok/CLAUDE.md', '/bad\n/CLAUDE.md'],
        examined: [{ path: '/ok/a', flag: 1 }, { path: '/bad\u001b/b', flag: 1 }],
        keys: ['file 1 2 /ok', 'file 1 2 /bad\nK injected'],
      });
      expect(text).toBe('V 1\nR /ok/CLAUDE.md\nP 1 /ok/a\nK file 1 2 /ok\n');
    });

    it('a stamp that does not open with the version row reads as empty', () => {
      for (const text of ['', 'R /x\nK file 1 2 /x\n', 'V 2\nR /x\n', null, undefined, 42]) {
        const parsed = A.parseStamp(text);
        expect(parsed.valid).toBe(false);
        expect(parsed.keys).toEqual([]);
        expect(parsed.roots).toEqual([]);
      }
    });

    it('ignores rows it does not know, and reads the error marker', () => {
      const parsed = A.parseStamp('V 1\nZ what\nR /r\nP 7 /bad\nP 1 /p\nE audit-failed\n');
      expect(parsed.roots).toEqual(['/r']);
      expect(parsed.examined).toEqual([{ path: '/p', flag: 1 }]);
      expect(parsed.error).toBe(true);
    });

    it('an over-size stamp is read as absent', () => {
      const big = path.join(tmp, 'big-stamp');
      fs.writeFileSync(big, `V 1\n${'K file 1 1 /x\n'.repeat(Math.ceil(A.MAX_STAMP_BYTES / 14) + 10)}`);
      expect(fs.statSync(big).size).toBeGreaterThan(A.MAX_STAMP_BYTES);
      expect(A.readStampFile(big)).toBeNull();
    });
  });

  // ── The facade: running, and writing the stamp (AC-437) ──────────────────────

  describe('facade run and stamp write', () => {
    const devflowDir = (): string => path.join(home, '.devflow');
    const stampPath = (): string => path.join(devflowDir(), CLAUDE_MD_AUDIT_STAMP_FILE);

    it('runClaudeMdAudit audits the gated roots and reads the displayed keys from the stamp', async () => {
      const claudeDir = path.join(home, '.claude');
      write(path.join(claudeDir, 'CLAUDE.md'), '@~/big.md\n');
      write(path.join(home, 'big.md'), filler(10001));
      const first = await runClaudeMdAudit({ claudeDir, projectRoot: null, home, devflowDir: devflowDir() });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(formatClaudeMdAuditNote(first.value)).toContain('big.md');
      expect(formatClaudeMdAuditNote(first.value)).toBe(first.value.lines.join('\n'));
      expect((await writeClaudeMdAuditStamp(devflowDir(), first.value.stamp)).ok).toBe(true);

      const second = await runClaudeMdAudit({ claudeDir, projectRoot: null, home, devflowDir: devflowDir() });
      expect(second.ok && formatClaudeMdAuditNote(second.value)).toBeNull();
    });

    it('formatClaudeMdAuditNote is null when nothing is flagged', async () => {
      const result = await runClaudeMdAudit({ claudeDir: path.join(home, '.claude'), projectRoot: project, home, devflowDir: devflowDir() });
      expect(result.ok && formatClaudeMdAuditNote(result.value)).toBeNull();
    });

    it('writes the stamp text to <devflowDir>/.claude-md-audit through a sibling temp file', async () => {
      const result = await writeClaudeMdAuditStamp(devflowDir(), 'V 1\nR /x\n');
      expect(result.ok).toBe(true);
      expect(fs.readFileSync(stampPath(), 'utf-8')).toBe('V 1\nR /x\n');
      expect(fs.readdirSync(devflowDir()).filter(n => n.includes('.tmp.'))).toEqual([]);
    });

    it('rewrites an existing regular stamp', async () => {
      fs.writeFileSync(stampPath(), 'old\n');
      expect((await writeClaudeMdAuditStamp(devflowDir(), 'new\n')).ok).toBe(true);
      expect(fs.readFileSync(stampPath(), 'utf-8')).toBe('new\n');
    });

    it('never creates the machine root', async () => {
      const missing = path.join(tmp, 'no-such-home', '.devflow');
      const result = await writeClaudeMdAuditStamp(missing, 'V 1\n');
      expect(result).toEqual({ ok: false, error: { kind: 'no-machine-root' } });
      expect(fs.existsSync(missing)).toBe(false);
      expect(fs.existsSync(path.dirname(missing))).toBe(false);
    });

    it('refuses a symlinked stamp path and writes nothing through it (AC-437)', async () => {
      const victim = write(path.join(tmp, 'victim.txt'), 'precious\n');
      fs.symlinkSync(victim, stampPath());
      const result = await writeClaudeMdAuditStamp(devflowDir(), 'V 1\nR /x\n');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('refused');
      expect(fs.readFileSync(victim, 'utf-8')).toBe('precious\n');
      expect(fs.lstatSync(stampPath()).isSymbolicLink()).toBe(true);
      expect(fs.readdirSync(devflowDir()).filter(n => n.includes('.tmp.'))).toEqual([]);
    });

    it('refuses a dangling symlink at the stamp path (AC-437)', async () => {
      fs.symlinkSync(path.join(tmp, 'not-there'), stampPath());
      const result = await writeClaudeMdAuditStamp(devflowDir(), 'V 1\n');
      expect(result.ok).toBe(false);
      expect(fs.existsSync(path.join(tmp, 'not-there'))).toBe(false);
    });

    it('refuses a directory at the stamp path (AC-437)', async () => {
      fs.mkdirSync(stampPath());
      const result = await writeClaudeMdAuditStamp(devflowDir(), 'V 1\n');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ kind: 'refused', detail: 'the stamp path is not a regular file' });
      expect(fs.readdirSync(stampPath())).toEqual([]);
    });

    it('refuses a FIFO at the stamp path without opening it (AC-437)', async () => {
      expect(spawnSync('mkfifo', [stampPath()]).status).toBe(0);
      const started = Date.now();
      const result = await writeClaudeMdAuditStamp(devflowDir(), 'V 1\n');
      expect(Date.now() - started).toBeLessThan(5000);
      expect(result.ok).toBe(false);
    }, 20_000);
  });

  // ── The hook-mode CLI ────────────────────────────────────────────────────────

  describe('hook-mode CLI', () => {
    const stamp = (): string => path.join(home, '.devflow', CLAUDE_MD_AUDIT_STAMP_FILE);
    const hook = (...roots: string[]) =>
      spawnSync(process.execPath, [SCRIPT, 'hook', home, stamp(), ...roots], { encoding: 'utf-8' });

    it('prints the framed block: magic, M lines, the stamp rows, END', () => {
      write('CLAUDE.md', '@big.md\n');
      const big = write('big.md', filler(10001));
      const r = hook(path.join(project, 'CLAUDE.md'));
      expect(r.status).toBe(0);
      const lines = r.stdout.split('\n');
      expect(lines[0]).toBe(A.HOOK_MAGIC);
      expect(lines[1]).toBe(`M CLAUDE.md import audit: ${big} is 10,001 bytes (over the 10,000-byte import threshold).`);
      expect(lines[2]).toBe('V 1');
      expect(lines[lines.length - 2]).toBe(A.HOOK_END);
      expect(lines[lines.length - 1]).toBe('');
      expect(lines.filter(l => l.startsWith('R '))).toEqual([`R ${path.join(project, 'CLAUDE.md')}`]);
    });

    it('prints no M line for a key the stamp already holds, and keeps that key', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10001));
      const first = hook(path.join(project, 'CLAUDE.md'));
      const stampRows = first.stdout.split('\n').filter(l => /^[VRPKE] /.test(l)).join('\n') + '\n';
      fs.writeFileSync(stamp(), stampRows);
      const second = hook(path.join(project, 'CLAUDE.md'));
      expect(second.stdout.split('\n').filter(l => l.startsWith('M '))).toEqual([]);
      expect(second.stdout.split('\n').filter(l => l.startsWith('K '))).toHaveLength(1);
    });

    it('treats a symlinked stamp as absent keys (the finding shows again)', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10001));
      const first = hook(path.join(project, 'CLAUDE.md'));
      const real = path.join(tmp, 'elsewhere-stamp');
      fs.writeFileSync(real, first.stdout.split('\n').filter(l => /^[VRPKE] /.test(l)).join('\n') + '\n');
      fs.symlinkSync(real, stamp());
      expect(hook(path.join(project, 'CLAUDE.md')).stdout).toContain('\nM CLAUDE.md import audit:');
    });

    it('a wrong mode or missing arguments exit non-zero and print nothing on stdout', () => {
      for (const argv of [[], ['hook'], ['hook', home], ['audit', home, stamp()]]) {
        const r = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf-8' });
        expect(r.status, JSON.stringify(argv)).not.toBe(0);
        expect(r.stdout).toBe('');
      }
    });

    it('every stdout line is printable ASCII for a project of ordinary names', () => {
      write('CLAUDE.md', '@big.md\n');
      write('big.md', filler(10001));
      for (const line of hook(path.join(project, 'CLAUDE.md')).stdout.split('\n')) expect(line).toMatch(/^[ -~]*$/);
    });
  });
});
