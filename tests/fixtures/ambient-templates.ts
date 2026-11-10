/**
 * Exact string output by the preamble hook for a prompt that reaches its reminder branch.
 *
 * This value is verified byte-equal against preamble hook output in Suites 1, 3 and 5
 * of shell-hooks.test.ts. If the preamble hook changes the string, those tests fail first.
 * It is the full fixed output string, not a substring used for detection.
 */

/** Fixed string emitted by the preamble hook for every prompt that is neither empty nor a slash command. */
export const REMINDER_TEMPLATE =
  "Orchestrator reminder: coordinate, don't produce — delegate edits, builds and multi-file reads " +
  'to a roster agent or a devflow workflow skill; keep only judgment work mainline (conversation, decisions, routing, combining agent reports).';
