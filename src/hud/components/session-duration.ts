import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function sessionDuration(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.sessionStartTime) return null;
  const elapsed = Math.floor((Date.now() - ctx.sessionStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const hours = Math.floor(minutes / 60);
  let label: string;
  if (hours > 0) {
    label = `${hours}h ${minutes % 60}m`;
  } else {
    label = `${minutes}m`;
  }
  const text = `\u23F1 ${label}`;
  return { text: dim(text), raw: text };
}
