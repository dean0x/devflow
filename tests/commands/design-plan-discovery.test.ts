/**
 * D-DESIGN-PLAN-DISCOVERY — `/code-review` and `/bug-analysis` read the newest plan for the work
 * under review, and a plan is either a `/plan` artifact (`design/{name}.{ts}.md`) or one of the
 * per-ticket plans `/dynamic-plan` writes (`design/{slug}/{ts}/{ticket-slug}-plan.md`).
 *
 * Both commands listed only `design/*.md`, so a per-ticket plan was never found, and they sorted
 * "by filename" although a `/plan` artifact's name starts with its issue ID, not its timestamp. Each
 * now lists both layouts, sorts by the timestamp each layout carries, scans the ten newest, and lets
 * a per-ticket plan count only when its ticket slug appears in the branch name, so another ticket's
 * acceptance criteria are never read as this branch's.
 *
 * The globs are checked against the layout `/dynamic-plan` and `/plan` actually write, taken from
 * their compiled text, so a layout change on either side fails here.
 */

import { describe, it, expect } from 'vitest'

import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile } from '../helpers.js'

const FLAT_GLOB = '.devflow/docs/design/*.md'
const TICKET_GLOB = '.devflow/docs/design/*/*/*-plan.md'

const READERS = [
  { command: 'code-review.md', readRule: 'Read the most recent file that carries the section, extract `## PR Description Guidance` section' },
  { command: 'bug-analysis.md', readRule: 'Read the most recent file that carries an `## Acceptance Criteria` section' },
] as const

/** A glob of `*` segments as an anchored regex: `*` is any run of non-slash characters. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

/** Named collector: what a reader's plan-discovery step fails to say. */
export function collectDiscoveryDefects(label: string, text: string, readRule: string): string[] {
  const out: string[] = []
  if (!text.includes(`{worktree}/${FLAT_GLOB}\``)) out.push(`${label}: does not list the /plan artifacts (${FLAT_GLOB})`)
  if (!text.includes(`{worktree}/${TICKET_GLOB}\``)) out.push(`${label}: does not list the /dynamic-plan per-ticket plans (${TICKET_GLOB})`)
  if (!text.includes('Sort by timestamp, newest first, and scan the 10 most recent')) out.push(`${label}: does not bound the listing to the 10 newest`)
  if (!text.includes('Never sort by file name')) out.push(`${label}: may sort by file name`)
  if (!text.includes("A per-ticket plan counts only when its `{ticket-slug}` (its file name without `-plan.md`) appears in the worktree's branch name")) {
    out.push(`${label}: lets a per-ticket plan of another ticket count`)
  }
  if (!text.includes(readRule)) out.push(`${label}: does not skip a newer plan that lacks its section`)
  return out
}

describe('/code-review and /bug-analysis find /plan artifacts and /dynamic-plan per-ticket plans', () => {
  for (const { command, readRule } of READERS) {
    it(`${command} lists both layouts, newest first, bounded`, () => {
      expect(collectDiscoveryDefects(command, requireDistFile(command), readRule)).toEqual([])
    })
  }

  it('known-bad probe: the flat-only listing is reported', () => {
    const flatOnly = requireDistFile('code-review.md')
      .replace(`\`{worktree}/${TICKET_GLOB}\``, '`nothing`')
      .replace('Never sort by file name', 'Sort by file name')
    expect(collectDiscoveryDefects('code-review.md', flatOnly, READERS[0].readRule)).toEqual([
      `code-review.md: does not list the /dynamic-plan per-ticket plans (${TICKET_GLOB})`,
      'code-review.md: may sort by file name',
    ])
  })
})

describe('the globs match the layouts the writers produce, and only those', () => {
  const dynamicPlan = requireDistFile('dynamic-plan.md')
  const plan = requireDistFile('plan.md')

  it('/dynamic-plan writes design/{slug}/{ts}/{ticket-slug}-plan.md and DECISIONS-NEEDED.md', () => {
    expect(dynamicPlan).toContain('const OUTDIR = `${ROOT}/.devflow/docs/design/${slug}/${ts}`;')
    expect(dynamicPlan).toContain('{ticket-slug}-plan.md')
    expect(dynamicPlan).toContain('DECISIONS-NEEDED.md')
  })

  it('the per-ticket glob matches a plan in a run folder and nothing else /dynamic-plan writes', () => {
    const ticket = globToRegExp(TICKET_GLOB)
    expect(ticket.test('.devflow/docs/design/wave/2026-04-07_0905/add-login-plan.md')).toBe(true)
    expect(ticket.test('.devflow/docs/design/wave/2026-04-07_0905/DECISIONS-NEEDED.md')).toBe(false)
    expect(ticket.test('.devflow/docs/design/42-jwt-auth.2026-04-07_1430.md'), 'a /plan artifact').toBe(false)
  })

  it('the flat glob matches the three /plan names and no per-ticket plan', () => {
    const flat = globToRegExp(FLAT_GLOB)
    for (const name of ['42-jwt-auth.2026-04-07_1430.md', 'multi-jwt-auth.2026-04-07_1430.md', 'jwt-auth.2026-04-07_1430.md']) {
      expect(flat.test(`.devflow/docs/design/${name}`), name).toBe(true)
    }
    expect(flat.test('.devflow/docs/design/wave/2026-04-07_0905/add-login-plan.md')).toBe(false)
    expect(plan, '/plan still writes those three names').toContain('{ISSUE_ID}-{topic-slug}.{YYYY-MM-DD_HHMM}.md')
  })

  it('the skill says why a listing sorts by the stamp: a /plan artifact\'s name starts with its issue ID', () => {
    const skill = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'docs-framework', 'SKILL.md'), 'utf-8')
    expect(skill).toContain('so a listing sorts by that suffix, not by the leading `{ISSUE_ID}`')
  })
})
