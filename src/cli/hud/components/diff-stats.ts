import type { ComponentResult, GatherContext } from '../types.js';
import { yellow, green, red } from '../colors.js';

export default async function diffStats(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git) return null;
  const { filesChanged, additions, deletions } = ctx.git;
  if (filesChanged === 0 && additions === 0 && deletions === 0) return null;
  const parts: string[] = [];
  const rawParts: string[] = [];
  if (filesChanged > 0) {
    parts.push(yellow(`${filesChanged}`));
    rawParts.push(`${filesChanged}`);
  }
  if (additions > 0) {
    parts.push(green(`+${additions}`));
    rawParts.push(`+${additions}`);
  }
  if (deletions > 0) {
    parts.push(red(`-${deletions}`));
    rawParts.push(`-${deletions}`);
  }
  return { text: parts.join(' '), raw: rawParts.join(' ') };
}
