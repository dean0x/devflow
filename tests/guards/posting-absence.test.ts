/**
 * Posting-absence guard (#648, AC-13, AC-16 and AC-18: no on build prints the local line, each off command prints it once).
 *
 * With compliance off, a machine installs no step that posts to GitHub or a tracker.
 * The text is absent from the prompt, not gated at run time (a gate is text the model
 * can read past). This guard scans the compliance-off builds of every host on the
 * roster, `dist/compliance-off/` and `dist/curation-compliance-off/`, for the items
 * AC-13 lists, and finds none. It scans the prompts of every host outside the roster
 * the same way: a host with no compliance arm installs its compliance-on text, so its
 * prompt must name no posting item either. That group is the command hosts and the
 * compiled agent hosts with no arm, in the curation-on and the curation-off build,
 * and the hand-authored agents.
 *
 * The scan is held honest four ways:
 *   - the same patterns run over the compliance-on prompts and each must find a hit,
 *     so no pattern is empty by design;
 *   - a posting line seeded into a clean text must fail the scan, and an allowlist
 *     entry with a reason must excuse it, so both halves of the collector are live;
 *   - the off hosts come from COMPLIANCE_VARIANT_HOSTS, the roster the build manifest is
 *     held to in both directions, so a host cannot gain an arm and escape the scan;
 *   - the hosts outside the roster are the other hosts of the manifest and the agent
 *     registry, each file read and a posting line seeded into each one reported.
 *
 * The reference text a compliance-off machine installs is held to the same rule by the last
 * section (AC-44): the content of two compliance-off installs (the github install and the all-off
 * install of tests/install-snapshot.test.ts, made into injected scratch dirs) and both
 * compliance-off dist trees, including `dist/compliance-off/skills/git/references`. Its patterns
 * are the AC-44 families, its allowlist carries a reason for every excused line, and it is held
 * honest the same ways: a seeded line fails it, and every family finds a hit in the compliance-on
 * text.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  BOTH_OFF_OUTPUT_DIR,
  COMPLIANCE_OFF_OUTPUT_DIR,
  variantOffRelPath,
  type OffVariantKey,
  type VariantKind,
} from '../../src/core/curation-variants.js'
import { skillsDir } from '../../src/core/assets.js'
import { getAllAgentNames } from '../../src/core/plugins.js'
import { SKILL_REFS_OUTPUT_DIR, installedReferenceManifest } from '../../src/core/mds-variants.js'
import { ROOT, resolveAllAgents, walkFiles } from '../helpers.js'
import {
  INSTALL_CONFIGS,
  SUBPROCESS_TIMEOUT_MS,
  captureBaseline,
  createSandbox,
  excludeGitAndLogs,
  readTree,
  removeSandbox,
  runCliOk,
  type Baseline,
  type Sandbox,
} from '../install-snapshot-helpers.js'
import {
  COMPLIANCE_VARIANT_HOSTS,
  CURATION_VARIANT_HOSTS,
  MDS_COMMAND_HOSTS,
  MDS_GENERATOR_HOSTS,
  POSTING_OPERATIONS,
} from '../fixtures/mds-manifest.js'

/**
 * A text to scan, with the label a defect names it by. `key` is the name an allowlist entry
 * excuses it under when that differs from the label: the AC-44 scan reads the same file in four
 * places (two dist trees, two installs), so an entry names the file once, by its path below the tree.
 */
interface ScanFile {
  readonly path: string
  readonly text: string
  readonly key?: string
}

/** One thing a compliance-off prompt must not hold. */
interface PostingPattern {
  readonly id: string
  readonly re: RegExp
}

/** The publish call of the evidence script. */
const PUBLISH_CALL: PostingPattern = { id: 'publish call', re: /verify-evidence\.cjs["`]?\s+publish\b/ }

/** One pattern per posting operation: a spawn, a loading row, a prose pointer and a path all name the op. */
const OP_NAME_PATTERNS: readonly PostingPattern[] = POSTING_OPERATIONS.map(
  (op): PostingPattern => ({ id: `op ${op}`, re: new RegExp(`\\b${op}\\b`) }),
)

/** The heading of the PR-body section that asks a reviewer where to look. */
const REVIEWER_FOCUS_HEADING: PostingPattern = { id: 'Reviewer Focus Areas heading', re: /Reviewer Focus Areas/ }

/**
 * The items AC-13 lists, as patterns. Each op name is a pattern of its own: a spawn, a
 * loading row, a prose pointer and a path all name the op, and none belongs in an off prompt.
 */
const POSTING_PATTERNS: readonly PostingPattern[] = [
  PUBLISH_CALL,
  ...OP_NAME_PATTERNS,
  { id: 'PR_TEST_PLAN_BLOCK input', re: /\bPR_TEST_PLAN_BLOCK\b/ },
  { id: 'PR_EXCEPTIONS input', re: /\bPR_EXCEPTIONS\b/ },
  { id: 'TRACEABILITY_EXCEPTIONS input', re: /\bTRACEABILITY_EXCEPTIONS\b/ },
  { id: 'SHIPPED_ISSUES input', re: /\bSHIPPED_ISSUES\b/ },
  { id: 'PLAN_ARTIFACT_PATH input', re: /\bPLAN_ARTIFACT_PATH\b/ },
  { id: 'gap-synthesis REQUIREMENTS input', re: /REQUIREMENTS: \{discovered requirements summary from Phase 6 gap synthesis/ },
  { id: 'Code report text in PR_DESCRIPTION_GUIDANCE', re: /Code agents' reports from `?CODE_AGENT_OUTPUT/ },
  { id: 'Validate report text in PR_DESCRIPTION_GUIDANCE', re: /Validate's `Lint pack:` line if UNVERIFIED/ },
  { id: 'implement evidence asks read', re: /implement-evidence-asks/ },
  REVIEWER_FOCUS_HEADING,
]

/** Why a posting line may stay in an off prompt: it forbids the act, describes it, or names a plain op. */
const ALLOW_REASONS = ['prohibition', 'description', 'plain-op'] as const

type AllowReason = (typeof ALLOW_REASONS)[number]

/** One excused hit: the file it sits in, the pattern id it matches, and the reason it stays. */
interface AllowEntry {
  readonly file: string
  readonly pattern: string
  readonly reason: AllowReason
}

/** The excused hits of the command and agent scan. Empty: no off prompt holds a posting line. An entry is added only with its reason. */
const ALLOWLIST: readonly AllowEntry[] = []

/**
 * Named collector: the posting items a set of texts hold outside the allowlist, one
 * `<path>: <pattern id>` entry per file and pattern, in scan order. An entry excuses a file by
 * its `key` when it has one, else by its path.
 */
export function collectPostingHits(
  files: readonly ScanFile[],
  patterns: readonly PostingPattern[] = POSTING_PATTERNS,
  allowlist: readonly AllowEntry[] = ALLOWLIST,
): string[] {
  const hits: string[] = []
  for (const file of files) {
    const name = file.key ?? file.path
    for (const pattern of patterns) {
      if (!pattern.re.test(file.text)) continue
      if (allowlist.some(entry => entry.file === name && entry.pattern === pattern.id)) continue
      hits.push(`${file.path}: ${pattern.id}`)
    }
  }
  return hits
}

/** The fixed local line a compliance-off build prints once when the evidence policy is required (AC-18). */
const OFF_DEGRADED_LINE = 'TRACEABILITY: DEGRADED (compliance off on this machine; the repository requires evidence)'

/** The `.md` files directly under a repo-relative directory, sorted, or an error naming the build step. */
function readTreeDir(relDir: string): ScanFile[] {
  let names: string[]
  try {
    names = readdirSync(path.join(ROOT, relDir)).filter(name => name.endsWith('.md')).sort()
  } catch {
    throw new Error(`${relDir}/ is absent: run \`npm run build:mds\` (this guard reads compiled prompts and cannot be skipped)`)
  }
  return names.map(name => ({ path: `${relDir}/${name}`, text: readFileSync(path.join(ROOT, relDir, name), 'utf-8') }))
}

/**
 * The compliance-off prompts of every host on the roster: its compliance-off file, and its
 * both-off file when the host also carries a curation arm. One read per file, so a missing
 * file is an error and never a silent skip.
 */
function offRosterFiles(kind: VariantKind): ScanFile[] {
  const files: ScanFile[] = []
  for (const host of COMPLIANCE_VARIANT_HOSTS) {
    if (!host.startsWith(`${kind}/`)) continue
    const name = host.slice(kind.length + 1)
    const keys: OffVariantKey[] = CURATION_VARIANT_HOSTS.includes(host) ? ['compliance-off', 'both-off'] : ['compliance-off']
    for (const key of keys) {
      const rel = variantOffRelPath(key, kind, `${name}.md`)
      let text: string
      try {
        text = readFileSync(path.join(ROOT, rel), 'utf-8')
      } catch {
        throw new Error(`${rel} is absent: run \`npm run build:mds\` (the roster names ${host}, so the build must write it)`)
      }
      files.push({ path: rel, text })
    }
  }
  return files
}

/** Every prompt built with compliance on: the commands and agents, curation on and off. */
function complianceOnFiles(): { commands: ScanFile[]; agents: ScanFile[]; all: ScanFile[] } {
  const commands = readTreeDir('dist/commands')
  const agents = readTreeDir('dist/agents')
  const all = [...commands, ...agents, ...readTreeDir('dist/curation-off/commands'), ...readTreeDir('dist/curation-off/agents')]
  return { commands, agents, all }
}

/** True when the host `<kind>/<name>` carries a compliance arm, so a compliance-off machine installs its off file. */
function isArmed(kind: VariantKind, name: string): boolean {
  return COMPLIANCE_VARIANT_HOSTS.includes(`${kind}/${name}`)
}

/**
 * The prompts a compliance-off machine installs from outside the roster. A host with no compliance
 * arm has no off file, so the machine installs the same text a compliance-on machine does: the
 * curation-on build, or the curation-off build when curation is also off. A hand-authored agent has no
 * build and installs as written. One read per file, so a missing file is an error and never a silent skip.
 */
function unarmedFiles(): { commands: ScanFile[]; agents: ScanFile[]; handAuthored: ScanFile[]; all: ScanFile[] } {
  const compiled = (kind: VariantKind): ScanFile[] =>
    [...readTreeDir(`dist/${kind}`), ...readTreeDir(`dist/curation-off/${kind}`)].filter(
      file => !isArmed(kind, path.basename(file.path, '.md')),
    )
  const commands = compiled('commands')
  const agents = compiled('agents')
  const handAuthored = [...resolveAllAgents().values()]
    .filter(source => source.origin === 'src')
    .map((source): ScanFile => ({ path: path.relative(ROOT, source.path).split(path.sep).join('/'), text: source.content }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { commands, agents, handAuthored, all: [...commands, ...agents, ...handAuthored] }
}

/**
 * The compiled files the manifest says the unarmed hosts of one kind have: the curation-on file of each, and
 * the curation-off file of each that also carries a curation arm. Sorted, so it compares to the scan's own list.
 */
function expectedUnarmedPaths(kind: VariantKind, hosts: readonly string[]): string[] {
  return hosts
    .filter(name => !isArmed(kind, name))
    .flatMap(name => [`dist/${kind}/${name}.md`, ...(CURATION_VARIANT_HOSTS.includes(`${kind}/${name}`) ? [`dist/curation-off/${kind}/${name}.md`] : [])])
    .sort()
}

describe('posting absence: a compliance-off prompt holds no posting item (AC-13, AC-16)', () => {
  const offCommands = offRosterFiles('commands')
  const offAgents = offRosterFiles('agents')

  it('the compliance-off command prompts hold none of the listed posting items', () => {
    expect(collectPostingHits(offCommands)).toEqual([])
  })

  it('the compliance-off agent prompts hold none of the listed posting items', () => {
    expect(offAgents.length, 'the roster names agents, so the scan reads at least one off agent').toBeGreaterThan(0)
    expect(collectPostingHits(offAgents)).toEqual([])
  })

  it('every host on the roster has the off files its arms call for, and the scan reads them all', () => {
    const expected = COMPLIANCE_VARIANT_HOSTS.reduce(
      (count, host) => count + (CURATION_VARIANT_HOSTS.includes(host) ? 2 : 1),
      0,
    )
    expect(offCommands.length + offAgents.length).toBe(expected)
  })
})

describe('posting absence: a prompt outside the roster holds no posting item (AC-13, AC-16)', () => {
  const unarmed = unarmedFiles()
  const unarmedCommandPaths = expectedUnarmedPaths('commands', MDS_COMMAND_HOSTS)
  const unarmedAgentPaths = expectedUnarmedPaths('agents', MDS_GENERATOR_HOSTS)
  const handAuthoredNames = getAllAgentNames().filter(name => !(MDS_GENERATOR_HOSTS as readonly string[]).includes(name)).sort()

  it('the command prompts with no compliance arm, curation on and off, hold none of the listed posting items', () => {
    expect(collectPostingHits(unarmed.commands)).toEqual([])
  })

  it('the compiled agent prompts with no compliance arm, curation on and off, hold none of the listed posting items', () => {
    expect(collectPostingHits(unarmed.agents)).toEqual([])
  })

  it('the hand-authored agent prompts hold none of the listed posting items', () => {
    expect(collectPostingHits(unarmed.handAuthored)).toEqual([])
  })

  it('the scan reads every file the manifests name for a host outside the roster, and no armed host', () => {
    expect(unarmedCommandPaths.length, 'the manifest names command hosts with no compliance arm').toBeGreaterThan(0)
    expect(unarmedAgentPaths.length, 'the manifest names compiled agent hosts with no compliance arm').toBeGreaterThan(0)
    expect(handAuthoredNames.length, 'the agent registry names hand-authored agents').toBeGreaterThan(0)
    expect(unarmed.commands.map(file => file.path).sort()).toEqual(unarmedCommandPaths)
    expect(unarmed.agents.map(file => file.path).sort()).toEqual(unarmedAgentPaths)
    expect(unarmed.handAuthored.map(file => path.basename(file.path, '.md')).sort()).toEqual(handAuthoredNames)
  })

  it('known-bad probe: a posting line seeded into any one outside-the-roster prompt is reported, by file and pattern', () => {
    const seeded = unarmed.all.map((file): ScanFile => ({ ...file, text: `${file.text}\nOPERATION: manage-debt\n` }))
    expect(collectPostingHits(unarmed.all)).toEqual([])
    expect(collectPostingHits(seeded)).toEqual(unarmed.all.map(file => `${file.path}: op manage-debt`))
  })
})

describe('posting absence: the scan is not empty by design (AC-13)', () => {
  const on = complianceOnFiles()

  it('every pattern finds a hit in the compliance-on prompts', () => {
    expect(on.commands.length, 'the on commands are read').toBeGreaterThan(0)
    expect(on.agents.length, 'the on agents are read').toBeGreaterThan(0)
    const silent = POSTING_PATTERNS.filter(pattern => collectPostingHits([...on.commands, ...on.agents], [pattern], []).length === 0)
    expect(silent.map(pattern => pattern.id), 'a pattern that matches no on prompt proves nothing about an off one').toEqual([])
  })

  it('the Git agent names all eight posting operations, so the agent scan is held by the same names', () => {
    const git = on.agents.find(file => file.path === 'dist/agents/git.md')
    expect(git, 'dist/agents/git.md is read').toBeDefined()
    const named = POSTING_OPERATIONS.filter(op => new RegExp(`\\b${op}\\b`).test(git?.text ?? ''))
    expect(named).toEqual([...POSTING_OPERATIONS])
  })

  it('no compliance-on prompt prints the compliance-off notice (AC-18)', () => {
    expect(on.all.filter(file => file.text.includes(OFF_DEGRADED_LINE)).map(file => file.path)).toEqual([])
  })
})

/**
 * Named collector: the off command prompts that do not carry the fixed local line exactly once, recorded only
 * under the `required` policy (AC-18).
 */
function collectOffLineDefects(files: readonly ScanFile[]): string[] {
  const out: string[] = []
  const gate = `When \`EVIDENCE_POLICY\` is \`required\`, record \`${OFF_DEGRADED_LINE}\``
  for (const file of files) {
    const count = file.text.split(OFF_DEGRADED_LINE).length - 1
    if (count !== 1) out.push(`${file.path}: the fixed line appears ${count} times, expected 1`)
    else if (!file.text.includes(gate)) out.push(`${file.path}: the fixed line is not recorded only under the required policy`)
  }
  return out
}

describe('posting absence: each compliance-off command prints the fixed local line under `required` (AC-18)', () => {
  const offCommands = offRosterFiles('commands')

  it('every compliance-off command prompt on the roster holds the line once, behind the required-policy condition', () => {
    expect(offCommands.length, 'the roster names commands, so the scan reads at least one off command').toBeGreaterThan(0)
    expect(collectOffLineDefects(offCommands)).toEqual([])
  })

  it('known-bad probes: a missing, a doubled and an unconditional line are each reported', () => {
    const gate = `When \`EVIDENCE_POLICY\` is \`required\`, record \`${OFF_DEGRADED_LINE}\``
    const good: ScanFile = { path: 'seeded/good.md', text: `${gate} once.\n` }
    expect(collectOffLineDefects([good])).toEqual([])
    expect(collectOffLineDefects([{ path: 'seeded/none.md', text: 'No line.\n' }])).toEqual(['seeded/none.md: the fixed line appears 0 times, expected 1'])
    expect(collectOffLineDefects([{ path: 'seeded/twice.md', text: `${good.text}${good.text}` }])).toEqual(['seeded/twice.md: the fixed line appears 2 times, expected 1'])
    expect(collectOffLineDefects([{ path: 'seeded/bare.md', text: `Record \`${OFF_DEGRADED_LINE}\`.\n` }])).toEqual(['seeded/bare.md: the fixed line is not recorded only under the required policy'])
  })
})

/** One plain Git spawn a compliance-off command keeps: the host, the operation and the inputs its spawn passes (AC-14). */
interface PlainSpawn {
  readonly host: string
  readonly op: string
  readonly inputs: readonly string[]
  /** Inputs the off spawn must not pass (AC-14: the plan passes the scope title and statement only). */
  readonly absent?: readonly string[]
  /** The text that finds the spawn when the prompt names it in prose and not as an `OPERATION:` line. */
  readonly anchor?: string
  /** The lines the spawn spans from its anchor line. The default is `SPAWN_WINDOW_LINES`. */
  readonly lines?: number
}

/**
 * The plain writes the compliance-off commands keep (AC-14): the PR-opening spawn with its plain inputs, the
 * task setup and the issue filing. A command joins this list when it joins the roster. The plan passes the
 * scope title and statement only, and the release passes `COMMIT_LIST` to its notes (its spawn is one prose
 * line, so it names its own anchor and span).
 */
const PLAIN_SPAWNS: readonly PlainSpawn[] = [
  { host: 'code-review', op: 'ensure-pr-ready', inputs: ['PR_DESCRIPTION_GUIDANCE:', 'APPLY_CONVENTIONS:'] },
  { host: 'bug-analysis', op: 'ensure-pr-ready', inputs: ['APPLY_CONVENTIONS:'] },
  { host: 'dynamic-build', op: 'setup-task', inputs: ['TASK_DESCRIPTION:', 'ISSUE_REQUIRED:', 'APPLY_CONVENTIONS:'] },
  { host: 'dynamic-build', op: 'ensure-pr-ready', inputs: ['PR_DESCRIPTION_GUIDANCE:', 'APPLY_CONVENTIONS:', 'PR_WAVE_BLOCK:'] },
  { host: 'dynamic-tickets', op: 'ensure-traceable-issue', inputs: ['TASK_DESCRIPTION:', 'REQUIREMENTS:', 'WORKTREE_PATH:'] },
  {
    host: 'plan',
    op: 'ensure-traceable-issue',
    inputs: ['TASK_DESCRIPTION:', 'INITIAL_REQUEST:', 'WORKTREE_PATH:'],
    absent: ['REQUIREMENTS:', 'PLAN_ARTIFACT_PATH:'],
  },
  { host: 'release', op: 'create-release', inputs: ['COMMIT_LIST'], anchor: 'with `create-release` operation', lines: 1 },
]

/** The lines a spawn's inputs sit in: the `OPERATION:` line and the 13 after it. */
const SPAWN_WINDOW_LINES = 14

/**
 * Named collector: the plain spawns a set of off prompts lose. A prompt of a host in the table must name the
 * operation, and its spawn window must carry every input the row lists. A prompt of another host is not read.
 */
function collectPlainSpawnDefects(files: readonly ScanFile[], table: readonly PlainSpawn[] = PLAIN_SPAWNS): string[] {
  const out: string[] = []
  for (const file of files) {
    const host = path.basename(file.path, '.md')
    const lines = file.text.split('\n')
    for (const row of table.filter(r => r.host === host)) {
      const anchor = row.anchor ?? `OPERATION: ${row.op}`
      const at = lines.findIndex(line => line.includes(anchor))
      if (at === -1) {
        out.push(`${file.path}: no ${row.op} spawn`)
        continue
      }
      const window = lines.slice(at, at + (row.lines ?? SPAWN_WINDOW_LINES)).join('\n')
      for (const input of row.inputs.filter(i => !window.includes(i))) out.push(`${file.path}: the ${row.op} spawn drops ${input}`)
      for (const input of (row.absent ?? []).filter(i => window.includes(i))) out.push(`${file.path}: the ${row.op} spawn passes ${input}`)
    }
  }
  return out
}

describe('posting absence: the compliance-off commands keep their plain writes (AC-14)', () => {
  const offCommands = offRosterFiles('commands')

  it('every plain spawn of the table is in each off build of its host, with its inputs', () => {
    const hostsRead = PLAIN_SPAWNS.map(row => row.host).filter(host => offCommands.some(file => path.basename(file.path, '.md') === host))
    expect(hostsRead.length, 'every host of the table is on the roster, so each is read').toBe(PLAIN_SPAWNS.length)
    expect(collectPlainSpawnDefects(offCommands)).toEqual([])
  })

  it('the on builds carry the same spawns, so the table is not read against a text the host never had', () => {
    const on = complianceOnFiles().commands
    const kept = PLAIN_SPAWNS.map((row): PlainSpawn => ({ ...row, absent: [] }))
    expect(collectPlainSpawnDefects(on, kept)).toEqual([])
  })

  it('the on plan still passes the inputs the off plan drops, so the absence row is not vacuous', () => {
    const on = complianceOnFiles().commands.filter(file => file.path.endsWith('/plan.md'))
    expect(on.length).toBe(1)
    expect(collectPlainSpawnDefects(on)).toEqual([
      `${on[0]!.path}: the ensure-traceable-issue spawn passes REQUIREMENTS:`,
      `${on[0]!.path}: the ensure-traceable-issue spawn passes PLAN_ARTIFACT_PATH:`,
    ])
  })

  it('known-bad probes: the plan passing a gap input and the release passing no commit list are each reported', () => {
    const plan = offCommands.find(file => file.path.endsWith('/plan.md'))!
    expect(collectPlainSpawnDefects([plan])).toEqual([])
    const gap: ScanFile = { ...plan, text: plan.text.replace('LABELS: feature', 'REQUIREMENTS: {gap text}\nLABELS: feature') }
    expect(collectPlainSpawnDefects([gap])).toEqual([`${plan.path}: the ensure-traceable-issue spawn passes REQUIREMENTS:`])
    const noScope: ScanFile = { ...plan, text: plan.text.replace('INITIAL_REQUEST: {the Gate 0', 'SCOPE: {the Gate 0') }
    expect(collectPlainSpawnDefects([noScope])).toEqual([`${plan.path}: the ensure-traceable-issue spawn drops INITIAL_REQUEST:`])
    const release = offCommands.find(file => file.path.endsWith('/release.md'))!
    expect(collectPlainSpawnDefects([release])).toEqual([])
    const noList: ScanFile = { ...release, text: release.text.replace('also pass `COMMIT_LIST` from RELEASE_EVIDENCE as an input', 'also pass nothing') }
    expect(collectPlainSpawnDefects([noList])).toEqual([`${release.path}: the create-release spawn drops COMMIT_LIST`])
  })

  it('known-bad probes: a lost spawn and a lost input are each reported', () => {
    const base = offCommands.find(file => file.path.endsWith('/code-review.md'))!
    expect(collectPlainSpawnDefects([base])).toEqual([])
    const noSpawn: ScanFile = { ...base, text: base.text.replaceAll('OPERATION: ensure-pr-ready', 'OPERATION: other') }
    expect(collectPlainSpawnDefects([noSpawn])).toEqual([`${base.path}: no ensure-pr-ready spawn`])
    const noInput: ScanFile = { ...base, text: base.text.replace('APPLY_CONVENTIONS: {APPLY_CONVENTIONS}\nValidate branch', 'Validate branch') }
    expect(collectPlainSpawnDefects([noInput])).toEqual([`${base.path}: the ensure-pr-ready spawn drops APPLY_CONVENTIONS:`])
  })
})

describe('posting absence: known-bad probes keep the collector live', () => {
  const clean: ScanFile = { path: 'seeded/clean.md', text: 'Spawn the Git agent with ensure-pr-ready.\n' }

  it('a clean text is not reported', () => {
    expect(collectPostingHits([clean])).toEqual([])
  })

  it('a seeded posting line is reported, by file and pattern', () => {
    const seeded: ScanFile = { path: 'seeded/dirty.md', text: `${clean.text}"OPERATION: manage-debt\n` }
    expect(collectPostingHits([seeded])).toEqual(['seeded/dirty.md: op manage-debt'])
    const publish: ScanFile = { path: 'seeded/publish.md', text: 'node "$HOME/.devflow/scripts/verify-evidence.cjs" publish --pr 1\n' }
    expect(collectPostingHits([publish])).toEqual(['seeded/publish.md: publish call'])
  })

  it('an allowlist entry excuses its own file and pattern and nothing else', () => {
    const seeded: ScanFile = { path: 'seeded/dirty.md', text: 'Never call manage-debt here.\nPR_EXCEPTIONS: (none)\n' }
    const entry: AllowEntry = { file: 'seeded/dirty.md', pattern: 'op manage-debt', reason: 'prohibition' }
    expect(collectPostingHits([seeded], POSTING_PATTERNS, [entry])).toEqual(['seeded/dirty.md: PR_EXCEPTIONS input'])
    expect(collectPostingHits([{ ...seeded, path: 'seeded/other.md' }], POSTING_PATTERNS, [entry])).toEqual([
      'seeded/other.md: op manage-debt',
      'seeded/other.md: PR_EXCEPTIONS input',
    ])
  })
})

// ---------------------------------------------------------------------------
// AC-44: the compliance-off installs and the compliance-off dist trees hold no posting step
//
// The command and agent scan above covers the prompts. This one covers everything else a
// compliance-off machine installs as text: the reference documents of the git skill, the static
// skills, the rules and the hook text. Four corpora are scanned:
//   - the content of the github install and of the all-off install of tests/install-snapshot.test.ts,
//     each made by the built CLI into its own scratch HOME and repo (the snapshot configs that do not
//     enable a compliance framework), every installed file;
//   - `dist/compliance-off/` and `dist/curation-compliance-off/`, every file, including
//     `dist/compliance-off/skills/git/references/`.
//
// An installed script (`.js`, `.cjs`) is code, not text a model reads, and is left out: the
// evidence script keeps its publish code, and what holds it back on a compliance-off machine is the
// run-time refusal in tests/evidence/update-pr-evidence.test.ts. Everything else is scanned.
//
// A hit outside the allowlist fails. An allowlist entry names a file (by its path below the tree, so
// one entry covers the same file in all four corpora), the pattern id, and one reason:
//   prohibition  the line forbids the act, or greps for it as a violation;
//   description  the line says what an operation or a PR-body section is, and instructs nothing;
//   plain-op     the line is a write the compliance-off machine keeps (the PR body, the PR title).
// A hit that fits none of the three is a posting step left in an off build. It needs an arm in its
// source, not an allowlist entry.
// ---------------------------------------------------------------------------

/** The write flag of a `gh api` comment call, and the route it writes to. */
const WRITE_FLAG = '(?:-X|--method)\\s+(?:POST|PATCH)\\b'
const COMMENTS_ROUTE = '\\/comments\\b'
/** The same line or the next two: a wrapped `gh api` call puts its route on a following line. */
const WITHIN_TWO_LINES = '(?:[^\\n]*\\n){0,2}?[^\\n]*'

/** The AC-44 families, as patterns, plus the publish call, the eight op names and the Reviewer Focus Areas heading shared with AC-13. */
const AC44_PATTERNS: readonly PostingPattern[] = [
  { id: 'gh comment command', re: /\bgh\s+(?:pr|issue)\s+comment\b/ },
  { id: 'gh pr review command', re: /\bgh\s+pr\s+review\b/ },
  { id: 'gh pr edit command', re: /\bgh\s+pr\s+edit\b/ },
  { id: 'gh issue edit command', re: /\bgh\s+issue\s+edit\b/ },
  {
    id: 'comment POST or PATCH call',
    re: new RegExp(`${WRITE_FLAG}${WITHIN_TWO_LINES}${COMMENTS_ROUTE}|${COMMENTS_ROUTE}${WITHIN_TWO_LINES}${WRITE_FLAG}`),
  },
  PUBLISH_CALL,
  ...OP_NAME_PATTERNS,
  { id: 'MCP add-comment tool', re: /\*add comment\*|\|\s*add comment\s*\|/ },
  { id: 'MCP edit-comment tool', re: /\*edit comment in place\*|\|\s*edit comment in place\s*\|/ },
  { id: 'Testing Gaps heading', re: /Testing Gaps/ },
  REVIEWER_FOCUS_HEADING,
]

/**
 * The excused hits of the AC-44 scan. An entry is added only for a hit that exists, with its reason;
 * a test below fails an entry that no scanned text hits any more. The file is the path below the tree
 * (the same file is read in the github install, the all-off install and the compliance-off dist tree).
 */
const AC44_ALLOWLIST: readonly AllowEntry[] = [
  // The review methodology tells a reviewer to write findings into the report and never to post them.
  // `patterns.md` says where publishing happens (the Git agent's post-review-summary operation, with
  // its visibility gate and scrub): it describes the operation and instructs nothing.
  { file: 'skills/review-methodology/references/patterns.md', pattern: 'op post-review-summary', reason: 'description' },
  // `violations.md` lists "Publishing from inside a review" as a violation, and its detection greps
  // look for `gh pr comment` in review instructions: both forbid the act.
  { file: 'skills/review-methodology/references/violations.md', pattern: 'op post-review-summary', reason: 'prohibition' },
  { file: 'skills/review-methodology/references/violations.md', pattern: 'gh comment command', reason: 'prohibition' },
  // The docs framework lists which agents persist no file; its Git line says what the operation writes
  // (a consolidated review comment only). It describes the operation and instructs nothing.
  { file: 'skills/docs-framework/SKILL.md', pattern: 'op post-review-summary', reason: 'description' },
  // The Git skill's PR description template names the two sections a PR body may carry, and its
  // checks table says when the Testing Gaps section is warned. It describes the template; the
  // compliance-off ensure-pr-ready reference carries no step that fills either section.
  { file: 'skills/git/references/patterns.md', pattern: 'Testing Gaps heading', reason: 'description' },
  { file: 'skills/git/references/patterns.md', pattern: 'Reviewer Focus Areas heading', reason: 'description' },
  // The tool-call contract's capability table lists every capability a tracker operation may need and
  // what it does when no tool offers it. The two comment-write rows describe a capability; no kept
  // operation names either one as a step (the AC-42 arms cut every such step).
  { file: 'skills/git/references/tracker/_mcp.md', pattern: 'MCP add-comment tool', reason: 'description' },
  { file: 'skills/git/references/tracker/_mcp.md', pattern: 'MCP edit-comment tool', reason: 'description' },
  // ensure-pr-ready keeps two PR writes with compliance off (AC-14): the retitle of step 4c (the title
  // is validated before use) and the `## Related Issues` body edit of step 4b (through the D11 scrub).
  // The PR body is kept.
  { file: 'skills/git/references/tracker/github/ensure-pr-ready.md', pattern: 'gh pr edit command', reason: 'plain-op' },
  { file: 'skills/git/references/tracker/jira/ensure-pr-ready.md', pattern: 'gh pr edit command', reason: 'plain-op' },
  { file: 'skills/git/references/tracker/linear/ensure-pr-ready.md', pattern: 'gh pr edit command', reason: 'plain-op' },
]

/**
 * The path below the tree of a file read from a HOME: the install-only `devflow` namespace of a skill
 * or of a command, agent or rule folder is dropped, so an installed file and a built one share a name.
 */
export function scanKeyOf(homeRel: string): string {
  const skill = /^\.claude\/skills\/devflow:([^/]+)\/(.+)$/.exec(homeRel)
  if (skill !== null) return `skills/${skill[1]}/${skill[2]}`
  const folder = /^\.claude\/(commands|agents|rules)\/devflow\/(.+)$/.exec(homeRel)
  return folder === null ? homeRel : `${folder[1]}/${folder[2]}`
}

/** The compliance-off dist trees the scan reads. */
const OFF_DIST_TREES: readonly string[] = [COMPLIANCE_OFF_OUTPUT_DIR, BOTH_OFF_OUTPUT_DIR]

/** Every file of one dist tree, read as text. An absent or empty tree is an error that names the build step. */
function distTreeFiles(treeRel: string): ScanFile[] {
  const root = path.join(ROOT, ...treeRel.split('/'))
  const files = walkFiles(root, () => true)
  if (files.length === 0) throw new Error(`${treeRel}/ is absent or empty: run \`npm run build:mds\` (this guard reads compiled trees and cannot be skipped)`)
  return files.map(file => {
    const rel = path.relative(root, file).split(path.sep).join('/')
    return { path: `${treeRel}/${rel}`, text: readFileSync(file, 'utf-8'), key: rel }
  })
}

/** An installed script is code; a model reads none of it as a prompt. */
const SCRIPT_FILE_RE = /\.(?:c?js|mjs)$/

/** One install made into scratch dirs: its text files, the scripts left out, and the compliance state its manifest records. */
interface InstallScan {
  readonly name: string
  readonly home: string
  readonly files: ScanFile[]
  readonly scripts: string[]
  readonly complianceEnabled: unknown
  readonly installedCompliance: unknown
}

/** The value at a key path of parsed JSON, or `undefined` when a step is not an object. */
function valueAt(value: unknown, keys: readonly string[]): unknown {
  let current = value
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Read every file the install added to the sandbox HOME and repo, apart from `.git` and the hook logs. */
function scanInstall(name: string, sb: Sandbox, baseline: Baseline): InstallScan {
  const files: ScanFile[] = []
  const scripts: string[] = []
  const roots = [
    { label: 'home', tree: readTree(sb.home, excludeGitAndLogs, true), before: baseline.home, keyOf: scanKeyOf },
    { label: 'repo', tree: readTree(sb.repo, excludeGitAndLogs, true), before: baseline.repo, keyOf: (rel: string): string => `repo/${rel}` },
  ]
  for (const root of roots) {
    for (const [rel, entry] of root.tree) {
      if (entry.kind !== 'file' || entry.content === undefined || root.before.has(rel)) continue
      if (SCRIPT_FILE_RE.test(rel)) {
        scripts.push(`${root.label}/${rel}`)
      } else if (!entry.content.includes(0)) {
        files.push({ path: `install:${name}/${root.label}/${rel}`, text: entry.content.toString('utf-8'), key: root.keyOf(rel) })
      }
    }
  }
  const manifest: unknown = JSON.parse(readFileSync(path.join(sb.home, '.devflow', 'manifest.json'), 'utf-8'))
  return {
    name,
    home: sb.home,
    files,
    scripts,
    complianceEnabled: valueAt(manifest, ['features', 'compliance', 'enabled']),
    installedCompliance: valueAt(manifest, ['installedVariants', 'compliance']),
  }
}

/** The snapshot configs that make a compliance-off install: those that do not enable a compliance framework. */
const OFF_INSTALL_CONFIGS = INSTALL_CONFIGS.filter(config => !config.initArgs.includes('--compliance'))

describe('posting absence: the compliance-off installs and dist trees hold no posting step (AC-44)', () => {
  const distTrees = OFF_DIST_TREES.map(tree => ({ tree, files: distTreeFiles(tree) }))
  const sandboxes: Sandbox[] = []
  const installs: InstallScan[] = []
  const scanned = (): ScanFile[] => [...distTrees.flatMap(entry => entry.files), ...installs.flatMap(install => install.files)]

  beforeAll(() => {
    for (const config of OFF_INSTALL_CONFIGS) {
      const sb = createSandbox()
      sandboxes.push(sb)
      const baseline = captureBaseline(sb)
      runCliOk(sb, ['init', ...config.initArgs])
      installs.push(scanInstall(config.name, sb, baseline))
    }
  }, (OFF_INSTALL_CONFIGS.length + 1) * SUBPROCESS_TIMEOUT_MS)

  afterAll(() => {
    for (const sb of sandboxes) removeSandbox(sb)
  })

  it('scans the github install and the all-off install, and no install that enables compliance', () => {
    expect(OFF_INSTALL_CONFIGS.map(config => config.name)).toEqual(['github', 'all-off'])
    expect(installs.map(install => install.name)).toEqual(OFF_INSTALL_CONFIGS.map(config => config.name))
  })

  it('each scanned install is a compliance-off install made inside the scratch dirs', () => {
    for (const install of installs) {
      expect(install.complianceEnabled, `${install.name}: features.compliance.enabled`).toBe(false)
      expect(install.installedCompliance, `${install.name}: installedVariants.compliance`).toBe(false)
      expect(install.home.startsWith(os.tmpdir()), `${install.name}: the install ran in a temp HOME`).toBe(true)
      expect(install.home, `${install.name}: never the real HOME`).not.toBe(os.homedir())
    }
  })

  it('reads every installed file but the scripts, and the scripts it leaves out include the evidence script', () => {
    for (const install of installs) {
      expect(install.files.length, `${install.name}: installed text files`).toBeGreaterThan(100)
      expect(install.files.some(file => file.key === 'skills/git/references/pr/check-ci-status.md'), `${install.name}: a git reference`).toBe(true)
      expect(install.files.some(file => file.key === 'agents/git.md'), `${install.name}: the Git agent`).toBe(true)
      expect(install.files.some(file => (file.key ?? '').startsWith('commands/')), `${install.name}: a command`).toBe(true)
      expect(install.scripts, `${install.name}: scripts left out`).toContain('home/.devflow/scripts/verify-evidence.cjs')
      expect(install.files.some(file => SCRIPT_FILE_RE.test(file.path)), `${install.name}: no script is scanned`).toBe(false)
    }
  })

  it('reads the whole compliance-off references tree of the build, and both trees hold commands', () => {
    const offRefs = distTrees[0].files.filter(file => (file.key ?? '').startsWith('skills/git/references/'))
    expect(offRefs.map(file => file.key?.slice('skills/git/references/'.length)).sort()).toEqual([...installedReferenceManifest({ compliance: false })].sort())
    for (const { tree, files } of distTrees) {
      expect(files.some(file => (file.key ?? '').startsWith('commands/')), `${tree}: commands`).toBe(true)
    }
  })

  it('no compliance-off dist tree holds a posting item outside the allowlist', () => {
    for (const { tree, files } of distTrees) {
      expect(collectPostingHits(files, AC44_PATTERNS, AC44_ALLOWLIST), tree).toEqual([])
    }
  })

  it('no compliance-off install holds a posting item outside the allowlist', () => {
    for (const install of installs) {
      expect(collectPostingHits(install.files, AC44_PATTERNS, AC44_ALLOWLIST), install.name).toEqual([])
    }
  })

  it('every allowlist entry has one of the three reasons, names a pattern of the scan, and none repeats', () => {
    const ids = new Set(AC44_PATTERNS.map(pattern => pattern.id))
    expect(AC44_ALLOWLIST.length, 'the allowlist is read').toBeGreaterThan(0)
    for (const entry of AC44_ALLOWLIST) {
      expect(ALLOW_REASONS as readonly string[], `${entry.file}: ${entry.pattern}`).toContain(entry.reason)
      expect(ids.has(entry.pattern), `${entry.file}: "${entry.pattern}" is not a pattern of the scan`).toBe(true)
    }
    const names = AC44_ALLOWLIST.map(entry => `${entry.file}: ${entry.pattern}`)
    expect(new Set(names).size, 'an entry is listed twice').toBe(names.length)
  })

  it('every allowlist entry excuses a hit that a scanned text really holds, in every corpus that holds the file', () => {
    const files = scanned()
    const stale = AC44_ALLOWLIST.filter(entry => {
      const pattern = AC44_PATTERNS.find(candidate => candidate.id === entry.pattern)
      return !files.some(file => (file.key ?? file.path) === entry.file && pattern?.re.test(file.text) === true)
    })
    expect(stale.map(entry => `${entry.file}: ${entry.pattern}`), 'an entry for a hit that is gone').toEqual([])
    for (const install of installs) {
      const unseen = AC44_ALLOWLIST.filter(entry => entry.file.startsWith('skills/') && !install.files.some(file => file.key === entry.file))
      expect(unseen.map(entry => entry.file), `${install.name}: allowlisted files missing from the install`).toEqual([])
    }
  })

  it('known-bad probe: a posting line seeded into any scanned text fails the scan, install or dist tree', () => {
    const files = scanned()
    expect(files.length, 'the scan reads the installs and both trees').toBeGreaterThan(OFF_DIST_TREES.length)
    expect(AC44_ALLOWLIST.some(entry => entry.pattern === 'op manage-debt'), 'the probe pattern is not excused anywhere').toBe(false)
    const seeded = files.map((file): ScanFile => ({ ...file, text: `${file.text}\nOPERATION: manage-debt\n` }))
    expect(collectPostingHits(files, AC44_PATTERNS, AC44_ALLOWLIST)).toEqual([])
    expect(collectPostingHits(seeded, AC44_PATTERNS, AC44_ALLOWLIST)).toEqual(files.map(file => `${file.path}: op manage-debt`))
  })

  it('known-bad probe: an allowlist entry excuses its own file and pattern in every corpus, and nothing else', () => {
    const entry = AC44_ALLOWLIST.find(candidate => candidate.pattern === 'gh comment command')
    if (entry === undefined) throw new Error('the allowlist has no gh comment entry to probe')
    const line = 'grep -rn \'gh pr comment\' --include="*.md"\n'
    for (const file of scanned().slice(0, 1)) {
      expect(collectPostingHits([{ ...file, text: line }], AC44_PATTERNS, [entry])).toEqual([`${file.path}: gh comment command`])
    }
    const excused: ScanFile = { path: `install:github/home/.claude/${entry.file}`, key: entry.file, text: line }
    expect(collectPostingHits([excused], AC44_PATTERNS, [entry])).toEqual([])
    expect(collectPostingHits([{ ...excused, key: 'skills/git/SKILL.md' }], AC44_PATTERNS, [entry])).toEqual([`${excused.path}: gh comment command`])
    expect(collectPostingHits([{ ...excused, text: 'gh pr review 1\n' }], AC44_PATTERNS, [entry])).toEqual([`${excused.path}: gh pr review command`])
  })
})

/** One line per AC-44 pattern id, each of which that pattern must match; the table is held to the pattern list below. */
const SEED_LINES: Readonly<Record<string, string>> = {
  'gh comment command': 'gh issue comment 12 --body-file "$DEVFLOW_BODY"',
  'gh pr review command': 'gh pr review 12 --comment --body-file "$DEVFLOW_BODY"',
  'gh pr edit command': 'gh pr edit 12 --body-file "$DEVFLOW_BODY"',
  'gh issue edit command': 'gh issue edit 12 --body-file "$DEVFLOW_BODY"',
  'comment POST or PATCH call': 'gh api -X PATCH "repos/o/r/issues/comments/9" -F body=@"$DEVFLOW_BODY"',
  'publish call': 'node "$HOME/.devflow/scripts/verify-evidence.cjs" publish --pr 1',
  ...Object.fromEntries(POSTING_OPERATIONS.map(op => [`op ${op}`, `OPERATION: ${op}`])),
  'MCP add-comment tool': 'Post through the *add comment* capability.',
  'MCP edit-comment tool': 'Update it through the *edit comment in place* capability.',
  'Testing Gaps heading': '### Testing Gaps',
  'Reviewer Focus Areas heading': '## Reviewer Focus Areas',
}

/** Every compliance-on text the AC-44 families are shown against: commands, agents, the git references and the static skills. */
function complianceOnTextFiles(): ScanFile[] {
  const refsRoot = path.join(ROOT, ...SKILL_REFS_OUTPUT_DIR.split('/'))
  const read = (file: string): ScanFile => ({ path: path.relative(ROOT, file).split(path.sep).join('/'), text: readFileSync(file, 'utf-8') })
  return [
    ...readTreeDir('dist/commands'),
    ...readTreeDir('dist/agents'),
    ...walkFiles(refsRoot, file => file.endsWith('.md')).map(read),
    ...walkFiles(skillsDir(), file => file.endsWith('.md')).map(read),
  ]
}

describe('posting absence: the AC-44 families are live (non-vacuity)', () => {
  const on = complianceOnTextFiles()

  it('every family finds a hit in the compliance-on commands, agents, references and static skills', () => {
    expect(on.length, 'the compliance-on text is read').toBeGreaterThan(100)
    const silent = AC44_PATTERNS.filter(pattern => collectPostingHits(on, [pattern], []).length === 0)
    expect(silent.map(pattern => pattern.id), 'a pattern that matches no compliance-on text proves nothing about an off one').toEqual([])
  })

  it('the seed table has a line for every pattern, and each line is reported under its own pattern', () => {
    expect(Object.keys(SEED_LINES).sort()).toEqual(AC44_PATTERNS.map(pattern => pattern.id).sort())
    for (const pattern of AC44_PATTERNS) {
      const seeded: ScanFile = { path: 'seeded/dirty.md', text: `Spawn the Git agent.\n${SEED_LINES[pattern.id]}\n` }
      expect(collectPostingHits([seeded], AC44_PATTERNS, []), pattern.id).toContain(`seeded/dirty.md: ${pattern.id}`)
    }
    expect(collectPostingHits([{ path: 'seeded/clean.md', text: 'Spawn the Git agent with ensure-pr-ready.\n' }], AC44_PATTERNS, [])).toEqual([])
  })

  it('a comment write is reported when its route wraps onto the next line or comes first, and a milestone write or a comment delete is not', () => {
    const hit = (text: string): string[] => collectPostingHits([{ path: 'seeded/call.md', text }], AC44_PATTERNS, [])
    const id = 'seeded/call.md: comment POST or PATCH call'
    expect(hit('gh api \\\n    -X POST \\\n    "repos/o/r/pulls/1/comments" \\\n    -F body=@"$F"\n')).toEqual([id])
    expect(hit('gh api repos/o/r/issues/comments/9 \\\n  --method PATCH -F body=@"$F"\n')).toEqual([id])
    expect(hit('gh api --method POST "repos/o/r/milestones" -f title=v1\n')).toEqual([])
    expect(hit('Given an admin\nWhen DELETE /comments/{id}\nThen 200\n')).toEqual([])
  })
})
