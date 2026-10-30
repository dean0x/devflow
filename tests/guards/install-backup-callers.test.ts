/**
 * install-backup-callers: every place that swaps a devflow skill folder in goes through the backup
 * session, and a registered workflow folder is covered by the session's shipped set.
 *
 * What it asserts
 * ---------------
 * 1. Every call of `installWorkflowFolder`, `swapInSkillDirectory`, `installSkillDir` and
 *    `promoteUnitStagingTree` (the swap of a references unit folder) in `src/`
 *    passes `backups`. A call without the session would swap a folder and delete the files of the
 *    user that stand in it. Each name has at least one call, so the scan is not empty by design.
 * 2. Every call of `loadShippedSet` in `src/` passes `workflowFolders`, so a session is never built
 *    from a shipped set that lacks the registered folders.
 * 3. A folder registered in a workflow folder registry is covered: a session built from that
 *    registry moves none of the files the folder holds under any of the four variant keys, and a
 *    session built without the folder moves them. The check runs on the real registry, whatever it
 *    holds, and on the fixture registry, which keeps it from passing because the real one is empty.
 *
 * What a green run does NOT prove
 * -------------------------------
 * The scan reads the text of each file: a call made through an alias, or a swap written by hand with
 * `rename`, is not seen. Part 3 proves the set, not that a given install step uses the session.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, readdirSync, readFileSync, statSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { VARIANT_KEYS } from '../../src/core/curation-variants.js';
import { WORKFLOW_FOLDERS, workflowFolderFiles, type WorkflowFolder } from '../../src/core/mds-variants.js';
import { FIXTURE_FOLDER } from '../fixtures/workflow-folder.js';
import { ROOT, testBackups } from '../helpers.js';
import { assertTempHome, TEMP_HOME_PREFIX } from '../setup/home-isolation.js';

const SRC = path.join(ROOT, 'src');
const SESSION_CALLS = ['installWorkflowFolder', 'swapInSkillDirectory', 'installSkillDir', 'promoteUnitStagingTree'] as const;

/** Every `.ts` file below `dir`, sorted. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** The source without block comments and line comments, so a name in a comment is not a call. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}()])\/\/.*$/gm, '$1');
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

interface Call {
  readonly name: string;
  readonly args: string;
}

/** The calls of `name` in `source`. A declaration (`function name(`) is not a call. */
export function callsOf(source: string, name: string): Call[] {
  const text = withoutComments(source);
  const calls: Call[] = [];
  const pattern = new RegExp(`(?<![\\w.])${name}\\(`, 'g');
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (/\bfunction\s+$/.test(text.slice(0, match.index))) continue;
    calls.push({ name, args: callArguments(text, match.index + match[0].length) });
  }
  return calls;
}

/** The calls of `names` in `source` whose arguments lack the identifier `key`, as short messages. */
export function callsWithout(source: string, names: readonly string[], key: string): string[] {
  const missing = new RegExp(`\\b${key}\\b`);
  return names.flatMap(name => callsOf(source, name))
    .filter(call => !missing.test(call.args))
    .map(call => `${call.name}( call does not pass ${key}`);
}

describe('callers of the folder swaps', () => {
  const files = sourceFiles(SRC).map(file => [path.relative(ROOT, file), readFileSync(file, 'utf8')] as const);

  it('reaches the files it guards', () => {
    const names = files.map(([name]) => name);
    expect(names).toContain('src/targets/claude-code/curation-install.ts');
    expect(names).toContain('src/targets/claude-code/compliance-install.ts');
    expect(names).toContain('src/targets/claude-code/installer.ts');
  });

  it.each(SESSION_CALLS)('finds a call of %s', name => {
    const found = files.flatMap(([, source]) => callsOf(source, name));
    expect(found.length).toBeGreaterThan(0);
  });

  it('passes backups in every call of installWorkflowFolder, swapInSkillDirectory, installSkillDir and promoteUnitStagingTree', () => {
    const violations = files.flatMap(([file, source]) => callsWithout(source, SESSION_CALLS, 'backups').map(message => `${file}: ${message}`));
    expect(violations).toEqual([]);
  });

  it('passes workflowFolders in every call of loadShippedSet', () => {
    expect(files.flatMap(([, source]) => callsOf(source, 'loadShippedSet')).length).toBeGreaterThan(0);
    const violations = files.flatMap(([file, source]) => callsWithout(source, ['loadShippedSet'], 'workflowFolders').map(message => `${file}: ${message}`));
    expect(violations).toEqual([]);
  });
});

describe('callsWithout', () => {
  const good = [
    'await installWorkflowFolder({ claudeDir, name, files, links, backups });',
    'await swapInSkillDirectory(claudeDir, resolved.dir, target, links, opts.backups);',
    'await installSkillDir(claudeDir, devflowDir, frameworks, fragments, warn, links, backups);',
    'const promoted = await promoteUnitStagingTree(unit, opts.referencesTarget, built.stagingDir, opts.backups);',
  ].join('\n');

  it('passes calls that name the session', () => {
    expect(callsWithout(good, SESSION_CALLS, 'backups')).toEqual([]);
  });

  it('flags a call that leaves the session out', () => {
    const bad = 'await installWorkflowFolder({ claudeDir, name, files, links });';
    expect(callsWithout(bad, SESSION_CALLS, 'backups')).toEqual(['installWorkflowFolder( call does not pass backups']);
    const positional = 'await swapInSkillDirectory(claudeDir, sourceDir, target, links);';
    expect(callsWithout(positional, SESSION_CALLS, 'backups')).toEqual(['swapInSkillDirectory( call does not pass backups']);
    const overlayUnit = 'await promoteUnitStagingTree(unit, opts.referencesTarget, built.stagingDir);';
    expect(callsWithout(overlayUnit, SESSION_CALLS, 'backups')).toEqual(['promoteUnitStagingTree( call does not pass backups']);
  });

  it('does not take a declaration or a name in a comment for a call', () => {
    const source = [
      'async function swapInSkillDirectory(claudeDir: string, backups: BackupSession): Promise<void> {}',
      '// installSkillDir(claudeDir) is called once',
      '/* installWorkflowFolder({ claudeDir }) */',
    ].join('\n');
    expect(callsOf(source, 'swapInSkillDirectory')).toEqual([]);
    expect(callsOf(source, 'installSkillDir')).toEqual([]);
    expect(callsOf(source, 'installWorkflowFolder')).toEqual([]);
  });

  it('does not take a method of another name for a call', () => {
    expect(callsOf('await other.installSkillDir(a);', 'installSkillDir')).toEqual([]);
  });
});

describe('registered workflow folders and the shipped set', () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_HOME_PREFIX));
    assertTempHome(home);
    console.log(`install-backup-callers test home: ${await fs.realpath(home)}`);
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  /**
   * The files a session moves out of the registered folders when each folder holds the files of all
   * four variant keys. The session's shipped set is built from `sessionFolders`.
   */
  async function movedFromRegistered(registry: readonly WorkflowFolder[], sessionFolders: readonly WorkflowFolder[]): Promise<string[]> {
    const claudeDir = path.join(home, '.claude');
    const folders = registry.map(folder => path.join(claudeDir, 'skills', `devflow:${folder.name}`));
    for (const [index, folder] of registry.entries()) {
      for (const key of VARIANT_KEYS) {
        for (const file of workflowFolderFiles(folder, key)) {
          const target = path.join(folders[index], ...file.split('/'));
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, `${file} for ${key}\n`);
        }
      }
    }
    const session = await testBackups(home, { workflowFolders: sessionFolders });
    await session.prepass(folders);
    return session.snapshot().moved.map(unit => path.relative(claudeDir, unit.original)).sort();
  }

  it('moves no file of a folder in the real registry, whatever the registry holds', async () => {
    expect(await movedFromRegistered(WORKFLOW_FOLDERS, WORKFLOW_FOLDERS)).toEqual([]);
  });

  it('moves no file of a folder in the fixture registry', async () => {
    expect(await movedFromRegistered([FIXTURE_FOLDER], [FIXTURE_FOLDER])).toEqual([]);
  });

  it('reports the files of a fixture folder when the session was built without it', async () => {
    const moved = await movedFromRegistered([FIXTURE_FOLDER], []);

    expect(moved).toContain('skills/devflow:flow/SKILL.md');
    expect(moved, 'a folder nothing in the set names moves whole').toContain('skills/devflow:flow/references');
  });

  it('reports the files of every real folder when the session was built without the registry', async () => {
    const moved = await movedFromRegistered(WORKFLOW_FOLDERS, []);

    for (const folder of WORKFLOW_FOLDERS) {
      expect(moved.some(file => file.startsWith(`skills/devflow:${folder.name}/`)), `${folder.name} is reported`).toBe(true);
    }
  });
});
