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
    const icon = a.status === 'completed' ? '\u2713' : '\u25D0';
    const colorFn = a.status === 'completed' ? green : yellow;
    const modelTag = a.model ? gray(` [${a.model}]`) : '';
    const modelRaw = a.model ? ` [${a.model}]` : '';
    parts.push(colorFn(`${icon} ${a.name}`) + modelTag);
    rawParts.push(`${icon} ${a.name}${modelRaw}`);
  }

  return { text: parts.join(dim('  ')), raw: rawParts.join('  ') };
}
