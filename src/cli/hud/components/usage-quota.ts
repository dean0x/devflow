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

export default async function usageQuota(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.usage) return null;

  const { fiveHourPercent, sevenDayPercent } = ctx.usage;
  const parts: { text: string; raw: string }[] = [];

  if (fiveHourPercent !== null) {
    const bar = renderBar(Math.round(fiveHourPercent));
    parts.push({ text: dim('5h ') + bar.text, raw: `5h ${bar.raw}` });
  }
  if (sevenDayPercent !== null) {
    const bar = renderBar(Math.round(sevenDayPercent));
    parts.push({ text: dim('7d ') + bar.text, raw: `7d ${bar.raw}` });
  }

  if (parts.length === 0) return null;

  const sep = dim(' \u00B7 ');
  const text = dim('Session ') + parts.map((p) => p.text).join(sep);
  const raw = 'Session ' + parts.map((p) => p.raw).join(' \u00B7 ');
  return { text, raw };
}
