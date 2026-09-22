/**
 * Tracker artifact installer for the Claude Code target.
 *
 * Convergence function for the ONE artifact whose presence advertises the
 * selected tracker provider: the Tracker agent file. The generated reference
 * subtree converges too, but through {@link overlayInstalledReferences} in
 * installer.ts — that is the installer's one overlay spelling, and a mode flag
 * on this function would have made it a second (design review M2).
 *
 * Applies ADR-013: I/O orchestration in src/targets/; pure helpers in src/core/.
 * Applies PF-009: warn-not-throw, so one failing artifact never aborts an install.
 * Applies PF-015: the biconditional converges in BOTH directions — selecting a
 * provider installs the agent, returning to github removes it.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { agentSourceDirs, type AgentSourceDirs } from '../../core/assets.js';
import { mdFileName } from '../../core/orphan-sweep.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** What this run left the agent file in. */
export type TrackerAgentState = 'installed' | 'removed' | 'unchanged';

export interface ConvergeTrackerArtifactsOptions {
  /** Path to the Claude config dir (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /**
   * The RESOLVED tracker provider id. Not trusted as a path segment: it is only
   * ever compared, never joined — the agent's filename is a constant.
   */
  provider: string;
  warn: (msg: string) => void;
  /**
   * Agent source directories, most-preferred first — see agentSourceDirs(),
   * which owns the ordering convention and supplies the default. Injectable so
   * a test can prove the preference order against a temp tree.
   */
  agentSourceDirs?: AgentSourceDirs;
}

export interface ConvergeTrackerArtifactsResult {
  /**
   * True when every artifact operation this run attempted completed without
   * error. False when any warn path was taken.
   *
   * PF-015: converge is warn-not-throw, so callers cannot detect partial failure
   * with a catch block. The sentinel write is gated on this field — an
   * unconverged run must not advertise a provider whose agent is missing.
   */
  converged: boolean;
  /**
   * Is a spawnable copy of the Tracker agent at the target NOW — whoever put it
   * there, and whatever this run managed to do?
   *
   * Distinct from {@link ConvergeTrackerArtifactsResult.converged}, and the
   * distinction is what the presence sentinel has to be gated on. `converged`
   * answers "did this run succeed"; a caller that reads it alone gets both
   * directions wrong:
   *
   *   - a re-copy that fails over an already-installed agent (a transient
   *     EACCES, a full disk) would disable a provider that can still be spawned;
   *   - suppressing a sentinel WRITE leaves a previous provider's sentinel
   *     untouched, so a jira → linear transition whose agent copy failed goes on
   *     advertising jira. "Nothing advertises a provider whose agent is missing"
   *     is only true if somebody removes it.
   *
   * False when the path could not be probed at all (a non-absolute claudeDir):
   * a caller must not advertise on an answer this function could not establish.
   */
  agentPresent: boolean;
  /** What happened to `{claudeDir}/agents/devflow/tracker.md`. */
  agent: TrackerAgentState;
}

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * The agent whose presence is conditional on the provider.
 *
 * It stays DECLARED in `devflow-core-skills.agents` and is filtered here at
 * install time rather than being lifted into a feature-owned set: the compliance
 * precedent does not transfer, because compliance's plugin was deleted while
 * `devflow-core-skills` is a live, non-optional owner. A feature-owned set would
 * cost three new union sites and a rewrite of the pinned agent-roster floor to
 * solve a problem the agent SWEEP does not have — the sweep keys on the full
 * registry, so it never sees this file as an orphan, and removing it is solely
 * this function's job.
 */
const TRACKER_AGENT_NAME = 'tracker';

/**
 * The provider whose mechanics need no Tracker agent.
 *
 * GitHub conventions are not inferred: the Git agent runs `gh`, whose issue
 * grammar this repo already speaks. The agent exists to infer conventions from a
 * connected tool-call server, which is a thing only the other providers have.
 */
const AGENTLESS_PROVIDER = 'github';

function agentTarget(claudeDir: string): string {
  return path.join(claudeDir, 'agents', 'devflow', mdFileName(TRACKER_AGENT_NAME));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch { return false; }
}

/** First path in `candidates` that exists, or undefined when none do. */
async function firstExisting(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Would copying `source` over `target` change anything?
 *
 * Asked once, between resolving the source and copying it, so a run that would write a
 * byte-identical copy of the installed agent reports `unchanged` instead of `installed`
 * — the same question the reference overlay asks per unit, for the same reason: a
 * summary that can only ever say "installed" says nothing, and a steady-state re-init
 * announcing "tracker agent installed" is the noise this closes (QA S2).
 *
 * It does NOT weaken the self-heal. A hand-edited or truncated agent differs from its
 * source, so it is copied and reported as written; only an identical file is skipped,
 * and skipping a copy of what is already there changes nothing on disk.
 *
 * Any error — an absent target, an unreadable one — answers "no". The fallback is the
 * copy that was going to happen anyway, so a failure to compare costs a write, never
 * correctness.
 */
async function copyWouldChangeNothing(source: string, target: string): Promise<boolean> {
  try {
    const [from, to] = await Promise.all([fs.readFile(source), fs.readFile(target)]);
    return from.equals(to);
  } catch { return false; }
}

// ── Convergence ────────────────────────────────────────────────────────────

/**
 * Converge the Tracker agent file onto the resolved provider.
 *
 * Convergence matrix:
 *   provider !== github → copy the agent in, unless the installed file is already
 *                         byte-identical to the source. Compared rather than trusted
 *                         for existing, so a truncated or hand-edited file self-heals;
 *                         compared rather than re-copied blind, so a run that changes
 *                         nothing reports `unchanged` and the summary stays quiet
 *                         (see {@link copyWouldChangeNothing})
 *   provider === github → remove it, absent or not
 *
 * Never throws. A caller gates on `converged`; it does not catch. The one
 * refusal that is not an I/O degradation — a claudeDir that is not absolute —
 * is reported the same way rather than thrown, because it reaches here from a
 * manifest read and an install must not die on it.
 */
export async function convergeTrackerArtifacts(
  opts: ConvergeTrackerArtifactsOptions,
): Promise<ConvergeTrackerArtifactsResult> {
  const { claudeDir, provider, warn } = opts;

  // Precondition, asserted in production code rather than only in tests: an
  // empty or relative claudeDir would make the target resolve somewhere
  // unexpected, and the removal branch runs fs.rm against it.
  if (!path.isAbsolute(claudeDir)) {
    warn(`tracker: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return { converged: false, agentPresent: false, agent: 'unchanged' };
  }

  const target = agentTarget(claudeDir);

  if (provider === AGENTLESS_PROVIDER) {
    const existed = await pathExists(target);
    if (!existed) return { converged: true, agentPresent: false, agent: 'unchanged' };
    try {
      await fs.rm(target, { force: true });
    } catch (err) {
      warn(`tracker: failed to remove the Tracker agent (${target}) — ${String(err)}`);
      return { converged: false, agentPresent: true, agent: 'unchanged' };
    }
    return { converged: true, agentPresent: false, agent: 'removed' };
  }

  const dirs = opts.agentSourceDirs ?? agentSourceDirs();
  const candidates = dirs.map(dir => path.join(dir, mdFileName(TRACKER_AGENT_NAME)));
  const source = await firstExisting(candidates);
  if (source === undefined) {
    warn(
      `tracker: agent source not found for "${TRACKER_AGENT_NAME}" (searched: ${candidates.join(', ')}) — ` +
      `run \`npm run build:mds\` if it is compiled from an .mds generator host`,
    );
    // Probed rather than assumed: a previous run may have left a copy that is
    // still spawnable, and that is the difference between "this run did nothing"
    // and "there is nothing there".
    return { converged: false, agentPresent: await pathExists(target), agent: 'unchanged' };
  }

  // Already converged — nothing to write, and nothing for the summary to announce.
  // The directory is not created either: an identical file at the target means it is
  // already there (see {@link copyWouldChangeNothing}).
  if (await copyWouldChangeNothing(source, target)) {
    return { converged: true, agentPresent: true, agent: 'unchanged' };
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } catch (err) {
    warn(`tracker: failed to install the Tracker agent (${target}) — ${String(err)}`);
    return { converged: false, agentPresent: await pathExists(target), agent: 'unchanged' };
  }

  return { converged: true, agentPresent: true, agent: 'installed' };
}
