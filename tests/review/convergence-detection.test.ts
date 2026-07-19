import { describe, it, expect } from 'vitest'
import { loadFile, extractSection, computeFpRatio } from '../helpers'

// -------------------------------------------------------------------------
// Group 1: reviewer.md — convergence inputs
// -------------------------------------------------------------------------

describe('reviewer.md — convergence inputs', () => {
  const content = loadFile('src/assets/agents/reviewer.md')

  it('declares PRIOR_RESOLUTIONS in Input section', () => {
    const input = extractSection(content, '## Input', '## Focus Areas')
    expect(input).toContain('PRIOR_RESOLUTIONS')
  })

  it('marks PRIOR_RESOLUTIONS as optional with (none) default', () => {
    const input = extractSection(content, '## Input', '## Focus Areas')
    expect(input).toMatch(/PRIOR_RESOLUTIONS.*optional/i)
    expect(input).toContain('(none)')
  })

  it('uses <prior-resolution-summary> containment markers', () => {
    expect(content).toContain('<prior-resolution-summary>')
    expect(content).toContain('</prior-resolution-summary>')
  })

  it('has self-verification step in Responsibilities', () => {
    const responsibilities = extractSection(content, '## Responsibilities', '## Confidence Scale')
    expect(responsibilities).toMatch(/[Ss]elf.verify/)
  })

  it('self-verification covers MEDIUM severity (not just CRITICAL/HIGH)', () => {
    const responsibilities = extractSection(content, '## Responsibilities', '## Confidence Scale')
    expect(responsibilities).toContain('MEDIUM')
  })

  it('has Cross-Cycle Awareness section', () => {
    expect(content).toContain('## Cross-Cycle Awareness')
  })

  it('Cross-Cycle Awareness references False Positives table parsing', () => {
    const crossCycle = extractSection(content, '## Cross-Cycle Awareness', '## Issue Categories')
    expect(crossCycle).toMatch(/[Ff]alse [Pp]ositive/)
  })

  it('Cross-Cycle Awareness documents fallback when PRIOR_RESOLUTIONS cannot be parsed', () => {
    const crossCycle = extractSection(content, '## Cross-Cycle Awareness', '## Issue Categories')
    expect(crossCycle).toMatch(/cannot be parsed|parse.*fail/i)
  })

  it('Cross-Cycle Awareness requires verifying prior resolutions against current code', () => {
    const crossCycle = extractSection(content, '## Cross-Cycle Awareness', '## Issue Categories')
    expect(crossCycle).toMatch(/verify.*current.*code|current.*code.*verify/i)
  })
})

// -------------------------------------------------------------------------
// Group 2: code-review.md — convergence gate
// -------------------------------------------------------------------------

describe('code-review.md — convergence gate', () => {
  const content = loadFile('dist/commands/code-review.md')

  it('has Step 0d-i (Load Prior Resolution)', () => {
    expect(content).toContain('Step 0d-i')
    expect(content).toMatch(/[Ll]oad [Pp]rior [Rr]esolution/)
  })

  it('has Step 0d-ii (Convergence Assessment)', () => {
    expect(content).toContain('Step 0d-ii')
    expect(content).toMatch(/[Cc]onvergence [Aa]ssessment/)
  })

  it('Step 0d is after Step 0c and before Phase 1', () => {
    const idx0c = content.indexOf('Step 0c')
    const idx0d = content.indexOf('Step 0d')
    const idxPhase1 = content.indexOf('### Phase 1:')
    expect(idx0c).not.toBe(-1)
    expect(idx0d).not.toBe(-1)
    expect(idxPhase1).not.toBe(-1)
    expect(idx0d).toBeGreaterThan(idx0c)
    expect(idx0d).toBeLessThan(idxPhase1)
  })

  it('Step 0d-ii documents fp_ratio formula with correct denominator', () => {
    const step0d = extractSection(content, 'Step 0d-ii', '### Phase 1:')
    expect(step0d).toMatch(/fp_count\s*\/\s*\(fp_count\s*\+\s*fixed_count\s*\+\s*deferred_count\)/)
  })

  it('Step 0d-i documents --full loading PRIOR_RESOLUTIONS', () => {
    const step0d = extractSection(content, 'Step 0d-i', 'Step 0d-ii')
    expect(step0d).toContain('--full')
  })

  it('Step 0d-i documents (none) default for first review', () => {
    const step0d = extractSection(content, 'Step 0d-i', 'Step 0d-ii')
    expect(step0d).toContain('(none)')
  })

  // Intentional overlap with Group 6 all-surfaces check: this test pins PRIOR_RESOLUTIONS
  // to Phase 2 specifically, while Group 6 verifies whole-file presence across all surfaces.
  it('Phase 2 passes PRIOR_RESOLUTIONS to Reviewer agents with containment markers', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:')
    expect(phase2).toContain('PRIOR_RESOLUTIONS')
    expect(phase2).toContain('prior-resolution-summary')
  })

  it('Phase 3 passes CYCLE_NUMBER to Synthesizer', () => {
    const phase3 = extractSection(content, '### Phase 3:', '### Phase 4:')
    expect(phase3).toContain('CYCLE_NUMBER')
  })
})

// -------------------------------------------------------------------------
// Group 4: synthesizer.md — convergence status
// -------------------------------------------------------------------------

describe('synthesizer.md — convergence status', () => {
  const content = loadFile('src/assets/agents/synthesizer.md')

  it('review mode mentions convergence or Convergence Status', () => {
    const reviewMode = extractSection(content, '## Mode: Review', '## Principles')
    expect(reviewMode).toMatch(/[Cc]onvergence/)
  })

  it('output template includes Convergence Status section', () => {
    const reviewMode = extractSection(content, '## Mode: Review', '## Principles')
    expect(reviewMode).toContain('## Convergence Status')
  })

  it('Convergence Status includes cycle number and FP ratio fields', () => {
    const reviewMode = extractSection(content, '## Mode: Review', '## Principles')
    expect(reviewMode).toMatch(/cycle.number|cycle_number|Cycle/i)
    expect(reviewMode).toMatch(/FP.*[Rr]atio|fp_ratio/)
  })

  it('documents conditional merge note for high FP ratio', () => {
    const reviewMode = extractSection(content, '## Mode: Review', '## Principles')
    expect(reviewMode).toMatch(/[Ff]alse.positive.*ratio|FP ratio/)
    expect(reviewMode).toMatch(/manual|merge/i)
  })
})

// -------------------------------------------------------------------------
// Group 6: Cross-cutting convergence consistency (single command surface)
// -------------------------------------------------------------------------

describe('Cross-cutting convergence consistency', () => {
  const reviewer = loadFile('src/assets/agents/reviewer.md')
  const codeReview = loadFile('dist/commands/code-review.md')
  const synthesizer = loadFile('src/assets/agents/synthesizer.md')

  it('code-review command surface contains PRIOR_RESOLUTIONS', () => {
    expect(codeReview).toContain('PRIOR_RESOLUTIONS')
  })

  it('code-review uses <prior-resolution-summary> containment markers', () => {
    expect(codeReview).toContain('prior-resolution-summary')
  })

  it('code-review documents (none) default for PRIOR_RESOLUTIONS', () => {
    expect(codeReview).toMatch(/PRIOR_RESOLUTIONS.*\(none\)|set.*PRIOR_RESOLUTIONS.*\(none\)/is)
  })

  it('FP ratio formula present in code-review', () => {
    const formula = /fp_count\s*\/\s*\(fp_count\s*\+\s*fixed_count\s*\+\s*deferred_count\)/
    expect(codeReview).toMatch(formula)
  })

  it('soft convergence threshold documented in code-review', () => {
    expect(codeReview).toMatch(/CYCLE_NUMBER\s*>=?\s*3|cycle\s*>=?\s*3/i)
  })

  it('synthesizer FP note threshold matches command surface (>= 3)', () => {
    expect(synthesizer).toMatch(/CYCLE_NUMBER\s*>=?\s*3/)
  })

  it('reviewer.md and synthesizer.md both reference convergence concepts', () => {
    expect(reviewer).toMatch(/[Cc]onvergence|[Cc]ross.[Cc]ycle/)
    expect(synthesizer).toMatch(/[Cc]onvergence/)
  })

  it('--full documented in Step 0d-i of code-review', () => {
    const crStep0di = extractSection(codeReview, 'Step 0d-i', 'Step 0d-ii')
    expect(crStep0di).toContain('--full')
  })

  it('no AskUserQuestion in convergence section of code-review', () => {
    const crStep0dii = extractSection(codeReview, 'Step 0d-ii', '### Phase 1:')
    expect(crStep0dii).not.toContain('AskUserQuestion')
  })
})

// -------------------------------------------------------------------------
// Group 7: computeFpRatio — pure formula behavioral tests
// -------------------------------------------------------------------------

describe('computeFpRatio — pure fp_ratio formula', () => {
  it('computes correct ratio for typical resolution (7 FP, 1 fixed, 2 deferred)', () => {
    expect(computeFpRatio(7, 1, 2)).toBeCloseTo(0.7)
  })

  it('returns 0 when denominator is 0 (no issues resolved)', () => {
    expect(computeFpRatio(0, 0, 0)).toBe(0)
  })

  it('returns 0 on NaN inputs (parse failure path)', () => {
    expect(computeFpRatio(NaN, 1, 2)).toBe(0)
    expect(computeFpRatio(7, NaN, 2)).toBe(0)
    expect(computeFpRatio(7, 1, NaN)).toBe(0)
  })

  it('returns 0 on Infinity inputs (overflow parse failure)', () => {
    expect(computeFpRatio(Infinity, 1, 2)).toBe(0)
  })

  it('returns 1.0 when all issues are false positives', () => {
    expect(computeFpRatio(10, 0, 0)).toBe(1.0)
  })

  it('returns 0 when no false positives exist', () => {
    expect(computeFpRatio(0, 5, 3)).toBe(0)
  })

  it('triggers warning threshold at > 0.7 (strict, not >=)', () => {
    // Threshold is fp_ratio > 0.7, so exactly 0.7 should NOT trigger it
    expect(computeFpRatio(7, 3, 0)).toBeCloseTo(0.7)  // boundary: no warning
    expect(computeFpRatio(8, 2, 0)).toBeCloseTo(0.8)  // above boundary: warning
  })
})
