import { describe, it, expect } from 'vitest'
import { loadFile, extractSection } from '../helpers'

// -------------------------------------------------------------------------
// triage.md — DUPLICATE verdict contract (agent side of the PF-024 seam)
//
// build-mds.test.ts §16b pins the DUPLICATE literals on the *caller* side
// (compiled dist/commands/resolve.md). Those guards stay green even if the
// Triage agent stops emitting the bucket the caller parses — the pipeline
// would then abort on every run with a completeness failure and no test
// would say why. This file pins the producer side of the same seam.
//
// Read target: src/assets/agents/triage.md (source of truth; agents install
// directly with no build step, so there is no compiled artifact to read).
// -------------------------------------------------------------------------

const TRIAGE = loadFile('src/assets/agents/triage.md')

describe('triage.md — duplicate grouping pre-pass', () => {
  it('is non-vacuous', () => {
    expect(TRIAGE.length).toBeGreaterThan(1000)
  })

  it('declares the pre-pass ahead of the disposition matrix', () => {
    const prePass = TRIAGE.indexOf('## Duplicate Grouping Pre-Pass')
    const matrix = TRIAGE.indexOf('## Blast-Radius Disposition Matrix')
    expect(prePass, 'pre-pass section heading must exist').toBeGreaterThan(-1)
    expect(matrix, 'matrix section heading must exist').toBeGreaterThan(-1)
    expect(
      prePass,
      'the pre-pass must precede the matrix — it selects which issues the matrix runs on',
    ).toBeLessThan(matrix)
  })

  it('forbids duplicate_of chaining', () => {
    const section = extractSection(TRIAGE, '## Duplicate Grouping Pre-Pass', '## Blast-Radius')
    expect(
      section,
      'duplicate_of must be pinned to a non-DUPLICATE primary — a chain makes outcome inheritance unresolvable',
    ).toContain('must reference a non-DUPLICATE issue')
  })

  it('applies the security gate to the whole group, not the primary alone', () => {
    const section = extractSection(TRIAGE, '## Duplicate Grouping Pre-Pass', '## Blast-Radius')
    expect(
      section,
      'a security member must not be collapsed into a non-security primary without the gate applying',
    ).toContain('Security Gate')
    expect(
      section,
      'a mixed security/non-security group must promote the security member to primary',
    ).toContain('the security member is always the primary')
  })

  it('restricts the matrix to group primaries', () => {
    const section = extractSection(TRIAGE, '## Duplicate Grouping Pre-Pass', '## Blast-Radius')
    expect(section).toContain("primary only")
  })
})

describe('triage.md — DUPLICATE verdict ledger', () => {
  const output = extractSection(TRIAGE, '## Output', '## Boundaries')

  it('emits a DUPLICATE bucket with a Duplicate Of column', () => {
    expect(output, 'ledger must carry a ### DUPLICATE bucket').toContain('### DUPLICATE')
    expect(
      output,
      'the DUPLICATE table must name its primary — the caller resolves inherited outcomes through it',
    ).toContain('Duplicate Of')
  })

  it('counts DUPLICATE in the summary tally', () => {
    expect(
      output,
      'the summary tally is the caller completeness check — DUPLICATE must be counted there',
    ).toContain('- DUPLICATE: {n}')
  })
})

describe('DUPLICATE seam — triage.md producer ↔ resolve.md consumer', () => {
  const RESOLVE = loadFile('src/assets/commands/resolve.mds')

  it('both sides name the same verdict and reference attribute', () => {
    for (const literal of ['DUPLICATE', 'duplicate_of']) {
      expect(TRIAGE, `triage.md must produce ${literal}`).toContain(literal)
      expect(RESOLVE, `resolve.mds must consume ${literal}`).toContain(literal)
    }
  })

  it('resolve.mds keeps DUPLICATE out of every non-Duplicates summary section', () => {
    expect(
      RESOLVE,
      'without this rule a duplicate of a FALSE_POSITIVE primary would be listed in ## False Positives ' +
        'while the Statistics row counted only the primary — section and row would disagree',
    ).toContain('DUPLICATE issues are listed **only** in `## Duplicates`')
  })
})
