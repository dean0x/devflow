import type { ComponentResult, GatherContext } from '../types.js';
import { green, red } from '../colors.js';

export default async function gitAheadBehind(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git) return null;
  const { ahead, behind } = ctx.git;
  if (ahead === 0 && behind === 0) return null;
  const parts: string[] = [];
  const rawParts: string[] = [];
  if (ahead > 0) {
    parts.push(green(`${ahead}\u2191`));
    rawParts.push(`${ahead}\u2191`);
  }
  if (behind > 0) {
    parts.push(red(`${behind}\u2193`));
    rawParts.push(`${behind}\u2193`);
  }
  return { text: parts.join(' '), raw: rawParts.join(' ') };
}
