/**
 * install-backup-isolation: the backup tests never reach the developer's real home, and the
 * backup module stays a leaf.
 *
 * What it asserts
 * ---------------
 * 1. Every backup test file (`tests/installer/install-backup*.test.ts`,
 *    `tests/installer/folder-swap.test.ts` and `tests/installer/workflow-folder-backup.test.ts`):
 *    a. calls `assertTempHome(` on a home it made, and logs that home with `console.log(` after
 *       that call and before the first use of the code under test;
 *    b. never asks for the real home (`os.homedir(`, `homedir(`, `os.userInfo(`);
 *    c. injects the clock and the random bytes: no `Date.now(`, no `new Date()` without an
 *       argument, no `Math.random(` and no `randomBytes(`, and every `createBackupSession(` call
 *       names both `now` and `bytes`.
 * 2. `src/targets/claude-code/install-backup.ts` imports only node builtins and files under
 *    `src/core/`, and none of the installer, curation, compliance, workflow-folder or reference
 *    converge modules and no `cli` module.
 *
 * What a green run does NOT prove
 * -------------------------------
 * The checks read the text of each file. A home reached through a helper in another file, or a
 * clock read through a name this guard does not list, is not seen. The reach arm below fails by
 * name if a file it expects is not found, so a rename that drops a file from the guard fails.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { builtinModules } from 'module';
import * as path from 'path';

import { ROOT } from '../helpers.js';

const INSTALLER_TESTS = path.join(ROOT, 'tests', 'installer');
const MODULE_PATH = path.join(ROOT, 'src', 'targets', 'claude-code', 'install-backup.ts');
const CORE_DIR = path.join(ROOT, 'src', 'core');

const BACKUP_TEST_NAME = /^(?:install-backup.*|folder-swap|workflow-folder-backup)\.test\.ts$/;

/** The backup test files that exist today. A file here that the name pattern does not find fails the reach arm. */
const EXPECTED_BACKUP_TESTS = [
  'folder-swap.test.ts',
  'install-backup-converge.test.ts',
  'install-backup-e2e.test.ts',
  'install-backup-empty-run.test.ts',
  'install-backup-failures.test.ts',
  'install-backup-install.test.ts',
  'install-backup-report.test.ts',
  'install-backup.test.ts',
  'workflow-folder-backup.test.ts',
];

/** The first use of the code under test: the home must be asserted and logged before any of these. */
const FIRST_USE_MARKERS = [
  'createBackupSession(',
  'testBackups(',
  'installViaFileCopy(',
  'installWorkflowFolder(',
  'convergeWorkflowFolders(',
  'convergeVariantAxes(',
  'execFileSync(',
  'spawnSync(',
];

const REAL_HOME_CALLS = ['os.homedir(', 'homedir(', 'os.userInfo(', 'userInfo('];
const REAL_CLOCK_AND_RANDOM = ['Date.now(', 'Math.random(', 'randomBytes(', 'randomUUID('];

const BARRED_MODULES = [
  'installer',
  'curation-install',
  'compliance-install',
  'workflow-folder-install',
  'reference-converge',
];

function backupTestFiles(): string[] {
  const named = readdirSync(INSTALLER_TESTS).filter(name => BACKUP_TEST_NAME.test(name));
  return named.sort().map(name => path.join(INSTALLER_TESTS, name));
}

/** The expected backup test files that `found` leaves out. */
export function missingBackupTests(found: readonly string[]): string[] {
  return EXPECTED_BACKUP_TESTS.filter(name => !found.includes(name));
}

/** The text between the parentheses of the call that opens at `from` (just after the open one). */
function callArguments(source: string, from: number): string {
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    if (ch === ')' && --depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

function firstIndex(source: string, needles: readonly string[]): number {
  const found = needles.map(needle => source.indexOf(needle)).filter(index => index !== -1);
  return found.length === 0 ? -1 : Math.min(...found);
}

/** What is wrong with the isolation of one backup test file, as short messages. */
export function isolationViolations(source: string): string[] {
  const problems: string[] = [];

  const asserted = source.indexOf('assertTempHome(');
  if (asserted === -1) problems.push('does not call assertTempHome(');
  const logged = asserted === -1 ? -1 : source.slice(asserted).search(/console\.log\([^\n]*home/i);
  if (asserted !== -1 && logged === -1) problems.push('does not log the home after assertTempHome(');
  const firstUse = firstIndex(source, FIRST_USE_MARKERS);
  if (logged !== -1 && firstUse !== -1 && asserted + logged > firstUse) {
    problems.push('uses the code under test before it asserts and logs the home');
  }
  if (asserted !== -1 && firstUse !== -1 && asserted > firstUse) {
    problems.push('uses the code under test before it asserts the home');
  }

  for (const call of REAL_HOME_CALLS) {
    if (source.includes(call)) problems.push(`asks for the real home with ${call}`);
  }
  for (const call of [...REAL_CLOCK_AND_RANDOM, 'new Date()']) {
    if (source.includes(call)) problems.push(`reads the real clock or randomness with ${call}`);
  }

  for (let from = source.indexOf('createBackupSession('); from !== -1; from = source.indexOf('createBackupSession(', from + 1)) {
    const args = callArguments(source, from + 'createBackupSession('.length);
    for (const key of ['now', 'bytes']) {
      if (!new RegExp(`\\b${key}\\b`).test(args)) problems.push(`createBackupSession( call does not inject ${key}`);
    }
  }
  return problems;
}

/** What is wrong with the imports of the backup module, as short messages. */
export function importViolations(source: string, file: string): string[] {
  const problems: string[] = [];
  const specifiers = [...source.matchAll(/(?:\bfrom|\bimport\(|\brequire\()\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
  const builtins = new Set(builtinModules);
  for (const specifier of specifiers) {
    const base = path.basename(specifier).replace(/\.(?:js|ts)$/, '');
    if (BARRED_MODULES.includes(base)) problems.push(`imports the barred module ${specifier}`);
    if (specifier.startsWith('node:') || builtins.has(specifier)) continue;
    if (!specifier.startsWith('.')) {
      problems.push(`imports ${specifier}, which is not a node builtin`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), specifier);
    const rel = path.relative(CORE_DIR, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) problems.push(`imports ${specifier}, which is outside src/core`);
  }
  return problems;
}

describe('backup test isolation', () => {
  it('reaches every backup test file it is expected to guard', () => {
    const names = backupTestFiles().map(file => path.basename(file));
    expect(missingBackupTests(names)).toEqual([]);
  });

  it.each(backupTestFiles().map(file => [path.basename(file), file] as const))(
    '%s uses a temp home, logs it first and injects the clock',
    (_name, file) => {
      expect(isolationViolations(readFileSync(file, 'utf8'))).toEqual([]);
    },
  );
});

describe('the reach of the guard', () => {
  it('names each expected file that the search leaves out', () => {
    expect(missingBackupTests(EXPECTED_BACKUP_TESTS)).toEqual([]);
    expect(missingBackupTests(EXPECTED_BACKUP_TESTS.filter(name => name !== 'folder-swap.test.ts'))).toEqual(['folder-swap.test.ts']);
    expect(missingBackupTests([])).toEqual(EXPECTED_BACKUP_TESTS);
  });

  it('finds every expected file by the name pattern and no helper or other test', () => {
    for (const name of EXPECTED_BACKUP_TESTS) expect(BACKUP_TEST_NAME.test(name), name).toBe(true);
    expect(BACKUP_TEST_NAME.test('install-backup-harness.ts')).toBe(false);
    expect(BACKUP_TEST_NAME.test('folder-swap-other.test.ts')).toBe(false);
  });
});

describe('isolationViolations', () => {
  const good = [
    "const home = await fs.mkdtemp(path.join(os.tmpdir(), 'x'));",
    'assertTempHome(home);',
    'console.log(`test home: ${home}`);',
    'createBackupSession({ shipped, retired, claudeDir, devflowDir, now: clock, bytes: stampBytes });',
  ].join('\n');

  it('passes a file that asserts, logs, then injects', () => {
    expect(isolationViolations(good)).toEqual([]);
  });

  it('flags a file that never asserts the home', () => {
    expect(isolationViolations(good.replace('assertTempHome(home);', ''))).toContain('does not call assertTempHome(');
  });

  it('flags a file that never logs the home', () => {
    expect(isolationViolations(good.replace(/console\.log.*\n/, ''))).toContain('does not log the home after assertTempHome(');
  });

  it('flags a file that uses the code under test before it logs the home', () => {
    const late = 'createBackupSession({ now, bytes });\nassertTempHome(home);\nconsole.log(home);';
    expect(isolationViolations(late)).toContain('uses the code under test before it asserts the home');
  });

  it('flags a request for the real home', () => {
    expect(isolationViolations(`${good}\nconst real = os.homedir();`)).toContain('asks for the real home with os.homedir(');
  });

  it('flags the real clock and randomness', () => {
    expect(isolationViolations(`${good}\nconst t = Date.now();`)).toContain('reads the real clock or randomness with Date.now(');
    expect(isolationViolations(`${good}\nconst d = new Date();`)).toContain('reads the real clock or randomness with new Date()');
    expect(isolationViolations(`${good}\nconst r = Math.random();`)).toContain('reads the real clock or randomness with Math.random(');
  });

  it('flags a createBackupSession call that leaves out the clock or the bytes', () => {
    expect(isolationViolations(good.replace('now: clock, ', ''))).toContain('createBackupSession( call does not inject now');
    expect(isolationViolations(good.replace(', bytes: stampBytes', ''))).toContain('createBackupSession( call does not inject bytes');
  });
});

describe('backup module layering', () => {
  const file = MODULE_PATH;

  it('imports only node builtins and src/core, and none of the barred modules', () => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain("from 'fs'");
    expect(importViolations(source, file)).toEqual([]);
  });

  it.each([
    ["import { x } from './installer.js';", 'imports the barred module ./installer.js'],
    ["import { x } from './curation-install.js';", 'imports the barred module ./curation-install.js'],
    ["import { x } from './compliance-install.js';", 'imports the barred module ./compliance-install.js'],
    ["import { x } from './workflow-folder-install.js';", 'imports the barred module ./workflow-folder-install.js'],
    ["import { x } from './reference-converge.js';", 'imports the barred module ./reference-converge.js'],
    ["import { x } from '../../cli/commands/init.js';", 'imports ../../cli/commands/init.js, which is outside src/core'],
    ["const x = await import('./linked-folder.js');", 'imports ./linked-folder.js, which is outside src/core'],
    ["import { x } from 'picocolors';", 'imports picocolors, which is not a node builtin'],
  ])('flags %s', (source, message) => {
    expect(importViolations(source, file)).toContain(message);
  });

  it('allows node builtins and core files', () => {
    const source = [
      "import { promises as fs } from 'fs';",
      "import * as path from 'node:path';",
      "import { isContainedIn } from '../../core/paths.js';",
    ].join('\n');
    expect(importViolations(source, file)).toEqual([]);
  });
});
