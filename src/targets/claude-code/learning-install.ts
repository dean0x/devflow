/**
 * Learning-variant installer for the Claude Code target.
 *
 * D-LEARNING-VARIANT-INSTALL: the install follows the machine's learning switch
 * (`features.learning` in ~/.devflow/manifest.json) and nothing else. When the
 * switch is off, every command and agent that has a learning-off variant
 * (dist/learning-off/{commands,agents}, built by D-LEARNING-VARIANTS) is installed
 * from it, and the apply-decisions skill is not installed, so the decisions text
 * reaches no prompt and the skill has no reader. When the switch is on, the
 * learning-on files and the skill are installed. Three pieces carry it:
 *
 *   - the source order (src/core/assets.ts commandSourceDirs / agentSourceDirs):
 *     with learning off the learning-off directory is consulted first, then the
 *     normal order, so a host with no arm installs its one file as before;
 *   - the skill condition (LEARNING_GATED_SKILLS in src/core/plugins.ts):
 *     installViaFileCopy leaves the skill out when learning is off;
 *   - {@link convergeLearningVariants}, below: the converge that makes an
 *     ALREADY-installed tree match the switch, run by `devflow init` after the
 *     file copy and by `devflow learning --enable/--disable` after the switch is
 *     written ({@link applyLearningToggle}).
 *
 * The converge, decided in turn:
 *   - Its roster is the files that exist under dist/learning-off, not a list typed
 *     here: the build owns which hosts have an arm, so a new arm is converged with
 *     no edit to this file.
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
 *     under learning off is DORMANT in the same sense as one for a deselected
 *     skill: kept in ~/.devflow/skills, never installed, never deleted, and
 *     applied again the moment learning comes back on.
 *   - Version skew: the variants in this package were built with this version.
 *     When the manifest records another version, the installed files are not the
 *     ones this package would rewrite, so {@link applyLearningToggle} skips the
 *     converge and says to run `devflow init`.
 *   - An agent's installed `model:` and `effort:` are carried into the variant before
 *     the byte comparison (D-AGENT-OVERRIDE-CARRY, see {@link withInstalledState}),
 *     so the overrides `devflow agents` and the proxy put there are never written
 *     back to the shipped values and a no-op converge writes no agent.
 *     {@link applyLearningToggle} still runs reapplyAgentMapping straight after a
 *     converge that rewrote an agent: it reads agent-models.json and is the authority.
 *
 * D-LEARNING-PRELOAD-MACHINE-ONLY (amended): the apply-decisions preload follows
 * the machine switch only, never a repository's narrowing, because a repository
 * can narrow learning off on a machine where it is on and the installed agents are
 * machine-wide. Met by the variant: the learning-off agent files do not preload
 * the skill (no install-time frontmatter rewrite exists), and the learning-on files
 * keep the preload and their run-time gate for a narrowed repository. A repo
 * `project.json` with `learning: false` on a learning-on machine therefore changes
 * nothing installed.
 *
 * I/O orchestration in src/targets/; the pure selection rules stay in src/core/.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import {
  agentSourceDirs,
  commandSourceDirs,
  learningOffDir,
} from '../../core/assets.js';
import { carryAgentOverrides, reapplyAgentMapping } from '../../core/agent-models.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import type { LearningVariantKind } from '../../core/learning-variants.js';
import { readManifest } from '../../core/manifest.js';
import { getPackageRoot } from '../../core/paths.js';
import { isProxyEnabled } from '../../core/proxy-state.js';
import {
  DEVFLOW_PLUGINS,
  LEARNING_GATED_SKILLS,
  installedLanguageFocuses,
  prefixSkillName,
  skillsOf,
  type PluginDefinition,
} from '../../core/plugins.js';
import { copyDirectory, resolveSkillSource } from './installer.js';
import { LANGUAGE_STAMPED_COMMANDS, stampForConverge } from './language-stamp.js';

// ── Bounds ─────────────────────────────────────────────────────────────────

/**
 * The most variant files one kind may carry. The shipped roster is 14 commands and
 * 9 agents; the bound exists so a directory that grew without limit cannot turn the
 * converge into an unbounded loop (every loop has an explicit bound).
 */
export const MAX_LEARNING_ROSTER = 256;

/** Deepest skill-directory descent the tree comparison takes. */
const MAX_SKILL_TREE_DEPTH = 4;

/** A roster entry is a flat, lowercase, hyphenated markdown basename. */
const ROSTER_NAME_RE = /^[a-z0-9][a-z0-9-]*\.md$/;

const KINDS: readonly LearningVariantKind[] = ['commands', 'agents'];

// ── Types ──────────────────────────────────────────────────────────────────

/** What a converge left the learning-gated skill directory in. */
export type LearningSkillState =
  /** Installed, or replaced because the bytes differed. */
  | 'installed'
  /** Removed (learning off). */
  | 'removed'
  /** Already as the switch wants it: present and identical, or absent. */
  | 'unchanged'
  /** Learning on, but no plugin of the selection requires the skill: nothing installed. */
  | 'not-selected'
  | 'failed';

export interface ConvergeLearningVariantsOptions {
  /** Claude Code's config directory (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /** The machine root (~/.devflow), where skill shadows live. */
  devflowDir: string;
  /** The machine's settled learning switch. */
  learning: boolean;
  /** The effective plugin selection: the skill is installed on switch-on only if its closure holds it. */
  plugins: readonly PluginDefinition[];
  warn: (msg: string) => void;
  /** Package root the variants and sources, the apply-decisions skill included, are read from. Injectable for a temp tree; defaults to this package. */
  packageRoot?: string;
}

export interface ConvergeLearningVariantsResult {
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
  skill: LearningSkillState;
}

type FileOutcome = 'rewritten' | 'unchanged' | 'not-installed' | 'failed';

// ── Internals ──────────────────────────────────────────────────────────────

function installedFile(claudeDir: string, kind: LearningVariantKind, fileName: string): string {
  return path.join(claudeDir, kind, 'devflow', fileName);
}

/** The learning-ON source directories for a kind, most-preferred first. */
function onSourceDirs(kind: LearningVariantKind, root: string): readonly string[] {
  return kind === 'commands' ? commandSourceDirs(true, root) : agentSourceDirs(root, true);
}

/**
 * The roster of one kind: the `.md` files under dist/learning-off/<kind>, sorted.
 *
 * `present` is false when the directory does not exist (the build has not run, or
 * only `build:cli` did), so the caller can say so instead of reporting a converge
 * that had nothing to do.
 */
async function readRoster(
  kind: LearningVariantKind,
  root: string,
  warn: (msg: string) => void,
): Promise<{ names: string[]; present: boolean }> {
  let entries: string[];
  try {
    entries = await fs.readdir(learningOffDir(kind, root));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { names: [], present: false };
    warn(`learning variants: cannot read the ${kind} variants — ${String(err)}`);
    return { names: [], present: false };
  }
  const names = entries.filter(entry => ROSTER_NAME_RE.test(entry)).sort();
  if (names.length > MAX_LEARNING_ROSTER) {
    warn(`learning variants: ${names.length} ${kind} variants exceed the bound of ${MAX_LEARNING_ROSTER}; converging the first ${MAX_LEARNING_ROSTER}`);
    return { names: names.slice(0, MAX_LEARNING_ROSTER), present: true };
  }
  return { names, present: true };
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
 * Pure.
 */
function withInstalledState(
  kind: LearningVariantKind,
  fileName: string,
  source: Buffer,
  installed: Buffer,
  focuses: readonly string[],
): Buffer {
  if (kind === 'agents') {
    const sourceText = source.toString('utf-8');
    const carried = carryAgentOverrides(sourceText, installed.toString('utf-8'));
    return carried === sourceText ? source : Buffer.from(carried, 'utf-8');
  }
  return LANGUAGE_STAMPED_COMMANDS.includes(fileName.replace(/\.md$/, ''))
    ? Buffer.from(stampForConverge(source.toString('utf-8'), installed.toString('utf-8'), focuses), 'utf-8')
    : source;
}

/**
 * Converge ONE installed prompt onto the variant the switch wants.
 *
 * Never throws: every failure is a warning and the outcome `failed`, so the next
 * file is still tried.
 */
async function convergeFile(
  kind: LearningVariantKind,
  fileName: string,
  opts: Required<Pick<ConvergeLearningVariantsOptions, 'claudeDir' | 'learning' | 'warn'>> & {
    root: string;
    /** The effective selection's language list, stamped into a copy that has none to carry. */
    focuses: readonly string[];
  },
): Promise<FileOutcome> {
  const { claudeDir, learning, warn, root, focuses } = opts;
  const target = installedFile(claudeDir, kind, fileName);

  const installed = await readIfPresent(target);
  if (installed === 'absent') return 'not-installed';
  if (installed === 'unreadable') {
    warn(`learning variants: cannot read the installed ${kind}/${fileName} (${target}) — left as it is`);
    return 'failed';
  }

  // Learning off: the variant is the roster file itself. Learning on: the normal
  // source order, which is where the learning-on file of that host lives.
  const candidates = learning
    ? onSourceDirs(kind, root).map(dir => path.join(dir, fileName))
    : [path.join(learningOffDir(kind, root), fileName)];
  const source = await firstReadable(candidates);
  if (source === undefined) {
    warn(`learning variants: no source for ${kind}/${fileName} (searched: ${candidates.join(', ')}) — left as it is`);
    return 'failed';
  }

  const wanted = withInstalledState(kind, fileName, source.bytes, installed, focuses);

  // Byte-compared: an installed file already holding the target bytes is not
  // rewritten, so a run that changes nothing writes nothing.
  if (installed.equals(wanted)) return 'unchanged';

  try {
    // Prompts are UTF-8 text; the atomic writer takes a string and preserves the
    // target's permission mode.
    await writeFileAtomicExclusive(target, wanted.toString('utf-8'));
  } catch (err) {
    warn(`learning variants: could not rewrite ${kind}/${fileName} (${target}) — ${String(err)}`);
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
 */
async function swapInSkillDirectory(claudeDir: string, sourceDir: string, target: string): Promise<void> {
  const staging = path.join(claudeDir, `.devflow-learning-${process.pid}-${Date.now().toString(36)}.tmp`);
  const backup = `${staging}.old`;
  try {
    await copyDirectory(sourceDir, staging);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const hadTarget = await pathExists(target);
    if (hadTarget) await fs.rename(target, backup);
    try {
      await fs.rename(staging, target);
    } catch (err) {
      if (hadTarget) await fs.rename(backup, target);
      throw err;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Converge the learning-gated skill directories. Never throws. */
async function convergeSkills(opts: ConvergeLearningVariantsOptions): Promise<LearningSkillState> {
  const { claudeDir, devflowDir, learning, plugins, warn } = opts;
  const selected = skillsOf(plugins);
  let state: LearningSkillState = 'unchanged';

  // Every gated skill is converged: a failure on one must not skip the next.
  for (const skill of LEARNING_GATED_SKILLS) {
    const target = path.join(claudeDir, 'skills', prefixSkillName(skill));
    try {
      if (!learning) {
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
      await swapInSkillDirectory(claudeDir, resolved.dir, target);
      state = 'installed';
    } catch (err) {
      warn(`learning variants: could not converge the ${prefixSkillName(skill)} skill (${target}) — ${String(err)}`);
      state = 'failed';
    }
  }
  return state;
}

// ── Convergence ────────────────────────────────────────────────────────────

/**
 * Make the installed commands, agents and apply-decisions skill match the
 * machine's learning switch.
 *
 * Never throws. A caller reads `converged`; it does not catch. A claudeDir that is
 * not absolute is reported the same way rather than thrown, because an install
 * must not die on it.
 */
export async function convergeLearningVariants(
  opts: ConvergeLearningVariantsOptions,
): Promise<ConvergeLearningVariantsResult> {
  const { claudeDir, learning, warn } = opts;
  const empty: ConvergeLearningVariantsResult = {
    converged: false, commandsRewritten: [], agentsRewritten: [], unchanged: 0, notInstalled: 0, skill: 'unchanged',
  };

  // Precondition, asserted in production code: a relative claudeDir would resolve
  // the install targets somewhere unexpected.
  if (!path.isAbsolute(claudeDir)) {
    warn(`learning variants: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return empty;
  }
  const root = opts.packageRoot ?? getPackageRoot();
  const focuses = installedLanguageFocuses(opts.plugins);

  let failed = false;
  let unchanged = 0;
  let notInstalled = 0;
  const rewritten: Record<LearningVariantKind, string[]> = { commands: [], agents: [] };

  for (const kind of KINDS) {
    const roster = await readRoster(kind, root, warn);
    if (!roster.present) {
      warn(`learning variants: no ${kind} variants under ${learningOffDir(kind, root)} — run \`npm run build:mds\`; installed ${kind} left as they are`);
      failed = true;
      continue;
    }
    for (const fileName of roster.names) {
      const outcome = await convergeFile(kind, fileName, { claudeDir, learning, warn, root, focuses });
      if (outcome === 'rewritten') rewritten[kind].push(fileName);
      else if (outcome === 'unchanged') unchanged++;
      else if (outcome === 'not-installed') notInstalled++;
      else failed = true;
    }
  }

  // Evaluated unconditionally, after the files: a failed prompt never skips the skill
  // (one failure must not leave the rest of the fan-out half-converged).
  const skill = await convergeSkills(opts);
  if (skill === 'failed') failed = true;

  return {
    converged: !failed,
    commandsRewritten: rewritten.commands,
    agentsRewritten: rewritten.agents,
    unchanged,
    notInstalled,
    skill,
  };
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
export function describeLearningConverge(result: ConvergeLearningVariantsResult, learning: boolean): string | null {
  const parts: string[] = [];
  const prompts = result.commandsRewritten.length + result.agentsRewritten.length;
  if (prompts > 0) {
    parts.push(
      `${result.commandsRewritten.length} command(s) and ${result.agentsRewritten.length} agent(s) ` +
      `rewritten for the learning-${learning ? 'on' : 'off'} variant`,
    );
  }
  if (result.skill === 'installed') parts.push('the apply-decisions skill installed');
  if (result.skill === 'removed') parts.push('the apply-decisions skill removed');
  return parts.length === 0 ? null : parts.join('; ');
}

export interface ApplyLearningToggleOptions {
  claudeDir: string;
  devflowDir: string;
  /** The value the switch was just set to. */
  learning: boolean;
  /** The running package's version; null when it cannot be read. */
  runningVersion: string | null;
  warn: (msg: string) => void;
  packageRoot?: string;
}

export type LearningToggleOutcome =
  /** The converge did not run: the installed files are not ones this package would rewrite. */
  | { kind: 'skipped'; reason: 'no-manifest' | 'version-skew'; message: string }
  | { kind: 'converged'; result: ConvergeLearningVariantsResult; agentMappingReapplied: boolean };

/**
 * The version-skew check, apart from the I/O so it is provable by itself: null when
 * the installed prompts and this package agree, else the message to print.
 */
export function learningToggleSkew(installedVersion: string, runningVersion: string | null, learning: boolean): string | null {
  if (runningVersion !== null && installedVersion === runningVersion) return null;
  return (
    `The installed prompts come from devflow ${installedVersion} and this CLI is ${runningVersion ?? 'of unknown version'}, ` +
    `so the learning-${learning ? 'on' : 'off'} variants were not applied. Run \`devflow init\` to apply them.`
  );
}

/**
 * What `devflow learning --enable/--disable` does after the switch is written:
 * converge the installed tree onto the new value, then reapply the saved agent
 * model and effort mapping.
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
export async function applyLearningToggle(opts: ApplyLearningToggleOptions): Promise<LearningToggleOutcome> {
  const { claudeDir, devflowDir, learning, runningVersion, warn } = opts;

  const manifest = await readManifest(devflowDir);
  if (manifest === null) {
    return {
      kind: 'skipped',
      reason: 'no-manifest',
      message: 'No readable install manifest, so the learning variants were not applied. Run `devflow init`.',
    };
  }
  const skew = learningToggleSkew(manifest.version, runningVersion, learning);
  if (skew !== null) return { kind: 'skipped', reason: 'version-skew', message: skew };

  const selection = new Set(manifest.plugins);
  const result = await convergeLearningVariants({
    claudeDir,
    devflowDir,
    learning,
    plugins: DEVFLOW_PLUGINS.filter(plugin => selection.has(plugin.name)),
    warn,
    packageRoot: opts.packageRoot,
  });

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
      warn(`learning variants: could not reapply the agent model mapping — ${String(err)}`);
    }
  }
  return { kind: 'converged', result, agentMappingReapplied };
}
