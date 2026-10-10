/**
 * D-KB-RULES-SHAPE and D-KB-LEGACY-FALLBACK (#427): the shape a feature knowledge base is written in.
 *
 * Readers reproduce KB-specific content from anti-pattern, gotcha and invariant bullets far more
 * than from architecture prose, so every KB leads with a `## Rules` section of one-line bullets
 * under stable IDs, and the budget is a character count that is curated to, never cut to. This
 * guard holds the wording in the two files that write KBs (the `feature-knowledge` skill and the
 * Knowledge agent) and in the write-back prompt that registers the index line:
 *
 *   - the template and the Worked Example put `## Rules` first, after the title, and the skill states
 *     the 3-5K size, the `KB-AP-n` / `KB-INV-n` IDs, ID stability, retirement and the citation form;
 *   - the skill and the agent state no volatile numbers (naming the pinning test), a 30,000-character
 *     target, a 40,000-character ceiling, index lines of at most 300 characters, descriptions of at
 *     most 220 and "curate, never truncate"; the write-back prompt states the 300 cap;
 *   - neither file tells the agent to truncate, cut or drop KB content to meet a budget;
 *   - the 500-line cap and the split rule are replaced by the budget, with splitting kept only as the
 *     fallback when curation cannot reach the ceiling;
 *   - the legacy fallback and the refresh rule are stated, and the agent states the refresh rule once,
 *     inside its Direct Write Protocol paragraph and nowhere under Responsibilities.
 *
 * Each arm runs through a named collector and each has a known-bad probe over the same collector.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, collectUnfencedH2, requireDistFile, resolveAgentSource } from '../helpers.js'

const SKILL = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'feature-knowledge', 'SKILL.md'), 'utf-8')
const agentBody = (): string => resolveAgentSource('knowledge').content

/** The `knowledge_writeback` prompt as the implement command compiles it. */
function writebackPrompt(): string {
  const text = requireDistFile('implement.md')
  const start = text.indexOf('### Feature Knowledge Write-Back (Conditional)')
  if (start === -1) throw new Error('implement.md carries no write-back section')
  return text.slice(start)
}

// ---------------------------------------------------------------------------
// Rules first (AC-201)
// ---------------------------------------------------------------------------

/** The `## ` headings of a markdown fence's body, in order. */
function fenceHeadings(body: string): string[] {
  return body.split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3).trim())
}

/** Named collector: the template and the Worked Example, and what each puts first after the title. */
export function collectRulesFirstDefects(skill: string): string[] {
  const out: string[] = []
  const template = /### KNOWLEDGE\.md Structure\n\n```markdown\n([\s\S]*?)\n```/.exec(skill)?.[1]
  const example = /````markdown\n([\s\S]*?)\n````/.exec(skill)?.[1]
  if (template === undefined) out.push('no KNOWLEDGE.md template fence')
  else if (fenceHeadings(template)[0] !== 'Rules') out.push(`the template opens with "${fenceHeadings(template)[0]}", not Rules`)
  if (example === undefined) out.push('no Worked Example fence')
  else if (fenceHeadings(example)[0] !== 'Rules') out.push(`the Worked Example opens with "${fenceHeadings(example)[0]}", not Rules`)
  for (const [label, literal] of [
    ['the 3-5K size', 'about 3–5K characters'],
    ['the anti-pattern ID', '`KB-AP-n`'],
    ['the invariant ID', '`KB-INV-n`'],
    ['ID stability across rewrites', 'A bullet keeps its ID across rewrites'],
    ['ID retirement', "a removed bullet's ID is retired and never reused"],
    ['the citation form', 'as `{slug} KB-AP-n`; a bare ID is never cited'],
    ['the one-line grammar', 'A bullet fits one line and never starts with `## `'],
  ] as const) if (!skill.includes(literal)) out.push(`does not state ${label}`)
  return out
}

describe('Rules come first and their IDs are stable (D-KB-RULES-SHAPE)', () => {
  it('the template and the Worked Example open with Rules, and the skill states size, IDs, stability and citation', () => {
    expect(SKILL.length, 'nothing read').toBeGreaterThan(5000)
    expect(collectRulesFirstDefects(SKILL)).toEqual([])
  })

  it('known-bad probe: Rules moved down, in either fence, and each lost rule are reported', () => {
    const movedTemplate = SKILL.replace('## Rules\n- **KB-AP-1** [one-line', '## Overview\n- **KB-AP-1** [one-line')
    expect(movedTemplate, 'the seed must land').not.toBe(SKILL)
    expect(collectRulesFirstDefects(movedTemplate)).toEqual(['the template opens with "Overview", not Rules'])
    const movedExample = SKILL.replace('## Rules\n\n- **KB-AP-1** Fetch logic', '## Overview\n\n- **KB-AP-1** Fetch logic')
    expect(movedExample, 'the seed must land').not.toBe(SKILL)
    expect(collectRulesFirstDefects(movedExample)).toEqual(['the Worked Example opens with "Overview", not Rules'])
    expect(collectRulesFirstDefects(SKILL.replace('never reused', 'reused freely'))).toEqual(['does not state ID retirement'])
    expect(collectRulesFirstDefects(SKILL.replaceAll('`KB-INV-n`', 'an ID'))).toEqual(['does not state the invariant ID'])
  })
})

// ---------------------------------------------------------------------------
// The budget (AC-202, AC-203, AC-204)
// ---------------------------------------------------------------------------

/** The budget elements both writers state, each with the regex that finds it. */
const BUDGET_ELEMENTS: ReadonlyArray<{ readonly label: string; readonly re: RegExp }> = [
  { label: 'no volatile numbers, naming the pinning test or constant', re: /volatile numbers?[\s\S]{0,400}(?:pinning test|test or constant that pins)/i },
  { label: 'the 30,000-character target', re: /target 30,000 characters/ },
  { label: 'the 40,000-character ceiling', re: /ceiling 40,000/ },
  { label: 'index lines of at most 300 characters', re: /at most 300 characters/ },
  { label: 'descriptions of at most 220 characters', re: /at most 220/ },
  { label: 'curate, never truncate', re: /[Cc]urate, never truncate/ },
]

/** Named collector: the budget elements a writer's text does not state. */
export function collectBudgetDefects(label: string, text: string): string[] {
  return BUDGET_ELEMENTS.filter(({ re }) => !re.test(text)).map(e => `${label} does not state ${e.label}`)
}

/**
 * Named collector (AC-203): sentences that tell the writer to truncate, cut, drop or trim content in
 * connection with a budget. A sentence that carries a negation ("never", "nothing", "not") is the
 * rule itself, not an instruction to cut.
 */
export function collectTruncationInstructions(label: string, text: string): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.;:])\s+|\n+/)) {
    const cuts = /\b(?:truncat\w*|cut|drop(?:ped)?|trim(?:med)?)\b/i.test(sentence)
    const budget = /budget|ceiling|30,000|40,000|\bcharacters?\b/i.test(sentence)
    const negated = /\b(?:never|nothing|not|no)\b/i.test(sentence)
    if (cuts && budget && !negated) out.push(`${label}: ${sentence.trim().slice(0, 100)}`)
  }
  return out
}

/** Named collector (AC-204): the retired size rule, wherever a writer still states it. */
export function collectSizeRuleResidue(label: string, text: string): string[] {
  const out: string[] = []
  if (/\b500[ -]lines?\b|500\+ lines/i.test(text)) out.push(`${label}: the 500-line cap`)
  if (/split (?:it )?into (?:focused )?sub-knowledge bases/i.test(text) && !/only when curation cannot bring/.test(text)) {
    out.push(`${label}: the split rule without the curation condition`)
  }
  return out
}

describe('the budget is a character count that is curated to (D-KB-RULES-SHAPE)', () => {
  it('the skill, the Knowledge agent and the write-back prompt state their halves of the budget', () => {
    const agent = agentBody()
    expect(agent.length, 'agent: nothing read').toBeGreaterThan(5000)
    expect(collectBudgetDefects('the skill', SKILL)).toEqual([])
    expect(collectBudgetDefects('the agent', agent)).toEqual([])
    const writeback = writebackPrompt()
    expect(writeback).toContain('at most 300 characters, the description at most 220')
    expect(writeback).toContain('reword a longer one, never cut it')
  })

  it('neither the skill nor the agent tells the writer to truncate, cut or drop content to meet a budget', () => {
    expect(collectTruncationInstructions('the skill', SKILL)).toEqual([])
    expect(collectTruncationInstructions('the agent', agentBody())).toEqual([])
  })

  it('the 500-line cap is gone, and splitting survives only when curation cannot reach the ceiling', () => {
    expect(collectSizeRuleResidue('the skill', SKILL)).toEqual([])
    expect(collectSizeRuleResidue('the agent', agentBody())).toEqual([])
    for (const text of [SKILL, agentBody()]) expect(text).toMatch(/only when curation cannot bring a KB under the ceiling/)
  })

  it('known-bad probe: a lost value, a truncation instruction and the old cap are each reported', () => {
    expect(collectBudgetDefects('s', SKILL.replace('ceiling 40,000', 'ceiling 50,000'))).toEqual(['s does not state the 40,000-character ceiling'])
    expect(collectBudgetDefects('s', SKILL.replace(/[Cc]urate, never truncate/g, 'Keep it short'))).toEqual(['s does not state curate, never truncate'])
    expect(collectBudgetDefects('s', SKILL.replaceAll('at most 300 characters', 'short'))).toEqual(['s does not state index lines of at most 300 characters'])
    expect(collectTruncationInstructions('s', 'Truncate the file to fit the ceiling.')).toHaveLength(1)
    expect(collectTruncationInstructions('s', 'Drop the oldest sections when over budget.')).toHaveLength(1)
    expect(collectTruncationInstructions('s', 'Curate, never truncate: nothing is cut to meet the budget.')).toEqual([])
    expect(collectSizeRuleResidue('s', 'The file stays under 500 lines (split if necessary)')).toEqual(['s: the 500-line cap'])
    expect(collectSizeRuleResidue('s', '| 500+ lines in a single file | split |')).toEqual(['s: the 500-line cap'])
    expect(collectSizeRuleResidue('s', 'split into sub-knowledge bases (each with its own entry)')).toEqual(['s: the split rule without the curation condition'])
  })
})

// ---------------------------------------------------------------------------
// Legacy KBs and the refresh rule (AC-205)
// ---------------------------------------------------------------------------

/** Named collector: how a writer's text leaves the legacy fallback unstated. */
export function collectLegacyDefects(label: string, text: string): string[] {
  const out: string[] = []
  if (!/without `## Rules`|no `## Rules` section/.test(text)) out.push(`${label} does not say a KB without Rules is valid`)
  if (!/one to three entries from its Anti-Patterns or Gotchas/.test(text)) out.push(`${label} does not state the one-to-three fallback`)
  if (!/cited by section name/.test(text)) out.push(`${label} does not state citation by section name`)
  if (!/path and heading index/.test(text)) out.push(`${label} does not state the path and heading index`)
  return out
}

/** The `## Direct Write Protocol` section of the agent, and everything else of it. */
function agentSections(body: string): { direct: string; responsibilities: string } {
  const h2 = collectUnfencedH2(body)
  const slice = (name: string): string => {
    const i = h2.findIndex(h => h.text === `## ${name}`)
    if (i === -1) return ''
    return body.slice(h2[i].index, i + 1 < h2.length ? h2[i + 1].index : body.length)
  }
  return { direct: slice('Direct Write Protocol'), responsibilities: slice('Responsibilities') }
}

/** Named collector: how the refresh rule is stated in the skill and the agent. */
export function collectRefreshRuleDefects(skill: string, agent: string): string[] {
  const out: string[] = []
  for (const literal of ['change only the sections the new work touches', 'Never renumber', 'never rewrite untouched sections to meet the budget', 'written as it stands']) {
    if (!skill.includes(literal)) out.push(`the skill does not state "${literal}"`)
  }
  const count = agent.split('never renumber').length - 1
  if (count !== 1) out.push(`the agent states "never renumber" ${count} times, expected once`)
  const { direct, responsibilities } = agentSections(agent)
  if (!direct.includes('never renumber')) out.push('the agent does not state the refresh rule in the Direct Write Protocol paragraph')
  if (!direct.includes('only the sections the new work touches')) out.push('the Direct Write Protocol paragraph does not limit a refresh to the touched sections')
  if (/renumber|untouched sections/.test(responsibilities)) out.push('the agent states the refresh rule under Responsibilities')
  return out
}

describe('the legacy fallback and the refresh rule are stated once each (D-KB-LEGACY-FALLBACK)', () => {
  it('the skill and the agent state the legacy fallback', () => {
    expect(collectLegacyDefects('the skill', SKILL)).toEqual([])
    expect(collectLegacyDefects('the agent', agentBody())).toEqual([])
  })

  it('the skill states the refresh rule and the agent states it once, in the Direct Write Protocol paragraph', () => {
    expect(collectRefreshRuleDefects(SKILL, agentBody())).toEqual([])
  })

  it('known-bad probe: a lost fallback, a second statement and a misplaced rule are each reported', () => {
    expect(collectLegacyDefects('s', SKILL.replace('cited by section name', 'cited somehow'))).toEqual([
      's does not state citation by section name',
    ])
    expect(collectLegacyDefects('s', 'nothing')).toHaveLength(4)
    const agent = agentBody()
    const doubled = agent.replace('3. **Follow the feature-knowledge skill**', '3. **Follow the feature-knowledge skill** (never renumber)')
    expect(doubled, 'the seed must land').not.toBe(agent)
    expect(collectRefreshRuleDefects(SKILL, doubled)).toEqual([
      'the agent states "never renumber" 2 times, expected once',
      'the agent states the refresh rule under Responsibilities',
    ])
    const lost = agent.replace('never renumber, ', '')
    expect(collectRefreshRuleDefects(SKILL, lost)).toContain('the agent states "never renumber" 0 times, expected once')
    expect(collectRefreshRuleDefects(SKILL.replace('Never renumber', 'Renumber freely'), agent)).toEqual(['the skill does not state "Never renumber"'])
  })
})
