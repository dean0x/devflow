import * as path from 'path';
import { LEGACY_COMMAND_NAMES, LEGACY_RULE_NAMES } from '../../core/plugins.js';
import { RETIRED_SHIPPED } from '../../core/retired-shipped-names.js';
import type { BackupSession } from '../../targets/claude-code/install-backup.js';
import { LEGACY_SKILL_NAMES } from '../../targets/claude-code/legacy.js';
import { directoryState, isUnrealFolder, type LinkReport } from '../../targets/claude-code/linked-folder.js';

/** The retired files {@link sweepLegacyDevflowFiles} removed, as paths. The backup session names them. */
export interface LegacySweepResult {
  readonly removed: readonly string[];
}

/**
 * Whether the sweep may remove files from `dir`: the install did not refuse it, nothing in it stays
 * because a move failed or the folder was too large to scan, and `lstat` shows a real folder or
 * nothing. `readdir` and `rm` of a path below a link act on the folder it points to.
 */
async function mayRemoveFrom(report: Pick<LinkReport, 'refusedFolders'>, backups: BackupSession, dir: string): Promise<boolean> {
  return !report.refusedFolders.includes(dir) && !backups.isKept(dir) && !(await isUnrealFolder(dir));
}

/** Each name once, in the order given. */
const uniqueNames = (...lists: ReadonlyArray<readonly string[]>): string[] => [...new Set(lists.flat())];

/**
 * Remove `<folder>/<name>.md` for each name, by exact name. A name that is shipped today is never
 * removed, and a file that stays is left for the session's record.
 */
async function removeRetiredMarkdown(folder: string, names: readonly string[], backups: BackupSession): Promise<string[]> {
  const removed: string[] = [];
  for (const name of names) {
    const file = path.join(folder, `${name}.md`);
    if (backups.classifyAt(file, 'file') === 'shipped') continue;
    if ((await backups.removeExact(file)).status === 'removed') removed.push(file);
  }
  return removed;
}

/**
 * Remove the files that earlier releases installed into `commands/devflow` and `rules/devflow` and
 * that no release installs now: the retired command and rule names and the legacy lists, each by its
 * exact name. Runs on every install shape, since the full install's pre-clean covers only a full
 * install. A file whose name only looks like a retired one (a `*-teams.md` of the user's) is not
 * matched here: the install's pre-pass moves it aside and names it.
 *
 * A folder the install refused (`report.refusedFolders`), that the session could not scan, or that
 * is a link now is skipped whole: the sweep reads and removes nothing there, and the folder a link
 * points to is left as it is. Every removal goes through `backups`, so each removed file is named
 * once, on the retired line of its record. Never throws.
 *
 * @param opts.legacyCommands - Legacy command names; added to the retired commands.
 * @param opts.legacyRules - Legacy rule names; added to the retired rules.
 */
export async function sweepLegacyDevflowFiles(opts: {
  claudeDir: string;
  report: Pick<LinkReport, 'refusedFolders'>;
  backups: BackupSession;
  legacyCommands?: readonly string[];
  legacyRules?: readonly string[];
}): Promise<LegacySweepResult> {
  const { claudeDir, report, backups } = opts;
  const commands = uniqueNames(RETIRED_SHIPPED.commands, opts.legacyCommands ?? LEGACY_COMMAND_NAMES);
  const rules = uniqueNames(RETIRED_SHIPPED.rules, opts.legacyRules ?? LEGACY_RULE_NAMES);
  const removed: string[] = [];

  const commandsDir = path.join(claudeDir, 'commands', 'devflow');
  if (await mayRemoveFrom(report, backups, commandsDir)) {
    removed.push(...await removeRetiredMarkdown(commandsDir, commands, backups));
  }

  const rulesDir = path.join(claudeDir, 'rules', 'devflow');
  if (await mayRemoveFrom(report, backups, rulesDir)) {
    removed.push(...await removeRetiredMarkdown(rulesDir, rules, backups));
  }

  return { removed };
}

/**
 * Deal with the skill folders that earlier installs left under the legacy names: every name of the
 * legacy skill list, bare and `devflow:`-prefixed.
 *
 * A folder that no release listed moves whole, with one rename and no walk, and is named; it is never
 * deleted. A name with a listing in `retiredFiles` (the files a release shipped in that folder) goes
 * by the listing instead: the listed files are removed, the rest of the folder moves, and a plain
 * `rmdir` removes the folder only when it is empty. A move that fails leaves the folder and its
 * files where they are, and the session records it. A name that is shipped today, or that an earlier
 * step could not move, is skipped, and so is every name when the skills folder is a link or not a
 * folder: nothing is moved through a link. Nothing here removes a folder with recursion. Never throws.
 *
 * @param opts.legacySkills - Folder names to deal with; defaults to the legacy skill list.
 * @param opts.retiredFiles - Released file listings by folder name; defaults to the retired registry.
 */
export async function sweepLegacySkillFolders(opts: {
  claudeDir: string;
  backups: BackupSession;
  legacySkills?: readonly string[];
  retiredFiles?: Readonly<Record<string, readonly string[]>>;
}): Promise<void> {
  const { backups } = opts;
  const retiredFiles = opts.retiredFiles ?? RETIRED_SHIPPED.skillFiles;
  const skillsDir = path.join(opts.claudeDir, 'skills');
  if ((await directoryState(skillsDir)) !== 'real') return;

  for (const name of opts.legacySkills ?? LEGACY_SKILL_NAMES) {
    const folder = path.join(skillsDir, name);
    if (backups.isKept(folder) || backups.classifyAt(folder, 'directory') === 'shipped') continue;
    const listed = Object.hasOwn(retiredFiles, name) && retiredFiles[name].length > 0;
    if (listed && (await directoryState(folder)) === 'real') {
      await backups.prepass([folder]);
      await backups.removeListed(folder);
    } else {
      await backups.moveWhole(folder);
    }
  }
}
