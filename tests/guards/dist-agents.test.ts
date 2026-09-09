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
 * AC-1.2 additionally pins what Phase 1 did NOT build: no variant expansion, no
 * conditionals, no per-provider file naming. Phase 2 introduces those; a guard
 * that proves their absence now is what makes their arrival a deliberate change.
 *
 * Every collector is a named function called by both the assertion and its
 * known-bad probe (ADR-024). No literal agent path appears in this file — the
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

describe('compiled agents carry no escaped braces', () => {
  function compiledAgentContents(): Array<{ name: string; content: string }> {
    const dir = compiledAgentsDir()
    return requireCompiledAgents(dir).map(name => ({
      name,
      content: readFileSync(path.join(dir, name), 'utf-8'),
    }))
  }

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
    for (const name of agentSourceNames(agentsDir(), '.mds')) {
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

/**
 * Named collector: forbidden Phase-2 constructs found in a corpus.
 *
 * Phase 2 splits the Git agent into a contract layer plus generated per-provider
 * references, which is where variant expansion, conditionals and templated file
 * naming belong. Pinning their absence now means their arrival is a reviewed
 * change rather than something that accreted through Phase 1 (clause iii).
 */
function collectForbiddenConstructs(
  corpus: Array<{ name: string; content: string }>,
  forbidden: ReadonlyArray<{ token: string; appliesTo: 'all' | 'mds' }>,
): string[] {
  const violations: string[] = []
  for (const { name, content } of corpus) {
    for (const { token, appliesTo } of forbidden) {
      if (appliesTo === 'mds' && !name.endsWith('.mds')) continue
      if (content.includes(token)) violations.push(`${name}: contains '${token}'`)
    }
  }
  return violations
}

const FORBIDDEN_PHASE2_CONSTRUCTS = [
  { token: '@if', appliesTo: 'all' },
  { token: 'variants:', appliesTo: 'all' },
  { token: 'expandVariants', appliesTo: 'all' },
  { token: '(module, op)', appliesTo: 'all' },
  { token: 'tracker-', appliesTo: 'all' },
  { token: '{provider}.md', appliesTo: 'all' },
  { token: '@import', appliesTo: 'mds' },
  { token: '@define', appliesTo: 'mds' },
] as const

describe('AC-1.2: no variant expansion, conditionals, or provider templating in Phase 1', () => {
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

    const violations = collectForbiddenConstructs(corpus, FORBIDDEN_PHASE2_CONSTRUCTS)
    expect(
      violations,
      `Phase-2 constructs found in the Phase-1 tree:\n  ${violations.join('\n  ')}\n` +
      `Phase 1 is plumbing only — variant expansion and provider templating land in Phase 2.`,
    ).toHaveLength(0)
  })

  it('known-bad probe: each forbidden construct is detected by the same collector', () => {
    for (const entry of FORBIDDEN_PHASE2_CONSTRUCTS) {
      const name = entry.appliesTo === 'mds' ? 'seeded.mds' : 'seeded.ts'
      const violations = collectForbiddenConstructs(
        [{ name, content: `prefix ${entry.token} suffix\n` }],
        FORBIDDEN_PHASE2_CONSTRUCTS,
      )
      expect(
        violations.some(v => v.includes(entry.token)),
        `collector must flag a seeded '${entry.token}'`,
      ).toBe(true)
    }
  })

  it('known-bad probe: an mds-scoped token is not reported against a non-mds file', () => {
    // Scoping must be real, not decorative: @import is legal MDS-adjacent text in
    // a .ts file and must not be flagged there.
    const violations = collectForbiddenConstructs(
      [{ name: 'seeded.ts', content: 'import x from "y" // @import\n' }],
      FORBIDDEN_PHASE2_CONSTRUCTS,
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
