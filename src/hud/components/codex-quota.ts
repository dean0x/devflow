import type { ComponentResult, GatherContext } from '../types.js';
import { dim, red } from '../colors.js';
import { renderQuotaWindow } from './usage-quota.js';

/** "5h" for 300 minutes, "7d" for 10080; any other length reads as whole days, whole hours, else minutes. */
function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** Data at or above this age shows a suffix. */
export const CODEX_STALE_AFTER_SEC = 600;

/** Show whole minutes under an hour, hours under a day, else days. */
function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Codex usage limits, in usage-quota's style: "Codex 5h ███░░░░░ 40% (1h 2m) · 7d ...".
 *
 * A window whose resets_at has passed has reset since Codex last reported it, and
 * its use since the reset is unknown, so it renders as "7d reset" with no bar and
 * no percent. A record at least CODEX_STALE_AFTER_SEC old ends with its age,
 * for example "· data 10m old". The red "limited" marker shows when Codex
 * reports a reached limit and at least one window has not reset.
 */
export default async function codexQuota(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const usage = ctx.codexUsage;
  if (!usage || usage.windows.length === 0) return null;

  const nowMs = Date.now();
  const hasReset = (resetsAt: number): boolean => resetsAt * 1000 <= nowMs;

  const parts = usage.windows.map((w) => {
    const label = windowLabel(w.minutes);
    return hasReset(w.resetsAt)
      ? { text: dim(`${label} reset`), raw: `${label} reset` }
      : renderQuotaWindow(label, w.usedPercent, w.resetsAt);
  });
  const limited =
    usage.limitReached !== null && usage.windows.some((w) => !hasReset(w.resetsAt));
  const ageSec = Math.floor((nowMs - usage.observedAt) / 1000);
  const age = ageSec >= CODEX_STALE_AFTER_SEC ? ` · data ${formatAge(ageSec)} old` : '';

  return {
    text:
      dim('Codex ') +
      parts.map((p) => p.text).join(dim(' · ')) +
      (limited ? ' ' + red('limited') : '') +
      (age ? dim(age) : ''),
    raw: 'Codex ' + parts.map((p) => p.raw).join(' · ') + (limited ? ' limited' : '') + age,
  };
}
