import { describe, it, expect } from 'vitest'
import { loadFile, requireDistFile } from '../helpers.js'

// -------------------------------------------------------------------------
// Issue-reference vocabulary across the command layer (GAP-27 / GAP-47).
//
// Two two-sided pairs and the AC-2.10 byte-identity battery: the artifact name
// /plan writes against the name docs-framework records, the issue values /plan
// captures against the places that consume them, and the GitHub renderings that
// the neutral vocabulary expands to.
//
// Why two-sided: a writer-only guard stays green when the reader stops parsing
// the field the writer emits, and a reader-only guard stays green when the
// writer stops emitting it.
// -------------------------------------------------------------------------

const PLAN_MDS = loadFile('src/assets/commands/plan.mds')
const DOCS_FRAMEWORK = loadFile('src/assets/skills/docs-framework/SKILL.md')

// Deployed text — the assertion is about what ships, not about the source.
const PLAN_MD = requireDistFile('plan.md')
const RESOLVE_MD = requireDistFile('resolve.md')

// ── Named collectors ─────────────────────────────────────────────────────────

/** One named source in the corpus: a label for messages and the text itself. */
type NamedSource = readonly [label: string, source: string]

/**
 * Named collector: every offset at which `token` occurs in `source`.
 * Bounded — a corpus with more sites than MAX_SITES is one this scan no longer
 * understands, and is reported rather than silently truncated.
 */
function collectTokenSites(source: string, token: string): number[] {
  const MAX_SITES = 256
  const sites: number[] = []
  for (let at = source.indexOf(token); at !== -1; at = source.indexOf(token, at + token.length)) {
    if (sites.length >= MAX_SITES) {
      throw new Error(`more than ${MAX_SITES} sites for "${token}" — bound exceeded, scan aborted`)
    }
    sites.push(at)
  }
  return sites
}

describe('artifact naming — plan.mds writer ↔ docs-framework reader', () => {
  it('both sides are non-vacuous', () => {
    expect(PLAN_MDS.length).toBeGreaterThan(1000)
    expect(DOCS_FRAMEWORK.length).toBeGreaterThan(1000)
  })

  it('both sides name the design artifact with {ISSUE_ID}', () => {
    expect(
      PLAN_MDS,
      'plan.mds writes the artifact; it must name the filesystem-safe identifier, not a rendered reference',
    ).toContain('{ISSUE_ID}-{topic-slug}')
    expect(
      DOCS_FRAMEWORK,
      'docs-framework records the naming convention; a stale {issue} there is a second, wrong authority',
    ).toContain('{ISSUE_ID}-{topic-slug}')
  })

  it('the retired {issue} token is gone from docs-framework', () => {
    expect(
      DOCS_FRAMEWORK,
      '{issue} is ambiguous between the rendered reference and the fs-safe id — the distinction §14.1 draws',
    ).not.toContain('{issue}-{topic-slug}')
  })

  it('the worked example is unchanged — the rename is provably a no-op on the github path', () => {
    expect(DOCS_FRAMEWORK).toContain('`42-jwt-auth.2026-04-07_1430.md`')
  })

  it('the multi-issue artifact is named from its topic slug with `issue: pending`, never from a batch-fetched ID (#331)', () => {
    expect(collectMultiIssueNamingDefects(PLAN_MDS)).toEqual([])
  })

  it('known-bad probe: the retired first-issue `{ISSUE_ID}-multi` name is reported', () => {
    const line = multiIssueLine(PLAN_MDS)!
    const retired = '- If multi-issue: `{worktree}/.devflow/docs/design/{ISSUE_ID}-multi.{YYYY-MM-DD_HHMM}.md`, using the first issue\'s `ISSUE_ID`'
    expect(collectMultiIssueNamingDefects(PLAN_MDS.replace(line, retired))).toEqual([
      'the multi-issue name is not multi-{topic-slug}.{ts}.md',
      'the multi-issue name does not set `issue: pending`',
      'the multi-issue name reads an ISSUE_ID, which fetch-issues-batch never returns',
    ])
    expect(collectMultiIssueNamingDefects('no naming here')).toEqual(['no multi-issue naming line'])
  })
})

/** The Phase 14 naming bullet for a multi-issue plan, as the source spells it. */
function multiIssueLine(source: string): string | undefined {
  return source.split('\n').find(l => l.startsWith('- If multi-issue: `{worktree}/.devflow/docs/design/'))
}

/**
 * Named collector (#331): how the multi-issue naming bullet still depends on an
 * ID. `fetch-issues-batch` returns no `ISSUE_ID` (its Handoff Values are `(none)`),
 * so a name built from "the first issue's ISSUE_ID" has nothing to build from.
 */
function collectMultiIssueNamingDefects(source: string): string[] {
  const line = multiIssueLine(source)
  if (line === undefined) return ['no multi-issue naming line']
  const defects: string[] = []
  if (!line.includes('`{worktree}/.devflow/docs/design/multi-{topic-slug}.{YYYY-MM-DD_HHMM}.md`')) {
    defects.push('the multi-issue name is not multi-{topic-slug}.{ts}.md')
  }
  if (!line.includes('`issue: pending`')) defects.push('the multi-issue name does not set `issue: pending`')
  if (line.includes('ISSUE_ID')) defects.push('the multi-issue name reads an ISSUE_ID, which fetch-issues-batch never returns')
  return defects
}

// ── #331: the issue-capture values /plan names have consumers ────────────────
//
// `issue_capture_contract()` tells /plan to capture ISSUE_CONTENT and
// ACCEPTANCE_CRITERIA; #331 found neither named again anywhere in the command,
// so the capture was dead. Each must be named where it is USED: at Gate 0, which
// it seeds, and in the design artifact, which it feeds.

/** The captured values that must each have a Gate 0 consumer and an artifact consumer. */
const CAPTURED_VALUES = ['ISSUE_CONTENT', 'ACCEPTANCE_CRITERIA'] as const

/** The partial's own lines, which name every value and consume none. */
const CAPTURE_CONTRACT_PREFIXES = [
  '**Capture from the Git agent\'s Output block',
  '**Which operation emits which value:**',
  'Note: `ISSUE_CONTENT` stays inside',
] as const

/** The lines of `text` from the first line starting with `start` up to (not including) the first after it starting with `end`. */
function region(text: string, start: string, end: string): string[] {
  const lines = text.split('\n')
  const from = lines.findIndex(l => l.startsWith(start))
  if (from === -1) return []
  const to = lines.findIndex((l, i) => i > from && l.startsWith(end))
  return lines.slice(from, to === -1 ? lines.length : to)
}

/** Named collector (#331): every captured value with no consumer at Gate 0 or in the artifact. */
function collectUnconsumedCaptures(planMd: string): string[] {
  const gate0 = region(planMd, '#### Phase 1: Gate 0', '#### Phase 2:')
    .filter(l => !CAPTURE_CONTRACT_PREFIXES.some(p => l.startsWith(p)))
  const artifact = region(planMd, '**Store design artifact:**', '**Check the test plan before the artifact exists:**')
  const out: string[] = []
  for (const value of CAPTURED_VALUES) {
    if (!gate0.some(l => l.includes(`\`${value}\``))) out.push(`${value}: no Gate 0 consumer`)
    if (!artifact.some(l => l.includes(`\`${value}\``))) out.push(`${value}: no artifact consumer`)
  }
  return out
}

describe('#331 — /plan consumes the issue values it captures', () => {
  it('ISSUE_CONTENT and ACCEPTANCE_CRITERIA each seed Gate 0 and feed the design artifact', () => {
    expect(region(PLAN_MD, '#### Phase 1: Gate 0', '#### Phase 2:').length, 'the Gate 0 region is found').toBeGreaterThan(10)
    expect(region(PLAN_MD, '**Store design artifact:**', '**Check the test plan').length, 'the artifact region is found').toBeGreaterThan(10)
    expect(collectUnconsumedCaptures(PLAN_MD)).toEqual([])
  })

  it('known-bad probe: a plan that names the values only in the capture contract is reported', () => {
    const deadCapture = PLAN_MD.split('\n')
      .filter(l => CAPTURE_CONTRACT_PREFIXES.some(p => l.startsWith(p)) || !CAPTURED_VALUES.some(v => l.includes(`\`${v}\``)))
      .join('\n')
    expect(deadCapture, 'the seed must drop the consumers').not.toBe(PLAN_MD)
    expect(collectUnconsumedCaptures(deadCapture)).toEqual([
      'ISSUE_CONTENT: no Gate 0 consumer',
      'ISSUE_CONTENT: no artifact consumer',
      'ACCEPTANCE_CRITERIA: no Gate 0 consumer',
      'ACCEPTANCE_CRITERIA: no artifact consumer',
    ])
  })
})

// ── AC-2.10: the github-path renderings are byte-identical ───────────────────
//
// The neutral vocabulary of the command layer never changes what a GitHub user
// sees. Each pin below names the literal a reader of the deployed artifact would
// find today, so a vocabulary edit that also changed the rendering goes red here
// rather than in a user's issue body.
//
// BYTE-IDENTICAL cannot be said by `toContain`: it is satisfied by a corpus that
// also renders the literal a second time, somewhere else, in a context nobody
// sanctioned. Each rendering is therefore pinned by OCCURRENCE-COUNT EQUALITY
// against the deployed file that owns it: exactly one site, no more and no fewer.

/** One AC-2.10 rendering: the literal, and every deployed corpus that must carry it exactly once. */
interface PinnedRendering {
  readonly label: string
  readonly literal: string
  readonly sources: readonly NamedSource[]
  /** The neutral-vocabulary sibling the rendering is the github expansion of. */
  readonly neutralIn?: readonly [NamedSource, string]
}

const AC_2_10_RENDERINGS: readonly PinnedRendering[] = [
  {
    label: '1/3 `Tracked = #{n}` in resolve.md',
    literal: 'Tracked = #{n}',
    sources: [['resolve.md', RESOLVE_MD]],
    neutralIn: [['resolve.md', RESOLVE_MD], 'Tracked = {ISSUE_REF}'],
  },
  {
    label: '2/3 `42-jwt-auth.{ts}.md` in docs-framework and plan.md',
    literal: '42-jwt-auth.2026-04-07_1430.md',
    // Two corpora: docs-framework RECORDS the convention, plan.md WRITES to it.
    // Pinning one and not the other lets writer and record drift apart silently.
    sources: [['docs-framework/SKILL.md', DOCS_FRAMEWORK], ['plan.md', PLAN_MD]],
  },
  {
    label: '3/3 `issue: 42` in plan.md',
    literal: 'issue: 42',
    sources: [['plan.md', PLAN_MD]],
  },
]

/** Named collector: `{corpus}: {n}` for every corpus that does not carry `literal` exactly once. */
function collectOffCountSites(sources: readonly NamedSource[], literal: string): string[] {
  return sources
    .map(([label, src]) => [label, collectTokenSites(src, literal).length] as const)
    .filter(([, n]) => n !== 1)
    .map(([label, n]) => `${label}: ${n}`)
}

describe('AC-2.10 — byte-identity of the three github renderings', () => {
  it('non-vacuity: all three deployed corpora are loaded', () => {
    for (const [name, src] of [
      ['plan.md', PLAN_MD],
      ['resolve.md', RESOLVE_MD],
      ['docs-framework/SKILL.md', DOCS_FRAMEWORK],
    ] as const) {
      expect(src.length, `${name} must be non-empty`).toBeGreaterThan(1000)
    }
  })

  it('the pin table covers all three renderings', () => {
    expect(AC_2_10_RENDERINGS.map(r => r.label.slice(0, 3))).toEqual(['1/3', '2/3', '3/3'])
  })

  for (const rendering of AC_2_10_RENDERINGS) {
    it(`${rendering.label} — exactly one site, byte-identical`, () => {
      expect(
        collectOffCountSites(rendering.sources, rendering.literal),
        `AC-2.10 says the github rendering "${rendering.literal}" is byte-identical. ` +
        'Corpus/count pair(s) that are not exactly 1 — 0 means the rendering changed or moved, ' +
        '>1 means a second site now also renders it and the two can drift:\n  ' +
        collectOffCountSites(rendering.sources, rendering.literal).join('\n  '),
      ).toEqual([])
    })

    if (rendering.neutralIn) {
      const [[label, src], neutral] = rendering.neutralIn
      it(`${rendering.label} — its neutral sibling is present exactly once in ${label}`, () => {
        // The rendering is the github EXPANSION of the neutral token. Pinning the
        // expansion alone would stay green on a file that dropped the vocabulary
        // change and kept the example.
        expect(
          collectTokenSites(src, neutral).length,
          `"${neutral}" must be stated exactly once in ${label} — the rendering it expands to is ` +
          'pinned above, and two statements of the neutral form are two authorities',
        ).toBe(1)
      })
    }
  }

  it('known-bad probe: a seeded second site is reported by the same collector', () => {
    // Both failure directions, driven through collectOffCountSites — the SAME
    // function the pins above call, so a collector that stopped counting
    // takes this probe red with the guards it backs.
    for (const rendering of AC_2_10_RENDERINGS) {
      const [, firstSrc] = rendering.sources[0]
      const label = rendering.sources[0][0]

      const duplicated = `${firstSrc}\n\nstale example: ${rendering.literal}\n`
      expect(
        collectOffCountSites([[label, duplicated]], rendering.literal),
        `a seeded SECOND "${rendering.literal}" must be reported — otherwise the equality is a ` +
        'toContain in disguise',
      ).toEqual([`${label}: 2`])

      const removed = firstSrc.replace(rendering.literal, '(rendering removed)')
      expect(removed, 'the removal must actually change the corpus').not.toBe(firstSrc)
      expect(
        collectOffCountSites([[label, removed]], rendering.literal),
        `a REMOVED "${rendering.literal}" must be reported too`,
      ).toEqual([`${label}: 0`])
    }
  })

  it('the `Closes` line keeps its github rendering', () => {
    expect(PLAN_MD, 'the PR-body template now carries the neutral token').toContain('Closes {ISSUE_REF}')
    expect(PLAN_MD, 'and still states what that renders as under github').toContain('`Closes #{n}`')
  })
})
