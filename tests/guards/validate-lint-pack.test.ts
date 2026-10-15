/**
 * The Validate lint pack at the `lean` gate level (#475, part of epic #468).
 *
 * At `lean`, the `/implement` Phase 6 Validate runs the project's own lint pack, a build entry named
 * `lint-pack`, once the table commands that exist pass. The pack's template ships in the npm package and
 * devflow never installs or runs it. What this file holds, each arm through a named collector and known-bad
 * probes that drive the same collector over a synthetic violation:
 *   1. The doctrine: the Validate body's Lint pack section, its Input bullet, its lead line and its Output
 *      block, with the four states and both slots above the cap line.
 *   2. One spawn site: of every Validate spawn, only the `/implement` Phase 6 one passes `GATE_LEVEL` and
 *      `BASE_SHA`, as the first two lines of its prompt, in both builds.
 *   3. The data flow and the report: Phase 1 Produces and Phase 6 Requires list `GATE_LEVEL`; Phase 12 shows
 *      Validate's `Lint pack:` line, if any; Phase 9 passes an UNVERIFIED line to the PR body's Testing part.
 *   4. The Fix rule: validation-fix never edits the pack, its config, its build-file entry or `.gitattributes`
 *      to clear a match, and no other mode carries the rule.
 *   5. Ownership: the template folder holds exactly three files, the package ships it, and no prompt, hook or
 *      CLI source names the template script or runs the folder. No install golden names the pack.
 *   6. Size: the Validate body sits under its ceiling, registered as `validate-body-max`; lowered, never raised.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import {
  ROOT, agentReferencePath, isAgentBlock, parseFences, requireDistFile, requireDistFiles, resolveAgentSource,
  resolveAllAgents, resolveLearningOffSource, sectionBetween, walkFiles,
} from '../helpers.js'

/** The Validate agent body, src/assets/agents/validate.md, in bytes. Registered as `validate-body-max`; lowered, never raised. */
const VALIDATE_BODY_MAX_BYTES = 6_049

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

interface Doc {
  readonly label: string
  readonly text: string
}

const IMPLEMENT_ON = 'dist/commands/implement.md'
const IMPLEMENT_OFF = 'dist/learning-off/commands/implement.md'
const IMPLEMENT_LABELS: readonly string[] = [IMPLEMENT_ON, IMPLEMENT_OFF]
const REVALIDATE_LABEL = 'reference commands/implement-revalidate.md'

/** Every compiled command, in both builds. A missing build is an error, never a skip. */
function commandDocs(): Doc[] {
  const docs: Doc[] = []
  for (const file of requireDistFiles()) {
    docs.push({ label: `dist/commands/${file}`, text: requireDistFile(file) })
    const off = resolveLearningOffSource('commands', file.replace(/\.md$/, ''))
    if (off !== null) docs.push({ label: `dist/learning-off/commands/${file}`, text: off })
  }
  return docs
}

/** Every agent the registry declares, compiled where the build produces it. */
function agentDocs(): Doc[] {
  return [...resolveAllAgents()].map(([name, source]) => ({ label: `agent ${name}`, text: source.content }))
}

/** Every agent-references file. */
function referenceDocs(): Doc[] {
  const root = agentReferencePath('')
  return walkFiles(root, f => f.endsWith('.md')).map(file => ({
    label: `reference ${path.relative(root, file).split(path.sep).join('/')}`,
    text: readFileSync(file, 'utf-8'),
  }))
}

const COMMANDS = commandDocs()
const SPAWN_CORPUS: readonly Doc[] = [...COMMANDS, ...agentDocs(), ...referenceDocs()]
const BUILDS: readonly Doc[] = IMPLEMENT_LABELS.map(label => {
  const doc = COMMANDS.find(d => d.label === label)
  if (doc === undefined) throw new Error(`${label} is absent: run \`npm run build\``)
  return doc
})
const IMPLEMENT_SOURCE: Doc = {
  label: 'src/assets/commands/implement.mds',
  text: readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'implement.mds'), 'utf-8'),
}
const VALIDATE_BODY = resolveAgentSource('validate').content
const FIX_BODY = resolveAgentSource('fix').content

/** Replace `from` with `to` in a text, failing the test when the seed did not land. */
function seed(text: string, from: string | RegExp, to: string): string {
  const next = typeof from === 'string' ? text.replace(from, () => to) : text.replace(from, to)
  expect(next, `the seed ${String(from)} must change the text`).not.toBe(text)
  return next
}

/** The corpus with one doc's text replaced. */
function withDoc(docs: readonly Doc[], label: string, change: (text: string) => string): Doc[] {
  expect(docs.some(d => d.label === label), `${label} is in the corpus`).toBe(true)
  return docs.map(d => (d.label === label ? { label, text: change(d.text) } : d))
}

// ---------------------------------------------------------------------------
// 1. The doctrine
// ---------------------------------------------------------------------------

/** What the `## Lint pack` section must say, one clause each. The collector and its probes range over this whole table. */
const SECTION_CLAUSES: ReadonlyArray<readonly [label: string, clause: string]> = [
  ['the exact lean gate on the first level line', 'Only if the first `GATE_LEVEL:` line is exactly `lean`'],
  ['run last, once the table commands that exist pass', 'run it last, once the table commands that exist pass'],
  ['silence at any other level', 'else never run it or print anything about it'],
  ['the Lint row never runs the pack', 'The Lint row never runs it.'],
  ['one discovery source', 'Use the root `package.json` script `lint-pack`, else the root `Makefile` target; look nowhere else.'],
  ['not configured without either entry', 'Neither: not configured.'],
  ['the npm form', '`npm run -s lint-pack -- <BASE_SHA>`'],
  ['the make form', '`make -s lint-pack BASE=<BASE_SHA>`'],
  ['the capture form and the log read', 'in the capture form; Read the log'],
  ['the last LINT_PACK line decides', 'Its last `LINT_PACK:` line decides'],
  ['no-config reads as not configured', '`no-config` is not configured'],
  ['clean reads as clean', '`clean` is clean'],
  ['matches set FAIL and fill Parsed References', '`matches <n>` sets FAIL, each record into Parsed References'],
  ['every other outcome is an error', 'Any other line, none, a timeout or a first `BASE_SHA:` not matching `^[0-9a-f]{40}$` is an error'],
  ['an error keeps Status', 'Status stays'],
  ['an error reads UNVERIFIED, never a pass', 'the pack is UNVERIFIED, never a pass'],
  ['EXIT never decides the pack', '`EXIT=` never decides it'],
  ['an error is never BLOCKED', 'an error is never BLOCKED'],
  ['the changed and binary slots are copied', 'Copy the `pack-changed` paths and `skipped-binary` count to the `Lint pack:` line.'],
]

/** What the Output block's `Lint pack:` line must carry: its four states and both slots. */
const OUTPUT_PIECES: ReadonlyArray<readonly [label: string, piece: string]> = [
  ['the not-configured state with the template location', 'not configured (template: `templates/lint-pack` in devflow-kit)'],
  ['the clean state', ' | clean | '],
  ['the matches state', '<n> matches'],
  ['the UNVERIFIED state with its reason', 'UNVERIFIED (error <reason>)'],
  ['the pack-changed slot', '{; pack changed: <paths>}'],
  ['the skipped-binary slot', '{; <n> binary skipped}'],
]

const SECOND_SOURCE_WORDS: readonly string[] = ['scripts/', '.sh', 'Cargo.toml', 'pyproject', 'justfile', 'Taskfile']

/** Named collector: how the Validate body falls short of the lint-pack doctrine. */
export function collectValidateDoctrineDefects(body: string): string[] {
  const out: string[] = []
  const section = sectionBetween(body, '## Lint pack\n', '\n## Principles')
  if (section === null) return ['the body has no `## Lint pack` section before `## Principles`']
  if (!(body.indexOf('\n## Running commands') < body.indexOf('\n## Lint pack\n'))) out.push('the Lint pack section does not follow Running commands')
  for (const [label, clause] of SECTION_CLAUSES) {
    if (!section.includes(clause)) out.push(`the Lint pack section lost: ${label}`)
  }
  if (/\b(standard|full)\b/.test(section)) out.push('the Lint pack section names a level other than lean')
  for (const word of SECOND_SOURCE_WORDS) {
    if (section.includes(word)) out.push(`the Lint pack section names a second discovery source: ${word.trim()}`)
  }
  if (!body.includes('skipping any that do not exist and stopping on first failure:')) out.push('the lead line does not skip a table command that does not exist')
  if (!body.includes('- **GATE_LEVEL**, **BASE_SHA** (optional): see Lint pack.')) out.push('the Input context has no optional GATE_LEVEL and BASE_SHA bullet')
  const output = sectionBetween(body, '\n## Output\n', '\n## Core rules')
  if (output === null) return [...out, 'the body has no `## Output` section before `## Core rules`']
  const heading = output.indexOf('### Lint Pack')
  const references = output.indexOf('**Parsed References:**')
  const blockers = output.indexOf('### Blockers')
  const cap = output.indexOf('Report cap:')
  if (heading === -1) out.push('the Output block has no Lint Pack section')
  else if (!(references !== -1 && references < heading && heading < blockers && blockers < cap)) out.push('the Lint Pack section is not between Parsed References and Blockers, above the cap line')
  const line = output.split('\n').find(l => l.startsWith('Lint pack: {')) ?? ''
  if (line === '') out.push('the Output block has no `Lint pack:` line')
  for (const [label, piece] of OUTPUT_PIECES) {
    if (!line.includes(piece)) out.push(`the Lint pack line lost: ${label}`)
  }
  const last = output.trimEnd().split('\n').at(-1) ?? ''
  if (!last.startsWith('Report cap:')) out.push('the cap line is not last in Output')
  if (!last.includes('the `Lint pack:` line')) out.push('the cap line does not exempt the `Lint pack:` line')
  return out
}

describe('the Validate body holds the lint-pack doctrine (AC-6, AC-7)', () => {
  it('reads a real body, and it holds every clause', () => {
    expect(Buffer.byteLength(VALIDATE_BODY), 'the body is empty').toBeGreaterThan(4_000)
    expect(SECTION_CLAUSES.length).toBeGreaterThanOrEqual(19)
    expect(OUTPUT_PIECES.length).toBe(6)
    expect(collectValidateDoctrineDefects(VALIDATE_BODY)).toEqual([])
  })

  it('probes: each lost clause, piece or placement is reported by the same collector', () => {
    for (const [label, clause] of SECTION_CLAUSES) {
      expect(collectValidateDoctrineDefects(seed(VALIDATE_BODY, clause, '')), clause).toContain(`the Lint pack section lost: ${label}`)
    }
    for (const [label, piece] of OUTPUT_PIECES) {
      expect(collectValidateDoctrineDefects(seed(VALIDATE_BODY, piece, '')), piece).toContain(`the Lint pack line lost: ${label}`)
    }
    const lostLean = seed(VALIDATE_BODY, 'is exactly `lean`', 'is `lean` or `standard`')
    expect(collectValidateDoctrineDefects(lostLean)).toContain('the Lint pack section lost: the exact lean gate on the first level line')
    expect(collectValidateDoctrineDefects(lostLean)).toContain('the Lint pack section names a level other than lean')
    for (const word of SECOND_SOURCE_WORDS) {
      const widened = seed(VALIDATE_BODY, 'look nowhere else.', `look nowhere else except ${word}x.`)
      expect(collectValidateDoctrineDefects(widened), word).toContain(`the Lint pack section names a second discovery source: ${word.trim()}`)
    }
    expect(collectValidateDoctrineDefects(seed(VALIDATE_BODY, 'skipping any that do not exist and ', '')))
      .toContain('the lead line does not skip a table command that does not exist')
    expect(collectValidateDoctrineDefects(seed(VALIDATE_BODY, '- **GATE_LEVEL**, **BASE_SHA** (optional): see Lint pack.\n', '')))
      .toContain('the Input context has no optional GATE_LEVEL and BASE_SHA bullet')
    expect(collectValidateDoctrineDefects(seed(VALIDATE_BODY, '## Lint pack\n', '## Lint\n')))
      .toEqual(['the body has no `## Lint pack` section before `## Principles`'])
    expect(collectValidateDoctrineDefects(seed(VALIDATE_BODY, '### Lint Pack (lean only)\n', '')))
      .toContain('the Output block has no Lint Pack section')
    const belowCap = seed(VALIDATE_BODY, /(### Lint Pack \(lean only\)\n[^\n]*\n\n)/, '')
      .replace('\n## Core rules', '\n### Lint Pack (lean only)\nLint pack: {not configured}\n\n## Core rules')
    expect(collectValidateDoctrineDefects(belowCap)).toContain('the Lint Pack section is not between Parsed References and Blockers, above the cap line')
    expect(collectValidateDoctrineDefects(seed(VALIDATE_BODY, 'table, Parsed References and the `Lint pack:` line.', 'table and Parsed References.')))
      .toContain('the cap line does not exempt the `Lint pack:` line')
  })
})

// ---------------------------------------------------------------------------
// 2. One spawn site
// ---------------------------------------------------------------------------

const LEVEL_LINE = /^"?GATE_LEVEL:/m
const BASE_LINE = /^BASE_SHA:/m
const PHASE6_LEVEL = 'GATE_LEVEL: {GATE_LEVEL}'
const PHASE6_BASE = 'BASE_SHA: {output of `git merge-base {BASE_BRANCH} HEAD`}'

/** Named collector: every fenced spawn of the Validate agent in a text. */
export function collectValidateFences(text: string): string[] {
  return parseFences(text).filter(fence => isAgentBlock(fence, 'Validate'))
}

/** Named collector: every Validate spawn in a text, fenced or written in prose (a paragraph that holds the spawn call). */
export function collectValidateSpawns(text: string): string[] {
  const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, '').split(/\n[ \t]*\n/)
  return [...collectValidateFences(text), ...prose.filter(paragraph => isAgentBlock(paragraph, 'Validate'))]
}

/** Named collector: how the corpus passes `GATE_LEVEL` and `BASE_SHA` to a Validate spawn other than the one site. */
export function collectSpawnSiteDefects(docs: readonly Doc[]): string[] {
  const out: string[] = []
  for (const doc of docs) {
    const isImplement = IMPLEMENT_LABELS.includes(doc.label)
    const phase6 = isImplement ? sectionBetween(doc.text, '### Phase 6: Validate', '### Phase 7:') : null
    const site = phase6 === null ? null : collectValidateFences(phase6)[0] ?? null
    if (isImplement && site === null) out.push(`${doc.label}: Phase 6 has no Validate spawn`)
    for (const fence of collectValidateSpawns(doc.text)) {
      if (fence === site) {
        const prompt = fence.split('\n').slice(2)
        if (prompt[0]?.replace(/^"/, '') !== PHASE6_LEVEL) out.push(`${doc.label}: the Phase 6 prompt does not open with the GATE_LEVEL line`)
        if (prompt[1] !== PHASE6_BASE) out.push(`${doc.label}: the Phase 6 prompt does not carry the BASE_SHA line second`)
        if (!fence.includes('\nFILES_CHANGED: {branch_diff}\nVALIDATION_SCOPE: full\n')) out.push(`${doc.label}: FILES_CHANGED and VALIDATION_SCOPE are not adjacent in the Phase 6 prompt`)
        continue
      }
      if (LEVEL_LINE.test(fence)) out.push(`${doc.label}: a Validate spawn other than implement Phase 6 passes GATE_LEVEL`)
      if (BASE_LINE.test(fence)) out.push(`${doc.label}: a Validate spawn other than implement Phase 6 passes BASE_SHA`)
    }
    if (doc.label === REVALIDATE_LABEL && /GATE_LEVEL|BASE_SHA/.test(doc.text)) out.push(`${doc.label}: the re-validation path names GATE_LEVEL or BASE_SHA`)
  }
  return out
}

/** The names a section's `**Produces:**` or `**Requires:**` lines list, one array per line. */
function dataFlowLines(section: string | null, kind: 'Produces' | 'Requires'): string[][] {
  const lines = (section ?? '').split('\n').filter(l => l.startsWith(`**${kind}:**`))
  return lines.map(l => l.slice(`**${kind}:**`.length).replace(/\([^)]*\)/g, '').split(',').map(n => n.trim()).filter(n => n !== ''))
}

/** Named collector: how a copy of `/implement` fails to list `GATE_LEVEL` in the data flow, once per learning arm it holds. */
export function collectDataFlowDefects(doc: Doc, arms: number): string[] {
  const out: string[] = []
  const phase1 = dataFlowLines(sectionBetween(doc.text, '### Phase 1: Setup', '### Phase 2:'), 'Produces')
  if (phase1.length !== arms) out.push(`${doc.label}: Phase 1 has ${phase1.length} Produces lines, expected ${arms}`)
  for (const names of phase1) {
    if (!names.includes('GATE_LEVEL')) out.push(`${doc.label}: a Phase 1 Produces line does not list GATE_LEVEL`)
  }
  const phase6 = dataFlowLines(sectionBetween(doc.text, '### Phase 6: Validate', '### Phase 7:'), 'Requires')
  if (phase6.length !== 1) out.push(`${doc.label}: Phase 6 has ${phase6.length} Requires lines, expected 1`)
  for (const name of ['BASE_BRANCH', 'GATE_LEVEL']) {
    if (!phase6.some(names => names.includes(name))) out.push(`${doc.label}: Phase 6 Requires does not list ${name}`)
  }
  return out
}

/** The text with `GATE_LEVEL` dropped from the n-th Phase 1 Produces line (one line per learning arm). */
function dropFromArm(text: string, n: number): string {
  let seen = 0
  const next = text.replace(/^(\*\*Produces:\*\* TASK_ID[^\n]*), GATE_LEVEL$/gm, (whole: string, kept: string) => (seen++ === n ? kept : whole))
  expect(next, `Produces line ${n} must change`).not.toBe(text)
  return next
}

describe('only the implement Phase 6 Validate spawn passes the level and the base (AC-8)', () => {
  it('the corpus is real: implement spawns Validate twice per build, resolve and the others at least once', () => {
    for (const label of IMPLEMENT_LABELS) {
      const doc = COMMANDS.find(d => d.label === label)
      expect(collectValidateSpawns(doc?.text ?? '').length, label).toBe(2)
    }
    for (const base of ['resolve', 'self-review', 'release', 'dynamic-build']) {
      for (const label of [`dist/commands/${base}.md`, `dist/learning-off/commands/${base}.md`]) {
        const doc = COMMANDS.find(d => d.label === label)
        expect(doc, `${label} is read`).toBeDefined()
        expect(collectValidateSpawns(doc?.text ?? '').length, label).toBeGreaterThanOrEqual(1)
      }
    }
    expect(SPAWN_CORPUS.some(d => d.label === REVALIDATE_LABEL), 'the re-validation reference is read').toBe(true)
    expect(SPAWN_CORPUS.some(d => d.label === 'agent validate'), 'the Validate agent is read').toBe(true)
    expect(SPAWN_CORPUS.length, 'commands in both builds, agents and references').toBeGreaterThan(50)
  })

  it('the level line of another agent is not a Validate spawn: it does not fail the guard', () => {
    const review = SPAWN_CORPUS.filter(d => /(^|\/)code-review\.md$/.test(d.label))
    expect(review.length, 'code-review in both builds').toBe(2)
    for (const doc of review) expect(LEVEL_LINE.test(doc.text), `${doc.label} passes GATE_LEVEL to its own agents`).toBe(true)
    expect(collectSpawnSiteDefects(SPAWN_CORPUS)).toEqual([])
  })

  it('the data flow lists GATE_LEVEL in both Phase 1 arms, both builds and Phase 6', () => {
    expect(collectDataFlowDefects(IMPLEMENT_SOURCE, 2)).toEqual([])
    for (const doc of BUILDS) expect(collectDataFlowDefects(doc, 1)).toEqual([])
  })

  it('probes: a level line anywhere else, in the wrong place or a dropped entry is reported', () => {
    for (const label of IMPLEMENT_LABELS) {
      const phase8 = (text: string): string => seed(text, 'VALIDATION_SCOPE: changed-only\n', `VALIDATION_SCOPE: changed-only\n${PHASE6_LEVEL}\n`)
      expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, phase8)), label)
        .toContain(`${label}: a Validate spawn other than implement Phase 6 passes GATE_LEVEL`)
      const phase8Base = (text: string): string => seed(text, 'VALIDATION_SCOPE: changed-only\n', `VALIDATION_SCOPE: changed-only\n${PHASE6_BASE}\n`)
      expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, phase8Base)), label)
        .toContain(`${label}: a Validate spawn other than implement Phase 6 passes BASE_SHA`)
      const moved = (text: string): string => seed(text, `"${PHASE6_LEVEL}\n${PHASE6_BASE}\nFILES_CHANGED: {branch_diff}\n`, `"FILES_CHANGED: {branch_diff}\n${PHASE6_LEVEL}\n${PHASE6_BASE}\n`)
      expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, moved)), label)
        .toContain(`${label}: the Phase 6 prompt does not open with the GATE_LEVEL line`)
      const swapped = (text: string): string => seed(text, `${PHASE6_LEVEL}\n${PHASE6_BASE}\n`, `${PHASE6_BASE}\n${PHASE6_LEVEL}\n`)
      expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, swapped)), label)
        .toContain(`${label}: the Phase 6 prompt does not carry the BASE_SHA line second`)
      const apart = (text: string): string => seed(text, 'FILES_CHANGED: {branch_diff}\nVALIDATION_SCOPE: full\n', 'FILES_CHANGED: {branch_diff}\nNote.\nVALIDATION_SCOPE: full\n')
      expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, apart)), label)
        .toContain(`${label}: FILES_CHANGED and VALIDATION_SCOPE are not adjacent in the Phase 6 prompt`)
      const noSite = (text: string): string => seed(text, '### Phase 6: Validate', '### Phase 6: Check')
      expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, noSite)), label).toContain(`${label}: Phase 6 has no Validate spawn`)
    }
    for (const base of ['resolve', 'self-review', 'release', 'dynamic-build']) {
      for (const label of [`dist/commands/${base}.md`, `dist/learning-off/commands/${base}.md`]) {
        const addBase = (text: string): string => {
          const spawn = collectValidateSpawns(text)[0] ?? ''
          return seed(text, spawn, spawn.endsWith('```') ? `${spawn.slice(0, -3)}${PHASE6_BASE}\n\`\`\`` : `${spawn}\n${PHASE6_BASE}`)
        }
        const bad = collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, addBase))
        expect(bad, label).toContain(`${label}: a Validate spawn other than implement Phase 6 passes BASE_SHA`)
      }
    }
    const resolveLabels = SPAWN_CORPUS.map(d => d.label).filter(l => /resolve\.md$/.test(l))
    expect(resolveLabels.length, 'resolve in both builds').toBe(2)
    for (const label of resolveLabels) {
      const addLevel = (text: string): string => seed(text, 'VALIDATION_SCOPE: full\n', `VALIDATION_SCOPE: full\n${PHASE6_LEVEL}\n`)
      expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, label, addLevel)), label)
        .toContain(`${label}: a Validate spawn other than implement Phase 6 passes GATE_LEVEL`)
    }
    const revalidate = (text: string): string => `${text}\nPass GATE_LEVEL.\n`
    expect(collectSpawnSiteDefects(withDoc(SPAWN_CORPUS, REVALIDATE_LABEL, revalidate)))
      .toContain(`${REVALIDATE_LABEL}: the re-validation path names GATE_LEVEL or BASE_SHA`)
  })

  it('probes: a dropped Produces or Requires entry is reported, in every arm and build', () => {
    for (const arm of [0, 1]) {
      expect(collectDataFlowDefects({ label: IMPLEMENT_SOURCE.label, text: dropFromArm(IMPLEMENT_SOURCE.text, arm) }, 2), `arm ${arm}`)
        .toContain(`${IMPLEMENT_SOURCE.label}: a Phase 1 Produces line does not list GATE_LEVEL`)
    }
    for (const doc of BUILDS) {
      expect(collectDataFlowDefects({ label: doc.label, text: dropFromArm(doc.text, 0) }, 1), doc.label)
        .toContain(`${doc.label}: a Phase 1 Produces line does not list GATE_LEVEL`)
      for (const name of ['BASE_BRANCH', 'GATE_LEVEL']) {
        const other = name === 'GATE_LEVEL' ? 'BASE_BRANCH' : 'GATE_LEVEL'
        const dropped = seed(doc.text, '**Requires:** BASE_BRANCH, GATE_LEVEL\n', `**Requires:** ${other}\n`)
        expect(collectDataFlowDefects({ label: doc.label, text: dropped }, 1), `${doc.label} ${name}`)
          .toContain(`${doc.label}: Phase 6 Requires does not list ${name}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 3. The report
// ---------------------------------------------------------------------------

/** Named collector: how a copy of `/implement` fails to show Validate's `Lint pack:` line. */
export function collectReportDefects(doc: Doc): string[] {
  const out: string[] = []
  const phase12 = sectionBetween(doc.text, '### Phase 12: Report', '## Architecture')
  if (phase12 === null) out.push(`${doc.label}: no Phase 12 section`)
  else if (!phase12.includes("Validate's `Lint pack:` line if any")) out.push(`${doc.label}: Phase 12 does not show Validate's Lint pack line, if any`)
  const phase9 = sectionBetween(doc.text, '### Phase 9: Open PR', '### Phase 10:')
  const guidance = (phase9 ?? '').split('\n').find(l => l.startsWith('PR_DESCRIPTION_GUIDANCE:')) ?? ''
  if (guidance === '') out.push(`${doc.label}: Phase 9 has no PR_DESCRIPTION_GUIDANCE line`)
  for (const piece of ["Validate's `Lint pack:` line", 'UNVERIFIED', 'for Testing']) {
    if (guidance !== '' && !guidance.includes(piece)) out.push(`${doc.label}: the Phase 9 guidance lost: ${piece}`)
  }
  return out
}

describe('the final report and the PR body show an UNVERIFIED lint pack (AC-7)', () => {
  it('holds in both builds', () => {
    for (const doc of BUILDS) {
      expect(doc.text.length, doc.label).toBeGreaterThan(30_000)
      expect(collectReportDefects(doc), doc.label).toEqual([])
    }
  })

  it('probes: a dropped Phase 12 or Phase 9 clause is reported, in both builds', () => {
    for (const doc of BUILDS) {
      expect(collectReportDefects({ label: doc.label, text: seed(doc.text, "Validate's `Lint pack:` line if any, ", '') }), doc.label)
        .toContain(`${doc.label}: Phase 12 does not show Validate's Lint pack line, if any`)
      const clause = ", then Validate's `Lint pack:` line if UNVERIFIED, for Testing"
      for (const [lost, changed] of [
        ["Validate's `Lint pack:` line", ''],
        ["Validate's `Lint pack:` line", ", then the pack line if UNVERIFIED, for Testing"],
        ['UNVERIFIED', ", then Validate's `Lint pack:` line if wrong, for Testing"],
        ['for Testing', ", then Validate's `Lint pack:` line if UNVERIFIED, for review"],
      ] as const) {
        const defects = collectReportDefects({ label: doc.label, text: seed(doc.text, clause, changed) })
        expect(defects, `${doc.label} ${lost}`).toContain(`${doc.label}: the Phase 9 guidance lost: ${lost}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 4. The Fix rule
// ---------------------------------------------------------------------------

/** The four parts of the pack the rule names. The collector and its probes range over this whole table. */
const RULE_PARTS: readonly string[] = ['the lint pack', 'its config', 'its build-file entry', '`.gitattributes`']

/** Named collector: how the Fix body fails to forbid editing the pack, in validation-fix and nowhere else. */
export function collectFixRuleDefects(fix: string, others: readonly Doc[]): string[] {
  const out: string[] = []
  const start = fix.indexOf('## Mode: validation-fix')
  const end = fix.indexOf('\n## ', start + 1)
  if (start === -1 || end === -1) return ['the Fix body has no validation-fix mode']
  const mode = fix.slice(start, end)
  const rule = mode.split('\n').find(l => /^\d+\. Never edit /.test(l)) ?? ''
  if (rule === '') out.push('validation-fix has no Never-edit protocol entry')
  for (const part of RULE_PARTS) {
    if (rule !== '' && !rule.includes(part)) out.push(`the validation-fix rule does not name ${part}`)
  }
  for (const piece of ['to clear a lint-pack match', 'report it under Blockers']) {
    if (rule !== '' && !rule.includes(piece)) out.push(`the validation-fix rule lost: ${piece}`)
  }
  const outside = fix.slice(0, start) + fix.slice(end)
  if (/lint[ -]pack/i.test(outside)) out.push('Fix names the lint pack outside validation-fix')
  for (const doc of others) {
    if (/lint[ -]pack/i.test(doc.text)) out.push(`${doc.label} names the lint pack`)
  }
  return out
}

/** The rule line without one of the pack's parts, and the separator before it. */
function dropPart(rule: string, part: string): string {
  for (const separator of [', ', ' or ', '']) {
    const cut = rule.replace(`${separator}${part}`, '')
    if (cut !== rule) return cut
  }
  return rule
}

describe('Fix never edits the lint pack to clear a match (AC-10)', () => {
  const others: Doc[] = ['code', 'refactor'].map(name => ({ label: `agent ${name}`, text: resolveAgentSource(name).content }))

  it('the rule sits in validation-fix only, and no Code or Refactor body carries it', () => {
    expect(Buffer.byteLength(FIX_BODY), 'the Fix body is read').toBeGreaterThan(5_000)
    expect(FIX_BODY).toContain('OPERATION: qa-fix')
    for (const doc of others) expect(doc.text.length, doc.label).toBeGreaterThan(5_000)
    expect(collectFixRuleDefects(FIX_BODY, others)).toEqual([])
  })

  it('probes: a narrowed rule, a moved rule and a copied rule are reported', () => {
    const rule = FIX_BODY.split('\n').find(l => /^\d+\. Never edit /.test(l)) ?? ''
    expect(rule, 'the rule line is found').not.toBe('')
    for (const part of RULE_PARTS) {
      expect(collectFixRuleDefects(seed(FIX_BODY, rule, dropPart(rule, part)), others), part)
        .toContain(`the validation-fix rule does not name ${part}`)
    }
    for (const piece of ['to clear a lint-pack match', 'report it under Blockers']) {
      expect(collectFixRuleDefects(seed(FIX_BODY, piece, 'x'), others), piece).toContain(`the validation-fix rule lost: ${piece}`)
    }
    expect(collectFixRuleDefects(seed(FIX_BODY, /\n\d+\. Never edit [^\n]*/, ''), others)).toContain('validation-fix has no Never-edit protocol entry')
    expect(collectFixRuleDefects(seed(FIX_BODY, '## Mode: qa-fix', 'Never edit the lint pack.\n\n## Mode: qa-fix'), others))
      .toContain('Fix names the lint pack outside validation-fix')
    expect(collectFixRuleDefects(FIX_BODY, [...others, { label: 'agent code', text: 'Never edit the lint pack.' }]))
      .toContain('agent code names the lint pack')
    expect(collectFixRuleDefects('## Mode: qa-fix\n', others)).toEqual(['the Fix body has no validation-fix mode'])
  })
})

// ---------------------------------------------------------------------------
// 5. Ownership
// ---------------------------------------------------------------------------

const TEMPLATE_DIR = ['templates', 'lint-pack'].join('/')
const TEMPLATE_FILES: readonly string[] = ['.lint-pack.conf', 'README.md', 'lint-pack.sh']
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.mds', '.ts', '.cjs', '.mjs', '.js', '.sh', '.json', '.yml', '.yaml', '.txt'])
const NOT_CONFIGURED_POINTER = 'not configured (template: `templates/lint-pack` in devflow-kit)'

interface OwnershipInput {
  readonly templateFiles: readonly string[]
  readonly packageFiles: readonly string[]
  readonly sources: readonly Doc[]
  readonly goldens: readonly Doc[]
}

/** Named collector: how the template folder, the package and the prompt, hook and CLI sources break the ownership rules. */
export function collectOwnershipDefects(input: OwnershipInput): string[] {
  const out: string[] = []
  const found = [...input.templateFiles].sort().join(', ')
  if (found !== TEMPLATE_FILES.join(', ')) out.push(`${TEMPLATE_DIR}/ holds [${found}], expected [${TEMPLATE_FILES.join(', ')}]`)
  if (!input.packageFiles.includes(`${TEMPLATE_DIR}/`)) out.push(`package.json files does not list ${TEMPLATE_DIR}/`)
  for (const doc of input.sources) {
    for (const line of doc.text.split('\n')) {
      if (line.includes('lint-pack.sh')) out.push(`${doc.label} names the template script`)
      if (line.includes(TEMPLATE_DIR) && !line.includes(NOT_CONFIGURED_POINTER)) out.push(`${doc.label} names ${TEMPLATE_DIR} outside the not-configured pointer`)
    }
  }
  for (const doc of input.goldens) {
    if (doc.text.includes('lint-pack')) out.push(`${doc.label} names the lint pack`)
  }
  return [...new Set(out)]
}

function readTree(dir: string): Doc[] {
  return walkFiles(dir, f => TEXT_EXTENSIONS.has(path.extname(f))).map(file => ({
    label: path.relative(ROOT, file).split(path.sep).join('/'),
    text: readFileSync(file, 'utf-8'),
  }))
}

describe('the template is shipped, never installed or run (AC-9)', () => {
  const sources = [...readTree(path.join(ROOT, 'src')), ...readTree(path.join(ROOT, 'dist'))]
  const goldens = walkFiles(path.join(ROOT, 'tests', 'fixtures', 'golden'), f => /install-snapshot|hook-matrix/.test(path.basename(f)))
    .map(file => ({ label: path.basename(file), text: readFileSync(file, 'utf-8') }))
  const manifest: unknown = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
  const packageFiles = (manifest as { files?: unknown }).files
  const input: OwnershipInput = {
    templateFiles: walkFiles(path.join(ROOT, TEMPLATE_DIR), () => true).map(f => path.basename(f)),
    packageFiles: Array.isArray(packageFiles) ? packageFiles.filter((f): f is string => typeof f === 'string') : [],
    sources,
    goldens,
  }

  it('the corpus is real, and the rules hold', () => {
    expect(sources.length, 'src and dist are read').toBeGreaterThan(300)
    expect(sources.some(d => d.label === 'src/assets/agents/validate.md'), 'the Validate body is scanned').toBe(true)
    expect(sources.some(d => d.label.startsWith('dist/') && d.label.endsWith('.js')), 'compiled CLI code is scanned').toBe(true)
    expect(goldens.length, 'the install snapshots and the hook matrix are read').toBeGreaterThanOrEqual(4)
    expect(input.packageFiles.length, 'package.json files is read').toBeGreaterThan(3)
    expect(collectOwnershipDefects(input)).toEqual([])
  })

  it('probes: a hook naming the script, a missing entry, a fourth file and a golden are reported', () => {
    const hook: Doc = { label: 'src/assets/scripts/hooks/x', text: `bash ${TEMPLATE_DIR}/lint-pack.sh "$base"` }
    const defects = collectOwnershipDefects({ ...input, sources: [...sources, hook] })
    expect(defects).toContain('src/assets/scripts/hooks/x names the template script')
    expect(defects).toContain(`src/assets/scripts/hooks/x names ${TEMPLATE_DIR} outside the not-configured pointer`)
    const cli: Doc = { label: 'src/cli/x.ts', text: `const dir = '${TEMPLATE_DIR}/'` }
    expect(collectOwnershipDefects({ ...input, sources: [...sources, cli] })).toContain(`src/cli/x.ts names ${TEMPLATE_DIR} outside the not-configured pointer`)
    expect(collectOwnershipDefects({ ...input, packageFiles: input.packageFiles.filter(f => f !== `${TEMPLATE_DIR}/`) }))
      .toContain(`package.json files does not list ${TEMPLATE_DIR}/`)
    expect(collectOwnershipDefects({ ...input, templateFiles: [...input.templateFiles, 'extra.sh'] }))
      .toContain(`${TEMPLATE_DIR}/ holds [.lint-pack.conf, README.md, extra.sh, lint-pack.sh], expected [.lint-pack.conf, README.md, lint-pack.sh]`)
    expect(collectOwnershipDefects({ ...input, templateFiles: input.templateFiles.filter(f => f !== 'README.md') }))
      .toContain(`${TEMPLATE_DIR}/ holds [.lint-pack.conf, lint-pack.sh], expected [.lint-pack.conf, README.md, lint-pack.sh]`)
    expect(collectOwnershipDefects({ ...input, goldens: [...goldens, { label: 'install-snapshot-x.txt', text: '- templates/lint-pack/lint-pack.sh' }] }))
      .toContain('install-snapshot-x.txt names the lint pack')
  })
})

// ---------------------------------------------------------------------------
// 6. Size
// ---------------------------------------------------------------------------

/** Named collector: how a body falls short of its size ceiling. */
export function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

describe('the Validate body sits under its ceiling (AC-11)', () => {
  it('fits `validate-body-max`', () => {
    expect(Buffer.byteLength(VALIDATE_BODY), 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(4_000)
    expect(collectSizeDefects('validate.md', VALIDATE_BODY, VALIDATE_BODY_MAX_BYTES)).toEqual([])
  })

  it('probes: one byte over the ceiling is reported', () => {
    const over = `${VALIDATE_BODY}${'x'.repeat(VALIDATE_BODY_MAX_BYTES - Buffer.byteLength(VALIDATE_BODY) + 1)}`
    expect(Buffer.byteLength(over)).toBe(VALIDATE_BODY_MAX_BYTES + 1)
    expect(collectSizeDefects('validate.md', over, VALIDATE_BODY_MAX_BYTES))
      .toEqual([`validate.md is ${VALIDATE_BODY_MAX_BYTES + 1} bytes, ceiling ${VALIDATE_BODY_MAX_BYTES}`])
    expect(collectSizeDefects('validate.md', over.slice(0, -1), VALIDATE_BODY_MAX_BYTES)).toEqual([])
  })
})
