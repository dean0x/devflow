/**
 * Write-set fence (#406 item 19; audit appendix 09-tests.md, strategy item 3).
 *
 * D-WRITE-SET-FENCE: every CLI toggle — each `--enable`, `--disable` and `--set`
 * a command defines, plus the state-clearing and read-only actions beside them —
 * runs once, in table order, against one sandbox installed by the BUILT CLI
 * (`init --recommended --security user`; `npm run build` first). Around each run
 * the whole sandbox is walked with contents (HOME, the repo, its subdirectory and
 * worktree, the non-git dir, TMPDIR, the fake `claude`'s call log; `.git` is not
 * walked), and every path the run added, modified or removed must fall inside that
 * row's declared allowlist. A write outside it fails with the path named. A row
 * marked `mustWrite` must also change something, so a toggle that silently
 * stopped writing fails too, and the table leaves every toggle flipped
 * back to its installed state, so each row starts from a known one.
 *
 * D-LEARNING-VARIANT-FENCE: `learning --enable` / `--disable` converge the installed
 * learning variants (D-LEARNING-VARIANT-INSTALL), so their allowlist is the manifest
 * plus that surface and nothing wider: the command and agent files of the variant
 * roster (the files under dist/learning-off, the converge's own roster source) and
 * the learning-gated skill directories. The roster is read from the build, not typed
 * here, so a new arm is admitted with no edit; it is matched file by file, never as a
 * `commands/**` or `agents/**` subtree, so a stray write to any other agent, command
 * or skill still fails the fence. In a row the surface is the one entry
 * {@link LEARNING_VARIANT_SURFACE}, which the check expands to those paths.
 *
 * Coverage is held to the CLI's own definitions, not to this table: every
 * top-level command in `devflow --help` has a row or a reason in UNFENCED_COMMANDS,
 * and every `--enable` / `--disable` / `--set` option a command defines has a row
 * or a reason in UNFENCED_ACTIONS. Every spawn runs under `sandboxEnv`'s temp HOME;
 * no row reaches a real `claude` (the sandbox's fake records any call) or a
 * real `gh` (the sandbox's fake fails like an unauthenticated one and writes nothing).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import * as path from 'path'
import type { Command } from 'commander'
import { requireBuiltCli } from './helpers.js'
import {
  SUBPROCESS_TIMEOUT_MS, createSandbox, diffTree, excludeGit, readTree, removeSandbox, resolveOnPath, runCli,
  runCliOk, sandboxChildEnv, type Sandbox,
} from './install-snapshot-helpers.js'
import { learningOffDir } from '../src/core/assets.js'
import { LEARNING_GATED_SKILLS, prefixSkillName } from '../src/core/plugins.js'
import { initCommand } from '../src/cli/commands/init.js'
import { uninstallCommand } from '../src/cli/commands/uninstall.js'
import { ambientCommand } from '../src/cli/commands/ambient.js'
import { memoryCommand } from '../src/cli/commands/memory.js'
import { skillsCommand } from '../src/cli/commands/skills.js'
import { hudCommand } from '../src/cli/commands/hud.js'
import { flagsCommand } from '../src/cli/commands/flags.js'
import { knowledgeCommand } from '../src/cli/commands/knowledge/index.js'
import { learningCommand } from '../src/cli/commands/learning.js'
import { rulesCommand } from '../src/cli/commands/rules.js'
import { debugCommand } from '../src/cli/commands/debug.js'
import { securityCommand } from '../src/cli/commands/security.js'
import { safeDeleteCommand } from '../src/cli/commands/safe-delete.js'
import { proxyCommand } from '../src/cli/commands/proxy.js'
import { agentsCommand } from '../src/cli/commands/agents.js'
import { complianceCommand } from '../src/cli/commands/compliance.js'
import { trackerCommand } from '../src/cli/commands/tracker.js'

const CLI = requireBuiltCli()

// ── The fence table ─────────────────────────────────────────────────────────

export interface FenceRow {
  readonly args: readonly string[]
  /**
   * The paths the command may change, as `<HOME>/…`, `<REPO>/…` or `<SANDBOX>/…`.
   * An entry ending in `/**` admits that path and everything under it.
   * {@link LEARNING_VARIANT_SURFACE} admits the learning-variant roster (see there).
   * Any other entry admits exactly that path.
   */
  readonly allow: readonly string[]
  /** The row must change at least one path (the non-vacuity check). */
  readonly mustWrite: boolean
  /** State the row needs before its before-walk, e.g. a queue to clear. */
  readonly seed?: (sb: Sandbox) => void
  /** Names the row apart from another row with the same args. */
  readonly label?: string
}

const SETTINGS = '<HOME>/.claude/settings.json'
const MANIFEST = '<HOME>/.devflow/manifest.json'
const HUD_CONFIG = '<HOME>/.devflow/hud.json'
const RULES_DIR = '<HOME>/.claude/rules/devflow/**'
const COMPLIANCE_RULE = '<HOME>/.claude/rules/devflow/compliance.md'
const COMPLIANCE_SKILL = '<HOME>/.claude/skills/devflow:compliance/SKILL.md'
const TRACKER_SENTINEL = '<HOME>/.devflow/.tracker.enabled'
const SKILL_SHADOWS = '<HOME>/.devflow/skills/**'
const AGENT_MODELS = '<HOME>/.devflow/agent-models.json'
const REPO_MEMORY = '<REPO>/.devflow/memory/**'
const REPO_LEARNING = '<REPO>/.devflow/learning/**'

const NONE: readonly string[] = []

/** The prompt kinds the learning converge rewrites, installed at `<HOME>/.claude/<kind>/devflow/<file>`. */
const LEARNING_VARIANT_KINDS = ['commands', 'agents'] as const

/**
 * The surfaces a learning toggle's converge may write (D-LEARNING-VARIANT-FENCE):
 * each roster file's installed path, and each learning-gated skill directory.
 *
 * The roster is the `.md` files under dist/learning-off/<kind>, read through the
 * converge's own `learningOffDir`. An absent directory throws rather than yielding an
 * empty roster, which would fence the toggle to the manifest and fail every row for
 * a reason that names no cause.
 */
function learningVariantAllow(): string[] {
  const prompts = LEARNING_VARIANT_KINDS.flatMap(kind => {
    const dir = learningOffDir(kind)
    let names: string[]
    try {
      names = readdirSync(dir).filter(name => name.endsWith('.md')).sort()
    } catch (err) {
      throw new Error(`the learning-variant roster is unreadable (${dir}) — run \`npm run build:mds\`: ${String(err)}`)
    }
    return names.map(name => `<HOME>/.claude/${kind}/devflow/${name}`)
  })
  const skills = LEARNING_GATED_SKILLS.map(skill => `<HOME>/.claude/skills/${prefixSkillName(skill)}/**`)
  return [...prompts, ...skills]
}

const LEARNING_VARIANT_PATHS: readonly string[] = learningVariantAllow()

/**
 * The learning-variant surface as ONE allowlist entry. A row names the token; the
 * check expands it to {@link LEARNING_VARIANT_PATHS}, so the surface is matched file
 * by file and counts once in {@link allowlistSize} (D-ALLOWLIST-COUNTING).
 */
export const LEARNING_VARIANT_SURFACE = '<LEARNING-VARIANT-SURFACE>'

function seedFile(sb: Sandbox, rel: string, content: string): void {
  const abs = path.join(sb.repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

const seedMemoryQueue = (sb: Sandbox): void =>
  seedFile(sb, '.devflow/memory/.pending-turns.jsonl', `${JSON.stringify({ role: 'user', content: 'fence', ts: 1 })}\n`)

const seedLearningState = (sb: Sandbox): void => {
  seedFile(sb, '.devflow/learning/decisions-log.jsonl', `${JSON.stringify({ id: 'obs_fence', type: 'decision' })}\n`)
  seedFile(sb, '.devflow/learning/.pending-turns.jsonl', `${JSON.stringify({ role: 'user', content: 'fence', ts: 1 })}\n`)
}

/** The fenced entry: a v2 pitfall, retired, with the observation it projects. */
const FENCE_ENTRY = 'PF-001'
const FENCE_CONTENT = {
  type: 'pitfall',
  title: 'Fenced entry',
  rule: 'A learning command writes only inside the learning directory.',
  why: 'A write anywhere else is a write nothing reads back.',
  scope: ['area:fence'],
  provenance: 'write-set fence',
}

/** A retired entry and its observation, for --restore to bring back; --list and --show then read what it left. */
const seedRetiredEntry = (sb: Sandbox): void => {
  seedFile(sb, '.devflow/learning/decisions-log.jsonl', `${JSON.stringify({
    schema: 2, id: 'obs_fence_entry', ...FENCE_CONTENT,
    observations: 1, first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:00.000Z',
  })}\n`)
  seedFile(sb, '.devflow/learning/decisions-ledger.jsonl', `${JSON.stringify({
    schema: 2, id: 'obs_fence_entry', type: 'pitfall', anchor_id: FENCE_ENTRY, decisions_status: 'Retired',
    title: FENCE_CONTENT.title, rule: FENCE_CONTENT.rule, why: FENCE_CONTENT.why, scope: FENCE_CONTENT.scope,
    provenance: FENCE_CONTENT.provenance, date: '2026-01-01', status_note: 'fence', retired_on: '2026-01-02',
  })}\n`)
}

function rewriteHomeJson(sb: Sandbox, rel: string, edit: (json: Record<string, unknown>) => void): void {
  const abs = path.join(sb.home, rel)
  const json = JSON.parse(readFileSync(abs, 'utf-8')) as Record<string, unknown>
  edit(json)
  writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`)
}

/**
 * The state `init --security none` leaves in HOME: no deny list in the user
 * settings and `none` in the manifest. Seeded rather than installed because
 * `init --security none` also strips the Devflow deny list from the platform
 * managed-settings file, an absolute system path the sandbox cannot redirect.
 */
const seedNoDenyList = (sb: Sandbox): void => {
  rewriteHomeJson(sb, '.claude/settings.json', settings => {
    const permissions = settings.permissions as Record<string, unknown> | undefined
    // Non-vacuity: init's `--security user` really installed the list being removed.
    const deny = permissions?.deny
    expect(Array.isArray(deny) && deny.length > 0).toBe(true)
    if (permissions) delete permissions.deny
  })
  rewriteHomeJson(sb, '.devflow/manifest.json', manifest => {
    (manifest.features as Record<string, unknown>).security = 'none'
  })
}

/**
 * One row per toggle action, in run order. Each enable/disable (and set) pair
 * leaves the install where it found it.
 */
export const FENCE_ROWS: readonly FenceRow[] = [
  { args: ['memory', '--disable'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['memory', '--enable'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['memory', '--clear'], allow: [REPO_MEMORY], mustWrite: true, seed: seedMemoryQueue },
  { args: ['memory', '--status'], allow: NONE, mustWrite: false },

  { args: ['learning', '--disable'], allow: [MANIFEST, LEARNING_VARIANT_SURFACE], mustWrite: true },
  { args: ['learning', '--enable'], allow: [MANIFEST, LEARNING_VARIANT_SURFACE], mustWrite: true },
  { args: ['learning', '--restore', FENCE_ENTRY], allow: [REPO_LEARNING], mustWrite: true, seed: seedRetiredEntry },
  { args: ['learning', '--list'], allow: NONE, mustWrite: false },
  { args: ['learning', '--show', FENCE_ENTRY], allow: NONE, mustWrite: false },
  { args: ['learning', '--clear'], allow: [REPO_LEARNING], mustWrite: true, seed: seedLearningState },
  { args: ['learning', '--reset'], allow: [REPO_LEARNING], mustWrite: true, seed: seedLearningState },
  // The reset above left no learning directory: a reset with nothing to reset writes nothing.
  { args: ['learning', '--reset'], allow: NONE, mustWrite: false, label: 'with no learning data' },
  { args: ['learning', '--status'], allow: NONE, mustWrite: false },

  { args: ['knowledge', '--disable'], allow: [MANIFEST], mustWrite: true },
  { args: ['knowledge', '--enable'], allow: [MANIFEST], mustWrite: true },
  { args: ['knowledge', '--status'], allow: NONE, mustWrite: false },

  { args: ['ambient', '--disable'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['ambient', '--enable'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['ambient', '--status'], allow: NONE, mustWrite: false },

  { args: ['hud', '--disable'], allow: [SETTINGS, HUD_CONFIG, MANIFEST], mustWrite: true },
  { args: ['hud', '--enable'], allow: [SETTINGS, HUD_CONFIG, MANIFEST], mustWrite: true },
  { args: ['hud', '--detail'], allow: [HUD_CONFIG], mustWrite: true },
  { args: ['hud', '--no-detail'], allow: [HUD_CONFIG], mustWrite: true },
  { args: ['hud', '--status'], allow: NONE, mustWrite: false },

  { args: ['rules', '--disable'], allow: [RULES_DIR, MANIFEST], mustWrite: true },
  { args: ['rules', '--enable'], allow: [RULES_DIR, MANIFEST], mustWrite: true },
  { args: ['rules', '--status'], allow: NONE, mustWrite: false },

  { args: ['tracker', '--set', 'jira'], allow: [MANIFEST, TRACKER_SENTINEL], mustWrite: true },
  { args: ['tracker', '--set', 'github'], allow: [MANIFEST, TRACKER_SENTINEL], mustWrite: true },
  { args: ['tracker', '--status'], allow: NONE, mustWrite: false },

  { args: ['compliance', '--set', 'hipaa'], allow: [MANIFEST, COMPLIANCE_RULE, COMPLIANCE_SKILL], mustWrite: true },
  { args: ['compliance', '--set', ''], allow: [MANIFEST, COMPLIANCE_RULE, COMPLIANCE_SKILL], mustWrite: true },
  { args: ['compliance', '--disable'], allow: [MANIFEST, COMPLIANCE_RULE, COMPLIANCE_SKILL], mustWrite: true },
  { args: ['compliance', '--enable'], allow: [MANIFEST, COMPLIANCE_RULE, COMPLIANCE_SKILL], mustWrite: true },
  { args: ['compliance', '--disable'], allow: [MANIFEST, COMPLIANCE_RULE, COMPLIANCE_SKILL], mustWrite: true, label: 'after --enable' },
  { args: ['compliance', '--status'], allow: NONE, mustWrite: false },

  // Already installed by init's `--security user`: re-enabling may restamp the manifest only.
  { args: ['security', '--enable', '--user'], allow: [SETTINGS, MANIFEST], mustWrite: false },
  // From no deny list: enabling installs it in the user settings and records `user`.
  { args: ['security', '--enable', '--user'], allow: [SETTINGS, MANIFEST], mustWrite: true, seed: seedNoDenyList, label: 'from no deny list' },
  { args: ['security', '--status'], allow: NONE, mustWrite: false },

  { args: ['flags', '--disable', 'tui'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['flags', '--enable', 'tui'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['flags', '--set', 'max-concurrent-subagents=4'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['flags', '--unset', 'max-concurrent-subagents'], allow: [SETTINGS, MANIFEST], mustWrite: true },
  { args: ['flags', '--status'], allow: NONE, mustWrite: false },
  { args: ['flags', '--list'], allow: NONE, mustWrite: false },

  { args: ['debug', '--enable'], allow: [SETTINGS], mustWrite: true },
  { args: ['debug', '--disable'], allow: [SETTINGS], mustWrite: true },
  { args: ['debug', '--status'], allow: NONE, mustWrite: false },

  { args: ['skills', 'shadow', 'testing'], allow: [SKILL_SHADOWS], mustWrite: true },
  { args: ['skills', 'unshadow', 'testing'], allow: [SKILL_SHADOWS], mustWrite: true },
  { args: ['skills', 'list'], allow: NONE, mustWrite: false },

  { args: ['agents', '--set', 'code', '--model', 'sonnet'], allow: [AGENT_MODELS], mustWrite: true },
  { args: ['agents', '--reset', '--yes'], allow: [AGENT_MODELS], mustWrite: true },
  { args: ['agents', '--list'], allow: NONE, mustWrite: false },

  { args: ['proxy', '--status'], allow: NONE, mustWrite: false },
  { args: ['safe-delete', '--status'], allow: NONE, mustWrite: false },
]

/** Top-level commands with no row, and where their writes are held instead. */
export const UNFENCED_COMMANDS: Readonly<Record<string, string>> = {
  init: 'its whole HOME and repo write set is the install-snapshot golden (tests/install-snapshot.test.ts TP-2, TP-5), and its location invariance is tests/init-location-invariance.test.ts',
  uninstall: 'its keep list and removals are the install-snapshot golden\'s uninstall sections (TP-6)',
}

/** Toggle actions a command defines that have no row, each with the reason. */
export const UNFENCED_ACTIONS: Readonly<Record<string, string>> = {
  'security --disable':
    'after stripping the user settings it removes every Devflow deny entry from the platform managed-settings file ' +
    '(getManagedSettingsPath: /Library/Application Support/ClaudeCode or /etc/claude-code), an absolute system path ' +
    'with no seam the sandbox can redirect; on a machine whose managed file carries the deny list, a run would strip ' +
    'that machine\'s protection (or prompt for sudo), and the walk could not see the write anyway',
  'proxy --enable': 'starts the relay process, whose writes outlive the command',
  'proxy --disable': 'stops the relay process started by --enable',
  'safe-delete --enable': 'writes the shell profile only when the platform trash tool is on PATH, a machine fact the table cannot pin',
  'safe-delete --disable': 'removes what --enable wrote',
}

/** The command objects the CLI registers, for their option definitions. */
const COMMANDS: readonly Command[] = [
  initCommand, uninstallCommand, ambientCommand, memoryCommand, skillsCommand, hudCommand, flagsCommand,
  knowledgeCommand, learningCommand, rulesCommand, debugCommand, securityCommand, safeDeleteCommand,
  proxyCommand, agentsCommand, complianceCommand, trackerCommand,
]

/** The options that make a command a toggle. */
const TOGGLE_OPTIONS = ['--enable', '--disable', '--set'] as const

// ── The fence check (pure) ──────────────────────────────────────────────────

/** A sandbox-relative walk path as `<HOME>/…`, `<REPO>/…` or `<SANDBOX>/…`. */
export function fencePath(rel: string): string {
  if (rel === 'home' || rel.startsWith('home/')) return `<HOME>${rel.slice('home'.length)}`
  if (rel === 'repo' || rel.startsWith('repo/')) return `<REPO>${rel.slice('repo'.length)}`
  return `<SANDBOX>/${rel}`
}

/** The allowlist with {@link LEARNING_VARIANT_SURFACE} replaced by the paths it stands for. */
function expandAllow(allow: readonly string[]): string[] {
  return allow.flatMap(entry => (entry === LEARNING_VARIANT_SURFACE ? LEARNING_VARIANT_PATHS : [entry]))
}

function allowed(p: string, allow: readonly string[]): boolean {
  return expandAllow(allow).some(entry => {
    if (!entry.endsWith('/**')) return p === entry
    const dir = entry.slice(0, -'/**'.length)
    return p === dir || p.startsWith(`${dir}/`)
  })
}

/** The changed paths outside `allow`, sorted. Empty means the fence holds. */
export function fenceViolations(changed: readonly string[], allow: readonly string[]): string[] {
  return changed.filter(p => !allowed(p, allow)).sort()
}

/**
 * The number of distinct allowlist entries across the table — the fence's footprint.
 *
 * D-ALLOWLIST-COUNTING: counted as declared, before expansion. A roster-derived
 * surface ({@link LEARNING_VARIANT_SURFACE}) is ONE entry, because its members come
 * from the build and not from hand edits: a new arm grows the roster with no one
 * touching this file, so the count measures the paths a person has declared. Every
 * hand-written path is one entry each, so a new hand-written path still moves the
 * count and the ceiling in numeric-floors.json says so out loud.
 */
export function allowlistSize(rows: readonly FenceRow[]): number {
  return new Set(rows.flatMap(r => r.allow)).size
}

const rowName = (row: FenceRow): string =>
  `devflow ${row.args.map(a => (a === '' ? '""' : a)).join(' ')}${row.label ? ` (${row.label})` : ''}`

/** Every test name more than one row would register; a repeat needs a `label`. */
function duplicateRowNames(rows: readonly FenceRow[]): string[] {
  const names = rows.map(rowName)
  return [...new Set(names.filter((name, i) => names.indexOf(name) !== i))]
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('write-set fence check', () => {
  it('names a write outside the allowlist, and admits one inside it', () => {
    const changed = ['<HOME>/.devflow/manifest.json', '<HOME>/.claude/rules/devflow/a.md', '<REPO>/.gitignore']
    expect(fenceViolations(changed, [MANIFEST, RULES_DIR])).toEqual(['<REPO>/.gitignore'])
  })

  it('a subtree entry admits the directory itself and nothing beside it', () => {
    expect(fenceViolations(['<HOME>/.claude/rules/devflow'], [RULES_DIR])).toEqual([])
    expect(fenceViolations(['<HOME>/.claude/rules/devflowx'], [RULES_DIR])).toEqual(['<HOME>/.claude/rules/devflowx'])
  })

  it('maps walk paths to their sandbox tokens', () => {
    expect(fencePath('home/.claude/settings.json')).toBe(SETTINGS)
    expect(fencePath('repo/sub/x')).toBe('<REPO>/sub/x')
    expect(fencePath('fake-claude.calls')).toBe('<SANDBOX>/fake-claude.calls')
    expect(fencePath('wt/.devflow')).toBe('<SANDBOX>/wt/.devflow')
  })
})

describe('write-set fence: the learning-variant allowlist', () => {
  const ROW_ALLOW = [MANIFEST, LEARNING_VARIANT_SURFACE]
  const roster = (kind: 'commands' | 'agents'): string[] =>
    LEARNING_VARIANT_PATHS.filter(entry => entry.startsWith(`<HOME>/.claude/${kind}/devflow/`))

  it('is the dist/learning-off roster, file by file, plus the learning-gated skill directory', () => {
    // Non-vacuity: the roster really was read, and carries both kinds.
    expect(roster('commands').length).toBeGreaterThan(0)
    expect(roster('agents').length).toBeGreaterThan(0)
    for (const kind of LEARNING_VARIANT_KINDS) {
      const files = readdirSync(learningOffDir(kind)).filter(name => name.endsWith('.md'))
      expect(roster(kind).map(entry => path.posix.basename(entry)).sort()).toEqual(files.sort())
    }
    expect(LEARNING_VARIANT_PATHS).toContain('<HOME>/.claude/skills/devflow:apply-decisions/**')
  })

  it('admits no subtree of the commands, agents or skills directories', () => {
    const subtrees = LEARNING_VARIANT_PATHS.filter(entry => entry.endsWith('/**'))
    expect(subtrees).toEqual(['<HOME>/.claude/skills/devflow:apply-decisions/**'])
  })

  it('admits a roster agent, a roster command and the skill, and nothing beside them', () => {
    const [agent] = roster('agents')
    const [command] = roster('commands')
    const admitted = [
      agent, command,
      '<HOME>/.claude/skills/devflow:apply-decisions',
      '<HOME>/.claude/skills/devflow:apply-decisions/SKILL.md',
      '<HOME>/.devflow/manifest.json',
    ]
    expect(fenceViolations(admitted, ROW_ALLOW)).toEqual([])
  })

  // Known-bad probes: a write the converge never makes must still fail the fence.
  it('rejects a write to an agent outside the roster', () => {
    const stray = '<HOME>/.claude/agents/devflow/not-in-the-roster.md'
    expect(LEARNING_VARIANT_PATHS).not.toContain(stray)
    expect(fenceViolations([stray], ROW_ALLOW)).toEqual([stray])
  })

  it('rejects a write to a command outside the roster, and to another skill', () => {
    const strayCommand = '<HOME>/.claude/commands/devflow/not-in-the-roster.md'
    const otherSkill = '<HOME>/.claude/skills/devflow:testing/SKILL.md'
    // Joined so the skill-reference scan over tests/**/*.ts does not read the neighbour as a skill name.
    const neighbourSkill = ['<HOME>/.claude/skills/devflow', 'apply-decisions-x/SKILL.md'].join(':')
    expect(fenceViolations([strayCommand, otherSkill, neighbourSkill], ROW_ALLOW))
      .toEqual([strayCommand, neighbourSkill, otherSkill].sort())
  })

  it('rejects a roster file name under the wrong kind', () => {
    const commandNames = new Set(roster('commands').map(entry => path.posix.basename(entry)))
    const agentOnly = roster('agents').map(entry => path.posix.basename(entry)).find(name => !commandNames.has(name))
    // Non-vacuity: the roster really holds an agent that has no command of the same name.
    expect(agentOnly).toBeDefined()
    const misplaced = `<HOME>/.claude/commands/devflow/${agentOnly}`
    expect(fenceViolations([misplaced], ROW_ALLOW)).toEqual([misplaced])
  })
})

describe('write-set fence coverage', () => {
  it('fences every command the CLI registers, or says why not', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS })
    if (r.error) throw r.error
    const section = /\nCommands:\n([\s\S]*?)(?:\n\n|\n?$)/.exec(r.stdout)?.[1] ?? ''
    const listed = [...section.matchAll(/^ {2}([a-z][a-z-]*) /gm)].map(m => m[1]).filter(name => name !== 'help')
    // Non-vacuity: the help really listed the commands.
    expect(listed).toContain('memory')
    expect(listed.sort()).toEqual(COMMANDS.map(c => c.name()).sort())
    const fenced = new Set(FENCE_ROWS.map(row => row.args[0]))
    expect(listed.filter(name => !fenced.has(name) && !(name in UNFENCED_COMMANDS))).toEqual([])
  })

  it('fences every --enable, --disable and --set a command defines, or says why not', () => {
    const missing: string[] = []
    let toggles = 0
    for (const command of COMMANDS.filter(c => !(c.name() in UNFENCED_COMMANDS))) {
      for (const option of command.options.map(o => o.long).filter(long => TOGGLE_OPTIONS.some(t => t === long))) {
        toggles++
        const action = `${command.name()} ${option}`
        const hasRow = FENCE_ROWS.some(row => row.args[0] === command.name() && row.args.includes(option ?? ''))
        if (!hasRow && !(action in UNFENCED_ACTIONS)) missing.push(action)
      }
    }
    expect(toggles).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('every unfenced action names an option the CLI really defines', () => {
    for (const action of Object.keys(UNFENCED_ACTIONS)) {
      const [name, option] = action.split(' ')
      const command = COMMANDS.find(c => c.name() === name)
      expect(command?.options.map(o => o.long), action).toContain(option)
    }
  })

  it('every row registers a test name no other row has', () => {
    expect(duplicateRowNames(FENCE_ROWS)).toEqual([])
    // Red probe: two unlabelled rows with the same args are caught.
    const twin: FenceRow = { args: ['hud', '--status'], allow: NONE, mustWrite: false }
    expect(duplicateRowNames([twin, twin])).toEqual(['devflow hud --status'])
    expect(duplicateRowNames([twin, { ...twin, label: 'again' }])).toEqual([])
  })

  it('the table and its footprint stay registered in numeric-floors.json', () => {
    expect(FENCE_ROWS.length).toBeGreaterThanOrEqual(56)
    expect(new Set(FENCE_ROWS.map(row => row.args[0])).size).toBeGreaterThanOrEqual(15)
    expect(allowlistSize(FENCE_ROWS)).toBeLessThanOrEqual(12)
  })

  it('counts the learning-variant surface once, and every hand-written entry once each', () => {
    const learningRows = FENCE_ROWS.filter(row => row.allow.includes(LEARNING_VARIANT_SURFACE))
    // Non-vacuity: the surface really is in the table, in both learning toggles.
    expect(learningRows.map(rowName)).toEqual(['devflow learning --disable', 'devflow learning --enable'])
    expect(allowlistSize(learningRows)).toBe(2) // the manifest and the surface
    // Red probe: a second hand-written entry takes the footprint to 13, over the ceiling.
    const extra: FenceRow = { args: ['hud', '--status'], allow: ['<HOME>/.claude/hand-written.json'], mustWrite: false }
    expect(allowlistSize([...FENCE_ROWS, extra])).toBe(allowlistSize(FENCE_ROWS) + 1)
    expect(allowlistSize([...FENCE_ROWS, extra])).toBe(13)
    expect(() => expect(allowlistSize([...FENCE_ROWS, extra])).toBeLessThanOrEqual(12)).toThrow()
  })
})

describe('write-set fence: every toggle writes only inside its allowlist', () => {
  let sb: Sandbox | undefined
  const sandbox = (): Sandbox => {
    if (!sb) throw new Error('the fence sandbox was not created — see the beforeAll failure')
    return sb
  }

  beforeAll(() => {
    sb = createSandbox()
    runCliOk(sb, ['init', '--recommended', '--security', 'user'])
    // Non-vacuity: the child env really is the sandbox HOME, never the real one, and
    // its gh is the sandbox's fake, never a machine gh whose first run writes to HOME.
    expect(sandboxChildEnv(sb).HOME).toBe(sb.home)
    expect(resolveOnPath('gh', sandboxChildEnv(sb))).toBe(path.join(sb.bin, 'gh'))
  }, SUBPROCESS_TIMEOUT_MS)

  afterAll(() => removeSandbox(sb))

  for (const row of FENCE_ROWS) {
    it(rowName(row), () => {
      const s = sandbox()
      row.seed?.(s)
      const before = readTree(s.root, excludeGit, true)
      const run = runCli(s, row.args)
      expect(run.status, run.output).toBe(0)
      const { added, modified, removed } = diffTree(before, readTree(s.root, excludeGit, true))
      const changed = [...added, ...modified, ...removed].map(fencePath)
      expect(fenceViolations(changed, row.allow), `${rowName(row)} wrote outside its allowlist`).toEqual([])
      if (row.mustWrite) expect(changed.length, `${rowName(row)} changed nothing`).toBeGreaterThan(0)
    }, SUBPROCESS_TIMEOUT_MS)
  }
})
