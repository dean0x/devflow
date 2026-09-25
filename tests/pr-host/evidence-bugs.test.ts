/**
 * SDLC-evidence PR2 (#360), phase P1 — the PR-host evidence defects, executed
 * and structurally pinned.
 *
 * Every guard in this file has the three parts PF-064 asks of an absence-based
 * check: a NAMED collector, an assertion that the corpus it read is non-empty
 * (or exactly the size the property ranges over), and a known-bad probe that
 * drives the SAME collector over a seeded or historical text and must go red.
 * The historical texts are the `d09da34` spellings each fix replaces, quoted
 * verbatim, so the probes prove the teeth on real history rather than on seeds
 * alone.
 */

import { describe, it, expect } from 'vitest'

import { collectOrderViolations, type OrderRule } from '../helpers.js'

// ---------------------------------------------------------------------------
// 0. The shared order collector (tests/helpers.ts)
// ---------------------------------------------------------------------------

describe('collectOrderViolations — the shared order collector', () => {
  const RULE: OrderRule = { label: 'a before b', before: 'ALPHA', after: 'BRAVO' }

  it('reports nothing for a text in which each anchor occurs once and in order', () => {
    expect(collectOrderViolations('clean.md', 'x\nALPHA\ny\nBRAVO\n', [RULE])).toEqual([])
  })

  it('known-bad probe: a swapped pair yields exactly one violation', () => {
    const found = collectOrderViolations('swapped.md', 'BRAVO\nALPHA\n', [RULE])
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('swapped.md')
    expect(found[0]).toContain(RULE.label)
  })

  it('known-bad probe: a missing anchor yields exactly one violation, not a pass', () => {
    const found = collectOrderViolations('missing.md', 'ALPHA only\n', [RULE])
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('BRAVO')
  })

  it('known-bad probe: a duplicated anchor is ambiguity, reported as exactly one violation', () => {
    // A first-match reading would pass this text — the first ALPHA precedes BRAVO —
    // while the second ALPHA, after it, is the one a reader may follow.
    const found = collectOrderViolations('duplicated.md', 'ALPHA\nBRAVO\nALPHA\n', [RULE])
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('ALPHA')
  })

  it('refuses an empty anchor rather than matching it everywhere', () => {
    const found = collectOrderViolations('empty.md', 'ALPHA\n', [{ label: 'empty', before: '', after: 'ALPHA' }])
    expect(found, found.join('\n')).toHaveLength(1)
  })

  it('checks every rule, each on its own', () => {
    const rules: OrderRule[] = [RULE, { label: 'c before d', before: 'CHARLIE', after: 'DELTA' }]
    const found = collectOrderViolations('two.md', 'ALPHA\nBRAVO\nDELTA\nCHARLIE\n', rules)
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('c before d')
  })
})
