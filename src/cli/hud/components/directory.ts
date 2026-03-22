import type { ComponentResult, GatherContext } from '../types.js';
import { bold, white } from '../colors.js';
import * as path from 'node:path';

export default async function directory(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const cwd = ctx.stdin.cwd;
  if (!cwd) return null;
  const name = path.basename(cwd);
  return { text: bold(white(name)), raw: name };
}
