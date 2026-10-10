/**
 * Workflow-run segmentation for the token-audit tool: split a main session into runs and
 * attach each subagent to the run that spawned it.
 *
 * A main session is cut at the user's workflow slash commands (`<command-name>` tags) and at
 * `Skill` tool_use events naming a workflow; `/clear` ends the current run and returns to an
 * ad-hoc segment. A subagent is linked to its spawn by `meta.toolUseId` -> the main session's
 * `Agent` tool_use id, else by `meta.parentAgentId` (a nested spawn inherits its parent's run).
 */

import type { CommandMention, SkillCall, SpawnCall } from './parse.js';

/** Workflow commands and skills that open a run. */
export const WORKFLOW_SKILLS: ReadonlySet<string> = new Set([
  'devflow:implement',
  'devflow:plan',
  'devflow:code-review',
  'devflow:resolve',
  'devflow:release',
  'devflow:debug',
  'devflow:dynamic-tickets',
  'devflow:dynamic-build',
  'devflow:dynamic-plan',
  'devflow:self-review',
  'devflow:explore',
]);

export const AD_HOC = 'adhoc';
export const UNATTRIBUTED = 'unattributed';
const CLEAR = 'clear';
/** Longest parentAgentId chain followed when linking a nested subagent. */
const MAX_PARENT_HOPS = 8;

export interface Segment {
  readonly id: string;
  readonly sessionId: string;
  readonly label: string;
  /** Line index in the main transcript where the run starts; -1 for the implicit opening segment. */
  readonly startOrder: number;
}

function segmentOf(sessionId: string, label: string, startOrder: number): Segment {
  return { id: `${sessionId}:${label}@${startOrder}`, sessionId, label, startOrder };
}

/** The segment a subagent lands in when nothing links it to a spawn. */
export function unattributedSegment(sessionId: string): Segment {
  return { id: `${sessionId}:${UNATTRIBUTED}`, sessionId, label: UNATTRIBUTED, startOrder: -1 };
}

/** Ordered segments of one main session; never empty (the first is the ad-hoc segment at -1). */
export type Segments = readonly [Segment, ...Segment[]];

/**
 * Ordered segments of one main session; the first is always the ad-hoc segment starting at -1.
 * Of two boundaries on the same line the later one wins.
 */
export function buildSegments(
  sessionId: string,
  commands: readonly CommandMention[],
  skillCalls: readonly SkillCall[],
): Segments {
  const boundaries: Array<{ readonly order: number; readonly label: string }> = [];
  for (const command of commands) {
    if (command.name === CLEAR) boundaries.push({ order: command.order, label: AD_HOC });
    else if (WORKFLOW_SKILLS.has(command.name)) boundaries.push({ order: command.order, label: command.name });
  }
  for (const call of skillCalls) {
    if (WORKFLOW_SKILLS.has(call.name)) boundaries.push({ order: call.order, label: call.name });
  }
  boundaries.sort((a, b) => a.order - b.order);

  const rest: Segment[] = [];
  for (const boundary of boundaries) {
    const last = rest[rest.length - 1];
    if (last !== undefined && last.startOrder === boundary.order) rest.pop();
    rest.push(segmentOf(sessionId, boundary.label, boundary.order));
  }
  return [segmentOf(sessionId, AD_HOC, -1), ...rest];
}

/** The segment containing line `order`: the last one starting at or before it. */
export function segmentAt(segments: Segments, order: number): Segment {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = segments[mid];
    if (candidate !== undefined && candidate.startOrder <= order) low = mid;
    else high = mid - 1;
  }
  return segments[low] ?? segments[0];
}

export interface SubagentLinkInput {
  readonly agentId: string;
  readonly toolUseId: string | null;
  readonly parentAgentId: string | null;
}

/**
 * Map each subagent id to the segment that spawned it. Joins are Map-based: one pass over the
 * main session's spawns, then one memoised resolution per subagent (a nested subagent follows
 * `parentAgentId`, at most `MAX_PARENT_HOPS` hops, so a cycle cannot loop).
 */
export function linkSubagents(
  sessionId: string,
  segments: Segments,
  spawns: readonly SpawnCall[],
  agents: readonly SubagentLinkInput[],
): ReadonlyMap<string, Segment> {
  const spawnOrder = new Map<string, number>();
  for (const spawn of spawns) {
    if (!spawnOrder.has(spawn.toolUseId)) spawnOrder.set(spawn.toolUseId, spawn.order);
  }
  const byId = new Map<string, SubagentLinkInput>();
  for (const agent of agents) byId.set(agent.agentId, agent);

  const orphan = unattributedSegment(sessionId);
  const resolved = new Map<string, Segment>();

  const resolve = (agentId: string, hops: number): Segment => {
    const memo = resolved.get(agentId);
    if (memo !== undefined) return memo;
    const agent = byId.get(agentId);
    let segment = orphan;
    if (agent !== undefined) {
      const order = agent.toolUseId === null ? undefined : spawnOrder.get(agent.toolUseId);
      if (order !== undefined) {
        segment = segmentAt(segments, order);
      } else if (agent.parentAgentId !== null && hops < MAX_PARENT_HOPS && byId.has(agent.parentAgentId)) {
        segment = resolve(agent.parentAgentId, hops + 1);
      }
    }
    resolved.set(agentId, segment);
    return segment;
  };

  for (const agent of agents) resolve(agent.agentId, 0);
  return resolved;
}
