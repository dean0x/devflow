import type { ComponentResult, GatherContext } from '../types.js';
import { dim, red } from '../colors.js';
import { renderQuotaWindow } from './usage-quota.js';

/** "5h" for 300 minutes, "7d" for 10080; any other length reads as whole days, whole hours, else minutes. */
function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** Data older than this shows its age. */
export const CODEX_STALE_AFTER_SEC = 3600;

/** "3h" or "2d": the age in whole hours under a day, else whole days. */
function formatAge(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Codex usage limits, in usage-quota's style: "Codex 5h ███░░░░░ 40% (1h 2m) · 7d ...".
 *
 * A window whose resets_at has passed has reset since Codex last reported it, and
 * its use since the reset is unknown, so it renders as "7d reset" with no bar and
 * no percent. A record older than CODEX_STALE_AFTER_SEC ends with its age, for
 * example "· data 3h old". The red "limited" marker shows while Codex reports a
 * reached limit and at least one window is still counting down; once every window
 * has reset the limit is lifted and the stale marker is dropped.
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
  const ageSec = Math.floor(nowMs / 1000) - usage.observedAt;
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
