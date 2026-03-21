import type {
  ComponentId,
  ComponentResult,
  GatherContext,
  ComponentFn,
} from './types.js';
import { dim } from './colors.js';

// Import all components
import directory from './components/directory.js';
import gitBranch from './components/git-branch.js';
import gitAheadBehind from './components/git-ahead-behind.js';
import diffStats from './components/diff-stats.js';
import model from './components/model.js';
import contextUsage from './components/context-usage.js';
import versionBadge from './components/version-badge.js';
import sessionDuration from './components/session-duration.js';
import usageQuota from './components/usage-quota.js';
import toolActivity from './components/tool-activity.js';
import agentActivity from './components/agent-activity.js';
import todoProgress from './components/todo-progress.js';
import speed from './components/speed.js';
import configCounts from './components/config-counts.js';

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
  toolActivity,
  agentActivity,
  todoProgress,
  speed,
  configCounts,
};

/**
 * Line groupings for smart layout.
 * Components are assigned to lines and only rendered if enabled.
 */
const LINE_GROUPS: ComponentId[][] = [
  // Line 1: core info
  [
    'directory',
    'gitBranch',
    'gitAheadBehind',
    'diffStats',
    'model',
    'contextUsage',
    'versionBadge',
  ],
  // Line 2: session + quota
  ['sessionDuration', 'usageQuota', 'speed'],
  // Line 3: tool activity
  ['toolActivity'],
  // Line 4: agents + todos + config
  ['agentActivity', 'todoProgress', 'configCounts'],
];

const SEPARATOR = dim('  ');

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

  // Assemble lines using smart layout
  const lines: string[] = [];

  for (const lineGroup of LINE_GROUPS) {
    const lineResults = lineGroup
      .filter((id) => enabled.has(id) && results.has(id))
      .map((id) => results.get(id)!);

    if (lineResults.length > 0) {
      lines.push(lineResults.map((r) => r.text).join(SEPARATOR));
    }
  }

  return lines.join('\n');
}
