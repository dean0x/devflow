/**
 * D24: HUD notification component — one line, color-scaled by severity.
 * dim (50-69) / yellow (70-89) / red (90-100).
 */
import type { ComponentResult, GatherContext } from '../types.js';
import { dim, yellow, red } from '../colors.js';

export default async function notifications(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const data = ctx.notifications;
  if (!data) return null;

  const raw = data.text;
  let text: string;

  switch (data.severity) {
    case 'error':
      text = red(raw);
      break;
    case 'warning':
      text = yellow(raw);
      break;
    case 'dim':
    default:
      text = dim(raw);
      break;
  }

  return { text, raw };
}
