import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';

/**
 * HUD component: learning decisions counts.
 * Shows count of promoted (created) decisions entries by type.
 * Returns null gracefully if no learning log exists or no promoted entries.
 */
export default async function learningCounts(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const data = ctx.learningCounts;
  if (!data) return null;

  const { workflows, procedural, decisions, pitfalls } = data;
  const total = workflows + procedural + decisions + pitfalls;

  // Only render if there is at least one promoted entry
  if (total === 0) return null;

  const parts: string[] = [];
  if (workflows > 0) parts.push(`${workflows} workflow${workflows !== 1 ? 's' : ''}`);
  if (procedural > 0) parts.push(`${procedural} skill${procedural !== 1 ? 's' : ''}`);
  if (decisions > 0) parts.push(`${decisions} decision${decisions !== 1 ? 's' : ''}`);
  if (pitfalls > 0) parts.push(`${pitfalls} pitfall${pitfalls !== 1 ? 's' : ''}`);

  if (parts.length === 0) return null;

  const raw = `Learning: ${parts.join(', ')}`;
  const text = dim(raw);

  return { text, raw };
}
