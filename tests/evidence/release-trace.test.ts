/**
 * tests/evidence/release-trace.test.ts
 *
 * Suite for src/assets/scripts/release-trace.cjs — the git-only plumbing behind
 * `gather-release-evidence`'s last-release-tag fix and per-commit trace map
 * (SDLC-evidence PR5, #364, phase P1).
 *
 *   AC-1  `last-tag` returns the highest merged `^v?X.Y.Z$` tag; marker and
 *         prerelease tags never win; no tag ⇒ `LAST_TAG none`.
 *   AC-2  `map` puts every first-parent commit in exactly one class, the counts
 *         sum (else exit 5), and 501 commits ⇒ `bound:hit`.
 *   AC-3  Only closed-grammar tokens and gated author names reach stdout; revs
 *         are gated; exit codes 0–5 hold, with stdout empty on 1.
 *   (AC-15 runs against this repository by hand — a CI checkout has no tags.)
 *
 * Two harnesses drive the same script:
 *   - main() in-process with an injected exec — for the gates that must refuse
 *     BEFORE any git call, and for git answers no real repository produces;
 *   - the real script under process.execPath over REAL temporary repositories —
 *     for every class, the bound, the stdout contract and the exit codes.
 *
 * Every guard has a named collector, a non-empty corpus and a known-bad probe
 * run through the same collector (PF-064). Every spawn goes through scopedEnv()
 * and names its cwd (PF-060; verify-evidence.test.ts sweeps this directory).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { RELEASE_TRACE_SCRIPT } from './seam.js'
import { scopedEnv } from '../evidence-policy/scripted-shim.js'
import { composeScripts } from '../../src/targets/claude-code/installer.js'

// ---------------------------------------------------------------------------
// The .cjs seam — transcribed from the module's JSDoc; open it before changing
// ---------------------------------------------------------------------------

type Grammar = 'github' | 'jira' | 'linear'
type TraceClass = 'traced' | 'exempt:release' | 'exempt:revert' | 'exempt:bot' | 'untraced'
interface Commit {
  sha: string
  name: string
  email: string
  subject: string
  body: string
  paths: readonly string[]
}
interface TraceRecord { sha: string; cls: TraceClass; author: string }
interface TraceSummary { from: string; bound: 'ok' | 'hit'; unmatched: number; records: readonly TraceRecord[] }
interface ExecResult { status: number | null; stdout?: Buffer | string; stderr?: Buffer | string; error?: { code?: string } }
type ExecFn = (file: string, args: string[], opts: Record<string, unknown>) => ExecResult
interface Outcome { code: number; stdout: string }
interface ReleaseTrace {
  readonly EXIT_CODES: Readonly<Record<string, number>>
  readonly LIMITS: Readonly<Record<string, number>>
  readonly RELEASE_TAG_RE: RegExp
  readonly KEYWORD_RE: RegExp
  readonly TRAILING_CLASS: string
  readonly GRAMMARS: Readonly<Record<Grammar, RegExp>>
  readonly GRAMMAR_RULES: Readonly<Record<Grammar, { keyed: boolean; upcase: boolean }>>
  readonly EXEMPT: unknown
  readonly CLASSES: readonly TraceClass[]
  readonly AUTHOR_RE: RegExp
  readonly TRACE_HEADER_RE: RegExp
  readonly TRACE_ENTRY_RE: RegExp
  readonly TRACE_MORE_RE: RegExp
  readonly LAST_TAG_LINE_RE: RegExp
  readonly REASONS: Readonly<Record<string, string>>
  selectLastTag(names: readonly string[]): string | null
  findReference(message: string, grammar: Grammar, key: string | null): string | null
  classify(commit: Commit, ctx: { grammar: Grammar; key: string | null; traced: ReadonlySet<string> }): TraceClass
  render(summary: TraceSummary): string
  checkTraceOutput(text: unknown, expected?: { from: string; scanned: number; bound: 'ok' | 'hit'; unmatched: number }): boolean
  parseMessageLog(text: string, shas: readonly string[]): Array<Omit<Commit, 'paths'>> | null
  parsePathLog(text: string, shas: readonly string[]): string[][] | null
  main(argv: readonly string[], deps?: {
    exec?: ExecFn
    cwd?: string
    stderr?: (text: string) => void
    render?: (s: TraceSummary) => unknown
  }): Outcome
  settleOutcome(outcome: unknown): Outcome
}

const req = createRequire(import.meta.url)
const RT = req(RELEASE_TRACE_SCRIPT) as ReleaseTrace
const SOURCE = fs.readFileSync(RELEASE_TRACE_SCRIPT, 'utf-8')

/** Budget for describe blocks that spawn node or real git (slow under full-suite load). */
const SPAWN_BUDGET = { timeout: 20_000 } as const
/** Fixture builds make tens of git spawns; give the hook its own, larger budget. */
const FIXTURE_BUDGET = 60_000

const EXIT = RT.EXIT_CODES
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

// ---------------------------------------------------------------------------
// Real-git fixtures
// ---------------------------------------------------------------------------

let tmp: string
let home: string
let msgSeq = 0

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-release-trace-'))
  home = path.join(tmp, 'home')
  fs.mkdirSync(home, { recursive: true })
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** Run real git in a fixture repository; throws (a setup failure) on non-zero. */
function git(repo: string, args: readonly string[], extra: Readonly<Record<string, string>> = {}, input?: string): string {
  const r = spawnSync('git', [...args], {
    cwd: repo,
    env: scopedEnv(home, extra),
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: 20_000,
  })
  if (r.status !== 0) throw new Error(`fixture: git ${args.join(' ')} failed (${r.status}): ${r.stderr}`)
  return r.stdout
}

/** A fresh repository with one root commit on `main`. */
function newRepo(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(tmp, `${prefix}-`))
  git(dir, ['init', '-q', '-b', 'main'])
  fs.writeFileSync(path.join(dir, 'README'), 'root\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

interface CommitSpec {
  readonly subject: string
  readonly body?: string
  readonly files?: Readonly<Record<string, string>>
  readonly mv?: readonly [string, string]
  readonly author?: { readonly name: string; readonly email: string }
  readonly allowEmpty?: boolean
}

/** Commit exactly `spec` (verbatim message, so `#`-lines and control bytes survive); returns the SHA. */
function commit(repo: string, spec: CommitSpec): string {
  for (const [rel, content] of Object.entries(spec.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), content)
  }
  if (spec.mv !== undefined) {
    fs.mkdirSync(path.dirname(path.join(repo, spec.mv[1])), { recursive: true })
    git(repo, ['mv', spec.mv[0], spec.mv[1]])
  }
  git(repo, ['add', '-A'])
  const msgFile = path.join(tmp, `msg-${msgSeq++}.txt`)
  fs.writeFileSync(msgFile, `${spec.subject}${spec.body === undefined ? '' : `\n\n${spec.body}`}\n`)
  const author = spec.author === undefined
    ? {}
    : { GIT_AUTHOR_NAME: spec.author.name, GIT_AUTHOR_EMAIL: spec.author.email }
  git(repo, ['commit', '-q', '--cleanup=verbatim', '-F', msgFile, ...(spec.allowEmpty ? ['--allow-empty'] : [])], author)
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

interface Run { stdout: string; stderr: string; status: number | null }

/** Run the real script under process.execPath in `cwd`; HOME is tmp (PF-060). */
function run(cwd: string, args: readonly string[], script: string = RELEASE_TRACE_SCRIPT): Run {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: scopedEnv(home),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status }
}

interface Trace {
  readonly header: Readonly<Record<string, string>>
  readonly lines: readonly string[]
  /** sha12 ⇒ class, for every listed entry. */
  readonly listed: ReadonlyMap<string, string>
  readonly authors: ReadonlyMap<string, string>
}

/** Parse a `map` stdout through the module's own grammars; fails the test on any other line. */
function parseTrace(stdout: string): Trace {
  expect(stdout.endsWith('\n'), 'stdout ends with a newline').toBe(true)
  const lines = stdout.slice(0, -1).split('\n')
  const header = RT.TRACE_HEADER_RE.exec(lines[0])?.groups
  expect(header, `header: ${lines[0]}`).toBeDefined()
  const listed = new Map<string, string>()
  const authors = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const entry = RT.TRACE_ENTRY_RE.exec(line)?.groups
    if (entry !== undefined) {
      listed.set(entry.sha, entry.cls)
      authors.set(entry.sha, entry.author)
      continue
    }
    expect(RT.TRACE_MORE_RE.test(line), `a line outside the closed grammar: ${JSON.stringify(line)}`).toBe(true)
  }
  return { header: header!, lines, listed, authors }
}

/** The class a trace gives a commit: its listed class, else `traced` (only valid below LIST_CAP). */
function classOf(trace: Trace, sha: string): string {
  return trace.listed.get(sha.slice(0, 12)) ?? 'traced'
}

// ---------------------------------------------------------------------------
// In-process harness
// ---------------------------------------------------------------------------

/** An exec that fails the test if the script makes ANY call — for gates that must refuse first. */
function noCallExec(): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = []
  const exec: ExecFn = (file, args) => {
    calls.push([file, ...args])
    return { status: 128, stdout: '', stderr: 'unexpected call\n' }
  }
  return { exec, calls }
}

/** Run main() in-process; stderr is captured, never printed. */
function runMain(args: readonly string[], deps: { exec?: ExecFn; cwd?: string; render?: (s: TraceSummary) => unknown } = {}): Outcome & { stderr: string } {
  let stderr = ''
  const out = RT.main(['node', 'release-trace.cjs', ...args], {
    cwd: deps.cwd ?? tmp,
    stderr: (t: string) => { stderr += t },
    ...deps,
  })
  return { ...out, stderr }
}

/**
 * An exec answering by subcommand: rev-parse ⇒ `revParse`, rev-list ⇒ `revList`,
 * log ⇒ the message or path log (told apart by `-z`).
 */
function fakeGit(o: { revParse?: ExecResult; revList?: ExecResult; messages?: ExecResult; paths?: ExecResult }): ExecFn {
  return (_file, args) => {
    const sub = args[0] === '-c' ? args[2] : args[0]
    if (sub === 'rev-parse') return o.revParse ?? { status: 0, stdout: `${SHA_A}\n` }
    if (sub === 'rev-list') return o.revList ?? { status: 0, stdout: '' }
    if (sub === 'log') return (args.includes('-z') ? o.paths : o.messages) ?? { status: 0, stdout: '' }
    return { status: 128, stdout: '' }
  }
}

const commitOf = (over: Partial<Commit>): Commit => ({
  sha: SHA_A, name: 'Dev', email: 'dev@example.invalid', subject: 'feat: something', body: '', paths: ['src/a.js'], ...over,
})
const ctxOf = (grammar: Grammar = 'github', key: string | null = null, traced: readonly string[] = []) =>
  ({ grammar, key, traced: new Set(traced) })

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('module surface', () => {
  it('exports a frozen surface with the documented exit codes and bounds', () => {
    expect(Object.isFrozen(RT)).toBe(true)
    expect(RT.EXIT_CODES).toEqual({
      OK: 0, USAGE: 1, INPUT_UNUSABLE: 2, WRITE_FAILED: 3, GIT_FAILURE: 4, OUTPUT_GATE_REFUSED: 5,
    })
    expect(RT.LIMITS.SCAN_BOUND).toBe(500)
    expect(RT.LIMITS.LIST_CAP).toBe(100)
    expect(RT.CLASSES).toEqual(['traced', 'exempt:release', 'exempt:revert', 'exempt:bot', 'untraced'])
  })

  it('states step 3a\'s literals: an anchored case-insensitive keyword regex without the u flag, and the trailing class', () => {
    expect(RT.KEYWORD_RE.source).toBe('^\\(?(close[sd]?|fix(e[sd])?|resolve[sd]?|refs):?$')
    expect(RT.KEYWORD_RE.flags).toBe('i')
    expect(RT.TRAILING_CLASS).toBe('[.,;:)\\]!?]')
    expect(RT.GRAMMARS.github.source).toBe('^#[1-9][0-9]{0,8}$')
    expect(RT.GRAMMARS.jira.source).toBe('^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$')
    expect(RT.GRAMMARS.linear.source).toBe('^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$')
  })

  it('RELEASE_TAG_RE admits exactly the fixed `^v?X.Y.Z$` shape (D8)', () => {
    for (const tag of ['v1.0.0', '1.2.0', 'v10.20.30', 'v01.0.0']) expect(RT.RELEASE_TAG_RE.test(tag), tag).toBe(true)
    for (const tag of [
      'v1.1.0-rc.1', 'sdlc-baseline-2026-09-24', 'release-1.2.3', 'v1.2', 'v1.2.3.4', 'V1.2.3', 'vv1.2.3',
      ' v1.2.3', 'v1.2.3 ', 'v1.2.3\n', '-v1.2.3', 'v1.2.x',
    ]) {
      expect(RT.RELEASE_TAG_RE.test(tag), JSON.stringify(tag)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// last-tag (AC-1)
// ---------------------------------------------------------------------------

describe('selectLastTag — the highest release tag, compared numerically', () => {
  it.each([
    [['v1.0.0', 'sdlc-baseline-2026-09-24'], 'v1.0.0'],
    [['v1.0.0', 'v1.1.0-rc.1'], 'v1.0.0'],
    [['v1.0.0', '1.2.0'], '1.2.0'],
    [['1.2.0', 'v1.0.0'], '1.2.0'],
    [['v1.9.0', 'v1.10.0'], 'v1.10.0'],
    [['v2.0.0', 'v1.99.99'], 'v2.0.0'],
    [['v1.2.0', '1.2.0'], 'v1.2.0'],
    [['1.2.0', 'v1.2.0'], 'v1.2.0'],
    [['v99999999999999999999.0.0', 'v99999999999999999998.9.9'], 'v99999999999999999999.0.0'],
    [['v1.02.0', 'v1.1.9'], 'v1.02.0'],
    [['release-1.2.3', 'v1.2', 'v1.2.3.4', 'latest'], null],
    [[], null],
  ] as const)('%j ⇒ %s', (names, expected) => {
    expect(RT.selectLastTag(names)).toBe(expected)
  })
})

describe('last-tag over a real repository (AC-1)', SPAWN_BUDGET, () => {
  let repo: string
  let c1: string
  let c2: string

  beforeAll(() => {
    repo = newRepo('last-tag')
    c1 = commit(repo, { subject: 'feat: one', files: { a: '1' } })
    git(repo, ['tag', 'v1.0.0', c1])
    c2 = commit(repo, { subject: 'feat: two', files: { a: '2' } })
    git(repo, ['tag', 'sdlc-baseline-2026-09-24', c2])
  }, FIXTURE_BUDGET)

  it('ignores a newer marker tag that `git describe` returns', () => {
    expect(git(repo, ['describe', '--tags', '--abbrev=0']).trim(), 'the fixture reproduces the hazard')
      .toBe('sdlc-baseline-2026-09-24')
    const r = run(repo, ['last-tag'])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('LAST_TAG v1.0.0\n')
  })

  it('ignores a newer prerelease, picks a newer bare tag over a lower v-tag, and ignores an unmerged tag', () => {
    git(repo, ['tag', 'v1.1.0-rc.1', c2])
    expect(run(repo, ['last-tag']).stdout).toBe('LAST_TAG v1.0.0\n')

    git(repo, ['tag', '-a', '-m', 'annotated', '1.2.0', c2])
    // git's own version sort ranks `v1.0.0` above `1.2.0` — the order this script must not inherit.
    const gitOrder = git(repo, ['tag', '--merged', 'HEAD', '--sort=-v:refname']).split('\n')
    expect(gitOrder.filter(t => RT.RELEASE_TAG_RE.test(t))).toEqual(['v1.0.0', '1.2.0'])
    expect(run(repo, ['last-tag']).stdout).toBe('LAST_TAG 1.2.0\n')

    git(repo, ['checkout', '-q', '-b', 'side', c1])
    const side = commit(repo, { subject: 'feat: side', files: { s: '1' } })
    git(repo, ['tag', 'v9.0.0', side])
    git(repo, ['checkout', '-q', 'main'])
    expect(run(repo, ['last-tag']).stdout, 'a tag not merged into HEAD never wins').toBe('LAST_TAG 1.2.0\n')
  })

  it('prints `LAST_TAG none` when no release tag is merged', () => {
    const bare = newRepo('no-tags')
    git(bare, ['tag', 'sdlc-baseline-2026-09-24'])
    const r = run(bare, ['last-tag'])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('LAST_TAG none\n')
  })

  it('exits 4 with empty stdout outside a repository and on an unborn HEAD', () => {
    const notRepo = fs.mkdtempSync(path.join(tmp, 'not-a-repo-'))
    const outside = run(notRepo, ['last-tag'])
    expect(outside.status).toBe(EXIT.GIT_FAILURE)
    expect(outside.stdout).toBe('')

    const unborn = fs.mkdtempSync(path.join(tmp, 'unborn-'))
    git(unborn, ['init', '-q', '-b', 'main'])
    const empty = run(unborn, ['last-tag'])
    expect(empty.status).toBe(EXIT.GIT_FAILURE)
    expect(empty.stdout).toBe('')
  })
})

// ---------------------------------------------------------------------------
// classify — the rules, in-process (AC-2)
// ---------------------------------------------------------------------------

describe('classify — first match wins, terminal arm untraced', () => {
  const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' }

  it.each([
    ['traced by a closing keyword', commitOf({ body: 'Closes #3.' }), 'traced'],
    ['traced by the traced file alone', commitOf({ sha: SHA_B }), 'traced'],
    ['the /release commit', commitOf({ subject: 'chore(release): v1.2.3' }), 'exempt:release'],
    ['a bare-version /release commit', commitOf({ subject: 'chore(release): 1.2.3' }), 'exempt:release'],
    ['near miss: chore(release) that records something', commitOf({ subject: 'chore(release): record the manifest' }), 'untraced'],
    ['near miss: e7268747\'s shape', commitOf({ subject: 'chore(release): require explicit version confirmation before dispatch (#320)' }), 'untraced'],
    ['near miss: a prerelease version', commitOf({ subject: 'chore(release): v1.2.3-rc.1' }), 'untraced'],
    ['CHANGELOG-only', commitOf({ paths: ['CHANGELOG.md'] }), 'exempt:release'],
    ['a nested CHANGELOG.md only', commitOf({ paths: ['packages/x/CHANGELOG.md', 'CHANGELOG.md'] }), 'exempt:release'],
    ['CHANGELOG plus source', commitOf({ paths: ['CHANGELOG.md', 'src/a.js'] }), 'untraced'],
    ['a lowercase changelog.md', commitOf({ paths: ['changelog.md'] }), 'untraced'],
    ['a CHANGELOG.md.bak', commitOf({ paths: ['CHANGELOG.md.bak'] }), 'untraced'],
    ['an empty commit is never CHANGELOG-only', commitOf({ paths: [] }), 'untraced'],
    ['git revert', commitOf({ subject: 'Revert "feat: x"', body: `This reverts commit ${SHA_C}.\n` }), 'exempt:revert'],
    ['GitHub revert PR', commitOf({ subject: 'Revert "feat: x" (#21)', body: 'Reverts owner/repo#20\n' }), 'exempt:revert'],
    ['subject-only revert', commitOf({ subject: 'Revert "feat: x"' }), 'untraced'],
    ['body-only revert', commitOf({ body: `This reverts commit ${SHA_C}.` }), 'untraced'],
    ['revert naming a short SHA', commitOf({ subject: 'Revert "feat: x"', body: 'This reverts commit abc1234.' }), 'untraced'],
    ['bot with a numeric noreply', commitOf(BOT), 'exempt:bot'],
    ['bot with a bare noreply', commitOf({ name: 'dependabot[bot]', email: 'dependabot[bot]@users.noreply.github.com' }), 'exempt:bot'],
    ['[bot] name, foreign e-mail', commitOf({ name: 'evil[bot]', email: 'evil[bot]@example.com' }), 'untraced'],
    ['noreply bot e-mail, name without [bot]', commitOf({ name: 'renovate', email: 'renovate[bot]@users.noreply.github.com' }), 'untraced'],
    ['[bot] name, human noreply', commitOf({ name: 'x[bot]', email: '123+octocat@users.noreply.github.com' }), 'untraced'],
    ['order: a CHANGELOG-only bot commit (1a8ac476\'s shape) is release', commitOf({ ...BOT, paths: ['CHANGELOG.md'] }), 'exempt:release'],
    ['order: a traced revert is traced', commitOf({ subject: 'Revert "x"', body: `This reverts commit ${SHA_C}.\nRefs #9` }), 'traced'],
    ['order: a revert by a bot is revert', commitOf({ ...BOT, subject: 'Revert "x"', body: `This reverts commit ${SHA_C}.` }), 'exempt:revert'],
  ] as const)('%s ⇒ %s', (_label, c, expected) => {
    expect(RT.classify(c, ctxOf('github', null, [SHA_B]))).toBe(expected)
  })
})

describe('step 3a executed: the keyword rule and each grammar\'s gate', () => {
  // The G2 accept/reject table (release-evidence-rules.test.ts), through the script.
  it.each([
    ['Closes #12.', 'github', null, '#12'],
    ['fixes #12,', 'github', null, '#12'],
    ['(Resolves #12)', 'github', null, '#12'],
    ['Closes: #12', 'github', null, '#12'],
    ['Closes #1, #2', 'github', null, '#1'],
    ['Refs KEY-9;', 'jira', 'KEY', 'KEY-9'],
    ['closed: #7', 'github', null, '#7'],
    ['feat: x\n\nsome prose\nFixes #42 and more', 'github', null, '#42'],
    ['Closes foo, #5', 'github', null, '#5'],
    ['Refs KEY-9', 'github', null, null],
    ['Closes #12', 'jira', 'KEY', null],
    ['Refs OTHER-9', 'jira', 'KEY', null],
    ['Closes #12abc', 'github', null, null],
    ['Closes owner/repo#12', 'github', null, null],
    ['bare #12', 'github', null, null],
    ['prefixes #12', 'github', null, null],
    ['Merge pull request #12 from owner/branch', 'github', null, null],
    ['Closes #0', 'github', null, null],
    ['Closes\n#12', 'github', null, null],
    ['Closes #1234567890', 'github', null, null],
    ['fixes eng-12', 'linear', 'ENG', 'ENG-12'],
    ['fixes ENG-12', 'linear', 'ENG', 'ENG-12'],
    ['refs key-9', 'jira', 'KEY', null],
  ] as const)('%j (%s, key %s) ⇒ %s', (message, grammar, key, expected) => {
    expect(RT.findReference(message, grammar, key)).toBe(expected)
  })

  it('ASCII-upper normalisation only: `ſ` and `ı` never fold onto ASCII (String#toUpperCase would)', () => {
    expect('enſ-12'.toUpperCase(), 'the hazard this rule exists for').toBe('ENS-12')
    expect('ıx-1'.toUpperCase()).toBe('IX-1')
    expect(RT.findReference('fixes enſ-12', 'linear', 'ENS')).toBeNull()
    expect(RT.findReference('fixes ıx-1', 'linear', 'IX')).toBeNull()
    expect(RT.findReference('cloſes #12', 'github', null), 'no u-flag case folding on the keyword').toBeNull()
  })

  it('a hostile token costs linear time (the trailing strip never backtracks)', () => {
    const hostile = `Closes ${'.'.repeat(200_000)}a ${')'.repeat(100_000)}`
    const started = Date.now()
    expect(RT.findReference(hostile, 'github', null)).toBeNull()
    expect(Date.now() - started, 'a quadratic strip takes minutes here').toBeLessThan(2_000)
  })
})

// ---------------------------------------------------------------------------
// render and the output gate (AC-2, AC-3)
// ---------------------------------------------------------------------------

describe('render and the output gate (D-TRACE-STDOUT, D-TRACE-GATE)', () => {
  const rec = (n: number, cls: TraceClass, author = 'Dev'): TraceRecord =>
    ({ sha: n.toString(16).padStart(40, '0'), cls, author })

  it('renders the header, lists untraced then each exempt class, and counts traced', () => {
    const text = RT.render({
      from: 'v1.0.0', bound: 'ok', unmatched: 2,
      records: [rec(1, 'traced'), rec(2, 'exempt:bot', 'ci[bot]'), rec(3, 'untraced', 'Ev`il'), rec(4, 'exempt:release'), rec(5, 'untraced')],
    })
    expect(text).toBe([
      'TRACE from:v1.0.0 scanned:5 traced:1 untraced:2 exempt:2 unmatched:2 bound:ok',
      '- 000000000000 untraced author:(unprintable)',
      '- 000000000000 untraced author:Dev',
      '- 000000000000 exempt:release author:Dev',
      '- 000000000000 exempt:bot author:ci[bot]',
      '',
    ].join('\n'))
    expect(RT.checkTraceOutput(text, { from: 'v1.0.0', scanned: 5, bound: 'ok', unmatched: 2 })).toBe(true)
  })

  it('caps each class at 100 lines and closes it with `- …and <n> more`', () => {
    const records = [
      ...Array.from({ length: 150 }, (_, i) => rec(i + 1, 'untraced')),
      ...Array.from({ length: 101 }, (_, i) => rec(i + 200, 'exempt:revert')),
    ]
    const text = RT.render({ from: 'abc1234', bound: 'ok', unmatched: 0, records })
    const lines = text.slice(0, -1).split('\n')
    expect(lines).toHaveLength(1 + 100 + 1 + 100 + 1)
    expect(lines[101]).toBe('- …and 50 more')
    expect(lines[202]).toBe('- …and 1 more')
    expect(RT.checkTraceOutput(text, { from: 'abc1234', scanned: 251, bound: 'ok', unmatched: 0 })).toBe(true)
  })

  it('gates the author name: letters, marks, digits, space and `._[]-`, at most 64 code points', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['Zoë Ångström 李雷', 'Zoë Ångström 李雷'],
      ['github-actions[bot]', 'github-actions[bot]'],
      ['b'.repeat(64), 'b'.repeat(64)],
      ['a'.repeat(65), '(unprintable)'],
      ['Ev`il', '(unprintable)'],
      ['$(touch pwned)', '(unprintable)'],
      ['abc\u202Edef', '(unprintable)'],
      ['zero\u200Dwidth', '(unprintable)'],
      ['- …and 9 more', '(unprintable)'],
      ['name\nTRACE from:v9.9.9', '(unprintable)'],
      ['', '(unprintable)'],
      ['\uFFFD', '(unprintable)'],
    ]
    for (const [name, shown] of cases) {
      const text = RT.render({ from: 'v1.0.0', bound: 'ok', unmatched: 0, records: [rec(1, 'untraced', name)] })
      expect(text.split('\n')[1], JSON.stringify(name)).toBe(`- 000000000000 untraced author:${shown}`)
      expect(RT.checkTraceOutput(text)).toBe(true)
    }
  })

  it('refuses every incoherent output', () => {
    const header = (over: string) => `TRACE from:v1.0.0 ${over}\n`
    const bad: ReadonlyArray<readonly [string, unknown]> = [
      // Every other check passes here (nothing listed, nothing claimed listed): only the sum refuses it.
      ['counts do not sum', header('scanned:3 traced:1 untraced:0 exempt:0 unmatched:0 bound:ok')],
      ['listed untraced ≠ header', `${header('scanned:1 traced:0 untraced:1 exempt:0 unmatched:0 bound:ok')}`],
      ['scanned past the bound', header('scanned:501 traced:501 untraced:0 exempt:0 unmatched:0 bound:hit')],
      ['bound:hit below the bound', header('scanned:3 traced:3 untraced:0 exempt:0 unmatched:0 bound:hit')],
      ['a hostile author', `${header('scanned:1 traced:0 untraced:1 exempt:0 unmatched:0 bound:ok')}- 000000000001 untraced author:$(x)\n`],
      ['exempt listed before untraced', `${header('scanned:2 traced:0 untraced:1 exempt:1 unmatched:0 bound:ok')}- 000000000002 exempt:bot author:b\n- 000000000001 untraced author:a\n`],
      // The totals agree (2 untraced lines' worth, 0 exempt): only the class labels refuse it.
      ['an exempt-labelled line counted as untraced', `${header('scanned:2 traced:0 untraced:2 exempt:0 unmatched:0 bound:ok')}- 000000000002 exempt:bot author:b\n- 000000000001 untraced author:a\n`],
      ['an overflow line after a short class', `${header('scanned:5 traced:0 untraced:5 exempt:0 unmatched:0 bound:ok')}- 000000000001 untraced author:a\n- …and 4 more\n`],
      ['a trailing foreign line', `${header('scanned:0 traced:0 untraced:0 exempt:0 unmatched:0 bound:ok')}Closes #12\n`],
      ['no final newline', 'TRACE from:v1.0.0 scanned:0 traced:0 untraced:0 exempt:0 unmatched:0 bound:ok'],
      ['a leading-zero count', header('scanned:01 traced:01 untraced:0 exempt:0 unmatched:0 bound:ok')],
      ['a flag-shaped from', 'TRACE from:-x scanned:0 traced:0 untraced:0 exempt:0 unmatched:0 bound:ok\n'],
      ['not a string', 42],
    ]
    for (const [label, text] of bad) expect(RT.checkTraceOutput(text), label).toBe(false)

    const good = header('scanned:1 traced:1 untraced:0 exempt:0 unmatched:0 bound:ok')
    expect(RT.checkTraceOutput(good)).toBe(true)
    expect(RT.checkTraceOutput(good, { from: 'v1.0.0', scanned: 1, bound: 'ok', unmatched: 0 })).toBe(true)
    expect(RT.checkTraceOutput(good, { from: 'v1.0.0', scanned: 2, bound: 'ok', unmatched: 0 }), 'describes another run').toBe(false)
    expect(RT.checkTraceOutput(good, { from: 'v2.0.0', scanned: 1, bound: 'ok', unmatched: 0 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Parsing git's answers — record boundaries hostile bytes cannot move
// ---------------------------------------------------------------------------

describe('parsing git\'s answers (D-TRACE-PARSE)', () => {
  it('a message body carrying `\\x1e\\n` and the next SHA keeps its record', () => {
    const forged = `evil\x1e\n${SHA_B}\x1e\n${SHA_B}`
    const text = `${SHA_A}\0Dev\0d@x\0feat: a\0${forged}\x1e\n${SHA_B}\0Bot[bot]\0b@x\0chore(release): v1.0.0\0\x1e\n`
    expect(RT.parseMessageLog(text, [SHA_A, SHA_B])).toEqual([
      { sha: SHA_A, name: 'Dev', email: 'd@x', subject: 'feat: a', body: forged },
      { sha: SHA_B, name: 'Bot[bot]', email: 'b@x', subject: 'chore(release): v1.0.0', body: '' },
    ])
  })

  it('refuses a message log whose NUL count or record SHAs do not match rev-list', () => {
    const good = `${SHA_A}\0n\0e\0s\0b\x1e\n`
    expect(RT.parseMessageLog(good, [SHA_A])).not.toBeNull()
    expect(RT.parseMessageLog(`${SHA_A}\0n\0e\0s\0b\0x\x1e\n`, [SHA_A]), 'an extra NUL').toBeNull()
    expect(RT.parseMessageLog(good, [SHA_B]), 'another commit').toBeNull()
    expect(RT.parseMessageLog(good, [SHA_A, SHA_B]), 'a commit missing').toBeNull()
    const second = `${SHA_A}\0n\0e\0s\0b\x1e\n${SHA_C}\0n\0e\0s\0b\x1e\n`
    expect(RT.parseMessageLog(second, [SHA_A, SHA_C]), 'the positive control').not.toBeNull()
    expect(RT.parseMessageLog(second, [SHA_A, SHA_B]), 'a later record naming another commit').toBeNull()
    expect(RT.parseMessageLog(`${SHA_A}\0n\0e\0s\0b\x1e`, [SHA_A]), 'a truncated record').toBeNull()
    expect(RT.parseMessageLog('', []), 'nothing to parse').toBeNull()
  })

  it('a path named like a record boundary stays a path', () => {
    const hostile = `z\x1e${SHA_B}`
    const text = `\0${SHA_A}\0\nsrc/a.js\0${hostile}\0\nweird\0\0${SHA_B}\0\0${SHA_C}\0\nCHANGELOG.md\0`
    expect(RT.parsePathLog(text, [SHA_A, SHA_B, SHA_C])).toEqual([
      ['src/a.js', hostile, '\nweird'],
      [],
      ['CHANGELOG.md'],
    ])
  })

  it('refuses a path log that does not describe exactly the rev-list commits', () => {
    const good = `\0${SHA_A}\0\nCHANGELOG.md\0`
    expect(RT.parsePathLog(good, [SHA_A])).toEqual([['CHANGELOG.md']])
    expect(RT.parsePathLog(`\0${SHA_A}\0`, [SHA_A]), 'an empty commit').toEqual([[]])
    expect(RT.parsePathLog(good, [SHA_B]), 'another commit').toBeNull()
    expect(RT.parsePathLog(`\0${SHA_A}\0CHANGELOG.md\0`, [SHA_A]), 'no diff separator').toBeNull()
    expect(RT.parsePathLog(`${SHA_A}\0\nCHANGELOG.md\0`, [SHA_A]), 'no leading boundary').toBeNull()
    expect(RT.parsePathLog(`\0${SHA_A}\0\nCHANGELOG.md\0\0${SHA_B}\0`, [SHA_A]), 'an extra commit').toBeNull()
    expect(RT.parsePathLog(`\0${SHA_A}\0\n\0`, [SHA_A]), 'an empty path').toBeNull()
  })
})

// ---------------------------------------------------------------------------
// map over real repositories (AC-2, AC-3)
// ---------------------------------------------------------------------------

describe('map: one probe per class over a real repository (AC-2)', SPAWN_BUDGET, () => {
  let repo: string
  const sha: Record<string, string> = {}
  const HOSTILE_AUTHORS = {
    backtick: 'Ev`il Person',
    subshell: '$(touch pwned)',
    long65: 'a'.repeat(65),
    long64: 'b'.repeat(64),
    unicode: 'Zoë Ångström 李雷',
    bidi: 'abc\u202Edef',
    fakeMore: '- …and 9 more',
  } as const
  let trace: Trace
  let stdout: string

  beforeAll(() => {
    repo = newRepo('classes')
    git(repo, ['tag', 'v1.0.0'])
    sha.traced = commit(repo, { subject: 'feat: squash (#12)', body: 'Closes #3.', files: { 'src/t.js': '1' } })
    sha.releaseSubject = commit(repo, { subject: 'chore(release): v1.2.3', files: { VERSION: '1.2.3' } })
    sha.nearMiss = commit(repo, { subject: 'chore(release): record the release manifest', files: { m: '1' } })
    sha.changelogOnly = commit(repo, { subject: 'docs: changelog', files: { 'CHANGELOG.md': '1' } })
    sha.nestedChangelog = commit(repo, { subject: 'docs: pkg changelog', files: { 'docs/CHANGELOG.md': '1' } })
    sha.mixed = commit(repo, { subject: 'docs: changelog and code', files: { 'CHANGELOG.md': '2', 'src/a.js': 'a' } })
    sha.renameIntoChangelog = commit(repo, { subject: 'docs: move', mv: ['src/a.js', 'pkg/CHANGELOG.md'] })
    git(repo, ['revert', '--no-edit', sha.nearMiss])
    sha.gitRevert = git(repo, ['rev-parse', 'HEAD']).trim()
    sha.githubRevert = commit(repo, { subject: 'Revert "feat: something" (#21)', body: 'Reverts owner/repo#20', files: { r: '1' } })
    sha.subjectOnlyRevert = commit(repo, { subject: 'Revert "feat: other"', files: { r2: '1' } })
    sha.bot = commit(repo, {
      subject: 'chore: bump deps', files: { deps: '1' },
      author: { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' },
    })
    sha.botBare = commit(repo, {
      subject: 'chore: bump more', files: { deps: '2' },
      author: { name: 'dependabot[bot]', email: 'dependabot[bot]@users.noreply.github.com' },
    })
    sha.botForeign = commit(repo, {
      subject: 'chore: sneaky', files: { deps: '3' },
      author: { name: 'evil[bot]', email: 'evil[bot]@example.com' },
    })
    sha.empty = commit(repo, { subject: 'chore: empty', allowEmpty: true })
    sha.bareHash = commit(repo, { subject: 'fix: thing #12', files: { b: '1' } })
    // A body forging a record boundary for its parent (git cannot store the NUL it would need).
    sha.forgedBody = commit(repo, {
      subject: 'feat: forged body', body: `x\x1e\n${sha.empty}\nchore(release): v9.9.9`, files: { f: '1' },
    })
    // File names forging a path-log boundary and a diff separator.
    sha.forgedPaths = commit(repo, {
      subject: 'feat: forged paths', files: { [`z\x1e${sha.changelogOnly}`]: '1', 'we\nird': '1' },
    })
    for (const [k, name] of Object.entries(HOSTILE_AUTHORS)) {
      sha[`author-${k}`] = commit(repo, {
        subject: `feat: by ${k}`, files: { [`h-${k}`]: '1' }, author: { name, email: 'h@example.invalid' },
      })
    }
    const r = run(repo, ['map', '--from', 'v1.0.0', '--grammar', 'github'])
    expect(r.status, r.stderr).toBe(0)
    stdout = r.stdout
    trace = parseTrace(stdout)
  }, FIXTURE_BUDGET)

  it('classifies every probe as its rule says', () => {
    const expected: Record<string, string> = {
      traced: 'traced',
      releaseSubject: 'exempt:release',
      nearMiss: 'untraced',
      changelogOnly: 'exempt:release',
      nestedChangelog: 'exempt:release',
      mixed: 'untraced',
      renameIntoChangelog: 'untraced',
      gitRevert: 'exempt:revert',
      githubRevert: 'exempt:revert',
      subjectOnlyRevert: 'untraced',
      bot: 'exempt:bot',
      botBare: 'exempt:bot',
      botForeign: 'untraced',
      empty: 'untraced',
      bareHash: 'untraced',
      forgedBody: 'untraced',
      forgedPaths: 'untraced',
    }
    for (const k of Object.keys(HOSTILE_AUTHORS)) expected[`author-${k}`] = 'untraced'
    const got = Object.fromEntries(Object.keys(expected).map(k => [k, classOf(trace, sha[k])]))
    expect(got).toEqual(expected)
  })

  it('puts every scanned commit in exactly one class, and the counts sum', () => {
    const h = trace.header
    const scanned = Object.keys(sha).length
    expect(Number(h.scanned)).toBe(scanned)
    expect(Number(h.traced) + Number(h.untraced) + Number(h.exempt)).toBe(scanned)
    expect(Number(h.traced)).toBe(1)
    expect(trace.listed.size, 'every non-traced commit is listed once').toBe(scanned - 1)
    expect(h.bound).toBe('ok')
    expect(h.unmatched).toBe('0')
    expect(h.from).toBe('v1.0.0')
  })

  it('prints only gated author names — hostile names read `(unprintable)`', () => {
    const shown = (k: string) => trace.authors.get(sha[`author-${k}`].slice(0, 12))
    expect(shown('backtick')).toBe('(unprintable)')
    expect(shown('subshell')).toBe('(unprintable)')
    expect(shown('long65')).toBe('(unprintable)')
    expect(shown('bidi')).toBe('(unprintable)')
    expect(shown('fakeMore')).toBe('(unprintable)')
    expect(shown('long64')).toBe(HOSTILE_AUTHORS.long64)
    expect(shown('unicode')).toBe(HOSTILE_AUTHORS.unicode)
    for (const needle of ['`', '$(', 'a'.repeat(65), '\u202E', 'pwned', 'Closes', 'forged', 'squash', '\x1e', 'v9.9.9']) {
      expect(stdout.includes(needle), `stdout carries ${JSON.stringify(needle)}`).toBe(false)
    }
  })

  it('a --traced-file SHA in range is traced; one outside the scan is counted unmatched', () => {
    const tracedFile = path.join(tmp, 'traced-classes')
    const base = git(repo, ['rev-parse', 'v1.0.0^{commit}']).trim()
    fs.writeFileSync(tracedFile, `${sha.bareHash}\n${base}\n${sha.bareHash}\n`)
    const r = run(repo, ['map', '--from', 'v1.0.0', '--grammar', 'github', '--traced-file', tracedFile])
    expect(r.status, r.stderr).toBe(0)
    const t = parseTrace(r.stdout)
    expect(classOf(t, sha.bareHash)).toBe('traced')
    expect(t.header.traced).toBe('2')
    expect(t.header.unmatched, 'the base commit is outside the range; duplicates count once').toBe('1')
  })

  it('--from as a SHA prefix scans the same range', () => {
    const base = git(repo, ['rev-parse', 'v1.0.0^{commit}']).trim()
    const r = run(repo, ['map', '--from', base.slice(0, 12), '--grammar', 'github'])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.split('\n').slice(1)).toEqual(stdout.split('\n').slice(1))
    expect(parseTrace(r.stdout).header.from).toBe(base.slice(0, 12))
  })
})

describe('map: first-parent commits only (D4), and the jira grammar', SPAWN_BUDGET, () => {
  it('a merge-commit repository traces the merge, not the branch-internal commits', () => {
    const repo = newRepo('merges')
    git(repo, ['tag', 'v1.0.0'])
    git(repo, ['checkout', '-q', '-b', 'feat'])
    const wip1 = commit(repo, { subject: 'wip one', files: { w: '1' } })
    commit(repo, { subject: 'wip two', files: { w: '2' } })
    git(repo, ['checkout', '-q', 'main'])
    const direct = commit(repo, { subject: 'chore: direct push', files: { d: '1' } })
    git(repo, ['merge', '-q', '--no-ff', 'feat', '-m', 'Merge pull request #7 from o/feat', '-m', 'Feature title'])
    const merge = git(repo, ['rev-parse', 'HEAD']).trim()

    const plain = parseTrace(run(repo, ['map', '--from', 'v1.0.0', '--grammar', 'github']).stdout)
    expect(plain.header.scanned, 'the merge and the direct push only').toBe('2')
    expect(classOf(plain, merge)).toBe('untraced')
    expect(classOf(plain, direct)).toBe('untraced')
    expect(plain.listed.has(wip1.slice(0, 12))).toBe(false)

    const tracedFile = path.join(tmp, 'traced-merges')
    fs.writeFileSync(tracedFile, `${merge}\n${wip1}\n`)
    const r = run(repo, ['map', '--from', 'v1.0.0', '--grammar', 'github', '--traced-file', tracedFile])
    expect(r.status, r.stderr).toBe(0)
    const withFile = parseTrace(r.stdout)
    expect(classOf(withFile, merge)).toBe('traced')
    expect(withFile.header.unmatched, 'a branch-internal SHA is outside the first-parent scan').toBe('1')
  })

  it('a root commit inside the range is diffed against the empty tree even when the repository sets log.showRoot=false', () => {
    const repo = fs.mkdtempSync(path.join(tmp, 'root-in-range-'))
    git(repo, ['init', '-q', '-b', 'main'])
    const root = commit(repo, { subject: 'docs: first changelog', files: { 'CHANGELOG.md': '1' } })
    git(repo, ['checkout', '-q', '--orphan', 'unrelated'])
    git(repo, ['rm', '-rqf', '.'])
    commit(repo, { subject: 'chore: unrelated history', files: { u: '1' } })
    git(repo, ['tag', 'v1.0.0'])
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['config', 'log.showRoot', 'false'])
    const r = run(repo, ['map', '--from', 'v1.0.0', '--grammar', 'github'])
    expect(r.status, r.stderr).toBe(0)
    const t = parseTrace(r.stdout)
    expect(t.header.scanned).toBe('1')
    expect(classOf(t, root), 'the root commit changes CHANGELOG.md only').toBe('exempt:release')
  })

  it('jira: a same-key reference traces, a foreign key and a lowercase key do not; --key is upper-normalised', () => {
    const repo = newRepo('jira')
    git(repo, ['tag', '1.0.0'])
    const ok = commit(repo, { subject: 'feat: a', body: 'Refs KEY-9;', files: { a: '1' } })
    const foreign = commit(repo, { subject: 'feat: b', body: 'Refs OTHER-9', files: { b: '1' } })
    const lower = commit(repo, { subject: 'feat: c', body: 'refs key-10', files: { c: '1' } })
    const hash = commit(repo, { subject: 'feat: d', body: 'Closes #12', files: { d: '1' } })
    const r = run(repo, ['map', '--from', '1.0.0', '--grammar', 'jira', '--key', 'key'])
    expect(r.status, r.stderr).toBe(0)
    const t = parseTrace(r.stdout)
    expect([ok, foreign, lower, hash].map(s => classOf(t, s))).toEqual(['traced', 'untraced', 'untraced', 'untraced'])
  })
})

describe('map: the 500-commit bound (AC-2)', { timeout: 30_000 }, () => {
  let repo: string

  beforeAll(() => {
    repo = newRepo('bound')
    const base = git(repo, ['rev-parse', 'HEAD']).trim()
    git(repo, ['tag', 'v1.0.0'])
    const stream: string[] = []
    for (let i = 1; i <= 501; i++) {
      const msg = `chore: bulk ${i}\n`
      const content = `${i}\n`
      stream.push(
        'commit refs/heads/bulk', `mark :${i}`,
        `author Bulk <bulk@example.invalid> ${1_700_000_000 + i} +0000`,
        `committer Bulk <bulk@example.invalid> ${1_700_000_000 + i} +0000`,
        `data ${Buffer.byteLength(msg)}`, msg,
        i === 1 ? `from ${base}` : `from :${i - 1}`,
        'M 100644 inline bulk.txt', `data ${Buffer.byteLength(content)}`, content,
      )
    }
    git(repo, ['fast-import', '--quiet'], {}, `${stream.join('\n')}\n`)
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/bulk'])
    git(repo, ['tag', 'v1.0.1', 'bulk~500'])
  }, FIXTURE_BUDGET)

  it('501 commits ⇒ `bound:hit`, 500 classified, 100 listed and the rest counted', () => {
    const r = run(repo, ['map', '--from', 'v1.0.0', '--grammar', 'github'])
    expect(r.status, r.stderr).toBe(0)
    const t = parseTrace(r.stdout)
    expect(t.header.bound).toBe('hit')
    expect(t.header.scanned).toBe('500')
    expect(t.header.untraced).toBe('500')
    expect(t.lines).toHaveLength(1 + 100 + 1)
    expect(t.lines[101]).toBe('- …and 400 more')
    const oldest = git(repo, ['rev-parse', 'bulk~500']).trim()
    expect(t.listed.has(oldest.slice(0, 12)), 'the 501st commit is never classified').toBe(false)
    const newest = git(repo, ['rev-parse', 'bulk']).trim()
    expect(t.lines[1].startsWith(`- ${newest.slice(0, 12)} `), 'newest first').toBe(true)
  })

  it('exactly 500 commits ⇒ `bound:ok`', () => {
    const r = run(repo, ['map', '--from', 'v1.0.1', '--grammar', 'github'])
    expect(r.status, r.stderr).toBe(0)
    const t = parseTrace(r.stdout)
    expect(t.header.bound).toBe('ok')
    expect(t.header.scanned).toBe('500')
  })
})

// ---------------------------------------------------------------------------
// Hostile inputs and exit codes (AC-3)
// ---------------------------------------------------------------------------

describe('usage (exit 1, stdout empty)', () => {
  it.each([
    [[]],
    [['last-tag', 'extra']],
    [['map']],
    [['map', '--from', 'v1.0.0']],
    [['map', '--grammar', 'github']],
    [['map', '--from', 'v1.0.0', '--grammar', 'gitlab']],
    [['map', '--from', 'v1.0.0', '--grammar', 'jira']],
    [['map', '--from', 'v1.0.0', '--grammar', 'github', '--key', 'KEY']],
    [['map', '--from', 'v1.0.0', '--from', 'v1.0.0', '--grammar', 'github']],
    [['map', '--from=v1.0.0', '--grammar', 'github']],
    [['map', '--from', 'v1.0.0', '--grammar', 'github', '--traced-file']],
    [['map', '--from', 'v1.0.0', '--grammar', 'github', '--bogus', 'x']],
    [['--help']],
    [['lasttag']],
  ] as const)('%j', args => {
    const { exec, calls } = noCallExec()
    const r = runMain(args, { exec })
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/^Usage: /)
    expect(calls).toEqual([])
  })

  it('the real script prints nothing on stdout for a usage error', () => {
    const r = run(tmp, ['map', '--from'])
    expect(r.status).toBe(EXIT.USAGE)
    expect(r.stdout).toBe('')
  })
})

describe('gated inputs (exit 2) — refused before any git call, never echoed', () => {
  it.each([
    '-x', '--', '', 'HEAD', 'HEAD~1', 'main', 'v1.2.3; rm -rf ~', 'v1.2.3\n', 'v1.1.0-rc.1', 'ABCDEF1', 'abcdef',
    'a'.repeat(41), '$(id)', 'v1.2.3..HEAD', 'refs/tags/v1.2.3',
  ])('--from %j', from => {
    const { exec, calls } = noCallExec()
    const r = runMain(['map', '--from', from, '--grammar', 'github'], { exec })
    expect(r.code).toBe(EXIT.INPUT_UNUSABLE)
    expect(r.stdout).toBe('')
    expect(calls, 'no git call for a refused ref').toEqual([])
    expect(r.stderr).toBe(`release-trace: ${RT.REASONS.BAD_REF}\n`)
  })

  it.each(['A', '1AB', 'A-B', '$(id)', 'ABCDEFGHIJK', 'KEY ', 'ſKEY'])('--key %j', key => {
    const { exec, calls } = noCallExec()
    const r = runMain(['map', '--from', 'v1.0.0', '--grammar', 'jira', '--key', key], { exec })
    expect(r.code).toBe(EXIT.INPUT_UNUSABLE)
    expect(r.stdout).toBe('')
    expect(calls).toEqual([])
    expect(r.stderr).toBe(`release-trace: ${RT.REASONS.BAD_KEY}\n`)
  })

  it('--traced-file: anything but a regular file of lowercase 40-hex lines', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'traced-'))
    const file = (name: string, text: string): string => {
      const p = path.join(dir, name)
      fs.writeFileSync(p, text)
      return p
    }
    const target = file('target', `${SHA_A}\n`)
    const link = path.join(dir, 'link')
    fs.symlinkSync(target, link)
    const bad = [
      path.join(dir, 'missing'),
      dir,
      link,
      file('crlf', `${SHA_A}\r\n`),
      file('upper', `${SHA_A.toUpperCase()}\n`),
      file('short', `${'a'.repeat(39)}\n`),
      file('blank-line', `${SHA_A}\n\n${SHA_B}\n`),
      file('lone-newline', '\n'),
      file('prose', 'Closes #12\n'),
      file('oversize', `${SHA_A}\n`.repeat(1700)),
    ]
    for (const p of bad) {
      const { exec, calls } = noCallExec()
      const r = runMain(['map', '--from', 'v1.0.0', '--grammar', 'github', '--traced-file', p], { exec })
      expect(r.code, p).toBe(EXIT.INPUT_UNUSABLE)
      expect(calls).toEqual([])
      expect(r.stderr).toBe(`release-trace: ${RT.REASONS.BAD_TRACED_FILE}\n`)
    }
  })

  it('an unknown ref, a branch spelled like a tag, and a hex branch are exit 2 over real git', SPAWN_BUDGET, () => {
    const repo = newRepo('refs')
    git(repo, ['branch', 'v1.2.3'])
    git(repo, ['branch', 'deadbeef'])
    for (const from of ['v9.9.9', 'v1.2.3', 'deadbeef', 'abcdef0123']) {
      const r = run(repo, ['map', '--from', from, '--grammar', 'github'])
      expect(r.status, from).toBe(EXIT.INPUT_UNUSABLE)
      expect(r.stdout).toBe('')
      expect(r.stderr).toBe(`release-trace: ${RT.REASONS.UNKNOWN_REF}\n`)
    }
  })
})

describe('write failure (exit 3)', SPAWN_BUDGET, () => {
  it('an unwritable stdout exits 3; the same run into a writable file exits 0', () => {
    const repo = newRepo('write')
    git(repo, ['tag', 'v1.0.0'])
    const outFile = path.join(tmp, 'write-target.txt')
    fs.writeFileSync(outFile, '')

    const readOnly = fs.openSync(outFile, 'r')
    try {
      const r = spawnSync(process.execPath, [RELEASE_TRACE_SCRIPT, 'last-tag'], {
        cwd: repo, env: scopedEnv(home), stdio: ['ignore', readOnly, 'pipe'], timeout: 30_000,
      })
      expect(r.status).toBe(EXIT.WRITE_FAILED)
    } finally {
      fs.closeSync(readOnly)
    }

    const writable = fs.openSync(outFile, 'w')
    try {
      const r = spawnSync(process.execPath, [RELEASE_TRACE_SCRIPT, 'last-tag'], {
        cwd: repo, env: scopedEnv(home), stdio: ['ignore', writable, 'pipe'], timeout: 30_000,
      })
      expect(r.status).toBe(EXIT.OK)
    } finally {
      fs.closeSync(writable)
    }
    expect(fs.readFileSync(outFile, 'utf8')).toBe('LAST_TAG v1.0.0\n')
  })
})

describe('git failure (exit 4, stdout empty)', () => {
  it('outside a repository, over real git', SPAWN_BUDGET, () => {
    const notRepo = fs.mkdtempSync(path.join(tmp, 'map-not-a-repo-'))
    const r = run(notRepo, ['map', '--from', 'v1.0.0', '--grammar', 'github'])
    expect(r.status).toBe(EXIT.GIT_FAILURE)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe(`release-trace: ${RT.REASONS.NO_HEAD}\n`)
  })

  it.each([
    ['a spawn timeout', { revParse: { status: null, error: { code: 'ETIMEDOUT' } } }],
    ['an ENOBUFS rev-list', { revList: { status: null, error: { code: 'ENOBUFS' } } }],
    ['a rev-list line that is not a SHA', { revList: { status: 0, stdout: 'Closes #12\n' } }],
    ['a rev-list of 502 commits', { revList: { status: 0, stdout: `${SHA_B}\n`.repeat(502) } }],
    ['a failed message log', { revList: { status: 0, stdout: `${SHA_B}\n` }, messages: { status: 128, stdout: '' } }],
    ['a message log for another commit', {
      revList: { status: 0, stdout: `${SHA_B}\n` },
      messages: { status: 0, stdout: `${SHA_C}\0n\0e\0s\0b\x1e\n` },
      paths: { status: 0, stdout: `\0${SHA_B}\0` },
    }],
    ['a path log for another commit', {
      revList: { status: 0, stdout: `${SHA_B}\n` },
      messages: { status: 0, stdout: `${SHA_B}\0n\0e\0s\0b\x1e\n` },
      paths: { status: 0, stdout: `\0${SHA_C}\0` },
    }],
    ['a rev-parse answer that is not a SHA', { revParse: { status: 0, stdout: 'HEAD\n' } }],
  ] as const)('%s', (_label, answers) => {
    const r = runMain(['map', '--from', 'v1.0.0', '--grammar', 'github'], { exec: fakeGit(answers) })
    expect(r.code).toBe(EXIT.GIT_FAILURE)
    expect(r.stdout).toBe('')
  })

  it('an exec that throws is exit 4, labelled by class only', () => {
    const r = runMain(['last-tag'], { exec: () => { throw new TypeError('secret Closes #12') } })
    expect(r.code).toBe(EXIT.GIT_FAILURE)
    expect(r.stderr).toBe(`release-trace: ${RT.REASONS.INTERNAL} (TypeError)\n`)
  })
})

describe('output gate (exit 5)', () => {
  const answers = {
    revList: { status: 0, stdout: `${SHA_B}\n` },
    messages: { status: 0, stdout: `${SHA_B}\0Dev\0d@x\0feat: x\0\x1e\n` },
    paths: { status: 0, stdout: `\0${SHA_B}\0\nsrc/a.js\0` },
  } as const

  it('the fake repository traces cleanly without an injected render (positive control)', () => {
    const r = runMain(['map', '--from', 'v1.0.0', '--grammar', 'github'], { exec: fakeGit(answers) })
    expect(r.code, r.stderr).toBe(EXIT.OK)
    expect(r.stdout).toBe('TRACE from:v1.0.0 scanned:1 traced:0 untraced:1 exempt:0 unmatched:0 bound:ok\n- bbbbbbbbbbbb untraced author:Dev\n')
  })

  it.each([
    // Header matches this run and nothing is listed: only the sum (0 ≠ 1) refuses it.
    ['counts that do not sum', () => 'TRACE from:v1.0.0 scanned:1 traced:0 untraced:0 exempt:0 unmatched:0 bound:ok\n'],
    ['a header describing another run', () => 'TRACE from:v1.0.0 scanned:0 traced:0 untraced:0 exempt:0 unmatched:0 bound:ok\n'],
    ['a raw author', () => 'TRACE from:v1.0.0 scanned:1 traced:0 untraced:1 exempt:0 unmatched:0 bound:ok\n- bbbbbbbbbbbb untraced author:$(id)\n'],
    ['not a string', () => 7],
  ] as const)('%s', (_label, render) => {
    const r = runMain(['map', '--from', 'v1.0.0', '--grammar', 'github'], { exec: fakeGit(answers), render })
    expect(r.code).toBe(EXIT.OUTPUT_GATE_REFUSED)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe(`release-trace: ${RT.REASONS.GATE_REFUSED}\n`)
  })

  it('settleOutcome prints only closed shapes, and nothing on a non-zero code', () => {
    const header = 'TRACE from:v1.0.0 scanned:0 traced:0 untraced:0 exempt:0 unmatched:0 bound:ok\n'
    expect(RT.settleOutcome({ code: 0, stdout: 'LAST_TAG v1.0.0\n' })).toEqual({ code: 0, stdout: 'LAST_TAG v1.0.0\n' })
    expect(RT.settleOutcome({ code: 0, stdout: 'LAST_TAG none\n' })).toEqual({ code: 0, stdout: 'LAST_TAG none\n' })
    expect(RT.settleOutcome({ code: 0, stdout: header })).toEqual({ code: 0, stdout: header })
    expect(RT.settleOutcome({ code: 0, stdout: 'LAST_TAG sdlc-baseline\n' })).toEqual({ code: 5, stdout: '' })
    expect(RT.settleOutcome({ code: 0, stdout: '' })).toEqual({ code: 5, stdout: '' })
    for (const code of [1, 2, 3, 4, 5]) expect(RT.settleOutcome({ code, stdout: header })).toEqual({ code, stdout: '' })
    expect(RT.settleOutcome({ code: 9, stdout: header })).toEqual({ code: 4, stdout: '' })
    expect(RT.settleOutcome(null)).toEqual({ code: 4, stdout: '' })
  })
})

// ---------------------------------------------------------------------------
// The git argv (D-TRACE-PATHS, D-TRACE-MAILMAP, D-TRACE-SCAN)
// ---------------------------------------------------------------------------

describe('the git argv the script sends', SPAWN_BUDGET, () => {
  it('pins HEAD and --from once, walks one bounded first-parent range, and disables config-driven rewrites', () => {
    const repo = newRepo('argv')
    git(repo, ['tag', 'v1.0.0'])
    commit(repo, { subject: 'feat: a', files: { a: '1' } })
    const calls: string[][] = []
    const exec: ExecFn = (file, args, opts) => {
      calls.push([file, ...args])
      return spawnSync(file, args, { ...opts, cwd: repo, env: scopedEnv(home) }) as unknown as ExecResult
    }
    const r = runMain(['map', '--from', 'v1.0.0', '--grammar', 'github'], { exec, cwd: repo })
    expect(r.code, r.stderr).toBe(EXIT.OK)

    expect(calls.every(c => c[0] === 'git'), 'git only').toBe(true)
    expect(calls.map(c => (c[1] === '-c' ? c[3] : c[1]))).toEqual(['rev-parse', 'rev-parse', 'rev-list', 'log', 'log'])
    expect(calls[0]).toEqual(['git', 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    expect(calls[1]).toEqual(['git', 'rev-parse', '--verify', '--quiet', 'refs/tags/v1.0.0^{commit}'])
    const range = calls[2][calls[2].length - 1]
    expect(range).toMatch(/^[0-9a-f]{40}\.\.[0-9a-f]{40}$/)
    expect(calls[2]).toEqual(['git', 'rev-list', '--first-parent', '--max-count=501', range])
    for (const c of calls.slice(3)) {
      expect(c[c.length - 1], 'both logs walk the pinned range').toBe(range)
      expect(c).toContain('--first-parent')
    }
    expect(calls[3]).toContain('--no-use-mailmap')
    expect(calls[3], 'the raw ident (%an/%ae), never the mailmapped %aN/%aE').toContain('--format=%H%x00%an%x00%ae%x00%s%x00%b%x1e')
    expect(calls[4].slice(0, 3)).toEqual(['git', '-c', 'log.showRoot=true'])
    for (const flag of ['--no-renames', '--no-relative', '--ignore-submodules=none', '--diff-merges=first-parent', '-z']) {
      expect(calls[4]).toContain(flag)
    }
  })

  it('.mailmap cannot re-attribute a commit to a bot (raw ident), and diff.relative cannot hide a path', () => {
    const repo = newRepo('config')
    git(repo, ['tag', 'v1.0.0'])
    const human = commit(repo, { subject: 'feat: human', files: { 'sub/CHANGELOG.md': '1', 'src/x.js': '1' } })
    commit(repo, {
      subject: 'chore: mailmap',
      files: { '.mailmap': 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> devflow-test <devflow-test@example.invalid>\n' },
    })
    git(repo, ['config', 'log.mailmap', 'true'])
    git(repo, ['config', 'diff.relative', 'true'])
    const r = spawnSync(process.execPath, [RELEASE_TRACE_SCRIPT, 'map', '--from', 'v1.0.0', '--grammar', 'github'], {
      cwd: path.join(repo, 'sub'), env: scopedEnv(home), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    })
    expect(r.status, r.stderr).toBe(0)
    const t = parseTrace(r.stdout)
    expect(classOf(t, human), 'neither the mailmap nor the subdirectory changes the class').toBe('untraced')
    expect(t.authors.get(human.slice(0, 12))).toBe('devflow-test')
  })
})

// ---------------------------------------------------------------------------
// Install path (composeScripts)
// ---------------------------------------------------------------------------

describe('install path pin', SPAWN_BUDGET, () => {
  it('composeScripts puts release-trace.cjs at the top level, and the INSTALLED copy runs under {"type":"module"}', async () => {
    const target = path.join(fs.mkdtempSync(path.join(tmp, 'install-')), 'scripts')
    await composeScripts(target)
    const installed = path.join(target, 'release-trace.cjs')
    expect(fs.existsSync(installed), 'release-trace.cjs must land at the top of the scripts dir').toBe(true)
    expect(fs.readFileSync(installed, 'utf8')).toBe(SOURCE)
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')) as { type?: string }
    expect(pkg.type, 'the pin is only meaningful under the ESM package marker').toBe('module')

    const repo = newRepo('installed')
    git(repo, ['tag', 'v3.1.4'])
    const r = run(repo, ['last-tag'], installed)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('LAST_TAG v3.1.4\n')
  })
})

// ---------------------------------------------------------------------------
// Source guards (PF-064: named collector, non-empty corpus, known-bad probe)
// ---------------------------------------------------------------------------

function codeLines(source: string): string[] {
  return source.split('\n').map(l => (/^\s*(\*|\/\/|\/\*)/.test(l) ? '' : l))
}

/** Every way to reach a shell or a second spawn path; exactly one childProcess.spawnSync. */
function collectShellSpawns(source: string): string[] {
  const code = codeLines(source).join('\n')
  const out: string[] = []
  for (const m of code.matchAll(/shell:\s*true|\bexec(?:File)?Sync\s*\(|childProcess\.exec(?:File)?\s*\(|\bspawn\s*\(/g)) out.push(m[0])
  if ([...code.matchAll(/childProcess\.spawnSync\s*\(/g)].length !== 1) out.push('spawnSync call sites ≠ 1')
  return out
}

/** The function each `io.exec(` call site sits in. */
function collectExecSites(source: string): string[] {
  const sites: string[] = []
  let current = '(top level)'
  for (const line of codeLines(source)) {
    const fn = /^function (\w+)\(/.exec(line)
    if (fn) current = fn[1]
    if (/\bio\.exec\(/.test(line)) sites.push(current)
  }
  return sites
}

/**
 * git( call sites whose argv carries a revision not built by the gated builders:
 * rev-parse must live in resolveCommit (fed by commitRev), and rev-list/log must
 * walk `range` (from rangeRev).
 */
function collectUngatedRevisions(source: string): string[] {
  const code = codeLines(source).join('\n')
  const out: string[] = []
  for (const m of code.matchAll(/\bgit\(io, \[/g)) {
    const start = m.index ?? 0
    const end = code.indexOf(']', start)
    const argv = code.slice(start, end === -1 ? start + 400 : end + 1).replace(/\s+/g, ' ')
    if (/'rev-list'|'log'/.test(argv) && !/, range\]$/.test(argv)) out.push(argv)
    if (/'rev-parse'/.test(argv) && !/, rev\]$/.test(argv)) out.push(argv)
  }
  for (const line of codeLines(source)) {
    if (/^function resolveCommit\(/.test(line)) continue
    for (const m of line.matchAll(/\bresolveCommit\(io, ([^)]*\)?)/g)) {
      if (!m[1].startsWith('commitRev(')) out.push(m[0])
    }
  }
  return out
}

/** refuse( calls whose reason is not a REASONS entry (optionally + the error class label). */
function collectOpenReasons(source: string): string[] {
  return codeLines(source)
    .filter(l => /\brefuse\(io, /.test(l) && !/^function refuse\(/.test(l.trim()))
    .filter(l => !/refuse\(io, EXIT_CODES\.[A-Z_]+, REASONS\.[A-Z_]+(?: \+ ' \(' \+ errorLabel\(err\) \+ '\)')?\)/.test(l))
}

describe('source guards (release-trace.cjs)', () => {
  it('no shell, no exec, one production spawnSync', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(collectShellSpawns(SOURCE)).toEqual([])
    const probe = `${SOURCE}\nfunction bad() { childProcess.${'exec'}Sync('git log'); ${'spawn'}Sync('x', [], { shell: true }) }`
    expect(collectShellSpawns(probe).length).toBeGreaterThanOrEqual(2)
  })

  it('every subprocess goes through git() — the only place the argv, timeout and maxBuffer are set', () => {
    const sites = collectExecSites(SOURCE)
    expect(sites.length, 'the corpus must hold the one exec call').toBeGreaterThanOrEqual(1)
    expect([...new Set(sites)]).toEqual(['git'])
    const probe = `${SOURCE}\nfunction sneaky(io) {\n  return io.exec('sh', ['-c', 'x'], {});\n}\n`
    expect(collectExecSites(probe)).toContain('sneaky')
  })

  it('every revision reaches git through commitRev() or rangeRev()', () => {
    const calls = [...codeLines(SOURCE).join('\n').matchAll(/\bgit\(io, \[/g)]
    expect(calls.length, 'the corpus must hold the git calls').toBeGreaterThanOrEqual(5)
    expect(collectUngatedRevisions(SOURCE)).toEqual([])
    expect(collectUngatedRevisions(`${SOURCE}\nconst x = git(io, ['log', '--format=%s', args.from], 1, 1);\n`)).toHaveLength(1)
    expect(collectUngatedRevisions(`${SOURCE}\nconst y = resolveCommit(io, args.from + '^{commit}');\n`)).toHaveLength(1)
  })

  it('stderr carries REASONS only — no input is ever interpolated (D-TRACE-STDERR)', () => {
    const sites = codeLines(SOURCE).filter(l => /\brefuse\(io, /.test(l))
    expect(sites.length, 'the corpus must hold the refusals').toBeGreaterThanOrEqual(10)
    expect(collectOpenReasons(SOURCE)).toEqual([])
    expect(collectOpenReasons(`${SOURCE}\n    return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'bad ref ' + args.from);\n`)).toHaveLength(1)
    for (const reason of Object.values(RT.REASONS)) expect(reason).not.toMatch(/\$\{|\n/)
    const stderrWrites = codeLines(SOURCE).filter(l => /\bio\.stderr\(|process\.stderr\.write\(/.test(l))
    expect(stderrWrites.map(l => l.trim()).sort()).toEqual([
      "io.stderr('release-trace: ' + reason + '\\n');",
      'io.stderr(USAGE + \'\\n\');',
      "process.stderr.write('release-trace: ' + REASONS.INTERNAL + ' (' + errorLabel(err) + ')\\n');",
      'stderr: typeof d.stderr === \'function\' ? d.stderr : (text => { process.stderr.write(text); }),',
    ].sort())
  })

  it('requires only node built-ins', () => {
    const requires = [...SOURCE.matchAll(/\brequire\(((?:[^()]|\([^()]*\))*)\)/g)].map(m => m[1])
    expect(requires).toEqual(["'fs'", "'path'", "'child_process'"])
  })

  it('writes stdout once, at the boundary, and never calls process.exit', () => {
    const code = codeLines(SOURCE).join('\n')
    expect([...code.matchAll(/process\.stdout\.write\(/g)]).toHaveLength(1)
    expect(code).not.toMatch(/process\.exit\(/)
    expect(code).toMatch(/if \(require\.main === module\)/)
  })

  it('documents every exit code in the header', () => {
    for (const code of [0, 1, 2, 3, 4, 5]) expect(SOURCE).toMatch(new RegExp(`^//\\s+${code}\\s+`, 'm'))
  })

  it('carries each design decision at its code site', () => {
    for (const marker of [
      'D-TRACE-STDOUT', 'D-TRACE-BOUNDS', 'D-TRACE-LAST-TAG', 'D-TRACE-NORMALISE', 'D-TRACE-EXEMPT',
      'D-TRACE-EXEMPT-EMPTY', 'D-TRACE-CLASSIFY', 'D-TRACE-GATE', 'D-TRACE-PARSE', 'D-TRACE-PATHS',
      'D-TRACE-MAILMAP', 'D-TRACE-SCAN', 'D-TRACE-STDERR',
    ]) {
      expect(SOURCE, `${marker} missing`).toContain(marker)
    }
  })
})
