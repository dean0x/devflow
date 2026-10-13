/**
 * /plan's Revise loop is bounded (#455, D-PLAN-REVISE-BOUND).
 *
 * Gate 2 used to offer "Revise — re-run phases 10-12 with new constraints (loop back,
 * no limit on revisions)". Each revision spawns five agents (Plan ×3, Synthesize,
 * Design), so an unbounded loop is an unbounded bill. The bound is two revisions; then
 * Gate 2 offers Accept, Cancel, or "Restart /plan with these constraints". The spawn
 * count of a first pass is NOT cut (D-3: no quality evidence to cut a perspective), so
 * this guard holds only the loop's bound and its diagram.
 *
 *   AC-201  Revise is "when fewer than 2 revisions have run", with a budget of "at most
 *           2 revisions"; after that Gate 2 offers Accept, Cancel and Restart. The
 *           Error Handling rule says the same, and no line still promises "no limit".
 *   AC-206  The Architecture diagram shows the Git spawns of Phase 1 and Phase 14 and
 *           the bounded Revise loop.
 *
 * Both builds are read: the learning-on command and the learning-off variant, because
 * the bound sits beside learning arms and a build that dropped it would lose it
 * silently on one machine.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe
 * run through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { requireDistFile, resolveLearningOffSource } from '../helpers.js'

interface Build {
  readonly label: string
  readonly content: string
}

function builds(): Build[] {
  const off = resolveLearningOffSource('commands', 'plan')
  if (off === null) throw new Error('dist/learning-off/commands/plan.md is absent — run `npm run build` first')
  return [
    { label: 'learning-on', content: requireDistFile('plan.md') },
    { label: 'learning-off', content: off },
  ]
}

/** The Gate 2 "User can:" menu, from its lead to the MANDATORY line. */
function gate2Menu(content: string): string {
  const at = content.indexOf('User can:\n- **Accept**')
  const end = content.indexOf('**MANDATORY**: Do not write design artifact until Gate 2 is confirmed.', at)
  return at === -1 || end === -1 ? '' : content.slice(at, end)
}

/** The Error Handling section's Revise rule. */
function errorHandlingRule(content: string): string {
  return content.split('\n').find(l => l.startsWith('- If user selects "Revise" at Gate 2')) ?? ''
}

/** The Architecture diagram: the fenced block under `## Architecture`. */
function diagram(content: string): string {
  const at = content.indexOf('## Architecture')
  const open = content.indexOf('```', at)
  const close = content.indexOf('```', open + 3)
  return at === -1 || open === -1 || close === -1 ? '' : content.slice(open, close)
}

/** Named collector: what a built /plan lacks of the Revise bound (AC-201). */
export function collectReviseBoundDefects(content: string): string[] {
  const out: string[] = []
  const menu = gate2Menu(content)
  if (menu === '') return ['no Gate 2 menu']
  if (!menu.includes('- **Revise** — when fewer than 2 revisions have run, re-run phases 10-12 with new constraints.')) out.push('Revise is not conditioned on fewer than 2 revisions')
  if (!menu.includes('Budget: at most 2 revisions')) out.push('Revise states no budget of 2')
  if (!menu.includes('- **Restart /plan with these constraints**')) out.push('Gate 2 offers no Restart')
  if (!menu.includes('offered in place of Revise once 2 revisions have run')) out.push('Restart is not what replaces Revise')
  if (!menu.includes('- **Accept**') || !menu.includes('- **Cancel**')) out.push('Accept or Cancel is missing')
  if (!menu.includes('write no artifact')) out.push('Restart may write an artifact')
  const rule = errorHandlingRule(content)
  if (rule === '') out.push('no Error Handling rule for Revise')
  else {
    if (!rule.includes('fewer than 2 revisions have run')) out.push('the Error Handling rule is unbounded')
    if (!rule.includes('Restart /plan with these constraints')) out.push('the Error Handling rule names no Restart')
  }
  if (/no limit on revisions|unlimited revisions|as many (?:times|revisions)/i.test(content)) out.push('a line still promises an unbounded Revise')
  return out
}

/** Named collector: what the diagram lacks (AC-206): the two Git spawns and the bounded loop. */
export function collectDiagramDefects(content: string): string[] {
  const out: string[] = []
  const d = diagram(content)
  if (d === '') return ['no Architecture diagram']
  const line = (needle: string): number => d.split('\n').findIndex(l => l.includes(needle))
  const phase1 = line('Phase 1: GATE 0')
  const fetch = line('Git agent (fetch-issue / fetch-issues-batch)')
  const phase2 = line('Phase 2:')
  if (fetch === -1) out.push('Phase 1 shows no Git fetch spawn')
  else if (!(phase1 < fetch && fetch < phase2)) out.push('the Git fetch spawn is not under Phase 1')
  const phase14 = line('Phase 14: Output')
  const ensure = line('Git agent (ensure-traceable-issue)')
  if (ensure === -1) out.push('Phase 14 shows no Git ensure-traceable-issue spawn')
  else if (ensure < phase14) out.push('the Git ensure-traceable-issue spawn is not under Phase 14')
  const gate2 = line('Phase 13: GATE 2')
  const revise = line('Revise ≤ 2')
  if (revise === -1) out.push('the diagram shows no bounded Revise loop')
  else if (!(gate2 < revise && revise < phase14)) out.push('the Revise loop is not under Gate 2')
  if (revise !== -1 && !d.split('\n')[revise].includes('Restart /plan')) out.push('the diagram does not show where Revise ends')
  return out
}

for (const kind of ['learning-on', 'learning-off'] as const) {
  describe(`AC-201: /plan Revise is bounded at 2 (${kind} build)`, () => {
    const build = builds().find(b => b.label === kind)!

    it('reads a real build with a Gate 2 menu and an Error Handling rule', () => {
      expect(build.content.length, 'the build is empty').toBeGreaterThan(20_000)
      expect(gate2Menu(build.content).length, 'no Gate 2 menu').toBeGreaterThan(200)
      expect(errorHandlingRule(build.content), 'no Error Handling rule').not.toBe('')
    })

    it('states the bound, the replacement and no unbounded promise', () => {
      expect(collectReviseBoundDefects(build.content)).toEqual([])
    })

    it('known-bad probes: the old unbounded line, a dropped budget, a missing Restart and an unbounded rule are each reported', () => {
      const c = build.content
      const old = c.replace(
        '- **Revise** — when fewer than 2 revisions have run, re-run phases 10-12 with new constraints. Budget: at most 2 revisions, counted over the whole run',
        '- **Revise** — re-run phases 10-12 with new constraints (loop back, no limit on revisions)')
      expect(old, 'the seed must land').not.toBe(c)
      expect(collectReviseBoundDefects(old)).toEqual([
        'Revise is not conditioned on fewer than 2 revisions',
        'Revise states no budget of 2',
        'a line still promises an unbounded Revise',
      ])
      const noRestart = c.replace('- **Restart /plan with these constraints**', '- **Start over**')
      expect(collectReviseBoundDefects(noRestart)).toEqual(['Gate 2 offers no Restart'])
      const rule = errorHandlingRule(c)
      expect(collectReviseBoundDefects(c.replace(rule, '- If user selects "Revise" at Gate 2, loop back to Phase 10 with user\'s constraints'))).toEqual(['the Error Handling rule is unbounded', 'the Error Handling rule names no Restart'])
      expect(collectReviseBoundDefects(c.replace('write no artifact', 'write the artifact so far'))).toEqual(['Restart may write an artifact'])
    })
  })

  describe(`AC-206: the /plan diagram shows the Git spawns and the bounded Revise (${kind} build)`, () => {
    const build = builds().find(b => b.label === kind)!

    it('reads a real diagram', () => {
      expect(diagram(build.content).split('\n').length, 'the diagram is short').toBeGreaterThan(40)
    })

    it('shows the Phase 1 and Phase 14 Git spawns and the Revise ≤ 2 loop under Gate 2', () => {
      expect(collectDiagramDefects(build.content)).toEqual([])
    })

    it('known-bad probes: each missing piece is reported on its own', () => {
      const c = build.content
      expect(collectDiagramDefects(c.replace('│  │  ├─ Git agent (fetch-issue / fetch-issues-batch) - issue mode only\n', ''))).toEqual(['Phase 1 shows no Git fetch spawn'])
      expect(collectDiagramDefects(c.replace('Git agent (ensure-traceable-issue) - create or enrich tracker issue (optional)', 'Create tracker issue (optional)'))).toEqual(['Phase 14 shows no Git ensure-traceable-issue spawn'])
      expect(collectDiagramDefects(c.replace('│     └─ Revise ≤ 2 → back to Phase 10; after 2: Accept / Cancel / Restart /plan\n', ''))).toEqual(['the diagram shows no bounded Revise loop'])
      expect(collectDiagramDefects(c.replace('after 2: Accept / Cancel / Restart /plan', 'after 2: stop'))).toEqual(['the diagram does not show where Revise ends'])
    })
  })
}

describe('both builds carry the same bound', () => {
  it('the Gate 2 menu and the Error Handling rule are byte-identical across the learning builds', () => {
    const [on, off] = builds()
    expect(gate2Menu(on.content)).toBe(gate2Menu(off.content))
    expect(errorHandlingRule(on.content)).toBe(errorHandlingRule(off.content))
    expect(gate2Menu(on.content), 'the corpus is empty').not.toBe('')
  })
})
