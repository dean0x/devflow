import { promises as fs } from 'fs';

import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';

/**
 * Link checks for the folders Devflow installs into: `commands/devflow`, `agents/devflow`,
 * `rules/devflow`, the `skills/devflow:*` folders and everything below them.
 *
 * A write, `mkdir` or `readdir` follows a symbolic link, so a link at or below one of these
 * folders sends the write into another place. Every check here uses `lstat`, which sees the link
 * and never the entry it points to. One rule holds for all of them: a link is unlinked or left
 * alone, and what it points to is never written. Nothing here throws, except the write in
 * {@link writeFileReplacingLink}, whose callers catch it.
 *
 * This module imports nothing from the installer, so any install or converge step can use it.
 */

/** What stands at a path: nothing, a real directory, a link, or anything else (a file, an entry that cannot be inspected). */
export type DirectoryState = 'absent' | 'real' | 'link' | 'unusable';

/** Classify `dir` with `lstat`, so a link is seen as a link and never as the directory it points to. */
export async function directoryState(dir: string): Promise<DirectoryState> {
  try {
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink()) return 'link';
    return stat.isDirectory() ? 'real' : 'unusable';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unusable';
  }
}

/** Whether `dir` is a link or not a folder, so that a run must not write into it. An absent folder is fine: the run creates it. */
export async function isUnrealFolder(dir: string): Promise<boolean> {
  const state = await directoryState(dir);
  return state === 'link' || state === 'unusable';
}

/** Whether a link stands at `entry`. An absent or unreadable entry is not a link. */
export async function entryIsLink(entry: string): Promise<boolean> {
  return (await directoryState(entry)) === 'link';
}

/** What {@link unlinkLinkAt} did at a path. */
export type LinkUnlinkOutcome =
  /** A link stood there and is gone. Its target was not touched. */
  | 'unlinked'
  /** No link stands there (absent, a real directory, a file). Nothing was changed. */
  | 'no-link'
  /** A link stands there and could not be removed. It is still in place. */
  | 'stuck';

/**
 * Remove the link at `entry` with `unlink`: the link, never what it points to.
 *
 * The one place the pre-clean replaces a link. `readdir` and `mkdir` follow a link, so a pre-clean
 * that emptied through one would empty another directory. Never throws; a link that cannot be
 * removed is `stuck`, and the caller leaves the path alone.
 */
export async function unlinkLinkAt(entry: string): Promise<LinkUnlinkOutcome> {
  if (!(await entryIsLink(entry))) return 'no-link';
  try {
    await fs.unlink(entry);
    return 'unlinked';
  } catch {
    return 'stuck';
  }
}

/**
 * Where a step records the links it met. An `InstallReport` has both fields, so it can be passed as is.
 * A step that is given none still never writes through a link; it only reports nothing.
 */
export interface LinkReport {
  /** Paths of links the step removed and replaced with a real file or folder. What they pointed to was left as it was. */
  replacedLinks: string[];
  /** Paths the step wrote nothing at because they are a link it could not remove, or a folder that is not a folder. */
  refusedFolders: string[];
}

/**
 * Prove, with {@link isUnrealFolder}, that a run may write into `dir`, and record the folder in
 * `report.refusedFolders` when it may not. Returns true for a refused folder, so the caller skips
 * every write into it.
 *
 * The answer for each folder a run writes into besides the `devflow:git` references, which the
 * installer's `referencesHostState` answers: the commands, rules and agents folders and every other
 * skill folder. An absent folder is fine, since the install creates it. A link is refused and never
 * repaired, because the installer did not create it. A full install's pre-clean has already replaced
 * the links it could, so this refuses only what is left. Never throws.
 */
export async function refuseUnrealFolder(report: Pick<LinkReport, 'refusedFolders'>, dir: string): Promise<boolean> {
  if (!(await isUnrealFolder(dir))) return false;
  report.refusedFolders.push(dir);
  return true;
}

/** What {@link clearLinkedEntry} left at an entry. */
export type LinkClearance =
  /** No link stands there (absent, a file, a folder). The caller may write. */
  | 'clear'
  /** A link stood there and is gone. The caller may write a real entry, and reports the link. */
  | 'replaced'
  /** A link stands there that could not be removed, or the entry cannot be inspected. The caller writes nothing and reports it. */
  | 'refused';

/**
 * Make `entry` safe to write: a link there is unlinked, never followed, so the caller then creates a
 * real file or folder in its place. The entry can be a file or a folder. Only the last component is
 * checked, so a caller checks each folder on the way down before it checks an entry in it.
 *
 * Fail closed: an entry `lstat` cannot inspect is refused. Never throws.
 */
export async function clearLinkedEntry(entry: string): Promise<LinkClearance> {
  try {
    const stat = await fs.lstat(entry);
    if (!stat.isSymbolicLink()) return 'clear';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'clear' : 'refused';
  }
  try {
    await fs.unlink(entry);
    return 'replaced';
  } catch {
    return 'refused';
  }
}

/**
 * {@link clearLinkedEntry} plus the report: a replaced link goes to `report.replacedLinks`, a refused
 * entry to `report.refusedFolders`. Returns true when the caller may write at `entry`.
 *
 * The one call a write step makes before it creates or overwrites a file or folder inside a Devflow
 * folder. Omit `report` when the step has none; the link is still never written through.
 */
export async function clearLinkForWrite(entry: string, report?: LinkReport): Promise<boolean> {
  const clearance = await clearLinkedEntry(entry);
  if (clearance === 'replaced') report?.replacedLinks.push(entry);
  if (clearance === 'refused') report?.refusedFolders.push(entry);
  return clearance !== 'refused';
}

/** A report that holds no link yet. */
export function newLinkReport(): LinkReport {
  return { replacedLinks: [], refusedFolders: [] };
}

/**
 * One report from several: the paths of every report in order, each path once. A command that gets
 * the links of more than one step prints this, so a folder that two steps met is named once.
 * Returns a new report; the inputs are not changed.
 */
export function mergeLinkReports(...reports: readonly LinkReport[]): LinkReport {
  return {
    replacedLinks: [...new Set(reports.flatMap(report => report.replacedLinks))],
    refusedFolders: [...new Set(reports.flatMap(report => report.refusedFolders))],
  };
}

/**
 * The line for a link a step replaced. One wording for the install summary and for every converge
 * that reports through a `warn` callback.
 */
export function replacedLinkMessage(linkPath: string): string {
  return `${linkPath} was a link. It was replaced with a real file or folder, and what it pointed to was left as it was.`;
}

/**
 * The first sentence of every refused-folder line: what the folder is. The install and the uninstall
 * both open with it and then say what they did and what to do.
 */
export function refusedFolderStatement(folder: string): string {
  return `${folder} is a link or not a folder.`;
}

/**
 * The line for a folder a step wrote nothing at, because it is a link it could not remove or not a
 * folder. One wording for the install summary and for every converge that reports through a `warn`
 * callback.
 */
export function refusedFolderMessage(folder: string): string {
  return `${refusedFolderStatement(folder)} Nothing was written there. Replace it with a real file or folder and run the install again.`;
}

/** Send one line per link in `report` to `warn`: the replaced links first, then the refused folders. */
export function warnLinkReport(report: LinkReport, warn: (message: string) => void): void {
  for (const linkPath of report.replacedLinks) warn(replacedLinkMessage(linkPath));
  for (const folder of report.refusedFolders) warn(refusedFolderMessage(folder));
}

/** The mode of a file that replaces a link. The atomic writer would copy the mode of the link's target instead. */
const REPLACED_LINK_FILE_MODE = 0o644;

/** The temp file beside `file` that {@link writeFileReplacingLink} writes through: `<file>.tmp.<pid>`. */
export function linkReplacementTempPath(file: string): string {
  return `${file}.tmp.${process.pid}`;
}

/**
 * Write `content` at `file` through a temp file beside it and one rename. A rename puts the new file
 * in the place of whatever stands at `file`, so a link there is replaced and never followed; the link
 * is recorded in `links.replacedLinks` once the write is done. A file that replaces a link has the
 * fixed mode 0644, never the mode of what the link pointed to, which the atomic writer would copy
 * because its `stat` follows the link. Any other file goes through the atomic writer and keeps its
 * own mode. The caller has proved that the folder holding `file` is a real one. Throws what the
 * writer throws, so the caller keeps its own catch.
 */
export async function writeFileReplacingLink(file: string, content: string, links?: LinkReport): Promise<void> {
  if (!(await entryIsLink(file))) {
    await writeFileAtomicExclusive(file, content);
    return;
  }
  const temp = linkReplacementTempPath(file);
  try {
    // A stale temp file is removed first; the exclusive open then refuses anything placed there since.
    await fs.rm(temp, { force: true });
    await fs.writeFile(temp, content, { encoding: 'utf-8', flag: 'wx', mode: REPLACED_LINK_FILE_MODE });
    await fs.chmod(temp, REPLACED_LINK_FILE_MODE);
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
  links?.replacedLinks.push(file);
}
