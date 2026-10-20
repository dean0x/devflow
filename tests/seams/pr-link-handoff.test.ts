import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ROOT, buildCommittedTree, cleanupCommittedTree, collectCodeSpawnSites, collectOrderViolations, ensurePrReadyReference, gitOperationReferenceCorpus, requireDistFile, walkFiles } from '../helpers.js'
import { compiledSkillRefsDir } from '../../src/core/assets.js'

/** The generated `devflow:git` reference tree — the providers' own mechanics. */
const REFS_DIR = compiledSkillRefsDir()

// -------------------------------------------------------------------------
// `### Handoff Values` — Git agent producer ↔ ensure-pr-ready consumer (P2-S10, GAP-15; D-PR-BY-GIT, #448).
//
// GAP-15 found `ISSUE_PR_LINK` and `ISSUE_BRANCH_TOKEN` consumed with no
// producer anywhere: the ALWAYS-ON `Closes #{n}` rule had nothing to paste, and
// failed silently on the GitHub path too. T2b added the producers to setup-task
// and fetch-issue; this file pins both ends of that seam so a later edit cannot
// drop one side and leave the other looking healthy.
//
// The consumer is the Git agent's ensure-pr-ready reference, which opens the PR
// under every strategy (D-PR-BY-GIT, #448) and holds the paste gates. The failure
// mode a one-sided guard misses: a guard that only checks the producers stays green
// when the consumer stops pasting the block, and a guard that only checks the
// consumer stays green when the producers stop emitting it. Either way the PR
// body silently loses its issue link — the exact defect, restored.
//
// Both ends are Git operation references (D-OP-ONE-REF): the producer text is the
// setup-task and fetch-issue references, the consumer text is the ensure-pr-ready
// reference. The consumer's PR skeleton is one write expanded into three provider
// files, so the GitHub copy stands for it in the single-valued arms and the
// all-providers arm below holds the other two.
//
// Header doctrine and framing copied from tests/resolve/duplicate-verdict.test.ts:4-15
// (the repo's original two-sided producer/consumer test).
// -------------------------------------------------------------------------

/** The operations' producer text: each operation's one reference (GitHub), joined. */
const GIT = gitOperationReferenceCorpus().map(entry => entry.content).join('\n')

/** The PR-opening consumer of the handoff values (D-PR-BY-GIT): ensure-pr-ready's reference, GitHub copy. */
const PR_READY = ensurePrReadyReference()

afterAll(cleanupCommittedTree)

/** The producer lines, verbatim as git.md emits them under ### Handoff Values. */
const PRODUCER_LINES = [
  '- **PR link line**: {rendered}',
  '- **Branch token**: {branch-name}',
  '- **Branch token**: {suggested-branch}',
  '- **Issue ID**: {ISSUE_ID}',
] as const

/**
 * The branch token IS the branch name (#376 S5), per operation: setup-task's is
 * the branch it created, the placeholder its `## Task Setup:` heading uses, and
 * fetch-issue's is the one its `### Suggested Branch` section names.
 */
const BRANCH_TOKEN_SOURCES = [
  { op: 'setup-task', line: '- **Branch token**: {branch-name}', source: '## Task Setup: {branch-name}' },
  { op: 'fetch-issue', line: '- **Branch token**: {suggested-branch}', source: '### Suggested Branch' },
] as const

/** git.md's section for one operation, from its heading to the next operation's. */
function gitOpSection(git: string, op: string): string {
  const start = git.indexOf(`## Operation: ${op}\n`)
  if (start === -1) return ''
  const next = git.indexOf('\n## Operation:', start + 1)
  return next === -1 ? git.slice(start) : git.slice(start, next)
}

/** Named collector: each operation whose branch token is not the branch name it returns. */
function collectBranchTokenDefects(git: string): string[] {
  const out: string[] = []
  for (const { op, line, source } of BRANCH_TOKEN_SOURCES) {
    const section = gitOpSection(git, op)
    if (section === '') out.push(`${op}: no section`)
    else if (!section.includes(line) || !section.includes(source)) out.push(`${op}: branch token is not ${source}'s branch name`)
  }
  if (git.includes('- **Branch token**: {token}')) out.push('an opaque {token} placeholder is still emitted')
  return out
}

describe('Git operation references — ### Handoff Values producer block', () => {
  it('is non-vacuous', () => {
    expect(GIT.length).toBeGreaterThan(10000)
  })

  it('emits all three handoff values under a ### Handoff Values heading', () => {
    expect(GIT, 'the producer block must be headed so a reader can find it').toContain('### Handoff Values')
    for (const line of PRODUCER_LINES) {
      expect(
        GIT,
        `the setup-task and fetch-issue references must emit ${line} — the ensure-pr-ready consumer reads it by this exact label, not by prose`,
      ).toContain(line)
    }
  })

  it('defines the branch token as the branch name each operation returns (#376 S5)', () => {
    expect(collectBranchTokenDefects(GIT)).toEqual([])
  })

  it('known-bad probes: an opaque {token}, and a setup-task token that is not its branch, are reported', () => {
    const opaque = GIT.replace('- **Branch token**: {suggested-branch}', '- **Branch token**: {token}')
    expect(opaque, 'the seed must land').not.toBe(GIT)
    expect(collectBranchTokenDefects(opaque)).toEqual([
      'fetch-issue: branch token is not ### Suggested Branch\'s branch name',
      'an opaque {token} placeholder is still emitted',
    ])
    const swapped = GIT.replace('- **Branch token**: {branch-name}', '- **Branch token**: {suggested-branch}')
    expect(collectBranchTokenDefects(swapped)).toEqual(['setup-task: branch token is not ## Task Setup: {branch-name}\'s branch name'])
  })

  it('emits the block from both issue-returning operations, not just one', () => {
    // setup-task and fetch-issue are separate entry points into /implement.
    // A block on only one of them makes the consumer's paste rule depend on
    // which command the user ran.
    const count = GIT.split('### Handoff Values').length - 1
    expect(
      count,
      'both setup-task and fetch-issue must carry the block — one copy means one of the two entry points returns nothing to paste',
    ).toBeGreaterThanOrEqual(2)
  })
})

describe('ensure-pr-ready — ### Handoff Values consumer', () => {
  it('is non-vacuous', () => {
    expect(PR_READY.length).toBeGreaterThan(5000)
  })

  it('names the PR-link producer by its producer label', () => {
    expect(
      PR_READY,
      'the consumer must name `- **PR link line**:` — naming only the variable would not survive a producer relabel',
    ).toContain('- **PR link line**:')
    expect(
      PR_READY,
      'the consumer must name `- **Branch token**:` for the same reason',
    ).toContain('- **Branch token**:')
  })

  it('re-checks the shape before pasting, and degrades instead of coercing', () => {
    expect(
      PR_READY,
      'the PR body is a GitHub-visible sink; a returned value is still attacker-influenceable at the paste site',
    ).toContain('^Closes #[1-9][0-9]{0,8}$')
    expect(
      PR_READY,
      'a malformed ref must emit a DEGRADED reason, never be silently repaired or dropped',
    ).toContain('does not match any tracker reference grammar')
  })

  it('re-checks BEFORE it pastes — order, not mere presence', () => {
    const recheck = PR_READY.indexOf('after re-checking its shape against the tracker reference grammars')
    const degraded = PR_READY.indexOf('does not match any tracker reference grammar')
    expect(recheck, 'the re-check instruction must exist').toBeGreaterThan(-1)
    expect(
      recheck,
      'the shape re-check must be stated as a precondition of the paste, not as an afterthought below the DEGRADED line',
    ).toBeLessThan(degraded)
  })
})

// -------------------------------------------------------------------------
// The paste gate is ONE row per tracker grammar, and every row is executed.
//
// The gate used to be a single `github` arm. Under any other provider the Git
// agent renders `Refs PROJ-12`, which that arm rejects — so the one value the
// seam exists to carry was discarded as malformed for two of the three
// providers, and the PR body silently recomposed a github-shaped link from a
// number that is not a github issue.
//
// It then became one arm per RESOLVED provider — but the paste happens in a
// later spawn than the one that rendered the line (#359, G3): the command layer
// holds no provider knowledge and forwards the rendered line verbatim, so the
// consumer does not re-derive the provider from it. So the gate is a
// provider-free UNION: a value is pasted when it matches any one row. That is a
// sink check on the line's shape; setup-task or fetch-issue, which did resolve
// the provider, is what chose the grammar.
//
// The arms are read OUT of the prompt and RUN here rather than re-typed. A
// hand-copied grammar in a test is a second authority that agrees with the first
// only until one of them is edited, and an anchored pattern is exactly
// the kind of literal whose defect — a missing `^`, a `+` where `{0,8}` was
// meant — is invisible to a reader and obvious to anything that executes it.
// -------------------------------------------------------------------------

/** The providers whose `ISSUE_PR_LINK` ensure-pr-ready may be handed. Named, not discovered. */
const PASTE_PROVIDERS = ['github', 'jira', 'linear'] as const

/**
 * Named collector: the per-provider paste arms, as the prompt's table spells them.
 *
 * A row is `| `provider` | `^…$` |`. Returned as a Map so a missing provider is a
 * missing KEY — reported by name — rather than an arm silently defaulting to
 * whichever row happened to parse.
 */
function collectPasteArms(source: string): Map<string, string> {
  const arms = new Map<string, string>()
  for (const m of source.matchAll(/^\s*\|\s*`([a-z]+)`\s*\|\s*`(\^[^`]+\$)`\s*\|/gm)) {
    arms.set(m[1], m[2])
  }
  return arms
}

/** Every payload, with the providers whose arm must ACCEPT it. Absent ⇒ every arm rejects. */
const PASTE_PAYLOADS: ReadonlyArray<{ label: string; value: string; accepts: readonly string[] }> = [
  { label: 'a github link line', value: 'Closes #12', accepts: ['github'] },
  // The jira and linear rows OVERLAP on a plain uppercase key, and the table
  // records that rather than pretending otherwise. Under the union gate the
  // overlap is harmless — either row admitting a line is enough to paste it —
  // but each row is still held to its OWN provider's grammar below, so the two
  // shapes that part them, one each way, stay pinned.
  { label: 'a plain uppercase key', value: 'Refs PROJ-12', accepts: ['jira', 'linear'] },
  { label: 'a three-letter key', value: 'Refs ENG-12', accepts: ['jira', 'linear'] },
  { label: 'an underscored key (jira only)', value: 'Refs A_B-1', accepts: ['jira'] },
  { label: 'a single-character key (linear only)', value: 'Refs A-1', accepts: ['linear'] },
  // Hostile / malformed — every arm must refuse all of them.
  { label: 'two link lines in one value', value: 'Closes #12\nCloses #13', accepts: [] },
  { label: 'a trailing newline', value: 'Closes #12\n', accepts: [] },
  { label: 'a leading newline', value: '\nCloses #12', accepts: [] },
  { label: 'a zero issue number', value: 'Closes #0', accepts: [] },
  { label: 'a lowercase key', value: 'Refs proj-12', accepts: [] },
  { label: 'a trailing comment', value: 'Closes #12 <!-- x -->', accepts: [] },
  { label: 'a markdown link', value: 'Closes [#12](http://x.test)', accepts: [] },
  { label: 'the empty string', value: '', accepts: [] },
  // The value crosses an agent boundary as prose and is pasted into a PR body a
  // shell composes. A shape gate that admitted this would hand a command
  // substitution to whatever `gh pr create` invocation quotes it wrongly — so the
  // arms' whole-line anchoring is what has to refuse it, not a later escape.
  { label: 'a command substitution', value: 'pr-link: $(whoami)', accepts: [] },
  // Length. Every arm bounds its key and its number, so a line far past those
  // bounds has no accepting arm — the property that keeps an unbounded paste out
  // of the PR body. 74 characters, and its only defect IS the length: strip it
  // back to `Refs AB-1` and the jira and linear arms both take it.
  { label: 'an over-long line (74 ch, past every arm\'s bounded key and number)',
    value: `Refs A${'B'.repeat(10)}-${'1'.repeat(57)}`, accepts: [] },
]

describe('ensure-pr-ready — the paste gate, one row per tracker grammar', () => {
  it('states an anchored arm for every provider, and no arm for anything else', () => {
    const arms = collectPasteArms(PR_READY)
    expect(
      [...arms.keys()].sort(),
      'the paste gate must name every provider the Git agent can render a line for — an absent ' +
      'arm is a provider whose only valid value the agent has no rule to accept',
    ).toEqual([...PASTE_PROVIDERS].sort())
    for (const [provider, pattern] of arms) {
      expect(pattern.startsWith('^'), `${provider}: the arm must anchor the start of the line`).toBe(true)
      expect(pattern.endsWith('$'), `${provider}: the arm must anchor the end of the line`).toBe(true)
    }
  })

  it('every arm, EXECUTED against every payload, accepts exactly what it should', () => {
    const arms = collectPasteArms(PR_READY)
    const wrong: string[] = []
    for (const { label, value, accepts } of PASTE_PAYLOADS) {
      for (const provider of PASTE_PROVIDERS) {
        const pattern = arms.get(provider)
        expect(pattern, `no arm for ${provider}`).toBeDefined()
        const matched = new RegExp(pattern!).test(value)
        const expected = accepts.includes(provider)
        if (matched !== expected) {
          wrong.push(
            `${provider} ${matched ? 'ACCEPTED' : 'REJECTED'} ${label} (${JSON.stringify(value)}) ` +
            `— expected ${expected ? 'accept' : 'reject'}; arm is ${pattern}`,
          )
        }
      }
    }
    expect(
      wrong,
      `paste-arm outcome(s) the prompt's own grammar does not produce:\n  ${wrong.join('\n  ')}`,
    ).toEqual([])
  })

  it('states the bounds a regex engine is not guaranteed to apply', () => {
    // The arms are run by a model, not by this file's engine. `$` is
    // end-of-input in JS and end-of-LINE in several others, so the multi-line
    // refusal has to be written down as well as anchored; and an anchored
    // pattern bounds the SHAPE of a line, never its length.
    expect(
      PR_READY,
      'a value carrying a newline must be refused in words — a `$` that some engines read as ' +
      'end-of-line would admit everything after the first line into the PR body as free text',
    ).toMatch(/reject(?:s|ed)?[\s\S]{0,120}?(newline|multi-line)/i)
    expect(PR_READY, 'the arms must carry an explicit length bound').toMatch(/60 characters/)
  })

  it('(none) is not a mismatch, and is never recomposed from a bare number', () => {
    expect(
      PR_READY,
      '`(none)` means no line was captured, which is the documented absent case — degrading over ' +
      'it would report a malformed value every time a task has no issue',
    ).toMatch(/`\(none\)`[\s\S]{0,200}?not a mismatch/i)
    expect(
      PR_READY,
      'with no rendered line the section carries no reference — a bare ' +
      'number names a different issue under each provider, so any line composed from it would be a guess',
    ).toContain('never compose one from `ISSUE_NUMBER`')
    expect(
      PR_READY,
      'a bare issue number names a different issue under each provider, and the canonical reason ' +
      'for that is already registered — reuse it, never a new spelling',
    ).toContain('TRACEABILITY: DEGRADED (ambiguous issue reference)')
  })

  it('names no provider in the mismatch reason — the gate is a union over every row', () => {
    expect(
      PR_READY,
      'the gate decides no provider, so a reason that named one would name a guess; the ' +
      'union gate\'s honest report is that the line matched none of the grammars',
    ).toContain('does not match any tracker reference grammar')
    expect(PR_READY).not.toContain('does not match {provider} reference grammar')
    expect(PR_READY).not.toContain('does not match github reference grammar')
  })

  it('never asks the agent to read a provider it is not given', () => {
    // The retired instruction. With no provider in the spawn, "the arm for the
    // provider that was RESOLVED" has nothing to resolve against, and an agent
    // told to find one improvises it.
    expect(PR_READY).not.toMatch(/provider that was RESOLVED/i)
    expect(PR_READY).not.toContain('| Resolved provider |')
    expect(PR_READY, 'the gate is stated as a sink check').toContain('This is a sink check, not a provider check')
  })

  it('known-bad probe: the arm collector reports a missing anchor and a missing row', () => {
    const seeded = [
      '| Tracker grammar | value |',
      '|---|---|',
      '| `github` | `^Closes #[1-9][0-9]{0,8}$` |',
      '| `jira` | `^Refs [A-Z]+-[0-9]+$` |',
    ].join('\n')
    const arms = collectPasteArms(seeded)
    expect([...arms.keys()], 'the collector must read the rows it can and omit the row it cannot')
      .toEqual(['github', 'jira'])
    // An unanchored pattern is not a row this collector reads at all, which is
    // what makes the anchoring arm above a real check rather than a tautology.
    expect(collectPasteArms('| `linear` | `Refs [A-Z]+-[0-9]+` |').size).toBe(0)
  })

  // -----------------------------------------------------------------------
  // The arms are a FOURTH reader of each provider's reference grammar.
  //
  // The gate reads no provider's mechanics file to defer to, so a per-provider
  // sink check has to enumerate the closed set once, inside the gate — that is
  // what keeps it a sink check rather than a second convergence point. What it must
  // not become is a second AUTHORITY: the shape a `KEY-N` reference takes is
  // stated by each provider's own mechanics, and the project-key alphabet
  // already has an explicit one-authority claim over three readers
  // (tests/tracker/single-authority.test.ts). This gate was the reader that
  // claim does not cover.
  //
  // The arms agree with the mechanics today. What was missing is anything that
  // would notice if a provider's grammar were edited and this table were not —
  // and the dangerous direction is silent: a widened arm admits a link line the
  // provider's own mechanics would refuse, at the one gate standing between an
  // attacker-influenceable value and a GitHub-visible sink.
  // -----------------------------------------------------------------------

  /**
   * Named collector: the reference grammars a provider's generated mechanics
   * state, deduplicated.
   *
   * Read out of the shipped tree, never re-typed here — a literal in this file
   * would be the fifth authority and the only one nobody ships.
   * Linear's internal-id form is deliberately excluded: it carries no team, so
   * the provider's own history grammar admits the TEAM-KEY form only, and a
   * rendered PR link is always that form.
   */
  function collectProviderRefGrammars(provider: string): string[] {
    const dir = path.join(REFS_DIR, 'tracker', provider)
    const found = new Set<string>()
    for (const file of walkFiles(dir, f => f.endsWith('.md'), 1)) {
      for (const m of fs.readFileSync(file, 'utf-8').matchAll(/\^\[A-Z\]\[A-Z0-9_?\]\{\d,\d\}-\[1-9\]\[0-9\]\{\d,\d\}\$/g)) {
        found.add(m[0])
      }
    }
    return [...found]
  }

  it('each non-github arm is its provider\'s own reference grammar, prefixed by the rendered verb', () => {
    const arms = collectPasteArms(PR_READY)
    for (const provider of PASTE_PROVIDERS.filter(p => p !== 'github')) {
      const grammars = collectProviderRefGrammars(provider)
      expect(
        grammars,
        `${provider}'s mechanics state ${grammars.length} distinct KEY-N grammars; one authority ` +
        `means exactly one`,
      ).toHaveLength(1)

      const arm = arms.get(provider)
      expect(arm, `no paste arm for ${provider}`).toBeDefined()
      // The arm is the grammar with the rendered verb spliced in after `^`.
      expect(
        arm,
        `${provider}: the paste gate admits a shape its own mechanics do not state. The gate is a ` +
        `SINK check, not a second authority — widen the provider's grammar or narrow the gate, ` +
        `never let the two drift.\n  gate:      ${arm}\n  mechanics: ${grammars[0]}`,
      ).toBe(grammars[0].replace('^', '^Refs '))
    }
  })

  it('known-bad probe: the grammar collector reads the shipped tree and reports a drift', () => {
    // Non-vacuity: the collector must actually be finding grammars in the
    // shipped tree, or the arm above compares two absences.
    for (const provider of ['jira', 'linear']) {
      expect(
        collectProviderRefGrammars(provider),
        `${provider}: the collector found no grammar, so the arm above proves nothing`,
      ).toHaveLength(1)
    }
    // And a drifted gate is reported rather than tolerated: the linear grammar
    // against the jira arm is exactly the mix-up the overlap makes plausible.
    const [jira] = collectProviderRefGrammars('jira')
    const [linear] = collectProviderRefGrammars('linear')
    expect(jira, 'the two providers must differ, or the drift probe is vacuous').not.toBe(linear)
    expect(jira.replace('^', '^Refs ')).not.toBe(linear.replace('^', '^Refs '))
  })
})

// -------------------------------------------------------------------------
// A supplied ISSUE_PR_LINK is final (#486, finding 3, from #459).
//
// Step 4a decides the closing line of a PR it is handed one for, and a supplied
// value — `(none)` included — is its whole answer: step 4b runs only for an ABSENT
// key. Before this, `(none)` fell through to step 4b, and GitHub's step 4b composed
// a `Closes #{n}` line from a bare number or from the branch name: the same digits
// name a different issue under each provider, so the PR could close the wrong
// issue, or carry two `## Related Issues` headings (4a's empty one and 4b's).
//
// The paragraphs are read from the compiled GitHub reference. Step 4a is written
// once in `_ops_steps.mds` and expanded into every provider's reference, so the
// GitHub copy stands for it; step 4b is each provider's own, so the second describe
// reads all three.
// -------------------------------------------------------------------------

/** The blank-line-bounded paragraph of `ref` that opens with `lead`; '' when none does. */
function paragraphStartingWith(ref: string, lead: string): string {
  return ref.split(/\n[ \t]*\n/).find(p => p.trimStart().startsWith(lead)) ?? ''
}

/** A reference's step 4b, from its heading to step 4c; '' when either bound is absent. */
function step4bOf(ref: string): string {
  const start = ref.indexOf('\n4b. (ALWAYS-ON)')
  const end = ref.indexOf('\n4c. ', start)
  return start === -1 || end === -1 ? '' : ref.slice(start, end)
}

/** Step 4a's refusal line, which step 4b repeats word for word when the Handoff Values line fails the same check. */
const STEP_4A_REFUSAL = 'TRACEABILITY: DEGRADED (issue reference "{ref}" does not match any tracker reference grammar)'

/**
 * Named collector: how a step 4b block composes a closing line itself instead of taking the Handoff Values one,
 * or departs from the one form all three providers share. Step 4b is a single source with no lettered option,
 * no order, no fetch-by-key gate (it makes no tracker call) and no discoverability condition. It renders
 * nothing either: the Handoff Values line reaches it already rendered, so a provider note that renders a
 * key, or names `## Reference Rendering`, tells the step to publish a line the shared text forbids.
 */
function collectStep4bComposition(block: string): string[] {
  const out: string[] = []
  const has = (what: string, found: boolean): void => { if (found) out.push(what) }
  has('a rendering fallback', /render the (key|reference)|`## Reference Rendering`/.test(block))
  has('a branch-name fallback', /branch name pattern/.test(block))
  has('a lettered resolution option', /^\s+[a-z]\. /m.test(block))
  has('a resolution order', /Resolution order/.test(block))
  has('a fetch-by-key gate', /fetch by key/.test(block))
  has('a discoverability condition', /discoverable/.test(block))
  has('a producer that returns no Handoff Values block', /ensure-traceable-issue/.test(block))
  has('a number verified with the tracker CLI', /gh issue view/.test(block))
  has('a line built from a verified issue number', /verified issue number/.test(block))
  if (!/Never compose a line from a bare issue number/.test(block)) out.push('no ban on composing from a bare number')
  if (!block.includes('step 4a\'s shape check')) out.push('no pass through step 4a\'s shape check')
  if (!(block.includes('`setup-task`') && block.includes('`fetch-issue`') && block.includes('### Handoff Values'))) {
    out.push('no Handoff Values source naming setup-task and fetch-issue')
  }
  if (!block.includes(STEP_4A_REFUSAL)) out.push('no refusal outcome in step 4a\'s words')
  if (!block.includes('This step composes no line itself.')) out.push('no statement that step 4b composes no line')
  return out
}

describe('ensure-pr-ready — a supplied ISSUE_PR_LINK is final and step 4b composes nothing (#486, finding 3)', () => {
  const FINAL = paragraphStartingWith(PR_READY, '**A given `ISSUE_PR_LINK` is final.**')
  const NONE = paragraphStartingWith(PR_READY, '`(none)`')

  it('is non-vacuous: the paragraphs and the step 4b block are found', () => {
    expect(FINAL, 'the final-link paragraph').not.toBe('')
    expect(NONE, 'the (none) paragraph').not.toBe('')
    expect(step4bOf(PR_READY), 'the GitHub step 4b block').not.toBe('')
  })

  it('(a) a supplied (none) is final: it gives no reference and never reaches step 4b', () => {
    expect(FINAL, 'a supplied value is final, `(none)` included').toMatch(/When it is given, `\(none\)` included,/)
    expect(FINAL, '`(none)` no longer leaves the answer to step 4b').not.toMatch(/`\(none\)` or absent leaves the answer to step 4b/)
    expect(FINAL, 'the old condition excluded `(none)`').not.toContain('given and not `(none)`')
    expect(FINAL, 'only an absent key reaches step 4b').toContain('Only an absent `ISSUE_PR_LINK` goes to step 4b')
    expect(FINAL, 'an admitted wave block is the section\'s only writer').toContain('no admitted wave block exists')
    expect(NONE, 'an absent block is no longer a `(none)` case — only a supplied value is read here').not.toContain('absent `### Handoff Values` block')
  })

  it('(b) the degraded line shows when ISSUE_NUMBER is set and no line is admitted', () => {
    expect(
      FINAL,
      'a set ISSUE_NUMBER with no admitted line is reported under the registered reason, not left silent',
    ).toMatch(/When `ISSUE_NUMBER` is set and no line is admitted,[^.]*`TRACEABILITY: DEGRADED \(ambiguous issue reference\)`/)
  })

  it('(c) GitHub step 4b has no bare-number composition and no branch-name option', () => {
    const block = step4bOf(PR_READY)
    expect(
      collectStep4bComposition(block),
      'step 4b takes only the Handoff Values line, through the step 4a shape check — it composes no line itself',
    ).toEqual([])
    expect(block, 'the pinned guard: a given link is decided in step 4a').toContain('A given `ISSUE_PR_LINK` is already decided in step 4a: skip the resolution below.')
    expect(block, 'the pinned guard: the section is published through the PR-host half').toContain('Publish the section through step 4b\'s PR-host half.')
  })

  it('(d) none for both keys gives no Related Issues heading, and an empty heading needs ISSUE_NUMBER', () => {
    expect(
      NONE,
      'an unconditional empty heading is what put a heading on issue-less PRs',
    ).not.toContain('emit the `## Related Issues` heading with no reference')
    expect(
      FINAL,
      'with ISSUE_NUMBER `(none)` and no line, the PR body carries no heading',
    ).toMatch(/when it is `\(none\)`, write no heading/)
    expect(
      FINAL,
      'the empty heading belongs to a set ISSUE_NUMBER',
    ).toMatch(/When `ISSUE_NUMBER` is set and no line is admitted, emit the heading with no reference/)
  })

  it('known-bad probes: a branch fallback, a second option and a composing step 4b are each reported', () => {
    const block = step4bOf(PR_READY)
    expect(collectStep4bComposition(block), 'the real block is clean, so each seed fails for its own reason').toEqual([])
    const seeded = `${block}\n   b. If unavailable, fall back to the branch name pattern \`{type}/{number}-{slug}\` and verify with \`gh issue view {n}\`, a verified issue number.`
    expect(collectStep4bComposition(seeded)).toEqual([
      'a branch-name fallback',
      'a lettered resolution option',
      'a number verified with the tracker CLI',
      'a line built from a verified issue number',
    ])
    expect(collectStep4bComposition('4b. Render the line.')).toEqual([
      'no ban on composing from a bare number',
      'no pass through step 4a\'s shape check',
      'no Handoff Values source naming setup-task and fetch-issue',
      'no refusal outcome in step 4a\'s words',
      'no statement that step 4b composes no line',
    ])
    const leftovers: ReadonlyArray<{ seed: string; reports: string }> = [
      { seed: '   Resolution order:', reports: 'a resolution order' },
      { seed: '   The *fetch by key* capability absent or denied ⇒ `TRACEABILITY: DEGRADED (no tracker tool for fetch by key)` and skip the section.', reports: 'a fetch-by-key gate' },
      { seed: '   If no verified issue key is discoverable, skip silently.', reports: 'a discoverability condition' },
      { seed: '   The line is the one `ensure-traceable-issue` returned.', reports: 'a producer that returns no Handoff Values block' },
      { seed: '   `## Reference Rendering` absent, or its token discarded by the gate below ⇒ render the key as the documented default below, on its own line under the section heading, and record the discard under `### Substitutions`.', reports: 'a rendering fallback' },
      { seed: '   Absent or discarded ⇒ render the reference as the documented default below, on its own line under the section heading.', reports: 'a rendering fallback' },
      { seed: '   `## Reference Rendering` names the form of the line\'s token; the check above still decides what is published.', reports: 'a rendering fallback' },
    ]
    for (const { seed, reports } of leftovers) {
      const seeded = `${block}\n${seed}`
      expect(seeded, 'the seed must land').not.toBe(block)
      expect(collectStep4bComposition(seeded), `the seed ${JSON.stringify(seed)} must be reported by name`).toEqual([reports])
    }
    expect(
      collectStep4bComposition(block.replace(STEP_4A_REFUSAL, 'TRACEABILITY: DEGRADED (no line)')),
      'a step 4b that words its refusal differently from step 4a is reported',
    ).toEqual(['no refusal outcome in step 4a\'s words'])
    expect(step4bOf('no step four-b here'), 'an absent block reads as empty, never as a pass').toBe('')
  })
})

describe('ensure-pr-ready — no provider\'s step 4b composes a closing line from a bare number or a branch name (#486, finding 3)', () => {
  const BRANCH_DERIVED = [
    ['the branch-name pattern', /\{type\}\/\{[A-Za-z]+\}-\{slug\}/],
    ['the extract-and-verify instruction', /extract the segment/],
    ['the look-alike token warning', /merely looks like one/],
  ] as const

  /** Named collector: the branch-derived resolution text a provider's step 4b still carries. */
  function collectBranchDerivedText(block: string): string[] {
    return BRANCH_DERIVED.filter(([, pattern]) => pattern.test(block)).map(([what]) => what)
  }

  it.each(PASTE_PROVIDERS)('%s: step 4b takes only the Handoff Values line and composes nothing', provider => {
    const block = step4bOf(ensurePrReadyReference(provider))
    expect(block, `the ${provider} step 4b block`).not.toBe('')
    expect(collectStep4bComposition(block), `${provider} step 4b composes a line itself or departs from the shared form`).toEqual([])
    expect(collectBranchDerivedText(block), `${provider} step 4b still derives a reference from the branch name`).toEqual([])
    expect(block, 'the pinned guard: a given link is decided in step 4a').toContain('A given `ISSUE_PR_LINK` is already decided in step 4a: skip the resolution below.')
    expect(block, 'the pinned guard: the section is published through the PR-host half').toContain('Publish the section through step 4b\'s PR-host half.')
  })

  it('the three providers state one step 4b: the shared sentences are the same bytes in each', () => {
    const SHARED_SENTENCES = [
      'A given `ISSUE_PR_LINK` is already decided in step 4a: skip the resolution below.',
      'the only source is the `PR link line` of the `### Handoff Values` block that `setup-task` or `fetch-issue` returned for this branch.',
      'Publish it only if it passes step 4a\'s shape check.',
      `A line that fails the check is refused as step 4a refuses it, not repaired: emit \`${STEP_4A_REFUSAL}\` and publish nothing.`,
      'This step composes no line itself. Never compose a line from a bare issue number or a branch name.',
      'If no such line exists, skip silently.',
    ]
    for (const provider of PASTE_PROVIDERS) {
      const block = step4bOf(ensurePrReadyReference(provider))
      for (const sentence of SHARED_SENTENCES) {
        expect(block, `${provider} step 4b must carry the shared sentence: ${sentence}`).toContain(sentence)
      }
    }
  })

  it('no tracker source calls the branch-name define, and the define is gone', () => {
    const trackerDir = path.join(ROOT, 'src', 'assets', 'mds', 'tracker')
    const sources = walkFiles(trackerDir, f => f.endsWith('.mds'))
    expect(sources.length, 'non-vacuous: the tracker sources are found').toBeGreaterThan(3)
    const callers = sources.filter(f => fs.readFileSync(f, 'utf-8').includes('ref_preflight_branch')).map(f => path.relative(ROOT, f))
    expect(callers, 'the branch-name define, its export and its callers are removed').toEqual([])
  })

  it('known-bad probes: a seeded branch fallback in each provider is reported by name', () => {
    for (const provider of PASTE_PROVIDERS) {
      const block = step4bOf(ensurePrReadyReference(provider))
      expect(collectBranchDerivedText(block), `${provider}: the real block is clean, so the seed fails for its own reason`).toEqual([])
      const seeded = `${block}\n   b. Otherwise fall back to the branch name pattern \`{type}/{KEY}-{slug}\`: extract the segment and verify it. A branch name can carry a token that merely looks like one.`
      expect(collectBranchDerivedText(seeded), provider).toEqual([
        'the branch-name pattern',
        'the extract-and-verify instruction',
        'the look-alike token warning',
      ])
      expect(collectStep4bComposition(seeded), provider).toEqual(['a branch-name fallback', 'a lettered resolution option'])
    }
  })
})

describe('handoff seam — setup-task and fetch-issue producers ↔ ensure-pr-ready consumer', () => {
  it('both sides spell the two pasted labels identically', () => {
    for (const label of ['- **PR link line**:', '- **Branch token**:']) {
      expect(GIT, `the Git operation references must produce ${label}`).toContain(label)
      expect(PR_READY, `ensure-pr-ready must consume ${label}`).toContain(label)
    }
  })

  it('ISSUE_NUMBER is kept as the spawn key, with its value tied to the ISSUE_ID producer', () => {
    // §14.5: ISSUE_NUMBER (singular) is the spawn key; only its VALUE became
    // provider-canonical. A rename here would silently break the PR-opening spawn,
    // which this file reads below.
    const input = PR_READY.split('\n').find(l => l.startsWith('**Input:**')) ?? ''
    expect(input, 'the spawn key name must not be renamed').toContain('`ISSUE_NUMBER` (optional)')
    expect(
      PR_READY,
      'the input description must tie ISSUE_NUMBER to the producer that supplies it',
    ).toContain('- **Issue ID**: {ISSUE_ID}')
    expect(GIT, 'the Git operation references must produce that exact line').toContain('- **Issue ID**: {ISSUE_ID}')
  })
})

// -------------------------------------------------------------------------
// The forwarding leg (GAP-15, second half), after D-PR-BY-GIT (#448).
//
// The producer↔consumer pair above proves setup-task and fetch-issue emit the PR
// link line and ensure-pr-ready knows how to paste it. It says nothing about the
// wire BETWEEN them. GAP-15's residue was exactly that gap: `issue_capture_contract()`
// captured ISSUE_PR_LINK at the command layer, the consumer knew how to paste it,
// and not one spawn fence forwarded it — the value was captured and dropped, and
// every PR body silently fell back to composing the link itself.
//
// The Code agent opens no PR, so it takes none of the PR keys: no Code spawn
// forwards ISSUE_NUMBER, ISSUE_PR_LINK or PR_EXCEPTIONS (an exact-0 guard). The one
// consumer is the PR-opening Git spawn, so the relation over its fences is: a workflow
// that captures ISSUE_PR_LINK forwards it to its PR-opening Git spawn (D-LINK-FLOOR),
// and every such fence that passes ISSUE_NUMBER passes ISSUE_PR_LINK beside it, so step
// 4b (which runs only for an absent link) never meets a set issue. A workflow
// opens its PR in one of two ways, both named below: /implement passes the link
// itself, /dynamic-build composes a wave block from each ticket's captured
// `issuePrLink` and passes that.
//
// Corpus discipline: the assertion is about DEPLOYED text, so it reads
// dist/. It gets dist/ from buildCommittedTree() — a build of a COPY of the
// committed sources into a temp root — never by rebuilding the repo's own dist/
// from a test writer, which other parallel workers are concurrently reading.
// -------------------------------------------------------------------------

interface SpawnPayload {
  readonly file: string
  /** 1-based line of the key the collector matched. */
  readonly line: number
  /** The contiguous non-blank run of lines the key sits in — one spawn payload. */
  readonly block: string
}

/** The keys only the PR-opening Git spawn takes. A Code spawn carrying one is a PR input with no PR to open. */
const PR_ONLY_KEYS = ['ISSUE_NUMBER', 'ISSUE_PR_LINK', 'PR_EXCEPTIONS'] as const

/**
 * Named collector: the Code spawn sites that carry a PR-only key as a prompt line.
 *
 * A key is a prompt line when it opens a line (after indent and an optional quote or
 * `${…}` template context is irrelevant: the key sits at the line start in both fence
 * shapes the command layer uses). Rendered as `file:line KEY` for the failure message.
 */
function collectCodePrKeyLeaks(file: string, source: string): string[] {
  const keyAtLineStart = new RegExp(`^[ \\t]*"?(${PR_ONLY_KEYS.join('|')}): `, 'm')
  return collectCodeSpawnSites(file, source).flatMap(site => {
    const lines = site.payload.split('\n')
    return lines.flatMap((l, i) => {
      const m = keyAtLineStart.exec(l)
      return m === null ? [] : [`${file}:${site.line + i} ${m[1]}`]
    })
  })
}

/** Every deployed command, as `[name, text]`, from the committed-tree build. */
async function deployedCommands(): Promise<Array<readonly [string, string]>> {
  const { run, root } = await buildCommittedTree()
  expect(run.status, `the committed-tree build must succeed.\n${run.combined}`).toBe(0)
  const names = fs.readdirSync(path.join(root, 'dist', 'commands')).filter(f => f.endsWith('.md'))
  expect(names.length, 'no compiled command — the corpus is empty').toBeGreaterThan(10)
  return names.map(name => [name, requireDistFile(name, root)] as const)
}

describe('no Code spawn forwards a PR input (AC-204, D-PR-BY-GIT)', () => {
  it('ISSUE_NUMBER, ISSUE_PR_LINK and PR_EXCEPTIONS reach no Code spawn in any deployed command — exact 0', async () => {
    const commands = await deployedCommands()
    // Non-vacuity: the three hosts that spawn Code each contribute spawn sites the scan really read.
    const sitesByHost = (host: string): number => {
      const text = commands.find(([name]) => name === host)?.[1] ?? ''
      return collectCodeSpawnSites(host, text).length
    }
    for (const [host, floor] of [['implement.md', 9], ['dynamic-build.md', 8], ['resolve.md', 3]] as const) {
      expect(sitesByHost(host), `${host}: the collector stopped reading Code spawns`).toBeGreaterThanOrEqual(floor)
    }
    expect(
      commands.flatMap(([name, text]) => collectCodePrKeyLeaks(name, text)),
      'a Code spawn carries a key only the PR-opening Git spawn takes — Code opens no PR, so the key is dead weight in its prompt',
    ).toEqual([])
  }, 20_000)

  it('known-bad probe: a PR key seeded into a real Code spawn is reported by the same collector', async () => {
    const commands = await deployedCommands()
    const implement = commands.find(([name]) => name === 'implement.md')?.[1] ?? ''
    expect(collectCodePrKeyLeaks('implement.md', implement), 'the real text is clean, so the seed fails for its own reason').toEqual([])
    for (const key of PR_ONLY_KEYS) {
      const seeded = implement.replace('OPERATION: alignment-fix\n', `OPERATION: alignment-fix\n   ${key}: seeded\n`)
      expect(seeded, `${key}: the seed must land`).not.toBe(implement)
      const leaks = collectCodePrKeyLeaks('implement.md', seeded)
      expect(leaks, key).toHaveLength(1)
      expect(leaks[0]).toMatch(new RegExp(`^implement\\.md:\\d+ ${key}$`))
    }
    // …and a Git spawn carrying the same key is not a Code spawn: Phase 9 passes all three.
    expect(implement).toContain('OPERATION: ensure-pr-ready')
  }, 20_000)
})

describe('src/assets names neither CREATE_PR nor the retired pr-create mode (AC-204)', () => {
  /** Named collector: source files under `root` whose text holds either retired spelling. */
  function collectRetiredPrMode(root: string): string[] {
    return walkFiles(root, () => true, 8)
      .filter(file => /CREATE_PR|pr-create/.test(fs.readFileSync(file, 'utf-8')))
      .map(file => path.relative(root, file))
  }

  it('is clean across every shipped source', () => {
    const root = path.join(path.resolve(import.meta.dirname, '..', '..'), 'src', 'assets')
    expect(walkFiles(root, () => true, 8).length, 'the scan read no file').toBeGreaterThan(100)
    expect(collectRetiredPrMode(root)).toEqual([])
  })

  it('known-bad probe: a source holding either spelling is reported', () => {
    const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'pr-retired-'))
    try {
      fs.writeFileSync(path.join(scratch, 'a.md'), 'CREATE_PR: true\n')
      fs.writeFileSync(path.join(scratch, 'b.md'), 'OPERATION: pr-create\n')
      fs.writeFileSync(path.join(scratch, 'c.md'), 'OPERATION: ensure-pr-ready\n')
      expect(collectRetiredPrMode(scratch).sort()).toEqual(['a.md', 'b.md'])
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  })
})

// -------------------------------------------------------------------------
// D-LINK-FLOOR: a workflow that captures ISSUE_PR_LINK forwards it to its
// PR-opening Git spawn.
//
// "Captures" is read off the deployed text: the command names ISSUE_PR_LINK (the
// issue-capture contract, or the engine's per-ticket binding). "Opens a PR" is an
// `OPERATION: ensure-pr-ready` spawn. A command that does both must carry the link
// into that spawn — the key itself, or, for the wave, the wave block composed from
// the captured links. The named set is cross-checked against discovery both ways,
// so a new capturing PR-opener goes red here until it joins the set.
// -------------------------------------------------------------------------

/** Each capturing PR-opening command, and the spawn key through which it forwards the captured link. */
const LINK_FORWARDERS: Readonly<Record<string, string>> = {
  'implement.md': 'ISSUE_PR_LINK:',
  'dynamic-build.md': 'PR_WAVE_BLOCK:',
}

/**
 * The count of PR-opening Git spawns that pass `ISSUE_PR_LINK:` itself — the floor
 * `issue-pr-link-pr-open-sites`. One: /implement's Phase 9. The wave composes its
 * links into PR_WAVE_BLOCK, which is the other named route and is not counted here.
 */
const MIN_PR_OPEN_SITES = 1

/** Named collector: disagreements between the named forwarders and discovery over a command corpus. */
function collectForwarderDrift(
  corpus: ReadonlyArray<{ readonly name: string; readonly content: string }>,
  named: readonly string[],
): string[] {
  const discovered = corpus
    .filter(c => c.content.includes(ENSURE_PR_READY_OP) && c.content.includes('ISSUE_PR_LINK'))
    .map(c => c.name)
  return [
    ...discovered.filter(n => !named.includes(n)).map(n => `${n}: captures ISSUE_PR_LINK and opens a PR but is not a named forwarder`),
    ...named.filter(n => !discovered.includes(n)).map(n => `${n}: named forwarder no longer captures ISSUE_PR_LINK and opens a PR`),
  ]
}

/** Named collector: PR-opening spawns of a forwarder that lack the key it forwards through. */
function collectUnforwardedPrOpens(file: string, source: string): string[] {
  const key = LINK_FORWARDERS[file]
  if (key === undefined) return [`${file}: not a named forwarder`]
  return collectEnsurePrReadySpawns(file, source)
    .filter(p => !p.block.includes(key))
    .map(p => `${p.file}:${p.line}: the PR-opening spawn does not pass ${key}`)
}

/** A spawn payload line that passes `key`: the key opens the line, after indent and an optional quote. */
function passesKey(block: string, key: string): boolean {
  return new RegExp(`^[ \\t]*"?${key}: `, 'm').test(block)
}

/**
 * Named collector: PR-opening spawns that pass ISSUE_NUMBER but not ISSUE_PR_LINK.
 *
 * Step 4b runs only for an ABSENT ISSUE_PR_LINK. A spawn that sets ISSUE_NUMBER and omits the
 * link would send a set issue to step 4b, whose heading step 4a has already written. Keeping the
 * two keys together is what lets step 4a's final rule leave step 4b nothing to compose.
 */
function collectIssueNumberWithoutLink(payloads: readonly SpawnPayload[]): string[] {
  return payloads
    .filter(p => passesKey(p.block, 'ISSUE_NUMBER') && !passesKey(p.block, 'ISSUE_PR_LINK'))
    .map(p => `${p.file}:${p.line}: the PR-opening spawn passes ISSUE_NUMBER without ISSUE_PR_LINK`)
}

describe('ISSUE_PR_LINK reaches the PR-opening Git spawn (D-LINK-FLOOR)', () => {
  it('every capturing workflow forwards the link into its ensure-pr-ready spawn, and the named set is exactly that set', async () => {
    const commands = await deployedCommands()
    const corpus = commands.map(([name, content]) => ({ name, content }))
    expect(collectForwarderDrift(corpus, Object.keys(LINK_FORWARDERS))).toEqual([])
    for (const [name, content] of commands.filter(([n]) => n in LINK_FORWARDERS)) {
      expect(collectEnsurePrReadySpawns(name, content).length, `${name}: no PR-opening spawn to forward into`).toBeGreaterThan(0)
      expect(collectUnforwardedPrOpens(name, content), name).toEqual([])
    }
  }, 20_000)

  it('(e) every ensure-pr-ready fence that passes ISSUE_NUMBER also passes ISSUE_PR_LINK, and one such fence exists', async () => {
    // A characterization, not a RED case: it holds on the base this fix starts from.
    const commands = await deployedCommands()
    const payloads = commands.flatMap(([name, content]) => collectEnsurePrReadySpawns(name, content))
    const withNumber = payloads.filter(p => passesKey(p.block, 'ISSUE_NUMBER'))
    expect(withNumber.length, 'no fence passes ISSUE_NUMBER, so the relation below holds over nothing').toBeGreaterThan(0)
    expect(collectIssueNumberWithoutLink(payloads)).toEqual([])
  }, 20_000)

  it('known-bad probe: a fence that passes ISSUE_NUMBER and drops ISSUE_PR_LINK is reported', async () => {
    const commands = await deployedCommands()
    const implement = commands.find(([n]) => n === 'implement.md')?.[1] ?? ''
    expect(collectIssueNumberWithoutLink(collectEnsurePrReadySpawns('implement.md', implement)), 'the real fence is clean').toEqual([])
    const dropped = implement.replace(/^ISSUE_PR_LINK: .*\n/m, '')
    expect(dropped, 'the drop seed must land').not.toBe(implement)
    expect(collectIssueNumberWithoutLink(collectEnsurePrReadySpawns('implement.md', dropped))).toHaveLength(1)
  }, 20_000)

  it('the floor: at least issue-pr-link-pr-open-sites PR-opening spawns pass ISSUE_PR_LINK: itself', async () => {
    const commands = await deployedCommands()
    const sites = commands.flatMap(([name, content]) => collectEnsurePrReadySpawns(name, content))
      .filter(p => p.block.includes('ISSUE_PR_LINK:'))
    expect(sites.length, 'the collector found fewer PR-opening spawns than the floor').toBeGreaterThanOrEqual(MIN_PR_OPEN_SITES)
    expect(sites.map(p => p.file), 'only /implement passes the link itself').toEqual(['implement.md'])
  }, 20_000)

  it('known-bad probes: a dropped key, an unnamed capturer and a vanished forwarder are each reported', async () => {
    const commands = await deployedCommands()
    const corpus = commands.map(([name, content]) => ({ name, content }))
    const implement = commands.find(([n]) => n === 'implement.md')?.[1] ?? ''
    const wave = commands.find(([n]) => n === 'dynamic-build.md')?.[1] ?? ''

    const dropped = implement.replace(/^ISSUE_PR_LINK: .*\n/m, '')
    expect(dropped, 'the drop seed must land').not.toBe(implement)
    expect(collectUnforwardedPrOpens('implement.md', dropped)).toHaveLength(1)

    const waveDropped = wave.replace(/^ *PR_WAVE_BLOCK: .*\n/m, '')
    expect(waveDropped, 'the wave drop seed must land').not.toBe(wave)
    expect(collectUnforwardedPrOpens('dynamic-build.md', waveDropped)).toHaveLength(1)

    // A review host that begins to capture the link and open a PR without naming itself.
    const seeded = corpus.map(c => c.name === 'code-review.md' ? { ...c, content: `${c.content}\nISSUE_PR_LINK: {captured}\n` } : c)
    expect(collectForwarderDrift(seeded, Object.keys(LINK_FORWARDERS)))
      .toEqual(['code-review.md: captures ISSUE_PR_LINK and opens a PR but is not a named forwarder'])

    // A named forwarder that stopped capturing the link.
    const lost = corpus.map(c => c.name === 'implement.md' ? { ...c, content: c.content.split('ISSUE_PR_LINK').join('LINK') } : c)
    expect(collectForwarderDrift(lost, Object.keys(LINK_FORWARDERS)))
      .toEqual(['implement.md: named forwarder no longer captures ISSUE_PR_LINK and opens a PR'])
  }, 20_000)
})

// -------------------------------------------------------------------------
// /implement opens its PR through ONE Git ensure-pr-ready spawn, under every
// strategy (D-PR-BY-GIT, #448): a plan that says "the Git agent opens the PR" is a claim
// about the command, so the command is read here.
//
// Phase 9 owns the body: it sits after the gates and before the CI gate, outside
// every strategy branch, so no strategy can end with commits and no PR.
// -------------------------------------------------------------------------

const PHASE9 = '### Phase 9: Open PR'

/** Every key the Phase 9 spawn must carry: each ensure-pr-ready input /implement has a value for. */
const PHASE9_KEYS = [
  'Agent(subagent_type="Git")',
  'OPERATION: ensure-pr-ready',
  'WORKTREE_PATH: {worktree}',
  'BASE_BRANCH:',
  'TASK_ID:',
  'ISSUE_NUMBER:',
  'ISSUE_PR_LINK:',
  'PR_EXCEPTIONS:', // #362: /implement's recorded evidence exception, pasted behind its shape gate
  'PR_TEST_PLAN_BLOCK: {PR_TEST_PLAN_BLOCK verbatim, or (none)}', // #363: pasted behind `check block`
  'PR_DESCRIPTION_GUIDANCE:', // D-PR-BODY-FROM-HANDOFF: the Code agents' reports are the body's material
  'APPLY_CONVENTIONS:',
  'COMMIT_UNCOMMITTED: false', // D-COMMIT-EXPLICIT
] as const

/** The phase order the PR opening relies on: gates, then Phase 9, then the CI gate, evidence, report. */
const PHASE9_ORDER = [
  { label: 'Phase 9 follows the re-validate phase', before: '### Phase 8: Re-Validate', after: PHASE9 },
  { label: 'the CI gate follows Phase 9', before: PHASE9, after: '### Phase 10: CI Status Gate' },
  { label: 'evidence follows the CI gate', before: '### Phase 10: CI Status Gate', after: '### Phase 11: Evidence' },
  { label: 'the report follows evidence', before: '### Phase 11: Evidence', after: '### Phase 12: Report' },
] as const

/** Named collector: what /implement's PR opening lacks — exactly one Git spawn, in Phase 9, outside the strategies. */
function collectPhase9Defects(source: string): string[] {
  const out: string[] = []
  const spawns = collectEnsurePrReadySpawns('implement.md', source)
  if (spawns.length !== 1) return [`expected one ensure-pr-ready spawn, found ${spawns.length}`]
  for (const key of PHASE9_KEYS) {
    if (!spawns[0].block.includes(key)) out.push(`the spawn does not pass ${key}`)
  }
  out.push(...collectOrderViolations('implement.md', source, PHASE9_ORDER))
  const start = source.indexOf(PHASE9)
  const end = source.indexOf('### Phase 10: CI Status Gate')
  if (start === -1 || end === -1 || end < start) return [...out, 'no Phase 9 section before the CI gate']
  const phase = source.slice(start, end)
  if (!phase.includes('OPERATION: ensure-pr-ready')) out.push('the spawn is not inside Phase 9')
  if (!phase.includes('under every strategy')) out.push('Phase 9 does not run under every strategy')
  if (/\*\*(SINGLE|SEQUENTIAL|PARALLEL)_CODE_AGENTS?\*\*/.test(phase)) out.push('Phase 9 sits inside a strategy branch')
  if (/Agent\(subagent_type="Code"\)/.test(phase)) out.push('Phase 9 spawns a Code agent')
  return out
}

describe('/implement Phase 9 — one Git ensure-pr-ready spawn, outside every strategy (AC-201, AC-202)', () => {
  it('opens the PR once, with every PR input, after the gates and before the CI gate', async () => {
    const { root } = await buildCommittedTree()
    const implement = requireDistFile('implement.md', root)
    expect(implement.length, 'the deployed command is empty').toBeGreaterThan(10_000)
    expect(collectPhase9Defects(implement)).toEqual([])
    expect(implement, 'the retired orchestrator-run PR creation').not.toContain('run `gh pr create`')
  }, 20_000)

  it('known-bad probes: a lost spawn, a dropped key, a strategy-bound phase and a Code spawn are reported', async () => {
    const { root } = await buildCommittedTree()
    const real = requireDistFile('implement.md', root)

    const lost = real.replace('OPERATION: ensure-pr-ready', 'OPERATION: validate-branch')
    expect(lost, 'the lost-spawn seed must land').not.toBe(real)
    expect(collectPhase9Defects(lost)).toEqual(['expected one ensure-pr-ready spawn, found 0'])

    for (const key of ['COMMIT_UNCOMMITTED: false', 'ISSUE_PR_LINK:', 'PR_EXCEPTIONS:']) {
      const dropped = real.replace(new RegExp(`^${key}.*\\n`, 'm'), '')
      expect(dropped, `${key}: the drop seed must land`).not.toBe(real)
      expect(collectPhase9Defects(dropped), key).toContain(`the spawn does not pass ${key}`)
    }

    const bound = real.replace(PHASE9, `${PHASE9}\n\n**SINGLE_CODE_AGENT**: only`)
    expect(collectPhase9Defects(bound)).toContain('Phase 9 sits inside a strategy branch')

    const coded = real.replace(PHASE9, `${PHASE9}\n\nAgent(subagent_type="Code")`)
    expect(collectPhase9Defects(coded)).toContain('Phase 9 spawns a Code agent')

    // A Phase 9 emptied of its spawn is reported, and so is the CI gate running before the PR exists.
    const emptied = real.replace(PHASE9, '### Phase 9 later').replace('### Phase 10: CI Status Gate', `${PHASE9}\n\n### Phase 10: CI Status Gate`)
    expect(collectPhase9Defects(emptied)).toContain('the spawn is not inside Phase 9')
    const reordered = real.replace(PHASE9, '@@swap@@').replace('### Phase 10: CI Status Gate', PHASE9).replace('@@swap@@', '### Phase 10: CI Status Gate')
    expect(reordered, 'the reorder seed must land').not.toBe(real)
    const reorderedDefects = collectPhase9Defects(reordered)
    expect(reorderedDefects).toContain('no Phase 9 section before the CI gate')
    expect(reorderedDefects.some(d => d.includes('[the CI gate follows Phase 9]'))).toBe(true)
  }, 20_000)
})

describe('ensure-pr-ready opens the PR (D-LINK-VERBATIM, D-COMMIT-EXPLICIT, D-PR-EXISTS)', () => {
  /** The six inputs #448 added to the operation, all optional. */
  const NEW_INPUTS = ['BASE_BRANCH', 'TASK_ID', 'ISSUE_NUMBER', 'ISSUE_PR_LINK', 'PR_EXCEPTIONS', 'COMMIT_UNCOMMITTED'] as const

  /** Named collector: what one provider's ensure-pr-ready reference lacks of the PR-opening rules. */
  function collectPrOpenDefects(ref: string): string[] {
    const out: string[] = []
    const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
    const input = ref.split('\n').find(l => l.startsWith('**Input:**')) ?? ''
    for (const key of NEW_INPUTS) need(`the Input line does not declare ${key} as optional`, input.includes(`\`${key}\` (optional)`))
    need('a given link is final, pasted without step 4b resolving',
      ref.includes("**A given `ISSUE_PR_LINK` is final.**") && ref.includes('step 4b does not resolve a number'))
    need('a given none is final too, and only an absent link reaches step 4b',
      ref.includes('When it is given, `(none)` included,') && ref.includes('Only an absent `ISSUE_PR_LINK` goes to step 4b'))
    need('step 4b skips its resolution for a given link', /4b\. \(ALWAYS-ON\)[^\n]*A given `ISSUE_PR_LINK` is already decided in step 4a: skip the resolution/.test(ref))
    need('COMMIT_UNCOMMITTED defaults to true', ref.includes('`COMMIT_UNCOMMITTED` is `true` when absent'))
    need('false commits nothing and lists the stray files', ref.includes('When it is `false`, commit nothing') && ref.includes('list each uncommitted path under `### Uncommitted files`'))
    need('false opens the PR from HEAD', ref.includes('step 4a opens the PR from HEAD'))
    need('the Output template carries the uncommitted-files section', ref.includes('### Uncommitted files\n{only when `COMMIT_UNCOMMITTED` is `false`'))
    need('a failed scrub still creates the PR with a minimal body', ref.includes('**On scrubber failure** (non-zero exit or script missing): still create the PR — PR existence is the deliverable'))
    need('the degraded line is the redaction one', ref.includes('plus the literal line `TRACEABILITY: DEGRADED (redaction unavailable)`'))
    need('the raw body is never posted', ref.includes('Never post `$DEVFLOW_BODY_RAW`.'))
    need('a given base is checked by reading, written to a fresh temp file with the Write tool and read back, and an empty file opens no PR',
      ref.includes('When `BASE_BRANCH` is given, check it first against the step-5a name check (judge the match by reading; never pass the value to a command).') &&
      ref.includes('Read that file, Write `BASE_BRANCH` to it with the Write tool, and Read it back.') &&
      ref.includes('An empty file ends with Status BLOCKED and no PR, after `rm -- "{name file}"`.'))
    // The 4a base, the 4c title and the 5a name each have a Write step.
    need('a failed Write is a missing value, never a shell write', ref.split('If the Write tool fails, treat the value as missing; never write it with a shell command.').length - 1 >= 3)
    need('the base reaches gh pr create only from the name file', ref.includes('`test -s "$F" && gh pr create … --base="$(cat -- "$F")"`') && (ref.match(/gh pr create[^\n`]*--base\S*/g) ?? []).every(call => call.endsWith('--base="$(cat')))
    need('the name file is removed after the last create attempt, so a scrubber failure still opens the PR with the given base',
      ref.includes('in that same shell and after the last create attempt, `rm -- "$F"`, which runs on every path'))
    need('the D11 trap is unchanged and no second exit trap is armed for the base', ref.includes('The D11 trap stays unchanged: its rm list does not gain the name file, and no second EXIT trap is armed.'))
    need('exactly one test-plan check', ref.split('check block').length - 1 === 1)
    return out
  }

  it('every provider carries the PR-opening rules', () => {
    for (const provider of ['github', 'jira', 'linear']) {
      expect(collectPrOpenDefects(ensurePrReadyReference(provider)), provider).toEqual([])
    }
  })

  it('known-bad probes: each lost rule is reported by name', () => {
    const real = ensurePrReadyReference()
    const seeds: ReadonlyArray<{ from: string; to: string; expected: string }> = [
      { from: ' A given `ISSUE_PR_LINK` is already decided in step 4a: skip the resolution below.', to: '', expected: 'step 4b skips its resolution for a given link' },
      { from: 'Only an absent `ISSUE_PR_LINK` goes to step 4b', to: 'An absent or `(none)` `ISSUE_PR_LINK` goes to step 4b', expected: 'a given none is final too, and only an absent link reaches step 4b' },
      { from: '`COMMIT_UNCOMMITTED` is `true` when absent', to: '`COMMIT_UNCOMMITTED` is `false` when absent', expected: 'COMMIT_UNCOMMITTED defaults to true' },
      { from: 'When it is `false`, commit nothing', to: 'When it is `false`, commit anyway', expected: 'false commits nothing and lists the stray files' },
      { from: '**On scrubber failure** (non-zero exit or script missing): still create the PR — PR existence is the deliverable', to: '**On scrubber failure** (non-zero exit or script missing): create no PR', expected: 'a failed scrub still creates the PR with a minimal body' },
      { from: 'plus the literal line `TRACEABILITY: DEGRADED (redaction unavailable)`', to: 'plus a warning', expected: 'the degraded line is the redaction one' },
      { from: '--base="$(cat -- "$F")"', to: '--base "$BASE_BRANCH"', expected: 'the base reaches gh pr create only from the name file' },
      { from: 'Read that file, Write `BASE_BRANCH` to it with the Write tool, and Read it back.', to: 'Run `printf "%s" "$BASE_BRANCH" > "$F"`.', expected: 'a given base is checked by reading, written to a fresh temp file with the Write tool and read back, and an empty file opens no PR' },
      { from: 'If the Write tool fails, treat the value as missing; never write it with a shell command.', to: 'If the Write tool fails, write it with a shell command.', expected: 'a failed Write is a missing value, never a shell write' },
      { from: 'after the last create attempt, `rm -- "$F"`', to: 'after the first create attempt, `rm -- "$F"`', expected: 'the name file is removed after the last create attempt, so a scrubber failure still opens the PR with the given base' },
      { from: 'and no second EXIT trap is armed', to: 'and a second EXIT trap is armed', expected: 'the D11 trap is unchanged and no second exit trap is armed for the base' },
      { from: '`ISSUE_PR_LINK` (optional), ', to: '', expected: 'the Input line does not declare ISSUE_PR_LINK as optional' },
    ]
    for (const seed of seeds) {
      const wounded = real.replace(seed.from, seed.to)
      expect(wounded, `${seed.expected}: the seed must land`).not.toBe(real)
      expect(collectPrOpenDefects(wounded), seed.expected).toContain(seed.expected)
    }
    // A second test-plan check is the duplicate the merge exists to prevent.
    expect(collectPrOpenDefects(`${real}\nrun check block again`)).toContain('exactly one test-plan check')
  })
})

// -------------------------------------------------------------------------
// PR_TEST_PLAN_BLOCK forwarding — every ensure-pr-ready spawn carries it (#365, AC-5).
//
// ensure-pr-ready creates the PR for /code-review and /bug-analysis, and step
// 4a pastes a caller's test-plan block behind `check block`. A fence that drops
// the key leaves that paste with nothing to paste, silently: the PR opens with
// no test plan and nothing reports it. Each caller renders the block from
// /implement's evidence file alone (D8), with the branch slug shape-gated and
// the path double-quoted, so the slug never reaches a shell unchecked.
//
// The caller set is NAMED and then cross-checked against discovery over every
// compiled command, both ways: a new ensure-pr-ready caller goes red here until it
// joins the named set — and with it this arm. /dynamic-build joined with its wave
// PR (#365 P3), which also passes the wave block; its test-plan block comes from
// the wave's own evidence file, rendered after the workflow (not /implement's).
// -------------------------------------------------------------------------

/** The two review hosts: they render the test-plan block from /implement's evidence file (D8). */
const REVIEW_CALLERS: readonly string[] = ['code-review.md', 'bug-analysis.md']

/** The wave host: it renders the test-plan block from the wave evidence file, and passes the wave block. */
const WAVE_CALLER = 'dynamic-build.md'

/** The pipeline host: its Phase 9 opens the PR and passes /implement's own PR_TEST_PLAN_BLOCK, rendered in Phase 1. */
const IMPLEMENT_CALLER = 'implement.md'

/** The deployed commands that spawn ensure-pr-ready. Named, and cross-checked against discovery. */
const ENSURE_PR_READY_CALLERS: readonly string[] = [...REVIEW_CALLERS, WAVE_CALLER, IMPLEMENT_CALLER]

const ENSURE_PR_READY_OP = 'OPERATION: ensure-pr-ready'

/**
 * Named collector: every spawn payload that runs `OPERATION: ensure-pr-ready`.
 *
 * Blank-line bounded, the unit `collectIssueSpawnPayloads` reads, so one fence is
 * one payload. Bounded: a corpus with more sites than MAX_SITES is reported
 * rather than silently truncated.
 */
function collectEnsurePrReadySpawns(file: string, source: string): SpawnPayload[] {
  const MAX_SITES = 16
  const lines = source.split('\n')
  const payloads: SpawnPayload[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(ENSURE_PR_READY_OP)) continue
    let start = i
    while (start > 0 && lines[start - 1].trim() !== '') start--
    let end = i
    while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++
    if (payloads.length >= MAX_SITES) {
      throw new Error(`${file}: more than ${MAX_SITES} ${ENSURE_PR_READY_OP} sites — bound exceeded, scan aborted`)
    }
    payloads.push({ file, line: i + 1, block: lines.slice(start, end + 1).join('\n') })
  }
  return payloads
}

/**
 * Named collector: disagreements between the named caller set and discovery over
 * a command corpus — an unnamed spawner, or a named file that no longer spawns.
 */
function collectCallerDrift(
  corpus: ReadonlyArray<{ readonly name: string; readonly content: string }>,
  named: readonly string[],
): string[] {
  const discovered = corpus.filter(c => c.content.includes(ENSURE_PR_READY_OP)).map(c => c.name)
  return [
    ...discovered.filter(n => !named.includes(n)).map(n => `${n}: spawns ensure-pr-ready but is not a named caller`),
    ...named.filter(n => !discovered.includes(n)).map(n => `${n}: named caller spawns no ensure-pr-ready`),
  ]
}

/** The ensure-pr-ready payloads that do not pass the test-plan block — rendered for the failure message. */
function collectUnforwardedTestPlanSites(payloads: readonly SpawnPayload[]): string[] {
  return payloads.filter(p => !p.block.includes('PR_TEST_PLAN_BLOCK:')).map(p => `${p.file}:${p.line}`)
}

/** The caller's render paragraph: from its lead to the spawn it feeds. */
function testPlanRenderText(source: string): string | null {
  const at = source.indexOf('Render the test-plan block')
  if (at === -1) return null
  const end = source.indexOf(ENSURE_PR_READY_OP, at)
  return end === -1 ? null : source.slice(at, end)
}

/** The render command each caller runs: the slug-built path, double-quoted, then its exit code. */
const QUOTED_RENDER_RE = /verify-evidence\.cjs" render --plan "[^"\s]*\.devflow\/docs\/evidence-\{branch_slug\}\.md"; echo "exit=\$\?"/

/** Named collector: what a caller's PR_TEST_PLAN_BLOCK rendering fails to state. */
function collectTestPlanRenderDefects(file: string, source: string): string[] {
  const text = testPlanRenderText(source)
  if (text === null) return [`${file}: no test-plan render before the ensure-pr-ready spawn`]
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(`${file}: ${what}`) }
  need('the block comes from /implement\'s evidence file alone', text.includes("from `/implement`'s evidence file, and from nothing else"))
  need('the slug is shape-gated', text.includes('Only when `branch_slug` matches `^[A-Za-z0-9._-]{1,200}$`'))
  need('the evidence path is double-quoted', QUOTED_RENDER_RE.test(text))
  need('only `exit=0` yields the block, else `(none)`',
    text.includes('On `exit=0`, `PR_TEST_PLAN_BLOCK` is its stdout byte for byte without that `exit=` line; in every other case it is `(none)`'))
  return out
}

/** The lead of the wave's step 3(b), which renders its test-plan block. */
const WAVE_TEST_PLAN_LEAD = '**(b) The wave test plan.**'

/** The wave's step 3(b): from its lead to the ensure-pr-ready spawn it feeds. */
function waveTestPlanText(source: string): string | null {
  const at = source.indexOf(WAVE_TEST_PLAN_LEAD)
  if (at === -1) return null
  const end = source.indexOf(ENSURE_PR_READY_OP, at)
  return end === -1 ? null : source.slice(at, end)
}

/**
 * The wave's slug gate: the branch check that names `{slug}`. The evidence path is
 * built from that slug, so the gate must come before the path is.
 */
const WAVE_SLUG_GATE = 'Only a name matching `^wave/[a-z0-9][a-z0-9-]{0,59}$` opens a wave PR, and its part after `wave/` is the `{slug}` below'

/** The wave's two commands over the slug-built evidence path, verbatim: double-quoted, each read by its exit code. */
const WAVE_EVIDENCE_PATH = '"{integration worktree root}/.devflow/docs/evidence-wave-{slug}.md"'
const WAVE_CHECK = `verify-evidence.cjs" check tp ${WAVE_EVIDENCE_PATH}; echo "exit=$?"`
const WAVE_RENDER = `verify-evidence.cjs" render --plan ${WAVE_EVIDENCE_PATH}; echo "exit=$?"`

/** Named collector: what the wave caller's PR_TEST_PLAN_BLOCK rendering fails to state. */
function collectWaveTestPlanRenderDefects(file: string, source: string): string[] {
  const text = waveTestPlanText(source)
  if (text === null) return [`${file}: no wave test-plan render before the ensure-pr-ready spawn`]
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(`${file}: ${what}`) }
  const gateAt = source.indexOf(WAVE_SLUG_GATE)
  need('the slug is shape-gated by the wave branch check, before the path is built', gateAt !== -1 && gateAt < source.indexOf(WAVE_TEST_PLAN_LEAD))
  need('the evidence path is checked, double-quoted', text.includes(WAVE_CHECK))
  need('the evidence path is rendered, double-quoted', text.includes(WAVE_RENDER))
  need('only two `exit=0` yield the block, else `(none)`',
    text.includes('Only when both exit 0 is `PR_TEST_PLAN_BLOCK` the render\'s stdout, byte for byte without its `exit=` line; in every other case it is `(none)`'))
  return out
}

/** The wave block key, as the one caller that has a wave block passes it. */
const WAVE_BLOCK_KEY = 'PR_WAVE_BLOCK: {PR_WAVE_BLOCK verbatim}'

/** Named collector: ensure-pr-ready payloads whose wave-block key disagrees with their caller — the wave must pass it, a review host must not. */
function collectWaveBlockKeyDrift(payloads: readonly SpawnPayload[]): string[] {
  return payloads.flatMap(p => {
    const carries = p.block.includes('PR_WAVE_BLOCK:')
    if (p.file === WAVE_CALLER && !p.block.includes(WAVE_BLOCK_KEY)) return [`${p.file}:${p.line}: the wave spawn does not pass ${WAVE_BLOCK_KEY}`]
    if (p.file !== WAVE_CALLER && carries) return [`${p.file}:${p.line}: a review host passes PR_WAVE_BLOCK, which only the wave has`]
    return []
  })
}

describe('PR_TEST_PLAN_BLOCK forwarding — every ensure-pr-ready spawn carries the key (AC-5)', () => {
  it('the named caller set is exactly the compiled commands that spawn ensure-pr-ready', async () => {
    const { run, root } = await buildCommittedTree()
    expect(run.status, `the committed-tree build must succeed.\n${run.combined}`).toBe(0)
    const corpus = fs.readdirSync(path.join(root, 'dist', 'commands'))
      .filter(f => f.endsWith('.md'))
      .map(name => ({ name, content: requireDistFile(name, root) }))
    expect(corpus.length, 'no compiled command — the discovery corpus is empty').toBeGreaterThan(10)
    expect(
      collectCallerDrift(corpus, ENSURE_PR_READY_CALLERS),
      'an ensure-pr-ready caller outside the named set is a spawn this seam never reads — add it to ' +
      'ENSURE_PR_READY_CALLERS (and give it the key); a named caller that no longer spawns is a stale entry',
    ).toEqual([])

    // Known-bad probe: a new spawner outside the set, and a named caller that lost its spawn.
    const seeded = corpus.map(c =>
      c.name === 'resolve.md' ? { ...c, content: `${c.content}\n"${ENSURE_PR_READY_OP}\n` }
      : c.name === 'bug-analysis.md' ? { ...c, content: c.content.split(ENSURE_PR_READY_OP).join('OPERATION: validate-branch') }
      : c)
    expect(collectCallerDrift(seeded, ENSURE_PR_READY_CALLERS)).toEqual([
      'resolve.md: spawns ensure-pr-ready but is not a named caller',
      'bug-analysis.md: named caller spawns no ensure-pr-ready',
    ])
    // …and the wave caller dropped from the named set is the drift this arm first caught (#365 P3),
    // /implement's Phase 9 (#448) the one after it.
    expect(collectCallerDrift(corpus, REVIEW_CALLERS)).toEqual([
      `${WAVE_CALLER}: spawns ensure-pr-ready but is not a named caller`,
      `${IMPLEMENT_CALLER}: spawns ensure-pr-ready but is not a named caller`,
    ])
  }, 20_000) // pays for the memoised committed-tree build.

  it('every ensure-pr-ready spawn passes PR_TEST_PLAN_BLOCK', async () => {
    const { root } = await buildCommittedTree()
    const payloads = ENSURE_PR_READY_CALLERS.flatMap(name => collectEnsurePrReadySpawns(name, requireDistFile(name, root)))
    for (const name of ENSURE_PR_READY_CALLERS) {
      expect(payloads.some(p => p.file === name), `${name} contributed no ensure-pr-ready spawn`).toBe(true)
    }
    expect(
      collectUnforwardedTestPlanSites(payloads),
      'ensure-pr-ready spawn(s) without PR_TEST_PLAN_BLOCK — step 4a would have no test plan to paste',
    ).toEqual([])
    for (const p of payloads) {
      expect(p.block, `${p.file}:${p.line}: the key must carry the rendered value or (none)`)
        .toContain('PR_TEST_PLAN_BLOCK: {PR_TEST_PLAN_BLOCK verbatim, or (none)}')
    }
  }, 20_000)

  it('each review caller renders the block from /implement\'s evidence file, slug-gated and quoted, before the spawn', async () => {
    const { root } = await buildCommittedTree()
    expect(REVIEW_CALLERS.flatMap(name => collectTestPlanRenderDefects(name, requireDistFile(name, root))))
      .toEqual([])
  }, 20_000)

  it('the wave caller renders the block from the wave evidence file, slug-gated and quoted, before the spawn', async () => {
    const { root } = await buildCommittedTree()
    expect(collectWaveTestPlanRenderDefects(WAVE_CALLER, requireDistFile(WAVE_CALLER, root))).toEqual([])
  }, 20_000)

  it('the wave spawn passes PR_WAVE_BLOCK, and no review host does', async () => {
    const { root } = await buildCommittedTree()
    const payloads = ENSURE_PR_READY_CALLERS.flatMap(name => collectEnsurePrReadySpawns(name, requireDistFile(name, root)))
    expect(payloads.filter(p => p.file === WAVE_CALLER), 'the wave caller has exactly one ensure-pr-ready spawn').toHaveLength(1)
    expect(collectWaveBlockKeyDrift(payloads)).toEqual([])
  }, 20_000)

  it('known-bad probes: the wave spawn losing its wave block, and a review host gaining one, are reported', async () => {
    const { root } = await buildCommittedTree()
    const wave = requireDistFile(WAVE_CALLER, root)
    const dropped = wave.replace(/^ *PR_WAVE_BLOCK: .*\n/m, '')
    expect(dropped, 'the drop seed must land').not.toBe(wave)
    expect(collectWaveBlockKeyDrift(collectEnsurePrReadySpawns(WAVE_CALLER, dropped))).toHaveLength(1)

    const review = requireDistFile('code-review.md', root)
    const gained = review.replace(/^(PR_TEST_PLAN_BLOCK: .*)$/m, '$1\nPR_WAVE_BLOCK: {PR_WAVE_BLOCK verbatim}')
    expect(gained, 'the gain seed must land').not.toBe(review)
    expect(collectWaveBlockKeyDrift(collectEnsurePrReadySpawns('code-review.md', gained))).toEqual([
      expect.stringContaining('a review host passes PR_WAVE_BLOCK'),
    ])
  }, 20_000)

  it('known-bad probes: the wave render unquoted, ungated, or missing is reported', async () => {
    const { root } = await buildCommittedTree()
    const real = requireDistFile(WAVE_CALLER, root)

    const unquoted = real.replace(/render --plan "([^"]*)"/, 'render --plan $1')
    expect(unquoted, 'the unquoting seed must land').not.toBe(real)
    expect(collectWaveTestPlanRenderDefects(WAVE_CALLER, unquoted)).toEqual([`${WAVE_CALLER}: the evidence path is rendered, double-quoted`])

    const ungated = real.replace(WAVE_SLUG_GATE, 'Any name opens a wave PR')
    expect(ungated, 'the gate seed must land').not.toBe(real)
    expect(collectWaveTestPlanRenderDefects(WAVE_CALLER, ungated))
      .toEqual([`${WAVE_CALLER}: the slug is shape-gated by the wave branch check, before the path is built`])

    const unchecked = real.replace(/^node .*check tp .*evidence-wave.*\n/m, '')
    expect(unchecked, 'the check seed must land').not.toBe(real)
    expect(collectWaveTestPlanRenderDefects(WAVE_CALLER, unchecked)).toEqual([`${WAVE_CALLER}: the evidence path is checked, double-quoted`])

    expect(collectWaveTestPlanRenderDefects(WAVE_CALLER, real.replace(WAVE_TEST_PLAN_LEAD, '**(b) The plan.**')))
      .toEqual([`${WAVE_CALLER}: no wave test-plan render before the ensure-pr-ready spawn`])
  }, 20_000)

  it('known-bad probes: a dropped key, an unquoted path and an ungated slug are reported', async () => {
    const { root } = await buildCommittedTree()
    const real = requireDistFile('code-review.md', root)

    const dropped = real.replace(/^PR_TEST_PLAN_BLOCK: .*\n/m, '')
    expect(dropped, 'the drop seed must land').not.toBe(real)
    const sites = collectUnforwardedTestPlanSites(collectEnsurePrReadySpawns('code-review.md', dropped))
    expect(sites.length, 'dropping the key must leave exactly one site unforwarded').toBe(1)

    const unquoted = real.replace(/render --plan "([^"]*)"/, 'render --plan $1')
    expect(unquoted, 'the unquoting seed must land').not.toBe(real)
    expect(collectTestPlanRenderDefects('code-review.md', unquoted)).toEqual(['code-review.md: the evidence path is double-quoted'])

    const ungated = real.replace('Only when `branch_slug` matches `^[A-Za-z0-9._-]{1,200}$` and', 'When')
    expect(ungated, 'the gate seed must land').not.toBe(real)
    expect(collectTestPlanRenderDefects('code-review.md', ungated)).toEqual(['code-review.md: the slug is shape-gated'])

    expect(collectTestPlanRenderDefects('bug-analysis.md', real.replace('Render the test-plan block', 'Render the block')))
      .toEqual(['bug-analysis.md: no test-plan render before the ensure-pr-ready spawn'])
  }, 20_000)
})
