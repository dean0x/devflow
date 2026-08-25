/**
 * ANSI color helpers — re-exported from src/core/ansi.ts.
 *
 * The canonical implementation lives in src/core/ansi.ts (agent-neutral home,
 * applies ADR-013). This file is a re-export barrel so all existing HUD
 * component call sites continue to resolve `../colors.js` without change.
 */
export {
  bold,
  dim,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  gray,
  white,
  orange,
  brightRed,
  boldRed,
  bgGreen,
  bgYellow,
  bgRed,
  inverse,
  truncate,
  stripAnsi,
} from '../core/ansi.js';
