/**
 * D-KB-DELIVERY-TIERS and D-KB-LEGACY-FALLBACK (#427): feature knowledge reaches an agent as a
 * block per KB, not as the whole file.
 *
 * Before this change `knowledge_load()` read each selected KNOWLEDGE.md in full and concatenated it,
 * so a single spawn could carry 60 to 160 KB of KB text. The delivery is now, per selected KB:
 *
 *   --- Feature knowledge: {slug} ---
 *   KB: .devflow/features/{slug}/KNOWLEDGE.md
 *   Rules:
 *   - **KB-AP-2** {one to three bullets, verbatim from a Read view}
 *   Headings: L5 Rules · L40 Overview · ...
 *
 * `FEATURE_KNOWLEDGE` carries the blocks; `FEATURE_KNOWLEDGE_RULES` is the same blocks without the
 * `Headings:` line. A spawn line keeps the input name `FEATURE_KNOWLEDGE:` and names the variable of
 * its recipient's tier: Rules + index for Review, Triage, Design, Code, Diagnose, Research and
 * Explore, Rules only for Evaluate and Scrutinize, and nothing for Validate, Git and Test. A KB with
 * no `## Rules` section (a legacy KB) delivers one to three Anti-Patterns or Gotchas entries under a
 * `Rules ({section name}):` label (D-KB-LEGACY-FALLBACK).
 *
 * Arms, each through a named collector with a known-bad probe and a non-empty corpus:
 *
 *   - the eight load hosts (the seven that call `knowledge_load()` and `release`) carry the block
 *     format, the Bash heading listing and the legacy label, and never the Grep tool;
 *   - no shipped prompt tells an agent to read a KB in full or to concatenate whole KBs;
 *   - every spawn site that passes the input names the variable of its tier;
 *   - every Produces line that lists FEATURE_KNOWLEDGE also lists FEATURE_KNOWLEDGE_RULES;
 *   - each agent's Input line, the quality-gates line and the plan Explore instruction describe the
 *     form that recipient receives;
 *   - Validate, Git and Test declare no input; explore and debug never call the load; no hook source
 *     names the variable; no shipped file carries the retired full-content placeholder;
 *   - release loads by block delivery and spawns nothing that takes it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile, requireDistFiles, resolveAgentSource, resolveLearningOffSource } from '../helpers.js'

const LOAD_HEADING = '### Load Feature Knowledge'

/** The commands that call `knowledge_load()`, plus release, which loads by the same delivery. */
export const LOAD_HOSTS: readonly string[] = [
  'bug-analysis', 'code-review', 'implement', 'plan', 'release', 'research', 'resolve', 'self-review',
]

const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf-8')

// ---------------------------------------------------------------------------
// The load text
// ---------------------------------------------------------------------------

/** Literals every load host carries once, with the rule each one stands for. */
const LOAD_ELEMENTS: ReadonlyArray<{ readonly label: string; readonly literal: string }> = [
  { label: 'the slug header', literal: '--- Feature knowledge: {slug} ---' },
  { label: 'the KB path line', literal: 'KB: .devflow/features/{slug}/KNOWLEDGE.md' },
  { label: 'the Rules label', literal: '\nRules:\n' },
  { label: 'a Rules bullet with its ID', literal: '- **KB-AP-2** {bullet text, verbatim}' },
  { label: 'the heading index', literal: 'Headings: L5 Rules · L40 Overview' },
  { label: 'the Bash heading listing', literal: "command grep -n '^## '" },
  { label: 'the Read-tool range read', literal: 'with the Read tool, using `offset` and `limit`' },
  { label: 'verbatim from the Read view', literal: 'Paste each bullet verbatim from the Read view, never from a shell view' },
  { label: 'the legacy label', literal: 'Rules ({section name}):' },
  { label: 'the legacy range', literal: 'Anti-Patterns` or `## Gotchas` range' },
  { label: 'the Rules-only variable', literal: '`FEATURE_KNOWLEDGE_RULES` is the same blocks without the `Headings:` line' },
  { label: 'the none state', literal: 'set both to `(none)`' },
]

/** The section of a compiled command that `knowledge_load()` expands to. */
export function loadSection(text: string): string | null {
  const start = text.indexOf(LOAD_HEADING)
  if (start === -1) return null
  const end = text.indexOf('**One git call, then direct reads', start)
  return end === -1 ? text.slice(start) : text.slice(start, text.indexOf('\n', end) + 1)
}

/** Named collector: how a compiled command's load text falls short of the block delivery. */
export function collectLoadDefects(file: string, text: string): string[] {
  const section = loadSection(text)
  if (section === null) return [`${file}: no "${LOAD_HEADING}" section`]
  const out: string[] = []
  for (const { label, literal } of LOAD_ELEMENTS) {
    const n = section.split(literal).length - 1
    if (n !== 1) out.push(`${file}: ${label} appears ${n} times, expected once`)
  }
  if (/\bGrep\b/.test(section)) out.push(`${file}: the load names the Grep tool, which a Bash-holding agent does not have`)
  return out
}

describe('the load text delivers a block per KB (D-KB-DELIVERY-TIERS, D-KB-LEGACY-FALLBACK)', () => {
  it('exactly the eight load hosts carry the load section, each with every element once and no Grep tool', () => {
    const commands = requireDistFiles().map(f => [f.replace(/\.md$/, ''), requireDistFile(f)] as const)
    const hosts = commands.filter(([, text]) => text.includes(LOAD_HEADING)).map(([name]) => name).sort()
    expect(hosts).toEqual([...LOAD_HOSTS].sort())
    const defects = commands.filter(([name]) => LOAD_HOSTS.includes(name)).flatMap(([name, text]) => collectLoadDefects(name, text))
    expect(defects).toEqual([])
  })

  it('the learning-off variants of the load hosts deliver the same blocks', () => {
    let variants = 0
    for (const name of LOAD_HOSTS) {
      const off = resolveLearningOffSource('commands', name)
      if (off === null) continue
      variants++
      expect(collectLoadDefects(`learning-off/${name}`, off)).toEqual([])
    }
    expect(variants, 'no load host has a learning-off variant').toBeGreaterThanOrEqual(8)
  })

  it('known-bad probe: each missing element, a doubled block and the Grep tool are each reported', () => {
    const real = requireDistFile('implement.md')
    expect(collectLoadDefects('implement', real)).toEqual([])
    for (const { label, literal } of LOAD_ELEMENTS) {
      const without = real.replace(literal, '')
      expect(without, `the seed for "${label}" must land`).not.toBe(real)
      expect(collectLoadDefects('implement', without).some(d => d.includes(label)), label).toBe(true)
    }
    const doubled = real.replace('Headings: L5 Rules · L40 Overview', 'Headings: L5 Rules · L40 Overview\nHeadings: L5 Rules · L40 Overview')
    expect(collectLoadDefects('implement', doubled).some(d => d.includes('the heading index appears 2 times'))).toBe(true)
    const grep = real.replace("command grep -n '^## '", "the Grep tool with pattern '^## '")
    expect(collectLoadDefects('implement', grep).some(d => d.includes('names the Grep tool'))).toBe(true)
    expect(collectLoadDefects('x', 'no load here')).toEqual(['x: no "### Load Feature Knowledge" section'])
  })
})

// ---------------------------------------------------------------------------
// No whole-KB delivery anywhere
// ---------------------------------------------------------------------------

/** The shapes that carried a whole KB before the block delivery, each with a name for the report. */
const WHOLE_KB_SHAPES: ReadonlyArray<{ readonly name: string; readonly re: RegExp; readonly seed: string }> = [
  { name: 'read a KNOWLEDGE.md in full', re: /\bread\b[^\n]{0,100}KNOWLEDGE\.md`?[^\n.]{0,20}\bin full\b/i, seed: 'read `{worktree}/.devflow/features/{slug}/KNOWLEDGE.md` in full.' },
  { name: 'read the full KNOWLEDGE.md', re: /\bread the full `?KNOWLEDGE\.md/i, seed: 'For each selected KB, read the full `KNOWLEDGE.md`.' },
  { name: 'Concatenate the selected KNOWLEDGE.md', re: /Concatenate the selected KNOWLEDGE\.md/i, seed: 'Concatenate the selected KNOWLEDGE.md files under slug headers:' },
  { name: 'Concatenate under slug headers', re: /Concatenate under slug headers/i, seed: 'Concatenate under slug headers and set FEATURE_KNOWLEDGE.' },
  { name: 'the full-content template', re: /[[{]full KNOWLEDGE\.md content[\]}]/, seed: '{full KNOWLEDGE.md content}' },
  { name: 'pass matching KNOWLEDGE.md content', re: /pass matching KNOWLEDGE\.md content/i, seed: 'pass matching KNOWLEDGE.md content as FEATURE_KNOWLEDGE;' },
]

/** Named collector: the whole-KB shapes a body still carries, one entry per shape. */
export function collectWholeKbShapes(label: string, text: string): string[] {
  return WHOLE_KB_SHAPES.filter(({ re }) => re.test(text)).map(({ name }) => `${label}: ${name}`)
}

/** The corpus the shapes are banned from: compiled commands, the release source, the charter and the consumer skill. */
function wholeKbCorpus(): Array<readonly [string, string]> {
  const commands = requireDistFiles().map(f => [`dist/commands/${f}`, requireDistFile(f)] as const)
  return [
    ...commands,
    ['src/assets/commands/release.mds', read('src/assets/commands/release.mds')],
    ['orchestrator-charter.md', read('src/assets/scripts/hooks/assets/orchestrator-charter.md')],
    ['apply-feature-knowledge/SKILL.md', read('src/assets/skills/apply-feature-knowledge/SKILL.md')],
  ]
}

describe('no shipped prompt delivers a whole KB (D-KB-DELIVERY-TIERS)', () => {
  it('no command, the release source, the charter or the consumer skill reads or concatenates a KB in full', () => {
    const corpus = wholeKbCorpus()
    expect(corpus.length, 'nothing scanned').toBeGreaterThanOrEqual(17)
    expect(corpus.flatMap(([label, text]) => collectWholeKbShapes(label, text))).toEqual([])
  })

  it.each(WHOLE_KB_SHAPES.map(s => [s.name, s.seed] as const))('known-bad probe: "%s" is reported when seeded', (name, seed) => {
    const clean = read('src/assets/scripts/hooks/assets/orchestrator-charter.md')
    expect(collectWholeKbShapes('charter', clean)).toEqual([])
    expect(collectWholeKbShapes('charter', `${clean}\n${seed}\n`)).toEqual([`charter: ${name}`])
  })

  it('the shipped source holds no full-content placeholder anywhere under src/assets', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(md|mds|cjs|json)$/.test(entry.name) || !entry.name.includes('.')) files.push(full)
      }
    }
    walk(path.join(ROOT, 'src', 'assets'))
    expect(files.length, 'nothing scanned').toBeGreaterThan(100)
    const hits = files.filter(f => /[[{]full KNOWLEDGE\.md content[\]}]/.test(readFileSync(f, 'utf-8'))).map(f => path.relative(ROOT, f))
    expect(hits).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The tier at each spawn
// ---------------------------------------------------------------------------

/** One place a compiled command hands `FEATURE_KNOWLEDGE` to an agent. */
export interface FkSite {
  readonly agent: string
  /** The variable the line names, lower-cased: the tier. */
  readonly variable: string
}

const FK_INPUT = /`?FEATURE_KNOWLEDGE`?:\s*`?\{([A-Za-z_]+)\}`?/g
const AGENT_BEFORE = /subagent_type="([A-Za-z]+)"|Spawn \d+ ([A-Z][a-z]+) agents/g

/** Named collector: every `FEATURE_KNOWLEDGE: {variable}` input in a body, with the agent it is spawned for. */
export function collectFkSites(text: string): FkSite[] {
  const sites: FkSite[] = []
  for (const match of text.matchAll(FK_INPUT)) {
    const before = text.slice(0, match.index)
    let agent = '(unknown)'
    for (const a of before.matchAll(AGENT_BEFORE)) agent = a[1] ?? a[2]
    sites.push({ agent, variable: match[1].toLowerCase() })
  }
  return sites
}

const RICH = 'feature_knowledge'
const RULES = 'feature_knowledge_rules'

/** The tier table: every spawn that passes the input, per compiled command. */
export const TIER_TABLE: Readonly<Record<string, readonly FkSite[]>> = {
  'bug-analysis': [{ agent: 'Diagnose', variable: RICH }],
  'code-review': [{ agent: 'Review', variable: RICH }],
  implement: [
    { agent: 'Code', variable: RICH }, { agent: 'Code', variable: RICH }, { agent: 'Code', variable: RICH },
    { agent: 'Code', variable: RICH }, { agent: 'Code', variable: RICH },
    { agent: 'Scrutinize', variable: RULES }, { agent: 'Evaluate', variable: RULES },
  ],
  plan: [{ agent: 'Explore', variable: RICH }, { agent: 'Design', variable: RICH }],
  research: [{ agent: 'Research', variable: RICH }],
  resolve: [{ agent: 'Triage', variable: RICH }, { agent: 'Code', variable: RICH }],
  'self-review': [{ agent: 'Scrutinize', variable: RULES }],
}

const NO_TAKER = ['Validate', 'Git', 'Test']

/** Named collector: the sites of a command that differ from the table, and any Validate, Git or Test site. */
export function collectTierDefects(file: string, text: string, expected: readonly FkSite[]): string[] {
  const key = (s: FkSite): string => `${s.agent}=${s.variable}`
  const found = collectFkSites(text).map(key).sort()
  const want = expected.map(key).sort()
  const out: string[] = []
  if (found.join(',') !== want.join(',')) out.push(`${file}: spawn sites [${found.join(', ')}], tier table [${want.join(', ')}]`)
  for (const site of collectFkSites(text)) if (NO_TAKER.includes(site.agent)) out.push(`${file}: a ${site.agent} spawn passes FEATURE_KNOWLEDGE`)
  return out
}

describe('each spawn names the variable of its recipient tier (D-KB-DELIVERY-TIERS)', () => {
  it('every compiled command (both variants) matches the tier table, and no other command passes the input', () => {
    const commands = requireDistFiles().map(f => [f.replace(/\.md$/, ''), requireDistFile(f)] as const)
    expect(commands.length, 'nothing scanned').toBeGreaterThanOrEqual(14)
    const defects = commands.flatMap(([name, text]) => collectTierDefects(name, text, TIER_TABLE[name] ?? []))
    expect(defects).toEqual([])
    const total = commands.reduce((sum, [, text]) => sum + collectFkSites(text).length, 0)
    expect(total, 'the table covers every site').toBe(Object.values(TIER_TABLE).reduce((sum, rows) => sum + rows.length, 0))
    for (const name of Object.keys(TIER_TABLE)) {
      const off = resolveLearningOffSource('commands', name)
      expect(off, `${name} has a learning-off variant`).not.toBeNull()
      expect(collectTierDefects(`learning-off/${name}`, off ?? '', TIER_TABLE[name])).toEqual([])
    }
  })

  it('known-bad probe: a wrong tier, a lost site, an extra site and a Validate spawn are each reported', () => {
    const implement = requireDistFile('implement.md')
    const expected = TIER_TABLE.implement
    expect(collectTierDefects('implement', implement, expected)).toEqual([])

    const evaluateRich = implement.replace('ACCEPTANCE_CRITERIA: {extracted criteria if available}\nFEATURE_KNOWLEDGE: {feature_knowledge_rules}', 'ACCEPTANCE_CRITERIA: {extracted criteria if available}\nFEATURE_KNOWLEDGE: {feature_knowledge}')
    expect(evaluateRich, 'the seed must land').not.toBe(implement)
    expect(collectTierDefects('implement', evaluateRich, expected)).toHaveLength(1)

    const lost = implement.replace('FEATURE_KNOWLEDGE: {feature_knowledge_rules}\nEvaluate 9 pillars', 'Evaluate 9 pillars')
    expect(lost, 'the seed must land').not.toBe(implement)
    expect(collectTierDefects('implement', lost, expected)).toHaveLength(1)

    const validate = `${implement}\nAgent(subagent_type="Validate"):\n"FEATURE_KNOWLEDGE: {feature_knowledge}"\n`
    const defects = collectTierDefects('implement', validate, expected)
    expect(defects.some(d => d.includes('a Validate spawn passes FEATURE_KNOWLEDGE'))).toBe(true)
    expect(collectTierDefects('release', 'Agent(subagent_type="Git"):\n"FEATURE_KNOWLEDGE: {feature_knowledge}"', []).some(d => d.includes('a Git spawn passes'))).toBe(true)
  })

  it('the site collector reads the three spawn shapes: a fenced block, a list item and inline prose', () => {
    const fenced = 'Agent(subagent_type="Design"):\n"FEATURE_KNOWLEDGE: {feature_knowledge}\nX"'
    const list = 'Spawn 2-5 `Agent(subagent_type="Research")` agents\n- `FEATURE_KNOWLEDGE`: `{feature_knowledge}` from Phase 1'
    const prose = 'Spawn 4 Explore agents in a single message, each with `FEATURE_KNOWLEDGE: {feature_knowledge}` (from Phase 2).'
    expect(collectFkSites(fenced)).toEqual([{ agent: 'Design', variable: RICH }])
    expect(collectFkSites(list)).toEqual([{ agent: 'Research', variable: RICH }])
    expect(collectFkSites(prose)).toEqual([{ agent: 'Explore', variable: RICH }])
    expect(collectFkSites('FEATURE_KNOWLEDGE: {FEATURE_KNOWLEDGE}')).toEqual([{ agent: '(unknown)', variable: RICH }])
  })
})

// ---------------------------------------------------------------------------
// Produces lines
// ---------------------------------------------------------------------------

/** Named collector: Produces lines that list FEATURE_KNOWLEDGE but not FEATURE_KNOWLEDGE_RULES. */
export function collectProducesDefects(file: string, text: string): string[] {
  const lines = text.split('\n').filter(l => l.startsWith('**Produces:**') && /\bFEATURE_KNOWLEDGE\b/.test(l))
  return lines.filter(l => !/\bFEATURE_KNOWLEDGE_RULES\b/.test(l)).map(l => `${file}: ${l.slice(0, 80)}`)
}

describe('every Produces line that lists FEATURE_KNOWLEDGE also lists FEATURE_KNOWLEDGE_RULES (D-KB-DELIVERY-TIERS)', () => {
  it('holds in the eight load hosts, in both variants', () => {
    let lines = 0
    const defects: string[] = []
    for (const name of LOAD_HOSTS) {
      const variants: Array<readonly [string, string | null]> = [[name, requireDistFile(`${name}.md`)], [`learning-off/${name}`, resolveLearningOffSource('commands', name)]]
      for (const [label, text] of variants) {
        if (text === null) continue
        lines += text.split('\n').filter(l => l.startsWith('**Produces:**') && /\bFEATURE_KNOWLEDGE\b/.test(l)).length
        defects.push(...collectProducesDefects(label, text))
      }
    }
    expect(lines, 'nothing scanned').toBeGreaterThanOrEqual(16)
    expect(defects).toEqual([])
  })

  it('known-bad probe: a Produces line without the new variable is reported', () => {
    expect(collectProducesDefects('a', '**Produces:** A, FEATURE_KNOWLEDGE, B')).toEqual(['a: **Produces:** A, FEATURE_KNOWLEDGE, B'])
    expect(collectProducesDefects('a', '**Produces:** A, FEATURE_KNOWLEDGE, FEATURE_KNOWLEDGE_RULES, B')).toEqual([])
    expect(collectProducesDefects('a', '**Produces:** A, FEATURE_KNOWLEDGE_STATUS')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The form each recipient is told it receives
// ---------------------------------------------------------------------------

/** The `- **FEATURE_KNOWLEDGE**` Input bullet of an agent body, continuation lines included. */
export function inputBullet(body: string): string | null {
  const lines = body.split('\n')
  const start = lines.findIndex(l => l.startsWith('- **FEATURE_KNOWLEDGE**'))
  if (start === -1) return null
  const out = [lines[start]]
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '' || lines[i].startsWith('- ') || lines[i].startsWith('#')) break
    out.push(lines[i])
  }
  return out.join(' ').replace(/\s+/g, ' ')
}

const RICH_AGENTS = ['code', 'review', 'triage', 'design', 'diagnose', 'research'] as const
const RULES_AGENTS = ['evaluate', 'scrutinize'] as const

/** Named collector: how an Input bullet differs from the form its tier receives. */
export function collectFormDefects(agent: string, bullet: string | null, tier: 'rich' | 'rules'): string[] {
  if (bullet === null) return [`${agent}: no FEATURE_KNOWLEDGE Input bullet`]
  const out: string[] = []
  if (!/Rules bullets/.test(bullet)) out.push(`${agent}: does not say Rules bullets`)
  if (tier === 'rich') {
    if (!/KB path/.test(bullet)) out.push(`${agent}: does not name the KB path`)
    if (!/heading index/.test(bullet) || /no heading index/.test(bullet)) out.push(`${agent}: does not say it receives a heading index`)
  } else {
    if (!/KB path/.test(bullet)) out.push(`${agent}: does not name the KB path`)
    if (!/no heading index/.test(bullet)) out.push(`${agent}: does not say there is no heading index`)
  }
  if (/Pre-computed feature area context/.test(bullet)) out.push(`${agent}: still describes the whole-KB form`)
  if (agent === 'evaluate') {
    if (!/[Aa]cceptance context/.test(bullet)) out.push('evaluate: does not present the Rules as acceptance context')
    if (/pattern/i.test(bullet)) out.push('evaluate: the form line uses the word pattern')
  }
  return out
}

describe('each recipient is told the form it receives (D-KB-DELIVERY-TIERS)', () => {
  it('the eight agents describe exactly their tier, and evaluate keeps pattern wording out', () => {
    const defects = [
      ...RICH_AGENTS.flatMap(a => collectFormDefects(a, inputBullet(resolveAgentSource(a).content), 'rich')),
      ...RULES_AGENTS.flatMap(a => collectFormDefects(a, inputBullet(resolveAgentSource(a).content), 'rules')),
    ]
    expect(defects).toEqual([])
  })

  it('the evaluate form line holds none of the words the duty-ownership guard reserves for scrutinize (AC-228)', () => {
    const bullet = inputBullet(resolveAgentSource('evaluate').content) ?? ''
    expect(bullet.length, 'nothing read').toBeGreaterThan(100)
    expect(bullet).not.toMatch(/anti-patterns?\b|\bstubs?\b|\bwir(?:ed|ing)\b|\bpatterns?\b/i)
  })

  it('the quality-gates line describes the Rules-only form Scrutinize receives', () => {
    const skill = read('src/assets/skills/quality-gates/SKILL.md')
    const line = skill.split('\n').find(l => l.startsWith('If `FEATURE_KNOWLEDGE` is provided')) ?? ''
    expect(line, 'the line moved').not.toBe('')
    expect(line).toMatch(/Rules bullets/)
    expect(line).toMatch(/KB path/)
    expect(line).toMatch(/no heading index/)
    expect(line).not.toMatch(/documented architecture and anti-patterns/)
  })

  it('the plan Explore instruction cites KB IDs instead of relaying KB text', () => {
    const plan = requireDistFile('plan.md')
    expect(plan).toContain('cite its KB IDs (`{slug} KB-AP-n`) instead of restating the text')
    expect(plan).toContain('VALIDATE, EXTEND, and CORRECT it')
    expect(plan).not.toContain("VALIDATE, EXTEND, and CORRECT it, don't repeat it")
  })

  it('known-bad probe: the whole-KB wording, a missing index claim and pattern wording in evaluate are each reported', () => {
    const bullet = inputBullet(resolveAgentSource('code').content)
    expect(collectFormDefects('code', bullet, 'rich')).toEqual([])
    expect(collectFormDefects('code', '- **FEATURE_KNOWLEDGE** (optional): Pre-computed feature area context', 'rich')).toEqual([
      'code: does not say Rules bullets', 'code: does not name the KB path', 'code: does not say it receives a heading index', 'code: still describes the whole-KB form',
    ])
    const scrutinize = inputBullet(resolveAgentSource('scrutinize').content)
    expect(collectFormDefects('scrutinize', scrutinize, 'rules')).toEqual([])
    expect(collectFormDefects('scrutinize', (scrutinize ?? '').replace('no heading index', 'a heading index'), 'rules')).toEqual(['scrutinize: does not say there is no heading index'])
    const evaluate = inputBullet(resolveAgentSource('evaluate').content)
    expect(collectFormDefects('evaluate', evaluate, 'rules')).toEqual([])
    expect(collectFormDefects('evaluate', `${evaluate} Check the anti-pattern.`, 'rules')).toEqual(['evaluate: the form line uses the word pattern'])
    expect(collectFormDefects('evaluate', null, 'rules')).toEqual(['evaluate: no FEATURE_KNOWLEDGE Input bullet'])
  })
})

// ---------------------------------------------------------------------------
// Who takes no input, and where the load never runs
// ---------------------------------------------------------------------------

describe('Validate, Git and Test take no input, and explore, debug and the hooks never load (D-KB-DELIVERY-TIERS)', () => {
  it('validate, git and test declare no FEATURE_KNOWLEDGE input', () => {
    for (const agent of ['validate', 'git', 'test']) {
      const body = resolveAgentSource(agent).content
      expect(body.length, `${agent}: nothing read`).toBeGreaterThan(1000)
      expect(body, agent).not.toContain('FEATURE_KNOWLEDGE')
    }
  })

  it('explore and debug call no knowledge_load, and no hook script names the variable', () => {
    for (const host of ['explore', 'debug']) {
      const source = read(`src/assets/commands/${host}.mds`)
      expect(source.length, `${host}: nothing read`).toBeGreaterThan(1000)
      expect(source, host).not.toContain('knowledge_load')
      expect(requireDistFile(`${host}.md`), host).not.toContain(LOAD_HEADING)
    }
    const hooks = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks')
    const scripts = readdirSync(hooks, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)
    expect(scripts.length, 'nothing scanned').toBeGreaterThan(10)
    expect(scripts.filter(f => readFileSync(path.join(hooks, f), 'utf-8').includes('FEATURE_KNOWLEDGE'))).toEqual([])
  })

  it('known-bad probe: a Validate body that declares the input is reported by the same check', () => {
    const declares = (body: string): boolean => body.includes('FEATURE_KNOWLEDGE')
    expect(declares(resolveAgentSource('validate').content)).toBe(false)
    expect(declares(`${resolveAgentSource('validate').content}\n- **FEATURE_KNOWLEDGE** (optional): x`)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

describe('release loads by block delivery and spawns nothing that takes it (D-KB-DELIVERY-TIERS)', () => {
  it('release imports the shared load, lists both variables in Produces, and passes neither to a spawn', () => {
    const source = read('src/assets/commands/release.mds')
    expect(source).toContain('@import { knowledge_load } from "./_partials/_knowledge.mds"')
    expect(source).toContain('{{knowledge_load()}}')
    expect(source).not.toContain('Load feature knowledge:')
    const release = requireDistFile('release.md')
    expect(collectLoadDefects('release', release)).toEqual([])
    expect(release).toMatch(/\*\*Produces:\*\* DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, FEATURE_KNOWLEDGE_RULES/)
    expect(collectFkSites(release)).toEqual([])
    expect(release).not.toMatch(/FEATURE_KNOWLEDGE(?:_RULES)?:\s*\{/)
  })

  it('known-bad probe: a release that passes the input to a spawn is reported', () => {
    const release = requireDistFile('release.md')
    const seeded = `${release}\nAgent(subagent_type="Validate"):\n"FEATURE_KNOWLEDGE: {feature_knowledge}"\n`
    expect(collectFkSites(seeded)).toEqual([{ agent: 'Validate', variable: RICH }])
    expect(collectTierDefects('release', seeded, []).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// The consumer skill
// ---------------------------------------------------------------------------

/** Named collector: how the consumer skill falls short of the block delivery. */
export function collectConsumerDefects(skill: string): string[] {
  const out: string[] = []
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? ''
  if (!/^allowed-tools: Read, Bash$/m.test(frontmatter)) out.push('allowed-tools is not "Read, Bash"')
  for (const [label, literal] of [
    ['cites a Rules bullet as {slug} KB-AP-n', '`{slug} KB-AP-n`'],
    ['cites a legacy bullet by section', '`{slug} {section}`'],
    ['lists headings through Bash', "command grep -n '^## '"],
    ['reads a section with offset and limit', '`offset` and `limit`'],
    ['takes the start line from the Headings line', '`Headings:` line'],
    ['quotes KB text only from a Read view', 'Quote KB text only from a Read view'],
    ['keeps the skip guard', 'skip this skill entirely'],
  ] as const) if (!skill.includes(literal)) out.push(`does not state: ${label}`)
  if (/\bGrep\b/.test(skill)) out.push('names the Grep tool')
  return out
}

describe('the consumer skill applies the blocks and reads a section on demand (D-KB-DELIVERY-TIERS)', () => {
  it('apply-feature-knowledge states the citation forms, the Bash listing and the Read view rule', () => {
    const skill = read('src/assets/skills/apply-feature-knowledge/SKILL.md')
    expect(skill.length, 'nothing read').toBeGreaterThan(1000)
    expect(collectConsumerDefects(skill)).toEqual([])
  })

  it('known-bad probe: the Grep tool, a lost citation form and Read-only tools are each reported', () => {
    const skill = read('src/assets/skills/apply-feature-knowledge/SKILL.md')
    expect(collectConsumerDefects(skill.replace('allowed-tools: Read, Bash', 'allowed-tools: Read'))).toEqual(['allowed-tools is not "Read, Bash"'])
    expect(collectConsumerDefects(skill.replace('`{slug} KB-AP-n`', 'the ID'))).toEqual(['does not state: cites a Rules bullet as {slug} KB-AP-n'])
    expect(collectConsumerDefects(`${skill}\nUse the Grep tool.`)).toEqual(['names the Grep tool'])
  })
})
