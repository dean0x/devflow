/**
 * D24/D27: Reads .notifications.json, picks the worst active+undismissed
 * per-file notification. Returns NotificationData or null.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NotificationData } from './types.js';

interface NotificationEntry {
  active?: boolean;
  threshold?: number;
  count?: number;
  ceiling?: number;
  dismissed_at_threshold?: number | null;
  severity?: string;
  created_at?: string;
}

const SEVERITY_ORDER: Record<string, number> = { dim: 0, warning: 1, error: 2 };

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

  let data: Record<string, NotificationEntry>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  let worst: { key: string; entry: NotificationEntry; severity: number } | null = null;

  for (const [key, entry] of Object.entries(data)) {
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
    severity: (worst.entry.severity as NotificationData['severity']) ?? 'dim',
    text: `\u26A0 Knowledge: ${fileType} at ${count}/${ceiling} — run devflow learn --review`,
    count,
    ceiling,
  };
}
