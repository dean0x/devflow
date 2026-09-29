/**
 * Tracker artifact installer for the Claude Code target.
 *
 * Convergence function for the Tracker agent file. The generated reference
 * subtree converges too, but through the installer's one overlay spelling in
 * installer.ts — a mode flag on this function would have made it a second
 * (design review M2).
 *
 * Applies ADR-013: I/O orchestration in src/targets/; pure helpers in src/core/.
 * Applies PF-009: warn-not-throw, so one failing artifact never aborts an install.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { agentSourceDirs, type AgentSourceDirs } from '../../core/assets.js';
import { mdFileName } from '../../core/orphan-sweep.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** What this run left the agent file in. */
export type TrackerAgentState = 'installed' | 'unchanged';

export interface ConvergeTrackerArtifactsOptions {
  /** Path to the Claude config dir (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
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
   * True when the agent file is byte-identical to its source after this run.
   * False when any warn path was taken.
   *
   * PF-015: converge is warn-not-throw, so callers cannot detect partial failure
   * with a catch block; this field is how they learn of it.
   */
  converged: boolean;
  /** What happened to `{claudeDir}/agents/devflow/tracker.md`. */
  agent: TrackerAgentState;
}

/**
 * The agent this module owns.
 *
 * It stays DECLARED in `devflow-core-skills.agents`, so the agent SWEEP — which
 * keys on the full registry — never sees this file as an orphan, and is converged
 * here rather than by the installer's generic copy loop, which skips it.
 *
 * Exported because the name has more than one reader and may have only one
 * authority (D-TRACKER-AGENT-OWNER): {@link convergeTrackerArtifacts} below, and,
 * in installer.ts, both the generic agent copy loop — which has to skip the one
 * agent it does not own — and the full-install pre-clean, which has to empty the
 * agent directory around it. A second literal at any of those sites is the shape
 * this export exists to forbid.
 */
export const TRACKER_AGENT_NAME = 'tracker';

// ── Internals ──────────────────────────────────────────────────────────────

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
 * Converge the Tracker agent file: install it, whatever the machine's provider.
 *
 * D-INSTALL-ALL-PROVIDERS: every install carries the agent. The provider a
 * session learns conventions for is resolved per repository — a committed
 * `.devflow/project.json` can select jira on a machine whose default is github —
 * so the agent the session-start directive names must be spawnable on every
 * machine, not only on the ones whose manifest chose a tool-call provider. It is
 * INERT until that directive fires, which happens only for a provider with no
 * learned conventions.
 *
 * Copies the agent in unless the installed file is already byte-identical to the
 * source. Compared rather than trusted for existing, so a truncated or hand-edited
 * file self-heals; compared rather than re-copied blind, so a run that changes
 * nothing reports `unchanged` and the summary stays quiet
 * (see {@link copyWouldChangeNothing}).
 *
 * Never throws. A caller reads `converged`; it does not catch. The one refusal
 * that is not an I/O degradation — a claudeDir that is not absolute — is reported
 * the same way rather than thrown, because an install must not die on it.
 */
export async function convergeTrackerArtifacts(
  opts: ConvergeTrackerArtifactsOptions,
): Promise<ConvergeTrackerArtifactsResult> {
  const { claudeDir, warn } = opts;

  // Precondition, asserted in production code rather than only in tests: an
  // empty or relative claudeDir would make the target resolve somewhere
  // unexpected.
  if (!path.isAbsolute(claudeDir)) {
    warn(`tracker: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return { converged: false, agent: 'unchanged' };
  }

  const target = agentTarget(claudeDir);
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

  // Already converged — nothing to write, and nothing for the summary to announce.
  // The directory is not created either: an identical file at the target means it is
  // already there (see {@link copyWouldChangeNothing}).
  if (await copyWouldChangeNothing(source, target)) {
    return { converged: true, agent: 'unchanged' };
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
