/**
 * Shared hook types and hook-ownership helpers for Claude Code settings.json.
 * Used by every module that registers or removes a devflow hook (ambient.ts,
 * capture.ts, memory.ts, context.ts, proxy.ts, legacy-hooks.ts).
 *
 * NOTE: hud.ts uses a structurally different Settings type (statusLine, not hooks)
 * and is intentionally excluded from this shared module.
 */
import * as path from 'path';

export interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

export interface HookMatcher {
  /** Tool-name filter for PostToolUse/PreToolUse hooks (e.g. "AskUserQuestion"). Absent = matches all. */
  matcher?: string;
  hooks: HookEntry[];
}

export interface Settings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

/** A predicate over one hook entry of a matcher group. */
export type HookPredicate = (hook: HookEntry) => boolean;

/** The directory, relative to a devflow root, that holds every hook devflow registers. */
export const HOOKS_DIR_SUFFIX = '/scripts/hooks/';

/** The command ending devflow writes for a `run-hook <marker>` hook. */
export function runHookSuffix(marker: string): string {
  return `${HOOKS_DIR_SUFFIX}run-hook ${marker}`;
}

/** The command devflow registers for the `run-hook <marker>` hook under `devflowDir`. */
export function runHookCommand(devflowDir: string, marker: string): string {
  return `${path.join(devflowDir, 'scripts', 'hooks', 'run-hook')} ${marker}`;
}

/**
 * A predicate matching a hook whose command ends in any of `suffixes`, read with
 * surrounding whitespace trimmed and backslashes as slashes (a Windows install).
 * A missing or non-string command — a hand-edited settings.json — matches nothing.
 */
export function endsWithAny(suffixes: readonly string[]): HookPredicate {
  return (hook) => {
    const raw = (hook as { command?: unknown }).command;
    if (typeof raw !== 'string') return false;
    const command = raw.trim().replace(/\\/g, '/');
    return suffixes.some((suffix) => command.endsWith(suffix));
  };
}

/**
 * The ownership predicate for devflow's `run-hook <marker>` hooks.
 *
 * D-EXACT-HOOK-OWNER: a hook is devflow's when its command ENDS in
 * `/scripts/hooks/run-hook <marker>` for one of `markers`, or in one of the
 * module's named `legacySuffixes` (a form an earlier release registered, such as
 * `/scripts/hooks/session-start-memory.sh`), under any directory — so installs made
 * under a custom or retired devflow directory are still recognised. It is never
 * devflow's because it merely CONTAINS a marker word: a user's `~/bin/memory-worker`,
 * `echo capture-turn` or `/opt/tools/run-hook preamble` is theirs
 * (remove only what devflow can prove it wrote). Removal goes through `removeHooks`,
 * one hook at a time. Every hook module builds its predicates here;
 * D-AMBIENT-EXACT-HOOK is the ambient instance of this rule.
 */
export function devflowHookOwner(
  markers: readonly string[],
  legacySuffixes: readonly string[] = [],
): HookPredicate {
  return endsWithAny([...markers.map(runHookSuffix), ...legacySuffixes]);
}

/** A matcher group's hooks, or an empty list for a hand-edited group of another shape. */
function hooksOf(matcher: HookMatcher): readonly HookEntry[] {
  return Array.isArray(matcher?.hooks) ? matcher.hooks : [];
}

/**
 * Remove every hook matching `shouldRemove` from one event's matcher groups.
 * Mutates `settings` (callers pass their own parsed copy). Returns true if any hook
 * was removed.
 *
 * D-EXACT-HOOK-OWNER: removal is per HOOK, not per matcher group — a group keeps
 * the user's sibling hooks, in their order, and is dropped only when nothing is left
 * in it. A group whose `hooks` is not an array is kept as is. Empty event arrays and
 * an empty `hooks` object are cleaned up.
 */
export function removeHooks(
  settings: Settings,
  eventName: string,
  shouldRemove: HookPredicate,
): boolean {
  const matchers = settings.hooks?.[eventName];
  if (!settings.hooks || !Array.isArray(matchers)) return false;

  let removed = false;
  const kept: HookMatcher[] = [];
  for (const matcher of matchers) {
    const hooks = hooksOf(matcher);
    const remaining = hooks.filter((hook) => !shouldRemove(hook));
    if (remaining.length === hooks.length) {
      kept.push(matcher);
      continue;
    }
    removed = true;
    if (remaining.length > 0) kept.push({ ...matcher, hooks: remaining });
  }
  if (!removed) return false;

  if (kept.length === 0) {
    delete settings.hooks[eventName];
  } else {
    settings.hooks[eventName] = kept;
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  return true;
}

/** Whether any hook registered for `eventName` matches `isOurs`. */
export function hasHook(settings: Settings, eventName: string, isOurs: HookPredicate): boolean {
  const matchers = settings.hooks?.[eventName];
  return Array.isArray(matchers) && matchers.some((m) => hooksOf(m).some(isOurs));
}

/**
 * Append `entry` as a new matcher group for `eventName` unless a hook matching
 * `isOurs` is already registered there. Mutates `settings`. Returns true when the
 * entry was added.
 */
export function ensureHook(settings: Settings, eventName: string, isOurs: HookPredicate, entry: HookMatcher): boolean {
  if (hasHook(settings, eventName, isOurs)) {
    return false;
  }
  settings.hooks ??= {};
  settings.hooks[eventName] ??= [];
  settings.hooks[eventName].push(entry);
  return true;
}
