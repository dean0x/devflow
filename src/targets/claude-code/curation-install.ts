/**
 * Prompt-variant installer for the Claude Code target: the curation and compliance switches.
 *
 * D-LEARNING-VARIANT-INSTALL: the install follows the machine's two switches
 * (`features.curation` and `features.compliance` in ~/.devflow/manifest.json) and
 * nothing else. Each command and agent that has an arm for a switch that is off is
 * installed from the build tree of the machine's exact switch combination
 * (dist/{curation-off,compliance-off,curation-compliance-off}/{commands,agents}, built by
 * D-LEARNING-VARIANTS), and the apply-decisions skill is not installed when curation is
 * off, so the decisions text reaches no prompt and the skill has no reader. With a switch on,
 * its on files are installed. A compliance-off machine carries no posting step in any prompt
 * that has a compliance arm. Three pieces carry it:
 *
 *   - the source order (src/core/assets.ts commandSourceDirs / agentSourceDirs):
 *     an off combination takes its own tree, and only the all-on combination takes the
 *     normal order, so a host with no arm installs its one file as before;
 *   - the skill condition (CURATION_GATED_SKILLS in src/core/plugins.ts):
 *     installViaFileCopy leaves the skill out when curation is off;
 *   - {@link convergeVariantAxes}, below: the one converge that makes an
 *     ALREADY-installed tree match both switches, run by `devflow init` after the
 *     file copy and by `devflow curation` and `devflow compliance` after the switch is
 *     written ({@link applyVariantToggle}).
 *
 * The converge, decided in turn:
 *   - Its roster is the files that exist under the off trees, joined with the hosts the build
 *     manifest (dist/variant-axes.json) says carry an arm, not a list typed here: the build owns
 *     which hosts have an arm, so a new arm is converged with no edit to this file.
 *   - It fails closed on the posting question. With compliance off, an installed
 *     compliance-armed prompt that could not be converged is named in `posting`, and a build
 *     manifest that cannot name those hosts leaves `posting` unknown. Callers decide the cost:
 *     `devflow compliance` exits non-zero, init and curation warn.
 *   - After a clean converge, {@link applyVariantToggle} and init record which variants are
 *     installed (`installedVariants` in the manifest, see src/core/installed-variants.ts).
 *   - It rewrites only files that are ALREADY installed. A `--plugin` install
 *     carries one plugin's files; a toggle must not add another plugin's. For the
 *     same reason the skill is installed on a switch-on only when the machine's
 *     plugin selection requires it, and removed on a switch-off only if it is
 *     there.
 *   - A write is atomic (temp file and rename) and byte-compared first: a file
 *     already holding the target bytes is never touched, so a steady-state run
 *     moves nothing and its counts say so (the unchanged-count the pre-clean
 *     lesson asks for).
 *   - Each file and the skill are tried separately, with per-item isolation: one
 *     failure never skips the rest of the fan-out. Every failure is a warning,
 *     never a throw. A converge failure only warns, because either mismatch is
 *     safe: an on variant is still gated at run time (`decisions_gate()`), and an
 *     off variant loads no decisions at all.
 *   - A shadow is honoured exactly as the install honours it (a valid shadow wins, an
 *     invalid one is reported and the shipped source installs), because
 *     the skill is resolved through the installer's own resolveSkillSource. Only
 *     skills and rules have shadows; commands and agents have none, so there is
 *     nothing for an off variant to collide with. A shadow of apply-decisions
 *     under curation off is DORMANT in the same sense as one for a deselected
 *     skill: kept in ~/.devflow/skills, never installed, never deleted, and
 *     applied again the moment curation comes back on.
 *   - Version skew: the variants in this package were built with this version.
 *     When the manifest records another version, the installed files are not the
 *     ones this package would rewrite, so {@link applyVariantToggle} skips the
 *     converge and says to run `devflow init`. For a compliance-off toggle the message also
 *     says that posting steps remain installed until then.
 *   - An agent's installed `model:` and `effort:` are carried into the variant before
 *     the byte comparison (D-AGENT-OVERRIDE-CARRY, see {@link withInstalledState}),
 *     so the overrides `devflow agents` and the proxy put there are never written
 *     back to the shipped values and a no-op converge writes no agent.
 *     {@link applyVariantToggle} still runs reapplyAgentMapping straight after a
 *     converge that rewrote an agent: it reads agent-models.json and is the authority.
 *
 * D-LEARNING-PRELOAD-MACHINE-ONLY (amended): the apply-decisions preload follows
 * the machine switch only, never a repository's narrowing, because a repository
 * can narrow curation off on a machine where it is on and the installed agents are
 * machine-wide. Met by the variant: the curation-off agent files do not preload
 * the skill (no install-time frontmatter rewrite exists), and the curation-on files
 * keep the preload and their run-time gate for a narrowed repository. A repo
 * `project.json` with `curation: false` on a curation-on machine therefore changes
 * nothing installed.
 *
 * I/O orchestration in src/targets/; the pure selection rules stay in src/core/.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import {
  agentSourceDirs,
  bothOffDir,
  commandSourceDirs,
  complianceOffDir,
  curationOffDir,
} from '../../core/assets.js';
import { carryStampedTools } from '../../core/agent-frontmatter.js';
import { carryAgentOverrides, reapplyAgentMapping } from '../../core/agent-models.js';
import type { ComplianceFeatureState } from '../../core/compliance.js';
import { describeEchoedValue } from '../../core/echo-value.js';
import {
  ALL_SWITCHES_ON,
  VARIANT_MANIFEST_REL_PATH,
  describeVariantManifestParseError,
  machineVariantKey,
  parseVariantManifest,
  variantOffRelPath,
  type VariantAxis,
  type VariantKind,
  type VariantSwitches,
} from '../../core/curation-variants.js';
import { readInstalledVariants } from '../../core/installed-variants.js';
import { readManifest, writeManifest } from '../../core/manifest.js';
import { withManifestLock } from '../../core/manifest-lock.js';
import { getPackageRoot } from '../../core/paths.js';
import { isProxyEnabled } from '../../core/proxy-state.js';
import { WORKFLOW_FOLDERS, type WorkflowFolder } from '../../core/mds-variants.js';
import {
  DEVFLOW_PLUGINS,
  CURATION_GATED_SKILLS,
  installedLanguageFocuses,
  prefixSkillName,
  selectedWorkflowFolders,
  skillsOf,
  workflowFolderNames,
  type PluginDefinition,
} from '../../core/plugins.js';
import { convergeFromManifest, type ConvergeComplianceArtifactsResult } from './compliance-install.js';
import { copyDirectory, resolveSkillSource } from './installer.js';
import { LANGUAGE_STAMPED_COMMANDS, stampForConverge } from './language-stamp.js';
import { entryIsLink, newLinkReport, refuseUnrealFolder, refusedFolderMessage, warnLinkReport, writeFileReplacingLink, type LinkReport } from './linked-folder.js';
import { convergeReferences, type ConvergeReferencesResult } from './reference-converge.js';
import { installWorkflowFolder, readWorkflowFolder } from './workflow-folder-install.js';

// ── Bounds ─────────────────────────────────────────────────────────────────

/**
 * The most variant files one kind may carry. The shipped roster is 14 commands and
 * 9 agents; the bound exists so a directory that grew without limit cannot turn the
 * converge into an unbounded loop (every loop has an explicit bound).
 */
export const MAX_CURATION_ROSTER = 256;

/** Deepest skill-directory descent the tree comparison takes. */
const MAX_SKILL_TREE_DEPTH = 4;

/** A roster entry is a flat, lowercase, hyphenated markdown basename. */
const ROSTER_NAME_RE = /^[a-z0-9][a-z0-9-]*\.md$/;

const KINDS: readonly VariantKind[] = ['commands', 'agents'];

// ── Types ──────────────────────────────────────────────────────────────────

/** What a converge left the curation-gated skill directory in. */
export type CurationSkillState =
  /** Installed, or replaced because the bytes differed. */
  | 'installed'
  /** Removed (curation off). */
  | 'removed'
  /** Already as the switch wants it: present and identical, or absent. */
  | 'unchanged'
  /** Curation on, but no plugin of the selection requires the skill: nothing installed. */
  | 'not-selected'
  | 'failed';

export interface ConvergeCurationVariantsOptions {
  /** Claude Code's config directory (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /** The machine root (~/.devflow), where skill shadows live. */
  devflowDir: string;
  /** The machine's settled curation switch. */
  curation: boolean;
  /** The effective plugin selection: the skill is installed on switch-on only if its closure holds it. */
  plugins: readonly PluginDefinition[];
  warn: (msg: string) => void;
  /** Package root the variants and sources, the apply-decisions skill included, are read from. Injectable for a temp tree; defaults to this package. */
  packageRoot?: string;
}

export interface ConvergeCurationVariantsResult {
  /** True when nothing failed. False when any warn path was taken: callers read this, they do not catch. */
  converged: boolean;
  /** Installed command files this run rewrote, as `name.md`. */
  commandsRewritten: readonly string[];
  /** Installed agent files this run rewrote, as `name.md`. */
  agentsRewritten: readonly string[];
  /** Installed files already holding the target bytes. */
  unchanged: number;
  /** Roster entries with no installed file (another plugin's, or never installed): left alone. */
  notInstalled: number;
  skill: CurationSkillState;
}

type FileOutcome = 'rewritten' | 'unchanged' | 'not-installed' | 'failed';

/** One prompt of a kind that has a variant on an axis: its file name and the axes it carries an arm on. */
interface RosterHost {
  readonly file: string;
  readonly axes: Readonly<Record<VariantAxis, boolean>>;
}

/**
 * Whether the installed prompts and references of a compliance-off machine are free of the posting steps.
 *
 *   - `clear`: compliance is on, or every installed compliance-armed prompt holds the file built for the machine
 *     and the installed references hold the compliance-off set.
 *   - `left`: these installed files (prompts, or reference files that could not be removed) could not be
 *     converged and may still post.
 *   - `unknown`: the build manifest that names the compliance-armed prompts is unusable, or the references
 *     could not be converged, so the files that still post cannot be named.
 */
export type PostingConverge =
  | { readonly kind: 'clear' }
  | { readonly kind: 'left'; readonly files: readonly string[] }
  | { readonly kind: 'unknown'; readonly reason: string };

const POSTING_CLEAR: PostingConverge = { kind: 'clear' };

// ── Internals ──────────────────────────────────────────────────────────────

function installedFile(claudeDir: string, kind: VariantKind, fileName: string): string {
  return path.join(claudeDir, kind, 'devflow', fileName);
}

/**
 * The both-axes-ON source directories for a kind, most-preferred first: the files a host
 * with no off variant for the machine installs.
 */
function onSourceDirs(kind: VariantKind, root: string): readonly string[] {
  return kind === 'commands' ? commandSourceDirs(ALL_SWITCHES_ON, root) : agentSourceDirs(root, ALL_SWITCHES_ON);
}

/** The roster-shaped file names directly under `dir`, `'absent'` when it does not exist and `'unreadable'` (warned) when it cannot be read. */
async function listVariantDir(dir: string, kind: VariantKind, warn: (msg: string) => void): Promise<readonly string[] | 'absent' | 'unreadable'> {
  try {
    return (await fs.readdir(dir)).filter(entry => ROSTER_NAME_RE.test(entry));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    warn(`prompt variants: cannot read the ${kind} variants under ${dir} — ${String(err)}`);
    return 'unreadable';
  }
}

/**
 * The compiled prompts the build says carry an arm, read from its variant manifest. An error names the
 * cause in a line a person can act on. Compliance on never reads it: only a compliance-off machine needs
 * the manifest to know which prompts it must not leave unconverged.
 */
async function readVariantHosts(root: string): Promise<{ ok: true; hosts: ReadonlyMap<string, RosterHost> } | { ok: false; reason: string }> {
  const file = path.join(root, ...VARIANT_MANIFEST_REL_PATH.split('/'));
  let text: string;
  try {
    text = await fs.readFile(file, 'utf-8');
  } catch (err) {
    const cause = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'does not exist' : `cannot be read (${String(err)})`;
    return { ok: false, reason: `the variant manifest ${cause}: ${file}` };
  }
  const parsed = parseVariantManifest(text);
  if (!parsed.ok) return { ok: false, reason: `the variant manifest is not valid: ${file} (${describeVariantManifestParseError(parsed.error)})` };
  const hosts = new Map<string, RosterHost>();
  for (const host of parsed.value) hosts.set(`${host.kind}/${host.name}.md`, { file: `${host.name}.md`, axes: host.axes });
  return { ok: true, hosts };
}

/**
 * The roster of one kind: the prompts that differ on an axis, sorted by file name.
 *
 * The files under the three off trees name them (the build owns which hosts have an arm), and a host the
 * build manifest lists is added, so a tree removed from the package still leaves its hosts in the roster.
 * An arm comes from the manifest entry, or from the trees the file is in when the manifest does not list it
 * (a curation arm has a file under curation-off or both-off, a compliance arm under compliance-off or
 * both-off).
 *
 * `present` is false when no tree holds this kind and the manifest lists none (the build has not run, or
 * only `build:cli` did), so the caller can say so instead of reporting a converge that had nothing to do.
 * `incomplete` says the roster was read in part, already warned: a tree could not be listed
 * (`unreadable`), or the roster passed {@link MAX_CURATION_ROSTER} and the hosts after it were left out
 * (`truncated`). `refused` lists the manifest hosts whose name {@link ROSTER_NAME_RE} does not hold (the
 * build accepts a wider name), already warned: they are left out of `hosts` and the caller fails closed.
 */
async function readRoster(
  kind: VariantKind,
  root: string,
  manifestHosts: ReadonlyMap<string, RosterHost> | null,
  warn: (msg: string) => void,
): Promise<{ hosts: RosterHost[]; present: boolean; incomplete: 'unreadable' | 'truncated' | null; refused: readonly RosterHost[] }> {
  const listings = {
    curation: await listVariantDir(curationOffDir(kind, root), kind, warn),
    compliance: await listVariantDir(complianceOffDir(kind, root), kind, warn),
    both: await listVariantDir(bothOffDir(kind, root), kind, warn),
  };
  const inferred = new Map<string, Record<VariantAxis, boolean>>();
  const note = (names: readonly string[] | 'absent' | 'unreadable', axes: readonly VariantAxis[]): void => {
    if (typeof names === 'string') return;
    for (const name of names) {
      const arms = inferred.get(name) ?? { curation: false, compliance: false };
      inferred.set(name, {
        curation: arms.curation || axes.includes('curation'),
        compliance: arms.compliance || axes.includes('compliance'),
      });
    }
  };
  note(listings.curation, ['curation']);
  note(listings.compliance, ['compliance']);
  note(listings.both, ['curation', 'compliance']);

  const files = new Map<string, RosterHost>();
  const refused: RosterHost[] = [];
  for (const [file, axes] of inferred) files.set(file, { file, axes });
  for (const [key, host] of manifestHosts ?? []) {
    if (!key.startsWith(`${kind}/`) || !(host.axes.curation || host.axes.compliance)) continue;
    if (ROSTER_NAME_RE.test(host.file)) {
      files.set(host.file, host);
    } else {
      warn(`prompt variants: the build manifest lists ${kind}/${host.file}, a name the converge cannot hold; it was not converged`);
      refused.push(host);
    }
  }
  const hosts = [...files.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const present = hosts.length > 0 || Object.values(listings).some(listing => typeof listing !== 'string');
  if (hosts.length > MAX_CURATION_ROSTER) {
    warn(`prompt variants: ${hosts.length} ${kind} variants exceed the bound of ${MAX_CURATION_ROSTER}; converging the first ${MAX_CURATION_ROSTER}`);
    return { hosts: hosts.slice(0, MAX_CURATION_ROSTER), present: true, incomplete: 'truncated', refused };
  }
  const unreadable = Object.values(listings).some(listing => listing === 'unreadable');
  return { hosts, present, incomplete: unreadable ? 'unreadable' : null, refused };
}

async function readIfPresent(file: string): Promise<Buffer | 'absent' | 'unreadable'> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable';
  }
}

/** First of `candidates` that exists, or undefined. Bounded by the candidate list. */
async function firstReadable(candidates: readonly string[]): Promise<{ file: string; bytes: Buffer } | undefined> {
  for (const file of candidates) {
    try {
      return { file, bytes: await fs.readFile(file) };
    } catch { /* not here — next directory in preference order */ }
  }
  return undefined;
}

/**
 * The bytes a write would install: the variant `source` wearing the state the
 * installed copy carries, so the byte comparison in {@link convergeFile} compares
 * variants and nothing else.
 *
 * D-LANGUAGE-FOCUS-STAMP, composition: the variant on disk carries the language list the
 * install stamped (code-review.md), and the source carries the shipped `(none)`. The stamp is
 * carried from the installed copy into the text this write would install, so the byte
 * comparison stays honest (a stamped copy of the right variant is `unchanged`, not
 * rewritten on every run) and a variant switch never loses or changes the list. A copy with
 * no list to carry (installed before the stamp existed) is stamped from the selection instead.
 *
 * D-AGENT-OVERRIDE-CARRY, composition: an installed agent carries the `model:` and `effort:`
 * that `devflow agents` and the proxy put there, and the source carries the shipped ones.
 * Carrying them keeps the override window shut (no write ever leaves an agent on its shipped
 * model while reapplyAgentMapping has yet to restore it) and keeps a no-op converge
 * write-free, so "N agent(s) rewritten" counts only real variant switches. reapplyAgentMapping
 * stays the authority: it reads agent-models.json after the converge and the carry only agrees
 * with it (see carryAgentOverrides).
 *
 * D-TRACKER-SERVER-ALLOWLIST, composition: the installed Git agent carries the tracker-server
 * entries the install stamped onto its `tools:` line, and the variant source carries none.
 * The stamp is carried the same way (carryStampedTools), so a variant switch keeps the list
 * and a copy already holding the right variant and its stamp compares byte-equal. Install
 * and `devflow tracker --servers` are the only writers of the list; a converge never changes it.
 *
 * Pure.
 */
function withInstalledState(
  kind: VariantKind,
  fileName: string,
  source: Buffer,
  installed: Buffer,
  focuses: readonly string[],
): Buffer {
  if (kind === 'agents') {
    const sourceText = source.toString('utf-8');
    const installedText = installed.toString('utf-8');
    const carried = carryStampedTools(carryAgentOverrides(sourceText, installedText), installedText);
    return carried === sourceText ? source : Buffer.from(carried, 'utf-8');
  }
  return LANGUAGE_STAMPED_COMMANDS.includes(fileName.replace(/\.md$/, ''))
    ? Buffer.from(stampForConverge(source.toString('utf-8'), installed.toString('utf-8'), focuses), 'utf-8')
    : source;
}

/**
 * Converge ONE installed prompt onto the variant the machine's switches want.
 *
 * The file is the one built for the machine's exact switches (`machineVariantKey`): an off
 * variant is read from its own tree and no other, so a host with a compliance arm on a
 * compliance-off machine never falls through to a file that carries the posting steps. A host
 * the machine needs no off variant for comes from the normal source order.
 *
 * Never throws: every failure is a warning and the outcome `failed`, so the next
 * file is still tried.
 */
async function convergeFile(
  kind: VariantKind,
  host: RosterHost,
  opts: {
    claudeDir: string;
    switches: VariantSwitches;
    warn: (msg: string) => void;
    root: string;
    /** The effective selection's language list, stamped into a copy that has none to carry. */
    focuses: readonly string[];
    /** True when the kind's `devflow` folder is a link or not a folder: nothing is written in it. */
    folderRefused: boolean;
    /** Where a link replaced by a rewritten file is recorded. */
    links: LinkReport;
  },
): Promise<FileOutcome> {
  const { claudeDir, switches, warn, root, focuses, folderRefused, links } = opts;
  const fileName = host.file;
  const target = installedFile(claudeDir, kind, fileName);

  const installed = await readIfPresent(target);
  if (installed === 'absent') return 'not-installed';
  // Reading through a link is harmless and tells a prompt that is there from one that is not. It is
  // left as it is: the folder is reported once, by the caller.
  if (folderRefused) return 'failed';
  if (installed === 'unreadable') {
    warn(`prompt variants: cannot read the installed ${kind}/${fileName} (${target}) — left as it is`);
    return 'failed';
  }

  const key = machineVariantKey(switches, host.axes);
  const candidates = key === 'on'
    ? onSourceDirs(kind, root).map(dir => path.join(dir, fileName))
    : [path.join(root, ...variantOffRelPath(key, kind, fileName).split('/'))];
  const source = await firstReadable(candidates);
  if (source === undefined) {
    warn(`prompt variants: no source for ${kind}/${fileName} (searched: ${candidates.join(', ')}) — left as it is`);
    return 'failed';
  }

  const wanted = withInstalledState(kind, fileName, source.bytes, installed, focuses);

  // Byte-compared: an installed file already holding the target bytes is not
  // rewritten, so a run that changes nothing writes nothing.
  if (installed.equals(wanted)) return 'unchanged';

  try {
    // Prompts are UTF-8 text; the atomic writer takes a string and preserves the
    // target's permission mode. A link at the target is replaced by the rename, never followed.
    await writeFileReplacingLink(target, wanted.toString('utf-8'), links);
  } catch (err) {
    warn(`prompt variants: could not rewrite ${kind}/${fileName} (${target}) — ${String(err)}`);
    return 'failed';
  }
  return 'rewritten';
}

/** Every file below `dir` as sorted relative paths; null when anything is not a plain file or directory. */
async function listTree(dir: string, depth = 0): Promise<string[] | null> {
  if (depth > MAX_SKILL_TREE_DEPTH) return null;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch { return null; }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await listTree(path.join(dir, entry.name), depth + 1);
      if (nested === null) return null;
      out.push(...nested.map(rel => path.join(entry.name, rel)));
    } else if (entry.isFile()) {
      out.push(entry.name);
    } else {
      return null;
    }
  }
  return out.sort();
}

/** True only when both trees hold the same files with the same bytes. Any error answers false. */
async function treesIdentical(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([listTree(a), listTree(b)]);
  if (left === null || right === null || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
    try {
      const [x, y] = await Promise.all([fs.readFile(path.join(a, left[i])), fs.readFile(path.join(b, right[i]))]);
      if (!x.equals(y)) return false;
    } catch { return false; }
  }
  return true;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch { return false; }
}

/**
 * Install one skill directory atomically: stage a copy beside the claude dir's
 * skills, then swap it in, restoring the old directory if the swap fails.
 *
 * Staged under `claudeDir` itself, not under `skills/`: a staging directory a
 * crash leaves behind must not look like a second skill to Claude Code.
 *
 * A target that is a link is moved aside as the link itself, never followed, so what it points to is
 * left as it was; the link is recorded in `links` once the real folder stands in its place.
 */
async function swapInSkillDirectory(claudeDir: string, sourceDir: string, target: string, links: LinkReport): Promise<void> {
  const staging = path.join(claudeDir, `.devflow-curation-${process.pid}-${Date.now().toString(36)}.tmp`);
  const backup = `${staging}.old`;
  try {
    await copyDirectory(sourceDir, staging);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const wasLink = await entryIsLink(target);
    const hadTarget = wasLink || await pathExists(target);
    if (hadTarget) await fs.rename(target, backup);
    try {
      await fs.rename(staging, target);
    } catch (err) {
      if (hadTarget) await fs.rename(backup, target);
      throw err;
    }
    if (wasLink) links.replacedLinks.push(target);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Converge the curation-gated skill directories. A skill folder that was a link and was swapped is recorded in `links`. Never throws. */
async function convergeSkills(opts: ConvergeCurationVariantsOptions, links: LinkReport): Promise<CurationSkillState> {
  const { claudeDir, devflowDir, curation, plugins, warn } = opts;
  const selected = skillsOf(plugins);
  let state: CurationSkillState = 'unchanged';

  // Every gated skill is converged: a failure on one must not skip the next.
  for (const skill of CURATION_GATED_SKILLS) {
    const target = path.join(claudeDir, 'skills', prefixSkillName(skill));
    try {
      if (!curation) {
        if (!(await pathExists(target))) continue;
        await fs.rm(target, { recursive: true });
        state = 'removed';
        continue;
      }

      if (!selected.has(skill)) {
        if (state === 'unchanged') state = 'not-selected';
        continue;
      }
      const resolved = await resolveSkillSource(skill, devflowDir, opts.packageRoot);
      if ((await pathExists(target)) && (await treesIdentical(resolved.dir, target))) continue;
      await swapInSkillDirectory(claudeDir, resolved.dir, target, links);
      state = 'installed';
    } catch (err) {
      warn(`curation variants: could not converge the ${prefixSkillName(skill)} skill (${target}) — ${String(err)}`);
      state = 'failed';
    }
  }
  return state;
}

// ── Convergence ────────────────────────────────────────────────────────────

export interface ConvergePromptVariantsOptions {
  /** Claude Code's config directory (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /** The machine's settled curation and compliance switches. */
  switches: VariantSwitches;
  /** The effective plugin selection: its language list is stamped into a copy that has none to carry. */
  plugins: readonly PluginDefinition[];
  warn: (msg: string) => void;
  /** Package root the variants are read from. Injectable for a temp tree; defaults to this package. */
  packageRoot?: string;
}

export interface ConvergePromptVariantsResult {
  /** True when nothing failed. False when any warn path was taken. */
  converged: boolean;
  /** Installed command files this run rewrote, as `name.md`. */
  commandsRewritten: readonly string[];
  /** Installed agent files this run rewrote, as `name.md`. */
  agentsRewritten: readonly string[];
  /** Installed files already holding the target bytes. */
  unchanged: number;
  /** Roster entries with no installed file (another plugin's, or never installed): left alone. */
  notInstalled: number;
  /** Whether the installed prompts of a compliance-off machine are proven free of the posting steps. */
  posting: PostingConverge;
  /** Installed prompts that were a link and now are a real file. What they pointed to was left as it was. */
  replacedLinks: readonly string[];
  /** The `commands/devflow` or `agents/devflow` folder that is a link or not a folder: nothing was written in it. */
  refusedFolders: readonly string[];
}

/** The result of a converge that did not run: nothing changed and, with compliance off, nothing is proven. */
function notRun(switches: VariantSwitches, reason: string): ConvergePromptVariantsResult {
  return {
    converged: false,
    commandsRewritten: [],
    agentsRewritten: [],
    unchanged: 0,
    notInstalled: 0,
    posting: switches.compliance ? POSTING_CLEAR : { kind: 'unknown', reason },
    replacedLinks: [],
    refusedFolders: [],
  };
}

/**
 * Make the installed commands and agents match the machine's two switches: the per-kind
 * converge of the prompts.
 *
 * Each roster host is rewritten to the file built for the machine's exact switches (see
 * {@link convergeFile}). With compliance off the converge also answers the fail-closed
 * question: the build manifest names the hosts that carry a compliance arm, and an installed one
 * that could not be converged is listed in `posting` as still posting. A compliance-off machine whose
 * build manifest is unusable answers `unknown`, because it cannot name those hosts.
 *
 * A kind's `devflow` folder that is a link, or not a folder, is refused: nothing is written in it, the
 * installed prompts there count as not converged, and the folder is named in `refusedFolders` and in
 * a warning. A prompt that is a link in a real folder is replaced by a real file, and named in
 * `replacedLinks` and in a warning.
 *
 * Never throws. A caller reads `converged` and `posting`; it does not catch.
 */
export async function convergePromptVariants(opts: ConvergePromptVariantsOptions): Promise<ConvergePromptVariantsResult> {
  const { claudeDir, switches, warn } = opts;

  // Precondition, asserted in production code: a relative claudeDir would resolve
  // the install targets somewhere unexpected.
  if (!path.isAbsolute(claudeDir)) {
    warn(`prompt variants: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return notRun(switches, 'the Claude directory is not an absolute path');
  }
  const root = opts.packageRoot ?? getPackageRoot();
  const focuses = installedLanguageFocuses(opts.plugins);

  let failed = false;
  let unknownReason: string | null = null;
  let manifestHosts: ReadonlyMap<string, RosterHost> | null = null;
  if (!switches.compliance) {
    const manifest = await readVariantHosts(root);
    if (manifest.ok) {
      manifestHosts = manifest.hosts;
    } else {
      warn(`prompt variants: ${manifest.reason} — the installed prompts that still post cannot be named. Run \`npm run build:mds\`, then \`devflow init\`.`);
      unknownReason = manifest.reason;
      failed = true;
    }
  }

  let unchanged = 0;
  let notInstalled = 0;
  const stillPosting: string[] = [];
  const rewritten: Record<VariantKind, string[]> = { commands: [], agents: [] };
  const links = newLinkReport();

  for (const kind of KINDS) {
    // A link at the folder sends every write below it into another place, so the folder is proven first.
    const folderRefused = await refuseUnrealFolder(links, path.join(claudeDir, kind, 'devflow'));
    if (folderRefused) failed = true;
    const roster = await readRoster(kind, root, manifestHosts, warn);
    // A roster read in part is a failed converge. Past the bound, a host left out may carry a
    // compliance arm, so a compliance-off machine can no longer name every prompt that still posts.
    if (roster.incomplete !== null) failed = true;
    if (roster.incomplete === 'truncated' && !switches.compliance && unknownReason === null) {
      unknownReason = `more than ${MAX_CURATION_ROSTER} ${kind} carry a variant, and the ones past the bound were not converged`;
    }
    // A manifest host the roster cannot hold was never converged. If it carries a compliance arm, it may still post.
    if (roster.refused.length > 0) failed = true;
    const refusedPosting = roster.refused.find(host => host.axes.compliance);
    if (refusedPosting !== undefined && !switches.compliance && unknownReason === null) {
      unknownReason = `the build manifest lists ${kind}/${refusedPosting.file}, a name the converge cannot hold, so it was not converged`;
    }
    if (!roster.present) {
      warn(`prompt variants: no ${kind} variants under ${curationOffDir(kind, root)} — run \`npm run build:mds\`; installed ${kind} left as they are`);
      failed = true;
      continue;
    }
    for (const host of roster.hosts) {
      const outcome = await convergeFile(kind, host, { claudeDir, switches, warn, root, focuses, folderRefused, links });
      if (outcome === 'rewritten') rewritten[kind].push(host.file);
      else if (outcome === 'unchanged') unchanged++;
      else if (outcome === 'not-installed') notInstalled++;
      else {
        failed = true;
        if (!switches.compliance && host.axes.compliance) stillPosting.push(installedFile(claudeDir, kind, host.file));
      }
    }
  }

  let posting: PostingConverge = POSTING_CLEAR;
  if (unknownReason !== null) posting = { kind: 'unknown', reason: unknownReason };
  else if (stillPosting.length > 0) posting = { kind: 'left', files: stillPosting };

  warnLinkReport(links, warn);
  return {
    converged: !failed,
    commandsRewritten: rewritten.commands,
    agentsRewritten: rewritten.agents,
    unchanged,
    notInstalled,
    posting,
    replacedLinks: links.replacedLinks,
    refusedFolders: links.refusedFolders,
  };
}

// ── The one converge for both axes ─────────────────────────────────────────

/** The slice of the manifest the composed converge reads: the two switches, the frameworks and the rules switch. */
export interface VariantMachineState {
  readonly features: {
    readonly curation: boolean;
    readonly compliance: ComplianceFeatureState;
    readonly rules: boolean;
  };
}

export interface ConvergeVariantAxesOptions {
  /** Claude Code's config directory (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /** The machine root (~/.devflow), where skill shadows live. */
  devflowDir: string;
  /** The machine's settled switches. The compliance part reaches its converge only through {@link convergeFromManifest}. */
  manifest: VariantMachineState;
  /** The effective plugin selection. */
  plugins: readonly PluginDefinition[];
  warn: (msg: string) => void;
  /** Package root the variants and sources are read from. Injectable for a temp tree; defaults to this package. */
  packageRoot?: string;
  /**
   * The workflow skill folders the converge knows (D-WORKFLOW-FOLDER-INSTALL). Defaults to the real
   * registry, which is empty, so a default converge has no folder step. A test passes a fixture registry.
   */
  workflowFolders?: readonly WorkflowFolder[];
  /** Package root the folder trees are read from. Defaults to {@link ConvergeVariantAxesOptions.packageRoot}. */
  workflowFoldersRoot?: string;
}

/** What the workflow-folder converge did. */
export interface ConvergeWorkflowFoldersResult {
  /** True when nothing failed and nothing was refused. */
  converged: boolean;
  /** Folders this run wrote: new, or different from the exact-key files. */
  installed: readonly string[];
  /** Folders that already held the exact-key files. */
  unchanged: readonly string[];
  /** Why the converge did not finish, one entry per failure. Empty when `converged`. */
  failures: readonly string[];
  /** Installed folders that were not converged (a failure or a refusal), as absolute paths. They keep the text of the previous key. */
  stalled: readonly string[];
}

export interface ConvergeVariantAxesResult extends ConvergeCurationVariantsResult {
  /** What the compliance-artifact converge (the skill and the rule) did. */
  compliance: ConvergeComplianceArtifactsResult;
  /** What the references converge did: the overlay, then the removal list or the restore. */
  references: ConvergeReferencesResult;
  /** What the workflow-folder converge did: the exact-key folder of each selected folder workflow. */
  workflowFolders: ConvergeWorkflowFoldersResult;
  /** Whether a compliance-off machine still has installed prompts or references that post. */
  posting: PostingConverge;
  /** Installed prompts and rule files that were a link and now are a real file. What they pointed to was left as it was. */
  replacedLinks: readonly string[];
  /** Devflow folders that are a link or not a folder: nothing was written in them. */
  refusedFolders: readonly string[];
}

/**
 * Run one per-kind converge and fold an unexpected throw into its fallback result, so the
 * composed converge never throws and a failed kind never skips the next.
 */
async function attempt<T>(label: string, warn: (msg: string) => void, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    warn(`${label}: the converge failed — ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

/**
 * Converge the workflow skill folders of the selected plugins onto the machine's switches.
 *
 * D-WORKFLOW-FOLDER-INSTALL: a folder is complete under every variant key, so a switch of either axis
 * moves it to the folder of the new exact key (the same read and the same swap as the install), and a
 * folder that already holds that key's files is left alone. A switch to compliance off writes the
 * compliance-off folder, which leaves out the files its file list omits, so none of them stays. A
 * workflow whose plugin is not selected is not installed here and is not removed either: a full
 * install owns the removal. Never throws.
 */
async function convergeWorkflowFolders(opts: {
  claudeDir: string;
  switches: VariantSwitches;
  plugins: readonly PluginDefinition[];
  folders: readonly WorkflowFolder[];
  root: string;
  warn: (msg: string) => void;
}): Promise<ConvergeWorkflowFoldersResult> {
  const { claudeDir, switches, plugins, folders, root, warn } = opts;
  const installed: string[] = [];
  const unchanged: string[] = [];
  const failures: string[] = [];
  const stalled: string[] = [];
  const owned = selectedWorkflowFolders(plugins, workflowFolderNames(folders));

  for (const folder of folders) {
    if (!owned.has(folder.name)) continue;
    const target = path.join(claudeDir, 'skills', prefixSkillName(folder.name));
    const fail = (message: string): void => {
      warn(`workflow folders: ${message}`);
      failures.push(message);
      stalled.push(target);
    };
    const read = await readWorkflowFolder(folder, switches, root);
    if (!read.ok) {
      fail(read.reason);
      continue;
    }
    const links = newLinkReport();
    const result = await installWorkflowFolder({ claudeDir, name: folder.name, files: read.files, links });
    switch (result.outcome) {
      case 'installed':
        installed.push(folder.name);
        break;
      case 'unchanged':
        unchanged.push(folder.name);
        break;
      case 'refused':
        fail(refusedFolderMessage(links.refusedFolders[0] ?? target));
        break;
      case 'failed':
        fail(`could not converge ${prefixSkillName(folder.name)} (${result.reason ?? 'unknown error'})`);
        break;
      default: {
        const unhandled: never = result.outcome;
        fail(`unhandled folder outcome ${String(unhandled)}`);
      }
    }
  }
  return { converged: failures.length === 0, installed, unchanged, failures, stalled };
}

/**
 * The posting answer of the workflow-folder converge. Compliance on is clear. With compliance off, a
 * folder that was not converged still holds the text of the previous key, which may post, so it is named.
 * A converge that did not finish and names no folder (it threw) cannot say which folders post, so it is
 * `unknown` and never `clear`.
 */
export function workflowFoldersPosting(folders: ConvergeWorkflowFoldersResult, compliance: boolean): PostingConverge {
  if (compliance) return POSTING_CLEAR;
  if (folders.stalled.length > 0) return { kind: 'left', files: folders.stalled };
  if (!folders.converged) return { kind: 'unknown', reason: `the workflow folders: ${folders.failures.join('; ')}` };
  return POSTING_CLEAR;
}

/**
 * The one converge for both switches: it makes the installed tree match the machine's curation
 * and compliance switches. `devflow init`, `devflow curation` and `devflow compliance` all call it.
 *
 * It composes five per-kind converges, each a result and never a throw:
 *   - {@link convergePromptVariants}: the commands and agents, for both axes;
 *   - the apply-decisions skill, which follows the curation switch;
 *   - {@link convergeFromManifest}: the compliance skill and rule, the one place the manifest
 *     becomes compliance options;
 *   - {@link convergeReferences}: the `devflow:git` references, which follow the compliance switch
 *     (the overlay from the one source root of the switch, then the removal list or the restore);
 *   - the workflow skill folders, which follow both switches (the folder of the exact key).
 * A failed kind is a warning and `converged: false`, and the next kind still runs. A compliance-off
 * machine that still has a prompt or a reference file that posts, or cannot name one, is `posting`
 * and never `clear`: the caller decides what that costs (the compliance command exits non-zero,
 * init and curation warn).
 *
 * Never throws.
 */
export async function convergeVariantAxes(opts: ConvergeVariantAxesOptions): Promise<ConvergeVariantAxesResult> {
  const { claudeDir, devflowDir, manifest, plugins, warn, packageRoot } = opts;
  const switches: VariantSwitches = { curation: manifest.features.curation, compliance: manifest.features.compliance.enabled };

  // Precondition, asserted in production code: a relative claudeDir would resolve
  // every install target somewhere unexpected, the skill removal included.
  if (!path.isAbsolute(claudeDir)) {
    warn(`prompt variants: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return {
      ...notRun(switches, 'the Claude directory is not an absolute path'),
      skill: 'unchanged',
      compliance: { removedPreexisting: false, converged: false, replacedLinks: [], refusedFolders: [] },
      references: {
        converged: false,
        rewritten: [],
        removed: [],
        restored: [],
        failures: ['the Claude directory is not an absolute path'],
        stillPosting: [],
        unproven: !switches.compliance,
      },
      workflowFolders: { converged: false, installed: [], unchanged: [], failures: ['the Claude directory is not an absolute path'], stalled: [] },
    };
  }

  const prompts = await attempt('prompt variants', warn, notRun(switches, 'the prompt converge failed'), () =>
    convergePromptVariants({ claudeDir, switches, plugins, warn, packageRoot }),
  );
  const skillLinks = newLinkReport();
  const skill = await attempt<CurationSkillState>('curation variants', warn, 'failed', () =>
    convergeSkills({ claudeDir, devflowDir, curation: switches.curation, plugins, warn, packageRoot }, skillLinks),
  );
  warnLinkReport(skillLinks, warn);
  const compliance = await attempt<ConvergeComplianceArtifactsResult>(
    'compliance artifacts',
    warn,
    { removedPreexisting: false, converged: false, replacedLinks: [], refusedFolders: [] },
    () => convergeFromManifest({ claudeDir, devflowDir, manifest, warn }),
  );
  const references = await attempt<ConvergeReferencesResult>(
    'reference converge',
    warn,
    {
      converged: false,
      rewritten: [],
      removed: [],
      restored: [],
      failures: ['the reference converge failed'],
      stillPosting: [],
      unproven: !switches.compliance,
    },
    () => convergeReferences({ claudeDir, devflowDir, compliance: switches.compliance, warn, packageRoot }),
  );
  const workflowFolders = await attempt<ConvergeWorkflowFoldersResult>(
    'workflow folders',
    warn,
    { converged: false, installed: [], unchanged: [], failures: ['the workflow folder converge failed'], stalled: [] },
    () => convergeWorkflowFolders({
      claudeDir,
      switches,
      plugins,
      folders: opts.workflowFolders ?? WORKFLOW_FOLDERS,
      root: opts.workflowFoldersRoot ?? packageRoot ?? getPackageRoot(),
      warn,
    }),
  );

  return {
    converged: prompts.converged && skill !== 'failed' && compliance.converged && references.converged && workflowFolders.converged,
    commandsRewritten: prompts.commandsRewritten,
    agentsRewritten: prompts.agentsRewritten,
    unchanged: prompts.unchanged,
    notInstalled: prompts.notInstalled,
    skill,
    compliance,
    references,
    workflowFolders,
    posting: mergePosting(
      mergePosting(prompts.posting, referencesPosting(references)),
      workflowFoldersPosting(workflowFolders, switches.compliance),
    ),
    replacedLinks: [...prompts.replacedLinks, ...skillLinks.replacedLinks, ...compliance.replacedLinks],
    refusedFolders: [...prompts.refusedFolders, ...compliance.refusedFolders],
  };
}

/**
 * The posting answer of the references converge. Compliance on, and a converge that finished, are clear.
 * A failure that left the overlay unproven cannot name the files that post, so it is `unknown`; a failure
 * that only left named files in place is `left`.
 */
function referencesPosting(references: ConvergeReferencesResult): PostingConverge {
  if (references.unproven) return { kind: 'unknown', reason: `the installed references: ${references.failures.join('; ')}` };
  if (references.stillPosting.length > 0) return { kind: 'left', files: references.stillPosting };
  return POSTING_CLEAR;
}

/**
 * Join the posting answers of two kinds. `unknown` wins, because a file list that leaves a kind out
 * would claim more than was proven; two unknowns keep both reasons; two lists join.
 */
function mergePosting(a: PostingConverge, b: PostingConverge): PostingConverge {
  if (a.kind === 'unknown' && b.kind === 'unknown') return { kind: 'unknown', reason: `${a.reason}; ${b.reason}` };
  if (a.kind === 'unknown') return a;
  if (b.kind === 'unknown') return b;
  if (a.kind === 'left' && b.kind === 'left') return { kind: 'left', files: [...a.files, ...b.files] };
  return a.kind === 'left' ? a : b;
}

// ── The toggle ─────────────────────────────────────────────────────────────

/** The running package's version, or null when its package.json cannot be read or holds none. */
export async function readRunningVersion(packageRoot: string = getPackageRoot()): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * One line for what a converge changed, or null when it changed nothing.
 *
 * The caller prints it only on a toggle: a run that moved nothing says nothing.
 */
export function describeCurationConverge(
  result: ConvergeCurationVariantsResult & { readonly references?: ConvergeReferencesResult },
  curation: boolean,
): string | null {
  return describeVariantConverge(result, 'curation', curation);
}

/**
 * One line for what a converge changed on an axis, or null when it changed nothing: the prompts
 * rewritten for the variant the axis now holds and, for curation, the skill it installed or removed.
 */
export function describeVariantConverge(
  result: ConvergeCurationVariantsResult & { readonly references?: ConvergeReferencesResult },
  axis: VariantAxis,
  enabled: boolean,
): string | null {
  const parts: string[] = [];
  const prompts = result.commandsRewritten.length + result.agentsRewritten.length;
  if (prompts > 0) {
    parts.push(
      `${result.commandsRewritten.length} command(s) and ${result.agentsRewritten.length} agent(s) ` +
      `rewritten for the ${axis}-${enabled ? 'on' : 'off'} variant`,
    );
  }
  if (result.skill === 'installed') parts.push('the apply-decisions skill installed');
  if (result.skill === 'removed') parts.push('the apply-decisions skill removed');
  const references = result.references;
  if (references !== undefined) {
    const changed = references.rewritten.length + references.restored.length;
    if (changed > 0) parts.push(`${changed} reference file(s) written`);
    if (references.removed.length > 0) parts.push(`${references.removed.length} reference file(s) removed`);
  }
  return parts.length === 0 ? null : parts.join('; ');
}

/**
 * The lines that say a compliance-off machine may still hold a prompt that posts, or none when
 * the converge proved it clear. The files are the installed ones that could not be converged.
 */
export function describePostingLeft(posting: PostingConverge): readonly string[] {
  switch (posting.kind) {
    case 'clear':
      return [];
    case 'left':
      return [
        `${posting.files.length} installed file(s) still post: ${posting.files.join(', ')}`,
        'Run `devflow init` to install the compliance-off files. If init cannot remove one, delete it by hand.',
      ];
    case 'unknown':
      return [
        `The installed files that still post cannot be named: ${posting.reason}`,
        'Run `devflow init` to install the compliance-off files.',
      ];
    default: {
      const unhandled: never = posting;
      return [`unhandled posting state ${JSON.stringify(unhandled)}`];
    }
  }
}

export interface ApplyVariantToggleOptions {
  claudeDir: string;
  devflowDir: string;
  /** The axis the caller just changed. */
  axis: VariantAxis;
  /** The value that axis was just set to. */
  enabled: boolean;
  /** The running package's version; null when it cannot be read. */
  runningVersion: string | null;
  warn: (msg: string) => void;
  packageRoot?: string;
}

export type VariantToggleOutcome =
  /** The converge did not run: the installed files are not ones this package would rewrite. */
  | { kind: 'skipped'; reason: 'no-manifest' | 'version-skew'; message: string }
  | { kind: 'converged'; result: ConvergeVariantAxesResult; agentMappingReapplied: boolean };

/**
 * Whether the version the manifest records is the version of the running package.
 * Pure. An unknown running version (null) never matches: the installed files are then
 * not known to be the ones this package would write. Both callers, the curation
 * toggle and `init --hud-only`, ask this one question.
 */
export function installedVersionMatches(installedVersion: string, runningVersion: string | null): boolean {
  return runningVersion !== null && installedVersion === runningVersion;
}

/**
 * The version-skew check, apart from the I/O so it is provable by itself: null when
 * the installed prompts and this package agree, else the message to print. The
 * installed version is hand-editable file content, so it prints through
 * `describeEchoedValue`.
 */
export function curationToggleSkew(installedVersion: string, runningVersion: string | null, curation: boolean): string | null {
  return variantToggleSkew(installedVersion, runningVersion, 'curation', curation);
}

/**
 * The version-skew check for a toggle of either axis. A compliance-off toggle also says that posting
 * steps remain installed, because that is the unsafe side of the mismatch: the installed prompts are
 * the ones that carry them.
 */
export function variantToggleSkew(
  installedVersion: string,
  runningVersion: string | null,
  axis: VariantAxis,
  enabled: boolean,
): string | null {
  if (installedVersionMatches(installedVersion, runningVersion)) return null;
  const skew =
    `The installed prompts come from devflow ${describeEchoedValue(installedVersion)} and this CLI is ${runningVersion ?? 'of unknown version'}, ` +
    `so the ${axis}-${enabled ? 'on' : 'off'} variants were not applied`;
  return axis === 'compliance' && !enabled
    ? `${skew}, and posting steps remain installed until devflow init. Run \`devflow init\` to apply them.`
    : `${skew}. Run \`devflow init\` to apply them.`;
}

/** The line for a toggle that found no readable install manifest. */
function unreadableManifestMessage(axis: VariantAxis, enabled: boolean): string {
  return axis === 'compliance' && !enabled
    ? 'No readable install manifest, so the compliance-off variants were not applied, and posting steps remain installed until devflow init. Run `devflow init`.'
    : `No readable install manifest, so the ${axis} variants were not applied. Run \`devflow init\`.`;
}

/**
 * The version-skew line for a command that writes curation data, or null when the
 * installed scripts are the ones this CLI would write. A hook of another version
 * reads and creates a different ledger folder, so such a command writes nothing until
 * `devflow init` has run. Apart from the toggle's own check (`curationToggleSkew`,
 * which also names the prompt variants): this line is for configure and the other
 * mutating subcommands. The installed version is hand-editable file content, so it
 * prints through `describeEchoedValue`.
 */
export async function installedScriptsSkew(devflowDir: string, packageRoot?: string): Promise<string | null> {
  const manifest = await readManifest(devflowDir);
  if (manifest === null) {
    return 'No readable install manifest, so the installed scripts are not known. Run `devflow init` first. Nothing was written.';
  }
  const running = await readRunningVersion(packageRoot);
  if (installedVersionMatches(manifest.version, running)) return null;
  return (
    `The installed scripts come from devflow ${describeEchoedValue(manifest.version)} and this CLI is ` +
    `${running ?? 'of unknown version'}. Run \`devflow init\` first. Nothing was written.`
  );
}

/**
 * Record the variants the installed prompts now hold in the manifest, after a converge that
 * finished clean (AC-29). A record that already says so is left alone, so a toggle to the value
 * already installed writes nothing. A failed write is a warning: the status line then reads
 * the record as it stood, which says `mismatch` or `unknown` and names `devflow init`.
 *
 * The read and the write run under the manifest lock, as the switch writers do, so a switch that
 * another devflow run writes in between is never overwritten with the older copy read here. The
 * record is written only when the manifest's switches are still the ones the run converged to: if
 * they changed during the run, nothing is recorded, the record that stood is removed in the same
 * locked write (the status then reads unknown) and a warning says so. A lock that cannot be
 * taken, or is lost before the write, withholds the record with a warning.
 */
async function recordInstalledVariants(devflowDir: string, switches: VariantSwitches, warn: (msg: string) => void): Promise<void> {
  try {
    const locked = await withManifestLock(devflowDir, {}, async (lock): Promise<'written' | 'current' | 'no-manifest' | 'lock-lost' | 'switches-changed'> => {
      const manifest = await readManifest(devflowDir);
      if (manifest === null) return 'no-manifest';
      if (manifest.features.curation !== switches.curation || manifest.features.compliance.enabled !== switches.compliance) {
        // The record names switches that no longer hold: remove it, so the status reads unknown.
        if (!Object.hasOwn(manifest, 'installedVariants')) return 'switches-changed';
        if (!(await lock.stillHeld())) return 'lock-lost';
        const { installedVariants: _stale, ...unrecorded } = manifest;
        await writeManifest(devflowDir, unrecorded);
        return 'switches-changed';
      }
      const recorded = readInstalledVariants(manifest.installedVariants);
      if (recorded !== null && recorded.curation === switches.curation && recorded.compliance === switches.compliance) return 'current';
      if (!(await lock.stillHeld())) return 'lock-lost';
      await writeManifest(devflowDir, { ...manifest, installedVariants: { curation: switches.curation, compliance: switches.compliance } });
      return 'written';
    });
    if (!locked.ok || locked.value === 'lock-lost') {
      warn('install record: the install manifest lock could not be held, so the installed variants were not recorded. Run `devflow init`.');
    } else if (locked.value === 'no-manifest') {
      warn('install record: no readable install manifest, so the installed variants were not recorded. Run `devflow init`.');
    } else if (locked.value === 'switches-changed') {
      warn('install record: the switches changed during the run, so the installed variants were not recorded. Run `devflow init`.');
    }
  } catch (err) {
    warn(`install record: could not record the installed variants — ${String(err)}`);
  }
}

/**
 * What `devflow curation --enable/--disable` and `devflow compliance` do after the switch is
 * written: converge the installed tree onto both switches with the one converge, record the
 * installed variants when it finished clean, then reapply the saved agent model and effort mapping.
 *
 * The switch of the toggled axis is the value the caller just set. The other axis and the
 * compliance frameworks come from the manifest, which the caller has already written.
 *
 * A version skew keeps the check this toggle has always had: the installed prompts are not the
 * ones this package would rewrite, so nothing is converged and the outcome is `skipped`.
 *
 * The converge carries each installed agent's model and effort into the variant it
 * writes (D-AGENT-OVERRIDE-CARRY), so the overrides are already on the file and this
 * reapply is the authority behind that carry, not a repair of a default window: it
 * re-reads agent-models.json and corrects any agent whose installed values had
 * drifted from it. It runs only when the converge rewrote an agent, and a failure
 * there is a warning like every other failure here.
 *
 * Never throws.
 */
export async function applyVariantToggle(opts: ApplyVariantToggleOptions): Promise<VariantToggleOutcome> {
  const { claudeDir, devflowDir, axis, enabled, runningVersion, warn } = opts;

  const manifest = await readManifest(devflowDir);
  if (manifest === null) {
    return { kind: 'skipped', reason: 'no-manifest', message: unreadableManifestMessage(axis, enabled) };
  }
  const skew = variantToggleSkew(manifest.version, runningVersion, axis, enabled);
  if (skew !== null) return { kind: 'skipped', reason: 'version-skew', message: skew };

  const selection = new Set(manifest.plugins);
  const state: VariantMachineState = {
    features: {
      curation: axis === 'curation' ? enabled : manifest.features.curation,
      compliance: axis === 'compliance' ? { ...manifest.features.compliance, enabled } : manifest.features.compliance,
      rules: manifest.features.rules,
    },
  };
  const result = await convergeVariantAxes({
    claudeDir,
    devflowDir,
    manifest: state,
    plugins: DEVFLOW_PLUGINS.filter(plugin => selection.has(plugin.name)),
    warn,
    packageRoot: opts.packageRoot,
  });
  if (result.converged) {
    await recordInstalledVariants(devflowDir, { curation: state.features.curation, compliance: state.features.compliance.enabled }, warn);
  }

  let agentMappingReapplied = false;
  if (result.agentsRewritten.length > 0) {
    try {
      await reapplyAgentMapping({
        proxyEnabled: await isProxyEnabled(devflowDir),
        installDir: path.join(claudeDir, 'agents', 'devflow'),
        devflowDir,
        onWarning: warn,
      });
      agentMappingReapplied = true;
    } catch (err) {
      warn(`prompt variants: could not reapply the agent model mapping — ${String(err)}`);
    }
  }
  return { kind: 'converged', result, agentMappingReapplied };
}
