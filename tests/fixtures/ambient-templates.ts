/**
 * Exact strings output by the preamble hook for each dispatch branch.
 *
 * Shared between shell-hooks.test.ts (unit assertions) and
 * tests/integration/ambient-activation.test.ts (systemPrompt simulation) to
 * ensure both test layers stay in sync when the hook templates change.
 *
 * These values are verified byte-equal against preamble hook output in Suite 1
 * and Suite 3 of shell-hooks.test.ts. If the preamble hook changes either
 * string, the shell-hook tests fail first — the integration tests automatically
 * reflect the new value because they import from here.
 *
 * avoids PF-001: matches by prefix in the preamble hook itself; these constants
 * are the full fixed output strings (not substrings used for detection).
 */

/** Fixed string emitted by the preamble hook for a plan-handoff prompt. */
export const HANDOFF_TEMPLATE =
  "The user's prompt is a plan handoff (it begins with `Implement the following plan:`). " +
  "In one short sentence, tell the user you're invoking `devflow:implement`. " +
  'Then immediately invoke it with the Skill tool, passing the full plan ' +
  '(everything after the handoff prefix) as the skill input so it can be executed. ' +
  'Do not pause to ask whether to proceed.';

/** Fixed string emitted by the preamble hook for a normal (non-handoff, non-slash) prompt. */
export const REMINDER_TEMPLATE =
  "Orchestrator reminder: coordinate, don't produce — delegate edits, builds, multi-file reads, " +
  'and debug loops via the Agent tool (haiku=mechanical, sonnet=defined execution, opus=analysis/design/research) ' +
  'or the matching devflow workflow skill.\n' +
  'Keep only judgment work mainline: conversation, decisions, routing, synthesis of agent reports.';
