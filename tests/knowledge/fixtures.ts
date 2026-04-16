// Shared test fixtures for knowledge-context module tests.
// Both index-generator.test.ts and knowledge-citation.test.ts import from here
// to avoid drift between fixture definitions.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import * as path from 'path'
import * as os from 'os'

// ---------------------------------------------------------------------------
// ADR fixtures
// ---------------------------------------------------------------------------

export const ACTIVE_ADR = `## ADR-001: Use Result types everywhere across the codebase for errors

- **Status**: Active
- **Decision**: Always return Result<T,E>
- **Context**: TypeScript project enforcing functional error handling
`

export const DEPRECATED_ADR = `## ADR-002: Old approach no longer relevant

- **Status**: Deprecated
- **Decision**: Do the old thing
`

export const SUPERSEDED_ADR = `## ADR-003: Superseded approach no longer relevant

- **Status**: Superseded
- **Decision**: Outdated pattern
`

// ---------------------------------------------------------------------------
// PF fixtures
// ---------------------------------------------------------------------------

export const ACTIVE_PF = `## PF-004: Background hook scripts grow into god scripts over time

- **Status**: Active
- **Area**: scripts/hooks/foo.cjs, scripts/hooks/background-learning
- **Description**: Watch out for growing scripts
`

export const DEPRECATED_PF = `## PF-001: Old pitfall no longer relevant

- **Status**: Deprecated
- **Description**: No longer relevant
`

export const SUPERSEDED_PF = `## PF-005: Superseded pitfall

- **Status**: Superseded
- **Area**: some/file.ts
- **Description**: No longer relevant
`

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

const createdTmpDirs: string[] = []

/**
 * Create a temporary worktree directory with optional knowledge files.
 * Returns the absolute path to the tmpdir root.
 * Directories are tracked — call `cleanupTmpWorktrees()` in afterAll.
 */
export function makeTmpWorktree(decisions?: string, pitfalls?: string): string {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'knowledge-index-test-'))
  createdTmpDirs.push(tmpDir)
  const knowledgeDir = path.join(tmpDir, '.memory', 'knowledge')
  mkdirSync(knowledgeDir, { recursive: true })
  if (decisions !== undefined) {
    writeFileSync(path.join(knowledgeDir, 'decisions.md'), decisions, 'utf8')
  }
  if (pitfalls !== undefined) {
    writeFileSync(path.join(knowledgeDir, 'pitfalls.md'), pitfalls, 'utf8')
  }
  return tmpDir
}

/**
 * Remove all temporary worktree directories created by `makeTmpWorktree`.
 * Call in `afterAll(() => cleanupTmpWorktrees())`.
 */
export function cleanupTmpWorktrees(): void {
  for (const dir of createdTmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
  createdTmpDirs.length = 0
}
