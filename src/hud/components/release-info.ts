import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

export default async function releaseInfo(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git?.lastTag) return null;
  const { lastTag, commitsSinceTag } = ctx.git;
  const raw = commitsSinceTag > 0 ? `${lastTag} +${commitsSinceTag}` : lastTag;
  return { text: dim(raw), raw };
}
