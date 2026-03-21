import type { ComponentResult, GatherContext } from '../types.js';
import { dim, white } from '../colors.js';

export default async function model(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const name = ctx.stdin.model?.display_name;
  if (!name) return null;
  // Strip "Claude " prefix and trailing context info like "(1M context)" for brevity
  const short = name
    .replace(/^Claude\s+/i, '')
    .replace(/\s*\(\d+[KkMm]\s*context\)\s*$/, '');

  const cwSize = ctx.stdin.context_window?.context_window_size;
  let sizeStr = '';
  if (cwSize) {
    sizeStr =
      cwSize >= 1_000_000
        ? ` [${Math.round(cwSize / 1_000_000)}m]`
        : ` [${Math.round(cwSize / 1000)}k]`;
  }

  const raw = short + sizeStr;
  return { text: white(short) + (sizeStr ? dim(sizeStr) : ''), raw };
}
