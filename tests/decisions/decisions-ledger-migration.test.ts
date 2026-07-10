// tests/decisions/decisions-ledger-migration.test.ts
//
// Tests for Phase 4: preserve-verbatim ledger migration + two-file gitignore split.
//
// AC-F8  Migration preserves every existing body verbatim (raw_body), synthesizes
//        ADR-001, marks hand-deletions Retired (not resurrected), preserves
//        ADR-016's amendment; idempotent on re-run.
// AC-F11 Committed: anchored ledger + rendered .md. Gitignored: raw log + archive.
// AC-F3  decisions.md/pitfalls.md byte-reproducible from the ledger
//        (verify migrated render is byte-identical except TL;DR Key).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';
import { migrateDecisionsLedger, renderDecisionsIndex } from '../../src/cli/utils/decisions-ledger-migration.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const RENDERER_PATH = path.join(ROOT, 'scripts/hooks/lib/render-decisions.cjs');

const { renderDecisionsFile } = require(RENDERER_PATH) as {
  renderDecisionsFile: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => string;
};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Strip only the TL;DR Key list from a content string, normalising it to an
 * empty Key for byte comparison (the Key list changes but nothing else should).
 */
function stripTldrKey(content: string): string {
  return content.replace(/<!-- TL;DR: \d+ (?:decisions|pitfalls)\. Key: [^>]*-->/, (m) =>
    m.replace(/Key: [^>]*/, 'Key: '),
  );
}

/**
 * Build a minimal decisions.md with one or more entries.
 */
function buildDecisionsContent(entries: string[]): string {
  const header = `<!-- TL;DR: ${entries.length} decisions. Key: -->\n# Architectural Decisions\n\nAppend-only. Status changes allowed; deletions prohibited.\n`;
  return header + entries.join('');
}

/**
 * Build a minimal pitfalls.md with one or more entries.
 */
function buildPitfallsContent(entries: string[]): string {
  const header = `<!-- TL;DR: ${entries.length} pitfalls. Key: -->\n# Known Pitfalls\n\nArea-specific gotchas, fragile areas, and past bugs.\n`;
  return header + entries.join('');
}

// ---------------------------------------------------------------------------
// Shared fixture: the live-drift scenario
//
// Reproduces the key data patterns from the live decisions-log.jsonl:
//   - seed rows (created + artifact_path#ANCHOR): obs_known1 → ADR-001 (in .md)
//   - seed rows (created + artifact_path#ANCHOR): obs_deleted1 → ADR-002 (absent from .md)
//   - merge rows (first_seen/observations, no anchor): obs_merge1 → ADR-003 (Source in .md)
//   - a Source-absent entry → ADR-004 (synthesize obs_migrated_adr_004)
//   - amendment entry → ADR-005 (with an Amendment line in .md)
//   - observing-only row → never anchored (stays in log)
//   - pitfall: obs_pf_known1 → PF-001 (in .md)
//   - pitfall: obs_pf_deleted1 → PF-002 (absent from .md → Retired)
// ---------------------------------------------------------------------------

const DECISION_BODY_ADR001 = `
## ADR-001: Clean break philosophy

- **Date**: 2026-05-06
- **Status**: Accepted
- **Context**: Some context here.
- **Decision**: The decision text.
- **Consequences**: Some consequences.
- **Source**: self-learning:obs_c9d3m1
`;

const DECISION_BODY_ADR003 = `
## ADR-003: Track decisions in git

- **Date**: 2026-06-01
- **Status**: Accepted
- **Context**: Context for ADR-003.
- **Decision**: Decision for ADR-003.
- **Consequences**: Consequences for ADR-003.
- **Source**: self-learning:obs_merge1
`;

const DECISION_BODY_ADR004_NO_SOURCE = `
## ADR-004: Something without source

- **Date**: 2026-06-02
- **Status**: Accepted
- **Context**: Context without source.
- **Decision**: Decision without source.
- **Consequences**: Consequences.
`;

// ADR-005 with an Amendment line (models ADR-016 in live data)
const DECISION_BODY_ADR005_WITH_AMENDMENT = `
## ADR-005: Decision with amendment

- **Date**: 2026-06-03
- **Status**: Accepted
- **Context**: Original context.
- **Decision**: Original decision.
- **Consequences**: Original consequences.
- **Source**: self-learning:obs_amend1
- **Amendment (2026-06-07, PR #239)**: Memory is no longer a Dream task — superseded to this extent.
`;

const PITFALL_BODY_PF001 = `
## PF-001: A known pitfall

- **Area**: some area
- **Issue**: issue description
- **Impact**: impact description
- **Resolution**: resolution
- **Status**: Active
- **Source**: self-learning:obs_pf_known1
`;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let projectRoot: string;
let decisionsDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-ledger-migration-test-'));
  projectRoot = path.join(tmpDir, 'project');
  decisionsDir = path.join(projectRoot, '.devflow', 'decisions');
  await fs.mkdir(decisionsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Main golden test: reproduces live-data drift scenario
// ---------------------------------------------------------------------------

describe('migrateDecisionsLedger — golden', () => {
  it('anchors all .md entries with verbatim raw_body and marks hand-deletions as Retired', async () => {
    // --- Arrange ---
    const decisionsContent = buildDecisionsContent([
      DECISION_BODY_ADR001,   // Source obs_c9d3m1 NOT in log → synthesize
      DECISION_BODY_ADR003,   // Source obs_merge1 IS in log
      DECISION_BODY_ADR004_NO_SOURCE,  // No Source → obs_migrated_adr_004
      DECISION_BODY_ADR005_WITH_AMENDMENT, // Source obs_amend1 IS in log, has amendment
    ]);
    const pitfallsContent = buildPitfallsContent([PITFALL_BODY_PF001]);

    // decisions-log.jsonl:
    // - obs_c9d3m1 is NOT here (ADR-001 synthesis case)
    // - obs_merge1 IS here (with first_seen/observations shape)
    // - obs_deleted1 has artifact_path#ADR-002 but ADR-002 is NOT in .md (hand-delete)
    // - obs_pf_known1 IS here (pitfall)
    // - obs_pf_deleted1 has artifact_path#PF-002 but PF-002 is NOT in .md (hand-delete)
    // - obs_amend1 IS here
    // - obs_observing1 is observing-only (no anchor_id, status: observing)
    const logRows = [
      {
        id: 'obs_merge1',
        type: 'decision',
        pattern: 'Track decisions in git',
        first_seen: '2026-06-01T10:00:00Z',
        last_seen: '2026-06-01T10:00:00Z',
        observations: 1,
        status: 'created',
        details: 'area: decisions; issue: x',
      },
      {
        id: 'obs_deleted1',
        type: 'decision',
        pattern: 'Migrations must leave a clean house',
        status: 'created',
        created: '2026-05-19T14:23:29.773Z',
        artifact_path: path.join(decisionsDir, 'decisions.md#ADR-002'),
      },
      {
        id: 'obs_pf_known1',
        type: 'pitfall',
        pattern: 'A known pitfall',
        first_seen: '2026-06-01T00:00:00Z',
        last_seen: '2026-06-01T00:00:00Z',
        observations: 1,
        status: 'created',
        details: 'area: some area; issue: issue description',
      },
      {
        id: 'obs_pf_deleted1',
        type: 'pitfall',
        pattern: 'Another deleted pitfall',
        status: 'created',
        created: '2026-05-23T00:00:00Z',
        artifact_path: path.join(decisionsDir, 'pitfalls.md#PF-002'),
      },
      {
        id: 'obs_amend1',
        type: 'decision',
        pattern: 'Decision with amendment',
        first_seen: '2026-06-03T00:00:00Z',
        last_seen: '2026-06-03T00:00:00Z',
        observations: 1,
        status: 'created',
        details: 'context: original; decision: original; rationale: original',
      },
      {
        id: 'obs_observing1',
        type: 'decision',
        pattern: 'Observing only',
        first_seen: '2026-06-09T00:00:00Z',
        last_seen: '2026-06-09T00:00:00Z',
        observations: 1,
        status: 'observing',
        details: 'just observing',
      },
    ];

    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), decisionsContent, 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), pitfallsContent, 'utf-8');
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      logRows.map(r => JSON.stringify(r)).join('\n') + '\n',
      'utf-8',
    );

    // --- Act ---
    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    // --- Assert: result counts ---
    // anchored: obs_merge1 (ADR-003) + obs_pf_known1 (PF-001) + obs_amend1 (ADR-005) = 3
    expect(result.anchored).toBe(3);
    // synthesized: obs_c9d3m1 (ADR-001) + obs_migrated_adr_004 (ADR-004) = 2
    expect(result.synthesized).toBe(2);
    // retired: ADR-002 (obs_deleted1) + PF-002 (obs_pf_deleted1) = 2
    expect(result.retired).toBe(2);
    // warnings: 1 for ADR-004 no-Source
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/No Source marker for ADR-004/);

    // --- Assert: ledger file exists and contains expected rows ---
    const ledgerPath = path.join(decisionsDir, 'decisions-ledger.jsonl');
    const ledgerRaw = await fs.readFile(ledgerPath, 'utf-8');
    const ledgerRows = ledgerRaw.split('\n').filter(Boolean).map(l => JSON.parse(l));

    // (a) Ledger contains anchored rows for every .md entry
    const anchors = ledgerRows.map((r: { anchor_id?: string }) => r.anchor_id);
    expect(anchors).toContain('ADR-001');
    expect(anchors).toContain('ADR-003');
    expect(anchors).toContain('ADR-004');
    expect(anchors).toContain('ADR-005');
    expect(anchors).toContain('PF-001');

    // (b) ADR-001 is synthesized (id = obs_c9d3m1)
    const adr001Row = ledgerRows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-001');
    expect(adr001Row).toBeTruthy();
    expect(adr001Row.id).toBe('obs_c9d3m1');
    expect(adr001Row.decisions_status).toBe('Accepted');

    // (c) Hand-deleted anchors: ADR-002 and PF-002 present in ledger as Retired
    const adr002Row = ledgerRows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-002');
    expect(adr002Row).toBeTruthy();
    expect(adr002Row.decisions_status).toBe('Retired');

    const pf002Row = ledgerRows.find((r: { anchor_id?: string }) => r.anchor_id === 'PF-002');
    expect(pf002Row).toBeTruthy();
    expect(pf002Row.decisions_status).toBe('Retired');

    // (d) Observing-only row NOT in ledger
    const observingRow = ledgerRows.find((r: { id?: string }) => r.id === 'obs_observing1');
    expect(observingRow).toBeUndefined();

    // (e) Amendment captured in amendments[] AND in raw_body
    const adr005Row = ledgerRows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-005');
    expect(adr005Row).toBeTruthy();
    expect(adr005Row.amendments).toBeTruthy();
    expect(adr005Row.amendments.length).toBeGreaterThan(0);
    expect(adr005Row.amendments[0].note).toContain('Memory is no longer a Dream task');
    expect(adr005Row.raw_body).toContain('Amendment (2026-06-07, PR #239)');

    // (f) raw_body is verbatim for each entry
    const adr001BodyInLedger: string = adr001Row.raw_body;
    expect(adr001BodyInLedger).toContain('## ADR-001: Clean break philosophy');
    expect(adr001BodyInLedger).toContain('self-learning:obs_c9d3m1');
    expect(adr001BodyInLedger.startsWith('\n## ADR-001')).toBe(true);

    // (g) Re-rendered decisions.md and pitfalls.md are written
    const renderedDecisions = await fs.readFile(path.join(decisionsDir, 'decisions.md'), 'utf-8');
    const renderedPitfalls = await fs.readFile(path.join(decisionsDir, 'pitfalls.md'), 'utf-8');

    // Retired entries (ADR-002, PF-002) are absent from rendered .md
    expect(renderedDecisions).not.toContain('ADR-002');
    expect(renderedPitfalls).not.toContain('PF-002');

    // Active entries are present
    expect(renderedDecisions).toContain('ADR-001');
    expect(renderedDecisions).toContain('ADR-003');
    expect(renderedDecisions).toContain('ADR-004');
    expect(renderedDecisions).toContain('ADR-005');
    expect(renderedPitfalls).toContain('PF-001');

    // (h) Body content is byte-verbatim (strip TL;DR Key for comparison)
    const originalDecisionsStripped = stripTldrKey(decisionsContent);
    const renderedDecisionsStripped = stripTldrKey(renderedDecisions);
    // Each section body should be present in the re-rendered output
    expect(renderedDecisionsStripped).toContain(stripTldrKey(DECISION_BODY_ADR001).trim());
    expect(renderedDecisionsStripped).toContain(stripTldrKey(DECISION_BODY_ADR003).trim());
    expect(renderedDecisionsStripped).toContain(stripTldrKey(DECISION_BODY_ADR004_NO_SOURCE).trim());
    expect(renderedDecisionsStripped).toContain(stripTldrKey(DECISION_BODY_ADR005_WITH_AMENDMENT).trim());
    // Observing kept count
    expect(result.observingKept).toBe(1);
  });

  it('is idempotent — running a second time produces no new rows', async () => {
    const decisionsContent = buildDecisionsContent([DECISION_BODY_ADR001]);
    const pitfallsContent = buildPitfallsContent([PITFALL_BODY_PF001]);
    const logRows = [
      {
        id: 'obs_pf_known1',
        type: 'pitfall',
        pattern: 'A known pitfall',
        first_seen: '2026-06-01T00:00:00Z',
        last_seen: '2026-06-01T00:00:00Z',
        observations: 1,
        status: 'created',
      },
    ];
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), decisionsContent, 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), pitfallsContent, 'utf-8');
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      logRows.map(r => JSON.stringify(r)).join('\n') + '\n',
      'utf-8',
    );

    // First run
    const r1 = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });
    expect(r1.anchored + r1.synthesized + r1.retired).toBeGreaterThan(0);

    const ledgerAfterFirst = await fs.readFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'), 'utf-8',
    );

    // Second run
    const r2 = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });
    expect(r2.anchored).toBe(0);
    expect(r2.synthesized).toBe(0);
    expect(r2.retired).toBe(0);

    // Ledger content is unchanged
    const ledgerAfterSecond = await fs.readFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'), 'utf-8',
    );
    expect(ledgerAfterSecond).toBe(ledgerAfterFirst);
  });

  it('re-renders .md from ledger even when newRowsAdded === 0 (crash-window heal)', async () => {
    // Simulates a crash that occurred BETWEEN the atomic ledger write and the
    // subsequent renderAndWriteAll call in a prior run. The ledger is complete
    // but decisions.md / pitfalls.md are stale (missing or wrong). A re-run
    // should detect newRowsAdded === 0 yet still re-render the .md files so
    // they are reconciled with the committed ledger.

    // --- Arrange: build the ledger directly as if a prior run wrote it ---
    const adr001LedgerRow = {
      id: 'obs_c9d3m1',
      type: 'decision',
      pattern: 'Clean break philosophy',
      status: 'created',
      anchor_id: 'ADR-001',
      decisions_status: 'Accepted',
      date: '2026-05-06',
      raw_body: DECISION_BODY_ADR001,
    };
    const pf001LedgerRow = {
      id: 'obs_pf_known1',
      type: 'pitfall',
      pattern: 'A known pitfall',
      status: 'created',
      anchor_id: 'PF-001',
      decisions_status: 'Active',
      raw_body: PITFALL_BODY_PF001,
    };

    // Write the ledger as if a prior run succeeded
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'),
      [adr001LedgerRow, pf001LedgerRow].map(r => JSON.stringify(r)).join('\n') + '\n',
      'utf-8',
    );

    // Write the original .md files (the source that was used in the prior run)
    await fs.writeFile(
      path.join(decisionsDir, 'decisions.md'),
      buildDecisionsContent([DECISION_BODY_ADR001]),
      'utf-8',
    );
    await fs.writeFile(
      path.join(decisionsDir, 'pitfalls.md'),
      buildPitfallsContent([PITFALL_BODY_PF001]),
      'utf-8',
    );

    // Simulate stale .md: overwrite decisions.md with wrong/stale content and
    // delete pitfalls.md entirely — mimicking what a crash between ledger write
    // and renderAndWriteAll would leave behind.
    await fs.writeFile(
      path.join(decisionsDir, 'decisions.md'),
      '<!-- STALE: crash left this behind -->\n',
      'utf-8',
    );
    await fs.rm(path.join(decisionsDir, 'pitfalls.md'), { force: true });

    // Log: same anchors as the ledger so newRowsAdded will be 0
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      JSON.stringify({ id: 'obs_c9d3m1', type: 'decision', pattern: 'Clean break philosophy', status: 'created', first_seen: '2026-05-06T00:00:00Z' }) + '\n' +
      JSON.stringify({ id: 'obs_pf_known1', type: 'pitfall', pattern: 'A known pitfall', status: 'created', first_seen: '2026-06-01T00:00:00Z' }) + '\n',
      'utf-8',
    );

    // --- Act: run migration; the ledger already has all anchors so newRowsAdded === 0 ---
    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    // --- Assert: counts reflect idempotency (nothing new added) ---
    expect(result.anchored).toBe(0);
    expect(result.synthesized).toBe(0);
    expect(result.retired).toBe(0);

    // --- Assert: .md files are now reconciled with the committed ledger ---
    const renderedDecisions = await fs.readFile(path.join(decisionsDir, 'decisions.md'), 'utf-8');
    const renderedPitfalls = await fs.readFile(path.join(decisionsDir, 'pitfalls.md'), 'utf-8');

    // decisions.md must contain ADR-001 (from the ledger), NOT the stale content
    expect(renderedDecisions).not.toContain('STALE: crash left this behind');
    expect(renderedDecisions).toContain('ADR-001');
    expect(renderedDecisions).toContain('Clean break philosophy');

    // pitfalls.md must exist and contain PF-001 (was deleted by the simulated crash)
    expect(renderedPitfalls).toContain('PF-001');
    expect(renderedPitfalls).toContain('A known pitfall');

    // Ledger itself must be unchanged (re-render must not rewrite the ledger)
    const ledgerAfterRun = await fs.readFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'), 'utf-8',
    );
    const ledgerRows = ledgerAfterRun.split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows[0].anchor_id).toBe('ADR-001');
    expect(ledgerRows[1].anchor_id).toBe('PF-001');
  });
});

// ---------------------------------------------------------------------------
// AC-F8: ADR-001 synthesis case (Source obs absent from log)
// ---------------------------------------------------------------------------

describe('migrateDecisionsLedger — synthesis', () => {
  it('synthesizes a ledger row for an .md entry whose Source obs is not in the log', async () => {
    const decisionsContent = buildDecisionsContent([DECISION_BODY_ADR001]);
    // Log is empty — obs_c9d3m1 not in log
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), decisionsContent, 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([]), 'utf-8');

    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    expect(result.synthesized).toBe(1);
    expect(result.anchored).toBe(0);

    const ledgerPath = path.join(decisionsDir, 'decisions-ledger.jsonl');
    const rows = (await fs.readFile(ledgerPath, 'utf-8'))
      .split('\n').filter(Boolean).map(l => JSON.parse(l));

    const adr001 = rows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-001');
    expect(adr001).toBeTruthy();
    expect(adr001.id).toBe('obs_c9d3m1');
    expect(adr001.raw_body).toContain('## ADR-001: Clean break philosophy');
    expect(adr001.decisions_status).toBe('Accepted');
    expect(adr001.date).toBe('2026-05-06');
  });
});

// ---------------------------------------------------------------------------
// AC-F8: ADR-016 amendment preservation
// ---------------------------------------------------------------------------

describe('migrateDecisionsLedger — amendments', () => {
  it('captures amendments[] from the .md body AND preserves them in raw_body verbatim', async () => {
    const decisionsContent = buildDecisionsContent([DECISION_BODY_ADR005_WITH_AMENDMENT]);
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), decisionsContent, 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([]), 'utf-8');
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      JSON.stringify({ id: 'obs_amend1', type: 'decision', pattern: 'Decision with amendment', status: 'created', first_seen: '2026-06-03T00:00:00Z' }) + '\n',
      'utf-8',
    );

    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    expect(result.anchored).toBe(1);

    const ledgerPath = path.join(decisionsDir, 'decisions-ledger.jsonl');
    const rows = (await fs.readFile(ledgerPath, 'utf-8'))
      .split('\n').filter(Boolean).map(l => JSON.parse(l));

    const adr005 = rows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-005');
    expect(adr005).toBeTruthy();
    // amendments[] captures the structured amendment data
    expect(Array.isArray(adr005.amendments)).toBe(true);
    expect(adr005.amendments.length).toBe(1);
    expect(adr005.amendments[0].date).toContain('2026-06-07');
    expect(adr005.amendments[0].note).toContain('Memory is no longer a Dream task');
    // raw_body still contains the amendment line verbatim
    expect(adr005.raw_body).toContain('Amendment (2026-06-07, PR #239)');
    expect(adr005.raw_body).toContain('Memory is no longer a Dream task');
  });
});

// ---------------------------------------------------------------------------
// AC-F8: Hand-deletion (Retired) — numbers reserved, not resurrected into .md
// ---------------------------------------------------------------------------

describe('migrateDecisionsLedger — hand-deletions', () => {
  it('marks log rows with artifact_path#ANCHOR absent from .md as Retired, not in .md', async () => {
    // decisions.md has only ADR-001; decisions-log.jsonl also has obs_deleted2 → ADR-002
    const decisionsContent = buildDecisionsContent([DECISION_BODY_ADR001]);
    const pitfallsContent = buildPitfallsContent([PITFALL_BODY_PF001]);
    const logRows = [
      // Hand-deleted: anchor ADR-002 in artifact_path but absent from .md
      {
        id: 'obs_deleted2',
        type: 'decision',
        pattern: 'Deleted decision',
        status: 'created',
        created: '2026-05-20T00:00:00Z',
        artifact_path: path.join(decisionsDir, 'decisions.md#ADR-002'),
      },
      // Hand-deleted pitfall: PF-003 absent from .md
      {
        id: 'obs_pf_deleted2',
        type: 'pitfall',
        pattern: 'Deleted pitfall',
        status: 'created',
        created: '2026-05-20T00:00:00Z',
        artifact_path: path.join(decisionsDir, 'pitfalls.md#PF-003'),
      },
      // This one IS in .md → should NOT be retired
      {
        id: 'obs_pf_known1',
        type: 'pitfall',
        pattern: 'A known pitfall',
        status: 'created',
        first_seen: '2026-06-01T00:00:00Z',
      },
    ];

    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), decisionsContent, 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), pitfallsContent, 'utf-8');
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      logRows.map(r => JSON.stringify(r)).join('\n') + '\n',
      'utf-8',
    );

    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    expect(result.retired).toBe(2);

    const ledgerPath = path.join(decisionsDir, 'decisions-ledger.jsonl');
    const rows = (await fs.readFile(ledgerPath, 'utf-8'))
      .split('\n').filter(Boolean).map(l => JSON.parse(l));

    // ADR-002 and PF-003 are in ledger as Retired
    const adr002 = rows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-002');
    expect(adr002).toBeTruthy();
    expect(adr002.decisions_status).toBe('Retired');

    const pf003 = rows.find((r: { anchor_id?: string }) => r.anchor_id === 'PF-003');
    expect(pf003).toBeTruthy();
    expect(pf003.decisions_status).toBe('Retired');

    // Retired entries are NOT in the rendered .md
    const renderedDecisions = await fs.readFile(path.join(decisionsDir, 'decisions.md'), 'utf-8');
    const renderedPitfalls = await fs.readFile(path.join(decisionsDir, 'pitfalls.md'), 'utf-8');
    expect(renderedDecisions).not.toContain('ADR-002');
    expect(renderedPitfalls).not.toContain('PF-003');

    // Active entries are present
    expect(renderedDecisions).toContain('ADR-001');
    expect(renderedPitfalls).toContain('PF-001');
  });
});

// ---------------------------------------------------------------------------
// AC-F3: byte-compat round-trip
// ---------------------------------------------------------------------------

describe('migrateDecisionsLedger — byte-compat round-trip', () => {
  it('re-rendered .md is byte-identical to original except TL;DR Key', async () => {
    const decisionsContent = buildDecisionsContent([
      DECISION_BODY_ADR001,
      DECISION_BODY_ADR003,
    ]);
    const pitfallsContent = buildPitfallsContent([PITFALL_BODY_PF001]);

    const logRows = [
      {
        id: 'obs_c9d3m1',
        type: 'decision',
        pattern: 'Clean break philosophy',
        status: 'observing', // not created, to force synthesize path
        first_seen: '2026-05-06T00:00:00Z',
      },
      {
        id: 'obs_merge1',
        type: 'decision',
        pattern: 'Track decisions in git',
        first_seen: '2026-06-01T00:00:00Z',
        last_seen: '2026-06-01T00:00:00Z',
        observations: 1,
        status: 'created',
        details: 'area: decisions',
      },
      {
        id: 'obs_pf_known1',
        type: 'pitfall',
        pattern: 'A known pitfall',
        first_seen: '2026-06-01T00:00:00Z',
        status: 'created',
        details: 'area: some area',
      },
    ];

    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), decisionsContent, 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), pitfallsContent, 'utf-8');
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      logRows.map(r => JSON.stringify(r)).join('\n') + '\n',
      'utf-8',
    );

    await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    const renderedDecisions = await fs.readFile(path.join(decisionsDir, 'decisions.md'), 'utf-8');
    const renderedPitfalls = await fs.readFile(path.join(decisionsDir, 'pitfalls.md'), 'utf-8');

    // Byte-identical except TL;DR Key
    expect(stripTldrKey(renderedDecisions)).toBe(stripTldrKey(decisionsContent));
    expect(stripTldrKey(renderedPitfalls)).toBe(stripTldrKey(pitfallsContent));
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('migrateDecisionsLedger — edge cases', () => {
  it('is a no-op when decisionsDir does not exist', async () => {
    const emptyRoot = path.join(tmpDir, 'empty-project');
    await fs.mkdir(emptyRoot, { recursive: true });

    const result = await migrateDecisionsLedger(emptyRoot, { rendererPath: RENDERER_PATH });

    expect(result.anchored).toBe(0);
    expect(result.synthesized).toBe(0);
    expect(result.retired).toBe(0);
  });

  it('handles missing decisions.md (only pitfalls.md exists)', async () => {
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([PITFALL_BODY_PF001]), 'utf-8');
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      JSON.stringify({ id: 'obs_pf_known1', type: 'pitfall', pattern: 'A known pitfall', status: 'created', first_seen: '2026-06-01T00:00:00Z' }) + '\n',
      'utf-8',
    );

    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    expect(result.anchored).toBe(1); // PF-001 anchored from pitfalls.md
    expect(result.synthesized).toBe(0);
  });

  it('handles missing decisions-log.jsonl (only .md files exist)', async () => {
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), buildDecisionsContent([DECISION_BODY_ADR001]), 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([]), 'utf-8');
    // No decisions-log.jsonl

    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    // ADR-001 has Source obs_c9d3m1 but no log → synthesized
    expect(result.synthesized).toBe(1);
    expect(result.anchored).toBe(0);
  });

  it('generates obs_migrated_{anchor} for an .md entry with no Source marker', async () => {
    const noSourceBody = `
## ADR-009: Decision with no source

- **Date**: 2026-06-01
- **Status**: Accepted
- **Context**: Some context.
- **Decision**: Some decision.
- **Consequences**: Some consequences.
`;
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), buildDecisionsContent([noSourceBody]), 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([]), 'utf-8');

    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    expect(result.synthesized).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/No Source marker for ADR-009/);

    const ledgerPath = path.join(decisionsDir, 'decisions-ledger.jsonl');
    const rows = (await fs.readFile(ledgerPath, 'utf-8'))
      .split('\n').filter(Boolean).map(l => JSON.parse(l));

    const row = rows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-009');
    expect(row).toBeTruthy();
    expect(row.id).toBe('obs_migrated_adr_009');
  });

  it('warns and keeps first occurrence on duplicate Source obs_id', async () => {
    // Two .md entries claim the same Source obs_id
    const body1 = `
## ADR-010: First entry

- **Date**: 2026-06-01
- **Status**: Accepted
- **Context**: context
- **Decision**: decision
- **Consequences**: consequences
- **Source**: self-learning:obs_duplicate
`;
    const body2 = `
## ADR-011: Second entry (duplicate source)

- **Date**: 2026-06-02
- **Status**: Accepted
- **Context**: context2
- **Decision**: decision2
- **Consequences**: consequences2
- **Source**: self-learning:obs_duplicate
`;
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), buildDecisionsContent([body1, body2]), 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([]), 'utf-8');
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      JSON.stringify({ id: 'obs_duplicate', type: 'decision', pattern: 'First', status: 'created', first_seen: '2026-06-01T00:00:00Z' }) + '\n',
      'utf-8',
    );

    const result = await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    // One duplicate warning
    const dupWarnings = result.warnings.filter(w => w.includes('Duplicate Source obs_id'));
    expect(dupWarnings.length).toBe(1);
    expect(dupWarnings[0]).toContain('obs_duplicate');

    // Only ADR-010 is anchored (first occurrence kept)
    const ledgerPath = path.join(decisionsDir, 'decisions-ledger.jsonl');
    const rows = (await fs.readFile(ledgerPath, 'utf-8'))
      .split('\n').filter(Boolean).map(l => JSON.parse(l));

    const adr010 = rows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-010');
    expect(adr010).toBeTruthy();
    // ADR-011 skipped due to duplicate Source
    const adr011 = rows.find((r: { anchor_id?: string }) => r.anchor_id === 'ADR-011');
    expect(adr011).toBeUndefined();
  });

  it('dry-run does not write any files', async () => {
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), buildDecisionsContent([DECISION_BODY_ADR001]), 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([]), 'utf-8');

    await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH, dryRun: true });

    // Ledger should NOT exist after dry-run
    await expect(
      fs.access(path.join(decisionsDir, 'decisions-ledger.jsonl')),
    ).rejects.toThrow();
  });

  it('releases .decisions.lock after successful migration', async () => {
    await fs.writeFile(path.join(decisionsDir, 'decisions.md'), buildDecisionsContent([DECISION_BODY_ADR001]), 'utf-8');
    await fs.writeFile(path.join(decisionsDir, 'pitfalls.md'), buildPitfallsContent([]), 'utf-8');

    await migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH });

    const lockDir = path.join(decisionsDir, '.decisions.lock');
    await expect(fs.access(lockDir)).rejects.toThrow();
  });

  it('throws when .decisions.lock cannot be acquired (timeout path)', async () => {
    // Arrange: pre-write a non-empty ledger so the migration reaches Step 6
    // (acquireMkdirLock call). An empty ledger+log triggers the early-return
    // at "newRowsAdded === 0 && existingLedgerRows.length === 0" before the lock.
    const adr001LedgerRow = {
      id: 'obs_c9d3m1',
      type: 'decision',
      pattern: 'Clean break philosophy',
      status: 'created',
      anchor_id: 'ADR-001',
      decisions_status: 'Accepted',
      date: '2026-05-06',
      raw_body: DECISION_BODY_ADR001,
    };
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'),
      JSON.stringify(adr001LedgerRow) + '\n',
      'utf-8',
    );
    // Also write matching .md so idempotency check will find newRowsAdded === 0
    // and still need the lock (crash-heal path).
    await fs.writeFile(
      path.join(decisionsDir, 'decisions.md'),
      buildDecisionsContent([DECISION_BODY_ADR001]),
      'utf-8',
    );
    await fs.writeFile(
      path.join(decisionsDir, 'pitfalls.md'),
      buildPitfallsContent([]),
      'utf-8',
    );
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-log.jsonl'),
      JSON.stringify({ id: 'obs_c9d3m1', type: 'decision', pattern: 'Clean break philosophy', status: 'created', first_seen: '2026-05-06T00:00:00Z' }) + '\n',
      'utf-8',
    );

    // Pre-hold the lock: mkdir the lock directory before calling the migration.
    // The migration uses acquireMkdirLock with a timeout. To make the test fast
    // we pass a very short timeoutMs so the wait doesn't add 30 seconds.
    const lockDir = path.join(decisionsDir, '.decisions.lock');
    await fs.mkdir(lockDir);

    try {
      // Act + Assert: migration must throw (not hang) when the lock is unavailable.
      // Pass timeoutMs=100 so the test completes in ~100ms rather than 30s.
      await expect(
        migrateDecisionsLedger(projectRoot, { rendererPath: RENDERER_PATH, timeoutMs: 100 }),
      ).rejects.toThrow('decisions-ledger-migration: timeout acquiring .decisions.lock');
    } finally {
      // Clean up the pre-held lock so the afterEach rm can remove the directory.
      try { await fs.rmdir(lockDir); } catch { /* already gone */ }
    }
  });
});

// ---------------------------------------------------------------------------
// renderDecisionsIndex — bootstrap migration helper
// ---------------------------------------------------------------------------

describe('renderDecisionsIndex', () => {
  let tmpDir: string;
  let decisionsDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'render-index-test-'));
    decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    await fs.mkdir(decisionsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns { written: false } when ledger is absent', async () => {
    const result = await renderDecisionsIndex(tmpDir, { rendererPath: RENDERER_PATH });
    expect(result.written).toBe(false);
    // index.md must not exist
    await expect(fs.access(path.join(decisionsDir, 'index.md'))).rejects.toThrow();
  });

  it('returns { written: false } when ledger is empty', async () => {
    await fs.writeFile(path.join(decisionsDir, 'decisions-ledger.jsonl'), '', 'utf-8');
    const result = await renderDecisionsIndex(tmpDir, { rendererPath: RENDERER_PATH });
    expect(result.written).toBe(false);
    await expect(fs.access(path.join(decisionsDir, 'index.md'))).rejects.toThrow();
  });

  it('writes index.md from an active ledger row', async () => {
    const row = {
      id: 'obs_adr1',
      type: 'decision',
      anchor_id: 'ADR-001',
      pattern: 'Use Result types everywhere',
      decisions_status: 'Accepted',
      date: '2026-01-01',
      details: 'context: TypeScript; decision: return Result; rationale: safety',
    };
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'),
      JSON.stringify(row) + '\n',
      'utf-8',
    );

    const result = await renderDecisionsIndex(tmpDir, { rendererPath: RENDERER_PATH });
    expect(result.written).toBe(true);

    const indexContent = await fs.readFile(path.join(decisionsDir, 'index.md'), 'utf-8');
    expect(indexContent).toContain('ADR-001');
    expect(indexContent).toContain('Use Result types everywhere');
    // Trailing newline
    expect(indexContent).toMatch(/\n$/);
  });

  it('does NOT write decisions.md or pitfalls.md', async () => {
    const row = {
      id: 'obs_adr1',
      type: 'decision',
      anchor_id: 'ADR-001',
      pattern: 'Some decision',
      decisions_status: 'Accepted',
      date: '2026-01-01',
      details: '',
    };
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'),
      JSON.stringify(row) + '\n',
      'utf-8',
    );

    await renderDecisionsIndex(tmpDir, { rendererPath: RENDERER_PATH });

    // Body files must NOT be created by this bootstrap helper
    await expect(fs.access(path.join(decisionsDir, 'decisions.md'))).rejects.toThrow();
    await expect(fs.access(path.join(decisionsDir, 'pitfalls.md'))).rejects.toThrow();
  });

  it('is idempotent — second run overwrites index.md with same content', async () => {
    const row = {
      id: 'obs_adr1',
      type: 'decision',
      anchor_id: 'ADR-001',
      pattern: 'Idempotency check',
      decisions_status: 'Accepted',
      date: '2026-01-01',
      details: '',
    };
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'),
      JSON.stringify(row) + '\n',
      'utf-8',
    );

    await renderDecisionsIndex(tmpDir, { rendererPath: RENDERER_PATH });
    const first = await fs.readFile(path.join(decisionsDir, 'index.md'), 'utf-8');
    await renderDecisionsIndex(tmpDir, { rendererPath: RENDERER_PATH });
    const second = await fs.readFile(path.join(decisionsDir, 'index.md'), 'utf-8');

    expect(first).toBe(second);
  });

  it('returns (none) for inactive-only corpus', async () => {
    const row = {
      id: 'obs_dep',
      type: 'decision',
      anchor_id: 'ADR-001',
      pattern: 'Deprecated decision',
      decisions_status: 'Deprecated',
      date: '2026-01-01',
      details: '',
    };
    await fs.writeFile(
      path.join(decisionsDir, 'decisions-ledger.jsonl'),
      JSON.stringify(row) + '\n',
      'utf-8',
    );

    const result = await renderDecisionsIndex(tmpDir, { rendererPath: RENDERER_PATH });
    expect(result.written).toBe(true);

    const indexContent = await fs.readFile(path.join(decisionsDir, 'index.md'), 'utf-8');
    expect(indexContent.trim()).toBe('(none)');
  });
});
