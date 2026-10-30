/**
 * Shared set-up for the install-backup tests: a temp home, one backup session per run with the
 * clock and the random bytes injected (`testBackups`), and an install that mirrors the arguments
 * `devflow init` passes. Nothing here reads or writes the real home.
 */
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  DEVFLOW_PLUGINS,
  buildAssetMaps,
  buildRulesMap,
  buildScopedSkillsMap,
  type PluginDefinition,
} from '../../src/core/plugins.js';
import type { BackupSession } from '../../src/targets/claude-code/install-backup.js';
import { installViaFileCopy, type InstallReport, type Spinner } from '../../src/targets/claude-code/installer.js';
import { LEGACY_SKILL_NAMES } from '../../src/targets/claude-code/legacy.js';
import { testBackups } from '../helpers.js';
import { assertTempHome, TEMP_HOME_PREFIX } from '../setup/home-isolation.js';

export interface TestHome {
  readonly home: string;
  readonly claudeDir: string;
  readonly devflowDir: string;
}

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

/** The plugins a default `devflow init` selects. */
export const DEFAULT_PLUGINS: readonly PluginDefinition[] = DEVFLOW_PLUGINS.filter(plugin => !plugin.optional);

export function pluginNamed(name: string): PluginDefinition {
  const found = DEVFLOW_PLUGINS.find(plugin => plugin.name === name);
  if (found === undefined) throw new Error(`no such plugin: ${name}`);
  return found;
}

/** The first `devflow:`-prefixed name of the legacy skill list. No release shipped such a folder. */
export function firstPrefixedLegacyName(): string {
  const found = LEGACY_SKILL_NAMES.find(name => name.startsWith('devflow:'));
  if (found === undefined) throw new Error('the legacy skill list holds no prefixed name');
  return found;
}

/** A temp home with an empty Claude dir and an empty devflow dir. The caller asserts and logs it. */
export async function makeHome(): Promise<TestHome> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_HOME_PREFIX));
  assertTempHome(home);
  const claudeDir = path.join(home, 'claude');
  const devflowDir = path.join(home, 'devflow');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  return { home, claudeDir, devflowDir };
}

export async function removeHome(home: TestHome): Promise<void> {
  await fs.rm(home.home, { recursive: true, force: true });
}

/** A backup session over the home, built when it is called (so after any skill shadow is written). */
export function openSession(home: TestHome): Promise<BackupSession> {
  return testBackups(home.home, { claudeDir: home.claudeDir, devflowDir: home.devflowDir });
}

export interface RunInstallOptions {
  /** `partial` installs `devflow-code-review` on top of the default plugins, as `--plugin=devflow-code-review` does. */
  readonly shape: 'full' | 'partial';
  readonly backups?: BackupSession;
  readonly warn?: (message: string) => void;
  /** The machine switches the install writes for. Both default to on. */
  readonly curation?: boolean;
  readonly compliance?: boolean;
}

/** One `installViaFileCopy` run with the arguments init passes for the shape. */
export async function runInstall(home: TestHome, options: RunInstallOptions): Promise<InstallReport> {
  const partial = options.shape === 'partial';
  const selected: readonly PluginDefinition[] = partial ? [pluginNamed('devflow-code-review')] : DEFAULT_PLUGINS;
  const effective = partial ? DEFAULT_PLUGINS : selected;
  const selectedList = [...selected];
  return installViaFileCopy({
    backups: options.backups ?? (await openSession(home)),
    curation: options.curation ?? true,
    compliance: options.compliance ?? true,
    plugins: selectedList,
    effectivePlugins: [...effective],
    claudeDir: home.claudeDir,
    devflowDir: home.devflowDir,
    skillsMap: buildScopedSkillsMap(effective),
    agentsMap: buildAssetMaps(selectedList).agentsMap,
    rulesMap: buildRulesMap(selectedList),
    isPartialInstall: partial,
    spinner: noopSpinner,
    warn: options.warn ?? (() => undefined),
  });
}

export const at = (home: TestHome, rel: string): string => path.join(home.claudeDir, ...rel.split('/'));

export const exists = (target: string): Promise<boolean> => fs.lstat(target).then(() => true, () => false);

/** Write a file below the Claude dir and return its path. */
export async function put(home: TestHome, rel: string, text = rel): Promise<string> {
  const target = at(home, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
  return target;
}

/** The backup root of the home, or null when no run made one. */
export function backupRootOf(home: TestHome): string | null {
  const root = path.join(home.devflowDir, 'install-backups');
  return existsSync(root) ? root : null;
}

/** The only run folder under the backup root; throws when there is not exactly one. */
export async function onlyRunFolder(home: TestHome): Promise<string> {
  const root = backupRootOf(home);
  if (root === null) throw new Error('no backup root');
  const names = await fs.readdir(root);
  if (names.length !== 1) throw new Error(`expected one run folder, found ${names.length}`);
  return path.join(root, names[0]);
}

/**
 * Every entry at or below `root` as relative path -> kind, mode and bytes (a link: its target), so a
 * changed byte, mode, file or folder shows. A missing root is an empty snapshot.
 */
export async function treeSnapshot(root: string, rel = '.'): Promise<Record<string, string>> {
  let stat;
  try {
    stat = await fs.lstat(root);
  } catch {
    return {};
  }
  const mode = (stat.mode & 0o777).toString(8);
  if (stat.isSymbolicLink()) return { [rel]: `link:${await fs.readlink(root)}` };
  if (!stat.isDirectory()) return { [rel]: `file:${mode}:${(await fs.readFile(root)).toString('base64')}` };
  const out: Record<string, string> = { [`${rel}/`]: `dir:${mode}` };
  for (const name of (await fs.readdir(root)).sort()) {
    Object.assign(out, await treeSnapshot(path.join(root, name), `${rel}/${name}`));
  }
  return out;
}

/** The file paths below `root`, relative and sorted. */
export async function filesBelow(root: string, rel = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await filesBelow(root, next)));
    else out.push(next);
  }
  return out;
}
