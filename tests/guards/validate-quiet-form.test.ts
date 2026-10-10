/**
 * D-VALIDATE-QUIET-FORM (#427): the Validate agent prefers a tool's quiet output form, and only the
 * failing test is re-run verbosely.
 *
 * A passing run's log is read by nobody, and a failing one is read through `tail`, so the quiet form
 * of a build, typecheck or test command saves the output tokens without losing the verdict. The
 * "Validation Order" table in `validate.md` gains a Quiet form column, and one sentence after it
 * states the fallback: after a failing quiet run, re-run only the failing test with verbose output,
 * never the suite. That sentence is the stated exception to the never-re-run rule in the shared
 * `## Running commands` block, so it sits outside the block, which this change leaves byte-identical
 * in the Code, Validate and Test agents (`tests/guards/running-commands-parity.test.ts` owns the
 * bytes; the arm here asserts the quiet form never entered it).
 *
 * The five language rules (`typescript`, `python`, `go`, `java`, `rust`) each gain exactly one
 * quiet-form bullet with their `paths` frontmatter untouched; `react` names no test runner and gains
 * none. Each arm runs through a named collector with a known-bad probe over the same collector.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, collectUnfencedH2, resolveAgentSource } from '../helpers.js'

const BLOCK_HEADING = '## Running commands'
const FALLBACK = "After a failing quiet run, re-run only the failing test with verbose output, never the suite: this is the one exception to the never-re-run rule under Running commands."

/** The Validation Order table, row by row, as trimmed cells. */
export function tableRows(body: string): string[][] {
  const start = body.indexOf('## Validation Order')
  if (start === -1) return []
  const rest = body.slice(start)
  const end = rest.indexOf('\n\n**Gate ownership:**')
  const section = end === -1 ? rest : rest.slice(0, end)
  return section.split('\n').filter(l => l.startsWith('|')).map(l => l.split('|').slice(1, -1).map(c => c.trim()))
}

/** The forms each row of the table must list, in cell order. */
const EXPECTED_QUIET: Readonly<Record<string, readonly string[]>> = {
  Build: ['`cargo build -q`', '`gradle -q build`', '`mvn -q package`'],
  Typecheck: ['`tsc --pretty false`'],
  Lint: ['none'],
  Test: ['`vitest run --reporter=dot`', '`jest --silent`', '`pytest -q`', '`cargo test -q`', '`go test` without `-v`', '`gradle -q test`', '`mvn -q test`'],
}

/** Named collector: how the table and its fallback sentence differ from the quiet-form design. */
export function collectTableDefects(body: string): string[] {
  const out: string[] = []
  const rows = tableRows(body)
  if (rows.length === 0) return ['no Validation Order table']
  const header = rows[0].join('|')
  if (header !== 'Priority|Command Type|Common Examples|Quiet form') out.push(`the header reads "${rows[0].join(' | ')}"`)
  const data = rows.slice(2)
  if (data.length !== 4) out.push(`${data.length} data rows, expected 4`)
  for (const [type, forms] of Object.entries(EXPECTED_QUIET)) {
    const row = data.find(r => r[1] === type)
    if (row === undefined) { out.push(`no ${type} row`); continue }
    if (row.length !== 4) { out.push(`${type}: ${row.length} cells, expected 4`); continue }
    if (type === 'Lint') {
      if (row[3] !== 'none') out.push('Lint: the Quiet form cell is not exactly "none"')
      continue
    }
    for (const form of forms) if (!row[3].includes(form)) out.push(`${type}: the Quiet form cell does not list ${form}`)
  }
  const blockAt = body.indexOf(BLOCK_HEADING)
  const fallbackAt = body.indexOf(FALLBACK)
  if (fallbackAt === -1) out.push('the fallback sentence is missing or reworded')
  else if (body.split(FALLBACK).length - 1 !== 1) out.push('the fallback sentence appears more than once')
  else if (blockAt !== -1 && fallbackAt > blockAt) out.push('the fallback sentence sits inside or after the Running commands block')
  return out
}

/** Named collector (AC-229): the Running commands block must not carry the table or the fallback. */
export function collectBlockIntrusions(body: string): string[] {
  const h2 = collectUnfencedH2(body)
  const i = h2.findIndex(h => h.text === BLOCK_HEADING)
  if (i === -1) return ['no Running commands block']
  const block = body.slice(h2[i].index, i + 1 < h2.length ? h2[i + 1].index : body.length)
  const out: string[] = []
  if (/Quiet form/.test(block)) out.push('the block names the Quiet form column')
  if (block.split('\n').some(l => l.startsWith('|'))) out.push('the block carries a table row')
  if (/failing quiet run/.test(block)) out.push('the block carries the fallback sentence')
  return out
}

describe('the Validation Order table has a Quiet form column and a fallback sentence (D-VALIDATE-QUIET-FORM)', () => {
  it('validate.md lists the quiet forms, a Lint row of none, and the one-failing-test fallback before the block', () => {
    const body = resolveAgentSource('validate').content
    expect(body.length, 'nothing read').toBeGreaterThan(3000)
    expect(collectTableDefects(body)).toEqual([])
  })

  it('the Running commands block holds none of it, so its bytes stay shared with Code and Test', () => {
    for (const agent of ['code', 'validate', 'test']) {
      const body = resolveAgentSource(agent).content
      expect(collectBlockIntrusions(body), agent).toEqual([])
    }
  })

  it('known-bad probe: a lost column, a changed Lint cell, a misplaced fallback and a block intrusion are each reported', () => {
    const body = resolveAgentSource('validate').content
    const noColumn = body.replace('| Priority | Command Type | Common Examples | Quiet form |', '| Priority | Command Type | Common Examples |')
    expect(noColumn, 'the seed must land').not.toBe(body)
    expect(collectTableDefects(noColumn)).toContain('the header reads "Priority | Command Type | Common Examples"')

    const lint = body.replace('`make lint` | none |', '`make lint` | `eslint --quiet` |')
    expect(lint, 'the seed must land').not.toBe(body)
    expect(collectTableDefects(lint)).toEqual(['Lint: the Quiet form cell is not exactly "none"'])

    expect(collectTableDefects(body.replace('`pytest -q`, ', ''))).toEqual(['Test: the Quiet form cell does not list `pytest -q`'])
    expect(collectTableDefects(body.replace(FALLBACK, 'Re-run the suite verbosely.'))).toEqual(['the fallback sentence is missing or reworded'])

    const moved = body.replace(FALLBACK, '').replace('## Principles', `${FALLBACK}\n\n## Principles`)
    expect(collectTableDefects(moved)).toEqual(['the fallback sentence sits inside or after the Running commands block'])

    expect(collectBlockIntrusions(body.replace('- The same rules hold', '| a | b |\n- The same rules hold'))).toEqual(['the block carries a table row'])
    expect(collectBlockIntrusions(body.replace('- The same rules hold', `${FALLBACK}\n- The same rules hold`))).toEqual(['the block carries the fallback sentence'])
    expect(collectBlockIntrusions(body.replace('- The same rules hold', 'Quiet form first.\n- The same rules hold'))).toEqual(['the block names the Quiet form column'])
    expect(collectTableDefects('no table here')).toEqual(['no Validation Order table'])
  })
})

// ---------------------------------------------------------------------------
// The language rules
// ---------------------------------------------------------------------------

/** The five rules that gain one bullet, with the `paths` frontmatter each keeps and the forms it names. */
const RULES: ReadonlyArray<{ readonly name: string; readonly paths: string; readonly forms: readonly string[] }> = [
  { name: 'typescript', paths: 'paths: ["**/*.ts", "**/*.tsx"]', forms: ['vitest run --reporter=dot', 'jest --silent', 'tsc --pretty false'] },
  { name: 'python', paths: 'paths: ["**/*.py"]', forms: ['pytest -q'] },
  { name: 'go', paths: 'paths: ["**/*.go"]', forms: ['go test'] },
  { name: 'java', paths: 'paths: ["**/*.java"]', forms: ['gradle -q', 'mvn -q'] },
  { name: 'rust', paths: 'paths: ["**/*.rs"]', forms: ['cargo build -q', 'cargo test -q'] },
]

const readRule = (name: string): string => readFileSync(path.join(ROOT, 'src', 'assets', 'rules', `${name}.md`), 'utf-8')

/** Named collector: how a language rule differs from "one quiet-form bullet, frontmatter untouched". */
export function collectRuleDefects(name: string, text: string, paths: string, forms: readonly string[]): string[] {
  const out: string[] = []
  if (!text.startsWith(`---\n${paths}\n---\n`)) out.push(`${name}: the paths frontmatter changed`)
  const bullets = text.split('\n').filter(l => l.startsWith('- Quiet form:'))
  if (bullets.length !== 1) out.push(`${name}: ${bullets.length} quiet-form bullets, expected 1`)
  else for (const form of forms) if (!bullets[0].includes(`\`${form}`)) out.push(`${name}: the bullet does not name ${form}`)
  return out
}

describe('five language rules gain one quiet-form bullet each, and react gains none (D-VALIDATE-QUIET-FORM)', () => {
  it('typescript, python, go, java and rust carry exactly one bullet and keep their paths frontmatter', () => {
    expect(RULES.length).toBe(5)
    for (const { name, paths, forms } of RULES) {
      const text = readRule(name)
      expect(text.length, `${name}: nothing read`).toBeGreaterThan(200)
      expect(collectRuleDefects(name, text, paths, forms)).toEqual([])
    }
  })

  it('react.md is unchanged: no quiet-form bullet and its paths frontmatter', () => {
    const react = readRule('react')
    expect(react.startsWith('---\npaths: ["**/*.tsx", "**/*.jsx"]\n---\n')).toBe(true)
    expect(react).not.toMatch(/Quiet form/i)
  })

  it('known-bad probe: a second bullet, a lost bullet, a changed paths line and a lost form are each reported', () => {
    const { name, paths, forms } = RULES[0]
    const text = readRule(name)
    expect(collectRuleDefects(name, `${text}- Quiet form: again\n`, paths, forms)).toEqual([`${name}: 2 quiet-form bullets, expected 1`])
    expect(collectRuleDefects(name, text.replace(/^- Quiet form:.*\n/m, ''), paths, forms)).toEqual([`${name}: 0 quiet-form bullets, expected 1`])
    expect(collectRuleDefects(name, text.replace('"**/*.tsx"', '"**/*.mts"'), paths, forms)).toEqual([`${name}: the paths frontmatter changed`])
    expect(collectRuleDefects(name, text.replace('`jest --silent`', '`jest`'), paths, forms)).toEqual([`${name}: the bullet does not name jest --silent`])
  })
})
