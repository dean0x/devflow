/**
 * Posting-absence guard (#648, AC-13, AC-16 and the on-build half of AC-18).
 *
 * With compliance off, a machine installs no step that posts to GitHub or a tracker.
 * The text is absent from the prompt, not gated at run time (a gate is text the model
 * can read past). This guard scans the compliance-off builds of every host on the
 * roster, `dist/compliance-off/` and `dist/curation-compliance-off/`, for the items
 * AC-13 lists, and finds none.
 *
 * The scan is held honest three ways:
 *   - the same patterns run over the compliance-on prompts and each must find a hit,
 *     so no pattern is empty by design;
 *   - a posting line seeded into a clean text must fail the scan, and an allowlist
 *     entry with a reason must excuse it, so both halves of the collector are live;
 *   - the off hosts come from COMPLIANCE_VARIANT_HOSTS, the roster the build manifest is
 *     held to in both directions, so a host cannot gain an arm and escape the scan.
 *
 * The reference trees (`dist/skills/git/references/`) are outside this guard: their arms
 * and their scan belong to the reference build.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import * as path from 'path'

import { variantOffRelPath, type OffVariantKey, type VariantKind } from '../../src/core/curation-variants.js'
import { ROOT } from '../helpers.js'
import { COMPLIANCE_VARIANT_HOSTS, CURATION_VARIANT_HOSTS, POSTING_OPERATIONS } from '../fixtures/mds-manifest.js'

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
