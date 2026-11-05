/**
 * The Code and Harden agents read the plan's acceptance criteria and known limits (#756).
 *
 * A spawn that holds a phase of the plan, or a self-review of the branch, can pass
 * `ACCEPTANCE_CRITERIA` and `KNOWN_LIMITS`. Both agents then build, test and check only to the criteria,
 * and neither treats a stated limit as a finding or builds past it. The limit and the criteria never
 * lower a safety floor: a limit or a missing criterion never drops a trust-boundary, data-loss, security or
 * fail-closed check or its test. Absent inputs keep today's behaviour, so both inputs are optional.
 *
 * This file reads the COMPILED agent files a session loads, in every variant key:
 *
 *   Code    curation on and off, each with tdd on and off (`dist/agents/`, `dist/curation-off/agents/`,
 *           `dist/tdd-off/agents/`, `dist/curation-tdd-off/agents/`);
 *   Harden  curation on and off (`dist/agents/`, `dist/curation-off/agents/`).
 *
 * Every arm runs through a named collector, and each known-bad probe feeds the same collector a
 * body with one part removed, so a collector that stopped seeing a defect fails its own probe instead
 * of passing vacuously.
 *
 * /implement passes them in its four builds (on, curation off, compliance off, both off): one Phase 2
 * sentence puts the plan's Patterns to Follow, Known limits and the criteria that phase serves into each phase
 * or subtask `EXECUTION_PLAN`: the criteria its Serves cell names, any criterion no cell names and each
 * criterion that states a trust-boundary, security, data-loss or fail-closed property, or all criteria when the
 * phase's cell is absent or names any unlisted number. Its own steps still set its scope (the single spawn already takes the full
 * plan). The one Harden spawn carries both input lines, and the Harden line also keeps every pillar in force.
 * No Phase 2 Code spawn passes PATTERNS or PRIOR_PHASE_SUMMARY: the sentence carries the patterns and the
 * handoff file carries the prior phase, so the phase-N spawn keeps HANDOFF_FILE.
 *
 * /plan, in the same four builds, numbers the criteria AC-1, AC-2, ... and gives each Subtask Breakdown row
 * a Serves cell of the item-1 ACs it serves; the Synthesize planning template (`synthesize/planning.md`) has the Serves column and its
 * rule asks for the AC numbers each phase or subtask serves, for a SEQUENTIAL and a PARALLEL plan alike. That is the cell
 * the /implement sentence reads.
 *
 * What a green run does NOT prove: it proves the files carry the text. It does not prove that a model
 * follows it.
 */

import { describe, it, expect } from 'vitest'

import {
  isAgentBlock,
  parseFences,
  readAgentReference,
  requireDistFile,
  resolveAgentSource,
  resolveCurationOffSource,
  resolveVariantOffSource,
} from '../helpers.js'

const INPUT_HEAD = '- **ACCEPTANCE_CRITERIA**, **KNOWN_LIMITS** (optional):'

const NEVER_CUT_CLAUSE = 'A limit or a missing criterion never drops a trust-boundary, data-loss, security or fail-closed check or its test.'

const CODE_INPUT_LINE = `${INPUT_HEAD} Build only to the criteria and not past a stated limit. ${NEVER_CUT_CLAUSE}`

const HARDEN_INPUT_LINE =
  `${INPUT_HEAD} Test to the criteria; every pillar still applies. A stated limit is not a finding. ${NEVER_CUT_CLAUSE}`

interface Build { readonly label: string; readonly text: string }

function required(label: string, text: string | null): string {
  if (text === null) throw new Error(`${label} is absent: run \`npm run build:mds\``)
  return text
}

function codeBuilds(): Build[] {
  return [
    { label: 'code (curation on, tdd on)', text: resolveAgentSource('code').content },
    { label: 'code (curation off, tdd on)', text: required('dist/curation-off/agents/code.md', resolveCurationOffSource('agents', 'code')) },
    { label: 'code (curation on, tdd off)', text: required('dist/tdd-off/agents/code.md', resolveVariantOffSource('tdd-off', 'agents', 'code')) },
    { label: 'code (curation off, tdd off)', text: required('dist/curation-tdd-off/agents/code.md', resolveVariantOffSource('curation-tdd-off', 'agents', 'code')) },
  ]
}

function hardenBuilds(): Build[] {
  return [
    { label: 'harden (curation on)', text: resolveAgentSource('harden').content },
    { label: 'harden (curation off)', text: required('dist/curation-off/agents/harden.md', resolveCurationOffSource('agents', 'harden')) },
  ]
}

/** The lines of a body that open with the input head. */
function inputLines(text: string): string[] {
  return text.split('\n').filter(line => line.startsWith(INPUT_HEAD))
}

/** Named collector: how a body falls short of carrying `expected` once, as its one criteria-and-limits input line. */
function collectInputLineDefects(label: string, text: string, expected: string): string[] {
  const lines = inputLines(text)
  if (lines.length !== 1) return [`${label}: ${lines.length} criteria-and-limits input lines, expected 1`]
  return lines[0] === expected ? [] : [`${label}: the criteria-and-limits input line differs from the pinned text`]
}

describe('the Code agent reads ACCEPTANCE_CRITERIA and KNOWN_LIMITS in every build (#756)', () => {
  it.each(codeBuilds().map(b => [b.label, b.text] as const))('%s carries the input line and its never-cut clause once', (label, text) => {
    expect(text.length, 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(4_000)
    expect(collectInputLineDefects(label, text, CODE_INPUT_LINE)).toEqual([])
  })

  it('known-bad probes: a lost never-cut clause, a lost limit rule and a repeated line are each reported', () => {
    const [{ label, text }] = codeBuilds()
    const noClause = text.replace(` ${NEVER_CUT_CLAUSE}`, '')
    expect(noClause, 'the seed must land').not.toBe(text)
    expect(collectInputLineDefects(label, noClause, CODE_INPUT_LINE)).toEqual([`${label}: the criteria-and-limits input line differs from the pinned text`])
    const noLimit = text.replace(' and not past a stated limit', '')
    expect(noLimit, 'the seed must land').not.toBe(text)
    expect(collectInputLineDefects(label, noLimit, CODE_INPUT_LINE)).toEqual([`${label}: the criteria-and-limits input line differs from the pinned text`])
    const noLine = text.replace(`${CODE_INPUT_LINE}\n`, '')
    expect(noLine, 'the seed must land').not.toBe(text)
    expect(collectInputLineDefects(label, noLine, CODE_INPUT_LINE)).toEqual([`${label}: 0 criteria-and-limits input lines, expected 1`])
    expect(collectInputLineDefects(label, `${text}\n${CODE_INPUT_LINE}\n`, CODE_INPUT_LINE)).toEqual([`${label}: 2 criteria-and-limits input lines, expected 1`])
  })
})

const PHASE_PLAN_HEAD = "Each phase or subtask `EXECUTION_PLAN` adds the plan's"

const PHASE_PLAN_SENTENCE =
  `${PHASE_PLAN_HEAD} Patterns to Follow, Known limits, the criteria its Serves cell names, any criterion no cell names and each criterion that states a trust-boundary, security, data-loss or fail-closed property; a phase whose cell is absent or names any unlisted number gets all criteria; its own steps still set its scope.`

/** The clauses of the phase-plan sentence, each named in the defect that reports it lost. */
const PHASE_PLAN_CLAUSES: ReadonlyArray<readonly [name: string, clause: string]> = [
  ['Patterns to Follow', 'Patterns to Follow, '],
  ['Known limits', 'Known limits, '],
  ['served and unserved criteria', 'the criteria its Serves cell names, any criterion no cell names'],
  ['safety-criteria clause', ' and each criterion that states a trust-boundary, security, data-loss or fail-closed property'],
  ['fallback to all criteria', '; a phase whose cell is absent or names any unlisted number gets all criteria'],
]

const HARDEN_SPAWN_LINES = [
  'ACCEPTANCE_CRITERIA: {extracted criteria if available}',
  "KNOWN_LIMITS: {plan's Known limits, else (none)}",
] as const

function implementBuilds(): Build[] {
  return [
    { label: 'implement (on)', text: requireDistFile('implement.md') },
    { label: 'implement (curation off)', text: required('dist/curation-off/commands/implement.md', resolveCurationOffSource('commands', 'implement')) },
    { label: 'implement (compliance off)', text: required('compliance-off implement', resolveVariantOffSource('compliance-off', 'commands', 'implement')) },
    { label: 'implement (both off)', text: required('both-off implement', resolveVariantOffSource('both-off', 'commands', 'implement')) },
  ]
}

/** Named collector: how an /implement build falls short of the phase-plan sentence, as one line holding every clause. */
function collectPhasePlanSentenceDefects(label: string, text: string): string[] {
  const lines = text.split('\n').filter(line => line.startsWith(PHASE_PLAN_HEAD))
  if (lines.length !== 1) return [`${label}: the phase-plan sentence appears ${lines.length} times, expected 1`]
  if (lines[0] === PHASE_PLAN_SENTENCE) return []
  const lost = PHASE_PLAN_CLAUSES.filter(([, clause]) => !lines[0].includes(clause)).map(([name]) => `${label}: the phase-plan sentence lost its ${name}`)
  return lost.length > 0 ? lost : [`${label}: the phase-plan sentence differs from the pinned text`]
}

/** Named collector: how an /implement build falls short of passing the criteria and limits. */
function collectImplementDefects(label: string, text: string): string[] {
  const defects = collectPhasePlanSentenceDefects(label, text)
  const harden = parseFences(text).filter(block => isAgentBlock(block, 'Harden'))
  if (harden.length !== 1) return [...defects, `${label}: ${harden.length} Harden spawn blocks, expected 1`]
  for (const line of HARDEN_SPAWN_LINES) {
    if (!harden[0].split('\n').includes(line)) defects.push(`${label}: the Harden spawn lacks \`${line}\``)
  }
  return defects
}

describe('/implement passes ACCEPTANCE_CRITERIA and KNOWN_LIMITS in every build (#756)', () => {
  it.each(implementBuilds().map(b => [b.label, b.text] as const))('%s carries the phase-plan sentence and both Harden lines', (label, text) => {
    expect(text.length, 'the command is read: the guard would pass vacuously on an empty one').toBeGreaterThan(30_000)
    expect(collectImplementDefects(label, text)).toEqual([])
  })

  it('known-bad probes: each lost clause of the phase-plan sentence is reported by name', () => {
    const [{ label, text }] = implementBuilds()
    for (const [name, clause] of PHASE_PLAN_CLAUSES) {
      const lost = text.replace(PHASE_PLAN_SENTENCE, PHASE_PLAN_SENTENCE.replace(clause, ''))
      expect(lost, `the ${name} seed must land`).not.toBe(text)
      expect(collectImplementDefects(label, lost)).toEqual([`${label}: the phase-plan sentence lost its ${name}`])
    }
    const typoCase = text.replace(PHASE_PLAN_SENTENCE, PHASE_PLAN_SENTENCE.replace(' or names any unlisted number', ''))
    expect(typoCase, 'the unlisted-number seed must land').not.toBe(text)
    expect(collectImplementDefects(label, typoCase), 'a fallback that leaves out a cell naming an unlisted number is reported').toEqual([`${label}: the phase-plan sentence lost its fallback to all criteria`])
    const reworded = text.replace(PHASE_PLAN_SENTENCE, PHASE_PLAN_SENTENCE.replace('still set its scope', 'set its scope'))
    expect(reworded, 'the seed must land').not.toBe(text)
    expect(collectImplementDefects(label, reworded)).toEqual([`${label}: the phase-plan sentence differs from the pinned text`])
  })

  it('known-bad probes: a lost sentence, a lost Harden line and a lost Harden block are each reported', () => {
    const [{ label, text }] = implementBuilds()
    const noSentence = text.replace(`${PHASE_PLAN_SENTENCE}\n`, '')
    expect(noSentence, 'the seed must land').not.toBe(text)
    expect(collectImplementDefects(label, noSentence)).toEqual([`${label}: the phase-plan sentence appears 0 times, expected 1`])
    for (const line of HARDEN_SPAWN_LINES) {
      const lost = text.replace(`${line}\n`, '')
      expect(lost, 'the seed must land').not.toBe(text)
      expect(collectImplementDefects(label, lost)).toEqual([`${label}: the Harden spawn lacks \`${line}\``])
    }
    const noHarden = text.replace('Agent(subagent_type="Harden")', 'Agent(subagent_type="Other")')
    expect(noHarden, 'the seed must land').not.toBe(text)
    expect(collectImplementDefects(label, noHarden)).toEqual([`${label}: 0 Harden spawn blocks, expected 1`])
  })
})

const PHASE_2_HEADING = '### Phase 2: Implement'
const PHASE_3_HEADING = '### Phase 3:'

/** The Code fences of Phase 2: the single spawn, the phase 1 spawn, the phase N spawn and the parallel pair. */
const PHASE_2_CODE_FENCES = 4

/** Inputs no Phase 2 Code fence passes: the sentence carries the patterns, the handoff file carries the prior phase. */
const REPEATED_SPAWN_INPUTS = ['PATTERNS:', 'PRIOR_PHASE_SUMMARY:'] as const

/** The Phase 2 section of an /implement build, from its heading to the Phase 3 heading, or null when either is absent. */
function phase2Section(text: string): string | null {
  const start = text.indexOf(PHASE_2_HEADING)
  const end = start === -1 ? -1 : text.indexOf(PHASE_3_HEADING, start)
  return end === -1 ? null : text.slice(start, end)
}

/** Named collector: how the Phase 2 Code spawns of an /implement build repeat an input, or lose the handoff file of the phase-N spawn. */
function collectPhase2SpawnInputDefects(label: string, text: string): string[] {
  const section = phase2Section(text)
  if (section === null) return [`${label}: the Phase 2 section is not found`]
  const code = parseFences(section).filter(block => isAgentBlock(block, 'Code'))
  if (code.length !== PHASE_2_CODE_FENCES) return [`${label}: ${code.length} Phase 2 Code fences, expected ${PHASE_2_CODE_FENCES}`]
  const defects = code.flatMap((block, i) =>
    REPEATED_SPAWN_INPUTS.filter(input => block.includes(input)).map(input => `${label}: Phase 2 Code fence ${i + 1} passes ${input}`),
  )
  const phaseN = code.filter(block => block.includes('FILES_FROM_PRIOR_PHASE:'))
  if (phaseN.length !== 1) return [...defects, `${label}: ${phaseN.length} phase-N Code fences, expected 1`]
  if (!phaseN[0].includes('HANDOFF_FILE:')) defects.push(`${label}: the phase-N Code fence lacks HANDOFF_FILE:`)
  return defects
}

describe('no /implement Phase 2 Code spawn repeats PATTERNS or PRIOR_PHASE_SUMMARY in any build (#756)', () => {
  it.each(implementBuilds().map(b => [b.label, b.text] as const))('%s passes neither input and keeps HANDOFF_FILE in the phase-N spawn', (label, text) => {
    expect(text.length, 'the command is read: the guard would pass vacuously on an empty one').toBeGreaterThan(30_000)
    expect(collectPhase2SpawnInputDefects(label, text)).toEqual([])
  })

  it('known-bad probes: a repeated input in each kind of Code fence, a lost HANDOFF_FILE and a lost phase-N fence are each reported', () => {
    const [{ label, text }] = implementBuilds()
    const seeded = (from: string, to: string): string => {
      const edited = text.replace(from, to)
      expect(edited, 'the seed must land').not.toBe(text)
      return edited
    }
    const single = seeded('EXECUTION_PLAN: {full plan from setup context}\n', 'EXECUTION_PLAN: {full plan from setup context}\nPATTERNS: {patterns from plan document or empty}\n')
    expect(collectPhase2SpawnInputDefects(label, single)).toEqual([`${label}: Phase 2 Code fence 1 passes PATTERNS:`])
    const phase1 = seeded('EXECUTION_PLAN: {phase 1 steps}\n', 'EXECUTION_PLAN: {phase 1 steps}\nPATTERNS: {patterns from plan document or empty}\n')
    expect(collectPhase2SpawnInputDefects(label, phase1)).toEqual([`${label}: Phase 2 Code fence 2 passes PATTERNS:`])
    const summary = seeded('EXECUTION_PLAN: {phase N steps}\n', 'EXECUTION_PLAN: {phase N steps}\nPRIOR_PHASE_SUMMARY: {summary from previous Code agent}\n')
    expect(collectPhase2SpawnInputDefects(label, summary)).toEqual([`${label}: Phase 2 Code fence 3 passes PRIOR_PHASE_SUMMARY:`])
    const parallel = seeded('EXECUTION_PLAN: {subtask 2 steps}\n', 'EXECUTION_PLAN: {subtask 2 steps}\nPATTERNS: {patterns}\n')
    expect(collectPhase2SpawnInputDefects(label, parallel)).toEqual([`${label}: Phase 2 Code fence 4 passes PATTERNS:`])
    const noHandoff = seeded('HANDOFF_REQUIRED: {true if not last phase}\nHANDOFF_FILE: {worktree}/.devflow/docs/handoff-{branch_slug}.md"', 'HANDOFF_REQUIRED: {true if not last phase}"')
    expect(collectPhase2SpawnInputDefects(label, noHandoff)).toEqual([`${label}: the phase-N Code fence lacks HANDOFF_FILE:`])
    const noPhaseN = seeded('FILES_FROM_PRIOR_PHASE: {list of files created}\n', '')
    expect(collectPhase2SpawnInputDefects(label, noPhaseN)).toEqual([`${label}: 0 phase-N Code fences, expected 1`])
    const noSection = seeded(PHASE_2_HEADING, '### Phase 2: Build')
    expect(collectPhase2SpawnInputDefects(label, noSection)).toEqual([`${label}: the Phase 2 section is not found`])
  })
})

const CODE_BASE_BRANCH_INPUT = '- **BASE_BRANCH**: Branch this feature branch was created from\n'
const CODE_PRIOR_PHASE_SUMMARY_INPUT = '- **PRIOR_PHASE_SUMMARY**: Summary from the previous Code agent (format in Handoff)\n'

/** Named collector: how a Code body lists the PATTERNS input or the PRIOR_PHASE_SUMMARY input, which no spawn passes. */
function collectCodeSpawnInputDefects(label: string, text: string): string[] {
  const defects: string[] = []
  if (/^- \*\*PATTERNS\*\*/m.test(text)) defects.push(`${label}: the dead PATTERNS input is listed`)
  const summaries = text.split('\n').filter(line => line.startsWith('- **PRIOR_PHASE_SUMMARY**')).length
  if (summaries !== 0) defects.push(`${label}: ${summaries} PRIOR_PHASE_SUMMARY input lines, expected 0`)
  return defects
}

describe('the Code agent lists no PATTERNS input and no PRIOR_PHASE_SUMMARY input in every build (#756)', () => {
  it.each(codeBuilds().map(b => [b.label, b.text] as const))('%s', (label, text) => {
    expect(text.length, 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(4_000)
    expect(collectCodeSpawnInputDefects(label, text)).toEqual([])
  })

  it('known-bad probes: a listed PATTERNS input and a listed PRIOR_PHASE_SUMMARY input are each reported', () => {
    const [{ label, text }] = codeBuilds()
    const withPatterns = text.replace(CODE_BASE_BRANCH_INPUT, `${CODE_BASE_BRANCH_INPUT}- **PATTERNS**: Codebase patterns to follow\n`)
    expect(withPatterns, 'the seed must land').not.toBe(text)
    expect(collectCodeSpawnInputDefects(label, withPatterns)).toEqual([`${label}: the dead PATTERNS input is listed`])
    const withSummary = text.replace(CODE_BASE_BRANCH_INPUT, `${CODE_BASE_BRANCH_INPUT}${CODE_PRIOR_PHASE_SUMMARY_INPUT}`)
    expect(withSummary, 'the seed must land').not.toBe(text)
    expect(collectCodeSpawnInputDefects(label, withSummary)).toEqual([`${label}: 1 PRIOR_PHASE_SUMMARY input lines, expected 0`])
  })
})

const PLAN_AC_LINE_HEAD = '1. **Acceptance Criteria** — '
const PLAN_AC_NUMBERING = ', numbered AC-1, AC-2, ...'
const PLAN_SUBTASK_LINE_HEAD = '2. **Subtask Breakdown** — '
const PLAN_SERVES_CLAUSE = 'a Serves cell (the item-1 ACs it serves)'
const PLAN_SUBTASK_LINE = `${PLAN_SUBTASK_LINE_HEAD}phases with domains, dependencies and ${PLAN_SERVES_CLAUSE}; only with more than one subtask`

const PLANNING_REFERENCE = 'synthesize/planning.md'
const PLANNING_SERVES_RULE = 'Each phase or subtask names the AC numbers it serves.'
const PLANNING_SERVES_COLUMN = '| Steps | Serves |'

function planBuilds(): Build[] {
  return [
    { label: 'plan (on)', text: requireDistFile('plan.md') },
    { label: 'plan (curation off)', text: required('dist/curation-off/commands/plan.md', resolveCurationOffSource('commands', 'plan')) },
    { label: 'plan (compliance off)', text: required('compliance-off plan', resolveVariantOffSource('compliance-off', 'commands', 'plan')) },
    { label: 'plan (both off)', text: required('both-off plan', resolveVariantOffSource('both-off', 'commands', 'plan')) },
  ]
}

/** Named collector: how a /plan build falls short of numbering the criteria and naming the Serves cell in the plan artifact's section list. */
function collectPlanArtifactDefects(label: string, text: string): string[] {
  const lines = text.split('\n')
  const criteria = lines.filter(line => line.startsWith(PLAN_AC_LINE_HEAD))
  const subtasks = lines.filter(line => line.startsWith(PLAN_SUBTASK_LINE_HEAD))
  const defects: string[] = []
  if (criteria.length !== 1) defects.push(`${label}: ${criteria.length} Acceptance Criteria section lines in the plan artifact, expected 1`)
  else if (!criteria[0].includes(PLAN_AC_NUMBERING)) defects.push(`${label}: the plan artifact does not number the criteria AC-1, AC-2, ...`)
  if (subtasks.length !== 1) defects.push(`${label}: ${subtasks.length} Subtask Breakdown section lines in the plan artifact, expected 1`)
  else if (!subtasks[0].includes(PLAN_SERVES_CLAUSE)) defects.push(`${label}: the Subtask Breakdown line lacks the Serves cell that names the AC numbers`)
  else if (subtasks[0] !== PLAN_SUBTASK_LINE) defects.push(`${label}: the Subtask Breakdown line differs from the pinned text`)
  return defects
}

/**
 * Named collector: how the planning template falls short of asking for the AC numbers each phase or subtask serves, in its
 * rule and in its Subtask Breakdown table. The rule is one line of its own after the strategy bullets, so it covers a
 * PARALLEL_CODE_AGENTS plan as well as a SEQUENTIAL_CODE_AGENTS one, and a clause kept in only one bullet is reported.
 */
function collectPlanningTemplateDefects(label: string, text: string): string[] {
  const lines = text.split('\n')
  const defects: string[] = []
  const parallel = lines.filter(line => line.startsWith('- **PARALLEL_CODE_AGENTS**'))
  if (parallel.length !== 1) defects.push(`${label}: ${parallel.length} PARALLEL_CODE_AGENTS rule lines, expected 1`)
  const rules = lines.filter(line => line === PLANNING_SERVES_RULE)
  if (rules.length !== 1) defects.push(`${label}: ${rules.length} lines ask for the AC numbers each phase or subtask serves, expected 1 (one rule covers the SEQUENTIAL and PARALLEL plans)`)
  const headerAt = lines.findIndex(line => line.startsWith('| Phase |'))
  if (headerAt === -1) return [...defects, `${label}: the Subtask Breakdown table is not found`]
  if (!lines[headerAt].includes(PLANNING_SERVES_COLUMN)) defects.push(`${label}: the Subtask Breakdown table has no Serves column after Steps`)
  const rest = lines.slice(headerAt)
  const tableEnd = rest.findIndex(line => !line.startsWith('|'))
  const table = tableEnd === -1 ? rest : rest.slice(0, tableEnd)
  const columns = (row: string): number => row.split('|').length
  if (table.some(row => columns(row) !== columns(table[0]))) defects.push(`${label}: a Subtask Breakdown table row has a different column count from its header`)
  return defects
}

describe('/plan numbers the criteria and names the criteria each phase serves, in every build (#756)', () => {
  it.each(planBuilds().map(b => [b.label, b.text] as const))('%s numbers the criteria and has a Serves cell on the Subtask Breakdown line', (label, text) => {
    expect(text.length, 'the command is read: the guard would pass vacuously on an empty one').toBeGreaterThan(25_000)
    expect(collectPlanArtifactDefects(label, text)).toEqual([])
  })

  it('the planning template asks for the AC numbers each phase or subtask serves and has the Serves column', () => {
    const text = readAgentReference(PLANNING_REFERENCE)
    expect(text.length, 'the template is read: the guard would pass vacuously on an empty one').toBeGreaterThan(1_500)
    expect(collectPlanningTemplateDefects(PLANNING_REFERENCE, text)).toEqual([])
  })

  it('known-bad probes: the dropped numbering, the dropped Serves cell and a lost or doubled section line are each reported', () => {
    const [{ label, text }] = planBuilds()
    const seeded = (from: string, to: string): string => {
      const edited = text.replace(from, to)
      expect(edited, 'the seed must land').not.toBe(text)
      return edited
    }
    expect(collectPlanArtifactDefects(label, seeded(PLAN_AC_NUMBERING, ''))).toEqual([`${label}: the plan artifact does not number the criteria AC-1, AC-2, ...`])
    expect(collectPlanArtifactDefects(label, seeded(`, dependencies and ${PLAN_SERVES_CLAUSE}`, ' and dependencies'))).toEqual([
      `${label}: the Subtask Breakdown line lacks the Serves cell that names the AC numbers`,
    ])
    expect(collectPlanArtifactDefects(label, seeded(PLAN_SERVES_CLAUSE, 'a Serves cell'))).toEqual([`${label}: the Subtask Breakdown line lacks the Serves cell that names the AC numbers`])
    expect(collectPlanArtifactDefects(label, seeded('; only with more than one subtask', ''))).toEqual([`${label}: the Subtask Breakdown line differs from the pinned text`])
    expect(collectPlanArtifactDefects(label, seeded(`${PLAN_SUBTASK_LINE}\n`, ''))).toEqual([`${label}: 0 Subtask Breakdown section lines in the plan artifact, expected 1`])
    expect(collectPlanArtifactDefects(label, `${text}\n${PLAN_SUBTASK_LINE}\n`)).toEqual([`${label}: 2 Subtask Breakdown section lines in the plan artifact, expected 1`])
  })

  it('known-bad probes: the AC rule lost, kept for SEQUENTIAL only or lost for PARALLEL, and the dropped Serves column are each reported', () => {
    const label = PLANNING_REFERENCE
    const text = readAgentReference(PLANNING_REFERENCE)
    const seeded = (from: string, to: string): string => {
      const edited = text.replace(from, to)
      expect(edited, 'the seed must land').not.toBe(text)
      return edited
    }
    const noRule = `${label}: 0 lines ask for the AC numbers each phase or subtask serves, expected 1 (one rule covers the SEQUENTIAL and PARALLEL plans)`
    expect(collectPlanningTemplateDefects(label, seeded(`${PLANNING_SERVES_RULE}\n\n`, ''))).toEqual([noRule])
    const sequentialOnly = seeded(`${PLANNING_SERVES_RULE}\n\n`, '').replace('as the Subtask Breakdown section.', 'as the Subtask Breakdown section; give each phase the AC numbers it serves.')
    expect(sequentialOnly, 'the seed must land').not.toBe(text)
    expect(collectPlanningTemplateDefects(label, sequentialOnly)).toEqual([noRule])
    expect(collectPlanningTemplateDefects(label, seeded(PLANNING_SERVES_RULE, 'Each phase names the AC numbers it serves.'))).toEqual([noRule])
    expect(collectPlanningTemplateDefects(label, `${text}\n${PLANNING_SERVES_RULE}\n`)).toEqual([noRule.replace('0 lines', '2 lines')])
    expect(collectPlanningTemplateDefects(label, seeded('- **PARALLEL_CODE_AGENTS**', '- **PARALLEL**'))).toEqual([`${label}: 0 PARALLEL_CODE_AGENTS rule lines, expected 1`])
    const noColumn = text
      .replace('| Steps | Serves | Depends On |', '| Steps | Depends On |')
      .replace('|-------|--------|-------------|-------|-------|--------|------------|', '|-------|--------|-------------|-------|-------|------------|')
      .replace('| 1-3 | AC-1, AC-2 | - |', '| 1-3 | - |')
      .replace('| 4-6 | AC-3 | Phase 1 |', '| 4-6 | Phase 1 |')
    expect(noColumn, 'the seed must land').not.toBe(text)
    expect(collectPlanningTemplateDefects(label, noColumn)).toEqual([`${label}: the Subtask Breakdown table has no Serves column after Steps`])
    const headerOnly = seeded('| Steps | Serves | Depends On |', '| Steps | Depends On |')
    expect(collectPlanningTemplateDefects(label, headerOnly)).toEqual([
      `${label}: the Subtask Breakdown table has no Serves column after Steps`,
      `${label}: a Subtask Breakdown table row has a different column count from its header`,
    ])
    expect(collectPlanningTemplateDefects(label, seeded('| Phase | Domain |', '| Stage | Domain |'))).toEqual([`${label}: the Subtask Breakdown table is not found`])
  })
})

describe('the Harden agent reads ACCEPTANCE_CRITERIA and KNOWN_LIMITS in both builds (#756)', () => {
  it.each(hardenBuilds().map(b => [b.label, b.text] as const))('%s carries the input line and its never-cut clause once', (label, text) => {
    expect(text.length, 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(2_000)
    expect(collectInputLineDefects(label, text, HARDEN_INPUT_LINE)).toEqual([])
  })

  it('known-bad probes: a lost never-cut clause, a lost pillar rule, a lost limit rule and a repeated line are each reported', () => {
    const [{ label, text }] = hardenBuilds()
    const differs = [`${label}: the criteria-and-limits input line differs from the pinned text`]
    const noClause = text.replace(` ${NEVER_CUT_CLAUSE}`, '')
    expect(noClause, 'the seed must land').not.toBe(text)
    expect(collectInputLineDefects(label, noClause, HARDEN_INPUT_LINE)).toEqual(differs)
    const noPillars = text.replace('; every pillar still applies', '')
    expect(noPillars, 'the seed must land').not.toBe(text)
    expect(collectInputLineDefects(label, noPillars, HARDEN_INPUT_LINE)).toEqual(differs)
    const noLimit = text.replace(' A stated limit is not a finding.', '')
    expect(noLimit, 'the seed must land').not.toBe(text)
    expect(collectInputLineDefects(label, noLimit, HARDEN_INPUT_LINE)).toEqual(differs)
    expect(collectInputLineDefects(label, `${text}\n${HARDEN_INPUT_LINE}\n`, HARDEN_INPUT_LINE)).toEqual([`${label}: 2 criteria-and-limits input lines, expected 1`])
  })
})
