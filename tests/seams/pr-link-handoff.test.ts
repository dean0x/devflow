import { describe, it, expect, afterAll } from 'vitest'
import { buildCommittedTree, cleanupCommittedTree, requireDistFile, resolveAgentSource } from '../helpers.js'

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
      'a foreign-shaped ref must emit the canonical DEGRADED reason, never be silently repaired or dropped',
    ).toContain('does not match github reference grammar')
  })

  it('re-checks BEFORE it pastes — order, not mere presence', () => {
    const recheck = CODE.indexOf('after re-checking its shape against the resolved provider')
    const degraded = CODE.indexOf('does not match github reference grammar')
    expect(recheck, 'the re-check instruction must exist').toBeGreaterThan(-1)
    expect(
      recheck,
      'the shape re-check must be stated as a precondition of the paste, not as an afterthought below the DEGRADED line',
    ).toBeLessThan(degraded)
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

/** §14.5 pins 14 Code-spawn sites: 8 in implement, 6 in dynamic-build. */
const MIN_FORWARDING_SITES = 14

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
    ).toContain('compose the section from `ISSUE_NUMBER` instead')
    const numberAt = CODE.indexOf('**ISSUE_NUMBER** (optional)')
    const linkAt = CODE.indexOf('**ISSUE_PR_LINK** (optional)')
    expect(
      linkAt,
      'the sibling must be declared after the spawn key it accompanies, not in a distant section',
    ).toBeGreaterThan(numberAt)
  })
})
