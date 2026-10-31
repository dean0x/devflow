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
 * Row 17 of the table, the settings line, is pinned in tests/commands/settings-partial.test.ts.
 *
 * Rows 18a to 18d extend the table with four sentences of Phases 9 to 11 that carry a fail-closed rule: the capture of
 * the Git agent's lines (the `TRACEABILITY: DEGRADED` lines among them), the Phase 9 stop arm, and the outcome of the
 * Phase 10 and Phase 11 pushes. Each is pinned as a WHOLE sentence (`whole`): the anchor is the sentence from its first
 * word to its full stop, and it must start a sentence and end one. A reworded sentence is no longer found, and a
 * sentence glued to the text before it is reported as not whole. Two probes feed the same collector: the sentence as
 * a lean cut once reworded it, and the sentence glued to a word before it.
 *
 * A second claim, at the end of the file: the independence criteria of PARALLEL_CODE_AGENTS sit in the PARALLEL
 * block, never in the strategy table row. A plan whose frontmatter names the strategy skips the table, so a
 * criterion that lives only in the row is no gate for that plan.
 *
 * A third claim, after it: two whole sentences that close a gap in the run (the Phase 2 stop for a failed Code agent and the
 * Error Handling line for a run ended after Phase 9). They are not rows of the table above. They use the same collector, the
 * same deletion probe, the whole-sentence probe and the heading probe.
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
  /** Set when the anchor is a whole sentence: it starts a sentence and ends one in the compiled text. */
  readonly whole?: true
}

const PRINCIPLES = '## Principles'
const ERROR_HANDLING = '## Error Handling'
const PHASE_1 = '### Phase 1: Setup'
const DECISIONS_LOAD = '### Load DECISIONS_CONTEXT'
const FEATURE_KNOWLEDGE_LOAD = '### Load Feature Knowledge'
const PHASE_2 = '### Phase 2: Implement'
const PHASE_5 = '### Phase 5: Alignment Check'
const PHASE_9 = '### Phase 9: Open PR'
const PHASE_10 = '### Phase 10: CI Status Gate'
const PHASE_11 = '### Phase 11: Evidence'

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
  {
    no: '18a',
    item: 'Phase 9 capture of PR_NUMBER, the uncommitted list and the DEGRADED lines',
    anchor:
      'Capture the `- **PR**: #{number}` line of its `### Branch` as `PR_NUMBER`, its `### Uncommitted files` list and its `TRACEABILITY: DEGRADED ({reason})` lines for the Phase 12 report.',
    section: PHASE_9,
    whole: true,
  },
  {
    no: '18b',
    item: 'Phase 9 stop arm',
    anchor: 'If it returns `### Status: BLOCKED` or no PR number, report its reason to the user and stop at the report (Phase 12); Phases 10 and 11 do not run.',
    section: PHASE_9,
    whole: true,
  },
  {
    no: '18c',
    item: 'Phase 10 push outcome',
    anchor:
      'Any other result, a rejected non-fast-forward push included, records `TRACEABILITY: DEGRADED (ci push failed)` for the Phase 12 report, reports "CI status unknown — verify manually before merging" and proceeds to Phase 11 without waiting.',
    section: PHASE_10,
    whole: true,
  },
  {
    no: '18d',
    item: 'Phase 11 push outcome',
    anchor: 'Any other result, a rejected non-fast-forward push included, does not block: record `TRACEABILITY: DEGRADED (evidence push failed)` for the Phase 12 report and run the script anyway.',
    section: PHASE_11,
    whole: true,
  },
]

/**
 * Each whole-sentence row as the lean cut of Phases 9 to 12 once reworded it. The wording keeps the trigger and the
 * value of the rule, and still differs from the sentence the row pins, so the row must report it as missing.
 */
const REWORDED: Readonly<Record<string, string>> = {
  '18a':
    'Capture the `- **PR**: #{number}` line of its `### Branch` as `PR_NUMBER`, and its `### Uncommitted files` list and `TRACEABILITY: DEGRADED ({reason})` lines for the Phase 12 report.',
  '18b': 'If it returns `### Status: BLOCKED` or no PR number, report its reason and stop at the Phase 12 report; Phases 10 and 11 do not run.',
  '18c':
    'Any other result, a rejected non-fast-forward push included, records `TRACEABILITY: DEGRADED (ci push failed)`, reports "CI status unknown — verify manually before merging" and proceeds to Phase 11 without waiting.',
  '18d': 'Any other result, a rejected non-fast-forward push included, does not block: record `TRACEABILITY: DEGRADED (evidence push failed)` and run the script anyway.',
}

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

/**
 * True when the `length` characters at `index` start a sentence and end one: the text before them is the start of the
 * text, a line break, or a full stop and a space; the text after them is the end of the text, a space or a line break.
 */
export function isWholeSentence(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 2), index)
  const after = text.charAt(index + length)
  const startsSentence = index === 0 || before.endsWith('\n') || before === '. '
  const endsSentence = after === '' || after === ' ' || after === '\n'
  return startsSentence && endsSentence
}

/**
 * Named collector: the rows whose anchor is not in the text exactly once, under the heading that the row names, and
 * the whole-sentence rows whose anchor is not a whole sentence there.
 */
export function collectPlacementDefects(label: string, text: string, rows: readonly Row[]): string[] {
  const defects: string[] = []
  for (const row of rows) {
    const copies = countOf(text, row.anchor)
    if (copies === 0) {
      defects.push(`${where(label, row)}: anchor missing`)
    } else if (copies > 1) {
      defects.push(`${where(label, row)}: anchor occurs ${copies} times, expected once`)
    } else {
      const index = text.indexOf(row.anchor)
      const heading = headingAbove(text, index)
      if (heading !== row.section) defects.push(`${where(label, row)}: sits under ${heading ?? '(no heading)'}, expected ${row.section}`)
      if (row.whole === true && !isWholeSentence(text, index, row.anchor.length)) defects.push(`${where(label, row)}: not a whole sentence`)
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

/**
 * `text` without the one occurrence of the anchor of `row`; the probe is exact only when the anchor occurs once. A
 * whole sentence goes with the one space that follows it, so the sentence after it still starts a sentence.
 */
function deleteAnchor(text: string, row: Row): string {
  expect(countOf(text, row.anchor), `"${row.anchor.slice(0, 60)}" must occur once for the deletion to be exact`).toBe(1)
  const withSpace = `${row.anchor} `
  return text.replace(row.whole === true && text.includes(withSpace) ? withSpace : row.anchor, () => '')
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
          const broken = deleteAnchor(text, row)
          expect(collectPlacementDefects(file, broken, rows), `deleting the anchor of row ${row.no} must be reported`).toEqual([`${where(file, row)}: anchor missing`])
        }
      })

      it('known-bad probe: a reworded whole sentence is reported as that item missing, and no other', () => {
        const text = readBuild(file)
        const rows = expectedRows(key)
        const wholeRows = rows.filter(r => r.whole === true)
        expect(wholeRows.map(r => r.no), `${key} holds the four whole-sentence rows`).toEqual(['18a', '18b', '18c', '18d'])
        for (const row of wholeRows) {
          const reworded = REWORDED[row.no]
          expect(reworded, `row ${row.no} has a reworded probe text`).toBeDefined()
          expect(countOf(text, row.anchor), `row ${row.no} must occur once for the reword to be exact`).toBe(1)
          const broken = text.replace(row.anchor, () => reworded as string)
          expect(collectPlacementDefects(file, broken, rows), `rewording row ${row.no} must be reported`).toEqual([`${where(file, row)}: anchor missing`])
        }
      })

      it('known-bad probe: a whole sentence glued to a word before it is reported as not whole, and no other', () => {
        const text = readBuild(file)
        const rows = expectedRows(key)
        for (const row of rows.filter(r => r.whole === true)) {
          expect(countOf(text, row.anchor), `row ${row.no} must occur once for the gluing to be exact`).toBe(1)
          const broken = text.replace(row.anchor, () => `and ${row.anchor}`)
          expect(collectPlacementDefects(file, broken, rows), `gluing row ${row.no} must be reported`).toEqual([`${where(file, row)}: not a whole sentence`])
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

// ---------------------------------------------------------------------------
// The PARALLEL gate
// ---------------------------------------------------------------------------

/**
 * The independence criteria of PARALLEL_CODE_AGENTS. All of them must hold before a run splits into parallel Code
 * agents. The strategy table applies only when the plan frontmatter has no `execution-strategy`; a plan that names
 * PARALLEL_CODE_AGENTS skips the table. So the criteria sit in the PARALLEL block, which both paths reach, and
 * never in the table row. The patterns pin the contract (which criterion), not the wording around it.
 */
const INDEPENDENCE_CRITERIA: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: 'no shared contract', pattern: /no shared contracts\b/ },
  { name: 'different files or modules with no imports', pattern: /different files(?: or |\/)modules with no imports/ },
]

/**
 * Named collector: how a compiled command differs from "the independence criteria sit in the PARALLEL block". The
 * block opens at the line that starts `**PARALLEL_CODE_AGENTS**:` and ends at the next heading line. The strategy
 * table lies before the block, so text in a table row is outside it.
 */
export function collectParallelGateDefects(file: string, text: string): string[] {
  const lines = text.split('\n')
  const opens = lines.flatMap((line, i) => (line.startsWith('**PARALLEL_CODE_AGENTS**:') ? [i] : []))
  if (opens.length !== 1) return [`${file}: ${opens.length} PARALLEL_CODE_AGENTS blocks, expected 1`]
  const rest = lines.slice(opens[0] + 1)
  const end = rest.findIndex(line => /^#{1,6} \S/.test(line))
  const block = (end === -1 ? rest : rest.slice(0, end)).join('\n')
  return INDEPENDENCE_CRITERIA.filter(c => !c.pattern.test(block)).map(c => `${file}: the PARALLEL_CODE_AGENTS block does not state "${c.name}"`)
}

/** A command in miniature: the strategy table, the PARALLEL block, then the next phase. The criteria go where the caller puts them. */
function miniCommand(tableRow: string, blockTail: string, nextPhase: string): string {
  return [
    '| Strategy | When |',
    '|----------|------|',
    `| **PARALLEL_CODE_AGENTS** | ${tableRow} |`,
    '',
    '**PARALLEL_CODE_AGENTS**: spawn all Code agents in one message, one subtask each.',
    '',
    '```',
    'Agent(subagent_type="Code"):',
    '```',
    '',
    blockTail,
    '',
    '### Phase 3: Polish',
    '',
    nextPhase,
  ].join('\n')
}

const CRITERIA_TEXT = 'no shared contracts or interfaces between subtasks; different files/modules with no imports between them'

describe('the independence criteria of PARALLEL_CODE_AGENTS sit in the PARALLEL block, so a plan that names the strategy keeps the gate', () => {
  for (const { key, file } of BUILDS) {
    it(`${key} (${file}): the PARALLEL block states every criterion`, () => {
      expect(collectParallelGateDefects(file, readBuild(file))).toEqual([])
    })

    it(`${key} (${file}): known-bad probe: a lost criterion is reported as that criterion, and no other`, () => {
      const text = readBuild(file)
      for (const criterion of INDEPENDENCE_CRITERIA) {
        const broken = text.replace(criterion.pattern, '')
        expect(broken, `the seed for "${criterion.name}" must land`).not.toBe(text)
        expect(collectParallelGateDefects(file, broken)).toEqual([`${file}: the PARALLEL_CODE_AGENTS block does not state "${criterion.name}"`])
      }
    })
  }

  it('known-bad probe: criteria that sit only in the strategy table row are reported, both of them', () => {
    const moved = miniCommand(`All must hold: ${CRITERIA_TEXT} (rare)`, 'Spawn once the criteria hold.', 'Polish.')
    expect(collectParallelGateDefects('mini', moved)).toEqual([
      'mini: the PARALLEL_CODE_AGENTS block does not state "no shared contract"',
      'mini: the PARALLEL_CODE_AGENTS block does not state "different files or modules with no imports"',
    ])
  })

  it('known-bad probe: criteria that sit under the next heading are reported, and criteria in the block are not', () => {
    const late = miniCommand('True artifact independence (rare)', 'Spawn once the criteria hold.', CRITERIA_TEXT)
    expect(collectParallelGateDefects('mini', late)).toHaveLength(INDEPENDENCE_CRITERIA.length)
    const inBlock = miniCommand('True artifact independence (rare)', `**Independence criteria**: ${CRITERIA_TEXT}.`, 'Polish.')
    expect(collectParallelGateDefects('mini', inBlock)).toEqual([])
  })

  it('known-bad probe: a command with no PARALLEL block, or two, is reported by count', () => {
    expect(collectParallelGateDefects('mini', 'no block here')).toEqual(['mini: 0 PARALLEL_CODE_AGENTS blocks, expected 1'])
    const one = miniCommand('True artifact independence (rare)', CRITERIA_TEXT, 'Polish.')
    expect(collectParallelGateDefects('mini', `${one}\n${one}`)).toEqual(['mini: 2 PARALLEL_CODE_AGENTS blocks, expected 1'])
  })
})

// ---------------------------------------------------------------------------
// The fault-fix sentences (X1)
// ---------------------------------------------------------------------------

/**
 * Two whole sentences that close a gap in the run, found while the Polish skip moved into the command. They are not rows of the
 * never-cut table, so the table above holds its rows alone. They run through the same collector and the same probes.
 *   - A Code agent with any Status other than COMPLETE, or none, stops the run before Phase 3. A list of the stopping statuses would
 *     let an unknown status (a status such as PARTIAL) through.
 *   - A run that the user ends after Phase 10 started still records the evidence and writes the report.
 */
const FAULT_FIX_ROWS: readonly Row[] = [
  {
    no: 'X1a',
    item: 'Phase 2: a Code agent with a Status other than COMPLETE, or none, stops the run',
    anchor: 'A Code agent with a Status other than COMPLETE, or none: report it and its cause, then halt.',
    section: PHASE_2,
    whole: true,
  },
  {
    no: 'X1b',
    item: 'Error Handling: a run ended after Phase 10 started still runs Phases 11 and 12',
    anchor: 'If the user ends the run after Phase 10 started, run Phases 11 and 12 first.',
    section: ERROR_HANDLING,
    whole: true,
  },
]

/**
 * Each sentence as an earlier text of it worded it. The earlier text names the stopping statuses (FAILED and BLOCKED), so an unknown
 * status does not halt; the earlier end-run line ends the rule at the PR, so a stop in Phase 10 skips the evidence. Neither is the
 * pinned sentence, so the row must report it as missing.
 */
const FAULT_FIX_REWORDED: Readonly<Record<string, string>> = {
  X1a: 'A Code agent with FAILED, BLOCKED or no Status: report it and its cause, then halt.',
  X1b: 'If the user ends the run after Phase 9 opened the PR, run Phases 11 and 12 first.',
}

describe('the fault-fix sentences of /implement are in every compiled build, once, whole, under their section', () => {
  for (const { key, file } of BUILDS) {
    describe(`${key} (${file})`, () => {
      it('holds each sentence once, whole, under its section', () => {
        expect(FAULT_FIX_ROWS.map(r => r.no), 'the rows of the block').toEqual(['X1a', 'X1b'])
        expect(collectPlacementDefects(file, readBuild(file), FAULT_FIX_ROWS)).toEqual([])
      })

      it('known-bad probe: deleting a sentence is reported as that sentence missing, and no other', () => {
        const text = readBuild(file)
        for (const row of FAULT_FIX_ROWS) {
          expect(collectPlacementDefects(file, deleteAnchor(text, row), FAULT_FIX_ROWS), `deleting row ${row.no}`).toEqual([`${where(file, row)}: anchor missing`])
        }
      })

      it('known-bad probe: a sentence glued to a word before it is reported as not whole, and no other', () => {
        const text = readBuild(file)
        for (const row of FAULT_FIX_ROWS) {
          expect(countOf(text, row.anchor), `row ${row.no} must occur once for the gluing to be exact`).toBe(1)
          expect(collectPlacementDefects(file, text.replace(row.anchor, () => `and ${row.anchor}`), FAULT_FIX_ROWS), `gluing row ${row.no}`).toEqual([`${where(file, row)}: not a whole sentence`])
        }
      })

      it('known-bad probe: an earlier wording of a sentence is reported as that sentence missing: an unknown Code status no longer halts, and a stop in Phase 10 skips the evidence', () => {
        const text = readBuild(file)
        for (const row of FAULT_FIX_ROWS) {
          const reworded = FAULT_FIX_REWORDED[row.no]
          expect(reworded, `row ${row.no} has an earlier wording`).toBeDefined()
          expect(reworded, `row ${row.no}: the earlier wording is not the pinned sentence`).not.toBe(row.anchor)
          expect(countOf(text, row.anchor), `row ${row.no} must occur once for the reword to be exact`).toBe(1)
          expect(collectPlacementDefects(file, text.replace(row.anchor, () => reworded as string), FAULT_FIX_ROWS), `rewording row ${row.no}`).toEqual([`${where(file, row)}: anchor missing`])
        }
      })

      it('known-bad probe: a Phase 2 arm that drops "other than" or "or none" is reported as the arm missing', () => {
        const text = readBuild(file)
        const arm = (FAULT_FIX_ROWS.find(r => r.no === 'X1a') as Row).anchor
        for (const [from, to] of [['a Status other than COMPLETE, or none', 'a Status of FAILED'], ['COMPLETE, or none', 'COMPLETE'], ['a Status other than COMPLETE', 'a failed Status']] as const) {
          expect(arm.includes(from), `the arm holds "${from}"`).toBe(true)
          expect(collectPlacementDefects(file, text.replace(arm, () => arm.replace(from, to)), FAULT_FIX_ROWS), `"${from}" changed`).toEqual([`${where(file, FAULT_FIX_ROWS[0] as Row)}: anchor missing`])
        }
      })

      it('known-bad probe: renaming a heading is reported for each sentence under it, and no other', () => {
        const text = readBuild(file)
        for (const row of FAULT_FIX_ROWS) {
          expect(collectPlacementDefects(file, renameHeading(text, row.section), FAULT_FIX_ROWS), `renaming "${row.section}"`).toEqual([`${where(file, row)}: sits under ${row.section} (renamed), expected ${row.section}`])
        }
      })
    })
  }
})
