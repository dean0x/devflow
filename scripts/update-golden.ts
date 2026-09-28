#!/usr/bin/env node
/**
 * update-golden.ts — Golden fixture update script (DR-03).
 *
 * Usage: npm run test:golden:update -- <target>
 *        npm run test:golden:update -- github-status-lines --unfreeze  (frozen fixture)
 *        npm run test:golden:update -- <target> --out-dir <dir>
 *        npm run test:golden:update -- install-snapshot [--only <config>[,<config>]]
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
 *
 * `install-snapshot` (#388) writes `install-snapshot-{config}.txt` for every config
 * in INSTALL_CONFIGS plus `hook-matrix.txt`, by installing the BUILT CLI into temp
 * sandboxes (run `npm run build` first). `--only` narrows it to named configs; the
 * matrix is written only when its config (github) is among them. Its goldens change
 * only in fixture-only `test(snapshot):` commits.
 */

import { writeFileSync, mkdirSync } from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { extractStatusLines, resolveAgentSource } from '../tests/helpers.js'
import { INSTALL_CONFIGS, findConfig, writeInstallSnapshotGoldens } from '../tests/install-snapshot-helpers.js'

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

// --out-dir and --only consume the following argument, so neither value may be
// mistaken for the target. Parse them out before picking the positional target.
function valueFlag(name: string, what: string): { value: string | null; valueIndex: number } {
  const index = args.indexOf(name)
  if (index === -1) return { value: null, valueIndex: -1 }
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`Error: ${name} requires ${what}.`)
    process.exit(1)
  }
  return { value, valueIndex: index + 1 }
}
const outDir = valueFlag('--out-dir', 'a directory argument')
const only = valueFlag('--only', 'a comma-separated config list')
const outDirArg = outDir.value
const positional = args.filter(
  (a: string, i: number) => !a.startsWith('--') && i !== outDir.valueIndex && i !== only.valueIndex,
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
  console.error('       npm run test:golden:update -- install-snapshot [--only <config>[,<config>]]')
  console.error('')
  console.error('Available targets: git-agent, github-status-lines, install-snapshot')
  process.exit(1)
}

if (only.value !== null && targetArg !== 'install-snapshot') {
  console.error('Error: --only applies to the install-snapshot target alone.')
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
} else if (targetArg === 'install-snapshot') {
  const configs = only.value === null ? INSTALL_CONFIGS : only.value.split(',').map(findConfig)
  for (const dst of writeInstallSnapshotGoldens(destDir, configs)) console.log(`Written: ${dst}`)
} else {
  console.error(`Unknown target: '${targetArg}'`)
  console.error('Available targets: git-agent, github-status-lines, install-snapshot')
  process.exit(1)
}
