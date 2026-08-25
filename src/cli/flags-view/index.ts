/**
 * flags-view public barrel.
 *
 * Commands should import from this barrel to avoid coupling to internals.
 */

export { runFlagsTui, type FlagsTuiResult } from './terminal.js';
export { buildFlagRows, collectFlagRecord, type FlagRow, type FlagsViewState } from './state.js';
export { computeViewportHeight, FIXED_ROWS } from './render.js';
