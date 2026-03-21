import type { ComponentResult, GatherContext } from '../types.js';
import { green, yellow, red, dim } from '../colors.js';

function renderBar(percent: number): { text: string; raw: string } {
  const blocks = 3;
  const filled = Math.round((percent / 100) * blocks);
  const empty = blocks - filled;
  const colorFn = percent < 50 ? green : percent < 80 ? yellow : red;
  const filledBar = '\u258B'.repeat(filled);
  const emptyBar = '\u258B'.repeat(empty);
  const text = colorFn(filledBar) + dim(emptyBar) + ` ${percent}%`;
  const raw = '\u258B'.repeat(blocks) + ` ${percent}%`;
  return { text, raw };
}

export default async function usageQuota(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.usage) return null;
  // Prefer daily, fallback to weekly
  const pct = ctx.usage.dailyUsagePercent ?? ctx.usage.weeklyUsagePercent;
  if (pct === null || pct === undefined) return null;
  const bar = renderBar(Math.round(pct));
  return { text: bar.text, raw: bar.raw };
}
