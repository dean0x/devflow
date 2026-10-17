/**
 * Tracker-server stamp for the installed Git and Tracker agents.
 *
 * D-TRACKER-SERVER-ALLOWLIST: the Git and Tracker agents ship a tool ALLOWLIST (their
 * frontmatter `tools:` line), and the tracker tool servers a user has connected are
 * configured per machine, so the shipped line names none. The installer appends one
 * whole-server entry per configured server (`mcp__<server>`, which grants every tool the
 * server exposes) to the INSTALLED `tools:` line of those two agents, after the file is
 * copied. The list is `manifest.features.tracker.servers`, else TRACKER_MCP_SERVERS_DEFAULT,
 * and `devflow tracker --servers` changes it. Decided here:
 *
 *   - Stamped agents: Git and Tracker, the two that call tracker tools. Code and Research keep a
 *     denylist and so every tool server; Harden and Polish deny them all.
 *   - Where the stamp is written. Every path that writes an installed copy of either agent either
 *     stamps it or carries the stamp it finds:
 *       1. `installViaFileCopy` stamps Git as it writes it (full install and `--plugin` alike);
 *          a `--plugin` run that does not install Git leaves the installed, stamped copy alone.
 *       2. `convergeTrackerArtifacts` stamps Tracker as it writes it, and compares the STAMPED text
 *          with the installed file, so a steady-state run reports `unchanged`.
 *       3. `convergeCurationVariants` (init, `devflow curation --enable/--disable`) carries the
 *          installed stamp onto the variant it writes (`carryStampedTools`), the way it carries
 *          `model:` and `effort:`, so a variant switch keeps the list and a repeat run is byte-equal.
 *       4. `devflow tracker --servers` re-stamps the installed copies at once ({@link restampTrackerAgents}).
 *     `reapplyAgentMapping` and `revertExternalAgents` (`devflow agents`, the proxy, an uninstall's
 *     revert) go through `rewriteAgentFrontmatter`, which manages `model:` and `effort:` only, so
 *     they preserve the line. An agent has no shadow override: only skills and rules do.
 *   - The agent sources stay vendor-neutral. No stamped name appears under src/.
 *   - A name no connected server answers to is inert. The agent then finds no tool for the capability
 *     it needs and reports `TRACEABILITY: DEGRADED (no tracker tool for {capability})`, so a wrong
 *     or missing name is visible and the remedy is `devflow tracker --servers`.
 *
 * Never throws: every failure is a warning, because the install must not die on a stamp.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { stampAgentTools } from '../../core/agent-frontmatter.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import { mdFileName } from '../../core/orphan-sweep.js';
import { trackerServerTools } from '../../core/tracker.js';
import { TRACKER_AGENT_NAME } from './tracker-install.js';

/** The registry name of the Git agent. */
export const GIT_AGENT_NAME = 'git';

/** The installed agents that carry the stamp. */
export const TRACKER_STAMPED_AGENTS: readonly string[] = [GIT_AGENT_NAME, TRACKER_AGENT_NAME];

/** What a re-stamp did to each stamped agent. */
export interface RestampTrackerAgentsResult {
  /** Agents whose installed file was rewritten. */
  readonly rewritten: readonly string[];
  /** Agents whose installed file already held this list. */
  readonly unchanged: readonly string[];
  /** Agents with no installed copy; left absent. */
  readonly absent: readonly string[];
  /** Agents the stamp could not be applied to or written. */
  readonly failed: readonly string[];
}

export interface RestampTrackerAgentsOptions {
  /** Absolute Claude config directory (e.g. ~/.claude). */
  readonly claudeDir: string;
  /** The servers to stamp, already validated. */
  readonly servers: readonly string[];
  readonly warn: (message: string) => void;
}

/** True when `agentName` is an agent that carries the stamp. */
export function isTrackerStampedAgent(agentName: string): boolean {
  return TRACKER_STAMPED_AGENTS.includes(agentName);
}

/**
 * Stamp the installed Git and Tracker agents with `servers`.
 *
 * Rewrites only an installed copy (an absent one stays absent), compares against the bytes on
 * disk at the moment of writing, and writes atomically only when they differ, so a run that
 * changes nothing writes nothing. Never throws.
 */
export async function restampTrackerAgents(opts: RestampTrackerAgentsOptions): Promise<RestampTrackerAgentsResult> {
  const { claudeDir, servers, warn } = opts;
  const rewritten: string[] = [];
  const unchanged: string[] = [];
  const absent: string[] = [];
  const failed: string[] = [];

  // Precondition, asserted in production code: a relative claudeDir would resolve the targets
  // against the working directory.
  if (!path.isAbsolute(claudeDir)) {
    warn(`tracker servers: claudeDir is not an absolute path ("${claudeDir}") — the installed agents were not stamped`);
    return { rewritten, unchanged, absent, failed: [...TRACKER_STAMPED_AGENTS] };
  }

  const tools = trackerServerTools(servers);
  for (const agent of TRACKER_STAMPED_AGENTS) {
    const target = path.join(claudeDir, 'agents', 'devflow', mdFileName(agent));
    let current: string;
    try {
      current = await fs.readFile(target, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        absent.push(agent);
      } else {
        warn(`tracker servers: cannot read ${mdFileName(agent)} (${target}) — ${String(err)}`);
        failed.push(agent);
      }
      continue;
    }

    const stamped = stampAgentTools(current, tools);
    if (!stamped.ok) {
      warn(
        `tracker servers: ${mdFileName(agent)} could not be stamped (${stamped.error}), so it was left as it is. ` +
        'Run `devflow init` to reinstall it.',
      );
      failed.push(agent);
      continue;
    }
    if (!stamped.value.changed) {
      unchanged.push(agent);
      continue;
    }
    try {
      await writeFileAtomicExclusive(target, stamped.value.content);
      rewritten.push(agent);
    } catch (err) {
      warn(`tracker servers: could not rewrite ${mdFileName(agent)} (${target}) — ${String(err)}`);
      failed.push(agent);
    }
  }

  return { rewritten, unchanged, absent, failed };
}
