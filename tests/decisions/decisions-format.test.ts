// tests/decisions/decisions-format.test.ts
//
// Byte-compat tests for the shared format helpers in decisions-format.cjs.
// These helpers are the single source of truth for the output format of
// decisions.md and pitfalls.md entries.  Every assertion here locks a
// byte-level contract — any change to the output strings must be deliberate
// and propagated to all consumers (session-start-context, decisions-index,
// apply-decisions, decisions-usage-scan, render-decisions).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import * as path from 'path';
import { isLearningObservation } from '#core/observations.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const {
  initDecisionsContent,
  formatDecisionBody,
  formatPitfallBody,
  buildTldrLine,
  buildIndexContent,
  segmentDetails,
  formatAmendmentsLine,
} = require(path.join(ROOT, 'src/assets/scripts/hooks/lib/decisions-format.cjs')) as {
  initDecisionsContent: (kind: 'decision' | 'pitfall') => string;
  formatDecisionBody: (row: Record<string, unknown>) => string;
  formatPitfallBody: (row: Record<string, unknown>) => string;
  buildTldrLine: (kind: 'decisions' | 'pitfalls', rows: Record<string, unknown>[]) => string;
  buildIndexContent: (
    activeDecisionRows: Record<string, unknown>[],
    activePitfallRows: Record<string, unknown>[],
    opts: {
      decisionsFilePath: string;
      pitfallsFilePath: string;
      decisionBlocks?: string[];
      pitfallBlocks?: string[];
    }
  ) => string;
  segmentDetails: (
    detailsStr: string,
    keys: readonly string[]
  ) => Record<string, string>;
  // Accepts BOTH the { date, note } objects declared by LearningObservation /
  // LedgerRow in src/core/observations.ts and pre-rendered strings.
  formatAmendmentsLine: (
    amendments: unknown
  ) => string;
};

// ---------------------------------------------------------------------------
// initDecisionsContent — byte-compat headers
// ---------------------------------------------------------------------------

describe('initDecisionsContent', () => {
  it('decisions header matches byte-compat string', () => {
    const result = initDecisionsContent('decision');
    expect(result).toBe(
      '<!-- TL;DR: 0 decisions. Key: -->\n' +
      '# Architectural Decisions\n\n' +
      'Append-only. Status changes allowed; deletions prohibited.\n'
    );
  });

  it('pitfalls header matches byte-compat string', () => {
    const result = initDecisionsContent('pitfall');
    expect(result).toBe(
      '<!-- TL;DR: 0 pitfalls. Key: -->\n' +
      '# Known Pitfalls\n\n' +
      'Area-specific gotchas, fragile areas, and past bugs.\n'
    );
  });
});

// ---------------------------------------------------------------------------
// formatDecisionBody — byte-compat field layout
// ---------------------------------------------------------------------------

describe('formatDecisionBody', () => {
  it('produces exact heading, Date, Status, Context, Decision, Consequences, Source lines', () => {
    const row = {
      anchor_id: 'ADR-001',
      pattern: 'Use Result types everywhere',
      id: 'obs_c9d3m1',
      date: '2026-05-06',
      details: 'context: TypeScript project; decision: always return Result<T,E>; rationale: functional error handling',
    };
    const result = formatDecisionBody(row);

    expect(result).toMatch(/^\n## ADR-001: Use Result types everywhere\n\n/);
    expect(result).toContain('- **Date**: 2026-05-06\n');
    expect(result).toContain('- **Status**: Accepted\n');
    expect(result).toContain('- **Context**: TypeScript project\n');
    expect(result).toContain('- **Decision**: always return Result<T,E>\n');
    expect(result).toContain('- **Consequences**: functional error handling\n');
    expect(result).toContain('- **Source**: self-learning:obs_c9d3m1\n');
  });

  it('ends with a newline after Source line', () => {
    const row = {
      anchor_id: 'ADR-002',
      pattern: 'Some decision',
      id: 'obs_test',
      date: '2026-01-01',
      details: '',
    };
    const result = formatDecisionBody(row);
    expect(result).toMatch(/\n$/);
  });

  it('uses details as fallback for Context when no context: tag present', () => {
    const row = {
      anchor_id: 'ADR-003',
      pattern: 'Fallback decision',
      id: 'obs_fallback',
      date: '2026-06-01',
      details: 'just some raw detail text',
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Context**: just some raw detail text\n');
    expect(result).toContain('- **Decision**: Fallback decision\n');
  });

  it('falls back to obs id "unknown" when id is absent', () => {
    const row = {
      anchor_id: 'ADR-004',
      pattern: 'Missing id decision',
      date: '2026-06-01',
      details: '',
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Source**: self-learning:unknown\n');
  });

  it('renders empty date string when row.date is absent (D5 — render purity, RED until A3)', () => {
    // D5: formatDecisionBody must not clock-read new Date() as a fallback.
    // The fallback `row.date || new Date()...` makes the output non-deterministic
    // and breaks idempotent re-renders.  After the D5 fix: `row.date || ''`
    // renders `- **Date**: \n` for dateless rows.
    const row = {
      anchor_id: 'ADR-DATE',
      pattern: 'Dateless decision',
      id: 'obs_nodate',
      // date: intentionally absent — simulates a row that came through without a date
      details: 'context: foo; decision: bar; rationale: baz',
    };
    const result = formatDecisionBody(row);
    // Must render the empty date line (render-pure); must NOT embed today's date
    expect(result).toContain('- **Date**: \n');
    expect(result).not.toMatch(/- \*\*Date\*\*: \d{4}-\d{2}-\d{2}/);
  });

  it('matches byte-compat strings produced by assign-anchor for a real example', () => {
    // This golden string matches what assign-anchor (via formatDecisionBody) would write for this obs.
    const row = {
      anchor_id: 'ADR-007',
      id: 'obs_h9bw3c',
      pattern: 'Hook debug tracing must be a single global toggle',
      date: '2026-05-27',
      details: 'context: adding debug tracing to sidecar-capture; decision: implement DEVFLOW_HOOK_DEBUG=1; rationale: cross-hook interaction visibility',
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('\n## ADR-007: Hook debug tracing must be a single global toggle\n');
    expect(result).toContain('- **Date**: 2026-05-27\n');
    expect(result).toContain('- **Status**: Accepted\n');
    expect(result).toContain('- **Source**: self-learning:obs_h9bw3c\n');
  });
});

// ---------------------------------------------------------------------------
// formatPitfallBody — byte-compat field layout (NO Date field)
// ---------------------------------------------------------------------------

describe('formatPitfallBody', () => {
  it('produces exact heading, Area, Issue, Impact, Resolution, Status, Source lines', () => {
    const row = {
      anchor_id: 'PF-007',
      pattern: 'Editing installed hook scripts directly',
      id: 'obs_n4rs8t',
      details: 'area: src/assets/scripts/hooks/; issue: edits to installed copies; impact: silently overwritten; resolution: edit source + rebuild + reinstall',
    };
    const result = formatPitfallBody(row);

    expect(result).toMatch(/^\n## PF-007: Editing installed hook scripts directly\n\n/);
    expect(result).toContain('- **Area**: src/assets/scripts/hooks/\n');
    expect(result).toContain('- **Issue**: edits to installed copies\n');
    expect(result).toContain('- **Impact**: silently overwritten\n');
    expect(result).toContain('- **Resolution**: edit source + rebuild + reinstall\n');
    expect(result).toContain('- **Status**: Active\n');
    expect(result).toContain('- **Source**: self-learning:obs_n4rs8t\n');
  });

  it('has NO Date field (byte-compat asymmetry with decisions)', () => {
    const row = {
      anchor_id: 'PF-001',
      pattern: 'Some pitfall',
      id: 'obs_test_pf',
      details: 'area: somewhere; issue: something',
    };
    const result = formatPitfallBody(row);
    expect(result).not.toContain('**Date**');
  });

  it('ends with a newline after Source line', () => {
    const row = {
      anchor_id: 'PF-002',
      pattern: 'Another pitfall',
      id: 'obs_pf2',
      details: '',
    };
    const result = formatPitfallBody(row);
    expect(result).toMatch(/\n$/);
  });

  it('uses details as fallback for Area and Issue when no tags present', () => {
    const row = {
      anchor_id: 'PF-003',
      pattern: 'Fallback pitfall',
      id: 'obs_pf_fb',
      details: 'raw detail text no tags',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Area**: raw detail text no tags\n');
    expect(result).toContain('- **Issue**: raw detail text no tags\n');
  });

  it('falls back to obs id "unknown" when id is absent', () => {
    const row = {
      anchor_id: 'PF-004',
      pattern: 'Missing id pitfall',
      details: '',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Source**: self-learning:unknown\n');
  });
});

// ---------------------------------------------------------------------------
// segmentDetails — direct unit tests (RED until A1 implemented)
// ---------------------------------------------------------------------------
// Tests the exported segmentDetails(detailsStr, keys) pure helper.
// All assertions here will fail before the function is added to
// decisions-format.cjs because segmentDetails will be `undefined`.

describe('segmentDetails — direct unit tests', () => {
  const PF_KEYS = ['area', 'issue', 'impact', 'resolution'] as const;
  const ADR_KEYS = ['context', 'decision', 'rationale'] as const;

  it('extracts recognized key/value pairs from a clean details string', () => {
    const result = segmentDetails(
      'area: hooks; issue: foo; impact: bar; resolution: fix',
      PF_KEYS,
    );
    expect(result).toEqual({ area: 'hooks', issue: 'foo', impact: 'bar', resolution: 'fix' });
  });

  it('continuation segments (no recognized key) appended to previous field with semicolon', () => {
    // "src/core/" does not start with any recognized key → it extends the area value
    const result = segmentDetails(
      'area: src/hooks/; src/core/; issue: overwritten',
      PF_KEYS,
    );
    expect(result).toEqual({ area: 'src/hooks/; src/core/', issue: 'overwritten' });
  });

  it('collapses \\n to space inside field values', () => {
    const result = segmentDetails(
      'area: hooks; issue: problem\nwith\nnewlines',
      PF_KEYS,
    );
    expect(result).toEqual({ area: 'hooks', issue: 'problem with newlines' });
  });

  it('reissue: does NOT match issue: key (anchored check — reissue starts with r)', () => {
    // The unanchored old regex /issue:\s*([^;]+)/i finds "issue:" inside "reissue:".
    // The new segmenter checks the trimmed segment start; "reissue:" ≠ "issue:".
    const result = segmentDetails(
      'area: hooks; reissue: ADR-007; issue: actual problem; resolution: fix',
      PF_KEYS,
    );
    expect(result.issue).toBe('actual problem');
  });

  it('works for ADR keys (context / decision / rationale)', () => {
    const result = segmentDetails(
      'context: TypeScript; decision: use Result; rationale: safety',
      ADR_KEYS,
    );
    expect(result).toEqual({ context: 'TypeScript', decision: 'use Result', rationale: 'safety' });
  });

  it('a decoy key with NO real key after it leaves the field UNSET (isolates the anchoring)', () => {
    // The sibling 'reissue:' test above places the real `issue:` segment AFTER the
    // decoy, so a substring match would be overwritten by the later real segment and
    // the test would pass either way. Here there is no real `issue:` at all: the
    // field must stay undefined, and the decoy must fold into `area` as a
    // continuation. Swapping startsWith → includes makes THIS test RED.
    const result = segmentDetails('area: hooks; reissue: ADR-007', PF_KEYS);
    expect(result.issue).toBeUndefined();
    expect(result.area).toBe('hooks; reissue: ADR-007');
  });

  it('a decoy key AFTER the real key does not overwrite the real value', () => {
    // Ordering is the other half: with the decoy last, a substring match would
    // clobber the already-extracted value instead of extending it.
    const result = segmentDetails('issue: actual problem; reissue: ADR-007', PF_KEYS);
    expect(result.issue).toBe('actual problem; reissue: ADR-007');
  });

  it('a leading segment with no recognised key and no preceding field is dropped', () => {
    // currentKey is null until the first recognised key, so an orphan prefix has
    // nowhere to attach. It must be dropped, never silently assigned to keys[0].
    const result = segmentDetails('freeform prose with no key; area: hooks', PF_KEYS);
    expect(result).toEqual({ area: 'hooks' });
    expect(result.area).not.toContain('freeform prose');
  });
});

// ---------------------------------------------------------------------------
// segmentDetails — integration via formatDecisionBody (RED until A1)
// ---------------------------------------------------------------------------
// These tests drive formatDecisionBody through edge-cases that the OLD
// unanchored regex cannot handle.  They are RED until A1 wires segmentDetails
// into the formatter.

describe('segmentDetails — internal semicolons in decision fields', () => {
  it('Context field preserves embedded semicolons (not truncated at first ;)', () => {
    // OLD regex: /context:\s*([^;]+)/i → stops at first ; → "TypeScript"
    // NEW segmenter: "uses Result<T, E>" segment has no recognized key → continuation
    const row = {
      anchor_id: 'ADR-TEST',
      pattern: 'Test decision',
      id: 'obs_seg1',
      date: '2026-01-01',
      details: 'context: TypeScript; uses Result<T, E>; decision: always return Result; rationale: safety',
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Context**: TypeScript; uses Result<T, E>\n');
  });

  it('Decision field preserves embedded semicolons', () => {
    // OLD regex: /decision:\s*([^;]+)/i → stops at first ; → "step 1"
    const row = {
      anchor_id: 'ADR-TEST',
      pattern: 'Test decision',
      id: 'obs_seg2',
      date: '2026-01-01',
      details: 'context: project; decision: step 1; also step 2; rationale: cleaner',
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Decision**: step 1; also step 2\n');
  });

  it('Consequences (rationale) field preserves embedded semicolons', () => {
    // OLD regex: /rationale:\s*([^;]+)/i → stops at first ; → "benefit one"
    const row = {
      anchor_id: 'ADR-TEST',
      pattern: 'Test decision',
      id: 'obs_seg3',
      date: '2026-01-01',
      details: 'context: foo; decision: bar; rationale: benefit one; benefit two; benefit three',
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Consequences**: benefit one; benefit two; benefit three\n');
  });
});

describe('segmentDetails — internal semicolons in pitfall fields', () => {
  it('Area field preserves embedded semicolons', () => {
    // OLD regex: /area:\s*([^;]+)/i → "src/hooks/" only
    const row = {
      anchor_id: 'PF-TEST',
      pattern: 'Test pitfall',
      id: 'obs_seg4',
      details: 'area: src/hooks/; src/core/; issue: overwritten on reinstall',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Area**: src/hooks/; src/core/\n');
  });

  it('Issue field preserves embedded semicolons', () => {
    // OLD regex: /issue:\s*([^;]+)/i → "step 1" only
    const row = {
      anchor_id: 'PF-TEST',
      pattern: 'Test pitfall',
      id: 'obs_seg5',
      details: 'area: hooks; issue: step 1; also step 2; impact: bad',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Issue**: step 1; also step 2\n');
  });

  it('Impact field preserves embedded semicolons', () => {
    // OLD regex: /impact:\s*([^;]+)/i → "loses work" only
    const row = {
      anchor_id: 'PF-TEST',
      pattern: 'Test pitfall',
      id: 'obs_seg6',
      details: 'area: hooks; issue: foo; impact: loses work; corrupts state; resolution: fix',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Impact**: loses work; corrupts state\n');
  });

  it('Resolution field preserves embedded semicolons', () => {
    // OLD regex: /resolution:\s*([^;]+)/i → "step 1" only
    const row = {
      anchor_id: 'PF-TEST',
      pattern: 'Test pitfall',
      id: 'obs_seg7',
      details: 'area: hooks; issue: foo; impact: bar; resolution: step 1; step 2',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Resolution**: step 1; step 2\n');
  });

  it('reissue: does NOT false-match issue: key (PF-014-shaped specimen)', () => {
    // PF-014 bug: /issue:\s*([^;]+)/i is unanchored; it finds "issue:" inside
    // "reissue:" at string offset 2 and captures the wrong value.
    // Expected: issue = "process.exit skips finally" (from the actual issue: segment)
    const row = {
      anchor_id: 'PF-014',
      pattern: 'Test pitfall',
      id: 'obs_pf014',
      details: 'area: Node.js; reissue: ADR-007 not applicable; issue: process.exit skips finally; resolution: throw instead',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Issue**: process.exit skips finally\n');
    expect(result).toContain('- **Resolution**: throw instead\n');
  });

  it('first-match hijack: issue: embedded in area value does not capture wrong issue', () => {
    // OLD code: /issue:\s*([^;]+)/i on whole string finds "issue:" inside
    // "tracks issue: tickets" → captures "tickets" instead of "process exit".
    const row = {
      anchor_id: 'PF-TEST',
      pattern: 'Hijack test',
      id: 'obs_hijack',
      details: 'area: tracks issue: tickets; issue: process exit skips finally; resolution: use throw',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Area**: tracks issue: tickets\n');
    expect(result).toContain('- **Issue**: process exit skips finally\n');
  });

  it('newline in field value is collapsed to a space', () => {
    // [^;]+ matches \n; the output line would contain an embedded newline
    // unless the segmenter collapses \n → space.
    const row = {
      anchor_id: 'PF-TEST',
      pattern: 'Newline test',
      id: 'obs_newline',
      details: 'area: hooks; issue: problem\nwith newline; resolution: fix',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Issue**: problem with newline\n');
  });
});

// ---------------------------------------------------------------------------
// formatAmendmentsLine — amendments rendering (RED until A5)
// ---------------------------------------------------------------------------

describe('formatAmendmentsLine', () => {
  it('formats multiple amendments as semicolon-joined value on a single line', () => {
    const result = formatAmendmentsLine([
      '[2026-01-01] First amendment',
      '[2026-02-01] Second amendment',
    ]);
    expect(result).toBe('- **Amendments**: [2026-01-01] First amendment; [2026-02-01] Second amendment\n');
  });

  it('single amendment has no trailing semicolon', () => {
    const result = formatAmendmentsLine(['[2026-01-01] Only amendment']);
    expect(result).toBe('- **Amendments**: [2026-01-01] Only amendment\n');
  });

  it('empty array returns empty string (no Amendments line rendered)', () => {
    const result = formatAmendmentsLine([]);
    expect(result).toBe('');
  });
});

describe('formatAmendmentsLine — integration via formatDecisionBody / formatPitfallBody (RED until A5)', () => {
  it('formatDecisionBody includes Amendments line when row.amendments is non-empty', () => {
    const row = {
      anchor_id: 'ADR-001',
      pattern: 'Decision with amendments',
      id: 'obs_amend_001',
      date: '2026-01-01',
      details: 'context: foo; decision: bar; rationale: baz',
      amendments: ['[2026-02-01] Reinforced', '[2026-03-01] Confirmed'],
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Amendments**: [2026-02-01] Reinforced; [2026-03-01] Confirmed\n');
  });

  it('formatPitfallBody includes Amendments line when row.amendments is non-empty', () => {
    const row = {
      anchor_id: 'PF-001',
      pattern: 'Pitfall with amendments',
      id: 'obs_pf_amend_001',
      details: 'area: hooks; issue: foo; impact: bar; resolution: fix',
      amendments: ['[2026-02-01] Updated resolution'],
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Amendments**: [2026-02-01] Updated resolution\n');
  });

  it('formatDecisionBody omits Amendments line when row.amendments is absent', () => {
    const row = {
      anchor_id: 'ADR-002',
      pattern: 'No amendments',
      id: 'obs_002',
      date: '2026-01-01',
      details: 'context: foo; decision: bar; rationale: baz',
    };
    const result = formatDecisionBody(row);
    expect(result).not.toContain('Amendments');
  });

  it('formatDecisionBody omits Amendments line when row.amendments is an empty array', () => {
    const row = {
      anchor_id: 'ADR-003',
      pattern: 'Empty amendments',
      id: 'obs_003',
      date: '2026-01-01',
      details: 'context: foo; decision: bar; rationale: baz',
      amendments: [],
    };
    const result = formatDecisionBody(row);
    expect(result).not.toContain('Amendments');
  });
});

// ---------------------------------------------------------------------------
// formatAmendmentsLine — the { date, note } object shape
//
// src/core/observations.ts declares `amendments?: { date: string; note: string }[]`
// on BOTH LearningObservation and LedgerRow, and its isLearningObservation
// type guard REJECTS a plain string element (tests/decisions/observations-schema.test.ts).
// toLedgerRow copies obs.amendments through verbatim, so the object shape is the
// only shape that can legitimately reach the formatter — a bare join would render
// `- **Amendments**: [object Object]`.
// ---------------------------------------------------------------------------

describe('formatAmendmentsLine — { date, note } object shape (the schema-declared shape)', () => {
  it('renders a { date, note } entry as "[date] note" — never [object Object]', () => {
    const result = formatAmendmentsLine([{ date: '2026-01-01', note: 'First amendment' }]);
    expect(result).toBe('- **Amendments**: [2026-01-01] First amendment\n');
    expect(result).not.toContain('[object Object]');
  });

  it('joins multiple object entries with "; " identically to the string form', () => {
    const objects = formatAmendmentsLine([
      { date: '2026-01-01', note: 'First amendment' },
      { date: '2026-02-01', note: 'Second amendment' },
    ]);
    const strings = formatAmendmentsLine([
      '[2026-01-01] First amendment',
      '[2026-02-01] Second amendment',
    ]);
    expect(objects).toBe('- **Amendments**: [2026-01-01] First amendment; [2026-02-01] Second amendment\n');
    expect(objects).toBe(strings);
  });

  it('accepts a mixed array of strings and objects', () => {
    const result = formatAmendmentsLine([
      'pre-rendered entry',
      { date: '2026-02-01', note: 'object entry' },
    ]);
    expect(result).toBe('- **Amendments**: pre-rendered entry; [2026-02-01] object entry\n');
  });

  it('renders a note-only object bare (no empty bracket pair)', () => {
    expect(formatAmendmentsLine([{ note: 'note without a date' }])).toBe(
      '- **Amendments**: note without a date\n'
    );
  });

  it('collapses newlines inside a note to preserve the single-line field contract', () => {
    const result = formatAmendmentsLine([{ date: '2026-01-01', note: 'line one\nline two' }]);
    expect(result).toBe('- **Amendments**: [2026-01-01] line one line two\n');
    expect(result.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('drops unrenderable entries and emits NO line when nothing survives', () => {
    // A formatter running under .decisions.lock must degrade, never throw.
    expect(formatAmendmentsLine([{ date: '2026-01-01' }, null, 42])).toBe('');
    expect(formatAmendmentsLine(['   '])).toBe('');
  });

  it('formatDecisionBody renders the object shape through to the entry body', () => {
    const row = {
      anchor_id: 'ADR-004',
      pattern: 'Decision with object amendments',
      id: 'obs_004',
      date: '2026-01-01',
      details: 'context: foo; decision: bar; rationale: baz',
      amendments: [{ date: '2026-02-01', note: 'Reinforced' }],
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Amendments**: [2026-02-01] Reinforced\n');
    expect(result).not.toContain('[object Object]');
  });

  it('formatPitfallBody renders the object shape through to the entry body', () => {
    const row = {
      anchor_id: 'PF-004',
      pattern: 'Pitfall with object amendments',
      id: 'obs_pf_004',
      details: 'area: hooks; issue: foo; impact: bar; resolution: fix',
      amendments: [{ date: '2026-02-01', note: 'Updated resolution' }],
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Amendments**: [2026-02-01] Updated resolution\n');
    expect(result).not.toContain('[object Object]');
  });

  it('amendment text never leaks into the compact index line (applies ADR-007)', () => {
    const row = {
      anchor_id: 'ADR-005',
      type: 'decision',
      pattern: 'Indexed decision',
      id: 'obs_005',
      date: '2026-01-01',
      details: 'context: foo; decision: bar; rationale: baz',
      amendments: [{ date: '2026-02-01', note: 'amendment-marker-text' }],
    };
    const index = buildIndexContent([row], [], {
      decisionsFilePath: '/d.md',
      pitfallsFilePath: '/p.md',
    });
    expect(index).toContain('ADR-005  Indexed decision  [Accepted]');
    expect(index).not.toContain('amendment-marker-text');
    expect(index).not.toContain('Amendments');
  });

  it('PF-043 cross-check: the canonical { date, note } fixture passes isLearningObservation AND formatAmendmentsLine renders it correctly', () => {
    // PF-043 Resolution: derive fixtures from the runtime type guard and run at least
    // one through the guard inside the consuming test so the two suites cannot drift.
    // Previously this was only described in a comment; this test enforces it.
    const amendments = [{ date: '2026-02-01', note: 'Reinforced' }];
    const minimalObs = {
      id: 'obs_pf043_check',
      type: 'decision',
      pattern: 'PF-043 cross-check fixture',
      confidence: 0.9,
      observations: 1,
      first_seen: '2026-02-01T00:00:00Z',
      last_seen: '2026-02-01T00:00:00Z',
      status: 'created',
      evidence: [],
      details: 'context: PF-043; decision: derive fixtures from the type guard',
      amendments,
    };
    // Guard accepts the object-shape amendments (the schema-declared shape)
    expect(isLearningObservation(minimalObs)).toBe(true);
    // Formatter renders the same fixture to the expected string
    expect(formatAmendmentsLine(amendments)).toBe('- **Amendments**: [2026-02-01] Reinforced\n');
  });
});

// ---------------------------------------------------------------------------
// buildTldrLine — format and key slicing
// ---------------------------------------------------------------------------

describe('buildTldrLine', () => {
  it('decisions TL;DR: correct count and Key list', () => {
    const rows = [
      { anchor_id: 'ADR-001' },
      { anchor_id: 'ADR-003' },
      { anchor_id: 'ADR-004' },
    ];
    const result = buildTldrLine('decisions', rows);
    expect(result).toBe('<!-- TL;DR: 3 decisions. Key: ADR-001, ADR-003, ADR-004 -->');
  });

  it('pitfalls TL;DR: correct count and Key list', () => {
    const rows = [
      { anchor_id: 'PF-002' },
      { anchor_id: 'PF-004' },
    ];
    const result = buildTldrLine('pitfalls', rows);
    expect(result).toBe('<!-- TL;DR: 2 pitfalls. Key: PF-002, PF-004 -->');
  });

  it('Key includes only last 5 IDs when more than 5 rows', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      anchor_id: `ADR-${String(i + 1).padStart(3, '0')}`,
    }));
    const result = buildTldrLine('decisions', rows);
    // Last 5 should be ADR-004 through ADR-008
    expect(result).toBe('<!-- TL;DR: 8 decisions. Key: ADR-004, ADR-005, ADR-006, ADR-007, ADR-008 -->');
  });

  it('empty corpus: count is 0, Key is empty with single trailing space (byte-compat with initDecisionsContent)', () => {
    const result = buildTldrLine('decisions', []);
    // Must be byte-identical to initDecisionsContent's TL;DR (single space before -->)
    expect(result).toBe('<!-- TL;DR: 0 decisions. Key: -->');
  });

  it('Key uses comma+space separator (AC-A5)', () => {
    const rows = [{ anchor_id: 'ADR-001' }, { anchor_id: 'ADR-002' }];
    const result = buildTldrLine('decisions', rows);
    expect(result).toContain('ADR-001, ADR-002');
  });
});

// ---------------------------------------------------------------------------
// buildIndexContent — compact index generation
// ---------------------------------------------------------------------------

const OPTS = {
  decisionsFilePath: '/project/.devflow/learning/decisions.md',
  pitfallsFilePath:  '/project/.devflow/learning/pitfalls.md',
};

function makeAdrRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_adr1',
    type: 'decision',
    anchor_id: 'ADR-001',
    pattern: 'Use Result types everywhere',
    date: '2026-01-01',
    details: 'context: TypeScript; decision: return Result<T,E>; rationale: safety',
    ...overrides,
  };
}

function makePfRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_pf1',
    type: 'pitfall',
    anchor_id: 'PF-002',
    pattern: 'Editing installed scripts directly',
    details: 'area: src/assets/scripts/hooks/; issue: overwritten on reinstall; impact: lost; resolution: rebuild',
    ...overrides,
  };
}

describe('buildIndexContent', () => {
  it('returns "(none)" for empty corpus', () => {
    expect(buildIndexContent([], [], OPTS)).toBe('(none)');
  });

  it('decisions-only block has correct header and entry line', () => {
    const result = buildIndexContent([makeAdrRow()], [], OPTS);
    expect(result).toMatch(/^Decisions \(1\):/m);
    expect(result).toContain('ADR-001');
    expect(result).toContain('Use Result types everywhere');
    expect(result).toContain('[Accepted]');
    // No pitfalls block
    expect(result).not.toMatch(/^Pitfalls/m);
  });

  it('pitfalls-only block has correct header and entry line with area suffix', () => {
    const result = buildIndexContent([], [makePfRow()], OPTS);
    expect(result).toMatch(/^Pitfalls \(1\):/m);
    expect(result).toContain('PF-002');
    expect(result).toContain('Editing installed scripts directly');
    expect(result).toContain('[Active]');
    expect(result).toContain('src/assets/scripts/hooks/');
    // No decisions block
    expect(result).not.toMatch(/^Decisions/m);
  });

  it('mixed corpus produces Decisions block then Pitfalls block', () => {
    const result = buildIndexContent([makeAdrRow()], [makePfRow()], OPTS);
    expect(result).toMatch(/^Decisions \(1\):/m);
    expect(result).toMatch(/^Pitfalls \(1\):/m);
    // Decisions must appear before Pitfalls
    expect(result.indexOf('Decisions (')).toBeLessThan(result.indexOf('Pitfalls ('));
  });

  it('footer contains absolute paths and Read instruction', () => {
    const result = buildIndexContent([makeAdrRow()], [makePfRow()], OPTS);
    expect(result).toContain(OPTS.decisionsFilePath);
    expect(result).toContain(OPTS.pitfallsFilePath);
    expect(result).toContain('Read the relevant file');
  });

  it('no trailing newline in returned string (caller adds \\n before writing)', () => {
    const result = buildIndexContent([makeAdrRow()], [makePfRow()], OPTS);
    expect(result).not.toMatch(/\n$/);
  });

  it('uses raw_body when present (migrated entry byte-compat)', () => {
    const rawBody = '\n## ADR-005: Migrated decision\n\n- **Status**: Active\n- **Source**: self-learning:obs_m\n';
    const row = makeAdrRow({ anchor_id: 'ADR-005', raw_body: rawBody });
    const result = buildIndexContent([row], [], OPTS);
    expect(result).toContain('ADR-005');
    expect(result).toContain('Migrated decision');
    expect(result).toContain('[Active]');
  });

  it('truncates long title to 60 chars + ellipsis', () => {
    const longTitle = 'A'.repeat(70);
    const row = makeAdrRow({ pattern: longTitle });
    const result = buildIndexContent([row], [], OPTS);
    // Title in entry line is truncated
    expect(result).toContain('A'.repeat(60) + '…');
    expect(result).not.toContain('A'.repeat(61));
  });

  it('entry line with no area has no " — " area suffix (decisions have no Area field)', () => {
    const result = buildIndexContent([makeAdrRow()], [], OPTS);
    // The ADR entry line should not contain an area suffix
    const lines = result.split('\n');
    const entryLine = lines.find(l => l.includes('ADR-001'));
    expect(entryLine).toBeDefined();
    expect(entryLine).not.toContain(' — ');
  });

  it('multiple decisions are counted correctly in block header', () => {
    const rows = [
      makeAdrRow({ anchor_id: 'ADR-001', id: 'obs_a1' }),
      makeAdrRow({ anchor_id: 'ADR-002', id: 'obs_a2', pattern: 'Second decision' }),
    ];
    const result = buildIndexContent(rows, [], OPTS);
    expect(result).toMatch(/^Decisions \(2\):/m);
  });

  it('footer omits ADR-NNN line when no decisions, omits PF-NNN line when no pitfalls', () => {
    const decisionsOnly = buildIndexContent([makeAdrRow()], [], OPTS);
    expect(decisionsOnly).toContain('ADR-NNN entries live in');
    expect(decisionsOnly).not.toContain('PF-NNN  entries live in');

    const pitfallsOnly = buildIndexContent([], [makePfRow()], OPTS);
    expect(pitfallsOnly).not.toContain('ADR-NNN entries live in');
    expect(pitfallsOnly).toContain('PF-NNN  entries live in');
  });

  it('row with raw_body === "" falls through to formatDecisionBody and appears in index (not dropped)', () => {
    // ISSUE-1: raw_body === "" is falsy — buildIndexContent must NOT treat it as a
    // present block (which yields no heading match and silently drops the row from
    // the index). It must fall through to formatDecisionBody so the row appears.
    const rowWithEmptyRawBody = makeAdrRow({ raw_body: '' });
    const result = buildIndexContent([rowWithEmptyRawBody], [], OPTS);
    expect(result).toContain('ADR-001');
    expect(result).toContain('Use Result types everywhere');
    expect(result).toContain('[Accepted]');
  });

  it('pitfall row with raw_body === "" falls through to formatPitfallBody and appears in index (not dropped)', () => {
    // Symmetric ISSUE-1 check for pitfall rows.
    const rowWithEmptyRawBody = makePfRow({ raw_body: '' });
    const result = buildIndexContent([], [rowWithEmptyRawBody], OPTS);
    expect(result).toContain('PF-002');
    expect(result).toContain('Editing installed scripts directly');
    expect(result).toContain('[Active]');
  });

  it('area suffix in entry line is truncated to 80 chars + ellipsis when area exceeds 80 chars', () => {
    // ISSUE-6: pins the area-suffix 80-char truncation behaviour for pitfall rows.
    const longArea = 'A'.repeat(90);
    const row = makePfRow({ details: `area: ${longArea}; issue: something` });
    const result = buildIndexContent([], [row], OPTS);
    // Truncated area must appear followed by ellipsis; the 81st char must NOT appear.
    expect(result).toContain('A'.repeat(80) + '…');
    expect(result).not.toContain('A'.repeat(81));
  });

  it('row with a raw_body missing the Status line renders with [unknown] tag', () => {
    // ISSUE-16: [unknown]-status branch in formatIndexEntryLine is a defensive
    // guard for malformed raw_body rows (no Status: field). Restore minimal coverage.
    const rawBodyNoStatus = '\n## ADR-099: Entry without status line\n\n- **Context**: something\n- **Source**: self-learning:obs_x\n';
    const row = makeAdrRow({ anchor_id: 'ADR-099', raw_body: rawBodyNoStatus });
    const result = buildIndexContent([row], [], OPTS);
    expect(result).toContain('ADR-099');
    expect(result).toContain('[unknown]');
  });
});

// ---------------------------------------------------------------------------
// json-helper.cjs byte-compat: assign-anchor delegates to decisions-format
// ---------------------------------------------------------------------------
// We verify this by seeding an observation row directly (as the Learning agent
// appends it), promoting via assign-anchor, and checking the output matches
// what formatDecisionBody/formatPitfallBody would produce. This ensures the
// write path delegates to decisions-format.cjs correctly (AC-A8: assign-anchor
// is the sole writer).

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

const JSON_HELPER = path.join(ROOT, 'src/assets/scripts/hooks/json-helper.cjs');

describe('json-helper.cjs assign-anchor delegates to decisions-format', () => {
  it('decision entry written via assign-anchor matches formatDecisionBody output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-compat-test-'));
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.mkdirSync(decisionsDir, { recursive: true });
    const logFile = path.join(decisionsDir, 'decisions-log.jsonl');

    const obs = JSON.stringify({
      id: 'obs_formattest1',
      type: 'decision',
      pattern: 'Use immutable data structures',
      confidence: 0.9,
      observations: 1,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-01T00:00:00Z',
      status: 'observing',
      evidence: [],
      details: 'context: all state; decision: always return new objects; rationale: no mutation bugs',
      quality_ok: true,
    });

    try {
      // Seed the observation directly (one JSONL row, as the Learning agent
      // appends it), then promote via assign-anchor
      fs.writeFileSync(logFile, obs + '\n', 'utf8');
      execSync(
        `node "${JSON_HELPER}" assign-anchor decision obs_formattest1`,
        { cwd: tmpDir, encoding: 'utf8' }
      );

      const written = fs.readFileSync(path.join(decisionsDir, 'decisions.md'), 'utf8');
      // Heading format
      expect(written).toContain('\n## ADR-001: Use immutable data structures\n');
      // Date line present
      expect(written).toMatch(/- \*\*Date\*\*: \d{4}-\d{2}-\d{2}\n/);
      // Status
      expect(written).toContain('- **Status**: Accepted\n');
      // Source
      expect(written).toContain('- **Source**: self-learning:obs_formattest1\n');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('pitfall entry written via assign-anchor matches formatPitfallBody output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-compat-pf-test-'));
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.mkdirSync(decisionsDir, { recursive: true });
    const logFile = path.join(decisionsDir, 'decisions-log.jsonl');

    const obs = JSON.stringify({
      id: 'obs_pfformattest1',
      type: 'pitfall',
      pattern: 'Editing installed files directly',
      confidence: 0.8,
      observations: 2,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-02T00:00:00Z',
      status: 'observing',
      evidence: [],
      details: 'area: src/assets/scripts/hooks/; issue: changes overwritten on reinstall; impact: lost changes; resolution: edit source + rebuild',
      quality_ok: true,
    });

    try {
      // Seed the observation directly (one JSONL row, as the Learning agent
      // appends it), then promote via assign-anchor
      fs.writeFileSync(logFile, obs + '\n', 'utf8');
      execSync(
        `node "${JSON_HELPER}" assign-anchor pitfall obs_pfformattest1`,
        { cwd: tmpDir, encoding: 'utf8' }
      );

      const written = fs.readFileSync(path.join(decisionsDir, 'pitfalls.md'), 'utf8');
      // Heading format
      expect(written).toContain('\n## PF-001: Editing installed files directly\n');
      // Area present, NO Date
      expect(written).toContain('- **Area**: src/assets/scripts/hooks/');
      expect(written).not.toContain('**Date**');
      // Status
      expect(written).toContain('- **Status**: Active\n');
      // Source
      expect(written).toContain('- **Source**: self-learning:obs_pfformattest1\n');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('decisions-append op is removed — unknown op exits with error', () => {
    // AC-A8: decisions-append must no longer exist as a json-helper op.
    // Verify the op is rejected as unknown (exit code 1).
    expect(() => {
      execSync(
        `node "${JSON_HELPER}" decisions-append /tmp/dummy.md decision '{}'`,
        { encoding: 'utf8' }
      );
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Learning agent content-presence assertions (AC-F1, AC-F2)
// ---------------------------------------------------------------------------
// These lightweight checks verify that the Learning agent instructions
// (src/assets/agents/learning.md) contain the required creation-bar elements. They do
// not test LLM judgment — that is validated by the Test agent via scenarios.
// They lock the prose contract so the agent cannot accidentally regress on the
// key phrases.

describe('Learning agent creation-bar contract', () => {
  const AGENT_PATH = path.join(ROOT, 'src/assets/agents/learning.md');

  let agentContent: string;
  beforeAll(() => {
    agentContent = fs.readFileSync(AGENT_PATH, 'utf8');
  });

  it('contains abstain-by-default stance', () => {
    expect(agentContent).toContain('Most runs produce nothing');
    expect(agentContent).toContain('If unsure, record nothing');
  });

  it('contains ADR-XOR-PF hard rule', () => {
    expect(agentContent).toContain('ADR-XOR-PF');
    // "never both" may span a line break — check both forms
    expect(agentContent).toMatch(/never\s+both/);
    expect(agentContent).toContain('Concrete failure');
    expect(agentContent).toContain('forward-looking');
  });

  it('contains dedup-before-create rule', () => {
    expect(agentContent).toContain('Dedup before creating');
    expect(agentContent).toContain('reinforce that row');
  });

  it('instructs agent to use assign-anchor for promotion, never invents numbers itself', () => {
    // The agent must be instructed to use assign-anchor for promotion
    expect(agentContent).toContain('assign-anchor');
    // decisions-append is retired tooling and is not mentioned at all (nothing
    // positively instructs calling it — there is no lingering reference to forbid).
    expect(agentContent).not.toMatch(/\bjson-helper\.cjs\b.*\bdecisions-append\b/);
    expect(agentContent).not.toContain('decisions-append');
    expect(agentContent).toContain('NEVER invent an ADR-NNN/PF-NNN number');
  });

  it('has no numeric confidence gate (ADR-008)', () => {
    // Must not contain a numeric confidence threshold that acts as a gate
    expect(agentContent).not.toMatch(/confidence\s*[>=]+\s*0\.\d+/);
    expect(agentContent).not.toContain('0.65');
    expect(agentContent).not.toContain('0.95');
  });

  it('states confidence is metadata, not a gate', () => {
    expect(agentContent).toContain('NOT a gate');
  });

  it('Iron Law references assign-anchor and render, not decisions-append', () => {
    // Verify Iron Law line
    expect(agentContent).toContain('assign-anchor OWNS NUMBERING');
    expect(agentContent).toContain('render OWNS THE .md');
    expect(agentContent).toContain('NEVER HAND-EDIT');
  });

  it('negative examples list both NOT-a-decision and NOT-a-pitfall', () => {
    expect(agentContent).toContain('NOT a decision');
    expect(agentContent).toContain('NOT a pitfall');
  });
});

// ---------------------------------------------------------------------------
// Item 5 — acceptance-criteria pins
// ---------------------------------------------------------------------------

describe('segmentDetails — comma positive-control (commas never split fields)', () => {
  // Commas are NOT separators in segmentDetails — only ';' is.
  // These tests document the positive contract and prevent a regression where
  // comma handling is accidentally introduced.

  it('commas inside field values are preserved verbatim', () => {
    const ADR_KEYS = ['context', 'decision', 'rationale'] as const;
    const result = segmentDetails(
      'context: TypeScript, Go, Rust; decision: use Result<T, E>; rationale: safety, clarity',
      ADR_KEYS,
    );
    expect(result.context).toBe('TypeScript, Go, Rust');
    expect(result.decision).toBe('use Result<T, E>');
    expect(result.rationale).toBe('safety, clarity');
  });

  it('formatDecisionBody preserves commas in all ADR field values', () => {
    const row = {
      anchor_id: 'ADR-COMMA',
      pattern: 'Comma positive-control decision',
      id: 'obs_comma',
      date: '2026-01-01',
      details: 'context: Go, Rust, TypeScript; decision: use Result, not panics; rationale: safety, clarity',
    };
    const result = formatDecisionBody(row);
    expect(result).toContain('- **Context**: Go, Rust, TypeScript\n');
    expect(result).toContain('- **Decision**: use Result, not panics\n');
    expect(result).toContain('- **Consequences**: safety, clarity\n');
  });

  it('formatPitfallBody preserves commas in pitfall field values', () => {
    const row = {
      anchor_id: 'PF-COMMA',
      pattern: 'Comma positive-control pitfall',
      id: 'obs_pf_comma',
      details: 'area: hooks, scripts; issue: step 1, step 2; impact: foo; resolution: bar',
    };
    const result = formatPitfallBody(row);
    expect(result).toContain('- **Area**: hooks, scripts\n');
    expect(result).toContain('- **Issue**: step 1, step 2\n');
  });
});

describe('formatDecisionBody / formatPitfallBody — amendments position pin', () => {
  // Amendments must render LAST (after Source).  This test pins that ordering so
  // reordering the concatenation in the formatters fails loudly rather than silently.

  it('Amendments renders after Source in formatDecisionBody', () => {
    const row = {
      anchor_id: 'ADR-POS',
      pattern: 'Position test decision',
      id: 'obs_pos_adr',
      date: '2026-01-01',
      details: 'context: foo; decision: bar; rationale: baz',
      amendments: [{ date: '2026-06-01', note: 'Reinforced' }],
    };
    const result = formatDecisionBody(row);
    const sourceIdx = result.indexOf('- **Source**:');
    const amendmentsIdx = result.indexOf('- **Amendments**:');
    expect(sourceIdx).toBeGreaterThan(-1);
    expect(amendmentsIdx).toBeGreaterThan(-1);
    // Amendments must appear AFTER Source — reordering the concatenation fails here
    expect(amendmentsIdx).toBeGreaterThan(sourceIdx);
  });

  it('Amendments renders after Source in formatPitfallBody', () => {
    const row = {
      anchor_id: 'PF-POS',
      pattern: 'Position test pitfall',
      id: 'obs_pos_pf',
      details: 'area: hooks; issue: foo; impact: bar; resolution: fix',
      amendments: [{ date: '2026-06-01', note: 'Updated resolution' }],
    };
    const result = formatPitfallBody(row);
    const sourceIdx = result.indexOf('- **Source**:');
    const amendmentsIdx = result.indexOf('- **Amendments**:');
    expect(sourceIdx).toBeGreaterThan(-1);
    expect(amendmentsIdx).toBeGreaterThan(-1);
    expect(amendmentsIdx).toBeGreaterThan(sourceIdx);
  });
});

describe("segmentDetails — rejoin-normalization of TL;DR (documented '; ' join behavior)", () => {
  // segmentDetails splits on ';' — a tight TL;DR in a field value becomes two
  // segments "TL" and "DR".  The continuation logic reassembles them with '; '
  // (spaced) because that is the canonical rejoiner.  This is deliberate:
  // the '; ' join is the contract for continuation segments throughout this module.
  // Pin this behavior so it cannot silently change (e.g., to ',' or ';').

  it('TL;DR in a decision field renders as "TL; DR" (tight → spaced, deliberate "; " rejoin)', () => {
    const ADR_KEYS = ['context', 'decision', 'rationale'] as const;
    const result = segmentDetails(
      'decision: TL;DR of the approach; rationale: keeps things simple',
      ADR_KEYS,
    );
    // '; ' join: TL + continuation " DR of the approach" → "TL; DR of the approach"
    expect(result.decision).toBe('TL; DR of the approach');
  });

  it('TL;DR in a pitfall field renders as "TL; DR" (same normalization)', () => {
    const PF_KEYS = ['area', 'issue', 'impact', 'resolution'] as const;
    const result = segmentDetails(
      'area: hooks; issue: TL;DR of the problem; impact: bad',
      PF_KEYS,
    );
    expect(result.issue).toBe('TL; DR of the problem');
  });
});

// ---------------------------------------------------------------------------
// REG-2: recovery pass for legacy corpus rows (fields embedded after ". ")
// ---------------------------------------------------------------------------

describe('segmentDetails — REG-2: recovery pass for legacy corpus rows', () => {
  const PF_KEYS = ['area', 'issue', 'impact', 'resolution'] as const;
  const ADR_KEYS = ['context', 'decision', 'rationale'] as const;

  it('PF-009-shaped: keys embedded mid-segment after ". " are recovered by recovery pass', () => {
    // Legacy corpus rows (before the ';'-grammar was documented) use '. ' as
    // the field separator — the anchored pass only captures 'area:' (at segment
    // start), and the recovery pass fills 'issue:', 'impact:', 'resolution:'.
    const details =
      'area: rule install fan-out. issue: no per-item try/catch. impact: aborts install. resolution: wrap in try/catch';
    const result = segmentDetails(details, PF_KEYS);
    // anchored pass captures area (it is at segment start)
    expect(result.area).toBeTruthy();
    // recovery pass rescues the remaining fields
    expect(result.issue).toBeTruthy();
    expect(result.issue).toContain('no per-item try/catch');
    expect(result.impact).toBeTruthy();
    expect(result.impact).toContain('aborts install');
    expect(result.resolution).toBeTruthy();
    expect(result.resolution).toContain('wrap in try/catch');
  });

  it('ADR-004-shaped: decision and rationale embedded mid-segment are recovered', () => {
    // ADR-004 uses '. ' separators; 'decision:' and 'rationale:' appear
    // mid-segment after the context value — the recovery pass is required.
    const details =
      'context: ambient mode churned through two designs. decision: pivot to always-on orchestrator charter. rationale: graded orchestrator is simpler';
    const result = segmentDetails(details, ADR_KEYS);
    expect(result.context).toBeTruthy();
    // recovery pass fills the remaining ADR keys
    expect(result.decision).toBeTruthy();
    expect(result.decision).toContain('pivot');
    expect(result.rationale).toBeTruthy();
    expect(result.rationale).toContain('simpler');
  });

  it('recovery pass does NOT override a value already set by the anchored pass', () => {
    // 'area:' appears at the start of the first segment AND again mid-segment.
    // The anchored pass sets it on the first occurrence; recovery must skip it.
    const details = 'area: correct value. area: should not win via recovery';
    const result = segmentDetails(details, PF_KEYS);
    expect(result.area).toBeTruthy();
    // The anchored match captured from the first segment — recovery skips.
    expect(result.area).toContain('correct value');
  });

  it('well-formed ;-delimited input still parses correctly (no regression)', () => {
    const details = 'area: hooks; issue: Promise.all; impact: install aborts; resolution: guard';
    const result = segmentDetails(details, PF_KEYS);
    expect(result.area).toBe('hooks');
    expect(result.issue).toBe('Promise.all');
    expect(result.impact).toBe('install aborts');
    expect(result.resolution).toBe('guard');
  });
});

// ---------------------------------------------------------------------------
// TS-1: full JS LineTerminator set collapsed in field values (\r, \r\n, LS, PS)
// ---------------------------------------------------------------------------

describe('segmentDetails — TS-1: full LineTerminator set collapsed in field values', () => {
  const PF_KEYS = ['area', 'issue', 'impact', 'resolution'] as const;

  it('\\r (bare CR) in a segment value is collapsed to a space', () => {
    const result = segmentDetails('area: foo\rbar; issue: baz', PF_KEYS);
    expect(result.area).toBe('foo bar');
  });

  it('\\r\\n (CRLF) in a segment value — each character is replaced, yielding two spaces', () => {
    const result = segmentDetails('area: foo\r\nbar; issue: baz', PF_KEYS);
    expect(result.area).toBe('foo  bar');
  });

  it('\\u2028 (LS) in a segment value is collapsed to a space', () => {
    const result = segmentDetails('area: foo bar; issue: baz', PF_KEYS);
    expect(result.area).toBe('foo bar');
  });

  it('\\r in amendmentToString string form is collapsed to a space', () => {
    expect(formatAmendmentsLine(['foo\rbar'])).toBe('- **Amendments**: foo bar\n');
  });

  it('\\r\\n in amendmentToString string form — both chars replaced, two spaces', () => {
    expect(formatAmendmentsLine(['foo\r\nbar'])).toBe('- **Amendments**: foo  bar\n');
  });

  it('\\u2028 in amendmentToString string form is collapsed to a space', () => {
    expect(formatAmendmentsLine(['foo bar'])).toBe('- **Amendments**: foo bar\n');
  });

  it('\\r in amendmentToString { date, note } object note is collapsed to a space', () => {
    expect(formatAmendmentsLine([{ note: 'foo\rbar', date: '2026-01-01' }])).toBe(
      '- **Amendments**: [2026-01-01] foo bar\n',
    );
  });

  it('CR-bearing area value cannot hijack the Status tag in buildIndexContent (TS-1 guard)', () => {
    // Without LINE_TERMINATORS collapse, formatPitfallBody would emit:
    //   "- **Area**: foo\r- **Status**: Faked\n"
    // and the /^- \*\*Status\*\*:/m regex would wrongly extract "Faked" as
    // the status field. With the fix the CR is collapsed to a space, so the
    // actual "- **Status**: Active\n" line is the only Status line in the block.
    const row = {
      anchor_id: 'PF-001',
      pattern: 'test pitfall',
      id: 'obs1',
      decisions_status: undefined,
      details: 'area: foo\r- **Status**: Faked; issue: x; impact: y; resolution: z',
    };
    const result = buildIndexContent([], [row], {
      decisionsFilePath: '/tmp/decisions.md',
      pitfallsFilePath: '/tmp/pitfalls.md',
    });
    expect(result).toContain('[Active]');
    expect(result).not.toContain('[Faked]');
  });
});

// ---------------------------------------------------------------------------
// SEC-S1: duplicate-key policy — last-match-wins (docstring correction pin)
// ---------------------------------------------------------------------------

describe('segmentDetails — SEC-S1: duplicate-key policy is last-match-wins', () => {
  const PF_KEYS = ['area', 'issue', 'impact', 'resolution'] as const;

  it('when the same key appears more than once the LAST segment-start occurrence wins', () => {
    // The docstring previously said "priority order" (implying first-wins) but
    // the implementation overwrites on each match — so last wins.  This test
    // pins last-match-wins so a refactor cannot silently invert it.
    const result = segmentDetails('area: first; area: second', PF_KEYS);
    expect(result.area).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// toLedgerRow sink validation — SEC-1 / PF-023
// Validate at the convergence point so assign-anchor, refresh-anchor, and any
// future op inherit the guards without repeating them.
// ---------------------------------------------------------------------------

describe('toLedgerRow sink validation — SEC-1 / PF-023', () => {
  const formatModule = require(
    path.join(ROOT, 'src/assets/scripts/hooks/lib/decisions-format.cjs')
  ) as {
    toLedgerRow: (
      obs: Record<string, unknown>,
      opts: { anchorId: string; status: string; date?: string; expectType?: string }
    ) => Record<string, unknown>;
    isSafeRawBody: (body: unknown, anchorId: string) => boolean;
  };
  const { toLedgerRow, isSafeRawBody } = formatModule;

  // --- pattern newline collapse ---

  it('pattern containing \\n collapses to a single line, preventing forged Status lines', () => {
    // A newline in pattern would emit '- **Status**: Forged\n' above the real Status
    // line inside formatDecisionBody. The line-anchored /^- \*\*Status\*\*:/m regex
    // would match the FIRST occurrence — the forged one. Collapsing at toLedgerRow
    // prevents this class of heading/field injection (PF-023 sink).
    const obs = {
      id: 'obs_sec1_pat',
      type: 'decision',
      pattern: 'Use Result types\n- **Status**: Retired',
      details: 'context: x; decision: y; rationale: z',
    };
    const row = toLedgerRow(obs, { anchorId: 'ADR-001', status: 'Accepted', date: '2026-01-01' });
    // Newline must be collapsed — no embedded newline in the stored pattern
    expect(String(row.pattern)).not.toContain('\n');
  });

  it('pattern newline collapse prevents Status hijacking end-to-end through buildIndexContent', () => {
    // End-to-end: a pattern containing '\\n- **Status**: Retired' would — WITHOUT the
    // newline collapse — forge a '- **Status**: Retired' line ABOVE the real status line in
    // the rendered block, so the line-anchored /^- \*\*Status\*\*:/m regex would match it
    // first and report [Retired] in the index. After sink validation the newline is
    // collapsed so the Status field is no longer forged as a new line.
    const obs = {
      id: 'obs_sec1_e2e',
      type: 'decision',
      pattern: 'Good pattern\n- **Status**: Retired',
      details: 'context: a; decision: b; rationale: c',
    };
    const row = toLedgerRow(obs, { anchorId: 'ADR-042', status: 'Accepted', date: '2026-01-01' });
    const idx = buildIndexContent([row], [], {
      decisionsFilePath: '/decisions.md',
      pitfallsFilePath: '/pitfalls.md',
    });
    // The status TAG must be [Accepted] — the forged status line was neutralised.
    // The word 'Retired' may still appear as part of the collapsed pattern title (that
    // is fine — the injection vector was the forged line-start `- **Status**: …`, not
    // the title text), but it must never appear as the status tag [Retired].
    expect(idx).toContain('[Accepted]');
    expect(idx).not.toContain('[Retired]');
  });

  // --- raw_body second heading dropped ---

  it('raw_body with a second heading is dropped; entry renders through the sanitised formatter', () => {
    // A raw_body containing two ## headings could forge an index entry under
    // a different ADR number. isSafeRawBody rejects it; the row then renders
    // through formatDecisionBody which only emits the real anchor_id heading.
    const obs = {
      id: 'obs_sec1_rb_dbl',
      type: 'decision',
      pattern: 'Some pattern',
      details: '',
      raw_body: '\n## ADR-001: Real title\n\n## ADR-002: Forged entry\n\n- **Status**: Accepted\n',
    };
    const row = toLedgerRow(obs, { anchorId: 'ADR-001', status: 'Accepted', date: '2026-01-01' });
    // raw_body must be absent — dropped because it contained two headings
    expect(row.raw_body).toBeUndefined();
  });

  it('raw_body with a mismatched anchor heading is dropped', () => {
    // A raw_body claiming a different anchor ID could relocate the entry to an
    // incorrect position in the rendered corpus. isSafeRawBody rejects it.
    const obs = {
      id: 'obs_sec1_rb_mis',
      type: 'decision',
      pattern: 'Pattern',
      details: '',
      raw_body: '\n## ADR-999: Hijacked title\n\n- **Status**: Accepted\n',
    };
    const row = toLedgerRow(obs, { anchorId: 'ADR-001', status: 'Accepted', date: '2026-01-01' });
    expect(row.raw_body).toBeUndefined();
  });

  it('raw_body with exactly one heading matching the anchor is preserved', () => {
    // Positive case: a safe raw_body passes isSafeRawBody and is kept in the row.
    const safeBody = '\n## ADR-001: Real title\n\n- **Status**: Accepted\n';
    const obs = {
      id: 'obs_sec1_rb_safe',
      type: 'decision',
      pattern: 'Real title',
      details: '',
      raw_body: safeBody,
    };
    const row = toLedgerRow(obs, { anchorId: 'ADR-001', status: 'Accepted', date: '2026-01-01' });
    expect(row.raw_body).toBe(safeBody);
  });

  // --- expectType mismatch throws ---

  it('expectType mismatch throws with a message naming the anchor and both types', () => {
    // The type guard prevents a log row whose type was changed from re-projecting
    // a PF-NNN entry into decisions.md (or vice versa), corrupting the corpus.
    const obs = {
      id: 'obs_sec1_type',
      type: 'pitfall',   // log says pitfall
      pattern: 'Some pattern',
      details: '',
    };
    expect(() =>
      toLedgerRow(obs, { anchorId: 'ADR-001', status: 'Accepted', expectType: 'decision' })
    ).toThrow(/type mismatch/);
    expect(() =>
      toLedgerRow(obs, { anchorId: 'ADR-001', status: 'Accepted', expectType: 'decision' })
    ).toThrow(/ADR-001/);
  });

  // --- isSafeRawBody direct unit tests ---

  describe('isSafeRawBody', () => {
    it('returns false for non-string', () => {
      expect(isSafeRawBody(null, 'ADR-001')).toBe(false);
      expect(isSafeRawBody(42, 'ADR-001')).toBe(false);
    });

    it('returns false for body with zero headings', () => {
      expect(isSafeRawBody('no heading here', 'ADR-001')).toBe(false);
    });

    it('returns false for body with two headings', () => {
      const body = '## ADR-001: First\n\n## ADR-002: Second\n';
      expect(isSafeRawBody(body, 'ADR-001')).toBe(false);
    });

    it('returns false when the single heading does not match anchorId', () => {
      const body = '## ADR-999: Wrong anchor\n';
      expect(isSafeRawBody(body, 'ADR-001')).toBe(false);
    });

    it('returns true for exactly one matching heading', () => {
      const body = '\n## ADR-001: Correct title\n\n- **Status**: Accepted\n';
      expect(isSafeRawBody(body, 'ADR-001')).toBe(true);
    });

    it('works for PF anchors', () => {
      const body = '\n## PF-023: Correct pitfall\n\n- **Status**: Active\n';
      expect(isSafeRawBody(body, 'PF-023')).toBe(true);
      expect(isSafeRawBody(body, 'PF-001')).toBe(false);
    });
  });
});
