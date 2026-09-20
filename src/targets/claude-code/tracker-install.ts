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

// ── Convergence ────────────────────────────────────────────────────────────

/**
 * Converge the Tracker agent file onto the resolved provider.
 *
 * Convergence matrix:
 *   provider !== github → copy the agent in (re-copied every run, so a truncated
 *                         or hand-edited file self-heals rather than being
 *                         trusted because it exists)
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
    return { converged: false, agent: 'unchanged' };
  }

  const target = agentTarget(claudeDir);

  if (provider === AGENTLESS_PROVIDER) {
    const existed = await pathExists(target);
    if (!existed) return { converged: true, agent: 'unchanged' };
    try {
      await fs.rm(target, { force: true });
    } catch (err) {
      warn(`tracker: failed to remove the Tracker agent (${target}) — ${String(err)}`);
      return { converged: false, agent: 'unchanged' };
    }
    return { converged: true, agent: 'removed' };
  }

  const dirs = opts.agentSourceDirs ?? agentSourceDirs();
  const candidates = dirs.map(dir => path.join(dir, mdFileName(TRACKER_AGENT_NAME)));
  const source = await firstExisting(candidates);
  if (source === undefined) {
    warn(
      `tracker: agent source not found for "${TRACKER_AGENT_NAME}" (searched: ${candidates.join(', ')}) — ` +
      `run \`npm run build:mds\` if it is compiled from an .mds generator host`,
    );
    return { converged: false, agent: 'unchanged' };
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } catch (err) {
    warn(`tracker: failed to install the Tracker agent (${target}) — ${String(err)}`);
    return { converged: false, agent: 'unchanged' };
  }

  return { converged: true, agent: 'installed' };
}
