import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function gitAheadBehind(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git) return null;
  const { ahead, behind } = ctx.git;
  if (ahead === 0 && behind === 0) return null;
  const rawParts: string[] = [];
  if (ahead > 0) rawParts.push(`${ahead}\u2191`);
  if (behind > 0) rawParts.push(`${behind}\u2193`);
  const raw = rawParts.join(' ');
  return { text: dim(raw), raw };
}
