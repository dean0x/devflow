/**
 * /research tells the user why its research narrowed to the codebase type.
 *
 * Phase 2 restricts the plan to `codebase` when WebSearch or WebFetch is missing. A user who asked a
 * web question and got a codebase-only answer must learn the reason, so the check says to tell them.
 * Every build of the command holds the same sentence once, in Phase 2.
 */

import { describe, it, expect } from 'vitest'

import { requireDistFile, resolveCurationOffSource } from '../helpers.js'

const TOOL_CHECK = '**Tool availability check**: If WebSearch/WebFetch are unavailable, restrict to `codebase` type only, telling the user why.'

/** Named collector: how a built /research falls short of the tool-availability sentence, once and inside Phase 2. */
export function collectToolCheckDefects(label: string, text: string): string[] {
  const count = text.split(TOOL_CHECK).length - 1
  if (count !== 1) return [`${label}: the tool-availability sentence appears ${count} times, expected once`]
  const phase2 = text.indexOf('### Phase 2: Requirements')
  const phase3 = text.indexOf('### Phase 3: Orient')
  const at = text.indexOf(TOOL_CHECK)
  return phase2 !== -1 && phase3 > phase2 && at > phase2 && at < phase3 ? [] : [`${label}: the sentence is not inside Phase 2`]
}

describe('/research tells the user why the type narrowed (tool-availability check)', () => {
  const builds: ReadonlyArray<readonly [string, string | null]> = [
    ['research (curation on)', requireDistFile('research.md')],
    ['research (curation off)', resolveCurationOffSource('commands', 'research')],
  ]

  it.each(builds)('%s holds the sentence once, in Phase 2', (label, text) => {
    expect(text, `${label}: the build is read`).not.toBeNull()
    expect(Buffer.byteLength(text as string), `${label}: the build is a whole command`).toBeGreaterThan(5_000)
    expect(collectToolCheckDefects(label, text as string)).toEqual([])
  })

  it('known-bad probes: the sentence without the reason, a doubled sentence and one outside Phase 2 are each reported', () => {
    const real = requireDistFile('research.md')
    const withoutReason = real.replace(', telling the user why.', '.')
    expect(withoutReason, 'the seed must land').not.toBe(real)
    expect(collectToolCheckDefects('r', withoutReason)).toEqual(['r: the tool-availability sentence appears 0 times, expected once'])
    const doubled = real.replace(TOOL_CHECK, `${TOOL_CHECK}\n\n${TOOL_CHECK}`)
    expect(collectToolCheckDefects('r', doubled)).toEqual(['r: the tool-availability sentence appears 2 times, expected once'])
    const moved = real.replace(`${TOOL_CHECK}\n\n`, '').replace('### Phase 3: Orient (Conditional)\n', `### Phase 3: Orient (Conditional)\n\n${TOOL_CHECK}\n`)
    expect(moved, 'the moved seed must land').not.toBe(real)
    expect(collectToolCheckDefects('r', moved)).toEqual(['r: the sentence is not inside Phase 2'])
  })
})
