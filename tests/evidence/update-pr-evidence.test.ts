/**
 * tests/evidence/update-pr-evidence.test.ts
 *
 * SDLC-evidence PR4 (#363), phase P3, and #455 — the `update-pr-evidence` PR-host
 * operation.
 *
 *   AC-5  the op's contract (Input, D4, Output) and its mechanics are one file,
 *         `references/pr/update-pr-evidence.md`, contract first (D-OP-ONE-REF); it
 *         loads no publication gate and runs no visibility probe.
 *   AC-6  the mechanics POINT at the script rather than restate it (#455,
 *         D-OP-SCRIPT-POINTER): one `verify-evidence.cjs publish` run, whose stdout
 *         is the op's whole answer. The reference holds no gh call, no
 *         `--body-file`, no scrubber chain and no marker. The `EVIDENCE` template
 *         the mechanics parse accepts and rejects exactly what `EVIDENCE_LINE_RE`
 *         does, over a differential table.
 *   AC-203 the script itself, run for real under a `gh` fake on PATH: it prints the
 *         exact `## PR Evidence` block in every scenario, scrubs before it posts,
 *         and makes no gh write after a failed scrub (the check that used to be a
 *         shell chain in the reference now lives here, where it can be executed).
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe. Every reader reads BUILT artifacts.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { extractOpSectionFromCorpus, gitOperationReferenceCorpus, prHostRel } from '../helpers.js'
import { cleanShimRoots, runScript, SHIM_HEAD, SHIM_PR, type Redact, type ScriptRun, type ShimCall, type ShimScenario } from './pr-shim.js'
import { PR_EVIDENCE_SCRIPT, VERIFY_EVIDENCE_SCRIPT, CI_WAIT_SCRIPT } from './seam.js'

interface EvidenceFields {
  pr: number
  head: string
  total: number
  counts: Record<string, number>
  stale: readonly number[]
  exceptions: readonly string[]
  approval: string
  key: string
  posted: string
  body: string
}

/** Only what this suite reads from the script. */
interface EvidenceExports {
  readonly EVIDENCE_LINE_RE: RegExp
  readonly STATES: readonly string[]
  readonly MARKERS: Readonly<Record<string, unknown>>
  formatEvidenceLine(fields: EvidenceFields): { ok: true; value: string } | { ok: false }
}

const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as EvidenceExports

const OP = 'update-pr-evidence'

function requirePrBody(): string {
  const file = path.join(compiledSkillRefsDir(), ...prHostRel(OP).split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${prHostRel(OP)} is absent — run \`npm run build\` first (this suite reads the built reference)`)
  }
}

/**
 * The steps of the reference: everything from its `### Process` heading on. The contract block ahead
 * of it carries a fenced Output template, and the backtick-span scans below pair backticks across
 * the whole text they are given, so a fence in front of the steps would shift every pairing after it.
 */
function mechanicsOf(reference: string): string {
  const at = reference.indexOf('\n### Process')
  if (at === -1) throw new Error(`${prHostRel(OP)} has no ### Process heading — the contract block is not followed by steps`)
  return reference.slice(at + 1)
}

/** The op's own section — 'sole': its one reference is the contract authority [DR-18]. */
function contractSection(): string {
  return extractOpSectionFromCorpus(gitOperationReferenceCorpus(), OP, { mode: 'sole' }).content
}

// ---------------------------------------------------------------------------
// 1. The EVIDENCE template ↔ EVIDENCE_LINE_RE
// ---------------------------------------------------------------------------

/** Placeholder words whose meaning is the script's: compiled from the regex's own group. */
const OPEN_PLACEHOLDERS: ReadonlySet<string> = new Set(['n', 'sha', 'ids', 'kinds', 'hex'])

/** Escape a literal for a RegExp source. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** The named capture groups of a RegExp source, in source order. */
function namedGroups(source: string): string[] {
  return [...source.matchAll(/\(\?<([A-Za-z][A-Za-z0-9]*)>/g)].map(m => m[1])
}

/** The source of one named group, without the group itself. Bounded by the source length. */
function namedGroupSource(source: string, group: string): string {
  const open = `(?<${group}>`
  const start = source.indexOf(open)
  if (start === -1) throw new Error(`no (?<${group}>…) group`)
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
  throw new Error(`(?<${group}>…) is unbalanced`)
}

/** Named collector: the one `EVIDENCE …` code span the mechanics parse, or null when not exactly one. */
export function collectEvidenceTemplate(prBody: string): string | null {
  const spans = [...prBody.matchAll(/`(EVIDENCE [^`]+)`/g)].map(m => m[1])
  return spans.length === 1 ? spans[0] : null
}

/**
 * Compile the template to a RegExp. The i-th `<…>` placeholder is the regex's i-th
 * named group — order, not a hand-kept name map, so a reordered or dropped field
 * disagrees. A placeholder naming an open word (`<n>`, `<sha>`, `<ids|none>` …) takes
 * that group's own source; a closed one (`<yes|no|unchecked>`) compiles to its
 * listed values, so a value the template drops or invents disagrees.
 */
export function compileEvidenceTemplate(template: string, re: RegExp): RegExp {
  const groups = namedGroups(re.source)
  let out = ''
  let slot = 0
  for (let i = 0; i < template.length;) {
    if (template[i] === '<') {
      const close = template.indexOf('>', i)
      if (close === -1) throw new Error('template: unclosed <')
      const body = template.slice(i + 1, close)
      const group = groups[slot]
      if (group === undefined) throw new Error(`template: placeholder ${slot + 1} has no group in the regex`)
      out += body.split('|').some(word => OPEN_PLACEHOLDERS.has(word))
        ? `(?:${namedGroupSource(re.source, group)})`
        : `(?:${body.split('|').map(escapeRe).join('|')})`
      slot++
      i = close + 1
      continue
    }
    out += escapeRe(template[i])
    i++
  }
  if (slot !== groups.length) throw new Error(`template: ${slot} placeholders for ${groups.length} groups`)
  return new RegExp(`^${out}$`)
}

const HEAD = '0123456789abcdef0123456789abcdef01234567'

function line(over: Partial<EvidenceFields> = {}): string {
  const fields: EvidenceFields = {
    pr: 7,
    head: HEAD,
    total: 3,
    counts: { 'VERIFIED-CI': 1, 'ATTESTED-LOCAL': 1, UNVERIFIED: 0, STALE: 1, FAILED: 0, INDETERMINATE: 0 },
    stale: [2],
    exceptions: [],
    approval: 'unchecked',
    key: '0123456789ab',
    posted: 'no',
    body: 'changed',
    ...over,
  }
  const r = PE.formatEvidenceLine(fields)
  if (!r.ok) throw new Error(`formatEvidenceLine refused ${JSON.stringify(fields)}`)
  return r.value
}

/** The differential table: lines the script prints, and hostile near-misses. */
function differentialTable(): string[] {
  const zero = { 'VERIFIED-CI': 0, 'ATTESTED-LOCAL': 0, UNVERIFIED: 0, STALE: 0, FAILED: 0, INDETERMINATE: 0 }
  const rows: string[] = [
    line({ total: 0, counts: zero, stale: [] }),
    line({ pr: 1_234_567_890 }),
    line({ total: 200, counts: { ...zero, STALE: 200 }, stale: Array.from({ length: 200 }, (_, i) => i + 1) }),
    line({ total: 100, counts: { ...zero, 'VERIFIED-CI': 99, FAILED: 1 }, stale: [] }),
  ]
  for (const approval of ['yes', 'no', 'unchecked']) {
    for (const posted of ['yes', 'no', 'n/a']) {
      for (const body of ['same', 'changed']) {
        for (const exceptions of [[], ['ticket-link'], ['test-plan'], ['ticket-link', 'test-plan']]) {
          rows.push(line({ approval, posted, body, exceptions }))
        }
      }
    }
  }
  const ok = line()
  rows.push(
    ok.replace('approval:unchecked', 'approval:maybe'),
    ok.replace('posted:no', 'posted:na'),
    ok.replace('body:changed', 'body:SAME'),
    ok.replace('exceptions:none', 'exceptions:test-plan,ticket-link'),
    ok.replace('exceptions:none', 'exceptions:ticket-links'),
    ok.replace(`head:${HEAD}`, `head:${HEAD.slice(1)}`),
    ok.replace(`head:${HEAD}`, `head:${HEAD.toUpperCase()}`),
    ok.replace('key:0123456789ab', 'key:0123456789a'),
    ok.replace('pr:7', 'pr:0'),
    ok.replace('pr:7', 'pr:07'),
    ok.replace('total:3', 'total:201'),
    ok.replace('stale:TP-2', 'stale:TP-0'),
    ok.replace('stale:TP-2', 'stale:TP-2,'),
    ok.replace('stale:TP-2', 'stale:2'),
    ok.replace(' FAILED:0 ', ' '),
    ok.replace('STALE:1 FAILED:0', 'FAILED:0 STALE:1'),
    ok.replace('EVIDENCE ', 'EVIDENCE  '),
    ok.replace('EVIDENCE', 'evidence'),
    ` ${ok}`,
    `${ok} `,
    `${ok}\tx`,
    ok.replace(' body:changed', ''),
    '',
  )
  return rows
}

/** Named collector: the table rows on which the compiled template and the script's regex disagree. */
export function collectTemplateDisagreements(candidate: RegExp, rows: readonly string[]): string[] {
  return rows
    .filter(row => candidate.test(row) !== PE.EVIDENCE_LINE_RE.test(row))
    .map(row => `${JSON.stringify(row.slice(0, 120))}: template ${candidate.test(row) ? 'accepts' : 'rejects'}, EVIDENCE_LINE_RE ${PE.EVIDENCE_LINE_RE.test(row) ? 'accepts' : 'rejects'}`)
}

describe('AC-6: the EVIDENCE template accepts and rejects exactly what EVIDENCE_LINE_RE does', () => {
  const prBody = requirePrBody()

  it('the mechanics carry exactly one EVIDENCE template, and the table is two-sided', () => {
    expect(collectEvidenceTemplate(prBody), 'exactly one `EVIDENCE …` span').not.toBeNull()
    const rows = differentialTable()
    const accepted = rows.filter(r => PE.EVIDENCE_LINE_RE.test(r))
    expect(accepted.length, 'too few accepted rows').toBeGreaterThanOrEqual(70)
    expect(rows.length - accepted.length, 'too few hostile rows').toBeGreaterThanOrEqual(20)
  })

  it('over the differential table', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    expect(collectTemplateDisagreements(compileEvidenceTemplate(template, PE.EVIDENCE_LINE_RE), differentialTable())).toEqual([])
  })

  it('known-bad probe: a template that drops `unchecked` disagrees', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    const seeded = template.replace('<yes|no|unchecked>', '<yes|no>')
    expect(seeded, 'the seed must land').not.toBe(template)
    expect(collectTemplateDisagreements(compileEvidenceTemplate(seeded, PE.EVIDENCE_LINE_RE), differentialTable()).length).toBeGreaterThan(0)
  })

  it('known-bad probe: a template with two fields swapped disagrees', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    const seeded = template.replace('STALE:<n> FAILED:<n>', 'FAILED:<n> STALE:<n>')
    expect(seeded, 'the seed must land').not.toBe(template)
    expect(collectTemplateDisagreements(compileEvidenceTemplate(seeded, PE.EVIDENCE_LINE_RE), differentialTable()).length).toBeGreaterThan(0)
  })

  it('known-bad probe: a template that drops a field cannot even be compiled against the regex', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    expect(() => compileEvidenceTemplate(template.replace(' body:<same|changed>', ''), PE.EVIDENCE_LINE_RE)).toThrow(/placeholders for/)
  })
})


// ---------------------------------------------------------------------------
// 2. The mechanics point at the script, and never restate it (#455)
// ---------------------------------------------------------------------------

/** Only what this suite reads from verify-evidence.cjs. */
interface PartLike {
  readonly status: string
  readonly reason: string | null
}
interface VerifyApi {
  readonly BODY_STATUSES: readonly string[]
  readonly COMMENT_STATUSES: readonly string[]
  main(argv: readonly string[], deps?: object): { code: number; stdout: string }
  settleOutcome(outcome: unknown): { code: number; stdout: string }
  parsePublishBlock(text: string): { evidenceLine: string; body: PartLike; comment: PartLike } | null
  renderPublishBlock(evidenceLine: string, body: PartLike, comment: PartLike): string
}

const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as VerifyApi

/**
 * Every backticked span that INVOKES `cmd` — with an argument after it. A bare
 * mention is prose, not a call.
 */
function spansInvoking(text: string, cmd: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(span => span.includes(`${cmd} `))
}

/** Text the script owns, which the mechanics must never spell (a second grammar authority). */
function restatedGrammar(): string[] {
  const markers = Object.values(PE.MARKERS).filter((v): v is string => typeof v === 'string')
  return ['<!-- devflow:', '<!-- /devflow:', ...markers, ' — method:', ' out:', 'status:self-attested']
}

/**
 * What the mechanics must say, each with the wording that carries it. The script does
 * the work, so the reference is the pointer plus the rules a reader of the run needs.
 */
const REQUIRED_RULES: ReadonlyArray<readonly [label: string, text: string]> = [
  ['stdout-only', "Print the script's stdout and nothing else"],
  ['exit-2 line', 'On exit 2 it is `TRACEABILITY: DEGRADED (evidence unavailable)`'],
  ['failed run', 'Any other exit, or empty stdout, is a failed run'],
  ['evidence-file path gate', 'only a value matching `^[A-Za-z0-9._/-]{1,255}$` reaches the shell'],
  ['bash timeout', 'Set the Bash `timeout` to 180000'],
  ['unscrubbed never posted', 'a body the script cannot scrub is never posted'],
  ['concurrent-edit reason', '`DEGRADED (concurrent edit)`'],
  ['read-back reason', '`DEGRADED (body read-back mismatch)`'],
]

/** What gh, the scrubber and the work files are called in: none of it belongs in the reference. */
const SCRIPT_OWNED_LITERALS: readonly string[] = [
  'gh pr edit', 'gh pr comment', 'gh pr view', 'gh repo view', '--body-file', 'redact-secrets', '$DEVFLOW_', 'mktemp',
  'splice --pr', 'readback --pr', 'verify --pr',
]

/** Named collector: every way the mechanics stop pointing at the script or take a step back from it. */
export function collectMechanicsDefects(prBody: string): string[] {
  const out: string[] = []
  const runs = spansInvoking(prBody, 'verify-evidence.cjs"')
  if (runs.length !== 1 || !runs[0].includes('publish --pr {PR_NUMBER}')) {
    out.push(`expected exactly one \`verify-evidence.cjs" publish --pr {PR_NUMBER}\` run, found ${runs.length}`)
  }
  for (const text of SCRIPT_OWNED_LITERALS) {
    if (prBody.includes(text)) out.push(`names ${JSON.stringify(text)} — the script owns it`)
  }
  for (const text of restatedGrammar()) {
    if (prBody.includes(text)) out.push(`restates script-owned text ${JSON.stringify(text)}`)
  }
  for (const text of ['publication-gate.md', '`full` → ']) {
    if (prBody.includes(text)) out.push(`decides publication itself (${text}) — the script decides the comment's form`)
  }
  for (const [label, text] of REQUIRED_RULES) {
    if (!prBody.includes(text)) out.push(`does not state the ${label} rule`)
  }
  return out
}

describe('AC-6: the mechanics point at the script and restate nothing', () => {
  const reference = requirePrBody()
  const prBody = mechanicsOf(reference)

  it('the reference is the built one, opening with its own anchor, and holds its steps', () => {
    expect(reference.startsWith(`## Operation: ${OP}\n`)).toBe(true)
    expect(spansInvoking(prBody, 'verify-evidence.cjs"').length, 'the publish run').toBe(1)
    expect(prBody.length, 'the Process block is empty').toBeGreaterThan(500)
  })

  it('names the run, the stdout rule and the DEGRADED forms, and nothing the script owns', () => {
    expect(collectMechanicsDefects(prBody)).toEqual([])
  })

  it('known-bad probe: a gh call, a body file and a scrubber chain put back are each reported', () => {
    const seeded = `${prBody}\nThen \`gh pr edit {PR_NUMBER} --body-file "$DEVFLOW_BODY"\` after \`node redact-secrets.cjs a b\`.\n`
    expect(collectMechanicsDefects(seeded)).toEqual([
      'names "gh pr edit" — the script owns it',
      'names "--body-file" — the script owns it',
      'names "redact-secrets" — the script owns it',
      'names "$DEVFLOW_" — the script owns it',
    ])
  })

  it('known-bad probe: a second run, a dropped stdout rule and an ungated evidence path are reported', () => {
    const twice = `${prBody}\nThen run \`node "$HOME/.devflow/scripts/verify-evidence.cjs" publish --pr {PR_NUMBER}\` again.\n`
    expect(collectMechanicsDefects(twice)).toEqual(['expected exactly one `verify-evidence.cjs" publish --pr {PR_NUMBER}` run, found 2'])
    const quiet = prBody.replace("Print the script's stdout and nothing else", 'Print what you like')
    expect(quiet, 'the seed must land').not.toBe(prBody)
    expect(collectMechanicsDefects(quiet)).toEqual(['does not state the stdout-only rule'])
    const ungated = prBody.replace(' — only a value matching `^[A-Za-z0-9._/-]{1,255}$` reaches the shell', '')
    expect(ungated, 'the seed must land').not.toBe(prBody)
    expect(collectMechanicsDefects(ungated)).toEqual(['does not state the evidence-file path gate rule'])
  })

  it('known-bad probe: a marker literal, a verify run of its own and a visibility probe are each reported', () => {
    const block = String(PE.MARKERS.BLOCK_START)
    const seeded = `${prBody}\nFind ${block} with \`node verify-evidence.cjs verify --pr 7\`, then \`gh repo view --json visibility\`.\n`
    expect(collectMechanicsDefects(seeded)).toEqual([
      'names "gh repo view" — the script owns it',
      'names "verify --pr" — the script owns it',
      'restates script-owned text "<!-- devflow:"',
      `restates script-owned text ${JSON.stringify(block)}`,
    ])
  })
})

// ---------------------------------------------------------------------------
// 3. The contract in the reference, and its statuses ↔ the script's vocabulary
// ---------------------------------------------------------------------------

const INPUT_LINE =
  '**Input:** `PR_NUMBER`, `REVIEW_PUBLICATION`, `EVIDENCE_FILE` (optional), `WORKTREE_PATH` (optional)'

/** The status tokens an Output line enumerates after `**<label>**:`, DEGRADED excluded. */
function outputStatuses(section: string, label: string): string[] {
  const m = new RegExp(`\\*\\*${label}\\*\\*: ([^·\\n]+)`).exec(section)
  if (m === null) return []
  return m[1].split('|').map(s => s.trim()).filter(s => s !== '' && !s.startsWith('DEGRADED'))
}

/**
 * Named collector: contract lines missing from the reference, and Output statuses the
 * script never prints (or prints and the contract never lists). The script's
 * vocabulary is the authority; the contract is held to it both ways.
 */
export function collectContractDefects(section: string): string[] {
  const out: string[] = []
  const inputs = section.split('\n').filter(l => l.startsWith('**Input:**'))
  if (inputs.length !== 1 || inputs[0] !== INPUT_LINE) out.push(`Input line is not ${JSON.stringify(INPUT_LINE)}`)
  if (!section.includes('**Degradation (D4):**')) out.push('no **Degradation (D4):** clause in the contract block')
  if (!section.includes('{the script\'s EVIDENCE line}')) out.push('Output does not return the script\'s EVIDENCE line')
  const vocabulary: ReadonlyArray<readonly [string, readonly string[]]> = [['Body', VE.BODY_STATUSES], ['Comment', VE.COMMENT_STATUSES]]
  for (const [label, printed] of vocabulary) {
    const listed = outputStatuses(section, label)
    if (listed.length === 0) out.push(`Output has no **${label}** statuses`)
    for (const status of printed) if (!listed.includes(status)) out.push(`**${label}**: the script prints ${status}, the contract does not list it`)
    for (const status of listed) if (!printed.includes(status)) out.push(`**${label}**: ${status} is listed but the script never prints it`)
  }
  return out
}

describe('AC-5: the contract opens the reference, and its statuses are the script\'s', () => {
  const section = contractSection()

  it('the section is the op\'s own, and names neither the publication gate nor a visibility probe', () => {
    expect(section.startsWith(`## Operation: ${OP}\n`)).toBe(true)
    expect(section).not.toContain('publication-gate.md')
    expect(section).not.toContain('gh repo view')
    expect(section, 'PR_EXCEPTIONS reaches the op through the evidence file, never as an input').not.toContain('PR_EXCEPTIONS')
  })

  it('carries its contract lines, and its Output statuses are exactly the script\'s', () => {
    expect(VE.BODY_STATUSES.length, 'the script prints no body status').toBeGreaterThan(0)
    expect(collectContractDefects(section)).toEqual([])
  })

  it('known-bad probe: an Input the design keeps out, a status nothing prints and a status the contract lacks are reported', () => {
    const seeded = section
      .replace(INPUT_LINE, `${INPUT_LINE}, \`PR_EXCEPTIONS\``)
      .replace('POSTED | SKIPPED | OFF', 'POSTED | OFF | QUEUED')
    expect(collectContractDefects(seeded)).toEqual([
      `Input line is not ${JSON.stringify(INPUT_LINE)}`,
      '**Comment**: the script prints SKIPPED, the contract does not list it',
      '**Comment**: QUEUED is listed but the script never prints it',
    ])
  })
})

// ---------------------------------------------------------------------------
// 4. The script, run for real under a gh fake (AC-203)
// ---------------------------------------------------------------------------

/** Each test spawns node a dozen times (the script, the scrubber, the gh fake): generous under a loaded full-suite run. */
const SPAWN_BUDGET = { timeout: 120_000 } as const
const EM = '—'
/** A string the scrubber must remove: an AWS access key shape. */
const SECRET = 'AKIAIOSFODNN7EXAMPLE'

const tpLine = (n: number, scenario: string): string => `- [ ] TP-${n} (AC-1) ${scenario} ${EM} method:manual`
const evidenceFile = (tps: readonly string[]): string => `# Evidence\n\n## Test Plan\n${tps.join('\n')}\n\n## Claims\n`

interface RunOptions {
  readonly scenario?: ShimScenario
  readonly redact?: Redact
  readonly tps?: readonly string[]
  readonly args?: readonly string[]
  /** Rewrites the script's source before it runs (a known-bad probe). */
  readonly mutate?: (source: string) => string
}

afterAll(cleanShimRoots)

/** Lay out one scenario and run `publish` once (or `runs` times over the same fake PR). */
function runPublish(options: RunOptions = {}, runs = 1): ScriptRun[] {
  return runScript({
    scenario: options.scenario,
    redact: options.redact,
    mutate: options.mutate,
    args: options.args ?? ['publish', '--pr', String(SHIM_PR), '--evidence', 'evidence.md'],
    files: { 'evidence.md': evidenceFile(options.tps ?? [tpLine(1, 'Logs in with a valid password'), tpLine(2, 'Rejects a wrong password')]) },
  }, runs)
}

/** The one run of a scenario. */
function runOnce(options: RunOptions = {}): ScriptRun {
  return runPublish(options, 1)[0]
}

const verbs = (calls: readonly ShimCall[]): string[] => calls.map(c => c.args.slice(0, 2).join(' '))
const STATUS_RE = /^\*\*Body\*\*: (.+) · \*\*Comment\*\*: (.+)$/m

describe('AC-203: publish prints the exact block, scrubs before it posts, and writes only behind a good scrub', () => {
  it('1. a plan with nothing posted yet: the block is edited in, read back, and the comment is posted', SPAWN_BUDGET, () => {
    const r = runOnce()
    expect(r.code, r.stderr).toBe(0)
    const block = VE.parsePublishBlock(r.stdout)
    expect(block, r.stdout).not.toBeNull()
    expect(block?.body.status).toBe('EDITED')
    expect(block?.comment.status).toBe('POSTED')
    expect(r.stdout.split('\n')[0]).toBe('## PR Evidence')
    expect(r.stdout.split('\n')[1]).toMatch(/^EVIDENCE pr:7 head:c{40} total:2 /)
    expect(r.stdout, 'no TRACEABILITY line on a clean run').not.toContain('TRACEABILITY')
    expect(verbs(r.writes)).toEqual(['pr edit', 'pr comment'])
    // The PR's own text survives the splice; the block sits beside it.
    expect(r.pr.body).toContain('Adds the thing.')
    expect(r.pr.body).toContain('TP-1')
    expect(r.pr.comments).toHaveLength(1)
    expect(r.pr.comments[0].body).toContain(`head:${SHIM_HEAD}`)
  })

  it('2. a second run over the same PR changes and posts nothing (body:same, posted:yes)', SPAWN_BUDGET, () => {
    const [first, second] = runPublish({}, 2)
    expect(first.writes).toHaveLength(2)
    expect(second.code, second.stderr).toBe(0)
    const block = VE.parsePublishBlock(second.stdout)
    expect(block?.body.status).toBe('UNCHANGED')
    expect(block?.comment.status).toBe('SKIPPED')
    expect(second.writes, 'an unchanged PR gets no gh write').toEqual([])
    expect(second.stdout).toContain(' posted:yes body:same')
  })

  it('3. a secret in the plan reaches neither the PR body nor the comment (D11)', SPAWN_BUDGET, () => {
    const r = runOnce({ tps: [tpLine(1, `Rotates the key ${SECRET} on login`)] })
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parsePublishBlock(r.stdout)?.body.status).toBe('EDITED')
    expect(r.writes).toHaveLength(2)
    for (const w of r.writes) expect(w.file ?? '', verbs([w])[0]).not.toContain(SECRET)
    expect(r.pr.body).not.toContain(SECRET)
    expect(r.pr.comments[0].body).not.toContain(SECRET)
    expect(r.writes.every(w => (w.file ?? '').length > 0), 'a write with an empty file proves nothing').toBe(true)
  })

  it('4. publication off posts no comment and says OFF', SPAWN_BUDGET, () => {
    const r = runOnce({ args: ['publish', '--pr', '7', '--evidence', 'evidence.md', '--publication', 'off'] })
    expect(r.code, r.stderr).toBe(0)
    const block = VE.parsePublishBlock(r.stdout)
    expect(block?.body.status).toBe('EDITED')
    expect(block?.comment.status).toBe('OFF')
    expect(verbs(r.writes)).toEqual(['pr edit'])
  })

  it('5. a body edited under the run is a concurrent edit: SKIPPED, no edit, a TRACEABILITY line, the comment still posts', SPAWN_BUDGET, () => {
    const original = 'Adds the thing.\n\n## Summary\nA summary.\n'
    const r = runOnce({ scenario: { body: original, bodies: [original, `${original}\nEdited once.\n`, `${original}\nEdited twice.\n`] } })
    expect(r.code, r.stderr).toBe(0)
    const block = VE.parsePublishBlock(r.stdout)
    expect(block?.body.status).toBe('SKIPPED')
    expect(block?.comment.status).toBe('POSTED')
    expect(r.stdout).toContain('TRACEABILITY: DEGRADED (concurrent edit)')
    expect(verbs(r.writes), 'no gh pr edit after a conflict').toEqual(['pr comment'])
  })

  it('6. a scrubber that exits 1: no gh write at all, both halves DEGRADED (redaction unavailable)', SPAWN_BUDGET, () => {
    const r = runOnce({ redact: 'fails' })
    expect(r.code, r.stderr).toBe(0)
    const block = VE.parsePublishBlock(r.stdout)
    expect(block?.body).toEqual({ status: 'DEGRADED', reason: 'redaction unavailable' })
    expect(block?.comment).toEqual({ status: 'DEGRADED', reason: 'redaction unavailable' })
    expect(r.writes, 'gh never runs after a failed redact').toEqual([])
    expect(r.stdout.match(/TRACEABILITY: DEGRADED \(redaction unavailable\)/g)).toHaveLength(1)
    expect(r.pr.body, 'the PR is untouched').toBe('Adds the thing.\n\n## Summary\nA summary.\n')
    expect(r.pr.comments).toEqual([])
  })

  it('7. a scrubber that is not there is the same: no gh write', SPAWN_BUDGET, () => {
    const r = runOnce({ redact: 'missing' })
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parsePublishBlock(r.stdout)?.body.reason).toBe('redaction unavailable')
    expect(r.writes).toEqual([])
  })

  it('8. one 5xx on the body edit is retried once and then succeeds', SPAWN_BUDGET, () => {
    const r = runOnce({ scenario: { failures: [{ match: ['pr', 'edit'], times: 1, stderr: 'gh: Bad Gateway (HTTP 502)\n' }] } })
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parsePublishBlock(r.stdout)?.body.status).toBe('EDITED')
    expect(verbs(r.calls.filter(c => c.args[1] === 'edit'))).toEqual(['pr edit', 'pr edit'])
  })

  it('9. two 5xx on the body edit stop at two calls: DEGRADED, and the comment is still tried', SPAWN_BUDGET, () => {
    const r = runOnce({ scenario: { failures: [{ match: ['pr', 'edit'], times: 5, stderr: 'gh: Bad Gateway (HTTP 502)\n' }] } })
    expect(r.code, r.stderr).toBe(0)
    const block = VE.parsePublishBlock(r.stdout)
    expect(block?.body).toEqual({ status: 'DEGRADED', reason: '5xx on update-pr-evidence' })
    expect(block?.comment.status).toBe('POSTED')
    expect(r.calls.filter(c => c.args[1] === 'edit')).toHaveLength(2)
    expect(r.stdout).toContain('TRACEABILITY: DEGRADED (5xx on update-pr-evidence)')
  })

  it('10. a body that does not read back as written is DEGRADED (body read-back mismatch)', SPAWN_BUDGET, () => {
    const r = runOnce({ scenario: { editStores: 'Somebody else rewrote the body.\n' } })
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parsePublishBlock(r.stdout)?.body).toEqual({ status: 'DEGRADED', reason: 'body read-back mismatch' })
    expect(r.stdout).toContain('TRACEABILITY: DEGRADED (body read-back mismatch)')
  })

  it('11. two 5xx on the comment stop at two calls: DEGRADED, the body stays EDITED', SPAWN_BUDGET, () => {
    const r = runOnce({ scenario: { failures: [{ match: ['pr', 'comment'], times: 5, stderr: 'gh: Service Unavailable (HTTP 503)\n' }] } })
    expect(r.code, r.stderr).toBe(0)
    const block = VE.parsePublishBlock(r.stdout)
    expect(block?.body.status).toBe('EDITED')
    expect(block?.comment).toEqual({ status: 'DEGRADED', reason: '5xx on update-pr-evidence' })
    expect(r.calls.filter(c => c.args[1] === 'comment')).toHaveLength(2)
  })

  it('12. a 4xx is not retried', SPAWN_BUDGET, () => {
    const r = runOnce({ scenario: { failures: [{ match: ['pr', 'comment'], times: 5, stderr: 'gh: Forbidden (HTTP 403)\n' }] } })
    expect(VE.parsePublishBlock(r.stdout)?.comment).toEqual({ status: 'DEGRADED', reason: 'gh pr comment failed' })
    expect(r.calls.filter(c => c.args[1] === 'comment')).toHaveLength(1)
  })

  it('13. a PR gh cannot read: exit 2, the one DEGRADED line, no write', SPAWN_BUDGET, () => {
    const r = runOnce({ scenario: { noPr: true } })
    expect(r.code).toBe(2)
    expect(r.stdout).toBe('TRACEABILITY: DEGRADED (evidence unavailable)\n')
    expect(r.writes).toEqual([])
  })

  it('14. a bad flag is a usage error: exit 1, stdout empty, gh never called', SPAWN_BUDGET, () => {
    for (const args of [
      ['publish', '--pr', '7', '--publication', 'bogus'],
      ['publish', '--pr', '07'],
      ['publish', '--pr', '7', '--evidence', 'a b.md'],
      ['publish', '--pr', '7', '--evidence', '$(id).md'],
      ['publish'],
    ]) {
      const r = runOnce({ args })
      expect(r.code, args.join(' ')).toBe(1)
      expect(r.stdout, args.join(' ')).toBe('')
      expect(r.calls, args.join(' ')).toEqual([])
    }
  })

  it('15. every run bounds its gh writes and cleans its work directory', SPAWN_BUDGET, () => {
    const worst = runOnce({
      scenario: {
        failures: [
          { match: ['pr', 'edit'], times: 9, stderr: 'gh: Bad Gateway (HTTP 502)\n' },
          { match: ['pr', 'comment'], times: 9, stderr: 'gh: Bad Gateway (HTTP 502)\n' },
        ],
      },
    })
    const afterVerify = worst.calls.slice(1)
    expect(afterVerify.length, 'the writes stage makes at most 8 gh calls').toBeLessThanOrEqual(8)
    expect(afterVerify.length, 'the worst case still exercises the stage').toBeGreaterThanOrEqual(5)
    for (const r of [worst, runOnce(), runOnce({ redact: 'fails' }), runOnce({ scenario: { noPr: true } })]) {
      expect(r.leftovers, 'the private work directory is removed').toEqual([])
    }
  })

  it('16. a scrubber that wrote its output and then failed is still not posted from; cut the gates and it is', SPAWN_BUDGET, () => {
    const held = runOnce({ redact: 'half' })
    expect(held.code, held.stderr).toBe(0)
    expect(held.writes, 'the output file exists, but the exit code decides').toEqual([])
    expect(VE.parsePublishBlock(held.stdout)?.comment.reason).toBe('redaction unavailable')

    const bodyGate = "if (!scrub(io, files.notesRaw, files.notes)) return degradedPart('redaction unavailable');"
    const commentGate = "if (!scrub(io, files.commentRaw, files.comment)) return degradedPart('redaction unavailable');"
    const cut = runOnce({
      redact: 'half',
      mutate: source => {
        expect(source, 'both gate lines must exist to be cut').toContain(bodyGate)
        expect(source).toContain(commentGate)
        // The call stays and only its exit-code gate goes: the scrubber's output file exists, as it does after a real crash.
        return source
          .replace(bodyGate, 'scrub(io, files.notesRaw, files.notes);')
          .replace(commentGate, 'scrub(io, files.commentRaw, files.comment);')
      },
    })
    expect(verbs(cut.writes), 'with the gates cut the half-scrubbed files ARE posted: the guard above can go red').toEqual(['pr edit', 'pr comment'])
  })
})

describe('the boundary prints a publish block only when it parses back to itself (D-OP-BLOCK-GATE)', () => {
  const evidenceLine = PE.formatEvidenceLine({
    pr: 7, head: SHIM_HEAD, total: 1,
    counts: { 'VERIFIED-CI': 0, 'ATTESTED-LOCAL': 0, UNVERIFIED: 1, STALE: 0, FAILED: 0, INDETERMINATE: 0 },
    stale: [], exceptions: [], approval: 'unchecked', key: '0123456789ab', posted: 'no', body: 'changed',
  })
  const good = VE.renderPublishBlock(
    evidenceLine.ok ? evidenceLine.value : '',
    { status: 'EDITED', reason: null },
    { status: 'POSTED', reason: null },
  )

  it('accepts a rendered block and refuses a tampered one', () => {
    expect(evidenceLine.ok).toBe(true)
    expect(VE.settleOutcome({ code: 0, stdout: good })).toEqual({ code: 0, stdout: good })
    const refused = { code: 4, stdout: '' }
    for (const bad of [
      good.replace('EDITED', 'edited'),
      good.replace('## PR Evidence', '## PR evidence'),
      `${good}extra line\n`,
      `${good}TRACEABILITY: DEGRADED (made up)\n`,
      good.replace('**Body**:', '**Body** :'),
      good.replace('\n**Body**', '\n\n**Body**'),
      good.slice(0, -1),
    ]) {
      expect(VE.settleOutcome({ code: 0, stdout: bad }), JSON.stringify(bad)).toEqual(refused)
    }
    expect(VE.settleOutcome({ code: 2, stdout: good }), 'a block with exit 2').toEqual(refused)
    expect(VE.settleOutcome({ code: 0, stdout: 'TRACEABILITY: DEGRADED (evidence unavailable)\n' }), 'the degraded line with exit 0').toEqual(refused)
    expect(VE.settleOutcome({ code: 2, stdout: 'TRACEABILITY: DEGRADED (evidence unavailable)\n' })).toEqual({ code: 2, stdout: 'TRACEABILITY: DEGRADED (evidence unavailable)\n' })
  })

  it('a degraded half earns its TRACEABILITY line, and only that line', () => {
    const degraded = VE.renderPublishBlock(
      evidenceLine.ok ? evidenceLine.value : '',
      { status: 'SKIPPED', reason: null },
      { status: 'DEGRADED', reason: 'redaction unavailable' },
    )
    expect(degraded.split('\n').slice(3)).toEqual([
      'TRACEABILITY: DEGRADED (concurrent edit)',
      'TRACEABILITY: DEGRADED (redaction unavailable)',
      '',
    ])
    expect(VE.parsePublishBlock(degraded)).not.toBeNull()
    expect(VE.parsePublishBlock(degraded.replace('(concurrent edit)', '(something else)'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. Source order: no gh write is reachable before the scrub that gates it
// ---------------------------------------------------------------------------

/** Named collector: the gh write calls in the script that are not preceded, in their function, by a scrub. */
export function collectUngatedWrites(source: string): string[] {
  const out: string[] = []
  const fns = [...source.matchAll(/^function (\w+)\([^)]*\) \{\n([\s\S]*?)\n\}\n/gm)]
  for (const m of fns) {
    const body = m[2]
    const write = /ghWrite\(io, \['pr', '(edit|comment)'/.exec(body)
    if (write === null) continue
    const scrub = body.indexOf('scrub(io,')
    if (scrub === -1 || scrub > write.index) out.push(`${m[1]}: gh pr ${write[1]} without a scrub before it`)
  }
  return out
}

describe('the script\'s source: each gh write follows its scrub', () => {
  const source = fs.readFileSync(VERIFY_EVIDENCE_SCRIPT, 'utf-8')

  it('publishBody and publishComment scrub before they write', () => {
    expect(source.match(/ghWrite\(io, \['pr', '(?:edit|comment)'/g), 'the corpus must hold both writes').toHaveLength(2)
    expect(collectUngatedWrites(source)).toEqual([])
  })

  it('known-bad probe: a write with the scrub moved after it is reported', () => {
    const seeded = source.replace(
      "  if (!scrub(io, files.commentRaw, files.comment)) return degradedPart('redaction unavailable');\n", '')
    expect(seeded, 'the seed must land').not.toBe(source)
    expect(collectUngatedWrites(seeded)).toEqual(['publishComment: gh pr comment without a scrub before it'])
  })

  it('the ci-wait script is the one the readiness classifier shares', () => {
    expect(fs.existsSync(CI_WAIT_SCRIPT)).toBe(true)
    expect(source).toContain("require(path.join(__dirname, 'ci-wait.cjs'))")
  })
})
