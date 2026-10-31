/**
 * D-COMPLIANCE-INJECT (AC-308, AC-309) — the compliance instruction reaches an agent through a spawn
 * prompt, and only when the resolved lens is on.
 *
 * The lens is the union of the machine, the default branch and the worktree (D-LENS-UNION), so a repository
 * can turn it on when the machine switch is off. The `compliance` skill therefore installs on every machine
 * (D-COMPLIANCE-INSTALL-ALWAYS) and an install-time variant keyed on the machine switch would be wrong. The
 * only place that knows the resolved lens is the command, so the command carries the instruction:
 *
 *   AC-308  No Code-family body carries a compliance Skill call or a compliance input. Every Code and Fix
 *           spawn site passes `COMPLIANCE_DIRECTIVE`, which is empty when `COMPLIANCE_FRAMEWORKS` is `off`,
 *           so a lens-off spawn carries nothing about compliance, not even `COMPLIANCE_FRAMEWORKS: off`.
 *   AC-309  No Review or Design body or preload carries compliance-only text. The compliance-focus spawns of
 *           /code-review and /plan carry `COMPLIANCE_FOCUS_DIRECTIVE`, and gap-analysis's compliance patterns
 *           live in a reference the /plan compliance spawn names by path.
 *
 * Read from the COMPILED prompts a session loads (`dist/commands`, `dist/agents`, `dist/curation-off`) and
 * the shipped skill sources. Every arm runs through a named collector that the live sweep and its known-bad
 * probe both call, over a corpus whose size is asserted first (a sweep that read nothing proves nothing).
 *
 * The /implement re-validation path is the one prompt that re-enters past Phase 1, and Phase 1 is where the lens and
 * the directive are set. Its reference (`implement-revalidate.md`) therefore points at the Phase 1 steps that set them
 * and copies none of their text. The reference is hand-authored source with no build step, so it is read from `src`
 * through `readAgentReference`. The Phase 1 steps it points at are read from both compiled builds. This file holds the
 * pointer (`collectRevalidateLensDefects`) and the Phase 1 source it names (`collectPhase1DirectiveSourceDefects`). It
 * does not repeat the normal-path guards: the mapping sentence of every host (`tests/compliance-prompts.test.ts`),
 * the off clause and the directive line of every spawning host in both builds (`collectUngatedHosts`) and the floor
 * of Code-family spawn sites in `implement.md` (`CODE_SPAWN_FLOORS`). The other halves of the same path are held in
 * their owners: Phase 4 keeps Harden at every level in `tests/guards/implement-resolve-levels.test.ts`, and both the
 * review-publication value and the step-1 reading of "Phase 1 ran" (`collectRevalidatePhase1RunDefects`) in
 * `tests/evidence/implement-flow.test.ts`.
 *
 * Out of scope by design: Triage. Its compliance paragraph dispositions findings the Review agents already
 * raised; it loads no skill and takes no lens, so the strict rule below does not read it. Harden's
 * "pattern compliance checking" is unrelated to the lens.
 *
 * What a green run does NOT prove: that a model follows the directive, or that the orchestrating model
 * drops the empty directive line. It proves the text and the gate are in the prompts.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import * as path from 'path'

import {
  ROOT, collectCodeSpawnSites, countOf, readAgentReference, requireDistFile, requireDistFiles, resolveAllAgents, resolveCurationOffSource, resolveVariantOffSource, sectionBetween,
} from '../helpers.js'
import type { CodeSpawnSite } from '../helpers.js'
import { seedOnce } from './level-guard-helpers.js'
import { variantOffRelPath, type OffVariantKey } from '../../src/core/curation-variants.js'
import { COMPLIANCE_VARIANT_HOSTS, CURATION_VARIANT_HOSTS } from '../fixtures/mds-manifest.js'

// ── Independent oracles: the directive lines as the commands must render them ─────────────────────────

/** The Code-family directive for `ids` (`<ids>` in prose, `${COMPLIANCE_FRAMEWORKS}` in the workflow script). */
const codeDirective = (ids: string): string =>
  'When the task touches regulated surface (data models, auth flows, logging/observability, payments, IaC, retention), ' +
  `invoke Skill(skill="devflow:compliance") and load references/{id}.md only for the ids in ${ids} ` +
  '(none: generic controls only); never fabricate guidance for a framework you were not given.'

/** The compliance-focus directive for `ids`. */
const focusDirective = (ids: string): string =>
  `For this compliance focus, invoke Skill(skill="devflow:compliance") and load references/{id}.md only for the ids in ${ids} ` +
  '(none: generic controls only); never fabricate guidance for a framework you were not given.'

/** The clause every prose host that sets the directive states: lens off means an empty directive. */
const OFF_CLAUSE = '`COMPLIANCE_DIRECTIVE` is empty when `COMPLIANCE_FRAMEWORKS` is `off`'

/** The workflow script's version of the same condition. */
const JS_OFF_CLAUSE = 'const COMPLIANCE_DIRECTIVE = COMPLIANCE_FRAMEWORKS === "off" ? "" : `'

const ACTIVE_SENTENCE = '`COMPLIANCE_ACTIVE` is `true` unless `COMPLIANCE_FRAMEWORKS` is `off`.'

/** The sentence of Phase 1 that maps the settings line's lens to `COMPLIANCE_FRAMEWORKS`. */
const FRAMEWORKS_SENTENCE =
  "`COMPLIANCE_FRAMEWORKS` is the settings line's `COMPLIANCE` with `generic` written `none`: `off`, `none`, or the framework ids the machine and this repository declare."

/** The label of the Phase 1 step that sets the directive, and the one the re-validation reference points at. */
const DIRECTIVE_STEP = '**Set the compliance directive**'

/** The re-validation reference's step that takes the settings: the one step that points at the Phase 1 lens and directive steps. */
const REVALIDATE_SETTINGS_STEP = /^\d+\. \*\*Take GATE_LEVEL\*\*/

/** The words of that step that set the lens and the directive, each exact: [what it must say, the text that says it]. */
const REVALIDATE_LENS_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['the lens comes from that same line, the accepted one or the fail-closed one', 'from that same line, the accepted one or the fail-closed one,'],
  ['COMPLIANCE_FRAMEWORKS is set as Phase 1 defines it', '`COMPLIANCE_FRAMEWORKS` as Phase 1 defines it'],
  ['COMPLIANCE_DIRECTIVE is set by the Phase 1 directive step', '`COMPLIANCE_DIRECTIVE` by the Phase 1 **Set the compliance directive** step'],
  ['Phases 5-7 pass the directive to their Fix spawns', 'Phases 5-7 pass `COMPLIANCE_DIRECTIVE` to their Fix spawns'],
]

/** What the reference must not hold: a second home for text that Phase 1 owns. [what it is, the matcher, a sample that the matcher finds]. */
const REVALIDATE_LENS_BANNED: ReadonlyArray<readonly [string, string | RegExp, string]> = [
  ['the off clause', OFF_CLAUSE, OFF_CLAUSE],
  ['the directive Skill call', 'invoke Skill(skill="devflow:compliance")', 'invoke Skill(skill="devflow:compliance")'],
  ['the compliance skill name', 'devflow:compliance', 'devflow:compliance'],
  ['the lens gate', 'COMPLIANCE_ACTIVE', 'COMPLIANCE_ACTIVE'],
  ['the raw lens as an input line', /^\s*"?COMPLIANCE_FRAMEWORKS:/m, 'COMPLIANCE_FRAMEWORKS: {COMPLIANCE_FRAMEWORKS}'],
  ['the mapping from generic to none', 'with `generic` written `none`', 'with `generic` written `none`'],
  ['a spawn', 'Agent(subagent_type=', 'Agent(subagent_type="Fix"):'],
]

/** The settings step as the reference worded it before it set the lens and the directive: a known-bad text for the collector. */
const PRE_FIX_SETTINGS_STEP =
  '4. **Take GATE_LEVEL**: unless Phase 1 ran, run the **Resolve the settings line** step of Phase 1 once for this worktree, and take `GATE_LEVEL` from the line it accepts, or from its fail-closed line when it accepts none. Phase 6 passes it to Validate.'

/** A spawn that passes the directive: a fence line, a template line, a prose sentence or the engine's pseudo-form. */
const DIRECTIVE_REF = /\$?\{COMPLIANCE_DIRECTIVE\}|(?:with|carries) `COMPLIANCE_DIRECTIVE`|\+ COMPLIANCE_DIRECTIVE \+/

/** Compiled commands that spawn Code-family agents, and the spawn sites each carries today. Floors: may only rise. */
const CODE_SPAWN_FLOORS: Readonly<Record<string, number>> = {
  // 8 fences (single, sequential ×2, parallel ×2, validation/alignment/qa-fix) + the CI-fix line
  'implement.md': 9,
  // the issue-fix and validation-fix fences + the CI-fix line
  'resolve.md': 3,
  // the fix the user accepts in the Offer Fix phase
  'debug.md': 1,
  // implement, validation-fix, alignment-fix, qa-fix, review-fix and final-validation-fix templates + the merge-conflict resolver sentence + the engine partial's pseudo-form
  'dynamic-build.md': 8,
}

/** Agents whose bodies may carry no compliance text at all (the Design focus list is the one allowance). */
const STRICT_SLUGS = ['code', 'fix', 'refactor', 'review', 'design', 'architect'] as const

/** The focus enumeration Design keeps (its `Focus` input line): focus names shared with every other focus, not compliance-only text. */
const DESIGN_FOCUS_LIST = /completeness, architecture, security, performance, compliance, consistency, or dependencies/

// ── Collectors ───────────────────────────────────────────────────────────────────────────────────────

/** Named collector: Code-family spawn sites that pass no directive. */
export function collectUndirectedSites(sites: readonly CodeSpawnSite[]): string[] {
  return sites.filter(s => !DIRECTIVE_REF.test(s.payload)).map(s => `${s.file}:${s.line}`)
}

/** Named collector: Code-family spawn sites that still hand the agent the raw lens (it would read `off` as text). */
export function collectRawLensSites(sites: readonly CodeSpawnSite[]): string[] {
  return sites.filter(s => s.payload.includes('COMPLIANCE_FRAMEWORKS')).map(s => `${s.file}:${s.line}`)
}

/**
 * Named collector: hosts that spawn Code-family agents but do not set the directive behind the lens condition
 * or render its line as the oracle spells it. `dynamic-build.md` sets it in its workflow script.
 */
export function collectUngatedHosts(hosts: ReadonlyArray<readonly [string, string]>): string[] {
  const out: string[] = []
  for (const [file, text] of hosts) {
    if (file === 'dynamic-build.md') {
      if (!text.includes(JS_OFF_CLAUSE)) out.push(`${file}: the workflow script does not empty the directive when the lens is off`)
      if (!text.includes(codeDirective('${COMPLIANCE_FRAMEWORKS}'))) out.push(`${file}: the script's directive line differs from the partial's`)
      continue
    }
    if (!text.includes(OFF_CLAUSE)) out.push(`${file}: does not state that the directive is empty when the lens is off`)
    if (!text.includes(`> ${codeDirective('<ids>')}`)) out.push(`${file}: does not render the directive line`)
  }
  return out
}

/**
 * Named collector: how a compliance-focus spawn (Review in /code-review, Design in /plan) falls short of AC-309.
 * The host must gate the focus on `COMPLIANCE_ACTIVE`, set the focus directive, and put it in the spawn fence.
 */
export function collectFocusSpawnDefects(host: string, text: string, agentType: 'Review' | 'Design'): string[] {
  const out: string[] = []
  const fence = (agentType === 'Review'
    ? text.match(/Agent\(subagent_type="Review"[\s\S]*?```/)
    : text.match(/Agent\(subagent_type="Design"\):\n"Focus: \{completeness\|architecture\|security\|performance\|compliance\|consistency\|dependencies\}\n[\s\S]*?```/))?.[0]
  if (fence === undefined) return [`${host}: no ${agentType} compliance-capable spawn fence found`]
  if (!fence.includes('{COMPLIANCE_FOCUS_DIRECTIVE}  (compliance focus only)')) out.push(`${host}: the ${agentType} spawn carries no focus directive`)
  if (fence.includes('COMPLIANCE_FRAMEWORKS')) out.push(`${host}: the ${agentType} spawn still carries the raw lens`)
  if (agentType === 'Design' && !fence.includes('skills/devflow:gap-analysis/references/compliance.md')) {
    out.push(`${host}: the Design spawn does not name the gap-analysis compliance reference`)
  }
  if (!text.includes(`> ${focusDirective('<ids>')}`)) out.push(`${host}: does not render the focus directive line`)
  if (!text.includes('`COMPLIANCE_FOCUS_DIRECTIVE` is this one line')) out.push(`${host}: does not set COMPLIANCE_FOCUS_DIRECTIVE`)
  if (!text.includes(ACTIVE_SENTENCE)) out.push(`${host}: does not gate the focus on COMPLIANCE_ACTIVE`)
  return out
}

/**
 * Named collector: how an agent body falls short of AC-308/AC-309. Every agent: no compliance Skill call and
 * no compliance input. A strict slug: no compliance text at all, bar Design's focus enumeration.
 */
export function collectAgentBodyDefects(slug: string, content: string): string[] {
  const out: string[] = []
  if (content.includes('devflow:compliance')) out.push('names devflow:compliance')
  if (content.includes('COMPLIANCE_FRAMEWORKS')) out.push('names COMPLIANCE_FRAMEWORKS')
  if ((STRICT_SLUGS as readonly string[]).includes(slug)) {
    const rest = slug === 'design' ? content.split('\n').filter(l => !DESIGN_FOCUS_LIST.test(l)).join('\n') : content
    if (/compliance/i.test(rest)) out.push('carries compliance text')
  }
  return out
}

/** Named collector: how the gap-analysis preload or its compliance reference falls short of AC-309. */
export function collectGapAnalysisDefects(skill: string, reference: string | null): string[] {
  const out: string[] = []
  if (/compliance/i.test(skill)) out.push('the preloaded SKILL.md carries compliance text')
  if (!skill.includes('GAPS IN DESIGN BECOME BUGS IN PRODUCTION')) out.push('the Iron Law is gone')
  for (const heading of ['### 1. Completeness', '### 2. Architecture', '### 3. Security', '### 4. Performance', '### 5. Consistency', '### 6. Dependencies']) {
    if (!skill.includes(heading)) out.push(`the section "${heading}" is gone`)
  }
  if (reference === null) return [...out, 'references/compliance.md is absent']
  if (!reference.includes('**Detection patterns:**')) out.push('the reference lost its detection patterns')
  if (!reference.includes('**Evidence trigger:**')) out.push('the reference lost its evidence trigger')
  return out
}

/**
 * Named collector: how the /implement re-validation reference falls short of AC-308 when Phase 1 does not run. Its
 * settings step must set the lens and the directive from the same settings line by pointing at the Phase 1 steps, and
 * the reference must hold no second copy of what those steps own (the off clause, the directive line, the skill name,
 * the lens gate, the raw lens, the mapping and a spawn).
 */
export function collectRevalidateLensDefects(reference: string): string[] {
  const step = reference.split('\n').find(line => REVALIDATE_SETTINGS_STEP.test(line))
  if (step === undefined) return ['the re-validation reference has no step that takes GATE_LEVEL']
  const out: string[] = []
  for (const [what, text] of REVALIDATE_LENS_PARTS) {
    if (!step.includes(text)) out.push(`the settings step does not say: ${what}`)
  }
  for (const [what, needle] of REVALIDATE_LENS_BANNED) {
    if (typeof needle === 'string' ? reference.includes(needle) : needle.test(reference)) out.push(`the re-validation reference copies ${what}`)
  }
  return out
}

/**
 * Named collector: how one build of /implement falls short of the Phase 1 source that the re-validation reference points
 * at. Phase 1 holds the directive step once, with the off clause in its paragraph, and the mapping sentence. Phases 5-7
 * hold three Fix spawns, and each passes the directive.
 */
export function collectPhase1DirectiveSourceDefects(label: string, md: string): string[] {
  const out: string[] = []
  const phase1 = sectionBetween(md, '### Phase 1: Setup', '### Phase 2:')
  if (phase1 === null) out.push(`${label}: no Phase 1 section`)
  else {
    if (countOf(phase1, DIRECTIVE_STEP) !== 1) out.push(`${label}: Phase 1 does not hold ${DIRECTIVE_STEP} exactly once`)
    else {
      const fromStep = phase1.slice(phase1.indexOf(DIRECTIVE_STEP))
      const stepParagraph = fromStep.split('\n\n')[0]
      if (!stepParagraph.includes(OFF_CLAUSE)) {
        out.push(`${label}: the ${DIRECTIVE_STEP} paragraph does not state that the directive is empty when the lens is off`)
      }
    }
    if (!phase1.includes(FRAMEWORKS_SENTENCE)) out.push(`${label}: Phase 1 does not hold the COMPLIANCE_FRAMEWORKS mapping sentence`)
  }
  const fixPhases = sectionBetween(md, '### Phase 5:', '### Phase 8:')
  if (fixPhases === null) return [...out, `${label}: no Phases 5-7 section`]
  const sites = collectCodeSpawnSites(label, fixPhases, 'Fix')
  if (sites.length !== 3) out.push(`${label}: Phases 5-7 hold ${sites.length} Fix spawn(s), expected 3`)
  if (collectUndirectedSites(sites).length > 0) out.push(`${label}: a Fix spawn of Phases 5-7 passes no directive`)
  return out
}

// ── Corpus ───────────────────────────────────────────────────────────────────────────────────────────

const SKILL_DIR = path.join(ROOT, 'src', 'assets', 'skills', 'gap-analysis')
const readSkillFile = (rel: string): string | null => {
  const file = path.join(SKILL_DIR, rel)
  return existsSync(file) ? readFileSync(file, 'utf-8') : null
}

const codeSites = (): CodeSpawnSite[] => requireDistFiles().flatMap(f => collectCodeSpawnSites(f, requireDistFile(f)))
const spawnHosts = (): Array<readonly [string, string]> => Object.keys(CODE_SPAWN_FLOORS).map(f => [f, requireDistFile(f)] as const)

/**
 * The curation-off variant of a compiled command (D-LEARNING-VARIANTS): a curation-off machine installs it in
 * place of `dist/commands/<file>`, and its curation-off arms are text the curation-on sweep never reads.
 */
const curationOffCommand = (file: string): string => {
  const text = resolveCurationOffSource('commands', file.replace(/\.md$/, ''))
  if (text === null) throw new Error(`dist/curation-off/commands/${file} is absent — run \`npm run build\` first`)
  return text
}
const offSpawnHosts = (): Array<readonly [string, string]> =>
  Object.keys(CODE_SPAWN_FLOORS).map(f => [f, curationOffCommand(f)] as const)

/** The two variants a compliance-off machine can install: curation on (compliance-off) and curation off (both-off). */
const COMPLIANCE_OFF_KEYS: readonly OffVariantKey[] = ['compliance-off', 'both-off']

/**
 * One compiled variant of a command on the compliance roster (#648). A host on the roster has this file, so an absent
 * one is an error that names the build step, never a skip: a host could otherwise gain an arm and leave the sweep.
 */
const complianceOffCommand = (key: OffVariantKey, name: string): string => {
  const text = resolveVariantOffSource(key, 'commands', name)
  if (text === null) throw new Error(`${variantOffRelPath(key, 'commands', `${name}.md`)} is absent — run \`npm run build\` first`)
  return text
}

/** The commands on the compliance roster, by name. */
const complianceCommandNames = (): string[] =>
  COMPLIANCE_VARIANT_HOSTS.filter(h => h.startsWith('commands/')).map(h => h.slice('commands/'.length))

/**
 * The Code-spawning hosts of the roster, in one compliance-off variant, keyed by the file name the floors use. A host
 * with a curation arm has both variants; one without has the compliance-off file only.
 */
const complianceOffSpawnHosts = (key: OffVariantKey): Array<readonly [string, string]> =>
  complianceCommandNames()
    .filter(name => `${name}.md` in CODE_SPAWN_FLOORS)
    .filter(name => key === 'compliance-off' || CURATION_VARIANT_HOSTS.includes(`commands/${name}`))
    .map(name => [`${name}.md`, complianceOffCommand(key, name)] as const)

/**
 * The compliance lens text blocks of one compiled command (AC-17): the mapping sentence, the lens step, the directive
 * step with its rendered line, the focus-directive step with its line and the active sentence. Taken by anchor and not
 * by line, because one line may carry a lens block next to text that a compliance-off variant drops.
 */
const LENS_BLOCKS: readonly RegExp[] = [
  /\*\*Resolve the compliance lens\*\*[^\n]*/g,
  /\*\*Set the compliance directive\*\*[^\n]*\n\n> [^\n]*/g,
  /\*\*Set the compliance focus directive\*\*[^\n]*\n\n> [^\n]*/g,
]

/** Named collector: every lens text block of a command, in order, each as the text it prints. */
export function collectLensBlocks(text: string): string[] {
  const blocks = LENS_BLOCKS.flatMap(re => text.match(re) ?? [])
  const sentences = [FRAMEWORKS_SENTENCE, ACTIVE_SENTENCE].flatMap(sentence => Array.from({ length: countOf(text, sentence) }, () => sentence))
  return [...blocks, ...sentences]
}

// ── AC-308 ───────────────────────────────────────────────────────────────────────────────────────────

describe('AC-308: no Code-family body carries the compliance skill; each spawn site injects the directive behind the lens', () => {
  it('reads the spawn sites it claims to read (non-vacuity)', () => {
    const sites = codeSites()
    for (const [host, floor] of Object.entries(CODE_SPAWN_FLOORS)) {
      const n = sites.filter(s => s.file === host).length
      expect(n, `${host}: ${n} Code-family spawn site(s), floor ${floor} — the collector stopped reading them`).toBeGreaterThanOrEqual(floor)
    }
    expect(
      [...new Set(sites.map(s => s.file))].sort(),
      'a command outside the named set spawns Code agents — name it in CODE_SPAWN_FLOORS',
    ).toEqual(Object.keys(CODE_SPAWN_FLOORS).sort())
  })

  it('every Code and Fix spawn site passes the directive and none passes the raw lens', () => {
    const sites = codeSites()
    expect(collectUndirectedSites(sites)).toEqual([])
    expect(collectRawLensSites(sites)).toEqual([])
  })

  it('every spawning host sets the directive empty when the lens is off', () => {
    expect(collectUngatedHosts(spawnHosts())).toEqual([])
  })

  it('a pass-through host never gates its own flow on the lens (the directive is its only use of it)', () => {
    for (const [host, text] of [...spawnHosts(), ...offSpawnHosts()]) {
      expect(text, `${host}: a pass-through host never gates on COMPLIANCE_ACTIVE`).not.toContain('COMPLIANCE_ACTIVE')
    }
  })

  it('the curation-off variants pass the directive at every site and set it behind the lens, like the curation-on ones', () => {
    const hosts = offSpawnHosts()
    const sites = hosts.flatMap(([f, t]) => collectCodeSpawnSites(f, t))
    for (const [host, floor] of Object.entries(CODE_SPAWN_FLOORS)) {
      const n = sites.filter(s => s.file === host).length
      expect(n, `${host} (curation off): ${n} Code-family spawn site(s), floor ${floor}`).toBeGreaterThanOrEqual(floor)
    }
    expect(collectUndirectedSites(sites)).toEqual([])
    expect(collectRawLensSites(sites)).toEqual([])
    expect(collectUngatedHosts(hosts)).toEqual([])
  })

  it('known-bad probe: a curation-off-only arm that drops the directive or keeps the raw lens is reported', () => {
    // Each anchor lives in a curation-off arm alone, so only the curation-off sweep can see it change.
    const probes: Array<[string, string, string]> = [
      ['implement.md', '`COMPLIANCE_DIRECTIVE` (when it is not empty), `CI_FAILURES` and `PUSH: false`', '`COMPLIANCE_FRAMEWORKS`, `CI_FAILURES` and `PUSH: false`'],
      ['dynamic-build.md', 'plan + COMPLIANCE_DIRECTIVE + handoff', 'plan + COMPLIANCE_FRAMEWORKS + handoff'],
    ]
    for (const [host, anchor, stale] of probes) {
      expect(requireDistFile(host), `${host}: the anchor must be curation-off only`).not.toContain(anchor)
      const real = curationOffCommand(host)
      expect(real, `${host}: the curation-off anchor must exist`).toContain(anchor)
      const seeded = collectCodeSpawnSites(host, real.replace(anchor, stale))
      expect(collectUndirectedSites(seeded), `${host}: the stale arm drops the directive`).toHaveLength(1)
      expect(collectRawLensSites(seeded), `${host}: the stale arm hands over the raw lens`).toHaveLength(1)
    }
  })

  it('no Code-family body, curation on or off, names the compliance skill or the lens', () => {
    const agents = resolveAllAgents()
    for (const slug of ['code', 'fix', 'refactor']) {
      const source = agents.get(slug)
      expect(source, `${slug}: the agent is not in the registry`).toBeDefined()
      expect(source!.content.length, `${slug}: the body is empty — the guard would pass vacuously`).toBeGreaterThan(4_000)
      expect(collectAgentBodyDefects(slug, source!.content), `${slug} (curation on)`).toEqual([])
      const off = resolveCurationOffSource('agents', slug)
      expect(off, `dist/curation-off/agents/${slug}.md is absent — run \`npm run build\` first`).not.toBeNull()
      expect(collectAgentBodyDefects(slug, off!), `${slug} (curation off)`).toEqual([])
    }
  })

  it('known-bad probe: a spawn site of each shape that drops the directive is reported by the same collector', () => {
    const implement = requireDistFile('implement.md')
    const dynamic = requireDistFile('dynamic-build.md')
    // [host, live text, the directive as that shape spells it, what the spawn reads without it]
    const probes: Array<[string, string, string, string]> = [
      ['implement.md', implement, '\n   {COMPLIANCE_DIRECTIVE}"', '"'],                                  // an indented fix-phase fence
      ['implement.md', implement, ' with `COMPLIANCE_DIRECTIVE` (when it is not empty)', ''],            // the CI-fix prose spawn
      ['dynamic-build.md', dynamic, '\n${COMPLIANCE_DIRECTIVE}', ''],                                    // a template spawn
      ['dynamic-build.md', dynamic, ' and carries `COMPLIANCE_DIRECTIVE` (when it is not empty)', ''],   // the merge-conflict resolver sentence
      ['dynamic-build.md', dynamic, ' + COMPLIANCE_DIRECTIVE + handoff', ' + handoff'],                  // the engine partial's pseudo-form
    ]
    for (const [host, real, directive, without] of probes) {
      expect(collectUndirectedSites(collectCodeSpawnSites(host, real)), `${host}: the live text is clean`).toEqual([])
      const seeded = real.replace(directive, without)
      expect(seeded, `${host}: the seed must land (${directive.trim()})`).not.toBe(real)
      expect(collectUndirectedSites(collectCodeSpawnSites(host, seeded)), `${host}: dropping ${directive.trim()}`).toHaveLength(1)
    }
  })

  it('known-bad probe: a spawn that hands the agent the raw lens is reported', () => {
    const implement = requireDistFile('implement.md')
    const dynamic = requireDistFile('dynamic-build.md')
    const probes: Array<[string, string, string, string]> = [
      ['implement.md', implement, '\n   {COMPLIANCE_DIRECTIVE}"', '\n   {COMPLIANCE_DIRECTIVE}\n   COMPLIANCE_FRAMEWORKS: {COMPLIANCE_FRAMEWORKS}"'],
      ['dynamic-build.md', dynamic, '\n${COMPLIANCE_DIRECTIVE}', '\n${COMPLIANCE_DIRECTIVE}\nCOMPLIANCE_FRAMEWORKS: ${COMPLIANCE_FRAMEWORKS}'],
    ]
    for (const [host, real, from, to] of probes) {
      expect(collectRawLensSites(collectCodeSpawnSites(host, real)), `${host}: the live text is clean`).toEqual([])
      const seeded = real.replace(from, to)
      expect(seeded, `${host}: the seed must land`).not.toBe(real)
      expect(collectRawLensSites(collectCodeSpawnSites(host, seeded)), `${host}: a raw lens`).toHaveLength(1)
    }
  })

  it('known-bad probe: a host that does not empty the directive when the lens is off is reported', () => {
    const live = spawnHosts()
    expect(collectUngatedHosts(live), 'the live hosts are clean').toEqual([])
    const reseed = (host: string, from: string, to: string): Array<readonly [string, string]> =>
      live.map(([file, text]) => {
        if (file !== host) return [file, text] as const
        expect(text, `${host}: the seed anchor must exist`).toContain(from)
        return [file, text.replace(from, to)] as const
      })
    expect(collectUngatedHosts(reseed('implement.md', OFF_CLAUSE, '`COMPLIANCE_DIRECTIVE` is always set')))
      .toEqual(['implement.md: does not state that the directive is empty when the lens is off'])
    expect(collectUngatedHosts(reseed('implement.md', 'invoke Skill(skill="devflow:compliance")', 'invoke the skill')))
      .toEqual(['implement.md: does not render the directive line'])
    expect(collectUngatedHosts(reseed('dynamic-build.md', JS_OFF_CLAUSE, 'const COMPLIANCE_DIRECTIVE = COMPLIANCE_FRAMEWORKS === "x" ? "" : `')))
      .toEqual(['dynamic-build.md: the workflow script does not empty the directive when the lens is off'])
    expect(collectUngatedHosts(reseed('dynamic-build.md', 'only for the ids in ${COMPLIANCE_FRAMEWORKS}', 'for all ids')))
      .toEqual(["dynamic-build.md: the script's directive line differs from the partial's"])
  })

  it('known-bad probe: a Code-family body that names the skill, takes the lens or mentions compliance is reported', () => {
    const real = resolveAllAgents().get('fix')!.content
    expect(collectAgentBodyDefects('fix', real), 'the real body is clean').toEqual([])
    expect(collectAgentBodyDefects('fix', `${real}\n2. Invoke \`Skill(skill="devflow:compliance")\`.\n`))
      .toEqual(['names devflow:compliance', 'carries compliance text'])
    expect(collectAgentBodyDefects('fix', `${real}\n- **COMPLIANCE_FRAMEWORKS** (optional): the lens\n`))
      .toEqual(['names COMPLIANCE_FRAMEWORKS', 'carries compliance text'])
    expect(collectAgentBodyDefects('fix', `${real}\nCheck compliance.\n`)).toEqual(['carries compliance text'])
  })
})

// ── AC-308 and AC-17 on the compliance-off builds ────────────────────────────────────────────────────

describe('AC-308 and AC-17: the compliance-off command builds keep the injection and the lens text', () => {
  it('reads the compliance-off spawn hosts it claims to read (non-vacuity)', () => {
    for (const key of COMPLIANCE_OFF_KEYS) {
      const hosts = complianceOffSpawnHosts(key)
      expect(hosts.map(([file]) => file), `${key}: the roster names implement and resolve`).toEqual(expect.arrayContaining(['implement.md', 'resolve.md']))
      for (const [file, text] of hosts) expect(text.length, `${key} ${file}: empty`).toBeGreaterThan(10_000)
    }
  })

  it.each(COMPLIANCE_OFF_KEYS)('every Code and Fix spawn site of the %s builds passes the directive and never the raw lens, and each host empties it when the lens is off', key => {
    const hosts = complianceOffSpawnHosts(key)
    const sites = hosts.flatMap(([file, text]) => collectCodeSpawnSites(file, text))
    for (const [file] of hosts) {
      const n = sites.filter(s => s.file === file).length
      expect(n, `${file} (${key}): ${n} Code-family spawn site(s), floor ${CODE_SPAWN_FLOORS[file]}`).toBeGreaterThanOrEqual(CODE_SPAWN_FLOORS[file])
    }
    expect(collectUndirectedSites(sites)).toEqual([])
    expect(collectRawLensSites(sites)).toEqual([])
    expect(collectUngatedHosts(hosts)).toEqual([])
    for (const [file, text] of hosts) expect(text, `${file} (${key}): a pass-through host never gates on COMPLIANCE_ACTIVE`).not.toContain('COMPLIANCE_ACTIVE')
  })

  it('known-bad probe: a compliance-off site that drops the directive or hands over the raw lens is reported', () => {
    const [file, text] = complianceOffSpawnHosts('compliance-off').find(([f]) => f === 'implement.md')!
    const anchor = '`COMPLIANCE_DIRECTIVE` (when it is not empty), `CI_FAILURES`, `DECISIONS_CONTEXT` and `PUSH: false`'
    expect(text, 'implement.md (compliance off) keeps its curation-on CI-fix line').toContain(anchor)
    const seeded = collectCodeSpawnSites(file, text.replace(anchor, '`COMPLIANCE_FRAMEWORKS`, `CI_FAILURES`, `DECISIONS_CONTEXT` and `PUSH: false`'))
    expect(collectUndirectedSites(seeded)).toHaveLength(1)
    expect(collectRawLensSites(seeded)).toHaveLength(1)
  })

  it('every lens text block of a rostered command is byte-identical across its four variants (AC-17)', () => {
    let total = 0
    for (const name of complianceCommandNames()) {
      const on = collectLensBlocks(requireDistFile(`${name}.md`))
      total += on.length
      const variants: Array<readonly [string, string]> = [
        ['curation-off', curationOffCommand(`${name}.md`)],
        ...COMPLIANCE_OFF_KEYS.map(key => [key, complianceOffCommand(key, name)] as const),
      ]
      for (const [label, text] of variants) expect(collectLensBlocks(text), `${name}: the ${label} variant`).toEqual(on)
    }
    expect(total, 'the roster commands carry lens blocks, so the comparison is not empty').toBeGreaterThanOrEqual(4)
  })

  it('known-bad probe: a lens block that one variant words differently is reported, and text beside a block is not', () => {
    const on = collectLensBlocks(requireDistFile('implement.md'))
    const off = complianceOffCommand('compliance-off', 'implement')
    expect(collectLensBlocks(off)).toEqual(on)
    const sibling = 'Phase 11 passes no publication value: the local verify posts nothing. '
    expect(collectLensBlocks(seedOnce(off, sibling, ''))).toEqual(on)
    const changed = seedOnce(off, '(none: generic controls only)', '(none: no controls)')
    expect(collectLensBlocks(changed)).not.toEqual(on)
    expect(collectLensBlocks(seedOnce(off, FRAMEWORKS_SENTENCE, 'The lens.'))).not.toEqual(on)
  })
})

// ── AC-309 ───────────────────────────────────────────────────────────────────────────────────────────

describe('AC-309: no Review or Design body or preload carries compliance-only text; the compliance-focus spawns inject it', () => {
  it('reads the agents it claims to read (non-vacuity)', () => {
    const agents = resolveAllAgents()
    expect(agents.size, 'the agent corpus shrank').toBeGreaterThanOrEqual(15)
    for (const slug of STRICT_SLUGS) {
      // D-DESIGN-VARIANTS: each Design variant carries one mode, so its body is shorter than the other strict bodies.
      const floor = slug === 'design' || slug === 'architect' ? 3_000 : 4_000
      expect(agents.get(slug)?.content.length ?? 0, `${slug}: missing or empty`).toBeGreaterThan(floor)
    }
  })

  it('no agent names the compliance skill or the lens, and the strict set carries no compliance text, curation on or off', () => {
    const agents = resolveAllAgents()
    for (const [slug, source] of agents) {
      expect(collectAgentBodyDefects(slug, source.content), `${slug} (curation on)`).toEqual([])
    }
    for (const slug of STRICT_SLUGS) {
      const off = resolveCurationOffSource('agents', slug)
      expect(off, `dist/curation-off/agents/${slug}.md is absent — run \`npm run build\` first`).not.toBeNull()
      expect(collectAgentBodyDefects(slug, off!), `${slug} (curation off)`).toEqual([])
    }
  })

  it('the /code-review Review spawn and the /plan Design spawn each inject the compliance focus directive, curation on or off', () => {
    expect(collectFocusSpawnDefects('code-review.md', requireDistFile('code-review.md'), 'Review')).toEqual([])
    expect(collectFocusSpawnDefects('plan.md', requireDistFile('plan.md'), 'Design')).toEqual([])
    expect(collectFocusSpawnDefects('code-review.md', curationOffCommand('code-review.md'), 'Review'), 'curation off').toEqual([])
    expect(collectFocusSpawnDefects('plan.md', curationOffCommand('plan.md'), 'Design'), 'curation off').toEqual([])
  })

  it('gap-analysis keeps its Iron Law and six sections in the preload; the compliance patterns live in a reference', () => {
    expect(collectGapAnalysisDefects(readSkillFile('SKILL.md')!, readSkillFile('references/compliance.md'))).toEqual([])
  })

  it('known-bad probe: a focus spawn that loses its directive, keeps the raw lens or loses its path is reported', () => {
    const review = requireDistFile('code-review.md')
    const plan = requireDistFile('plan.md')
    const seed = (real: string, from: string, to: string): string => {
      expect(real, `the seed anchor must exist (${from.slice(0, 40)})`).toContain(from)
      return real.replace(from, to)
    }
    expect(collectFocusSpawnDefects('code-review.md', seed(review, '{COMPLIANCE_FOCUS_DIRECTIVE}  (compliance focus only)', ''), 'Review'))
      .toEqual(['code-review.md: the Review spawn carries no focus directive'])
    expect(collectFocusSpawnDefects('code-review.md', seed(review, '{COMPLIANCE_FOCUS_DIRECTIVE}  (compliance focus only)', 'COMPLIANCE_FRAMEWORKS: {COMPLIANCE_FRAMEWORKS}  (compliance focus only)'), 'Review'))
      .toEqual(['code-review.md: the Review spawn carries no focus directive', 'code-review.md: the Review spawn still carries the raw lens'])
    expect(collectFocusSpawnDefects('plan.md', seed(plan, 'skills/devflow:gap-analysis/references/compliance.md', 'skills/devflow:gap-analysis/SKILL.md'), 'Design'))
      .toEqual(['plan.md: the Design spawn does not name the gap-analysis compliance reference'])
    expect(collectFocusSpawnDefects('plan.md', seed(plan, ACTIVE_SENTENCE, ''), 'Design'))
      .toEqual(['plan.md: does not gate the focus on COMPLIANCE_ACTIVE'])
    expect(collectFocusSpawnDefects('code-review.md', seed(review, 'For this compliance focus, invoke Skill(skill="devflow:compliance")', 'For this compliance focus, invoke the skill'), 'Review'))
      .toEqual(['code-review.md: does not render the focus directive line'])
    expect(collectFocusSpawnDefects('plan.md', seed(plan, '`COMPLIANCE_FOCUS_DIRECTIVE` is this one line', '`COMPLIANCE_FOCUS_DIRECTIVE` is a line'), 'Design'))
      .toEqual(['plan.md: does not set COMPLIANCE_FOCUS_DIRECTIVE'])
    expect(collectFocusSpawnDefects('plan.md', 'no fence here', 'Design')).toEqual(['plan.md: no Design compliance-capable spawn fence found'])
  })

  it('known-bad probe: an agent body that names the skill or the lens, and a Design body with compliance-only text, are reported', () => {
    const review = resolveAllAgents().get('review')!.content
    expect(collectAgentBodyDefects('review', review), 'the real Review body is clean').toEqual([])
    expect(collectAgentBodyDefects('review', `${review}\n| \`compliance\` | \`devflow:compliance\` |\n`)).toEqual(['names devflow:compliance', 'carries compliance text'])
    const design = resolveAllAgents().get('design')!.content
    expect(collectAgentBodyDefects('design', design), 'the real Design body is clean: its focus list is the one allowance').toEqual([])
    expect(design, 'the Design body still lists the focus the allowance covers').toMatch(DESIGN_FOCUS_LIST)
    expect(collectAgentBodyDefects('design', `${design}\n- **COMPLIANCE_FRAMEWORKS** (compliance focus): ids\n`)).toEqual(['names COMPLIANCE_FRAMEWORKS', 'carries compliance text'])
    // The focus-list allowance is Design's alone: the Architect body has no Focus input.
    const architect = resolveAllAgents().get('architect')!.content
    expect(collectAgentBodyDefects('architect', architect), 'the real Architect body is clean').toEqual([])
    expect(collectAgentBodyDefects('architect', `${architect}\n- **Focus**: completeness, architecture, security, performance, compliance, consistency, or dependencies\n`))
      .toEqual(['carries compliance text'])
    // Triage is out of scope: its paragraph dispositions findings and names neither the skill nor the lens.
    expect(collectAgentBodyDefects('triage', 'Compliance findings: default to FIX_SEPARATE.')).toEqual([])
  })

  it('known-bad probe: a preload that regains compliance text, or a lost reference or section, is reported', () => {
    const skill = readSkillFile('SKILL.md')!
    const reference = readSkillFile('references/compliance.md')
    expect(collectGapAnalysisDefects(skill, reference), 'the real files are clean').toEqual([])
    expect(collectGapAnalysisDefects(`${skill}\n### 7. Compliance (when the compliance lens is on)\n`, reference)).toEqual(['the preloaded SKILL.md carries compliance text'])
    expect(collectGapAnalysisDefects(skill, null)).toEqual(['references/compliance.md is absent'])
    expect(collectGapAnalysisDefects(skill, '# empty')).toEqual(['the reference lost its detection patterns', 'the reference lost its evidence trigger'])
    expect(collectGapAnalysisDefects(skill.replace('### 3. Security', '### 3. Sec'), reference)).toEqual(['the section "### 3. Security" is gone'])
    expect(collectGapAnalysisDefects(skill.replace('GAPS IN DESIGN BECOME BUGS IN PRODUCTION', 'x'), reference)).toEqual(['the Iron Law is gone'])
  })
})

// ── AC-308 on the re-validation path (#544) ──────────────────────────────────────────────────────────

describe('AC-308: the re-validation path sets the lens and the directive by pointing at the Phase 1 steps', () => {
  const revalidateReference = (): string => {
    const text = readAgentReference('commands/implement-revalidate.md')
    expect(text.length, 'the re-validation reference is empty, so this guard would pass vacuously').toBeGreaterThan(1_000)
    return text
  }
  const settingsStep = (reference: string): string => {
    const step = reference.split('\n').find(line => REVALIDATE_SETTINGS_STEP.test(line))
    expect(step, 'the re-validation reference has no step that takes GATE_LEVEL').toBeDefined()
    return step!
  }
  const builds = (): Array<readonly [string, string]> => [
    ['dist/commands/implement.md', requireDistFile('implement.md')],
    ['dist/curation-off/commands/implement.md', curationOffCommand('implement.md')],
    ...COMPLIANCE_OFF_KEYS.map(key => [variantOffRelPath(key, 'commands', 'implement.md'), complianceOffCommand(key, 'implement')] as const),
  ]
  /** The build with the directive line of its qa-fix fence dropped. The fence is found by its own unique text: the directive line repeats in every Fix fence. */
  const withoutQaFixDirective = (md: string): string => {
    const at = md.indexOf('OPERATION: qa-fix')
    expect(countOf(md, 'OPERATION: qa-fix'), 'the qa-fix fence is unique').toBe(1)
    const end = md.indexOf('```', at)
    expect(end, 'the qa-fix fence has a closing line').toBeGreaterThan(at)
    return md.slice(0, at) + seedOnce(md.slice(at, end), '\n   {COMPLIANCE_DIRECTIVE}"', '"') + md.slice(end)
  }

  it('the settings step takes the lens and the directive from the same line by pointer, and the reference copies no Phase 1 text', () => {
    const reference = revalidateReference()
    expect(REVALIDATE_LENS_PARTS.length, 'the part table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(4)
    expect(settingsStep(reference), 'the step still takes GATE_LEVEL from the Phase 1 settings step').toContain('**Resolve the settings line**')
    expect(collectRevalidateLensDefects(reference)).toEqual([])
  })

  it('both builds keep the Phase 1 directive step with its off clause, the mapping sentence and three Fix spawns in Phases 5-7 that pass the directive', () => {
    for (const [label, md] of builds()) {
      expect(md.length, `${label}: empty`).toBeGreaterThan(10_000)
      expect(collectPhase1DirectiveSourceDefects(label, md), label).toEqual([])
    }
  })

  it('known-bad probe: the settings step as it was before it set the lens and the directive reports every lens defect', () => {
    const reference = revalidateReference()
    const old = seedOnce(reference, settingsStep(reference), PRE_FIX_SETTINGS_STEP)
    expect(collectRevalidateLensDefects(old)).toEqual(REVALIDATE_LENS_PARTS.map(([what]) => `the settings step does not say: ${what}`))
  })

  it.each(REVALIDATE_LENS_PARTS)('known-bad probe: dropping "%s" from the settings step is reported', (what, text) => {
    const reference = revalidateReference()
    expect(collectRevalidateLensDefects(seedOnce(reference, text, ''))).toEqual([`the settings step does not say: ${what}`])
  })

  it('known-bad probe: a clause that keeps only the line it accepts, and not the fail-closed one, is reported', () => {
    const reference = revalidateReference()
    const accepted = seedOnce(reference, 'from that same line, the accepted one or the fail-closed one,', 'from the line it accepts,')
    expect(collectRevalidateLensDefects(accepted)).toEqual([`the settings step does not say: ${REVALIDATE_LENS_PARTS[0][0]}`])
  })

  it.each(REVALIDATE_LENS_BANNED)('known-bad probe: a reference that copies %s is reported', (what, needle, sample) => {
    const reference = revalidateReference()
    expect(typeof needle === 'string' ? reference.includes(needle) : needle.test(reference), `the shipped reference holds ${what}`).toBe(false)
    expect(collectRevalidateLensDefects(`${reference}\n${sample}\n`)).toContain(`the re-validation reference copies ${what}`)
  })

  it('known-bad probe: a renamed settings step is reported, not skipped', () => {
    const reference = revalidateReference()
    expect(collectRevalidateLensDefects(seedOnce(reference, '**Take GATE_LEVEL**', '**Take the level**')))
      .toEqual(['the re-validation reference has no step that takes GATE_LEVEL'])
  })

  it.each([0, 1])('known-bad probe: a build that loses the Phase 1 directive source is reported (build %i)', index => {
    const [label, md] = builds()[index]
    expect(collectPhase1DirectiveSourceDefects(label, seedOnce(md, DIRECTIVE_STEP, '**Set the directive**')))
      .toEqual([`${label}: Phase 1 does not hold ${DIRECTIVE_STEP} exactly once`])
    expect(collectPhase1DirectiveSourceDefects(label, seedOnce(md, OFF_CLAUSE, '`COMPLIANCE_DIRECTIVE` is always set')))
      .toEqual([`${label}: the ${DIRECTIVE_STEP} paragraph does not state that the directive is empty when the lens is off`])
    expect(collectPhase1DirectiveSourceDefects(label, seedOnce(md, FRAMEWORKS_SENTENCE, '')))
      .toEqual([`${label}: Phase 1 does not hold the COMPLIANCE_FRAMEWORKS mapping sentence`])
    expect(collectPhase1DirectiveSourceDefects(label, withoutQaFixDirective(md)))
      .toEqual([`${label}: a Fix spawn of Phases 5-7 passes no directive`])
    expect(collectPhase1DirectiveSourceDefects(label, seedOnce(md, '### Phase 5:', '### Step 5:')))
      .toEqual([`${label}: no Phases 5-7 section`])
    expect(collectPhase1DirectiveSourceDefects(label, seedOnce(md, '### Phase 1: Setup', '### Step 1: Setup')))
      .toEqual([`${label}: no Phase 1 section`])
    // The alignment-fix fence is the first Fix spawn of Phases 5-7; typed otherwise it is no Fix spawn.
    expect(collectPhase1DirectiveSourceDefects(label, seedOnce(md, 'subagent_type="Fix"):\n   "OPERATION: alignment-fix', 'subagent_type="Code"):\n   "OPERATION: alignment-fix')))
      .toEqual([`${label}: Phases 5-7 hold 2 Fix spawn(s), expected 3`])
  })

  it('known-bad probe: a qa-fix fence that never closes fails the seed loudly instead of slicing to the wrong place', () => {
    const [, md] = builds()[0]
    const unclosed = md.slice(0, md.indexOf('OPERATION: qa-fix') + 'OPERATION: qa-fix'.length)
    expect(() => withoutQaFixDirective(unclosed)).toThrow('the qa-fix fence has a closing line')
  })
})
