import type { ComponentResult, GatherContext } from '../types.js';
import { cyan, yellow } from '../colors.js';

export default async function gitBranch(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git) return null;
  const indicator = ctx.git.dirty ? '*' : '';
  const text = cyan(ctx.git.branch) + (indicator ? yellow(indicator) : '');
  const raw = ctx.git.branch + indicator;
  return { text, raw };
}
