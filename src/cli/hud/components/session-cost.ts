import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function sessionCost(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const cost = ctx.stdin.cost?.total_cost_usd;
  if (cost == null) return null;

  const parts: string[] = [`$${cost.toFixed(2)}`];

  if (ctx.costHistory?.weeklyCost != null && ctx.costHistory.weeklyCost > 0) {
    parts.push(`$${ctx.costHistory.weeklyCost.toFixed(2)}/wk`);
  }

  if (ctx.costHistory?.monthlyCost != null && ctx.costHistory.monthlyCost > 0) {
    parts.push(`$${ctx.costHistory.monthlyCost.toFixed(2)}/mo`);
  }

  const raw = parts.join(' \u00B7 ');
  return { text: dim(raw), raw };
}
