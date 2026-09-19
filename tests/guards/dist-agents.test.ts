/**
 * dist/agents guards (Phase 1: AC-1.1, AC-1.2, AC-1.3, AC-1.6).
 *
 * The Git agent is now compiled: `git.mds` (a generator host) → `dist/agents/git.md`.
 * That makes dist/agents/ a shipping artifact directory, and it needs the same three
 * properties dist/commands/ has had since Guard 4 in tests/packaging.test.ts:
 *
 *   (a) source ↔ output parity, in BOTH directions and fail-loud. Guard 4's
 *       `catch { return }` + `if (distFiles.length === 0) return` shape is
 *       deliberately NOT copied: a guard that skips itself on a missing build
 *       verifies nothing on exactly the tree where it matters (PF-018).
 *   (b) no leaked `\{` / `\}` — MDS escapes braces in prose, and a missed or
 *       doubled escape reaches the artifact rather than the compiler (PF-024).
 *   (c) no `.md` shadowing an `.mds` host: two sources for one agent means the
 *       dist-preferred resolver silently picks a winner.
 *
 * AC-1.2 additionally pins constructs that must not appear. Phase 1 wrote it as
 * "nothing Phase 2 will add"; Phase 2 narrowed it deliberately — variant
 * expansion and the (module, op) dispatch arrived and are named in
 * LEGALISED_IN_PHASE2 — while conditional arms and provider-templated FILE
 * naming stay forbidden in every phase, because the generated tree is
 * tracker/{provider}/{op}.md driven by a typed registry, not by a template.
 *
 * Every collector is a named function called by both the assertion and its
 * known-bad probe (PF-018). No literal agent path appears in this file — the
 * directories come from src/core/assets.ts (AC-0.7 / AC-1.10).
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import { agentsDir, compiledAgentsDir } from '../../src/core/assets.js'
import { getAllAgentNames } from '../../src/core/plugins.js'
import { resolveAgentSource } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')

// ---------------------------------------------------------------------------
// Fail-loud readers (requireDistFile shape — throw with a build hint, never skip)
// ---------------------------------------------------------------------------

/**
 * List the compiled agent files under `<root>/dist/agents/`.
 * Throws with a build hint when the directory is absent. This is the deliberate
 * opposite of packaging.test.ts Guard 4's silent `catch { return }`.
 */
function requireCompiledAgents(dir: string): string[] {
  try {
    return readdirSync(dir).filter(f => f.endsWith('.md')).sort()
  } catch {
    throw new Error(
      `${path.relative(ROOT, dir)}/ is absent — run \`npm run build:mds\` first\n` +
      '  (this guard reads compiled agent files and cannot be skipped)',
    )
  }
}

/**
 * List the agent source basenames in `dir` carrying the given extension.
 * `dir` comes from agentsDir(), never from a literal path (AC-0.7 / AC-1.10).
 */
function agentSourceNames(dir: string, ext: '.md' | '.mds'): string[] {
  return readdirSync(dir).filter(f => f.endsWith(ext)).map(f => path.basename(f, ext)).sort()
}

// ---------------------------------------------------------------------------
// (a) dist ↔ src parity for dist/agents, both directions
// ---------------------------------------------------------------------------

interface ParityResult {
  /** Compiled files with no generator host source. */
  orphans: string[]
  /** Generator hosts with no compiled output. */
  missing: string[]
  compiledCount: number
  hostCount: number
}

/**
 * Named collector: compare the compiled agent set against the generator-host set.
 * Called by the parity assertion AND by the seeded-temp-root probe below.
 */
function collectAgentParity(srcDir: string, distDir: string): ParityResult {
  const compiled = requireCompiledAgents(distDir)
  const hosts = agentSourceNames(srcDir, '.mds')
  const hostSet = new Set(hosts)
  const compiledSet = new Set(compiled.map(f => path.basename(f, '.md')))

  return {
    orphans: compiled.map(f => path.basename(f, '.md')).filter(n => !hostSet.has(n)),
    missing: hosts.filter(n => !compiledSet.has(n)),
    compiledCount: compiled.length,
    hostCount: hosts.length,
  }
}

describe('dist/agents ↔ src generator-host parity (fail-loud, both directions)', () => {
  it('every compiled agent has a generator host, and every generator host is compiled', () => {
    const parity = collectAgentParity(agentsDir(), compiledAgentsDir())

    // Non-vacuity on BOTH sides: a zero on either would make the corresponding
    // direction pass by iterating nothing (PF-018).
    expect(parity.compiledCount, 'dist/agents/ holds no .md files — the guard would be vacuous').toBeGreaterThan(0)
    expect(parity.hostCount, 'no .mds generator host found — the guard would be vacuous').toBeGreaterThan(0)

    expect(
      parity.orphans,
      `Compiled agent(s) with no generator host source:\n  ${parity.orphans.join('\n  ')}\n` +
      `Add the .mds source, or remove the stale compiled output.`,
    ).toHaveLength(0)
    expect(
      parity.missing,
      `Generator host(s) with no compiled output:\n  ${parity.missing.join('\n  ')}\n` +
      `Run 'npm run build:mds', or check for build errors.`,
    ).toHaveLength(0)
  })

  it('known-bad probe: an orphaned compiled file and an uncompiled host are both caught', () => {
    withTempTree(tmp => {
      const src = path.join(tmp, 'src', 'assets', 'agents')
      const dist = path.join(tmp, 'dist', 'agents')
      mkdirSync(src, { recursive: true })
      mkdirSync(dist, { recursive: true })
      // orphan: compiled output with no source
      writeFileSync(path.join(dist, 'orphan.md'), '---\nname: Orphan\n---\n', 'utf-8')
      // missing: source with no compiled output
      writeFileSync(path.join(src, 'uncompiled.mds'), '---\noutput-dir: dist/agents\n---\n', 'utf-8')

      const parity = collectAgentParity(src, dist)
      expect(parity.orphans, 'forward direction must flag the orphaned compiled file').toContain('orphan')
      expect(parity.missing, 'reverse direction must flag the uncompiled host').toContain('uncompiled')
    })
  })

  it('known-bad probe: an absent dist/agents/ throws with a build hint (never a silent skip)', () => {
    withTempTree(tmp => {
      expect(
        () => collectAgentParity(tmp, path.join(tmp, 'dist', 'agents')),
      ).toThrow(/npm run build:mds/)
    })
  })
})

// ---------------------------------------------------------------------------
// (b) no escaped braces leak into a compiled agent
// ---------------------------------------------------------------------------

/**
 * Named collector: compiled agent files containing a literal backslash-brace.
 *
 * MDS interpolates `{…}` everywhere except column-0 triple-backtick fences, so
 * prose braces are written `\{` / `\}` in the .mds source and compile back to
 * `{` / `}`. A missed escape is a compile error; a DOUBLED escape is silent —
 * `\{` reaches the artifact and every downstream `{PLACEHOLDER}` contract at
 * that site is dead text (PF-024).
 */
function collectEscapedBraceLeaks(files: Array<{ name: string; content: string }>): string[] {
  const leaks: string[] = []
  for (const { name, content } of files) {
    for (const seq of ['\\{', '\\}']) {
      const count = content.split(seq).length - 1
      if (count > 0) leaks.push(`${name}: ${count} occurrence(s) of ${seq}`)
    }
  }
  return leaks
}

function compiledAgentContents(): Array<{ name: string; content: string }> {
  const dir = compiledAgentsDir()
  return requireCompiledAgents(dir).map(name => ({
    name,
    content: readFileSync(path.join(dir, name), 'utf-8'),
  }))
}

describe('compiled agents carry no escaped braces', () => {
  it('no dist/agents/*.md contains a literal \\{ or \\}', () => {
    const files = compiledAgentContents()
    expect(files.length, 'no compiled agent scanned — guard is vacuous (PF-018)').toBeGreaterThan(0)

    const leaks = collectEscapedBraceLeaks(files)
    expect(
      leaks,
      `Escaped braces leaked into compiled agent output — a doubled escape in the .mds source:\n  ${leaks.join('\n  ')}`,
    ).toHaveLength(0)
  })

  it('known-bad probe: a seeded \\{ is detected by the same collector', () => {
    const seeded = [{ name: 'seeded.md', content: 'marker cycle:\\{CYCLE_NUMBER\\} ts:{REVIEW_TIMESTAMP}\n' }]
    const leaks = collectEscapedBraceLeaks(seeded)
    expect(leaks.length, 'the collector must flag a seeded backslash-brace').toBeGreaterThan(0)
    // And a clean placeholder must NOT be flagged, or the collector is a blanket fail.
    expect(collectEscapedBraceLeaks([{ name: 'clean.md', content: 'cycle:{CYCLE_NUMBER}\n' }])).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (d) every compiled agent still HAS its frontmatter
// ---------------------------------------------------------------------------

interface AgentHeaderShape {
  name: string
  /** True when the leading frontmatter block declares a non-empty `name:`. */
  hasNameKey: boolean
}

/**
 * Named collector: one row per compiled agent whose leading frontmatter block was
 * actually FOUND — a headerless file contributes no row at all.
 *
 * Counting headers rather than files is the point (PF-018): a collector that
 * emitted a row per input with `hasBlock: false` would let the caller iterate a
 * full-length array of rows and forget to assert on the flag. Here a lost header
 * shows up as a short array, which the caller compares against the file count.
 *
 * The failure this guards is silent by construction: the generator strip removes
 * the leading block, so a source with only ONE block loses its whole frontmatter
 * and produces a plausible-looking markdown file (PF-061).
 */
function collectAgentHeaderShapes(
  files: ReadonlyArray<{ name: string; content: string }>,
): AgentHeaderShape[] {
  const shapes: AgentHeaderShape[] = []
  for (const { name, content } of files) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content)
    if (match === null) continue
    shapes.push({ name, hasNameKey: /^name:[ \t]*\S/m.test(match[1]) })
  }
  return shapes
}

describe('every compiled agent starts with a frontmatter block carrying name:', () => {
  it('no dist/agents/*.md was emitted headerless or nameless', () => {
    const files = compiledAgentContents()
    expect(files.length, 'no compiled agent scanned — guard is vacuous (PF-018)').toBeGreaterThan(0)

    const shapes = collectAgentHeaderShapes(files)
    const headerless = files
      .filter(f => !shapes.some(s => s.name === f.name))
      .map(f => f.name)
    expect(
      headerless,
      `Compiled agent(s) with no leading frontmatter block:\n  ${headerless.join('\n  ')}\n` +
      `A generator host must declare TWO leading blocks — block 1 steers the build,\n` +
      `block 2 is the agent's own frontmatter. A single-block source loses it entirely.`,
    ).toHaveLength(0)

    const nameless = shapes.filter(s => !s.hasNameKey).map(s => s.name)
    expect(
      nameless,
      `Compiled agent(s) whose frontmatter carries no name::\n  ${nameless.join('\n  ')}`,
    ).toHaveLength(0)
  })

  it('known-bad probe: a stripped-to-headerless file and a nameless block are both caught', () => {
    // (i) What a single-block generator host actually produces: the block gone,
    //     the body intact. The collector must return NO row for it.
    const stripped = [{ name: 'stripped.md', content: '\n# Git Agent\n\nBody text.\n' }]
    expect(
      collectAgentHeaderShapes(stripped),
      'a headerless file must contribute no header row — otherwise the count check is vacuous',
    ).toHaveLength(0)

    // (ii) A block that survived but lost name: must be reported, not skipped.
    const nameless = collectAgentHeaderShapes([
      { name: 'nameless.md', content: '---\nmodel: haiku\n---\n\nBody text.\n' },
    ])
    expect(nameless).toHaveLength(1)
    expect(nameless[0].hasNameKey, 'the collector must flag a block with no name: key').toBe(false)

    // (iii) And a healthy artifact must NOT be flagged, or the collector is a blanket fail.
    const healthy = collectAgentHeaderShapes([
      { name: 'healthy.md', content: '---\nname: Git\nmodel: haiku\n---\n\nBody text.\n' },
    ])
    expect(healthy).toHaveLength(1)
    expect(healthy[0].hasNameKey).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (c) no .md shadowing an .mds generator host
// ---------------------------------------------------------------------------

/**
 * Named collector: agent names that have BOTH a hand-authored `.md` source and
 * an `.mds` generator host. Two sources for one agent means the resolver picks a
 * winner silently and the loser rots.
 */
function collectShadowedHosts(dir: string): string[] {
  const md = new Set(agentSourceNames(dir, '.md'))
  return agentSourceNames(dir, '.mds').filter(name => md.has(name))
}

describe('no hand-authored .md shadows an .mds generator host', () => {
  it('the agents source directory has at most one source per agent', () => {
    const dir = agentsDir()
    const hosts = agentSourceNames(dir, '.mds')
    expect(hosts.length, 'no generator host present — this guard would be vacuous').toBeGreaterThan(0)

    const shadowed = collectShadowedHosts(dir)
    expect(
      shadowed,
      `Agent(s) with both a .md and a .mds source:\n  ${shadowed.join('\n  ')}\n` +
      `Delete the hand-authored .md — the generator host is the source, and its\n` +
      `compiled artifact in dist/agents/ is what the resolver and installer prefer.`,
    ).toHaveLength(0)
  })

  it('known-bad probe: a temp tree holding both x.md and x.mds is flagged', () => {
    withTempTree(tmp => {
      mkdirSync(tmp, { recursive: true })
      writeFileSync(path.join(tmp, 'x.md'), 'hand-authored', 'utf-8')
      writeFileSync(path.join(tmp, 'x.mds'), '---\noutput-dir: dist/agents\n---\n', 'utf-8')
      expect(collectShadowedHosts(tmp)).toEqual(['x'])
    })
  })
})

// ---------------------------------------------------------------------------
// AC-1.6 / AC-1.3 — the dist-preferred path is live, and the src arm still works
// ---------------------------------------------------------------------------

describe('agent resolution origins in the real tree (AC-1.6, AC-1.3)', () => {
  it('the compiled agent resolves with origin=dist', () => {
    // The dist-preferred branch of resolveAgentSource had no live consumer until
    // dist/agents/ existed. This asserts it is actually the branch being taken.
    const hosts = agentSourceNames(agentsDir(), '.mds')
    expect(hosts.length, 'no generator host present — this guard would be vacuous').toBeGreaterThan(0)

    for (const name of hosts) {
      expect(resolveAgentSource(name).origin, `${name} must resolve from dist/agents/`).toBe('dist')
    }
  })

  it('an unconverted agent still resolves with origin=src (fallback arm)', () => {
    // AC-1.3's fallback arm must be exercised on an agent that has NO generator
    // host — `git` can no longer prove it, its .md source is gone.
    const hosts = new Set(agentSourceNames(agentsDir(), '.mds'))
    const unconverted = getAllAgentNames().filter(n => !hosts.has(n))
    expect(unconverted.length, 'every agent is generated — the fallback arm is unprovable').toBeGreaterThan(0)

    for (const name of unconverted) {
      expect(resolveAgentSource(name).origin, `${name} must resolve from the source tree`).toBe('src')
    }
  })

  it('AC-1.3 loud-failure arm: a generated agent is unresolvable without a build', () => {
    // A temp root shaped like the real one after the rename: the source tree has
    // the .mds host but no .md, and dist/ has not been built. Neither arm resolves,
    // so the resolver must throw with a build hint rather than return something.
    withTempTree(tmp => {
      const src = path.join(tmp, 'src', 'assets', 'agents')
      mkdirSync(src, { recursive: true })
      const generated = agentSourceNames(agentsDir(), '.mds')[0]
      writeFileSync(path.join(src, `${generated}.mds`), '---\noutput-dir: dist/agents\n---\n', 'utf-8')

      expect(() => resolveAgentSource(generated, tmp)).toThrow(/npm run build/)
    })
  })
})

// ---------------------------------------------------------------------------
// AC-1.2 — Phase 1 built plumbing, not variant expansion
// ---------------------------------------------------------------------------

interface ForbiddenConstruct {
  /** How the construct is named in the failure message and in the probe. */
  label: string
  /** Anchored matcher — the shape the construct actually takes in source. */
  pattern: RegExp
  /** A realistic instance of the construct the collector must flag (PF-018). */
  probe: string
  appliesTo: 'all' | 'mds'
}

/**
 * Named collector: forbidden Phase-2 constructs found in a corpus.
 *
 * Phase 2 splits the Git agent into a contract layer plus generated per-provider
 * references, which is where variant expansion, conditionals and templated file
 * naming belong. Pinning their absence now means their arrival is a reviewed
 * change rather than something that accreted through Phase 1.
 *
 * Each construct is matched by an ANCHORED regex, never a bare substring. The
 * corpus deliberately includes src/core/mds-variants.ts and scripts/build-mds.ts
 * — the two files whose entire subject is this machinery — so a substring like
 * `variants:` or `tracker-` fires on any docblock that so much as names what
 * Phase 2 will add, forcing authors to word around their own guard. The anchor
 * is the shape the construct has in real source (a YAML key at line start, a
 * call, a directive, a generated filename), so prose about Phase 2 stays legal
 * and Phase-2 code does not.
 */
function collectForbiddenConstructs(
  corpus: Array<{ name: string; content: string }>,
  forbidden: ReadonlyArray<ForbiddenConstruct>,
): string[] {
  const violations: string[] = []
  for (const { name, content } of corpus) {
    for (const { label, pattern, appliesTo } of forbidden) {
      if (appliesTo === 'mds' && !name.endsWith('.mds')) continue
      if (pattern.test(content)) violations.push(`${name}: contains '${label}'`)
    }
  }
  return violations
}

/**
 * Legalised in Phase 2, recorded so the narrowing is visible rather than silent.
 *
 * `expandVariants(` and the `(module, op)` dispatch signature were forbidden
 * because Phase 1 built no expansion; Phase 2's whole subject is that expansion,
 * and both now live in src/core/mds-variants.ts and scripts/build-mds.ts — the
 * two files this guard's corpus deliberately includes. Keeping them forbidden
 * would mean the guard failing on the mechanism it was written to await, which
 * is not a narrowing anyone can act on.
 *
 * What did NOT become legal, and stays in the table below: `@if` (Phase 2 ships
 * no conditional arms at all — the single-arm form AC-1.2 was written against
 * remains forbidden outright), the `tracker-<provider>.md` filename token
 * (§14.5: it appears NOWHERE — the generated tree is `tracker/{provider}/{op}.md`
 * and the flat per-provider file shape was disqualified), the `{provider}.md`
 * templated output name, a `variants:` YAML key (the roster is a typed registry,
 * not frontmatter), and `@import`/`@define` inside a compiled AGENT host — the
 * Git agent is prose, and a directive there would mean its body had become a
 * template.
 */
const LEGALISED_IN_PHASE2: readonly string[] = ['expandVariants(', '(module, op)']

const FORBIDDEN_CONSTRUCTS: ReadonlyArray<ForbiddenConstruct> = [
  // A conditional directive, not the letters 'if' after an '@'.
  { label: '@if', pattern: /@if\b/, probe: '@if provider == "github"\n', appliesTo: 'all' },
  // A frontmatter/YAML key at line start, not the word in a sentence.
  { label: 'variants:', pattern: /^[ \t]*variants:/m, probe: 'variants:\n  - github\n', appliesTo: 'all' },
  // A per-provider tracker FILE, not the adjective 'tracker-agnostic'.
  { label: 'tracker-<provider>.md', pattern: /\btracker-[a-z0-9-]+\.mds?\b/, probe: 'see tracker-github.md for the mapping\n', appliesTo: 'all' },
  // A templated output filename.
  { label: '{provider}.md', pattern: /\{provider\}\.mds?\b/, probe: 'output-name: tracker-{provider}.md\n', appliesTo: 'all' },
  // MDS directives — unanchored on purpose: anywhere in an AGENT host is a
  // templated agent body. Reference modules under src/assets/mds/ use @define by
  // design and are not in this corpus.
  { label: '@import', pattern: /@import\b/, probe: '@import "./_partials/_tracker.mds"\n', appliesTo: 'mds' },
  { label: '@define', pattern: /@define\b/, probe: '@define providerBlock()\n', appliesTo: 'mds' },
]

describe('AC-1.2 (Phase-2 scope fence): no conditionals or provider-templated file naming', () => {
  function buildScopeCorpus(): Array<{ name: string; content: string }> {
    const hosts = agentSourceNames(agentsDir(), '.mds')
    const corpus = hosts.map(name => ({
      name: `${name}.mds`,
      content: readFileSync(path.join(agentsDir(), `${name}.mds`), 'utf-8'),
    }))
    for (const rel of [
      path.join('src', 'core', 'mds-variants.ts'),
      path.join('scripts', 'build-mds.ts'),
    ]) {
      corpus.push({ name: rel, content: readFileSync(path.join(ROOT, rel), 'utf-8') })
    }
    return corpus
  }

  it('the generator host, the core module, and the build script carry none of them', () => {
    const corpus = buildScopeCorpus()
    // Union non-vacuity: all three scopes must be present, and each non-empty.
    expect(corpus.length, 'corpus must span the .mds host(s) plus the two build files').toBeGreaterThanOrEqual(3)
    for (const entry of corpus) {
      expect(entry.content.length, `${entry.name} is empty — guard would be vacuous`).toBeGreaterThan(0)
    }

    const violations = collectForbiddenConstructs(corpus, FORBIDDEN_CONSTRUCTS)
    expect(
      violations,
      `Forbidden construct(s) found:\n  ${violations.join('\n  ')}\n` +
      `Conditional arms and provider-templated file naming are out of scope in every phase;\n` +
      `the generated tree is tracker/{provider}/{op}.md, driven by a typed registry.`,
    ).toHaveLength(0)
  })

  it('known-bad probe: each forbidden construct is detected by the same collector', () => {
    // Every entry carries the instance that must trip it, so anchoring a pattern
    // without keeping it able to catch its own construct is a red test.
    for (const entry of FORBIDDEN_CONSTRUCTS) {
      const name = entry.appliesTo === 'mds' ? 'seeded.mds' : 'seeded.ts'
      const violations = collectForbiddenConstructs(
        [{ name, content: entry.probe }],
        FORBIDDEN_CONSTRUCTS,
      )
      expect(
        violations.some(v => v.includes(entry.label)),
        `collector must flag its own seeded '${entry.label}': ${JSON.stringify(entry.probe)}`,
      ).toBe(true)
    }
  })

  it('the Phase-2 narrowing is explicit: the legalised constructs are named, and gone from the table', () => {
    // A deliberate narrowing must be readable as one. Without this, the two
    // entries could have been deleted in a hurry and nobody could tell a removal
    // from a rewording (ADR-003 — leave the end state, and say what changed).
    expect(LEGALISED_IN_PHASE2.length, 'the narrowing must name what it legalised').toBeGreaterThan(0)
    for (const label of LEGALISED_IN_PHASE2) {
      expect(
        FORBIDDEN_CONSTRUCTS.map(c => c.label),
        `'${label}' is legal in Phase 2 and must not also be forbidden`,
      ).not.toContain(label)
    }
    // And the fence is still load-bearing after the narrowing, not an empty shell.
    expect(FORBIDDEN_CONSTRUCTS.length, 'fence must still forbid something').toBeGreaterThanOrEqual(6)
    expect(FORBIDDEN_CONSTRUCTS.map(c => c.label)).toContain('tracker-<provider>.md')
    expect(FORBIDDEN_CONSTRUCTS.map(c => c.label)).toContain('@if')
  })

  it('known-bad probe: prose naming a forbidden construct is not itself a violation', () => {
    // The other half of the anchoring contract. The corpus contains the two build
    // files this guard is about, so a docblock that describes the mechanism must
    // stay legal — otherwise the guard taxes its own documentation, and the next
    // author words around it instead of writing what they mean.
    const prose = [
      ' * No host declares a variants: key — the roster is a typed registry.',
      ' * Output naming stays tracker-agnostic: no per-provider filename token.',
      ' * A conditional arm would be written with an if directive; none exists.',
    ].join('\n')

    expect(
      collectForbiddenConstructs([{ name: 'seeded.ts', content: prose }], FORBIDDEN_CONSTRUCTS),
      'anchored patterns must not fire on prose that merely names the construct',
    ).toHaveLength(0)
  })

  it('known-bad probe: an mds-scoped token is not reported against a non-mds file', () => {
    // Scoping must be real, not decorative: @import is legal MDS-adjacent text in
    // a .ts file and must not be flagged there.
    const violations = collectForbiddenConstructs(
      [{ name: 'seeded.ts', content: 'import x from "y" // @import\n' }],
      FORBIDDEN_CONSTRUCTS,
    )
    expect(violations.filter(v => v.includes('@import'))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Shared temp-tree helper — never writes into the real src/ or dist/
// ---------------------------------------------------------------------------

function withTempTree(fn: (dir: string) => void): void {
  const tmp = mkdtempSync(path.join(tmpdir(), 'devflow-dist-agents-'))
  try {
    fn(tmp)
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  }
}
