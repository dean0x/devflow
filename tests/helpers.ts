import { readFileSync, readdirSync, existsSync, statSync, promises as fsp } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { type ManifestData } from '../src/core/manifest.js'
import { DEFAULT_TRACKER_PROVIDER } from '../src/core/tracker.js'
import { getAllAgentNames } from '../src/core/plugins.js'
import { agentSourceDirs, compiledSkillRefsDir } from '../src/core/assets.js'
import { MAX_REFERENCE_SWEEP_DEPTH } from '../src/core/reference-sweep.js'

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

/** One compile input and when it was last written. */
interface CompileInput {
  readonly file: string
  readonly mtimeMs: number
}

/**
 * Named collector: the most recently modified source `tsc` compiles into `dist/`.
 *
 * The input set is tsconfig.json's — `src/**` minus the `src/assets` tree, which
 * is copied and never compiled — restated here as an extension filter plus that
 * one exclusion rather than parsed out of the config. The scan is a CURRENCY
 * check, not a build: over-reading a file tsc ignores can only report a stale
 * dist one edit early, while under-reading one it compiles is the exact failure
 * this exists to prevent, so the filter errs wide.
 *
 * Returns null when the tree holds no compile input at all, which the caller
 * separates into "this root is not a source tree" and "the scan went empty".
 */
function newestCompileInput(srcDir: string): CompileInput | null {
  const excluded = path.join(srcDir, 'assets') + path.sep
  const files = walkFiles(
    srcDir,
    file => (file.endsWith('.ts') || file.endsWith('.json')) && !file.startsWith(excluded),
  )
  let newest: CompileInput | null = null
  for (const file of files) {
    const { mtimeMs } = statSync(file)
    if (newest === null || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs }
  }
  return newest
}

/**
 * Resolve the compiled CLI entrypoint and return its absolute path.
 * Throws — does NOT skip — when absent OR STALE. A guard that silently skips on a
 * missing build artifact is not a guard: a skipped subprocess-CLI test proves
 * nothing about the CLI, and a SKIP mark reads as "fine" in a CI log.
 *
 * EXISTENCE IS NOT CURRENCY. This is the gate on the only executable coverage of
 * a `devflow` action BODY, and a `dist/cli.js` older than the sources it was
 * compiled from certifies a build nobody is shipping — PF-018's first mechanism
 * in its quietest form, where the target exists but is not the one under review.
 * So the artifact is compared against the newest compile input and a stale one
 * fails LOUD, naming the build step, exactly as an absent one does.
 *
 * WHY MTIME AND NOT A CONTENT STAMP. The build writes no stamp (`npm run build`
 * is `rm -rf dist && tsc && build-mds`), and mtime is sound for both orderings
 * that actually occur: CI checks out, then builds into a freshly removed `dist/`,
 * so every artifact is newer than every source; locally an edit after a build is
 * precisely the state this reports. There is no cached-`dist/` restore step in
 * either workflow that could invert the two.
 *
 * @param root - Repository root to resolve paths against (default: ROOT).
 *   Pass a temp-dir root in tests to verify throw behaviour without touching the real dist.
 */
export function requireBuiltCli(root: string = ROOT): string {
  const cliPath = path.join(root, 'dist', 'cli.js')
  if (!existsSync(cliPath)) {
    throw new Error(
      'dist/cli.js is absent — run `npm run build` first\n' +
      '  (this guard spawns the compiled CLI as a subprocess and cannot be skipped)',
    )
  }

  const srcDir = path.join(root, 'src')
  const newest = newestCompileInput(srcDir)
  if (newest === null) {
    // A hermetic temp root carries a `dist/` and no sources; there is nothing for
    // it to be stale against, and the absence arm above is the only claim it can
    // make. A root that HAS a `src/` and yields no compile input is a scan that
    // went empty, which would make every currency check below vacuous (PF-018).
    if (!existsSync(srcDir)) return cliPath
    throw new Error(
      `${srcDir} exists but holds no .ts/.json compile input — the currency check below ` +
      'would pass by reading nothing, which is the vacuous-guard shape it exists to refuse',
    )
  }

  const builtMs = statSync(cliPath).mtimeMs
  if (builtMs < newest.mtimeMs) {
    throw new Error(
      'dist/cli.js is STALE — run `npm run build` first\n' +
      `  ${path.relative(root, newest.file)} was modified after the CLI was compiled\n` +
      '  (this guard spawns the compiled CLI as a subprocess: a stale artifact certifies\n' +
      '   a build nobody is shipping, so it cannot be skipped and must not be tolerated)',
    )
  }
  return cliPath
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
 *
 * Module-local: `buildCommittedTree` below is the sole caller in this file, and
 * every other test file spawns the build through its own `runBuild` against its
 * own fake root rather than importing this one.
 */
function runMdsBuild(fakeRoot: string): BuildRun {
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
  // 'mds' carries the reference modules (src/assets/mds/tracker/*.mds). Omitting
  // it would leave the copied tree one host short of the committed one, so the
  // build's printed census and the dist/-staleness compare would both assert
  // about a corpus the real build does not have.
  for (const sub of ['commands', 'agents', 'mds']) {
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

// ── Fenced-code-block awareness for column-0 section boundaries ──────────────
//
// D-FENCE-AWARE-BOUNDARY (PF-063). A `## ` line at column 0 inside a fenced code
// block is payload, not structure: `tracker/github/manage-debt.md`'s `## Items`
// is the literal body of the successor tech-debt issue, and
// `tracker/github/ensure-traceable-issue.md` carries six such lines across its
// `gh issue create` heredoc and its D3 template fence. A terminator search that
// reads them as headings ends the operation's section mid-fence — the bytes stay
// on disk, containment-green, while every union-mode guard reading that section
// examines an empty tail. PF-063's recorded remedy is to make the rule structural
// and assert it; `collectUnfencedLines` is the structural half — the ONE fence
// scanner every "is this column-0 line structure or payload?" question routes
// through. Its callers: `collectUnfencedH2` (below) for `## ` section
// boundaries, shared by the extractor and by the per-op reference guard in
// tests/tracker/; and `capability-hoist`'s process-block terminator, which
// closes on `## `/`### `/`**Output:**`/`---` and had re-derived the rule locally.
// A collector that re-derives it drifts the moment the rule moves, and its probe
// stays green while the real rule has changed (PF-018).
//
// Fence grammar — a deliberate CommonMark subset:
//   open  — a line whose first non-space characters, after at most 3 leading
//           spaces, are 3+ backticks or 3+ tildes (a backtick fence's info string
//           may not itself contain a backtick);
//   close — a later line with at most 3 leading spaces carrying the same marker
//           character, a run at least as long as the opening one, and nothing
//           after it but whitespace;
//   an unclosed fence runs to the end of the text.
//
// Deliberate non-goals, written down rather than inferred from a green run
// (PF-064): 4-space-indented code blocks, HTML blocks, and fences opened 4+
// spaces deep inside a list item are not modelled. Every `## ` inside one of
// those is itself indented, so it is not a column-0 `## ` line and could not
// terminate a section under either the old rule or this one.
//
// Where the rules are probed: directly against this scanner in
// tests/guards/fence-grammar.test.ts (one synthetic corpus per rule, each proven
// red against the inverted rule), and end-to-end through the section extractor
// in tests/guards/agent-source-resolver.test.ts. A rule with no probe can be
// inverted with the whole suite still green (PF-018), so a rule added here is a
// probe added there.

const FENCE_MARKER_RE = /^ {0,3}(`{3,}|~{3,})/

/** One line that sits outside every fenced code block. */
export interface UnfencedLine {
  /** 1-based line number. */
  line: number
  /** Offset of the line's first character within `text`, in the units `String.slice` takes. */
  index: number
  /** The line, verbatim. */
  text: string
}

/** A `collectUnfencedH2` site: the heading starts at column 0, so `index` is its `#`. */
export type UnfencedH2 = UnfencedLine

/** The opening delimiter of a fence the text never closes. */
export interface UnclosedFence {
  /** 1-based line number of the opening delimiter. */
  line: number
  /** Offset of the delimiter's first character within `text`, in the units `String.slice` takes. */
  index: number
  /** The opening line, verbatim — its info string names the fence a fix must close. */
  text: string
}

/** What one pass of the fence scanner saw. */
interface FenceScan {
  /** Accepted lines outside every fence, in document order. */
  readonly sites: UnfencedLine[]
  /** The fence still open when the text ran out, or null when every fence closed. */
  readonly unclosed: UnclosedFence | null
}

/**
 * The single pass both public collectors read. Private on purpose: callers ask
 * either "which column-0 lines are structure?" or "does the text end inside a
 * fence?", and answering both from one scan is what keeps the grammar in one
 * place. A second scanner drifts from this one the moment a rule moves, and its
 * probe stays green while the real rule has changed (PF-018).
 */
function scanFences(text: string, accept: (line: string) => boolean): FenceScan {
  const sites: UnfencedLine[] = []
  const lines = text.split('\n')
  let offset = 0
  let open: { char: string; length: number; opener: UnclosedFence } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const marker = FENCE_MARKER_RE.exec(line)
    if (open === null) {
      if (marker !== null) {
        const run = marker[1]
        const info = line.slice(marker[0].length)
        if (run[0] !== '`' || !info.includes('`')) {
          open = {
            char: run[0],
            length: run.length,
            opener: { line: i + 1, index: offset, text: line },
          }
        }
      } else if (accept(line)) {
        sites.push({ line: i + 1, index: offset, text: line })
      }
    } else if (
      marker !== null &&
      marker[1][0] === open.char &&
      marker[1].length >= open.length &&
      line.slice(marker[0].length).trim() === ''
    ) {
      open = null
    }
    offset += line.length + 1
  }

  return { sites, unclosed: open === null ? null : open.opener }
}

/**
 * Named collector — the harness's ONE fence scanner. Returns every line of
 * `text` that sits outside every fenced code block and satisfies `accept`, in
 * document order.
 *
 * `accept` sees the raw line, so a caller expresses its own shape (a `## `
 * heading, a process-block terminator) while the fence rule stays here.
 */
export function collectUnfencedLines(
  text: string,
  accept: (line: string) => boolean,
): UnfencedLine[] {
  return scanFences(text, accept).sites
}

/**
 * Named collector: every column-0 `## ` line in `text` that is NOT inside a
 * fenced code block, in document order.
 *
 * This is the single owner of "is this `## ` structure or payload?" — the
 * section extractor and the generated-reference structure guard must not
 * re-derive it, or a probe can stay green after the real rule changes
 * (PF-018).
 */
export function collectUnfencedH2(text: string): UnfencedH2[] {
  return collectUnfencedLines(text, line => line.startsWith('## '))
}

/**
 * Named collector: the opening delimiter of a fence `text` never closes.
 *
 * "An unclosed fence runs to the end of the text" is the one rule of the grammar
 * above whose blast radius is the whole document. Past an unclosed delimiter
 * every column-0 `## ` is payload, so every union-mode section extraction runs to
 * end of file, every absence assertion over the tail is satisfied for the wrong
 * reason, and the fenced-`## ` non-vacuity floor counts UP as the corpus
 * degrades — all three numbers a reader would check move the reassuring way
 * (PF-018). The corpus-wide assertion that no shipped file is in that state
 * lives in tests/guards/fence-grammar.test.ts.
 *
 * Returns at most one entry, which is a property of the grammar and not of this
 * function: the scan carries a single open state, so the first delimiter able to
 * close a fence closes it, and only the final unmatched opener can survive to end
 * of text. The array shape is what callers aggregate across a corpus
 * (`files.flatMap(...)`), and keeps the empty assertion spelled the way every
 * other named collector here spells it.
 *
 * Deliberate non-goal (PF-064): a fence a writer forgot to close, which a later
 * unrelated delimiter happens to close, is balanced under this grammar and is not
 * reported. What is asserted is exactly what the rule states — the text does not
 * end inside a fence.
 */
export function collectUnclosedFences(text: string): UnclosedFence[] {
  const { unclosed } = scanFences(text, () => false)
  return unclosed === null ? [] : [unclosed]
}

/**
 * Bounded memo over `collectUnfencedH2`, keyed by the exact document text.
 *
 * The extractor below needs one whole-document fence scan per corpus file, but
 * it is called once per (op, file) PAIR — 18 operations over a ~24-file sink
 * corpus re-parsed every file 18 times to answer a question whose answer is a
 * property of the file alone. The memo is keyed on content rather than on the
 * `CorpusEntry` object because the corpus builders return fresh objects on
 * every call, so an identity-keyed cache would never hit.
 *
 * The capacity bound is deliberate: an unbounded module-level cache in a
 * long-running vitest worker retains every document the suite ever extracted
 * from. FIFO eviction (Map preserves insertion order) over a limit comfortably
 * above the largest real corpus keeps the steady state a pure hit.
 */
const UNFENCED_H2_MEMO_LIMIT = 64
const unfencedH2Memo = new Map<string, readonly UnfencedH2[]>()

function unfencedH2Index(text: string): readonly UnfencedH2[] {
  const cached = unfencedH2Memo.get(text)
  if (cached !== undefined) return cached
  const sites = collectUnfencedH2(text)
  if (unfencedH2Memo.size >= UNFENCED_H2_MEMO_LIMIT) {
    const oldest = unfencedH2Memo.keys().next()
    if (oldest.done !== true) unfencedH2Memo.delete(oldest.value)
  }
  unfencedH2Memo.set(text, sites)
  return sites
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
 *
 * Both ends of the section come from the SAME unfenced-heading index, so the
 * anchor is line-bounded and fence-aware by construction: the section runs from
 * the operation's own UNFENCED column-0 `## ` line to the next one, or to end of
 * file (D-FENCE-AWARE-BOUNDARY / PF-063 — see `collectUnfencedH2`).
 *
 * Both properties fix a real defect the earlier `indexOf(marker)` start had,
 * where only the terminator was fence-aware:
 *
 *   line-bounded — `## Operation: fetch-issue` prefix-matched
 *     `fetch-issues-batch.md`'s own line-1 heading, so every union lookup for
 *     `fetch-issue` silently concatenated the sibling operation's whole
 *     mechanics file (matchCount 3 over a corpus holding 2 `fetch-issue`
 *     sections). Every guard reading that section was over-broad by
 *     construction, whatever it happened to assert.
 *
 *   fence-aware — a `## Operation:` line quoted inside a fenced sample is
 *     payload, exactly as the terminator already treated it. While the start was
 *     fence-blind, such a sample made 'sole' mode throw "found in multiple
 *     files", which reads as a corpus-scope bug rather than as a fenced sample.
 *
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
    const headings = unfencedH2Index(entry.content)
    // `trimEnd` so the anchor must be the whole heading line: trailing whitespace
    // is invisible in a diff, a sibling operation's name is not.
    const at = headings.findIndex(h => h.text.trimEnd() === marker)
    if (at === -1) continue
    // Cut at the newline that PRECEDES the next unfenced heading, so the section
    // carries no trailing blank line and the heading belongs to the next section.
    const terminator = headings[at + 1]
    const section = terminator === undefined
      ? entry.content.slice(headings[at].index)
      : entry.content.slice(headings[at].index, terminator.index - 1)
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
 * DEPTH. Among the walks over the generated reference tree this is the third,
 * after the build's prune and the installer's sweep, so it takes its bound from
 * the same owner rather than re-spelling one: MAX_REFERENCE_SWEEP_DEPTH in
 * src/core/reference-sweep.ts, on that module's convention — the walked root is
 * depth 0, the bound is the deepest directory a walk may descend INTO, and
 * `depth > bound` is the breach. Each walker carrying its own literal is how the
 * first two came to disagree on both the number of levels and on what happens at
 * the last one; the same bound governs the source asset trees walked here.
 *
 * A breach is loud here too, and for the harness's own reason: a walk that
 * stopped at the bound and returned anyway would hand a collector a corpus
 * smaller than the tree it claims to cover, and every guard reading from it
 * would pass over ground it never saw. A test helper may throw, so it throws —
 * the build throws on the same breach, the sweep reports it in `failed`, and
 * none of the three passes it over.
 *
 * `maxDepth` is a per-call-site SCOPE, not a second bound: narrowing it (a
 * caller that wants one flat level) stops descent silently, because stopping is
 * what that caller asked for. It may only narrow — the shared bound is the
 * ceiling and is checked first.
 *
 * @param dir - Absolute path of the directory to walk.
 * @param accept - Predicate applied to each file's absolute path.
 * @param maxDepth - Deliberate scope cap, at most MAX_REFERENCE_SWEEP_DEPTH
 *   (the default). Directories below it are skipped silently.
 * @throws If the walk reaches a directory deeper than MAX_REFERENCE_SWEEP_DEPTH.
 */
export function walkFiles(
  dir: string,
  accept: (file: string) => boolean,
  maxDepth: number = MAX_REFERENCE_SWEEP_DEPTH,
  _depth = 0,
): string[] {
  if (_depth > MAX_REFERENCE_SWEEP_DEPTH) {
    throw new Error(
      `walkFiles: descent into ${dir} exceeds the bound of ` +
      `${MAX_REFERENCE_SWEEP_DEPTH} levels — no tree the harness walks is this ` +
      'deep, and a walk that stopped here would report a corpus smaller than the ' +
      'tree it claims to cover.',
    )
  }
  if (_depth > maxDepth) return []

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
      result.push(...walkFiles(absPath, accept, maxDepth, _depth + 1))
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

// ── Tracker reference-naming collector ───────────────────────────────────────
//
// One collector for the AC-2.5/AC-2.7 single-naming-line claim, shared by the
// containment and byte-budget suites so both assert over the same definition of
// "names a reference path" (PF-018: a probe that re-implements the collector
// proves the copy is live, not the guard).

/**
 * Named collector: lines of the compiled agent that name a `references/tracker/`
 * path.
 *
 * Both suites drive this one function — the live assertion (exactly one such
 * line, inside the preamble) and the known-bad probes that seed a second line.
 */
export function collectTrackerNamingLines(content: string): string[] {
  return content.split('\n').filter(line => line.includes('references/tracker/'))
}

// ── Per-item fetch collector ([DR-08]) ───────────────────────────────────────
//
// §14.4 fixes `fetch_batch` as a SINGLE-QUERY capability for every provider, and
// [DR-08] states the negative that keeps it one: no per-item fetch verb may appear
// in any provider's `fetch-issues-batch` reference. The claim is made twice by
// design — once per provider inside that provider's own suite, once across every
// provider in tests/provider-literals.test.ts — so the shape table lives HERE
// rather than in either of them. Two copies of the table would be two authorities
// on what a per-item fetch looks like, which is the divergence [DR-19] forbids one
// level down; and a test file cannot import another test file's export without
// re-registering its suites.

/**
 * Shapes that betray a per-item fetch inside a `fetch-issues-batch` reference.
 *
 * Two classes, and both are needed. A TOOL-NAME verb (`getJiraIssue`, `get_issue`)
 * is what an author reaches for when writing against a server's catalogue; a
 * CAPABILITY name (`fetch by key`) is what an author reaches for when writing
 * against this repo's own capability-first doctrine. §14.4's [DR-08] row names
 * both — "`getJiraIssue`, `get_issue`, or any single-key fetch capability" — and a
 * table covering only the first would be inert against the module this repo's own
 * rules steer an author towards writing.
 *
 * `fetch-issue` — the single-issue OPERATION's own name — is in the table for the
 * same reason, and it is the shape that actually caught something: "request the
 * same projection `fetch-issue` requests" was a harmless cross-reference in a first
 * draft, but "call `fetch-issue` for each key" is the per-item loop written in
 * devflow's own vocabulary, and no regex can tell those two apart. A batch
 * reference therefore names the sibling op by DESCRIPTION rather than by name,
 * which costs one word and leaves the table unambiguous.
 *
 * Every entry carries a trailing `\b`, which is what keeps the op anchor line
 * `## Operation: fetch-issues-batch` out of the results: the `s` after `issue` is
 * a word character, so the plural is not the singular.
 */
export const PER_ITEM_FETCH_SHAPES: readonly RegExp[] = [
  /\bget[_-]?jira[_-]?issue\b/i,
  /\bget[_-]?issue\b/i,
  /\bfetch[_-]?issue\b/i,
  /\bfetch by key\b/i,
]

/** Named collector: per-item fetch shapes in a batch reference, as `{line}: {match}`. */
export function collectPerItemFetchVerbs(text: string): string[] {
  const found: string[] = []
  for (const [i, line] of text.split('\n').entries()) {
    for (const shape of PER_ITEM_FETCH_SHAPES) {
      const match = shape.exec(line)
      if (match !== null) found.push(`${i + 1}: ${match[0]}`)
    }
  }
  return found
}

// ── ~/.devflow/tracker.md schema parsers (§14.3) ──────────────────────────────
//
// The schema has a WRITER (the Tracker agent's embedded template, 3a-2) and a
// READER (the Git-agent preamble, 3a-4) — conflict C12. The two-sided equality
// test between them cannot catch drift in its own oracle, so the heading list
// and the parsers live here, once, and every suite binds to these.

/** Info string of the fence inside the Tracker agent that holds the template. */
export const TRACKER_TEMPLATE_FENCE_TAG = 'tracker-md-template'

/**
 * How many sections §14.3 fixes.
 *
 * A separate literal so the list below is checked against a NUMBER rather than
 * against its own length. A drop-one edit that also decrements this constant is
 * a deliberate schema change; one that does not is the accident the oracle
 * refuses at import.
 */
export const TRACKER_SCHEMA_SECTION_COUNT = 11

/**
 * Named collector: the ways a candidate §14.3 heading list fails to be an oracle.
 *
 * Three mutation classes, each reported by name:
 *   - DUPLICATE — the same heading twice. A duplicate inflates every length
 *     comparison while the schema it describes has shrunk, which is how a
 *     `>= 11` floor accepts a ten-section list.
 *   - SHORT — fewer distinct headings than §14.3 fixes (drop-one).
 *   - LONG — more (add-one).
 *
 * WHAT A CLEAN RESULT DOES NOT COVER, recorded beside the rule rather than left
 * to be inferred (PF-064). A heading RENAMED here, in the Tracker agent's
 * template and in the Git-agent's reader block, all in one commit, is well
 * formed and passes. That is a declared NON-GOAL, not an oversight: §14.3 is a
 * design artifact under `.devflow/docs/design/`, which is gitignored, so no
 * committed file can arbitrate a synchronized rename. This list is a THIRD PARTY
 * to the writer and the reader — it catches a schema that silently SHRINKS, and
 * it is silent about one that is consistently re-spelled.
 */
export function collectSchemaOracleDefects(sections: readonly string[]): string[] {
  const defects: string[] = []
  const distinct = new Set<string>()
  for (const section of sections) {
    if (distinct.has(section)) defects.push(`duplicate heading: ${section}`)
    distinct.add(section)
  }
  if (distinct.size !== TRACKER_SCHEMA_SECTION_COUNT) {
    defects.push(
      `${distinct.size} distinct heading(s); §14.3 fixes ${TRACKER_SCHEMA_SECTION_COUNT}`,
    )
  }
  return defects
}

/**
 * Check the §14.3 list's shape, then freeze it — or throw naming the defect.
 *
 * Fail-loud at import, on the same reasoning as `requireBuiltCli` above: every
 * tracker-schema guard in the suite binds to this list, so a list that has
 * quietly lost a section makes each of them compare against the wrong contract
 * while staying green. A helper may throw, so it throws.
 *
 * Exported so the throw itself can be driven over a mutated list, rather than
 * only the predicate behind it: a guard whose reporting arm has never been shown
 * to fire is a guard nobody has seen work.
 */
export function requireSchemaOracle(sections: readonly string[]): readonly string[] {
  const defects = collectSchemaOracleDefects(sections)
  if (defects.length > 0) {
    throw new Error(
      'TRACKER_SCHEMA_SECTIONS is not a usable oracle — every tracker-schema guard binds ' +
      'to it, so each would compare against a contract §14.3 does not state:\n  ' +
      defects.join('\n  '),
    )
  }
  return Object.freeze(sections)
}

/**
 * The `~/.devflow/tracker.md` section headings, in order, verbatim from §14.3.
 *
 * `## Project` carries two values (site and key) and is therefore ONE heading
 * with two validator rows — §14.3's table splits the rows, not the section.
 * `learned:` is deliberately absent from the frontmatter set below: it has no
 * stated consumer, and an unread key is residue (ADR-003 clause iii).
 *
 * Its SHAPE is settled here, once, at import: exactly
 * `TRACKER_SCHEMA_SECTION_COUNT` distinct headings, no repeats. A consumer
 * therefore compares against this list rather than re-deriving a floor of its
 * own — a floor that counts duplicates is satisfied by a list that has dropped
 * one section and repeated another. `tests/tracker/schema-oracle.test.ts` drives
 * `collectSchemaOracleDefects` over each of those mutations, so the check above
 * is shown live rather than assumed.
 */
export const TRACKER_SCHEMA_SECTIONS: readonly string[] = requireSchemaOracle([
  '## Project',
  '## Issue Types',
  '## Required Fields',
  '## Iteration Policy',
  '## Transitions',
  '## Assignee',
  '## Tech Debt',
  '## Wave Filter',
  '## Reference Rendering',
  '## Dedup Strategy',
  '### Substitutions',
])

/** Frontmatter keys of the written file (§14.3). */
export const TRACKER_SCHEMA_FRONTMATTER_KEYS: readonly string[] = ['provider', 'inferred-from']

/**
 * Named collector: the tagged template fence's inner text, or null.
 *
 * Addressed by its info string rather than by position — "the first fence"
 * silently re-points at whatever fence an edit happens to put first.
 */
export function collectTrackerTemplate(content: string): string | null {
  const re = new RegExp('```' + TRACKER_TEMPLATE_FENCE_TAG + '\\n([\\s\\S]*?)```', 'm')
  return re.exec(content)?.[1] ?? null
}

/** Named collector: `##`/`###` headings inside the template, in document order. */
export function collectTrackerTemplateHeadings(template: string): string[] {
  return template
    .split('\n')
    .filter(l => /^#{2,3} \S/.test(l))
    .map(l => l.trim())
}

/** One row of the agent's schema/validator table. */
export interface TrackerSchemaRow {
  readonly section: string
  readonly scope: string
  readonly absent: string
  readonly validator: string
}

/**
 * Named collector: rows of the schema/validator table, one per value-bearing
 * schema field.
 *
 * Splits on UNESCAPED pipes only, so a validator cell may spell an alternation
 * (`enum: \`none\` \| \`self\``) without the row parsing as six cells. The
 * hostile-value suite drives the `validator` cells this returns, so the table in
 * the agent is the single authority for what a value must look like — a second
 * copy of the shapes inside the test would prove the copy, not the agent
 * (PF-018).
 */
export function collectTrackerSchemaRows(content: string): TrackerSchemaRow[] {
  const rows: TrackerSchemaRow[] = []
  for (const line of content.split('\n')) {
    if (!line.startsWith('| `## ')) continue
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map(c => c.trim())
    if (cells.length !== 4) continue
    rows.push({ section: cells[0], scope: cells[1], absent: cells[2], validator: cells[3] })
  }
  return rows
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
//
// PHASE-2 RETARGET — what changed and why the fixture moved with it.
// ---------------------------------------------------------------------------
// Phase 2 split the Git agent's GitHub mechanics out of dist/agents/git.md into
// generated skill references. Nine of the 24 git-side samples were sampling the
// text that moved. Of those, seven are recoverable by naming the file the text
// moved to; two STRADDLE the retained/moved boundary — their start anchor moved
// and their end anchor stayed — and no concatenation of the two files contains
// the original bytes as a contiguous substring.
//
// `D-STRADDLE-SPLIT`: the two straddling samples (manage-debt, learn-conventions)
// are SPLIT into two samples each — the moved half read from the reference, the
// retained half read from git.md — rather than being repointed to one side. Both
// halves were sampled before the split and both are still sampled after it; the
// alternative (repoint the start anchor and keep the end anchor on git.md) cannot
// be expressed by `between()`, which slices ONE string, and dropping either half
// would silently shrink the fixture's coverage of that operation.
//
// The fixture was therefore re-captured ONCE, under an explicit user
// authorisation dated 2026-09-14, in its own fixture-only commit. That
// authorisation is spent: it covers this retarget and nothing after it.
//
// PROOF OBLIGATION AFTER THE RE-CAPTURE. The Phase-0 faithfulness gate ran the
// rewritten extractor over the `b6928e5` snapshot and required the old fixture
// back byte-for-byte. That gate cannot be re-run across a deliberate re-capture —
// the old bytes are the ones the retarget changes. The standing proof is the
// DERIVATION test in tests/goldens/github-status-lines.test.ts: the `--unfreeze
// --out-dir` case re-derives the whole fixture from the live tree on every run
// and compares it byte-for-byte, and the inputs it derives from are themselves
// frozen (git.md by the git-agent.md golden; the generated references by the
// containment oracle's 101bda7 baselines). A FUTURE extractor rewrite inherits
// the Phase-0 obligation unchanged, with the baseline tree being the re-capture
// commit rather than b6928e5.

/**
 * Generated skill references the status-line corpus samples.
 *
 * A closed list, not a convenience: `statusLineRefReader().read` refuses a path
 * that is not on it, and the extractor refuses to return unless every entry was
 * actually read (both arms probed in agent-source-resolver.test.ts). Together
 * those two arms mean a later edit cannot quietly repoint a reference-sourced
 * sample back at git.md and leave the list as decoration — the retarget would stop
 * being covered and the extractor would say so.
 */
export const STATUS_LINE_REFERENCE_FILES = [
  'learn-conventions.md',
  'publication-gate.md',
  'tracker/github/backlink-shipped-issues.md',
  'tracker/github/ensure-traceable-issue.md',
  'tracker/github/manage-debt.md',
  'tracker/github/post-wave-report.md',
] as const

/** A path `STATUS_LINE_REFERENCE_FILES` declares — derived, never re-spelled. */
type StatusLineReferenceFile = (typeof STATUS_LINE_REFERENCE_FILES)[number]

/**
 * Narrow an arbitrary relative path to one the list declares.
 *
 * A type predicate rather than a membership test on an already-narrow parameter:
 * typed as the union, `ref()`'s refusal could never fire under its own signature
 * and would need a widening cast to be written at all — a check the compiler knows
 * is vacuous, laundered past it. Here the check earns the narrow type instead of
 * presupposing it, so the arm that refuses is the arm that produces the value the
 * rest of `ref()` uses.
 */
function isStatusLineReference(relPath: string): relPath is StatusLineReferenceFile {
  return STATUS_LINE_REFERENCE_FILES.some(declared => declared === relPath)
}

/** A declared-reference reader, plus the accounting of what it actually read. */
export interface StatusLineRefReader {
  /**
   * Read a generated skill reference by its path relative to the references
   * root. Fail-loud on both an undeclared path and an absent file: an extractor
   * that silently sampled nothing would re-capture a shorter fixture and call it
   * stable.
   */
  read(relPath: string): string
  /** The declared paths `read` has returned. */
  readonly seen: ReadonlySet<string>
}

/**
 * Build the reader `extractStatusLines` samples generated references through.
 *
 * Module-level and exported for one reason: the refusal arm is the half of the
 * closed list that nothing else can fire. Every call site inside the extractor
 * passes a declared path, so a test that only ran the extractor would assert the
 * list's ENFORCEMENT nowhere — "`ref()` refuses an undeclared path" would stay a
 * claim about unexercised code (PF-018). The probe in
 * tests/guards/agent-source-resolver.test.ts drives THIS function, not a copy of
 * its membership test.
 *
 * `read` takes `string` and narrows through `isStatusLineReference`: the refusal
 * is the gate that actually runs (tests/ is outside `tsc -p tsconfig.json`
 * today, #337), reachable under the signature rather than dead beneath it.
 */
export function statusLineRefReader(): StatusLineRefReader {
  const seen = new Set<string>()
  return {
    seen,
    read(relPath: string): string {
      if (!isStatusLineReference(relPath)) {
        throw new Error(
          `extractStatusLines: "${relPath}" is not in STATUS_LINE_REFERENCE_FILES — ` +
          'add it there so the read is declared, or sample a file that is',
        )
      }
      seen.add(relPath)
      const abs = path.join(compiledSkillRefsDir(ROOT), ...relPath.split('/'))
      try {
        return readFileSync(abs, 'utf-8')
      } catch {
        throw new Error(
          `extractStatusLines: generated reference "${relPath}" is absent at ${abs}\n` +
          '  Run `npm run build` first — the status-line corpus samples the generated mechanics',
        )
      }
    },
  }
}

/**
 * Extract the status-line corpus that matches tests/fixtures/golden/github-status-lines.txt.
 *
 * Anchors (not line numbers) drive extraction so the function survives line insertions
 * in git.md without fixture drift. The optional `gitContent` parameter allows callers
 * to supply an alternative git.md body (e.g. a baseline snapshot for proof testing).
 *
 * Reads through the dist-preferred resolver. The resolver's dist-preferred/src-fallback
 * choice is byte-neutral for this extractor because Phase 1's byte-equality gate requires
 * dist/agents/git.md to equal the source it is generated from. Generated references are
 * addressed through `compiledSkillRefsDir()` — never through a hard-coded `dist/` string,
 * which would put a second definition of the build's output directory in the harness.
 */
export function extractStatusLines(gitContent?: string): string {
  const git = gitContent ?? resolveAgentSource('git').content
  const code = resolveAgentSource('code').content
  const dynamicBuild = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'dynamic-build.mds'), 'utf-8')
  const resolveMds = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'resolve.mds'), 'utf-8')

  // One-entry corpus for `gitOp` below. The label is what a 'sole' conflict would
  // name, and a one-entry corpus cannot conflict — but the extractor's contract
  // takes a path and a caller-supplied baseline body has none on disk, so the
  // file's own name is the honest label.
  const gitCorpus: CorpusEntry[] = [{ path: 'git.md', content: git }]

  // Sampling runs through the module-level reader so the closed list's refusal
  // arm is probed against this exact code rather than a copy (see
  // `statusLineRefReader`).
  const refs = statusLineRefReader()
  const ref = (relPath: string): string => refs.read(relPath)

  /**
   * Extract the named operation section from git.md.
   *
   * Routed through the harness's one section extractor, so the boundary is the
   * shared rule — line-bounded at the start, cut at the next UNFENCED column-0
   * `## ` (D-FENCE-AWARE-BOUNDARY / PF-063). A `## ` line inside an Output
   * template's fence is payload, which is what the hand-rolled slice this
   * replaces used a `\n## Operation:` terminator to approximate: that terminator
   * stopped only at a SIBLING operation, so the last operation's section ran past
   * end of file into the shared `## Principles` trailer, and every operation's
   * section silently carried any non-operation heading that followed it. That is
   * the construct Guard 10 was rewritten to escape (667c497) — a region wider
   * than the operation it claims to be — and every `between`/`singleLine` below
   * inherited it from here. PF-057's class: a slicing rule that pins layout
   * instead of the semantics the fixture is supposed to sample.
   *
   * 'sole' [DR-18]: git.md is the single authority for the sections sampled
   * here. A second corpus file carrying the anchor would mean this call was
   * pointed at the wrong corpus, and the throw is how that is reported.
   */
  function gitOp(opName: string): string {
    return extractOpSectionFromCorpus(gitCorpus, opName, { mode: 'sole' }).content
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
    // D10 step 2 — MOVED whole: the `## Publication gate (D10)` section is now
    // references/publication-gate.md, named from the two summary ops (P2-S5 cut 2).
    singleLine(ref('publication-gate.md'), '2. Resolve `REVIEW_PUBLICATION` input:'),
    // D11 Comment-sink scrub rules (baseline lines 54-57)
    between(git, '- Non-zero scrubber exit OR script missing → **DO NOT POST**', '- **Always post `$DEVFLOW_BODY` (scrubbed), never `$DEVFLOW_BODY_RAW`.**'),
    // ensure-pr-ready output template (baseline lines 140-149)
    between(gitOp('ensure-pr-ready'), '- Committed: {yes/no} ({message} if yes)', '{Any `TRACEABILITY: DEGRADED ({reason})` lines from steps 4b/4c — these never change the READY/BLOCKED verdict}'),
    // validate-branch output block (baseline lines 174-191)
    between(gitOp('validate-branch'), '## Pre-Flight: Validation', '{BLOCKED reason if applicable}'),
    // setup-task output block (baseline lines 238-252)
    between(gitOp('setup-task'), '## Task Setup: {branch-name}', '- **Acceptance Criteria**: {criteria}'),
    // fetch-issue D4 + output block (baseline lines 268-290)
    // gitOp() scopes both anchors to this operation's own section; the
    // "## Issue #{number}:" heading in its Output template is fenced, so it is
    // payload and does not cut the section (PF-063).
    between(gitOp('fetch-issue'), '**Degradation (D4):** `gh` unauthenticated or absent, tracker unavailable', '{type}/{number}-{slug}'),
    // fetch-issues-batch D4 + output block (baseline lines 314-339)
    // Same scoping as fetch-issue above; its "## Issues Batch ({n} issues)"
    // heading is fenced too (PF-063).
    between(gitOp('fetch-issues-batch'), '**Degradation (D4):** `gh` unauthenticated or absent, tracker unavailable', '- **Conflicts**: {conflicting requirements if any}'),
    // post-review-summary STUB output template (baseline lines 381-386)
    between(gitOp('post-review-summary'), '     {counts-by-severity table verbatim from local artifact', 'Cap body at 60000 characters'),
    // manage-debt — STRADDLES, split per D-STRADDLE-SPLIT. The process steps moved
    // to the provider reference; the D4 clause they degrade into stayed in git.md,
    // and both halves are still sampled.
    between(ref('tracker/github/manage-debt.md'), '3. Extract items to add:', '7. Return the backlog issue number for Tracked field backfill in resolution-summary.md'),
    between(gitOp('manage-debt'), '**Process:**', '`Tracked` stays `(pending — TRACEABILITY: DEGRADED ({reason}))` in resolution-summary.md.'),
    // check-ci-status input + process (baseline lines 441-451): leading and trailing blank lines
    '\n' + between(gitOp('check-ci-status'), '**Input:** `PR_NUMBER`', '6. List failing/pending checks with names') + '\n',
    // create-release process steps (baseline lines 479-485)
    between(gitOp('create-release'), '1b. Conventions: if `.devflow/conventions.md` exists', '…and {n} more commits` line (D4 degrade if enrichment fails)'),
    // gather-release-evidence input + process (baseline lines 507-518)
    between(gitOp('gather-release-evidence'), '**Input:** `WORKTREE_PATH` (optional)', '**Output:**'),
    // learn-conventions — STRADDLES, split per D-STRADDLE-SPLIT. The bounded scan,
    // the file template and the post-composition verification moved to
    // references/learn-conventions.md (P2-S5 cut 1, loaded only when
    // .devflow/conventions.md is absent); the D4 clause and the Output template
    // stayed in git.md. Leading blank preserved on the first half.
    '\n' + between(ref('learn-conventions.md'), '   ## Version Names', 'If no matches are found, write the file.'),
    between(gitOp('learn-conventions'), '**Degradation (D4):** If `gh` unauthenticated or remote unreachable', '**Output:**\n```markdown'),
    // fetch-review-threads process + output header (baseline lines 625-644)
    between(gitOp('fetch-review-threads'), '3. Apply devflow-authored exclusion predicate', '### External Thread Records'),
    // resolve-review-threads reply loop (baseline lines 694-704): trailing blank
    between(gitOp('resolve-review-threads'), 'unexplained unresolved threads.', '4. Wait 1s between operations') + '\n',
    // post-resolution-summary STUB output template (baseline lines 754-757): trailing blank
    between(gitOp('post-resolution-summary'), '     Full summary withheld (public repository).', '     {counts-by-severity table verbatim from local artifact') + '\n',
    // check-merge-readiness PR + CI fetch steps (baseline lines 785-787)
    between(gitOp('check-merge-readiness'), '2. Fetch PR review decision:', '3. Fetch CI status (same logic as `check-ci-status`)'),
    // backlink-shipped-issues per-issue steps — MOVED whole (P2-S6)
    between(ref('tracker/github/backlink-shipped-issues.md'), '1. Fetch existing comments authored by the viewer:', 'Apply the Comment-sink scrub (D11) and post via `gh issue comment {number} --body-file "$DEVFLOW_BODY"`.'),
    // ensure-traceable-issue plan-artifact + create steps — MOVED whole (P2-S6)
    between(ref('tracker/github/ensure-traceable-issue.md'), '     ```\n   - If `PLAN_ARTIFACT_PATH` provided:', '- Title: derived from `TASK_DESCRIPTION` (same slug logic as setup-task)'),
    // post-wave-report dedup check + compose steps — MOVED whole (P2-S6)
    between(ref('tracker/github/post-wave-report.md'), '   - If found: skip — report `Skipped: wave report for {WAVE_ID} already posted`', '3. Compose the comment body:\n   ```markdown'),
    // Guard-5 dedup marker lines (baseline lines 366, 742, 921)
    // Use 5-space / 3-space prefix to target the template lines, not the search-step lines
    // that also reference these markers within the same operation section.
    singleLine(gitOp('post-review-summary'), '     <!-- devflow:review-summary'),
    singleLine(gitOp('post-resolution-summary'), '     <!-- devflow:resolution-summary'),
    // …the third moved with post-wave-report's compose step.
    singleLine(ref('tracker/github/post-wave-report.md'), '   <!-- devflow:wave-report'),
    // code.md: PR-body guidance table and D11 scrub directive (lines 93, 95, 99)
    singleLine(code, '| Related Issues (ISSUE_NUMBER provided) |'),
    singleLine(code, 'When `ISSUE_NUMBER` is provided, always include'),
    singleLine(code, '**D11 scrub (PR body is a GitHub-visible sink):**'),
    // dynamic-build.mds: wave-report dedup and DEGRADED rules (lines 522, 524).
    // The old anchor ("deduplicates via marker `<!-- devflow:wave-report …`") no
    // longer exists: P2-S12 removed the caller-restated marker literal, because the
    // operation owns the marker (GAP-20). Retargeted to the successor sentence —
    // same line, same rule, same caller.
    singleLine(dynamicBuild, 'deduplicates via its own marker'),
    singleLine(dynamicBuild, 'In WAVE mode, if no tracking-issue number'),
    // resolve.mds: Tracked field rules and phase diagram (lines 244, 354, 501, 510, 541, 619)
    singleLine(resolveMds, 'Set `Tracked` for FIX_SEPARATE and TECH_DEBT items'),
    singleLine(resolveMds, '- **DEGRADED**: if Git agent returns `TRACEABILITY: DEGRADED'),
    singleLine(resolveMds, '├─ Phase 5: Write resolution-summary.md (compaction safety'),
    singleLine(resolveMds, '├─ Phase 9: Git agent (manage-debt)'),
    singleLine(resolveMds, '| gh/GitHub absent | manage-debt degrades'),
    singleLine(resolveMds, '| Issue | File:Line | Reason | Tracked |'),
  ]

  // Both directions of the declared-reference set, in one place: `ref()` refuses a
  // path this list does not declare, and this refuses to return while a declared
  // path went unread. Without the second arm the retarget could be undone one
  // sample at a time and the list would keep asserting a coverage that had gone.
  if (refs.seen.size !== STATUS_LINE_REFERENCE_FILES.length) {
    const unread = STATUS_LINE_REFERENCE_FILES.filter(f => !refs.seen.has(f))
    throw new Error(
      'extractStatusLines: declared generated reference(s) were never sampled: ' +
      `${unread.join(', ')}\n` +
      '  Either a sample was repointed away from the reference (the Phase-2 retarget is being\n' +
      '  undone) or the entry is stale and should be removed from STATUS_LINE_REFERENCE_FILES.',
    )
  }

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
      tracker: { provider: DEFAULT_TRACKER_PROVIDER },
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

// ── Tool-call provider mechanics claims (AC-3.3, AC-3.11, §14.3) ──────────────
//
// WHY HERE AND NOT IN EITHER PROVIDER SUITE. Each of these sentences is a claim
// made per provider, so it needs a per-provider arm — and the claim is the SAME
// claim for every tool-call provider, so a copy in each suite is two authorities
// on one contract. The [DR-08] table above moved here for exactly this reason;
// these follow it.
//
// WHAT THEY PIN, AND WHY PROSE ALONE WAS NOT ENOUGH.
//
//   AC-3.3 — "provider jira with no Jira MCP ⇒ a named DEGRADED at each tracker
//   op, branch and PR still created, `Tracked (pending)` with the reason, NEVER a
//   GitHub issue as fallback". All three clauses shipped as prose in both modules
//   and no test contained any of the three strings, so the whole criterion rested
//   on nobody condensing the paragraph. The GitHub-fallback clause is the one
//   that matters most: silently opening an issue on a tracker the user does not
//   use is worse than an honest gap, and it is the single most plausible thing an
//   author reaches for when a capability probe comes back empty.
//
//   AC-3.11 — the branch shape `{type}/{KEY}-{slug}` with the type EXACT-matched
//   against `## Issue Types`. The always-loaded agent deliberately does not
//   restate this (the byte budget refuses a second copy, and GAP-37 forbids one),
//   so each provider's own setup-task mechanics is the only statement of it and
//   the only place it can be pinned.
//
//   §14.3 — a discarded `## Reference Rendering` token degrades to the documented
//   default AND records the discard under `### Substitutions`. Both halves or
//   neither: a default with no record is a silent substitution, and a record with
//   no default is a report about nothing.
//
// The reference VOCABULARY differs per provider by design — jira renders a `KEY`,
// linear a `REF` — so the two spellings are parameters of the table rather than
// two tables. Nothing else varies: these clauses are contract text.
//
// EVERY ROW PINS A TOKEN, NEVER A SENTENCE — and that is a standing rule, not a
// style note. These generated mechanics are priced against the per-provider
// loaded-set ceilings in tests/tracker/byte-budget.test.ts, of which
// `budget-loaded-set-linear` is the thinnest and therefore the binding one, so a
// condensing pass over this prose is an expected event rather than a hypothetical.
// A row that pins a whole sentence makes the two forces contradict each other: the
// ceiling demands the sentence be shortened and the guard forbids it from changing,
// and the guard loses in the only way that matters — it goes RED reporting a clause
// that is still present, because the rewrite moved a comma. That is PF-057's
// mistake one level down: pinning where a sentence happens to break.
//
// So each row's shape recognises the SHORTEST phrase that carries its claim, and a
// requirement whose halves must co-occur is written as SEVERAL rows over the same
// op list rather than as one ordered regex bridging between phrases. The property
// asserted is membership per operation file; adjacency inside one sentence is not
// the property, and a bridge with a hand-picked width has no contract behind it.
//
// A token that can begin a sentence spells its first letter as `[Xx]`, because the
// copy-edit these rows are written to survive — splitting one comma-spliced sentence
// into two — CAPITALISES the word it promotes to the front. A case-sensitive token
// would go red on exactly the rewrite the byte ceiling is asking for. The tolerance
// is one letter and no more: `### Substitutions` is a heading name, and a wholesale
// `/i` would admit a heading that does not exist.

/** The reference vocabulary one tool-call provider's mechanics use. */
export interface ProviderRefVocabulary {
  /** Branch-token placeholder in `{type}/{TOKEN}-{slug}` — `KEY` on jira, `REF` on linear. */
  readonly refToken: string
  /** How the mechanics name a bare reference in prose — `key` on jira, `reference` on linear. */
  readonly refNoun: string
}

/** One token a tool-call provider's mechanics owe, and where it must appear. */
export interface ProviderMechanicsClaim {
  /** Short name, used in the failure message and by the per-row probe. */
  readonly label: string
  /** The acceptance criterion this clause is the mechanical half of. */
  readonly criterion: string
  /**
   * Generated op references that must EACH state the clause. An empty list means
   * "somewhere in this provider's tree" — used only where the sentence's home is
   * legitimately a property of the provider rather than of the operation.
   */
  readonly ops: readonly string[]
  /** The shape that recognises the clause, built from the provider's vocabulary. */
  readonly pattern: (vocab: ProviderRefVocabulary) => RegExp
  readonly why: string
}

export const TOOL_CALL_MECHANICS_CLAIMS: readonly ProviderMechanicsClaim[] = [
  {
    label: '`Tracked (pending)` carries the reason when the capability is missing',
    criterion: 'AC-3.3',
    ops: ['setup-task', 'ensure-traceable-issue'],
    pattern: () => /`Tracked \(pending\)`/,
    why:
      'the traceability field has to say SOMETHING, and "pending with a reason" is the only ' +
      'honest value: a blank field reads as "no issue was wanted" and a fabricated one reads as ' +
      'an issue that exists. Both operations reach this state, so both must name the value',
  },
  {
    label: 'the branch is still cut and the PR is still opened',
    criterion: 'AC-3.3',
    ops: ['setup-task'],
    pattern: () => /\*\*The branch is still cut and the PR is still opened\*\*/,
    why:
      'D4\'s whole promise is that a traceability gap never aborts the caller\'s workflow. Without ' +
      'this clause an author reading "the capability is absent ⇒ DEGRADED" has no instruction to ' +
      'continue, and the natural reading of a DEGRADED precondition is to stop',
  },
  {
    label: 'never a GitHub issue as a fallback',
    criterion: 'AC-3.3',
    ops: ['setup-task'],
    pattern: () => /\*\*NEVER create a GitHub issue as a fallback\*\*/,
    why:
      'the single most plausible improvisation when a tracker capability comes back empty, and the ' +
      'worst: a different tracker is not a degraded version of this one, and a stray issue on a ' +
      'system the user does not watch is worse than an honest gap',
  },
  {
    label: 'the same prohibition on the issue-creating operation',
    criterion: 'AC-3.3',
    ops: ['ensure-traceable-issue'],
    pattern: () => /never creates a GitHub issue instead/,
    why:
      'setup-task delegates creation here, so a prohibition stated only there is a prohibition the ' +
      'operation that actually creates issues never reads',
  },
  {
    label: 'the branch shape is `{type}/{TOKEN}-{slug}`',
    criterion: 'AC-3.11',
    ops: ['setup-task'],
    pattern: v => new RegExp(`\\{type\\}/\\{${v.refToken}\\}-\\{slug\\}`),
    why:
      'the requester\'s own journey. The always-loaded agent does not restate the shape — the byte ' +
      'budget refuses a second copy and GAP-37 forbids one — so this file is its only statement',
  },
  {
    label: 'the type comes from `## Issue Types` by exact match',
    criterion: 'AC-3.11',
    ops: ['setup-task'],
    pattern: () => /`## Issue Types` by \*\*exact match\*\*/,
    why:
      'an inferred type is a value the tracker never enumerated, so the create call fails at the ' +
      'far end or, worse, succeeds against a type that means something else in that project',
  },
  // §14.3's discarded-token rule, as THREE token rows over the two operations
  // that render a reference — see the token-vs-sentence note above the table.
  {
    label: 'the fallback renders the reference itself',
    criterion: '§14.3',
    ops: ['ensure-pr-ready', 'create-release'],
    pattern: v => new RegExp(`[Rr]ender the ${v.refNoun}\\b`),
    why:
      'the DEFAULT half. Without it a discarded token leaves the operation with no instruction for ' +
      'what to emit, and the natural reading of "the token was discarded" is to emit nothing',
  },
  {
    label: 'the fallback reference goes on its own line',
    criterion: '§14.3',
    ops: ['ensure-pr-ready', 'create-release'],
    pattern: () => /on its own line/,
    why:
      'the documented shape of that default. A reference folded into surrounding prose is a ' +
      'reference the tracker\'s own link detection may never see, which is the failure the section ' +
      'was configured to avoid in the first place',
  },
  {
    label: 'the discard is recorded under `### Substitutions`',
    criterion: '§14.3',
    ops: ['ensure-pr-ready', 'create-release'],
    pattern: () => /[Rr]ecord the discard under `### Substitutions`/,
    why:
      'the RECORD half — both halves or neither. A default with no record is a silent substitution: ' +
      'the user sees a reference they did not configure and nothing says why',
  },
]

/**
 * One provider's generated mechanics corpus, as the claim collector reads it.
 *
 * All four members describe the SAME provider, so they travel as one value: four
 * positional arguments of which two are same-arity functions are four arguments a
 * call site can transpose silently.
 *
 * `read` and `tree` are injected so the caller keeps its own fail-loud reader —
 * every provider suite already has one with a build hint, and a second reader here
 * would be a second place ENOENT tolerance could creep in.
 */
export interface ProviderCorpus {
  /** The provider's reference sub-directory, which prefixes every reported line. */
  readonly label: string
  /** The vocabulary each claim's shape is built from. */
  readonly vocab: ProviderRefVocabulary
  /** One op's generated reference. */
  readonly read: (op: string) => string
  /** Every op's generated reference concatenated — the subject of the op-less claims. */
  readonly tree: () => string
}

/**
 * Named collector: claims a tool-call provider's generated mechanics do not make.
 */
export function collectMissingMechanicsClaims(
  corpus: ProviderCorpus,
  claims: readonly ProviderMechanicsClaim[],
): string[] {
  const missing: string[] = []
  for (const claim of claims) {
    const pattern = claim.pattern(corpus.vocab)
    if (claim.ops.length === 0) {
      if (!pattern.test(corpus.tree())) {
        missing.push(`${corpus.label} [${claim.criterion}]: missing ${claim.label} — ${claim.why}`)
      }
      continue
    }
    for (const op of claim.ops) {
      if (!pattern.test(corpus.read(op))) {
        missing.push(
          `${corpus.label}/${op}.md [${claim.criterion}]: missing ${claim.label} — ${claim.why}`,
        )
      }
    }
  }
  return missing
}
