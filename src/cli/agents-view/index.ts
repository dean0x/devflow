/**
 * agents-view barrel — re-exports for easy imports from consumers.
 *
 * applies ADR-013: CLI-layer module group.
 */

export { reduce, buildRow, isDirtyModel, isDirtyEffort, unsavedCount } from './state.js';
export { renderFrame } from './render.js';
export type {
  AgentRow,
  AgentsViewState,
  Intent,
  ReduceResult,
  InitRowInput,
} from './state.js';
export type { RenderDims } from './render.js';
export type { TuiResult } from './terminal.js';
export { runAgentsTui } from './terminal.js';
