/**
 * D24/D27: Reads .decisions-notifications.json (primary) and .notifications.json (fallback for
 * pre-migration compatibility), picks the worst active+undismissed notification.
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

/** Try to read and parse a notifications JSON file. Returns the map or null on any failure. */
function readNotifFile(filePath: string): Record<string, NotificationEntry> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
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
  return parsed as Record<string, NotificationEntry>;
}

/**
 * D27: Get the worst active+undismissed notification across per-file entries.
 * Reads from .decisions-notifications.json (primary, written by `devflow decisions`) and
 * .notifications.json (fallback for projects that have not yet run the split migration).
 * Returns null when no active notifications exist.
 */
export function getActiveNotification(cwd: string): NotificationData | null {
  const memoryDir = path.join(cwd, '.memory');

  // Primary: post-split-migration file written by devflow decisions
  const decisionsNotifPath = path.join(memoryDir, '.decisions-notifications.json');
  // Fallback: pre-split-migration name — kept for backward compat with projects that
  // have not yet run a session since the split migration (devflow learn now writes
  // .learning-notifications.json, but old sessions may have left .notifications.json).
  const legacyNotifPath = path.join(memoryDir, '.notifications.json');

  // Merge entries from both files; entries from the primary file take precedence on key collision
  const legacyMap = readNotifFile(legacyNotifPath);
  const decisionsMap = readNotifFile(decisionsNotifPath);

  if (!legacyMap && !decisionsMap) return null;

  const merged: Record<string, NotificationEntry> = {
    ...(legacyMap ?? {}),
    ...(decisionsMap ?? {}),
  };

  let worst: { key: string; entry: NotificationEntry; severity: number } | null = null;

  for (const [key, entry] of Object.entries(merged)) {
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

  // All keys in these files use the "decisions-capacity-*" prefix (written by decisions pipeline
  // and legacy learning pipeline pre-split-migration). The HUD does not read
  // .learning-notifications.json, which is managed separately by the learning pipeline.
  const reviewCommand = 'devflow decisions --review';

  return {
    id: worst.key,
    severity: isSeverity(worst.entry.severity) ? worst.entry.severity : 'dim',
    text: `⚠ Decisions: ${fileType} at ${count}/${ceiling} — run ${reviewCommand}`,
    count,
    ceiling,
  };
}
