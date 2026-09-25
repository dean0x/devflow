import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { buildCommittedTree, cleanupCommittedTree, requireDistFile, resolveAgentSource, walkFiles } from '../helpers.js'
import { compiledSkillRefsDir } from '../../src/core/assets.js'

/** The generated `devflow:git` reference tree — the providers' own mechanics. */
const REFS_DIR = compiledSkillRefsDir()

// -------------------------------------------------------------------------
// `### Handoff Values` — Git agent producer ↔ Code agent consumer (P2-S10, GAP-15).
//
// GAP-15 found `ISSUE_PR_LINK` and `ISSUE_BRANCH_TOKEN` consumed with no
// producer anywhere: the Code agent's ALWAYS-ON `Closes #{n}` rule had nothing
// to paste, and failed silently on the GitHub path too. T2b added the producers
// to setup-task and fetch-issue; this file pins both ends of that seam so a
// later edit cannot drop one side and leave the other looking healthy.
//
// The failure mode a one-sided guard misses: a guard that only checks git.md
// stays green when code.md stops consuming the block, and a guard that only
// checks code.md stays green when git.md stops emitting it. Either way the PR
// body silently loses its issue link — the exact defect, restored.
//
// Read targets are resolved through resolveAgentSource (never a literal
// src/assets/agents/ path — AC-0.7): git.md is compiled from an MDS generator
// host, code.md is hand-authored, and the resolver knows the difference.
//
// Header doctrine and framing copied from tests/resolve/duplicate-verdict.test.ts:4-15
// (the repo's original two-sided producer/consumer test).
// -------------------------------------------------------------------------

const GIT = resolveAgentSource('git').content
const CODE = resolveAgentSource('code').content

afterAll(cleanupCommittedTree)

/** The three producer lines, verbatim as git.md emits them under ### Handoff Values. */
const PRODUCER_LINES = [
  '- **PR link line**: {rendered}',
  '- **Branch token**: {token}',
  '- **Issue ID**: {ISSUE_ID}',
] as const

describe('git.md — ### Handoff Values producer block', () => {
  it('is non-vacuous', () => {
    expect(GIT.length).toBeGreaterThan(10000)
  })

  it('emits all three handoff values under a ### Handoff Values heading', () => {
    expect(GIT, 'the producer block must be headed so a reader can find it').toContain('### Handoff Values')
    for (const line of PRODUCER_LINES) {
      expect(
        GIT,
        `git.md must emit ${line} — the Code agent reads it by this exact label, not by prose`,
      ).toContain(line)
    }
  })

  it('emits the block from both issue-returning operations, not just one', () => {
    // setup-task and fetch-issue are separate entry points into /implement.
    // A block on only one of them makes the Code agent's paste rule depend on
    // which command the user ran.
    const count = GIT.split('### Handoff Values').length - 1
    expect(
      count,
      'both setup-task and fetch-issue must carry the block — one copy means one of the two entry points returns nothing to paste',
    ).toBeGreaterThanOrEqual(2)
  })
})

describe('code.md — ### Handoff Values consumer', () => {
  it('is non-vacuous', () => {
    expect(CODE.length).toBeGreaterThan(5000)
  })

  it('names the PR-link producer by its producer label', () => {
    expect(
      CODE,
      'the consumer must name `- **PR link line**:` — naming only the variable would not survive a producer relabel',
    ).toContain('- **PR link line**:')
    expect(
      CODE,
      'the consumer must name `- **Branch token**:` for the same reason',
    ).toContain('- **Branch token**:')
  })

  it('re-checks the shape before pasting, and degrades instead of coercing', () => {
    expect(
      CODE,
      'the PR body is a GitHub-visible sink; a returned value is still attacker-influenceable at the paste site',
    ).toContain('^Closes #[1-9][0-9]{0,8}$')
    expect(
      CODE,
      'a malformed ref must emit a DEGRADED reason, never be silently repaired or dropped',
    ).toContain('does not match any tracker reference grammar')
  })

  it('re-checks BEFORE it pastes — order, not mere presence', () => {
    const recheck = CODE.indexOf('after re-checking its shape against the tracker reference grammars')
    const degraded = CODE.indexOf('does not match any tracker reference grammar')
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
// It then became one arm per RESOLVED provider — but the Code agent is never
// told the provider (#359, G3): the command layer holds no provider knowledge
// and forwards the Git agent's rendered line verbatim. So the gate is a
// provider-free UNION: a value is pasted when it matches any one row. That is a
// sink check on the line's shape; the Git agent, which did resolve the
// provider, is what chose the grammar.
//
// The arms are read OUT of the prompt and RUN here rather than re-typed. A
// hand-copied grammar in a test is a second authority that agrees with the first
// only until one of them is edited (PF-018), and an anchored pattern is exactly
// the kind of literal whose defect — a missing `^`, a `+` where `{0,8}` was
// meant — is invisible to a reader and obvious to anything that executes it.
// -------------------------------------------------------------------------

/** The providers whose `ISSUE_PR_LINK` the Code agent may be handed. Named, not discovered. */
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

describe('code.md — the paste gate, one row per tracker grammar', () => {
  it('states an anchored arm for every provider, and no arm for anything else', () => {
    const arms = collectPasteArms(CODE)
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
    const arms = collectPasteArms(CODE)
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
      CODE,
      'a value carrying a newline must be refused in words — a `$` that some engines read as ' +
      'end-of-line would admit everything after the first line into the PR body as free text',
    ).toMatch(/reject(?:s|ed)?[\s\S]{0,120}?(newline|multi-line)/i)
    expect(CODE, 'the arms must carry an explicit length bound').toMatch(/60 characters/)
  })

  it('(none) is not a mismatch, and is never recomposed from a bare number', () => {
    expect(
      CODE,
      '`(none)` means no line was captured, which is the documented absent case — degrading over ' +
      'it would report a malformed value every time a task has no issue',
    ).toMatch(/`\(none\)`[\s\S]{0,200}?not a mismatch/i)
    expect(
      CODE,
      'with no rendered line the section keeps its heading and carries no reference — the Code ' +
      'agent does not know the provider, so any line it composed would be a guess',
    ).toContain('never compose one from `ISSUE_NUMBER`')
    expect(
      CODE,
      'a bare issue number names a different issue under each provider, and the canonical reason ' +
      'for that is already registered — reuse it, never a new spelling',
    ).toContain('TRACEABILITY: DEGRADED (ambiguous issue reference)')
  })

  it('names no provider in the mismatch reason — the agent is never told one', () => {
    expect(
      CODE,
      'the Code agent receives no provider, so a reason that named one would name a guess; the ' +
      'union gate\'s honest report is that the line matched none of the grammars',
    ).toContain('does not match any tracker reference grammar')
    expect(CODE).not.toContain('does not match {provider} reference grammar')
    expect(CODE).not.toContain('does not match github reference grammar')
  })

  it('never asks the agent to read a provider it is not given', () => {
    // The retired instruction. With no provider in the spawn, "the arm for the
    // provider that was RESOLVED" has nothing to resolve against, and an agent
    // told to find one improvises it.
    expect(CODE).not.toMatch(/provider that was RESOLVED/i)
    expect(CODE).not.toContain('| Resolved provider |')
    expect(CODE, 'the gate is stated as a sink check').toContain('This is a sink check, not a provider check')
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
  // The Code agent sits outside the Git spawn surface and loads no provider
  // mechanics file it could defer to, so a per-provider sink check has to
  // enumerate the closed set once, inside the gate — that is what keeps it a
  // sink check rather than a second convergence point (PF-023). What it must
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
   * would be the fifth authority and the only one nobody ships (PF-018).
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
    const arms = collectPasteArms(CODE)
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

describe('handoff seam — git.md producer ↔ code.md consumer', () => {
  it('both sides spell the two pasted labels identically', () => {
    for (const label of ['- **PR link line**:', '- **Branch token**:']) {
      expect(GIT, `git.md must produce ${label}`).toContain(label)
      expect(CODE, `code.md must consume ${label}`).toContain(label)
    }
  })

  it('ISSUE_NUMBER is kept as the spawn key, with its value tied to the ISSUE_ID producer', () => {
    // §14.5: ISSUE_NUMBER (singular) is KEPT at every Code-spawn site; only its
    // VALUE becomes provider-canonical. A rename here would silently break all
    // 14 spawn sites, none of which this file can see.
    expect(CODE, 'the spawn key name must not be renamed').toContain('**ISSUE_NUMBER** (optional)')
    expect(
      CODE,
      'the input description must tie ISSUE_NUMBER to the producer that supplies it',
    ).toContain('- **Issue ID**: {ISSUE_ID}')
    expect(GIT, 'git.md must produce that exact line').toContain('- **Issue ID**: {ISSUE_ID}')
  })
})

// -------------------------------------------------------------------------
// The forwarding leg (GAP-15, second half).
//
// The producer↔consumer pair above proves git.md emits the PR link line and
// code.md knows how to paste it. It says nothing about the wire BETWEEN them.
// GAP-15's residue was exactly that gap: `issue_capture_contract()` captured
// ISSUE_PR_LINK at the command layer, code.md consumed it, and not one Code
// spawn fence forwarded it — the value was captured and dropped, and every
// PR body silently fell back to composing the link itself.
//
// ISSUE_NUMBER stays the spawn key (§14.5); ISSUE_PR_LINK is its SIBLING. So
// the invariant is relational, not a count of one key: every spawn payload
// that carries ISSUE_NUMBER must carry ISSUE_PR_LINK too. A fence that gains
// ISSUE_NUMBER without the sibling goes red, which is the drift that actually
// happens — a ninth fence copied from an older one.
//
// Corpus discipline (PF-055): the assertion is about DEPLOYED text, so it reads
// dist/. It gets dist/ from buildCommittedTree() — a build of a COPY of the
// committed sources into a temp root — never by rebuilding the repo's own dist/
// from a test writer, which other parallel workers are concurrently reading.
// -------------------------------------------------------------------------

/** The deployed commands that spawn Code agents with an issue key. Named, not discovered. */
const FORWARDING_COMMANDS: readonly string[] = ['implement.md', 'dynamic-build.md']

/**
 * §14.5 pinned 14 Code-spawn sites: 8 in implement, 6 in dynamic-build. #359 adds
 * the 15th — /implement's parallel-strategy `pr-create` spawn, which replaced the
 * orchestrator creating the unified PR itself (unscrubbed, and rendering its own
 * link line): 9 in implement, 6 in dynamic-build.
 */
const MIN_FORWARDING_SITES = 15

interface SpawnPayload {
  readonly file: string
  /** 1-based line of the ISSUE_NUMBER: key. */
  readonly line: number
  /** The contiguous non-blank run of lines the key sits in — one spawn payload. */
  readonly block: string
}

/**
 * Named collector: every spawn payload carrying an `ISSUE_NUMBER:` key.
 *
 * A payload is the contiguous run of non-blank lines around the key — the unit a
 * spawn fence hands to one agent. Blank-line bounded rather than fence-bounded so
 * the one collector reads both shapes the command layer uses: the markdown
 * `Agent(subagent_type="Code")` fences in implement.md and the JS
 * `agent(\`…\`, { agentType: "Code" })` template literals in dynamic-build.md.
 *
 * Bounded: a corpus with more sites than MAX_SITES is a corpus this scan no
 * longer understands, and is reported rather than silently truncated.
 */
function collectIssueSpawnPayloads(file: string, source: string): SpawnPayload[] {
  const MAX_SITES = 64
  const KEY = 'ISSUE_NUMBER:'
  const lines = source.split('\n')
  const payloads: SpawnPayload[] = []

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(KEY)) continue
    let start = i
    while (start > 0 && lines[start - 1].trim() !== '') start--
    let end = i
    while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++
    if (payloads.length >= MAX_SITES) {
      throw new Error(`${file}: more than ${MAX_SITES} ${KEY} sites — bound exceeded, scan aborted`)
    }
    payloads.push({ file, line: i + 1, block: lines.slice(start, end + 1).join('\n') })
  }
  return payloads
}

/** The payloads that carry ISSUE_NUMBER but not its sibling — rendered for the failure message. */
function collectUnforwardedSites(payloads: readonly SpawnPayload[]): string[] {
  return payloads
    .filter(p => !p.block.includes('ISSUE_PR_LINK:'))
    .map(p => `${p.file}:${p.line}`)
}

describe('ISSUE_PR_LINK forwarding — every Code spawn site carries the sibling key', () => {
  it('the named command set forwards it at every ISSUE_NUMBER site', async () => {
    const { run, root } = await buildCommittedTree()
    expect(run.status, `the committed-tree build must succeed.\n${run.combined}`).toBe(0)

    const payloads = FORWARDING_COMMANDS.flatMap(name =>
      collectIssueSpawnPayloads(name, requireDistFile(name, root)),
    )

    // Non-vacuity, both directions: the floor, and every named file contributing.
    expect(
      payloads.length,
      `only ${payloads.length} spawn site(s) found, floor ${MIN_FORWARDING_SITES} — a collector ` +
      'that reached fewer files than it names would pass by scanning nothing (PF-018)',
    ).toBeGreaterThanOrEqual(MIN_FORWARDING_SITES)
    for (const name of FORWARDING_COMMANDS) {
      expect(
        payloads.some(p => p.file === name),
        `${name} contributed no spawn site — the named set and the corpus disagree`,
      ).toBe(true)
    }

    expect(
      collectUnforwardedSites(payloads),
      'Code spawn site(s) carrying ISSUE_NUMBER without ISSUE_PR_LINK. The command layer ' +
      'captures the rendered PR link line via issue_capture_contract(); a fence that omits it ' +
      'drops the value on the floor and the PR body silently recomposes the link (GAP-15):\n  ' +
      collectUnforwardedSites(payloads).join('\n  '),
    ).toEqual([])
  }, 20_000) // pays for the memoised committed-tree build: ~3.7s alone, headroom for suite contention.

  it('known-bad probe: a fence that loses the sibling key is reported by the same collector', async () => {
    const { root } = await buildCommittedTree()
    const real = requireDistFile('implement.md', root)

    // GREEN half: the real deployed text has no unforwarded site.
    expect(collectUnforwardedSites(collectIssueSpawnPayloads('implement.md', real))).toEqual([])

    // RED half: drop the sibling from exactly ONE fence — the drift this guard
    // exists for — and prove the SAME collector names that site.
    const seeded = real.replace(/^.*ISSUE_PR_LINK:.*\n/m, '')
    expect(seeded, 'the seed must actually remove a line').not.toBe(real)
    const seededViolations = collectUnforwardedSites(collectIssueSpawnPayloads('implement.md', seeded))
    expect(
      seededViolations.length,
      'removing one ISSUE_PR_LINK line must leave exactly one site unforwarded — if the ' +
      'collector reports zero it is not reading the payload it claims to read',
    ).toBe(1)
  })

  it('code.md declares the sibling key as an input, next to the spawn key it accompanies', () => {
    expect(
      CODE,
      'a forwarded key the agent does not declare is a key the agent may ignore',
    ).toContain('**ISSUE_PR_LINK** (optional)')
    expect(
      CODE,
      'the declaration must name the (none) fallback, or an unset value has no defined behaviour',
    ).toContain('the section then carries its heading and no reference')
    const numberAt = CODE.indexOf('**ISSUE_NUMBER** (optional)')
    const linkAt = CODE.indexOf('**ISSUE_PR_LINK** (optional)')
    expect(
      linkAt,
      'the sibling must be declared after the spawn key it accompanies, not in a distant section',
    ).toBeGreaterThan(numberAt)
  })
})

// -------------------------------------------------------------------------
// /implement's parallel path opens its PR through a Code `pr-create` spawn (#359, G3).
//
// The orchestrator used to run `gh pr create` itself for PARALLEL_CODE_AGENTS: the
// body skipped the D11 scrub every Code-created PR gets, and the command layer
// rendered its own link line — a second rendering site with no provider to render
// it against. Both went when the step became a Code spawn whose Responsibility 7
// owns the body, the paste gate and the scrub. This block pins that the spawn
// exists, carries everything Responsibility 7 reads, and lands on a declared mode.
// -------------------------------------------------------------------------

/** Named collector: the Code spawn payloads that run `OPERATION: pr-create`. */
function collectPrCreateSpawns(source: string): SpawnPayload[] {
  return collectIssueSpawnPayloads('implement.md', source).filter(p => p.block.includes('OPERATION: pr-create'))
}

/** The keys Responsibility 7 reads, every one of which the pr-create spawn must carry. */
const PR_CREATE_KEYS = [
  'Agent(subagent_type="Code")',
  'CREATE_PR: true',
  'BASE_BRANCH:',
  'PR_DESCRIPTION_GUIDANCE:',
  'ISSUE_NUMBER:',
  'ISSUE_PR_LINK:',
  'PR_EXCEPTIONS:', // #362: /implement's recorded evidence exception, pasted by Responsibility 7
  'PR_TEST_PLAN_BLOCK:', // #363: /implement's rendered test-plan block, pasted behind `check block`
] as const

describe('/implement parallel PR — a Code pr-create spawn, never the orchestrator', () => {
  it('Phase 10 spawns exactly one pr-create Code agent carrying every Responsibility-7 input', async () => {
    const { root } = await buildCommittedTree()
    const implement = requireDistFile('implement.md', root)
    const spawns = collectPrCreateSpawns(implement)
    expect(spawns, 'one pr-create spawn — the parallel path must not create the PR itself').toHaveLength(1)
    for (const key of PR_CREATE_KEYS) {
      expect(spawns[0].block, `the pr-create spawn must pass ${key}`).toContain(key)
    }
    expect(implement, 'the retired orchestrator-run PR creation').not.toContain('run `gh pr create`')
  }, 20_000)

  it('code.md declares the mode and routes it through Responsibility 7 and its D11 scrub', () => {
    expect(CODE).toMatch(/\*\*OPERATION\*\* \(optional\):[^\n]*`pr-create`/)
    const mode = CODE.slice(CODE.indexOf('## Mode: pr-create'))
    expect(mode.startsWith('## Mode: pr-create'), 'the mode section must exist').toBe(true)
    const body = mode.slice(0, mode.indexOf('\n## ', 1))
    expect(body).toContain('Responsibility 7')
    expect(body).toContain('D11 scrub')
    expect(body).toContain('Make no code changes')
  })

  it('known-bad probe: a Phase 10 that lost its spawn is reported', async () => {
    const { root } = await buildCommittedTree()
    const real = requireDistFile('implement.md', root)
    const seeded = real.replace('OPERATION: pr-create', 'OPERATION: implement')
    expect(seeded, 'the seed must actually change the text').not.toBe(real)
    expect(collectPrCreateSpawns(seeded)).toHaveLength(0)
  })
})
