import type { ComponentResult, GatherContext } from '../types.js';
import { dim, red } from '../colors.js';
import { renderQuotaWindow } from './usage-quota.js';

/** "5h" for 300 minutes, "7d" for 10080; any other length reads as whole days, whole hours, else minutes. */
function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/**
 * Codex usage limits, in usage-quota's style: "Codex 5h ███░░░░░ 40% (1h 2m) · 7d ...".
 *
 * A window whose resets_at has passed has reset since Codex last logged it, so it
 * renders as 0% with no countdown rather than as the stale figure. The red
 * "limited" marker shows while Codex reports a reached limit and at least one
 * window is still counting down; once every window has reset the limit is lifted
 * and the stale marker is dropped.
 */
export default async function codexQuota(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const usage = ctx.codexUsage;
  if (!usage || usage.windows.length === 0) return null;

  const nowMs = Date.now();
  const hasReset = (resetsAt: number): boolean => resetsAt * 1000 <= nowMs;

  const parts = usage.windows.map((w) =>
    hasReset(w.resetsAt)
      ? renderQuotaWindow(windowLabel(w.minutes), 0, null)
      : renderQuotaWindow(windowLabel(w.minutes), w.usedPercent, w.resetsAt),
  );
  const limited =
    usage.limitReached !== null && usage.windows.some((w) => !hasReset(w.resetsAt));

  return {
    text:
      dim('Codex ') +
      parts.map((p) => p.text).join(dim(' · ')) +
      (limited ? ' ' + red('limited') : ''),
    raw: 'Codex ' + parts.map((p) => p.raw).join(' · ') + (limited ? ' limited' : ''),
  };
}
