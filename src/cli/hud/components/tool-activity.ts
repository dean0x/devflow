import type { ComponentResult, GatherContext } from '../types.js';
import { green, yellow, dim } from '../colors.js';

export default async function toolActivity(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.transcript) return null;
  const { tools } = ctx.transcript;
  if (tools.length === 0) return null;

  const running = tools.filter((t) => t.status === 'running');
  const completed = tools.filter((t) => t.status === 'completed');

  // Count by name for completed
  const counts = new Map<string, number>();
  for (const t of completed) {
    counts.set(t.name, (counts.get(t.name) || 0) + 1);
  }

  const parts: string[] = [];
  const rawParts: string[] = [];

  // Show completed summary (top 3)
  for (const [name, count] of Array.from(counts.entries()).slice(0, 3)) {
    const s = `\u2713 ${name} \u00D7${count}`;
    parts.push(green(s));
    rawParts.push(s);
  }

  // Show running (top 2)
  for (const t of running.slice(0, 2)) {
    const s = `\u25D0 ${t.name}`;
    parts.push(yellow(s));
    rawParts.push(s);
  }

  if (parts.length === 0) return null;
  return { text: parts.join(dim('  ')), raw: rawParts.join('  ') };
}
