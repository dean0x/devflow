/**
 * The Design agent is two build variants (#733, D-DESIGN-VARIANTS). One agent used to serve two
 * modes and preloaded both mode skills on every spawn, although a spawn runs one mode. Now
 * `Design` runs the gap analysis and `Architect` writes implementation plans and reviews them
 * for design anti-patterns. The two hosts share one partial, as the Code variants do.
 *
 *   - Each variant, in both curation builds, preloads exactly its own mode skill: Design preloads
 *     gap-analysis and not design-review; Architect preloads design-review and not gap-analysis.
 *   - /plan spawns Design in the Phase 5 fences and Architect in the Phase 12 fence, with no
 *     `Mode:` line, in every build of the command.
 *   - /dynamic-plan's plan writer spawns Architect. Every other dynamic Design spawn keeps Design:
 *     the dynamic-plan cross-plan critic, the dynamic-tickets drafter and cross-critic, the
 *     ticket-factory drafter and cross-critic, and the dynamic-build wave reader.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe run
 * through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { parseFrontmatterSkills, requireDistFile, resolveAgentSource, resolveCurationOffSource, resolveVariantOffSource } from '../helpers.js'

/** The two mode skills. Each variant preloads exactly one of them. */
const MODE_SKILLS: readonly string[] = ['gap-analysis', 'design-review']

/** [agent slug, frontmatter name, the one mode skill it preloads]. */
const VARIANTS: ReadonlyArray<readonly [string, string, string]> = [
  ['design', 'Design', 'gap-analysis'],
  ['architect', 'Architect', 'design-review'],
]

interface Build {
  readonly label: string
  readonly content: string
}

/** Both curation builds of an agent variant. */
function agentBuilds(slug: string): Build[] {
  const off = resolveCurationOffSource('agents', slug)
  if (off === null) throw new Error(`dist/curation-off/agents/${slug}.md is absent — run \`npm run build\` first`)
  return [
    { label: `${slug} (curation on)`, content: resolveAgentSource(slug).content },
    { label: `${slug} (curation off)`, content: off },
  ]
}

/** Every build of a command that the build writes: curation on, then each off variant that exists. */
function commandBuilds(name: string): Build[] {
  const out: Build[] = [{ label: `${name} (all on)`, content: requireDistFile(`${name}.md`) }]
  for (const key of ['curation-off', 'compliance-off', 'both-off'] as const) {
    const off = resolveVariantOffSource(key, 'commands', name)
    if (off !== null) out.push({ label: `${name} (${key})`, content: off })
  }
  return out
}

/** Named collector: how a variant build falls short of preloading exactly its own mode skill. */
export function collectModePreloadDefects(label: string, content: string, own: string): string[] {
  const skills = parseFrontmatterSkills(content)
  if (skills.length === 0) return [`${label}: preloads no skill`]
  const modes = skills.filter(s => MODE_SKILLS.includes(s))
  const out: string[] = []
  if (!modes.includes(own)) out.push(`${label}: does not preload ${own}`)
  for (const other of modes.filter(s => s !== own)) out.push(`${label}: preloads ${other}, the mode skill of the other variant`)
  if (modes.filter(s => s === own).length > 1) out.push(`${label}: preloads ${own} twice`)
  return out
}

/** The text of one `#### Phase N:` section of /plan, up to the next phase heading. */
function phaseSection(content: string, phase: number): string | null {
  const at = content.indexOf(`#### Phase ${phase}:`)
  if (at === -1) return null
  const end = content.indexOf('\n#### Phase ', at + 10)
  return content.slice(at, end === -1 ? undefined : end)
}

/** Named collector: how a /plan build falls short of spawning Design in Phase 5 and Architect in Phase 12, with no Mode line. */
export function collectPlanSpawnDefects(label: string, content: string): string[] {
  const out: string[] = []
  for (const [phase, want] of [[5, 'Design'], [12, 'Architect']] as const) {
    const section = phaseSection(content, phase)
    if (section === null) { out.push(`${label}: no Phase ${phase}`); continue }
    const types = [...section.matchAll(/Agent\(subagent_type="([^"]+)"\)/g)].map(m => m[1])
    if (types.length === 0) out.push(`${label}: Phase ${phase} has no agent fence`)
    for (const type of types.filter(t => t !== want)) out.push(`${label}: Phase ${phase} spawns "${type}", expected ${want}`)
    if (/^"?Mode:/m.test(section)) out.push(`${label}: Phase ${phase} still passes a Mode line`)
  }
  return out
}

/** One dynamic spawn site: where it starts, where its call ends, and the agent type it must name. */
interface SpawnSite {
  readonly label: string
  readonly start: string
  readonly end: string
  readonly want: 'Design' | 'Architect'
}

const DYNAMIC_SITES: Readonly<Record<string, readonly SpawnSite[]>> = {
  'dynamic-plan': [
    { label: 'plan writer', start: 'const plans = await phase("plan-parallel"', end: '\n// ', want: 'Architect' },
    { label: 'cross-plan critic', start: 'const crossCritic = await phase("cross-plan-critic"', end: '\n// ', want: 'Design' },
  ],
  'dynamic-tickets': [
    { label: 'drafter', start: 'const drafts = await phase("draft"', end: '\n// ', want: 'Design' },
    { label: 'cross-critic', start: 'const critic = await phase("cross-critic"', end: '\n// ', want: 'Design' },
    { label: 'factory drafter', start: 'const drafts = await parallel(candidates.map(c => () =>', end: '\n```', want: 'Design' },
    { label: 'factory cross-critic', start: 'const critic = await agent(`Whole-set completeness & coherence audit.', end: '\n```', want: 'Design' },
  ],
  'dynamic-build': [
    { label: 'wave reader (step)', start: '**Step 1 — Read the wave**', end: '\n- ', want: 'Design' },
    { label: 'wave reader (script)', start: 'const waveRead = await agent(', end: '\n  );', want: 'Design' },
  ],
}

/** Named collector: each dynamic site names exactly one agent type in its own span, and it is the decided one. */
export function collectDynamicSpawnDefects(label: string, content: string, sites: readonly SpawnSite[]): string[] {
  const out: string[] = []
  for (const site of sites) {
    const at = content.indexOf(site.start)
    if (at === -1) { out.push(`${label}: no ${site.label}`); continue }
    if (content.indexOf(site.start, at + 1) !== -1) out.push(`${label}: the ${site.label} start is not unique`)
    const end = content.indexOf(site.end, at + site.start.length)
    if (end === -1) { out.push(`${label}: the ${site.label} has no end`); continue }
    const types = [...content.slice(at, end).matchAll(/agentType:\s*"([^"]+)"/g)].map(m => m[1])
    if (types.length !== 1) out.push(`${label}: the ${site.label} names ${types.length} agent types, expected 1`)
    else if (types[0] !== site.want) out.push(`${label}: the ${site.label} spawns "${types[0]}", expected ${site.want}`)
  }
  return out
}

describe('each Design variant preloads exactly its own mode skill, in both curation builds', () => {
  it('reads both builds of both variants, each with its own name', () => {
    for (const [slug, name] of VARIANTS) {
      const builds = agentBuilds(slug)
      expect(builds).toHaveLength(2)
      for (const b of builds) {
        expect(b.content.length, `${b.label}: the body is empty`).toBeGreaterThan(2_000)
        expect(b.content, `${b.label}: frontmatter name`).toMatch(new RegExp(`^name: ${name}$`, 'm'))
      }
    }
  })

  it.each(VARIANTS)('%s preloads its mode skill and not the other one', (slug, _name, own) => {
    for (const b of agentBuilds(slug)) expect(collectModePreloadDefects(b.label, b.content, own)).toEqual([])
  })

  it('known-bad probes: both mode skills, the other mode skill and no preload are each reported', () => {
    const design = agentBuilds('design')[0].content
    const both = design.replace('  - devflow:gap-analysis\n', '  - devflow:gap-analysis\n  - devflow:design-review\n')
    expect(both, 'the seed must land').not.toBe(design)
    expect(collectModePreloadDefects('design', both, 'gap-analysis')).toEqual(['design: preloads design-review, the mode skill of the other variant'])
    const swapped = design.replace('  - devflow:gap-analysis\n', '  - devflow:design-review\n')
    expect(collectModePreloadDefects('design', swapped, 'gap-analysis')).toEqual([
      'design: does not preload gap-analysis',
      'design: preloads design-review, the mode skill of the other variant',
    ])
    const architect = agentBuilds('architect')[1].content
    const lost = architect.replace('  - devflow:design-review\n', '')
    expect(lost, 'the seed must land').not.toBe(architect)
    expect(collectModePreloadDefects('architect', lost, 'design-review')).toEqual(['architect: does not preload design-review'])
    expect(collectModePreloadDefects('architect', '---\nname: Architect\n---\n', 'design-review')).toEqual(['architect: preloads no skill'])
  })
})

describe('/plan spawns Design in Phase 5 and Architect in Phase 12, with no Mode line', () => {
  it('reads all four builds of the command, each with both phases', () => {
    const builds = commandBuilds('plan')
    expect(builds.map(b => b.label)).toEqual(['plan (all on)', 'plan (curation-off)', 'plan (compliance-off)', 'plan (both-off)'])
    for (const b of builds) {
      expect(phaseSection(b.content, 5), `${b.label}: Phase 5`).toContain('Agent(subagent_type=')
      expect(phaseSection(b.content, 12), `${b.label}: Phase 12`).toContain('Agent(subagent_type=')
    }
  })

  it.each(commandBuilds('plan'))('$label names the decided types', ({ label, content }) => {
    expect(collectPlanSpawnDefects(label, content)).toEqual([])
  })

  it('known-bad probes: Design in Phase 12, Architect in Phase 5, a Mode line and a lost fence are each reported', () => {
    const plan = commandBuilds('plan')[0].content
    const seed = (from: string, to: string, after = 0): string => {
      const at = plan.indexOf(from, after)
      expect(at, `the seed anchor must exist (${from})`).toBeGreaterThan(-1)
      return plan.slice(0, at) + to + plan.slice(at + from.length)
    }
    const phase12 = plan.indexOf('#### Phase 12:')
    expect(collectPlanSpawnDefects('plan', seed('Agent(subagent_type="Architect")', 'Agent(subagent_type="Design")')))
      .toEqual(['plan: Phase 12 spawns "Design", expected Architect'])
    expect(collectPlanSpawnDefects('plan', seed('Agent(subagent_type="Design")', 'Agent(subagent_type="Architect")')))
      .toEqual(['plan: Phase 5 spawns "Architect", expected Design'])
    expect(collectPlanSpawnDefects('plan', seed('Agent(subagent_type="Architect"):\n"', 'Agent(subagent_type="Architect"):\n"Mode: design-review\n')))
      .toEqual(['plan: Phase 12 still passes a Mode line'])
    expect(collectPlanSpawnDefects('plan', seed('Agent(subagent_type="Architect")', 'Agent()', phase12)))
      .toEqual(['plan: Phase 12 has no agent fence'])
  })
})

describe('/dynamic-plan writes plans with Architect; every other dynamic Design spawn keeps Design', () => {
  const hosts = Object.keys(DYNAMIC_SITES)

  it('reads every build of the three dynamic commands, and the sites name both types', () => {
    expect(hosts).toEqual(['dynamic-plan', 'dynamic-tickets', 'dynamic-build'])
    expect(commandBuilds('dynamic-plan')).toHaveLength(2)
    expect(commandBuilds('dynamic-tickets')).toHaveLength(4)
    expect(commandBuilds('dynamic-build')).toHaveLength(4)
    const wants = Object.values(DYNAMIC_SITES).flat().map(s => s.want)
    expect(wants.filter(w => w === 'Architect')).toHaveLength(1)
    expect(wants.filter(w => w === 'Design')).toHaveLength(7)
  })

  it.each(hosts.flatMap(host => commandBuilds(host).map(b => [b.label, host, b.content] as const)))(
    '%s names the decided type at each site',
    (label, host, content) => {
      expect(collectDynamicSpawnDefects(label, content, DYNAMIC_SITES[host])).toEqual([])
    },
  )

  it('known-bad probes: a Design plan writer, an Architect critic, a lost site and a site with two types are each reported', () => {
    const plan = commandBuilds('dynamic-plan')[0].content
    const sites = DYNAMIC_SITES['dynamic-plan']
    const seed = (text: string, from: string, to: string): string => {
      expect(text, `the seed anchor must exist (${from})`).toContain(from)
      return text.replace(from, to)
    }
    expect(collectDynamicSpawnDefects('dp', seed(plan, '{ agentType: "Architect" }', '{ agentType: "Design" }'), sites))
      .toEqual(['dp: the plan writer spawns "Design", expected Architect'])
    expect(collectDynamicSpawnDefects('dp', plan.replace(/(phase\("cross-plan-critic"[\s\S]*?)agentType: "Design"/, '$1agentType: "Architect"'), sites))
      .toEqual(['dp: the cross-plan critic spawns "Architect", expected Design'])
    expect(collectDynamicSpawnDefects('dp', seed(plan, 'const crossCritic = await phase("cross-plan-critic"', 'const critic = await phase("critic"'), sites))
      .toEqual(['dp: no cross-plan critic'])
    expect(collectDynamicSpawnDefects('dp', seed(plan, '{ agentType: "Architect" }', '{ agentType: "Architect" }, { agentType: "Design" }'), sites))
      .toEqual(['dp: the plan writer names 2 agent types, expected 1'])
    const build = commandBuilds('dynamic-build')[0].content
    expect(collectDynamicSpawnDefects('db', seed(build, 'Spawn a `agentType: "Design"` agent (opus', 'Spawn a `agentType: "Architect"` agent (opus'), DYNAMIC_SITES['dynamic-build']))
      .toEqual(['db: the wave reader (step) spawns "Architect", expected Design'])
  })
})
