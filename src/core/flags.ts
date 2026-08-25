/**
 * Claude Code flag registry — typed, extensible mechanism for managing
 * Claude Code feature flags and settings.
 *
 * Pure functions: applyFlags, stripFlags, getDefaultFlagsRecord — no I/O.
 *
 * D14: Typed registry — flags carry kind (boolean|enum|number|string), target
 * (env|setting), and per-kind defaultValue. Neutral values delete their target
 * key; active values write the appropriate payload. Number 0 is ACTIVE. Sink
 * validation via coerceFlagValue (applies PF-023: validate at the convergence
 * point every caller reaches). applyFlags(settingsJson, FlagsRecord) is the
 * sole API; init.ts works directly with FlagsRecord (no legacy string[] bridge).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminant for the FlagDef union — determines which per-kind fields are present. */
export type FlagKind = 'boolean' | 'enum' | 'number' | 'string';

/** A concrete flag value (never null). */
export type FlagValue = boolean | number | string;

/**
 * A flag record value: the flag's value or null.
 * null = known + deliberately unset (neutral = delete the target key).
 */
export type FlagsRecordValue = FlagValue | null;

/**
 * The complete flag state record. Keys are flag IDs; values are the current
 * value or null (neutral). Unknown keys are forward-compatible (skipped by
 * applyFlags). Absent keys are NOT the same as null — absent = unknown to
 * this install (adopted on next seed per ADR-014 semantics).
 */
export type FlagsRecord = Record<string, FlagsRecordValue>;

/** Where the flag's value is written in settings.json. */
export type FlagTarget =
  | { readonly type: 'env'; readonly key: string }
  | { readonly type: 'setting'; readonly key: string };

// ── Per-kind interfaces ────────────────────────────────────────────────────────

interface FlagDefCommon {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** One-line what + why hint shown in the UI (keep ≤ ~76 cols). */
  readonly hint: string;
  /** UI partitioning only: true = recommended section; false = optional section. */
  readonly recommended: boolean;
  readonly target: FlagTarget;
}

/** A boolean on/off flag. `onPayload` is written when the flag is enabled. */
export interface BooleanFlagDef extends FlagDefCommon {
  readonly kind: 'boolean';
  /** The value written to the target when the flag is ON. Env targets must use strings. */
  readonly onPayload: string | boolean;
  /** Default value; false = neutral for booleans (key is deleted when false). */
  readonly defaultValue: boolean;
}

/** An enum flag. `neutralValue` is the value that means "no preference" (key is deleted). */
export interface EnumFlagDef extends FlagDefCommon {
  readonly kind: 'enum';
  readonly values: readonly string[];
  readonly valueHints?: Readonly<Partial<Record<string, string>>>;
  /** When set, this value is neutral — applying it removes the target key. */
  readonly neutralValue?: string;
  readonly defaultValue: string | undefined;
}

/** A numeric flag. null = neutral. Number 0 is ACTIVE (not neutral). */
export interface NumberFlagDef extends FlagDefCommon {
  readonly kind: 'number';
  readonly defaultValue: number | undefined;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  /** Upstream default (for informational display). */
  readonly upstreamDefault?: number;
}

/**
 * A string flag. null = neutral.
 * `wrapKey` — if set, the value is written as `{ [wrapKey]: value }` (e.g. spellcheck).
 */
export interface StringFlagDef extends FlagDefCommon {
  readonly kind: 'string';
  readonly defaultValue: string | undefined;
  readonly wrapKey?: string;
  readonly maxLength?: number;
}

/** Discriminated union of all flag types. Discriminant: `kind`. */
export type ClaudeCodeFlag = BooleanFlagDef | EnumFlagDef | NumberFlagDef | StringFlagDef;

// ─── Registry ─────────────────────────────────────────────────────────────────

// Phase 0 probe findings: see docs/reference/claude-code-flags-probe.md

/**
 * Ordered registry of all Claude Code flags managed by devflow.
 *
 * IDs are the stable manifest keys (`features.flags` in the devflow manifest).
 * Array order drives the `--list` table and TUI row order — intentional changes
 * to order are display changes and should be made deliberately.
 *
 * Not every Claude Code env var belongs here. One notable exclusion:
 *   `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` — deliberately
 *   proxy-owned. It is paired with `ANTHROPIC_BASE_URL` in proxy.ts and its
 *   lifecycle is coupled to relay enable/disable; strip is handled by
 *   `stripProxyEnv` (src/cli/commands/proxy.ts). Adding it here would create a
 *   second owner and double-strip it on uninstall. (mirrors agent-teams note)
 */
export const FLAG_REGISTRY: readonly ClaudeCodeFlag[] = [

  // ══ Recommended (default ON) ══════════════════════════════════════════════

  {
    id: 'tui',
    label: 'Fullscreen terminal UI',
    description: 'Flicker-free fullscreen rendering',
    hint: 'Enables fullscreen mode — flicker-free and cursor-stable',
    kind: 'boolean',
    target: { type: 'setting', key: 'tui' },
    onPayload: 'fullscreen',
    recommended: true,
    defaultValue: true,
  },
  {
    id: 'tool-search',
    label: 'Deferred tool loading',
    description: 'Load tool schemas on demand instead of all at startup',
    hint: 'Defers tool schema loading to first use — smaller initial context',
    kind: 'boolean',
    target: { type: 'env', key: 'ENABLE_TOOL_SEARCH' },
    onPayload: 'true',
    recommended: true,
    defaultValue: true,
  },
  {
    id: 'lsp',
    label: 'LSP support',
    description: 'Enable Language Server Protocol integration',
    hint: 'Activates LSP tool so Claude can query your editor code intelligence',
    kind: 'boolean',
    target: { type: 'env', key: 'ENABLE_LSP_TOOL' },
    onPayload: 'true',
    recommended: true,
    defaultValue: true,
  },
  {
    id: 'prompt-caching-1h',
    label: 'Extended prompt cache',
    description: 'Extend prompt cache TTL from 5min to 1h',
    hint: 'Extends cache TTL from 5 min to 1 hr — cheaper long sessions',
    kind: 'boolean',
    target: { type: 'env', key: 'ENABLE_PROMPT_CACHING_1H' },
    onPayload: 'true',
    recommended: true,
    defaultValue: true,
  },
  {
    id: 'show-turn-duration',
    label: 'Show turn duration',
    description: 'Display timing info after each turn',
    hint: 'Shows wall-clock time for each turn — useful for spotting slow paths',
    kind: 'boolean',
    target: { type: 'setting', key: 'showTurnDuration' },
    onPayload: true,
    recommended: true,
    defaultValue: true,
  },
  {
    id: 'clear-context-on-plan',
    label: 'Clear context on plan accept',
    description: 'Clear context window when accepting a plan',
    hint: 'Clears context on plan accept so implementation starts with full budget',
    kind: 'boolean',
    target: { type: 'setting', key: 'showClearContextOnPlanAccept' },
    onPayload: true,
    recommended: true,
    defaultValue: true,
  },
  {
    id: 'disable-bundled-skills',
    label: 'Disable bundled skills',
    description: "Remove Claude Code's built-in skills and workflows (devflow provides its own)",
    hint: "Removes Claude Code's built-in skills — devflow installs its own set",
    kind: 'boolean',
    target: { type: 'setting', key: 'disableBundledSkills' },
    onPayload: true,
    recommended: true,
    defaultValue: true,
  },
  {
    id: 'pin-sonnet-4-6',
    label: 'Pin Sonnet to 4.6',
    description: 'Pin the default Sonnet model to claude-sonnet-4-6',
    hint: 'Pins Sonnet to 4.6 — stable, deterministic alias across model updates',
    kind: 'boolean',
    target: { type: 'env', key: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
    onPayload: 'claude-sonnet-4-6',
    recommended: true,
    defaultValue: true,
  },
  {
    // Devflow fan-outs routinely exceed the upstream default of 20.
    // Set to 40 by default so parallel Code/Review/Research waves don't
    // silently queue. upstreamDefault recorded for display. (applies PF-023 bounds)
    id: 'max-concurrent-subagents',
    label: 'Max concurrent subagents',
    description: 'Maximum number of subagents Claude Code will spawn concurrently',
    hint: 'Sets concurrent subagent cap; upstream default is 20 — devflow uses 40',
    kind: 'number',
    target: { type: 'env', key: 'CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS' },
    recommended: true,
    defaultValue: 40,
    min: 1,
    max: 100,         // devflow sanity bound (applies PF-023)
    integer: true,
    upstreamDefault: 20,
  },

  // ══ Optional (default OFF) — skip these if you're unsure ══════════════════

  {
    id: 'brief',
    label: 'Brief output mode',
    description: 'Reduce verbosity of Claude Code output',
    hint: 'Reduces output verbosity — shorter responses, less explanation',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_BRIEF' },
    onPayload: 'true',
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'thinking-summaries',
    label: 'Thinking summaries',
    description: 'Show thinking summaries during reasoning',
    hint: 'Surfaces condensed reasoning previews during extended thinking',
    kind: 'boolean',
    target: { type: 'setting', key: 'showThinkingSummaries' },
    onPayload: true,
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'subprocess-env-scrub',
    label: 'Subprocess env scrub',
    description: 'Strip cloud credentials from subprocesses',
    hint: 'Strips cloud credentials (AWS, GCP, Azure) from subprocess env',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB' },
    onPayload: '1',
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'disable-nonessential-traffic',
    label: 'Disable non-essential traffic',
    description: 'Suppress usage metrics telemetry',
    hint: 'Suppresses usage telemetry sent back to Anthropic',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' },
    onPayload: 'true',
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'forked-subagents',
    label: 'Forked subagents',
    description: 'Better subagent perf on external builds',
    hint: 'Enables forked subagent model — faster parallel agents (experimental)',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_FORK_SUBAGENT' },
    onPayload: '1',
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'disable-adaptive-thinking',
    label: 'Disable adaptive thinking',
    description: 'Disable adaptive reasoning on Opus/Sonnet 4.6',
    hint: 'Disables adaptive thinking budget — fixes compute per turn',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING' },
    onPayload: 'true',
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'always-thinking',
    label: 'Always enable thinking',
    description: 'Enable extended thinking by default',
    hint: 'Forces extended thinking on every turn, including non-complex ones',
    kind: 'boolean',
    target: { type: 'setting', key: 'alwaysThinkingEnabled' },
    onPayload: true,
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'disable-git-instructions',
    label: 'Disable git instructions',
    description: 'Remove git workflow instructions from system prompt',
    hint: 'Removes git workflow from system prompt — saves tokens in each turn',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS' },
    onPayload: 'true',
    recommended: false,
    defaultValue: false,
  },
  // NOTE: DISABLE_COMPACT and DISABLE_AUTOUPDATER intentionally omit the CLAUDE_CODE_ prefix —
  // these names are defined by upstream Claude Code and must match exactly.
  {
    id: 'disable-compact',
    label: 'Disable auto-compaction',
    description: 'Disable automatic context compaction',
    hint: 'Disables auto-compaction — retains full context at the cost of more tokens',
    kind: 'boolean',
    target: { type: 'env', key: 'DISABLE_COMPACT' },
    onPayload: 'true',
    recommended: false,
    defaultValue: false,
  },
  {
    // v2.1.223 semantics: disables the 1M-token context window experiment and
    // falls back to the standard context budget for the model.
    id: 'disable-1m-context',
    label: 'Disable 1M context window',
    description: 'Disable the 1M-token context window experiment (v2.1.223+)',
    hint: 'Opts out of the 1M context experiment — uses standard context budget',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_DISABLE_1M_CONTEXT' },
    onPayload: 'true',
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'disable-autoupdater',
    label: 'Disable auto-updater',
    description: 'Prevent automatic update checks',
    hint: 'Prevents automatic update checks — manage updates manually',
    kind: 'boolean',
    target: { type: 'env', key: 'DISABLE_AUTOUPDATER' },
    onPayload: 'true',
    recommended: false,
    defaultValue: false,
  },
  {
    id: 'agent-teams',
    label: 'Agent Teams (experimental)',
    description: 'Enable Claude Code experimental Agent Teams',
    hint: 'Enables peer-agent teammate mode — experimental, may change any release',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS' },
    onPayload: '1',
    recommended: false,
    defaultValue: false,
    // Note: the legacy `teammateMode:"auto"` settings key is stripped by
    // src/core/teammate-mode-cleanup.ts during uninstall (stripDevflowTeammateModeFromJson).
    // The env var above is the only surface managed by FLAG_REGISTRY for this flag.
  },

  {
    // Upstream: restores Todo/TaskCreate tools removed by default in Opus 4.8+,
    // Sonnet 5+, and Fable 5+. Set to '1' to re-enable.
    id: 'enable-todo-tools',
    label: 'Enable todo/task tools',
    description: 'Restore Todo and TaskCreate tools removed by default in newer models',
    hint: 'Re-enables Todo/TaskCreate tools on Opus 4.8+ / Sonnet 5+ / Fable 5+',
    kind: 'boolean',
    target: { type: 'env', key: 'CLAUDE_CODE_ENABLE_TODO_TOOLS' },
    onPayload: '1',
    recommended: false,
    defaultValue: false,
  },

  // ── Valued flags (number/enum/string) ────────────────────────────────────

  {
    // Domain: unset by default; set only when users want a non-default spawn depth.
    // upstreamDefault: 3 (recorded for display). PF-023 bounds: max 10.
    id: 'subagent-spawn-depth',
    label: 'Max subagent spawn depth',
    description: 'Maximum depth of nested subagent spawning',
    hint: 'Caps nested spawn depth; upstream default is 3 — raise only when needed',
    kind: 'number',
    target: { type: 'env', key: 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH' },
    recommended: false,
    defaultValue: undefined,
    min: 1,
    max: 10,          // devflow sanity bound (applies PF-023)
    integer: true,
    upstreamDefault: 3,
  },
  {
    // Phase 0: domain verified small|medium|large|unrestricted from binary
    // (4-value cluster at adjacent string offsets, adjacent to Workflows feature text).
    id: 'workflow-size-guideline',
    label: 'Workflow size guideline',
    description: 'Guide Claude on the expected size of workflow plans',
    hint: 'Hints preferred plan scale: small/medium/large/unrestricted',
    kind: 'enum',
    target: { type: 'setting', key: 'workflowSizeGuideline' },
    values: ['small', 'medium', 'large', 'unrestricted'],
    recommended: false,
    defaultValue: undefined,
  },
  {
    id: 'default-model',
    label: 'Default model',
    description: 'Override the default model for Claude Code',
    hint: 'Sets ANTHROPIC_DEFAULT_MODEL — overrides session-level model selection',
    kind: 'string',
    target: { type: 'env', key: 'ANTHROPIC_DEFAULT_MODEL' },
    recommended: false,
    defaultValue: undefined,
    maxLength: 64,
  },
  {
    // Upstream default: 30 min. 0 = disabled (still ACTIVE — written to env).
    // PF-023 bounds: max 1440 (24h). min 0 (0 = off, explicit value not neutral).
    id: 'goal-checkin-minutes',
    label: 'Goal check-in interval',
    description: 'Interval in minutes for Claude to check in on task goals',
    hint: 'Periodic goal check-ins every N min; 0 = off; upstream default is 30',
    kind: 'number',
    target: { type: 'env', key: 'CLAUDE_CODE_GOAL_CHECKIN_MINUTES' },
    recommended: false,
    defaultValue: undefined,
    min: 0,           // 0 = off (ACTIVE, not neutral — written as "0")
    max: 1440,        // devflow sanity bound: 24 hours (applies PF-023)
    integer: true,
    upstreamDefault: 30,
  },
  {
    // Writes as { command: value } per Claude Code spellcheck setting shape.
    id: 'spellcheck',
    label: 'Spellcheck command',
    description: 'Custom spellcheck command for Claude Code',
    hint: 'Sets the external spell-check command (written as {command: ...})',
    kind: 'string',
    target: { type: 'setting', key: 'spellcheck' },
    recommended: false,
    defaultValue: undefined,
    wrapKey: 'command',
    maxLength: 256,   // devflow sanity bound (applies PF-023)
  },
  {
    // view-mode folded into the registry; neutralValue 'default' deletes the viewMode key.
    // VIEW_MODES, ViewMode, resolveExistingViewMode, and resolveFinalViewMode remain exported
    // for init.ts and other callers that read/resolve view-mode in the settings pipeline.
    id: 'view-mode',
    label: 'View mode',
    description: 'Interface view mode (default / verbose / focus)',
    hint: "Controls view mode; 'default' removes the key (Claude Code native default)",
    kind: 'enum',
    target: { type: 'setting', key: 'viewMode' },
    values: ['default', 'verbose', 'focus'],
    valueHints: {
      default: 'Standard view (no override)',
      verbose: 'Show all tool output and reasoning',
      focus: 'Minimal UI — hides secondary panels',
    },
    neutralValue: 'default',
    recommended: false,
    defaultValue: 'default',
  },
];

// Pre-built lookup for O(1) flag-by-id access.
const FLAG_REGISTRY_MAP = new Map<string, ClaudeCodeFlag>(
  FLAG_REGISTRY.map(f => [f.id, f]),
);

/**
 * O(1) flag lookup backed by FLAG_REGISTRY_MAP.
 * Returns undefined when the id is not in the registry.
 */
export function findFlag(id: string): ClaudeCodeFlag | undefined {
  return FLAG_REGISTRY_MAP.get(id);
}

// ─── Core value helpers ───────────────────────────────────────────────────────

/**
 * Returns the neutral value for a flag — the value that means "no preference"
 * (applying neutral deletes the target key).
 *
 * - boolean: false (false = off = no key written)
 * - enum: neutralValue if defined, else null
 * - number: null (no number, including 0, is neutral — 0 is ACTIVE)
 * - string: null
 */
export function neutralValueOf(flag: ClaudeCodeFlag): FlagsRecordValue {
  switch (flag.kind) {
    case 'boolean': return false;
    case 'enum': return flag.neutralValue ?? null;
    case 'number': return null;
    case 'string': return null;
  }
}

/**
 * Returns true when `value` is the neutral value for `flag`.
 * null is always neutral. Number 0 is NOT neutral.
 */
export function isNeutral(flag: ClaudeCodeFlag, value: FlagsRecordValue): boolean {
  if (value === null) return true;
  return value === neutralValueOf(flag);
}

/**
 * Map a record value to a TUI value.
 *
 * viewMode GLUE RULE (PF-017 one-shared-definition corollary): the mapping lives here,
 * next to neutralValueOf — the definition it depends on — not across a module boundary.
 *   enum with neutralValue: neutralValue → null in TUI (null is the TUI representation
 *   of "use the default"; the key is deleted when persisted).
 * All other values pass through unchanged.
 *
 * Consumers: flags-view/state.ts (buildFlagRows, buildDevflowDefault, collectFlagRecord).
 */
export function recordToTui(flag: ClaudeCodeFlag, v: FlagsRecordValue): FlagsRecordValue {
  if (v === null) return null;
  if (flag.kind === 'enum' && flag.neutralValue !== undefined) {
    if (v === flag.neutralValue) return null;
  }
  return v;
}

/**
 * Map a TUI value back to a record value.
 *
 * viewMode GLUE RULE (PF-017 one-shared-definition corollary): inverse of recordToTui,
 * co-located with that function so the round-trip contract is auditable in one place.
 *   enum with neutralValue: null → neutralValue (e.g. 'default').
 * All other values pass through unchanged.
 *
 * Consumers: flags-view/state.ts (collectFlagRecord).
 */
export function tuiToRecord(flag: ClaudeCodeFlag, v: FlagsRecordValue): FlagsRecordValue {
  if (v === null && flag.kind === 'enum' && flag.neutralValue !== undefined) {
    return flag.neutralValue;
  }
  return v;
}

/**
 * Validate and coerce `raw` to a safe value for `flag` at the sink.
 * Returns null when the value is invalid (hostile-value defence — applies PF-023).
 *
 * Number invariants: finite, within [min, max], integer when required.
 * String invariants: within maxLength, no control characters.
 * Enum invariants: value must be in the declared values array.
 * Boolean invariants: must be a boolean.
 */
export function coerceFlagValue(flag: ClaudeCodeFlag, raw: unknown): FlagsRecordValue {
  if (raw === null || raw === undefined) return null;

  switch (flag.kind) {
    case 'boolean': {
      if (typeof raw !== 'boolean') return null;
      return raw;
    }
    case 'enum': {
      if (typeof raw !== 'string') return null;
      if (!(flag.values as readonly string[]).includes(raw)) return null;
      return raw;
    }
    case 'number': {
      if (typeof raw !== 'number') return null;
      if (!Number.isFinite(raw)) return null; // rejects Infinity, NaN, 1e309
      if (flag.min !== undefined && raw < flag.min) return null;
      if (flag.max !== undefined && raw > flag.max) return null;
      if (flag.integer === true && !Number.isInteger(raw)) return null;
      return raw;
    }
    case 'string': {
      if (typeof raw !== 'string') return null;
      // Empty string is UNSET, never an active value — caller should pass null for unset.
      if (raw === '') return null;
      if (flag.maxLength !== undefined && raw.length > flag.maxLength) return null;
      // Reject ASCII control chars except \t (horizontal tab is benign in commands).
      // LF (\x0a) MUST be rejected: `spellcheck` is executed as a shell command, where
      // a newline is a statement separator, and the --status table is line-oriented.
      // The range \x0a-\x1f covers LF through US, with \x09 (TAB) as the sole omission.
      if (/[\x00-\x08\x0a-\x1f\x7f]/.test(raw)) return null;
      return raw;
    }
  }
}

/**
 * Parse a CLI text input to a FlagsRecordValue.
 * 'unset' (literal) → null for any flag.
 *
 * Number branch uses strict decimal grammar (applies PF-023 — invariant at the sink
 * every caller reaches, not per-caller): rejects empty, padded, hex, exponent,
 * and leading-zero forms. Equivalent to the TUI's strict parsing so both entry
 * points share one grammar.
 *
 * String branch: empty string → null (empty is UNSET, not an active value).
 */
export function parseFlagValueInput(flag: ClaudeCodeFlag, text: string): FlagsRecordValue {
  if (text === 'unset') return null;
  switch (flag.kind) {
    case 'boolean': {
      if (text === 'true') return true;
      if (text === 'false') return false;
      return null;
    }
    case 'enum':
      return coerceFlagValue(flag, text);
    case 'number': {
      // Strict decimal grammar: reject empty, padded, hex, exponent, and leading zeros.
      // Number('') === 0, Number(' 3 ') === 3, Number('0x5') === 5, Number('1e1') === 10 —
      // all would pass bare Number() but violate the strict grammar contract.
      if (text === '' || text !== text.trim()) return null;
      if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
      return coerceFlagValue(flag, Number(text));
    }
    case 'string':
      // Empty string → null (empty is UNSET); coerceFlagValue handles the rest.
      return coerceFlagValue(flag, text);
  }
}

/**
 * Returns a human-readable kind label for a flag — used by --list output.
 *
 * Exhaustive switch (no default): TypeScript narrows on `flag.kind` so the
 * per-kind casts that appeared in the previous nested ternary at the call
 * site are unnecessary here; each branch sees the narrowed subtype directly.
 *
 * Output examples:
 *   boolean                      → 'boolean'
 *   enum [small|medium|large|…]  → 'enum [small|medium|large|…]'
 *   number min=1 max=100 integer → 'number min=1 max=100 integer'
 *   string maxLen=64             → 'string maxLen=64'
 */
export function describeFlagKind(flag: ClaudeCodeFlag): string {
  switch (flag.kind) {
    case 'boolean':
      return 'boolean';
    case 'enum':
      return `enum [${flag.values.join('|')}]`;
    case 'number': {
      const parts: string[] = [];
      if (flag.min !== undefined) parts.push(`min=${flag.min}`);
      if (flag.max !== undefined) parts.push(`max=${flag.max}`);
      if (flag.integer) parts.push('integer');
      return `number${parts.length ? ' ' + parts.join(' ') : ''}`;
    }
    case 'string':
      return `string${flag.maxLength !== undefined ? ` maxLen=${flag.maxLength}` : ''}`;
  }
}

/**
 * Returns the expected-input hint shown by --set when a value is invalid.
 *
 * Exhaustive switch — per-kind casts from the former triple-nested ternary
 * in flags.ts are gone; TypeScript narrows each arm directly.
 *
 * Output examples:
 *   boolean → 'true|false|unset'
 *   enum    → 'small|medium|large|unrestricted|unset'
 *   number  → 'a valid number value or unset'
 *   string  → 'a valid string value or unset'
 */
export function expectedInputFor(flag: ClaudeCodeFlag): string {
  switch (flag.kind) {
    case 'boolean':
      return 'true|false|unset';
    case 'enum':
      return `${flag.values.join('|')}|unset`;
    case 'number':
      return 'a valid number value or unset';
    case 'string':
      return 'a valid string value or unset';
  }
}

/**
 * Format a flag value for display.
 *
 * Vocabulary (applies ADR-016 — one syntax, one semantic):
 *   boolean true  → 'enabled'
 *   boolean false → 'disabled'  (not 'unset' — false is a deliberate-off, not unset)
 *   null / neutral → 'unset'
 *   other active values → their string representation
 *
 * Boolean branch must win before isNeutral so that false yields 'disabled',
 * not 'unset' (isNeutral treats false as neutral for booleans).
 */
export function formatFlagValue(flag: ClaudeCodeFlag, value: FlagsRecordValue): string {
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled';
  if (value === null || isNeutral(flag, value)) return 'unset';
  return String(value);
}

/**
 * Count flags in `record` that have active (non-neutral) values.
 * Unknown IDs are counted if their value is truthy.
 */
export function countActiveFlags(record: FlagsRecord): number {
  let count = 0;
  for (const [id, value] of Object.entries(record)) {
    if (value === null) continue;
    const flag = FLAG_REGISTRY_MAP.get(id);
    if (flag) {
      if (!isNeutral(flag, value)) count++;
    } else if (value) {
      // Unknown flag ID: count if truthy
      count++;
    }
  }
  return count;
}

/**
 * Read the view-mode from a FlagsRecord.
 * Returns 'default' when the entry is absent, null, or unrecognised.
 */
export function readViewMode(record: FlagsRecord): ViewMode {
  const v = record['view-mode'];
  if (typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v)) {
    return v as ViewMode;
  }
  return 'default';
}

/**
 * Sanitize a FlagsRecord by coercing each known flag's value through
 * coerceFlagValue.
 *
 * Known flag IDs (applies ADR-014 key-presence semantics):
 *   - explicit null input → kept as null (deliberately unset)
 *   - valid non-null input → kept as coerced value
 *   - invalid non-null input → KEY DROPPED (absent = adopt default on next init,
 *     which is safer than writing null = "deliberately unset" for a corrupt value)
 *
 * Unknown flag IDs (forward-compat):
 *   - primitive values (boolean, number, string, null) → kept as-is
 *   - non-primitive values (objects, arrays) → DROPPED to avoid laundering
 *     untrusted shapes into FlagsRecordValue (applies PF-023)
 *
 * D39: `__proto__`, `constructor`, `prototype` are always skipped.
 */
export function sanitizeFlagsRecord(record: FlagsRecord): FlagsRecord {
  const result: FlagsRecord = {};
  for (const [id, value] of Object.entries(record)) {
    // D39: prototype pollution guard — skip dangerous own-property names that
    // would invoke [[Set]] accessors on the result object and mutate its prototype.
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
    const flag = FLAG_REGISTRY_MAP.get(id);
    if (flag) {
      if (value === null) {
        // Explicit null = deliberately unset: preserve key-presence semantics.
        result[id] = null;
      } else {
        const coerced = coerceFlagValue(flag, value);
        if (coerced !== null) {
          result[id] = coerced;
        }
        // else: invalid non-null value → DROP the key so the flag is re-adopted
        // on next init from registry defaults (safer than writing null = "unset").
      }
    } else {
      // Unknown id: forward-compat pass-through for primitive/null values only.
      // Non-primitive values (objects, arrays) are dropped — laundering an
      // arbitrary object into FlagsRecordValue violates the type contract.
      if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        result[id] = value;
      }
    }
  }
  return result;
}

// ─── Record builders ──────────────────────────────────────────────────────────

/**
 * Per-kind default-value rule (single authoritative source — CONS-M2).
 *
 * - boolean: flag.defaultValue (always a boolean — never collapses to null)
 * - enum / number / string: flag.defaultValue ?? null
 *   (undefined defaultValue → null = adopt-on-next-init semantics)
 *
 * Call sites: getDefaultFlagsRecord, resolveSeedFlags (init-seed.ts),
 * buildDevflowDefault (flags-view/state.ts). Adding a fifth kind or changing
 * the null-collapse rule requires updating only this function.
 */
export function defaultValueOf(flag: ClaudeCodeFlag): FlagsRecordValue {
  return flag.kind === 'boolean' ? flag.defaultValue : (flag.defaultValue ?? null);
}

/**
 * Return a FlagsRecord with every registered flag set to its defaultValue.
 * Flags with undefined defaultValue get null.
 * This record has an entry for EVERY flag — use it for initial seeding.
 */
export function getDefaultFlagsRecord(): FlagsRecord {
  return Object.fromEntries(FLAG_REGISTRY.map(f => [f.id, defaultValueOf(f)]));
}

// ─── Migration helper ─────────────────────────────────────────────────────────

/**
 * Migrate a legacy (string-array) enabled-flags manifest to a typed FlagsRecord.
 * Called by manifest.ts self-healing when it encounters an old string-array manifest.
 *
 * Contract (applies ADR-014 transition semantics):
 * - knownIds defined   → knownSet = knownIds ∪ enabledIds
 * - knownIds undefined → knownSet = full current registry ∪ enabledIds
 *   (pre-knownFlags manifests: all flags known, so adopt-nothing is expressed
 *   as value = enabledIds.includes(id) rather than absent entry)
 * - Boolean registry flags in knownSet → value = enabledIds.includes(id)
 * - Registry flags NOT in knownSet → NO entry (adopted on next seed)
 * - Unknown enabled IDs (not in registry) → `true` preserved
 * - viewMode fold: 'view-mode' = legacyViewMode ?? 'default'
 */
export function migrateLegacyFlagsToRecord(
  enabledIds: string[],
  knownIds?: string[],
  legacyViewMode?: ViewMode,
): FlagsRecord {
  const enabledSet = new Set(enabledIds);

  const knownSet: Set<string> =
    knownIds !== undefined
      ? new Set([...knownIds, ...enabledIds])
      : new Set([...FLAG_REGISTRY.map(f => f.id), ...enabledIds]);

  const result: FlagsRecord = {};

  for (const flag of FLAG_REGISTRY) {
    // view-mode is handled separately at the end
    if (flag.id === 'view-mode') continue;

    if (!knownSet.has(flag.id)) {
      // Not known at last install → NO entry (will be adopted on next seed)
      continue;
    }

    if (flag.kind === 'boolean') {
      result[flag.id] = enabledSet.has(flag.id);
    } else {
      // Valued flags: legacy string arrays never contain them; null = neutral
      result[flag.id] = null;
    }
  }

  // Unknown enabled IDs (not in any registry) preserved as true
  for (const id of enabledIds) {
    if (!FLAG_REGISTRY_MAP.has(id)) {
      result[id] = true;
    }
  }

  // viewMode fold: always written so the view-mode entry is explicit
  result['view-mode'] = legacyViewMode ?? 'default';

  return result;
}

// ─── Apply / Strip ────────────────────────────────────────────────────────────

/**
 * Return `v` as a `Record<string, unknown>` only when it is a plain object.
 * Returns undefined for arrays, null, or non-objects.
 *
 * Used as a guard at every `settings.env` access point so that a malformed
 * `"env": []` in settings.json cannot cause `Object.keys([]).length === 0`
 * to delete the entire env key, losing user-set env vars (applies TS-M3).
 */
function asPlainObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Compute the value to write to settings.json for an active flag. */
function buildPayload(flag: ClaudeCodeFlag, value: FlagValue): unknown {
  switch (flag.kind) {
    case 'boolean':
      return flag.onPayload;
    case 'enum':
      return value as string;
    case 'number':
      // Env targets receive string values; setting targets receive numbers.
      return flag.target.type === 'env' ? String(value as number) : value;
    case 'string': {
      const s = value as string;
      return flag.wrapKey ? { [flag.wrapKey]: s } : s;
    }
  }
}

/**
 * Apply a FlagsRecord to a settings JSON string.
 *
 * - Unknown flag IDs are skipped (forward-compatible with future flags).
 * - `coerceFlagValue` is called at the sink before applying (applies PF-023).
 * - Neutral values delete their target key.
 * - Env payloads for number flags are stringified ('40', never 40).
 * - Setting payloads for string flags with wrapKey are shaped ({ command: v }).
 * - env object is created on demand; deleted when it becomes empty.
 * - `__proto__`, `constructor`, `prototype` keys are silently skipped.
 */
export function applyFlags(settingsJson: string, flags: FlagsRecord): string {
  // REL-M2 sink guard (applies PF-023): a non-plain-object root (null, array, scalar)
  // would cause a silent no-op or a confusing TypeError deep inside the loop.
  // Throw early with a clear message so every caller path is self-guarding.
  const root = JSON.parse(settingsJson);
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('applyFlags: settings.json root must be a plain object');
  }
  const settings = root as Record<string, unknown>;

  for (const [id, value] of Object.entries(flags)) {
    // Prototype pollution guard
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;

    const flag = FLAG_REGISTRY_MAP.get(id);
    if (!flag) continue; // unknown id — skip for forward compat

    // Coerce at the sink (applies PF-023: validate at the convergence point)
    const safe = coerceFlagValue(flag, value);

    if (isNeutral(flag, safe)) {
      // Neutral → delete the target key
      if (flag.target.type === 'env') {
        // asPlainObject guard: "env": [] must not delete a user's env var (applies TS-M3)
        const env = asPlainObject(settings.env);
        if (env) delete env[flag.target.key];
      } else {
        delete settings[flag.target.key];
      }
    } else {
      const payload = buildPayload(flag, safe as FlagValue);
      if (flag.target.type === 'env') {
        if (!asPlainObject(settings.env)) {
          settings.env = {};
        }
        (settings.env as Record<string, unknown>)[flag.target.key] = payload;
      } else {
        settings[flag.target.key] = payload;
      }
    }
  }

  // Clean up empty env object; asPlainObject guard avoids matching "env": []
  const env = asPlainObject(settings.env);
  if (env && Object.keys(env).length === 0) {
    delete settings.env;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Strip all flag-managed keys from a settings JSON string.
 * Registry-driven unconditional delete. Now covers viewMode (via view-mode
 * registry entry) and object-valued settings (spellcheck → key deleted).
 * Cleans up empty env object. Strip-then-apply idempotence preserved (INV-1).
 */
export function stripFlags(settingsJson: string): string {
  // REL-M2 sink guard (applies PF-023): mirror of applyFlags — throw early on a
  // non-plain-object root so every caller path is self-guarding.
  const root = JSON.parse(settingsJson);
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('stripFlags: settings.json root must be a plain object');
  }
  const settings = root as Record<string, unknown>;
  // asPlainObject guard: "env": [] must not have its keys iterated as an object (applies TS-M3)
  const env = asPlainObject(settings.env);

  for (const flag of FLAG_REGISTRY) {
    if (flag.target.type === 'env') {
      if (env) delete env[flag.target.key];
    } else {
      delete settings[flag.target.key];
    }
  }

  if (env && Object.keys(env).length === 0) {
    delete settings.env;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

// ─── viewMode helpers ─────────────────────────────────────────────────────────

const VIEW_MODE_KEY = 'viewMode';

/** All valid view mode values. Used for validation at manifest read boundaries. */
export const VIEW_MODES = ['default', 'verbose', 'focus'] as const;

/** The viewMode field type — a narrowed union of the three supported modes. */
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * Extract the non-default view mode from a settings JSON string.
 *
 * Returns the persisted ViewMode when it is a recognised non-default value
 * ('focus' or 'verbose'), so callers can chain with ?? to fall through to
 * a manifest value or the 'default' literal:
 *
 *   viewMode = resolveExistingViewMode(snapshot) ?? manifest?.features.viewMode ?? 'default'
 *
 * Returns undefined when:
 *   - JSON is malformed
 *   - the viewMode key is absent
 *   - viewMode is 'default' (no meaningful override to preserve)
 *   - viewMode is an unrecognised string
 */
export function resolveExistingViewMode(settingsJson: string): ViewMode | undefined {
  try {
    const parsed: unknown = JSON.parse(settingsJson);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const existing = (parsed as Record<string, unknown>)[VIEW_MODE_KEY];
      if (
        typeof existing === 'string' &&
        (VIEW_MODES as readonly string[]).includes(existing) &&
        existing !== 'default'
      ) {
        return existing as ViewMode;
      }
    }
  } catch { /* malformed settings.json — treat as no opinion */ }
  return undefined;
}

/**
 * Resolve the final view mode to write, combining an existing settings value,
 * an init-prompt-selected value, and whether the selection was explicit.
 *
 * Rules:
 *   1. explicit ⇒ selected wins (user intent is unambiguous, even 'default')
 *   2. non-default current ⇒ current wins (preserve externally-set mode)
 *   3. else ⇒ selected
 */
export function resolveFinalViewMode(
  current: ViewMode | undefined,
  selected: ViewMode,
  explicit: boolean,
): ViewMode {
  if (explicit) return selected;
  if (current !== undefined && current !== 'default') return current;
  return selected;
}

// ─── Fold-before-strip pipeline ───────────────────────────────────────────────

/**
 * Fold-before-strip pipeline — the single authoritative entry point for all
 * settings.json mutation paths (applies PF-015, PF-017, ADR-014).
 *
 * Both `init.ts` and `persistFlagConfig` (flags.ts) MUST call this instead of
 * invoking `stripFlags` + `applyFlags` directly; the invariant lives in the
 * pipeline, not at call sites.
 *
 * Fold semantics (D15-adopt):
 *
 *   view-mode (Step 1): resolved via `resolveFinalViewMode` so an externally-set
 *   `/focus` survives unless `viewModeExplicit` is true.
 *
 *   Valued flags — enum/number/string, excluding view-mode (Step 2):
 *   The "claimed" set is determined by `opts.ownedRecord`:
 *     - `undefined`  → use `record` itself (persistFlagConfig path — the manifest
 *                      record IS what devflow claims)
 *     - `null`       → nothing previously owned (fresh install)
 *     - `FlagsRecord`→ the original manifest flags BEFORE seeding (init path)
 *
 *   A flag is "claimed" when it is present and non-null in the claimed set.
 *   Claimed: record value wins (devflow previously set this value).
 *   Unclaimed: fold from settings — if the user has a value in settings.json,
 *   adopt it into the record (ADR-014 adoption, devflow takes ownership).
 *
 *   Boolean flags: never folded — on/off is always record-driven.
 *
 * The fold MUST run on pre-strip content — `stripFlags` removes the target
 * keys, making any fold after strip vacuous.
 *
 * Uninstall note: `src/cli/commands/uninstall.ts` calls `stripFlags` directly
 * with no record argument, preserving its full-sweep semantics. Do not change.
 *
 * Pure function: no I/O.
 *
 * @param settingsJson    Current settings.json content (pre-strip)
 * @param record          FlagsRecord to fold into and apply
 * @param opts.viewModeExplicit  true when the caller explicitly selected a view
 *                        mode (TUI row changed or `--set view-mode=...` passed)
 * @param opts.ownedRecord  Prior ownership set; see semantics above.
 *                        Init path: `existingManifest?.features.flags ?? null`.
 *                        persistFlagConfig path: omit (undefined).
 * @returns `{ settings: updated JSON string, record: folded FlagsRecord }`
 */
export function convergeFlagsIntoSettings(
  settingsJson: string,
  record: FlagsRecord,
  opts: {
    viewModeExplicit: boolean;
    ownedRecord?: FlagsRecord | null;
  },
): { settings: string; record: FlagsRecord } {
  // ── Step 1: fold view-mode (must read pre-strip) ──────────────────────────
  // PF-015: resolveExistingViewMode reads the viewMode key. stripFlags removes
  // it as part of the view-mode registry entry. Reading after strip silently
  // reverts an externally-set /focus.
  const folded: FlagsRecord = {
    ...record,
    'view-mode': resolveFinalViewMode(
      resolveExistingViewMode(settingsJson),
      readViewMode(record),
      opts.viewModeExplicit,
    ),
  };

  // ── Step 2: fold existing values for valued flags (pre-strip) ────────────
  // D15-adopt: for unclaimed valued flags, read the current settings value and
  // adopt it into the record. Claimed flags (previously set by devflow) keep
  // their record value; boolean flags are never folded.
  //
  // "Claimed" is determined by opts.ownedRecord:
  //   undefined → use `record` (persistFlagConfig: manifest record = owned set)
  //   null      → nothing claimed (fresh install)
  //   FlagsRecord → original manifest flags before seeding (init path)
  const claimedIn: FlagsRecord | null =
    opts.ownedRecord !== undefined ? opts.ownedRecord : record;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const env = asPlainObject(parsed.env);

  for (const flag of FLAG_REGISTRY) {
    if (flag.kind === 'boolean') continue;   // boolean flags: record-driven only
    if (flag.id === 'view-mode') continue;   // already handled above

    // Check whether devflow previously owned this flag's key.
    // Any presence in claimedIn — including null (explicitly unset) — means
    // devflow owns the slot; the record value (or its absence) wins over settings.
    // Absence from claimedIn means devflow never wrote it → fold from settings.
    const previouslyOwned =
      claimedIn !== null &&
      Object.prototype.hasOwnProperty.call(claimedIn, flag.id);
    if (previouslyOwned) continue;

    // Read the raw value from settings.json (before strip removes it)
    const rawVal =
      flag.target.type === 'env'
        ? env?.[flag.target.key]
        : parsed[flag.target.key];
    if (rawVal === undefined) continue;

    // Unwrap wrapKey-shaped values (e.g., spellcheck: { command: 'hunspell' } → 'hunspell')
    let toCoerce: unknown = rawVal;
    if (flag.kind === 'string' && flag.wrapKey !== undefined) {
      const obj = asPlainObject(rawVal);
      toCoerce = obj !== undefined ? obj[flag.wrapKey] : undefined;
    }
    if (toCoerce === undefined) continue;

    // Env vars store numbers as strings ('8') — convert to number for coercion
    if (flag.kind === 'number' && typeof toCoerce === 'string') {
      const n = Number(toCoerce);
      toCoerce = Number.isFinite(n) ? n : toCoerce;
    }

    const coerced = coerceFlagValue(flag, toCoerce);
    if (coerced !== null) {
      folded[flag.id] = coerced;
    }
  }

  // ── Step 3: strip all managed keys, then apply the folded record ──────────
  const stripped = stripFlags(settingsJson);
  const settings = applyFlags(stripped, folded);

  return { settings, record: folded };
}
