import { describe, it, expect } from 'vitest'
import { loadFile, extractSection } from '../decisions/helpers'

// -------------------------------------------------------------------------
// Group 1: reviewer.md — convergence inputs
// -------------------------------------------------------------------------

describe('reviewer.md — convergence inputs', () => {
  const content = loadFile('shared/agents/reviewer.md')

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
})

// -------------------------------------------------------------------------
// Group 2: code-review.md — convergence gate
// -------------------------------------------------------------------------

describe('code-review.md — convergence gate', () => {
  const content = loadFile('plugins/devflow-code-review/commands/code-review.md')

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
    expect(idx0d).toBeGreaterThan(idx0c)
    expect(idx0d).toBeLessThan(idxPhase1)
  })

  it('Step 0d-ii documents fp_ratio formula with correct denominator', () => {
    const step0d = extractSection(content, 'Step 0d-ii', '### Phase 1:')
    expect(step0d).toMatch(/fp_count\s*\/\s*\(fp_count\s*\+\s*fixed_count\s*\+\s*deferred_count\)/)
  })

  it('Step 0d-ii documents --full bypass', () => {
    const step0d = extractSection(content, 'Step 0d-ii', '### Phase 1:')
    expect(step0d).toContain('--full')
  })

  it('Step 0d-i documents (none) default for first review', () => {
    const step0d = extractSection(content, 'Step 0d-i', 'Step 0d-ii')
    expect(step0d).toContain('(none)')
  })

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
// Group 3: code-review-teams.md — convergence parity
// -------------------------------------------------------------------------

describe('code-review-teams.md — convergence parity', () => {
  const content = loadFile('plugins/devflow-code-review/commands/code-review-teams.md')

  it('has Step 0d-i and Step 0d-ii', () => {
    expect(content).toContain('Step 0d-i')
    expect(content).toContain('Step 0d-ii')
  })

  it('convergence gate ordered between Step 0c and Phase 1', () => {
    const idx0c = content.indexOf('Step 0c')
    const idx0d = content.indexOf('Step 0d')
    const idxPhase1 = content.indexOf('### Phase 1:')
    expect(idx0d).toBeGreaterThan(idx0c)
    expect(idx0d).toBeLessThan(idxPhase1)
  })

  it('passes PRIOR_RESOLUTIONS to reviewer teammates', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 2b:')
    expect(phase2).toContain('PRIOR_RESOLUTIONS')
  })

  it('passes CYCLE_NUMBER to Synthesizer/Lead', () => {
    const phase3 = extractSection(content, '### Phase 3:', '### Phase 4:')
    expect(phase3).toContain('CYCLE_NUMBER')
  })

  it('documents --full bypass', () => {
    const step0d = extractSection(content, 'Step 0d-ii', '### Phase 1:')
    expect(step0d).toContain('--full')
  })

  it('has cross-reference comment to code-review.md', () => {
    expect(content).toMatch(/code-review\.md/)
    expect(content).toMatch(/[Cc]onvergence.*sync|sync.*[Cc]onvergence|mirror/i)
  })
})

// -------------------------------------------------------------------------
// Group 4: review:orch SKILL.md — convergence phase
// -------------------------------------------------------------------------

describe('review:orch SKILL.md — convergence phase', () => {
  const content = loadFile('shared/skills/review:orch/SKILL.md')

  it('has Phase 2b between Phase 2 and Phase 3', () => {
    const idx2 = content.indexOf('## Phase 2:')
    const idx2b = content.indexOf('## Phase 2b')
    const idx3 = content.indexOf('## Phase 3:')
    expect(idx2b).toBeGreaterThan(idx2)
    expect(idx2b).toBeLessThan(idx3)
  })

  it('Phase 2b has Produces/Requires annotations', () => {
    const phase2b = extractSection(content, '## Phase 2b', '## Phase 3')
    expect(phase2b).toContain('**Produces:**')
    expect(phase2b).toContain('**Requires:**')
  })

  it('Phase 2b references fp_ratio computation', () => {
    const phase2b = extractSection(content, '## Phase 2b', '## Phase 3')
    expect(phase2b).toMatch(/fp_ratio/)
  })

  it('Phase 5 passes PRIOR_RESOLUTIONS to reviewers', () => {
    const phase5 = extractSection(content, '## Phase 5:', '## Phase 6:')
    expect(phase5).toContain('PRIOR_RESOLUTIONS')
  })

  it('Phase 6 passes CYCLE_NUMBER to Synthesizer', () => {
    const phase6 = extractSection(content, '## Phase 6:', '## Phase 7:')
    expect(phase6).toContain('CYCLE_NUMBER')
  })

  it('Phase Completion Checklist includes Phase 2b', () => {
    const checklist = extractSection(content, '## Phase Completion Checklist', null)
    expect(checklist).toContain('Phase 2b')
  })
})

// -------------------------------------------------------------------------
// Group 5: synthesizer.md — convergence status
// -------------------------------------------------------------------------

describe('synthesizer.md — convergence status', () => {
  const content = loadFile('shared/agents/synthesizer.md')

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
// Group 6: Cross-cutting convergence consistency
// -------------------------------------------------------------------------

describe('Cross-cutting convergence consistency', () => {
  const reviewer = loadFile('shared/agents/reviewer.md')
  const codeReview = loadFile('plugins/devflow-code-review/commands/code-review.md')
  const teamsReview = loadFile('plugins/devflow-code-review/commands/code-review-teams.md')
  const reviewOrch = loadFile('shared/skills/review:orch/SKILL.md')
  const synthesizer = loadFile('shared/agents/synthesizer.md')

  it('all 3 orchestration surfaces contain PRIOR_RESOLUTIONS', () => {
    expect(codeReview).toContain('PRIOR_RESOLUTIONS')
    expect(teamsReview).toContain('PRIOR_RESOLUTIONS')
    expect(reviewOrch).toContain('PRIOR_RESOLUTIONS')
  })

  it('all 3 surfaces use <prior-resolution-summary> containment markers', () => {
    expect(codeReview).toContain('prior-resolution-summary')
    expect(teamsReview).toContain('prior-resolution-summary')
    expect(reviewOrch).toContain('prior-resolution-summary')
  })

  it('all 3 surfaces document (none) default', () => {
    expect(codeReview).toMatch(/PRIOR_RESOLUTIONS.*\(none\)|set.*PRIOR_RESOLUTIONS.*\(none\)/is)
    expect(teamsReview).toMatch(/PRIOR_RESOLUTIONS.*\(none\)|set.*PRIOR_RESOLUTIONS.*\(none\)/is)
    expect(reviewOrch).toMatch(/PRIOR_RESOLUTIONS.*\(none\)|set.*PRIOR_RESOLUTIONS.*\(none\)/is)
  })

  it('FP ratio formula consistent across surfaces that compute it', () => {
    const formula = /fp_count\s*\/\s*\(fp_count\s*\+\s*fixed_count\s*\+\s*deferred_count\)/
    expect(codeReview).toMatch(formula)
    expect(teamsReview).toMatch(formula)
    expect(reviewOrch).toMatch(formula)
  })

  it('maximum cycle bound documented in all orchestration surfaces', () => {
    expect(codeReview).toMatch(/CYCLE_NUMBER\s*>=?\s*3|cycle\s*>=?\s*3/i)
    expect(teamsReview).toMatch(/CYCLE_NUMBER\s*>=?\s*3|cycle\s*>=?\s*3/i)
    expect(reviewOrch).toMatch(/CYCLE_NUMBER\s*>=?\s*3|cycle\s*>=?\s*3/i)
  })

  it('synthesizer FP note threshold matches orchestration surfaces (>= 3)', () => {
    expect(synthesizer).toMatch(/CYCLE_NUMBER\s*>=?\s*3/)
  })

  it('reviewer.md and synthesizer.md both reference convergence concepts', () => {
    expect(reviewer).toMatch(/[Cc]onvergence|[Cc]ross.[Cc]ycle/)
    expect(synthesizer).toMatch(/[Cc]onvergence/)
  })

  it('--full bypass documented in both command files', () => {
    const crStep0d = extractSection(codeReview, 'Step 0d', '### Phase 1:')
    const trStep0d = extractSection(teamsReview, 'Step 0d', '### Phase 1:')
    expect(crStep0d).toContain('--full')
    expect(trStep0d).toContain('--full')
  })
})
