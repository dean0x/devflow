import type { ComponentResult, GatherContext } from '../types.js';
import { dim, green, red } from '../colors.js';

export default async function diffStats(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.git) return null;
  const { filesChanged, additions, deletions } = ctx.git;
  if (filesChanged === 0 && additions === 0 && deletions === 0) return null;
  const filePart = filesChanged > 0
    ? `${filesChanged} file${filesChanged === 1 ? '' : 's'}`
    : '';
  const lineParts: string[] = [];
  if (additions > 0) lineParts.push(`+${additions}`);
  if (deletions > 0) lineParts.push(`-${deletions}`);

  const sections: string[] = [];
  const rawSections: string[] = [];

  if (filePart) {
    sections.push(dim(filePart));
    rawSections.push(filePart);
  }
  if (lineParts.length > 0) {
    const lineText = lineParts
      .map((p) => (p.startsWith('+') ? green(p) : red(p)))
      .join(' ');
    sections.push(lineText);
    rawSections.push(lineParts.join(' '));
  }

  if (sections.length === 0) return null;
  return {
    text: sections.join(dim(' \u00B7 ')),
    raw: rawSections.join(' \u00B7 '),
  };
}
