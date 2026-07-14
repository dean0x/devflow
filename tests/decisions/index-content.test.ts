// tests/decisions/index-content.test.ts
//
// Integration tests for the selectActiveRows → buildIndexContent pipeline.
//
// The old index-generator.test.ts exercised decisions-index.cjs CLI/subprocess.
// Phase 4 deletes that script. These tests validate the same behavioral
// contracts using the in-process pipeline:
//   selectActiveRows (render-decisions.cjs) → buildIndexContent (decisions-format.cjs)
//
// Coverage contract:
//   - Active-only output: only active entries appear in index output
//   - Belt-and-suspenders filter: deprecated/superseded rows excluded
//   - Mixed corpora: correct counts and IDs for decisions + pitfalls
//   - Area suffix: pitfall entries include area when present
//   - Empty corpus: returns "(none)"
//   - renderAndWriteAll integration: index.md written and reflects ledger state

import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

const ROOT = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)

const { selectActiveRows, renderAndWriteAll } = require(
  path.join(ROOT, 'scripts/hooks/lib/render-decisions.cjs')
) as {
  selectActiveRows: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => Record<string, unknown>[];
  renderAndWriteAll: (worktreePath: string, rows: Record<string, unknown>[]) => void;
}

const { buildIndexContent } = require(
  path.join(ROOT, 'scripts/hooks/lib/decisions-format.cjs')
) as {
  buildIndexContent: (
    activeDecisionRows: Record<string, unknown>[],
    activePitfallRows: Record<string, unknown>[],
    opts: { decisionsFilePath: string; pitfallsFilePath: string }
  ) => string;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = '2026-01-01T00:00:00Z'

function makeDecisionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_d001',
    type: 'decision',
    pattern: 'Use Result types everywhere',
    anchor_id: 'ADR-001',
    date: '2026-01-01',
    decisions_status: 'Accepted',
    confidence: 0.9,
    observations: 1,
    first_seen: NOW,
    last_seen: NOW,
    status: 'created',
    evidence: [],
    details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
    quality_ok: true,
    ...overrides,
  }
}

function makePitfallRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_pf001',
    type: 'pitfall',
    pattern: 'Background hook god scripts',
    anchor_id: 'PF-004',
    decisions_status: undefined,
    confidence: 0.95,
    observations: 2,
    first_seen: NOW,
    last_seen: NOW,
    status: 'created',
    evidence: [],
    details: 'area: scripts/hooks/foo.cjs; issue: god scripts; impact: hard to test; resolution: split concerns',
    quality_ok: true,
    ...overrides,
  }
}

const OPTS = {
  decisionsFilePath: '/project/.devflow/decisions/decisions.md',
  pitfallsFilePath: '/project/.devflow/decisions/pitfalls.md',
}

// ---------------------------------------------------------------------------
// Active-only contract: pipeline output matches expectations
// ---------------------------------------------------------------------------

describe('selectActiveRows + buildIndexContent — active-only contract', () => {
  it('returns "(none)" when corpus is empty', () => {
    const adrRows = selectActiveRows([], 'decisions')
    const pfRows = selectActiveRows([], 'pitfalls')
    expect(buildIndexContent(adrRows, pfRows, OPTS)).toBe('(none)')
  })

  it('includes active ADR entry with correct ID and title', () => {
    const rows = [makeDecisionRow()]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    const result = buildIndexContent(adrRows, pfRows, OPTS)
    expect(result).toContain('ADR-001')
    expect(result).toContain('Use Result types everywhere')
    expect(result).toMatch(/^Decisions \(1\):/m)
  })

  it('includes active PF entry with correct ID and area suffix', () => {
    const rows = [makePitfallRow()]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    const result = buildIndexContent(adrRows, pfRows, OPTS)
    expect(result).toContain('PF-004')
    expect(result).toContain('Background hook god scripts')
    expect(result).toMatch(/^Pitfalls \(1\):/m)
    expect(result).toContain('scripts/hooks/foo.cjs')
  })

  it('shows both Decisions and Pitfalls blocks for mixed corpus', () => {
    const rows = [makeDecisionRow(), makePitfallRow()]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    const result = buildIndexContent(adrRows, pfRows, OPTS)
    expect(result).toMatch(/^Decisions \(1\):/m)
    expect(result).toMatch(/^Pitfalls \(1\):/m)
    expect(result).toContain('ADR-001')
    expect(result).toContain('PF-004')
  })

  it('counts multiple active entries correctly', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001', id: 'obs_a1' }),
      makeDecisionRow({ anchor_id: 'ADR-002', id: 'obs_a2', pattern: 'Inject dependencies always' }),
    ]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    const result = buildIndexContent(adrRows, pfRows, OPTS)
    expect(result).toMatch(/^Decisions \(2\):/m)
    expect(result).toContain('ADR-001')
    expect(result).toContain('ADR-002')
  })
})

// ---------------------------------------------------------------------------
// Belt-and-suspenders: inactive status entries excluded from index
//
// The renderer only writes active entries to .md files, but the write-time
// builder also uses selectActiveRows which filters by decisions_status.
// These tests verify the filter works end-to-end for all inactive statuses.
// ---------------------------------------------------------------------------

describe('selectActiveRows + buildIndexContent — belt-and-suspenders active-only filter', () => {
  it('excludes Deprecated decision row', () => {
    const rows = [makeDecisionRow({ decisions_status: 'Deprecated' })]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    expect(buildIndexContent(adrRows, pfRows, OPTS)).toBe('(none)')
  })

  it('excludes Superseded decision row', () => {
    const rows = [makeDecisionRow({ decisions_status: 'Superseded' })]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    expect(buildIndexContent(adrRows, pfRows, OPTS)).toBe('(none)')
  })

  it('excludes Retired decision row', () => {
    const rows = [makeDecisionRow({ decisions_status: 'Retired' })]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    expect(buildIndexContent(adrRows, pfRows, OPTS)).toBe('(none)')
  })

  it('excludes Deprecated pitfall row', () => {
    const rows = [makePitfallRow({ decisions_status: 'Deprecated' })]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    expect(buildIndexContent(adrRows, pfRows, OPTS)).toBe('(none)')
  })

  it('excludes Superseded pitfall row', () => {
    const rows = [makePitfallRow({ decisions_status: 'Superseded' })]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    expect(buildIndexContent(adrRows, pfRows, OPTS)).toBe('(none)')
  })

  it('keeps active ADR when mixed with Deprecated ADR', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001', id: 'obs_a1', decisions_status: 'Accepted' }),
      makeDecisionRow({ anchor_id: 'ADR-002', id: 'obs_a2', pattern: 'Old decision', decisions_status: 'Deprecated' }),
    ]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    const result = buildIndexContent(adrRows, pfRows, OPTS)
    expect(result).toContain('ADR-001')
    expect(result).not.toContain('ADR-002')
    expect(result).toMatch(/^Decisions \(1\):/m)
  })

  it('keeps active PF when mixed with Superseded PF', () => {
    const rows = [
      makePitfallRow({ anchor_id: 'PF-004', id: 'obs_pf4' }),
      makePitfallRow({ anchor_id: 'PF-005', id: 'obs_pf5', pattern: 'Old pitfall', decisions_status: 'Superseded' }),
    ]
    const adrRows = selectActiveRows(rows, 'decisions')
    const pfRows = selectActiveRows(rows, 'pitfalls')
    const result = buildIndexContent(adrRows, pfRows, OPTS)
    expect(result).toContain('PF-004')
    expect(result).not.toContain('PF-005')
    expect(result).toMatch(/^Pitfalls \(1\):/m)
  })
})

// ---------------------------------------------------------------------------
// renderAndWriteAll integration: index.md is written and reflects ledger state
// ---------------------------------------------------------------------------

const tmpDirs: string[] = []
afterAll(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-content-test-'))
  tmpDirs.push(d)
  return d
}

describe('renderAndWriteAll — index.md integration', () => {
  it('writes index.md reflecting active rows', () => {
    const tmpDir = makeTmp()
    const rows = [makeDecisionRow(), makePitfallRow()]
    renderAndWriteAll(tmpDir, rows)
    const indexPath = path.join(tmpDir, '.devflow', 'learning', 'index.md')
    expect(fs.existsSync(indexPath)).toBe(true)
    const content = fs.readFileSync(indexPath, 'utf8')
    expect(content).toContain('ADR-001')
    expect(content).toContain('PF-004')
  })

  it('writes index.md with "(none)\\n" for empty corpus', () => {
    const tmpDir = makeTmp()
    renderAndWriteAll(tmpDir, [])
    const indexPath = path.join(tmpDir, '.devflow', 'learning', 'index.md')
    expect(fs.existsSync(indexPath)).toBe(true)
    const content = fs.readFileSync(indexPath, 'utf8')
    expect(content).toBe('(none)\n')
  })

  it('index.md excludes inactive rows (belt-and-suspenders from renderAndWriteAll)', () => {
    const tmpDir = makeTmp()
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeDecisionRow({ anchor_id: 'ADR-002', id: 'obs_dep', pattern: 'Old', decisions_status: 'Deprecated' }),
    ]
    renderAndWriteAll(tmpDir, rows)
    const content = fs.readFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'index.md'), 'utf8'
    )
    expect(content).toContain('ADR-001')
    expect(content).not.toContain('ADR-002')
  })

  it('index.md written last — all three files exist after write', () => {
    const tmpDir = makeTmp()
    const rows = [makeDecisionRow()]
    renderAndWriteAll(tmpDir, rows)
    const dir = path.join(tmpDir, '.devflow', 'learning')
    expect(fs.existsSync(path.join(dir, 'decisions.md'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'pitfalls.md'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'index.md'))).toBe(true)
  })

  it('renderAndWriteAll is idempotent — two runs produce byte-identical index.md', () => {
    const tmpDir = makeTmp()
    const rows = [makeDecisionRow(), makePitfallRow()]
    renderAndWriteAll(tmpDir, rows)
    const indexPath = path.join(tmpDir, '.devflow', 'learning', 'index.md')
    const first = fs.readFileSync(indexPath, 'utf8')
    renderAndWriteAll(tmpDir, rows)
    const second = fs.readFileSync(indexPath, 'utf8')
    expect(first).toBe(second)
  })
})
