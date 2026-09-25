#!/usr/bin/env node
/**
 * update-golden.ts — Golden fixture update script (DR-03).
 *
 * Usage: npm run test:golden:update -- <target>
 *        npm run test:golden:update -- github-status-lines --unfreeze  (frozen fixture)
 *        npm run test:golden:update -- <target> --out-dir <dir>
 *
 * A target is required. Without one, exits non-zero and prints usage.
 * The target `github-status-lines` is a frozen fixture and is refused without
 * an explicit --unfreeze argument (the frozen-target refusal test asserts this
 * behaviour — tests/goldens/github-status-lines.test.ts).
 *
 * `--out-dir <dir>` redirects the write away from tests/fixtures/golden/.
 * The acceptance half of the refusal guard uses it to exercise the real write
 * path against a temp directory: a test that ran this script against the live
 * fixture would regenerate the frozen golden on every `npm test` (and in CI),
 * which is the one thing §3 forbids — "a CI job that regenerates a golden is a
 * golden that asserts nothing".
 *
 * DR-03 lifecycle rule: the fixture is frozen; regenerating it takes --unfreeze
 * AND a fresh explicit authorisation. Three have been granted and all three are
 * spent — see the authorisation log in tests/goldens/github-status-lines.test.ts.
 */

import { writeFileSync, mkdirSync } from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { extractStatusLines, resolveAgentSource } from '../tests/helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const GOLDENS_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden')

// The lifecycle rule — printed verbatim on frozen-target refusal (DR-03)
const FROZEN_LIFECYCLE_RULE =
  'github-status-lines.txt is a frozen fixture: regenerating it requires --unfreeze ' +
  'AND a fresh explicit authorisation naming the bytes it permits. Five authorisations ' +
  'have been granted and all five are spent. Pass --unfreeze only under a new one.'

const args = process.argv.slice(2)
const hasUnfreeze = args.includes('--unfreeze')

// --out-dir consumes the following argument, so it must not be mistaken for the
// target. Parse it out before picking the positional target.
const outDirIndex = args.indexOf('--out-dir')
const outDirArg = outDirIndex === -1 ? null : args[outDirIndex + 1]
if (outDirIndex !== -1 && (!outDirArg || outDirArg.startsWith('--'))) {
  console.error('Error: --out-dir requires a directory argument.')
  process.exit(1)
}
const outDirValueIndex = outDirIndex === -1 ? -1 : outDirIndex + 1
const positional = args.filter(
  (a: string, i: number) => !a.startsWith('--') && i !== outDirValueIndex,
)
const targetArg = positional[0]

// Resolved against ROOT so a relative --out-dir cannot depend on the caller's cwd.
const destDir = outDirArg ? path.resolve(ROOT, outDirArg) : GOLDENS_DIR

if (!targetArg) {
  console.error('Error: a named target is required.')
  console.error('')
  console.error('Usage: npm run test:golden:update -- <target>')
  console.error('       npm run test:golden:update -- git-agent')
  console.error('       npm run test:golden:update -- github-status-lines --unfreeze')
  console.error('')
  console.error('Available targets: git-agent, github-status-lines')
  process.exit(1)
}

// Frozen-target guard (DR-03): github-status-lines requires --unfreeze
if (targetArg === 'github-status-lines' && !hasUnfreeze) {
  console.error('Refused: github-status-lines.txt is a frozen fixture.')
  console.error('')
  console.error(FROZEN_LIFECYCLE_RULE)
  console.error('')
  console.error('To override (only under a fresh explicit authorisation):')
  console.error('  npm run test:golden:update -- github-status-lines --unfreeze')
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })

if (targetArg === 'git-agent') {
  const dst = path.join(destDir, 'git-agent.md')
  // The resolver is the one authority on which file wins, so print the path it
  // actually returned — a hand-written label per origin drifts the moment the
  // agent's authoring shape changes.
  const source = resolveAgentSource('git')
  console.log(`Using ${path.relative(ROOT, source.path)} (origin=${source.origin})`)
  writeFileSync(dst, source.content, 'utf-8')
  console.log(`Written: ${dst} (${source.content.length} chars)`)
} else if (targetArg === 'github-status-lines') {
  const content = extractStatusLines()
  const dst = path.join(destDir, 'github-status-lines.txt')
  writeFileSync(dst, content, 'utf-8')
  console.log(`Written: ${dst} (${content.length} chars)`)
} else {
  console.error(`Unknown target: '${targetArg}'`)
  console.error('Available targets: git-agent, github-status-lines')
  process.exit(1)
}
