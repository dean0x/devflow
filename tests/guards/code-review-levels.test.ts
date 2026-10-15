/**
 * /code-review focus sets per gate level (#474, part of epic #468).
 *
 * `GATE_LEVEL` comes from the accepted settings line. `/code-review` narrows REVIEW_FOCUS_LIST by it in
 * its own step, Step 1.2b, once per worktree and before the diff files are written:
 *   - `full` is today: the command reads nothing and keeps every set.
 *   - `standard` drops `typescript` and, on a `code` diff, `dependencies` unless a listed manifest changed.
 *   - `lean` keeps security, testing and reliability on a `code` diff, plus compliance on its own trigger.
 *   - Security runs at every level and in every class.
 * The class-by-level table lives in `references/commands/code-review-levels.md`. The command reads it only
 * at `standard` or `lean`, once per run, through the sanctioned resolution line, and a failed read applies
 * the full sets.
 *
 * What this file holds, each arm through a named collector and a known-bad probe over the same collector:
 *   1. The reference: its table form, closed vocabulary, subset-by-construction, manifest list and rules.
 *   2. A simulator that reads its rules only from the parsed reference. The expected sets come only from
 *      the hand-written oracle below, so a wrong reference fails the assertions instead of agreeing with them.
 *   3. The gate-level block of the command: read paragraph, invariants, fallback, learning-arm position.
 *   4. Full is today: the Step 1.1 reduced sets, the rule-1 manifests and the Step 1.2 trigger rows.
 *   5. No second cycle: Step 0e-ii only warns, and nothing restarts a phase or starts /resolve.
 *   6. The summary: the Synthesize spawn passes the level and the planned focuses, and the summary template
 *      names them, marks a focus with no report, spells its outcomes as the Merge Rules do and cannot give
 *      APPROVED without a security report, whatever FOCUSES lists.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { GATE_LEVELS } from '../../src/core/gate-level.js'
import { ROOT, SANCTIONED_RESOLUTION, readAgentReference, requireDistFile, resolveLearningOffSource, sectionBetween, tableRows } from '../helpers.js'

// ---------------------------------------------------------------------------
// Independent oracle: written by hand from the issue and the gate decisions, never parsed
// ---------------------------------------------------------------------------

const CORE = ['security', 'architecture', 'performance', 'complexity', 'consistency', 'regression', 'testing', 'reliability'] as const
const LANGUAGE = ['typescript', 'react', 'accessibility', 'ui-design', 'go', 'java', 'python', 'rust'] as const
const CONDITIONAL = ['database', 'dependencies', 'documentation'] as const
const CLASSES = ['code', 'docs-only', 'tests-only', 'lockfile-only'] as const
const REDUCED = ['docs-only', 'tests-only', 'lockfile-only'] as const
const VOCABULARY: readonly string[] = [...CORE, ...LANGUAGE, ...CONDITIONAL, 'compliance']

const FULL_REDUCED: Readonly<Record<string, readonly string[]>> = {
  'docs-only': ['documentation', 'consistency', 'security'],
  'tests-only': ['testing', 'reliability', 'consistency', 'security'],
  'lockfile-only': ['dependencies', 'security'],
}

/** The Step 1.1 rule-1 manifest and build file names. */
const RULE1_MANIFESTS = ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements*.txt', 'CMakeLists.txt'] as const
/** The level reference's own list: rule 1 plus the manifests of Ruby, PHP, Maven, Gradle, other Python layouts, Go workspaces, .NET, Swift, CocoaPods, Dart, Scala, Elixir and Deno. */
const MANIFESTS = [
  ...RULE1_MANIFESTS, 'Gemfile', 'composer.json', 'pom.xml', 'build.gradle*', 'setup.py', 'setup.cfg', 'Pipfile',
  'go.work', '*.csproj', 'Directory.*.props', 'Package.swift', 'Podfile', 'pubspec.yaml', 'build.sbt', 'mix.exs', 'deno.json',
] as const
/** File names a glob entry of the list must also match, beyond the `-dev` fill the loop below makes. */
const GLOB_EXAMPLES = ['build.gradle.kts', 'requirements-dev.txt', 'App.csproj', 'Directory.Packages.props'] as const
/** The rule-4 lockfiles: used only to prove that a lockfile alone drops the dependencies lens. */
const LOCKFILES = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'composer.lock',
  'Podfile.lock', 'pubspec.lock', 'mix.lock', 'Package.resolved', 'deno.lock', 'go.work.sum',
] as const

type Level = 'standard' | 'lean'
interface ExpectedCell { readonly op: 'keep' | 'drop'; readonly names: readonly string[] }

const EXPECTED_CELLS: Readonly<Record<(typeof CLASSES)[number], Readonly<Record<Level, ExpectedCell>>>> = {
  code: {
    standard: { op: 'drop', names: ['typescript', 'dependencies'] },
    lean: { op: 'keep', names: ['security', 'testing', 'reliability', 'compliance'] },
  },
  'docs-only': {
    standard: { op: 'keep', names: ['documentation', 'consistency', 'security'] },
    lean: { op: 'keep', names: ['documentation', 'consistency', 'security'] },
  },
  'tests-only': {
    standard: { op: 'keep', names: ['testing', 'reliability', 'consistency', 'security'] },
    lean: { op: 'keep', names: ['testing', 'reliability', 'security'] },
  },
  'lockfile-only': {
    standard: { op: 'keep', names: ['dependencies', 'security'] },
    lean: { op: 'keep', names: ['dependencies', 'security'] },
  },
}

const DOCS = ['documentation', 'consistency', 'security']
const TESTS = ['testing', 'reliability', 'consistency', 'security']
const TESTS_LEAN = ['testing', 'reliability', 'security']
const LOCK = ['dependencies', 'security']
const DOCS_TESTS = ['documentation', 'consistency', 'security', 'testing', 'reliability']
const TESTS_LOCK = ['testing', 'reliability', 'consistency', 'security', 'dependencies']
const TESTS_LOCK_LEAN = ['testing', 'reliability', 'security', 'dependencies']
const DOCS_LOCK = ['documentation', 'consistency', 'security', 'dependencies']
const ALL_THREE = ['documentation', 'consistency', 'security', 'testing', 'reliability', 'dependencies']

/** Hand-written sets of every reduced and mixed non-code combination, per level (AC-4, AC-5). */
const EXPECTED_SETS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'docs-only': { full: DOCS, standard: DOCS, lean: DOCS },
  'tests-only': { full: TESTS, standard: TESTS, lean: TESTS_LEAN },
  'lockfile-only': { full: LOCK, standard: LOCK, lean: LOCK },
  'docs-only+tests-only': { full: DOCS_TESTS, standard: DOCS_TESTS, lean: DOCS_TESTS },
  'tests-only+lockfile-only': { full: TESTS_LOCK, standard: TESTS_LOCK, lean: TESTS_LOCK_LEAN },
  'docs-only+lockfile-only': { full: DOCS_LOCK, standard: DOCS_LOCK, lean: DOCS_LOCK },
  'docs-only+tests-only+lockfile-only': { full: ALL_THREE, standard: ALL_THREE, lean: ALL_THREE },
}

/** The twelve Step 1.2 trigger rows as they stood before #474, verbatim. */
const TODAY_TRIGGER_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Any .ts or .tsx files', 'typescript'],
  ['.tsx or .jsx files (React components)', 'react'],
  ['.tsx or .jsx files (React components)', 'accessibility'],
  ['.tsx/.jsx/.css/.scss files', 'ui-design'],
  ['.go files', 'go'],
  ['.java files', 'java'],
  ['.py files', 'python'],
  ['.rs files', 'rust'],
  ['DB/migration files', 'database'],
  ['Dependency files changed', 'dependencies'],
  ['Docs or significant code', 'documentation'],
  ['COMPLIANCE_ACTIVE AND diff touches regulated surface', 'compliance'],
]

const LEVEL_REFERENCE_PATH = 'skills/devflow:agent-references/references/commands/code-review-levels.md'

// ---------------------------------------------------------------------------
// Section readers
// ---------------------------------------------------------------------------

const step11 = (body: string): string | null => sectionBetween(body, '#### Step 1.1:', '#### Step 1.2:')
const step12 = (body: string): string | null => sectionBetween(body, '#### Step 1.2:', '#### Step 1.3:')
const step12Own = (body: string): string | null => sectionBetween(body, '#### Step 1.2:', '#### Step 1.2b:')
const step12b = (body: string): string | null => sectionBetween(body, '#### Step 1.2b:', '#### Step 1.3:')
const phase3 = (body: string): string | null => sectionBetween(body, '### Phase 3:', '### Phase 4:')
const gateBlock = (body: string): string | null => sectionBetween(body, '**Gate level.**', '#### Step 1.3:')

/** The names on a section's `**Produces:**` or `**Requires:**` line, parentheticals dropped. */
function dataFlowNames(section: string | null, kind: 'Produces' | 'Requires'): string[] {
  const line = new RegExp(`^\\*\\*${kind}:\\*\\* (.+)$`, 'm').exec(section ?? '')?.[1] ?? ''
  return line.replace(/\([^)]*\)/g, '').split(',').map(n => n.trim()).filter(n => n !== '')
}

const unique = (names: readonly string[]): string[] => [...new Set(names)]
const sameSet = (a: readonly string[], b: readonly string[]): boolean => unique(a).sort().join(',') === unique(b).sort().join(',')
const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** Whether a file name equals a manifest name, where `*` in the name stands for any characters. */
function nameMatches(file: string, pattern: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(file)
}

// ---------------------------------------------------------------------------
// 1. The level reference
// ---------------------------------------------------------------------------

interface ParsedCell { readonly op: 'keep' | 'drop'; readonly names: readonly string[]; readonly exception: string | null }
interface ParsedRef {
  readonly header: readonly string[]
  readonly cells: ReadonlyMap<string, ReadonlyMap<string, ParsedCell>>
  readonly badCells: readonly string[]
  readonly manifests: readonly string[]
  readonly manifestRule: string
  readonly perClassUnion: boolean
}

const CELL_RE = /^(keep|drop): ([a-z-]+(?:, [a-z-]+)*)(?: \(([a-z-]+) stays when a listed manifest changed\))?$/

/** Parse the reference into its table cells, manifest list and mixed rule. Lenient: defects are reported by the collector. */
export function parseLevelRef(ref: string): ParsedRef {
  const rows = tableRows(sectionBetween(ref, '## Sets', '## Rules') ?? '')
  const header = rows[0] ?? []
  const cells = new Map<string, Map<string, ParsedCell>>()
  const badCells: string[] = []
  for (const row of rows.slice(1)) {
    const cls = (row[0] ?? '').replace(/`/g, '')
    const perLevel = new Map<string, ParsedCell>()
    header.slice(1).forEach((level, i) => {
      const text = row[i + 1] ?? ''
      const m = CELL_RE.exec(text)
      if (m === null) { badCells.push(`${cls}/${level}: ${text}`); return }
      perLevel.set(level, { op: m[1] as 'keep' | 'drop', names: m[2].split(', '), exception: m[3] ?? null })
    })
    cells.set(cls, perLevel)
  }
  const manifestLine = /^- \*\*Manifests:\*\* (.*)$/m.exec(ref)?.[1] ?? ''
  const mixedLine = /^- \*\*Mixed diff:\*\* (.*)$/m.exec(ref)?.[1] ?? ''
  return {
    header,
    cells,
    badCells,
    manifests: [...manifestLine.matchAll(/`([^`]+)`/g)].map(m => m[1]),
    manifestRule: manifestLine,
    perClassUnion: mixedLine.includes("to that class's own set") && mixedLine.includes('take the union of the results'),
  }
}

/** The rule-1 manifest names, parsed from the command's Step 1.1. */
function rule1Manifests(cr: string): string[] {
  const rule = /^1\. [^\n]*$/m.exec(step11(cr) ?? '')?.[0] ?? ''
  const list = /manifest or build file \(([^)]*)\)/.exec(rule)?.[1] ?? ''
  return [...list.matchAll(/`([^`]+)`/g)].map(m => m[1])
}

/** The two sentences of the Manifests line that decide which changed paths keep the dependencies focus. */
const MANIFEST_SENTENCES = ['A path matches by file name.', 'A lockfile alone is not a manifest change.'] as const

/** Text the reference must never carry: it names `compliance` only as a lens name. */
const REF_FORBIDDEN: ReadonlyArray<readonly [string, string]> = [
  ['<!-- learning:', 'a learning marker'],
  ['Agent(subagent_type=', 'a spawn block'],
  ['COMPLIANCE_FRAMEWORKS', 'a framework list'],
  ['devflow:compliance', 'the compliance skill'],
  ['regulated surface', 'the compliance trigger'],
]

/** AC-2, AC-3, AC-4, AC-6, AC-7, AC-8: the reference table, its vocabulary, its manifest list and its rules. */
export function collectLevelRefDefects(ref: string, cr: string): string[] {
  const out: string[] = []
  const parsed = parseLevelRef(ref)
  const narrowed = GATE_LEVELS.filter(level => level !== 'full')
  const wantHeader = ['Class', ...narrowed]
  if (parsed.header.join(' | ') !== wantHeader.join(' | ')) out.push(`the header is "${parsed.header.join(' | ')}", expected "${wantHeader.join(' | ')}"`)
  const classes = [...parsed.cells.keys()]
  if (classes.join(',') !== CLASSES.join(',')) out.push(`the class rows are "${classes.join(', ')}", expected "${CLASSES.join(', ')}"`)
  for (const bad of parsed.badCells) out.push(`a cell does not match the cell form: ${bad}`)
  for (const [cls, perLevel] of parsed.cells) {
    for (const [level, cell] of perLevel) {
      const where = `${cls}/${level}`
      for (const name of cell.names) if (!VOCABULARY.includes(name)) out.push(`${where}: "${name}" is not a focus name`)
      if (cell.op === 'keep' && !cell.names.includes('security')) out.push(`${where}: a keep cell without security`)
      if (cell.op === 'drop' && cell.names.includes('security')) out.push(`${where}: a drop cell that drops security`)
      if (cls !== 'code' && cell.names.includes('compliance')) out.push(`${where}: compliance outside the code class`)
      const full = FULL_REDUCED[cls]
      if (full !== undefined) {
        for (const name of cell.names) if (!full.includes(name)) out.push(`${where}: "${name}" is outside the class's full set`)
      }
      if (cell.exception !== null && !(cls === 'code' && level === 'standard' && cell.exception === 'dependencies')) {
        out.push(`${where}: an exception for "${cell.exception}", only dependencies on code/standard is allowed`)
      }
      const want = (EXPECTED_CELLS as Readonly<Record<string, Readonly<Record<string, ExpectedCell>>>>)[cls]?.[level]
      if (want !== undefined && (want.op !== cell.op || !sameSet(want.names, cell.names))) {
        out.push(`${where}: "${cell.op}: ${cell.names.join(', ')}", expected "${want.op}: ${want.names.join(', ')}"`)
      }
    }
  }
  const standardCode = parsed.cells.get('code')?.get('standard')
  if (standardCode !== undefined && standardCode.exception !== 'dependencies') out.push('code/standard: the manifest exception for dependencies is missing')
  if (!sameSet(parsed.manifests, MANIFESTS)) out.push(`the manifest list is "${parsed.manifests.join(', ')}", expected "${MANIFESTS.join(', ')}"`)
  for (const sentence of MANIFEST_SENTENCES) if (!parsed.manifestRule.includes(sentence)) out.push(`the Manifests line lacks: ${sentence}`)
  const rule1 = rule1Manifests(cr)
  if (rule1.length === 0) out.push('no rule-1 manifest names were parsed from Step 1.1')
  for (const name of rule1) if (!parsed.manifests.includes(name)) out.push(`the manifest list lacks the rule-1 name ${name}`)
  if (!parsed.perClassUnion) out.push('the mixed-diff rule is not "apply each class\'s row to that class\'s own set, then take the union of the results"')
  for (const [needle, what] of REF_FORBIDDEN) if (ref.includes(needle)) out.push(`the reference carries ${what}`)
  return out
}

// ---------------------------------------------------------------------------
// 2. The simulator
// ---------------------------------------------------------------------------

interface Scenario {
  readonly stamped: readonly string[]
  readonly triggered: readonly string[]
  readonly conditional: readonly string[]
  readonly complianceActive: boolean
  readonly regulated: boolean
  readonly depPath: string
}

const changedPaths = (sc: Scenario): string[] => (sc.depPath === 'none' ? ['src/x.ts'] : ['src/x.ts', sc.depPath])

/** Whether any changed path of the scenario is named like one of the manifests. */
const changesManifest = (sc: Scenario, manifests: readonly string[]): boolean =>
  changedPaths(sc).some(p => manifests.some(m => nameMatches(baseName(p), m)))

/** The oracle's full-level set of one class: the set the command builds before it narrows. */
function fullSetOf(cls: string, sc: Scenario): string[] {
  if (cls !== 'code') return [...(FULL_REDUCED[cls] ?? [])]
  const language = LANGUAGE.filter(l => sc.triggered.includes(l) && sc.stamped.includes(l))
  const conditional = CONDITIONAL.filter(c => sc.conditional.includes(c) && (c !== 'dependencies' || sc.depPath !== 'none'))
  const compliance = sc.complianceActive && sc.regulated ? ['compliance'] : []
  return [...CORE, ...language, ...conditional, ...compliance]
}

/** The oracle's expected set at a level, from the hand-written rules and sets only. */
function expectedSet(level: string, classes: readonly string[], sc: Scenario): string[] {
  if (classes.length === 1 && classes[0] === 'code') {
    const full = fullSetOf('code', sc)
    if (level === 'full') return full
    if (level === 'lean') return full.filter(n => ['security', 'testing', 'reliability', 'compliance'].includes(n))
    const manifestChanged = changesManifest(sc, MANIFESTS)
    return full.filter(n => n !== 'typescript' && (n !== 'dependencies' || manifestChanged))
  }
  return [...(EXPECTED_SETS[classes.join('+')]?.[level] ?? [])]
}

/** Narrow the classes' full sets by the parsed reference, as the command's Step 1.2b says. */
export function simulate(level: string, classes: readonly string[], sc: Scenario, ref: ParsedRef): string[] {
  const fulls = classes.map(cls => fullSetOf(cls, sc))
  if (level === 'full') return unique(fulls.flat())
  const manifestChanged = changesManifest(sc, ref.manifests)
  const narrow = (cls: string, set: readonly string[]): string[] => {
    const cell = ref.cells.get(cls)?.get(level)
    if (cell === undefined) return [...set]
    if (cell.op === 'keep') return set.filter(n => cell.names.includes(n))
    return set.filter(n => !cell.names.includes(n) || (n === cell.exception && manifestChanged))
  }
  if (classes.length > 1 && !ref.perClassUnion) {
    let list = unique(fulls.flat())
    for (const cls of classes) list = narrow(cls, list)
    return list
  }
  return unique(classes.flatMap((cls, i) => narrow(cls, fulls[i])))
}

function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => [...acc, ...acc.map(s => [...s, item])], [[]])
}

const CLASS_COMBOS: ReadonlyArray<readonly string[]> = [['code'], ...subsets(REDUCED).filter(s => s.length > 0)]
const STAMPED: ReadonlyArray<readonly string[]> = [[], [...LANGUAGE], ['typescript', 'go']]
const TRIGGERED: ReadonlyArray<readonly string[]> = [[], ['typescript'], ['typescript', 'react', 'go']]
const DEP_PATHS = ['none', 'package.json', 'package-lock.json', 'Podfile'] as const

function* scenarios(): Generator<Scenario> {
  for (const stamped of STAMPED) for (const triggered of TRIGGERED) for (const conditional of subsets(CONDITIONAL)) {
    for (const complianceActive of [false, true]) for (const regulated of [false, true]) for (const depPath of DEP_PATHS) {
      yield { stamped, triggered, conditional, complianceActive, regulated, depPath }
    }
  }
}

const describeScenario = (sc: Scenario): string =>
  `stamped=[${sc.stamped.join(',')}] triggered=[${sc.triggered.join(',')}] conditional=[${sc.conditional.join(',')}] compliance=${sc.complianceActive}/${sc.regulated} dep=${sc.depPath}`

/**
 * AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8: every level, class combination and scenario. The first defect of each
 * kind per level and class combination is reported, so one wrong cell gives a short list.
 */
export function collectSimulationDefects(parsed: ParsedRef, run: typeof simulate = simulate): string[] {
  const first = new Map<string, string>()
  const report = (key: string, message: string): void => { if (!first.has(key)) first.set(key, message) }
  for (const level of GATE_LEVELS) for (const classes of CLASS_COMBOS) {
    const label = `${level} ${classes.join('+')}`
    for (const sc of scenarios()) {
      const got = run(level, classes, sc, parsed)
      const full = unique(classes.flatMap(cls => fullSetOf(cls, sc)))
      const want = expectedSet(level, classes, sc)
      if (!got.includes('security')) report(`${label}|security`, `${label}: no security (${describeScenario(sc)})`)
      if (got.some(n => !full.includes(n))) report(`${label}|subset`, `${label}: a focus outside the full set (${describeScenario(sc)})`)
      if (got.includes('compliance') && !classes.includes('code')) report(`${label}|compliance`, `${label}: compliance without the code class`)
      if (!sameSet(got, want)) report(`${label}|set`, `${label}: got [${got.join(', ')}], expected [${want.join(', ')}] (${describeScenario(sc)})`)
    }
  }
  // Manifest names and lockfiles, one at a time, on a standard code diff that has the dependencies trigger.
  const base: Scenario = { stamped: [], triggered: [], conditional: ['dependencies'], complianceActive: false, regulated: false, depPath: 'none' }
  for (const file of [...MANIFESTS.map(manifest => manifest.replaceAll('*', '-dev')), ...GLOB_EXAMPLES]) {
    const got = run('standard', ['code'], { ...base, depPath: file }, parsed)
    if (!got.includes('dependencies')) report(`manifest|${file}`, `standard code: a changed ${file} does not keep dependencies`)
  }
  for (const lockfile of LOCKFILES) {
    const got = run('standard', ['code'], { ...base, depPath: lockfile }, parsed)
    if (got.includes('dependencies')) report(`lockfile|${lockfile}`, `standard code: a changed ${lockfile} with code keeps dependencies`)
  }
  return [...first.values()]
}

// ---------------------------------------------------------------------------
// 3. The gate-level block of the command
// ---------------------------------------------------------------------------

const BLOCK_ITEMS = [
  "Narrow REVIEW_FOCUS_LIST, for every class, by this worktree's `GATE_LEVEL`.",
  '`full` keeps it and reads nothing.',
  "Apply each class's row to that class's own set, then take the union of the results.",
  'A row only removes focuses.',
  'If the Read fails, or a row is missing or malformed, set `GATE_LEVEL` to `full` for every worktree of this run',
  'level reference unreadable: full sets applied',
  'Security runs at every level and in every class.',
  'Compliance keeps the trigger above at every level.',
] as const

/** AC-7, AC-8, AC-9, AC-14: the block that narrows REVIEW_FOCUS_LIST, in one compiled build. */
export function collectGateLevelBlockDefects(body: string): string[] {
  const out: string[] = []
  const block = gateBlock(body)
  if (block === null) return ['no gate-level block between "**Gate level.**" and "#### Step 1.3:"']
  const own = step12Own(body)
  const narrow = step12b(body)
  if (own === null || narrow === null || !narrow.startsWith('#### Step 1.2b: Narrow by gate level')) out.push('Step 1.2b has no heading of its own after Step 1.2')
  const read = block.split('\n\n').find(p => p.includes(LEVEL_REFERENCE_PATH))
  if (read === undefined) out.push('the block has no read paragraph for the level reference')
  else {
    for (const needle of ['`standard` or `lean`', SANCTIONED_RESOLUTION, 'with the Read tool', 'once per run']) {
      if (!read.includes(needle)) out.push(`the read paragraph lacks: ${needle.slice(0, 50)}`)
    }
    if (read.indexOf(SANCTIONED_RESOLUTION) > read.indexOf(LEVEL_REFERENCE_PATH)) out.push('the resolution comes after the path')
  }
  for (const item of BLOCK_ITEMS) if (!block.includes(item)) out.push(`the block lacks: ${item.slice(0, 60)}`)
  const names = body.split('CLAUDE_CONFIG_DIR').length - 1
  if (names !== 1) out.push(`${names} CLAUDE_CONFIG_DIR names in the command, expected 1`)
  const stampAt = body.indexOf('A language focus is spawned only when its file-type condition above fires')
  if (stampAt === -1 || body.indexOf('CLAUDE_CONFIG_DIR') < stampAt) out.push('the directory read does not come after the stamp paragraph')
  if (block.split('\n').some(l => l.startsWith('Installed language focuses: '))) out.push('the block carries a second stamp line')
  if (LANGUAGE.some(l => l !== 'go' && block.includes(l)) || block.includes('`go`')) out.push('the block restates a language focus list')
  const produces = sectionBetween(body, '#### Step 0b:', '#### Step 0b-ii:') ?? ''
  if (!/\*\*Produces:\*\* [^\n]*GATE_LEVEL/.test(produces)) out.push('Step 0b Produces does not list GATE_LEVEL')
  const phase1 = sectionBetween(body, '### Phase 1: Analyze Changed Files', '#### Step 1.1:') ?? ''
  if (!/\*\*Requires:\*\* [^\n]*GATE_LEVEL/.test(phase1)) out.push('Phase 1 Requires does not list GATE_LEVEL')
  if (/\*\*Produces:\*\* [^\n]*every class/.test(own ?? '')) out.push('Step 1.2 Produces claims every class, which only Step 1.2b narrows')
  if (dataFlowNames(own, 'Requires').includes('GATE_LEVEL')) out.push('Step 1.2 Requires lists GATE_LEVEL, which only Step 1.2b reads')
  for (const name of ['REVIEW_FOCUS_LIST', 'GATE_LEVEL']) {
    if (!dataFlowNames(narrow, 'Produces').includes(name)) out.push(`Step 1.2b Produces does not list ${name}`)
  }
  for (const name of ['REVIEW_FOCUS_LIST', 'DIFF_CLASS', 'CHANGED_PATHS', 'GATE_LEVEL']) {
    if (!dataFlowNames(narrow, 'Requires').includes(name)) out.push(`Step 1.2b Requires does not list ${name}`)
  }
  for (const name of ['GATE_LEVEL', 'REVIEW_FOCUS_LIST']) {
    if (!dataFlowNames(phase3(body), 'Requires').includes(name)) out.push(`Phase 3 Requires does not list ${name}`)
  }
  if (/Resolve the compliance lens$/m.test(body)) out.push('a Step 0b title names the compliance lens alone, but the step also yields GATE_LEVEL')
  if (!(own ?? '').includes('REVIEW_FOCUS_LIST starts with the eight core focuses')) out.push('Step 1.2 does not say the code list starts with the eight core focuses')
  if (/core focuses are unconditional/.test(own ?? '')) out.push('Step 1.2 calls the core focuses unconditional, but Step 1.2b narrows them')
  if (!body.includes('sets the diff range, never the gate level')) out.push('Edge Cases does not say --full sets the diff range, never the gate level')
  if (!body.includes('one per focus in REVIEW_FOCUS_LIST')) out.push('Phase 2 does not spawn one Review agent per REVIEW_FOCUS_LIST focus')
  return out
}

/** AC-8: in the source, the block sits outside every learning arm, so both builds carry it. */
export function collectBlockArmDefects(source: string): string[] {
  let arm: string | null = null
  let inBlock = false
  let seen = false
  const out: string[] = []
  for (const line of source.split('\n')) {
    const open = /^<!-- learning:(on|off) -->$/.exec(line)
    if (open !== null) { arm = open[1]; continue }
    if (line === '<!-- learning:end -->') { arm = null; continue }
    if (line.startsWith('#### Step 1.2b: Narrow by gate level')) { inBlock = true; seen = true }
    else if (line.startsWith('#### Step 1.3:')) inBlock = false
    if (inBlock && arm !== null) { out.push(`the gate-level block sits inside a learning:${arm} arm`); break }
  }
  if (!seen) out.push('the source has no Step 1.2b heading')
  return out
}

// ---------------------------------------------------------------------------
// 4. Full is today
// ---------------------------------------------------------------------------

/** AC-1: the Step 1.1 reduced sets, the rule-1 manifests and the Step 1.2 trigger rows equal the text before #474. */
export function collectFullIsTodayDefects(body: string): string[] {
  const out: string[] = []
  const s11 = step11(body)
  if (s11 === null) return ['no Step 1.1']
  for (const [cls, focuses] of Object.entries(FULL_REDUCED)) {
    const got = new RegExp(`^- \`${cls}\`: ([^\\n]+)$`, 'm').exec(s11)?.[1]
    if (got === undefined) out.push(`no reduced set line for ${cls}`)
    else if (got !== focuses.join(', ')) out.push(`${cls} set is "${got}", expected "${focuses.join(', ')}"`)
  }
  const rule1 = rule1Manifests(body)
  if (rule1.join(',') !== RULE1_MANIFESTS.join(',')) out.push(`the rule-1 manifests are "${rule1.join(', ')}", expected "${RULE1_MANIFESTS.join(', ')}"`)
  const s12 = step12(body)
  if (s12 === null) return [...out, 'no Step 1.2']
  const rows = tableRows(s12).slice(1)
  if (rows.length !== TODAY_TRIGGER_ROWS.length) out.push(`${rows.length} trigger rows, expected ${TODAY_TRIGGER_ROWS.length}`)
  TODAY_TRIGGER_ROWS.forEach(([condition, adds], i) => {
    const row = rows[i]
    if (row === undefined || row[0] !== condition || row[1] !== adds) out.push(`trigger row ${i + 1} is "${(row ?? []).join(' | ')}", expected "${condition} | ${adds}"`)
  })
  if (!s12.includes('| COMPLIANCE_ACTIVE AND diff touches regulated surface | compliance |')) out.push('the compliance trigger row is not byte-equal')
  const sentence = s12.split('\n\n').find(p => p.includes('COMPLIANCE_ACTIVE` AND the diff touches regulated surface'))
  if (sentence === undefined) out.push('Step 1.2 has no compliance sentence')
  else if (!sentence.endsWith(': on a `code` diff, add `compliance`.')) out.push('the compliance sentence is not limited to the `code` class')
  return out
}

// ---------------------------------------------------------------------------
// 5. No second cycle
// ---------------------------------------------------------------------------

const RESTART_PHASE = /\b(return|go back|loop back|re-?enter|restart)\b[^.\n]{0,40}\bPhase [12]\b/i
const SECOND_CYCLE = /\b(start|begin|launch|trigger|run)s?\b[^.\n]{0,20}\b(second|another|new|next) (review )?cycle/i
/** A /resolve command start; a script path such as `scripts/resolve-settings.cjs` is not one. */
const RESOLVE_START = /(^|[\s(`])\/(devflow:)?resolve\b(?![-.])/m

/** AC-10: Step 0e-ii only warns and continues, and nothing in the command or the reference starts another cycle. */
export function collectSecondCycleDefects(body: string, ref: string): string[] {
  const out: string[] = []
  if (!/^MAX_REVIEW_CYCLES = 10$/m.test(body)) out.push('MAX_REVIEW_CYCLES = 10 is missing')
  const rows = tableRows(sectionBetween(body, '**Decision table — Step 0e-ii paths:**', '#### Step 0f:') ?? '')
  const outcome = (condition: string): string | undefined => rows.find(r => r[0] === condition)?.[1]
  for (const condition of ['CYCLE_NUMBER > MAX_REVIEW_CYCLES', 'fp_ratio > 0.7 AND CYCLE_NUMBER >= 3']) {
    if (outcome(condition) !== 'Warn in output, continue') out.push(`the outcome of "${condition}" is "${outcome(condition) ?? '(no row)'}", expected "Warn in output, continue"`)
  }
  if (!(rows.find(r => r[0].startsWith('denominator = 0'))?.[1] ?? '').startsWith('fp_ratio = 0, skip warning')) out.push('the parse-failure row does not skip the warning')
  const continues = body.match(/^\s*Continue with review\.$/gm) ?? []
  if (continues.length !== 2) out.push(`${continues.length} "Continue with review." lines, expected 2`)
  for (const [name, text] of [['the command', body], ['the reference', ref]] as const) {
    if (RESTART_PHASE.test(text)) out.push(`${name} restarts or re-enters Phase 1 or 2`)
    if (SECOND_CYCLE.test(text)) out.push(`${name} starts a second cycle`)
    if (RESOLVE_START.test(text)) out.push(`${name} starts /resolve`)
  }
  const afterPhase3 = body.slice(Math.max(0, body.indexOf('### Phase 3:')))
  if (/Agent\(subagent_type="Review"/.test(afterPhase3)) out.push('a Review agent is spawned after Phase 3')
  return out
}

// ---------------------------------------------------------------------------
// 6. The summary
// ---------------------------------------------------------------------------

/** What a review finds in blocking, and which focuses its FOCUSES input lists. */
interface MergeFacts { critical: number; high: number; medium: number; focuses: readonly string[] }

/**
 * The recommendation the Merge Rules give for these facts when no security report exists: the first row whose
 * condition holds. A row that names the plan holds only when the plan lists security; an unknown row is named.
 */
function mergeRecommendationWithoutSecurityReport(rows: string[][], facts: MergeFacts): string {
  const holds = (condition: string): boolean | undefined => {
    if (condition === 'Any CRITICAL in blocking') return facts.critical > 0
    if (condition === 'Any HIGH in blocking') return facts.high > 0
    if (condition === 'Only MEDIUM in blocking') return facts.medium > 0
    if (condition === 'No blocking issues') return facts.critical + facts.high + facts.medium === 0
    if (/security focus[^|]*no report/i.test(condition)) return !/plan|FOCUSES/i.test(condition) || facts.focuses.includes('security')
    return undefined
  }
  for (const [condition, outcome] of rows) {
    const hit = holds(condition)
    if (hit === undefined) return `(unknown condition "${condition}")`
    if (hit) return outcome
  }
  return '(no row applies)'
}

/**
 * AC-11: a review with no security report is never APPROVED, whatever FOCUSES lists, and a CRITICAL finding still
 * blocks the merge. The Merge Rules are read top to bottom, so the security row must sit after the BLOCK MERGE row
 * and before every APPROVED row, its condition must not name the plan, and the table must say the first match wins.
 */
export function collectApprovedWithoutSecurityDefects(syn: string): string[] {
  const out: string[] = []
  const section = sectionBetween(syn, '**Merge Rules', '**Output:**') ?? ''
  const rows = tableRows(section).filter(r => r.length >= 2 && r[0] !== 'Condition')
  const security = rows.findIndex(r => /security focus[^|]*no report/i.test(r[0]))
  if (!/first matching row/i.test(section)) out.push('the Merge Rules do not say that the first matching row applies')
  if (security === -1) return out
  rows.forEach((row, i) => {
    if (row[1].startsWith('APPROVED') && i < security) out.push(`the "${row[0]}" row gives "${row[1]}" before the security row, so APPROVED is reachable with no security report`)
  })
  const cases: ReadonlyArray<readonly [string, Pick<MergeFacts, 'critical' | 'high' | 'medium'>, string]> = [
    ['a CRITICAL blocking issue', { critical: 1, high: 0, medium: 0 }, 'BLOCK MERGE'],
    ['a HIGH blocking issue', { critical: 0, high: 1, medium: 0 }, 'CHANGES REQUESTED'],
    ['a MEDIUM blocking issue', { critical: 0, high: 0, medium: 1 }, 'CHANGES REQUESTED'],
    ['no blocking issue', { critical: 0, high: 0, medium: 0 }, 'CHANGES REQUESTED'],
  ]
  for (const focuses of [CORE, CORE.filter(f => f !== 'security'), []] as ReadonlyArray<readonly string[]>) {
    for (const [label, counts, expected] of cases) {
      const got = mergeRecommendationWithoutSecurityReport(rows, { ...counts, focuses })
      if (got !== expected) out.push(`with no security report, FOCUSES [${focuses.join(', ')}] and ${label}, the Merge Rules give "${got}", expected "${expected}"`)
    }
  }
  return out
}

/** AC-11: the Step 3a spawn passes the level and the focuses, and the review summary reference shows and uses them. */
export function collectSummaryDefects(cr: string, syn: string): string[] {
  const out: string[] = []
  const fences = [...(sectionBetween(cr, '### Phase 3:', '### Phase 4:') ?? '').matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1])
  const synthesize = fences.find(f => f.includes('Agent(subagent_type="Synthesize"'))
  const git = fences.find(f => f.includes('Agent(subagent_type="Git"'))
  if (synthesize === undefined) out.push('no Synthesize spawn in Phase 3')
  else {
    if (!/^GATE_LEVEL: \{GATE_LEVEL\}$/m.test(synthesize)) out.push('the Synthesize spawn does not pass GATE_LEVEL')
    if (!/^FOCUSES: \{REVIEW_FOCUS_LIST\}$/m.test(synthesize)) out.push('the Synthesize spawn does not pass FOCUSES')
    if (!/^REVIEW_BASE_DIR: \S/m.test(synthesize)) out.push('the Synthesize spawn lost REVIEW_BASE_DIR')
  }
  if (git === undefined) out.push('no Git spawn in Phase 3')
  else if (/^(GATE_LEVEL|FOCUSES):/m.test(git)) out.push('the Git spawn carries the level or the focuses')
  const inputs = sectionBetween(syn, '**Mode inputs:**', '**Process:**') ?? ''
  for (const input of ['GATE_LEVEL', 'FOCUSES']) if (!inputs.includes(`**${input}**`)) out.push(`the Mode inputs do not declare ${input}`)
  const template = /```markdown\n([\s\S]*?)```/.exec(syn)?.[1] ?? ''
  const lines = template.split('\n')
  const gate = lines.findIndex(l => l.startsWith('**Gate level**: {GATE_LEVEL}'))
  if (gate === -1) out.push('the summary template has no line that starts with "**Gate level**: {GATE_LEVEL}"')
  else {
    // A missing anchor counts as a wrong order, so a template that lost its Date line is reported.
    const date = lines.findIndex(l => l.startsWith('**Date**:'))
    const merge = lines.findIndex(l => l.startsWith('## Merge Recommendation'))
    if (date === -1 || gate < date) out.push('the Gate level line does not follow the Date line')
    if (merge === -1 || gate > merge) out.push('the Gate level line does not come before the Merge Recommendation')
    if (!lines[gate].includes('(no report)')) out.push('the Gate level line does not mark a focus with no report')
  }
  const ruleRows = tableRows(sectionBetween(syn, '**Merge Rules', '**Output:**') ?? '').filter(r => r[0] !== 'Condition')
  const outcomes = unique(ruleRows.map(r => r[1])).join(' | ')
  const slot = /^## Merge Recommendation: \{(.*)\}$/m.exec(template)?.[1]
  if (slot !== outcomes) out.push(`the Merge Recommendation slot is "${slot ?? '(none)'}", the Merge Rules give "${outcomes}"`)
  if (!/^\{Max 5 brief items /m.test(template)) out.push('the Suggestions guidance lost its limit of 5 brief items')
  const rule = ruleRows.find(r => /security focus[^|]*no report/i.test(r[0]))
  if (rule === undefined) out.push('the Merge Rules have no row for the security focus with no report')
  else if (rule[1].startsWith('APPROVED')) out.push(`the security focus with no report gives "${rule[1]}"`)
  out.push(...collectApprovedWithoutSecurityDefects(syn))
  const written = [...cr.matchAll(/\{timestamp\}\/([\w{}-]+)\.md/g)].map(m => m[1])
  for (const name of unique(written)) if (!['{focus}', 'review-summary'].includes(name)) out.push(`the command writes {timestamp}/${name}.md, a file the summary does not need`)
  if (written.length === 0) out.push('no {timestamp}/*.md write found, so the file-set check proves nothing')
  return out
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const VARIANTS: ReadonlyArray<{ label: string; body: string }> = (() => {
  const off = resolveLearningOffSource('commands', 'code-review')
  if (off === null) throw new Error('dist/learning-off/commands/code-review.md is absent: run `npm run build:mds`')
  return [
    { label: 'learning on', body: requireDistFile('code-review.md') },
    { label: 'learning off', body: off },
  ]
})()
const ON = VARIANTS[0].body
const REF = readAgentReference('commands/code-review-levels.md')
const SYN = readAgentReference('synthesize/review.md')
const SECURITY_ROW = '| Security focus has no report (it runs in every review) | CHANGES REQUESTED |'
const SOURCE = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'code-review.mds'), 'utf-8')

/** Replace `from` with `to` in `body`, failing the test when the seed did not land. */
function seed(body: string, from: string | RegExp, to: string): string {
  const next = typeof from === 'string' ? body.replace(from, () => to) : body.replace(from, to)
  expect(next, `the seed ${String(from)} must change the text`).not.toBe(body)
  return next
}

describe('the corpus is real', () => {
  it('reads both builds of the command, the level reference and the gate levels', () => {
    for (const { label, body } of VARIANTS) expect(body.length, `${label}: nothing read`).toBeGreaterThan(5000)
    expect(REF.length, 'the level reference is empty').toBeGreaterThan(400)
    expect(SYN.length, 'the review summary reference is empty').toBeGreaterThan(400)
    expect(SOURCE.length, 'the command source is empty').toBeGreaterThan(5000)
    expect(GATE_LEVELS.length).toBeGreaterThanOrEqual(3)
    expect(GATE_LEVELS).toContain('full')
    expect(CLASS_COMBOS.length, 'code plus seven non-empty reduced subsets').toBe(8)
    expect([...scenarios()].length, 'the scenario grid is empty').toBeGreaterThan(1000)
  })
})

describe('the level reference holds the decided sets (AC-2, AC-3, AC-4, AC-6, AC-7)', () => {
  it('is well formed, a subset by construction and free of compliance logic', () => {
    expect(collectLevelRefDefects(REF, ON)).toEqual([])
    const parsed = parseLevelRef(REF)
    expect(parsed.cells.size, 'four class rows').toBe(4)
    expect(parsed.manifests.length, 'the manifest list is parsed').toBe(MANIFESTS.length)
  })

  it('known-bad probes: each seeded change is reported', () => {
    const defects = (text: string): string[] => collectLevelRefDefects(text, ON)
    expect(defects(seed(REF, '| keep: testing, reliability, security |', '| keep: testing, reliability, consistency, security |')).join('\n'))
      .toMatch(/tests-only\/lean: "keep: testing, reliability, consistency, security", expected/)
    expect(defects(seed(REF, 'drop: typescript, dependencies', 'drop: dependencies')).join('\n'))
      .toMatch(/code\/standard: "drop: dependencies", expected "drop: typescript, dependencies"/)
    expect(defects(seed(REF, 'drop: typescript, dependencies (dependencies stays', 'drop: typescript (dependencies stays')).join('\n'))
      .toMatch(/code\/standard: "drop: typescript", expected/)
    expect(defects(seed(REF, ' (dependencies stays when a listed manifest changed)', ''))).toContain('code/standard: the manifest exception for dependencies is missing')
    expect(defects(seed(REF, '`Gemfile`, ', '')).join('\n')).toMatch(/the manifest list is/)
    expect(defects(seed(REF, ', `deno.json`', '')).join('\n')).toMatch(/the manifest list is/)
    expect(defects(seed(REF, /^\| `lockfile-only` .*\n/m, '')).join('\n')).toMatch(/the class rows are "code, docs-only, tests-only", expected/)
    expect(defects(seed(REF, '\n\n## Rules', '\n| `extra` | keep: security | keep: security |\n\n## Rules')).join('\n'))
      .toMatch(/the class rows are "code, docs-only, tests-only, lockfile-only, extra"/)
    expect(defects(seed(REF, '| keep: testing, reliability, security |', '| keep testing |')).join('\n')).toMatch(/a cell does not match the cell form: tests-only\/lean: keep testing/)
    expect(defects(seed(REF, '| keep: testing, reliability, security |', '| keep: testing, reliability, security, bogus |')))
      .toContain('tests-only/lean: "bogus" is not a focus name')
    expect(defects(seed(REF, 'drop: typescript, dependencies', 'drop: typescript, security')))
      .toContain('code/standard: a drop cell that drops security')
    expect(defects(seed(REF, '| keep: testing, reliability, security |', '| keep: testing, reliability, security, documentation |')))
      .toContain('tests-only/lean: "documentation" is outside the class\'s full set')
    expect(defects(seed(REF, /(\| `lockfile-only` \| keep: dependencies, security)/, '$1 (dependencies stays when a listed manifest changed)')))
      .toContain('lockfile-only/standard: an exception for "dependencies", only dependencies on code/standard is allowed')
    expect(defects(seed(REF, /(\| `code` \| drop: typescript, dependencies) \(dependencies stays/, '$1 (typescript stays')))
      .toContain('code/standard: an exception for "typescript", only dependencies on code/standard is allowed')
    expect(defects(seed(REF, /(keep: security, testing, reliability, compliance) \|/, '$1 (dependencies stays when a listed manifest changed) |')))
      .toContain('code/lean: an exception for "dependencies", only dependencies on code/standard is allowed')
    expect(collectLevelRefDefects(REF, 'Step 1.1 is absent.')).toContain('no rule-1 manifest names were parsed from Step 1.1')
    expect(defects(seed(REF, '`go.mod`, ', ''))).toContain('the manifest list lacks the rule-1 name go.mod')
    expect(defects(seed(REF, ' A path matches by file name.', ''))).toContain('the Manifests line lacks: A path matches by file name.')
    expect(defects(seed(REF, 'A path matches by file name.', 'A path matches by directory name.'))).toContain('the Manifests line lacks: A path matches by file name.')
    expect(defects(seed(REF, ' A lockfile alone is not a manifest change.', ''))).toContain('the Manifests line lacks: A lockfile alone is not a manifest change.')
    expect(defects(seed(REF, 'A lockfile alone is not a manifest change.', 'A lockfile alone is a manifest change.')))
      .toContain('the Manifests line lacks: A lockfile alone is not a manifest change.')
    expect(defects(seed(REF, 'keep: security, testing, reliability, compliance', 'keep: testing, reliability, compliance')))
      .toContain('code/lean: a keep cell without security')
    expect(defects(seed(REF, /(\| `docs-only` \| )keep: documentation, consistency, security/, '$1keep: documentation, consistency, security, compliance')))
      .toContain('docs-only/standard: compliance outside the code class')
    expect(defects(seed(REF, '| Class | standard | lean |', '| Class | full | standard | lean |')).join('\n')).toMatch(/the header is "Class \| full \| standard \| lean"/)
    expect(defects(seed(REF, '| Class | standard | lean |', '| Class | standard | lean | extra |')).join('\n')).toMatch(/the header is/)
    expect(defects(`${REF}\n<!-- learning:on -->\n`)).toContain('the reference carries a learning marker')
    expect(defects(`${REF}\nCOMPLIANCE_FRAMEWORKS: {COMPLIANCE_FRAMEWORKS}\n`)).toContain('the reference carries a framework list')
    expect(defects(`${REF}\nRead devflow:compliance for the framework.\n`)).toContain('the reference carries the compliance skill')
    expect(defects(`${REF}\nAgent(subagent_type="Review"): x\n`)).toContain('the reference carries a spawn block')
    expect(defects(`${REF}\nAdd compliance when the diff touches regulated surface.\n`)).toContain('the reference carries the compliance trigger')
    expect(defects(seed(REF, "to that class's own set", 'to the one list'))).toContain('the mixed-diff rule is not "apply each class\'s row to that class\'s own set, then take the union of the results"')
  })
})

describe('the simulator reads its rules from the reference and the oracle decides the sets (AC-1..AC-8)', () => {
  const parsed = parseLevelRef(REF)

  it('every level, class combination and scenario gets the decided set, with security everywhere and no set outside the full set', () => {
    expect(collectSimulationDefects(parsed)).toEqual([])
  })

  it('the hand-written mixed sets are the decided sizes at lean: docs+tests 5, tests+lockfile 4, docs+lockfile 4, all three 6', () => {
    const sizes = Object.fromEntries(Object.entries(EXPECTED_SETS).map(([k, v]) => [k, v.lean.length]))
    expect(sizes).toMatchObject({
      'docs-only+tests-only': 5, 'tests-only+lockfile-only': 4, 'docs-only+lockfile-only': 4, 'docs-only+tests-only+lockfile-only': 6,
    })
  })

  it('known-bad probes: a lean tests-only without security, the manifest exception removed and a sequential mixed rule are each reported', () => {
    const defects = (text: string): string[] => collectSimulationDefects(parseLevelRef(text))
    expect(defects(seed(REF, '| keep: testing, reliability, security |', '| keep: testing, reliability |')).some(d => d.startsWith('lean tests-only: no security'))).toBe(true)
    expect(defects(seed(REF, ' (dependencies stays when a listed manifest changed)', '')).some(d => d.startsWith('standard code: a changed package.json does not keep dependencies'))).toBe(true)
    const sequential = defects(seed(REF, 'apply each class\'s row to that class\'s own set, then take the union of the results, with no further cap',
      'apply each class\'s row in turn to the one list'))
    expect(sequential.some(d => d.startsWith('lean docs-only+tests-only: got [security], expected'))).toBe(true)
    expect(defects(seed(REF, '`Gemfile`, ', '')).some(d => d.startsWith('standard code: a changed Gemfile does not keep dependencies'))).toBe(true)
    expect(defects(seed(REF, ', `Podfile`', '')).some(d => d.startsWith('standard code: a changed Podfile does not keep dependencies'))).toBe(true)
    expect(defects(seed(REF, '`build.gradle*`', '`build.gradle`')).some(d => d.startsWith('standard code: a changed build.gradle.kts does not keep dependencies'))).toBe(true)
    expect(defects(seed(REF, '`*.csproj`', '`App.sln`')).some(d => d.startsWith('standard code: a changed App.csproj does not keep dependencies'))).toBe(true)
    expect(defects(seed(REF, 'drop: typescript, dependencies', 'drop: dependencies')).some(d => d.startsWith('standard code: got'))).toBe(true)
    expect(defects(seed(REF, ', `deno.json`', ', `deno.json`, `yarn.lock`')).some(d => d.startsWith('standard code: a changed yarn.lock with code keeps dependencies'))).toBe(true)
  })

  it('known-bad probes: a run that adds a focus outside the full set, or compliance without the code class, is reported', () => {
    const adding = (name: string): typeof simulate => (level, classes, sc, ref) => [...simulate(level, classes, sc, ref), name]
    expect(collectSimulationDefects(parsed, adding('bogus')).some(d => d.includes(': a focus outside the full set ('))).toBe(true)
    expect(collectSimulationDefects(parsed, adding('compliance')).some(d => d.startsWith('lean docs-only: compliance without the code class'))).toBe(true)
  })

  it('a lockfile with code drops the dependencies lens at standard, and a manifest keeps it', () => {
    const sc: Scenario = { stamped: [], triggered: [], conditional: ['dependencies'], complianceActive: false, regulated: false, depPath: 'package-lock.json' }
    expect(simulate('standard', ['code'], sc, parsed)).not.toContain('dependencies')
    expect(simulate('standard', ['code'], { ...sc, depPath: 'package.json' }, parsed)).toContain('dependencies')
    expect(simulate('full', ['code'], sc, parsed)).toContain('dependencies')
  })
})

describe('the command carries the gate-level block, outside the learning arms (AC-8, AC-9, AC-14)', () => {
  it.each(VARIANTS)('$label: the block, the read paragraph and the invariants', ({ body }) => {
    expect(collectGateLevelBlockDefects(body)).toEqual([])
  })

  it('the source holds the block outside every learning arm', () => {
    expect(collectBlockArmDefects(SOURCE)).toEqual([])
  })

  it('known-bad probes: each removed invariant, read-paragraph phrase and data-flow line, a changed root form or order, and a block in a learning arm are reported', () => {
    const defects = (text: string): string[] => collectGateLevelBlockDefects(text)
    for (const item of BLOCK_ITEMS) {
      expect(defects(seed(ON, item, 'removed')), `removing "${item.slice(0, 40)}"`).toContain(`the block lacks: ${item.slice(0, 60)}`)
    }
    expect(defects(seed(ON, 'Narrow REVIEW_FOCUS_LIST, for every class, by', 'Narrow REVIEW_FOCUS_LIST, for the `code` class only, by')))
      .toContain(`the block lacks: ${BLOCK_ITEMS[0].slice(0, 60)}`)
    expect(defects(seed(ON, '`full` keeps it and reads nothing.', '`full` keeps it and reads the level reference.'))).toContain('the block lacks: `full` keeps it and reads nothing.')
    expect(defects(seed(ON, SANCTIONED_RESOLUTION, 'd="$HOME/.claude";')).join('\n')).toMatch(/the read paragraph lacks: d="\$\{CLAUDE_CONFIG_DIR:-\}"/)
    expect(defects(seed(ON, '` with the Read tool.', '`.'))).toContain('the read paragraph lacks: with the Read tool')
    expect(defects(seed(ON, 'At `standard` or `lean`, once per run, ', ''))).toEqual([
      'the read paragraph lacks: `standard` or `lean`',
      'the read paragraph lacks: once per run',
    ])
    const readParagraph = gateBlock(ON)?.split('\n\n').find(p => p.includes(LEVEL_REFERENCE_PATH)) ?? ''
    expect(readParagraph, 'the read paragraph is in the compiled command').not.toBe('')
    const pathFirst = `At \`standard\` or \`lean\`, once per run, Read \`<that directory>/${LEVEL_REFERENCE_PATH}\` with the Read tool, after you run \`${SANCTIONED_RESOLUTION} printf '%s\\n' "$d"\` in Bash.`
    expect(defects(seed(ON, readParagraph, pathFirst))).toEqual(['the resolution comes after the path'])
    const movedUp = seed(seed(ON, `${readParagraph}\n\n`, ''), '**Language focus stamp.**', `${readParagraph}\n\n**Language focus stamp.**`)
    expect(defects(movedUp)).toContain('the directory read does not come after the stamp paragraph')
    expect(defects(`${ON}\nRun \`echo "$CLAUDE_CONFIG_DIR"\`.\n`)).toContain('2 CLAUDE_CONFIG_DIR names in the command, expected 1')
    expect(defects(seed(ON, '#### Step 1.2b: Narrow by gate level\n\n', ''))).toContain('Step 1.2b has no heading of its own after Step 1.2')
    expect(defects(seed(ON, '**Produces:** COMPLIANCE_ACTIVE, COMPLIANCE_FRAMEWORKS, GATE_LEVEL', '**Produces:** COMPLIANCE_ACTIVE, COMPLIANCE_FRAMEWORKS')))
      .toContain('Step 0b Produces does not list GATE_LEVEL')
    expect(defects(seed(ON, '**Requires:** DIFF_RANGE, REVIEW_DIR, COMPLIANCE_ACTIVE, GATE_LEVEL (from Step 0b)', '**Requires:** DIFF_RANGE, REVIEW_DIR, COMPLIANCE_ACTIVE (from Step 0b)')))
      .toContain('Phase 1 Requires does not list GATE_LEVEL')
    expect(defects(seed(ON, '**Requires:** DIFF_CLASS, CHANGED_PATHS, COMPLIANCE_ACTIVE', '**Requires:** DIFF_CLASS, CHANGED_PATHS, COMPLIANCE_ACTIVE, GATE_LEVEL')))
      .toContain('Step 1.2 Requires lists GATE_LEVEL, which only Step 1.2b reads')
    expect(defects(seed(ON, '**Produces:** REVIEW_FOCUS_LIST (code class)', '**Produces:** REVIEW_FOCUS_LIST (code class; every class by level)')))
      .toContain('Step 1.2 Produces claims every class, which only Step 1.2b narrows')
    const P12B = '**Produces:** REVIEW_FOCUS_LIST, GATE_LEVEL'
    const R12B = '**Requires:** REVIEW_FOCUS_LIST, DIFF_CLASS, CHANGED_PATHS, GATE_LEVEL'
    const R3 = '**Requires:** REVIEW_FOCUS_OUTPUTS, REVIEW_DIR, PR_INFO, GATE_LEVEL, REVIEW_FOCUS_LIST'
    for (const [from, to, defect] of [
      [P12B, '**Produces:** REVIEW_FOCUS_LIST', 'Step 1.2b Produces does not list GATE_LEVEL'],
      [P12B, '**Produces:** GATE_LEVEL', 'Step 1.2b Produces does not list REVIEW_FOCUS_LIST'],
      [R12B, '**Requires:** REVIEW_FOCUS_LIST, DIFF_CLASS, CHANGED_PATHS', 'Step 1.2b Requires does not list GATE_LEVEL'],
      [R12B, '**Requires:** REVIEW_FOCUS_LIST, DIFF_CLASS, GATE_LEVEL', 'Step 1.2b Requires does not list CHANGED_PATHS'],
      [R12B, '**Requires:** REVIEW_FOCUS_LIST, CHANGED_PATHS, GATE_LEVEL', 'Step 1.2b Requires does not list DIFF_CLASS'],
      [R12B, '**Requires:** DIFF_CLASS, CHANGED_PATHS, GATE_LEVEL', 'Step 1.2b Requires does not list REVIEW_FOCUS_LIST'],
      [R3, '**Requires:** REVIEW_FOCUS_OUTPUTS, REVIEW_DIR, PR_INFO, REVIEW_FOCUS_LIST', 'Phase 3 Requires does not list GATE_LEVEL'],
      [R3, '**Requires:** REVIEW_FOCUS_OUTPUTS, REVIEW_DIR, PR_INFO, GATE_LEVEL', 'Phase 3 Requires does not list REVIEW_FOCUS_LIST'],
    ] as const) {
      expect(defects(seed(ON, from, to)), defect).toContain(defect)
    }
    expect(defects(seed(ON, '#### Step 0b: Resolve the compliance lens and gate level', '#### Step 0b: Resolve the compliance lens')))
      .toContain('a Step 0b title names the compliance lens alone, but the step also yields GATE_LEVEL')
    expect(defects(seed(ON, '├─ Step 0b: Resolve the compliance lens and gate level', '├─ Step 0b: Resolve the compliance lens')))
      .toContain('a Step 0b title names the compliance lens alone, but the step also yields GATE_LEVEL')
    const unconditional = seed(ON, 'REVIEW_FOCUS_LIST starts with the eight core focuses', 'the eight core focuses are unconditional; REVIEW_FOCUS_LIST holds the language focuses')
    expect(defects(unconditional)).toContain('Step 1.2 calls the core focuses unconditional, but Step 1.2b narrows them')
    expect(defects(unconditional)).toContain('Step 1.2 does not say the code list starts with the eight core focuses')
    expect(defects(seed(ON, 'one per focus in REVIEW_FOCUS_LIST', 'for the focus set `DIFF_CLASS` selects')))
      .toContain('Phase 2 does not spawn one Review agent per REVIEW_FOCUS_LIST focus')
    expect(defects(seed(ON, 'Compliance keeps the trigger above at every level.', 'Compliance keeps the trigger above at every level.\nInstalled language focuses: go')))
      .toContain('the block carries a second stamp line')
    expect(defects(seed(ON, 'Compliance keeps the trigger above at every level.', 'Compliance keeps the trigger above at every level for react and rust.')))
      .toContain('the block restates a language focus list')
    expect(defects(seed(ON, 'It sets the diff range, never the gate level', 'It applies to all'))).toContain('Edge Cases does not say --full sets the diff range, never the gate level')
    const inArm = seed(seed(SOURCE, '#### Step 1.2b: Narrow by gate level', '<!-- learning:on -->\n#### Step 1.2b: Narrow by gate level'),
      '#### Step 1.3: Write the diff files', '<!-- learning:end -->\n#### Step 1.3: Write the diff files')
    expect(collectBlockArmDefects(inArm)).toEqual(['the gate-level block sits inside a learning:on arm'])
  })
})

describe('full is today (AC-1)', () => {
  it.each(VARIANTS)('$label: the reduced sets, the rule-1 manifests and the twelve trigger rows are unchanged', ({ body }) => {
    expect(collectFullIsTodayDefects(body)).toEqual([])
  })

  it('known-bad probes: an edited trigger row, a reduced set and a manifest name are each reported', () => {
    expect(collectFullIsTodayDefects(seed(ON, '| .go files | go |', '| .go files | golang |')).join('\n')).toMatch(/trigger row 5 is ".go files \| golang"/)
    expect(collectFullIsTodayDefects(seed(ON, '| COMPLIANCE_ACTIVE AND diff touches regulated surface | compliance |', '| COMPLIANCE_ACTIVE AND diff touches PII | compliance |')))
      .toContain('the compliance trigger row is not byte-equal')
    expect(collectFullIsTodayDefects(seed(ON, ': on a `code` diff, add `compliance`.', ': add `compliance`.')))
      .toContain('the compliance sentence is not limited to the `code` class')
    expect(collectFullIsTodayDefects(seed(ON, '- `docs-only`: documentation, consistency, security', '- `docs-only`: documentation, security')))
      .toContain('docs-only set is "documentation, security", expected "documentation, consistency, security"')
    expect(collectFullIsTodayDefects(seed(ON, '`CMakeLists.txt`)', '`CMakeLists.txt`, `Gemfile`)')).join('\n')).toMatch(/the rule-1 manifests are/)
  })
})

describe('no second cycle (AC-10)', () => {
  it.each(VARIANTS)('$label: Step 0e-ii only warns and nothing restarts a phase, a cycle or /resolve', ({ body }) => {
    expect(collectSecondCycleDefects(body, REF)).toEqual([])
  })

  it('known-bad probes: a stop, a second-cycle sentence, a resolve start, a restart and a late Review spawn are each reported', () => {
    expect(collectSecondCycleDefects(seed(ON, '| CYCLE_NUMBER > MAX_REVIEW_CYCLES | Warn in output, continue |', '| CYCLE_NUMBER > MAX_REVIEW_CYCLES | Stop |'), REF).join('\n'))
      .toMatch(/the outcome of "CYCLE_NUMBER > MAX_REVIEW_CYCLES" is "Stop"/)
    expect(collectSecondCycleDefects(seed(ON, /^ {3}Continue with review\.$/m, '   Stop the review.'), REF)).toContain('1 "Continue with review." lines, expected 2')
    expect(collectSecondCycleDefects(ON, `${REF}\nStart a second review cycle.\n`)).toContain('the reference starts a second cycle')
    expect(collectSecondCycleDefects(`${ON}\nThen run \`/resolve\`.\n`, REF)).toContain('the command starts /resolve')
    expect(collectSecondCycleDefects(`${ON}\nThen run \`/devflow:resolve\`.\n`, REF)).toContain('the command starts /resolve')
    expect(collectSecondCycleDefects(`${ON}\nThen go back to Phase 1.\n`, REF)).toContain('the command restarts or re-enters Phase 1 or 2')
    expect(collectSecondCycleDefects(seed(ON, '### Phase 4: Write Review Head Marker & Report', '### Phase 4: Write Review Head Marker & Report\n\nAgent(subagent_type="Review", run_in_background=false): "Mode: again"\n'), REF))
      .toContain('a Review agent is spawned after Phase 3')
  })

  it('a script path named resolve-settings.cjs is not a /resolve start', () => {
    expect(collectSecondCycleDefects(`${ON}\nnode "$HOME/.devflow/scripts/resolve-settings.cjs" "{root}"\n`, REF)).toEqual([])
    expect(RESOLVE_START.test('node scripts/resolve-evidence-policy.cjs')).toBe(false)
  })
})

describe('the summary names the level and the focuses (AC-11)', () => {
  it.each(VARIANTS)('$label: the Synthesize spawn passes both inputs and the summary reference uses them', ({ body }) => {
    expect(collectSummaryDefects(body, SYN)).toEqual([])
  })

  it('known-bad probes: a lost input, a lost or misplaced Gate level line, a lost marker, a lost security row, the level in the Git spawn and a new summary file are each reported', () => {
    expect(collectSummaryDefects(seed(ON, 'GATE_LEVEL: {GATE_LEVEL}\nFOCUSES: {REVIEW_FOCUS_LIST}\n', 'FOCUSES: {REVIEW_FOCUS_LIST}\n'), SYN))
      .toContain('the Synthesize spawn does not pass GATE_LEVEL')
    expect(collectSummaryDefects(seed(ON, 'FOCUSES: {REVIEW_FOCUS_LIST}\n', ''), SYN)).toContain('the Synthesize spawn does not pass FOCUSES')
    expect(collectSummaryDefects(ON, seed(SYN, /^\*\*Gate level\*\*: .*\n/m, ''))).toContain('the summary template has no line that starts with "**Gate level**: {GATE_LEVEL}"')
    expect(collectSummaryDefects(ON, seed(SYN, '`(no report)`', 'nothing'))).toContain('the Gate level line does not mark a focus with no report')
    expect(collectSummaryDefects(ON, seed(SYN, /^(\*\*Date\*\*: .*\n)(\*\*Gate level\*\*: .*\n)/m, '$2$1'))).toContain('the Gate level line does not follow the Date line')
    expect(collectSummaryDefects(ON, seed(SYN, /^\*\*Date\*\*: .*\n/m, ''))).toContain('the Gate level line does not follow the Date line')
    expect(collectSummaryDefects(ON, seed(SYN, /^## Merge Recommendation: .*\n/m, ''))).toContain('the Gate level line does not come before the Merge Recommendation')
    expect(collectSummaryDefects(seed(ON, 'OPERATION: post-review-summary\n', 'OPERATION: post-review-summary\nGATE_LEVEL: {GATE_LEVEL}\n'), SYN))
      .toContain('the Git spawn carries the level or the focuses')
    expect(collectSummaryDefects(ON, seed(SYN, `${SECURITY_ROW}\n`, '')))
      .toContain('the Merge Rules have no row for the security focus with no report')
    expect(collectSummaryDefects(ON, seed(SYN, SECURITY_ROW, '| Security focus has no report (it runs in every review) | APPROVED WITH COMMENTS |')))
      .toContain('the security focus with no report gives "APPROVED WITH COMMENTS"')
    expect(collectSummaryDefects(ON, seed(SYN, /^(\| Security focus has no report .*\n)(.*\n)(\| No blocking issues \| APPROVED \|)$/m, '$2$3\n$1'.trimEnd())))
      .toContain('the "No blocking issues" row gives "APPROVED" before the security row, so APPROVED is reachable with no security report')
    expect(collectSummaryDefects(ON, seed(SYN, ' (first matching row applies)', '')))
      .toContain('the Merge Rules do not say that the first matching row applies')
    expect(collectSummaryDefects(ON, seed(SYN, /^(\| Any CRITICAL in blocking \| BLOCK MERGE \|\n)(\| Any HIGH in blocking \| CHANGES REQUESTED \|\n)(\| Security focus has no report .*\n)/m, '$3$1$2')))
      .toContain('with no security report, FOCUSES [security, architecture, performance, complexity, consistency, regression, testing, reliability] and a CRITICAL blocking issue, the Merge Rules give "CHANGES REQUESTED", expected "BLOCK MERGE"')
    for (const planned of ['| Planned security focus has no report | CHANGES REQUESTED |', '| Security focus in FOCUSES has no report | CHANGES REQUESTED |']) {
      const defects = collectSummaryDefects(ON, seed(SYN, SECURITY_ROW, planned))
      expect(defects).toContain('with no security report, FOCUSES [architecture, performance, complexity, consistency, regression, testing, reliability] and no blocking issue, the Merge Rules give "APPROVED", expected "CHANGES REQUESTED"')
      expect(defects).toContain('with no security report, FOCUSES [] and no blocking issue, the Merge Rules give "APPROVED", expected "CHANGES REQUESTED"')
    }
    expect(collectSummaryDefects(ON, seed(SYN, '{BLOCK MERGE | CHANGES REQUESTED | APPROVED WITH COMMENTS | APPROVED}', '{BLOCK | CHANGES_REQUESTED | APPROVED}')))
      .toContain('the Merge Recommendation slot is "BLOCK | CHANGES_REQUESTED | APPROVED", the Merge Rules give "BLOCK MERGE | CHANGES REQUESTED | APPROVED WITH COMMENTS | APPROVED"')
    expect(collectSummaryDefects(ON, seed(SYN, '{Max 5 brief items ', '{Max 5 items ')))
      .toContain('the Suggestions guidance lost its limit of 5 brief items')
    expect(collectSummaryDefects(ON, seed(SYN, '- **GATE_LEVEL**, **FOCUSES**', '- **GATE_LEVEL**')))
      .toContain('the Mode inputs do not declare FOCUSES')
    expect(collectSummaryDefects(`${ON}\nWrite the levels to {worktree_path}/.devflow/docs/reviews/{branch-slug}/{timestamp}/levels.md.\n`, SYN))
      .toContain('the command writes {timestamp}/levels.md, a file the summary does not need')
  })
})
