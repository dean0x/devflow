/**
 * External model dormancy predicate and Claude model alias set.
 *
 * Dormancy asks "does this model name need the proxy?" — answerable from the
 * complement (the static Claude passthrough set) without any discovery I/O.
 * This keeps the safety property correct even when discovery fails.
 *
 * Live model discovery (discoverExternalModels / getExternalModelsCached) lives
 * in src/core/model-discovery.ts. The TUI picker and --set validation use the
 * ExternalModelCatalog returned by those functions.
 *
 * applies ADR-013: pure core-layer module, no Claude Code adapter concerns.
 *
 * NOTE: the internal routing runtime package name must NEVER appear in
 * user-visible strings, CLI output, or error messages. User-facing vocabulary:
 * "external model routing (GPT models via your OpenAI/Codex subscription)" /
 * "Devflow proxy".
 */

// ---------------------------------------------------------------------------
// Claude model alias set — exported for TUI cycle builders and tests.
// Lives in external-models (leaf module, no project imports) so callers in
// agents-view/state.ts can import without cycles.
// ---------------------------------------------------------------------------

/**
 * Claude model short-alias identifiers.
 * A mapping entry with one of these model values applies unconditionally —
 * it is NOT an external model and is NOT subject to proxy dormancy.
 *
 * Includes 'fable': devflow's Claude set is intentionally a SUPERSET of the
 * routing runtime's own Anthropic passthrough regex (which does not match
 * 'fable'). The runtime's fallbackProvider is 'anthropic', so 'fable' routes
 * correctly. Excluding 'fable' here would misclassify it as external and
 * silently revert it to the shipped default when the proxy is off.
 */
export const CLAUDE_MODEL_ALIASES: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable'];

const CLAUDE_EXACT: ReadonlySet<string> = new Set([...CLAUDE_MODEL_ALIASES, 'inherit']);

/**
 * Returns true when `model` names a Claude-native model — an alias
 * (haiku/sonnet/opus/fable/inherit) or a full claude- prefixed identifier.
 *
 * Used as the COMPLEMENT predicate for dormancy: a model is external if and
 * only if it is not a Claude model name (and not 'default').
 *
 * Pure function, no I/O.
 */
export function isClaudeModelName(model: string): boolean {
  return CLAUDE_EXACT.has(model) || model.startsWith('claude-');
}

// ---------------------------------------------------------------------------
// Dormancy predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when `model` names a non-Claude model that requires the
 * Devflow proxy AND the proxy is currently disabled — i.e., the entry is
 * DORMANT and the shipped default model should be used instead.
 *
 * Classification is by the COMPLEMENT: a model is dormant-when-off iff it is
 * NOT a Claude model name (and not 'default' or undefined). This makes dormancy
 * independent of runtime discovery — a discovery failure cannot degrade the
 * safety property by returning an empty external set.
 *
 * Single source of truth for dormancy — do NOT inline this predicate at call
 * sites. (anti-pattern, KNOWLEDGE.md § Anti-Patterns — "Duplicating the dormancy predicate")
 *
 * Pure function, no I/O. Lives in external-models (leaf module, no project
 * imports) so callers in agents-view/state.ts can import without cycles.
 *
 * @param model - The configured model string, or undefined (no mapping entry).
 * @param proxyEnabled - Whether the Devflow proxy is currently active.
 */
export function isDormantExternalModel(
  model: string | undefined,
  proxyEnabled: boolean,
): boolean {
  if (model === undefined || proxyEnabled) return false;
  return model !== 'default' && !isClaudeModelName(model);
}
