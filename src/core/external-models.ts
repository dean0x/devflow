/**
 * External GPT model registry — single source of truth for the TUI picker
 * and routing configuration.
 *
 * applies ADR-013: pure core-layer module, no Claude Code adapter concerns.
 *
 * NOTE: the internal routing runtime package name must NEVER appear in
 * user-visible strings, CLI output, or error messages. User-facing vocabulary:
 * "external model routing (GPT models via your OpenAI/Codex subscription)" /
 * "Devflow proxy".
 */

export interface ExternalModel {
  readonly id: string;
  readonly label: string;
}

/**
 * Registry of external GPT models available via the Devflow proxy.
 * Order determines TUI picker display order — preserve it.
 */
export const EXTERNAL_GPT_MODELS: readonly ExternalModel[] = [
  { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5',       label: 'GPT-5.5' },
];

/**
 * Returns the list of external GPT model IDs.
 * Consumed by: routing config generation (proxy-state), TUI picker (agents CLI),
 * and dormancy logic (agent-models).
 */
export function externalModelIds(): string[] {
  return EXTERNAL_GPT_MODELS.map(m => m.id);
}

/**
 * Returns true when `model` is an external GPT model ID (per EXTERNAL_GPT_MODELS)
 * AND the Devflow proxy is currently disabled — i.e., the entry is DORMANT and
 * the shipped default model should be used instead.
 *
 * Undefined `model` always returns false (no mapping entry → not dormant).
 *
 * Single source of truth for the dormancy predicate — avoids duplication across
 * resolveEffective (agent-models), buildRow (agents-view/state), buildListRows,
 * and the --set warning (agents CLI).
 *
 * Pure function, no I/O. Lives in external-models (leaf module, no project imports)
 * so callers in agents-view/state.ts can import it without creating cycles.
 */
export function isDormantGptModel(
  model: string | undefined,
  proxyEnabled: boolean,
): boolean {
  if (model === undefined) return false;
  return EXTERNAL_GPT_MODELS.some(m => m.id === model) && !proxyEnabled;
}
