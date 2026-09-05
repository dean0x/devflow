#!/usr/bin/env node
/**
 * update-golden.js — Golden fixture update script (DR-03).
 *
 * Usage: npm run test:golden:update -- <target>
 *        npm run test:golden:update -- github-status-lines --unfreeze  (frozen through Phase 3)
 *
 * A target is required. Without one, exits non-zero and prints usage.
 * The target `github-status-lines` is frozen through Phase 3 and is refused
 * without an explicit --unfreeze argument (the frozen-target refusal test
 * asserts this behaviour — tests/goldens/github-status-lines.test.ts).
 *
 * DR-03 lifecycle rule:
 *   "frozen at Phase 0, never regenerated through Phase 3; green only with --unfreeze"
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const GOLDENS_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden')

// §0.2 lifecycle rule — printed verbatim on frozen-target refusal (DR-03)
const FROZEN_LIFECYCLE_RULE =
  'github-status-lines.txt is frozen at Phase 0, never regenerated through Phase 3. ' +
  'Pass --unfreeze only when this constraint has been formally lifted by the phase plan.'

const args = process.argv.slice(2)
const targetArg = args.find(a => !a.startsWith('--'))
const hasUnfreeze = args.includes('--unfreeze')

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
  console.error('To override (only when the phase plan permits it):')
  console.error('  npm run test:golden:update -- github-status-lines --unfreeze')
  process.exit(1)
}

mkdirSync(GOLDENS_DIR, { recursive: true })

if (targetArg === 'git-agent') {
  const src = path.join(ROOT, 'src', 'assets', 'agents', 'git.md')
  const dst = path.join(GOLDENS_DIR, 'git-agent.md')
  // Prefer dist/agents/git.md when it exists (Phase 1+ dist-preferred path)
  let sourcePath = src
  try {
    const distSrc = path.join(ROOT, 'dist', 'agents', 'git.md')
    readFileSync(distSrc) // probe
    sourcePath = distSrc
    console.log('Using dist/agents/git.md (dist-preferred)')
  } catch {
    console.log('Using src/assets/agents/git.md (src fallback)')
  }
  const content = readFileSync(sourcePath, 'utf-8')
  writeFileSync(dst, content, 'utf-8')
  console.log(`Written: tests/fixtures/golden/git-agent.md (${content.length} chars)`)
} else if (targetArg === 'github-status-lines') {
  // Inline extractStatusLines logic (avoids TypeScript import for Node.js direct execution).
  // This must stay in sync with tests/helpers.ts extractStatusLines().
  const git = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'git.md'), 'utf-8')
  const code = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'code.md'), 'utf-8')
  const dynamicBuild = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'dynamic-build.mds'), 'utf-8')
  const resolveMds = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'resolve.mds'), 'utf-8')

  function getLines(content, from, to) {
    return content.split('\n').slice(from - 1, to).join('\n')
  }
  function getLine(content, n) {
    return content.split('\n')[n - 1]
  }

  const parts = [
    getLines(git, 23, 28), getLine(git, 33), getLine(git, 36), getLines(git, 54, 57),
    getLines(git, 140, 149), getLines(git, 174, 191), getLines(git, 238, 252), getLines(git, 270, 283),
    getLines(git, 302, 318), getLines(git, 369, 374), getLines(git, 399, 408), getLines(git, 429, 439),
    getLines(git, 467, 473), getLines(git, 495, 506), getLines(git, 570, 582), getLines(git, 613, 632),
    getLines(git, 682, 692), getLines(git, 742, 745), getLines(git, 773, 775), getLines(git, 822, 830),
    getLines(git, 865, 869), getLines(git, 905, 908),
    getLine(git, 354), getLine(git, 730), getLine(git, 909),
    getLine(code, 93), getLine(code, 95), getLine(code, 99),
    getLine(dynamicBuild, 522), getLine(dynamicBuild, 524),
    getLine(resolveMds, 244), getLine(resolveMds, 352), getLine(resolveMds, 499),
    getLine(resolveMds, 508), getLine(resolveMds, 539), getLine(resolveMds, 619),
  ]

  const content = parts.join('\n') + '\n'
  const dst = path.join(GOLDENS_DIR, 'github-status-lines.txt')
  writeFileSync(dst, content, 'utf-8')
  console.log(`Written: tests/fixtures/golden/github-status-lines.txt (${content.length} chars)`)
} else {
  console.error(`Unknown target: '${targetArg}'`)
  console.error('Available targets: git-agent, github-status-lines')
  process.exit(1)
}
