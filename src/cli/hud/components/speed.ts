import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function speed(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.speed?.tokensPerSecond) return null;
  const tps = Math.round(ctx.speed.tokensPerSecond);
  const label = `${tps} tok/s`;
  return { text: dim(label), raw: label };
}
