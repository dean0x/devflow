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
  target:
    | { type: 'env'; key: string; value: string }
    | { type: 'setting'; key: string; value: unknown };
  defaultEnabled: boolean;
}

export const FLAG_REGISTRY: readonly ClaudeCodeFlag[] = [
  {
    id: 'tool-search',
    label: 'Deferred tool loading',
    description: 'Load tool schemas on demand instead of all at startup',
    target: { type: 'env', key: 'ENABLE_TOOL_SEARCH', value: 'true' },
    defaultEnabled: true,
  },
  {
    id: 'lsp',
    label: 'LSP support',
    description: 'Enable Language Server Protocol integration',
    target: { type: 'env', key: 'ENABLE_LSP_TOOL', value: 'true' },
    defaultEnabled: true,
  },
  {
    id: 'clear-context-on-plan',
    label: 'Clear context on plan accept',
    description: 'Clear context window when accepting a plan',
    target: { type: 'setting', key: 'showClearContextOnPlanAccept', value: true },
    defaultEnabled: true,
  },
  {
    id: 'brief',
    label: 'Brief output mode',
    description: 'Reduce verbosity of Claude Code output',
    target: { type: 'env', key: 'CLAUDE_CODE_BRIEF', value: 'true' },
    defaultEnabled: false,
  },
  {
    id: 'disable-1m-context',
    label: 'Disable 1M context window',
    description: 'Use standard context window instead of extended 1M',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_1M_CONTEXT', value: 'true' },
    defaultEnabled: false,
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
