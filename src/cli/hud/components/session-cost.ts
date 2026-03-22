import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function sessionCost(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const cost = ctx.stdin.cost?.total_cost_usd;
  if (cost == null) return null;
  const formatted = `$${cost.toFixed(2)}`;
  return { text: dim(formatted), raw: formatted };
}
