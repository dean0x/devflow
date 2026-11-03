/**
 * /plan's Revise loop is bounded (#455, D-PLAN-REVISE-BOUND).
 *
 * Gate 2 used to offer "Revise — re-run phases 10-12 with new constraints (loop back,
 * no limit on revisions)". At `full` a revision spawns five agents (Plan ×3,
 * Synthesize, Design) and the first pass keeps every spawn; at `standard` and `lean`
 * the levels reference cuts the first pass, on the run evidence in issue #473, and a
 * revision spawns two (Plan, Design). Either way an unbounded loop is an unbounded
 * bill. The bound is two revisions; then Gate 2 offers Accept, Cancel, or "Restart
 * /plan with these constraints". This guard holds only the loop's bound;
 * tests/guards/plan-levels.test.ts holds the spawn counts of each level.
 *
 *   AC-201  Revise is "when fewer than 2 revisions have run", with a budget of "at most
 *           2 revisions"; after that Gate 2 offers Accept, Cancel and Restart. The
 *           Error Handling rule says the same, and no line still promises "no limit".
 *
 * Both builds are read: the curation-on command and the curation-off variant, because
 * the bound sits beside curation arms and a build that dropped it would lose it
 * silently on one machine.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe
 * run through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { requireDistFile, resolveCurationOffSource } from '../helpers.js'

interface Build {
  readonly label: string
  readonly content: string
}

function builds(): Build[] {
  const off = resolveCurationOffSource('commands', 'plan')
  if (off === null) throw new Error('dist/curation-off/commands/plan.md is absent — run `npm run build` first')
  return [
    { label: 'curation-on', content: requireDistFile('plan.md') },
    { label: 'curation-off', content: off },
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

for (const kind of ['curation-on', 'curation-off'] as const) {
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

}

describe('both builds carry the same bound', () => {
  it('the Gate 2 menu and the Error Handling rule are byte-identical across the curation builds', () => {
    const [on, off] = builds()
    expect(gate2Menu(on.content)).toBe(gate2Menu(off.content))
    expect(errorHandlingRule(on.content)).toBe(errorHandlingRule(off.content))
    expect(gate2Menu(on.content), 'the corpus is empty').not.toBe('')
  })
})
