import type { ComponentResult, GatherContext } from '../types.js';
import { white, yellow, green } from '../colors.js';

export default async function gitBranch(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git) return null;
  const dirtyMark = ctx.git.dirty ? '*' : '';
  const stagedMark = ctx.git.staged ? '+' : '';
  const indicator = dirtyMark + stagedMark;
  const text =
    white(ctx.git.branch) +
    (dirtyMark ? yellow(dirtyMark) : '') +
    (stagedMark ? green(stagedMark) : '');
  const raw = ctx.git.branch + indicator;
  return { text, raw };
}
