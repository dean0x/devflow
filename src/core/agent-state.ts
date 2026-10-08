/**
 * Agent row vocabulary shared by `devflow agents --list` and the TUI.
 *
 * Single source of truth for the STATE column and the EFFORT cell, so neither
 * surface can drift from the other. Centralised here (core layer) so neither
 * cli/commands nor cli/agents-view owns the vocabulary.
 *
 * Pure core-layer module, no CLI-adapter concerns.
 */

import { isDormantExternalModel } from './external-models.js';

// ---------------------------------------------------------------------------
// AgentState
// ---------------------------------------------------------------------------

/**
 * The states an agent row can be in.
 *
 * Drives the STATE column in both `devflow agents --list` and the TUI. The first
 * four are installation states and the only values classifyAgentState returns.
 * `worker` marks the row of a background worker (D-WORKER-AGENTS): it has no
 * installed agent file, so it can be neither installed, not installed nor
 * dormant, and its rows bypass classifyAgentState.
 */
export type AgentState = 'active' | 'saved-inactive' | 'not-installed' | 'unknown' | 'worker';

// ---------------------------------------------------------------------------
// AGENT_STATE_LABELS
// ---------------------------------------------------------------------------

/**
 * Display labels for each {@link AgentState}, shared by `--list` and the TUI
 * so the two surfaces cannot drift from each other.
 *
 * Apply colour at each call site; this map holds bare text only.
 */
export const AGENT_STATE_LABELS: Readonly<Record<AgentState, string>> = {
  'active': 'active',
  'saved-inactive': 'saved-inactive',
  'not-installed': 'not installed',
  'unknown': 'unknown',
  'worker': 'worker',
};

// ---------------------------------------------------------------------------
// formatEffortDisplay
// ---------------------------------------------------------------------------

/**
 * The text of an EFFORT cell, shared by `--list` and the TUI.
 *
 * D-SHIPPED-EFFORT: a configured level or `inherit` is shown as is. An
 * unconfigured row shows `default (<shipped effort>)` when the shipped source
 * carries an effort — the same `default (shippedDefault)` convention the MODEL
 * cell uses — and plain `default` when it carries none.
 *
 * Pure function, no I/O.
 *
 * @param configured - The row's effort: a level, `inherit`, or `default` when unset.
 * @param shippedEffort - The effort the shipped source carries, if any.
 */
export function formatEffortDisplay(configured: string, shippedEffort: string | undefined): string {
  if (configured !== 'default') return configured;
  return shippedEffort === undefined ? 'default' : `default (${shippedEffort})`;
}

// ---------------------------------------------------------------------------
// classifyAgentState
// ---------------------------------------------------------------------------

/**
 * Options for {@link classifyAgentState}.
 */
export interface ClassifyAgentStateOptions {
  /** The configured model string ('default' or a model name). */
  configured: string;
  /** Whether the Devflow proxy is currently active. */
  proxyEnabled: boolean;
  /** Whether the agent's .md file exists in the install directory. */
  installed: boolean;
  /** Whether the agent name appears in the plugin registry. */
  inRegistry: boolean;
}

/**
 * Classify an agent row's install state.
 *
 * Single source of truth shared by `--list` and the TUI so the two surfaces
 * cannot drift. The four-way result drives the STATE column in render.ts and
 * the STATE column in --list output. Worker rows never come through here.
 *
 * Pure function, no I/O.
 */
export function classifyAgentState({
  configured,
  proxyEnabled,
  installed,
  inRegistry,
}: ClassifyAgentStateOptions): Exclude<AgentState, 'worker'> {
  if (!inRegistry) return 'unknown';
  if (!installed) return 'not-installed';
  if (isDormantExternalModel(configured, proxyEnabled)) return 'saved-inactive';
  return 'active';
}
