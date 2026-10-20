/**
 * tests/evidence/resolve-base-process.test.ts
 *
 * The process half of the suite for src/assets/scripts/resolve-base.cjs (#495). The
 * behaviour matrix lives in resolve-base.test.ts; this file holds what concerns the
 * child processes the script starts:
 *
 *   AC-12 The exact fetch argv, never --filter or --depth. The repository's hook,
 *         fsmonitor and upload-pack settings do not run for the fetch (each sentinel has a
 *         positive control: a plain git command in the same repository does run it). The
 *         exact argv holds the fsmonitor override itself; the end-to-end row holds that the
 *         command stays silent for a real run, and a second row shows the override alone
 *         silences it once the fetch reads the index.
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
import { spawnSync, type SpawnSyncOptions } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { RESOLVE_BASE_SCRIPT, SUBPROCESS_TIMEOUT_MS } from './seam.js'
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
  fetchTimeoutMs?: number
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

const SPAWN_BUDGET = { timeout: SUBPROCESS_TIMEOUT_MS } as const
const POSIX = process.platform !== 'win32'
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

// ---------------------------------------------------------------------------
// The recording stub shared by the argv, environment and bound rows
// ---------------------------------------------------------------------------

interface Call { readonly file: string; readonly args: readonly string[]; readonly opts: Record<string, unknown> }

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

/** The two arguments every local git call of the script starts with. */
const LOCAL_OVERRIDE = ['-c', 'core.fsmonitor=false'] as const

/** What the stub names a call: a listed local site, the fetch, or `unknown` for any other argv. */
type Seen = Site | 'fetch' | 'unknown'

/** The exact argv of each listed local site, after the override; the local and origin tips have distinct ids. */
const LOCAL_ARGV: Readonly<Record<Site, readonly string[]>> = {
  'check-ref-format': ['check-ref-format', 'refs/heads/main'],
  'config remote.origin.url': ['config', '--get', 'remote.origin.url'],
  'config core.sshCommand': ['config', '--get', 'core.sshCommand'],
  'rev-parse local tip': ['rev-parse', '--verify', '--quiet', 'refs/heads/main^{commit}'],
  'rev-parse origin tip': ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}'],
  'merge-base local tip': ['merge-base', TIP_LOCAL, 'HEAD'],
  'merge-base origin tip': ['merge-base', TIP_ORIGIN, 'HEAD'],
  'merge-base --is-ancestor': ['merge-base', '--is-ancestor', BASE_LOCAL, BASE_ORIGIN],
  'rev-parse chosen base': ['rev-parse', '--verify', '--quiet', `${BASE_ORIGIN}^{commit}`],
}

const sameArgv = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/** Names the call site of one script call from its exact argv; any argv that matches no listed site is `unknown`. */
function siteOf(args: readonly string[]): Seen {
  const rest = [...args]
  while (rest[0] === '-c') rest.splice(0, 2)
  if (rest[0] === 'fetch') return 'fetch'
  if (!sameArgv(args.slice(0, LOCAL_OVERRIDE.length), LOCAL_OVERRIDE)) return 'unknown'
  const local = args.slice(LOCAL_OVERRIDE.length)
  const listed = (Object.entries(LOCAL_ARGV) as [Site, readonly string[]][]).find(([, argv]) => sameArgv(argv, local))
  return listed === undefined ? 'unknown' : listed[0]
}

const exit = (status: number, stdout = ''): SpawnResult => ({ status, stdout: Buffer.from(stdout), stderr: Buffer.from('') })
const ok = (stdout = ''): SpawnResult => exit(0, stdout)
const HAPPY: Readonly<Record<Site | 'fetch', SpawnResult>> = {
  'check-ref-format': ok(),
  'config remote.origin.url': ok('https://example.invalid/r.git\n'),
  'config core.sshCommand': exit(1),
  'fetch': ok(),
  'rev-parse local tip': ok(`${TIP_LOCAL}\n`),
  'rev-parse origin tip': ok(`${TIP_ORIGIN}\n`),
  'merge-base local tip': ok(`${BASE_LOCAL}\n`),
  'merge-base origin tip': ok(`${BASE_ORIGIN}\n`),
  'merge-base --is-ancestor': ok(),
  'rev-parse chosen base': ok(`${BASE_ORIGIN}\n`),
}

/** The answer to a call that matches no listed site: an error exit the script does not expect. */
const UNLISTED: SpawnResult = exit(97)

/**
 * Answers every call by its site; `unanswered` replaces the answer at one site, and `onCall` may answer
 * any call first (it sees the site and the full argv). Records the sites and the calls.
 */
function siteStub(
  unanswered?: { site: Site; result: SpawnResult },
  onCall?: (site: Seen, args: readonly string[]) => SpawnResult | undefined,
): { spawn: SpawnFn; sites: Seen[]; calls: Call[] } {
  const sites: Seen[] = []
  const calls: Call[] = []
  const spawn: SpawnFn = (file, args, opts) => {
    calls.push({ file, args: [...args], opts })
    const site = siteOf(args)
    sites.push(site)
    const timed = onCall?.(site, args)
    if (timed !== undefined) return timed
    if (site === 'unknown') return UNLISTED
    return unanswered !== undefined && unanswered.site === site ? unanswered.result : HAPPY[site]
  }
  return { spawn, sites, calls }
}

/** The happy path of `siteStub`, with the answer of the core.sshCommand read that a row may change. */
function stubSpawn(o: { sshCommandConfigured?: boolean | 'unknown' } = {}): { spawn: SpawnFn; calls: Call[] } {
  const { spawn, calls } = siteStub(undefined, site => {
    if (site !== 'config core.sshCommand') return undefined
    if (o.sshCommandConfigured === 'unknown') return exit(128)
    return o.sshCommandConfigured === true ? ok('ssh -i key\n') : undefined
  })
  return { spawn, calls }
}

const run = (name: string, mode: 'local' | 'pr', deps: Deps): { code: number; line: string } =>
  RB.main(['node', 'resolve-base.cjs', mode, name], { cwd: '/work/tree', ...deps })

const fetchCall = (calls: readonly Call[]): Call => {
  const found = calls.filter(c => c.args.includes('fetch'))
  expect(found, 'exactly one fetch call').toHaveLength(1)
  return found[0]
}

// ---------------------------------------------------------------------------
// AC-12: the exact argv, read from a recording stub
// ---------------------------------------------------------------------------

/** The contract's fetch argv for one branch, written out in full. */
const contractFetchArgv = (name: string): string[] => [
  '-c', 'core.fsmonitor=false',
  '-c', `core.hooksPath=${NULL_DEVICE}`,
  '-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=45',
  'fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--no-auto-maintenance',
  '--no-show-forced-updates', '--quiet', '--refmap=', '--upload-pack=git-upload-pack',
  'origin', `+refs/heads/${name}:refs/remotes/origin/${name}`,
]

describe('the fetch argv (AC-12)', () => {
  it('is exactly the contract\'s argv, with the full refspec for the branch', () => {
    const { spawn, calls } = stubSpawn()
    run('main', 'pr', { spawn, env: { PATH: '/bin' } })
    expect(fetchCall(calls).file).toBe('git')
    expect(fetchCall(calls).args).toEqual(contractFetchArgv('main'))
    expect(RB.fetchArgv('feature/x'), 'a branch name with a slash').toEqual(contractFetchArgv('feature/x'))
  })

  it('carries its own HTTP stall bound, no longer than the fetch bound, so a fetch that outlives its caller ends by itself', () => {
    const argv = RB.fetchArgv('main')
    const valueOf = (key: string): string | undefined => argv.find(a => a.startsWith(`${key}=`))?.slice(key.length + 1)
    expect(valueOf('http.lowSpeedLimit')).toBe('1')
    const seconds = Number(valueOf('http.lowSpeedTime'))
    expect(Number.isInteger(seconds) && seconds > 0, 'a positive whole number of seconds').toBe(true)
    expect(seconds * 1000).toBeLessThanOrEqual(RB.FETCH_TIMEOUT_MS)
    for (const key of ['http.lowSpeedLimit', 'http.lowSpeedTime']) {
      expect(argv[argv.indexOf(`${key}=${valueOf(key)}`) - 1], `${key} is a -c option`).toBe('-c')
      expect(argv.indexOf(`${key}=${valueOf(key)}`), `${key} comes before the subcommand`).toBeLessThan(argv.indexOf('fetch'))
    }
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
    expect(sites, 'every call the script makes matches a listed site').not.toContain('unknown')
    const expected = SITES.filter(s => s.modes.includes(mode)).map(s => s.site)
    expect(new Set(sites)).toEqual(new Set([...expected, 'fetch']))
  })

  it('control: an argv that matches no listed site is reported as unknown, so a new local call fails the control', () => {
    const unlisted: readonly (readonly string[])[] = [
      [...LOCAL_OVERRIDE, 'rev-parse', '--git-dir'],
      [...LOCAL_OVERRIDE, 'rev-parse', '--verify', '--quiet', 'refs/heads/other^{commit}'],
      [...LOCAL_OVERRIDE, 'merge-base', '--octopus', TIP_LOCAL, 'HEAD'],
      [...LOCAL_OVERRIDE, 'merge-base', 'e'.repeat(40), 'HEAD'],
      [...LOCAL_OVERRIDE, 'config', '--get', 'user.name'],
      [...LOCAL_OVERRIDE, 'status'],
      ['rev-parse', '--verify', '--quiet', `${BASE_ORIGIN}^{commit}`],
    ]
    for (const argv of unlisted) expect(siteOf(argv), argv.join(' ')).toBe('unknown')
    const { spawn, sites } = siteStub()
    for (const argv of unlisted) spawn('git', [...argv], {})
    expect(sites).toEqual(unlisted.map(() => 'unknown'))
  })

  const ROWS = SITES.flatMap(s => s.modes.flatMap(mode => KINDS.map(k => ({ mode, site: s.site, fetch: s.fetch, kind: k.kind, result: k.result }))))

  it.each(ROWS.map(r => [`${r.mode} mode: ${r.site} ${r.kind}`, r] as const))('%s', (_name, row) => {
    const { spawn, sites } = siteStub({ site: row.site, result: row.result })
    const out = run('main', row.mode, { spawn, env: { PATH: '/bin' } })
    expect(sites, 'the call site was reached').toContain(row.site)
    expect(sites, 'every call the script makes matches a listed site').not.toContain('unknown')
    expect(out).toEqual({ code: 0, line: `BASE_REF=none TIP=none FETCH=${row.fetch} REASON=resolver-unavailable NOTE=stop` })
  })

  it('an answer that is an error exit of git itself keeps its own reason: an ancestry check that exits 128 gives no-merge-base', () => {
    const { spawn } = siteStub({ site: 'merge-base --is-ancestor', result: exit(128) })
    expect(run('main', 'local', { spawn, env: { PATH: '/bin' } }).line)
      .toBe('BASE_REF=none TIP=none FETCH=ok REASON=no-merge-base NOTE=stop')
  })

  /** An exit the call site does not accept: the format check, the origin URL, a tip read, the commit check of the chosen base. */
  const ANSWERED: readonly { readonly site: Site; readonly kind: string; readonly result: SpawnResult }[] = [
    { site: 'check-ref-format', kind: 'exits 128', result: exit(128) },
    { site: 'config remote.origin.url', kind: 'exits 2', result: exit(2) },
    { site: 'config remote.origin.url', kind: 'exits 128', result: exit(128) },
    { site: 'rev-parse local tip', kind: 'exits 128', result: exit(128) },
    { site: 'rev-parse local tip', kind: 'exits 0 with no commit id', result: ok('main\n') },
    { site: 'rev-parse local tip', kind: 'exits 128 with a commit id on stdout', result: exit(128, `${TIP_LOCAL}\n`) },
    { site: 'rev-parse origin tip', kind: 'exits 128', result: exit(128) },
    { site: 'rev-parse origin tip', kind: 'exits 0 with no commit id', result: ok('main\n') },
    { site: 'rev-parse origin tip', kind: 'exits 128 with a commit id on stdout', result: exit(128, `${TIP_ORIGIN}\n`) },
    { site: 'rev-parse chosen base', kind: 'names another commit', result: ok(`${'e'.repeat(40)}\n`) },
    { site: 'rev-parse chosen base', kind: 'exits 1', result: exit(1) },
  ]
  const BY_SITE = Object.fromEntries(SITES.map(s => [s.site, s])) as Record<Site, typeof SITES[number]>
  const ANSWERED_ROWS = ANSWERED.flatMap(a => BY_SITE[a.site].modes.map(mode => ({ ...a, mode, fetch: BY_SITE[a.site].fetch })))

  it.each(ANSWERED_ROWS.map(r => [`${r.mode} mode: ${r.site} ${r.kind}`, r] as const))('%s gives resolver-unavailable', (_name, row) => {
    const { spawn, sites } = siteStub({ site: row.site, result: row.result })
    const out = run('main', row.mode, { spawn, env: { PATH: '/bin' } })
    expect(sites, 'the call site was reached').toContain(row.site)
    expect(sites, 'every call the script makes matches a listed site').not.toContain('unknown')
    expect(out).toEqual({ code: 0, line: `BASE_REF=none TIP=none FETCH=${row.fetch} REASON=resolver-unavailable NOTE=stop` })
  })

  /** With no origin URL the local tip is chosen, and its commit check names BASE_LOCAL, which is not a listed site. */
  const LOCAL_COMMIT_CHECK = [...LOCAL_OVERRIDE, 'rev-parse', '--verify', '--quiet', `${BASE_LOCAL}^{commit}`]

  it.each([
    ['an empty value', ok('')],
    ['a missing key', exit(1)],
  ] as const)('an origin URL that is %s gives no-origin on the local tip and makes no fetch', (_kind, result) => {
    const { spawn, sites, calls } = siteStub({ site: 'config remote.origin.url', result }, (site, args) =>
      site === 'unknown' && sameArgv(args, LOCAL_COMMIT_CHECK) ? ok(`${BASE_LOCAL}\n`) : undefined)
    const out = run('main', 'local', { spawn, env: { PATH: '/bin' } })
    expect(out).toEqual({ code: 0, line: `BASE_REF=${BASE_LOCAL} TIP=local FETCH=skipped REASON=no-origin NOTE=info` })
    expect(sites, 'no fetch and no SSH read').not.toContain('fetch')
    expect(sites).not.toContain('config core.sshCommand')
    expect(calls.filter((_, i) => sites[i] === 'unknown').map(c => c.args), 'the one unlisted call is the commit check of the local base')
      .toEqual([LOCAL_COMMIT_CHECK])
  })
})

describe('the run budget (AC-15)', () => {
  it('stays below the 120 s Bash tool limit and above the fetch bound', () => {
    expect(RB.RUN_BUDGET_MS).toBeLessThan(120_000)
    expect(RB.RUN_BUDGET_MS).toBeGreaterThan(RB.FETCH_TIMEOUT_MS)
  })

  /** A clock the stub moves forward by `stepMs` per call. */
  function clocked(stepMs: number, fetchResult?: SpawnResult): { deps: Deps; calls: Call[]; sites: Seen[] } {
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
/** The hook directory, the upload-pack program and the fsmonitor command that the AC-12 test points a repository at. */
let settingsDir: string
/** Where those three programs leave a file when they run. */
let marksDir: string

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
  const which = spawnSync('sh', ['-c', 'command -v git'], { cwd: tmp, env: scopedEnv(tmp), encoding: 'utf8', timeout: SUBPROCESS_TIMEOUT_MS })
  realGitPath = (which.stdout ?? '').trim()
  // macOS scans a newly written executable on its first run, which can take seconds: write every
  // fake once and run it once here, so no test's budget absorbs the scan
  const warmExtra = { SSH_LOG: path.join(tmp, 'warm.log'), REAL_GIT: realGitPath, FAKE_PIDS: path.join(tmp, 'warm.pids') }
  for (const dir of FAKE_DIRS) {
    spawnSync(writeExecutable(path.join(fakeBin, dir, 'ssh'), LOG_SCRIPT), ['warm-up'], { cwd: tmp, env: scopedEnv(tmp, warmExtra), stdio: 'ignore', timeout: SUBPROCESS_TIMEOUT_MS })
  }
  spawnSync(writeExecutable(path.join(fakeBin, 'hung', 'git'), HUNG_GIT), ['--version'], { cwd: tmp, env: scopedEnv(tmp, warmExtra), stdio: 'ignore', timeout: SUBPROCESS_TIMEOUT_MS })
  // the three programs of the AC-12 test: written once, and run once here for the same reason
  settingsDir = path.join(fakeBin, 'settings')
  marksDir = path.join(tmp, 'marks')
  fs.mkdirSync(marksDir)
  const settingsPrograms = [
    writeExecutable(path.join(settingsDir, 'hooks', 'reference-transaction'), `#!/bin/sh\ntouch "${path.join(marksDir, 'hook')}"\n`),
    writeExecutable(path.join(settingsDir, 'upload.sh'), `#!/bin/sh\ntouch "${path.join(marksDir, 'upload-pack')}"\nexec git-upload-pack "$@"\n`),
    writeExecutable(path.join(settingsDir, 'fsmonitor.sh'), `#!/bin/sh\ntouch "${path.join(marksDir, 'fsmonitor')}"\n`),
  ]
  for (const program of settingsPrograms) {
    spawnSync(program, ['warm-up'], { cwd: tmp, env: scopedEnv(tmp), stdio: 'ignore', timeout: SUBPROCESS_TIMEOUT_MS })
  }
}, 10 * SUBPROCESS_TIMEOUT_MS)

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
    const hook = path.join(marksDir, 'hook')
    const upload = path.join(marksDir, 'upload-pack')
    const fsmonitor = path.join(marksDir, 'fsmonitor')
    git(w.work, w.home, 'config', 'core.hooksPath', path.join(settingsDir, 'hooks'))
    git(w.work, w.home, 'config', 'remote.origin.uploadpack', path.join(settingsDir, 'upload.sh'))
    git(w.work, w.home, 'config', 'core.fsmonitor', path.join(settingsDir, 'fsmonitor.sh'))
    const m1 = advanceOrigin(w, 'm1.txt')
    const clear = (): void => { for (const f of [hook, upload, fsmonitor]) fs.rmSync(f, { force: true }) }
    clear()

    // positive controls: the same repository runs all three for ordinary commands
    git(w.work, w.home, 'fetch', '-q', 'origin', 'main')
    expect(fs.existsSync(hook), 'control: the hook runs for a plain fetch').toBe(true)
    expect(fs.existsSync(upload), 'control: the upload-pack program runs for a plain fetch').toBe(true)
    clear()
    git(w.work, w.home, 'status', '--porcelain')
    expect(fs.existsSync(fsmonitor), 'control: the fsmonitor command runs for a plain status').toBe(true)

    git(w.work, w.home, 'update-ref', 'refs/remotes/origin/main', w.m0)
    clear()
    expect(git(w.work, w.home, 'rev-parse', 'refs/remotes/origin/main')).toBe(w.m0)

    // The `-c core.fsmonitor=false` option itself is held by the exact-argv row and by the next row;
    // this run holds that none of the three programs runs for the whole call sequence of a real run.
    const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], { cwd: w.work, env: cleanEnv(w.home, {}) })
    expect(out.line).toMatch(RB.LINE_RE)
    expect(out.line).toContain('FETCH=ok')
    expect(git(w.work, w.home, 'rev-parse', 'refs/remotes/origin/main'), 'the fetch ran and moved the ref').toBe(m1)
    expect(fs.existsSync(hook), 'the hook did not run').toBe(false)
    expect(fs.existsSync(upload), 'the upload-pack program did not run').toBe(false)
    expect(fs.existsSync(fsmonitor), 'the fsmonitor command did not run').toBe(false)
  })

  it('the fsmonitor override alone keeps the command silent for a fetch that reads the index, where the same fetch without it runs the command', () => {
    const w = newWorld()
    const fsmonitor = path.join(marksDir, 'fsmonitor')
    git(w.work, w.home, 'config', 'core.fsmonitor', path.join(settingsDir, 'fsmonitor.sh'))
    const clear = (): void => { fs.rmSync(fsmonitor, { force: true }) }
    // the resolver's own argv, less the flag that keeps this fetch off the index
    const reachesIndex = RB.fetchArgv('main').filter(a => a !== '--no-recurse-submodules')
    const at = reachesIndex.indexOf('core.fsmonitor=false')
    expect(at, 'the argv carries the fsmonitor override as a -c option').toBeGreaterThan(0)
    expect(reachesIndex[at - 1]).toBe('-c')
    const withoutOverride = reachesIndex.filter((_, i) => i !== at - 1 && i !== at)

    clear()
    git(w.work, w.home, ...withoutOverride)
    expect(fs.existsSync(fsmonitor), 'control: without the override this fetch runs the fsmonitor command').toBe(true)
    clear()
    git(w.work, w.home, ...reachesIndex)
    expect(fs.existsSync(fsmonitor), 'with the override the fsmonitor command did not run').toBe(false)
  })

  it('writes only refs/remotes/origin/<name> when the configuration maps the remote elsewhere, where a plain fetch writes the mapped ref', () => {
    const w = newWorld()
    git(w.work, w.home, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/mirror/*')
    const mirrored = (): string => git(w.work, w.home, 'for-each-ref', '--format=%(refname)', 'refs/mirror')

    git(w.work, w.home, 'fetch', '-q', 'origin', 'main')
    expect(mirrored(), 'control: a plain fetch writes the mapped ref').toBe('refs/mirror/main')
    git(w.work, w.home, 'update-ref', '-d', 'refs/mirror/main')
    git(w.work, w.home, 'update-ref', '-d', 'refs/remotes/origin/main')
    const m1 = advanceOrigin(w, 'm1.txt')

    const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], { cwd: w.work, env: cleanEnv(w.home, {}) })
    expect(out.line).toContain('FETCH=ok')
    expect(git(w.work, w.home, 'rev-parse', 'refs/remotes/origin/main'), 'the fetch wrote the base ref').toBe(m1)
    expect(mirrored(), 'no mapped ref was written').toBe('')
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
  /** The bound put on the hung fetch: long enough for its shell to start and write the pid file under load. */
  const HUNG_BOUND_MS = 4_000

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

  /** Ends what a failed assertion leaves behind: each pid the hung fetch wrote that is still alive. A pid of 1 or less is never signalled. */
  const reap = (pids: readonly number[]): void => {
    for (const pid of pids) {
      if (!Number.isInteger(pid) || pid <= 1 || !alive(pid)) continue
      try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    }
  }

  it('returns REASON timeout inside the bound, on the cached ref, and leaves no process of the group alive', async () => {
    const w = newWorld()
    const pidFile = path.join(w.root, 'pids')
    const env = scopedEnv(w.home, { PATH: `${path.dirname(hungGit())}${path.delimiter}${process.env.PATH ?? ''}`, REAL_GIT: realGitPath, FAKE_PIDS: pidFile })

    const started = Date.now()
    const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], { cwd: w.work, env, fetchTimeoutMs: HUNG_BOUND_MS })
    const elapsed = Date.now() - started

    const pids = readPids(pidFile)
    try {
      expect(out.line).toBe(`BASE_REF=${w.m0} TIP=origin FETCH=failed REASON=timeout NOTE=degraded`)
      expect(elapsed, 'the injected bound ended the fetch, not the 45 s backstop').toBeLessThan(RB.FETCH_TIMEOUT_MS)
      expect(pids).toHaveLength(2)
      expect(await gone(pids), 'no process of the fetch group survives').toBe(true)
    } finally {
      reap(pids)
    }
  })

  it('control: the plain timeout kill alone leaves the helper of the group alive', async () => {
    const w = newWorld()
    const pidFile = path.join(w.root, 'pids')
    const extra = { REAL_GIT: realGitPath, FAKE_PIDS: pidFile }

    // spawnSync honors `detached` (the child leads a new process group, as in the production fetch) although SpawnSyncOptions does not declare it
    const options: SpawnSyncOptions & { detached: boolean } = { stdio: 'ignore', timeout: HUNG_BOUND_MS, killSignal: 'SIGKILL', detached: true }
    const run = spawnSync(hungGit(), ['fetch'], { ...options, cwd: w.root, env: scopedEnv(w.home, extra) })
    const [leader, helper] = readPids(pidFile)
    try {
      expect((run.error as NodeJS.ErrnoException | undefined)?.code, 'the timeout ended the leader').toBe('ETIMEDOUT')
      const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(helper)], { cwd: w.root, env: scopedEnv(w.home), encoding: 'utf8', timeout: SUBPROCESS_TIMEOUT_MS })
      expect(Number(group.stdout.trim()), 'the helper sits in the leader group').toBe(leader)
      expect(alive(helper), 'without a group kill the helper outlives its leader').toBe(true)
    } finally {
      reap([leader, helper])
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
