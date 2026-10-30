/**
 * /implement and /resolve spawn fences at `full` (#480, part of epic #468).
 *
 * `/implement` and `/resolve` read `GATE_LEVEL` and apply the rows of a level reference at `standard` and `lean`.
 * At `full` they read no reference and run as written. This file holds the claim that a change to either command
 * leaves every fenced `Agent(` spawn as it was: the sha256 of each such fence, in both builds of both commands, as
 * last pinned. A fence that is added, removed or edited by one character fails here, and the failure names the file,
 * the phase heading and the agent type.
 *
 * Scope: fenced spawns only. A spawn written in prose is not covered.
 *
 * One more arm covers the text between two spawns (#483): the `full` re-check loop of /implement Phase 5. A fence digest
 * does not see it, because the loop is prose. `collectFullLoopDefects` holds each of its lines once, in this order, in both builds.
 *
 * A change that edits a fence on purpose repins only that fence: run the repin case and apply what it prints to
 * `PINNED_FENCES`. It prints only the rows that changed or were added, to paste over the row with the same heading,
 * agent type and ordinal, and a `gone` line for each pinned row that has no fence, to delete. It writes no file.
 */

import { createHash } from 'crypto'
import { describe, it, expect } from 'vitest'

import { isAgentBlock, parseFences, requireDistFile, resolveCurationOffSource } from '../helpers.js'
import { FULL_LOOP_LINES, countOf, headingSection } from './level-guard-helpers.js'

const REPIN_COMMAND = 'REPIN_FENCES=1 npx vitest run tests/guards/implement-resolve-full-fences.test.ts --reporter=verbose'

/** One pinned fence: the nearest heading above it, its agent type(s), its ordinal under that heading and agent type, and the sha256 of the fence text. */
type PinnedFence = readonly [heading: string, agent: string, ordinal: number, sha256: string]

/** The four compiled files, by the label that every failure names. */
const FILES: ReadonlyArray<{ readonly label: string; readonly text: string }> = (() => {
  const off = (name: string): string => {
    const text = resolveCurationOffSource('commands', name)
    if (text === null) throw new Error(`dist/curation-off/commands/${name}.md is absent: run \`npm run build:mds\``)
    return text
  }
  return [
    { label: 'dist/commands/implement.md', text: requireDistFile('implement.md') },
    { label: 'dist/commands/resolve.md', text: requireDistFile('resolve.md') },
    { label: 'dist/curation-off/commands/implement.md', text: off('implement') },
    { label: 'dist/curation-off/commands/resolve.md', text: off('resolve') },
  ]
})()

/** The fence table of the four compiled files as last pinned, from the parser below. */
const PINNED_FENCES: Readonly<Record<string, readonly PinnedFence[]>> = {
  'dist/commands/implement.md': [
    ['Phase 1: Setup', 'Git', 1, '033d80248ba18ac74cff5a6ced902d0d04ebdf935379ae0ca3af85a89082354d'],
    ['Phase 2: Implement', 'Code', 1, 'fc704f621c8539988374e5a960bbb4df4f18e3916bc51e9026d9c43e22c307bf'],
    ['Phase 2: Implement', 'Code', 2, 'd0a3e9c10060de74f1fdd4ddb26155e66174f1562db049fc314641874085435d'],
    ['Phase 2: Implement', 'Code', 3, 'ea8f5541eb1425774cfb6e93dddd0d479706a709433baaf55c7bedfa2fe3af6a'],
    ['Phase 2: Implement', 'Code+Code', 1, 'ff6da2197ddbfb76fb6bb683f3811b13598b62d929d25f18e1924a8f7e6c2b66'],
    ['Phase 3: Polish', 'Polish', 1, '6ed165778357a4b2b4bbeaf9479e56d91b79b369ca33ff560c727b192f3fa5b8'],
    ['Phase 4: Self-Review', 'Harden', 1, 'd533372443a11f48949c764683ebd1d4cd9a75e0a625356d7d4009fec3c9edc7'],
    ['Phase 5: Alignment Check', 'Evaluate', 1, 'd8f8f3b31e8f5655feec153480c30c8a716f3928fcc56758a031643981c00d11'],
    ['Phase 5: Alignment Check', 'Fix', 1, '274c2085a90711493eb4ff34fb3ec925b683f3aded4fad7a253d5038811fc17c'],
    ['Phase 6: Validate', 'Validate', 1, 'ff73c33d68b52ecd8fc8379e16ef21eb616a9f491ccea7ba9398439b584e8c7e'],
    ['Phase 6: Validate', 'Fix', 1, 'fd53825261f6a8dde6a7e4652813cbc5fce3cf8e7eb08341cfeaf350e6f7363a'],
    ['Phase 7: QA Testing', 'Test', 1, '0f0537b04b80bdfbb02cbd600913671cabdc585f665ca7274bcaa6a8d423db55'],
    ['Phase 7: QA Testing', 'Fix', 1, 'ba216845d64d63e6090c291de4fc7c7177f5746b19b6a0c8c7080039da6c065c'],
    ['Phase 8: Re-Validate (only if a qa-fix committed)', 'Validate', 1, '9d7f60de6e0cfcf226626d8008ad9176948af3e707ba694fafc6505fec1d218f'],
    ['Phase 9: Open PR', 'Git', 1, 'd9b060ad4ecafcec9f7a4b1f6d132a5c7def17ff761905c5c79f98b263951b41'],
  ],
  'dist/commands/resolve.md': [
    ['Step 0b: Per-Worktree Pre-Flight (Git Agent)', 'Git', 1, '3427a65881118757c983e02f39a1bea9024603a96bc39175640f4fe1dc9811bd'],
    ['Phase 1b: Fetch External Review Threads', 'Git', 1, 'b3a3328a3ae352dc08637c75088dfe6fff4d2f94d1bdd29cda71eba29cb12f71'],
    ['Phase 2: Global Triage', 'Triage', 1, '1d14563888ec80b5b9daa508b7b7231de4a5730831c4a055d1b09b657ddf4de1'],
    ['Phase 4: Fix (Code agent × N)', 'Code', 1, '00da930cec5a6925acc2454d122264faee44fabc998bacc1146458bc7e16eb35'],
    ['Phase 6: Polish', 'Polish', 1, '91b9fa0a27affb8358861e0571be27ff2ee4e59b4ba8379814d860ed95329da3'],
    ['Phase 7: Verification Gate', 'Validate', 1, '32626e7d0678f9248c8f25d7f84a49c9edbe2e59c20ecb094b3d15b64bdffb6d'],
    ['Phase 7: Verification Gate', 'Fix', 1, 'e1fe8256d1d5b2d473356cbd502b08e1b50d02ba83ca865d0f90f7d7defd9e75'],
    ['Phase 9: Manage Debt (Sequential)', 'Git', 1, '38b86ec3b8fa43f83f87545a75cbbba072e742cd29b17fbf3065e6512afd8a73'],
    ['Phase 9b: Thread Resolution + Resolution Comment', 'Test', 1, '267256e3fc1b92c572e969abaac3275184020f0508c95ffe25bc53fde28d4e2a'],
    ['Phase 9b: Thread Resolution + Resolution Comment', 'Git', 1, '87cc9e0dd74f4a2097179992b522e3f7ce806ab39b73ca5ca9bac8ee3fb95cc5'],
    ['Phase 9b: Thread Resolution + Resolution Comment', 'Git', 2, '5a032e03562856fb39f3d6f0e87621521e4029c39b863cf10b621337f668759d'],
  ],
  'dist/curation-off/commands/implement.md': [
    ['Phase 1: Setup', 'Git', 1, '033d80248ba18ac74cff5a6ced902d0d04ebdf935379ae0ca3af85a89082354d'],
    ['Phase 2: Implement', 'Code', 1, 'f6d58a82751a6497a28141aa942a8b0397582566eccacfcc32f01c6274f57f36'],
    ['Phase 2: Implement', 'Code', 2, '4beef149677f73ac9f2de73ece65577b1a790970eff0ebf14b8ec6c069aa194e'],
    ['Phase 2: Implement', 'Code', 3, '379eb9289603fe97c0c9ea13f3822141e93267a00e24b81cf3e5ae57e30fbdbb'],
    ['Phase 2: Implement', 'Code+Code', 1, 'e1baf116af33fb9fe0e042f7fde009d18a4fe1d4dc69b95a6ab2c29bc7591761'],
    ['Phase 3: Polish', 'Polish', 1, '6ed165778357a4b2b4bbeaf9479e56d91b79b369ca33ff560c727b192f3fa5b8'],
    ['Phase 4: Self-Review', 'Harden', 1, '9d19e2cdd8085578d36c93dc74ba243efdb4a5c062ead728008ac67af1c61de8'],
    ['Phase 5: Alignment Check', 'Evaluate', 1, 'd8f8f3b31e8f5655feec153480c30c8a716f3928fcc56758a031643981c00d11'],
    ['Phase 5: Alignment Check', 'Fix', 1, 'a2478b9a395894b60c529d1cd0933d3af15d4a0cb28cd37bc8608ea3751a2163'],
    ['Phase 6: Validate', 'Validate', 1, 'ff73c33d68b52ecd8fc8379e16ef21eb616a9f491ccea7ba9398439b584e8c7e'],
    ['Phase 6: Validate', 'Fix', 1, '5bcec7eb869c856b9aeb561132729b31fe1f25643cda222d101653096c935aec'],
    ['Phase 7: QA Testing', 'Test', 1, '0f0537b04b80bdfbb02cbd600913671cabdc585f665ca7274bcaa6a8d423db55'],
    ['Phase 7: QA Testing', 'Fix', 1, 'dcc10ca1774583fd086a8daf5ccf8a10c82fb09af7d1542eaaee85423171940a'],
    ['Phase 8: Re-Validate (only if a qa-fix committed)', 'Validate', 1, '9d7f60de6e0cfcf226626d8008ad9176948af3e707ba694fafc6505fec1d218f'],
    ['Phase 9: Open PR', 'Git', 1, 'd9b060ad4ecafcec9f7a4b1f6d132a5c7def17ff761905c5c79f98b263951b41'],
  ],
  'dist/curation-off/commands/resolve.md': [
    ['Step 0b: Per-Worktree Pre-Flight (Git Agent)', 'Git', 1, '3427a65881118757c983e02f39a1bea9024603a96bc39175640f4fe1dc9811bd'],
    ['Phase 1b: Fetch External Review Threads', 'Git', 1, 'b3a3328a3ae352dc08637c75088dfe6fff4d2f94d1bdd29cda71eba29cb12f71'],
    ['Phase 2: Global Triage', 'Triage', 1, 'ac02513f3dbd49a8765e586eb85fc655efd82e25d1e60be640b9d39b7a1d990c'],
    ['Phase 4: Fix (Code agent × N)', 'Code', 1, 'b6dfb4a1c640e304eb5b4477694ea9f46789e7fe8a51f275aed09a256b40c887'],
    ['Phase 6: Polish', 'Polish', 1, '91b9fa0a27affb8358861e0571be27ff2ee4e59b4ba8379814d860ed95329da3'],
    ['Phase 7: Verification Gate', 'Validate', 1, '32626e7d0678f9248c8f25d7f84a49c9edbe2e59c20ecb094b3d15b64bdffb6d'],
    ['Phase 7: Verification Gate', 'Fix', 1, 'bbd779426a35c58b4a736587a137408a1ebb1f19ed4061855cc5ffa74488f63c'],
    ['Phase 9: Manage Debt (Sequential)', 'Git', 1, '38b86ec3b8fa43f83f87545a75cbbba072e742cd29b17fbf3065e6512afd8a73'],
    ['Phase 9b: Thread Resolution + Resolution Comment', 'Test', 1, '267256e3fc1b92c572e969abaac3275184020f0508c95ffe25bc53fde28d4e2a'],
    ['Phase 9b: Thread Resolution + Resolution Comment', 'Git', 1, '87cc9e0dd74f4a2097179992b522e3f7ce806ab39b73ca5ca9bac8ee3fb95cc5'],
    ['Phase 9b: Thread Resolution + Resolution Comment', 'Git', 2, '5a032e03562856fb39f3d6f0e87621521e4029c39b863cf10b621337f668759d'],
  ],
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** One spawn fence of a compiled command, with the key that pins it. */
interface SpawnFence {
  readonly heading: string
  readonly agent: string
  readonly ordinal: number
  readonly fence: string
}

/** The agent types that a fence spawns, in order: `Agent(subagent_type="X"` and `agentType: "X"`, each confirmed by `isAgentBlock`. */
function spawnTypes(fence: string): string[] {
  const found = [...fence.matchAll(/Agent\(subagent_type="([^"]+)"|agentType:\s*"([^"]+)"/g)].map(m => m[1] ?? m[2])
  return found.filter(type => isAgentBlock(fence, type))
}

/**
 * Every fence that spawns an agent, in order. The key of a fence is the nearest heading above it (a heading inside
 * a fence is text), its agent types joined by `+`, and its ordinal among the fences with that heading and those types.
 */
export function collectSpawnFences(text: string): { fences: SpawnFence[]; unreadable: string[] } {
  const all = parseFences(text)
  const ranges: Array<{ start: number; end: number; fence: string }> = []
  let cursor = 0
  for (const fence of all) {
    const start = text.indexOf(fence, cursor)
    ranges.push({ start, end: start + fence.length, fence })
    cursor = start + fence.length
  }
  const headings = [...text.matchAll(/^#{1,6} (.*)$/gm)]
    .filter(h => !ranges.some(r => (h.index ?? 0) >= r.start && (h.index ?? 0) < r.end))
    .map(h => ({ at: h.index ?? 0, text: h[1] }))
  const seen = new Map<string, number>()
  const fences: SpawnFence[] = []
  const unreadable: string[] = []
  for (const r of ranges) {
    const types = spawnTypes(r.fence)
    const heading = headings.filter(h => h.at < r.start).pop()?.text ?? '(no heading)'
    if (types.length === 0) {
      if (r.fence.includes('Agent(')) unreadable.push(`a fence under "${heading}" holds "Agent(" with no subagent_type`)
      continue
    }
    const agent = types.join('+')
    const key = `${heading}\u0000${agent}`
    const ordinal = (seen.get(key) ?? 0) + 1
    seen.set(key, ordinal)
    fences.push({ heading, agent, ordinal, fence: r.fence })
  }
  return { fences, unreadable }
}

/** The map key of a fence: heading, agent type and ordinal, joined by NUL. */
const keyOf = (heading: string, agent: string, ordinal: number): string => `${heading}\u0000${agent}\u0000${ordinal}`

const where = (heading: string, agent: string, ordinal: number): string => `"${heading}", ${agent} #${ordinal}`

/** One way that a compiled file differs from its pinned table. */
type FenceChange =
  | { readonly kind: 'changed'; readonly fence: SpawnFence; readonly expected: string; readonly actual: string }
  | { readonly kind: 'added'; readonly fence: SpawnFence; readonly actual: string }
  | { readonly kind: 'gone'; readonly pinned: PinnedFence }

/** What differs between the pinned table and the fences of one compiled file: the fences that changed or were added, in order, then the pinned rows that have no fence. The one diff, for the guard and the repin printer. */
function diffFences(text: string, pinned: readonly PinnedFence[]): { unreadable: string[]; changes: FenceChange[] } {
  const { fences, unreadable } = collectSpawnFences(text)
  const want = new Map(pinned.map(([heading, agent, ordinal, digest]) => [keyOf(heading, agent, ordinal), digest] as const))
  const got = new Set(fences.map(f => keyOf(f.heading, f.agent, f.ordinal)))
  const changes: FenceChange[] = []
  for (const fence of fences) {
    const expected = want.get(keyOf(fence.heading, fence.agent, fence.ordinal))
    const actual = sha256(fence.fence)
    if (expected === undefined) changes.push({ kind: 'added', fence, actual })
    else if (expected !== actual) changes.push({ kind: 'changed', fence, expected, actual })
  }
  for (const row of pinned) {
    if (!got.has(keyOf(row[0], row[1], row[2]))) changes.push({ kind: 'gone', pinned: row })
  }
  return { unreadable, changes }
}

/** What differs between the pinned table and the fences of one compiled file. Each defect ends with the repin command. */
export function collectFenceDigestDefects(label: string, text: string, pinned: readonly PinnedFence[]): string[] {
  const { unreadable, changes } = diffFences(text, pinned)
  const end = ` Repin: ${REPIN_COMMAND}`
  return [
    ...unreadable.map(line => `${label}: ${line}.${end}`),
    ...changes.map(change => {
      switch (change.kind) {
        case 'added': return `${label}: a fence was added under ${where(change.fence.heading, change.fence.agent, change.fence.ordinal)}: ${change.actual}.${end}`
        case 'changed': return `${label}: the fence under ${where(change.fence.heading, change.fence.agent, change.fence.ordinal)} changed: expected ${change.expected}, actual ${change.actual}.${end}`
        case 'gone': return `${label}: the fence under ${where(change.pinned[0], change.pinned[1], change.pinned[2])} is gone.${end}`
      }
    }),
  ]
}

/** A row key as source text. The heading is quoted with `JSON.stringify`, so an apostrophe in it stays valid TypeScript. */
const keyText = (heading: string, agent: string, ordinal: number): string => `${JSON.stringify(heading)}, '${agent}', ${ordinal}`

/**
 * The repin lines of one compiled file: a row to paste for each fence that changed or was added, and a `gone` line for
 * each pinned row that has no fence. A fence that holds `Agent(` with no type has no row, so it gets an `unreadable`
 * line. A table that is current gives no line.
 */
export function collectRepinLines(text: string, pinned: readonly PinnedFence[]): string[] {
  const { unreadable, changes } = diffFences(text, pinned)
  return [
    ...unreadable.map(line => `    // unreadable: ${line}`),
    ...changes.map(change => {
      switch (change.kind) {
        case 'added':
        case 'changed': return `    [${keyText(change.fence.heading, change.fence.agent, change.fence.ordinal)}, '${change.actual}'],`
        case 'gone': return `    // gone: [${keyText(change.pinned[0], change.pinned[1], change.pinned[2])}]`
      }
    }),
  ]
}

const REPIN_CURRENT = 'PINNED_FENCES is current: no fence changed, was added or is gone.'

/** The repin report for the compiled files: the lines of each file that differs under its label, or one line when every file is current. */
export function repinReport(files: ReadonlyArray<{ readonly label: string; readonly text: string }>, pinned: Readonly<Record<string, readonly PinnedFence[]>>): string {
  const parts = files.flatMap(({ label, text }) => {
    const lines = collectRepinLines(text, pinned[label])
    return lines.length === 0 ? [] : [`  '${label}':`, ...lines]
  })
  return parts.length === 0 ? REPIN_CURRENT : parts.join('\n')
}

/** Replace `from` with `to` in `text`, failing the test when the seed did not land. */
function seed(text: string, from: string, to: string): string {
  const next = text.replace(from, () => to)
  expect(next, `the seed "${from.slice(0, 40)}" must change the text`).not.toBe(text)
  return next
}

/** The spawn fence of `agent` under `heading` in `text`, failing the test when there is none. */
function fenceOf(text: string, heading: string, agent: string): string {
  const found = collectSpawnFences(text).fences.find(f => f.heading === heading && f.agent === agent)
  expect(found, `a ${agent} fence under "${heading}"`).toBeDefined()
  return (found as SpawnFence).fence
}

const PHASE_5_HEADING = '### Phase 5: Alignment Check'

/** The lines of the Phase 5 section of a compiled /implement, trimmed, up to the next `### ` heading; null when the heading is absent or repeated. */
function phase5Lines(body: string): string[] | null {
  const section = countOf(body, `\n${PHASE_5_HEADING}\n`) === 1 ? headingSection(body, PHASE_5_HEADING, '### ') : null
  return section === null ? null : section.split('\n').slice(1).map(line => line.trim())
}

/** Named collector (AC-3 of #483): each line of the `full` re-check loop appears exactly once in Phase 5 of the compiled /implement, and the lines follow the order of `FULL_LOOP_LINES`. */
export function collectFullLoopDefects(body: string): string[] {
  const section = phase5Lines(body)
  if (section === null) return [`"${PHASE_5_HEADING}" is absent or repeated`]
  const presence = FULL_LOOP_LINES.flatMap(line => {
    const held = section.filter(l => l === line).length
    return held === 1 ? [] : [`Phase 5 holds the line "${line}" ${held} times, expected 1`]
  })
  if (presence.length > 0) return presence
  const at = FULL_LOOP_LINES.map(line => section.indexOf(line))
  return FULL_LOOP_LINES.flatMap((line, i) => (i > 0 && at[i] < at[i - 1] ? [`Phase 5 holds the line "${line}" before the line "${FULL_LOOP_LINES[i - 1]}", expected after`] : []))
}

describe('the corpus is real', () => {
  it('reads the four compiled files, each with spawn fences, and pins every one of them', () => {
    expect(FILES.map(f => f.label)).toEqual(Object.keys(PINNED_FENCES))
    for (const { label, text } of FILES) {
      expect(text.length, `${label}: nothing read`).toBeGreaterThan(5000)
      const { fences, unreadable } = collectSpawnFences(text)
      expect(fences.length, `${label}: no Agent( fence, so this guard proves nothing`).toBeGreaterThan(0)
      expect(unreadable, `${label}: a fence with Agent( and no type`).toEqual([])
      expect(PINNED_FENCES[label].length, `${label}: the pinned rows`).toBe(fences.length)
    }
  })
})

describe('every fenced Agent( spawn equals its pinned sha256 (AC-2)', () => {
  it.each(FILES)('$label: no fence is added, removed or edited', ({ label, text }) => {
    expect(collectFenceDigestDefects(label, text, PINNED_FENCES[label])).toEqual([])
  })

  it('known-bad probes: one edited character, one removed fence, a level line added to a Validate fence, an added fence and an agentType spawn are each reported with the heading and the agent type', () => {
    const [implement, resolve] = FILES
    const polish = fenceOf(implement.text, 'Phase 3: Polish', 'Polish')
    const edited = collectFenceDigestDefects(implement.label, seed(implement.text, polish, polish.replace('Polish recently', 'Polish recentlx')), PINNED_FENCES[implement.label])
    expect(edited, 'one defect').toHaveLength(1)
    expect(edited[0]).toMatch(/^dist\/commands\/implement\.md: the fence under "Phase 3: Polish", Polish #1 changed: expected [0-9a-f]{64}, actual [0-9a-f]{64}\./)
    expect(edited[0].endsWith(`Repin: ${REPIN_COMMAND}`), 'the failure ends with the repin command').toBe(true)

    const harden = fenceOf(implement.text, 'Phase 4: Self-Review', 'Harden')
    const removed = collectFenceDigestDefects(implement.label, seed(implement.text, harden, ''), PINNED_FENCES[implement.label])
    expect(removed).toEqual([`${implement.label}: the fence under "Phase 4: Self-Review", Harden #1 is gone. Repin: ${REPIN_COMMAND}`])

    const validate = fenceOf(resolve.text, 'Phase 7: Verification Gate', 'Validate')
    const leveled = collectFenceDigestDefects(resolve.label, seed(resolve.text, validate, validate.replace('"FILES_CHANGED:', '"GATE_LEVEL: {GATE_LEVEL}\nFILES_CHANGED:')), PINNED_FENCES[resolve.label])
    expect(leveled, 'one defect').toHaveLength(1)
    expect(leveled[0]).toMatch(/^dist\/commands\/resolve\.md: the fence under "Phase 7: Verification Gate", Validate #1 changed:/)

    const added = collectFenceDigestDefects(implement.label, seed(implement.text, '### Phase 12: Report\n', '### Phase 12: Report\n\n```\nAgent(subagent_type="Polish"):\n"x"\n```\n'), PINNED_FENCES[implement.label])
    expect(added).toHaveLength(1)
    expect(added[0]).toMatch(/a fence was added under "Phase 12: Report", Polish #1: [0-9a-f]{64}\./)

    const untyped = collectFenceDigestDefects(implement.label, seed(implement.text, '### Phase 12: Report\n', '### Phase 12: Report\n\n```\nAgent():\n"x"\n```\n'), PINNED_FENCES[implement.label])
    expect(untyped).toHaveLength(1)
    expect(untyped[0]).toMatch(/a fence under "Phase 12: Report" holds "Agent\(" with no subagent_type\./)

    const agentTyped = collectFenceDigestDefects(implement.label, seed(implement.text, '### Phase 12: Report\n', '### Phase 12: Report\n\n```\nagentType: "Polish"\n"x"\n```\n'), PINNED_FENCES[implement.label])
    expect(agentTyped, 'a fence that spawns with agentType is pinned too').toHaveLength(1)
    expect(agentTyped[0]).toMatch(/a fence was added under "Phase 12: Report", Polish #1: [0-9a-f]{64}\./)
  })

  it('a heading inside a fence is text, and a spawn in prose is not a fence', () => {
    const text = '### Phase 1: A\n\n```\n### Phase 9: not a heading\nAgent(subagent_type="Git"):\n"x"\n```\n\nSpawn Agent(subagent_type="Test") in prose.\n'
    const { fences } = collectSpawnFences(text)
    expect(fences.map(f => [f.heading, f.agent, f.ordinal])).toEqual([['Phase 1: A', 'Git', 1]])
  })

  it('known-bad probes: the repin report holds only the rows that changed or were added and a gone line for each removed row', () => {
    const [implement, resolve] = FILES
    expect(repinReport(FILES, PINNED_FENCES), 'every pin is current').toBe(REPIN_CURRENT)

    const polish = fenceOf(implement.text, 'Phase 3: Polish', 'Polish')
    const edited = polish.replace('Polish recently', 'Polish recentlx')
    expect(collectRepinLines(seed(implement.text, polish, edited), PINNED_FENCES[implement.label])).toEqual([`    ["Phase 3: Polish", 'Polish', 1, '${sha256(edited)}'],`])

    const harden = fenceOf(implement.text, 'Phase 4: Self-Review', 'Harden')
    expect(collectRepinLines(seed(implement.text, harden, ''), PINNED_FENCES[implement.label])).toEqual([`    // gone: ["Phase 4: Self-Review", 'Harden', 1]`])

    const quoted = collectRepinLines(seed(implement.text, '### Phase 12: Report\n', '### Phase 12: Don\'t Report\n\n```\nAgent(subagent_type="Polish"):\n"x"\n```\n'), PINNED_FENCES[implement.label])
    expect(quoted, 'one row').toHaveLength(1)
    expect(quoted[0]).toMatch(/^ {4}\["Phase 12: Don't Report", 'Polish', 1, '[0-9a-f]{64}'\],$/)

    const untyped = collectRepinLines(seed(implement.text, '### Phase 12: Report\n', '### Phase 12: Report\n\n```\nAgent():\n"x"\n```\n'), PINNED_FENCES[implement.label])
    expect(untyped).toEqual(['    // unreadable: a fence under "Phase 12: Report" holds "Agent(" with no subagent_type'])

    const report = repinReport([{ label: implement.label, text: seed(implement.text, polish, edited) }, { label: resolve.label, text: resolve.text }], PINNED_FENCES)
    expect(report).toBe(`  '${implement.label}':\n    ["Phase 3: Polish", 'Polish', 1, '${sha256(edited)}'],`)
  })

  it.skipIf(process.env.REPIN_FENCES !== '1')('prints the rows to repin in PINNED_FENCES (set REPIN_FENCES=1; writes no file)', () => {
    console.log(`\n${repinReport(FILES, PINNED_FENCES)}\n`)
  })
})

describe('the full-level Phase 5 re-check loop is as written (AC-3 of #483)', () => {
  const builds = FILES.filter(f => f.label.endsWith('/implement.md'))
  const LOOP_BACK = FULL_LOOP_LINES[2]

  it('reads both builds of /implement', () => {
    expect(builds.map(f => f.label)).toEqual(['dist/commands/implement.md', 'dist/curation-off/commands/implement.md'])
  })

  it.each(builds)('$label: Phase 5 holds the counter, the two-attempt test, the loop-back line and the user report once each', ({ text }) => {
    expect(collectFullLoopDefects(text)).toEqual([])
  })

  it.each(builds)('$label: known-bad probes: a changed cap, a removed loop-back line, a removed re-check, a renumbered report step, a repeated line, a moved line and a loop-back line below step 4 are each reported', ({ text }) => {
    const missing = (line: string): string[] => [`Phase 5 holds the line "${line}" 0 times, expected 1`]
    expect(collectFullLoopDefects(seed(text, FULL_LOOP_LINES[1], '3. If `alignment_fix_count <= 1`:')), 'cap changed from 2 to 1').toEqual(missing(FULL_LOOP_LINES[1]))
    expect(collectFullLoopDefects(seed(text, `   ${LOOP_BACK}\n`, '')), 'loop-back line removed').toEqual(missing(LOOP_BACK))
    expect(collectFullLoopDefects(seed(text, 'Loop back to Phase 5 (re-check alignment).', 'Loop back to Phase 5.')), '"(re-check alignment)" removed').toEqual(missing(LOOP_BACK))
    expect(collectFullLoopDefects(seed(text, FULL_LOOP_LINES[3], FULL_LOOP_LINES[3].replace('4.', '5.'))), 'step 4 renumbered').toEqual(missing(FULL_LOOP_LINES[3]))
    expect(collectFullLoopDefects(seed(text, FULL_LOOP_LINES[0], `${FULL_LOOP_LINES[0]}\n${FULL_LOOP_LINES[0]}`)), 'a repeated line').toEqual([`Phase 5 holds the line "${FULL_LOOP_LINES[0]}" 2 times, expected 1`])
    expect(collectFullLoopDefects(seed(seed(text, `   ${LOOP_BACK}\n`, ''), '### Phase 6: Validate', `### Phase 6: Validate\n\n${LOOP_BACK}`)), 'the line moved out of Phase 5').toEqual(missing(LOOP_BACK))
    expect(collectFullLoopDefects(seed(seed(text, `   ${LOOP_BACK}\n`, ''), FULL_LOOP_LINES[3], `${FULL_LOOP_LINES[3]}\n   ${LOOP_BACK}`)), 'the loop-back line below step 4').toEqual([`Phase 5 holds the line "${FULL_LOOP_LINES[3]}" before the line "${LOOP_BACK}", expected after`])
    expect(collectFullLoopDefects(seed(text, PHASE_5_HEADING, '### Phase 5: Check')), 'heading renamed').toEqual([`"${PHASE_5_HEADING}" is absent or repeated`])
  })
})
