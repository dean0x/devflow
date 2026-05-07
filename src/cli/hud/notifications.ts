/**
 * Reads .decisions-notifications.json, picks the worst active+undismissed notification.
 * Returns NotificationData or null.
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
 * Get the worst active+undismissed notification from .decisions-notifications.json.
 * Returns null when no active notifications exist or the file is missing/malformed.
 */
export function getActiveNotification(cwd: string): NotificationData | null {
  const decisionsNotifPath = path.join(cwd, '.memory', '.decisions-notifications.json');

  let raw: string;
  try {
    raw = fs.readFileSync(decisionsNotifPath, 'utf-8');
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
  const notifMap = parsed as Record<string, NotificationEntry>;

  let worst: { key: string; entry: NotificationEntry; severity: number } | null = null;

  for (const [key, entry] of Object.entries(notifMap)) {
    if (!entry || !entry.active) continue;
    // Skip dismissed (dismissed_at_threshold matches or exceeds current threshold)
    if (entry.dismissed_at_threshold != null && entry.dismissed_at_threshold >= (entry.threshold ?? 0)) continue;

    const sev = SEVERITY_ORDER[entry.severity ?? 'dim'] ?? 0;
    if (!worst || sev > worst.severity || (sev === worst.severity && (entry.count ?? 0) > (worst.entry.count ?? 0))) {
      worst = { key, entry, severity: sev };
    }
  }

  if (!worst) return null;

  // Extract file type from key: "decisions-capacity-decisions" → "decisions"
  const fileType = worst.key.replace('decisions-capacity-', '');
  const count = worst.entry.count ?? 0;
  const ceiling = worst.entry.ceiling ?? 100;

  const reviewCommand = 'devflow decisions --review';

  return {
    id: worst.key,
    severity: isSeverity(worst.entry.severity) ? worst.entry.severity : 'dim',
    text: `⚠ Decisions: ${fileType} at ${count}/${ceiling} — run ${reviewCommand}`,
    count,
    ceiling,
  };
}
