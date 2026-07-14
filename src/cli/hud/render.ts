import type {
  ComponentId,
  ComponentResult,
  GatherContext,
  ComponentFn,
} from './types.js';
import { dim } from './colors.js';

import directory from './components/directory.js';
import gitBranch from './components/git-branch.js';
import gitAheadBehind from './components/git-ahead-behind.js';
import diffStats from './components/diff-stats.js';
import model from './components/model.js';
import contextUsage from './components/context-usage.js';
import versionBadge from './components/version-badge.js';
import sessionDuration from './components/session-duration.js';
import usageQuota from './components/usage-quota.js';
import todoProgress from './components/todo-progress.js';
import configCounts from './components/config-counts.js';
import decisionsCounts from './components/decisions-counts.js';
import sessionCost from './components/session-cost.js';
import releaseInfo from './components/release-info.js';
import worktreeCount from './components/worktree-count.js';

const COMPONENT_MAP: Record<ComponentId, ComponentFn> = {
  directory,
  gitBranch,
  gitAheadBehind,
  diffStats,
  model,
  contextUsage,
  versionBadge,
  sessionDuration,
  usageQuota,
  todoProgress,
  configCounts,
  decisionsCounts,
  sessionCost,
  releaseInfo,
  worktreeCount,
};

/**
 * Line groupings for smart layout.
 * Components are assigned to lines and only rendered if enabled.
 */
const LINE_GROUPS: ComponentId[][] = [
  ['directory', 'gitBranch', 'gitAheadBehind', 'releaseInfo', 'worktreeCount', 'diffStats'],
  ['contextUsage', 'usageQuota', 'todoProgress'],
  ['model', 'configCounts', 'sessionCost'],
  ['decisionsCounts'],
  ['versionBadge'],
];

const SEPARATOR = dim(' \u00B7 ');

/**
 * Render all enabled components into a multi-line HUD string.
 * Components that return null are excluded. Lines with no rendered
 * components are skipped.
 */
export async function render(ctx: GatherContext): Promise<string> {
  const enabled = new Set(ctx.config.components);

  // Render all enabled components in parallel
  const results = new Map<ComponentId, ComponentResult>();
  const promises: Promise<void>[] = [];

  for (const id of enabled) {
    const fn = COMPONENT_MAP[id];
    if (!fn) continue;
    promises.push(
      fn(ctx)
        .then((result) => {
          if (result) results.set(id, result);
        })
        .catch(() => {
          /* Component failure is non-fatal */
        }),
    );
  }

  await Promise.all(promises);

  // Assemble lines using smart layout
  const lines: string[] = [];

  for (const entry of LINE_GROUPS) {
    const lineResults = entry
      .filter((id) => enabled.has(id) && results.has(id))
      .map((id) => results.get(id)!);

    if (lineResults.length > 0) {
      // Separate multi-line results (containing newlines) from single-line
      const singleLine: string[] = [];
      for (const r of lineResults) {
        if (r.text.includes('\n')) {
          // Flush any accumulated single-line parts first
          if (singleLine.length > 0) {
            lines.push(singleLine.join(SEPARATOR));
            singleLine.length = 0;
          }
          lines.push(r.text);
        } else {
          singleLine.push(r.text);
        }
      }
      if (singleLine.length > 0) {
        lines.push(singleLine.join(SEPARATOR));
      }
    }
  }

  return lines.join('\n');
}
