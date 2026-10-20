/**
 * D-LEDGER-MAIN-WORKTREE — the TypeScript side (CLI and HUD) resolves the
 * curation ledger root with the rule the hooks' df_resolve_roots applies
 * (src/assets/scripts/hooks/resolve-project-root), so `devflow curation` and the
 * HUD read the ledger the hooks write in a linked worktree.
 *
 * Real git fixtures: a main checkout, a subdirectory, a linked worktree, a
 * non-git directory. The parity case runs the hook helper itself on the same
 * fixtures and compares its DF_LEDGER_ROOT with the TypeScript answer.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLedgerRoot, lookupLedgerRoot, parseLedgerRootOutput, LEDGER_ROOT_TIMEOUT_MS } from '../../src/core/ledger-root.js';
import { useWarmFakeExecutables } from '../helpers/warm-fake-executable.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RESOLVE_HELPER = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'resolve-project-root');

/** The hooks' DF_LEDGER_ROOT for `cwd` under `home`, straight from the shell helper. */
function hookLedgerRoot(cwd: string, home: string): string {
  const out = spawnSync(
    'bash',
    ['-c', 'source "$1"; df_resolve_roots "$2"; printf %s "$DF_LEDGER_ROOT"', '_', RESOLVE_HELPER, cwd],
    { encoding: 'utf-8', env: { ...process.env, HOME: home } },
  );
  return out.stdout;
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init -q', { cwd: dir, stdio: 'pipe' });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir, stdio: 'pipe' });
}

describe('parseLedgerRootOutput', () => {
  it('reads two absolute lines as the toplevel and the common git directory', () => {
    expect(parseLedgerRootOutput('/r/wt\n/r/main/.git\n')).toEqual({ kind: 'roots', toplevel: '/r/wt', commonDir: '/r/main/.git' });
  });

  it('reads the git < 2.31 echo (the flag back as its own line) as the toplevel only', () => {
    expect(parseLedgerRootOutput('--path-format=absolute\n/r/wt\n.git\n')).toEqual({ kind: 'toplevel', toplevel: '/r/wt' });
  });

  it('refuses any other shape', () => {
    for (const out of ['', '/r/wt\n', 'r/wt\n/r/.git\n', '/r/wt\n.git\n', '/a\n/b\n/c\n', '--path-format=absolute\nr/wt\n.git\n']) {
      expect(parseLedgerRootOutput(out), JSON.stringify(out)).toEqual({ kind: 'unrecognised' });
    }
  });
});

// Real git fixtures, one or two git spawns per case: budgeted past vitest's 5 s default.
describe('getLedgerRoot — the hooks\' ledger rule on real git (D-LEDGER-MAIN-WORKTREE)', { timeout: 30_000 }, () => {
  let base: string;
  let main: string;
  let sub: string;
  let wt: string;
  let bareMain: string;
  let bareWt: string;
  let outside: string;
  let home: string;

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-root-')));
    home = path.join(base, 'home');
    fs.mkdirSync(home);
    main = path.join(base, 'main');
    initRepo(main);
    fs.mkdirSync(path.join(main, '.devflow', 'curation'), { recursive: true });
    sub = path.join(main, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    wt = path.join(base, 'wt');
    execSync(`git worktree add -q "${wt}" -b feat`, { cwd: main, stdio: 'pipe' });
    // A main checkout that never ran devflow: no .devflow/ to anchor on.
    bareMain = path.join(base, 'bare-main');
    initRepo(bareMain);
    bareWt = path.join(base, 'bare-wt');
    execSync(`git worktree add -q "${bareWt}" -b feat`, { cwd: bareMain, stdio: 'pipe' });
    outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('a linked worktree resolves to the main checkout when main has .devflow/', async () => {
    expect(await getLedgerRoot(wt, { home })).toBe(main);
  });

  it('the main checkout and its subdirectory resolve to the main checkout', async () => {
    expect(await getLedgerRoot(main, { home })).toBe(main);
    expect(await getLedgerRoot(sub, { home })).toBe(main);
  });

  it('a linked worktree of a main checkout without .devflow/ keeps its own toplevel', async () => {
    expect(await getLedgerRoot(bareWt, { home })).toBe(bareWt);
  });

  it('a main checkout at HOME (a dotfiles repository) is refused: the worktree keeps its toplevel', async () => {
    expect(await getLedgerRoot(wt, { home: main })).toBe(wt);
    // Physical compare: HOME reached through a symlink is still HOME.
    const link = path.join(base, 'home-link');
    fs.symlinkSync(main, link);
    expect(await getLedgerRoot(wt, { home: link })).toBe(wt);
  });

  it('outside a git repository there is no ledger root (null — the caller keeps its fallback)', async () => {
    expect(await getLedgerRoot(outside, { home })).toBeNull();
  });

  it('agrees with the hooks\' df_resolve_roots on every fixture', async () => {
    for (const [cwd, h] of [[main, home], [sub, home], [wt, home], [bareWt, home], [wt, main]] as const) {
      expect(await getLedgerRoot(cwd, { home: h }), cwd).toBe(hookLedgerRoot(cwd, h));
    }
  });
});

// A hung git (a stalled mount) must not hold a caller for ever. The fake `git` is first on PATH
// for the length of one test only; HOME is never touched.
describe('getLedgerRoot — a git that hangs is bounded', { timeout: 30_000 }, () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  /** Budget handed to the lookups here: short, so the tests stay fast. */
  const BUDGET_MS = 300;
  /** What a lookup may take beyond its budget: the kill grace plus a loaded machine. */
  const MARGIN_MS = 3_000;
  let base: string;
  let work: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-root-hang-')));
    work = path.join(base, 'work');
    fs.mkdirSync(work);
    fs.mkdirSync(path.join(base, 'bin'));
    savedPath = process.env.PATH;
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    fs.rmSync(base, { recursive: true, force: true });
  });

  /** Put a `git` that runs `body` first on PATH, for the rest of this test. */
  function fakeGit(body: string): void {
    writeFakeExecutable(path.join(base, 'bin', 'git'), `#!/bin/bash\n${body}\n`);
    process.env.PATH = `${path.join(base, 'bin')}${path.delimiter}${savedPath ?? ''}`;
  }

  async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const started = Date.now();
    const value = await run();
    return { value, ms: Date.now() - started };
  }

  it('shares the HUD\'s one-second budget', () => {
    expect(LEDGER_ROOT_TIMEOUT_MS).toBe(1000);
  });

  it('answers timed-out within the budget when git sleeps, and getLedgerRoot answers null', async () => {
    fakeGit('exec sleep 30');

    const lookup = await timed(() => lookupLedgerRoot(work, { timeoutMs: BUDGET_MS }));
    expect(lookup.value).toEqual({ kind: 'timed-out' });
    expect(lookup.ms).toBeLessThan(BUDGET_MS + MARGIN_MS);

    const root = await timed(() => getLedgerRoot(work, { timeoutMs: BUDGET_MS }));
    expect(root.value).toBeNull();
    expect(root.ms).toBeLessThan(BUDGET_MS + MARGIN_MS);
  });

  it('answers within the budget even when git ignores the polite kill', async () => {
    fakeGit("trap '' TERM\nsleep 3");

    const lookup = await timed(() => lookupLedgerRoot(work, { timeoutMs: BUDGET_MS }));

    expect(lookup.value).toEqual({ kind: 'timed-out' });
    expect(lookup.ms).toBeLessThan(BUDGET_MS + MARGIN_MS);
  });

  it('bounds the fallback call too: a first answer that is not recognised, then a git that sleeps', async () => {
    fakeGit('case "$*" in\n  *--git-common-dir*) echo "not a path"; exit 0 ;;\n  *) exec sleep 30 ;;\nesac');

    const lookup = await timed(() => lookupLedgerRoot(work, { timeoutMs: BUDGET_MS }));

    expect(lookup.value).toEqual({ kind: 'timed-out' });
    expect(lookup.ms).toBeLessThan(BUDGET_MS + MARGIN_MS);
  });

  it('answers the toplevel from the fallback when the first answer is not recognised', async () => {
    fakeGit('case "$*" in\n  *--git-common-dir*) echo "not a path"; exit 0 ;;\n  *) echo /some/where/else; exit 0 ;;\nesac');

    expect(await lookupLedgerRoot(work, { timeoutMs: BUDGET_MS })).toEqual({ kind: 'root', root: '/some/where/else' });
  });

  it('answers no-root, not timed-out, when git fails fast (not a work tree)', async () => {
    fakeGit('echo "fatal: not a git repository" >&2\nexit 128');

    expect(await lookupLedgerRoot(work, { timeoutMs: BUDGET_MS })).toEqual({ kind: 'no-root' });
    expect(await getLedgerRoot(work, { timeoutMs: BUDGET_MS })).toBeNull();
  });
});
