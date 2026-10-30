/**
 * The shipped set: every file path, relative to the Claude dir, that some install of this build
 * can write into `commands/devflow`, `agents/devflow`, `rules/devflow` and `skills/devflow:*`.
 *
 * The backup session moves a file out of those folders unless the set names it, so the set errs
 * toward too large. It comes from the full registries and all four variants (compliance on and
 * off, curation on and off), never from the selection of one run and never from what an earlier
 * install left on disk:
 *
 *   - commands: every plugin command, also a workflow that ships as a skill folder, since the
 *     old command file of such a workflow is removed as a shipped file and never moved;
 *   - agents and rules: every plugin entry, the feature-owned rules and the tracker agent;
 *   - skills: the files of each registry skill in the package source, the generated references
 *     of the compliance-on manifest, the compliance skill the converge writes, and the files only
 *     a compliance-on install writes;
 *   - workflow folders: the files of each registered folder under all four variant keys;
 *   - shadows: the listing of a valid skill shadow counts beside the listing it replaces.
 *
 * {@link buildShippedSet} is pure. {@link loadShippedSet} reads the package and the shadows from
 * disk, within fixed bounds, and answers with a reason instead of a smaller set when it cannot.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { skillsDir } from '../../core/assets.js';
import { complianceSkillFiles } from '../../core/compliance.js';
import { COMPLIANCE_OFF_REMOVED_SKILL_FILES } from '../../core/compliance-off-files.js';
import { VARIANT_KEYS } from '../../core/curation-variants.js';
import {
  SKILL_REFS_SKILL_NAME,
  installedReferenceManifest,
  workflowFolderFiles,
  type WorkflowFolder,
} from '../../core/mds-variants.js';
import { createPathSet, type ShippedSet } from '../../core/path-set.js';
import {
  FEATURE_OWNED_RULES,
  getAllAgentNames,
  getAllCommandNames,
  getAllRuleNames,
  getAllSkillNames,
  prefixSkillName,
} from '../../core/plugins.js';
import { validateSkillShadow } from './installer.js';
import { TRACKER_AGENT_NAME } from './tracker-install.js';

/** The most files one listed skill folder may hold. A folder past it is a failed listing. */
export const MAX_LISTED_FILES = 2_000;

/** The deepest level a listed folder may reach, counting the listed root as 0. */
export const MAX_LISTED_DEPTH = 6;

/** The most folders one listing may visit. */
export const MAX_LISTED_FOLDERS = 500;

const IGNORED_FILE_NAME = '.DS_Store';

export interface ShippedSetInputs {
  /** Registry skill name, without the `devflow:` prefix, to the files below its folder in the package. */
  readonly packageSkillFiles: ReadonlyMap<string, readonly string[]>;
  /** Registry skill name to the files below its valid shadow. Both listings count. */
  readonly shadowListings?: ReadonlyMap<string, readonly string[]>;
  /** The workflow folder registry. The default registry is empty; a test passes a fixture. */
  readonly workflowFolders: readonly WorkflowFolder[];
}

const commandPath = (name: string): string => `commands/devflow/${name}.md`;
const agentPath = (name: string): string => `agents/devflow/${name}.md`;
const rulePath = (name: string): string => `rules/devflow/${name}.md`;
const skillPath = (skill: string, file: string): string => `skills/${prefixSkillName(skill)}/${file}`;

/**
 * The file paths of the shipped set. Pure: the registries are constants, and the package and
 * shadow listings come in as inputs.
 */
export function shippedPaths(inputs: ShippedSetInputs): Set<string> {
  const paths = new Set<string>();

  for (const name of getAllCommandNames(new Set())) paths.add(commandPath(name));
  for (const name of [...getAllAgentNames(), TRACKER_AGENT_NAME]) paths.add(agentPath(name));
  for (const name of [...getAllRuleNames(), ...FEATURE_OWNED_RULES]) paths.add(rulePath(name));

  for (const [skill, files] of inputs.packageSkillFiles) {
    for (const file of files) paths.add(skillPath(skill, file));
  }
  for (const [skill, files] of inputs.shadowListings ?? []) {
    for (const file of files) paths.add(skillPath(skill, file));
  }

  for (const rel of installedReferenceManifest({ compliance: true })) {
    paths.add(skillPath(SKILL_REFS_SKILL_NAME, `references/${rel}`));
  }
  for (const entry of COMPLIANCE_OFF_REMOVED_SKILL_FILES) paths.add(`skills/${entry}`);
  for (const file of complianceSkillFiles()) paths.add(skillPath('compliance', file));

  for (const folder of inputs.workflowFolders) {
    for (const key of VARIANT_KEYS) {
      for (const file of workflowFolderFiles(folder, key)) paths.add(skillPath(folder.name, file));
    }
  }
  return paths;
}

/** The shipped set of {@link shippedPaths}, ready for the backup session. */
export function buildShippedSet(inputs: ShippedSetInputs): ShippedSet {
  return createPathSet(shippedPaths(inputs));
}

type Listing =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The files below `root` as POSIX paths, sorted per folder. Folders are entered only as real
 * folders (a link is listed as a file and never entered). The listing is bounded by
 * {@link MAX_LISTED_FILES}, {@link MAX_LISTED_DEPTH} and {@link MAX_LISTED_FOLDERS}; a breach or a
 * read error is a failed listing, since a smaller listing would be a smaller set.
 */
async function listFiles(root: string): Promise<Listing> {
  const files: string[] = [];
  const pending: Array<{ readonly dir: string; readonly rel: string; readonly depth: number }> = [
    { dir: root, rel: '', depth: 0 },
  ];
  for (let visited = 0; visited < MAX_LISTED_FOLDERS; visited++) {
    const next = pending.pop();
    if (next === undefined) return { ok: true, files };
    let entries;
    try {
      entries = await fs.readdir(next.dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      return { ok: false, reason: `could not read ${next.dir} (${typeof code === 'string' ? code : 'error'})` };
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = next.rel === '' ? entry.name : `${next.rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (next.depth + 1 > MAX_LISTED_DEPTH) return { ok: false, reason: `${root} is deeper than ${MAX_LISTED_DEPTH} levels` };
        pending.push({ dir: path.join(next.dir, entry.name), rel, depth: next.depth + 1 });
      } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name !== IGNORED_FILE_NAME) {
        if (files.length >= MAX_LISTED_FILES) return { ok: false, reason: `${root} holds more than ${MAX_LISTED_FILES} files` };
        files.push(rel);
      }
    }
  }
  return pending.length === 0
    ? { ok: true, files }
    : { ok: false, reason: `${root} holds more than ${MAX_LISTED_FOLDERS} folders` };
}

export interface LoadShippedSetOptions {
  /** The devflow dir whose `skills/<name>` folders hold the skill shadows. */
  readonly devflowDir: string;
  /** The package root the skill source is read from. */
  readonly packageRoot: string;
  /** The workflow folder registry (`WORKFLOW_FOLDERS`; a test passes a fixture). */
  readonly workflowFolders: readonly WorkflowFolder[];
  /** Shadow listings the caller already holds. Given, no shadow is read from disk. */
  readonly shadowListings?: ReadonlyMap<string, readonly string[]>;
}

export type LoadShippedSetResult =
  | { readonly ok: true; readonly shipped: ShippedSet }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the shipped set from the registries, the package skill source and the skill shadows.
 *
 * Every registry skill is listed from `skillsDir(packageRoot)`. A skill whose source is missing is
 * a failed load, not a smaller set: the caller then runs no scan, because a set that lacks a
 * shipped file would send that file to the backup folder.
 */
export async function loadShippedSet(options: LoadShippedSetOptions): Promise<LoadShippedSetResult> {
  const skills = getAllSkillNames(new Set());
  const packageSkillFiles = new Map<string, readonly string[]>();
  for (const skill of skills) {
    const listed = await listFiles(path.join(skillsDir(options.packageRoot), skill));
    if (!listed.ok) return { ok: false, reason: `skill "${skill}": ${listed.reason}` };
    packageSkillFiles.set(skill, listed.files);
  }

  let shadowListings = options.shadowListings;
  if (shadowListings === undefined) {
    const found = new Map<string, readonly string[]>();
    for (const skill of skills) {
      const shadowDir = path.join(options.devflowDir, 'skills', skill);
      if ((await validateSkillShadow(shadowDir)) !== 'valid') continue;
      const listed = await listFiles(shadowDir);
      if (!listed.ok) return { ok: false, reason: `shadow of skill "${skill}": ${listed.reason}` };
      found.set(skill, listed.files);
    }
    shadowListings = found;
  }

  return {
    ok: true,
    shipped: buildShippedSet({ packageSkillFiles, shadowListings, workflowFolders: options.workflowFolders }),
  };
}
