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

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const {
  initDecisionsContent,
  formatDecisionBody,
  formatPitfallBody,
  buildTldrLine,
  buildIndexContent,
} = require(path.join(ROOT, 'src/assets/scripts/hooks/lib/decisions-format.cjs')) as {
  initDecisionsContent: (kind: 'decision' | 'pitfall') => string;
  formatDecisionBody: (row: Record<string, unknown>) => string;
  formatPitfallBody: (row: Record<string, unknown>) => string;
  buildTldrLine: (kind: 'decisions' | 'pitfalls', rows: Record<string, unknown>[]) => string;
  buildIndexContent: (
    activeDecisionRows: Record<string, unknown>[],
    activePitfallRows: Record<string, unknown>[],
    opts: { decisionsFilePath: string; pitfallsFilePath: string }
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
  decisionsFilePath: '/project/.devflow/decisions/decisions.md',
  pitfallsFilePath:  '/project/.devflow/decisions/pitfalls.md',
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
    details: 'area: scripts/hooks/; issue: overwritten on reinstall; impact: lost; resolution: rebuild',
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
    expect(result).toContain('scripts/hooks/');
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
      details: 'area: scripts/hooks/; issue: changes overwritten on reinstall; impact: lost changes; resolution: edit source + rebuild',
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
// not test LLM judgment — that is validated by the Tester agent via scenarios.
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
