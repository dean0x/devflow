// tests/hud-decisions-counts.test.ts
// Tests for the HUD decisions/pitfalls counts component (D309).
// Validates active-row counting from decisions-ledger.jsonl, inactive-status
// exclusion, and graceful fallback when the ledger is missing or unreadable.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import decisionsCounts, {
  gatherDecisionsCounts,
} from '../src/cli/hud/components/decisions-counts.js';
import { stripAnsi } from '../src/cli/hud/colors.js';
import type { DecisionsCountsData, GatherContext } from '../src/cli/hud/types.js';

// Helper: build a minimal ledger JSONL row with the given fields
function makeRow(type: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `obs_${Math.random().toString(36).slice(2)}`,
    type,
    pattern: 'test pattern',
    details: 'test details',
    anchor_id: type === 'pitfall' ? 'PF-001' : 'ADR-001',
    decisions_status: 'Accepted',
    ...extra,
  });
}

function makeCtx(data: DecisionsCountsData | null): GatherContext {
  return {
    stdin: {},
    git: null,
    transcript: null,
    usage: null,
    configCounts: null,
    decisionsCounts: data,
    costHistory: null,
    config: { enabled: true, detail: false, components: [] },
    devflowDir: '/test/.devflow',
    sessionStartTime: null,
    terminalWidth: 120,
  };
}

describe('gatherDecisionsCounts', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-decisions-counts-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
    ledgerPath = path.join(tmpDir, '.devflow', 'decisions', 'decisions-ledger.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts active rows by type', () => {
    const lines = [
      makeRow('decision', { anchor_id: 'ADR-001' }),
      makeRow('decision', { anchor_id: 'ADR-002' }),
      makeRow('decision', { anchor_id: 'ADR-003' }),
      makeRow('pitfall', { anchor_id: 'PF-001' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherDecisionsCounts(tmpDir)).toEqual({ decisions: 3, pitfalls: 1 });
  });

  it('treats absent decisions_status and Active as active', () => {
    const lines = [
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: undefined }),
      makeRow('decision', { anchor_id: 'ADR-002', decisions_status: 'Active' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherDecisionsCounts(tmpDir)).toEqual({ decisions: 2, pitfalls: 0 });
  });

  it('excludes Deprecated, Superseded, and Retired rows', () => {
    const lines = [
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: 'Deprecated' }),
      makeRow('decision', { anchor_id: 'ADR-002', decisions_status: 'Superseded' }),
      makeRow('pitfall', { anchor_id: 'PF-001', decisions_status: 'Retired' }),
      makeRow('pitfall', { anchor_id: 'PF-002' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherDecisionsCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 1 });
  });

  it('skips rows without anchor_id', () => {
    const lines = [
      makeRow('decision', { anchor_id: undefined }),
      makeRow('decision', { anchor_id: 'ADR-001' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherDecisionsCounts(tmpDir)).toEqual({ decisions: 1, pitfalls: 0 });
  });

  it('skips malformed JSON lines', () => {
    const content = `not json at all\n${makeRow('pitfall', { anchor_id: 'PF-001' })}\n{truncated\n`;
    fs.writeFileSync(ledgerPath, content);

    expect(gatherDecisionsCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 1 });
  });

  it('returns null when the ledger file is missing', () => {
    expect(gatherDecisionsCounts(tmpDir)).toBeNull();
  });

  it('returns null when the ledger holds no valid rows', () => {
    fs.writeFileSync(ledgerPath, 'garbage\n\n{"type":"decision"}\n');

    expect(gatherDecisionsCounts(tmpDir)).toBeNull();
  });

  it('returns zero counts (not null) when every row is inactive', () => {
    fs.writeFileSync(
      ledgerPath,
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: 'Retired' }) + '\n',
    );

    expect(gatherDecisionsCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 0 });
  });
});

describe('decisionsCounts component', () => {
  it('returns null when no data was gathered', async () => {
    expect(await decisionsCounts(makeCtx(null))).toBeNull();
  });

  it('returns null when counts are all zero', async () => {
    expect(await decisionsCounts(makeCtx({ decisions: 0, pitfalls: 0 }))).toBeNull();
  });

  it('renders decisions and pitfalls with singular/plural forms', async () => {
    const result = await decisionsCounts(makeCtx({ decisions: 1, pitfalls: 2 }));

    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Learning: 1 decision, 2 pitfalls');
  });

  it('omits zero-count parts', async () => {
    const result = await decisionsCounts(makeCtx({ decisions: 3, pitfalls: 0 }));

    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Learning: 3 decisions');
  });

  it('dims the rendered text without altering content', async () => {
    const result = await decisionsCounts(makeCtx({ decisions: 2, pitfalls: 1 }));

    expect(result).not.toBeNull();
    expect(stripAnsi(result!.text)).toBe(result!.raw);
  });
});
