/**
 * Never-cut presence guard for `/implement` (#675).
 *
 * `docs/reference/lean-prompts.md` lists the never-cut items of the command: text that a cut may move, never drop
 * or reword. This file holds the claim that each item of that list, from Principle 1 to the decisions context, is
 * in the compiled command, in the section that holds it today. The text is read from the compiled files, never
 * from the source, because the compiled file is what a user installs.
 *
 * The compiled command exists in four builds, one per curation and compliance switch. Each build reads
 * its own set of items, and the sets are data in this file (`ABSENT`):
 *   - A curation-off build has no decisions load, so it has no item that passes the decisions context (rows 11 and 16).
 *   - A compliance-off build has no evidence publish call, so it has no publish item (row 2b).
 * An item that a build has no arm for must be absent from that build, so a set that drifts from the text fails in
 * both directions.
 *
 * A row is one item: its number in the never-cut table (a letter marks one clause of an item that holds
 * several), the literal anchor (the shortest phrase from the compiled text that carries the rule) and the heading
 * that the anchor must sit under. The check needs the anchor exactly once, under that heading. A cut that moves an item
 * changes its row in the same commit.
 *
 * Each arm runs through a named collector, and a seeded probe feeds the same collector with a copy of the compiled text:
 *   - the deletion probe removes one anchor and asserts that the collector reports that row missing, and no other;
 *   - the section probe renames one heading and asserts that the collector reports each row under it as misplaced;
 *   - the absence probe feeds a build that holds an item to the collector for a build that has none.
 *
 * Rows 17 to 19 of the table need the skill folder and are not in this file.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, countOf } from '../helpers.js'

// ---------------------------------------------------------------------------
// The compiled builds
// ---------------------------------------------------------------------------

type VariantKey = 'on' | 'curation-off' | 'compliance-off' | 'both-off'

/** The four compiled files of the command, by the build that writes them. */
const BUILDS: ReadonlyArray<{ readonly key: VariantKey; readonly file: string }> = [
  { key: 'on', file: 'dist/commands/implement.md' },
  { key: 'curation-off', file: 'dist/curation-off/commands/implement.md' },
  { key: 'compliance-off', file: 'dist/compliance-off/commands/implement.md' },
  { key: 'both-off', file: 'dist/curation-compliance-off/commands/implement.md' },
]

/** A compiled file. An absent file means the build step did not run, and that is an error, never a skip. */
function readBuild(file: string): string {
  try {
    return readFileSync(path.join(ROOT, file), 'utf-8')
  } catch {
    throw new Error(`${file} is absent: run \`npm run build:mds\``)
  }
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

interface Row {
  /** The number of the item in the never-cut table; a letter marks one clause of an item that holds several. */
  readonly no: string
  readonly item: string
  /** The shortest phrase of the compiled text that carries the rule. */
  readonly anchor: string
  /** The nearest heading line above the anchor. */
  readonly section: string
}

const PRINCIPLES = '## Principles'
const ERROR_HANDLING = '## Error Handling'
const PHASE_1 = '### Phase 1: Setup'
const DECISIONS_LOAD = '### Load DECISIONS_CONTEXT'
const FEATURE_KNOWLEDGE_LOAD = '### Load Feature Knowledge'
const PHASE_2 = '### Phase 2: Implement'
const PHASE_5 = '### Phase 5: Alignment Check'
const PHASE_10 = '### Phase 10: CI Status Gate'

const ROWS: readonly Row[] = [
  {
    no: '1',
    item: 'Principle 1, orchestration only',
    anchor: 'never does work itself (no tests, builds or fixes); "Spawn X" means call the Agent tool',
    section: PRINCIPLES,
  },
  {
    no: '2a',
    item: 'Principle 1, inline calls: resolver, pushes and ci-wait',
    anchor: "the fresh base step's resolver calls (Phase 1, re-validation), the Phase 10 and 11 pushes, the Phase 10 ci-wait call",
    section: PRINCIPLES,
  },
  {
    no: '2b',
    item: 'Principle 1, inline calls: evidence publish call',
    anchor: 'the Phase 11 evidence publish call',
    section: PRINCIPLES,
  },
  {
    no: '3',
    item: 'Principle 2, honest reporting',
    anchor: 'Display agent outputs directly',
    section: PRINCIPLES,
  },
  {
    no: '4',
    item: 'Principle 3, loop limits',
    anchor: 'Max 2 validation retries, max 2 alignment fix iterations, max 2 QA retries before escalating to user; the CI gate allows at most 3 waits and 2 fixes',
    section: PRINCIPLES,
  },
  {
    no: '5',
    item: 'Principle 4, CI awareness',
    anchor: 'test-plan evidence (Phase 11) is recorded under every strategy',
    section: PRINCIPLES,
  },
  {
    no: '6',
    item: 'Error Handling rule',
    anchor: 'report the phase, agent type and error. Offer: retry the phase, investigate, or escalate to user',
    section: ERROR_HANDLING,
  },
  {
    no: '7',
    item: 'Empty-input rule',
    anchor: "Write the description yourself: one line, taken from the plan's title or, with no plan, from the conversation. Send it as the setup-task `TASK_DESCRIPTION` below.",
    section: PHASE_1,
  },
  {
    no: '8',
    item: 'Base-branch check',
    anchor: 'stop unless it passes the setup check',
    section: PHASE_1,
  },
  {
    no: '9',
    item: 'Handoff file deleted once the PR exists',
    anchor: 'Delete `{worktree}/.devflow/docs/handoff-{branch_slug}.md` once the PR exists — after Phase 9 (cleanup)',
    section: PHASE_2,
  },
  {
    no: '10a',
    item: 'Phase 5 alignment-fix counter',
    anchor: '2. Increment `alignment_fix_count`',
    section: PHASE_5,
  },
  {
    no: '10b',
    item: 'Phase 5 alignment-fix limit',
    anchor: '3. If `alignment_fix_count <= 2`:',
    section: PHASE_5,
  },
  {
    no: '10c',
    item: 'Phase 5 alignment-fix loop-back',
    anchor: 'Loop back to Phase 5 (re-check alignment)',
    section: PHASE_5,
  },
  {
    no: '10d',
    item: 'Phase 5 alignment-fix report to the user',
    anchor: '4. If `alignment_fix_count > 2`: Report misalignments to user for decision',
    section: PHASE_5,
  },
  {
    no: '11',
    item: 'DECISIONS_CONTEXT on the ci-fix spawn',
    anchor: '`CI_FAILURES`, `DECISIONS_CONTEXT` and `PUSH: false`',
    section: PHASE_10,
  },
  {
    no: '12a',
    item: 'Fresh base: unreadable resolver output counts as a stop',
    anchor: 'counts as `NOTE=stop`, `REASON=resolver-unavailable`',
    section: FEATURE_KNOWLEDGE_LOAD,
  },
  {
    no: '12b',
    item: 'Fresh base: the stop line stops the run',
    anchor: '`stop` (`BASE_REF=none`) stops the run, naming REASON and its fix',
    section: FEATURE_KNOWLEDGE_LOAD,
  },
  {
    no: '12c',
    item: 'Fresh base: the temp file is removed on exit',
    anchor: `trap 'rm -- "$F"' EXIT`,
    section: FEATURE_KNOWLEDGE_LOAD,
  },
  {
    no: '13a',
    item: 'Test-plan check: rewrite once',
    anchor: 'rewrite the section once',
    section: PHASE_1,
  },
  {
    no: '13b',
    item: 'Test-plan check: drop the section if it still fails',
    anchor: 'drop the `## Test Plan` section from the file',
    section: PHASE_1,
  },
  {
    no: '13c',
    item: 'Test-plan check: a required policy asks',
    anchor: 'Missing test plan, only when `EVIDENCE_POLICY` is `required`:** when the check above leaves the test plan missing',
    section: PHASE_1,
  },
  {
    no: '13d',
    item: 'Test-plan check: a standard policy does not ask',
    anchor: 'a missing test plan is never asked about',
    section: PHASE_1,
  },
  {
    no: '14',
    item: 'Test-plan scenario text',
    anchor: 'a scenario holds no `#`, `@` or `/`',
    section: PHASE_1,
  },
  {
    no: '15',
    item: 'Compliance directive passed to every Code and Fix spawn',
    anchor: 'Pass `COMPLIANCE_DIRECTIVE` to every Code and Fix spawn',
    section: PHASE_1,
  },
  {
    no: '16',
    item: 'Decisions context passed to the Code and Harden agents',
    anchor: 'Pass `DECISIONS_CONTEXT` to Code agent (Phase 2) and Harden agent (Phase 4).',
    section: DECISIONS_LOAD,
  },
]

/**
 * The rows that a build has no arm for. Every other row is expected in the build. Derived from the compiled text:
 * a curation-off build drops the decisions load and the field on the ci-fix spawn, and a compliance-off build
 * replaces the evidence publish call with a verify call.
 */
const ABSENT: Readonly<Record<VariantKey, readonly string[]>> = {
  on: [],
  'curation-off': ['11', '16'],
  'compliance-off': ['2b'],
  'both-off': ['11', '16', '2b'],
}

const expectedRows = (key: VariantKey): Row[] => ROWS.filter(r => !ABSENT[key].includes(r.no))
const absentRows = (key: VariantKey): Row[] => ROWS.filter(r => ABSENT[key].includes(r.no))

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

const where = (label: string, row: Row): string => `${label}: row ${row.no} (${row.item})`

/** The nearest heading line above `index`; a `#` line inside a fenced block is text, not a heading. */
export function headingAbove(text: string, index: number): string | null {
  let heading: string | null = null
  let inFence = false
  let offset = 0
  for (const line of text.split('\n')) {
    if (offset > index) break
    if (line.trimStart().startsWith('```')) inFence = !inFence
    else if (!inFence && /^#{1,6} /.test(line)) heading = line
    offset += line.length + 1
  }
  return heading
}

/** Named collector: the rows whose anchor is not in the text exactly once, under the heading that the row names. */
export function collectPlacementDefects(label: string, text: string, rows: readonly Row[]): string[] {
  const defects: string[] = []
  for (const row of rows) {
    const copies = countOf(text, row.anchor)
    if (copies === 0) {
      defects.push(`${where(label, row)}: anchor missing`)
    } else if (copies > 1) {
      defects.push(`${where(label, row)}: anchor occurs ${copies} times, expected once`)
    } else {
      const heading = headingAbove(text, text.indexOf(row.anchor))
      if (heading !== row.section) defects.push(`${where(label, row)}: sits under ${heading ?? '(no heading)'}, expected ${row.section}`)
    }
  }
  return defects
}

/** Named collector: the rows that a build has no arm for, whose anchor is in the text all the same. */
export function collectAbsenceDefects(label: string, text: string, rows: readonly Row[]): string[] {
  return rows.filter(r => text.includes(r.anchor)).map(r => `${where(label, r)}: anchor present in a build that has no such item`)
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** `text` without the one occurrence of `anchor`; the probe is exact only when the anchor occurs once. */
function deleteAnchor(text: string, anchor: string): string {
  expect(countOf(text, anchor), `"${anchor.slice(0, 60)}" must occur once for the deletion to be exact`).toBe(1)
  return text.replace(anchor, () => '')
}

/** `text` with the one heading line `heading` renamed. */
function renameHeading(text: string, heading: string): string {
  const line = `\n${heading}\n`
  expect(countOf(text, line), `the heading "${heading}" must occur once as a line`).toBe(1)
  return text.replace(line, () => `\n${heading} (renamed)\n`)
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('the table is well formed', () => {
  it('holds each row number once, and each absent set names rows of the table', () => {
    const numbers = ROWS.map(r => r.no)
    expect(new Set(numbers).size, 'a row number is used twice').toBe(numbers.length)
    for (const [key, absent] of Object.entries(ABSENT)) {
      for (const no of absent) expect(numbers, `${key} names row ${no}, which is not a row`).toContain(no)
    }
  })

  it('holds a non-empty anchor and a heading line for every row', () => {
    for (const row of ROWS) {
      expect(row.anchor.trim().length, `row ${row.no} has an empty anchor`).toBeGreaterThan(0)
      expect(row.section, `row ${row.no} names a section that is not a heading line`).toMatch(/^#{1,6} \S/)
    }
  })
})

describe('the never-cut items of /implement are in every compiled build, under their section', () => {
  for (const { key, file } of BUILDS) {
    describe(`${key} (${file})`, () => {
      it('holds each expected item once, under its section', () => {
        expect(collectPlacementDefects(file, readBuild(file), expectedRows(key))).toEqual([])
      })

      it('holds no item that the build has no arm for', () => {
        expect(collectAbsenceDefects(file, readBuild(file), absentRows(key))).toEqual([])
      })

      it('known-bad probe: deleting the anchor of an item is reported as that item missing, and no other', () => {
        const text = readBuild(file)
        const rows = expectedRows(key)
        for (const row of rows) {
          const broken = deleteAnchor(text, row.anchor)
          expect(collectPlacementDefects(file, broken, rows), `deleting the anchor of row ${row.no} must be reported`).toEqual([`${where(file, row)}: anchor missing`])
        }
      })

      it('known-bad probe: renaming a heading is reported for each item under it, and no other', () => {
        const text = readBuild(file)
        const rows = expectedRows(key)
        for (const section of new Set(rows.map(r => r.section))) {
          const broken = renameHeading(text, section)
          const expected = rows.filter(r => r.section === section).map(r => `${where(file, r)}: sits under ${section} (renamed), expected ${section}`)
          expect(collectPlacementDefects(file, broken, rows), `renaming "${section}" must be reported`).toEqual(expected)
        }
      })
    })
  }

  it('known-bad probe: a build that holds an item is reported by the check for a build that has none', () => {
    const on = BUILDS.find(b => b.key === 'on')
    expect(on, 'the on build is listed').toBeDefined()
    if (on === undefined) return
    const text = readBuild(on.file)
    for (const key of ['curation-off', 'compliance-off', 'both-off'] as const) {
      const rows = absentRows(key)
      expect(rows.length, `${key} has an absent set`).toBeGreaterThan(0)
      expect(collectAbsenceDefects(on.file, text, rows)).toEqual(rows.map(r => `${where(on.file, r)}: anchor present in a build that has no such item`))
    }
  })
})
