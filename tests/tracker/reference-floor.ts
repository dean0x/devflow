/**
 * The floor a tracker reference's content must clear, and its one owner.
 *
 * A zero-byte file is already refused by `splitVariantSections`' empty-section
 * arm; this floor catches the next shape up — a section that kept its heading and
 * lost its body, which compiles and ships and reads downstream as `tracker
 * mechanics unavailable` taken as the normal path.
 *
 * Three suites measure that one shape, one step apart, which is why they read one
 * constant instead of three:
 *   - tests/tracker/reference-reachability.test.ts floors the generated GitHub
 *     references, beside the parity check that says each of them must exist.
 *   - tests/tracker/linear-module.test.ts floors the generated Linear tree.
 *   - tests/tracker/jira-module.test.ts floors the generated Jira tree AND the
 *     `@define` BODY the generator reads, because a define that lost its body
 *     compiles into exactly the reference this floor exists to catch.
 *
 * Spelled at each site it is a number that can drift at one of them while every
 * other site and a presence-only guard stay green — the same argument the
 * `comment_cap` module define makes for the comment-body cap. So it has one owner
 * and every site imports it.
 *
 * Registered as the `min-reference-chars` FLOOR in tests/fixtures/numeric-floors.json:
 * every assertion reading it is `content.length < MIN_REFERENCE_CHARS` ⇒ problem, so
 * raising it makes all three suites stricter and lowering it re-admits the shape the
 * constant exists to catch.
 */
export const MIN_REFERENCE_CHARS = 80;
