/**
 * tests/evidence/contract-parity.test.ts
 *
 * SDLC-evidence PR4 (#363): the test-plan contract ↔ pr-evidence.cjs parity.
 *
 *   AC-2  `_plan_contract.mds` define `test_plan_line()` states the TP line, the
 *         three methods, the six closed states and the ladder's precedence, and
 *         each is pinned to the script's exports: the Shape template compiles to a
 *         RegExp that accepts and rejects exactly what TP_LINE_RE does over a
 *         differential table; the Fields prose names the script's own bounds; the
 *         States, Methods and precedence lists equal STATES, METHODS and PRECEDENCE.
 *         The partial stays import-free with two defines (PF-073), and every
 *         adopter — the two /dynamic-* commands, /plan (#363 P4: its Gate 2 shows
 *         the TP lines its `## Test Plan` section keeps) and, from the commit that
 *         wires it, /implement — carries the define's whole expansion exactly once.
 *
 * The exception grammar is held three ways: `evidence_exception()`'s kind list,
 * code.md's paste gate and the script's EXCEPTION_KINDS / EXCEPTION_LINE_RE name
 * the same kinds in the same order, and the gate IS EXCEPTION_LINE_RE's source.
 *
 * The script's grammar is required, never transcribed: a hand-copied pattern is a
 * second authority that agrees with the first only until one of them is edited.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064).
 *
 * NOT covered: the scenario's "printable" rule is pinned by the rows it names
 * (controls, bidi and separator characters) rather than by compiling the word —
 * a scenario class the prose does not enumerate cannot be derived from prose.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile, resolveAgentSource, walkFiles } from '../helpers.js'
import { PR_EVIDENCE_SCRIPT } from './seam.js'

/** Transcribed from the script's JSDoc — only what this suite reads. */
interface ContractExports {
  readonly STATES: readonly string[]
  readonly METHODS: readonly string[]
  readonly PRECEDENCE: readonly string[]
  readonly EXCEPTION_KINDS: readonly string[]
  readonly LIMITS: Readonly<Record<string, number>>
  readonly TP_LINE_RE: RegExp
  readonly GLOB_RE: RegExp
  readonly EXCEPTION_LINE_RE: RegExp
}
const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as ContractExports

const PARTIAL_PATH = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_plan_contract.mds')
const PARTIAL_IMPORT = './_partials/_plan_contract.mds'
const TP_DEFINE = 'test_plan_line'
const CONTRACT_DEFINE = 'acceptance_criteria_contract'
const EM = '—'

/** PF-073: compile cost is exponential in the define count; the contract partial holds exactly these. */
const KNOWN_DEFINES: readonly string[] = [TP_DEFINE, CONTRACT_DEFINE]
/** The command hosts that import the contract partial, sorted. */
const CONTRACT_ADOPTERS: readonly string[] = ['dynamic-build', 'dynamic-plan', 'plan']

interface TextFile {
  readonly name: string
  readonly content: string
}

function partialSource(): string {
  return readFileSync(PARTIAL_PATH, 'utf-8')
}

/** The body between `@define <name>():` and its `@end`, or null when either is absent. */
function defineBody(source: string, name: string): string | null {
  const lines = source.split('\n')
  const start = lines.indexOf(`@define ${name}():`)
  if (start === -1) return null
  const end = lines.indexOf('@end', start + 1)
  if (end === -1) return null
  return lines.slice(start + 1, end).join('\n')
}

/** Resolve prose brace escapes the way the MDS compiler emits them (`\{` → `{`); the expansion arm checks this model. */
function unescapeMds(text: string): string {
  return text.replace(/\\([{}])/g, '$1')
}

/** The define's built text: what each adopter expands to. */
function contractText(source: string = partialSource()): string {
  const body = defineBody(source, TP_DEFINE)
  if (body === null) throw new Error(`${PARTIAL_PATH}: no \`@define ${TP_DEFINE}():\` … \`@end\` block`)
  return unescapeMds(body)
}

/** Escape a literal for a RegExp source — valid under the `u` flag, so `-` is left bare (outside a class it is literal). */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * The source of one named capture group in a RegExp source, without the group
 * itself. Tracks escapes and character classes; a lookbehind `(?<!` or `(?<=`
 * is a plain group here. Bounded by the source length.
 */
function namedGroupSource(source: string, group: string): string {
  const open = `(?<${group}>`
  const start = source.indexOf(open)
  if (start === -1) throw new Error(`TP_LINE_RE has no (?<${group}>…) group`)
  let depth = 1
  let inClass = false
  for (let i = start + open.length; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') { i++; continue }
    if (inClass) { if (ch === ']') inClass = false; continue }
    if (ch === '[') { inClass = true; continue }
    if (ch === '(') depth++
    if (ch === ')') {
      depth--
      if (depth === 0) return source.slice(start + open.length, i)
    }
  }
  throw new Error(`TP_LINE_RE's (?<${group}>…) group is unbalanced`)
}

// ---------------------------------------------------------------------------
// Collectors over the contract text
// ---------------------------------------------------------------------------

/** The bullet that opens with `- **<label>:**`, or null. */
function bullet(text: string, label: string): string | null {
  const line = text.split('\n').find(l => l.startsWith(`- **${label}:**`))
  return line ?? null
}

/** Every backticked span of a line, in order. */
function spans(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map(m => m[1])
}

/** Named collector: the Shape bullet's two templates — the line and its optional files suffix. */
function collectShapeTemplates(text: string): { line: string; files: string } {
  const shape = bullet(text, 'Shape')
  if (shape === null) throw new Error('the contract has no Shape bullet')
  const all = spans(shape)
  const line = all.find(s => s.startsWith('- [ ] TP-'))
  const files = all.find(s => s.startsWith(' [files:'))
  if (line === undefined || files === undefined) throw new Error('the Shape bullet lacks the line or the files template')
  return { line, files }
}

/** Named collector: the closed state list, as written in the States bullet. */
function collectContractStates(text: string): string[] {
  const states = bullet(text, 'States (closed)')
  if (states === null) return []
  const list = spans(states).find(s => s.includes(' | '))
  return list === undefined ? [] : list.split(' | ')
}

/** Named collector: the precedence chain, as written in the States bullet. */
function collectContractPrecedence(text: string): string[] {
  const states = bullet(text, 'States (closed)')
  if (states === null) return []
  const chain = spans(states).find(s => s.includes(' → '))
  return chain === undefined ? [] : chain.split(' → ')
}

/** Named collector: the method names the Methods bullet defines, in order. */
function collectContractMethods(text: string): string[] {
  const methods = bullet(text, 'Methods')
  if (methods === null) return []
  return [...methods.matchAll(/`([a-z]+)` —/g)].map(m => m[1])
}

interface FieldRules {
  readonly tpMax: number | null
  readonly acMax: number | null
  readonly scenarioMax: number | null
  readonly globClass: string | null
  readonly globsPerLine: number | null
  readonly excluded: readonly string[]
  readonly forbiddenText: string | null
}

/** Named collector: the bounds and exclusions the Fields bullet states. */
function collectFieldRules(text: string): FieldRules {
  const fields = bullet(text, 'Fields') ?? ''
  const num = (re: RegExp): number | null => {
    const m = re.exec(fields)
    return m === null ? null : Number(m[1])
  }
  const excludedClause = /contains no (.*?), and never the text `([^`]+)`/.exec(fields)
  const excluded = excludedClause === null
    ? []
    : [...spans(excludedClause[1]), ...(/\bbacktick\b/.test(excludedClause[1]) ? ['`'] : [])]
  const globClass = /`<glob>` matches `([^`]+)`/.exec(fields)
  return {
    tpMax: num(/`<n>` is 1–(\d+)/),
    acMax: num(/`<m>` in 1–(\d+)/),
    scenarioMax: num(/`<scenario>` is 1–(\d+) printable characters/),
    globClass: globClass === null ? null : globClass[1],
    globsPerLine: num(/at most (\d+) per line/),
    excluded: excluded.sort(),
    forbiddenText: excludedClause === null ? null : excludedClause[2],
  }
}

// ---------------------------------------------------------------------------
// The template compiler
// ---------------------------------------------------------------------------

/** The repetition token of the files template: `,` plus another glob. */
const REPEAT_TOKEN = '[, <glob>…]'

/**
 * Compile the Shape templates into one RegExp, so its accept/reject behaviour can
 * be compared with TP_LINE_RE's.
 *
 *   `<n>` `<m>` `<scenario>`  TP_LINE_RE's own `n`, `ac` and `scenario` groups (each
 *                             is a grammar, not a list; the Fields arm pins their
 *                             bounds against the prose separately)
 *   `<glob>`                  GLOB_RE's class and bound
 *   `<a|b|c>`                 one of the listed values
 *   `[, <glob>…]`             `, <glob>` again, at most (globs per line − 1) times
 *   anything else             literal text — `[ ]`, `[files: ` and `]` included
 *
 * The files template is optional ("optionally followed by").
 */
function compileShape(templates: { line: string; files: string }, globsPerLine: number): RegExp {
  const glob = PE.GLOB_RE.source.replace(/^\^/, '').replace(/\$$/, '')
  const placeholders: Readonly<Record<string, string>> = {
    n: namedGroupSource(PE.TP_LINE_RE.source, 'n'),
    m: namedGroupSource(PE.TP_LINE_RE.source, 'ac'),
    scenario: namedGroupSource(PE.TP_LINE_RE.source, 'scenario'),
    glob,
  }
  const compile = (template: string): string => {
    let out = ''
    for (let i = 0; i < template.length;) {
      if (template.startsWith(REPEAT_TOKEN, i)) {
        out += `(?:, (?:${glob})){0,${globsPerLine - 1}}`
        i += REPEAT_TOKEN.length
        continue
      }
      if (template[i] === '<') {
        const close = template.indexOf('>', i)
        if (close === -1) throw new Error('template: unclosed <')
        const body = template.slice(i + 1, close)
        if (body.includes('|')) out += `(?:${body.split('|').map(escapeRe).join('|')})`
        else if (placeholders[body] !== undefined) out += `(?:${placeholders[body]})`
        else throw new Error(`template: unknown placeholder <${body}>`)
        i = close + 1
        continue
      }
      out += escapeRe(template[i])
      i++
    }
    return out
  }
  return new RegExp(`^${compile(templates.line)}(?:${compile(templates.files)})?$`, 'u')
}

const tp = (n: string | number, m: string | number, scenario: string, method: string, files?: string): string =>
  `- [ ] TP-${n} (AC-${m}) ${scenario} ${EM} method:${method}${files === undefined ? '' : ` [files: ${files}]`}`

/** The differential table: lines TP_LINE_RE accepts, and hostile near-misses. */
function differentialTable(): string[] {
  const rows: string[] = []
  const globs = ['a', 'src/**', '*.ts', 'a?c', '**/x.md', 'a'.repeat(120), '.github/workflows/*.yml']
  for (const method of PE.METHODS) {
    for (const [n, m] of [[1, 1], [9, 99], [10, 100], [99, 999], [100, 5], [199, 1], [200, 999]] as const) {
      rows.push(tp(n, m, 'a scenario', method))
      for (const g of globs) rows.push(tp(n, m, 's', method, g))
      rows.push(tp(n, m, 's', method, Array.from({ length: 10 }, (_, i) => `g${i}`).join(', ')))
    }
  }
  rows.push(
    tp(1, 1, 'x', 'e2e'),                                        // unlisted method
    tp(1, 1, 'x', 'CI'),
    tp(1, 1, 'x', ''),
    tp(1, 1, 'x', 'ci manual'),
    tp(1, 1, 'x', 'ci', Array.from({ length: 11 }, (_, i) => `g${i}`).join(', ')), // 11 globs
    tp(1, 1, 'x', 'ci', ''),                                     // empty files
    tp(1, 1, 'x', 'ci', 'a,b'),
    tp(1, 1, 'x', 'ci', 'a, '),
    tp(1, 1, 'x', 'ci', 'a'.repeat(121)),
    tp(1, 1, 'x', 'ci', '[ab]'),
    tp(1, 1, 'x', 'ci', 'a b'),
    tp(1, 1, 'x', 'ci').replace('- [ ]', '- [x]'),
    tp(1, 1, 'x', 'ci').replace('- [ ]', '-  [ ]'),
    tp(1, 1, 'x', 'ci').replace('(AC-1)', 'AC-1'),
    tp(1, 1, 'x', 'ci').replace(` ${EM} `, ' - '),
    tp(1, 1, 'x', 'ci').replace('method:', 'method: '),
    `${tp(1, 1, 'x', 'ci')} [files: a]x`,
    `${tp(1, 1, 'x', 'ci')} [files a]`,
    `${tp(1, 1, 'x', 'ci')}[files: a]`,
    `${tp(1, 1, 'x', 'ci')} `,
    tp(0, 1, 'x', 'ci'),
    tp(201, 1, 'x', 'ci'),
    tp('01', 1, 'x', 'ci'),
    tp(1, 0, 'x', 'ci'),
    tp(1, 1000, 'x', 'ci'),
    tp(1, 1, 'a'.repeat(201), 'ci'),
    tp(1, 1, 'a<b', 'ci'),
    tp(1, 1, `a ${EM} method:ci`, 'local'),
    '',
  )
  return rows
}

/** Named collector: the table rows on which two grammars disagree. */
function collectGrammarDisagreements(candidate: RegExp, rows: readonly string[]): string[] {
  return rows
    .filter(row => candidate.test(row) !== PE.TP_LINE_RE.test(row))
    .map(row => `${JSON.stringify(row)}: template ${candidate.test(row) ? 'accepts' : 'rejects'}, TP_LINE_RE ${PE.TP_LINE_RE.test(row) ? 'accepts' : 'rejects'}`)
}

// ---------------------------------------------------------------------------
// The partial: shape and adopters (PF-073)
// ---------------------------------------------------------------------------

/** Named collector: the `@define`, `@export` and `@import` lines of an MDS source. */
function collectDeclarations(source: string): { defines: string[]; exports: string[]; imports: string[] } {
  return {
    defines: [...source.matchAll(/^@define ([A-Za-z_][A-Za-z0-9_]*)\(\):/gm)].map(m => m[1]),
    exports: [...source.matchAll(/^@export ([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)].map(m => m[1]),
    imports: [...source.matchAll(/^@import\b.*$/gm)].map(m => m[0]),
  }
}

/** Named collector: which MDS sources import the contract partial, in any import form. */
function collectContractImporters(sources: readonly TextFile[]): string[] {
  const importLine = new RegExp(`^@import\\b.*"${escapeRe(PARTIAL_IMPORT)}"`, 'm')
  return sources.filter(s => importLine.test(s.content)).map(s => s.name).sort()
}

/** Named collector: the files that do not hold `expansion` exactly once. */
function collectExpansionDefects(files: readonly TextFile[], expansion: string): string[] {
  return files
    .map(f => ({ name: f.name, count: f.content.split(expansion).length - 1 }))
    .filter(x => x.count !== 1)
    .map(x => `${x.name}: holds the ${TP_DEFINE}() expansion ${x.count} times (expected 1)`)
}

describe('AC-2: the _plan_contract partial', () => {
  it('declares exactly the two known defines, test_plan_line first, each exported, with no import (PF-073)', () => {
    const { defines, exports, imports } = collectDeclarations(partialSource())
    expect(defines, 'MDS captures at definition site, so the called define comes first').toEqual([...KNOWN_DEFINES])
    expect([...exports].sort()).toEqual([...defines].sort())
    expect(imports).toEqual([])
  })

  it('known-bad probe: a third define and an import are reported', () => {
    const seeded = `@import { x } from "./_y.mds"\n${partialSource()}\n@define smuggled():\nbody\n@end\n`
    const { defines, imports } = collectDeclarations(seeded)
    expect(defines).toContain('smuggled')
    expect(imports).toHaveLength(1)
  })

  it('the contract define calls test_plan_line() exactly once', () => {
    const body = defineBody(partialSource(), CONTRACT_DEFINE) ?? ''
    expect(body.length, 'the contract define is empty').toBeGreaterThan(500)
    expect(body.split('\n').filter(l => l.trim() === `{${TP_DEFINE}()}`)).toHaveLength(1)
  })

  it('is imported by exactly the adopter hosts', () => {
    const corpus = walkFiles(path.join(ROOT, 'src'), f => f.endsWith('.mds')).map(f => ({
      name: path.basename(f, '.mds'),
      content: readFileSync(f, 'utf-8'),
    }))
    expect(corpus.length, 'the src/ .mds walk found nothing').toBeGreaterThanOrEqual(20)
    expect(collectContractImporters(corpus)).toEqual([...CONTRACT_ADOPTERS])
  })

  it('known-bad probe: an unlisted importer is reported', () => {
    const seeded: TextFile[] = [
      { name: 'stray', content: `@import { ${TP_DEFINE} } from "${PARTIAL_IMPORT}"\n` },
      { name: 'unrelated', content: '@import { x } from "./_partials/_other.mds"\n' },
    ]
    expect(collectContractImporters(seeded)).toEqual(['stray'])
  })

  it('every adopter\'s built command carries the whole expansion exactly once', () => {
    const expansion = contractText()
    expect(expansion.length, 'the define body is empty').toBeGreaterThan(600)
    const files = CONTRACT_ADOPTERS.map(h => ({ name: `${h}.md`, content: requireDistFile(`${h}.md`) }))
    expect(collectExpansionDefects(files, expansion)).toEqual([])
  })

  it('known-bad probe: a one-character drift in a built copy is reported', () => {
    const expansion = contractText()
    const files = CONTRACT_ADOPTERS.map(h => ({ name: `${h}.md`, content: requireDistFile(`${h}.md`) }))
    const drifted = files.map((f, i) => (i === 0 ? { ...f, content: f.content.replace('unique and ascending', 'unique, ascending') } : f))
    expect(collectExpansionDefects(drifted, expansion)).toEqual([`${files[0].name}: holds the ${TP_DEFINE}() expansion 0 times (expected 1)`])
  })

  it('the contract names no marker literal and no `<!-- devflow:` text', () => {
    expect(contractText()).not.toMatch(/<!--/)
  })
})

// ---------------------------------------------------------------------------
// AC-2 — the TP line
// ---------------------------------------------------------------------------

describe('AC-2: the Shape template accepts and rejects exactly what TP_LINE_RE does', () => {
  it('over the differential table', () => {
    const text = contractText()
    const rules = collectFieldRules(text)
    expect(rules.globsPerLine).not.toBeNull()
    const compiled = compileShape(collectShapeTemplates(text), rules.globsPerLine ?? 0)
    const rows = differentialTable()
    const accepted = rows.filter(r => PE.TP_LINE_RE.test(r))
    expect(accepted.length, 'too few accepted rows').toBeGreaterThanOrEqual(150)
    expect(rows.length - accepted.length, 'too few hostile rows').toBeGreaterThanOrEqual(25)
    expect(collectGrammarDisagreements(compiled, rows)).toEqual([])
  })

  it('known-bad probe: a template missing `manual` disagrees with TP_LINE_RE', () => {
    const text = contractText()
    const seeded = text.replace('<ci|local|manual>', '<ci|local>')
    expect(seeded, 'the seed must land').not.toBe(text)
    const compiled = compileShape(collectShapeTemplates(seeded), collectFieldRules(text).globsPerLine ?? 0)
    expect(collectGrammarDisagreements(compiled, differentialTable()).length).toBeGreaterThan(0)
  })

  it('known-bad probe: a files bound of 9 disagrees with TP_LINE_RE', () => {
    const text = contractText()
    const compiled = compileShape(collectShapeTemplates(text), 9)
    expect(collectGrammarDisagreements(compiled, differentialTable()).length).toBeGreaterThan(0)
  })
})

describe('AC-2: the Fields prose names the script\'s own bounds', () => {
  const expected: FieldRules = {
    tpMax: PE.LIMITS.TP_MAX,
    acMax: PE.LIMITS.AC_MAX,
    scenarioMax: PE.LIMITS.SCENARIO_MAX,
    globClass: `[A-Za-z0-9._/*?-]{1,${PE.LIMITS.GLOB_MAX}}`,
    globsPerLine: PE.LIMITS.GLOBS_PER_LINE,
    excluded: ['<', '>', '[', ']', '`'].sort(),
    forbiddenText: ` ${EM} method:`,
  }

  it('each bound and exclusion the prose states equals the script\'s', () => {
    expect(collectFieldRules(contractText())).toEqual(expected)
  })

  it('TP_LINE_RE enforces each stated bound at its edge', () => {
    const L = PE.LIMITS
    const ok = (line: string): boolean => PE.TP_LINE_RE.test(line)
    expect(ok(tp(L.TP_MAX, 1, 'x', 'ci'))).toBe(true)
    expect(ok(tp(L.TP_MAX + 1, 1, 'x', 'ci'))).toBe(false)
    expect(ok(tp(1, L.AC_MAX, 'x', 'ci'))).toBe(true)
    expect(ok(tp(1, L.AC_MAX + 1, 'x', 'ci'))).toBe(false)
    expect(ok(tp(1, 1, 'é'.repeat(L.SCENARIO_MAX), 'ci'))).toBe(true)
    expect(ok(tp(1, 1, 'é'.repeat(L.SCENARIO_MAX + 1), 'ci'))).toBe(false)
    expect(ok(tp(1, 1, 'x', 'ci', 'a'.repeat(L.GLOB_MAX)))).toBe(true)
    expect(ok(tp(1, 1, 'x', 'ci', 'a'.repeat(L.GLOB_MAX + 1)))).toBe(false)
    for (const ch of expected.excluded) expect(ok(tp(1, 1, `a${ch}b`, 'ci')), ch).toBe(false)
    expect(ok(tp(1, 1, `a${expected.forbiddenText}ci`, 'ci'))).toBe(false)
  })

  it('the stated glob class is GLOB_RE\'s, over every printable ASCII character', () => {
    const stated = new RegExp(`^${collectFieldRules(contractText()).globClass}$`)
    for (let c = 0x20; c <= 0x7e; c++) {
      const ch = String.fromCharCode(c)
      expect(stated.test(ch), JSON.stringify(ch)).toBe(PE.GLOB_RE.test(ch))
    }
  })

  it('"printable" excludes controls, format and separator characters', () => {
    for (const ch of ['\t', '\r', '\u0000', '\u007f', '\u0085', '​', '‮', '⁦', ' ', ' ', '﻿']) {
      expect(PE.TP_LINE_RE.test(tp(1, 1, `a${ch}b`, 'ci')), JSON.stringify(ch)).toBe(false)
    }
    for (const ch of [' ', 'é', '🚀', '中', EM]) {
      expect(PE.TP_LINE_RE.test(tp(1, 1, `a${ch}b`, 'ci')), JSON.stringify(ch)).toBe(true)
    }
  })

  it('known-bad probe: prose that drops `>` or raises a bound is reported', () => {
    const text = contractText()
    const dropped = text.replace('`<`, `>`, backtick', '`<`, backtick')
    expect(dropped, 'the seed must land').not.toBe(text)
    expect(collectFieldRules(dropped)).not.toEqual(expected)
    const raised = text.replace('`<n>` is 1–200', '`<n>` is 1–250')
    expect(raised, 'the seed must land').not.toBe(text)
    expect(collectFieldRules(raised)).not.toEqual(expected)
  })
})

// ---------------------------------------------------------------------------
// AC-2 — the closed enums and the precedence
// ---------------------------------------------------------------------------

describe('AC-2: the States, Methods and precedence equal the exports', () => {
  it('States (closed) equals STATES, in order', () => {
    const states = collectContractStates(contractText())
    expect(states.length, 'no state list parsed — the collector is blind').toBe(6)
    expect(states).toEqual([...PE.STATES])
  })

  it('known-bad probe: a contract missing STALE is reported', () => {
    const text = contractText()
    const seeded = text.replace(' | STALE', '')
    expect(seeded, 'the seed must land').not.toBe(text)
    expect(collectContractStates(seeded)).not.toEqual([...PE.STATES])
  })

  it('Methods names METHODS, in order, and the Shape alternation lists the same', () => {
    const text = contractText()
    expect(collectContractMethods(text)).toEqual([...PE.METHODS])
    const alternation = /<([a-z]+(?:\|[a-z]+)+)>/.exec(collectShapeTemplates(text).line)
    expect(alternation?.[1].split('|')).toEqual([...PE.METHODS])
  })

  it('known-bad probe: a Methods bullet without `manual` is reported', () => {
    const text = contractText()
    const seeded = text.replace(/; `manual` —[^\n]*/, '.')
    expect(seeded, 'the seed must land').not.toBe(text)
    expect(collectContractMethods(seeded)).not.toEqual([...PE.METHODS])
  })

  it('the precedence chain equals PRECEDENCE, ends in the conservative UNVERIFIED, and names only STATES', () => {
    const chain = collectContractPrecedence(contractText())
    expect(chain.length, 'no precedence chain parsed').toBe(7)
    expect(chain).toEqual([...PE.PRECEDENCE])
    expect(chain[chain.length - 1]).toBe('UNVERIFIED')
    for (const s of chain) expect(PE.STATES).toContain(s)
  })

  it('known-bad probe: a chain with STALE and FAILED swapped is reported', () => {
    const text = contractText()
    const seeded = text.replace('STALE → FAILED', 'FAILED → STALE')
    expect(seeded, 'the seed must land').not.toBe(text)
    expect(collectContractPrecedence(seeded)).not.toEqual([...PE.PRECEDENCE])
  })

  it('only the first two states count as verified, as the contract says', () => {
    expect(contractText()).toContain('Only the first two count as verified.')
    expect(PE.STATES.slice(0, 2)).toEqual(['VERIFIED-CI', 'ATTESTED-LOCAL'])
  })
})

// ---------------------------------------------------------------------------
// EXCEPTION_LINE_RE ↔ code.md's paste gate ↔ the partial's kind set
// ---------------------------------------------------------------------------

const EVIDENCE_POLICY_PARTIAL = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_evidence_policy.mds')

/** code.md's paste gate: the anchored pattern in the fence under its PR_EXCEPTIONS paragraph. */
function codeGateSource(code: string): string {
  const at = code.indexOf('**Pasting `PR_EXCEPTIONS`.**')
  if (at === -1) throw new Error('code.md has no PR_EXCEPTIONS paste paragraph')
  const fence = /```\n\s*(\^[^\n]+\$)\n\s*```/.exec(code.slice(at))
  if (fence === null) throw new Error('code.md: no anchored pattern fence under the PR_EXCEPTIONS paragraph')
  return fence[1]
}

/** The kind set of an exception-line pattern, and the pattern with that set replaced by a placeholder. */
function splitKinds(source: string): { kinds: string[]; rest: string } {
  const m = /^\^- `(?:\(([a-z|-]+)\)|([a-z-]+))`/.exec(source)
  if (m === null) throw new Error(`no kind set at the head of ${source.slice(0, 40)}`)
  const kinds = (m[1] ?? m[2]).split('|')
  return { kinds, rest: source.replace(m[0], '^- `<KIND>`') }
}

/**
 * The kinds `evidence_exception()` (define 2 of `_evidence_policy.mds`) renders:
 * the code spans of its `<kind>` bullet between "is one of" and the first " — ".
 * Read below the template fence, whose own line also opens with "- `<kind>`".
 */
function partialKinds(source: string = readFileSync(EVIDENCE_POLICY_PARTIAL, 'utf-8')): string[] {
  const body = defineBody(source, 'evidence_exception')
  if (body === null) throw new Error(`${EVIDENCE_POLICY_PARTIAL}: no \`@define evidence_exception():\` block`)
  const rules = body.slice(body.indexOf('```', body.indexOf('```markdown') + 3) + 3)
  const bulletLine = rules.split('\n').find(l => l.startsWith('- `<kind>`'))
  if (bulletLine === undefined) return []
  return spans(bulletLine.slice(bulletLine.indexOf(' is one of '), bulletLine.indexOf(' — ')))
}

/**
 * Named collector: where the three statements of the exception grammar disagree —
 * the partial that renders a line, code.md's gate that pastes it, and the script
 * (EXCEPTION_KINDS and EXCEPTION_LINE_RE) that parses it back out of a PR. The gate
 * and the script regex must be the SAME source, so a line one admits the other
 * can never refuse, and all three kind lists must be equal, in order.
 */
function collectExceptionGrammarDisagreements(input: {
  partial: readonly string[]
  gate: string
  script: string
  kinds: readonly string[]
}): string[] {
  const out: string[] = []
  if (input.script !== input.gate) out.push('EXCEPTION_LINE_RE is not code.md\'s paste gate byte for byte')
  const gateKinds = splitKinds(input.gate).kinds
  const scriptKinds = splitKinds(input.script).kinds
  const want = input.kinds.join('|')
  if (input.partial.join('|') !== want) out.push(`the partial renders [${input.partial.join(', ')}], EXCEPTION_KINDS is [${input.kinds.join(', ')}]`)
  if (gateKinds.join('|') !== want) out.push(`code.md's gate admits [${gateKinds.join(', ')}], EXCEPTION_KINDS is [${input.kinds.join(', ')}]`)
  if (scriptKinds.join('|') !== want) out.push(`EXCEPTION_LINE_RE admits [${scriptKinds.join(', ')}], EXCEPTION_KINDS is [${input.kinds.join(', ')}]`)
  return out
}

describe('the exception grammar: the partial, code.md\'s gate and the script agree three ways', () => {
  const live = () => ({
    partial: partialKinds(),
    gate: codeGateSource(resolveAgentSource('code').content),
    script: PE.EXCEPTION_LINE_RE.source,
    kinds: PE.EXCEPTION_KINDS,
  })

  it('the partial, the gate and the script name the same kinds, and the gate is EXCEPTION_LINE_RE', () => {
    const now = live()
    expect(now.partial.length, 'no kind parsed out of the partial — the collector is blind').toBeGreaterThanOrEqual(2)
    expect(now.kinds).toEqual(['ticket-link', 'test-plan'])
    expect(collectExceptionGrammarDisagreements(now)).toEqual([])
    expect(PE.EXCEPTION_LINE_RE.flags).toBe('')
  })

  it('known-bad probes: a narrowed gate, a partial with a third kind and a drifted reason bound are each reported', () => {
    const now = live()
    const narrowedGate = now.gate.replace('(ticket-link|test-plan)', 'ticket-link')
    expect(narrowedGate, 'the seed must land').not.toBe(now.gate)
    expect(collectExceptionGrammarDisagreements({ ...now, gate: narrowedGate })).toEqual([
      'EXCEPTION_LINE_RE is not code.md\'s paste gate byte for byte',
      'code.md\'s gate admits [ticket-link], EXCEPTION_KINDS is [ticket-link, test-plan]',
    ])
    const seededPartial = readFileSync(EVIDENCE_POLICY_PARTIAL, 'utf-8').replace('`ticket-link` or `test-plan`', '`ticket-link`, `test-plan` or `waiver`')
    expect(partialKinds(seededPartial)).toEqual(['ticket-link', 'test-plan', 'waiver'])
    expect(collectExceptionGrammarDisagreements({ ...now, partial: partialKinds(seededPartial) })).toHaveLength(1)
    const drifted = now.script.replace('{0,199}', '{0,299}')
    expect(collectExceptionGrammarDisagreements({ ...now, script: drifted })).toEqual([
      'EXCEPTION_LINE_RE is not code.md\'s paste gate byte for byte',
    ])
  })
})
