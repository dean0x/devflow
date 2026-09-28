/**
 * Install snapshot and hook matrix harness (#388, epic #387 PR1).
 *
 * Shared by `tests/install-snapshot.test.ts` and the `install-snapshot` target of
 * `scripts/update-golden.ts`, so the test and the generator capture, normalise and
 * render through one code path: a golden the generator writes is byte-for-byte
 * what the test recomputes.
 *
 * D-SNAPSHOT-SANDBOX: every run gets one `mkdtemp` root under `os.tmpdir()` holding
 * `home/` (the child's `$HOME`, with an empty `.claude/` so init sees Claude Code),
 * `repo/` (a git repo with one commit, where init and uninstall run), `repo/sub/`,
 * `wt/` (a real `git worktree add` of `repo`), `nongit/`, `bin/` (a fake `claude`
 * first on PATH) and `tmp/` (the hooks' TMPDIR, so a temp write is a recorded write
 * rather than an escape). Every CLI and hook env comes from `sandboxEnv`, which
 * asserts the HOME is a temp dir and never the real one (PF-060), and every init
 * passes `--security user`: the managed-settings path is absolute and cannot be
 * sandboxed, so the snapshot never touches it.
 *
 * D-SNAPSHOT-NORMALISE: a golden must hold on Linux and macOS and survive a release
 * bump (PF-079), so the rendered text carries no machine fact. Sandbox paths are
 * replaced in both their logical and realpath forms (macOS `/var` → `/private/var`)
 * and in the dash-joined slug hooks use for log directories; ISO timestamps become
 * `<TIMESTAMP>`; the manifest's `version` becomes `<VERSION>` when it equals the
 * package.json version read at run time. Walks record names, kinds and the owner
 * exec bit only — never sizes, other mode bits (umask differs between machines) or
 * readdir order (every listing is sorted).
 *
 * D-SNAPSHOT-SCOPE: the install walks cover the sandbox HOME and the repo, minus
 * `.git` and the hook log directory. The repo walk doubles as the write-boundary
 * check: everything init writes into the directory it was run from is on record.
 * A second init with the same argv is recorded as a line diff against the first
 * (AC-3 holds it at `(none)`), and the uninstall half records only the difference
 * from the pre-init baseline — the keep list, and any baseline entry it removed.
 *
 * D-HOOK-MATRIX: every hook command string in the installed settings.json is run
 * exactly as Claude Code runs it — `sh -c <command>` with a JSON payload on stdin —
 * in four locations: the repo root, a subdirectory, a linked worktree and a non-git
 * directory. Each cell starts from the same tree: the harness snapshots the whole
 * sandbox (contents included) before the matrix and restores it after every cell,
 * so a cell records what that hook writes on its own, independent of test order.
 * `memory-worker` is skipped by name: it launches a detached `claude -p` worker that
 * outlives the hook, so its writes are neither bounded nor attributable to it.
 */

import { spawnSync } from 'child_process'
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ROOT, requireBuiltCli, sandboxEnv } from './helpers.js'

/** One CLI or hook spawn under full-suite load runs well past vitest's 5 s default. */
export const SUBPROCESS_TIMEOUT_MS = 60_000

/** No sandbox tree is anywhere near this deep; a walk that gets here is a loop or a bug. */
const MAX_WALK_DEPTH = 32

/** The config the hook matrix runs against: the recommended github install. */
export const HOOK_MATRIX_CONFIG = 'github'
export const HOOK_MATRIX_GOLDEN = 'hook-matrix.txt'

export interface InstallConfig {
  readonly name: string
  readonly initArgs: readonly string[]
}

/**
 * The three install shapes the goldens pin. `all-off` passes every `--no-*` switch
 * `devflow init` accepts; install-snapshot.test.ts holds it to the commander definition.
 */
export const INSTALL_CONFIGS: readonly InstallConfig[] = [
  { name: 'github', initArgs: ['--recommended', '--security', 'user'] },
  { name: 'jira-hipaa', initArgs: ['--tracker', 'jira', '--compliance', 'hipaa', '--security', 'user'] },
  {
    name: 'all-off',
    initArgs: [
      '--no-ambient', '--no-memory', '--no-hud', '--no-knowledge', '--no-learning',
      '--no-rules', '--no-proxy', '--no-compliance', '--security', 'user',
    ],
  },
]

export interface NoSwitchDrift {
  /** `--no-*` switches `devflow init` accepts that the argv does not pass. */
  readonly missing: readonly string[]
  /** `--no-*` switches the argv passes that `devflow init` does not accept. */
  readonly extra: readonly string[]
}

/**
 * Compare the `--no-*` switches `init` accepts with those an argv passes, each side
 * sorted, so the all-off guard names the switch a new `--no-x` left out.
 */
export function noSwitchDrift(accepted: readonly string[], initArgs: readonly string[]): NoSwitchDrift {
  const passed = new Set(initArgs.filter(arg => arg.startsWith('--no-')))
  const known = new Set(accepted)
  return {
    missing: [...known].filter(flag => !passed.has(flag)).sort(),
    extra: [...passed].filter(flag => !known.has(flag)).sort(),
  }
}

export const installGoldenName = (config: InstallConfig): string => `install-snapshot-${config.name}.txt`

export function findConfig(name: string): InstallConfig {
  const config = INSTALL_CONFIGS.find(c => c.name === name)
  if (!config) {
    throw new Error(`unknown install-snapshot config '${name}' (known: ${INSTALL_CONFIGS.map(c => c.name).join(', ')})`)
  }
  return config
}

// ── Sandbox ─────────────────────────────────────────────────────────────────

export interface Sandbox {
  readonly root: string
  readonly home: string
  readonly repo: string
  readonly sub: string
  readonly worktree: string
  readonly nonGit: string
  readonly bin: string
  readonly tmp: string
}

const GIT_IDENTITY = [
  '-c', 'user.name=Devflow Snapshot', '-c', 'user.email=snapshot@example.invalid',
  '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main',
] as const

function run(cmd: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}:\n${result.stdout}${result.stderr}`)
  }
}

/** Build the D-SNAPSHOT-SANDBOX layout. The caller owns removal (`removeSandbox`). */
export function createSandbox(): Sandbox {
  const root = mkdtempSync(path.join(os.tmpdir(), 'devflow-snapshot-'))
  const sb: Sandbox = {
    root,
    home: path.join(root, 'home'),
    repo: path.join(root, 'repo'),
    sub: path.join(root, 'repo', 'sub'),
    worktree: path.join(root, 'wt'),
    nonGit: path.join(root, 'nongit'),
    bin: path.join(root, 'bin'),
    tmp: path.join(root, 'tmp'),
  }
  for (const dir of [path.join(sb.home, '.claude'), sb.sub, sb.nonGit, sb.bin, sb.tmp]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path.join(sb.repo, 'README.md'), '# snapshot fixture\n')
  writeFileSync(path.join(sb.sub, 'notes.md'), 'a tracked file one level down\n')

  // A fake `claude` records any invocation inside the sandbox instead of starting a
  // real session; the record is itself a write, so a cell that reaches it says so.
  const fakeClaude = path.join(sb.bin, 'claude')
  writeFileSync(fakeClaude, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${path.join(root, 'fake-claude.calls')}'\nexit 0\n`)
  chmodSync(fakeClaude, 0o755)

  const gitEnv = sandboxEnv(sb.home, { GIT_CONFIG_NOSYSTEM: '1' })
  run('git', [...GIT_IDENTITY, 'init', '-q'], sb.repo, gitEnv)
  run('git', [...GIT_IDENTITY, 'add', '-A'], sb.repo, gitEnv)
  run('git', [...GIT_IDENTITY, 'commit', '-q', '-m', 'fixture'], sb.repo, gitEnv)
  run('git', [...GIT_IDENTITY, 'worktree', 'add', '-q', '-b', 'snapshot-wt', sb.worktree], sb.repo, gitEnv)
  return sb
}

export function removeSandbox(sb: Sandbox | undefined): void {
  if (sb) rmSync(sb.root, { recursive: true, force: true })
}

/**
 * The child env for CLI and hook spawns: sandboxed HOME, fake `claude` first on PATH,
 * and no SHELL. With a known SHELL, init writes a safe-delete block into that shell's
 * profile whenever the platform's trash tool is on PATH (`trash` on macOS, `trash-put`
 * on Linux) — a machine fact, not an install fact, so it is kept out of the golden.
 */
export function sandboxChildEnv(sb: Sandbox, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env = sandboxEnv(sb.home, { PATH: `${sb.bin}${path.delimiter}${process.env.PATH ?? '/usr/bin:/bin'}`, ...extra })
  delete env.SHELL
  return env
}

export interface CliRun {
  readonly status: number | null
  readonly output: string
}

/** Run the built devflow CLI in the sandbox repo, non-interactively (stdin is a pipe). */
export function runCli(sb: Sandbox, args: readonly string[]): CliRun {
  const result = spawnSync('node', [requireBuiltCli(), ...args], {
    cwd: sb.repo,
    env: sandboxChildEnv(sb),
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
  })
  if (result.error) throw result.error
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** `runCli` that throws with the CLI's output on a non-zero exit. */
export function runCliOk(sb: Sandbox, args: readonly string[]): void {
  const { status, output } = runCli(sb, args)
  if (status !== 0) throw new Error(`devflow ${args.join(' ')} exited ${status}:\n${output}`)
}

// ── Normalisation (D-SNAPSHOT-NORMALISE) ────────────────────────────────────

export interface Normaliser {
  /** [from, to] pairs, longest `from` first so a nested path wins over its parent. */
  readonly pairs: ReadonlyArray<readonly [string, string]>
  readonly version: string
}

const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g

/** The directory-name slug `log-paths` derives from a cwd: leading `/` dropped, `/` → `-`. */
export const pathSlug = (p: string): string => p.replace(/^\//, '').split('/').join('-')

function pathForms(p: string): string[] {
  const forms = [p]
  if (existsSync(p)) forms.push(realpathSync(p))
  return [...new Set(forms)]
}

/**
 * Build a normaliser mapping each named path (token → path) in its logical and
 * realpath forms. `slugged` tokens are also mapped in their `pathSlug` form.
 */
export function buildNormaliser(
  named: Readonly<Record<string, string>>,
  version: string,
  slugged: readonly string[] = [],
): Normaliser {
  const pairs = new Map<string, string>()
  for (const [token, p] of Object.entries(named)) {
    for (const form of pathForms(p)) {
      pairs.set(form, token)
      if (slugged.includes(token)) pairs.set(pathSlug(form), token)
    }
  }
  const sorted = [...pairs.entries()].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))
  return { pairs: sorted, version }
}

export function normaliseText(text: string, n: Normaliser): string {
  let out = text
  for (const [from, to] of n.pairs) out = out.split(from).join(to)
  return out.replace(ISO_TIMESTAMP_RE, '<TIMESTAMP>')
}

/** Render a manifest with its version (when it is this package's) and timestamps normalised. */
export function renderManifest(raw: string, n: Normaliser): string {
  const manifest = JSON.parse(raw) as Record<string, unknown>
  const normalised = manifest.version === n.version ? { ...manifest, version: '<VERSION>' } : manifest
  return normaliseText(JSON.stringify(normalised, null, 2), n)
}

/** Render settings.json with `permissions.deny` collapsed to its entry count. */
export function renderSettings(raw: string, n: Normaliser): string {
  const settings = JSON.parse(raw) as Record<string, unknown>
  const permissions = settings.permissions as Record<string, unknown> | undefined
  const collapsed = permissions && Array.isArray(permissions.deny)
    ? { ...settings, permissions: { ...permissions, deny: `<${permissions.deny.length} entries>` } }
    : settings
  return normaliseText(JSON.stringify(collapsed, null, 2), n)
}

export function readPackageVersion(): string {
  return (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version: string }).version
}

/** The install-snapshot normaliser: HOME, repo and sandbox root. */
export function snapshotNormaliser(sb: Sandbox, version: string = readPackageVersion()): Normaliser {
  return buildNormaliser({ '<HOME>': sb.home, '<REPO>': sb.repo, '<SANDBOX>': sb.root }, version, ['<SANDBOX>'])
}

// ── Walks ───────────────────────────────────────────────────────────────────

export type EntryKind = 'dir' | 'file' | 'link'

export interface EntryState {
  readonly kind: EntryKind
  readonly mode: number
  /** File bytes or symlink target; absent for a directory. */
  readonly content?: Buffer
}

export type TreeState = ReadonlyMap<string, EntryState>

export type Exclude = (rel: string, name: string) => boolean

/** `.git` (a directory in the repo, a file in a worktree) is never part of a walk. */
export const excludeGit: Exclude = (_rel, name) => name === '.git'

/** Install walks also drop the hook log directory, which init does not own. */
export const excludeGitAndLogs: Exclude = (rel, name) => name === '.git' || rel === '.devflow/logs'

/**
 * Read a tree into a sorted map rel → state. `withContent` reads file bytes, which
 * the hook matrix needs to restore a tree and the install walks do not.
 */
export function readTree(root: string, exclude: Exclude, withContent: boolean): TreeState {
  const out = new Map<string, EntryState>()
  const visit = (dir: string, relDir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) throw new Error(`readTree: ${dir} is deeper than ${MAX_WALK_DEPTH} levels`)
    for (const name of readdirSync(dir).sort()) {
      const rel = relDir === '' ? name : `${relDir}/${name}`
      if (exclude(rel, name)) continue
      const abs = path.join(dir, name)
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) {
        out.set(rel, { kind: 'link', mode: st.mode, content: Buffer.from(readlinkSync(abs)) })
      } else if (st.isDirectory()) {
        out.set(rel, { kind: 'dir', mode: st.mode })
        visit(abs, rel, depth + 1)
      } else {
        out.set(rel, { kind: 'file', mode: st.mode, content: withContent ? readFileSync(abs) : undefined })
      }
    }
  }
  if (existsSync(root)) visit(root, '', 0)
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** `d path/`, `x path` (owner-executable file), `- path`, `l path -> target`. */
export function renderEntry(rel: string, e: EntryState): string {
  if (e.kind === 'dir') return `d ${rel}/`
  if (e.kind === 'link') return `l ${rel} -> ${e.content?.toString() ?? ''}`
  return `${e.mode & 0o100 ? 'x' : '-'} ${rel}`
}

export function renderTree(tree: TreeState, n: Normaliser): string {
  const lines = [...tree.entries()].map(([rel, e]) => normaliseText(renderEntry(rel, e), n))
  return lines.length === 0 ? '(empty)' : lines.join('\n')
}

// ── Golden sections ─────────────────────────────────────────────────────────

export interface Section {
  readonly heading: string
  readonly body: string
}

export function renderGolden(header: readonly string[], sections: readonly Section[]): string {
  const blocks = sections.map(s => `## ${s.heading}\n${s.body}\n`)
  return `${header.map(h => `# ${h}`).join('\n')}\n\n${blocks.join('\n')}`
}

/** Parse a golden back into heading → body, in file order. Throws on a duplicate heading. */
export function parseGolden(text: string): Map<string, string> {
  const sections = new Map<string, string>()
  const parts = text.split(/^## /m).slice(1)
  for (const part of parts) {
    const newline = part.indexOf('\n')
    const heading = part.slice(0, newline)
    if (sections.has(heading)) throw new Error(`golden has a duplicate section '## ${heading}'`)
    sections.set(heading, part.slice(newline + 1).replace(/\n+$/, ''))
  }
  return sections
}

// ── Install snapshot ────────────────────────────────────────────────────────

export interface Baseline {
  readonly home: TreeState
  readonly repo: TreeState
}

export function captureBaseline(sb: Sandbox): Baseline {
  return { home: readTree(sb.home, excludeGitAndLogs, false), repo: readTree(sb.repo, excludeGitAndLogs, false) }
}

function readIfPresent(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf-8') : null
}

export function baselineSections(baseline: Baseline, n: Normaliser): Section[] {
  return [
    { heading: 'baseline: HOME', body: renderTree(baseline.home, n) },
    { heading: 'baseline: repo', body: renderTree(baseline.repo, n) },
  ]
}

/** The post-init sections: both walks, settings, manifest and the repo's config.json. */
export function captureInstall(sb: Sandbox, n: Normaliser): Section[] {
  const settings = readIfPresent(path.join(sb.home, '.claude', 'settings.json'))
  const manifest = readIfPresent(path.join(sb.home, '.devflow', 'manifest.json'))
  const repoConfig = readIfPresent(path.join(sb.repo, '.devflow', 'config.json'))
  return [
    { heading: 'install: HOME', body: renderTree(readTree(sb.home, excludeGitAndLogs, false), n) },
    { heading: 'install: repo', body: renderTree(readTree(sb.repo, excludeGitAndLogs, false), n) },
    { heading: 'install: settings.json (permissions.deny collapsed to a count)', body: settings === null ? '(absent)' : renderSettings(settings, n) },
    { heading: 'install: manifest.json', body: manifest === null ? '(absent)' : renderManifest(manifest, n) },
    { heading: 'install: repo .devflow/config.json', body: repoConfig === null ? '(absent)' : normaliseText(repoConfig.trimEnd(), n) },
  ]
}

function treeDifference(from: TreeState, minus: TreeState, prefix: string, n: Normaliser): string[] {
  return [...from.entries()].filter(([rel]) => !minus.has(rel)).map(([rel, e]) => normaliseText(renderEntry(`${prefix}${rel}`, e), n))
}

/**
 * Line diff of `a` → `b` as `-`/`+` lines under `@@ line N @@` hunk headers (N is
 * the 1-based line in `a` where the hunk starts). No context lines: a golden section
 * records exactly what moved.
 *
 * research: built, not adopted — the repo has no diff dependency, and an LCS over a
 * few hundred lines is a dozen lines here against a new package for every consumer.
 */
export function lineDiff(a: readonly string[], b: readonly string[]): string[] {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  let inHunk = false
  // Each pass advances i, j or both, so the loop ends within a.length + b.length passes.
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
      inHunk = false
      continue
    }
    if (!inHunk) out.push(`@@ line ${i + 1} @@`)
    inHunk = true
    if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) out.push(`- ${a[i++]}`)
    else out.push(`+ ${b[j++]}`)
  }
  return out
}

export const REINIT_HEADING = 're-init: difference from the first install (AC-3 wants none)'

/**
 * The re-init section: per install section, the line diff from the first init to a
 * second init with the same argv. AC-3 holds it at `(none)`; anything else is a
 * regression, and the hunks name exactly what the second run changed.
 */
export function renderReinitDiff(first: readonly Section[], second: readonly Section[]): string {
  const blocks: string[] = []
  for (const [index, section] of first.entries()) {
    const other = second[index]
    if (other?.heading !== section.heading) throw new Error(`re-init capture has no section '${section.heading}' at ${index}`)
    const diff = lineDiff(section.body.split('\n'), other.body.split('\n'))
    if (diff.length > 0) blocks.push(`### ${section.heading}\n${diff.join('\n')}`)
  }
  return blocks.length === 0 ? '(none)' : blocks.join('\n')
}

/** The uninstall sections' headings, in golden order. */
export const UNINSTALL_HEADINGS = [
  'uninstall: keep list (present after uninstall, absent from the baseline)',
  'uninstall: baseline entries removed',
  'uninstall: settings.json (permissions.deny collapsed to a count)',
] as const

/** The post-uninstall sections: what survives beyond the baseline, and what of the baseline did not. */
export function captureUninstall(sb: Sandbox, baseline: Baseline, n: Normaliser): Section[] {
  const home = readTree(sb.home, excludeGitAndLogs, false)
  const repo = readTree(sb.repo, excludeGitAndLogs, false)
  const kept = [...treeDifference(home, baseline.home, '<HOME>/', n), ...treeDifference(repo, baseline.repo, '<REPO>/', n)]
  const removed = [...treeDifference(baseline.home, home, '<HOME>/', n), ...treeDifference(baseline.repo, repo, '<REPO>/', n)]
  const settings = readIfPresent(path.join(sb.home, '.claude', 'settings.json'))
  const [keptHeading, removedHeading, settingsHeading] = UNINSTALL_HEADINGS
  return [
    { heading: keptHeading, body: kept.length === 0 ? '(none)' : kept.join('\n') },
    { heading: removedHeading, body: removed.length === 0 ? '(none)' : removed.join('\n') },
    { heading: settingsHeading, body: settings === null ? '(absent)' : renderSettings(settings, n) },
  ]
}

export function installGoldenHeader(config: InstallConfig): string[] {
  return [
    `install-snapshot golden — config: ${config.name} (#388 AC-2, AC-3, AC-4)`,
    'Records TODAY\'s behaviour, bugs included: a later PR that changes a section says why in its fixture-only test(snapshot): commit.',
    `argv: devflow init ${config.initArgs.join(' ')}  (cwd <REPO>, HOME <HOME>, stdin not a TTY), run twice; then devflow uninstall`,
    'Regenerate: npm run test:golden:update -- install-snapshot  (fixture-only test(snapshot): commit)',
    'Normalised: sandbox paths (logical + realpath), ISO timestamps, the package version. Walk lines: d dir/, x executable, - file, l link.',
  ]
}

// ── Hook matrix (D-HOOK-MATRIX) ─────────────────────────────────────────────

export const HOOK_LOCATIONS = ['root', 'subdir', 'worktree', 'non-git'] as const
export type HookLocation = typeof HOOK_LOCATIONS[number]

/** Hooks the matrix never runs, by name, with the reason recorded in the golden. */
export const SKIPPED_HOOKS: Readonly<Record<string, string>> = {
  'memory-worker': 'launches a detached claude -p worker that outlives the hook; its writes are not the hook\'s',
}

export function locationDir(sb: Sandbox, location: HookLocation): string {
  switch (location) {
    case 'root': return sb.repo
    case 'subdir': return sb.sub
    case 'worktree': return sb.worktree
    case 'non-git': return sb.nonGit
  }
}

export interface InstalledHook {
  readonly event: string
  readonly matcher: string | undefined
  readonly command: string
  readonly name: string
}

interface HookEntry { readonly type?: string; readonly command?: string }
interface HookGroup { readonly matcher?: string; readonly hooks?: readonly HookEntry[] }

/** Every command hook in settings.json, in settings order. The name is the `run-hook` argument. */
export function installedHooks(settingsRaw: string): InstalledHook[] {
  const settings = JSON.parse(settingsRaw) as { hooks?: Record<string, readonly HookGroup[]> }
  const hooks: InstalledHook[] = []
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    for (const group of groups) {
      for (const entry of group.hooks ?? []) {
        if (entry.type !== 'command' || typeof entry.command !== 'string') continue
        const match = /\brun-hook\s+(\S+)\s*$/.exec(entry.command)
        hooks.push({ event, matcher: group.matcher, command: entry.command, name: match ? match[1] : entry.command })
      }
    }
  }
  return hooks
}

export const cellHeading = (location: HookLocation, hook: InstalledHook): string =>
  `${location} · ${hook.name} (${hook.event}${hook.matcher ? ` ${hook.matcher}` : ''})`

/** Split a golden cell heading back into its location and hook name. */
export function parseCellHeading(heading: string): { location: HookLocation; name: string } {
  const match = /^(\S+) · (\S+) \(/.exec(heading)
  const location = HOOK_LOCATIONS.find(l => l === match?.[1])
  if (!match || !location) throw new Error(`hook-matrix golden has a malformed cell heading '## ${heading}'`)
  return { location, name: match[2] }
}

/** A realistic minimal stdin payload per event, shaped like the one Claude Code sends. */
export function hookPayload(event: string, matcher: string | undefined, cwd: string, sb: Sandbox): Record<string, unknown> {
  const common = { session_id: 'hook-matrix', transcript_path: path.join(sb.root, 'transcript.jsonl'), cwd, hook_event_name: event }
  const question = 'Which install config should the snapshot cover?'
  switch (event) {
    case 'UserPromptSubmit':
      return { ...common, prompt: 'Summarise the open work on this branch.' }
    case 'Stop':
      return { ...common, stop_hook_active: false, last_assistant_message: 'Done: the branch builds and its tests pass.' }
    case 'SessionStart':
      return { ...common, source: 'startup' }
    case 'PreCompact':
      return { ...common, trigger: 'auto', custom_instructions: '' }
    case 'PostToolUse':
      return {
        ...common,
        tool_name: matcher ?? 'AskUserQuestion',
        tool_input: { questions: [{ question, header: 'Config', multiSelect: false, options: [{ label: 'github' }, { label: 'all-off' }] }] },
        tool_response: { questions: [], answers: { [question]: 'github' } },
      }
    default:
      throw new Error(`hook matrix: no payload for event '${event}' — add one to hookPayload`)
  }
}

/** The hook-matrix normaliser: paths are rendered relative to the sandbox root already, so only log slugs remain. */
export function matrixNormaliser(sb: Sandbox, version: string = readPackageVersion()): Normaliser {
  return buildNormaliser({ '<SANDBOX>': sb.root }, version, ['<SANDBOX>'])
}

interface TreeDiff {
  readonly added: string[]
  readonly modified: string[]
  readonly removed: string[]
}

function sameEntry(a: EntryState, b: EntryState): boolean {
  if (a.kind !== b.kind || (a.mode & 0o777) !== (b.mode & 0o777)) return false
  if (a.content === undefined || b.content === undefined) return a.content === b.content
  return a.content.equals(b.content)
}

export function diffTree(before: TreeState, after: TreeState): TreeDiff {
  const added = [...after.keys()].filter(rel => !before.has(rel))
  const removed = [...before.keys()].filter(rel => !after.has(rel))
  const modified = [...after.entries()]
    .filter(([rel, e]) => { const b = before.get(rel); return b !== undefined && !sameEntry(b, e) })
    .map(([rel]) => rel)
  return { added, modified, removed }
}

/** Put the sandbox back to `baseline` after a cell: delete additions, rewrite changes. */
export function restoreTree(root: string, baseline: TreeState, current: TreeState): void {
  const { added, modified, removed } = diffTree(baseline, current)
  for (const rel of [...added].sort().reverse()) rmSync(path.join(root, rel), { recursive: true, force: true })
  for (const rel of [...removed, ...modified].sort()) {
    const abs = path.join(root, rel)
    const e = baseline.get(rel)
    if (!e) continue
    if (e.kind === 'dir') {
      mkdirSync(abs, { recursive: true })
    } else {
      rmSync(abs, { recursive: true, force: true })
      if (e.kind === 'link') symlinkSync(e.content?.toString() ?? '', abs)
      else writeFileSync(abs, e.content ?? Buffer.alloc(0))
    }
    if (e.kind !== 'link') chmodSync(abs, e.mode & 0o7777)
  }
}

export const readSandbox = (sb: Sandbox): TreeState => readTree(sb.root, excludeGit, true)

/**
 * Run one hook in one location from the matrix baseline, render what it wrote,
 * and restore the baseline. The rendered body is the golden cell.
 */
export function runHookCell(sb: Sandbox, baseline: TreeState, hook: InstalledHook, location: HookLocation, n: Normaliser): string {
  const cwd = realpathSync(locationDir(sb, location))
  const result = spawnSync('sh', ['-c', hook.command], {
    cwd,
    env: sandboxChildEnv(sb, { TMPDIR: sb.tmp }),
    input: JSON.stringify(hookPayload(hook.event, hook.matcher, cwd, sb)),
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
  })
  if (result.error) throw result.error
  const after = readSandbox(sb)
  const { added, modified, removed } = diffTree(baseline, after)
  restoreTree(sb.root, baseline, after)
  const residue = diffTree(baseline, readSandbox(sb))
  if (residue.added.length + residue.modified.length + residue.removed.length > 0) {
    throw new Error(`hook matrix could not restore the sandbox after ${hook.name} @ ${location}: ${JSON.stringify(residue)}`)
  }

  const exit = result.status === null ? `signal ${result.signal ?? 'unknown'}` : String(result.status)
  const entry = (rel: string, state: TreeState): string => (state.get(rel)?.kind === 'dir' ? `${rel}/` : rel)
  const writes = [
    ...added.map(rel => `A ${entry(rel, after)}`),
    ...modified.map(rel => `M ${entry(rel, after)}`),
    ...removed.map(rel => `D ${entry(rel, baseline)}`),
  ].sort((a, b) => (a.slice(2) < b.slice(2) ? -1 : a.slice(2) > b.slice(2) ? 1 : 0))
  return normaliseText([`exit ${exit}`, ...(writes.length === 0 ? ['(no writes)'] : writes)].join('\n'), n)
}

export const skippedCellBody = (hook: InstalledHook): string => `SKIPPED: ${SKIPPED_HOOKS[hook.name]}`

export function hookMatrixHeader(): string[] {
  const config = findConfig(HOOK_MATRIX_CONFIG)
  return [
    'hook-matrix golden — what every installed hook writes, per location (#388 AC-5, TP-7)',
    `install: devflow init ${config.initArgs.join(' ')}; each hook runs as sh -c <settings.json command>, JSON payload on stdin`,
    'Locations: root = repo/, subdir = repo/sub/, worktree = wt/ (git worktree add), non-git = nongit/. Paths are relative to the sandbox root.',
    'Each cell starts from the same post-install tree (restored after every cell). A = added, M = modified, D = removed; .git is not walked.',
    'This records TODAY\'s behaviour, bugs included: a later PR that changes a cell says why in its fixture-only test(snapshot): commit.',
    'Regenerate: npm run test:golden:update -- install-snapshot',
  ]
}

/** Run the whole matrix against an installed sandbox and return its sections, in location-major order. */
export function captureHookMatrix(sb: Sandbox, n: Normaliser): Section[] {
  const hooks = installedHooks(readFileSync(path.join(sb.home, '.claude', 'settings.json'), 'utf-8'))
  const baseline = readSandbox(sb)
  const sections: Section[] = []
  for (const location of HOOK_LOCATIONS) {
    for (const hook of hooks) {
      const body = hook.name in SKIPPED_HOOKS ? skippedCellBody(hook) : runHookCell(sb, baseline, hook, location, n)
      sections.push({ heading: cellHeading(location, hook), body })
    }
  }
  return sections
}

// ── Generator (scripts/update-golden.ts install-snapshot) ───────────────────

/**
 * Write the goldens for `configs` into `outDir` and return the written paths. The
 * hook matrix is written when its config is among them. Each config runs in its own
 * sandbox: baseline → init → capture → re-init → capture → (matrix) → uninstall →
 * capture — the order the test runs them in.
 */
export function writeInstallSnapshotGoldens(outDir: string, configs: readonly InstallConfig[] = INSTALL_CONFIGS): string[] {
  mkdirSync(outDir, { recursive: true })
  const written: string[] = []
  for (const config of configs) {
    const sb = createSandbox()
    try {
      const n = snapshotNormaliser(sb)
      const baseline = captureBaseline(sb)
      runCliOk(sb, ['init', ...config.initArgs])
      const install = captureInstall(sb, n)
      runCliOk(sb, ['init', ...config.initArgs])
      const reinit = { heading: REINIT_HEADING, body: renderReinitDiff(install, captureInstall(sb, n)) }
      if (config.name === HOOK_MATRIX_CONFIG) {
        const matrix = captureHookMatrix(sb, matrixNormaliser(sb))
        const dst = path.join(outDir, HOOK_MATRIX_GOLDEN)
        writeFileSync(dst, renderGolden(hookMatrixHeader(), matrix), 'utf-8')
        written.push(dst)
      }
      runCliOk(sb, ['uninstall'])
      const uninstall = captureUninstall(sb, baseline, n)
      const dst = path.join(outDir, installGoldenName(config))
      writeFileSync(dst, renderGolden(installGoldenHeader(config), [...baselineSections(baseline, n), ...install, reinit, ...uninstall]), 'utf-8')
      written.push(dst)
    } finally {
      removeSandbox(sb)
    }
  }
  return written
}
