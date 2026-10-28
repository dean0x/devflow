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
 * The reference trees (`dist/skills/git/references/`) are outside this guard: their arms
 * and their scan belong to the reference build.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import * as path from 'path'

import { variantOffRelPath, type OffVariantKey, type VariantKind } from '../../src/core/curation-variants.js'
import { getAllAgentNames } from '../../src/core/plugins.js'
import { ROOT, resolveAllAgents } from '../helpers.js'
import {
  COMPLIANCE_VARIANT_HOSTS,
  CURATION_VARIANT_HOSTS,
  MDS_COMMAND_HOSTS,
  MDS_GENERATOR_HOSTS,
  POSTING_OPERATIONS,
} from '../fixtures/mds-manifest.js'

/** A text to scan, with the label a defect names it by. */
interface ScanFile {
  readonly path: string
  readonly text: string
}

/** One thing a compliance-off prompt must not hold. */
interface PostingPattern {
  readonly id: string
  readonly re: RegExp
}

/**
 * The items AC-13 lists, as patterns. Each op name is a pattern of its own: a spawn, a
 * loading row, a prose pointer and a path all name the op, and none belongs in an off prompt.
 */
const POSTING_PATTERNS: readonly PostingPattern[] = [
  { id: 'publish call', re: /verify-evidence\.cjs["`]?\s+publish\b/ },
  ...POSTING_OPERATIONS.map((op): PostingPattern => ({ id: `op ${op}`, re: new RegExp(`\\b${op}\\b`) })),
  { id: 'PR_TEST_PLAN_BLOCK input', re: /\bPR_TEST_PLAN_BLOCK\b/ },
  { id: 'PR_EXCEPTIONS input', re: /\bPR_EXCEPTIONS\b/ },
  { id: 'TRACEABILITY_EXCEPTIONS input', re: /\bTRACEABILITY_EXCEPTIONS\b/ },
  { id: 'SHIPPED_ISSUES input', re: /\bSHIPPED_ISSUES\b/ },
  { id: 'PLAN_ARTIFACT_PATH input', re: /\bPLAN_ARTIFACT_PATH\b/ },
  { id: 'gap-synthesis REQUIREMENTS input', re: /REQUIREMENTS: \{discovered requirements summary from Phase 6 gap synthesis/ },
  { id: 'Code report text in PR_DESCRIPTION_GUIDANCE', re: /Code agents' reports from `?CODE_AGENT_OUTPUT/ },
  { id: 'Validate report text in PR_DESCRIPTION_GUIDANCE', re: /Validate's `Lint pack:` line if UNVERIFIED/ },
  { id: 'implement evidence asks read', re: /implement-evidence-asks/ },
  { id: 'Reviewer Focus Areas heading', re: /Reviewer Focus Areas/ },
]

/** Why a posting line may stay in an off prompt: it forbids the act, describes it, or names a plain op. */
type AllowReason = 'prohibition' | 'description' | 'plain-op'

/** One excused hit: the file it sits in, the pattern id it matches, and the reason it stays. */
interface AllowEntry {
  readonly file: string
  readonly pattern: string
  readonly reason: AllowReason
}

/** The excused hits. Empty: no off prompt holds a posting line. An entry is added only with its reason. */
const ALLOWLIST: readonly AllowEntry[] = []

/**
 * Named collector: the posting items a set of texts hold outside the allowlist, one
 * `<path>: <pattern id>` entry per file and pattern, in scan order.
 */
export function collectPostingHits(
  files: readonly ScanFile[],
  patterns: readonly PostingPattern[] = POSTING_PATTERNS,
  allowlist: readonly AllowEntry[] = ALLOWLIST,
): string[] {
  const hits: string[] = []
  for (const file of files) {
    for (const pattern of patterns) {
      if (!pattern.re.test(file.text)) continue
      if (allowlist.some(entry => entry.file === file.path && entry.pattern === pattern.id)) continue
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
