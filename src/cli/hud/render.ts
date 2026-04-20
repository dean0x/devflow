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
import sessionCost from './components/session-cost.js';
import releaseInfo from './components/release-info.js';
import worktreeCount from './components/worktree-count.js';
import learningCounts from './components/learning-counts.js';
import notifications from './components/notifications.js';

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
  sessionCost,
  releaseInfo,
  worktreeCount,
  learningCounts,
  notifications,
};

/**
 * Line groupings for smart layout.
 * Components are assigned to lines and only rendered if enabled.
 * null entries denote section breaks (blank line between sections).
 */
const LINE_GROUPS: (ComponentId[] | null)[] = [
  // Section 1: Info (3 lines)
  ['directory', 'gitBranch', 'gitAheadBehind', 'releaseInfo', 'worktreeCount', 'diffStats'],
  ['contextUsage', 'usageQuota'],
  ['model', 'configCounts', 'sessionDuration', 'sessionCost'],
  // --- section break ---
  null,
  // Section 2: Activity
  ['todoProgress'],
  ['learningCounts'],
  ['notifications'],
  ['versionBadge'],
];

const SEPARATOR = dim(' \u00B7 ');

/**
 * Render all enabled components into a multi-line HUD string.
 * Components that return null are excluded. Empty lines are skipped.
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

  // Assemble lines using smart layout with section breaks
  const lines: string[] = [];
  let pendingBreak = false;

  for (const entry of LINE_GROUPS) {
    if (entry === null) {
      if (lines.length > 0) pendingBreak = true;
      continue;
    }

    const lineResults = entry
      .filter((id) => enabled.has(id) && results.has(id))
      .map((id) => results.get(id)!);

    if (lineResults.length > 0) {
      if (pendingBreak) {
        lines.push('');
        pendingBreak = false;
      }
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
