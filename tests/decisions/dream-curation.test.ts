// tests/decisions/dream-curation.test.ts
//
// Phase 6 tests for the curation skill rewrite and retire-by-status model.
//
// AC-F4: Rendered .md contains only active entries — Deprecated/Superseded/Retired never appear.
// AC-F5: Retire removes an entry from .md but keeps it (anchor + Retired) in the committed ledger;
//         number never reused.
// AC-F6: A retired entry is recoverable: re-activating status + render restores it identically.
// AC-F9: Observing rows >30d are archived (rotation); anchored rows never archived.
//         (Curation SKILL wiring: contract that rotation step is present.)
// Curation SKILL: Iron Law, retire-anchor usage, rotation step, no direct .md edit, ADR-XOR-PF.
// observation-io: updateDecisionsStatus is removed; module still exports the correct surface.

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const JSON_HELPER_BIN = path.join(ROOT, 'scripts/hooks/json-helper.cjs');
const RENDER_BIN = path.join(ROOT, 'scripts/hooks/lib/render-decisions.cjs');

const {
  renderDecisionsFile,
  parseLedger,
  renderAndWriteAll,
} = require(RENDER_BIN) as {
  renderDecisionsFile: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => string;
  parseLedger: (ledgerPath: string) => Record<string, unknown>[];
  renderAndWriteAll: (worktreePath: string, rows: Record<string, unknown>[]) => void;
};

const {
  rotateObservations,
  writeJsonlAtomic,
} = require(JSON_HELPER_BIN) as {
  rotateObservations: (logPath: string, archivePath: string, nowMs: number) => number;
  writeJsonlAtomic: (file: string, entries: object[]) => void;
};

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
  const ledgerPath = path.join(dir, '.devflow', 'decisions', 'decisions-ledger.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return ledgerPath;
}

function runHelper(args: string, cwd: string): { stdout: string; code: number; stderr: string } {
  try {
    const stdout = execSync(`node "${JSON_HELPER_BIN}" ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, code: 0, stderr: '' };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number; stderr?: string };
    return {
      stdout: err.stdout ?? '',
      code: err.status ?? 1,
      stderr: err.stderr ?? '',
    };
  }
}

function readDecisionsMd(dir: string): string {
  return fs.readFileSync(path.join(dir, '.devflow', 'decisions', 'decisions.md'), 'utf8');
}

// ---------------------------------------------------------------------------
// dream-procedure.md content-presence assertions (AC-C3)
//
// The standalone dream-decisions/dream-curation SKILL.md files were retired
// when the dream system was simplified to a detached `claude -p` worker
// (background-dream-update) that reads scripts/hooks/dream-procedure.md
// directly — it is not a Claude Code skill (skills do not load in `claude -p`
// sessions). The Iron-Law strings this describe pins are the same contract
// the old SKILL.md files enforced, now consolidated into one procedure doc.
// ---------------------------------------------------------------------------

describe('dream-procedure.md curation contract (AC-C3)', () => {
  const PROCEDURE_PATH = path.join(ROOT, 'scripts/hooks/dream-procedure.md');
  let procedureContent: string;

  beforeAll(() => {
    procedureContent = fs.readFileSync(PROCEDURE_PATH, 'utf8');
  });

  it('Iron Law says assign-anchor owns numbering, render owns the .md, never hand-edit', () => {
    expect(procedureContent).toContain('assign-anchor OWNS NUMBERING');
    expect(procedureContent).toContain('render OWNS THE .md');
    expect(procedureContent).toContain('NEVER HAND-EDIT');
  });

  it('instructs to call retire-anchor for deprecation/retirement, never hand-edit the .md', () => {
    expect(procedureContent).toContain('retire-anchor');
    expect(procedureContent).toContain('RETIRE BY STATUS');
    expect(procedureContent).toContain('never hand-edit the .md');
  });

  it('states inputs are read-only (except where noted)', () => {
    expect(procedureContent).toContain('Inputs (read-only, except where noted)');
  });

  it('writes only via merge-observation/assign-anchor/retire-anchor/rotate-observations', () => {
    expect(procedureContent).toContain('merge-observation');
    expect(procedureContent).toContain('assign-anchor');
    expect(procedureContent).toContain('retire-anchor');
    expect(procedureContent).toContain('rotate-observations');
  });

  it('touches .last-dream-ok as the final success signal', () => {
    expect(procedureContent).toContain('.devflow/dream/.last-dream-ok');
    expect(procedureContent).toContain('LAST');
  });

  it('writes an optional last-run-summary only when the ledger changed', () => {
    expect(procedureContent).toContain('dream/last-run-summary');
    expect(procedureContent).toMatch(/if nothing changed, do NOT create this file/i);
  });

  it('contains the abstain-by-default creation bar', () => {
    expect(procedureContent).toContain('abstain-by-default');
    expect(procedureContent).toMatch(/most runs produce nothing/i);
  });

  it('contains ADR-XOR-PF awareness note', () => {
    expect(procedureContent).toContain('ADR-XOR-PF');
    expect(procedureContent).toContain('forward-looking');
    expect(procedureContent).toContain('Concrete failure');
  });

  it('contains dedup awareness note', () => {
    expect(procedureContent).toMatch(/dedup|near-duplicate/i);
  });

  it('bounds curation to at most 5 changes per run', () => {
    // \s+ tolerates an incidental mid-sentence line wrap in the markdown source
    // (a literal newline between "curation" and "changes", not just a space).
    expect(procedureContent).toMatch(/≤5\s+curation\s+changes/);
    expect(procedureContent).toContain('stop after 5 changes');
  });

  it('7-day protection window is keyed off the ledger date field', () => {
    expect(procedureContent).toContain('7-day protection window');
    expect(procedureContent).toContain("ledger row's");
    expect(procedureContent).toContain('date` field');
  });

  it('rotation step is for archiving stale observing rows (AC-F9)', () => {
    expect(procedureContent).toContain('observing');
    expect(procedureContent).toMatch(/30 days|30-day/);
    expect(procedureContent).toMatch(/never touches anchored|never touch.*anchor/i);
  });
});

// ---------------------------------------------------------------------------
// AC-F4: Rendered .md contains only active entries
// ---------------------------------------------------------------------------

describe('AC-F4: renderDecisionsFile excludes non-active statuses', () => {
  it('Deprecated entry does not appear in rendered decisions.md', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted', pattern: 'Keep this' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Deprecated', pattern: 'Deprecated entry' }),
    ];
    const output = renderDecisionsFile(rows, 'decisions');
    expect(output).toContain('ADR-001');
    expect(output).not.toContain('ADR-002');
    expect(output).not.toContain('Deprecated entry');
  });

  it('Superseded entry does not appear in rendered decisions.md', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Superseded', pattern: 'Old decision' }),
    ];
    const output = renderDecisionsFile(rows, 'decisions');
    expect(output).not.toContain('ADR-003');
    expect(output).not.toContain('Old decision');
  });

  it('Retired entry does not appear in rendered decisions.md', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-004', id: 'obs_004', decisions_status: 'Retired', pattern: 'Retired decision' }),
    ];
    const output = renderDecisionsFile(rows, 'decisions');
    expect(output).not.toContain('ADR-004');
    expect(output).not.toContain('Retired decision');
  });

  it('only Active pitfall status appears in rendered pitfalls.md', () => {
    const pf1 = { ...makeLedgerRow({ anchor_id: 'PF-001', id: 'obs_pf1', type: 'pitfall', decisions_status: 'Active', pattern: 'Active pitfall' }), type: 'pitfall', date: undefined };
    const pf2 = { ...makeLedgerRow({ anchor_id: 'PF-002', id: 'obs_pf2', type: 'pitfall', decisions_status: 'Deprecated', pattern: 'Deprecated pitfall' }), type: 'pitfall', date: undefined };
    const output = renderDecisionsFile([pf1, pf2], 'pitfalls');
    expect(output).toContain('PF-001');
    expect(output).not.toContain('PF-002');
    expect(output).not.toContain('Deprecated pitfall');
  });
});

// ---------------------------------------------------------------------------
// AC-F5: retire-anchor removes entry from .md, keeps it Retired in ledger
// ---------------------------------------------------------------------------

describe('AC-F5: retire-anchor hides entry from .md, keeps in ledger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curation-retire-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retired entry vanishes from decisions.md', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted', pattern: 'Keep this' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted', pattern: 'Retire this' }),
    ]);

    const result = runHelper('retire-anchor ADR-002 Retired', tmpDir);
    expect(result.code).toBe(0);

    const md = readDecisionsMd(tmpDir);
    expect(md).toContain('ADR-001');
    expect(md).not.toContain('ADR-002');
    expect(md).not.toContain('Retire this');
  });

  it('retired entry stays Retired in the ledger', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ]);

    runHelper('retire-anchor ADR-002 Retired', tmpDir);

    const rows = parseLedger(path.join(tmpDir, '.devflow', 'decisions', 'decisions-ledger.jsonl'));
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

    runHelper('retire-anchor ADR-002 Retired', tmpDir);

    // Write a new observation and promote it — should get ADR-003, not ADR-002
    const logPath = path.join(tmpDir, '.devflow', 'decisions', 'decisions-log.jsonl');
    fs.writeFileSync(logPath, JSON.stringify(makeObsRow({ id: 'obs_new', type: 'decision', status: 'ready' })) + '\n', 'utf8');
    const result = runHelper('assign-anchor decision obs_new', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-003');
  });

  it('Deprecated entry (via Deprecated status) vanishes from .md, stays in ledger', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted', pattern: 'Surviving' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted', pattern: 'Going Deprecated' }),
    ]);

    runHelper('retire-anchor ADR-002 Deprecated', tmpDir);

    const md = readDecisionsMd(tmpDir);
    expect(md).toContain('ADR-001');
    expect(md).not.toContain('ADR-002');

    const rows = parseLedger(path.join(tmpDir, '.devflow', 'decisions', 'decisions-ledger.jsonl'));
    const dep = rows.find(r => r.anchor_id === 'ADR-002');
    expect(dep!.decisions_status).toBe('Deprecated');
  });

  it('TL;DR count in decisions.md drops by one after retirement', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ]);

    // Render initial state: 2 active
    runHelper('retire-anchor ADR-001 Retired', tmpDir); // only ADR-002 left
    // Retire ADR-002 as well — 0 active
    runHelper('retire-anchor ADR-002 Retired', tmpDir);

    const md = readDecisionsMd(tmpDir);
    expect(md).toContain('<!-- TL;DR: 0 decisions.');
  });
});

// ---------------------------------------------------------------------------
// AC-F6: Recoverability — re-activating + render restores entry identically
// ---------------------------------------------------------------------------

describe('AC-F6: retired entry is recoverable — re-activate + render restores it', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curation-recover-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('render after re-activate restores entry to decisions.md with identical content', () => {
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

    // Retire ADR-002 — it vanishes from .md
    runHelper('retire-anchor ADR-002 Retired', tmpDir);
    const mdAfterRetire = readDecisionsMd(tmpDir);
    expect(mdAfterRetire).not.toContain('ADR-002');

    // Re-activate: flip decisions_status back to Accepted in the ledger
    const ledgerPath = path.join(tmpDir, '.devflow', 'decisions', 'decisions-ledger.jsonl');
    const rows = parseLedger(ledgerPath);
    const updated = rows.map(r =>
      r.anchor_id === 'ADR-002' ? { ...r, decisions_status: 'Accepted' } : r
    );
    fs.writeFileSync(ledgerPath, updated.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    // Re-render
    execSync(`node "${RENDER_BIN}" render "${tmpDir}"`, { cwd: tmpDir, encoding: 'utf8' });

    // Entry restored identically
    const mdAfterRestore = readDecisionsMd(tmpDir);
    expect(mdAfterRestore).toContain('ADR-002');
    expect(mdAfterRestore).toContain('Recoverable Decision');
    expect(mdAfterRestore).toContain('self-learning:obs_002');
  });

  it('restored entry has the same content as before retirement (raw_body round-trip)', () => {
    const rawBody = '\n## ADR-003: Raw Body Test\n\n- **Date**: 2026-03-01\n- **Status**: Accepted\n- **Context**: some context\n- **Decision**: some decision\n- **Consequences**: some consequences\n- **Source**: self-learning:obs_003\n';
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Accepted', raw_body: rawBody }),
    ]);

    // Capture content before retire
    execSync(`node "${RENDER_BIN}" render "${tmpDir}"`, { cwd: tmpDir, encoding: 'utf8' });
    const mdBefore = readDecisionsMd(tmpDir);

    // Retire
    runHelper('retire-anchor ADR-003 Retired', tmpDir);
    const mdRetired = readDecisionsMd(tmpDir);
    expect(mdRetired).not.toContain('ADR-003');

    // Re-activate + render
    const ledgerPath = path.join(tmpDir, '.devflow', 'decisions', 'decisions-ledger.jsonl');
    const rows = parseLedger(ledgerPath);
    const updated = rows.map(r =>
      r.anchor_id === 'ADR-003' ? { ...r, decisions_status: 'Accepted' } : r
    );
    fs.writeFileSync(ledgerPath, updated.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    execSync(`node "${RENDER_BIN}" render "${tmpDir}"`, { cwd: tmpDir, encoding: 'utf8' });

    const mdAfter = readDecisionsMd(tmpDir);
    expect(mdAfter).toBe(mdBefore);
  });
});

// ---------------------------------------------------------------------------
// AC-F9: rotation step — dream-procedure.md contract
// Already tested at the op level in ledger-ops.test.ts; here we verify
// the procedure wires it correctly (contract-level check).
// ---------------------------------------------------------------------------

describe('AC-F9: rotation step wired into curation (contract check)', () => {
  const PROCEDURE_PATH = path.join(ROOT, 'scripts/hooks/dream-procedure.md');
  let procedureContent: string;

  beforeAll(() => {
    procedureContent = fs.readFileSync(PROCEDURE_PATH, 'utf8');
  });

  it('procedure calls rotate-observations before selecting curation retire/merge candidates', () => {
    // The rotation step must appear BEFORE the Part 2 "LLM judgment" (retire/merge
    // candidate selection) — use lastIndexOf since Part 1 has its own earlier
    // "LLM judgment" heading (the creation-bar one) that rotation is NOT gated by.
    const rotateIdx = procedureContent.indexOf('rotate-observations');
    const judgmentIdx = procedureContent.lastIndexOf('LLM judgment');
    expect(rotateIdx).toBeGreaterThan(-1);
    expect(judgmentIdx).toBeGreaterThan(-1);
    expect(rotateIdx).toBeLessThan(judgmentIdx);
  });

  it('procedure says rotation runs under .observations.lock (self-locking)', () => {
    // The relevant paragraph must mention .observations.lock near rotate-observations
    const rotateIdx = procedureContent.indexOf('rotate-observations');
    // Check within 400 chars of the rotate-observations mention
    const context = procedureContent.slice(Math.max(0, rotateIdx - 400), rotateIdx + 400);
    expect(context).toContain('.observations.lock');
  });

  it('procedure states rotation archives stale observing rows and never touches anchored rows', () => {
    expect(procedureContent).toContain('anchored');
    expect(procedureContent).toContain('archive');
  });

  it('rotateObservations internal function: anchored rows never archived (AC-F9 contract)', () => {
    // Verify the op itself still enforces the contract (belt-and-suspenders check)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-contract-test-'));
    const decisionsDir = path.join(tmpDir, 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });

    const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
    const NOW = Date.now();
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();

    const logPath = path.join(decisionsDir, 'decisions-log.jsonl');
    const archivePath = path.join(decisionsDir, 'decisions-log.archive.jsonl');

    // Stale observing without anchor — should be rotated
    // Stale observing with anchor_id — must NOT be rotated
    writeJsonlAtomic(logPath, [
      makeObsRow({ id: 'obs_stale_unanchored', status: 'observing', last_seen: staleDate }),
      makeObsRow({ id: 'obs_stale_anchored', status: 'observing', last_seen: staleDate, anchor_id: 'ADR-001' }),
    ]);

    const rotated = rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(1); // only the unanchored one

    const archive = parseLedger(archivePath);
    expect(archive.map(r => r.id)).toContain('obs_stale_unanchored');
    expect(archive.map(r => r.id)).not.toContain('obs_stale_anchored');

    const remaining = parseLedger(logPath);
    expect(remaining.map(r => r.id)).toContain('obs_stale_anchored');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// observation-io: updateDecisionsStatus is removed; module surface is clean
// ---------------------------------------------------------------------------

describe('observation-io: updateDecisionsStatus is removed', () => {
  it('observation-io module does not export updateDecisionsStatus', async () => {
    // Dynamic import to check actual module exports
    const mod = await import(path.join(ROOT, 'src/cli/utils/observation-io.js'));
    expect((mod as Record<string, unknown>).updateDecisionsStatus).toBeUndefined();
  });

  it('observation-io still exports readObservations, writeObservations, warnIfInvalid', async () => {
    const mod = await import(path.join(ROOT, 'src/cli/utils/observation-io.js'));
    expect(typeof (mod as Record<string, unknown>).readObservations).toBe('function');
    expect(typeof (mod as Record<string, unknown>).writeObservations).toBe('function');
    expect(typeof (mod as Record<string, unknown>).warnIfInvalid).toBe('function');
  });
});
