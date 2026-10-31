/**
 * tests/evidence/seam.ts
 *
 * The one place the evidence suites name their scripts' paths, and the one home of
 * the helpers they share: cutting a function out of a script's source and spelling
 * an evidence marker line. A test file must never import another test file (vitest
 * would register the imported file's tests a second time), so shared code lives here.
 */

import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import * as os from 'os'
import * as path from 'path'

import { scopedEnv } from '../evidence-policy/scripted-shim.js'
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

/** The TP arguments of a prompt's `claim` call, as the prompts spell them. */
export const CLAIM_TP_ARGS = 'TP-<n>=<PASS|FAIL|SKIP>[:<exit>] ...'

/** The lines of a compiled prompt that run the evidence script's `claim` subcommand. */
export function claimCallLines(text: string): string[] {
  return text.split('\n').filter(line => line.includes('verify-evidence.cjs" claim '))
}

/**
 * Run a prompt's `claim` call line against the real script, in-process. `claims` replaces the
 * gate-or-TP slot of the call (`gate|` + CLAIM_TP_ARGS in /implement, CLAIM_TP_ARGS elsewhere),
 * `head` replaces `<head>`, and each `fill` pair replaces one placeholder of the prompt (a path).
 * A placeholder left in the call throws. The tracked-file check is answered "not tracked", and
 * any other subprocess call fails the run: `claim` makes none.
 */
export function runClaimCall(
  line: string,
  o: { readonly claims: string; readonly head: string; readonly fill: ReadonlyArray<readonly [string, string]> },
): { code: number; stdout: string; stderr: string } {
  const slot = line.includes(`gate|${CLAIM_TP_ARGS}`) ? `gate|${CLAIM_TP_ARGS}` : CLAIM_TP_ARGS
  let rest = line.slice(line.indexOf(' claim ') + ' claim '.length).replace(slot, o.claims).replace('<head>', o.head)
  for (const [from, to] of o.fill) rest = rest.split(from).join(to)
  if (/[<>{}]/.test(rest)) throw new Error(`a placeholder is unfilled in: ${rest}`)
  const argv = [...rest.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2])
  const { main } = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as {
    readonly main: (
      argv: readonly string[],
      deps: { readonly stderr: (text: string) => void; readonly exec: (file: string, args: string[]) => unknown },
    ) => { code: number; stdout: string }
  }
  let stderr = ''
  const out = main(['node', 'verify-evidence.cjs', 'claim', ...argv], {
    stderr: text => { stderr += text },
    exec: (file, args) => {
      const tracked = trackedCheckAnswer(file, args)
      if (tracked === null) throw new Error(`claim made a call: ${file} ${args.join(' ')}`)
      return tracked
    },
  })
  return { ...out, stderr }
}

/**
 * The answer the script's tracked-file check gets in a test whose exec is an in-process twin.
 * The check is the one `git ... ls-files` call the script makes about a path it was told to
 * read or to write. By default the twin answers "not tracked" (git exits 0 and lists nothing)
 * without a spawn: a suite that makes hundreds of runs would otherwise start hundreds of git
 * processes. With `real` the answer is the real git's over the real path, for a test that holds
 * a repository; `-C` names the directory, so the spawn's own cwd does not matter. Null for any
 * other call, which the twin answers itself.
 */
export function trackedCheckAnswer(
  file: string,
  args: readonly string[],
  real = false,
): { status: number | null; stdout: Buffer; stderr: Buffer } | null {
  if (file !== 'git' || !args.includes('ls-files')) return null
  if (!real) return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  const r = spawnSync('git', [...args], {
    cwd: os.tmpdir(),
    env: scopedEnv(os.tmpdir(), { LC_ALL: 'C' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { status: r.status, stdout: Buffer.from(r.stdout ?? ''), stderr: Buffer.from(r.stderr ?? '') }
}
