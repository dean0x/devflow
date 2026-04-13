/**
 * D24/D27: Reads .notifications.json, picks the worst active+undismissed
 * per-file notification. Returns NotificationData or null.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NotificationData } from './types.js';
import { type NotificationEntry, isNotificationMap } from '../utils/notifications-shape.js';

const SEVERITY_VALUES = ['dim', 'warning', 'error'] as const;
type Severity = typeof SEVERITY_VALUES[number];

const SEVERITY_ORDER: Record<string, number> = { dim: 0, warning: 1, error: 2 };

function isSeverity(v: unknown): v is Severity {
  return typeof v === 'string' && (SEVERITY_VALUES as readonly string[]).includes(v);
}

/**
 * D27: Get the worst active+undismissed notification across per-file entries.
 * Returns null when no active notifications exist.
 */
export function getActiveNotification(cwd: string): NotificationData | null {
  const notifPath = path.join(cwd, '.memory', '.notifications.json');

  let raw: string;
  try {
    raw = fs.readFileSync(notifPath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isNotificationMap(parsed)) return null;

  let worst: { key: string; entry: NotificationEntry; severity: number } | null = null;

  for (const [key, entry] of Object.entries(parsed)) {
    if (!entry || !entry.active) continue;
    // Skip dismissed (dismissed_at_threshold matches or exceeds current threshold)
    if (entry.dismissed_at_threshold != null && entry.dismissed_at_threshold >= (entry.threshold ?? 0)) continue;

    const sev = SEVERITY_ORDER[entry.severity ?? 'dim'] ?? 0;
    if (!worst || sev > worst.severity || (sev === worst.severity && (entry.count ?? 0) > (worst.entry.count ?? 0))) {
      worst = { key, entry, severity: sev };
    }
  }

  if (!worst) return null;

  // Extract file type from key: "knowledge-capacity-decisions" → "decisions"
  const fileType = worst.key.replace('knowledge-capacity-', '');
  const count = worst.entry.count ?? 0;
  const ceiling = worst.entry.ceiling ?? 100;

  return {
    id: worst.key,
    severity: isSeverity(worst.entry.severity) ? worst.entry.severity : 'dim',
    text: `\u26A0 Knowledge: ${fileType} at ${count}/${ceiling} — run devflow learn --review`,
    count,
    ceiling,
  };
}
