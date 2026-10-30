/**
 * tests/guards/implement-alignment-status.test.ts
 *
 * /implement Phase 5 stops on an Evaluate status that no branch routes.
 *
 * Phase 5 routes two statuses: ALIGNED continues to Phase 6, and MISALIGNED enters the alignment-fix loop. Any other
 * status, and a report with no status, must stop the run and report the status and its cause. Without that arm the
 * run has no rule for such a report and may read it as ALIGNED. Phases 6 and 8 carry the same arm for Validate, and
 * /self-review carries it for its Validate step.
 *
 * Every build of the command is read: curation on, curation off, compliance off, and both off. The guard has a named
 * collector, a non-empty-corpus assertion and known-bad probes run through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { requireDistFile, resolveVariantOffSource, sectionBetween } from '../helpers.js'

type OffKey = 'curation-off' | 'compliance-off' | 'both-off'

const PHASE5 = '### Phase 5: Alignment Check'
const PHASE6 = '### Phase 6: Validate'
const ALIGNED_BRANCH = '**If ALIGNED:**'
const MISALIGNED_BRANCH = '**If MISALIGNED:**'
const STEP_2 = '2. Increment `alignment_fix_count`'
const STEP_3 = '3. If `alignment_fix_count <= 2`:'
const STEP_4 = '4. If `alignment_fix_count > 2`:'
const ARM_LEAD = 'Any other or missing Status'

/** What the arm must say, as the label of the defect and the text that carries it. */
const ARM_PARTS: ReadonlyArray<readonly [label: string, text: string]> = [
  ['report the status, or "none" for a missing one', 'report the status or "none"'],
  ['report the cause', 'its cause'],
  ['halt', 'halt'],
  ['rule out ALIGNED', 'never ALIGNED'],
]

/** The compiled /implement of each of the four builds, by label. */
const BUILDS: ReadonlyArray<readonly [label: string, body: string]> = (() => {
  const off = (key: OffKey): string => {
    const text = resolveVariantOffSource(key, 'commands', 'implement')
    if (text === null) throw new Error(`the ${key} build of /implement is absent: run \`npm run build:mds\``)
    return text
  }
  return [
    ['curation on', requireDistFile('implement.md')],
    ['curation off', off('curation-off')],
    ['compliance off', off('compliance-off')],
    ['curation and compliance off', off('both-off')],
  ]
})()

/** The unindented lines of a section that open with the arm's lead words. */
function armLines(section: string): string[] {
  return section.split('\n').filter(line => line.startsWith(ARM_LEAD))
}

/**
 * The defects of Phase 5 of one compiled /implement: the section is present with both routed branches and the
 * alignment-fix steps, and it holds exactly one unindented arm after step 4 that reports the status and its cause,
 * halts and rules out ALIGNED.
 */
export function collectAlignmentStatusDefects(body: string): string[] {
  const section = sectionBetween(body, PHASE5, PHASE6)
  if (section === null) return ['Phase 5 is absent or does not end at Phase 6']

  const defects: string[] = []
  for (const [label, text] of [
    ['the ALIGNED branch', ALIGNED_BRANCH],
    ['the MISALIGNED branch', MISALIGNED_BRANCH],
    ['step 2 of the MISALIGNED branch', STEP_2],
    ['step 3 of the MISALIGNED branch', STEP_3],
    ['step 4 of the MISALIGNED branch', STEP_4],
  ] as const) {
    if (!section.includes(text)) defects.push(`Phase 5 lost ${label}`)
  }

  const arms = armLines(section)
  if (arms.length !== 1) {
    defects.push(`expected one unindented unrouted-status arm in Phase 5, found ${arms.length}`)
    return defects
  }
  const arm = arms[0] as string
  for (const [label, text] of ARM_PARTS) {
    if (!arm.includes(text)) defects.push(`the unrouted-status arm does not ${label}`)
  }
  const step4 = section.indexOf(STEP_4)
  if (step4 !== -1 && section.indexOf(arm) < step4) defects.push('the unrouted-status arm sits before step 4 of the MISALIGNED branch')
  return defects
}

describe('/implement Phase 5 stops on an unrouted Evaluate status', () => {
  it('reads four builds, each with a Phase 5 section that holds the routed branches', () => {
    expect(BUILDS.map(([label]) => label)).toEqual(['curation on', 'curation off', 'compliance off', 'curation and compliance off'])
    for (const [label, body] of BUILDS) {
      const section = sectionBetween(body, PHASE5, PHASE6)
      expect(section, label).not.toBeNull()
      expect(section, label).toContain(ALIGNED_BRANCH)
      expect(section, label).toContain(MISALIGNED_BRANCH)
    }
  })

  it.each(BUILDS)('%s: Phase 5 holds one arm that reports and halts on any other or missing status', (label, body) => {
    expect(collectAlignmentStatusDefects(body), label).toEqual([])
  })

  describe('known-bad probes', () => {
    const [, real] = BUILDS[0] as readonly [string, string]
    const section = sectionBetween(real, PHASE5, PHASE6) as string
    const arm = armLines(section)[0] ?? '(Phase 5 holds no unrouted-status arm)'

    /** The compiled text with `from` replaced by `to`; fails when the seed does not land. */
    const seeded = (from: string, to: string): string => {
      expect(real.includes(from), `the seed ${JSON.stringify(from.slice(0, 40))} must land`).toBe(true)
      return real.replace(from, to)
    }

    it('reports a deleted arm', () => {
      expect(collectAlignmentStatusDefects(seeded(`\n${arm}\n`, '\n'))).toEqual([
        'expected one unindented unrouted-status arm in Phase 5, found 0',
      ])
    })

    it('reports an arm that is indented into step 4', () => {
      expect(collectAlignmentStatusDefects(seeded(`\n${arm}`, `\n   ${arm}`))).toEqual([
        'expected one unindented unrouted-status arm in Phase 5, found 0',
      ])
    })

    it('reports an arm that continues instead of halting', () => {
      expect(collectAlignmentStatusDefects(seeded(arm, arm.replace('halt', 'continue')))).toEqual(['the unrouted-status arm does not halt'])
    })

    it('reports an arm that does not rule out ALIGNED', () => {
      expect(collectAlignmentStatusDefects(seeded(arm, arm.replace('; never ALIGNED', '')))).toEqual(['the unrouted-status arm does not rule out ALIGNED'])
    })

    it('reports an arm that drops the cause', () => {
      expect(collectAlignmentStatusDefects(seeded(arm, arm.replace(' and its cause', '')))).toEqual(['the unrouted-status arm does not report the cause'])
    })

    it('reports an arm that sits before step 4', () => {
      const moved = seeded(`\n${arm}\n`, '\n').replace(STEP_4, `${arm}\n${STEP_4}`)
      expect(collectAlignmentStatusDefects(moved)).toEqual(['the unrouted-status arm sits before step 4 of the MISALIGNED branch'])
    })

    it('reports a lost MISALIGNED step', () => {
      expect(collectAlignmentStatusDefects(seeded(STEP_2, '2. Count'))).toEqual(['Phase 5 lost step 2 of the MISALIGNED branch'])
    })
  })
})
