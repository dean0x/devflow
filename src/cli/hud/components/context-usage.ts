import type { ComponentResult, GatherContext } from '../types.js';
import { dim, green, yellow, red } from '../colors.js';

const BAR_WIDTH = 8;

/**
 * Context window usage component.
 * Visual bar with 3-tier color gradient matching usage-quota: green / yellow / red.
 * At >85% appends token breakdown: (in: Nk).
 */
export default async function contextUsage(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const cw = ctx.stdin.context_window;
  if (!cw) return null;

  let pct: number | null = null;
  if (cw.used_percentage !== undefined) {
    pct = Math.round(cw.used_percentage);
  } else if (cw.context_window_size && cw.current_usage?.input_tokens !== undefined) {
    pct = Math.round((cw.current_usage.input_tokens / cw.context_window_size) * 100);
  }

  if (pct === null) return null;

  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;

  let colorFn: (s: string) => string;
  if (pct < 50) {
    colorFn = green;
  } else if (pct < 80) {
    colorFn = yellow;
  } else {
    colorFn = red;
  }

  const filledBar = '\u2588'.repeat(filled);
  const emptyBar = '\u2591'.repeat(empty);

  let suffix = '';
  if (pct > 85 && cw.current_usage?.input_tokens !== undefined) {
    const inK = Math.round(cw.current_usage.input_tokens / 1000);
    suffix = ` (in: ${inK}k)`;
  }

  const raw = `Current Session ${filledBar}${emptyBar} ${pct}%${suffix}`;
  const text =
    dim('Current Session ') +
    colorFn(filledBar) +
    dim(emptyBar) +
    ' ' +
    colorFn(`${pct}%`) +
    (suffix ? dim(suffix) : '');

  return { text, raw };
}
