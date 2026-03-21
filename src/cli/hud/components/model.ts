import type { ComponentResult, GatherContext } from '../types.js';
import { magenta } from '../colors.js';

export default async function model(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const name = ctx.stdin.model?.display_name;
  if (!name) return null;
  return { text: magenta(name), raw: name };
}
