import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { LEGACY_COMMAND_NAMES, LEGACY_RULE_NAMES } from '../../core/plugins.js';
import { RETIRED_SHIPPED } from '../../core/retired-shipped-names.js';
import type { BackupSession } from '../../targets/claude-code/install-backup.js';
import { LEGACY_SKILL_NAMES } from '../../targets/claude-code/legacy.js';
import { BARE_LEGACY_SKILL_HASHES } from '../../targets/claude-code/legacy-skill-hashes.js';
import { directoryState, isUnrealFolder, type LinkReport } from '../../targets/claude-code/linked-folder.js';

/** The prefix of a skill folder in devflow's own namespace. A folder without it is bare. */
const NAMESPACE_PREFIX = 'devflow:';

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

/** The bare legacy folders that {@link sweepLegacySkillFolders} kept because it could not tell who made them. */
export interface LegacySkillSweepResult {
  readonly kept: readonly string[];
}

/** The most bytes of a `SKILL.md` the check reads. Every released copy is far smaller, so a larger file is not one. */
const MAX_SKILL_FILE_BYTES = 1024 * 1024;

/**
 * Who made a bare legacy skill folder, judged from its `SKILL.md` alone:
 *   - `devflow`: the file is a regular file whose SHA-256 is one of `released`;
 *   - `other`: the file reads and is not one of them, or is larger than any release copy;
 *   - `unknown`: the check cannot decide. There is no `SKILL.md`, it is not a regular file, the
 *     folder or the file is a link, or a read fails.
 * An `absent` folder needs no answer. Reads one file at most. Never throws.
 */
async function judgeBareSkillFolder(folder: string, released: readonly string[]): Promise<'absent' | 'devflow' | 'other' | 'unknown'> {
  const state = await directoryState(folder);
  if (state === 'absent') return 'absent';
  if (state !== 'real') return 'unknown';
  try {
    const skillFile = path.join(folder, 'SKILL.md');
    const stat = await fs.lstat(skillFile);
    if (!stat.isFile()) return 'unknown';
    if (stat.size > MAX_SKILL_FILE_BYTES) return 'other';
    const digest = createHash('sha256').update(await fs.readFile(skillFile)).digest('hex');
    return released.includes(digest) ? 'devflow' : 'other';
  } catch {
    return 'unknown';
  }
}

/**
 * Deal with the skill folders that earlier installs left under the legacy names: every name of the
 * legacy skill list, bare and `devflow:`-prefixed.
 *
 * A `devflow:`-prefixed folder that no release listed moves whole, with one rename and no walk, and
 * is named; it is never deleted. A bare folder lives in the skills folder that Claude Code and other
 * tools share, so its name proves nothing (`python`, `plan` and `review` are names of a user's own
 * skills too). It moves only when its `SKILL.md` is a copy that a release of devflow installed
 * (`released`). A bare folder whose `SKILL.md` is any other file stays where it is, and nothing is
 * said. A bare folder that the check cannot judge stays, is never deleted, and is returned in
 * `kept`, so the caller names it. A name with a listing in `retiredFiles` (the files a release
 * shipped in that folder) goes by the listing instead: the listed files are removed, the rest of
 * the folder moves, and a plain `rmdir` removes the folder only when it is empty. A move that fails
 * leaves the folder and its files where they are, and the session records it. A name that is shipped
 * today, or that an earlier step could not move, is skipped, and so is every name when the skills
 * folder is a link or not a folder: nothing is moved through a link. Nothing here removes a folder
 * with recursion. Never throws.
 *
 * @param opts.legacySkills - Folder names to deal with; defaults to the legacy skill list.
 * @param opts.retiredFiles - Released file listings by folder name; defaults to the retired registry.
 * @param opts.released - SHA-256 hashes of the released `SKILL.md` copies by bare name; defaults to the frozen table.
 */
export async function sweepLegacySkillFolders(opts: {
  claudeDir: string;
  backups: BackupSession;
  legacySkills?: readonly string[];
  retiredFiles?: Readonly<Record<string, readonly string[]>>;
  released?: Readonly<Record<string, readonly string[]>>;
}): Promise<LegacySkillSweepResult> {
  const { backups } = opts;
  const retiredFiles = opts.retiredFiles ?? RETIRED_SHIPPED.skillFiles;
  const released = opts.released ?? BARE_LEGACY_SKILL_HASHES;
  const kept: string[] = [];
  const skillsDir = path.join(opts.claudeDir, 'skills');
  if ((await directoryState(skillsDir)) !== 'real') return { kept };

  for (const name of opts.legacySkills ?? LEGACY_SKILL_NAMES) {
    const folder = path.join(skillsDir, name);
    if (backups.isKept(folder) || backups.classifyAt(folder, 'directory') === 'shipped') continue;
    const listed = Object.hasOwn(retiredFiles, name) && retiredFiles[name].length > 0;
    if (listed && (await directoryState(folder)) === 'real') {
      await backups.prepass([folder]);
      await backups.removeListed(folder);
    } else if (name.startsWith(NAMESPACE_PREFIX)) {
      await backups.moveWhole(folder);
    } else {
      const verdict = await judgeBareSkillFolder(folder, Object.hasOwn(released, name) ? released[name] : []);
      if (verdict === 'devflow') await backups.moveWhole(folder);
      else if (verdict === 'unknown') kept.push(folder);
    }
  }
  return { kept };
}
