/**
 * Install of a workflow skill folder: `skills/devflow:<name>/`, from the build tree of the
 * machine's exact variant key.
 *
 * D-WORKFLOW-FOLDER-INSTALL: the install (installViaFileCopy) and the converge
 * (convergeVariantAxes, for init, `devflow curation` and `devflow compliance`) both call
 * {@link installWorkflowFolder} after {@link readWorkflowFolder}, so a folder the install writes
 * and a folder the converge writes after a switch are the same bytes. Three rules hold:
 *
 *   - ONE source root: the tree built for exactly the machine's two switches
 *     (workflowFoldersSourceDir). A key whose tree lacks the folder, or lacks a file of its own
 *     file list, is a failed read. Nothing falls through to another key, so a compliance-off
 *     machine never receives the text of the compliance-on tree.
 *   - EXACTLY the key's file list (workflowFolderFiles): the installed folder holds those files
 *     and no others. A file the list omits for the key, and any other file below the folder, is
 *     pruned by the swap, so a switch to compliance off leaves no file the compliance-off list omits.
 *   - ONE swap: the folder is staged beside the skills folder and moved into place, and the old
 *     folder is restored if the move fails. A folder that already holds the exact files is not
 *     touched, so an install that changes nothing writes nothing.
 *
 * A link at the skills folder or at the folder, or anything there that is not a folder, is refused
 * and recorded in `links.refusedFolders`; a link is never followed and never written through.
 * Nothing here throws: a failure is a result with a reason.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { workflowFoldersSourceDir } from '../../core/assets.js';
import type { VariantSwitches } from '../../core/curation-variants.js';
import {
  checkFolderBuildIds,
  describeBuildIdCheckError,
  workflowFolderFiles,
  workflowFolderKey,
  type WorkflowFolder,
} from '../../core/mds-variants.js';
import { isContainedIn } from '../../core/paths.js';
import { prefixSkillName } from '../../core/plugins.js';
import { directoryState, refuseUnrealFolder, type LinkReport } from './linked-folder.js';

/** The deepest level of a folder that is read or compared: `references/<file>` is level 1. */
const MAX_FOLDER_DEPTH = 4;

/** One file of a folder, as the build wrote it. */
export interface WorkflowFolderFile {
  /** POSIX path inside the folder, as the registry spells it (`SKILL.md`, `references/<name>.md`). */
  readonly file: string;
  readonly bytes: Buffer;
}

export type WorkflowFolderRead =
  | { readonly ok: true; readonly files: readonly WorkflowFolderFile[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the files one folder holds under the exact variant key of `switches`.
 *
 * Fails, with a reason that names the folder, when the key's tree lacks the folder, when the folder
 * is a link or not a folder, when a file of the key's list is missing or is not a plain file, or
 * when the stamped files do not carry one build id (a build that stopped half-way).
 *
 * @param root - Package root the build tree is read from.
 */
export async function readWorkflowFolder(
  folder: WorkflowFolder,
  switches: VariantSwitches,
  root: string,
): Promise<WorkflowFolderRead> {
  const key = workflowFolderKey(switches);
  const dir = path.join(workflowFoldersSourceDir(switches, root), folder.name);
  if ((await directoryState(dir)) !== 'real') {
    return {
      ok: false,
      reason: `workflow folder '${folder.name}' is not built for the variant key '${key}' (${dir}). Ensure build:mds ran successfully before install.`,
    };
  }

  const files: WorkflowFolderFile[] = [];
  for (const rel of workflowFolderFiles(folder, key)) {
    if (!isContainedIn(dir, rel)) {
      return { ok: false, reason: `workflow folder '${folder.name}' names the file '${rel}', which leaves the folder` };
    }
    const source = path.join(dir, ...rel.split('/'));
    try {
      if (!(await fs.lstat(source)).isFile()) {
        return { ok: false, reason: `${source} is not a plain file` };
      }
      files.push({ file: rel, bytes: await fs.readFile(source) });
    } catch (err) {
      return { ok: false, reason: `${source} could not be read (${err instanceof Error ? err.message : String(err)})` };
    }
  }

  const ids = checkFolderBuildIds(files.map(({ file, bytes }) => ({ file, body: bytes.toString('utf-8') })));
  if (!ids.ok) {
    return { ok: false, reason: `workflow folder '${folder.name}' (${key}): ${describeBuildIdCheckError(ids.error)}` };
  }
  return { ok: true, files };
}

/**
 * Every entry below `dir` as sorted POSIX paths: a file as `a/b.md`, a folder as `a/`. Null when
 * anything is neither a plain file nor a folder (a link, a socket), or the walk is deeper than the bound.
 */
async function listEntries(dir: string, prefix = '', depth = 0): Promise<string[] | null> {
  if (depth > MAX_FOLDER_DEPTH) return null;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      const nested = await listEntries(path.join(dir, entry.name), `${rel}/`, depth + 1);
      if (nested === null) return null;
      out.push(`${rel}/`, ...nested);
    } else if (entry.isFile()) {
      out.push(rel);
    } else {
      return null;
    }
  }
  return out.sort();
}

/** The entries a folder of exactly these files holds: the files and the folders that hold them. */
function expectedEntries(files: readonly WorkflowFolderFile[]): string[] {
  const entries = new Set<string>();
  for (const { file } of files) {
    entries.add(file);
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) entries.add(`${parts.slice(0, i).join('/')}/`);
  }
  return [...entries].sort();
}

/** True only when `target` holds exactly these files with exactly these bytes. Any error answers false. */
async function folderHolds(target: string, files: readonly WorkflowFolderFile[]): Promise<boolean> {
  const listed = await listEntries(target);
  const wanted = expectedEntries(files);
  if (listed === null || listed.length !== wanted.length || listed.some((entry, i) => entry !== wanted[i])) return false;
  for (const { file, bytes } of files) {
    try {
      if (!bytes.equals(await fs.readFile(path.join(target, ...file.split('/'))))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export type WorkflowFolderOutcome =
  /** The folder was written (new, or different from the files). */
  | 'installed'
  /** The folder already held exactly the files; nothing was written. */
  | 'unchanged'
  /** The skills folder or the folder is a link or not a folder; nothing was written. Recorded in `links`. */
  | 'refused'
  /** The stage or the swap failed; the previous folder, if any, was restored. */
  | 'failed';

export interface WorkflowFolderInstall {
  readonly name: string;
  readonly outcome: WorkflowFolderOutcome;
  /** Why the install failed. Present only for `failed`. */
  readonly reason?: string;
}

export interface InstallWorkflowFolderOptions {
  /** Claude Code's config directory (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /** The folder name, which installs as `skills/devflow:<name>/`. */
  name: string;
  /** The files of the key's list, from {@link readWorkflowFolder}. */
  files: readonly WorkflowFolderFile[];
  /** Where a refused folder is recorded. */
  links: Pick<LinkReport, 'refusedFolders'>;
}

/**
 * Write `skills/devflow:<name>/` as exactly `files`: stage, then swap in. See the module comment.
 *
 * The staging folder sits under `claudeDir`, not under `skills/`, so a folder a crash leaves
 * behind never looks like a second skill to Claude Code. Never throws.
 */
export async function installWorkflowFolder(opts: InstallWorkflowFolderOptions): Promise<WorkflowFolderInstall> {
  const { claudeDir, name, files, links } = opts;
  if (!path.isAbsolute(claudeDir)) {
    return { name, outcome: 'failed', reason: `claudeDir is not an absolute path ("${claudeDir}")` };
  }
  const skillsDir = path.join(claudeDir, 'skills');
  const target = path.join(skillsDir, prefixSkillName(name));
  if (await refuseUnrealFolder(links, skillsDir)) return { name, outcome: 'refused' };
  if (await refuseUnrealFolder(links, target)) return { name, outcome: 'refused' };

  const staging = path.join(claudeDir, `.devflow-workflow-${name}-${process.pid}-${Date.now().toString(36)}.tmp`);
  const backup = `${staging}.old`;
  try {
    if ((await directoryState(target)) === 'real' && (await folderHolds(target, files))) {
      return { name, outcome: 'unchanged' };
    }
    for (const { file, bytes } of files) {
      const staged = path.join(staging, ...file.split('/'));
      await fs.mkdir(path.dirname(staged), { recursive: true });
      await fs.writeFile(staged, bytes);
    }
    await fs.mkdir(skillsDir, { recursive: true });
    const hadTarget = (await directoryState(target)) === 'real';
    if (hadTarget) await fs.rename(target, backup);
    try {
      await fs.rename(staging, target);
    } catch (err) {
      if (hadTarget) await fs.rename(backup, target);
      throw err;
    }
    return { name, outcome: 'installed' };
  } catch (err) {
    return { name, outcome: 'failed', reason: err instanceof Error ? err.message : String(err) };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
  }
}
