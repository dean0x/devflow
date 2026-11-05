/**
 * D-DESIGN-PLAN-DISCOVERY — `/code-review` and `/bug-analysis` read the newest plan for the work
 * under review, and a plan is a `/plan` artifact (`design/{name}.{ts}.md`).
 *
 * Both commands list only `design/*.md`, sort by the timestamp the artifact name carries (its
 * name starts with its issue ID, not its timestamp) and scan the ten newest.
 *
 * The glob is checked against the layout `/plan` actually writes, taken from its compiled text, so
 * a layout change on either side fails here.
 */

import { describe, it, expect } from 'vitest'

import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile } from '../helpers.js'

const FLAT_GLOB = '.devflow/docs/design/*.md'

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
  if (/\.devflow\/docs\/design\/\*\/\*/.test(text)) out.push(`${label}: lists a nested design layout`)
  if (!text.includes('Sort by timestamp, newest first, and scan the 10 most recent')) out.push(`${label}: does not bound the listing to the 10 newest`)
  if (!text.includes('Never sort by file name')) out.push(`${label}: may sort by file name`)
  if (!text.includes(readRule)) out.push(`${label}: does not skip a newer plan that lacks its section`)
  return out
}

describe('/code-review and /bug-analysis find /plan artifacts', () => {
  for (const { command, readRule } of READERS) {
    it(`${command} lists the flat layout only, newest first, bounded`, () => {
      expect(collectDiscoveryDefects(command, requireDistFile(command), readRule)).toEqual([])
    })
  }

  it('known-bad probe: a nested listing and a file-name sort are reported', () => {
    const seeded = requireDistFile('code-review.md')
      .replace(`\`{worktree}/${FLAT_GLOB}\``, '`{worktree}/.devflow/docs/design/*/*/*-plan.md`')
      .replace('Never sort by file name', 'Sort by file name')
    expect(collectDiscoveryDefects('code-review.md', seeded, READERS[0].readRule)).toEqual([
      `code-review.md: does not list the /plan artifacts (${FLAT_GLOB})`,
      'code-review.md: lists a nested design layout',
      'code-review.md: may sort by file name',
    ])
  })
})

describe('the glob matches the layout the writer produces, and only that', () => {
  const plan = requireDistFile('plan.md')

  it('the flat glob matches the three /plan names and no nested plan', () => {
    const flat = globToRegExp(FLAT_GLOB)
    for (const name of ['42-jwt-auth.2026-04-07_1430.md', 'multi-jwt-auth.2026-04-07_1430.md', 'jwt-auth.2026-04-07_1430.md']) {
      expect(flat.test(`.devflow/docs/design/${name}`), name).toBe(true)
    }
    expect(flat.test('.devflow/docs/design/batch/2026-04-07_0905/add-login-plan.md')).toBe(false)
    expect(plan, '/plan still writes those three names').toContain('{ISSUE_ID}-{topic-slug}.{YYYY-MM-DD_HHMM}.md')
  })

  it('the skill says why a listing sorts by the stamp: a /plan artifact\'s name starts with its issue ID', () => {
    const skill = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'docs-framework', 'SKILL.md'), 'utf-8')
    expect(skill).toContain('so a listing sorts by that suffix, not by the leading `{ISSUE_ID}`')
  })
})
