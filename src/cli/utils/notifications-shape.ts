/**
 * @file notifications-shape.ts
 *
 * Shared type definitions and runtime guard for `.memory/.notifications.json`.
 *
 * Consolidated from two divergent definitions:
 *   - `src/cli/commands/learn.ts`      (STRONGER — validated entries are objects)
 *   - `src/cli/hud/notifications.ts`   (WEAKER — only checked top-level map)
 *
 * The STRONGER definition is canonical: each value in the map must itself be a
 * non-null, non-array object. This ensures callers that iterate entries can
 * safely assume entry-level object shape before accessing fields.
 *
 * D-SEC1: Runtime guard rejects arrays, primitives, and null at both map and
 * entry level. Callers treat failed validation as an empty map and warn rather
 * than crash — this preserves forward compatibility when json-helper.cjs adds
 * new entry fields.
 */

/**
 * Shape of a single entry in `.memory/.notifications.json`.
 * Mirrors the structure written by `json-helper.cjs` (write-path).
 */
export interface NotificationEntry {
  active?: boolean;
  threshold?: number;
  count?: number;
  ceiling?: number;
  dismissed_at_threshold?: number | null;
  severity?: string;
  created_at?: string;
}

/**
 * @deprecated Use `NotificationEntry` — this alias exists for backward
 * compatibility with call sites that imported `NotificationFileEntry` from
 * `learn.ts` before the consolidation.
 */
export type NotificationFileEntry = NotificationEntry;

/**
 * Runtime guard for `.notifications.json` parse results (STRONGER definition).
 *
 * Returns true only when:
 *   - `v` is a non-null, non-array object (the top-level map), AND
 *   - every value in that map is itself a non-null, non-array object
 *
 * On failure, callers should treat the result as an empty map and warn rather
 * than crash.
 */
export function isNotificationMap(v: unknown): v is Record<string, NotificationEntry> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as object).every(
    (entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}
