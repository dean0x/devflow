/**
 * no-system-managed-spawn — no test file spawns the CLI into the managed-settings
 * removal without the shared skip guard (#406, D-TESTS-NO-SYSTEM-MANAGED in
 * tests/helpers/managed-settings.ts).
 *
 * `init --security none` and `security --disable` strip the Devflow deny list
 * from the platform managed-settings file, an absolute system path no sandboxed
 * HOME redirects, with a direct write or unlink before any TTY or sudo step. On
 * a root run, or a machine whose managed file or directory is writable, a test
 * spawning either would silently rewrite or delete that machine's real file.
 *
 * What it asserts
 * ---------------
 * Every file under `tests/` whose code passes either as CLI arguments — the
 * quoted-token pairs `'--security', 'none'` and `'security', '--disable'` (any
 * quote, any whitespace or newline between them) or the single token
 * `'--security=none'` — both imports `systemManagedSettingsAtRisk` from
 * `helpers/managed-settings.js` and declares a test or suite with
 * `.skipIf(systemManagedSettingsAtRisk())`. A test that does not need the
 * `none` mode installs with `--security user` instead.
 *
 * What a green run does NOT prove (PF-064)
 * ----------------------------------------
 * The matcher reads the arguments as they are spelled. An argument assembled at
 * runtime (`['--security', mode]`), a shell-string spawn (`execSync('devflow
 * security --disable')`, none of which the suite uses) and prose naming the
 * command — a comment, a test title, an object key — are not matches. The check
 * is per file: it proves the file uses the guard, not that each spawning test
 * sits under it. The corpus is `tests/` code files minus this guard, whose
 * seeded probes spell the arguments on purpose.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js';
import { managedSettingsWritable, systemManagedSettingsAtRisk } from '../helpers/managed-settings.js';

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** The CLI arguments that reach the managed-settings removal, as quoted tokens. */
const MANAGED_REMOVAL_ARGS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: '--security none', pattern: /(['"`])--security\1\s*,\s*(['"`])none\2/ },
  { name: '--security=none', pattern: /(['"`])--security=none\1/ },
  { name: 'security --disable', pattern: /(['"`])security\1\s*,\s*(['"`])--disable\2/ },
];

/** The shared guard helper, imported from its one module. */
const GUARD_IMPORT = /import\s*\{[^}]*\bsystemManagedSettingsAtRisk\b[^}]*\}\s*from\s*(['"])[^'"]*\/helpers\/managed-settings\.js\1/;
/** A test or suite declared under the guard. */
const GUARD_SKIP = /\.skipIf\(\s*systemManagedSettingsAtRisk\(\)\s*\)/;

interface UnguardedSpawn {
  path: string;
  line: number;
  arg: string;
  missing: 'import' | 'skipIf' | 'import and skipIf';
}

/** The first line of `content` at which `pattern` matches (patterns may span lines). */
function lineOf(content: string, pattern: RegExp): number {
  const at = pattern.exec(content)?.index ?? 0;
  return content.slice(0, at).split('\n').length;
}

/**
 * Every managed-removal argument in a file that lacks the guard. Pure — the live
 * arm and the seeded probes run this same function.
 */
function findUnguardedManagedSpawns(corpus: readonly CorpusEntry[]): UnguardedSpawn[] {
  const found: UnguardedSpawn[] = [];
  for (const entry of corpus) {
    const hasImport = GUARD_IMPORT.test(entry.content);
    const hasSkip = GUARD_SKIP.test(entry.content);
    if (hasImport && hasSkip) continue;
    const missing = !hasImport && !hasSkip ? 'import and skipIf' : !hasImport ? 'import' : 'skipIf';
    for (const { name, pattern } of MANAGED_REMOVAL_ARGS) {
      if (pattern.test(entry.content)) {
        found.push({ path: entry.path, line: lineOf(entry.content, pattern), arg: name, missing });
      }
    }
  }
  return found;
}

/** Every file in `corpus` that passes a managed-removal argument, guarded or not. */
function findManagedSpawners(corpus: readonly CorpusEntry[]): string[] {
  return corpus.filter(e => MANAGED_REMOVAL_ARGS.some(({ pattern }) => pattern.test(e.content))).map(e => e.path);
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const SELF = 'tests/guards/no-system-managed-spawn.test.ts';
const CODE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];

const corpus: CorpusEntry[] = walkFiles(path.join(ROOT, 'tests'), file => CODE_EXTENSIONS.includes(path.extname(file)))
  .map(file => ({
    path: path.relative(ROOT, file).split(path.sep).join('/'),
    content: readFileSync(file, 'utf-8'),
  }))
  .filter(entry => entry.path !== SELF);

// ---------------------------------------------------------------------------
// Live arms
// ---------------------------------------------------------------------------

describe('no test spawns the managed-settings removal unguarded (D-TESTS-NO-SYSTEM-MANAGED)', () => {
  it('reaches the one test that needs the `none` mode, and sees its arguments', () => {
    // Non-vacuity: the corpus holds the tests, and the matcher recognises the
    // guarded `--security none` re-init they carry.
    expect(corpus.length).toBeGreaterThan(100);
    expect(findManagedSpawners(corpus)).toContain('tests/init-machine-switch-e2e.test.ts');
  });

  it('every file passing --security none or security --disable uses the shared skip guard', () => {
    const offenders = findUnguardedManagedSpawns(corpus);
    expect(
      offenders.map(o => `${o.path}:${o.line}: \`${o.arg}\` without the ${o.missing} — use --security user, or it.skipIf(systemManagedSettingsAtRisk())`),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seeded probes (PF-064): the matcher goes red on every spelling a spawn can
// take, and stays green on prose and on a guarded file.
// ---------------------------------------------------------------------------

describe('no-system-managed-spawn guard: seeded probes', () => {
  const FILE = 'tests/example-e2e.test.ts';
  const IMPORT = "import { systemManagedSettingsAtRisk } from './helpers/managed-settings.js';\n";
  const SKIP = "it.skipIf(systemManagedSettingsAtRisk())('strips the deny list', () => {});\n";

  const KNOWN_BAD: ReadonlyArray<{ name: string; content: string; arg: string; missing: UnguardedSpawn['missing'] }> = [
    { name: 'an init argument array', content: "const MINIMAL = ['init', '--security', 'none'];", arg: '--security none', missing: 'import and skipIf' },
    { name: 'a spread-in argument list', content: "const common = ['--recommended', \"--security\", \"none\"];\nrunCli('init', ...common);", arg: '--security none', missing: 'import and skipIf' },
    { name: 'arguments split across lines', content: "spawnSync('node', [CLI, 'init',\n  '--security',\n  'none',\n]);", arg: '--security none', missing: 'import and skipIf' },
    { name: 'the joined flag', content: "runInit(repo, '--security=none');", arg: '--security=none', missing: 'import and skipIf' },
    { name: 'security --disable', content: "runCli(home, 'security', '--disable');", arg: 'security --disable', missing: 'import and skipIf' },
    { name: 'the import without the skip', content: `${IMPORT}runInit(repo, '--security', 'none');`, arg: '--security none', missing: 'skipIf' },
    { name: 'the skip without the shared import', content: `${SKIP}runInit(repo, '--security', 'none');`, arg: '--security none', missing: 'import' },
    {
      name: 'a skip on a local copy of the helper',
      content: `import { systemManagedSettingsAtRisk } from './local.js';\n${SKIP}runInit(repo, '--security', 'none');`,
      arg: '--security none',
      missing: 'import',
    },
  ];

  for (const probe of KNOWN_BAD) {
    it(`reports ${probe.name}`, () => {
      const found = findUnguardedManagedSpawns([{ path: FILE, content: probe.content }]);
      expect(found.map(f => [f.arg, f.missing])).toEqual([[probe.arg, probe.missing]]);
    });
  }

  it('names the line the argument starts on', () => {
    const found = findUnguardedManagedSpawns([{ path: FILE, content: "// header\n\nrunInit(repo,\n  '--security', 'none');" }]);
    expect(found.map(f => f.line)).toEqual([4]);
  });

  it('does not report prose, other modes, or a guarded file', () => {
    const clean: CorpusEntry[] = [
      { path: FILE, content: "// init --security none strips the managed file\nit('`--security none` re-init', () => {});" },
      { path: FILE, content: "const UNFENCED = { 'security --disable': 'reason' };\nexpect(text).not.toContain('devflow security --disable');" },
      { path: FILE, content: "runInit(repo, '--security', 'user');\nrunCli(home, 'security', '--enable');" },
      { path: FILE, content: `${IMPORT}${SKIP}runInit(repo, '--security', 'none');\nrunCli(home, 'security', '--disable');` },
    ];
    expect(findUnguardedManagedSpawns(clean)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The shared helper
// ---------------------------------------------------------------------------

describe('systemManagedSettingsAtRisk', () => {
  it('is at risk as root whatever the file permissions', () => {
    expect(systemManagedSettingsAtRisk(0, () => false)).toBe(true);
  });

  it('is at risk when the managed file is writable, and not otherwise', () => {
    expect(systemManagedSettingsAtRisk(501, () => true)).toBe(true);
    expect(systemManagedSettingsAtRisk(501, () => false)).toBe(false);
    expect(systemManagedSettingsAtRisk(undefined, () => false)).toBe(false);
  });
});

describe('managedSettingsWritable', () => {
  it('is writable when the file or its directory is, and not on an unsupported platform', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'df-managed-writable-'));
    try {
      const file = path.join(dir, 'managed-settings.json');
      // A missing file in a writable directory: the unlink and a later write both reach it.
      expect(managedSettingsWritable(() => file)).toBe(true);
      writeFileSync(file, '{}');
      expect(managedSettingsWritable(() => file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(managedSettingsWritable(() => { throw new Error('Managed settings not supported on platform: win32'); })).toBe(false);
  });

  it('is not writable when neither the path nor its directory exists', () => {
    const missing = path.join(os.tmpdir(), `df-managed-missing-${process.pid}`, 'nested', 'managed-settings.json');
    expect(managedSettingsWritable(() => missing)).toBe(false);
  });
});
