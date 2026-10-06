// tests/decisions/learning-curation.test.ts
//
// Phase 6 tests for the curation skill rewrite and retire-by-status model.
//
// AC-F4: Rendered .md renders a body for active entries only — a Deprecated, Superseded or
//         Retired entry is listed under Inactive and never rendered.
// AC-F5: Retire removes an entry's body from .md but keeps it (anchor + Retired) in the committed
//         ledger; number never reused.
// AC-F6: A retired entry is recoverable: restore-anchor renders it again, exactly as before.
// AC-F9: Rotation archives an observation no ledger entry carries once 30 days pass
//         since its last activity; one an entry carries is never archived.
//         (Curation SKILL wiring: contract that rotation step is present.)
// Curation SKILL: Iron Law, retire-anchor usage, rotation step, no direct .md edit, ADR-XOR-PF.

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { makeV2LogRow, requireLearningStore, runJsonHelper } from './learning-fixtures.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const RENDER_BIN = path.join(ROOT, 'src/assets/scripts/hooks/lib/render-decisions.cjs');

const {
  renderDecisionsFile,
  parseLedger,
} = require(RENDER_BIN) as {
  renderDecisionsFile: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => string;
  parseLedger: (ledgerPath: string) => Record<string, unknown>[];
};

const store = requireLearningStore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedgerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_test001',
    type: 'decision',
    pattern: 'Use Result types everywhere',
    anchor_id: 'ADR-001',
    date: '2026-01-01',
    decisions_status: 'Accepted',
    confidence: 0.9,
    observations: 1,
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-01-01T00:00:00Z',
    status: 'created',
    evidence: [],
    details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
    quality_ok: true,
    ...overrides,
  };
}

function makeObsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_obs001',
    type: 'decision',
    pattern: 'Use Result types everywhere',
    confidence: 0.9,
    observations: 1,
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-01-01T00:00:00Z',
    status: 'observing',
    evidence: [],
    details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
    quality_ok: true,
    ...overrides,
  };
}

function writeLedger(dir: string, rows: Record<string, unknown>[]): string {
  const ledgerPath = path.join(dir, '.devflow', 'learning', 'decisions-ledger.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return ledgerPath;
}

function readDecisionsMd(dir: string): string {
  return fs.readFileSync(path.join(dir, '.devflow', 'learning', 'decisions.md'), 'utf8');
}

// ---------------------------------------------------------------------------
// Learning agent content-presence assertions (AC-C3)
//
// The Learning agent (src/assets/agents/learning.md) is the sole decisions processor:
// it claims the queue through claim-queue, reads the claimed turns directly,
// reads the ledger and the log only through list and show, and writes only
// through the learning ops. These describe pins hold the curation contract
// strings in place — the same Iron-Law contract the ledger ops enforce at runtime.
// ---------------------------------------------------------------------------

describe('Learning agent curation contract (AC-C3)', () => {
  const AGENT_PATH = path.join(ROOT, 'src/assets/agents/learning.md');
  let agentContent: string;

  beforeAll(() => {
    agentContent = fs.readFileSync(AGENT_PATH, 'utf8');
  });

  it('Iron Law says assign-anchor owns numbering, render owns the .md, never hand-edit', () => {
    expect(agentContent).toContain('assign-anchor OWNS NUMBERING');
    expect(agentContent).toContain('render OWNS THE .md');
    expect(agentContent).toContain('NEVER HAND-EDIT');
  });

  it('instructs to call retire-anchor for deprecation/retirement, never hand-edit the .md', () => {
    expect(agentContent).toContain('retire-anchor');
    expect(agentContent).toContain('RETIRE BY STATUS');
    expect(agentContent).toContain('never hand-edit the .md');
  });

  it('reads the claimed turns directly and the ledger only through list and show', () => {
    // \s+ tolerates a line wrap anywhere in the wrapped prose.
    expect(agentContent).toMatch(/claimed\s+turns\s+are\s+the\s+one\s+input\s+you\s+read\s+directly\s+with\s+your\s+Read\s+tool/);
    expect(agentContent).toMatch(/Ledger\s+and\s+log\s+data\s+come\s+only\s+through\s+`list`\s+and\s+`show`/);
  });

  it('routes every ledger write through the learning ops', () => {
    for (const op of [
      'put-observation', 'assign-anchor', 'retire-anchor', 'restore-anchor', 'refresh-anchor',
      'rotate-observations', 'claim-due',
    ]) {
      expect(agentContent, op).toContain(op);
    }
  });

  it('names the claim file and releases the claim with release-claim as the FINAL act', () => {
    expect(agentContent).toContain('.devflow/learning/.pending-turns.processing');
    expect(agentContent).toContain('FINAL act');
    expect(agentContent).toContain('json-helper.cjs" release-claim <token>');
  });

  it('run visibility is the final message — no status file', () => {
    expect(agentContent).toMatch(/final message is the run's only\s+visibility surface/);
    expect(agentContent).toMatch(/no status file/);
  });

  it('contains the abstain-by-default creation bar', () => {
    expect(agentContent).toContain('abstain-by-default');
    expect(agentContent).toMatch(/most runs produce nothing/i);
  });

  it('contains ADR-XOR-PF awareness note', () => {
    expect(agentContent).toContain('ADR-XOR-PF');
    expect(agentContent).toContain('forward-looking');
    expect(agentContent).toContain('Concrete failure');
  });

  it('contains dedup awareness note', () => {
    expect(agentContent).toMatch(/dedup|near-duplicate/i);
  });

  it('bounds maintenance by the claim-due work list, not by a change cap or a protection window', () => {
    expect(agentContent).toContain('json-helper.cjs" claim-due');
    // \s+ tolerates a mid-sentence line wrap, so a re-wrapped cap is still caught.
    expect(agentContent).not.toMatch(/≤5\s+curation\s+changes/);
    expect(agentContent).not.toMatch(/7-day\s+protection\s+window/);
  });

  it('rotation step archives observations no entry carries (AC-F9)', () => {
    expect(agentContent).toMatch(/30 days|30-day/);
    expect(agentContent).toMatch(/never touches anchored|never touch.*anchor/i);
  });
});

// ---------------------------------------------------------------------------
// AC-F4: Rendered .md contains only active entries
// ---------------------------------------------------------------------------

describe('AC-F4: renderDecisionsFile renders no body for a non-active status', () => {
  it('a Deprecated entry has no body in rendered decisions.md and is listed under Inactive', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted', pattern: 'Keep this' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Deprecated', pattern: 'Deprecated entry' }),
    ];
    const output = renderDecisionsFile(rows, 'decisions');
    expect(output).toMatch(/^## ADR-001: Keep this$/m);
    expect(output).not.toMatch(/^## ADR-002:/m);
    expect(output).not.toContain('Deprecated entry');
    expect(output).toContain('| ADR-002 | Deprecated | — |\n');
  });

  it('a Superseded entry has no body in rendered decisions.md and is listed under Inactive', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Superseded', pattern: 'Old decision' }),
    ];
    const output = renderDecisionsFile(rows, 'decisions');
    expect(output).not.toMatch(/^## ADR-003:/m);
    expect(output).not.toContain('Old decision');
    expect(output).toContain('| ADR-003 | Superseded | — |\n');
  });

  it('a Retired entry has no body in rendered decisions.md and is listed under Inactive', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-004', id: 'obs_004', decisions_status: 'Retired', pattern: 'Retired decision' }),
    ];
    const output = renderDecisionsFile(rows, 'decisions');
    expect(output).not.toMatch(/^## ADR-004:/m);
    expect(output).not.toContain('Retired decision');
    expect(output).toContain('| ADR-004 | Retired | — |\n');
  });

  it('only an Active pitfall has a body in rendered pitfalls.md', () => {
    const pf1 = { ...makeLedgerRow({ anchor_id: 'PF-001', id: 'obs_pf1', type: 'pitfall', decisions_status: 'Active', pattern: 'Active pitfall' }), type: 'pitfall', date: undefined };
    const pf2 = { ...makeLedgerRow({ anchor_id: 'PF-002', id: 'obs_pf2', type: 'pitfall', decisions_status: 'Deprecated', pattern: 'Deprecated pitfall' }), type: 'pitfall', date: undefined };
    const output = renderDecisionsFile([pf1, pf2], 'pitfalls');
    expect(output).toMatch(/^## PF-001: Active pitfall$/m);
    expect(output).not.toMatch(/^## PF-002:/m);
    expect(output).not.toContain('Deprecated pitfall');
    expect(output).toContain('| PF-002 | Deprecated | — |\n');
  });
});

// ---------------------------------------------------------------------------
// AC-F5: retire-anchor removes entry from .md, keeps it Retired in ledger
// ---------------------------------------------------------------------------

describe('AC-F5: retire-anchor hides entry from .md, keeps in ledger', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curation-retire-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Retire `anchor` with `status`, a reason on stdin. */
  function retire(anchor: string, status: string, reason = 'A one-off'): number {
    return runJsonHelper(tmpDir, ['retire-anchor', anchor, status], JSON.stringify({ reason })).code;
  }

  it('a retired entry loses its body in decisions.md and is listed under Inactive', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted', pattern: 'Keep this' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted', pattern: 'Retire this' }),
    ]);

    expect(retire('ADR-002', 'Retired')).toBe(0);

    const md = readDecisionsMd(tmpDir);
    expect(md).toMatch(/^## ADR-001: Keep this$/m);
    expect(md).not.toMatch(/^## ADR-002:/m);
    expect(md).not.toContain('Retire this');
    expect(md).toContain('| ADR-002 | Retired | A one-off |\n');
  });

  it('retired entry stays Retired in the ledger', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ]);

    expect(retire('ADR-002', 'Retired')).toBe(0);

    const rows = parseLedger(path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl'));
    expect(rows).toHaveLength(2);
    const retiredRow = rows.find(r => r.anchor_id === 'ADR-002');
    expect(retiredRow).toBeDefined();
    expect(retiredRow!.decisions_status).toBe('Retired');
  });

  it('ADR-002 number is never reused after retirement (AC-F7)', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ]);

    expect(retire('ADR-002', 'Retired')).toBe(0);

    // Write a new observation and promote it — should get ADR-003, not ADR-002
    const logPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-log.jsonl');
    fs.writeFileSync(logPath, JSON.stringify(makeV2LogRow({ id: 'obs_new' })) + '\n', 'utf8');
    const result = runJsonHelper(tmpDir, ['assign-anchor', 'decision', 'obs_new']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-003');
  });

  it('a Deprecated entry loses its body in the .md, is listed under Inactive and stays in the ledger', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted', pattern: 'Surviving' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted', pattern: 'Going Deprecated' }),
    ]);

    expect(retire('ADR-002', 'Deprecated', 'The store moved')).toBe(0);

    const md = readDecisionsMd(tmpDir);
    expect(md).toMatch(/^## ADR-001: Surviving$/m);
    expect(md).not.toMatch(/^## ADR-002:/m);
    expect(md).not.toContain('Going Deprecated');
    expect(md).toContain('| ADR-002 | Deprecated | The store moved |\n');

    const rows = parseLedger(path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl'));
    const dep = rows.find(r => r.anchor_id === 'ADR-002');
    expect(dep!.decisions_status).toBe('Deprecated');
  });

  it('TL;DR count in decisions.md drops by one after retirement', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ]);

    expect(retire('ADR-001', 'Retired')).toBe(0);
    expect(readDecisionsMd(tmpDir)).toContain('<!-- TL;DR: 1 decisions -->');
    expect(retire('ADR-002', 'Retired')).toBe(0);
    expect(readDecisionsMd(tmpDir)).toContain('<!-- TL;DR: 0 decisions -->');
  });
});

// ---------------------------------------------------------------------------
// AC-F6: Recoverability — restore-anchor renders a retired entry again
// ---------------------------------------------------------------------------

describe('AC-F6: a retired entry is recoverable — restore-anchor renders it again', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curation-recover-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('restore-anchor brings a retired entry back into decisions.md and out of the Inactive table', () => {
    const originalRow = makeLedgerRow({
      anchor_id: 'ADR-002',
      id: 'obs_002',
      pattern: 'Recoverable Decision',
      decisions_status: 'Accepted',
      raw_body: '\n## ADR-002: Recoverable Decision\n\n- **Date**: 2026-01-01\n- **Status**: Accepted\n- **Context**: test context\n- **Decision**: test decision\n- **Consequences**: test consequences\n- **Source**: self-learning:obs_002\n',
    });
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      originalRow,
    ]);

    // Retire ADR-002 — its body leaves the .md and it is listed under Inactive
    expect(runJsonHelper(tmpDir, ['retire-anchor', 'ADR-002', 'Retired'], '{"reason":"A one-off"}').code).toBe(0);
    const mdAfterRetire = readDecisionsMd(tmpDir);
    expect(mdAfterRetire).not.toMatch(/^## ADR-002:/m);
    expect(mdAfterRetire).toContain('| ADR-002 | Retired | A one-off |\n');

    expect(runJsonHelper(tmpDir, ['restore-anchor', 'ADR-002'])).toEqual({ code: 0, stdout: 'restored ADR-002\n', stderr: '' });

    // Entry restored, and no longer listed under Inactive
    const mdAfterRestore = readDecisionsMd(tmpDir);
    expect(mdAfterRestore).toMatch(/^## ADR-002: Recoverable Decision$/m);
    expect(mdAfterRestore).toContain('self-learning:obs_002');
    expect(mdAfterRestore).not.toContain('## Inactive');
  });

  it('the restored entry renders exactly as it did before retirement (raw_body round-trip)', () => {
    const rawBody = '\n## ADR-003: Raw Body Test\n\n- **Date**: 2026-03-01\n- **Status**: Accepted\n- **Context**: some context\n- **Decision**: some decision\n- **Consequences**: some consequences\n- **Source**: self-learning:obs_003\n';
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Accepted', raw_body: rawBody }),
    ]);

    // Capture content before retire
    execSync(`node "${RENDER_BIN}" render "${tmpDir}"`, { cwd: tmpDir, encoding: 'utf8' });
    const mdBefore = readDecisionsMd(tmpDir);

    expect(runJsonHelper(tmpDir, ['retire-anchor', 'ADR-003', 'Retired'], '{"reason":"A one-off"}').code).toBe(0);
    const mdRetired = readDecisionsMd(tmpDir);
    expect(mdRetired).not.toMatch(/^## ADR-003:/m);
    expect(mdRetired).toContain('| ADR-003 | Retired | A one-off |\n');

    expect(runJsonHelper(tmpDir, ['restore-anchor', 'ADR-003']).code).toBe(0);
    expect(readDecisionsMd(tmpDir)).toBe(mdBefore);
  });
});

// ---------------------------------------------------------------------------
// AC-F9: rotation step — Learning agent contract
// Already tested at the op level in ledger-ops.test.ts; here we verify
// the agent instructions wire it correctly (contract-level check).
// ---------------------------------------------------------------------------

describe('AC-F9: rotation step wired into curation (contract check)', () => {
  const AGENT_PATH = path.join(ROOT, 'src/assets/agents/learning.md');
  let agentContent: string;

  beforeAll(() => {
    agentContent = fs.readFileSync(AGENT_PATH, 'utf8');
  });

  it('agent runs rotate-observations before selecting curation retire/merge candidates', () => {
    // The Part 2 rotation step must appear BEFORE the Part 2 "LLM judgment"
    // (retire/merge candidate selection) — use lastIndexOf on both since the
    // Environment section and Part 1 have earlier mentions.
    const rotateIdx = agentContent.lastIndexOf('Rotate stale observations first');
    const judgmentIdx = agentContent.lastIndexOf('LLM judgment');
    expect(rotateIdx).toBeGreaterThan(-1);
    expect(judgmentIdx).toBeGreaterThan(-1);
    expect(rotateIdx).toBeLessThan(judgmentIdx);
  });

  it('agent must call the ops plainly — they self-lock; no external lock allowed', () => {
    expect(agentContent).toMatch(/self-locks? internally/i);
    expect(agentContent).toMatch(/never wrap them in a lock/i);
  });

  it('agent states rotation archives unreferenced observations and never touches anchored ones', () => {
    expect(agentContent).toContain('anchored');
    expect(agentContent).toContain('archive');
  });

  it('rotation archives a stale observation no ledger entry carries and keeps one an entry carries (AC-F9 contract)', () => {
    // Verify the op itself still enforces the contract (belt-and-suspenders check)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-contract-test-'));
    try {
      const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      writeLedger(tmpDir, [makeLedgerRow({ id: 'obs_stale_anchored', anchor_id: 'ADR-001' })]);
      const logPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-log.jsonl');
      store.writeJsonlAtomic(logPath, [
        makeObsRow({ id: 'obs_stale_unanchored', status: 'observing', last_seen: staleDate }),
        makeObsRow({ id: 'obs_stale_anchored', status: 'observing', last_seen: staleDate }),
      ]);

      expect(store.rotateObservations(tmpDir)).toEqual({ ok: true, value: { rotated: 1, appended: 1 } });

      const archive = parseLedger(path.join(tmpDir, '.devflow', 'learning', 'decisions-log.archive.jsonl'));
      expect(archive.map(r => r.id)).toEqual(['obs_stale_unanchored']);
      expect(parseLedger(logPath).map(r => r.id)).toEqual(['obs_stale_anchored']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
