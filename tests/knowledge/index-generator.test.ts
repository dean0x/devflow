import { describe, it, expect, afterAll } from 'vitest'
import * as path from 'path'
import { execSync } from 'child_process'
import { createRequire } from 'module'
import {
  ACTIVE_ADR, ACTIVE_PF, DEPRECATED_ADR, SUPERSEDED_PF,
  makeTmpWorktree, cleanupTmpWorktrees,
} from './fixtures'

afterAll(() => cleanupTmpWorktrees())

const ROOT = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)

const { filterKnowledgeContext, loadKnowledgeIndex } = require(
  path.join(ROOT, 'scripts/hooks/lib/knowledge-context.cjs')
) as {
  filterKnowledgeContext: (raw: string) => string
  loadKnowledgeIndex: (worktree: string, opts?: { decisionsFile?: string; pitfallsFile?: string }) => string
}

const CJS_PATH = path.join(ROOT, 'scripts/hooks/lib/knowledge-context.cjs')

// -------------------------------------------------------------------------
// loadKnowledgeIndex — formatting
// -------------------------------------------------------------------------

describe('loadKnowledgeIndex — formatting', () => {
  it('returns "(none)" when both knowledge files are absent', () => {
    const tmpDir = makeTmpWorktree()
    expect(loadKnowledgeIndex(tmpDir)).toBe('(none)')
  })

  it('returns "(none)" when all entries are Deprecated/Superseded after filter', () => {
    const tmpDir = makeTmpWorktree(DEPRECATED_ADR, SUPERSEDED_PF)
    expect(loadKnowledgeIndex(tmpDir)).toBe('(none)')
  })

  it('includes Decisions block when decisions.md has active entries', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('Decisions (1):')
    expect(result).toContain('ADR-001')
  })

  it('includes Pitfalls block when pitfalls.md has active entries', () => {
    const tmpDir = makeTmpWorktree(undefined, ACTIVE_PF)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('Pitfalls (1):')
    expect(result).toContain('PF-004')
  })

  it('shows both Decisions and Pitfalls blocks when both files have active entries', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR, ACTIVE_PF)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('Decisions (1):')
    expect(result).toContain('Pitfalls (1):')
  })

  it('strips Deprecated entries from Decisions block', () => {
    const mixed = ACTIVE_ADR + '\n' + DEPRECATED_ADR
    const tmpDir = makeTmpWorktree(mixed)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('Decisions (1):')
    expect(result).toContain('ADR-001')
    expect(result).not.toContain('ADR-002')
  })

  it('strips Superseded entries from Pitfalls block', () => {
    const mixed = ACTIVE_PF + '\n' + SUPERSEDED_PF
    const tmpDir = makeTmpWorktree(undefined, mixed)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('Pitfalls (1):')
    expect(result).toContain('PF-004')
    expect(result).not.toContain('PF-005')
  })

  it('truncates title to 60 characters with ellipsis', () => {
    const longTitle = 'A'.repeat(70)
    const adr = `## ADR-003: ${longTitle}\n\n- **Status**: Active\n- **Decision**: Long title\n`
    const tmpDir = makeTmpWorktree(adr)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('ADR-003')
    // Title should be truncated to 60 chars with '…'
    const lines = result.split('\n')
    const adrLine = lines.find(l => l.includes('ADR-003'))
    expect(adrLine).toBeDefined()
    // The title should contain the ellipsis character, confirming truncation occurred
    expect(adrLine).toContain('…')
    // The full 70-char title should not appear verbatim
    expect(adrLine).not.toContain(longTitle)
  })

  it('truncates area to 80 characters with ellipsis', () => {
    const longArea = 'scripts/hooks/' + 'a'.repeat(80)
    const pf = `## PF-006: Some pitfall\n\n- **Status**: Active\n- **Area**: ${longArea}\n- **Description**: desc\n`
    const tmpDir = makeTmpWorktree(undefined, pf)
    const result = loadKnowledgeIndex(tmpDir)
    const lines = result.split('\n')
    const pfLine = lines.find(l => l.includes('PF-006'))
    expect(pfLine).toBeDefined()
    // Area suffix should be truncated
    if (pfLine!.includes('—')) {
      const areaPart = pfLine!.split('—')[1]?.trim() ?? ''
      expect(areaPart.length).toBeLessThanOrEqual(81) // 80 + '…'
    }
  })

  it('shows [unknown] for entries with no recognized status', () => {
    const adr = `## ADR-007: Unknown status entry\n\n- **Status**: Draft\n- **Decision**: Something\n`
    const tmpDir = makeTmpWorktree(adr)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('ADR-007')
    expect(result).toContain('[unknown]')
  })

  it('omits — Area suffix when Area field is missing', () => {
    const pf = `## PF-008: No area field\n\n- **Status**: Active\n- **Description**: desc\n`
    const tmpDir = makeTmpWorktree(undefined, pf)
    const result = loadKnowledgeIndex(tmpDir)
    const lines = result.split('\n')
    const pfLine = lines.find(l => l.includes('PF-008'))
    expect(pfLine).toBeDefined()
    expect(pfLine).not.toContain('—')
  })

  it('includes file path footer for decisions', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('decisions.md')
    expect(result).toContain('ADR-NNN')
  })

  it('includes file path footer for pitfalls', () => {
    const tmpDir = makeTmpWorktree(undefined, ACTIVE_PF)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('pitfalls.md')
    expect(result).toContain('PF-NNN')
  })

  it('omits Decisions block when only pitfalls file is present', () => {
    const tmpDir = makeTmpWorktree(undefined, ACTIVE_PF)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).not.toContain('Decisions (')
    expect(result).toContain('Pitfalls (')
  })

  it('omits Pitfalls block when only decisions file is present', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR)
    const result = loadKnowledgeIndex(tmpDir)
    expect(result).toContain('Decisions (')
    expect(result).not.toContain('Pitfalls (')
  })
})

// -------------------------------------------------------------------------
// CLI dispatch — subcommand mode
// -------------------------------------------------------------------------

describe('CLI dispatch — subcommand mode', () => {
  it('index subcommand produces index format output', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR, ACTIVE_PF)
    const output = execSync(`node "${CJS_PATH}" index "${tmpDir}"`).toString()
    expect(output).toContain('Decisions (1):')
    expect(output).toContain('Pitfalls (1):')
    expect(output).toContain('ADR-001')
    expect(output).toContain('PF-004')
  })

  it('bare invocation (no subcommand) exits with code 1', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR)
    let threw = false
    try {
      execSync(`node "${CJS_PATH}" "${tmpDir}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  it('unknown subcommand exits with code 1 and prints usage', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR)
    let threw = false
    let stderr = ''
    try {
      execSync(`node "${CJS_PATH}" foo "${tmpDir}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (e: any) {
      threw = true
      stderr = e.stderr ?? ''
    }
    expect(threw).toBe(true)
    expect(stderr).toMatch(/[Uu]sage/)
  })

  it('index subcommand on empty knowledge returns "(none)"', () => {
    const tmpDir = makeTmpWorktree()
    const output = execSync(`node "${CJS_PATH}" index "${tmpDir}"`).toString()
    expect(output.trim()).toBe('(none)')
  })
})

// -------------------------------------------------------------------------
// Observability — stderr log
// -------------------------------------------------------------------------

describe('Observability — stderr log on successful invocation', () => {
  it('index subcommand logs mode, worktree, and entries count to stderr', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR, ACTIVE_PF)
    // Run and capture stderr
    const stderr = execSync(
      `node "${CJS_PATH}" index "${tmpDir}" 2>&1 1>/dev/null`,
      { encoding: 'utf8', shell: true }
    )
    expect(stderr).toContain('[knowledge-context]')
    expect(stderr).toContain('mode=index')
    expect(stderr).toContain('entries=2')
  })

  it('does not log observability when result is "(none)"', () => {
    const tmpDir = makeTmpWorktree()
    const stderr = execSync(
      `node "${CJS_PATH}" index "${tmpDir}" 2>&1 1>/dev/null`,
      { encoding: 'utf8', shell: true }
    )
    // No log when (none)
    expect(stderr).not.toContain('[knowledge-context]')
  })
})
