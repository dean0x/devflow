// tests/decisions/observations-schema.test.ts
//
// Tests for the extended LearningObservation schema (Phase 2 ledger fields)
// and the isLearningObservation type guard backward-compat contract.
//
// AC-A7: The type guard must accept old rows (no new fields) and validate
// new optional fields' types when present; reject malformed new fields.

import { describe, it, expect } from 'vitest';
import { isLearningObservation } from '#core/observations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalValidRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_test001',
    type: 'decision',
    pattern: 'Use Result types',
    confidence: 0.9,
    observations: 1,
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-01-01T00:00:00Z',
    status: 'created',
    evidence: [],
    details: 'context: project; decision: always return Result',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Backward compat: old rows (no new fields) still pass
// ---------------------------------------------------------------------------

describe('isLearningObservation — backward compat (old rows, no new fields)', () => {
  it('accepts a minimal valid old-format decision row', () => {
    expect(isLearningObservation(minimalValidRow())).toBe(true);
  });

  it('accepts all four observation types', () => {
    for (const type of ['workflow', 'procedural', 'decision', 'pitfall']) {
      expect(isLearningObservation(minimalValidRow({ type }))).toBe(true);
    }
  });

  it('accepts all four status values', () => {
    for (const status of ['observing', 'ready', 'created', 'deprecated']) {
      expect(isLearningObservation(minimalValidRow({ status }))).toBe(true);
    }
  });

  it('accepts rows with optional legacy fields (mayBeStale, staleReason, quality_ok, artifact_path)', () => {
    const row = minimalValidRow({
      mayBeStale: true,
      staleReason: 'code-ref-missing:foo.ts',
      quality_ok: true,
      artifact_path: '/path/to/file.md#ADR-001',
    });
    expect(isLearningObservation(row)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// New fields accepted when correctly typed
// ---------------------------------------------------------------------------

describe('isLearningObservation — new ledger fields accepted when valid', () => {
  it('accepts anchor_id as string', () => {
    expect(isLearningObservation(minimalValidRow({ anchor_id: 'ADR-016' }))).toBe(true);
  });

  it('accepts date as string', () => {
    expect(isLearningObservation(minimalValidRow({ date: '2026-06-10' }))).toBe(true);
  });

  it('accepts all valid decisions_status values', () => {
    for (const decisions_status of ['Accepted', 'Active', 'Deprecated', 'Superseded', 'Retired']) {
      expect(isLearningObservation(minimalValidRow({ decisions_status }))).toBe(true);
    }
  });

  it('accepts amendments as array of {date, note} objects', () => {
    const row = minimalValidRow({
      amendments: [
        { date: '2026-06-07', note: 'Memory is no longer a Dream task' },
        { date: '2026-06-08', note: 'Follow-up clarification' },
      ],
    });
    expect(isLearningObservation(row)).toBe(true);
  });

  it('accepts raw_body as string', () => {
    const row = minimalValidRow({
      raw_body: '\n## ADR-001: Some decision\n\n- **Status**: Accepted\n',
    });
    expect(isLearningObservation(row)).toBe(true);
  });

  it('accepts a row with ALL new ledger fields set', () => {
    const row = minimalValidRow({
      anchor_id: 'ADR-016',
      date: '2026-06-06',
      decisions_status: 'Accepted',
      amendments: [{ date: '2026-06-07', note: 'Amendment note' }],
      raw_body: '\n## ADR-016: Split Dream\n\n- **Status**: Accepted\n',
    });
    expect(isLearningObservation(row)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// New fields rejected when malformed
// ---------------------------------------------------------------------------

describe('isLearningObservation — new ledger fields rejected when malformed', () => {
  it('rejects anchor_id as number', () => {
    expect(isLearningObservation(minimalValidRow({ anchor_id: 16 }))).toBe(false);
  });

  it('rejects anchor_id as boolean', () => {
    expect(isLearningObservation(minimalValidRow({ anchor_id: true }))).toBe(false);
  });

  it('rejects date as number', () => {
    expect(isLearningObservation(minimalValidRow({ date: 20260610 }))).toBe(false);
  });

  it('rejects decisions_status as unknown string', () => {
    expect(isLearningObservation(minimalValidRow({ decisions_status: 'Pending' }))).toBe(false);
  });

  it('rejects decisions_status as number', () => {
    expect(isLearningObservation(minimalValidRow({ decisions_status: 1 }))).toBe(false);
  });

  it('rejects amendments as non-array', () => {
    expect(isLearningObservation(minimalValidRow({ amendments: 'amendment string' }))).toBe(false);
  });

  it('rejects amendments where element is not an object', () => {
    expect(isLearningObservation(minimalValidRow({ amendments: ['just a string'] }))).toBe(false);
  });

  it('rejects amendments where element is missing note field', () => {
    expect(isLearningObservation(minimalValidRow({ amendments: [{ date: '2026-01-01' }] }))).toBe(false);
  });

  it('rejects amendments where element is missing date field', () => {
    expect(isLearningObservation(minimalValidRow({ amendments: [{ note: 'some note' }] }))).toBe(false);
  });

  it('rejects amendments where date is a number', () => {
    expect(isLearningObservation(minimalValidRow({ amendments: [{ date: 20260101, note: 'note' }] }))).toBe(false);
  });

  it('rejects raw_body as number', () => {
    expect(isLearningObservation(minimalValidRow({ raw_body: 42 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Required fields still enforced
// ---------------------------------------------------------------------------

describe('isLearningObservation — required fields still enforced', () => {
  it('rejects null', () => {
    expect(isLearningObservation(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isLearningObservation('string')).toBe(false);
  });

  it('rejects missing id', () => {
    const { id: _, ...row } = minimalValidRow() as { id: unknown; [k: string]: unknown };
    expect(isLearningObservation(row)).toBe(false);
  });

  it('rejects empty id', () => {
    expect(isLearningObservation(minimalValidRow({ id: '' }))).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(isLearningObservation(minimalValidRow({ type: 'unknown-type' }))).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(isLearningObservation(minimalValidRow({ status: 'active' }))).toBe(false);
  });

  it('rejects non-array evidence', () => {
    expect(isLearningObservation(minimalValidRow({ evidence: 'not an array' }))).toBe(false);
  });

  it('rejects non-string details', () => {
    expect(isLearningObservation(minimalValidRow({ details: null }))).toBe(false);
  });
});
