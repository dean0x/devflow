import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function todoProgress(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.transcript) return null;
  const { todos } = ctx.transcript;
  if (todos.total === 0) return null;
  const label = `${todos.completed}/${todos.total} todos`;
  return { text: dim(label), raw: label };
}
