/**
 * Shared TUI cell helpers — shared by agents-view and flags-view.
 *
 * Applies PF-017: generified into a shared module rather than copy-adapted per consumer.
 * Pure functions, no I/O.
 */

import { stripAnsi, truncate } from '../../core/ansi.js';

// ---------------------------------------------------------------------------
// Cell padding and truncation
// ---------------------------------------------------------------------------

/**
 * Pad a string to `width` visible characters.
 * Padding is measured against the ANSI-stripped visible length.
 */
export function padToVisible(s: string, width: number): string {
  const visible = stripAnsi(s);
  const padding = Math.max(0, width - visible.length);
  return s + ' '.repeat(padding);
}

/**
 * Truncate a string to at most `maxWidth` visible characters.
 * Uses the ANSI-stripped length for measurement; rebuilds from the stripped value
 * so styling is not carried across the truncation boundary.
 */
export function truncateVisible(s: string, maxWidth: number): string {
  const raw = stripAnsi(s);
  if (raw.length <= maxWidth) return s;
  // Re-truncate the unstyled version — simpler than ANSI-aware slice.
  return truncate(raw, maxWidth);
}

/**
 * Sanitize an untrusted string for a fixed-width TUI cell.
 *
 * stripAnsi strips escape sequences and C0 controls but, by contract, KEEPS
 * TAB (\x09) and LF (\x0a). Both are layout-breaking in a fixed-width frame:
 *   - LF emits a newline inside a frame line, breaking the one-string-per-
 *     terminal-line contract and desyncing the cursor arithmetic in the shell.
 *   - TAB measures as one visible character but occupies up to eight terminal
 *     columns, misaligning every column to its right.
 * Both collapse to a single space; raw key is untouched for save-path merges.
 */
const LAYOUT_BREAKING_WS = /[\t\n]/g;
export function sanitizeCell(s: string): string {
  return stripAnsi(s).replace(LAYOUT_BREAKING_WS, ' ');
}
