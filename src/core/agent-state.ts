/**
 * Agent installation-state classification.
 *
 * Single source of truth for the STATE column shared by `--list` and the TUI.
 * Centralised here (core layer) per ADR-013 so neither cli/commands nor
 * cli/agents-view owns the vocabulary.
 *
 * applies ADR-013: pure core-layer module, no CLI-adapter concerns.
 */

import { isDormantExternalModel } from './external-models.js';

// ---------------------------------------------------------------------------
// AgentState
// ---------------------------------------------------------------------------

/**
 * The four installation states an agent row can be in.
 *
 * Drives the STATE column in both `devflow agents --list` and the TUI.
 */
export type AgentState = 'active' | 'saved-inactive' | 'not-installed' | 'unknown';

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
};

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
 * the STATE column in --list output.
 *
 * Pure function, no I/O.
 */
export function classifyAgentState({
  configured,
  proxyEnabled,
  installed,
  inRegistry,
}: ClassifyAgentStateOptions): AgentState {
  if (!inRegistry) return 'unknown';
  if (!installed) return 'not-installed';
  if (isDormantExternalModel(configured, proxyEnabled)) return 'saved-inactive';
  return 'active';
}
