/**
 * tests/evidence/pr-shim.ts
 *
 * A stateful `gh` fake for the two scripted PR-host operations (#455): `publish`
 * (update-pr-evidence) and `readiness` (check-merge-readiness). It is a helper, not
 * a suite, so the suites that use it never import one another.
 *
 * The fake is a node script placed first on PATH. It keeps one PR in a JSON state
 * file, so a write (`pr edit`, `pr comment`) changes what the next read (`pr view`)
 * answers, and it logs every invocation with the bytes of any `--body-file` at the
 * moment gh was called — the script deletes its work files when it exits. An argv it
 * does not script exits 97, so a script that invents a call fails in the log instead
 * of being fed a plausible answer.
 *
 * Scenario knobs, all optional:
 *   bodies     the body each `pr view` that asks for `body` answers, in order; the
 *              PR's own body answers once the list runs out (a concurrent edit)
 *   failures   gh calls that fail: `match` is an argv prefix, `times` how often
 *   editStores what `pr edit` stores instead of the file it was given (a read-back
 *              that differs)
 *   noPr       every `pr view` answers "Could not resolve to a PullRequest"
 *   heads      the head each `pr view` that asks for `headRefOid` answers, in order; the
 *              last one repeats (a push between two runs). A read of `body` alone takes none
 *   commentEditStores  what a comment edit (`api --method PATCH`) stores instead of the
 *              file it was given (a comment read-back that differs)
 *
 * Comments carry a pull-comment `url` (`.../pull/7#issuecomment-<n>`, n from 1001 in the
 * order they are seeded and posted) unless a scenario seeds one, `''` included. The comment
 * edit and its read-back are scripted for one argv shape each, as are the GraphQL thread
 * count and the repository `html_url` (`https://github.com/o/r`); any other `api` argv exits 97.
 * An edit answers with a JSON body of at least 8 KiB unless it runs `--silent`, so a write
 * buffer that is too small shows. `pr comment`, `pr edit` and the comment edit are the writes.
 */

import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { scopedEnv } from '../evidence-policy/scripted-shim.js'
import { VERIFY_EVIDENCE_SCRIPT } from './seam.js'

export const SHIM_HEAD = 'c'.repeat(40)
export const SHIM_BASE = 'b'.repeat(40)
export const SHIM_PR = 7
/** The url prefix of every comment the fake seeds or posts; the id follows `issuecomment-`. */
export const COMMENT_URL = 'https://github.com/o/r/pull/7#issuecomment-'

export interface ShimFailure {
  /** An argv prefix, e.g. ['pr', 'edit']. */
  readonly match: readonly string[]
  readonly times: number
  readonly stderr: string
  readonly exit?: number
}

export interface ShimComment {
  readonly author: { readonly login: string }
  readonly authorAssociation: string
  readonly body: string
  readonly viewerDidAuthor: boolean
  /** Absent gets the next pull-comment url; an own value (`''` too) is kept as given. */
  readonly url?: string
}

export interface ShimScenario {
  readonly body?: string
  readonly bodies?: readonly string[]
  readonly comments?: readonly ShimComment[]
  readonly failures?: readonly ShimFailure[]
  readonly editStores?: string
  readonly commentEditStores?: string
  readonly heads?: readonly string[]
  readonly noPr?: boolean
  /** `reviewDecision` answer: a string, or null for "no rule asks for a review". */
  readonly reviewDecision?: string | null
  /** `pr checks` rows; absent answers "no checks reported". */
  readonly checks?: ReadonlyArray<{ readonly name: string; readonly state: string; readonly bucket: string }>
  readonly checksExit?: number
  /** The GraphQL thread answer's `reviewThreads`. Absent answers an unscripted failure. */
  readonly threads?: { readonly totalCount: number; readonly nodes: ReadonlyArray<{ readonly isResolved: unknown }> }
  readonly reviews?: ReadonlyArray<{ readonly author: { readonly login: string }; readonly authorAssociation: string; readonly state: string }>
  readonly author?: string
  readonly viewer?: string
}

export interface ShimCall {
  readonly args: readonly string[]
  /** The bytes of the `--body-file`, read when gh was called. */
  readonly file?: string
  readonly failed?: boolean
}

export interface GhShim {
  /** Goes first on PATH. */
  readonly dir: string
  readonly env: Readonly<Record<string, string>>
  calls(): ShimCall[]
  /** The PR as the fake last stored it. */
  state(): { pr: { body: string; comments: ShimComment[] } }
}

const SHIM_SOURCE = String.raw`#!/usr/bin/env node
'use strict'
const fs = require('fs')
const args = process.argv.slice(2)
const statePath = process.env.GH_SHIM_STATE
const logPath = process.env.GH_SHIM_LOG
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
const log = extra => fs.appendFileSync(logPath, JSON.stringify(Object.assign({ args }, extra || {})) + '\n')
const out = value => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)) }
const stop = (stderr, code) => { process.stderr.write(stderr); process.exit(code === undefined ? 1 : code) }
const COMMENT_URL = ${JSON.stringify(COMMENT_URL)}
const COMMENT_PATH_RE = /^repos\/\{owner\}\/\{repo\}\/issues\/comments\/([0-9]+)$/
const commentById = id => state.pr.comments.find(c => typeof c.url === 'string' && c.url.endsWith('#issuecomment-' + id))
const unscripted = () => { log({ unscripted: true }); stop('gh shim: unscripted argv\n', 97) }
const bodyFile = () => { const i = args.indexOf('--body-file'); return i === -1 ? undefined : fs.readFileSync(args[i + 1], 'utf8') }

for (const f of state.failures || []) {
  if (f.times > 0 && f.match.every((m, i) => args[i] === m)) {
    f.times--
    save()
    log({ failed: true })
    stop(f.stderr, f.exit)
  }
}

const [a, b] = args
if (a === 'pr' && b === 'view') {
  const fields = args[args.indexOf('--json') + 1].split(',')
  log()
  if (state.noPr) stop('GraphQL: Could not resolve to a PullRequest with the number of ' + args[2] + '. (repository.pullRequest)\n')
  const pr = state.pr
  let body = pr.body
  if (fields.includes('body')) {
    const i = state.reads || 0
    state.reads = i + 1
    if (state.bodies && state.bodies[i] !== undefined) body = state.bodies[i]
    save()
  }
  if (fields.includes('headRefOid') && state.heads && state.heads.length > 0) {
    const h = state.headReads || 0
    state.headReads = h + 1
    pr.headRefOid = state.heads[Math.min(h, state.heads.length - 1)]
    save()
  }
  const all = {
    number: pr.number, headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid, body,
    author: { login: pr.author }, comments: pr.comments, reviews: pr.reviews,
    isCrossRepository: false, reviewDecision: state.reviewDecision === undefined ? '' : state.reviewDecision,
  }
  const picked = {}
  for (const f of fields) picked[f] = all[f]
  out(picked)
  process.exit(0)
}
if (a === 'pr' && b === 'edit') {
  const file = bodyFile()
  log({ file })
  state.pr.body = state.editStores !== undefined ? state.editStores : file
  save()
  process.exit(0)
}
if (a === 'pr' && b === 'comment') {
  const file = bodyFile()
  log({ file })
  const id = state.nextCommentId
  state.nextCommentId = id + 1
  state.pr.comments.push({ author: { login: state.viewer }, authorAssociation: 'OWNER', body: file, viewerDidAuthor: true, url: COMMENT_URL + id })
  save()
  process.exit(0)
}
if (a === 'pr' && b === 'checks') {
  log()
  if (!state.checks) stop('no checks reported on the ' + "'" + 'feature' + "'" + ' branch\n')
  out(state.checks)
  process.exit(state.checksExit || 0)
}
if (a === 'api' && b === 'graphql') {
  log()
  if (!state.threads) stop('gh: unscripted graphql\n', 97)
  out({ data: { repository: { pullRequest: { reviewThreads: state.threads } } } })
  process.exit(0)
}
if (a === 'api' && b === '--method') {
  // gh api --method PATCH repos/{owner}/{repo}/issues/comments/<id> -F body=@<file> [--silent]
  const m = COMMENT_PATH_RE.exec(args[3] || '')
  const rest = args.slice(4)
  const shaped = args[2] === 'PATCH' && m !== null && rest[0] === '-F' && /^body=@.+/.test(rest[1] || '') &&
    (rest.length === 2 || (rest.length === 3 && rest[2] === '--silent'))
  if (!shaped) unscripted()
  const file = fs.readFileSync(rest[1].slice(6), 'utf8')
  log({ file })
  const target = commentById(m[1])
  if (target === undefined) stop('gh: Not Found (HTTP 404)\n')
  target.body = state.commentEditStores !== undefined ? state.commentEditStores : file
  save()
  if (rest.length === 2) out({ id: m[1], body: target.body, padding: 'x'.repeat(8192) })
  process.exit(0)
}
if (a === 'api' && COMMENT_PATH_RE.test(b || '')) {
  // gh api repos/{owner}/{repo}/issues/comments/<id> --jq '.body | @json'
  if (!(args.length === 4 && args[2] === '--jq' && args[3] === '.body | @json')) unscripted()
  log()
  const target = commentById(COMMENT_PATH_RE.exec(b)[1])
  if (target === undefined) stop('gh: Not Found (HTTP 404)\n')
  out(JSON.stringify(target.body) + '\n')
  process.exit(0)
}
if (a === 'api' && b === 'repos/{owner}/{repo}') {
  if (!(args.length === 4 && args[2] === '--jq' && args[3] === '.html_url')) unscripted()
  log()
  out('https://github.com/o/r\n')
  process.exit(0)
}
unscripted()
`

/** Build the fake under `root` for one scenario. `root` is owned by the test. */
export function createGhShim(root: string, scenario: ShimScenario = {}): GhShim {
  const dir = path.join(root, 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const bin = path.join(dir, 'gh')
  fs.writeFileSync(bin, SHIM_SOURCE, { mode: 0o755 })
  const statePath = path.join(root, 'gh-state.json')
  const logPath = path.join(root, 'gh-calls.jsonl')
  fs.writeFileSync(logPath, '')
  const viewer = scenario.viewer ?? 'devflow-bot'
  let nextCommentId = 1001
  const comments = (scenario.comments ?? []).map(c =>
    c.url !== undefined ? { ...c } : { ...c, url: `${COMMENT_URL}${nextCommentId++}` })
  const state = {
    pr: {
      number: SHIM_PR,
      headRefOid: SHIM_HEAD,
      baseRefOid: SHIM_BASE,
      body: scenario.body ?? 'Adds the thing.\n\n## Summary\nA summary.\n',
      author: scenario.author ?? 'alice',
      comments,
      reviews: [...(scenario.reviews ?? [])],
    },
    bodies: scenario.bodies,
    failures: scenario.failures?.map(f => ({ ...f })),
    editStores: scenario.editStores,
    commentEditStores: scenario.commentEditStores,
    heads: scenario.heads,
    headReads: 0,
    nextCommentId,
    noPr: scenario.noPr ?? false,
    reviewDecision: scenario.reviewDecision,
    checks: scenario.checks,
    checksExit: scenario.checksExit,
    threads: scenario.threads,
    viewer,
    reads: 0,
  }
  fs.writeFileSync(statePath, JSON.stringify(state))
  return {
    dir,
    env: { GH_SHIM_STATE: statePath, GH_SHIM_LOG: logPath },
    calls: () => fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l !== '').map(l => JSON.parse(l) as ShimCall),
    state: () => JSON.parse(fs.readFileSync(statePath, 'utf8')) as { pr: { body: string; comments: ShimComment[] } },
  }
}

// ---------------------------------------------------------------------------
// Running the script under the fake
// ---------------------------------------------------------------------------

const SCRIPTS_COPIED = ['verify-evidence.cjs', 'pr-evidence.cjs', 'ci-wait.cjs'] as const
const SCRIPTS_SOURCE = path.dirname(VERIFY_EVIDENCE_SCRIPT)

/**
 * `half` is a scrubber that writes its output and then exits 1 — a crash after the copy.
 * `grow` copies its input, appends 70,000 characters and exits 0 — redaction that grew the text.
 */
export type Redact = 'real' | 'fails' | 'half' | 'grow' | 'missing'

export interface RunOptions {
  readonly scenario?: ShimScenario
  readonly redact?: Redact
  /** The script's argv after its own path. */
  readonly args: readonly string[]
  /** Files laid down in the working directory first, by relative path. */
  readonly files?: Readonly<Record<string, string>>
  /** Rewrites the script's source before it runs (a known-bad probe). */
  readonly mutate?: (source: string) => string
}

export interface ScriptRun {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  /** The gh calls this run made. */
  readonly calls: readonly ShimCall[]
  /** The gh writes among them: `pr edit`, `pr comment` and the comment edit (`api --method`). */
  readonly writes: readonly ShimCall[]
  /** What is left in the run's TMPDIR afterwards. */
  readonly leftovers: readonly string[]
  readonly pr: { body: string; comments: Array<{ body: string; url?: string }> }
}

const roots: string[] = []

/** Remove every scenario root this file made. Call it from the suite's afterAll. */
export function cleanShimRoots(): void {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
}

/**
 * Lay out one scenario under a fresh root — a copy of the scripts beside a scrubber
 * of the chosen kind, a working directory, the gh fake first on PATH, an own TMPDIR —
 * and run the script `runs` times over the same fake PR.
 */
export function runScript(options: RunOptions, runs = 1): ScriptRun[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-script-test-'))
  roots.push(root)
  const scripts = path.join(root, 'scripts')
  const work = path.join(root, 'work')
  const tmp = path.join(root, 'tmp')
  const home = path.join(root, 'home')
  for (const dir of [scripts, work, tmp, home]) fs.mkdirSync(dir, { recursive: true })
  for (const name of SCRIPTS_COPIED) {
    const source = fs.readFileSync(path.join(SCRIPTS_SOURCE, name), 'utf-8')
    fs.writeFileSync(path.join(scripts, name), name === 'verify-evidence.cjs' && options.mutate ? options.mutate(source) : source)
  }
  const redact = options.redact ?? 'real'
  const scrubber = path.join(scripts, 'redact-secrets.cjs')
  if (redact === 'real') fs.copyFileSync(path.join(SCRIPTS_SOURCE, 'redact-secrets.cjs'), scrubber)
  if (redact === 'fails') fs.writeFileSync(scrubber, 'process.exitCode = 1\n')
  if (redact === 'half') fs.writeFileSync(scrubber, "require('fs').copyFileSync(process.argv[2], process.argv[3])\nprocess.exitCode = 1\n")
  if (redact === 'grow') {
    fs.writeFileSync(scrubber, "const fs = require('fs')\nfs.writeFileSync(process.argv[3], fs.readFileSync(process.argv[2], 'utf8') + 'x'.repeat(70000))\n")
  }
  for (const [rel, content] of Object.entries(options.files ?? {})) fs.writeFileSync(path.join(work, rel), content)

  const shim = createGhShim(root, options.scenario)
  const results: ScriptRun[] = []
  for (let i = 0; i < runs; i++) {
    const before = shim.calls().length
    const r = spawnSync(process.execPath, [path.join(scripts, 'verify-evidence.cjs'), ...options.args], {
      cwd: work,
      env: scopedEnv(home, { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, TMPDIR: tmp, ...shim.env }),
      encoding: 'utf-8',
      timeout: 60_000,
    })
    const calls = shim.calls().slice(before)
    results.push({
      code: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      calls,
      writes: calls.filter(c => (c.args[0] === 'pr' && (c.args[1] === 'edit' || c.args[1] === 'comment')) || (c.args[0] === 'api' && c.args[1] === '--method')),
      leftovers: fs.readdirSync(tmp),
      pr: shim.state().pr,
    })
  }
  return results
}
