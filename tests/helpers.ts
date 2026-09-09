import { readFileSync, readdirSync, existsSync, promises as fsp } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { type ManifestData } from '../src/core/manifest.js'
import { getAllAgentNames } from '../src/core/plugins.js'
import { agentSourceDirs } from '../src/core/assets.js'

export const ROOT = path.resolve(import.meta.dirname, '..')

const DIST_COMMANDS_DIR = path.join(ROOT, 'dist', 'commands')

/**
 * Ensure dist/commands/ exists and return its .md files.
 * Throws — does NOT return — when absent. A guard that silently skips
 * on a missing build artifact is not a guard.
 *
 * @param root - Repository root to resolve paths against (default: ROOT).
 *   Pass a temp-dir root in tests to verify throw behaviour without touching the real dist.
 */
export function requireDistFiles(root: string = ROOT): string[] {
  const dir = path.join(root, 'dist', 'commands')
  try {
    return readdirSync(dir).filter(f => f.endsWith('.md'))
  } catch {
    throw new Error(
      'dist/commands/ is absent — run `npm run build` first\n' +
      '  (this guard reads compiled command files and cannot be skipped)',
    )
  }
}

/**
 * Read a dist command file. Throws if absent (referencing the build step).
 * A missing dist file is a build error, not a skip condition.
 *
 * @param root - Repository root to resolve paths against (default: ROOT).
 *   Pass a temp-dir root in tests to verify throw behaviour without touching the real dist.
 */
export function requireDistFile(name: string, root: string = ROOT): string {
  const filePath = path.join(root, 'dist', 'commands', name)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    throw new Error(
      `dist/commands/${name} is absent — run \`npm run build\` first`,
    )
  }
}

export function loadFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

// ── Isolated MDS builds ──────────────────────────────────────────────────────
//
// A test that needs compiled artifacts must never get them by rebuilding the
// real dist/ tree: vitest runs other files in parallel workers that READ those
// same paths, so an unscoped build silently REPAIRS a stale dist/ mid-suite and
// whichever reader lost the race reports a flake instead of the staleness
// (avoids PF-055). Every build spawned from here is redirected to a throwaway
// root via DEVFLOW_MDS_ROOT, and the corpus it compiles is a COPY of the
// committed sources — so the real src/ and dist/ trees are only ever read.

const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx')
const BUILD_MDS_SCRIPT = path.join(ROOT, 'scripts', 'build-mds.ts')

/** Exit status and merged stdout+stderr of one `build-mds.ts` run. */
export interface BuildRun {
  status: number | null
  combined: string
}

/**
 * Run the real build script against an isolated fake root.
 * `cwd` stays at the repo root so module resolution is unchanged; the root the
 * build walks and writes comes from DEVFLOW_MDS_ROOT alone.
 */
export function runMdsBuild(fakeRoot: string): BuildRun {
  const result = spawnSync(TSX_BIN, [BUILD_MDS_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, DEVFLOW_MDS_ROOT: fakeRoot },
  })
  if (result.error) throw result.error
  return { status: result.status, combined: (result.stdout ?? '') + (result.stderr ?? '') }
}

/** Copy the two directories the walk discovers hosts in into a fake root. */
export async function copyCommittedSources(fakeRoot: string): Promise<void> {
  for (const sub of ['commands', 'agents']) {
    await fsp.cp(
      path.join(ROOT, 'src', 'assets', sub),
      path.join(fakeRoot, 'src', 'assets', sub),
      { recursive: true },
    )
  }
}

export interface CommittedTreeBuild {
  run: BuildRun
  /** Temp root holding the COPY of src/assets/ and the dist/ tree built from it. */
  root: string
}

let committedTreeBuild: Promise<CommittedTreeBuild> | null = null

/**
 * Compile the committed .mds corpus ONCE, into a copy of it under a temp root.
 *
 * Callers that need real compiled artifacts — the printed host/partial census,
 * the dist/-is-in-sync compare, every content assertion over a compiled command
 * — read them from `<root>/dist/` instead of the repo's own dist/, which stays
 * untouched and can therefore be COMPARED rather than overwritten.
 *
 * Memoised per test file (each vitest file loads its own module instance): one
 * spawn serves every caller in that file. The promise, not the value, is cached
 * so concurrent callers await the same build. Pair with `cleanupCommittedTree`
 * in an `afterAll`.
 */
export function buildCommittedTree(): Promise<CommittedTreeBuild> {
  committedTreeBuild ??= (async (): Promise<CommittedTreeBuild> => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'devflow-mds-committed-'))
    await copyCommittedSources(root)
    return { run: runMdsBuild(root), root }
  })()
  return committedTreeBuild
}

/** Remove the memoised committed-tree build's temp root. Safe to call twice. */
export async function cleanupCommittedTree(): Promise<void> {
  const built = await committedTreeBuild?.catch(() => null)
  committedTreeBuild = null
  if (built) await fsp.rm(built.root, { recursive: true, force: true })
}

/**
 * Named collector: every `spawnSync(` site in a source text, and which of them
 * do not scope the child to DEVFLOW_MDS_ROOT. A test file that spawns builds
 * scans its own source with this so the isolation above cannot decay silently —
 * a prose invariant cannot detect a spawn someone adds without the env var.
 *
 * The options object is taken as the text up to the call's closing `});`,
 * bounded so a malformed source cannot make this scan run away.
 */
export function collectSpawnScoping(source: string): { total: number; unscoped: number[] } {
  const CALL = 'spawn' + 'Sync('   // split so this scanner never matches itself
  const MAX_SITES = 64
  const unscoped: number[] = []
  let total = 0
  for (let at = source.indexOf(CALL); at !== -1; at = source.indexOf(CALL, at + CALL.length)) {
    if (++total > MAX_SITES) {
      throw new Error(`more than ${MAX_SITES} ${CALL} sites — bound exceeded, scan aborted`)
    }
    const tail = source.slice(at, at + 1000)
    const end = tail.indexOf('});')
    const call = end === -1 ? tail : tail.slice(0, end)
    if (!call.includes('DEVFLOW_MDS_ROOT')) unscoped.push(at)
  }
  return { total, unscoped }
}

// ── Agent-source resolver ────────────────────────────────────────────────────
//
// Dist-preferred, src-fallback — the directory order comes from
// agentSourceDirs(), so this harness shares the production ordering convention
// rather than re-spelling it. ENOENT-tolerant on the dist side only.
// Throws with a build hint when neither location resolves — matching the
// "throw-with-a-build-hint, never skip" contract of requireDistFile above.
//
// Anti-pattern named explicitly: `scanned > 0` over the agent corpus.
// 15 of 16 agents survive `scanned > 0` while coverage of `git` silently
// disappears (GAP-07). Use resolveAllAgents() ⊇ getAllAgentNames() instead.

export interface AgentSource {
  path: string
  content: string
  origin: 'dist' | 'src'
}

export interface CorpusEntry {
  path: string
  content: string
}

/**
 * Resolve the source for a named agent: dist/agents first, src/assets/agents
 * fallback. Throws with a build hint when neither exists.
 *
 * @param root - Repository root to resolve paths against (default: ROOT).
 *   Pass a temp-dir root in tests to keep fixtures hermetic; all real callers
 *   use the default so no call sites change.
 */
export function resolveAgentSource(name: string, root: string = ROOT): AgentSource {
  // Order comes from agentSourceDirs() — the one owner of the dist-first policy.
  const [compiledDir, sourceDir] = agentSourceDirs(root)
  const distPath = path.join(compiledDir, `${name}.md`)
  if (existsSync(distPath)) {
    return { path: distPath, content: readFileSync(distPath, 'utf-8'), origin: 'dist' }
  }
  const srcPath = path.join(sourceDir, `${name}.md`)
  try {
    return { path: srcPath, content: readFileSync(srcPath, 'utf-8'), origin: 'src' }
  } catch {
    throw new Error(
      `Agent '${name}' not found at ${distPath} or ${srcPath}\n` +
      '  Run `npm run build` first (dist side is ENOENT-tolerant, src side is not)',
    )
  }
}

/**
 * Resolve all agents declared in DEVFLOW_PLUGINS.
 * Returns a Map keyed by agent name. Every consumer must assert:
 *   expect([...resolveAllAgents().keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))
 *
 * @param root - Repository root to resolve paths against (default: ROOT).
 *   Pass a temp-dir root in tests to keep fixtures hermetic.
 */
export function resolveAllAgents(root: string = ROOT): Map<string, AgentSource> {
  const result = new Map<string, AgentSource>()
  for (const name of getAllAgentNames()) {
    result.set(name, resolveAgentSource(name, root))
  }
  return result
}

// ── Corpus-spanning operation-section extractor ──────────────────────────────
//
// Two modes, explicit — no default. Either choice is silently wrong for one
// caller, so neither is the default [DR-18]:
//
//   'sole'  — the contract authority is a single file; throws when the anchor
//             matches in more than one corpus file, naming both paths. A first-
//             match implementation would accept a key declared only by a non-
//             authoritative provider (makes seam test permissive).
//
//   'union' — concatenates matching sections from all files; returns a match
//             count. A first-match implementation would silently under-count
//             the D11 posting-op floor without touching the literal 8 (the
//             exact evasion R2/H3 exist to prevent).

/**
 * Extract an ## Operation: section from a corpus.
 * Throws when the anchor is absent from every file in the corpus.
 * Throws when mode is 'sole' and the anchor matches in more than one file
 * (naming both paths — that is the intent; the first match is not the authority).
 */
export function extractOpSectionFromCorpus(
  corpus: CorpusEntry[],
  op: string,
  opts: { mode: 'union' | 'sole' },
): { content: string; matchCount: number } {
  const marker = `## Operation: ${op}`
  const matches: Array<{ path: string; section: string }> = []

  for (const entry of corpus) {
    const start = entry.content.indexOf(marker)
    if (start === -1) continue
    const nextSection = entry.content.indexOf('\n## ', start + marker.length)
    const section = nextSection === -1
      ? entry.content.slice(start)
      : entry.content.slice(start, nextSection)
    matches.push({ path: entry.path, section })
  }

  if (matches.length === 0) {
    throw new Error(
      `Anchor "## Operation: ${op}" not found in any of ${corpus.length} corpus file(s)`,
    )
  }

  if (opts.mode === 'sole' && matches.length > 1) {
    throw new Error(
      `'sole' mode: anchor "## Operation: ${op}" found in multiple files:\n` +
      matches.map(m => `  ${m.path}`).join('\n'),
    )
  }

  return {
    content: matches.map(m => m.section).join('\n'),
    matchCount: matches.length,
  }
}

// ── File tree walker ─────────────────────────────────────────────────────────
//
// Used by gitAgentSinkCorpus for recursive references/ traversal.
// The three existing walkers in tests/guards/ carry rel-prefix/extension lists
// and a depth cap that serve their own collector contracts — leave them as-is.

/**
 * Recursively walk `dir`, returning the absolute paths of all files for which
 * `accept` returns true, sorted deterministically.
 *
 * ENOENT or ENOTDIR on any node returns [] for that node (directory absent or
 * not a directory). Other errors (e.g. EACCES) propagate — they indicate a
 * genuine problem.
 *
 * Descent stops silently once the recursion reaches `maxDepth` levels below
 * the initial `dir` (default 8). No error is thrown when the cap is hit.
 *
 * @param dir - Absolute path of the directory to walk.
 * @param accept - Predicate applied to each file's absolute path.
 * @param maxDepth - Maximum recursion depth (default 8). Descent beyond this
 *   depth is silently skipped.
 */
export function walkFiles(
  dir: string,
  accept: (file: string) => boolean,
  maxDepth = 8,
  _depth = 0,
): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw err
  }
  const result: string[] = []
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (_depth < maxDepth) {
        result.push(...walkFiles(absPath, accept, maxDepth, _depth + 1))
      }
    } else if (accept(absPath)) {
      result.push(absPath)
    }
  }
  return result.sort()
}

// ── Git agent sink corpus ────────────────────────────────────────────────────
//
// git.md ∪ dist/skills/git/references/** (ENOENT-tolerant on the dist side).
// Used by the D11 forward/reverse/bypass guards so the floor stays ≥ 8
// when posting-op mechanics move into compiled reference files (Phase 2+).

/**
 * Build the D11 sink-class corpus: git.md (via the dist-preferred resolver)
 * plus all compiled skill references under dist/skills/git/references/**
 * (ENOENT-tolerant for Phase 0, before dist/skills/ is built).
 *
 * The references/ tree is walked recursively because Phase 2 nests operation
 * files at references/tracker/github/{op}.md — a flat readdirSync would miss
 * that depth.
 *
 * @param root - Repository root to resolve paths against (default: ROOT).
 *   Pass a temp-dir root in tests to keep corpus construction hermetic.
 */
export function gitAgentSinkCorpus(root = ROOT): CorpusEntry[] {
  const corpus: CorpusEntry[] = []

  // Primary: git.md (via dist-preferred resolver)
  const git = resolveAgentSource('git', root)
  corpus.push({ path: git.path, content: git.content })

  // Secondary: compiled skill references — walked recursively so Phase 2's
  // references/tracker/github/{op}.md depth is covered (ENOENT-tolerant)
  const refsDir = path.join(root, 'dist', 'skills', 'git', 'references')
  const refFiles = walkFiles(refsDir, f => f.endsWith('.md'))
  for (const filePath of refFiles) {
    corpus.push({ path: filePath, content: readFileSync(filePath, 'utf-8') })
  }

  return corpus
}

// ── Fence parsing helpers ─────────────────────────────────────────────────────
//
// These mirror registry-integrity.test.ts:449-456 verbatim (the repo's
// canonical fence-parsing precedent).

/**
 * Extract all triple-backtick code fences from content, including their
 * opening and closing fence markers.
 */
export function parseFences(content: string): string[] {
  const fences: string[] = []
  const fencePattern = /```[^\n]*\n([\s\S]*?)```/g
  let match
  while ((match = fencePattern.exec(content)) !== null) {
    fences.push(match[0])
  }
  return fences
}

/**
 * True when a code fence block is a spawn block for the named agent type.
 * Matches both Agent(subagent_type="X") and agentType: "X" forms.
 */
export function isAgentBlock(block: string, type: string): boolean {
  return (
    new RegExp(`Agent\\(subagent_type="${type}"`).test(block) ||
    new RegExp(`agentType:\\s*"${type}"`).test(block)
  )
}

// ── Golden fixture loader ────────────────────────────────────────────────────
//
// Throws with a command hint when the fixture is absent — never self-heals.
// A guard that silently skips on a missing fixture is not a guard (PF-018).
// A golden mismatch means the source is wrong, never the fixture (H2).

const GOLDENS_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden')

/**
 * Load a named golden fixture. Throws with the update-command hint when the
 * file is absent. Never auto-regenerates — CI must never call the update script.
 */
export function loadGolden(name: string): string {
  const fixturePath = path.join(GOLDENS_DIR, name)
  try {
    return readFileSync(fixturePath, 'utf-8')
  } catch {
    // Derive the stem for the command hint: strip extension for the update command
    const stem = name.replace(/\.[^.]+$/, '')
    throw new Error(
      `Golden fixture '${name}' not found at tests/fixtures/golden/${name}\n` +
      `  To regenerate: npm run test:golden:update -- ${stem}`,
    )
  }
}

// ── github-status-lines extractor ────────────────────────────────────────────
//
// Content-anchored extraction: each excerpt is located by a unique text anchor
// rather than a hard-coded line number. Adding or removing lines above a sampled
// section does not break the extractor. Must remain in sync with
// tests/fixtures/golden/github-status-lines.txt (AC-0.9).

/**
 * Extract the status-line corpus that matches tests/fixtures/golden/github-status-lines.txt.
 *
 * Anchors (not line numbers) drive extraction so the function survives line insertions
 * in git.md without fixture drift. The optional `gitContent` parameter allows callers
 * to supply an alternative git.md body (e.g. a baseline snapshot for proof testing).
 *
 * Reads through the dist-preferred resolver. The resolver's dist-preferred/src-fallback
 * choice is byte-neutral for this extractor because Phase 1's byte-equality gate requires
 * dist/agents/git.md to equal the source it is generated from.
 */
export function extractStatusLines(gitContent?: string): string {
  const git = gitContent ?? resolveAgentSource('git').content
  const code = resolveAgentSource('code').content
  const dynamicBuild = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'dynamic-build.mds'), 'utf-8')
  const resolveMds = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'resolve.mds'), 'utf-8')

  /**
   * Extract the named operation section from git.md.
   * Uses \n## Operation: as the boundary so output blocks that contain ## headings
   * (e.g. fetch-issue's "## Issue #{number}:" in its template) are not truncated.
   */
  function gitOp(opName: string): string {
    const heading = `## Operation: ${opName}`
    const start = git.indexOf(heading)
    if (start === -1) throw new Error(`git.md: operation section not found: "${opName}"`)
    const next = git.indexOf('\n## Operation:', start + heading.length)
    return git.slice(start, next === -1 ? git.length : next)
  }

  /**
   * Extract from the start of startAnchor's line through the end of endAnchor's line
   * (inclusive, no trailing newline). Both anchors may span multiple lines.
   */
  function between(src: string, startAnchor: string, endAnchor: string): string {
    const si = src.indexOf(startAnchor)
    if (si === -1) throw new Error(`between: start anchor not found: "${startAnchor.slice(0, 80)}"`)
    const lineStart = src.lastIndexOf('\n', si) + 1
    const ei = src.indexOf(endAnchor, si + startAnchor.length)
    if (ei === -1) throw new Error(`between: end anchor not found: "${endAnchor.slice(0, 80)}"`)
    const lineEnd = src.indexOf('\n', ei + endAnchor.length - 1)
    return src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd)
  }

  /** Extract the single line containing anchor (no trailing newline). */
  function singleLine(src: string, anchor: string): string {
    const i = src.indexOf(anchor)
    if (i === -1) throw new Error(`singleLine: anchor not found: "${anchor.slice(0, 80)}"`)
    const ls = src.lastIndexOf('\n', i) + 1
    const le = src.indexOf('\n', i)
    return src.slice(ls, le === -1 ? src.length : le)
  }

  const parts: string[] = [
    // git.md cross-cutting: D4 degradation contract (baseline lines 23-28)
    between(git, '**Degradation contract (D4):**', 'raise the inter-operation delay from 1s to 3s for the remainder of the batch.'),
    // blank separator line within the D10 section (baseline line 33)
    '',
    // D10 step 2 (baseline line 36)
    singleLine(git, '2. Resolve `REVIEW_PUBLICATION` input:'),
    // D11 Comment-sink scrub rules (baseline lines 54-57)
    between(git, '- Non-zero scrubber exit OR script missing → **DO NOT POST**', '- **Always post `$DEVFLOW_BODY` (scrubbed), never `$DEVFLOW_BODY_RAW`.**'),
    // ensure-pr-ready output template (baseline lines 140-149)
    between(gitOp('ensure-pr-ready'), '- Committed: {yes/no} ({message} if yes)', '{Any `TRACEABILITY: DEGRADED ({reason})` lines from steps 4b/4c — these never change the READY/BLOCKED verdict}'),
    // validate-branch output block (baseline lines 174-191)
    between(gitOp('validate-branch'), '## Pre-Flight: Validation', '{BLOCKED reason if applicable}'),
    // setup-task output block (baseline lines 238-252)
    between(gitOp('setup-task'), '## Task Setup: {branch-name}', '- **Acceptance Criteria**: {criteria}'),
    // fetch-issue D4 + output block (baseline lines 268-290)
    // Must use gitOp() to avoid ## truncation on "## Issue #{number}:" in the output template
    between(gitOp('fetch-issue'), '**Degradation (D4):** `gh` unauthenticated or absent, tracker unavailable', '{type}/{number}-{slug}'),
    // fetch-issues-batch D4 + output block (baseline lines 314-339)
    // Must use gitOp() to avoid ## truncation on "## Issues Batch" in the output template
    between(gitOp('fetch-issues-batch'), '**Degradation (D4):** `gh` unauthenticated or absent, tracker unavailable', '- **Conflicts**: {conflicting requirements if any}'),
    // post-review-summary STUB output template (baseline lines 381-386)
    between(gitOp('post-review-summary'), '     {counts-by-severity table verbatim from local artifact', 'Cap body at 60000 characters'),
    // manage-debt process + D4 (baseline lines 411-420)
    between(gitOp('manage-debt'), '3. Extract items to add:', '`Tracked` stays `(pending — TRACEABILITY: DEGRADED ({reason}))` in resolution-summary.md.'),
    // check-ci-status input + process (baseline lines 441-451): leading and trailing blank lines
    '\n' + between(gitOp('check-ci-status'), '**Input:** `PR_NUMBER`', '6. List failing/pending checks with names') + '\n',
    // create-release process steps (baseline lines 479-485)
    between(gitOp('create-release'), '1b. Conventions: if `.devflow/conventions.md` exists', '…and {n} more commits` line (D4 degrade if enrichment fails)'),
    // gather-release-evidence input + process (baseline lines 507-518)
    between(gitOp('gather-release-evidence'), '**Input:** `WORKTREE_PATH` (optional)', '**Output:**'),
    // learn-conventions version-names + degradation + output opener (baseline lines 582-594): leading blank
    '\n' + between(gitOp('learn-conventions'), '   ## Version Names', '**Output:**\n```markdown'),
    // fetch-review-threads process + output header (baseline lines 625-644)
    between(gitOp('fetch-review-threads'), '3. Apply devflow-authored exclusion predicate', '### External Thread Records'),
    // resolve-review-threads reply loop (baseline lines 694-704): trailing blank
    between(gitOp('resolve-review-threads'), 'unexplained unresolved threads.', '4. Wait 1s between operations') + '\n',
    // post-resolution-summary STUB output template (baseline lines 754-757): trailing blank
    between(gitOp('post-resolution-summary'), '     Full summary withheld (public repository).', '     {counts-by-severity table verbatim from local artifact') + '\n',
    // check-merge-readiness PR + CI fetch steps (baseline lines 785-787)
    between(gitOp('check-merge-readiness'), '2. Fetch PR review decision:', '3. Fetch CI status (same logic as `check-ci-status`)'),
    // backlink-shipped-issues per-issue steps (baseline lines 834-842)
    between(gitOp('backlink-shipped-issues'), '1. Fetch existing comments authored by the viewer:', 'Apply the Comment-sink scrub (D11) and post via `gh issue comment {number} --body-file "$DEVFLOW_BODY"`.'),
    // ensure-traceable-issue plan-artifact + create steps (baseline lines 877-881)
    between(gitOp('ensure-traceable-issue'), '     ```\n   - If `PLAN_ARTIFACT_PATH` provided:', '- Title: derived from `TASK_DESCRIPTION` (same slug logic as setup-task)'),
    // post-wave-report dedup check + compose steps (baseline lines 917-920)
    between(gitOp('post-wave-report'), '   - If found: skip — report `Skipped: wave report for {WAVE_ID} already posted`', '3. Compose the comment body:\n   ```markdown'),
    // Guard-5 dedup marker lines (baseline lines 366, 742, 921)
    // Use 5-space / 3-space prefix to target the template lines, not the search-step lines
    // that also reference these markers within the same operation section.
    singleLine(gitOp('post-review-summary'), '     <!-- devflow:review-summary'),
    singleLine(gitOp('post-resolution-summary'), '     <!-- devflow:resolution-summary'),
    singleLine(gitOp('post-wave-report'), '   <!-- devflow:wave-report'),
    // code.md: PR-body guidance table and D11 scrub directive (lines 93, 95, 99)
    singleLine(code, '| Related Issues (ISSUE_NUMBER provided) |'),
    singleLine(code, 'When `ISSUE_NUMBER` is provided, always include'),
    singleLine(code, '**D11 scrub (PR body is a GitHub-visible sink):**'),
    // dynamic-build.mds: wave-report dedup and DEGRADED rules (lines 522, 524)
    singleLine(dynamicBuild, 'The Git agent deduplicates via marker'),
    singleLine(dynamicBuild, 'In WAVE mode, if no tracking-issue number'),
    // resolve.mds: Tracked field rules and phase diagram (lines 244, 354, 501, 510, 541, 619)
    singleLine(resolveMds, 'Set `Tracked` for FIX_SEPARATE and TECH_DEBT items'),
    singleLine(resolveMds, '- **DEGRADED**: if Git agent returns `TRACEABILITY: DEGRADED'),
    singleLine(resolveMds, '├─ Phase 5: Write resolution-summary.md (compaction safety'),
    singleLine(resolveMds, '├─ Phase 9: Git agent (manage-debt)'),
    singleLine(resolveMds, '| gh/GitHub absent | manage-debt degrades'),
    singleLine(resolveMds, '| Issue | File:Line | Reason | Tracked |'),
  ]

  return parts.join('\n') + '\n'
}

/**
 * Extract a named section from markdown content.
 * Returns the content from startAnchor to endAnchor (or end of string).
 * Throws loudly if either anchor is absent.
 */
export function extractSection(content: string, startAnchor: string, endAnchor: string | null): string {
  const start = content.indexOf(startAnchor)
  if (start === -1) throw new Error(`Anchor not found: "${startAnchor}"`)
  if (endAnchor === null) return content.slice(start)
  const end = content.indexOf(endAnchor, start + startAnchor.length)
  if (end === -1) throw new Error(`End anchor not found after "${startAnchor}": "${endAnchor}"`)
  return content.slice(start, end)
}

/**
 * Canonical ManifestData factory for tests.
 *
 * Returns a minimal but structurally complete ManifestData with:
 * - flags: FlagsRecord (Phase 2: was string[])
 * - No knownFlags / viewMode fields (deprecated; healed away on readManifest)
 *
 * Use deep-spread to override individual fields:
 *   makeManifest({ features: { ...makeManifest().features, proxy: true } })
 *
 * This factory is the canonical source for ManifestData test fixtures.
 * Tests that write to disk via writeManifest should use this factory so
 * readManifest round-trips produce bit-identical results (no heal cycle).
 */
export function makeManifest(overrides: Partial<ManifestData> = {}): ManifestData {
  return {
    version: '2.0.0',
    plugins: ['devflow-implement', 'devflow-code-review'],
    scope: 'user',
    features: {
      ambient: true,
      memory: true,
      hud: true,
      knowledge: true,
      learning: true,
      rules: true,
      proxy: false,
      compliance: { enabled: false, frameworks: [] },
      flags: { tui: true, lsp: true, 'tool-search': true },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Pure function mirroring the fp_ratio formula documented in command surfaces.
 * Denominator = fp_count + fixed_count + deferred_count.
 * Returns 0 when denominator is 0 or any input is NaN/non-finite (parse failure path).
 */
export function computeFpRatio(fpCount: number, fixedCount: number, deferredCount: number): number {
  if (!Number.isFinite(fpCount) || !Number.isFinite(fixedCount) || !Number.isFinite(deferredCount)) {
    return 0
  }
  const denominator = fpCount + fixedCount + deferredCount
  if (denominator === 0) return 0
  return fpCount / denominator
}

// ── Frontmatter splitting ────────────────────────────────────────────────────

/** A document's leading `---…---` frontmatter block and the text after it. */
export interface FrontmatterSplit {
  /** The whole block, both `---` delimiters and the trailing newline included. */
  block: string
  /** The block's inner text, delimiters and their newlines excluded. */
  inner: string
  /** Everything after the block. */
  body: string
}

/**
 * Split a document at its leading frontmatter block; null when it has none.
 *
 * One owner for the `^---…---` shape, which was reimplemented per test file:
 * every caller then agrees on the same CRLF handling and the same answer for a
 * block that is not at byte offset 0. Only a block at the very start counts —
 * that is the rule the Claude Code loader and the MDS build both apply.
 */
export function splitFrontmatter(text: string): FrontmatterSplit | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (!match) return null
  return { block: match[0], inner: match[1], body: text.slice(match[0].length) }
}
