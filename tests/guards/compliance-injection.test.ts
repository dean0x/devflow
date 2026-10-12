/**
 * D-COMPLIANCE-INJECT (AC-308, AC-309) — the compliance instruction reaches an agent through a spawn
 * prompt, and only when the resolved lens is on.
 *
 * The lens is the union of the machine, the default branch and the worktree (D-LENS-UNION), so a repository
 * can turn it on when the machine switch is off. The `compliance` skill therefore installs on every machine
 * (D-COMPLIANCE-INSTALL-ALWAYS) and an install-time variant keyed on the machine switch would be wrong. The
 * only place that knows the resolved lens is the command, so the command carries the instruction:
 *
 *   AC-308  No Code-family body carries a compliance Skill call or a compliance input. Every Code and Code-fix
 *           spawn site passes `COMPLIANCE_DIRECTIVE`, which is empty when `COMPLIANCE_FRAMEWORKS` is `off`,
 *           so a lens-off spawn carries nothing about compliance, not even `COMPLIANCE_FRAMEWORKS: off`.
 *   AC-309  No Review or Design body or preload carries compliance-only text. The compliance-focus spawns of
 *           /code-review and /plan carry `COMPLIANCE_FOCUS_DIRECTIVE`, and gap-analysis's compliance patterns
 *           live in a reference the /plan compliance spawn names by path.
 *
 * Read from the COMPILED prompts a session loads (`dist/commands`, `dist/agents`, `dist/learning-off`) and
 * the shipped skill sources. Every arm runs through a named collector that the live sweep and its known-bad
 * probe both call, over a corpus whose size is asserted first (a sweep that read nothing proves nothing).
 *
 * Out of scope by design: Triage. Its compliance paragraph dispositions findings the Review agents already
 * raised; it loads no skill and takes no lens, so the strict rule below does not read it. Scrutinize's
 * "pattern compliance checking" is unrelated to the lens.
 *
 * What a green run does NOT prove: that a model follows the directive, or that the orchestrating model
 * drops the empty directive line. It proves the text and the gate are in the prompts.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import * as path from 'path'

import {
  ROOT, collectCodeSpawnSites, requireDistFile, requireDistFiles, resolveAllAgents, resolveLearningOffSource,
} from '../helpers.js'
import type { CodeSpawnSite } from '../helpers.js'

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
const STRICT_SLUGS = ['code', 'code-fix', 'code-edit', 'review', 'design'] as const

/** The focus enumeration Design keeps: a list of focus names shared with every other focus, not compliance-only text. */
const DESIGN_FOCUS_LIST = /completeness, architecture, security, performance, compliance, consistency, dependencies/

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
    : text.match(/Agent\(subagent_type="Design"\):\n"Mode: gap-analysis[\s\S]*?```/))?.[0]
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

// ── Corpus ───────────────────────────────────────────────────────────────────────────────────────────

const SKILL_DIR = path.join(ROOT, 'src', 'assets', 'skills', 'gap-analysis')
const readSkillFile = (rel: string): string | null => {
  const file = path.join(SKILL_DIR, rel)
  return existsSync(file) ? readFileSync(file, 'utf-8') : null
}

const codeSites = (): CodeSpawnSite[] => requireDistFiles().flatMap(f => collectCodeSpawnSites(f, requireDistFile(f)))
const spawnHosts = (): Array<readonly [string, string]> => Object.keys(CODE_SPAWN_FLOORS).map(f => [f, requireDistFile(f)] as const)

/**
 * The learning-off variant of a compiled command (D-LEARNING-VARIANTS): a learning-off machine installs it in
 * place of `dist/commands/<file>`, and its learning-off arms are text the learning-on sweep never reads.
 */
const learningOffCommand = (file: string): string => {
  const text = resolveLearningOffSource('commands', file.replace(/\.md$/, ''))
  if (text === null) throw new Error(`dist/learning-off/commands/${file} is absent — run \`npm run build\` first`)
  return text
}
const offSpawnHosts = (): Array<readonly [string, string]> =>
  Object.keys(CODE_SPAWN_FLOORS).map(f => [f, learningOffCommand(f)] as const)

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

  it('every Code and Code-fix spawn site passes the directive and none passes the raw lens', () => {
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

  it('the learning-off variants pass the directive at every site and set it behind the lens, like the learning-on ones', () => {
    const hosts = offSpawnHosts()
    const sites = hosts.flatMap(([f, t]) => collectCodeSpawnSites(f, t))
    for (const [host, floor] of Object.entries(CODE_SPAWN_FLOORS)) {
      const n = sites.filter(s => s.file === host).length
      expect(n, `${host} (learning off): ${n} Code-family spawn site(s), floor ${floor}`).toBeGreaterThanOrEqual(floor)
    }
    expect(collectUndirectedSites(sites)).toEqual([])
    expect(collectRawLensSites(sites)).toEqual([])
    expect(collectUngatedHosts(hosts)).toEqual([])
  })

  it('known-bad probe: a learning-off-only arm that drops the directive or keeps the raw lens is reported', () => {
    // Each anchor lives in a learning-off arm alone, so only the learning-off sweep can see it change.
    const probes: Array<[string, string, string]> = [
      ['implement.md', '`COMPLIANCE_DIRECTIVE` (when it is not empty), `CI_FAILURES` and `PUSH: false`', '`COMPLIANCE_FRAMEWORKS`, `CI_FAILURES` and `PUSH: false`'],
      ['dynamic-build.md', 'plan + COMPLIANCE_DIRECTIVE + handoff', 'plan + COMPLIANCE_FRAMEWORKS + handoff'],
    ]
    for (const [host, anchor, stale] of probes) {
      expect(requireDistFile(host), `${host}: the anchor must be learning-off only`).not.toContain(anchor)
      const real = learningOffCommand(host)
      expect(real, `${host}: the learning-off anchor must exist`).toContain(anchor)
      const seeded = collectCodeSpawnSites(host, real.replace(anchor, stale))
      expect(collectUndirectedSites(seeded), `${host}: the stale arm drops the directive`).toHaveLength(1)
      expect(collectRawLensSites(seeded), `${host}: the stale arm hands over the raw lens`).toHaveLength(1)
    }
  })

  it('no Code-family body, learning on or off, names the compliance skill or the lens', () => {
    const agents = resolveAllAgents()
    for (const slug of ['code', 'code-fix', 'code-edit']) {
      const source = agents.get(slug)
      expect(source, `${slug}: the agent is not in the registry`).toBeDefined()
      expect(source!.content.length, `${slug}: the body is empty — the guard would pass vacuously`).toBeGreaterThan(4_000)
      expect(collectAgentBodyDefects(slug, source!.content), `${slug} (learning on)`).toEqual([])
      const off = resolveLearningOffSource('agents', slug)
      expect(off, `dist/learning-off/agents/${slug}.md is absent — run \`npm run build\` first`).not.toBeNull()
      expect(collectAgentBodyDefects(slug, off!), `${slug} (learning off)`).toEqual([])
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
    const real = resolveAllAgents().get('code-fix')!.content
    expect(collectAgentBodyDefects('code-fix', real), 'the real body is clean').toEqual([])
    expect(collectAgentBodyDefects('code-fix', `${real}\n2. Invoke \`Skill(skill="devflow:compliance")\`.\n`))
      .toEqual(['names devflow:compliance', 'carries compliance text'])
    expect(collectAgentBodyDefects('code-fix', `${real}\n- **COMPLIANCE_FRAMEWORKS** (optional): the lens\n`))
      .toEqual(['names COMPLIANCE_FRAMEWORKS', 'carries compliance text'])
    expect(collectAgentBodyDefects('code-fix', `${real}\nCheck compliance.\n`)).toEqual(['carries compliance text'])
  })
})

// ── AC-309 ───────────────────────────────────────────────────────────────────────────────────────────

describe('AC-309: no Review or Design body or preload carries compliance-only text; the compliance-focus spawns inject it', () => {
  it('reads the agents it claims to read (non-vacuity)', () => {
    const agents = resolveAllAgents()
    expect(agents.size, 'the agent corpus shrank').toBeGreaterThanOrEqual(15)
    for (const slug of STRICT_SLUGS) {
      expect(agents.get(slug)?.content.length ?? 0, `${slug}: missing or empty`).toBeGreaterThan(4_000)
    }
  })

  it('no agent names the compliance skill or the lens, and the strict set carries no compliance text, learning on or off', () => {
    const agents = resolveAllAgents()
    for (const [slug, source] of agents) {
      expect(collectAgentBodyDefects(slug, source.content), `${slug} (learning on)`).toEqual([])
    }
    for (const slug of STRICT_SLUGS) {
      const off = resolveLearningOffSource('agents', slug)
      expect(off, `dist/learning-off/agents/${slug}.md is absent — run \`npm run build\` first`).not.toBeNull()
      expect(collectAgentBodyDefects(slug, off!), `${slug} (learning off)`).toEqual([])
    }
  })

  it('the /code-review Review spawn and the /plan Design spawn each inject the compliance focus directive, learning on or off', () => {
    expect(collectFocusSpawnDefects('code-review.md', requireDistFile('code-review.md'), 'Review')).toEqual([])
    expect(collectFocusSpawnDefects('plan.md', requireDistFile('plan.md'), 'Design')).toEqual([])
    expect(collectFocusSpawnDefects('code-review.md', learningOffCommand('code-review.md'), 'Review'), 'learning off').toEqual([])
    expect(collectFocusSpawnDefects('plan.md', learningOffCommand('plan.md'), 'Design'), 'learning off').toEqual([])
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
