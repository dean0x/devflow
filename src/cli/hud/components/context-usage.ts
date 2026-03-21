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
  const colorFn = pct < 50 ? green : pct < 80 ? yellow : red;
  return { text: colorFn(label), raw: label };
}
