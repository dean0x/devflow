/**
 * Report caps on the built-in spawns the commands write as prose.
 *
 * D-CHARTER-BOUNDED-INLINE. The orchestrator charter asks every direct
 * delegation for a final report of bounded size, so a delegated result does not
 * flood the main thread. The commands spawn built-in Explore and Plan agents the
 * same way — as prose in the command ("spawn 4 Explore agents"), not as a
 * roster `Agent(subagent_type=…)` line a template could cap once — so each spawn
 * instruction carries its own cap, with a token figure: "at most about 1,500
 * tokens". A cap with no figure ("keep it short") bounds nothing.
 *
 * Counted in the COMPILED commands, because that is what the model reads:
 *   - explore: the Phase 3 explorers                             (at least 1)
 *   - debug:   the three Phase 3 investigator payloads, and the
 *              Phase 4 confirmation explorers                     (at least 4)
 *   - plan:    Phase 3 and Phase 8 (Explore) and Phase 10 (Plan)  (at least 3)
 *
 * The roster agents' own `## Output` caps belong to the agent execution doctrine
 * and are not counted here.
 *
 * Deterministic code counts a shape and makes no judgment: a figure after
 * "at most", "under" or "no more than", followed by "tokens". Every assertion
 * runs through the named collector, and the known-bad probes drive that same
 * collector, so one that silently counted nothing cannot make the guard pass.
 */

import { describe, it, expect } from 'vitest'

import { readFileSync } from 'fs'
import * as path from 'path'

import { requireDistFile } from '../helpers.js'

const CHARTER_PATH = path.resolve(
  import.meta.dirname, '..', '..', 'src', 'assets', 'scripts', 'hooks', 'assets', 'orchestrator-charter.md',
)

/** A cap with a token figure: "at most about 1,500 tokens", "under 2000 tokens", "no more than 1,500 tokens". */
const CAP_WORDING = /\b(?:at most|under|no more than)\s+(?:about\s+)?(\d[\d,]*)\s+tokens\b/gi

/** The fewest cap sites each compiled command must carry. */
const REQUIRED_CAPS: Readonly<Record<string, number>> = {
  explore: 1,
  debug: 4,
  plan: 3,
}

/** Named collector: how many report caps with a token figure a body carries. */
export function countReportCaps(body: string): number {
  return (body.match(CAP_WORDING) ?? []).length
}

/** Named collector: the commands that carry fewer caps than they must. */
export function collectReportCapShortfalls(bodies: ReadonlyMap<string, string>): string[] {
  const shortfalls: string[] = []
  for (const [command, required] of Object.entries(REQUIRED_CAPS)) {
    const body = bodies.get(command)
    if (body === undefined) {
      shortfalls.push(`${command}.md is absent from the corpus`)
      continue
    }
    const found = countReportCaps(body)
    if (found < required) {
      shortfalls.push(`${command}.md carries ${found} report cap(s) with a token figure; ${required} required`)
    }
  }
  return shortfalls
}

function readCompiled(): Map<string, string> {
  return new Map(Object.keys(REQUIRED_CAPS).map(command => [command, requireDistFile(`${command}.md`)]))
}

describe('report caps on built-in Explore and Plan spawns (D-CHARTER-BOUNDED-INLINE)', () => {
  it('explore, debug and plan each carry their report caps with a token figure', () => {
    const shortfalls = collectReportCapShortfalls(readCompiled())
    expect(shortfalls, `Report-cap shortfalls:\n  ${shortfalls.join('\n  ')}`).toEqual([])
  })

  it('every command cap states the figure the orchestrator charter states, so the two never drift apart', () => {
    const figuresIn = (body: string): string[] => [...body.matchAll(CAP_WORDING)].map(match => match[1])
    const charterFigures = [...new Set(figuresIn(readFileSync(CHARTER_PATH, 'utf-8')))]
    expect(charterFigures, 'the charter states exactly one cap figure').toHaveLength(1)

    for (const [command, body] of readCompiled()) {
      expect([...new Set(figuresIn(body))], `${command}.md states the charter's figure and no other`).toEqual(charterFigures)
    }
  })

  it('known-bad probe: a command short of its caps is reported', () => {
    const real = readCompiled()
    expect(collectReportCapShortfalls(real), 'the real corpus is clean, so each seed fails for its own reason').toEqual([])

    const stripped = new Map(real)
    stripped.set('debug', real.get('debug')!.replace(CAP_WORDING, 'a short report'))
    expect(collectReportCapShortfalls(stripped)).toEqual([
      `debug.md carries 0 report cap(s) with a token figure; ${REQUIRED_CAPS.debug} required`,
    ])

    const missing = new Map(real)
    missing.delete('plan')
    expect(collectReportCapShortfalls(missing)).toEqual(['plan.md is absent from the corpus'])
  })

  it('known-bad probe: wording without a token figure is not a cap', () => {
    expect(countReportCaps('Keep each report short.')).toBe(0)
    expect(countReportCaps('Return a report of at most a page.')).toBe(0)
    expect(countReportCaps('The call is retried under 5 minutes.')).toBe(0)
    expect(countReportCaps('A report of at most about 1,500 tokens.')).toBe(1)
    expect(countReportCaps('Under 2000 tokens; no more than 1,500 tokens.')).toBe(2)
  })
})
