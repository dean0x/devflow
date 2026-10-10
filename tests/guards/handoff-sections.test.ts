/**
 * D-HANDOFF-CAP (#427): a handoff file is a list of per-phase sections, each written once by the
 * Code agent that completed the phase.
 *
 * When a ticket runs sequential Code phases, the durable record is `handoff-{branch_slug}.md`. The
 * unit is one `## Phase {N} Implementation Summary` section, capped at 8,192 UTF-8 bytes. The writer
 * condenses its own section before writing and appends it with a redirect, so no later write
 * rewrites an earlier section and the orchestrator never has to read the file back and rewrite it.
 * The next Code agent reads only the section of the phase immediately before its own. The
 * `## Evidence Exceptions` section is the orchestrator's: written first, before any Code spawn,
 * byte-identical afterwards and outside any cap.
 *
 * Three places state the protocol and must agree: the Code agent (its HANDOFF_FILE input, orientation
 * read, handoff step and Output template), the `**Handoff Protocol**` paragraph of `/implement`, and
 * the handoff convention that the four dynamic commands share through `authoring_preamble()`. The
 * persistence clauses `tests/evidence-policy/ticket-gate.test.ts` pins stay byte-identical.
 *
 * Each arm runs through a named collector, and the known-bad probes feed the same collectors.
 */

import { describe, it, expect } from 'vitest'

import { requireDistFile, resolveAgentSource } from '../helpers.js'

const SECTION_HEADING = '## Phase {N} Implementation Summary'
const DYNAMIC_HOSTS = ['dynamic-build', 'dynamic-plan', 'dynamic-profile', 'dynamic-tickets'] as const

/** The `**Handoff Protocol**` paragraph of the compiled implement command. */
export function handoffProtocol(implement: string): string {
  return implement.split('\n').find(l => l.startsWith('**Handoff Protocol**')) ?? ''
}

/** The shared handoff convention paragraph of a compiled dynamic command. */
export function handoffConvention(command: string): string {
  const start = command.indexOf('### Handoff convention for sequential Code agents within a ticket')
  if (start === -1) return ''
  const rest = command.slice(start)
  const end = rest.indexOf('\n### ', 5)
  return end === -1 ? rest : rest.slice(0, end)
}

interface Rule {
  readonly label: string
  /** True when the text states the rule. */
  readonly holds: (text: string) => boolean
}

/** What the Code agent's text must state. */
const CODE_RULES: readonly Rule[] = [
  { label: 'the Code agent is the writer', holds: t => /append your own `## Phase \{N\} Implementation Summary` section/.test(t) },
  { label: 'the section heading', holds: t => t.includes(SECTION_HEADING) },
  { label: 'the 8,192-byte cap', holds: t => t.includes('at most 8,192 bytes') },
  { label: 'the writer condenses its own section', holds: t => /condensing it before writing; nothing else is condensed/.test(t) },
  { label: 'append-only', holds: t => t.includes('with a Bash `>>` redirect, never rewriting an earlier section or the `## Evidence Exceptions` section') },
  { label: 'the reader takes only the preceding phase', holds: t => /read only the `## Phase \{N\} Implementation Summary` section of the phase immediately before yours/.test(t) },
  { label: 'never the whole file', holds: t => t.includes('never the whole file') },
  { label: 'the Output template names the appended section', holds: t => t.includes('end with the section you appended to `HANDOFF_FILE`') },
]

/** What the orchestrator-side texts (the Handoff Protocol paragraph, the shared convention) must state. */
const ORCHESTRATOR_RULES: readonly Rule[] = [
  { label: 'the Code agent is the writer', holds: t => /[Ee]ach Code agent[^.]*appends its own `## Phase \{N\} Implementation Summary` section/.test(t) },
  { label: 'the 8,192-byte cap', holds: t => t.includes('at most 8,192 bytes') },
  { label: 'append-only', holds: t => /never rewrit(?:es|ing) an earlier section/.test(t) },
  { label: 'the reader takes only the preceding phase', holds: t => /only the section of the phase immediately before its own/.test(t) },
]

/** Named collector: the rules a body does not state. */
export function collectRuleDefects(label: string, text: string, rules: readonly Rule[]): string[] {
  return rules.filter(r => !r.holds(text)).map(r => `${label}: does not state ${r.label}`)
}

/** Named collector: the Handoff Protocol paragraph's other clauses (AC-219). */
export function collectProtocolDefects(paragraph: string): string[] {
  const out: string[] = []
  if (!paragraph.startsWith('**Handoff Protocol**')) out.push('the paragraph does not begin with **Handoff Protocol**')
  if (!paragraph.includes('keeping any `## Evidence Exceptions` section byte-identical')) out.push('a phase-summary write may drop the Evidence Exceptions section')
  if (!paragraph.includes('once the PR exists')) out.push('cleanup is not tied to the PR existing')
  if (/using the Write tool/.test(paragraph) || /write its phase summary/.test(paragraph)) out.push('the orchestrator is still told to write the phase summary')
  if (!paragraph.includes('The orchestrator writes no phase section')) out.push('does not say the orchestrator writes no phase section')
  return out
}

/** Named collector: a sentence that allows rewriting an earlier section or the Evidence Exceptions section. */
export function collectRewriteAllowances(label: string, text: string): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.;])\s+|\n+/)) {
    if (/\brewrit(?:e|es|ing|ten)\b/i.test(sentence) && /\b(?:section|handoff|file)\b/i.test(sentence) && !/\b(?:never|nothing|not)\b/i.test(sentence)) {
      out.push(`${label}: ${sentence.trim().slice(0, 100)}`)
    }
  }
  return out
}

describe('the Code agent writes its own capped section and reads only the one before it (D-HANDOFF-CAP)', () => {
  it('the Code agent states the writer, heading, cap, append-only rule and the narrow read', () => {
    const code = resolveAgentSource('code').content
    expect(code.length, 'nothing read').toBeGreaterThan(5000)
    expect(collectRuleDefects('code', code, CODE_RULES)).toEqual([])
    // The template under Output carries the same heading as the step.
    expect(code.split(SECTION_HEADING).length - 1).toBeGreaterThanOrEqual(3)
  })

  it('the /implement Handoff Protocol paragraph states the same protocol and keeps its pinned clauses', () => {
    const paragraph = handoffProtocol(requireDistFile('implement.md'))
    expect(paragraph.length, 'the paragraph moved').toBeGreaterThan(300)
    expect(collectRuleDefects('implement', paragraph, ORCHESTRATOR_RULES)).toEqual([])
    expect(collectProtocolDefects(paragraph)).toEqual([])
  })

  it('every dynamic command states the same convention through the shared preamble', () => {
    for (const host of DYNAMIC_HOSTS) {
      const convention = handoffConvention(requireDistFile(`${host}.md`))
      expect(convention.length, `${host}: the convention moved`).toBeGreaterThan(300)
      expect(collectRuleDefects(host, convention, ORCHESTRATOR_RULES)).toEqual([])
    }
  })

  it('known-bad probe: each lost rule in each of the three places is reported', () => {
    const code = resolveAgentSource('code').content
    const paragraph = handoffProtocol(requireDistFile('implement.md'))
    const convention = handoffConvention(requireDistFile('dynamic-build.md'))
    const seeds: ReadonlyArray<readonly [string, string, string, readonly Rule[], string]> = [
      ['code', code, '8,192 bytes', CODE_RULES, 'the 8,192-byte cap'],
      ['code', code, 'with a Bash `>>` redirect', CODE_RULES, 'append-only'],
      ['code', code, 'immediately before yours', CODE_RULES, 'the reader takes only the preceding phase'],
      ['code', code, 'never the whole file', CODE_RULES, 'never the whole file'],
      ['implement', paragraph, 'at most 8,192 bytes', ORCHESTRATOR_RULES, 'the 8,192-byte cap'],
      ['implement', paragraph, 'never rewriting an earlier section', ORCHESTRATOR_RULES, 'append-only'],
      ['implement', paragraph, 'immediately before its own', ORCHESTRATOR_RULES, 'the reader takes only the preceding phase'],
      ['dynamic-build', convention, 'at most 8,192 bytes', ORCHESTRATOR_RULES, 'the 8,192-byte cap'],
      ['dynamic-build', convention, 'It never rewrites an earlier section', ORCHESTRATOR_RULES, 'append-only'],
      ['dynamic-build', convention, 'only the section of the phase immediately before its own', ORCHESTRATOR_RULES, 'the reader takes only the preceding phase'],
    ]
    for (const [label, text, literal, rules, rule] of seeds) {
      const broken = text.replaceAll(literal, 'x')
      expect(broken, `the seed "${literal}" must land`).not.toBe(text)
      expect(collectRuleDefects(label, broken, rules), literal).toContain(`${label}: does not state ${rule}`)
    }
    const heading = code.replaceAll(SECTION_HEADING, '## Phase summary')
    expect(collectRuleDefects('code', heading, CODE_RULES)).toContain('code: does not state the section heading')
  })
})

describe('no rule rewrites an earlier section or the Evidence Exceptions section (D-HANDOFF-CAP)', () => {
  it('the Handoff Protocol keeps its prefix and clauses, and the orchestrator no longer writes a phase section', () => {
    expect(collectProtocolDefects(handoffProtocol(requireDistFile('implement.md')))).toEqual([])
  })

  it('no handoff text allows a rewrite, and the Evidence Exceptions forwarding is unchanged', () => {
    const code = resolveAgentSource('code').content
    const implement = requireDistFile('implement.md')
    const texts: Array<readonly [string, string]> = [
      ['code', code],
      ['implement', handoffProtocol(implement)],
      ...DYNAMIC_HOSTS.map(h => [h, handoffConvention(requireDistFile(`${h}.md`))] as const),
    ]
    expect(texts.every(([, t]) => t.length > 300)).toBe(true)
    expect(texts.flatMap(([label, t]) => collectRewriteAllowances(label, t))).toEqual([])
    // The orchestrator still records the exception first, and PR_EXCEPTIONS still forwards verbatim.
    expect(implement).toContain('**Record the exception at once**, before any Code spawn')
    expect(implement).toMatch(/PR_EXCEPTIONS: \{the ## Evidence Exceptions section of \{worktree\}\/\.devflow\/docs\/handoff-\{branch_slug\}\.md verbatim, or \(none\)\}/)
    expect(code).toContain('- **PR_EXCEPTIONS** (optional): the pre-rendered `## Evidence Exceptions` section')
  })

  it('known-bad probe: a restored orchestrator write, a rewrite allowance and a lost clause are each reported', () => {
    const paragraph = handoffProtocol(requireDistFile('implement.md'))
    const restored = paragraph.replace('The orchestrator writes no phase section.', 'After each Code agent completes, write its phase summary using the Write tool.')
    expect(restored, 'the seed must land').not.toBe(paragraph)
    expect(collectProtocolDefects(restored)).toEqual([
      'the orchestrator is still told to write the phase summary',
      'does not say the orchestrator writes no phase section',
    ])
    expect(collectProtocolDefects(paragraph.replace('keeping any `## Evidence Exceptions` section byte-identical', 'keeping notes'))).toEqual([
      'a phase-summary write may drop the Evidence Exceptions section',
    ])
    expect(collectProtocolDefects(paragraph.replace('once the PR exists', 'when done'))).toEqual(['cleanup is not tied to the PR existing'])
    expect(collectProtocolDefects(`x${paragraph}`)).toEqual(['the paragraph does not begin with **Handoff Protocol**'])
    expect(collectRewriteAllowances('s', 'Rewrite the handoff file with the new section.')).toHaveLength(1)
    expect(collectRewriteAllowances('s', 'Each agent may rewrite an earlier section when it changes.')).toHaveLength(1)
    expect(collectRewriteAllowances('s', 'It never rewrites an earlier section.')).toEqual([])
  })
})
