/**
 * code-read-economy — the Code, Fix and Refactor agents read a file once, keep command output small,
 * and a long plan splits into sequential phases (#452).
 *
 * Decisions recorded here (the last three are the #453 cache-hygiene outcomes):
 *
 *  - D-SEQ-SPLIT        A plan that writes 10 or more files, or has 7 or more steps, runs as
 *                       SEQUENTIAL_CODE_AGENTS; each phase has at most 5 files and at most 6 steps.
 *                       Every other plan is one Code agent, and a run with no plan document is always
 *                       one Code agent because it has no Subtask Breakdown to split. Evidence (R-452a):
 *                       the Code bin of 100 or more turns is 59.9% of Code cost-equivalent (ce), and the
 *                       p90 peak context is 394,630. The unmeasured percent labels and the word
 *                       "Consider" are gone from the planning reference.
 *  - D-CODE-READ-ONCE   A Code-family agent never re-reads an unchanged file. For a file over 400 lines,
 *                       or for a second look, it greps with line numbers first and reads only that
 *                       range. Evidence (R-452d): the re-read share is 31.6%, and that share is a floor.
 *  - D-CODE-QUIET       One shared output line covers both top classes of unbounded output: never print
 *                       a large file whole, page it, and cap any output; list or count search matches
 *                       before printing them. Evidence (R-452c): grep and find are 37.9% and cat, sed
 *                       and head are 37.8%, a tie for the top class, so one line covers both. The line
 *                       is the text in `validate.md`, so there is one wording across the agents.
 *  - D-NO-TURN-END-WAIT No Monitor denial and no new body line. Evidence (R-453a = A): 0 non-TTL
 *                       cache-miss ce in 45.10M subagent ce (0.0%), and no agent type had 2 or more
 *                       events across 1,756 subagent requests.
 *  - D-SPAWN-ORDER-NO-CACHE
 *                       The spawn field order does not change. Evidence (R-453b = B): the staggered
 *                       Code first turn read 18,889 tokens, equal to the static prefix (n = 1), and 5
 *                       of 5 wave-A staggered first turns read the modal 24,534. The cache matches
 *                       whole blocks, so a field reorder buys nothing. R-453c: no probe.
 *  - D-CODE-FULL-SUITE-BRIEF
 *                       No product lever; a brief gives Code named test files only. Evidence: 3 Code
 *                       spawns ran the full test suite in the foreground for 337 to 431 s, past the
 *                       5-minute cache TTL. That is about 1.35M ce, 6.4% of Code ce. 2 of the 3 came
 *                       from a hand-written orchestrator brief that asked for the full suite. The
 *                       /implement and /resolve spawn prompts never ask for it. The Code bodies
 *                       already ban the full suite, and Validate owns it.
 *
 * The bodies sit outside the shared `## Running commands` block: `running-commands-parity.test.ts`
 * owns that block's bytes, and nothing here may enter it. Each arm runs through a named collector, and
 * every known-bad probe runs through the same collector as the real corpus. Corpus reads are loud: a
 * missing build output or a source tree standing in for one throws instead of skipping.
 *
 * What a green run does NOT prove
 * -------------------------------
 * - It proves the compiled text carries each line once, outside the block, with the stated numbers. It
 *   does not prove an agent obeys a line, or that 400 lines is the best threshold; the figures are the
 *   audit's and this file only holds them still.
 * - The split rule is checked as wording in the planning reference and the compiled `/implement`. The
 *   planner that counts files and steps is a model, so no test proves a given plan splits correctly.
 * - The three #453 records add no product lever, so they have no text in any body. The test holds only
 *   that this header names each record with one key number; the numbers come from the audit.
 */

import { describe, it, expect } from 'vitest'

import { CORE_RULES_DIGEST } from '../fixtures/agent-config.js'
import {
  collectUnfencedH2,
  loadFile,
  readAgentReference,
  requireDistFile,
  resolveAgentSource,
  resolveLearningOffSource,
} from '../helpers.js'

const BLOCK_HEADING = '## Running commands'
const AGENTS = ['code', 'fix', 'refactor'] as const
const MIN_BODY_BYTES = 3000

const READ_ONCE_MARKER = '**Read once**'
const READ_ONCE_FRAGMENTS = ['Never re-read an unchanged file', '`grep -n`', '`offset`', '`limit`'] as const
const SPLIT_FRAGMENTS = ['>= 10 files', '>= 7 steps', '<= 5 files', '<= 6 steps'] as const
const TRIGGER_FRAGMENTS = ['>= 10 files', '>= 7 steps'] as const

/** The #453 records this header must name, each with one key number of its evidence. */
const CACHE_HYGIENE_RECORDS: ReadonlyArray<readonly [string, string]> = [
  ['D-NO-TURN-END-WAIT', '0.0%'],
  ['D-SPAWN-ORDER-NO-CACHE', '18,889'],
  ['D-CODE-FULL-SUITE-BRIEF', '6.4%'],
]
const CE_EXPANSION = 'cost-equivalent (ce)'

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

interface Body {
  readonly label: string
  readonly content: string
}

/** Code, Fix and Refactor, learning on and learning off: six compiled bodies, each read or the run fails. */
function codeFamilyBodies(): Body[] {
  const out: Body[] = []
  for (const name of AGENTS) {
    const on = resolveAgentSource(name)
    if (on.origin !== 'dist') {
      throw new Error(`${name}: only the source tree was found, run \`npm run build:mds\` first (a generator host has no source body)`)
    }
    out.push({ label: `${name} (learning on)`, content: on.content })
    const off = resolveLearningOffSource('agents', name)
    if (off === null) throw new Error(`dist/learning-off/agents/${name}.md is absent, run \`npm run build:mds\` first`)
    out.push({ label: `${name} (learning off)`, content: off })
  }
  return out
}

/** The shared output line: the fixture holds its text, and `validate.md` must carry that exact line once. */
function sharedOutputLine(): string {
  const line = CORE_RULES_DIGEST['context-economy'].line
  const validate = resolveAgentSource('validate').content
  const bullets = validate.split(`\n- ${line}\n`).length - 1
  if (bullets !== 1) throw new Error(`validate.md carries the shared output line ${bullets} times, expected 1`)
  return line
}

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/** Start and end offsets of the `## Running commands` section, or null when the body has none. */
function runningBlock(body: string): { readonly start: number; readonly end: number } | null {
  const h2 = collectUnfencedH2(body)
  const i = h2.findIndex(h => h.text === BLOCK_HEADING)
  if (i === -1) return null
  return { start: h2[i].index, end: i + 1 < h2.length ? h2[i + 1].index : body.length }
}

/** Offsets of every occurrence of `needle`; the scan moves forward each step, so it ends. */
function offsetsOf(body: string, needle: string): number[] {
  const out: number[] = []
  for (let at = body.indexOf(needle); at !== -1; at = body.indexOf(needle, at + needle.length)) out.push(at)
  return out
}

/** The whole line that holds offset `at`. */
function lineAt(body: string, at: number): string {
  const start = body.lastIndexOf('\n', at) + 1
  const end = body.indexOf('\n', at)
  return body.slice(start, end === -1 ? body.length : end)
}

/** Named collector (D-CODE-READ-ONCE): how a body's read-once line differs from "once, outside the block, over 400 lines". */
export function collectReadOnceDefects(body: string): string[] {
  const block = runningBlock(body)
  if (block === null) return ['no Running commands block']
  const found = offsetsOf(body, READ_ONCE_MARKER)
  if (found.length !== 1) return [`${found.length} read-once lines, expected 1`]
  const out: string[] = []
  if (found[0] >= block.start && found[0] < block.end) out.push('the read-once line sits inside the Running commands block')
  const line = lineAt(body, found[0])
  if (!/ over 400 lines\b/.test(line)) out.push('the read-once line does not state the threshold "over 400 lines"')
  for (const fragment of READ_ONCE_FRAGMENTS) {
    if (!line.includes(fragment)) out.push(`the read-once line does not say ${fragment}`)
  }
  return out
}

/** Named collector (D-CODE-QUIET): how a body's copy of the shared output line differs from "once, outside the block". */
export function collectOutputLineDefects(body: string, line: string): string[] {
  const block = runningBlock(body)
  if (block === null) return ['no Running commands block']
  const found = offsetsOf(body, line)
  if (found.length !== 1) return [`${found.length} shared output lines, expected 1`]
  return found[0] >= block.start && found[0] < block.end ? ['the shared output line sits inside the Running commands block'] : []
}

/** Named collector (D-SEQ-SPLIT): how the planning reference differs from the one split rule. */
export function collectSplitRuleDefects(text: string): string[] {
  const out: string[] = []
  const rules = text.split('\n').filter(l => l.startsWith('- **SEQUENTIAL_CODE_AGENTS**'))
  if (rules.length !== 1) out.push(`${rules.length} SEQUENTIAL_CODE_AGENTS rule lines, expected 1`)
  else for (const fragment of SPLIT_FRAGMENTS) {
    if (!rules[0].includes(fragment)) out.push(`the SEQUENTIAL_CODE_AGENTS rule does not state "${fragment}"`)
  }
  if (/\bConsider\b/.test(text)) out.push('the reference still says "Consider"')
  if (/\d\s*%/.test(text)) out.push('the reference still carries a percent label')
  const header = text.split('\n').find(l => l.startsWith('| Phase |'))
  if (header === undefined || !/\| Files \| Steps \|/.test(header)) out.push('the Subtask Breakdown table does not list Files and Steps for each phase')
  return out
}

/** Named collector (D-SEQ-SPLIT): how a compiled `/implement` differs from "no plan means one Code agent, same trigger as the reference". */
export function collectNoPlanDefects(command: string): string[] {
  const out: string[] = []
  const lines = command.split('\n')
  const rules = lines.filter(l => l.startsWith('- Otherwise: SINGLE_CODE_AGENT'))
  if (rules.length !== 1) out.push(`${rules.length} no-plan SINGLE_CODE_AGENT rule lines, expected 1`)
  else {
    if (!rules[0].includes('no Subtask Breakdown to split')) out.push('the no-plan rule does not give its reason: no Subtask Breakdown to split')
    if (/unless|complexity/i.test(rules[0])) out.push('the no-plan rule still has an exception')
  }
  const rows = lines.filter(l => l.startsWith('| **SEQUENTIAL_CODE_AGENTS** |'))
  if (rows.length !== 1) out.push(`${rows.length} SEQUENTIAL_CODE_AGENTS strategy rows, expected 1`)
  else for (const fragment of TRIGGER_FRAGMENTS) {
    if (!rows[0].includes(fragment)) out.push(`the SEQUENTIAL_CODE_AGENTS strategy row does not state "${fragment}"`)
  }
  if (lines.some(l => /\| Frequency \|/.test(l))) out.push('the strategy table still has a Frequency column')
  return out
}

/** This file's own header comment: everything before the first end of a block comment. */
function ownHeader(): string {
  const source = loadFile('tests/guards/code-read-economy.test.ts')
  const end = source.indexOf('*/')
  if (end === -1) throw new Error('code-read-economy.test.ts has no header comment')
  return source.slice(0, end)
}

/** Header list entries by record name. An entry is its bullet line plus the lines up to the next bullet or blank line. */
function headerEntries(header: string): Map<string, string[]> {
  const entries = new Map<string, string[]>()
  let name: string | null = null
  let lines: string[] = []
  const flush = (): void => {
    if (name !== null) entries.set(name, [...(entries.get(name) ?? []), lines.join('\n')])
    name = null
    lines = []
  }
  for (const line of header.split('\n')) {
    const bullet = /^ \*  - (D-[A-Z0-9-]+)/.exec(line)
    if (bullet !== null) {
      flush()
      name = bullet[1]
    } else if (/^ \*\s*$/.test(line)) {
      flush()
    }
    if (name !== null) lines.push(line)
  }
  flush()
  return entries
}

/** Named collector (#453 records): how a header differs from "each record named once, with its key number, and ce spelled out first". */
export function collectRecordDefects(header: string, records: ReadonlyArray<readonly [string, string]>): string[] {
  const out: string[] = []
  const entries = headerEntries(header)
  for (const [name, number] of records) {
    const found = entries.get(name) ?? []
    if (found.length !== 1) out.push(`${found.length} header entries for ${name}, expected 1`)
    else if (!found[0].includes(number)) out.push(`${name} does not state "${number}"`)
  }
  const spelled = offsetsOf(header, CE_EXPANSION)
  if (spelled.length !== 1) out.push(`${spelled.length} places spell out "${CE_EXPANSION}", expected 1`)
  else if (header.search(/\bce\b/) < spelled[0]) out.push('the header uses "ce" before it spells it out')
  return out
}

// ---------------------------------------------------------------------------
// The corpus arms
// ---------------------------------------------------------------------------

describe('Code, Fix and Refactor read a file once and cap their output, in both builds (D-CODE-READ-ONCE, D-CODE-QUIET)', () => {
  it('reads six compiled bodies: three agents, learning on and off', () => {
    const bodies = codeFamilyBodies()
    expect(bodies.map(b => b.label)).toEqual([
      'code (learning on)', 'code (learning off)',
      'fix (learning on)', 'fix (learning off)',
      'refactor (learning on)', 'refactor (learning off)',
    ])
    for (const { label, content } of bodies) expect(content.length, `${label}: nothing read`).toBeGreaterThan(MIN_BODY_BYTES)
  })

  it('each body carries the read-once line once, outside the Running commands block, with the 400-line threshold', () => {
    for (const { label, content } of codeFamilyBodies()) {
      expect(collectReadOnceDefects(content), label).toEqual([])
    }
  })

  it('each body carries the shared output line once, outside the block, byte for byte the line in validate.md', () => {
    const line = sharedOutputLine()
    for (const { label, content } of codeFamilyBodies()) {
      expect(collectOutputLineDefects(content, line), label).toEqual([])
    }
  })

  it('known-bad probe: a missing, duplicate, misplaced or mis-numbered read-once line is each reported', () => {
    const body = resolveAgentSource('code').content
    const line = lineAt(body, body.indexOf(READ_ONCE_MARKER))
    expect(line, 'the seed line must exist').toContain(READ_ONCE_MARKER)
    expect(collectReadOnceDefects(body)).toEqual([])

    const missing = body.replace(`${line}\n`, '')
    expect(missing, 'the seed must land').not.toBe(body)
    expect(collectReadOnceDefects(missing)).toEqual(['0 read-once lines, expected 1'])

    const duplicate = body.replace(line, `${line}\n${line}`)
    expect(duplicate, 'the seed must land').not.toBe(body)
    expect(collectReadOnceDefects(duplicate)).toEqual(['2 read-once lines, expected 1'])

    const inBlock = missing.replace('- The same rules hold', `${line}\n- The same rules hold`)
    expect(inBlock, 'the seed must land').not.toBe(missing)
    expect(collectReadOnceDefects(inBlock)).toEqual(['the read-once line sits inside the Running commands block'])

    const threshold = body.replace('over 400 lines', 'over 300 lines')
    expect(threshold, 'the seed must land').not.toBe(body)
    expect(collectReadOnceDefects(threshold)).toEqual(['the read-once line does not state the threshold "over 400 lines"'])

    const noRange = body.replace('`grep -n` first, then ', '')
    expect(noRange, 'the seed must land').not.toBe(body)
    expect(collectReadOnceDefects(noRange)).toEqual(['the read-once line does not say `grep -n`'])

    expect(collectReadOnceDefects('no block here')).toEqual(['no Running commands block'])
  })

  it('known-bad probe: a missing, duplicate or misplaced shared output line is each reported', () => {
    const body = resolveAgentSource('code').content
    const shared = sharedOutputLine()
    expect(collectOutputLineDefects(body, shared)).toEqual([])

    const missing = body.replace(shared, 'Keep output short.')
    expect(missing, 'the seed must land').not.toBe(body)
    expect(collectOutputLineDefects(missing, shared)).toEqual(['0 shared output lines, expected 1'])

    const duplicate = body.replace(shared, `${shared}\n- ${shared}`)
    expect(duplicate, 'the seed must land').not.toBe(body)
    expect(collectOutputLineDefects(duplicate, shared)).toEqual(['2 shared output lines, expected 1'])

    const inBlock = missing.replace('- The same rules hold', `- ${shared}\n- The same rules hold`)
    expect(inBlock, 'the seed must land').not.toBe(missing)
    expect(collectOutputLineDefects(inBlock, shared)).toEqual(['the shared output line sits inside the Running commands block'])

    const reworded = body.replace('cap any output you print', 'cap any output')
    expect(reworded, 'the seed must land').not.toBe(body)
    expect(collectOutputLineDefects(reworded, shared)).toEqual(['0 shared output lines, expected 1'])

    expect(collectOutputLineDefects('no block here', shared)).toEqual(['no Running commands block'])
  })
})

// ---------------------------------------------------------------------------
// The split rule
// ---------------------------------------------------------------------------

describe('a long plan splits into sequential phases and a run with no plan is one Code agent (D-SEQ-SPLIT)', () => {
  it('the planning reference states the one split rule, with no "Consider" and no percent label', () => {
    const text = readAgentReference('synthesize/planning.md')
    expect(text.length, 'nothing read').toBeGreaterThan(500)
    expect(collectSplitRuleDefects(text)).toEqual([])
  })

  it('the compiled /implement, learning on and off, sends a run with no plan to one Code agent and agrees on the trigger', () => {
    const on = requireDistFile('implement.md')
    const off = resolveLearningOffSource('commands', 'implement')
    if (off === null) throw new Error('dist/learning-off/commands/implement.md is absent, run `npm run build:mds` first')
    for (const [label, content] of [['learning on', on], ['learning off', off]] as const) {
      expect(content.length, `${label}: nothing read`).toBeGreaterThan(MIN_BODY_BYTES)
      expect(collectNoPlanDefects(content), label).toEqual([])
    }
  })

  it('known-bad probe: a lost or changed threshold, a "Consider", a percent label and a lost column are each reported', () => {
    const text = readAgentReference('synthesize/planning.md')

    const filesThreshold = text.replace('>= 10 files', '>= 8 files')
    expect(filesThreshold, 'the seed must land').not.toBe(text)
    expect(collectSplitRuleDefects(filesThreshold)).toEqual(['the SEQUENTIAL_CODE_AGENTS rule does not state ">= 10 files"'])

    const phaseSteps = text.replace('<= 6 steps', '<= 8 steps')
    expect(phaseSteps, 'the seed must land').not.toBe(text)
    expect(collectSplitRuleDefects(phaseSteps)).toEqual(['the SEQUENTIAL_CODE_AGENTS rule does not state "<= 6 steps"'])

    const consider = text.replace('Count the files', 'Consider the files')
    expect(consider, 'the seed must land').not.toBe(text)
    expect(collectSplitRuleDefects(consider)).toEqual(['the reference still says "Consider"'])

    const percent = text.replace('- **SINGLE_CODE_AGENT**: every other plan.', '- **SINGLE_CODE_AGENT** (~80%): every other plan.')
    expect(percent, 'the seed must land').not.toBe(text)
    expect(collectSplitRuleDefects(percent)).toEqual(['the reference still carries a percent label'])

    const noColumns = text.replace('| Files | Steps |', '| Files |')
    expect(noColumns, 'the seed must land').not.toBe(text)
    expect(collectSplitRuleDefects(noColumns)).toEqual(['the Subtask Breakdown table does not list Files and Steps for each phase'])

    expect(collectSplitRuleDefects('no rule here')).toContain('0 SEQUENTIAL_CODE_AGENTS rule lines, expected 1')
  })

  it('known-bad probe: a lost reason, a kept exception, a changed trigger and a Frequency column are each reported', () => {
    const command = requireDistFile('implement.md')
    expect(collectNoPlanDefects(command)).toEqual([])

    const noReason = command.replace(', because there is no Subtask Breakdown to split', '')
    expect(noReason, 'the seed must land').not.toBe(command)
    expect(collectNoPlanDefects(noReason)).toEqual(['the no-plan rule does not give its reason: no Subtask Breakdown to split'])

    const exception = command.replace('no Subtask Breakdown to split', 'no Subtask Breakdown to split, unless task description signals high complexity')
    expect(exception, 'the seed must land').not.toBe(command)
    expect(collectNoPlanDefects(exception)).toEqual(['the no-plan rule still has an exception'])

    const trigger = command.replace('>= 7 steps', '>= 9 steps')
    expect(trigger, 'the seed must land').not.toBe(command)
    expect(collectNoPlanDefects(trigger)).toEqual(['the SEQUENTIAL_CODE_AGENTS strategy row does not state ">= 7 steps"'])

    const frequency = command.replace('| Strategy | When |', '| Strategy | When | Frequency |')
    expect(frequency, 'the seed must land').not.toBe(command)
    expect(collectNoPlanDefects(frequency)).toEqual(['the strategy table still has a Frequency column'])

    expect(collectNoPlanDefects('no rule here')).toEqual([
      '0 no-plan SINGLE_CODE_AGENT rule lines, expected 1',
      '0 SEQUENTIAL_CODE_AGENTS strategy rows, expected 1',
    ])
  })
})

// ---------------------------------------------------------------------------
// The #453 cache-hygiene records
// ---------------------------------------------------------------------------

describe('the #453 cache-hygiene outcomes are recorded in this header (D-NO-TURN-END-WAIT, D-SPAWN-ORDER-NO-CACHE, D-CODE-FULL-SUITE-BRIEF)', () => {
  it('the header names all three records, each with a key number, and spells out ce before it uses it', () => {
    const header = ownHeader()
    expect(header, 'not the header comment').toContain('Decisions recorded here')
    expect(collectRecordDefects(header, CACHE_HYGIENE_RECORDS)).toEqual([])

    const renamed = header.replace('- D-SPAWN-ORDER-NO-CACHE', '- D-SPAWN-ORDER')
    expect(renamed, 'the seed must land').not.toBe(header)
    expect(collectRecordDefects(renamed, CACHE_HYGIENE_RECORDS)).toEqual(['0 header entries for D-SPAWN-ORDER-NO-CACHE, expected 1'])

    const noNumber = header.replace('18,889', '18,000')
    expect(noNumber, 'the seed must land').not.toBe(header)
    expect(collectRecordDefects(noNumber, CACHE_HYGIENE_RECORDS)).toEqual(['D-SPAWN-ORDER-NO-CACHE does not state "18,889"'])

    const duplicate = `${header}\n *  - D-NO-TURN-END-WAIT 0.0% again\n`
    expect(collectRecordDefects(duplicate, CACHE_HYGIENE_RECORDS)).toEqual(['2 header entries for D-NO-TURN-END-WAIT, expected 1'])

    const unspelled = header.replace(CE_EXPANSION, 'cost-equivalent')
    expect(unspelled, 'the seed must land').not.toBe(header)
    expect(collectRecordDefects(unspelled, CACHE_HYGIENE_RECORDS)).toEqual([`0 places spell out "${CE_EXPANSION}", expected 1`])

    expect(collectRecordDefects(`ce ${header}`, CACHE_HYGIENE_RECORDS)).toEqual(['the header uses "ce" before it spells it out'])
  })
})
