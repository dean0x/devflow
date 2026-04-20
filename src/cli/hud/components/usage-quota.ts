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
 * Format: '2h15m', '3d12h', '45m' (compact, no spaces)
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
    return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  }

  if (totalHours > 0) {
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${totalHours}h${minutes}m` : `${totalHours}h`;
  }

  return `${totalMinutes}m`;
}

export default async function usageQuota(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.usage) return null;

  const { fiveHourPercent, sevenDayPercent, fiveHourResetsAt, sevenDayResetsAt } = ctx.usage;
  const parts: { text: string; raw: string }[] = [];

  if (fiveHourPercent !== null) {
    const bar = renderBar(Math.round(fiveHourPercent));
    const countdown = fiveHourResetsAt != null ? formatCountdown(fiveHourResetsAt) : '';
    const countdownText = countdown ? dim(` \u21BB${countdown}`) : '';
    const countdownRaw = countdown ? ` \u21BB${countdown}` : '';
    parts.push({
      text: dim('5h') + countdownText + dim(' ') + bar.text,
      raw: `5h${countdownRaw} ${bar.raw}`,
    });
  }
  if (sevenDayPercent !== null) {
    const bar = renderBar(Math.round(sevenDayPercent));
    const countdown = sevenDayResetsAt != null ? formatCountdown(sevenDayResetsAt) : '';
    const countdownText = countdown ? dim(` \u21BB${countdown}`) : '';
    const countdownRaw = countdown ? ` \u21BB${countdown}` : '';
    parts.push({
      text: dim('7d') + countdownText + dim(' ') + bar.text,
      raw: `7d${countdownRaw} ${bar.raw}`,
    });
  }

  if (parts.length === 0) return null;

  const sep = dim(' \u00B7 ');
  const text = parts.map((p) => p.text).join(sep);
  const raw = parts.map((p) => p.raw).join(' \u00B7 ');
  return { text, raw };
}
