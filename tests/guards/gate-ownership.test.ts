/**
 * Gate-ownership guard (D-GATE-OWNERSHIP).
 *
 * The full test suite has one owner. Before, any agent that "ran the tests" ran
 * whatever the project's test command was, so a single ticket paid for the whole
 * suite from Code, Scrutinize, Test and Validate in turn. Each of the six agent
 * bodies now carries one `**Gate ownership:**` line that says which checks that
 * agent runs, and Validate runs the full suite once per HEAD and is the only
 * agent that does.
 *
 * What this holds:
 *
 *   - each body carries exactly one gate line, and its text is the pinned row;
 *   - every body but Validate's also says that only Validate runs the full suite;
 *   - no body but Validate's instructs a full-suite run, and Simplify and
 *     Evaluate instruct no build, test or lint command at all;
 *   - the TDD skill says "affected tests" where it used to say "all tests", and
 *     defines the term once.
 *
 * The rows are pinned as text, not as intent. A rewording that kept the meaning
 * would still have to change this file, which is the point: the table is the
 * contract the Gate resequencing work builds on, and a quiet edit to one row
 * would put two agents' rows in disagreement. Each arm runs through a named
 * collector and the known-bad probes feed the same collectors a synthetic copy,
 * so a collector that stopped seeing defects fails its own probe.
 */

import { describe, it, expect } from 'vitest'
import { ROOT, resolveAgentSource } from '../helpers.js'
import { readFileSync } from 'fs'
import * as path from 'path'

const LABEL = '**Gate ownership:**'
const ONLY_VALIDATE = 'Only Validate runs the full suite.'

/** The six bodies that carry a gate row. */
const GATE_ROWS: Readonly<Record<string, string>> = {
  code:
    'Run the targeted tests for your change in its TDD cycle, plus one affected-tests run after your last edit. ' +
    'In a fix mode, compile and run the named failing or regression tests. Never the full suite. ' +
    'Batch fixes: one build check per batch, not per edit.',
  simplify: 'Run no build, test or lint command. Reading files and git diffs is not verification.',
  evaluate: 'Run no build, test or lint command. Git read commands only.',
  scrutinize: 'Run only a test file you added or changed, once.',
  test: 'Run the scenario commands. Never the full suite.',
  validate: 'Run the full suite once per HEAD. You are the only agent that does.',
}

const GATE_BODIES = Object.keys(GATE_ROWS)

/** The line a body must carry: the row, plus the ownership sentence for everyone but Validate. */
function expectedLine(name: string): string {
  return `${LABEL} ${GATE_ROWS[name]}${name === 'validate' ? '' : ` ${ONLY_VALIDATE}`}`
}

/** Named collector: gate lines a body does not carry exactly once, or carries reworded. */
function collectRowDefects(name: string, content: string): string[] {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.startsWith(LABEL))
  if (lines.length !== 1) return [`${name}: expected exactly one "${LABEL}" line, found ${lines.length}`]
  return lines[0] === expectedLine(name) ? [] : [`${name}: gate row differs from the pinned text`]
}

/**
 * A line that instructs running the whole suite. Narrow on purpose: it needs a
 * run verb, then "full", "whole" or "entire", then "suite" or "test suite".
 */
const FULL_SUITE_RUN = /\b(run|runs|execute|re-run)\b[^.\n]{0,40}\b(full|whole|entire)\b[^.\n]{0,20}\bsuite\b/i

/** A line that forbids or assigns the full suite rather than instructing it. */
const FORBIDS_OR_ASSIGNS = /\b(never|do not|don't|only validate|not the full)\b/i

/** Named collector: full-suite instructions in a body that does not own the suite. */
function collectFullSuiteDefects(name: string, content: string): string[] {
  if (name === 'validate') return []
  return content
    .split('\n')
    .filter(l => FULL_SUITE_RUN.test(l) && !FORBIDS_OR_ASSIGNS.test(l))
    .map(l => `${name}: instructs a full-suite run: ${l.trim()}`)
}

/** A shell command that builds, tests or lints. */
const BUILD_TEST_LINT_COMMAND = /\b(npm|pnpm|yarn|npx|cargo|go|make|tsc|eslint|vitest|jest|pytest)\s+(run\s+)?(build|test|lint|typecheck|check|vet)\b/i

/** Named collector: build, test or lint commands in a body that must not run any. */
function collectCommandDefects(name: string, content: string): string[] {
  if (name !== 'simplify' && name !== 'evaluate') return []
  return content
    .split('\n')
    .filter(l => BUILD_TEST_LINT_COMMAND.test(l))
    .map(l => `${name}: instructs a build, test or lint command: ${l.trim()}`)
}

/** Named collector: how the TDD skill departs from "affected tests". */
function collectTddDefects(skill: string): string[] {
  const defects: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) defects.push(what) }
  need('Step 2 checkpoint says "All affected tests pass"', skill.includes('**Checkpoint:** All affected tests pass.'))
  need('Step 3 runs the affected tests after every refactoring step', skill.includes('Run the affected tests after every refactoring step.'))
  need('Step 3 checkpoint says "All affected tests still pass"', skill.includes('**Checkpoint:** All affected tests still pass.'))
  need('the cycle checklist says "ALL affected tests pass"', skill.includes('ALL affected tests pass, not just the new one'))
  need('"all tests" no longer stands for the whole suite', !/^\*\*Checkpoint:\*\* All tests (still )?pass/m.test(skill) && !skill.includes('ALL tests pass'))
  const definitions = skill.split('**Affected tests**').length - 1
  need(`the term is defined exactly once (found ${definitions})`, definitions === 1)
  need('the definition names Jest and Vitest related-test selection', skill.includes('`--findRelatedTests`') && skill.includes("Vitest's `related`"))
  need('the definition falls back to the owning package or path', skill.includes('the package or path that owns them'))
  return defects
}

const body = (name: string): string => resolveAgentSource(name).content

const tddSkill = (): string =>
  readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'test-driven-development', 'SKILL.md'), 'utf-8')

describe('D-GATE-OWNERSHIP: who runs which check', () => {
  it('there are six gate bodies, one per gate row', () => {
    expect(GATE_BODIES.length).toBeGreaterThanOrEqual(6)
  })

  it('each of the six bodies carries exactly its pinned gate row', () => {
    for (const name of GATE_BODIES) expect(collectRowDefects(name, body(name))).toEqual([])
  })

  it('every body but Validate\'s says that only Validate runs the full suite', () => {
    for (const name of GATE_BODIES.filter(n => n !== 'validate')) {
      expect(body(name), `${name}.md must say it`).toContain(ONLY_VALIDATE)
    }
  })

  it('no body but Validate\'s instructs a full-suite run', () => {
    for (const name of GATE_BODIES) expect(collectFullSuiteDefects(name, body(name))).toEqual([])
  })

  it('Simplify and Evaluate instruct no build, test or lint command', () => {
    for (const name of ['simplify', 'evaluate']) expect(collectCommandDefects(name, body(name))).toEqual([])
  })

  it('the TDD skill says "affected tests" and defines the term once', () => {
    expect(collectTddDefects(tddSkill())).toEqual([])
  })

  it('known-bad probe: a seeded "run the full test suite" line in a copy of code.md is reported', () => {
    const seeded = `${body('code')}\n5. Run the full test suite before you commit.\n`
    expect(collectFullSuiteDefects('code', seeded)).toEqual([
      'code: instructs a full-suite run: 5. Run the full test suite before you commit.',
    ])
    expect(collectFullSuiteDefects('validate', seeded), 'Validate owns the suite').toEqual([])
  })

  it('known-bad probe: a reworded row, a lost row and a doubled row are reported', () => {
    const code = body('code')
    expect(collectRowDefects('code', code.replace('Never the full suite.', 'Run the suite if you like.'))).toEqual([
      'code: gate row differs from the pinned text',
    ])
    expect(collectRowDefects('code', code.replace(LABEL, '**Gate:**'))).toEqual([
      'code: expected exactly one "**Gate ownership:**" line, found 0',
    ])
    expect(collectRowDefects('code', `${code}\n${expectedLine('code')}\n`)).toEqual([
      'code: expected exactly one "**Gate ownership:**" line, found 2',
    ])
  })

  it('known-bad probe: a build command in Simplify and an unqualified "all tests" in the skill are reported', () => {
    expect(collectCommandDefects('simplify', `${body('simplify')}\nThen run \`npm run lint\` to confirm.\n`)).toEqual([
      'simplify: instructs a build, test or lint command: Then run `npm run lint` to confirm.',
    ])
    expect(collectTddDefects(tddSkill().replace('**Checkpoint:** All affected tests pass.', '**Checkpoint:** All tests pass.')).length)
      .toBeGreaterThan(0)
  })
})
