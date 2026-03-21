import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function worktreeCount(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git || ctx.git.worktreeCount <= 1) return null;
  const raw = `${ctx.git.worktreeCount} worktrees`;
  return { text: dim(raw), raw };
}
