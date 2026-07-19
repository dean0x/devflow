/**
 * Claude Code flag registry.
 *
 * Typed, extensible mechanism for managing Claude Code feature flags.
 * Pure functions: applyFlags, stripFlags, getDefaultFlags — no I/O.
 */

export interface ClaudeCodeFlag {
  id: string;
  label: string;
  description: string;
  hint: string;
  target:
    | { type: 'env'; key: string; value: string }
    | { type: 'setting'; key: string; value: boolean | string };
  defaultEnabled: boolean;
}

export const FLAG_REGISTRY: readonly ClaudeCodeFlag[] = [
  // === Recommended (default ON) ===
  {
    id: 'tui',
    label: 'Fullscreen terminal UI',
    description: 'Flicker-free fullscreen rendering',
    hint: 'Modern fullscreen interface',
    target: { type: 'setting', key: 'tui', value: 'fullscreen' },
    defaultEnabled: true,
  },
  {
    id: 'tool-search',
    label: 'Deferred tool loading',
    description: 'Load tool schemas on demand instead of all at startup',
    hint: 'Faster startup',
    target: { type: 'env', key: 'ENABLE_TOOL_SEARCH', value: 'true' },
    defaultEnabled: true,
  },
  {
    id: 'lsp',
    label: 'LSP support',
    description: 'Enable Language Server Protocol integration',
    hint: 'Code intelligence from your editor',
    target: { type: 'env', key: 'ENABLE_LSP_TOOL', value: 'true' },
    defaultEnabled: true,
  },
  {
    id: 'prompt-caching-1h',
    label: 'Extended prompt cache',
    description: 'Extend prompt cache TTL from 5min to 1h',
    hint: 'Cheaper long sessions',
    target: { type: 'env', key: 'ENABLE_PROMPT_CACHING_1H', value: 'true' },
    defaultEnabled: true,
  },
  {
    id: 'show-turn-duration',
    label: 'Show turn duration',
    description: 'Display timing info after each turn',
    hint: 'See how long each response takes',
    target: { type: 'setting', key: 'showTurnDuration', value: true },
    defaultEnabled: true,
  },
  {
    id: 'clear-context-on-plan',
    label: 'Clear context on plan accept',
    description: 'Clear context window when accepting a plan',
    hint: 'Clean slate after planning',
    target: { type: 'setting', key: 'showClearContextOnPlanAccept', value: true },
    defaultEnabled: true,
  },
  {
    id: 'disable-bundled-skills',
    label: 'Disable bundled skills',
    description: "Remove Claude Code's built-in skills and workflows (devflow provides its own)",
    hint: 'Cleaner skill list',
    target: { type: 'setting', key: 'disableBundledSkills', value: true },
    defaultEnabled: true,
  },
  {
    id: 'pin-sonnet-4-6',
    label: 'Pin Sonnet to 4.6',
    description: 'Pin the default Sonnet model to claude-sonnet-4-6',
    hint: 'Stable, deterministic Sonnet version',
    target: { type: 'env', key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', value: 'claude-sonnet-4-6' },
    defaultEnabled: true,
  },
  // === Optional (default OFF) — skip these if you're unsure ===
  {
    id: 'brief',
    label: 'Brief output mode',
    description: 'Reduce verbosity of Claude Code output',
    hint: 'Shorter responses',
    target: { type: 'env', key: 'CLAUDE_CODE_BRIEF', value: 'true' },
    defaultEnabled: false,
  },
  {
    id: 'thinking-summaries',
    label: 'Thinking summaries',
    description: 'Show thinking summaries during reasoning',
    hint: 'See reasoning previews',
    target: { type: 'setting', key: 'showThinkingSummaries', value: true },
    defaultEnabled: false,
  },
  {
    id: 'subprocess-env-scrub',
    label: 'Subprocess env scrub',
    description: 'Strip cloud credentials from subprocesses',
    hint: 'Security: strip cloud creds from subprocesses',
    target: { type: 'env', key: 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', value: '1' },
    defaultEnabled: false,
  },
  {
    id: 'disable-nonessential-traffic',
    label: 'Disable non-essential traffic',
    description: 'Suppress usage metrics telemetry',
    hint: 'No telemetry',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', value: 'true' },
    defaultEnabled: false,
  },
  {
    id: 'forked-subagents',
    label: 'Forked subagents',
    description: 'Better subagent perf on external builds',
    hint: 'Faster parallel agents (experimental)',
    target: { type: 'env', key: 'CLAUDE_CODE_FORK_SUBAGENT', value: '1' },
    defaultEnabled: false,
  },
  {
    id: 'disable-adaptive-thinking',
    label: 'Disable adaptive thinking',
    description: 'Disable adaptive reasoning on Opus/Sonnet 4.6',
    hint: 'Fixed thinking budget',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING', value: 'true' },
    defaultEnabled: false,
  },
  {
    id: 'always-thinking',
    label: 'Always enable thinking',
    description: 'Enable extended thinking by default',
    hint: 'Thinking on every turn',
    target: { type: 'setting', key: 'alwaysThinkingEnabled', value: true },
    defaultEnabled: false,
  },
  {
    id: 'disable-git-instructions',
    label: 'Disable git instructions',
    description: 'Remove git workflow instructions from system prompt',
    hint: 'Smaller system prompt',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS', value: 'true' },
    defaultEnabled: false,
  },
  // NOTE: DISABLE_COMPACT and DISABLE_AUTOUPDATER intentionally omit the CLAUDE_CODE_ prefix —
  // these names are defined by upstream Claude Code and must match exactly.
  {
    id: 'disable-compact',
    label: 'Disable auto-compaction',
    description: 'Disable automatic context compaction',
    hint: 'Keep full context (uses more tokens)',
    target: { type: 'env', key: 'DISABLE_COMPACT', value: 'true' },
    defaultEnabled: false,
  },
  {
    id: 'disable-1m-context',
    label: 'Disable 1M context window',
    description: 'Use standard context window instead of extended 1M',
    hint: 'Use smaller context window',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_1M_CONTEXT', value: 'true' },
    defaultEnabled: false,
  },
  {
    id: 'disable-autoupdater',
    label: 'Disable auto-updater',
    description: 'Prevent automatic update checks',
    hint: 'No automatic updates',
    target: { type: 'env', key: 'DISABLE_AUTOUPDATER', value: 'true' },
    defaultEnabled: false,
  },
  {
    id: 'agent-teams',
    label: 'Agent Teams (experimental)',
    description: 'Enable Claude Code experimental Agent Teams',
    hint: 'Peer agents / teammate mode — experimental',
    target: { type: 'env', key: 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', value: '1' },
    defaultEnabled: false,
    // Note: the legacy `teammateMode:"auto"` settings key is stripped by
    // src/core/teammate-mode-cleanup.ts during uninstall (stripDevflowTeammateModeFromJson).
    // The env var above is the only surface managed by FLAG_REGISTRY for this flag.
  },
];

/**
 * Return IDs of all flags that are enabled by default.
 */
export function getDefaultFlags(): string[] {
  return FLAG_REGISTRY.filter(f => f.defaultEnabled).map(f => f.id);
}

/**
 * Apply enabled flags to a settings JSON string.
 * Sets env vars for env-type flags and top-level keys for setting-type flags.
 * Ignores unknown flag IDs (forward-compatible with old manifests).
 */
export function applyFlags(settingsJson: string, flagIds: string[]): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  const flagMap = new Map(FLAG_REGISTRY.map(f => [f.id, f]));

  for (const id of flagIds) {
    const flag = flagMap.get(id);
    if (!flag) continue;

    if (flag.target.type === 'env') {
      settings.env ??= {};
      (settings.env as Record<string, string>)[flag.target.key] = flag.target.value;
    } else {
      settings[flag.target.key] = flag.target.value;
    }
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Strip all flag-managed keys from a settings JSON string.
 * Removes env vars and top-level settings controlled by the flag registry.
 * Cleans up empty env object when last entry is removed.
 */
export function stripFlags(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;

  const env = settings.env as Record<string, unknown> | undefined;

  for (const flag of FLAG_REGISTRY) {
    if (flag.target.type === 'env') {
      if (env) {
        delete env[flag.target.key];
      }
    } else {
      delete settings[flag.target.key];
    }
  }

  if (env && Object.keys(env).length === 0) {
    delete settings.env;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

const VIEW_MODE_KEY = 'viewMode';

/** All valid view mode values. Used for validation at manifest read boundaries. */
export const VIEW_MODES = ['default', 'verbose', 'focus'] as const;

/** The viewMode field type — a narrowed union of the three supported modes. */
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * Apply a view mode to a settings JSON string.
 * 'default' removes the viewMode key (Claude Code default behaviour);
 * 'verbose' and 'focus' set the key explicitly.
 */
export function applyViewMode(settingsJson: string, mode: ViewMode): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  if (mode === 'default') {
    delete settings[VIEW_MODE_KEY];
  } else {
    settings[VIEW_MODE_KEY] = mode;
  }
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Strip the viewMode key from a settings JSON string.
 * Used during uninstall / flag strip to restore Claude Code defaults.
 */
export function stripViewMode(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  delete settings[VIEW_MODE_KEY];
  return JSON.stringify(settings, null, 2) + '\n';
}
