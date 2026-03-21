import type { ComponentResult, GatherContext } from '../types.js';
import { green, yellow, dim, gray } from '../colors.js';

export default async function agentActivity(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.transcript) return null;
  const { agents } = ctx.transcript;
  if (agents.length === 0) return null;

  const parts: string[] = [];
  const rawParts: string[] = [];

  for (const a of agents.slice(-4)) {
    const modelTag = a.model ? gray(` [${a.model}]`) : '';
    const modelRaw = a.model ? ` [${a.model}]` : '';
    if (a.status === 'completed') {
      parts.push(green(`\u2713 ${a.name}`) + modelTag);
      rawParts.push(`\u2713 ${a.name}${modelRaw}`);
    } else {
      parts.push(yellow(`\u25D0 ${a.name}`) + modelTag);
      rawParts.push(`\u25D0 ${a.name}${modelRaw}`);
    }
  }

  return { text: parts.join(dim('  ')), raw: rawParts.join('  ') };
}
