/**
 * tests/evidence/seam.ts
 *
 * The one place the evidence suites name their scripts' paths, and the one home of
 * the helpers they share: cutting a function out of a script's source and spelling
 * an evidence marker line. A test file must never import another test file (vitest
 * would register the imported file's tests a second time), so shared code lives here.
 */

import { createRequire } from 'module'
import * as path from 'path'

import { ROOT } from '../helpers.js'

/** The pure core: grammars, markers, ladder, render, splice, trust. */
export const PR_EVIDENCE_SCRIPT = path.join(ROOT, 'src', 'assets', 'scripts', 'pr-evidence.cjs')

/** The I/O half: gathers the facts through gh and git, feeds `classify`, prints one EVIDENCE line. */
export const VERIFY_EVIDENCE_SCRIPT = path.join(ROOT, 'src', 'assets', 'scripts', 'verify-evidence.cjs')

/** Release traceability plumbing: the last release tag and the per-commit trace map (git only). */
export const RELEASE_TRACE_SCRIPT = path.join(ROOT, 'src', 'assets', 'scripts', 'release-trace.cjs')

/** The CI wait for one pushed head: gh in, one status line out (D-CI-WAIT-INLINE). */
export const CI_WAIT_SCRIPT = path.join(ROOT, 'src', 'assets', 'scripts', 'ci-wait.cjs')

/** The base resolver: fetches the base once, picks the fork point, prints one line. */
export const RESOLVE_BASE_SCRIPT = path.join(ROOT, 'src', 'assets', 'scripts', 'resolve-base.cjs')

/** The bound of one node or git launch, and the timeout of every test that makes one (a launch can stall 14 to 16 s under full-suite load). */
export const SUBPROCESS_TIMEOUT_MS = 60_000

/**
 * A top-level `function name(...) {` of a script, up to the closing brace at column 0.
 * Group 1 is the name, group 2 the body between the signature line and that brace.
 * It carries the `g` flag: read it with `matchAll`, never `test` or `exec`.
 */
export const TOP_LEVEL_FUNCTION_RE = /^function (\w+)\([^)]*\) \{\n([\s\S]*?)\n\}\n/gm

/** The text of the top-level function `name`, without its signature line; '' when absent. */
export function functionBodyOf(source: string, name: string): string {
  for (const m of source.matchAll(TOP_LEVEL_FUNCTION_RE)) if (m[1] === name) return m[2]
  return ''
}

/** The marker line of an evidence comment for `head` and `key`, built from the script's own MARKERS. */
export function markerLine(head: string, key: string): string {
  const { MARKERS } = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as { readonly MARKERS: { readonly EVIDENCE_OPEN: string } }
  return `${String(MARKERS.EVIDENCE_OPEN)} head:${head} key:${key} -->`
}
