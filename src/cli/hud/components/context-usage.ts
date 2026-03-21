import type { ComponentResult, GatherContext } from '../types.js';
import { green, yellow, red } from '../colors.js';

/**
 * Context window usage component.
 * Color thresholds ported from statusline.sh: green < 50%, yellow 50-80%, red > 80%.
 */
export default async function contextUsage(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const cw = ctx.stdin.context_window;
  if (!cw?.context_window_size || !cw?.current_usage?.input_tokens) return null;

  const pct = Math.round(
    (cw.current_usage.input_tokens / cw.context_window_size) * 100,
  );
  const label = `${pct}%`;

  // Color thresholds from statusline.sh
  let colorFn: (s: string) => string;
  if (pct < 50) {
    colorFn = green;
  } else if (pct < 80) {
    colorFn = yellow;
  } else {
    colorFn = red;
  }
  return { text: colorFn(label), raw: label };
}
