// tests/decisions/decisions-format.test.ts
//
// Byte-compat tests for the shared format helpers in decisions-format.cjs.
// These helpers are the single source of truth for the output format of
// decisions.md and pitfalls.md entries.  Every assertion here locks a
// byte-level contract — any change to the output strings must be deliberate
// and propagated to all consumers (session-start-context, decisions-index,
// apply-decisions, decisions-usage-scan, render-decisions).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const {
  initDecisionsContent,
  formatDecisionBody,
  formatPitfallBody,
  buildTldrLine,
} = require(path.join(ROOT, 'scripts/hooks/lib/decisions-format.cjs')) as {
  initDecisionsContent: (kind: 'decision' | 'pitfall') => string;
  formatDecisionBody: (row: Record<string, unknown>) => string;
  formatPitfallBody: (row: Record<string, unknown>) => string;
  buildTldrLine: (kind: 'decisions' | 'pitfalls', rows: Record<string, unknown>[]) => string;
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

  it('matches byte-compat strings produced by decisions-append for a real example', () => {
    // This golden string matches what decisions-append would write for this obs.
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
      details: 'area: scripts/hooks/; issue: edits to installed copies; impact: silently overwritten; resolution: edit source + rebuild + reinstall',
    };
    const result = formatPitfallBody(row);

    expect(result).toMatch(/^\n## PF-007: Editing installed hook scripts directly\n\n/);
    expect(result).toContain('- **Area**: scripts/hooks/\n');
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

  it('empty corpus: count is 0, Key is empty string', () => {
    const result = buildTldrLine('decisions', []);
    expect(result).toBe('<!-- TL;DR: 0 decisions. Key:  -->');
  });

  it('Key uses comma+space separator (AC-A5)', () => {
    const rows = [{ anchor_id: 'ADR-001' }, { anchor_id: 'ADR-002' }];
    const result = buildTldrLine('decisions', rows);
    expect(result).toContain('ADR-001, ADR-002');
  });
});

// ---------------------------------------------------------------------------
// json-helper.cjs byte-compat: decisions-append still delegates correctly
// ---------------------------------------------------------------------------
// We verify this by running decisions-append via the CLI and checking the
// output matches what formatDecisionBody/formatPitfallBody would produce.
// This ensures json-helper.cjs delegates to decisions-format.cjs correctly.

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

const JSON_HELPER = path.join(ROOT, 'scripts/hooks/json-helper.cjs');

describe('json-helper.cjs decisions-append delegates to decisions-format', () => {
  it('decision entry in written .md matches formatDecisionBody output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-compat-test-'));
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
    const decisionsFile = path.join(decisionsDir, 'decisions.md');

    const obs = JSON.stringify({
      id: 'obs_formattest1',
      type: 'decision',
      pattern: 'Use immutable data structures',
      confidence: 0.9,
      observations: 1,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-01T00:00:00Z',
      status: 'ready',
      evidence: [],
      details: 'context: all state; decision: always return new objects; rationale: no mutation bugs',
      quality_ok: true,
    });

    try {
      execSync(`node "${JSON_HELPER}" decisions-append "${decisionsFile}" decision '${obs}'`, {
        encoding: 'utf8',
      });

      const written = fs.readFileSync(decisionsFile, 'utf8');
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

  it('pitfall entry in written .md matches formatPitfallBody output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-compat-pf-test-'));
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
    const pitfallsFile = path.join(decisionsDir, 'pitfalls.md');

    const obs = JSON.stringify({
      id: 'obs_pfformattest1',
      type: 'pitfall',
      pattern: 'Editing installed files directly',
      confidence: 0.95,
      observations: 2,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-02T00:00:00Z',
      status: 'ready',
      evidence: [],
      details: 'area: scripts/hooks/; issue: changes overwritten on reinstall; impact: lost changes; resolution: edit source + rebuild',
      quality_ok: true,
    });

    try {
      execSync(`node "${JSON_HELPER}" decisions-append "${pitfallsFile}" pitfall '${obs}'`, {
        encoding: 'utf8',
      });

      const written = fs.readFileSync(pitfallsFile, 'utf8');
      // Heading format
      expect(written).toContain('\n## PF-001: Editing installed files directly\n');
      // Area present, NO Date
      expect(written).toContain('- **Area**: scripts/hooks/');
      expect(written).not.toContain('**Date**');
      // Status
      expect(written).toContain('- **Status**: Active\n');
      // Source
      expect(written).toContain('- **Source**: self-learning:obs_pfformattest1\n');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
