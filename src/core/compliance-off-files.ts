/**
 * The skill files a compliance-off install removes by exact name.
 *
 * ONE list. Both users of it, the install and the compliance converge, read this constant,
 * so a name added here reaches both and a name missing here is missing from both.
 *
 * The references of the posting operations are pruned from the converged `pr/` and
 * `tracker/` subtrees by the overlay. These three files sit outside them, and the overlay
 * never prunes a flat root (D-OVERLAY-FLAT-UNIT), so a skill copy would otherwise leave
 * each of them on a machine that has switched compliance off:
 *   - `publication-gate.md`: generated, and named from the two summary operations only.
 *     The compliance-off manifest omits it, so the overlay writes no copy, and a copy
 *     from an earlier compliance-on install stays until it is removed here.
 *   - `github-posting.md`: the static posting recipes, which no compliance-off reference
 *     names.
 *   - `implement-evidence-asks.md`: read only by the compliance-on arms of `/implement`.
 *
 * Each entry is a path below `~/.claude/skills/`, spelled as it is installed. The removal
 * is keyed on the machine compliance switch alone (never on curation, a repository key or
 * the provider), and enabling compliance puts each file back byte for byte.
 */
export const COMPLIANCE_OFF_REMOVED_SKILL_FILES = [
  'devflow:git/references/publication-gate.md',
  'devflow:git/references/github-posting.md',
  'devflow:agent-references/references/commands/implement-evidence-asks.md',
] as const;

/** One entry of {@link COMPLIANCE_OFF_REMOVED_SKILL_FILES}. */
export type ComplianceOffRemovedSkillFile = (typeof COMPLIANCE_OFF_REMOVED_SKILL_FILES)[number];
