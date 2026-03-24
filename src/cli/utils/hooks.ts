/**
 * Shared hook types for Claude Code settings.json.
 * Used by learn.ts, ambient.ts, and memory.ts.
 *
 * NOTE: hud.ts uses a structurally different Settings type (statusLine, not hooks)
 * and is intentionally excluded from this shared module.
 */

export interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

export interface HookMatcher {
  hooks: HookEntry[];
}

export interface Settings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}
