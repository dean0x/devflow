/**
 * D-PRELOAD-CLEANUP — an agent preloads only what its body reads on every spawn (#446).
 *
 * A preloaded skill is billed on every spawn of its agent, so each one has to be read by that agent
 * every time. Five were not, and each left with its need restated where the agent still reads it:
 *
 *   - Knowledge never receives `FEATURE_KNOWLEDGE`; it refreshes `EXISTING_KB`, so it drops
 *     `apply-feature-knowledge` and its own body says to check a kept assertion against the code;
 *   - Tracker holds its input rules in its Core rules, so it drops `boundary-validation`;
 *   - Synthesize reads no skill: the three review categories sit in its review mode as a table
 *     (`review-methodology` is gone), and its callers pass every output path (`docs-framework` is gone,
 *     with `/dynamic-tickets` stating the ticket slug rule itself, and `/plan` and `/research`
 *     loading the skill on the main thread where they name a document);
 *   - Triage drops `security` for D-TRIAGE-SECURITY-INLINE: the security-finding definition and the
 *     never-quote-a-live-secret rule, inline in about 400 bytes.
 *
 * Each check reads the compiled agent or command, the text the model receives, and every collector is
 * driven by a known-bad probe on the real text so it cannot pass by reading nothing.
 */

import { describe, expect, it } from 'vitest'

import { parseFrontmatterSkills, readAgentReference, requireDistFile, requireDistFiles, resolveAgentSource, resolveLearningOffSource } from '../helpers.js'

/** Skills each agent no longer preloads, in unprefixed form. */
const DROPPED: ReadonlyArray<readonly [string, string]> = [
  ['knowledge', 'apply-feature-knowledge'],
  ['tracker', 'boundary-validation'],
  ['synthesize', 'review-methodology'],
  ['synthesize', 'docs-framework'],
  ['triage', 'security'],
]

/** The preloads each of the four agents keeps after the cleanup, in file order. */
const KEPT: Readonly<Record<string, readonly string[]>> = {
  knowledge: ['feature-knowledge', 'apply-decisions', 'worktree-support'],
  tracker: ['git'],
  synthesize: ['worktree-support'],
  triage: ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
}

/** Named collector: preloads an agent still declares that the cleanup removed. */
export function collectRestoredPreloads(agent: string, content: string): string[] {
  const declared = parseFrontmatterSkills(content)
  return DROPPED.filter(([name, skill]) => name === agent && declared.includes(skill)).map(([, skill]) => `${agent} preloads ${skill}`)
}

/** Named collector: how a Triage body falls short of the inline security rule (D-TRIAGE-SECURITY-INLINE). */
export function collectTriageSecurityDefects(body: string): string[] {
  const out: string[] = []
  const paragraph = body.split('\n').find(line => line.startsWith('A security finding is one whose')) ?? ''
  if (paragraph === '') return ['no "A security finding is one whose" paragraph']
  for (const term of [
    '`security` focus', 'injection', 'unescaped sink', 'authn/authz', 'secrets or crypto', 'untrusted input',
    'deserialization or integrity', 'SSRF', 'supply-chain', 'check-then-act race',
  ]) {
    if (!paragraph.includes(term)) out.push(`the definition omits "${term}"`)
  }
  if (!/Never quote a live secret/.test(paragraph)) out.push('the live-secret rule is missing')
  if (!/recommend rotation/.test(paragraph)) out.push('the rule does not recommend rotation')
  const bytes = Buffer.byteLength(paragraph, 'utf-8')
  if (bytes > 450) out.push(`the paragraph is ${bytes} bytes, ceiling 450`)
  return out
}

/** Named collector: how Synthesize's review mode falls short of the inline category table. */
export function collectSynthesizeCategoryDefects(body: string): string[] {
  const out: string[] = []
  for (const row of [
    '| **Blocking** (1) | Lines added or modified in this branch |',
    '| **Should-Fix** (2) |',
    '| **Pre-existing** (3) | Lines the branch did not touch | Informational only; never blocks |',
  ]) {
    if (!body.includes(row)) out.push(`the category table lacks the row starting "${row.slice(0, 40)}"`)
  }
  for (const gone of ['devflow:review-methodology', 'devflow:docs-framework']) {
    if (body.includes(gone)) out.push(`the body still names ${gone}`)
  }
  return out
}

describe('agents drop the preloads their bodies never read (D-PRELOAD-CLEANUP)', () => {
  it.each(Object.keys(KEPT))('%s keeps exactly its remaining preload, in both curation variants', (agent) => {
    const variants = [resolveAgentSource(agent).content, resolveLearningOffSource('agents', agent) ?? resolveAgentSource(agent).content]
    for (const content of variants) {
      expect(collectRestoredPreloads(agent, content)).toEqual([])
      const declared = parseFrontmatterSkills(content)
      expect(declared.length, `${agent}: nothing was read`).toBeGreaterThan(0)
      expect(declared.every(skill => (KEPT[agent] as readonly string[]).includes(skill)), `${agent}: ${declared.join(', ')}`).toBe(true)
    }
  })

  it('the curation-on variants keep every preload the cleanup left, in order', () => {
    for (const [agent, kept] of Object.entries(KEPT)) {
      expect(parseFrontmatterSkills(resolveAgentSource(agent).content), agent).toEqual(kept)
    }
  })

  it('known-bad probe: a restored preload is reported by the same collector', () => {
    for (const [agent, skill] of DROPPED) {
      const real = resolveAgentSource(agent).content
      expect(collectRestoredPreloads(agent, real)).toEqual([])
      const seeded = real.replace(/^skills:\n/m, `skills:\n  - devflow:${skill}\n`)
      expect(seeded, 'the seed must land').not.toBe(real)
      expect(collectRestoredPreloads(agent, seeded)).toEqual([`${agent} preloads ${skill}`])
    }
  })
})

describe('Triage states the security rule inline (D-TRIAGE-SECURITY-INLINE, AC-503)', () => {
  it('both curation variants carry the definition and the live-secret rule within the byte ceiling', () => {
    const on = resolveAgentSource('triage').content
    const off = resolveLearningOffSource('agents', 'triage')
    expect(off, 'triage has a curation-off variant').not.toBeNull()
    expect(collectTriageSecurityDefects(on)).toEqual([])
    expect(collectTriageSecurityDefects(off ?? '')).toEqual([])
  })

  it('the paragraph sits inside the Security Gate step, before the FALSE_POSITIVE verdict', () => {
    const body = resolveAgentSource('triage').content
    const gate = body.indexOf('**0. SECURITY GATE')
    const definition = body.indexOf('A security finding is one whose')
    const falsePositive = body.indexOf('**1. FALSE_POSITIVE**')
    expect(gate).toBeGreaterThan(-1)
    expect(definition).toBeGreaterThan(gate)
    expect(falsePositive).toBeGreaterThan(definition)
  })

  it('known-bad probe: each lost term, a lost rule and a bloated paragraph are reported', () => {
    const real = resolveAgentSource('triage').content
    expect(collectTriageSecurityDefects(real)).toEqual([])
    expect(collectTriageSecurityDefects(real.replace('SSRF, ', ''))).toEqual(['the definition omits "SSRF"'])
    expect(collectTriageSecurityDefects(real.replace('Never quote a live secret', 'Quote a live secret'))).toEqual(['the live-secret rule is missing'])
    expect(collectTriageSecurityDefects(real.replace('and recommend rotation', 'and move on'))).toEqual(['the rule does not recommend rotation'])
    const bloated = real.replace('or a check-then-act race.', `or a check-then-act race. ${'x'.repeat(100)}`)
    expect(collectTriageSecurityDefects(bloated).some(d => d.includes('ceiling 450'))).toBe(true)
    expect(collectTriageSecurityDefects(real.replace('A security finding is one whose', 'Findings count as security when'))).toEqual([
      'no "A security finding is one whose" paragraph',
    ])
  })
})

/** What a Synthesize review spawn reads: the agent body, then the review mode's reference (D-MODE-BY-PATH). */
const synthesizeReviewText = (): string => `${resolveAgentSource('synthesize').content}\n${readAgentReference('synthesize/review.md')}`

describe('Synthesize carries the review categories inline (D-PRELOAD-CLEANUP)', () => {
  it('the review mode holds the three-row table and names neither skill it dropped', () => {
    expect(collectSynthesizeCategoryDefects(synthesizeReviewText())).toEqual([])
  })

  it('known-bad probe: a lost row and a restored skill name are each reported', () => {
    const real = synthesizeReviewText()
    expect(collectSynthesizeCategoryDefects(real)).toEqual([])
    const lostRow = real.replace(/^\| \*\*Should-Fix\*\* \(2\) \|.*$/m, '')
    expect(lostRow, 'the seed must land').not.toBe(real)
    expect(collectSynthesizeCategoryDefects(lostRow)).toEqual(['the category table lacks the row starting "| **Should-Fix** (2) |"'])
    expect(collectSynthesizeCategoryDefects(`${real}\nsee devflow:review-methodology\n`)).toEqual(['the body still names devflow:review-methodology'])
  })
})

describe('Knowledge still says to verify what it keeps (D-PRELOAD-CLEANUP)', () => {
  it('both variants tell it to check an EXISTING_KB assertion against current code and to trust the code', () => {
    const on = resolveAgentSource('knowledge').content
    const off = resolveLearningOffSource('agents', 'knowledge') ?? ''
    for (const body of [on, off]) {
      expect(body).toContain('EXISTING_KB is a snapshot: keep an assertion only after checking it against current code, and trust the code where they differ')
      expect(body).not.toContain('devflow:apply-feature-knowledge')
    }
  })
})

describe('/dynamic-tickets states its ticket slug rule itself (D-PRELOAD-CLEANUP)', () => {
  const RULE = "title.toLowerCase().replace(/[^a-z0-9]+/g, '-')"

  it('the tracking-issue phase names the rule the amend phase applies, so no preload supplies it', () => {
    const text = requireDistFile('dynamic-tickets.md')
    const amend = text.indexOf('Apply cross-set amendments to ticket')
    const tracking = text.indexOf('Write ticket files and a tracking-issue document')
    expect(amend, 'the amend phase was not found').toBeGreaterThan(-1)
    expect(tracking, 'the tracking-issue phase was not found').toBeGreaterThan(amend)
    expect(text.slice(amend, tracking), 'the amend phase applies the rule').toContain(RULE)
    expect(text.slice(tracking), 'the tracking-issue phase states it too').toContain(RULE)
    expect(text.slice(tracking)).toContain('${OUTDIR}/{ticket-slug}.md')
  })
})

describe('/plan and /research load docs-framework where they name a document (D-DOCS-NAMES-AUTHORITY)', () => {
  /** The lines of a compiled command that name the skill. */
  const loadLines = (text: string): string[] => text.split('\n').filter(line => line.includes('devflow:docs-framework'))

  it('/plan loads it once, in Phase 14 and before the design-document path is built', () => {
    const text = requireDistFile('plan.md')
    const hits = loadLines(text)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('Load via Skill tool: `devflow:docs-framework`')
    const phase = text.indexOf('#### Phase 14: Output')
    const load = text.indexOf(hits[0])
    const path = text.indexOf('**Pre-compute the artifact path**')
    expect(phase, 'Phase 14 was not found').toBeGreaterThan(-1)
    expect(load, 'the load comes after the Phase 14 heading').toBeGreaterThan(phase)
    expect(path, 'the path is built after the load').toBeGreaterThan(load)
  })

  it('/research loads it once, in Phase 2 and before the first output path is named', () => {
    const text = requireDistFile('research.md')
    const hits = loadLines(text)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('Load via Skill tool: `devflow:docs-framework`')
    const phase = text.indexOf('### Phase 2: Requirements')
    const load = text.indexOf(hits[0])
    const output = text.indexOf('- `OUTPUT_PATH`:')
    expect(phase, 'Phase 2 was not found').toBeGreaterThan(-1)
    expect(load, 'the load comes after the Phase 2 heading').toBeGreaterThan(phase)
    expect(output, 'the first output path comes after the load').toBeGreaterThan(load)
  })

  it('no other command and no agent names the skill: every other writer is handed its paths', () => {
    for (const file of requireDistFiles()) {
      if (file === 'plan.md' || file === 'research.md') continue
      expect(loadLines(requireDistFile(file)), file).toEqual([])
    }
  })
})
