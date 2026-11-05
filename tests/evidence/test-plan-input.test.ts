/**
 * The test plan is TP lines everywhere it is read.
 *
 *   - The Test agent takes its TEST_PLAN input as TP lines, and no JSON test-plan
 *     shape is left in it.
 *   - `check tp` reads one `## Test Plan` section: a whole plan file, whose other
 *     headings make the script parse the whole document as the plan, is refused.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { resolveAgentSource } from '../helpers.js'
import { VERIFY_EVIDENCE_SCRIPT } from './seam.js'

interface TextFile {
  readonly name: string
  readonly content: string
}

const TEST_AGENT = resolveAgentSource('test').content

/** Every start offset of a non-empty `needle` in `text`. */
function offsetsOf(text: string, needle: string): number[] {
  const out: number[] = []
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) out.push(at)
  return out
}

/** Replace the single occurrence of `from`; throws when there is none or several — an inert seed proves nothing. */
function seedOnce(text: string, from: string, to: string): string {
  const hits = offsetsOf(text, from).length
  if (hits !== 1) throw new Error(`seedOnce: expected exactly one "${from.slice(0, 80)}", found ${hits} — the seed is inert`)
  return text.replace(from, () => to)
}

/**
 * The legacy shape's tokens: its two object keys only it ever had (`scenario` and
 * `setup` are ordinary words), the Test agent's old "scenario list" input, the
 * stringify that fed it, and the object-array type a planner returned.
 */
const LEGACY_SHAPES = ['verificationMethod', 'expectedOutcome', 'scenario list', 'JSON.stringify(TEST_PLAN)', 'testPlan (array of {'] as const

/** Named collector: every legacy test-plan token in each file, as `file: token`. */
function collectLegacyTestPlanShapes(files: readonly TextFile[]): string[] {
  return files.flatMap(f => LEGACY_SHAPES.filter(t => f.content.includes(t)).map(t => `${f.name}: ${t}`))
}

const CONSUMERS: readonly TextFile[] = [{ name: 'agents/test.md', content: TEST_AGENT }]

/** The shipped wording of the TEST_PLAN input, and the spelling that named a scenario list. */
const SHIPPED_INPUT = 'TP lines from /plan, /implement or /resolve (if any)'
const SCENARIO_LIST_INPUT = 'TP lines from /plan, /implement or /resolve, or a scenario list from a planner (if any)'

describe('the Test agent takes its test plan as TP lines', () => {
  it('the corpus is the real agent and declares TEST_PLAN in its Input Context', () => {
    expect(TEST_AGENT.length).toBeGreaterThan(3000)
    const inputs = TEST_AGENT.slice(TEST_AGENT.indexOf('## Input Context'), TEST_AGENT.indexOf('## Responsibilities'))
    expect(inputs.length, 'the Input Context section must be found').toBeGreaterThan(100)
    expect(inputs).toContain('- **TEST_PLAN**:')
    expect(inputs).toContain(SHIPPED_INPUT)
  })

  it('it carries no legacy test-plan token', () => {
    expect(collectLegacyTestPlanShapes(CONSUMERS)).toEqual([])
  })

  it('known-bad probe: the scenario-list input is reported', () => {
    const seeded = CONSUMERS.map(f => ({ ...f, content: seedOnce(f.content, SHIPPED_INPUT, SCENARIO_LIST_INPUT) }))
    expect(collectLegacyTestPlanShapes(seeded)).toEqual(['agents/test.md: scenario list'])
  })
})

describe('check tp reads the test-plan section — the real script over a plan file', () => {
  interface Outcome { readonly code: number; readonly stdout: string }
  const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as {
    main(argv: readonly string[], deps?: { cwd?: string; stderr?: (t: string) => void }): Outcome
  }
  const TP = [
    '- [ ] TP-1 (AC-1) the endpoint rejects an expired token — method:ci [files: src/auth/**]',
    '- [ ] TP-2 (AC-2) a load of one hundred requests stays under the latency bound — method:local',
  ]
  const PLAN_FILE = [
    '## Implementation Plan', 'Build it.', '',
    '## Acceptance Criteria', '1. MUST reject an expired token.', '2. MUST NOT exceed 200 ms at p99.', '',
    '## Test Plan', ...TP, '',
    '## Test Scenarios', 'TP-1: a token past its expiry; the call returns 401.', 'TP-2: one hundred parallel calls; p99 under 200 ms.', '',
  ].join('\n')

  function check(text: string): number {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-tp-lines-'))
    try {
      const file = path.join(dir, 'in.md')
      fs.writeFileSync(file, text)
      return VE.main(['node', 'verify-evidence.cjs', 'check', 'tp', file], { cwd: dir, stderr: () => {} }).code
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  it('the copied `## Test Plan` section exits 0', () => {
    expect(check(['## Test Plan', ...TP].join('\n') + '\n')).toBe(0)
  })

  it('the whole plan file exits 5: its other headings make the script parse the whole document as the plan', () => {
    expect(check(PLAN_FILE)).toBe(5)
  })

  it('an absent section copies as an empty file, which is refused (exit 5), never admitted', () => {
    expect(check('')).toBe(5)
  })
})
