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
 * What a green run does NOT prove: it proves the files carry the text. It does not prove that a model
 * follows it, or that a command passes the inputs.
 */

import { describe, it, expect } from 'vitest'

import { resolveAgentSource, resolveCurationOffSource, resolveVariantOffSource } from '../helpers.js'

const INPUT_HEAD = '- **ACCEPTANCE_CRITERIA**, **KNOWN_LIMITS** (optional):'

const CODE_INPUT_LINE =
  `${INPUT_HEAD} Build only to the criteria and not past a stated limit. ` +
  'A limit or a missing criterion never drops a trust-boundary, data-loss, security or fail-closed check or its test.'

const HARDEN_INPUT_LINE = `${INPUT_HEAD} Check only to the criteria. A stated limit is not a finding.`

/** The Harden never-cut sentence follows the rule that names the trust-boundary, data-loss, security and fail-closed paths. */
const HARDEN_NEVER_CUT =
  'or a trust-boundary, data-loss, security or fail-closed path included. A limit or a missing criterion never drops that fix.'

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

/** Named collector: how a Harden body falls short of its never-cut sentence, stated once. */
function collectHardenNeverCutDefects(label: string, text: string): string[] {
  const copies = text.split(HARDEN_NEVER_CUT).length - 1
  return copies === 1 ? [] : [`${label}: the never-cut sentence appears ${copies} times, expected 1`]
}

describe('the Code agent reads ACCEPTANCE_CRITERIA and KNOWN_LIMITS in every build (#756)', () => {
  it.each(codeBuilds().map(b => [b.label, b.text] as const))('%s carries the input line and its never-cut clause once', (label, text) => {
    expect(text.length, 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(4_000)
    expect(collectInputLineDefects(label, text, CODE_INPUT_LINE)).toEqual([])
  })

  it('known-bad probes: a lost never-cut clause, a lost limit rule and a repeated line are each reported', () => {
    const [{ label, text }] = codeBuilds()
    const clause = 'A limit or a missing criterion never drops a trust-boundary, data-loss, security or fail-closed check or its test.'
    const noClause = text.replace(` ${clause}`, '')
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

describe('the Harden agent reads ACCEPTANCE_CRITERIA and KNOWN_LIMITS in both builds (#756)', () => {
  it.each(hardenBuilds().map(b => [b.label, b.text] as const))('%s carries the input line and the never-cut sentence once', (label, text) => {
    expect(text.length, 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(2_000)
    expect(collectInputLineDefects(label, text, HARDEN_INPUT_LINE)).toEqual([])
    expect(collectHardenNeverCutDefects(label, text)).toEqual([])
  })

  it('known-bad probes: a lost never-cut sentence, a lost limit rule and a repeated sentence are each reported', () => {
    const [{ label, text }] = hardenBuilds()
    const noSentence = text.replace(' A limit or a missing criterion never drops that fix.', '')
    expect(noSentence, 'the seed must land').not.toBe(text)
    expect(collectHardenNeverCutDefects(label, noSentence)).toEqual([`${label}: the never-cut sentence appears 0 times, expected 1`])
    const noLimit = text.replace(' A stated limit is not a finding.', '')
    expect(noLimit, 'the seed must land').not.toBe(text)
    expect(collectInputLineDefects(label, noLimit, HARDEN_INPUT_LINE)).toEqual([`${label}: the criteria-and-limits input line differs from the pinned text`])
    expect(collectHardenNeverCutDefects(label, `${text}\n${HARDEN_NEVER_CUT}\n`)).toEqual([`${label}: the never-cut sentence appears 2 times, expected 1`])
  })
})
