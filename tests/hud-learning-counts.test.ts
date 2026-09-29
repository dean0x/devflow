// tests/hud-learning-counts.test.ts
// Tests for the HUD learning/pitfalls counts component (D309).
// Validates active-row counting from decisions-ledger.jsonl, inactive-status
// exclusion, and graceful fallback when the ledger is missing or unreadable.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import learningCounts, {
  gatherLearningCounts,
  gatherLedgerLearningCounts,
} from '../src/hud/components/learning-counts.js';
import { stripAnsi } from '../src/hud/colors.js';
import type { LearningCountsData, GatherContext } from '../src/hud/types.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { isActive: cjsIsActive } = require(
  path.join(ROOT, 'src/assets/scripts/hooks/lib/render-decisions.cjs'),
) as { isActive: (row: Record<string, unknown>) => boolean };

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

function makeCtx(data: LearningCountsData | null): GatherContext {
  return {
    stdin: {},
    git: null,
    transcript: null,
    usage: null,
    configCounts: null,
    learningCounts: data,
    costHistory: null,
    config: { enabled: true, detail: false, components: [] },
    devflowDir: '/test/.devflow',
    sessionStartTime: null,
    terminalWidth: 120,
  };
}

describe('gatherLearningCounts', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-learning-counts-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
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

    expect(gatherLearningCounts(tmpDir)).toEqual({ decisions: 3, pitfalls: 1 });
  });

  it('treats absent decisions_status and Active as active', () => {
    const lines = [
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: undefined }),
      makeRow('decision', { anchor_id: 'ADR-002', decisions_status: 'Active' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherLearningCounts(tmpDir)).toEqual({ decisions: 2, pitfalls: 0 });
  });

  it('excludes Deprecated, Superseded, and Retired rows', () => {
    const lines = [
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: 'Deprecated' }),
      makeRow('decision', { anchor_id: 'ADR-002', decisions_status: 'Superseded' }),
      makeRow('pitfall', { anchor_id: 'PF-001', decisions_status: 'Retired' }),
      makeRow('pitfall', { anchor_id: 'PF-002' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherLearningCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 1 });
  });

  it('skips rows without anchor_id', () => {
    const lines = [
      makeRow('decision', { anchor_id: undefined }),
      makeRow('decision', { anchor_id: 'ADR-001' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherLearningCounts(tmpDir)).toEqual({ decisions: 1, pitfalls: 0 });
  });

  it('skips malformed JSON lines', () => {
    const content = `not json at all\n${makeRow('pitfall', { anchor_id: 'PF-001' })}\n{truncated\n`;
    fs.writeFileSync(ledgerPath, content);

    expect(gatherLearningCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 1 });
  });

  it('returns null when the ledger file is missing', () => {
    expect(gatherLearningCounts(tmpDir)).toBeNull();
  });

  it('returns null when the ledger holds no valid rows', () => {
    fs.writeFileSync(ledgerPath, 'garbage\n\n{"type":"decision"}\n');

    expect(gatherLearningCounts(tmpDir)).toBeNull();
  });

  it('returns zero counts (not null) when every row is inactive', () => {
    fs.writeFileSync(
      ledgerPath,
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: 'Retired' }) + '\n',
    );

    expect(gatherLearningCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 0 });
  });
});

// D-LEDGER-MAIN-WORKTREE: the HUD counts the ledger the hooks write. In a
// linked worktree that is the main checkout's; from a subdirectory it is the
// repository root's — never the session cwd's own (nonexistent) ledger.
describe('gatherLedgerLearningCounts resolves the ledger root like the hooks', { timeout: 30_000 }, () => {
  let base: string;
  let main: string;
  let wt: string;
  let outside: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-ledger-root-')));
    main = path.join(base, 'main');
    fs.mkdirSync(main);
    execSync('git init -q', { cwd: main, stdio: 'pipe' });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: main, stdio: 'pipe' });
    wt = path.join(base, 'wt');
    execSync(`git worktree add -q "${wt}" -b feat`, { cwd: main, stdio: 'pipe' });
    fs.mkdirSync(path.join(main, '.devflow', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(main, '.devflow', 'learning', 'decisions-ledger.jsonl'),
      [makeRow('decision'), makeRow('pitfall')].join('\n') + '\n',
    );
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(outside, '.devflow', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(outside, '.devflow', 'learning', 'decisions-ledger.jsonl'),
      makeRow('decision') + '\n',
    );
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('counts the main checkout\'s ledger from a linked worktree', async () => {
    expect(await gatherLedgerLearningCounts(wt, { home: outside })).toEqual({ decisions: 1, pitfalls: 1 });
  });

  it('counts the repository root\'s ledger from a subdirectory', async () => {
    const sub = path.join(main, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    expect(await gatherLedgerLearningCounts(sub, { home: outside })).toEqual({ decisions: 1, pitfalls: 1 });
  });

  it('keeps the worktree\'s own ledger when the main checkout is HOME', async () => {
    expect(await gatherLedgerLearningCounts(wt, { home: main })).toBeNull();
  });

  it('outside a git repository counts the cwd\'s ledger (the prior behaviour)', async () => {
    expect(await gatherLedgerLearningCounts(outside, { home: main })).toEqual({ decisions: 1, pitfalls: 0 });
  });
});

describe('learningCounts component', () => {
  it('returns null when no data was gathered', async () => {
    expect(await learningCounts(makeCtx(null))).toBeNull();
  });

  it('returns null when counts are all zero', async () => {
    expect(await learningCounts(makeCtx({ decisions: 0, pitfalls: 0 }))).toBeNull();
  });

  it('renders decisions and pitfalls with singular/plural forms', async () => {
    const result = await learningCounts(makeCtx({ decisions: 1, pitfalls: 2 }));

    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Learning: 1 decision, 2 pitfalls');
  });

  it('omits zero-count parts', async () => {
    const result = await learningCounts(makeCtx({ decisions: 3, pitfalls: 0 }));

    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Learning: 3 decisions');
  });

  it('dims the rendered text without altering content', async () => {
    const result = await learningCounts(makeCtx({ decisions: 2, pitfalls: 1 }));

    expect(result).not.toBeNull();
    expect(stripAnsi(result!.text)).toBe(result!.raw);
  });
});

// ---------------------------------------------------------------------------
// Contract test (D309): the HUD's active-row semantics must mirror
// render-decisions.cjs exactly, or the counts shown by the HUD would drift
// from the entries visible in decisions.md/pitfalls.md. This pins the
// mirror by comparing gatherLearningCounts' active/inactive determination
// (via count presence) against the cjs renderer's own isActive() for the
// full status matrix, rather than duplicating INACTIVE_STATUSES here.
// ---------------------------------------------------------------------------
describe('mirrors render-decisions.cjs active-row semantics (D309)', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-learning-mirror-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const statusMatrix: Array<string | undefined> = [
    undefined,
    'Accepted',
    'Active',
    'Deprecated',
    'Superseded',
    'Retired',
    'SomeFutureStatus',
  ];

  it.each(statusMatrix)(
    'agrees with render-decisions.cjs isActive() for decisions_status=%s',
    (status) => {
      const row: Record<string, unknown> = { type: 'decision', anchor_id: 'ADR-001' };
      if (status !== undefined) row.decisions_status = status;

      fs.writeFileSync(ledgerPath, JSON.stringify(row) + '\n');

      const expectedActive = cjsIsActive(row);
      const counts = gatherLearningCounts(tmpDir);
      const actualActive = counts !== null && counts.decisions === 1;

      expect(actualActive).toBe(expectedActive);
    },
  );
});
