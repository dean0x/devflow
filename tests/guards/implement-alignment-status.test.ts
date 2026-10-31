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
 * Phase 4 routes three Harden statuses: PASS and FIXED continue to Phase 5, and BLOCKED reports and halts. The same
 * arm follows them: any other status, and a report with no status, from a Harden that ran must stop the run and
 * report the status and its cause, and never read as PASS. A skipped Harden (the harden-scope bullet of the levels
 * reference) has no status to route, so the arm holds only for a Harden that ran.
 *
 * Every build of the command is read: curation on, curation off, compliance off, and both off. Each guard has a named
 * collector, a non-empty-corpus assertion and known-bad probes run through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { readAgentReference, requireDistFile, resolveVariantOffSource, sectionBetween } from '../helpers.js'

type OffKey = 'curation-off' | 'compliance-off' | 'both-off'

const PHASE5 = '### Phase 5: Alignment Check'
const PHASE6 = '### Phase 6: Validate'
const ALIGNED_BRANCH = '**If ALIGNED:**'
const MISALIGNED_BRANCH = '**If MISALIGNED:**'
const STEP_2 = '2. Increment `alignment_fix_count`'
const STEP_3 = '3. If `alignment_fix_count <= 2`:'
const STEP_4 = '4. If `alignment_fix_count > 2`:'
const ARM_LEAD = 'Any other or missing Status'
/** The line that follows the arm: a report for decision ends the pass, and the user's go starts Phase 6. */
const CONTINUE_LINE = 'After a report for decision, if the user decides to continue, start Phase 6.'

/** What the arm must say, as the label of the defect and the text that carries it. */
const ARM_PARTS: ReadonlyArray<readonly [label: string, text: string]> = [
  ['report the status, or "none" for a missing one', 'report the status or "none"'],
  ['report the cause', 'its cause'],
  ['halt', 'halt'],
  ['rule out ALIGNED', 'never ALIGNED'],
]

const PHASE4 = '### Phase 4: Self-Review'

/** The Phase 4 sentence that routes the three Harden statuses; the arm follows it and leaves it byte-equal. */
const HARDEN_STATUS_SENTENCE =
  'Harden agent reports `### Status: PASS | FIXED | BLOCKED`. **If BLOCKED:** report to user and halt. **If PASS or FIXED:** continue to Phase 5. A FIXED status commits fixes and starts no Validate of its own: the Phase 6 run covers them.'

/** What the Phase 4 arm must say, as the label of the defect and the text that carries it. */
const HARDEN_ARM_PARTS: ReadonlyArray<readonly [label: string, text: string]> = [
  ['report the status, or "none" for a missing one', 'report the status or "none"'],
  ['report the cause', 'its cause'],
  ['halt', 'halt'],
  ['rule out PASS', 'never PASS'],
  ['hold only for a Harden that ran, so a skipped Harden has no status to route', 'from a Harden that ran'],
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
 * halts and rules out ALIGNED. It also holds the one continue line: after a report for decision, the user's go starts
 * Phase 6.
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
  const continues = section.split('\n').filter(line => line === CONTINUE_LINE).length
  if (continues !== 1) defects.push(`Phase 5 holds the continue line ${continues} times, expected once`)
  return defects
}

/**
 * The defects of Phase 4 of one compiled /implement: the routed status sentence is whole, and one unindented arm follows
 * it that reports the status and its cause, halts, rules out PASS, and holds only for a Harden that ran.
 */
export function collectHardenStatusDefects(body: string): string[] {
  const section = sectionBetween(body, PHASE4, PHASE5)
  if (section === null) return ['Phase 4 is absent or does not end at Phase 5']

  const defects: string[] = []
  const status = section.indexOf(HARDEN_STATUS_SENTENCE)
  if (status === -1) defects.push('Phase 4 lost the routed status sentence')

  const arms = armLines(section)
  if (arms.length !== 1) {
    defects.push(`expected one unindented unrouted-status arm in Phase 4, found ${arms.length}`)
    return defects
  }
  const arm = arms[0] as string
  for (const [label, text] of HARDEN_ARM_PARTS) {
    if (!arm.includes(text)) defects.push(`the unrouted-status arm does not ${label}`)
  }
  if (status !== -1 && section.indexOf(arm) < status) defects.push('the unrouted-status arm sits before the routed status sentence')
  return defects
}

/**
 * The defects of the harden-scope bullet in the levels reference that make the Phase 4 arm silent on a skip: a skip
 * leaves Phase 4 skipped with `HARDEN_OUTPUT` reading `SKIPPED`, and the Skipped bullet lets the next phase start.
 */
export function collectHardenSkipDefects(levels: string): string[] {
  const bullet = levels.split('\n').find(line => line.startsWith('- **harden-scope:**'))
  if (bullet === undefined) return ['the levels reference has no harden-scope bullet']
  const defects: string[] = []
  if (!bullet.includes('Phase 4 counts as skipped under the Skipped bullet: `HARDEN_OUTPUT` reads `SKIPPED`')) defects.push('a Harden skip does not leave Phase 4 skipped with HARDEN_OUTPUT SKIPPED')
  if (!levels.includes('a skipped phase does not stop the run, and the next phase starts as written')) defects.push('a skipped phase may stop the run')
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

    it('reports a deleted continue line', () => {
      expect(collectAlignmentStatusDefects(seeded(`\n${CONTINUE_LINE}\n`, '\n'))).toEqual(['Phase 5 holds the continue line 0 times, expected once'])
    })

    it('reports a continue line that does not name the user decision', () => {
      expect(collectAlignmentStatusDefects(seeded(CONTINUE_LINE, CONTINUE_LINE.replace('if the user decides to continue, ', '')))).toEqual(['Phase 5 holds the continue line 0 times, expected once'])
    })

    it('reports a continue line that is repeated', () => {
      expect(collectAlignmentStatusDefects(seeded(CONTINUE_LINE, `${CONTINUE_LINE}\n${CONTINUE_LINE}`))).toEqual(['Phase 5 holds the continue line 2 times, expected once'])
    })
  })
})

describe('/implement Phase 4 stops on an unrouted Harden status', () => {
  it('reads four builds, each with a Phase 4 section that holds the routed status sentence', () => {
    for (const [label, body] of BUILDS) {
      const section = sectionBetween(body, PHASE4, PHASE5)
      expect(section, label).not.toBeNull()
      expect(section, label).toContain(HARDEN_STATUS_SENTENCE)
    }
  })

  it.each(BUILDS)('%s: Phase 4 holds one arm that reports and halts on any other or missing status of a Harden that ran', (label, body) => {
    expect(collectHardenStatusDefects(body), label).toEqual([])
  })

  it('the arm is silent on a skip: a skipped Harden leaves Phase 4 skipped, and the next phase starts as written', () => {
    expect(collectHardenSkipDefects(readAgentReference('commands/implement-levels.md'))).toEqual([])
  })

  describe('known-bad probes', () => {
    const [, real] = BUILDS[0] as readonly [string, string]
    const section = sectionBetween(real, PHASE4, PHASE5) as string
    const arm = armLines(section)[0] ?? '(Phase 4 holds no unrouted-status arm)'

    /** The compiled text with `from` replaced by `to`; fails when the seed does not land. */
    const seeded = (from: string, to: string): string => {
      expect(real.includes(from), `the seed ${JSON.stringify(from.slice(0, 40))} must land`).toBe(true)
      return real.replace(from, to)
    }

    it('reports a deleted arm', () => {
      expect(collectHardenStatusDefects(seeded(`\n${arm}\n`, '\n'))).toEqual([
        'expected one unindented unrouted-status arm in Phase 4, found 0',
      ])
    })

    it('reports an arm that is indented into the status line', () => {
      expect(collectHardenStatusDefects(seeded(`\n${arm}`, `\n   ${arm}`))).toEqual([
        'expected one unindented unrouted-status arm in Phase 4, found 0',
      ])
    })

    it('reports an arm that continues instead of halting', () => {
      expect(collectHardenStatusDefects(seeded(arm, arm.replace('halt', 'continue')))).toEqual(['the unrouted-status arm does not halt'])
    })

    it('reports an arm that does not rule out PASS', () => {
      expect(collectHardenStatusDefects(seeded(arm, arm.replace('; never PASS', '')))).toEqual(['the unrouted-status arm does not rule out PASS'])
    })

    it('reports an arm that drops the cause', () => {
      expect(collectHardenStatusDefects(seeded(arm, arm.replace(' and its cause', '')))).toEqual(['the unrouted-status arm does not report the cause'])
    })

    it('reports an arm that would fire on a skipped Harden', () => {
      expect(collectHardenStatusDefects(seeded(arm, arm.replace(' from a Harden that ran', '')))).toEqual([
        'the unrouted-status arm does not hold only for a Harden that ran, so a skipped Harden has no status to route',
      ])
    })

    it('reports an arm that sits before the routed status sentence', () => {
      const moved = seeded(`\n${arm}\n`, '\n').replace(HARDEN_STATUS_SENTENCE, `${arm}\n\n${HARDEN_STATUS_SENTENCE}`)
      expect(collectHardenStatusDefects(moved)).toEqual(['the unrouted-status arm sits before the routed status sentence'])
    })

    it('reports a lost status in the routed sentence', () => {
      expect(collectHardenStatusDefects(seeded('PASS | FIXED | BLOCKED', 'PASS | BLOCKED'))).toEqual(['Phase 4 lost the routed status sentence'])
    })

    it('reports a skip that no longer leaves Phase 4 skipped', () => {
      const levels = readAgentReference('commands/implement-levels.md')
      const from = 'Phase 4 counts as skipped under the Skipped bullet: `HARDEN_OUTPUT` reads `SKIPPED`'
      expect(levels.includes(from), 'the seed must land').toBe(true)
      expect(collectHardenSkipDefects(levels.replace(from, 'Phase 4 stops the run'))).toEqual([
        'a Harden skip does not leave Phase 4 skipped with HARDEN_OUTPUT SKIPPED',
      ])
    })
  })
})
