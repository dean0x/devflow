/**
 * tests/evidence/resolve-base-process.test.ts
 *
 * The process half of the suite for src/assets/scripts/resolve-base.cjs (#495). The
 * behaviour matrix lives in resolve-base.test.ts; this file holds what concerns the
 * child processes the script starts:
 *
 *   AC-12 The exact fetch argv, never --filter or --depth. The repository's hook,
 *         fsmonitor and upload-pack settings do not run for the fetch (each sentinel has a
 *         positive control: a plain git command in the same repository does run it).
 *   AC-13 The fetch environment. Credential prompts are off: the terminal prompt, the
 *         askpass programs and the SSH prompt. BatchMode and ConnectTimeout are added only
 *         when no SSH command is configured; a configured command is left unchanged;
 *         host-key checks are never weakened. Read from the stub's calls and, end to end,
 *         from a fake ssh in front of PATH.
 *   AC-14 The 45 s backstop: a hung fetch returns REASON timeout inside the bound and no
 *         process of its group survives (POSIX).
 *   AC-15 The bounds of the local calls and the run budget. A local git call that gives no
 *         answer (a timeout or a signal kill) gives resolver-unavailable, at every call
 *         site, in both modes. Each call takes the smaller of its own bound and the time
 *         left in the run budget, which stays below the 120 s Bash tool limit.
 *   The source reaches git through argv arrays, with shell false and no exec call.
 *
 * Every spawn names its cwd and takes its environment from scopedEnv(), so the developer's
 * HOME, git config and ssh settings never reach a fixture.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { RESOLVE_BASE_SCRIPT } from './seam.js'
import { realGit, scopedEnv } from '../evidence-policy/scripted-shim.js'

// ---------------------------------------------------------------------------
// The .cjs seam: transcribed from the module's JSDoc; open it before changing
// ---------------------------------------------------------------------------

interface SpawnResult {
  status: number | null
  stdout?: string | Buffer
  stderr?: string | Buffer
  error?: { code?: string }
  signal?: string | null
  pid?: number
}
type SpawnFn = (file: string, args: string[], opts: Record<string, unknown>) => SpawnResult
interface Deps {
  spawn?: SpawnFn
  env?: NodeJS.ProcessEnv
  cwd?: string
  timeoutMs?: number
  platform?: string
  now?: () => number
}
interface ResolveBase {
  readonly FETCH_TIMEOUT_MS: number
  readonly LOCAL_TIMEOUT_MS: number
  readonly RUN_BUDGET_MS: number
  readonly LINE_RE: RegExp
  fetchArgv(name: string, platform?: string): string[]
  main(argv: readonly string[], deps?: Deps): { code: number; line: string }
}

const req = createRequire(import.meta.url)
const RB = req(RESOLVE_BASE_SCRIPT) as ResolveBase
const SOURCE = fs.readFileSync(RESOLVE_BASE_SCRIPT, 'utf-8')

const SPAWN_BUDGET = { timeout: 30_000 } as const
const POSIX = process.platform !== 'win32'
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'
const SHA = 'a'.repeat(40)

// ---------------------------------------------------------------------------
// AC-12: the exact argv, read from a recording stub
// ---------------------------------------------------------------------------

interface Call { readonly file: string; readonly args: readonly string[]; readonly opts: Record<string, unknown> }

/** Answers every call the script makes on the happy path; records each one. */
function stubSpawn(o: { sshCommandConfigured?: boolean | 'unknown'; fetchStatus?: number } = {}): { spawn: SpawnFn; calls: Call[] } {
  const calls: Call[] = []
  const reply = (status: number, stdout = ''): SpawnResult => ({ status, stdout: Buffer.from(stdout), stderr: Buffer.from('') })
  const spawn: SpawnFn = (file, args, opts) => {
    calls.push({ file, args: [...args], opts })
    const rest = [...args]
    while (rest[0] === '-c') rest.splice(0, 2)
    const sub = rest[0]
    if (sub === 'check-ref-format') return reply(0)
    if (sub === 'config') {
      if (rest.includes('remote.origin.url')) return reply(0, 'https://example.invalid/r.git\n')
      if (rest.includes('core.sshCommand')) {
        if (o.sshCommandConfigured === 'unknown') return reply(128)
        return o.sshCommandConfigured === true ? reply(0, 'ssh -i key\n') : reply(1)
      }
    }
    if (sub === 'fetch') return reply(o.fetchStatus ?? 0)
    if (sub === 'rev-parse') return reply(0, `${SHA}\n`)
    if (sub === 'merge-base' && rest[1] === '--is-ancestor') return reply(0)
    if (sub === 'merge-base') return reply(0, `${SHA}\n`)
    return reply(97)
  }
  return { spawn, calls }
}

const run = (name: string, mode: 'local' | 'pr', deps: Deps): { code: number; line: string } =>
  RB.main(['node', 'resolve-base.cjs', mode, name], { cwd: '/work/tree', ...deps })

const fetchCall = (calls: readonly Call[]): Call => {
  const found = calls.filter(c => c.args.includes('fetch'))
  expect(found, 'exactly one fetch call').toHaveLength(1)
  return found[0]
}

describe('the fetch argv (AC-12)', () => {
  it('is exactly the contract\'s argv, with the full refspec for the branch', () => {
    const { spawn, calls } = stubSpawn()
    run('feature/x', 'pr', { spawn, env: { PATH: '/bin' } })
    expect(fetchCall(calls).file).toBe('git')
    expect(fetchCall(calls).args).toEqual([
      '-c', 'core.fsmonitor=false',
      '-c', `core.hooksPath=${NULL_DEVICE}`,
      'fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--no-auto-maintenance',
      '--no-show-forced-updates', '--quiet', '--upload-pack=git-upload-pack',
      'origin', '+refs/heads/feature/x:refs/remotes/origin/feature/x',
    ])
  })

  it('uses the null device of the platform for the hooks path', () => {
    expect(RB.fetchArgv('main', 'linux')).toContain('core.hooksPath=/dev/null')
    expect(RB.fetchArgv('main', 'darwin')).toContain('core.hooksPath=/dev/null')
    expect(RB.fetchArgv('main', 'win32')).toContain('core.hooksPath=NUL')
    expect(RB.fetchArgv('main', 'linux')).toEqual(RB.fetchArgv('main', 'darwin'))
  })

  it('never passes --filter or --depth, in any call', () => {
    const { spawn, calls } = stubSpawn()
    run('main', 'local', { spawn, env: { PATH: '/bin' } })
    expect(calls.length).toBeGreaterThan(5)
    for (const c of calls) {
      for (const a of c.args) expect(a).not.toMatch(/^--(filter|depth)\b/)
    }
  })

  it('starts every other git call with the fsmonitor override and passes argv arrays with no shell', () => {
    const { spawn, calls } = stubSpawn()
    run('main', 'local', { spawn, env: { PATH: '/bin' } })
    for (const c of calls) {
      expect(c.file).toBe('git')
      expect(c.args.slice(0, 2), c.args.join(' ')).toEqual(['-c', 'core.fsmonitor=false'])
      expect(c.opts.shell).toBe(false)
      expect(c.opts.stdio).toEqual(['ignore', 'pipe', 'pipe'])
      expect(c.opts.cwd).toBe('/work/tree')
      expect(typeof c.opts.timeout).toBe('number')
      expect(typeof c.opts.maxBuffer).toBe('number')
    }
  })

  it('bounds the fetch at the 45 s constant and every local call at the 30 s constant below it', () => {
    expect(RB.FETCH_TIMEOUT_MS).toBe(45_000)
    expect(RB.LOCAL_TIMEOUT_MS).toBe(30_000)
    expect(RB.LOCAL_TIMEOUT_MS).toBeLessThan(RB.FETCH_TIMEOUT_MS)
    const { spawn, calls } = stubSpawn()
    run('main', 'local', { spawn, env: { PATH: '/bin' } })
    expect(fetchCall(calls).opts.timeout).toBe(45_000)
    const local = calls.filter(x => !x.args.includes('fetch'))
    expect(local.length).toBeGreaterThan(5)
    for (const c of local) expect(c.opts.timeout, c.args.join(' ')).toBe(RB.LOCAL_TIMEOUT_MS)
  })

  it('makes one fetch for one run and orders the checks before it', () => {
    const { spawn, calls } = stubSpawn()
    run('main', 'local', { spawn, env: { PATH: '/bin' } })
    const subs = calls.map(c => c.args.filter(a => a !== '-c' && !a.includes('=')).slice(0, 2).join(' '))
    expect(subs.filter(s => s.startsWith('fetch'))).toHaveLength(1)
    expect(subs.indexOf('check-ref-format refs/heads/main')).toBe(0)
    expect(subs.findIndex(s => s.startsWith('config --get'))).toBe(1)
    expect(subs.findIndex(s => s.startsWith('fetch'))).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// AC-13: environment and the SSH rule
// ---------------------------------------------------------------------------

describe('the fetch environment (AC-13)', () => {
  const BATCH = 'ssh -o BatchMode=yes -o ConnectTimeout=5'
  const PROMPTS_OFF = {
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', SSH_ASKPASS_REQUIRE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', LC_ALL: 'C',
  }

  interface Row {
    readonly name: string
    readonly env: Record<string, string>
    readonly stub?: { sshCommandConfigured?: boolean | 'unknown' }
    readonly want: string | undefined
  }
  const ROWS: readonly Row[] = [
    { name: 'no SSH command anywhere: BatchMode and ConnectTimeout are added', env: {}, want: BATCH },
    { name: 'GIT_SSH_COMMAND set: left unchanged', env: { GIT_SSH_COMMAND: 'my-ssh -i key' }, want: 'my-ssh -i key' },
    { name: 'GIT_SSH_COMMAND set but empty: still counts as configured', env: { GIT_SSH_COMMAND: '' }, want: '' },
    { name: 'GIT_SSH set: no GIT_SSH_COMMAND is added', env: { GIT_SSH: '/opt/ssh-wrapper' }, want: undefined },
    { name: 'core.sshCommand configured: no GIT_SSH_COMMAND is added', env: {}, stub: { sshCommandConfigured: true }, want: undefined },
    { name: 'core.sshCommand cannot be read: treated as configured', env: {}, stub: { sshCommandConfigured: 'unknown' }, want: undefined },
  ]

  it.each(ROWS.map(r => [r.name, r] as const))('%s', (_name, row) => {
    const { spawn, calls } = stubSpawn(row.stub)
    run('main', 'pr', { spawn, env: { PATH: '/bin', ...row.env } })
    const env = fetchCall(calls).opts.env as NodeJS.ProcessEnv
    expect(env.GIT_SSH_COMMAND).toBe(row.want)
    if ('GIT_SSH' in row.env) expect(env.GIT_SSH).toBe(row.env.GIT_SSH)
  })

  it('turns prompts off in every call, over the caller\'s own values', () => {
    const { spawn, calls } = stubSpawn()
    run('main', 'pr', {
      spawn,
      env: {
        PATH: '/bin', GIT_TERMINAL_PROMPT: '1', GCM_INTERACTIVE: 'always', SSH_ASKPASS_REQUIRE: 'force',
        GIT_ASKPASS: '/usr/local/bin/askpass', SSH_ASKPASS: '/opt/ssh-askpass', LC_ALL: 'de_DE.UTF-8',
      },
    })
    expect(calls.length).toBeGreaterThan(5)
    for (const c of calls) expect(c.opts.env, c.args.join(' ')).toMatchObject(PROMPTS_OFF)
  })

  interface PromptRow { readonly name: string; readonly env: Record<string, string>; readonly want: Record<string, string> }
  const PROMPT_ROWS: readonly PromptRow[] = [
    { name: 'no caller value: GIT_ASKPASS and SSH_ASKPASS are set, to the empty string', env: {}, want: { GIT_ASKPASS: '', SSH_ASKPASS: '' } },
    { name: 'GIT_ASKPASS set by the caller: empty for the fetch', env: { GIT_ASKPASS: '/usr/local/bin/askpass' }, want: { GIT_ASKPASS: '', SSH_ASKPASS: '' } },
    { name: 'SSH_ASKPASS set by the caller: empty for the fetch', env: { SSH_ASKPASS: '/opt/ssh-askpass' }, want: { GIT_ASKPASS: '', SSH_ASKPASS: '' } },
    { name: 'a terminal prompt asked for by the caller: off for the fetch', env: { GIT_TERMINAL_PROMPT: '1' }, want: { GIT_TERMINAL_PROMPT: '0' } },
    { name: 'an askpass forced by the caller: never for the fetch', env: { SSH_ASKPASS_REQUIRE: 'force' }, want: { SSH_ASKPASS_REQUIRE: 'never' } },
    { name: 'a configured SSH command keeps its text, and the prompts stay off', env: { GIT_SSH_COMMAND: 'my-ssh -i key', GIT_ASKPASS: '/bin/askpass' }, want: { GIT_SSH_COMMAND: 'my-ssh -i key', GIT_ASKPASS: '' } },
  ]

  it.each(PROMPT_ROWS.map(r => [r.name, r] as const))('%s', (_name, row) => {
    const { spawn, calls } = stubSpawn()
    run('main', 'pr', { spawn, env: { PATH: '/bin', ...row.env } })
    expect(fetchCall(calls).opts.env).toMatchObject(row.want)
  })

  it('gives the other calls no GIT_SSH_COMMAND of their own', () => {
    const { spawn, calls } = stubSpawn()
    run('main', 'pr', { spawn, env: { PATH: '/bin' } })
    for (const c of calls.filter(x => !x.args.includes('fetch'))) {
      expect((c.opts.env as NodeJS.ProcessEnv).GIT_SSH_COMMAND, c.args.join(' ')).toBeUndefined()
    }
  })

  it('never weakens a host-key check, in the added option string or anywhere in the script', () => {
    const { spawn, calls } = stubSpawn()
    run('main', 'pr', { spawn, env: { PATH: '/bin' } })
    const env = fetchCall(calls).opts.env as NodeJS.ProcessEnv
    expect(env.GIT_SSH_COMMAND).not.toMatch(/StrictHostKeyChecking|UserKnownHostsFile|CheckHostIP/i)
    expect(SOURCE).not.toMatch(/StrictHostKeyChecking|UserKnownHostsFile|CheckHostIP/i)
  })
})

// ---------------------------------------------------------------------------
// AC-15: the local bounds, the run budget, and a local call that gives no answer
// ---------------------------------------------------------------------------

type Mode = 'local' | 'pr'
type Site =
  | 'check-ref-format' | 'config remote.origin.url' | 'config core.sshCommand'
  | 'rev-parse local tip' | 'rev-parse origin tip'
  | 'merge-base local tip' | 'merge-base origin tip' | 'merge-base --is-ancestor'
  | 'rev-parse chosen base'

const TIP_LOCAL = 'c'.repeat(40)
const TIP_ORIGIN = 'd'.repeat(40)
const BASE_LOCAL = 'a'.repeat(40)
const BASE_ORIGIN = 'b'.repeat(40)

/** Names the call site of one script call from its argv; the local and origin tips have distinct ids. */
function siteOf(args: readonly string[]): Site | 'fetch' {
  const rest = [...args]
  while (rest[0] === '-c') rest.splice(0, 2)
  const [sub, second] = rest
  const last = rest[rest.length - 1]
  if (sub === 'fetch') return 'fetch'
  if (sub === 'check-ref-format') return 'check-ref-format'
  if (sub === 'config') return rest.includes('remote.origin.url') ? 'config remote.origin.url' : 'config core.sshCommand'
  if (sub === 'rev-parse') {
    if (last === 'refs/heads/main^{commit}') return 'rev-parse local tip'
    if (last === 'refs/remotes/origin/main^{commit}') return 'rev-parse origin tip'
    return 'rev-parse chosen base'
  }
  if (second === '--is-ancestor') return 'merge-base --is-ancestor'
  return second === TIP_LOCAL ? 'merge-base local tip' : 'merge-base origin tip'
}

const ok = (stdout = ''): SpawnResult => ({ status: 0, stdout: Buffer.from(stdout), stderr: Buffer.from('') })
const HAPPY: Readonly<Record<Site | 'fetch', SpawnResult>> = {
  'check-ref-format': ok(),
  'config remote.origin.url': ok('https://example.invalid/r.git\n'),
  'config core.sshCommand': { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('') },
  'fetch': ok(),
  'rev-parse local tip': ok(`${TIP_LOCAL}\n`),
  'rev-parse origin tip': ok(`${TIP_ORIGIN}\n`),
  'merge-base local tip': ok(`${BASE_LOCAL}\n`),
  'merge-base origin tip': ok(`${BASE_ORIGIN}\n`),
  'merge-base --is-ancestor': ok(),
  'rev-parse chosen base': ok(`${BASE_ORIGIN}\n`),
}

/** Answers every call by its site; `unanswered` replaces the answer at one site. Records the sites and the calls. */
function siteStub(unanswered?: { site: Site; result: SpawnResult }, onCall?: (site: Site | 'fetch') => SpawnResult | undefined): { spawn: SpawnFn; sites: (Site | 'fetch')[]; calls: Call[] } {
  const sites: (Site | 'fetch')[] = []
  const calls: Call[] = []
  const spawn: SpawnFn = (file, args, opts) => {
    calls.push({ file, args: [...args], opts })
    const site = siteOf(args)
    sites.push(site)
    const timed = onCall?.(site)
    if (timed !== undefined) return timed
    return unanswered !== undefined && unanswered.site === site ? unanswered.result : HAPPY[site]
  }
  return { spawn, sites, calls }
}

const FRESH = `BASE_REF=${BASE_ORIGIN} TIP=origin FETCH=ok REASON=fresh NOTE=none`

describe('a local git call that gives no answer (AC-15)', () => {
  /** Where each local call sits against the fetch decides FETCH in the stop line. */
  const SITES: readonly { readonly site: Site; readonly modes: readonly Mode[]; readonly fetch: 'skipped' | 'ok' }[] = [
    { site: 'check-ref-format', modes: ['local', 'pr'], fetch: 'skipped' },
    { site: 'config remote.origin.url', modes: ['local', 'pr'], fetch: 'skipped' },
    { site: 'config core.sshCommand', modes: ['local', 'pr'], fetch: 'skipped' },
    { site: 'rev-parse local tip', modes: ['local', 'pr'], fetch: 'ok' },
    { site: 'rev-parse origin tip', modes: ['local', 'pr'], fetch: 'ok' },
    { site: 'merge-base local tip', modes: ['local', 'pr'], fetch: 'ok' },
    { site: 'merge-base origin tip', modes: ['local', 'pr'], fetch: 'ok' },
    { site: 'merge-base --is-ancestor', modes: ['local'], fetch: 'ok' },
    { site: 'rev-parse chosen base', modes: ['local', 'pr'], fetch: 'ok' },
  ]
  const KINDS: readonly { readonly kind: string; readonly result: SpawnResult }[] = [
    { kind: 'times out', result: { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } } },
    { kind: 'is killed by a signal', result: { status: null, signal: 'SIGKILL' } },
  ]

  it.each(['local', 'pr'] as const)('control: in %s mode every call answers, the stub reaches every listed site and the line is fresh', mode => {
    const { spawn, sites } = siteStub()
    expect(run('main', mode, { spawn, env: { PATH: '/bin' } }).line).toBe(FRESH)
    const expected = SITES.filter(s => s.modes.includes(mode)).map(s => s.site)
    expect(new Set(sites)).toEqual(new Set([...expected, 'fetch']))
  })

  const ROWS = SITES.flatMap(s => s.modes.flatMap(mode => KINDS.map(k => ({ mode, site: s.site, fetch: s.fetch, kind: k.kind, result: k.result }))))

  it.each(ROWS.map(r => [`${r.mode} mode: ${r.site} ${r.kind}`, r] as const))('%s', (_name, row) => {
    const { spawn, sites } = siteStub({ site: row.site, result: row.result })
    const out = run('main', row.mode, { spawn, env: { PATH: '/bin' } })
    expect(sites, 'the call site was reached').toContain(row.site)
    expect(out).toEqual({ code: 0, line: `BASE_REF=none TIP=none FETCH=${row.fetch} REASON=resolver-unavailable NOTE=stop` })
  })

  it('an answer that is an error exit of git itself keeps its own reason: an ancestry check that exits 128 gives no-merge-base', () => {
    const { spawn } = siteStub({ site: 'merge-base --is-ancestor', result: { status: 128, stdout: Buffer.from(''), stderr: Buffer.from('') } })
    expect(run('main', 'local', { spawn, env: { PATH: '/bin' } }).line)
      .toBe('BASE_REF=none TIP=none FETCH=ok REASON=no-merge-base NOTE=stop')
  })
})

describe('the run budget (AC-15)', () => {
  it('stays below the 120 s Bash tool limit and above the fetch bound', () => {
    expect(RB.RUN_BUDGET_MS).toBeLessThan(120_000)
    expect(RB.RUN_BUDGET_MS).toBeGreaterThan(RB.FETCH_TIMEOUT_MS)
  })

  /** A clock the stub moves forward by `stepMs` per call. */
  function clocked(stepMs: number, fetchResult?: SpawnResult): { deps: Deps; calls: Call[]; sites: (Site | 'fetch')[] } {
    let t = 0
    const { spawn: inner, calls, sites } = siteStub(undefined, site => (site === 'fetch' ? fetchResult : undefined))
    const spawn: SpawnFn = (file, args, opts) => { const r = inner(file, args, opts); t += stepMs; return r }
    return { deps: { spawn, env: { PATH: '/bin' }, now: () => t }, calls, sites }
  }
  const timeouts = (calls: readonly Call[]): unknown[] => calls.map(c => c.opts.timeout)

  it('gives each call the smaller of its own bound and the time left, and starts no call once the budget is spent', () => {
    // each call takes 40 s: the third call has 20 s left, the fetch and every call after it have none
    const { deps, calls } = clocked(40_000)
    const out = run('main', 'pr', deps)
    expect(timeouts(calls)).toEqual([30_000, 30_000, 20_000])
    expect(out.line).toBe('BASE_REF=none TIP=none FETCH=failed REASON=resolver-unavailable NOTE=stop')
  })

  it('bounds the fetch by the time left when that is less than its own 45 s', () => {
    // each call takes 30 s: 10 s of the budget are left when the fetch starts, and the fetch uses them
    const { deps, calls } = clocked(30_000, { status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT' } })
    const out = run('main', 'pr', deps)
    expect(timeouts(calls)).toEqual([30_000, 30_000, 30_000, 10_000])
    expect(out.line).toBe('BASE_REF=none TIP=none FETCH=failed REASON=resolver-unavailable NOTE=stop')
  })

  it('does not start a local call that has no time left and gives resolver-unavailable', () => {
    // each call takes 13 s: the check of the chosen base would start at 104 s
    const { deps, calls, sites } = clocked(13_000)
    const out = run('main', 'pr', deps)
    expect(sites).not.toContain('rev-parse chosen base')
    expect(timeouts(calls)).toEqual([30_000, 30_000, 30_000, 45_000, 30_000, 30_000, 22_000, 9_000])
    expect(out.line).toBe('BASE_REF=none TIP=none FETCH=ok REASON=resolver-unavailable NOTE=stop')
  })

  it('leaves the line of a run inside the budget unchanged', () => {
    const { deps } = clocked(1_000)
    expect(run('main', 'local', deps).line).toBe(FRESH)
  })
})

// ---------------------------------------------------------------------------
// Real git fixtures for the end-to-end rows
// ---------------------------------------------------------------------------

let tmp: string
let fakeBin: string
let realGitPath: string

/** A fake ssh that logs how it was started to $SSH_LOG, then fails the connection. */
const LOG_SCRIPT = [
  '#!/bin/sh',
  '{',
  '  printf "bin:%s\\n" "$0"',
  '  for a in "$@"; do printf "arg:%s\\n" "$a"; done',
  '  printf "env:GIT_TERMINAL_PROMPT=%s\\n" "$GIT_TERMINAL_PROMPT"',
  '  printf "env:GCM_INTERACTIVE=%s\\n" "$GCM_INTERACTIVE"',
  '  printf "env:SSH_ASKPASS_REQUIRE=%s\\n" "$SSH_ASKPASS_REQUIRE"',
  '  printf "env:GIT_ASKPASS=%s\\n" "$GIT_ASKPASS"',
  '  printf "env:SSH_ASKPASS=%s\\n" "$SSH_ASKPASS"',
  '  printf "env:LC_ALL=%s\\n" "$LC_ALL"',
  '} >> "$SSH_LOG"',
  'exit 255',
  '',
].join('\n')

/** A fetch that never ends, with a helper in the same process group; every other command is the real git. */
const HUNG_GIT = [
  '#!/bin/sh',
  'for a in "$@"; do',
  '  if [ "$a" = "fetch" ]; then',
  '    sleep 120 &',
  '    printf "%s %s\\n" "$$" "$!" > "$FAKE_PIDS"',
  '    wait',
  '    exit 0',
  '  fi',
  'done',
  'exec "$REAL_GIT" "$@"',
  '',
].join('\n')

const FAKE_DIRS = ['ssh-path', 'ssh-env', 'ssh-gitssh', 'ssh-config'] as const

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-resolve-base-proc-'))
  fakeBin = path.join(tmp, 'bin')
  fs.mkdirSync(fakeBin)
  const which = spawnSync('sh', ['-c', 'command -v git'], { cwd: tmp, env: scopedEnv(tmp), encoding: 'utf8', timeout: 10_000 })
  realGitPath = (which.stdout ?? '').trim()
  // macOS scans a newly written executable on its first run, which can take seconds: write every
  // fake once and run it once here, so no test's budget absorbs the scan
  const warmExtra = { SSH_LOG: path.join(tmp, 'warm.log'), REAL_GIT: realGitPath, FAKE_PIDS: path.join(tmp, 'warm.pids') }
  for (const dir of FAKE_DIRS) {
    spawnSync(writeExecutable(path.join(fakeBin, dir, 'ssh'), LOG_SCRIPT), ['warm-up'], { cwd: tmp, env: scopedEnv(tmp, warmExtra), stdio: 'ignore', timeout: 40_000 })
  }
  spawnSync(writeExecutable(path.join(fakeBin, 'hung', 'git'), HUNG_GIT), ['--version'], { cwd: tmp, env: scopedEnv(tmp, warmExtra), stdio: 'ignore', timeout: 40_000 })
}, 240_000)

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const git = (cwd: string, home: string, ...args: string[]): string => realGit(cwd, home, args).trim()

function put(dir: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), text)
}

function commitFile(dir: string, home: string, rel: string): string {
  put(dir, rel, `${rel}\n`)
  git(dir, home, 'add', '--', rel)
  git(dir, home, 'commit', '-q', '-m', `add ${rel}`)
  return git(dir, home, 'rev-parse', 'HEAD')
}

interface World { readonly root: string; readonly home: string; readonly remote: string; readonly work: string; readonly seed: string; readonly m0: string }

/** A bare origin with main at one commit, a clone of it, and a seed clone that can advance the origin. */
function newWorld(): World {
  const root = fs.mkdtempSync(path.join(tmp, 'w-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home)
  const remote = path.join(root, 'remote.git')
  const seed = path.join(root, 'seed')
  git(root, home, 'init', '-q', '--bare', '-b', 'main', remote)
  git(root, home, 'init', '-q', '-b', 'main', seed)
  const m0 = commitFile(seed, home, 'm0.txt')
  git(seed, home, 'remote', 'add', 'origin', remote)
  git(seed, home, 'push', '-q', 'origin', 'main')
  git(root, home, 'clone', '-q', remote, 'work')
  const work = path.join(root, 'work')
  git(work, home, 'checkout', '-q', '-b', 'feat')
  commitFile(work, home, 'feature.txt')
  return { root, home, remote, work, seed, m0 }
}

function advanceOrigin(w: World, rel: string): string {
  const sha = commitFile(w.seed, w.home, rel)
  git(w.seed, w.home, 'push', '-q', 'origin', 'main')
  return sha
}

function writeExecutable(p: string, text: string): string {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
  fs.chmodSync(p, 0o755)
  return p
}

const cleanEnv = (home: string, extra: Record<string, string>): NodeJS.ProcessEnv => {
  const env = scopedEnv(home, extra)
  for (const key of ['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS']) if (!(key in extra)) delete env[key]
  return env
}

// ---------------------------------------------------------------------------
// AC-12: the repository's own settings do not run for the fetch
// ---------------------------------------------------------------------------

describe.skipIf(!POSIX)('repository settings do not run for the fetch (AC-12)', SPAWN_BUDGET, () => {
  it('a hook, an fsmonitor command and an upload-pack program stay silent, where a plain git command runs each', () => {
    const w = newWorld()
    const sentinels = path.join(w.root, 'sentinels')
    fs.mkdirSync(sentinels)
    const hook = path.join(sentinels, 'hook')
    const upload = path.join(sentinels, 'upload-pack')
    const fsmonitor = path.join(sentinels, 'fsmonitor')
    writeExecutable(path.join(w.work, '.git', 'hooks', 'reference-transaction'), `#!/bin/sh\ntouch "${hook}"\n`)
    writeExecutable(path.join(w.root, 'upload.sh'), `#!/bin/sh\ntouch "${upload}"\nexec git-upload-pack "$@"\n`)
    writeExecutable(path.join(w.root, 'fsmonitor.sh'), `#!/bin/sh\ntouch "${fsmonitor}"\n`)
    git(w.work, w.home, 'config', 'remote.origin.uploadpack', path.join(w.root, 'upload.sh'))
    git(w.work, w.home, 'config', 'core.fsmonitor', path.join(w.root, 'fsmonitor.sh'))
    const m1 = advanceOrigin(w, 'm1.txt')
    const clear = (): void => { for (const f of [hook, upload, fsmonitor]) fs.rmSync(f, { force: true }) }
    // macOS scans a newly written executable on its first run, which can take seconds: run each once now
    for (const script of [path.join(w.work, '.git', 'hooks', 'reference-transaction'), path.join(w.root, 'upload.sh'), path.join(w.root, 'fsmonitor.sh')]) {
      spawnSync(script, ['warm-up'], { cwd: w.root, env: scopedEnv(w.home), stdio: 'ignore', timeout: 40_000 })
    }
    clear()

    // positive controls: the same repository runs all three for ordinary commands
    git(w.work, w.home, 'fetch', '-q', 'origin', 'main')
    git(w.work, w.home, 'status', '--porcelain')
    expect(fs.existsSync(hook), 'control: the hook runs for a plain fetch').toBe(true)
    expect(fs.existsSync(upload), 'control: the upload-pack program runs for a plain fetch').toBe(true)
    expect(fs.existsSync(fsmonitor), 'control: the fsmonitor command runs for a plain status').toBe(true)

    git(w.work, w.home, 'update-ref', 'refs/remotes/origin/main', w.m0)
    clear()
    expect(git(w.work, w.home, 'rev-parse', 'refs/remotes/origin/main')).toBe(w.m0)

    const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], { cwd: w.work, env: cleanEnv(w.home, {}) })
    expect(out.line).toMatch(RB.LINE_RE)
    expect(out.line).toContain('FETCH=ok')
    expect(git(w.work, w.home, 'rev-parse', 'refs/remotes/origin/main'), 'the fetch ran and moved the ref').toBe(m1)
    expect(fs.existsSync(hook), 'the hook did not run').toBe(false)
    expect(fs.existsSync(upload), 'the upload-pack program did not run').toBe(false)
    expect(fs.existsSync(fsmonitor), 'the fsmonitor command did not run').toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC-13: end to end, with a fake ssh in front of PATH
// ---------------------------------------------------------------------------

describe.skipIf(!POSIX)('the SSH rule end to end (AC-13)', SPAWN_BUDGET, () => {
  const fakeDir = (name: typeof FAKE_DIRS[number]): string => path.join(fakeBin, name)

  /** Run main() in-process against an ssh:// origin; the fake ssh logs and fails the fetch. */
  function runOverSsh(extraEnv: Record<string, string>, configure?: (w: World) => void): { log: string[]; line: string } {
    const w = newWorld()
    const sshLog = path.join(w.root, 'ssh.log')
    git(w.work, w.home, 'remote', 'set-url', 'origin', 'ssh://devflow-fake-host.invalid/repo.git')
    configure?.(w)
    const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], {
      cwd: w.work,
      env: cleanEnv(w.home, { PATH: `${fakeDir('ssh-path')}${path.delimiter}${process.env.PATH ?? ''}`, SSH_LOG: sshLog, ...extraEnv }),
    })
    expect(out.code).toBe(0)
    const log = fs.existsSync(sshLog) ? fs.readFileSync(sshLog, 'utf8').split('\n').filter(Boolean) : []
    return { log, line: out.line }
  }

  const sshArgs = (log: readonly string[]): string[] => log.filter(l => l.startsWith('arg:')).map(l => l.slice(4))

  it('adds BatchMode and ConnectTimeout, turns prompts off, and keeps the fetch\'s failure a degraded line on the cached ref', () => {
    const { log, line } = runOverSsh({ GIT_TERMINAL_PROMPT: '1', GIT_ASKPASS: '/usr/bin/true', SSH_ASKPASS: '/usr/bin/true', LC_ALL: 'de_DE.UTF-8' })
    const args = sshArgs(log)
    expect(args.join(' ')).toContain('-o BatchMode=yes -o ConnectTimeout=5')
    expect(args.join(' ')).not.toMatch(/StrictHostKeyChecking|UserKnownHostsFile/i)
    expect(log).toContain('env:GIT_TERMINAL_PROMPT=0')
    expect(log).toContain('env:GCM_INTERACTIVE=never')
    expect(log).toContain('env:SSH_ASKPASS_REQUIRE=never')
    expect(log).toContain('env:GIT_ASKPASS=')
    expect(log).toContain('env:SSH_ASKPASS=')
    expect(log).toContain('env:LC_ALL=C')
    expect(line).toMatch(/^BASE_REF=[0-9a-f]{40} TIP=origin FETCH=failed REASON=fetch-failed NOTE=degraded$/)
  })

  it('leaves a configured GIT_SSH_COMMAND unchanged', () => {
    const { log } = runOverSsh({ GIT_SSH_COMMAND: path.join(fakeDir('ssh-env'), 'ssh') })
    expect(log.some(l => l.startsWith('bin:') && l.includes('ssh-env'))).toBe(true)
    expect(log.some(l => l.includes('ssh-path'))).toBe(false)
    expect(sshArgs(log).join(' ')).not.toMatch(/BatchMode|ConnectTimeout/)
  })

  it('leaves a configured GIT_SSH program unchanged', () => {
    const { log } = runOverSsh({ GIT_SSH: path.join(fakeDir('ssh-gitssh'), 'ssh') })
    expect(log.some(l => l.startsWith('bin:') && l.includes('ssh-gitssh'))).toBe(true)
    expect(log.some(l => l.includes('ssh-path'))).toBe(false)
    expect(sshArgs(log).join(' ')).not.toMatch(/BatchMode|ConnectTimeout/)
  })

  it('leaves a configured core.sshCommand unchanged', () => {
    const { log } = runOverSsh({}, w => {
      git(w.work, w.home, 'config', 'core.sshCommand', path.join(fakeDir('ssh-config'), 'ssh'))
    })
    expect(log.some(l => l.startsWith('bin:') && l.includes('ssh-config'))).toBe(true)
    expect(log.some(l => l.includes('ssh-path'))).toBe(false)
    expect(sshArgs(log).join(' ')).not.toMatch(/BatchMode|ConnectTimeout/)
  })
})

// ---------------------------------------------------------------------------
// AC-14: the backstop and the process group
// ---------------------------------------------------------------------------

describe.skipIf(!POSIX)('the 45 s backstop (AC-14)', SPAWN_BUDGET, () => {
  const hungGit = (): string => path.join(fakeBin, 'hung', 'git')

  const alive = (pid: number): boolean => {
    try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
  }

  async function gone(pids: readonly number[]): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
      if (pids.every(p => !alive(p))) return true
      await new Promise(r => setTimeout(r, 50))
    }
    return false
  }

  const readPids = (file: string): number[] => fs.readFileSync(file, 'utf8').trim().split(/\s+/).map(Number)

  it('returns REASON timeout inside the bound, on the cached ref, and leaves no process of the group alive', async () => {
    const w = newWorld()
    const pidFile = path.join(w.root, 'pids')
    const env = scopedEnv(w.home, { PATH: `${path.dirname(hungGit())}${path.delimiter}${process.env.PATH ?? ''}`, REAL_GIT: realGitPath, FAKE_PIDS: pidFile })

    const started = Date.now()
    const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], { cwd: w.work, env, timeoutMs: 1_000 })
    const elapsed = Date.now() - started

    expect(out.line).toBe(`BASE_REF=${w.m0} TIP=origin FETCH=failed REASON=timeout NOTE=degraded`)
    expect(elapsed, 'returns within the injected bound plus the local calls').toBeLessThan(20_000)
    const pids = readPids(pidFile)
    expect(pids).toHaveLength(2)
    expect(await gone(pids), 'no process of the fetch group survives').toBe(true)
  })

  it('control: the plain timeout kill alone leaves the helper of the group alive', async () => {
    const w = newWorld()
    const pidFile = path.join(w.root, 'pids')
    const extra = { REAL_GIT: realGitPath, FAKE_PIDS: pidFile }

    spawnSync(hungGit(), ['fetch'], { cwd: w.root, env: scopedEnv(w.home, extra), stdio: 'ignore', timeout: 800, killSignal: 'SIGKILL', detached: true })
    const [leader, helper] = readPids(pidFile)
    try {
      expect(alive(helper), 'without a group kill the helper outlives its leader').toBe(true)
    } finally {
      try { process.kill(-leader, 'SIGKILL') } catch { /* already gone */ }
      try { process.kill(helper, 'SIGKILL') } catch { /* already gone */ }
    }
    expect(await gone([helper])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Source guard: argv arrays, shell false, no exec call
// ---------------------------------------------------------------------------

/** Source with comment lines blanked, so prose never counts as code. */
function codeOf(source: string): string {
  return source.split('\n').map(l => (/^\s*(\*|\/\/|\/\*)/.test(l) ? '' : l)).join('\n')
}

const SPAWN_SITE = /\b(?:spawnSync|spawn)\s*\(/g

/** The paren-balanced argument list that starts at the opening parenthesis `open`. */
function argList(code: string, open: number): string {
  let depth = 0
  for (let i = open; i < code.length && i < open + 2000; i++) {
    if (code[i] === '(') depth++
    if (code[i] === ')') depth--
    if (depth === 0) return code.slice(open, i + 1)
  }
  return code.slice(open, open + 2000)
}

/**
 * Named collector: how a source starts a process other than through an argv array with the
 * shell off. An exec-family call, `shell: true`, a spawn whose second argument is not an
 * array literal or whose options do not say `shell: false`, and the --filter/--depth flags.
 */
function collectProcessDefects(source: string): string[] {
  const code = codeOf(source)
  const defects: string[] = []
  if (/\bexec(?:File)?(?:Sync)?\s*\(/.test(code)) defects.push('an exec-family call')
  if (/\bshell\s*:\s*true\b/.test(code)) defects.push('shell: true')
  if (/['"`]--(?:filter|depth)\b/.test(code)) defects.push('a --filter or --depth flag')
  for (const m of code.matchAll(SPAWN_SITE)) {
    const args = argList(code, (m.index ?? 0) + m[0].length - 1)
    if (!/^\(\s*[\w.'"]+\s*,\s*\[/.test(args)) defects.push(`a spawn without an argv array literal: ${args.slice(0, 60)}`)
    if (!/\bshell\s*:\s*false\b/.test(args)) defects.push(`a spawn without shell: false: ${args.slice(0, 60)}`)
  }
  return defects
}

describe('how the script starts a process', () => {
  it('has spawn sites to inspect', () => {
    expect([...codeOf(SOURCE).matchAll(SPAWN_SITE)].length).toBeGreaterThanOrEqual(1)
  })

  it('uses argv arrays with the shell off, no exec call and none of the partial-clone flags', () => {
    expect(collectProcessDefects(SOURCE)).toEqual([])
  })

  it('flags each known-bad probe through the same collector', () => {
    const probes: ReadonlyArray<readonly [string, string]> = [
      ['an exec call', "const { exec } = require('child_process'); exec('git fetch ' + base)"],
      ['an execSync call', `childProcess.${'exec'}Sync('git fetch origin ' + base)`],
      ['shell: true', `childProcess.${'spawn'}Sync('git', ['fetch'], { shell: true })`],
      ['a command string', `childProcess.${'spawn'}Sync('git fetch origin', { shell: false })`],
      ['a spawn with no shell option', "ctx.spawn(file, [...args], { cwd })"],
      ['an argv held in a variable', 'ctx.spawn(file, args, { shell: false })'],
      ['--filter', "const flags = ['--filter=blob:none']"],
      ['--depth', "const flags = ['--depth', '1']"],
    ]
    for (const [name, probe] of probes) expect(collectProcessDefects(probe), name).not.toEqual([])
    expect(collectProcessDefects("ctx.spawn(file, [...args], { cwd, shell: false })")).toEqual([])
  })
})
