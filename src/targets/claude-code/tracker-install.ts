/**
 * Tracker artifact installer for the Claude Code target.
 *
 * Convergence function for the Tracker agent file. The generated reference
 * subtree converges too, but through the installer's one overlay spelling in
 * installer.ts — a mode flag on this function would have made it a second
 * (design review M2).
 *
 * I/O orchestration in src/targets/; pure helpers in src/core/.
 * Warn-not-throw, so one failing artifact never aborts an install.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { stampAgentTools } from '../../core/agent-frontmatter.js';
import { agentSourceDirs, type AgentSourceDirs } from '../../core/assets.js';
import { mdFileName } from '../../core/orphan-sweep.js';
import { TRACKER_MCP_SERVERS_DEFAULT, trackerServerTools } from '../../core/tracker.js';
import { newLinkReport, refuseUnrealFolder, warnLinkReport, writeFileReplacingLink } from './linked-folder.js';

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
  /**
   * The tracker tool servers stamped onto the agent's `tools:` line
   * (D-TRACKER-SERVER-ALLOWLIST). `devflow init` passes the manifest's setting; absent means
   * the default list, the meaning an absent manifest field has.
   */
  servers?: readonly string[];
}

export interface ConvergeTrackerArtifactsResult {
  /**
   * True when the agent file is byte-identical to its stamped source after this run.
   * False when any warn path was taken.
   *
   * Converge is warn-not-throw, so callers cannot detect partial failure
   * with a catch block; this field is how they learn of it.
   */
  converged: boolean;
  /** What happened to `{claudeDir}/agents/devflow/tracker.md`. */
  agent: TrackerAgentState;
  /** `tracker.md`, if it was a link, now a real file. What it pointed to was left as it was. */
  replacedLinks: readonly string[];
  /** `agents/devflow`, if it is a link or not a folder: nothing was written there. */
  refusedFolders: readonly string[];
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
 * Would writing `wanted` over `target` change anything?
 *
 * Asked once, between resolving the wanted bytes and writing them, so a run that would write a
 * byte-identical copy of the installed agent reports `unchanged` instead of `installed`
 * — the same question the reference overlay asks per unit, for the same reason: a
 * summary that can only ever say "installed" says nothing, and a steady-state re-init
 * announcing "tracker agent installed" is the noise this closes (QA S2).
 *
 * It does NOT weaken the self-heal. A hand-edited or truncated agent differs from what is
 * wanted, so it is written and reported as written; only an identical file is skipped,
 * and skipping a write of what is already there changes nothing on disk.
 *
 * Any error — an absent target, an unreadable one — answers "no". The fallback is the
 * write that was going to happen anyway, so a failure to compare costs a write, never
 * correctness.
 */
async function writeWouldChangeNothing(wanted: string, target: string): Promise<boolean> {
  try {
    return (await fs.readFile(target, 'utf-8')) === wanted;
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
 * Writes the agent in unless the installed file is already byte-identical to the
 * source wearing the tracker-server stamp (D-TRACKER-SERVER-ALLOWLIST; the stamp is the
 * only difference between the installed file and its source, which is why the comparison
 * is against the STAMPED text: against the bare source the file would differ on every run).
 * Compared rather than trusted for existing, so a truncated or hand-edited
 * file self-heals; compared rather than re-written blind, so a run that changes
 * nothing reports `unchanged` and the summary stays quiet
 * (see {@link writeWouldChangeNothing}).
 *
 * An `agents/devflow` that is a link, or not a folder, is refused: nothing is written there, and the
 * folder is named in `refusedFolders` and in a warning. A `tracker.md` that is a link is replaced by a
 * real file, and named in `replacedLinks` and in a warning.
 *
 * Never throws. A caller reads `converged`; it does not catch. The one refusal
 * that is not an I/O degradation — a claudeDir that is not absolute — is reported
 * the same way rather than thrown, because an install must not die on it.
 */
export async function convergeTrackerArtifacts(
  opts: ConvergeTrackerArtifactsOptions,
): Promise<ConvergeTrackerArtifactsResult> {
  const { claudeDir, warn } = opts;

  const links = newLinkReport();
  const finish = (converged: boolean, agent: TrackerAgentState): ConvergeTrackerArtifactsResult => {
    warnLinkReport(links, warn);
    return { converged, agent, replacedLinks: links.replacedLinks, refusedFolders: links.refusedFolders };
  };

  // Precondition, asserted in production code rather than only in tests: an
  // empty or relative claudeDir would make the target resolve somewhere
  // unexpected.
  if (!path.isAbsolute(claudeDir)) {
    warn(`tracker: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return finish(false, 'unchanged');
  }

  const target = agentTarget(claudeDir);
  // A link at the folder sends the write into another place, so the folder is proven first.
  if (await refuseUnrealFolder(links, path.dirname(target))) return finish(false, 'unchanged');

  const dirs = opts.agentSourceDirs ?? agentSourceDirs();
  const candidates = dirs.map(dir => path.join(dir, mdFileName(TRACKER_AGENT_NAME)));
  const source = await firstExisting(candidates);
  if (source === undefined) {
    warn(
      `tracker: agent source not found for "${TRACKER_AGENT_NAME}" (searched: ${candidates.join(', ')}) — ` +
      `run \`npm run build:mds\` if it is compiled from an .mds generator host`,
    );
    return finish(false, 'unchanged');
  }

  let wanted: string;
  try {
    const stamped = stampAgentTools(
      await fs.readFile(source, 'utf-8'),
      trackerServerTools(opts.servers ?? TRACKER_MCP_SERVERS_DEFAULT),
    );
    if (!stamped.ok) {
      warn(`tracker: the Tracker agent source could not take the tracker servers (${stamped.error}) — not installed`);
      return finish(false, 'unchanged');
    }
    wanted = stamped.value.content;
  } catch (err) {
    warn(`tracker: cannot read the Tracker agent source (${source}) — ${String(err)}`);
    return finish(false, 'unchanged');
  }

  // Already converged — nothing to write, and nothing for the summary to announce.
  // The directory is not created either: an identical file at the target means it is
  // already there (see {@link writeWouldChangeNothing}).
  if (await writeWouldChangeNothing(wanted, target)) {
    return finish(true, 'unchanged');
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await writeFileReplacingLink(target, wanted, links);
  } catch (err) {
    warn(`tracker: failed to install the Tracker agent (${target}) — ${String(err)}`);
    return finish(false, 'unchanged');
  }

  return finish(true, 'installed');
}
