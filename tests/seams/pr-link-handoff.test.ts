import { describe, it, expect } from 'vitest'
import { resolveAgentSource } from '../helpers.js'

// -------------------------------------------------------------------------
// `### Handoff Values` — Git agent producer ↔ Code agent consumer (P2-S10, GAP-15).
//
// GAP-15 found `ISSUE_PR_LINK` and `ISSUE_BRANCH_TOKEN` consumed with no
// producer anywhere: the Code agent's ALWAYS-ON `Closes #{n}` rule had nothing
// to paste, and failed silently on the GitHub path too. T2b added the producers
// to setup-task and fetch-issue; this file pins both ends of that seam so a
// later edit cannot drop one side and leave the other looking healthy.
//
// The failure mode a one-sided guard misses: a guard that only checks git.md
// stays green when code.md stops consuming the block, and a guard that only
// checks code.md stays green when git.md stops emitting it. Either way the PR
// body silently loses its issue link — the exact defect, restored.
//
// Read targets are resolved through resolveAgentSource (never a literal
// src/assets/agents/ path — AC-0.7): git.md is compiled from an MDS generator
// host, code.md is hand-authored, and the resolver knows the difference.
//
// Header doctrine and framing copied from tests/resolve/duplicate-verdict.test.ts:4-15
// (the repo's original two-sided producer/consumer test).
// -------------------------------------------------------------------------

const GIT = resolveAgentSource('git').content
const CODE = resolveAgentSource('code').content

/** The three producer lines, verbatim as git.md emits them under ### Handoff Values. */
const PRODUCER_LINES = [
  '- **PR link line**: {rendered}',
  '- **Branch token**: {token}',
  '- **Issue ID**: {ISSUE_ID}',
] as const

describe('git.md — ### Handoff Values producer block', () => {
  it('is non-vacuous', () => {
    expect(GIT.length).toBeGreaterThan(10000)
  })

  it('emits all three handoff values under a ### Handoff Values heading', () => {
    expect(GIT, 'the producer block must be headed so a reader can find it').toContain('### Handoff Values')
    for (const line of PRODUCER_LINES) {
      expect(
        GIT,
        `git.md must emit ${line} — the Code agent reads it by this exact label, not by prose`,
      ).toContain(line)
    }
  })

  it('emits the block from both issue-returning operations, not just one', () => {
    // setup-task and fetch-issue are separate entry points into /implement.
    // A block on only one of them makes the Code agent's paste rule depend on
    // which command the user ran.
    const count = GIT.split('### Handoff Values').length - 1
    expect(
      count,
      'both setup-task and fetch-issue must carry the block — one copy means one of the two entry points returns nothing to paste',
    ).toBeGreaterThanOrEqual(2)
  })
})

describe('code.md — ### Handoff Values consumer', () => {
  it('is non-vacuous', () => {
    expect(CODE.length).toBeGreaterThan(5000)
  })

  it('names the PR-link producer by its producer label', () => {
    expect(
      CODE,
      'the consumer must name `- **PR link line**:` — naming only the variable would not survive a producer relabel',
    ).toContain('- **PR link line**:')
    expect(
      CODE,
      'the consumer must name `- **Branch token**:` for the same reason',
    ).toContain('- **Branch token**:')
  })

  it('re-checks the shape before pasting, and degrades instead of coercing', () => {
    expect(
      CODE,
      'the PR body is a GitHub-visible sink; a returned value is still attacker-influenceable at the paste site',
    ).toContain('^Closes #[1-9][0-9]{0,8}$')
    expect(
      CODE,
      'a foreign-shaped ref must emit the canonical DEGRADED reason, never be silently repaired or dropped',
    ).toContain('does not match github reference grammar')
  })

  it('re-checks BEFORE it pastes — order, not mere presence', () => {
    const recheck = CODE.indexOf('after re-checking its shape against the resolved provider')
    const degraded = CODE.indexOf('does not match github reference grammar')
    expect(recheck, 'the re-check instruction must exist').toBeGreaterThan(-1)
    expect(
      recheck,
      'the shape re-check must be stated as a precondition of the paste, not as an afterthought below the DEGRADED line',
    ).toBeLessThan(degraded)
  })
})

describe('handoff seam — git.md producer ↔ code.md consumer', () => {
  it('both sides spell the two pasted labels identically', () => {
    for (const label of ['- **PR link line**:', '- **Branch token**:']) {
      expect(GIT, `git.md must produce ${label}`).toContain(label)
      expect(CODE, `code.md must consume ${label}`).toContain(label)
    }
  })

  it('ISSUE_NUMBER is kept as the spawn key, with its value tied to the ISSUE_ID producer', () => {
    // §14.5: ISSUE_NUMBER (singular) is KEPT at every Code-spawn site; only its
    // VALUE becomes provider-canonical. A rename here would silently break all
    // 14 spawn sites, none of which this file can see.
    expect(CODE, 'the spawn key name must not be renamed').toContain('**ISSUE_NUMBER** (optional)')
    expect(
      CODE,
      'the input description must tie ISSUE_NUMBER to the producer that supplies it',
    ).toContain('- **Issue ID**: {ISSUE_ID}')
    expect(GIT, 'git.md must produce that exact line').toContain('- **Issue ID**: {ISSUE_ID}')
  })
})
