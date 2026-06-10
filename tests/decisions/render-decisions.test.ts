// tests/decisions/render-decisions.test.ts
//
// Tests for render-decisions.cjs: golden, idempotency, round-trip, empty corpus,
// --check exit codes, and AC-P1 (O(N) performance, ratio/bounded-delta, per ADR-014).

import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cleanupTmpWorktrees, makeTmpWorktree } from './fixtures.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const {
  renderDecisionsFile,
  parseLedger,
  isActive,
  anchorNumeric,
} = require(path.join(ROOT, 'scripts/hooks/lib/render-decisions.cjs')) as {
  renderDecisionsFile: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => string;
  parseLedger: (ledgerPath: string) => Record<string, unknown>[];
  isActive: (row: Record<string, unknown>) => boolean;
  anchorNumeric: (anchorId: string) => number;
};

const { loadDecisionsIndex } = require(
  path.join(ROOT, 'scripts/hooks/lib/decisions-index.cjs')
) as {
  loadDecisionsIndex: (worktree: string, opts?: { decisionsFile?: string; pitfallsFile?: string }) => string;
};

const RENDERER = path.join(ROOT, 'scripts/hooks/lib/render-decisions.cjs');

afterAll(() => cleanupTmpWorktrees());

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = '2026-01-01T00:00:00Z';

function makeDecisionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_test001',
    type: 'decision',
    pattern: 'Use Result types everywhere',
    anchor_id: 'ADR-001',
    date: '2026-01-01',
    decisions_status: undefined,
    confidence: 0.9,
    observations: 1,
    first_seen: NOW,
    last_seen: NOW,
    status: 'created',
    evidence: [],
    details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
    quality_ok: true,
    ...overrides,
  };
}

function makePitfallRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_pf001',
    type: 'pitfall',
    pattern: 'Editing installed scripts directly',
    anchor_id: 'PF-002',
    decisions_status: undefined,
    confidence: 0.95,
    observations: 2,
    first_seen: NOW,
    last_seen: NOW,
    status: 'created',
    evidence: [],
    details: 'area: scripts/hooks/; issue: changes overwritten; impact: lost work; resolution: edit source + rebuild',
    quality_ok: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isActive — unit tests
// ---------------------------------------------------------------------------

describe('isActive', () => {
  it('returns true when decisions_status is undefined', () => {
    expect(isActive({ decisions_status: undefined })).toBe(true);
  });

  it('returns true for Accepted', () => {
    expect(isActive({ decisions_status: 'Accepted' })).toBe(true);
  });

  it('returns true for Active', () => {
    expect(isActive({ decisions_status: 'Active' })).toBe(true);
  });

  it('returns false for Deprecated', () => {
    expect(isActive({ decisions_status: 'Deprecated' })).toBe(false);
  });

  it('returns false for Superseded', () => {
    expect(isActive({ decisions_status: 'Superseded' })).toBe(false);
  });

  it('returns false for Retired', () => {
    expect(isActive({ decisions_status: 'Retired' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// anchorNumeric — unit tests
// ---------------------------------------------------------------------------

describe('anchorNumeric', () => {
  it('extracts numeric suffix from ADR-016', () => {
    expect(anchorNumeric('ADR-016')).toBe(16);
  });

  it('extracts numeric suffix from PF-007', () => {
    expect(anchorNumeric('PF-007')).toBe(7);
  });

  it('returns Infinity for empty string', () => {
    expect(anchorNumeric('')).toBe(Infinity);
  });

  it('returns Infinity for undefined', () => {
    expect(anchorNumeric(undefined as unknown as string)).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// parseLedger — handles missing file gracefully
// ---------------------------------------------------------------------------

describe('parseLedger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-parse-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when ledger file is absent', () => {
    const result = parseLedger(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(result).toEqual([]);
  });

  it('parses valid JSONL rows', () => {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    const row1 = { id: 'obs_a', type: 'decision', anchor_id: 'ADR-001' };
    const row2 = { id: 'obs_b', type: 'pitfall', anchor_id: 'PF-002' };
    fs.writeFileSync(ledgerPath, JSON.stringify(row1) + '\n' + JSON.stringify(row2) + '\n', 'utf8');
    const result = parseLedger(ledgerPath);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('obs_a');
    expect(result[1].id).toBe('obs_b');
  });

  it('skips malformed lines', () => {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    fs.writeFileSync(ledgerPath, '{"id":"obs_ok"}\n{invalid json}\n{"id":"obs_ok2"}\n', 'utf8');
    const result = parseLedger(ledgerPath);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('obs_ok');
    expect(result[1].id).toBe('obs_ok2');
  });

  it('skips empty lines', () => {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    fs.writeFileSync(ledgerPath, '\n{"id":"obs_ok"}\n\n', 'utf8');
    const result = parseLedger(ledgerPath);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// renderDecisionsFile — golden tests
// ---------------------------------------------------------------------------

describe('renderDecisionsFile — golden', () => {
  it('empty corpus: decisions.md header + empty TL;DR', () => {
    const result = renderDecisionsFile([], 'decisions');
    expect(result.startsWith('<!-- TL;DR: 0 decisions. Key: -->')).toBe(true);
    expect(result).toContain('# Architectural Decisions');
    expect(result).not.toMatch(/## ADR-\d+:/);
  });

  it('empty corpus: pitfalls.md header + empty TL;DR', () => {
    const result = renderDecisionsFile([], 'pitfalls');
    expect(result.startsWith('<!-- TL;DR: 0 pitfalls. Key: -->')).toBe(true);
    expect(result).toContain('# Known Pitfalls');
    expect(result).not.toMatch(/## PF-\d+:/);
  });

  it('renders a single active decision from details', () => {
    const rows = [makeDecisionRow()];
    const result = renderDecisionsFile(rows, 'decisions');
    expect(result).toContain('<!-- TL;DR: 1 decisions. Key: ADR-001 -->');
    expect(result).toContain('\n## ADR-001: Use Result types everywhere\n');
    expect(result).toContain('- **Date**: 2026-01-01\n');
    expect(result).toContain('- **Status**: Accepted\n');
    expect(result).toContain('- **Source**: self-learning:obs_test001\n');
  });

  it('renders a single active pitfall from details', () => {
    const rows = [makePitfallRow()];
    const result = renderDecisionsFile(rows, 'pitfalls');
    expect(result).toContain('<!-- TL;DR: 1 pitfalls. Key: PF-002 -->');
    expect(result).toContain('\n## PF-002: Editing installed scripts directly\n');
    expect(result).toContain('- **Area**: scripts/hooks/');
    expect(result).toContain('- **Status**: Active\n');
    expect(result).not.toContain('**Date**');
  });

  it('renders raw_body verbatim when present (migrated entry)', () => {
    const rawBody = '\n## ADR-005: Some migrated decision\n\n- **Date**: 2026-05-01\n- **Status**: Accepted\n- **Context**: old context\n- **Decision**: old decision\n- **Consequences**: none\n- **Source**: self-learning:obs_migrated\n';
    const rows = [makeDecisionRow({
      anchor_id: 'ADR-005',
      pattern: 'Some migrated decision',
      id: 'obs_migrated',
      raw_body: rawBody,
    })];
    const result = renderDecisionsFile(rows, 'decisions');
    expect(result).toContain(rawBody);
    // Should NOT re-render from details
    expect(result).not.toContain('- **Context**: TypeScript project');
  });

  it('excludes Deprecated entries', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeDecisionRow({ anchor_id: 'ADR-002', id: 'obs_deprecated', pattern: 'Old approach', decisions_status: 'Deprecated' }),
    ];
    const result = renderDecisionsFile(rows, 'decisions');
    expect(result).toContain('ADR-001');
    expect(result).not.toContain('ADR-002');
    expect(result).toContain('<!-- TL;DR: 1 decisions. Key: ADR-001 -->');
  });

  it('excludes Superseded entries', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-003', decisions_status: 'Superseded' }),
      makePitfallRow({ anchor_id: 'PF-001', decisions_status: 'Superseded' }),
    ];
    const decisionsResult = renderDecisionsFile(rows, 'decisions');
    const pitfallsResult = renderDecisionsFile(rows, 'pitfalls');
    expect(decisionsResult).not.toContain('ADR-003');
    expect(pitfallsResult).not.toContain('PF-001');
  });

  it('excludes Retired entries', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeDecisionRow({ anchor_id: 'ADR-002', id: 'obs_ret', pattern: 'Retired', decisions_status: 'Retired' }),
    ];
    const result = renderDecisionsFile(rows, 'decisions');
    expect(result).toContain('ADR-001');
    expect(result).not.toContain('ADR-002');
  });

  it('excludes rows without anchor_id', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001' }),
      { ...makeDecisionRow({ anchor_id: undefined, id: 'obs_noanchor', pattern: 'Unanchored' }), anchor_id: undefined },
    ];
    const result = renderDecisionsFile(rows, 'decisions');
    expect(result).toContain('ADR-001');
    expect(result).not.toContain('obs_noanchor');
    expect(result).not.toContain('Unanchored');
  });

  it('filters decisions rows to decisions.md only (type=decision)', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001' }),
      makePitfallRow({ anchor_id: 'PF-001' }),
    ];
    const decisionsResult = renderDecisionsFile(rows, 'decisions');
    expect(decisionsResult).toContain('ADR-001');
    expect(decisionsResult).not.toContain('PF-001');

    const pitfallsResult = renderDecisionsFile(rows, 'pitfalls');
    expect(pitfallsResult).toContain('PF-001');
    expect(pitfallsResult).not.toContain('ADR-001');
  });

  it('sorts entries by numeric anchor (not lexicographic)', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-010', id: 'obs_010', pattern: 'Decision 10' }),
      makeDecisionRow({ anchor_id: 'ADR-002', id: 'obs_002', pattern: 'Decision 2' }),
      makeDecisionRow({ anchor_id: 'ADR-007', id: 'obs_007', pattern: 'Decision 7' }),
    ];
    const result = renderDecisionsFile(rows, 'decisions');
    const idx002 = result.indexOf('## ADR-002');
    const idx007 = result.indexOf('## ADR-007');
    const idx010 = result.indexOf('## ADR-010');
    expect(idx002).toBeLessThan(idx007);
    expect(idx007).toBeLessThan(idx010);
  });

  it('TL;DR line is the FIRST line of the rendered file', () => {
    const rows = [makeDecisionRow()];
    const result = renderDecisionsFile(rows, 'decisions');
    const firstLine = result.split('\n')[0];
    expect(firstLine).toMatch(/^<!-- TL;DR:/);
  });

  it('mixed active/inactive: TL;DR count reflects only active entries', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeDecisionRow({ anchor_id: 'ADR-002', id: 'obs_dep', pattern: 'Old', decisions_status: 'Deprecated' }),
      makeDecisionRow({ anchor_id: 'ADR-003', id: 'obs_act', pattern: 'Another active', decisions_status: 'Active' }),
    ];
    const result = renderDecisionsFile(rows, 'decisions');
    expect(result).toContain('<!-- TL;DR: 2 decisions. Key: ADR-001, ADR-003 -->');
  });
});

// ---------------------------------------------------------------------------
// renderDecisionsFile — idempotency
// ---------------------------------------------------------------------------

describe('renderDecisionsFile — idempotency', () => {
  it('rendering the same rows twice yields byte-identical output', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001' }),
      makeDecisionRow({ anchor_id: 'ADR-003', id: 'obs_003', pattern: 'Second decision' }),
    ];
    const first = renderDecisionsFile(rows, 'decisions');
    const second = renderDecisionsFile(rows, 'decisions');
    expect(first).toBe(second);
  });

  it('pitfalls rendering is also idempotent', () => {
    const rows = [makePitfallRow(), makePitfallRow({ anchor_id: 'PF-007', id: 'obs_pf007', pattern: 'Another pitfall' })];
    const first = renderDecisionsFile(rows, 'pitfalls');
    const second = renderDecisionsFile(rows, 'pitfalls');
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: render → decisions-index parse
// ---------------------------------------------------------------------------

describe('renderDecisionsFile — round-trip with decisions-index', () => {
  it('rendered decisions.md is parseable by decisions-index', () => {
    const rows = [
      makeDecisionRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeDecisionRow({ anchor_id: 'ADR-003', id: 'obs_003', pattern: 'Inject dependencies everywhere', decisions_status: 'Active' }),
    ];
    const decisionsContent = renderDecisionsFile(rows, 'decisions');
    const pitfallsContent = renderDecisionsFile(rows, 'pitfalls');

    const tmpDir = makeTmpWorktree(decisionsContent, pitfallsContent);
    const index = loadDecisionsIndex(tmpDir);
    expect(index).toContain('ADR-001');
    expect(index).toContain('ADR-003');
  });

  it('rendered pitfalls.md is parseable by decisions-index', () => {
    const rows = [
      makePitfallRow({ anchor_id: 'PF-002', decisions_status: 'Active' }),
      makePitfallRow({ anchor_id: 'PF-007', id: 'obs_pf007', pattern: 'Another pitfall', decisions_status: 'Active' }),
    ];
    const decisionsContent = renderDecisionsFile([], 'decisions');
    const pitfallsContent = renderDecisionsFile(rows, 'pitfalls');

    const tmpDir = makeTmpWorktree(decisionsContent, pitfallsContent);
    const index = loadDecisionsIndex(tmpDir);
    expect(index).toContain('PF-002');
    expect(index).toContain('PF-007');
  });
});

// ---------------------------------------------------------------------------
// CLI: render subcommand writes both .md files
// ---------------------------------------------------------------------------

describe('CLI render subcommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 and writes both .md files when ledger is absent (empty corpus)', () => {
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    // DO NOT create ledger — test empty-corpus path

    execSync(`node "${RENDERER}" render "${tmpDir}"`, { encoding: 'utf8' });

    expect(fs.existsSync(path.join(decisionsDir, 'decisions.md'))).toBe(true);
    expect(fs.existsSync(path.join(decisionsDir, 'pitfalls.md'))).toBe(true);

    const dContent = fs.readFileSync(path.join(decisionsDir, 'decisions.md'), 'utf8');
    expect(dContent).toContain('<!-- TL;DR: 0 decisions. Key: -->');
    expect(dContent).toContain('# Architectural Decisions');

    const pContent = fs.readFileSync(path.join(decisionsDir, 'pitfalls.md'), 'utf8');
    expect(pContent).toContain('<!-- TL;DR: 0 pitfalls. Key: -->');
    expect(pContent).toContain('# Known Pitfalls');
  });

  it('exits 0 and writes correctly when ledger has active rows', () => {
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });

    const row1 = makeDecisionRow({ anchor_id: 'ADR-001' });
    const row2 = makePitfallRow({ anchor_id: 'PF-002' });
    const ledgerPath = path.join(decisionsDir, 'decisions-ledger.jsonl');
    fs.writeFileSync(ledgerPath, JSON.stringify(row1) + '\n' + JSON.stringify(row2) + '\n', 'utf8');

    execSync(`node "${RENDERER}" render "${tmpDir}"`, { encoding: 'utf8' });

    const dContent = fs.readFileSync(path.join(decisionsDir, 'decisions.md'), 'utf8');
    expect(dContent).toContain('## ADR-001');

    const pContent = fs.readFileSync(path.join(decisionsDir, 'pitfalls.md'), 'utf8');
    expect(pContent).toContain('## PF-002');
  });
});

// ---------------------------------------------------------------------------
// CLI: --check subcommand exit codes
// ---------------------------------------------------------------------------

describe('CLI --check subcommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCheck(worktree: string): { code: number; stderr: string } {
    try {
      execSync(`node "${RENDERER}" --check "${worktree}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { code: 0, stderr: '' };
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: string };
      return { code: err.status ?? 1, stderr: err.stderr ?? '' };
    }
  }

  it('exits 0 when on-disk .md files match the render from ledger', () => {
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });

    // Render to disk first
    execSync(`node "${RENDERER}" render "${tmpDir}"`, { encoding: 'utf8' });

    // --check should agree
    const result = runCheck(tmpDir);
    expect(result.code).toBe(0);
  });

  it('exits non-zero when decisions.md on disk drifts from ledger render', () => {
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });

    // Render to disk
    execSync(`node "${RENDERER}" render "${tmpDir}"`, { encoding: 'utf8' });

    // Corrupt decisions.md
    fs.writeFileSync(
      path.join(decisionsDir, 'decisions.md'),
      '<!-- TL;DR: 99 decisions. Key: ADR-999 -->\n# Tampered\n',
      'utf8'
    );

    const result = runCheck(tmpDir);
    expect(result.code).not.toBe(0);
  });

  it('--check does not write files', () => {
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    // No .md files yet — check will see drift (absent = drift) and exit non-zero
    runCheck(tmpDir);
    // Files should still be absent
    expect(fs.existsSync(path.join(decisionsDir, 'decisions.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI: missing subcommand exits non-zero
// ---------------------------------------------------------------------------

describe('CLI — invalid usage', () => {
  it('exits non-zero when no subcommand given', () => {
    let threw = false;
    try {
      execSync(`node "${RENDERER}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-P1 performance: O(N) — ratio/bounded-delta methodology (per ADR-014)
// ---------------------------------------------------------------------------

describe('AC-P1 render performance (ratio/bounded-delta, not absolute ms)', () => {
  function buildRows(n: number): Record<string, unknown>[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `obs_perf${i}`,
      type: i % 2 === 0 ? 'decision' : 'pitfall',
      pattern: `Pattern number ${i}`,
      anchor_id: i % 2 === 0 ? `ADR-${String(i + 1).padStart(3, '0')}` : `PF-${String(i + 1).padStart(3, '0')}`,
      decisions_status: 'Accepted',
      confidence: 0.9,
      observations: 1,
      first_seen: NOW,
      last_seen: NOW,
      status: 'created',
      evidence: [],
      details: `context: test context ${i}; decision: do thing ${i}; rationale: performance test`,
      quality_ok: true,
    }));
  }

  it('10x row count yields <15x render time (bounded ratio, not absolute ms)', () => {
    const SMALL = 20;
    const LARGE = 200;
    const WARMUP = 3;
    const RUNS = 5;

    // Warmup to avoid JIT effects
    for (let i = 0; i < WARMUP; i++) {
      renderDecisionsFile(buildRows(SMALL), 'decisions');
      renderDecisionsFile(buildRows(LARGE), 'decisions');
    }

    // Measure SMALL
    const smallTimes: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const rows = buildRows(SMALL);
      const start = performance.now();
      renderDecisionsFile(rows, 'decisions');
      smallTimes.push(performance.now() - start);
    }

    // Measure LARGE
    const largeTimes: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const rows = buildRows(LARGE);
      const start = performance.now();
      renderDecisionsFile(rows, 'decisions');
      largeTimes.push(performance.now() - start);
    }

    const medianSmall = smallTimes.sort((a, b) => a - b)[Math.floor(RUNS / 2)];
    const medianLarge = largeTimes.sort((a, b) => a - b)[Math.floor(RUNS / 2)];

    // Guard: medianSmall must be measurable (>0.01ms) for ratio to be meaningful
    if (medianSmall < 0.01) {
      // Sub-millisecond render — too fast to measure reliably; skip ratio assertion
      return;
    }

    const ratio = medianLarge / medianSmall;
    // 10x rows should be <=15x time (AC-P1: no super-linear blowup)
    // Using 15 as the bound to allow for variance in JIT, GC, etc.
    expect(ratio).toBeLessThan(15);
  });
});
