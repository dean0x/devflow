/**
 * tests/fixtures/issue-capture-contract.ts
 *
 * THE shared table of the values issue_capture_contract() names, each with the
 * producer literal the Git operation references emit. Two tests range over it:
 *
 *   - tests/seams/command-agent-input.test.ts (third direction) checks every
 *     producerPattern against the Output block of each op in producerOps.
 *   - tests/build-mds.test.ts (section 22) builds the capture phrases that a
 *     host with its own capture list must carry from the same rows.
 *
 * One table serves both, so a renamed label or producer literal fails the seam
 * test and the host guard together.
 *
 * Each entry names what git.md emits in its fetch-issue / fetch-issues-batch Output
 * template (the producer's vocabulary), NOT the variable name the plan command uses
 * (the consumer's vocabulary). Variable names like ISSUE_CONTENT, ACCEPTANCE_CRITERIA,
 * and ISSUE_REF never appear in git.md — they are plan.md's capture-side labels.
 * Searching DIST_FILES for them found only the consumer (plan.md's own capture line)
 * and called it the producer; that was the defect.
 *
 * ISSUE_URL stays excluded: no URL field is emitted by any Output template, so
 * listing it would declare an artifact with no reachable producer.
 * ISSUE_ID was excluded for the same reason in c7bff85 and is BACK from Phase 2:
 * the `### Handoff Values` block T2b added to setup-task and fetch-issue emits it
 * under its own label, so it now has a producer. Same for ISSUE_PR_LINK and
 * ISSUE_BRANCH_TOKEN — the two values GAP-15 found consumed with no producer.
 *
 * From Phase 2 onward this list is the compiled _tracker.mds issue_capture_contract()
 * define restated for the collector; both sides are asserted to name the same keys
 * by the `_tracker.mds define names the same keys` test of the seam file.
 *
 * PER-OP, not over a concatenation. The earlier form glued the fetch-issue and
 * fetch-issues-batch slices together and searched the join, so a key produced by
 * ONE of them read as produced by "the issue-fetching ops" — which is how the
 * three Handoff Values passed while `fetch-issues-batch` emitted none of them.
 * Each entry therefore names the operation(s) the partial says produce it, and
 * each is checked in each of those operations separately.
 *
 * Rows are data, never code.
 */

export interface IssueCaptureEntry {
  readonly label: string;
  readonly producerPattern: string;
  /** Every op whose Output template must carry `producerPattern`. */
  readonly producerOps: readonly string[];
}

export const ISSUE_CAPTURE_CONTRACT: readonly IssueCaptureEntry[] = [
  // The issue body is wrapped in <untrusted-issue-body> by every issue-bearing op
  // (Principle 8 containment, commit 75f13e7).
  {
    label: 'ISSUE_CONTENT',
    producerPattern: '<untrusted-issue-body>',
    producerOps: ['setup-task', 'fetch-issue', 'fetch-issues-batch'],
  },
  // "### Acceptance Criteria" heading in fetch-issue; "**Acceptance Criteria**:"
  // in the batch template and in setup-task's fetched-issue block.
  {
    label: 'ACCEPTANCE_CRITERIA',
    producerPattern: 'Acceptance Criteria',
    producerOps: ['setup-task', 'fetch-issue', 'fetch-issues-batch'],
  },
  // "## Issue {ISSUE_REF}:" heading in fetch-issue; "### Issue {ISSUE_REF1}:" in batch.
  // setup-task reports the number under "### Issue (if fetched)" and is NOT a
  // producer of the rendered-reference heading.
  {
    label: 'ISSUE_REF',
    producerPattern: '## Issue {ISSUE_REF',
    producerOps: ['fetch-issue', 'fetch-issues-batch'],
  },
  // The three `### Handoff Values` producers (P2-S10, written in T2b). Each is
  // matched on its full labelled prefix, not on the bare name: a prose mention of
  // "the branch token" elsewhere in the section must not satisfy the check.
  //
  // SINGLE-ISSUE OPS ONLY. A batch answers for many issues at once, so there is no
  // one PR link line and no one branch token to render; issue_capture_contract()
  // states that scope, and this roster is the mechanical half of it. Listing
  // fetch-issues-batch here would demand a block the batch has no well-defined
  // value for; omitting the scope sentence from the partial would leave the batch
  // flows capturing three values nothing emits (GAP-15's shape).
  {
    label: 'ISSUE_ID',
    producerPattern: '- **Issue ID**:',
    producerOps: ['setup-task', 'fetch-issue'],
  },
  {
    label: 'ISSUE_PR_LINK',
    producerPattern: '- **PR link line**:',
    producerOps: ['setup-task', 'fetch-issue'],
  },
  {
    label: 'ISSUE_BRANCH_TOKEN',
    producerPattern: '- **Branch token**:',
    producerOps: ['setup-task', 'fetch-issue'],
  },
];
