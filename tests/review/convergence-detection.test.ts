import { describe, it, expect } from 'vitest'
import { loadFile, extractSection, computeFpRatio, readAgentReference, resolveAgentSource, requireDistFile, resolveCurationOffSource, sectionBetween } from '../helpers'
import { countOf, seedOnce } from '../guards/level-guard-helpers'

// -------------------------------------------------------------------------
// Group 1: review.md — convergence inputs
// -------------------------------------------------------------------------

describe('review.md — convergence inputs', () => {
  const content = resolveAgentSource('review').content

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

  it('has Step 0e-i (Load Prior Resolution)', () => {
    expect(content).toContain('Step 0e-i')
    expect(content).toMatch(/[Ll]oad [Pp]rior [Rr]esolution/)
  })

  it('has Step 0e-ii (Convergence Assessment)', () => {
    expect(content).toContain('Step 0e-ii')
    expect(content).toMatch(/[Cc]onvergence [Aa]ssessment/)
  })

  it('convergence steps (0e-i, 0e-ii) are after Step 0d and before Phase 1', () => {
    const idx0d = content.indexOf('Step 0d')
    const idx0ei = content.indexOf('Step 0e-i')
    const idx0eii = content.indexOf('Step 0e-ii')
    const idxPhase1 = content.indexOf('### Phase 1:')
    expect(idx0d).not.toBe(-1)
    expect(idx0ei).not.toBe(-1)
    expect(idx0eii).not.toBe(-1)
    expect(idxPhase1).not.toBe(-1)
    expect(idx0ei).toBeGreaterThan(idx0d)
    expect(idx0eii).toBeGreaterThan(idx0d)
    expect(idx0ei).toBeLessThan(idxPhase1)
    expect(idx0eii).toBeLessThan(idxPhase1)
  })

  it('Step 0e-ii documents fp_ratio formula with correct denominator', () => {
    const step0d = extractSection(content, 'Step 0e-ii', '### Phase 1:')
    expect(step0d).toMatch(/fp_count\s*\/\s*\(fp_count\s*\+\s*fixed_count\s*\+\s*deferred_count\)/)
  })

  it('Step 0e-i documents --full loading PRIOR_RESOLUTIONS', () => {
    const step0d = extractSection(content, 'Step 0e-i', 'Step 0e-ii')
    expect(step0d).toContain('--full')
  })

  it('Step 0e-i documents (none) default for first review', () => {
    const step0d = extractSection(content, 'Step 0e-i', 'Step 0e-ii')
    expect(step0d).toContain('(none)')
  })

  // Intentional overlap with Group 6 all-surfaces check: this test pins PRIOR_RESOLUTIONS
  // to Phase 2 specifically, while Group 6 verifies whole-file presence across all surfaces.
  it('Phase 2 passes PRIOR_RESOLUTIONS to Review agents with containment markers', () => {
    const phase2 = extractSection(content, '### Phase 2:', '### Phase 3:')
    expect(phase2).toContain('PRIOR_RESOLUTIONS')
    expect(phase2).toContain('prior-resolution-summary')
  })

  it('Phase 3 passes CYCLE_NUMBER to the Synthesize agent', () => {
    const phase3 = extractSection(content, '### Phase 3:', '### Phase 4:')
    expect(phase3).toContain('CYCLE_NUMBER')
  })
})

// -------------------------------------------------------------------------
// Group 4: synthesize.md — convergence status
// -------------------------------------------------------------------------

describe('synthesize review mode — convergence status', () => {
  // D-MODE-BY-PATH: the review template lives in the review mode reference, not the agent body.
  const content = readAgentReference('synthesize/review.md')

  it('review mode mentions convergence or Convergence Status', () => {
    const reviewMode = extractSection(content, '## Mode: Review', null)
    expect(reviewMode).toMatch(/[Cc]onvergence/)
  })

  it('output template includes Convergence Status section', () => {
    const reviewMode = extractSection(content, '## Mode: Review', null)
    expect(reviewMode).toContain('## Convergence Status')
  })

  it('Convergence Status includes cycle number and FP ratio fields', () => {
    const reviewMode = extractSection(content, '## Mode: Review', null)
    expect(reviewMode).toMatch(/cycle.number|cycle_number|Cycle/i)
    expect(reviewMode).toMatch(/FP.*[Rr]atio|fp_ratio/)
  })

  it('documents conditional merge note for high FP ratio', () => {
    const reviewMode = extractSection(content, '## Mode: Review', null)
    expect(reviewMode).toMatch(/[Ff]alse.positive.*ratio|FP ratio/)
    expect(reviewMode).toMatch(/manual|merge/i)
  })
})

// -------------------------------------------------------------------------
// Group 6: Cross-cutting convergence consistency (single command surface)
// -------------------------------------------------------------------------

describe('Cross-cutting convergence consistency', () => {
  const reviewAgent = resolveAgentSource('review').content
  const codeReview = loadFile('dist/commands/code-review.md')
  const synthesizeAgent = readAgentReference('synthesize/review.md')

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

  it('synthesize agent FP note threshold matches command surface (>= 3)', () => {
    expect(synthesizeAgent).toMatch(/CYCLE_NUMBER\s*>=?\s*3/)
  })

  it('review.md and synthesize.md both reference convergence concepts', () => {
    expect(reviewAgent).toMatch(/[Cc]onvergence|[Cc]ross.[Cc]ycle/)
    expect(synthesizeAgent).toMatch(/[Cc]onvergence/)
  })

  it('--full documented in Step 0e-i of code-review', () => {
    const crStep0di = extractSection(codeReview, 'Step 0e-i', 'Step 0e-ii')
    expect(crStep0di).toContain('--full')
  })

  it('no AskUserQuestion in convergence section of code-review', () => {
    const crStep0dii = extractSection(codeReview, 'Step 0e-ii', '### Phase 1:')
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

// -------------------------------------------------------------------------
// Group 8: private sections stay out of posted summaries — the writer lines and the prior-summary clause
//
// The Synthesize review template and /resolve Phase 5 tell the writer where text not for public posting
// goes. /code-review Step 0e-i drops those sections from the prior resolution summary before any agent
// reads it. One collector reads every file: both builds of /resolve and /code-review plus the template.
// Each read is loud, so a missing build fails the file instead of skipping it.
// -------------------------------------------------------------------------

const WRITER_LINE = 'Put text not for public posting in a final `## Private notes` section.'
const RESOLVE_TEMPLATE_LINE = 'Use the template from the Output Artifact section below.'
const PRIOR_SUMMARY_NEEDLES = [
  'fenced or not',
  'any case',
  'starting `Private`',
  'to the next unfenced heading with as many `#` or fewer',
  'Close any fence it leaves open',
] as const
const STEP_4_OPENER = '4. Otherwise: set CYCLE_NUMBER = count + 1.'

type PrivateMarkerKind = 'synthesize' | 'resolve' | 'code-review'
interface PrivateMarkerFile { readonly label: string; readonly kind: PrivateMarkerKind; readonly body: string }

function curationOffCommand(name: string): string {
  const body = resolveCurationOffSource('commands', name)
  if (body === null) throw new Error(`dist/curation-off/commands/${name}.md is absent: run \`npm run build:mds\``)
  return body
}

const PRIVATE_MARKER_FILES: readonly PrivateMarkerFile[] = [
  { label: 'synthesize/review.md', kind: 'synthesize', body: readAgentReference('synthesize/review.md') },
  { label: 'resolve.md (curation on)', kind: 'resolve', body: requireDistFile('resolve.md') },
  { label: 'resolve.md (curation off)', kind: 'resolve', body: curationOffCommand('resolve') },
  { label: 'code-review.md (curation on)', kind: 'code-review', body: requireDistFile('code-review.md') },
  { label: 'code-review.md (curation off)', kind: 'code-review', body: curationOffCommand('code-review') },
]

/** Where each file keeps its line: the cut of the file that must hold it. */
const PRIVATE_MARKER_SCOPES: Readonly<Record<PrivateMarkerKind, { readonly name: string; readonly start: string; readonly end: string }>> = {
  synthesize: { name: 'Output list', start: '**Output:**', end: 'Report format:' },
  resolve: { name: 'Phase 5', start: '### Phase 5: Write resolution-summary.md', end: '### Phase 6: Polish' },
  'code-review': { name: 'Step 0e-i', start: '#### Step 0e-i: Load Prior Resolution and Count Cycles', end: '#### Step 0e-ii: Convergence Assessment' },
}

/**
 * How a file falls short of the private-section lines: the Synthesize Output list holds the writer line as its third
 * item, /resolve Phase 5 holds it once right after the template sentence, and /code-review Step 0e-i step 4 states the
 * grammar of the cut (fenced or not, any case, a heading starting `Private`, ending at the next unfenced heading with as
 * many `#` or fewer). A file whose cut is absent is one defect, never a skip.
 */
function collectPrivateMarkerDefects(files: readonly PrivateMarkerFile[]): string[] {
  const out: string[] = []
  for (const { label, kind, body } of files) {
    const scope = PRIVATE_MARKER_SCOPES[kind]
    const part = sectionBetween(body, scope.start, scope.end)
    if (part === null) {
      out.push(`${label}: the ${scope.name} cut is absent`)
      continue
    }
    if (kind === 'code-review') {
      const step4 = part.split('\n').find(line => line.startsWith(STEP_4_OPENER))
      if (step4 === undefined) {
        out.push(`${label}: ${scope.name} has no step 4 line`)
        continue
      }
      for (const needle of PRIOR_SUMMARY_NEEDLES) {
        if (!step4.includes(needle)) out.push(`${label}: ${scope.name} step 4 lacks "${needle}"`)
      }
      continue
    }
    const expected = kind === 'synthesize' ? `\n3. ${WRITER_LINE}\n` : `${RESOLVE_TEMPLATE_LINE} ${WRITER_LINE}\n`
    if (countOf(part, expected) !== 1) out.push(`${label}: the ${scope.name} lacks the writer line in its place`)
    if (countOf(part, WRITER_LINE) !== 1) out.push(`${label}: the ${scope.name} holds ${countOf(part, WRITER_LINE)} writer lines, expected 1`)
  }
  return out
}

/** The corpus with one file's body edited, so a probe runs through the same collector as the shipped files. */
function withEditedFile(label: string, edit: (body: string) => string): PrivateMarkerFile[] {
  expect(PRIVATE_MARKER_FILES.map(f => f.label), `${label} must be a corpus file`).toContain(label)
  return PRIVATE_MARKER_FILES.map(f => (f.label === label ? { ...f, body: edit(f.body) } : f))
}

describe('private sections stay out of posted summaries — writer lines and the prior-summary clause', () => {
  it('reads the template, /resolve and /code-review in both builds, and every file holds its line', () => {
    expect(PRIVATE_MARKER_FILES.map(f => f.label)).toEqual([
      'synthesize/review.md',
      'resolve.md (curation on)',
      'resolve.md (curation off)',
      'code-review.md (curation on)',
      'code-review.md (curation off)',
    ])
    expect(collectPrivateMarkerDefects(PRIVATE_MARKER_FILES)).toEqual([])
  })

  const CODE_REVIEW_CLAUSE = ' minus each section from a heading line (fenced or not, any case) starting `Private` to the next unfenced heading with as many `#` or fewer. Close any fence it leaves open'
  const SEEDED_REMOVALS: Readonly<Record<PrivateMarkerKind, { readonly remove: (body: string) => string; readonly defects: (label: string) => string[] }>> = {
    synthesize: {
      remove: body => seedOnce(body, `3. ${WRITER_LINE}\n`, ''),
      defects: label => [`${label}: the Output list lacks the writer line in its place`, `${label}: the Output list holds 0 writer lines, expected 1`],
    },
    resolve: {
      remove: body => seedOnce(body, ` ${WRITER_LINE}`, ''),
      defects: label => [`${label}: the Phase 5 lacks the writer line in its place`, `${label}: the Phase 5 holds 0 writer lines, expected 1`],
    },
    'code-review': {
      remove: body => seedOnce(body, CODE_REVIEW_CLAUSE, ''),
      defects: label => PRIOR_SUMMARY_NEEDLES.map(needle => `${label}: Step 0e-i step 4 lacks "${needle}"`),
    },
  }

  it.each(PRIVATE_MARKER_FILES)('known-bad probe, $label: removing its line is reported for that file alone', ({ label, kind }) => {
    const seeded = withEditedFile(label, SEEDED_REMOVALS[kind].remove)
    expect(collectPrivateMarkerDefects(seeded)).toEqual(SEEDED_REMOVALS[kind].defects(label))
  })

  it.each(PRIVATE_MARKER_FILES.filter(f => f.kind === 'resolve'))('known-bad probe, $label: a writer line before the template sentence is reported', ({ label }) => {
    const seeded = withEditedFile(label, body => seedOnce(body, `${RESOLVE_TEMPLATE_LINE} ${WRITER_LINE}`, `${WRITER_LINE} ${RESOLVE_TEMPLATE_LINE}`))
    expect(collectPrivateMarkerDefects(seeded)).toEqual([`${label}: the Phase 5 lacks the writer line in its place`])
  })

  it.each(PRIVATE_MARKER_FILES.filter(f => f.kind === 'code-review').flatMap(f => PRIOR_SUMMARY_NEEDLES.map(needle => ({ label: f.label, needle }))))(
    'known-bad probe, $label: step 4 without "$needle" is reported',
    ({ label, needle }) => {
      const seeded = withEditedFile(label, body => {
        const step4 = body.split('\n').find(line => line.startsWith(STEP_4_OPENER))
        if (step4 === undefined) throw new Error(`${label}: no step 4 line to seed`)
        return seedOnce(body, step4, step4.replace(needle, 'x'))
      })
      expect(collectPrivateMarkerDefects(seeded)).toEqual([`${label}: Step 0e-i step 4 lacks "${needle}"`])
    },
  )
})
