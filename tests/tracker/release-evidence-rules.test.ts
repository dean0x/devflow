/**
 * gather-release-evidence — the closing-keyword rule (G2) and the merged-PR
 * listing (G1), executed and structurally pinned (#359).
 *
 * G2. The candidate parse used to full-match whitespace tokens after three
 * keywords, so `Closes #12.`, `fixes #3,` and `(closes #4)` produced nothing, and
 * `close/closed/fix/fixed/resolve/resolves/resolved` were not keywords at all. The
 * rule now lives once in `_common.mds` as step 3a of every provider's reference.
 * This file READS the keyword regex and the trailing-strip class out of the BUILT
 * reference and RUNS the procedure the step states — a hand-copied regex here would
 * be a second authority that agrees with the shipped one only until one is edited
 * (PF-018), and the MDS escaping of `\(` and `\]` in prose is exactly the kind of
 * defect only an executing reader sees.
 *
 * G1. A squash-merged PR's commit rarely carries a closing keyword, so the only
 * record of which issue it closed is the PR's `closingIssuesReferences`. The GitHub
 * mechanics now read them from ONE merged-PR listing, map PRs into the range
 * locally, render each number `#{n}` before the gate, and report what the listing
 * could not cover instead of calling an empty result "empty, not degraded".
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { ROOT, requireDistFile, resolveAgentSource, walkFiles } from '../helpers.js'

const REFS_DIR = compiledSkillRefsDir()
const PROVIDERS = ['github', 'jira', 'linear'] as const

function requireRef(rel: string): string {
  const file = path.join(REFS_DIR, ...rel.split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${rel} is absent — run \`npm run build\` first (this guard reads built artifacts)`)
  }
}

const gatherRef = (provider: string): string =>
  requireRef(`tracker/${provider}/gather-release-evidence.md`)

/** Named collector: the step-3a line of a gather reference, or null when absent. */
export function collectClosingKeywordStep(text: string): string | null {
  return text.split('\n').find(line => line.startsWith('3a. **Closing-keyword rule.**')) ?? null
}

/** The two literals the procedure needs, read out of the step's own code spans. */
interface ClosingKeywordRule {
  readonly keyword: string
  readonly trailingClass: string
}

/** Named collector: the keyword regex and the trailing-strip class a step-3a line states. */
export function parseClosingKeywordRule(step: string): ClosingKeywordRule | null {
  const keyword = step.match(/whitespace token matching `([^`]+)`/)?.[1]
  const trailingClass = step.match(/every trailing character in `(\[[^`]+\])`/)?.[1]
  return keyword && trailingClass ? { keyword, trailingClass } : null
}

/**
 * Step 3a, executed: the candidates a text yields under a rule.
 *
 * Bounded by the input's own token count — every loop below walks a finite array
 * forward and never re-enters.
 */
export function extractCandidates(text: string, rule: ClosingKeywordRule): string[] {
  const keyword = new RegExp(rule.keyword, 'i')
  const trailing = new RegExp(`${rule.trailingClass}+$`)
  const candidates: string[] = []
  for (const line of text.split('\n')) {
    const tokens = line.split(/\s+/).filter(Boolean)
    for (let i = 0; i < tokens.length; i++) {
      if (!keyword.test(tokens[i])) continue
      for (let j = i + 1; j < tokens.length; j++) {
        for (const part of tokens[j].split(',')) {
          const stripped = part.replace(/^\(/, '').replace(trailing, '')
          if (stripped !== '') candidates.push(stripped)
        }
        if (!tokens[j].endsWith(',')) break
      }
    }
  }
  return candidates
}

/** Named collector: the anchored history grammar a gather reference states. */
export function collectHistoryGrammar(text: string): string | null {
  return text.match(/history grammar\*\* is `(\^[^`]+\$)`/)?.[1] ?? null
}

/** Step 5's gate: the provider grammar, anchored, plus KEY equality where the grammar is KEY-N. */
function gate(candidates: readonly string[], grammar: string, projectKey?: string): string[] {
  const re = new RegExp(grammar)
  return candidates.filter(c => re.test(c) && (projectKey === undefined || c.split('-')[0] === projectKey))
}

const RULE = (() => {
  const step = collectClosingKeywordStep(gatherRef('github'))
  const parsed = step === null ? null : parseClosingKeywordRule(step)
  if (parsed === null) throw new Error('github gather-release-evidence: step 3a or its literals are missing')
  return parsed
})()

const GITHUB_GRAMMAR = collectHistoryGrammar(gatherRef('github'))
const JIRA_GRAMMAR = collectHistoryGrammar(gatherRef('jira'))

/** The accept/reject table. `expected` is what survives step 5's gate. */
const CASES: ReadonlyArray<{ readonly text: string; readonly provider: 'github' | 'jira'; readonly expected: readonly string[] }> = [
  // Accepted — every one of these was dropped by the pre-#359 whitespace full-match.
  { text: 'Closes #12.', provider: 'github', expected: ['#12'] },
  { text: 'fixes #12,', provider: 'github', expected: ['#12'] },
  { text: '(Resolves #12)', provider: 'github', expected: ['#12'] },
  { text: 'Closes: #12', provider: 'github', expected: ['#12'] },
  { text: 'Closes #1, #2', provider: 'github', expected: ['#1', '#2'] },
  { text: 'Refs KEY-9;', provider: 'jira', expected: ['KEY-9'] },
  { text: 'closed: #7', provider: 'github', expected: ['#7'] },
  // Rejected — a reference in the other provider's grammar never crosses the gate.
  { text: 'Refs KEY-9', provider: 'github', expected: [] },
  { text: 'Closes #12', provider: 'jira', expected: [] },
  { text: 'Refs OTHER-9', provider: 'jira', expected: [] },
  // Rejected — by the gate, or because no keyword precedes the token.
  { text: 'Closes #12abc', provider: 'github', expected: [] },
  { text: 'Closes owner/repo#12', provider: 'github', expected: [] },
  { text: 'bare #12', provider: 'github', expected: [] },
  { text: 'prefixes #12', provider: 'github', expected: [] },
  { text: 'Merge pull request #12 from owner/branch', provider: 'github', expected: [] },
]

describe('G2: the closing-keyword rule, executed from the built reference', () => {
  it('reads non-empty literals and both grammars out of the shipped tree', () => {
    expect(RULE.keyword.startsWith('^') && RULE.keyword.endsWith('$'), 'the keyword regex is anchored')
      .toBe(true)
    expect(RULE.trailingClass, 'the MDS build must emit the class with its escaped bracket intact')
      .toBe('[.,;:)\\]!?]')
    expect(GITHUB_GRAMMAR, 'github 3b must state an anchored grammar').toBe('^#[1-9][0-9]{0,8}$')
    expect(JIRA_GRAMMAR, 'jira must state its anchored KEY-N grammar').not.toBeNull()
  })

  it('accepts and rejects exactly per the table', () => {
    const wrong: string[] = []
    for (const { text, provider, expected } of CASES) {
      const grammar = provider === 'github' ? GITHUB_GRAMMAR! : JIRA_GRAMMAR!
      const got = gate(extractCandidates(text, RULE), grammar, provider === 'jira' ? 'KEY' : undefined)
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        wrong.push(`${JSON.stringify(text)} (${provider}): got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`)
      }
    }
    expect(wrong, `closing-keyword outcomes the shipped rule does not produce:\n  ${wrong.join('\n  ')}`).toEqual([])
  })

  it('every keyword form is admitted, and a keyword-shaped substring is not', () => {
    const keyword = new RegExp(RULE.keyword, 'i')
    for (const word of ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved', 'refs', 'Closes:', '(fixes']) {
      expect(keyword.test(word), `${word} must be a closing keyword`).toBe(true)
    }
    for (const word of ['prefixes', 'fixture', 'closest', 'ref', 'resolver']) {
      expect(keyword.test(word), `${word} must not be a closing keyword`).toBe(false)
    }
  })

  it('states the rule byte-identically in all three providers, and names no grammar in it', () => {
    const steps = PROVIDERS.map(p => collectClosingKeywordStep(gatherRef(p)))
    expect(steps.every(s => s !== null), 'every provider reference must carry step 3a').toBe(true)
    expect(new Set(steps).size, 'one author: the three step-3a lines must be byte-identical').toBe(1)
    expect(steps[0], 'the shared rule lands in jira/linear too — it must carry no `#` grammar').not.toMatch(/#/)
  })

  it('known-bad probe: the pre-#359 rule rejects `Closes #12.`, which the shipped rule accepts', () => {
    // The retired procedure: whitespace tokens, three keywords, full-match `#[0-9]+`.
    const retired = (text: string): string[] => {
      const out: string[] = []
      for (const line of text.split('\n')) {
        const tokens = line.split(/\s+/).filter(Boolean)
        tokens.forEach((t, i) => {
          if (['refs', 'closes', 'fixes'].includes(t.toLowerCase()) && i + 1 < tokens.length) out.push(tokens[i + 1])
        })
      }
      return out.filter(c => /^#[0-9]+$/.test(c))
    }
    expect(retired('Closes #12.'), 'the retired rule is the defect this file exists for').toEqual([])
    expect(gate(extractCandidates('Closes #12.', RULE), GITHUB_GRAMMAR!)).toEqual(['#12'])
    // …and the collector reports a reference that lost its step.
    expect(collectClosingKeywordStep('### Process\n4. Resolve.\n')).toBeNull()
    expect(parseClosingKeywordRule('3a. **Closing-keyword rule.** no literals here')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// G1 — one merged-PR listing, rendered `#{n}`, with its honest statuses.
// ---------------------------------------------------------------------------

/** Named collector: listing calls that carry no explicit `--limit N` bound. */
export function collectUnboundedListings(text: string): string[] {
  return text.split('\n').filter(line => /gh pr list\b/.test(line) && !/--limit \d+/.test(line))
}

/** Named collector: `gh pr view` fallback lines that state no `≤N` bound. */
export function collectUnboundedFallbacks(text: string): string[] {
  return text.split('\n').filter(line => /gh pr view\b/.test(line) && !/≤\d+/.test(line))
}

/** Does a fallback line also take the range `(#N)` subjects a SUCCESSFUL listing left unmapped (#364)? */
export function fallbackCoversUnmappedMarkers(line: string): boolean {
  return line.includes('after a listing that succeeds, also over each range `(#N)` naming no listed PR')
}

/** The gather Output's declared status domain, as git.md spells it (PF-075). */
const GATHER_STATUS_LINE =
  '### Status: READY | PARTIAL ({n} DEGRADED) | TRUNCATED ({n} not processed) | DEGRADED ({reason}) | INDETERMINATE ({reason})'

/** git.md's `gather-release-evidence` section, from its heading to the next operation's. */
function gatherSection(): string {
  const git = resolveAgentSource('git').content
  const start = git.indexOf('## Operation: gather-release-evidence')
  if (start === -1) throw new Error('git.md: no gather-release-evidence operation')
  const next = git.indexOf('\n## Operation:', start + 1)
  return next === -1 ? git.slice(start) : git.slice(start, next)
}

describe('G1: the GitHub merged-PR listing', () => {
  const text = gatherRef('github')

  it('resolves the range with exactly one bounded listing', () => {
    const listings = text.split('\n').filter(line => /gh pr list\b/.test(line))
    expect(listings, 'one listing line, not one call per commit').toHaveLength(1)
    expect(listings[0]).toContain('closingIssuesReferences')
    expect(listings[0]).toContain('mergeCommit')
    expect(collectUnboundedListings(text)).toEqual([])
    expect(text, 'the aliased per-commit GraphQL batch is retired').not.toContain('associatedPullRequests')
  })

  it('renders every merged-PR number `#{n}` before the gate', () => {
    expect(text).toContain('renders every number it reads from a merged PR as `#{n}` before step 5\'s gate')
  })

  it('reports what the listing could not answer instead of an empty "not degraded"', () => {
    expect(text).toContain('`TRACEABILITY: DEGRADED (merged-PR listing did not cover the range)`')
    expect(text).toContain('`INDETERMINATE (merged-PR listing hit its 200 cap)`')
    expect(text, 'a foreign reference is the canonical reason, not a shipped issue')
      .toContain('`TRACEABILITY: DEGRADED (foreign issue reference {ref})`')
  })

  it('keeps a bounded fallback for a gh that cannot list the field', () => {
    const fallbacks = text.split('\n').filter(line => /gh pr view\b/.test(line))
    expect(fallbacks, 'the listing-failure fallback must exist').toHaveLength(1)
    expect(collectUnboundedFallbacks(text)).toEqual([])
    expect(fallbacks[0]).toContain('THROTTLED ({n} not processed)')
  })

  it('the agent declares the five-value status and the trace map, and reads the flagged-empty case', () => {
    const section = gatherSection()
    expect(section).toContain(GATHER_STATUS_LINE)
    expect(section).toContain('### TRACE_MAP\n{the trace script\'s lines, verbatim}')
    expect(section).toContain('unless the Mechanics flag merged PRs they could not resolve')
  })

  it('the fallback also resolves a range `(#N)` that no listed PR maps (the G1 residual)', () => {
    const fallback = text.split('\n').find(line => /gh pr view\b/.test(line))
    expect(fallback, 'the fallback line must exist').toBeDefined()
    expect(fallbackCoversUnmappedMarkers(fallback!), 'a successful listing must still hand an unmapped `(#N)` to the fallback').toBe(true)
    expect(fallback, 'the listing-failure case keeps its wording').toContain(
      '**The listing fails** (an older `gh` reports `Unknown JSON field`) ⇒ `TRACEABILITY: DEGRADED ({reason})`, then fall back to',
    )
  })

  it('known-bad probe: an unbounded listing and an unbounded fallback are both reported', () => {
    expect(collectUnboundedListings('- `gh pr list --state merged --json number,closingIssuesReferences`'))
      .toHaveLength(1)
    expect(collectUnboundedFallbacks('- fall back to `gh pr view N --json closingIssuesReferences` for every PR'))
      .toHaveLength(1)
    // The pre-#364 fallback ran only when the listing failed, so a squash subject's
    // `(#N)` naming a PR the listing missed dropped its issue silently.
    const retired = '   - **The listing fails** (an older `gh` reports `Unknown JSON field`) ⇒ `TRACEABILITY: DEGRADED ({reason})`, ' +
      'then fall back to `gh pr view N --json closingIssuesReferences` over the PR numbers in `(#N)` / `Merge pull request #N` ' +
      'subjects, each N gated `^[1-9][0-9]{0,8}$`, bounded at ≤25 PRs'
    expect(fallbackCoversUnmappedMarkers(retired)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// G1 tag-date binding — TAG_DATE must interpolate the `{last_tag}` placeholder
// git.md's own steps use, never an unbound shell variable step 4 itself never
// assigns (#359 PR1 M1 — the pre-fix line read `"$LAST_TAG"`, which nothing in
// the operation binds, so the listing's `--search` term evaluated to an empty
// tag date on every real invocation).
// ---------------------------------------------------------------------------

/** Named collector: lines referencing a `$LAST_TAG` shell variable nothing in the reference binds. */
export function collectUnboundLastTagRefs(text: string): string[] {
  return text.split('\n').filter(line => /\$LAST_TAG\b/.test(line))
}

describe('G1: the tag-date binding', () => {
  const text = gatherRef('github')

  it('TAG_DATE interpolates the {last_tag} placeholder, not an unbound shell variable', () => {
    expect(collectUnboundLastTagRefs(text), 'gather step 4 must not reference $LAST_TAG').toEqual([])
    const tagDateLine = text.split('\n').find(line => line.includes('TAG_DATE='))
    expect(tagDateLine, 'the once-before-the-listing bullet must exist').toBeDefined()
    expect(tagDateLine).toContain('--format=%cd {last_tag})')
  })

  it('states the fallback when TAG_DATE fails its shape gate', () => {
    expect(text).toContain('If `TAG_DATE` fails this gate, treat it as **the listing fails** below')
  })

  it('known-bad probe: the collector reports the pre-fix unbound form and clears the fixed one', () => {
    const broken = '   - TAG_DATE=$(TZ=UTC git log -1 --date=format-local:%Y-%m-%d --format=%cd "$LAST_TAG")'
    const fixed = '   - TAG_DATE=$(TZ=UTC git log -1 --date=format-local:%Y-%m-%d --format=%cd {last_tag})'
    expect(collectUnboundLastTagRefs(broken)).toHaveLength(1)
    expect(collectUnboundLastTagRefs(fixed)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// #364 (PR5) — steps 1a and 6 come from `_common.mds`, byte for byte, in all
// three gather references. Step 1a replaces step 1's `git describe` tag with the
// last RELEASE tag; step 6 accounts for every first-parent commit of the range,
// which is what closes the G1 residual: a commit no listed PR maps is no longer
// dropped silently, it is listed as untraced.
// ---------------------------------------------------------------------------

const COMMON_SOURCE = path.join(ROOT, 'src', 'assets', 'mds', 'tracker', '_common.mds')

/** The body line of `@define {name}(…):` in `_common.mds`, braces unescaped as the compiler emits them. */
function commonDefineLine(name: string): string {
  const source = readFileSync(COMMON_SOURCE, 'utf-8')
  const open = source.split('\n').findIndex(line => line.startsWith(`@define ${name}(`))
  if (open === -1) throw new Error(`_common.mds: no \`@define ${name}(\``)
  const body = source.split('\n')[open + 1]
  if (body === undefined || body === '@end') throw new Error(`_common.mds: ${name} has an empty body`)
  return body.replace(/\\([{}])/g, '$1')
}

/** Named collector: the one line of a gather reference that opens with `prefix`, or null. */
export function collectGatherStep(text: string, prefix: string): string | null {
  const lines = text.split('\n').filter(line => line.startsWith(prefix))
  return lines.length === 1 ? lines[0] : null
}

/**
 * Named collector: the fixed fragments of the step-6 define — its body split on
 * the two parameters — that a provider's step 6 does NOT carry, in order.
 */
export function collectMissingStep6Fragments(step: string, defineLine: string): string[] {
  const fragments = defineLine.split(/\{(?:arm|args)\}/).filter(f => f !== '')
  const missing: string[] = []
  let from = 0
  for (const fragment of fragments) {
    const at = step.indexOf(fragment, from)
    if (at === -1) missing.push(fragment)
    else from = at + fragment.length
  }
  return missing
}

const STEP_1A = '1a. **Last release tag.**'
const STEP_6 = '6. **Per-commit trace map.**'

/** Each provider's own step-6 arguments: its grammar, and GitHub's traced SHAs. */
const STEP_6_ARGS: Readonly<Record<(typeof PROVIDERS)[number], string>> = {
  github: 'map --from {last_tag} --grammar github --traced-file "$T"; echo "exit=$?"',
  jira: 'map --from {last_tag} --grammar jira --key {KEY}; echo "exit=$?"',
  linear: 'map --from {last_tag} --grammar linear --key {KEY}; echo "exit=$?"',
}

describe('#364: steps 1a and 6 are _common.mds text in every gather reference (AC-5)', () => {
  it('step 1a is the define\'s line, byte-identical in all three providers', () => {
    const define = commonDefineLine('last_release_tag_step')
    expect(define.startsWith(STEP_1A), 'the define must open with its step label').toBe(true)
    for (const p of PROVIDERS) {
      expect(collectGatherStep(gatherRef(p), STEP_1A), `${p}: step 1a`).toBe(define)
    }
  })

  it('step 1a sits before step 3a, and step 6 is the last step', () => {
    for (const p of PROVIDERS) {
      const lines = gatherRef(p).split('\n')
      const a = lines.findIndex(l => l.startsWith(STEP_1A))
      const k = lines.findIndex(l => l.startsWith('3a. '))
      const six = lines.findIndex(l => l.startsWith(STEP_6))
      expect(a, `${p}: 1a before 3a`).toBeGreaterThan(-1)
      expect(a, `${p}: 1a before 3a`).toBeLessThan(k)
      expect(lines.slice(six + 1).filter(l => l.trim() !== ''), `${p}: nothing follows step 6`).toEqual([])
    }
  })

  it('step 6 carries every fixed fragment of the define, in order, with this provider\'s arguments', () => {
    const define = commonDefineLine('trace_map_step')
    expect(define.split(/\{(?:arm|args)\}/).length, 'the define must take both parameters').toBe(3)
    for (const p of PROVIDERS) {
      const step = collectGatherStep(gatherRef(p), STEP_6)
      expect(step, `${p}: exactly one step 6`).not.toBeNull()
      expect(collectMissingStep6Fragments(step!, define), `${p}: step 6 drifted from _common.mds`).toEqual([])
      expect(step, `${p}: its own grammar`).toContain(STEP_6_ARGS[p])
    }
  })

  it('GitHub passes the SHAs step 4 traced; the keyed providers skip the run without a key', () => {
    const github = collectGatherStep(gatherRef('github'), STEP_6)!
    expect(github).toContain('`trap \'rm -- "$T"\' EXIT; T="$(mktemp)"`')
    expect(github, 'a squash PR traces through its merge commit or its subject').toContain('its `mergeCommit.oid`, or a subject naming it')
    for (const p of ['jira', 'linear'] as const) {
      expect(collectGatherStep(gatherRef(p), STEP_6), p).toContain('with none usable, skip the run and take the arm below')
    }
  })

  it('known-bad probe: a one-character drift in a provider\'s step 6 is reported', () => {
    const define = commonDefineLine('trace_map_step')
    const step = collectGatherStep(gatherRef('jira'), STEP_6)!
    const drifted = step.replace('bound:hit` ⇒ status', 'bound:hit` => status')
    expect(drifted, 'the seed must land').not.toBe(step)
    expect(collectMissingStep6Fragments(drifted, define)).toHaveLength(1)
    expect(collectGatherStep('1a. **Last release tag.** one\n1a. **Last release tag.** two', STEP_1A), 'two copies are no copy').toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PF-075 — every status a gather reference reports is a value of the domain the
// agent's Output declares. Jira and Linear reported PARTIAL and TRUNCATED for a
// year under a three-value declaration; /release classifies by that declaration.
// ---------------------------------------------------------------------------

/** The status keywords the declared line admits. */
function declaredStatuses(line: string): string[] {
  return line.replace('### Status: ', '').split(' | ').map(v => v.split(' ')[0])
}

/**
 * D4's item-level count — "report remaining items as `THROTTLED ({n} not
 * processed)`" — is a report about ITEMS, not the operation's `### Status:`.
 */
const ITEM_LEVEL_REPORTS: readonly string[] = ['THROTTLED']

/** The two shapes a reported status takes: after the word `status`, or as a `KEYWORD (reason)` span. */
const REPORTED_STATUS_RES: readonly RegExp[] = [/\bstatus `([A-Z]+)\b/g, /`([A-Z]{4,}) \(/g]

/** Every status keyword a gather reference reports, in either shape. */
function reportedStatuses(text: string): string[] {
  return REPORTED_STATUS_RES.flatMap(re => [...text.matchAll(re)].map(m => m[1]))
    .filter(s => !ITEM_LEVEL_REPORTS.includes(s))
}

/**
 * Named collector: status keywords a gather reference reports that the declared
 * domain does not admit.
 *
 * NOT covered: a bare keyword in another verb shape ("return `COMPLETE`"), and
 * the item-level `THROTTLED` count, which is not the operation's status.
 */
export function collectUndeclaredStatuses(text: string, declared: readonly string[]): string[] {
  return [...new Set(reportedStatuses(text).filter(s => !declared.includes(s)))]
}

describe('PF-075: the gather references report only declared statuses', () => {
  const declared = declaredStatuses(GATHER_STATUS_LINE)

  it('the declared domain is the five values, and the agent carries it', () => {
    expect(declared).toEqual(['READY', 'PARTIAL', 'TRUNCATED', 'DEGRADED', 'INDETERMINATE'])
    expect(gatherSection()).toContain(GATHER_STATUS_LINE)
  })

  it('every reported status is declared, and each provider reports at least one', () => {
    for (const p of PROVIDERS) {
      const text = gatherRef(p)
      expect(reportedStatuses(text).length, `${p}: no reported status was read`).toBeGreaterThan(0)
      expect(collectUndeclaredStatuses(text, declared), p).toEqual([])
    }
  })

  it('known-bad probe: an undeclared status is reported, a declared one is not', () => {
    expect(collectUndeclaredStatuses('report status `COMPLETE (all good)`.', declared)).toEqual(['COMPLETE'])
    expect(collectUndeclaredStatuses('Report `PARTIAL ({n} DEGRADED)` whenever', declared)).toEqual([])
    // The pre-#364 three-value declaration would not admit what Jira reports.
    expect(collectUndeclaredStatuses(gatherRef('jira'), ['READY', 'DEGRADED', 'INDETERMINATE']).sort())
      .toEqual(['PARTIAL', 'TRUNCATED'])
  })
})

// ---------------------------------------------------------------------------
// `--limit` on every `gh pr list` — widened from the GitHub gather reference to
// the compiled agent, every generated reference and release.md (#364).
// ---------------------------------------------------------------------------

/**
 * Named collector: `gh pr list` INVOCATIONS with no `--limit N` in their own code
 * span (or line, outside a span).
 *
 * A span holding only the name — `` `gh pr list` `` — names the command and is
 * not an invocation: git.md's learn-conventions degradation clause speaks of "the
 * `gh pr list` scan" whose invocation, bounded, lives in its reference.
 *
 * NOT covered: an invocation split across a backslash continuation, a `--limit`
 * passed through a variable, and files outside the corpus below (hand-authored
 * skill references and the other commands).
 */
export function collectUnboundedInvocations(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/gh pr list\b/g)) {
      const at = m.index ?? 0
      if (line[at - 1] === '`' && line[at + 'gh pr list'.length] === '`') continue
      const close = line.indexOf('`', at)
      const invocation = line.slice(at, close === -1 ? line.length : close)
      if (!/--limit \d+/.test(invocation)) out.push(invocation)
    }
  }
  return out
}

/**
 * Invocations the corpus carries without `--limit`, each with its reason — the
 * rule and its exemptions are one authority (PF-067). Every entry must still be
 * emitted, so an exemption cannot outlive the line it excuses.
 */
const KNOWN_UNBOUNDED_INVOCATIONS: ReadonlyArray<{ readonly file: string; readonly invocation: string; readonly why: string }> = [
  {
    file: 'skills/git/references/pr/ensure-pr-ready.md',
    invocation: 'gh pr list --head {branch} --state open',
    why:
      'the open-PR lookup for one head branch, in PR-host mechanics that #364 does not touch (its ' +
      'budget prices no pr/ file). gh caps an unflagged listing at 30, and a head branch has at ' +
      'most one open PR per base; adding `--limit` there is recorded as a follow-up',
  },
]

describe('#364: `--limit` on every `gh pr list` in the agent, the references and release.md', () => {
  const distRoot = path.join(ROOT, 'dist')
  const corpus = [
    { file: 'agents/git.md', content: resolveAgentSource('git').content },
    ...walkFiles(REFS_DIR, f => f.endsWith('.md')).map(f => ({
      file: path.relative(distRoot, f).split(path.sep).join('/'),
      content: readFileSync(f, 'utf-8'),
    })),
    { file: 'commands/release.md', content: requireDistFile('release.md') },
  ]

  it('the corpus reaches each class, and invocations are found in it', () => {
    const files = corpus.map(c => c.file)
    for (const sentinel of [
      'agents/git.md',
      'commands/release.md',
      'skills/git/references/learn-conventions.md',
      'skills/git/references/tracker/github/gather-release-evidence.md',
      'skills/git/references/pr/ensure-pr-ready.md',
    ]) {
      expect(files, `sentinel ${sentinel} was not read`).toContain(sentinel)
    }
    const invocations = corpus.flatMap(c => c.content.split('\n').filter(l => /gh pr list\b/.test(l)))
    expect(invocations.length, 'fewer `gh pr list` lines than the tree carries').toBeGreaterThanOrEqual(4)
  })

  it('every invocation carries `--limit N`, or is a named exemption', () => {
    const offenders = corpus.flatMap(({ file, content }) =>
      collectUnboundedInvocations(content)
        .filter(inv => !KNOWN_UNBOUNDED_INVOCATIONS.some(e => e.file === file && e.invocation === inv))
        .map(inv => `${file}: ${inv}`))
    expect(offenders).toEqual([])
  })

  it('every exemption is still emitted, and has a reason', () => {
    for (const e of KNOWN_UNBOUNDED_INVOCATIONS) {
      const entry = corpus.find(c => c.file === e.file)
      expect(entry, `${e.file} is not in the corpus`).toBeDefined()
      expect(collectUnboundedInvocations(entry!.content), `${e.file}: the exemption excuses nothing`).toContain(e.invocation)
      expect(e.why.length).toBeGreaterThan(40)
    }
  })

  it('known-bad probes: an unbounded invocation in release.md is reported; the bare name is not', () => {
    const release = corpus.find(c => c.file === 'commands/release.md')!.content
    expect(collectUnboundedInvocations(`${release}\n- list merged work: \`gh pr list --state merged --json number\`\n`))
      .toEqual(['gh pr list --state merged --json number'])
    expect(collectUnboundedInvocations('```bash\ngh pr list\n```')).toEqual(['gh pr list'])
    expect(collectUnboundedInvocations('Any 4xx on the `gh pr list` scan → skip the signal.')).toEqual([])
    expect(collectUnboundedInvocations('`gh pr list --state merged --limit 30 --json title`')).toEqual([])
  })
})
