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
 *         `--body-file`, no scrubber chain, no marker and no copy of the `EVIDENCE`
 *         line grammar.
 *   AC-203 the script itself, run for real under a `gh` fake on PATH: it prints the
 *         exact `## PR Evidence` block (the `Test plan:` line included) in every
 *         scenario, prints the one evidence unavailable line when it cannot, scrubs
 *         before it posts, and makes no gh write after a failed scrub (the check that
 *         used to be a shell chain in the reference now lives here, where it can be
 *         executed).
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe. Every reader reads BUILT artifacts.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import { readFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { extractOpSectionFromCorpus, gitOperationReferenceCorpus, prHostRel } from '../helpers.js'
import { cleanShimRoots, COMMENT_URL, ENABLED_MANIFEST, machineManifest, runScript, SHIM_HEAD, SHIM_PR, warmGhShim, type Redact, type ScriptDirs, type ScriptRun, type ShimCall, type ShimComment, type ShimScenario } from './pr-shim.js'
import { PR_EVIDENCE_SCRIPT, VERIFY_EVIDENCE_SCRIPT, CI_WAIT_SCRIPT, SUBPROCESS_TIMEOUT_MS, TOP_LEVEL_FUNCTION_RE, functionBodyOf, markerLine } from './seam.js'

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
// 1. The mechanics point at the script, and never restate it (#455)
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
  settleOutcome(outcome: unknown, publish?: boolean): { code: number; stdout: string }
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
  ['empty-stdout line', 'If the script did not run or printed nothing, emit `TRACEABILITY: DEGRADED (evidence unavailable)`'],
  ['evidence-file path gate', 'only a value matching `^[A-Za-z0-9._/-]{1,255}$` reaches the shell'],
  ['bash timeout', 'Set the Bash `timeout` to 180000'],
  ['unscrubbed never posted', 'a body the script cannot scrub is never posted'],
]

/** Text of the block the script prints: its `EVIDENCE` line, its `Test plan:` line and its `Body` / `Comment` line. The mechanics spell none of it. */
const SCRIPT_PRINTED_LITERALS: readonly string[] = ['`EVIDENCE ', 'INDETERMINATE:', 'ATTESTED-LOCAL', 'Test plan:', '**Body**:', '**Comment**:']

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
  for (const text of SCRIPT_PRINTED_LITERALS) {
    if (prBody.includes(text)) out.push(`restates the block the script prints (${JSON.stringify(text)})`)
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

  it('known-bad probe: the EVIDENCE line, the Test plan line and the Body line put back are each reported', () => {
    const seeded = `${prBody}\nIt prints \`EVIDENCE pr:<n> head:<sha>\`, then Test plan: 1/2 verified, then **Body**: EDITED.\n`
    expect(collectMechanicsDefects(seeded)).toEqual(
      ['`EVIDENCE ', 'Test plan:', '**Body**:'].map(text => `restates the block the script prints (${JSON.stringify(text)})`),
    )
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
// 2. The contract in the reference, and its statuses ↔ the script's vocabulary
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

  it('the comment statuses are POSTED, SKIPPED, OFF and EDITED, and the contract line lists them in that order', () => {
    expect(VE.COMMENT_STATUSES).toEqual(['POSTED', 'SKIPPED', 'OFF', 'EDITED'])
    expect(section).toContain('**Comment**: POSTED | SKIPPED | OFF | EDITED | DEGRADED ({reason})')
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
// 3. The script, run for real under a gh fake (AC-203)
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
  /** More files in the working directory, beside `evidence.md`. */
  readonly files?: Readonly<Record<string, string>>
  /** The machine manifest of the run: its text, `null` for none; absent holds compliance enabled. */
  readonly manifest?: string | null
  readonly setup?: (dirs: ScriptDirs) => Readonly<Record<string, string>> | void
}

beforeAll(warmGhShim, SUBPROCESS_TIMEOUT_MS)
afterAll(cleanShimRoots)

/** Lay out one scenario and run `publish` once (or `runs` times over the same fake PR). */
function runPublish(options: RunOptions = {}, runs = 1): ScriptRun[] {
  return runScript({
    scenario: options.scenario,
    redact: options.redact,
    mutate: options.mutate,
    manifest: options.manifest,
    setup: options.setup,
    args: options.args ?? ['publish', '--pr', String(SHIM_PR), '--evidence', 'evidence.md'],
    files: {
      ...options.files,
      'evidence.md': evidenceFile(options.tps ?? [tpLine(1, 'Logs in with a valid password'), tpLine(2, 'Rejects a wrong password')]),
    },
  }, runs)
}

/** The one run of a scenario. */
function runOnce(options: RunOptions = {}): ScriptRun {
  return runPublish(options, 1)[0]
}

/** The one line a `publish` that could not give its block prints, with its newline. */
const UNAVAILABLE_LINE = 'TRACEABILITY: DEGRADED (evidence unavailable)\n'

const verbs = (calls: readonly ShimCall[]): string[] => calls.map(c => c.args.slice(0, 2).join(' '))
const STATUS_RE = /^\*\*Body\*\*: (.+) · \*\*Comment\*\*: (.+)$/m

const MARKER_OPEN = String(PE.MARKERS.EVIDENCE_OPEN)
const STRICT_MARKER = PE.MARKERS.EVIDENCE_RE as RegExp
const H1 = 'a'.repeat(40)
const H2 = 'd'.repeat(40)
const [KEY_A, KEY_B, KEY_C] = ['a', 'b', 'c'].map(ch => ch.repeat(12))
/** A comment of the viewer (the login the fake posts as). */
const ownComment = (body: string, over: Partial<ShimComment> = {}): ShimComment =>
  ({ author: { login: 'devflow-bot' }, authorAssociation: 'OWNER', body, viewerDidAuthor: true, ...over })
/** A comment of another login. The association is NONE, so the script makes no permission lookup for it. */
const foreignComment = (body: string, over: Partial<ShimComment> = {}): ShimComment =>
  ({ author: { login: 'mallory' }, authorAssociation: 'NONE', body, viewerDidAuthor: false, ...over })
/** An evidence comment of the viewer, at the shim's head unless `head` is given, with a key the current plan never has. */
const olderOwn = (head = SHIM_HEAD, key = KEY_A): ShimComment => ownComment(`${markerLine(head, key)}\nOlder evidence text.\n`)

const patchCalls = (calls: readonly ShimCall[]): ShimCall[] => calls.filter(c => c.args[0] === 'api' && c.args[1] === '--method')
const readBackCalls = (calls: readonly ShimCall[]): ShimCall[] => calls.filter(c => c.args[0] === 'api' && c.args.includes('.body | @json'))
const commentPart = (r: ScriptRun): PartLike | undefined => VE.parsePublishBlock(r.stdout)?.comment
const commentBodies = (r: ScriptRun): string[] => r.pr.comments.map(c => c.body)
const firstLineOf = (text: string): string => text.split('\n')[0]
const PATCH_PATH = (id: string): string => `repos/{owner}/{repo}/issues/comments/${id}`

const BODY_GATE = "if (!scrub(io, files.notesRaw, files.notes)) return degradedPart('redaction unavailable');"
const COMMENT_GATE = "if (!scrub(io, files.commentRaw, files.comment)) return degradedPart('redaction unavailable');"

/**
 * A known-bad probe for the run: both scrub gates cut. The call stays and only its exit-code gate goes,
 * so the scrubber's output file exists, as it does after a real crash.
 */
function cutGates(source: string): string {
  expect(source, 'both gate lines must exist to be cut').toContain(BODY_GATE)
  expect(source).toContain(COMMENT_GATE)
  return source
    .replace(BODY_GATE, 'scrub(io, files.notesRaw, files.notes);')
    .replace(COMMENT_GATE, 'scrub(io, files.commentRaw, files.comment);')
}

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
    expect(r.stdout.split('\n')[2], 'two unverified test plan lines, no claim').toBe('Test plan: 0/2 verified (VERIFIED-CI 0, ATTESTED-LOCAL 0)')
    expect(r.stdout.split('\n')[3]).toMatch(STATUS_RE)
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

    const own = olderOwn()
    const withOwn = runOnce({ scenario: { comments: [own] }, args: ['publish', '--pr', '7', '--evidence', 'evidence.md', '--publication', 'off'] })
    expect(commentPart(withOwn)?.status, withOwn.stdout).toBe('OFF')
    expect(verbs(withOwn.writes), 'off writes no comment, edit or post').toEqual(['pr edit'])
    expect(commentBodies(withOwn)).toEqual([own.body])
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

    const own = olderOwn()
    const edit = runOnce({ redact: 'fails', scenario: { comments: [own] } })
    expect(commentPart(edit)).toEqual({ status: 'DEGRADED', reason: 'redaction unavailable' })
    expect(edit.writes, 'no edit after a failed scrub either').toEqual([])
    expect(commentBodies(edit)).toEqual([own.body])
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

  it('14. a bad flag is a usage error: exit 2, the one unavailable line, usage on stderr, gh never called', SPAWN_BUDGET, () => {
    for (const args of [
      ['publish', '--pr', '7', '--publication', 'bogus'],
      ['publish', '--pr', '07'],
      ['publish', '--pr', '7', '--evidence', 'a b.md'],
      ['publish', '--pr', '7', '--evidence', '$(id).md'],
      ['publish'],
    ]) {
      const r = runOnce({ args })
      expect(r.code, args.join(' ')).toBe(2)
      expect(r.stdout, args.join(' ')).toBe(UNAVAILABLE_LINE)
      expect(r.stderr, args.join(' ')).toContain('Usage:')
      expect(r.calls, args.join(' ')).toEqual([])
    }
  })

  it('14b. another subcommand keeps its usage exit: exit 1, stdout empty', SPAWN_BUDGET, () => {
    for (const args of [['verify'], ['readiness', '--pr', '07'], ['bogus']]) {
      const r = runOnce({ args })
      expect(r.code, args.join(' ')).toBe(1)
      expect(r.stdout, args.join(' ')).toBe('')
    }
  })

  it('14c. an error thrown outside the handler in main: a publish still prints the unavailable line, another subcommand prints nothing', SPAWN_BUDGET, () => {
    const seeded = (source: string): string => {
      const at = 'const parsed = parseArgs(argv);'
      expect(source, 'the seed must land').toContain(at)
      return source.replace(at, `throw new Error('seeded'); ${at}`)
    }
    const publish = runOnce({ mutate: seeded })
    expect(publish.code, publish.stderr).toBe(2)
    expect(publish.stdout).toBe(UNAVAILABLE_LINE)
    expect(publish.stderr).toContain('internal error (Error)')
    expect(publish.calls, 'the seed throws before any gh call').toEqual([])

    const other = runOnce({ mutate: seeded, args: ['verify', '--pr', String(SHIM_PR)] })
    expect(other.code, other.stderr).toBe(4)
    expect(other.stdout).toBe('')
  })

  it('14d. a block the output gate refuses: the run prints the unavailable line with exit 2', SPAWN_BUDGET, () => {
    const seeded = (source: string): string => {
      const at = "'**Body**: ' + partText(body)"
      expect(source, 'the seed must land').toContain(at)
      return source.replace(at, "'**Body** ' + partText(body)")
    }
    const r = runOnce({ mutate: seeded })
    expect(r.code, r.stderr).toBe(2)
    expect(r.stdout).toBe(UNAVAILABLE_LINE)
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

    const cut = runOnce({ redact: 'half', mutate: cutGates })
    expect(verbs(cut.writes), 'with the gates cut the half-scrubbed files ARE posted: the guard above can go red').toEqual(['pr edit', 'pr comment'])
  })

  it('16b. the same with an evidence comment of the viewer: a half-scrubbed comment is not edited in; cut the gates and it is', SPAWN_BUDGET, () => {
    const own = olderOwn()
    const held = runOnce({ redact: 'half', scenario: { comments: [own] } })
    expect(held.code, held.stderr).toBe(0)
    expect(held.writes, 'the output file exists, but the exit code decides').toEqual([])
    expect(commentPart(held)?.reason).toBe('redaction unavailable')
    expect(commentBodies(held)).toEqual([own.body])

    const cut = runOnce({ redact: 'half', scenario: { comments: [own] }, mutate: cutGates })
    expect(verbs(cut.writes), 'with the gates cut the half-scrubbed comment IS edited in: the guard above can go red').toEqual(['pr edit', 'api --method'])
  })
})

// ---------------------------------------------------------------------------
// 4b. The viewer's own evidence comment is edited in place, never doubled
// ---------------------------------------------------------------------------

/** The marker a publish of the default plan prints at the shim's head — learned from one run, then kept. */
let learnedMarker: string | undefined
function currentMarker(): string {
  learnedMarker ??= firstLineOf(runOnce().pr.comments[0].body)
  return learnedMarker
}

describe('the viewer\'s own evidence comment is edited in place, never doubled', () => {
  it('17. a second head edits the one comment (same id, no new post); the same head again writes nothing', SPAWN_BUDGET, () => {
    const [first, second, third] = runPublish({ scenario: { heads: [H1, H2, H2] } }, 3)
    expect(commentPart(first)).toEqual({ status: 'POSTED', reason: null })
    expect(first.pr.comments).toHaveLength(1)
    const url = first.pr.comments[0].url ?? ''
    expect(url).toMatch(/#issuecomment-1001$/)
    expect(firstLineOf(first.pr.comments[0].body)).toContain(`head:${H1}`)

    expect(second.code, second.stderr).toBe(0)
    expect(commentPart(second)).toEqual({ status: 'EDITED', reason: null })
    expect(second.stdout, 'a clean edit prints no TRACEABILITY line').not.toContain('TRACEABILITY')
    expect(second.writes.filter(w => w.args[0] === 'pr' && w.args[1] === 'comment'), 'no new post').toEqual([])
    const patches = patchCalls(second.calls)
    expect(patches).toHaveLength(1)
    expect(patches[0].args.slice(0, 5)).toEqual(['api', '--method', 'PATCH', PATCH_PATH('1001'), '-F'])
    expect(patches[0].args[5]).toMatch(/^body=@.+/)
    expect(patches[0].args.slice(6)).toEqual(['--silent'])
    expect(readBackCalls(second.calls), 'one read of the edited comment').toHaveLength(1)
    expect(second.pr.comments).toHaveLength(1)
    expect(second.pr.comments[0].url).toBe(url)
    expect(firstLineOf(second.pr.comments[0].body)).toContain(`head:${H2}`)

    expect(third.code, third.stderr).toBe(0)
    expect(commentPart(third)).toEqual({ status: 'SKIPPED', reason: null })
    expect(third.writes, 'the same head and key again').toEqual([])
    expect(third.stdout).toContain(' posted:yes ')
  })

  it('18. of two own matches the newest is edited; the older one and a newer lookalike of another login stay byte for byte', SPAWN_BUDGET, () => {
    const older = olderOwn(H1, KEY_A)
    const newest = olderOwn(H1, KEY_B)
    const lookalike = foreignComment(`${MARKER_OPEN} head:\nA lookalike with no key.\n`)
    expect(STRICT_MARKER.test(firstLineOf(lookalike.body)), 'the lookalike is not a strict marker').toBe(false)
    const r = runOnce({ scenario: { comments: [older, newest, lookalike] } })
    expect(r.code, r.stderr).toBe(0)
    expect(commentPart(r)).toEqual({ status: 'EDITED', reason: null })
    expect(patchCalls(r.calls).map(c => c.args[3])).toEqual([PATCH_PATH('1002')])
    expect(verbs(r.writes), 'one body edit, one comment edit, no post').toEqual(['pr edit', 'api --method'])
    const bodies = commentBodies(r)
    expect(bodies).toHaveLength(3)
    expect(bodies[0]).toBe(older.body)
    expect(bodies[2]).toBe(lookalike.body)
    expect(firstLineOf(bodies[1])).toContain(`head:${SHIM_HEAD}`)
    expect(JSON.stringify(r.calls), 'nothing is deleted').not.toContain('DELETE')
  })

  it('19. a strict marker of another login after the own comment, or with none of the viewer\'s: a new comment is posted and the others stay', SPAWN_BUDGET, () => {
    const own = olderOwn(H1, KEY_A)
    const theirs = foreignComment(`${markerLine(H1, KEY_B)}\nTheir evidence text.\n`)
    expect(STRICT_MARKER.test(firstLineOf(theirs.body)), 'theirs is a strict marker').toBe(true)

    const after = runOnce({ scenario: { comments: [own, theirs] } })
    expect(commentPart(after)).toEqual({ status: 'POSTED', reason: null })
    expect(verbs(after.writes)).toEqual(['pr edit', 'pr comment'])
    expect(patchCalls(after.calls)).toEqual([])
    expect(commentBodies(after).slice(0, 2)).toEqual([own.body, theirs.body])
    expect(after.pr.comments).toHaveLength(3)
    expect(firstLineOf(after.pr.comments[2].body)).toContain(`head:${SHIM_HEAD}`)

    const alone = runOnce({ scenario: { comments: [theirs] } })
    expect(commentPart(alone)).toEqual({ status: 'POSTED', reason: null })
    expect(patchCalls(alone.calls)).toEqual([])
    expect(alone.pr.comments).toHaveLength(2)
    expect(commentBodies(alone)[0]).toBe(theirs.body)
  })

  it('20. a changed key at the same head edits the newer own comment, an older exact match stays, and a 20-digit id reaches the path whole', SPAWN_BUDGET, () => {
    const exact = ownComment(`${currentMarker()}\nAn earlier copy of this exact evidence.\n`)
    const bigId = '12345678901234567890'
    const newer = { ...olderOwn(SHIM_HEAD, KEY_C), url: `${COMMENT_URL}${bigId}` }
    const r = runOnce({ scenario: { comments: [exact, newer] } })
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout, 'the newer comment is not this evidence, so it is not skipped').toContain(' posted:no ')
    expect(commentPart(r)).toEqual({ status: 'EDITED', reason: null })
    expect(patchCalls(r.calls).map(c => c.args[3])).toEqual([PATCH_PATH(bigId)])
    expect(commentBodies(r)[0]).toBe(exact.body)
    expect(firstLineOf(commentBodies(r)[1])).toBe(currentMarker())
    expect(r.pr.comments[1].url).toBe(newer.url)
  })

  it('21. a malformed own comment (the prefix alone) is repaired by the edit', SPAWN_BUDGET, () => {
    const broken = ownComment(`${MARKER_OPEN} head:oops\nHalf a marker.\n`)
    const r = runOnce({ scenario: { comments: [broken] } })
    expect(commentPart(r)).toEqual({ status: 'EDITED', reason: null })
    expect(r.pr.comments).toHaveLength(1)
    expect(STRICT_MARKER.test(firstLineOf(r.pr.comments[0].body)), 'the first line is a marker now').toBe(true)
    expect(patchCalls(r.calls).map(c => c.args[3])).toEqual([PATCH_PATH('1001')])
  })

  it('22. an own comment whose url holds no id is DEGRADED (comment id unreadable): no edit, no post', SPAWN_BUDGET, () => {
    const own = { ...olderOwn(), url: '' }
    const r = runOnce({ scenario: { comments: [own] } })
    expect(r.code, r.stderr).toBe(0)
    expect(commentPart(r)).toEqual({ status: 'DEGRADED', reason: 'comment id unreadable' })
    expect(r.stdout).toContain('TRACEABILITY: DEGRADED (comment id unreadable)')
    expect(verbs(r.writes), 'the body is still written; the comment is not').toEqual(['pr edit'])
    expect(commentBodies(r)).toEqual([own.body])
  })

  it('22b. the same own comment behind a strict marker of another login is no edit target: a new comment is posted, nothing degrades', SPAWN_BUDGET, () => {
    const own = { ...olderOwn(H1, KEY_A), url: '' }
    const theirs = foreignComment(`${markerLine(H1, KEY_B)}\nTheir evidence text.\n`)
    const r = runOnce({ scenario: { comments: [own, theirs] } })
    expect(r.code, r.stderr).toBe(0)
    expect(commentPart(r)).toEqual({ status: 'POSTED', reason: null })
    expect(r.stdout).not.toContain('comment id unreadable')
    expect(patchCalls(r.calls)).toEqual([])
    expect(verbs(r.writes)).toEqual(['pr edit', 'pr comment'])
    expect(commentBodies(r).slice(0, 2)).toEqual([own.body, theirs.body])
  })

  it('23. a comment that does not read back as written, or cannot be read, is DEGRADED (comment read-back mismatch), never EDITED', SPAWN_BUDGET, () => {
    const mismatch = runOnce({ scenario: { comments: [olderOwn()], commentEditStores: 'Somebody else rewrote the comment.\n' } })
    expect(commentPart(mismatch)).toEqual({ status: 'DEGRADED', reason: 'comment read-back mismatch' })
    expect(mismatch.stdout).toContain('TRACEABILITY: DEGRADED (comment read-back mismatch)')
    expect(verbs(mismatch.writes), 'no fallback post').toEqual(['pr edit', 'api --method'])

    const unreadable = runOnce({
      scenario: {
        comments: [olderOwn()],
        failures: [{ match: ['api', PATCH_PATH('1001')], times: 5, stderr: 'gh: Bad Gateway (HTTP 502)\n' }],
      },
    })
    expect(commentPart(unreadable)).toEqual({ status: 'DEGRADED', reason: 'comment read-back mismatch' })
    expect(readBackCalls(unreadable.calls), 'the read is tried once').toHaveLength(1)
    expect(verbs(unreadable.writes)).toEqual(['pr edit', 'api --method'])
  })

  it('23b. a stored comment that lost its one trailing newline still reads back equal: EDITED', SPAWN_BUDGET, () => {
    const r = runOnce({ scenario: { comments: [olderOwn()], commentEditTrimsNewline: true } })
    expect(r.code, r.stderr).toBe(0)
    expect(commentPart(r), r.stdout).toEqual({ status: 'EDITED', reason: null })
    expect(r.stdout).not.toContain('TRACEABILITY')
    const sent = patchCalls(r.calls)[0].file ?? ''
    expect(sent, 'the file sent ends in a newline').toMatch(/\n$/)
    expect(r.pr.comments[0].body, 'the fake stored it without that newline').toBe(sent.slice(0, -1))
    expect(readBackCalls(r.calls)).toHaveLength(1)
    expect(verbs(r.writes)).toEqual(['pr edit', 'api --method'])
  })

  it('23c. a read-back answer that is not JSON, or JSON but not a string, is DEGRADED (comment read-back mismatch): never EDITED, no fallback post', SPAWN_BUDGET, () => {
    for (const answer of ['this is not json\n', '', '42\n', 'null\n', '["a body"]\n', '{"body":"a body"}\n']) {
      const label = JSON.stringify(answer)
      const r = runOnce({ scenario: { comments: [olderOwn()], commentReadBack: answer } })
      expect(commentPart(r), label).toEqual({ status: 'DEGRADED', reason: 'comment read-back mismatch' })
      expect(r.stdout, label).toContain('TRACEABILITY: DEGRADED (comment read-back mismatch)')
      expect(readBackCalls(r.calls), label).toHaveLength(1)
      expect(verbs(r.writes), `${label}: no fallback post`).toEqual(['pr edit', 'api --method'])
      expect(commentBodies(r), label).toHaveLength(1)
    }
  })

  it('24. a 4xx on the edit is not retried: DEGRADED (comment edit failed), no read-back, no post', SPAWN_BUDGET, () => {
    for (const stderr of ['gh: Forbidden (HTTP 403)\n', 'gh: Not Found (HTTP 404)\n']) {
      const r = runOnce({ scenario: { comments: [olderOwn()], failures: [{ match: ['api', '--method', 'PATCH'], times: 5, stderr }] } })
      expect(commentPart(r), stderr).toEqual({ status: 'DEGRADED', reason: 'comment edit failed' })
      expect(patchCalls(r.calls), stderr).toHaveLength(1)
      expect(readBackCalls(r.calls), stderr).toEqual([])
      expect(verbs(r.writes), stderr).toEqual(['pr edit', 'api --method'])
    }
  })

  it('25. two 5xx on the edit stop at two calls: DEGRADED (5xx on update-pr-evidence), no read-back', SPAWN_BUDGET, () => {
    const r = runOnce({
      scenario: { comments: [olderOwn()], failures: [{ match: ['api', '--method', 'PATCH'], times: 9, stderr: 'gh: Bad Gateway (HTTP 502)\n' }] },
    })
    expect(commentPart(r)).toEqual({ status: 'DEGRADED', reason: '5xx on update-pr-evidence' })
    expect(patchCalls(r.calls)).toHaveLength(2)
    expect(readBackCalls(r.calls)).toEqual([])
    expect(r.stdout).toContain('TRACEABILITY: DEGRADED (5xx on update-pr-evidence)')
  })

  it('26. body and comment both retried once use exactly eight write-stage gh calls', SPAWN_BUDGET, () => {
    const base = 'Adds the thing.\n\n## Summary\nA summary.\n'
    const other = `${base}\nEdited once.\n`
    const r = runOnce({
      scenario: {
        body: base,
        // verify reads the first; the splice reads the second, finds the body moved, and reads again.
        bodies: [base, other, other],
        comments: [olderOwn()],
        failures: [
          { match: ['pr', 'edit'], times: 1, stderr: 'gh: Bad Gateway (HTTP 502)\n' },
          { match: ['api', '--method', 'PATCH'], times: 1, stderr: 'gh: Bad Gateway (HTTP 502)\n' },
        ],
      },
    })
    expect(r.code, r.stderr).toBe(0)
    const block = VE.parsePublishBlock(r.stdout)
    expect(block?.body.status, r.stdout).toBe('EDITED')
    expect(block?.comment.status, r.stdout).toBe('EDITED')
    const stage = r.calls.slice(1)
    expect(stage, 'two body reads, two edits, one body read-back, two comment edits, one comment read-back').toHaveLength(8)
    const firstEdit = stage.findIndex(c => c.args[0] === 'pr' && c.args[1] === 'edit')
    const readsBefore = stage.slice(0, firstEdit)
    expect(readsBefore.map(c => c.args.slice(0, 2).join(' '))).toEqual(['pr view', 'pr view'])
    for (const c of readsBefore) expect(c.args[c.args.indexOf('--json') + 1]).toBe('body')
    expect(stage.filter(c => c.args[0] === 'pr' && c.args[1] === 'edit')).toHaveLength(2)
    expect(patchCalls(stage)).toHaveLength(2)
    expect(readBackCalls(stage)).toHaveLength(1)
  })

  it('27. the edit runs silent: with the flag cut, the answer overflows the write buffer and the edit reads as failed', SPAWN_BUDGET, () => {
    const silent = ", '--silent']"
    const r = runOnce({
      scenario: { comments: [olderOwn()] },
      mutate: source => {
        expect(source.split(silent), 'the flag must appear once to be cut').toHaveLength(2)
        return source.replace(silent, ']')
      },
    })
    expect(firstLineOf(r.pr.comments[0].body), 'the fake did store the edit').toContain(`head:${SHIM_HEAD}`)
    expect(commentPart(r)).toEqual({ status: 'DEGRADED', reason: 'comment edit failed' })
    expect(patchCalls(r.calls)).toHaveLength(1)
  })

  it('28. full publication edits the comment to carry the scenario table, and a comment over 4,096 bytes reads back equal', SPAWN_BUDGET, () => {
    const tps = Array.from({ length: 100 }, (_, i) => tpLine(i + 1, `Scenario ${i + 1} of the plan`))
    const r = runOnce({
      tps,
      scenario: { comments: [olderOwn()] },
      args: ['publish', '--pr', '7', '--evidence', 'evidence.md', '--publication', 'full'],
    })
    expect(r.code, r.stderr).toBe(0)
    expect(commentPart(r), r.stdout).toEqual({ status: 'EDITED', reason: null })
    expect(r.stdout).not.toContain('TRACEABILITY')
    const text = r.pr.comments[0].body
    expect(text).toContain('| TP |')
    expect(Buffer.byteLength(text), 'larger than the line buffer the writes use').toBeGreaterThan(4096)
    expect(readBackCalls(r.calls)).toHaveLength(1)
  })

  it('28b. a secret in the scenario table reaches neither the comment edit nor the stored comment (D11)', SPAWN_BUDGET, () => {
    const r = runOnce({
      tps: [tpLine(1, `Rotates the key ${SECRET} on login`)],
      scenario: { comments: [olderOwn()] },
      args: ['publish', '--pr', '7', '--evidence', 'evidence.md', '--publication', 'full'],
    })
    expect(r.code, r.stderr).toBe(0)
    expect(commentPart(r), r.stdout).toEqual({ status: 'EDITED', reason: null })
    expect(r.stdout).toContain('**Comment**: EDITED')
    const patches = patchCalls(r.calls)
    expect(patches).toHaveLength(1)
    expect(patches[0].file ?? '', 'an empty file proves nothing').not.toBe('')
    expect(patches[0].file).not.toContain(SECRET)
    const stored = r.pr.comments[0].body
    expect(stored).toContain('| TP |')
    expect(stored).not.toContain(SECRET)
    expect(r.pr.comments, 'the edit is in place, no second comment').toHaveLength(1)
  })

  it('29. a comment that redaction grows past the cap is not edited in', SPAWN_BUDGET, () => {
    const own = olderOwn()
    const r = runOnce({ redact: 'grow', scenario: { comments: [own] } })
    expect(commentPart(r)).toEqual({ status: 'DEGRADED', reason: 'comment over size cap' })
    expect(r.stdout).toContain('TRACEABILITY: DEGRADED (comment over size cap)')
    expect(patchCalls(r.calls)).toEqual([])
    expect(commentBodies(r)).toEqual([own.body])
  })
})

// ---------------------------------------------------------------------------
// 4. The publish guard: the machine manifest decides, before any gh call
// ---------------------------------------------------------------------------

const OFF_LINE = 'TRACEABILITY: DEGRADED (compliance off)'
const UNREADABLE_LINE = 'TRACEABILITY: DEGRADED (compliance state unreadable)'
const COMPLIANCE_OFF_MANIFEST = machineManifest({ enabled: false, frameworks: [] })
/** The environment variables that could name another devflow directory for the guard to read. */
const ELSEWHERE_ENV_NAMES = ['DEVFLOW_DIR', 'DEVFLOW_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME'] as const

/** The run ended at the guard: the one line, exit 2, and no gh call, no gh write, no work directory. */
function expectRefused(r: ScriptRun, line: string): void {
  expect(r.stdout).toBe(`${line}\n`)
  expect(r.code, r.stderr).toBe(2)
  expect(r.calls, 'no gh call').toEqual([])
  expect(r.writes).toEqual([])
  expect(r.leftovers, 'no work directory made').toEqual([])
}

/** The run went on as it always did: the block, and the gh calls behind it. */
function expectPublished(r: ScriptRun): void {
  expect(r.code, r.stderr).toBe(0)
  expect(r.stdout.startsWith('## PR Evidence\n'), r.stdout).toBe(true)
  expect(verbs(r.calls), 'the PR was read').toContain('pr view')
}

describe('publish refuses before any gh call unless the machine manifest says compliance is enabled (AC-51..AC-53)', () => {
  it('TP-69. a manifest with compliance off prints the off line, exits 2 and makes no gh call', SPAWN_BUDGET, () => {
    expectRefused(runOnce({ manifest: COMPLIANCE_OFF_MANIFEST }), OFF_LINE)
  })

  it('TP-69. a manifest that records no compliance state at all reads as off', SPAWN_BUDGET, () => {
    expectRefused(runOnce({ manifest: JSON.stringify({ version: '0.0.0', plugins: [], features: { memory: true } }) }), OFF_LINE)
  })

  it('TP-69. the off answer names its reason on stderr, and the same run with compliance on does not', SPAWN_BUDGET, () => {
    expect(runOnce({ manifest: COMPLIANCE_OFF_MANIFEST }).stderr).toContain('compliance is off')
    expect(runOnce().stderr).not.toContain('compliance is off')
  })

  it('TP-70. a repository that claims compliance does not turn a machine with compliance off into one that publishes', SPAWN_BUDGET, () => {
    const on = { features: { compliance: { enabled: true, frameworks: ['gdpr'] } } }
    const r = runOnce({
      manifest: COMPLIANCE_OFF_MANIFEST,
      files: {
        '.devflow/project.json': JSON.stringify({ version: 1, compliance: ['gdpr'], ...on }),
        '.devflow/config.json': JSON.stringify(on),
        '.devflow/policy.json': JSON.stringify({ compliance: true }),
        '.devflow/manifest.json': ENABLED_MANIFEST,
        'manifest.json': ENABLED_MANIFEST,
      },
    })
    expectRefused(r, OFF_LINE)
  })

  it('TP-70. a repository that claims compliance is off does not stop a machine with compliance on', SPAWN_BUDGET, () => {
    const off = { features: { compliance: { enabled: false, frameworks: [] } } }
    expectPublished(runOnce({
      files: {
        '.devflow/project.json': JSON.stringify({ version: 1, ...off }),
        '.devflow/config.json': JSON.stringify(off),
        '.devflow/manifest.json': COMPLIANCE_OFF_MANIFEST,
      },
    }))
  })

  /** A folder beside the run's HOME that holds `manifestText` at every path a devflow-directory override could mean. */
  const elsewhere = (manifestText: string) => (dirs: ScriptDirs): Record<string, string> => {
    const dir = path.join(dirs.root, 'elsewhere')
    fs.mkdirSync(path.join(dir, '.devflow'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), manifestText)
    fs.writeFileSync(path.join(dir, '.devflow', 'manifest.json'), manifestText)
    return Object.fromEntries(ELSEWHERE_ENV_NAMES.map(name => [name, dir]))
  }

  it('TP-70. a devflow-directory override in the environment that holds an enabled manifest is ignored', SPAWN_BUDGET, () => {
    expectRefused(runOnce({ manifest: COMPLIANCE_OFF_MANIFEST, setup: elsewhere(ENABLED_MANIFEST) }), OFF_LINE)
  })

  it('TP-70. a devflow-directory override in the environment that holds a manifest with compliance off is ignored', SPAWN_BUDGET, () => {
    expectPublished(runOnce({ setup: elsewhere(COMPLIANCE_OFF_MANIFEST) }))
  })

  const unreadable: ReadonlyArray<readonly [string, string | null]> = [
    ['no manifest', null],
    ['an empty file', ''],
    ['text that is not JSON', '{"features":'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['an object with no features', '{}'],
    ['features as an array', '{"features":[]}'],
    ['compliance as a string', machineManifest('yes')],
    ['compliance as an array', machineManifest([])],
    ['compliance as null', machineManifest(null)],
    ['enabled as a string', machineManifest({ enabled: 'true', frameworks: [] })],
    ['no enabled key', machineManifest({ frameworks: [] })],
    ['enabled true and no frameworks', machineManifest({ enabled: true })],
    ['enabled true and frameworks that are not strings', machineManifest({ enabled: true, frameworks: [1] })],
    ['a file over the size bound', JSON.stringify({ pad: 'x'.repeat(4 * 1024 * 1024 + 1) })],
  ]

  it.each(unreadable)('TP-71. %s prints the unreadable line, exits 2 and writes nothing', SPAWN_BUDGET, (_label, manifest) => {
    expectRefused(runOnce({ manifest }), UNREADABLE_LINE)
  })

  it('TP-71. a manifest that is not UTF-8 is unreadable', SPAWN_BUDGET, () => {
    expectRefused(runOnce({ manifest: null, setup: dirs => { fs.writeFileSync(dirs.manifestPath, Buffer.from([0x7b, 0xff, 0xfe, 0x7d])) } }), UNREADABLE_LINE)
  })

  it('TP-71. a directory, a link to a directory and a dangling link in the manifest\'s place are unreadable', SPAWN_BUDGET, () => {
    const inPlace: ReadonlyArray<(dirs: ScriptDirs) => void> = [
      dirs => { fs.mkdirSync(dirs.manifestPath) },
      dirs => { fs.symlinkSync(dirs.home, dirs.manifestPath) },
      dirs => { fs.symlinkSync(path.join(dirs.home, 'absent.json'), dirs.manifestPath) },
    ]
    for (const place of inPlace) expectRefused(runOnce({ manifest: null, setup: dirs => { place(dirs) } }), UNREADABLE_LINE)
  })

  it('TP-71. a HOME that is not absolute reads no manifest, not even one the working directory holds at that path', SPAWN_BUDGET, () => {
    const r = runOnce({
      manifest: null,
      files: { 'relative-home/.devflow/manifest.json': ENABLED_MANIFEST },
      setup: () => ({ HOME: 'relative-home' }),
    })
    expectRefused(r, UNREADABLE_LINE)
  })

  it('TP-72. a manifest with compliance enabled leaves publish as it was', SPAWN_BUDGET, () => {
    expectPublished(runOnce({ manifest: machineManifest({ enabled: true, frameworks: ['gdpr', 'hipaa'] }) }))
  })

  it('TP-72. the manifest is followed through a link, as the machine manifest is everywhere else', SPAWN_BUDGET, () => {
    expectPublished(runOnce({
      manifest: null,
      setup: dirs => {
        const real = path.join(dirs.home, 'real-manifest.json')
        fs.writeFileSync(real, ENABLED_MANIFEST)
        fs.symlinkSync(real, dirs.manifestPath)
      },
    }))
  })

  describe('main takes the manifest path as a dependency (MainDeps)', () => {
    const made: string[] = []
    afterAll(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

    /** Run `publish` in this process with an exec that throws, and count how often it was reached. */
    function publishWith(manifestText: string | null): { code: number; stdout: string; execCalls: number; stderr: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-guard-'))
      made.push(dir)
      const manifestPath = path.join(dir, 'manifest.json')
      if (manifestText !== null) fs.writeFileSync(manifestPath, manifestText)
      let execCalls = 0
      let stderr = ''
      const out = VE.main(['node', 'verify-evidence.cjs', 'publish', '--pr', '7'], {
        manifestPath,
        cwd: dir,
        exec: () => { execCalls++; throw new Error('exec must not run') },
        stderr: (text: string) => { stderr += text },
      })
      return { ...out, execCalls, stderr }
    }

    it('answers off, and runs nothing, for a manifest with compliance off', () => {
      expect(publishWith(COMPLIANCE_OFF_MANIFEST)).toMatchObject({ code: 2, stdout: `${OFF_LINE}\n`, execCalls: 0 })
    })

    it('answers unreadable, and runs nothing, for a missing manifest', () => {
      expect(publishWith(null)).toMatchObject({ code: 2, stdout: `${UNREADABLE_LINE}\n`, execCalls: 0 })
    })

    it('goes on to the exec for an enabled manifest at the injected path, whatever HOME holds', () => {
      const r = publishWith(ENABLED_MANIFEST)
      expect(r.execCalls, 'the exec that throws was reached').toBeGreaterThan(0)
      expect(r).toMatchObject({ code: 2, stdout: 'TRACEABILITY: DEGRADED (evidence unavailable)\n' })
    })
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

  /** The EVIDENCE line of a plan with the given counts, none stale. */
  function evidenceLineFor(verifiedCi: number, attestedLocal: number, unverified: number): string {
    const r = PE.formatEvidenceLine({
      pr: 7, head: SHIM_HEAD, total: verifiedCi + attestedLocal + unverified,
      counts: { 'VERIFIED-CI': verifiedCi, 'ATTESTED-LOCAL': attestedLocal, UNVERIFIED: unverified, STALE: 0, FAILED: 0, INDETERMINATE: 0 },
      stale: [], exceptions: [], approval: 'unchecked', key: '0123456789ab', posted: 'no', body: 'changed',
    })
    if (!r.ok) throw new Error('formatEvidenceLine refused the fields')
    return r.value
  }

  const refused = { code: 4, stdout: '' }
  const unavailable = { code: 2, stdout: UNAVAILABLE_LINE }

  it('accepts a rendered block and refuses a tampered one, and a refused publish answer is the unavailable line', () => {
    expect(evidenceLine.ok).toBe(true)
    expect(VE.settleOutcome({ code: 0, stdout: good })).toEqual({ code: 0, stdout: good })
    expect(VE.settleOutcome({ code: 0, stdout: good }, true)).toEqual({ code: 0, stdout: good })
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
      expect(VE.settleOutcome({ code: 0, stdout: bad }, true), JSON.stringify(bad)).toEqual(unavailable)
    }
    expect(VE.settleOutcome({ code: 2, stdout: good }), 'a block with exit 2').toEqual(refused)
    expect(VE.settleOutcome({ code: 2, stdout: good }, true), 'a block with exit 2').toEqual(unavailable)
    expect(VE.settleOutcome({ code: 0, stdout: UNAVAILABLE_LINE }), 'the degraded line with exit 0').toEqual(refused)
    expect(VE.settleOutcome({ code: 0, stdout: UNAVAILABLE_LINE }, true)).toEqual(unavailable)
    expect(VE.settleOutcome(unavailable, true)).toEqual(unavailable)
  })

  it('settles no publish run to empty stdout: a usage exit, an empty answer and a malformed one each print the unavailable line', () => {
    for (const outcome of [{ code: 1, stdout: '' }, { code: 4, stdout: '' }, { code: 0, stdout: '' }, { code: 99, stdout: 'x\n' }, null, 'text']) {
      expect(VE.settleOutcome(outcome, true), JSON.stringify(outcome)).toEqual(unavailable)
    }
  })

  it('leaves every other subcommand as it was: a usage exit and a refused answer print nothing', () => {
    expect(VE.settleOutcome({ code: 1, stdout: '' })).toEqual({ code: 1, stdout: '' })
    expect(VE.settleOutcome({ code: 1, stdout: '' }, false)).toEqual({ code: 1, stdout: '' })
    expect(VE.settleOutcome({ code: 3, stdout: 'x\n' }, false)).toEqual(refused)
    expect(VE.settleOutcome(null, false)).toEqual(refused)
  })

  it('prints the Test plan line from the EVIDENCE line: the sum of the two verified counts over the total', () => {
    const cases: ReadonlyArray<readonly [verifiedCi: number, attestedLocal: number, unverified: number, tally: string]> = [
      [3, 2, 2, '5/7 verified (VERIFIED-CI 3, ATTESTED-LOCAL 2)'],
      [4, 0, 1, '4/5 verified (VERIFIED-CI 4, ATTESTED-LOCAL 0)'],
      [0, 6, 0, '6/6 verified (VERIFIED-CI 0, ATTESTED-LOCAL 6)'],
      [0, 0, 0, '0/0 verified (VERIFIED-CI 0, ATTESTED-LOCAL 0)'],
      [0, 0, 3, '0/3 verified (VERIFIED-CI 0, ATTESTED-LOCAL 0)'],
    ]
    for (const [verifiedCi, attestedLocal, unverified, tally] of cases) {
      const evidence = evidenceLineFor(verifiedCi, attestedLocal, unverified)
      const block = VE.renderPublishBlock(evidence, { status: 'EDITED', reason: null }, { status: 'POSTED', reason: null })
      expect(block.split('\n').slice(0, 4), tally).toEqual([
        '## PR Evidence',
        evidence,
        `Test plan: ${tally}`,
        '**Body**: EDITED · **Comment**: POSTED',
      ])
      expect(VE.settleOutcome({ code: 0, stdout: block }), tally).toEqual({ code: 0, stdout: block })
    }
  })

  it('reads a block back into exactly the parts it was rendered from, the Test plan line included', () => {
    const evidence = evidenceLineFor(3, 2, 2)
    const body = { status: 'SKIPPED', reason: null }
    const comment = { status: 'DEGRADED', reason: 'redaction unavailable' }
    const block = VE.renderPublishBlock(evidence, body, comment)
    const parsed = VE.parsePublishBlock(block)
    expect(parsed).toEqual({ evidenceLine: evidence, body, comment })
    expect(VE.renderPublishBlock(parsed?.evidenceLine ?? '', parsed?.body ?? body, parsed?.comment ?? comment)).toBe(block)
  })

  it('refuses a Test plan line that disagrees with the EVIDENCE line, or is missing, moved or reworded', () => {
    const evidence = evidenceLineFor(3, 2, 2)
    const block = VE.renderPublishBlock(evidence, { status: 'EDITED', reason: null }, { status: 'POSTED', reason: null })
    const plan = 'Test plan: 5/7 verified (VERIFIED-CI 3, ATTESTED-LOCAL 2)'
    expect(block, 'the seed line must be in the block').toContain(plan)
    const [heading, evidenceRow, , statusRow] = block.split('\n')
    for (const bad of [
      block.replace('5/7 verified', '7/7 verified'),
      block.replace('(VERIFIED-CI 3, ATTESTED-LOCAL 2)', '(VERIFIED-CI 2, ATTESTED-LOCAL 3)'),
      block.replace('(VERIFIED-CI 3,', '(VERIFIED-CI 4,'),
      block.replace('5/7 verified', '5/7'),
      block.replace('Test plan:', 'Test plan :'),
      block.replace(plan, `${plan} `),
      block.replace(`${plan}\n`, ''),
      `${heading}\n${evidenceRow}\n${statusRow}\n${plan}\n`,
      block.replace(plan, `${plan}\n${plan}`),
    ]) {
      expect(VE.parsePublishBlock(bad), JSON.stringify(bad)).toBeNull()
      expect(VE.settleOutcome({ code: 0, stdout: bad }), JSON.stringify(bad)).toEqual(refused)
      expect(VE.settleOutcome({ code: 0, stdout: bad }, true), JSON.stringify(bad)).toEqual(unavailable)
    }
  })

  it('refuses to render a block for an EVIDENCE line that does not parse', () => {
    expect(() => VE.renderPublishBlock('EVIDENCE nope', { status: 'EDITED', reason: null }, { status: 'POSTED', reason: null })).toThrow()
  })

  it.each([OFF_LINE, UNREADABLE_LINE])('TP-73. the gate admits "%s" only with exit 2', line => {
    const stdout = `${line}\n`
    expect(VE.settleOutcome({ code: 2, stdout })).toEqual({ code: 2, stdout })
    expect(VE.settleOutcome({ code: 1, stdout }), 'a usage exit prints nothing').toEqual({ code: 1, stdout: '' })
    for (const code of [0, 3, 4, 5, 9]) {
      expect(VE.settleOutcome({ code, stdout }), `exit ${code}`).toEqual({ code: 4, stdout: '' })
      expect(VE.settleOutcome({ code, stdout }, true), `exit ${code}, a publish run`).toEqual(unavailable)
    }
    expect(VE.settleOutcome({ code: 2, stdout: line }), 'without its newline').toEqual({ code: 4, stdout: '' })
    expect(VE.settleOutcome({ code: 2, stdout: `${line} \n` }), 'a changed line').toEqual({ code: 4, stdout: '' })
    expect(VE.settleOutcome({ code: 2, stdout: `${stdout}${stdout}` }), 'the line twice').toEqual({ code: 4, stdout: '' })
  })

  it('accepts EDITED and each comment DEGRADED reason the edit path prints', () => {
    const comments: PartLike[] = [
      { status: 'EDITED', reason: null },
      ...['comment id unreadable', 'comment edit failed', 'comment read-back mismatch', '5xx on update-pr-evidence']
        .map(reason => ({ status: 'DEGRADED', reason })),
    ]
    for (const comment of comments) {
      const block = VE.renderPublishBlock(evidenceLine.ok ? evidenceLine.value : '', { status: 'EDITED', reason: null }, comment)
      expect(VE.parsePublishBlock(block), block).not.toBeNull()
      expect(VE.settleOutcome({ code: 0, stdout: block }), block).toEqual({ code: 0, stdout: block })
    }
  })

  it('a degraded half earns its TRACEABILITY line, and only that line', () => {
    const degraded = VE.renderPublishBlock(
      evidenceLine.ok ? evidenceLine.value : '',
      { status: 'SKIPPED', reason: null },
      { status: 'DEGRADED', reason: 'redaction unavailable' },
    )
    expect(degraded.split('\n').slice(4)).toEqual([
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

/** Every gh write the script spells: `ghWrite(io, ['pr', 'edit' | 'comment' ...` and the comment edit's `['api', '--method' ...`. */
const GH_WRITE_RE = /ghWrite\(io, \['(pr|api)', '(edit|comment|--method)'/g

/** Named collector: each function that writes to gh, with its writes in source order (`pr edit`, `api --method`, `pr comment`). */
export function collectWritesByFunction(source: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const m of source.matchAll(TOP_LEVEL_FUNCTION_RE)) {
    const writes = [...m[2].matchAll(GH_WRITE_RE)].map(w => `${w[1]} ${w[2]}`)
    if (writes.length > 0) out[m[1]] = writes
  }
  return out
}

/** Named collector: the gh write calls in the script that are not preceded, in their function, by a scrub. */
export function collectUngatedWrites(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(TOP_LEVEL_FUNCTION_RE)) {
    const scrub = m[2].indexOf('scrub(io,')
    for (const write of m[2].matchAll(GH_WRITE_RE)) {
      if (scrub === -1 || scrub > (write.index ?? 0)) out.push(`${m[1]}: gh ${write[1]} ${write[2]} without a scrub before it`)
    }
  }
  return out
}

describe('the script\'s source: each gh write follows its scrub', () => {
  const source = fs.readFileSync(VERIFY_EVIDENCE_SCRIPT, 'utf-8')
  const POST_LINE = "  const post = ghWrite(io, ['pr', 'comment'"

  it('publishBody and publishComment scrub before they write', () => {
    expect(source.match(GH_WRITE_RE), 'the corpus must hold the three writes').toHaveLength(3)
    expect(source.match(/ghWrite\(io, \[/g), 'every ghWrite call is one the scan reads').toHaveLength(3)
    expect(collectUngatedWrites(source)).toEqual([])
  })

  it('publishBody holds the body edit; publishComment holds the comment edit and the comment post', () => {
    expect(collectWritesByFunction(source)).toEqual({
      publishBody: ['pr edit'],
      publishComment: ['api --method', 'pr comment'],
    })
  })

  it('the comment edit sits after the scrub gate and after the size-cap re-check', () => {
    const comment = functionBodyOf(source, 'publishComment')
    const gate = comment.indexOf(COMMENT_GATE)
    const cap = comment.indexOf('text.length > COMMENT_POST_MAX_CHARS')
    const patch = comment.indexOf("'--method', 'PATCH'")
    expect(gate, 'the gate line').toBeGreaterThanOrEqual(0)
    expect(cap, 'the cap check').toBeGreaterThan(gate)
    expect(patch, 'the edit').toBeGreaterThan(cap)
    expect(comment.split(COMMENT_GATE), 'one gate line in the function').toHaveLength(2)
  })

  it('known-bad probe: a write with the scrub cut is reported', () => {
    const seeded = source.replace(`  ${COMMENT_GATE}\n`, '')
    expect(seeded, 'the seed must land').not.toBe(source)
    expect(collectUngatedWrites(seeded)).toEqual([
      'publishComment: gh api --method without a scrub before it',
      'publishComment: gh pr comment without a scrub before it',
    ])
  })

  it('known-bad probe: the scrub moved to between the edit and the post is reported for the edit only', () => {
    expect(source, 'the post line must exist').toContain(POST_LINE)
    const seeded = source.replace(`  ${COMMENT_GATE}\n`, '').replace(POST_LINE, `  ${COMMENT_GATE}\n${POST_LINE}`)
    expect(seeded, 'the seed must land').not.toBe(source)
    expect(collectUngatedWrites(seeded)).toEqual(['publishComment: gh api --method without a scrub before it'])
  })

  it('the ci-wait script is the one the readiness classifier shares', () => {
    expect(fs.existsSync(CI_WAIT_SCRIPT)).toBe(true)
    expect(source).toContain("require(path.join(__dirname, 'ci-wait.cjs'))")
  })
})
