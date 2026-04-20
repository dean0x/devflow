import type { ComponentResult, GatherContext } from '../types.js';
import { green, yellow, red, dim } from '../colors.js';

const BAR_WIDTH = 8;

function renderBar(percent: number): { text: string; raw: string } {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;

  let colorFn: (s: string) => string;
  if (percent < 50) {
    colorFn = green;
  } else if (percent < 80) {
    colorFn = yellow;
  } else {
    colorFn = red;
  }

  const filledBar = '\u2588'.repeat(filled);
  const emptyBar = '\u2591'.repeat(empty);
  const text =
    colorFn(filledBar) +
    dim(emptyBar) +
    ' ' +
    colorFn(`${percent}%`);
  const raw = `${filledBar}${emptyBar} ${percent}%`;
  return { text, raw };
}

/**
 * Format seconds remaining until a reset timestamp into compact form.
 * Returns '' if the timestamp is in the past or not provided.
 * Format: '2h 15m', '3d 12h', '45m'
 */
export function formatCountdown(resetsAtEpoch: number): string {
  const nowMs = Date.now();
  const resetsAtMs = resetsAtEpoch * 1000;
  const remainingMs = resetsAtMs - nowMs;

  if (remainingMs <= 0) return '';

  const totalSeconds = Math.floor(remainingMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    const hours = totalHours % 24;
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (totalHours > 0) {
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }

  return `${totalMinutes}m`;
}

/** Render a single quota window: "5h ████░░░░ 45% (2h 15m)" */
function renderQuotaWindow(
  label: string,
  percent: number,
  resetsAt: number | null,
): { text: string; raw: string } {
  const bar = renderBar(Math.round(percent));
  const countdown = resetsAt != null ? formatCountdown(resetsAt) : '';
  const countdownText = countdown ? dim(` (${countdown})`) : '';
  const countdownRaw = countdown ? ` (${countdown})` : '';
  return {
    text: dim(label + ' ') + bar.text + countdownText,
    raw: `${label} ${bar.raw}${countdownRaw}`,
  };
}

export default async function usageQuota(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.usage) return null;

  const { fiveHourPercent, sevenDayPercent, fiveHourResetsAt, sevenDayResetsAt } = ctx.usage;
  const parts: { text: string; raw: string }[] = [];

  if (fiveHourPercent !== null) {
    parts.push(renderQuotaWindow('5h', fiveHourPercent, fiveHourResetsAt));
  }
  if (sevenDayPercent !== null) {
    parts.push(renderQuotaWindow('7d', sevenDayPercent, sevenDayResetsAt));
  }

  if (parts.length === 0) return null;

  const sep = dim(' \u00B7 ');
  return {
    text: parts.map((p) => p.text).join(sep),
    raw: parts.map((p) => p.raw).join(' \u00B7 '),
  };
}
