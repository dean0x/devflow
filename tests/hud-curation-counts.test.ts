// tests/hud-curation-counts.test.ts
// Tests for the HUD curation counts component (decisions and pitfalls) (D309).
// Validates active-row counting from decisions-ledger.jsonl, inactive-status
// exclusion, and graceful fallback when the ledger is missing or unreadable.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import curationCounts, {
  LEDGER_MAX_BYTES,
  gatherCurationCounts,
  gatherLedgerCurationCounts,
} from '../src/hud/components/curation-counts.js';
import { stripAnsi } from '../src/hud/colors.js';
import type { CurationCountsData, GatherContext } from '../src/hud/types.js';
import { curationMoveMarkerKey } from '../src/core/project-paths.js';
import { getCurationMoveMarkerPath } from '../src/core/curation-move-notice.js';

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

function makeCtx(data: CurationCountsData | null): GatherContext {
  return {
    stdin: {},
    git: null,
    transcript: null,
    usage: null,
    configCounts: null,
    curationCounts: data,
    costHistory: null,
    config: { enabled: true, detail: false, components: [] },
    devflowDir: '/test/.devflow',
    sessionStartTime: null,
    terminalWidth: 120,
  };
}

describe('gatherCurationCounts', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-curation-counts-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'curation'), { recursive: true });
    ledgerPath = path.join(tmpDir, '.devflow', 'curation', 'decisions-ledger.jsonl');
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

    expect(gatherCurationCounts(tmpDir)).toEqual({ decisions: 3, pitfalls: 1 });
  });

  it('treats absent decisions_status and Active as active', () => {
    const lines = [
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: undefined }),
      makeRow('decision', { anchor_id: 'ADR-002', decisions_status: 'Active' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherCurationCounts(tmpDir)).toEqual({ decisions: 2, pitfalls: 0 });
  });

  it('excludes Encoded, Deprecated, Superseded, and Retired rows', () => {
    const lines = [
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: 'Deprecated' }),
      makeRow('decision', { anchor_id: 'ADR-002', decisions_status: 'Superseded' }),
      makeRow('pitfall', { anchor_id: 'PF-001', decisions_status: 'Retired' }),
      makeRow('pitfall', { anchor_id: 'PF-003', decisions_status: 'Encoded' }),
      makeRow('pitfall', { anchor_id: 'PF-002' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherCurationCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 1 });
  });

  it('skips rows without anchor_id', () => {
    const lines = [
      makeRow('decision', { anchor_id: undefined }),
      makeRow('decision', { anchor_id: 'ADR-001' }),
    ];
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    expect(gatherCurationCounts(tmpDir)).toEqual({ decisions: 1, pitfalls: 0 });
  });

  it('skips malformed JSON lines', () => {
    const content = `not json at all\n${makeRow('pitfall', { anchor_id: 'PF-001' })}\n{truncated\n`;
    fs.writeFileSync(ledgerPath, content);

    expect(gatherCurationCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 1 });
  });

  it('returns null when the ledger file is missing', () => {
    expect(gatherCurationCounts(tmpDir)).toBeNull();
  });

  it('returns null when the ledger holds no valid rows', () => {
    fs.writeFileSync(ledgerPath, 'garbage\n\n{"type":"decision"}\n');

    expect(gatherCurationCounts(tmpDir)).toBeNull();
  });

  it('returns zero counts (not null) when every row is inactive', () => {
    fs.writeFileSync(
      ledgerPath,
      makeRow('decision', { anchor_id: 'ADR-001', decisions_status: 'Retired' }) + '\n',
    );

    expect(gatherCurationCounts(tmpDir)).toEqual({ decisions: 0, pitfalls: 0 });
  });
});

// D-HUD-LEDGER-BOUNDED: the statusline reads the ledger on every prompt, so it
// counts only a regular file of at most LEDGER_MAX_BYTES and never reads a ledger
// that is itself a symbolic link. A link, a FIFO or an oversized file shows no
// counts, as an absent ledger does, and none of them can stall the read.
describe('gatherCurationCounts reads only a bounded regular ledger (D-HUD-LEDGER-BOUNDED)', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-curation-bounded-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'curation'), { recursive: true });
    ledgerPath = path.join(tmpDir, '.devflow', 'curation', 'decisions-ledger.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** One valid active row, then the file extended with NUL bytes to `size` (a sparse file). */
  function ledgerOfSize(size: number): void {
    fs.writeFileSync(ledgerPath, makeRow('decision') + '\n');
    fs.truncateSync(ledgerPath, size);
  }

  it('shows no counts for a ledger that is a symbolic link to a ledger elsewhere', () => {
    const elsewhere = path.join(tmpDir, 'elsewhere.jsonl');
    fs.writeFileSync(elsewhere, [makeRow('decision'), makeRow('pitfall')].join('\n') + '\n');
    fs.symlinkSync(elsewhere, ledgerPath);

    expect(gatherCurationCounts(tmpDir)).toBeNull();
  });

  it('shows no counts for a ledger that is a symbolic link to an endless source', () => {
    fs.symlinkSync('/dev/zero', ledgerPath);

    expect(gatherCurationCounts(tmpDir)).toBeNull();
  });

  it('shows no counts for a FIFO at the ledger path, and never blocks on it', () => {
    execFileSync('mkfifo', [ledgerPath]);

    expect(gatherCurationCounts(tmpDir)).toBeNull();
  });

  it('counts a ledger of exactly LEDGER_MAX_BYTES', () => {
    ledgerOfSize(LEDGER_MAX_BYTES);

    expect(gatherCurationCounts(tmpDir)).toEqual({ decisions: 1, pitfalls: 0 });
  });

  it('shows no counts for a ledger one byte over LEDGER_MAX_BYTES', () => {
    ledgerOfSize(LEDGER_MAX_BYTES + 1);

    expect(gatherCurationCounts(tmpDir)).toBeNull();
  });

  it('LEDGER_MAX_BYTES leaves real ledgers, about 0.5 MB, far below the cap', () => {
    expect(LEDGER_MAX_BYTES).toBeGreaterThanOrEqual(4 * 1024 * 1024);
  });
});

// D-LEDGER-MAIN-WORKTREE: the HUD counts the ledger the hooks write. In a
// linked worktree that is the main checkout's; from a subdirectory it is the
// repository root's — never the session cwd's own (nonexistent) ledger.
describe('gatherLedgerCurationCounts resolves the ledger root like the hooks', { timeout: 30_000 }, () => {
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
    fs.mkdirSync(path.join(main, '.devflow', 'curation'), { recursive: true });
    fs.writeFileSync(
      path.join(main, '.devflow', 'curation', 'decisions-ledger.jsonl'),
      [makeRow('decision'), makeRow('pitfall')].join('\n') + '\n',
    );
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(outside, '.devflow', 'curation'), { recursive: true });
    fs.writeFileSync(
      path.join(outside, '.devflow', 'curation', 'decisions-ledger.jsonl'),
      makeRow('decision') + '\n',
    );
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('counts the main checkout\'s ledger from a linked worktree', async () => {
    expect(await gatherLedgerCurationCounts(wt, { home: outside })).toEqual({ decisions: 1, pitfalls: 1 });
  });

  it('counts the repository root\'s ledger from a subdirectory', async () => {
    const sub = path.join(main, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    expect(await gatherLedgerCurationCounts(sub, { home: outside })).toEqual({ decisions: 1, pitfalls: 1 });
  });

  it('keeps the worktree\'s own ledger when the main checkout is HOME', async () => {
    expect(await gatherLedgerCurationCounts(wt, { home: main })).toBeNull();
  });

  it('outside a git repository counts the cwd\'s ledger (the prior behaviour)', async () => {
    expect(await gatherLedgerCurationCounts(outside, { home: main })).toEqual({ decisions: 1, pitfalls: 0 });
  });
});

describe('the old ledger folder: the pointer and the refused line, only in the empty branch (#529, TP-17, TP-27)', () => {
  let base: string;
  let root: string;
  let home: string;

  const oldDir = (): string => path.join(root, '.devflow', 'learning');
  const newDir = (): string => path.join(root, '.devflow', 'curation');
  const markerPath = (): string => getCurationMoveMarkerPath(home, root);
  const POINTER = 'Curation: run devflow init, or open Claude Code in this project after it';
  const REFUSED = 'Curation: move refused, see the hook log';

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-old-folder-')));
    root = path.join(base, 'project');
    home = path.join(base, 'home');
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const rendered = async (data: CurationCountsData | null): Promise<string | null> => {
    const result = await curationCounts(makeCtx(data));
    return result === null ? null : stripAnsi(result.raw);
  };

  it('shows the pointer when only the old folder exists', async () => {
    fs.mkdirSync(oldDir(), { recursive: true });

    const data = await gatherLedgerCurationCounts(root, { home });

    expect(data).toEqual({ decisions: 0, pitfalls: 0, move: 'pointer' });
    expect(await rendered(data)).toBe(POINTER);
  });

  it('shows the refused line when a marker exists for this root', async () => {
    fs.mkdirSync(oldDir(), { recursive: true });
    fs.writeFileSync(markerPath(), '');

    const data = await gatherLedgerCurationCounts(root, { home });

    expect(data).toEqual({ decisions: 0, pitfalls: 0, move: 'refused' });
    expect(await rendered(data)).toBe(REFUSED);
  });

  it.each([
    ['tracked', 'Curation: move skipped, git tracks files in .devflow/learning/ or .devflow/curation/'],
    ['unknown', 'Curation: move skipped, git did not answer'],
  ] as const)('shows the skipped line when the shim left the %s marker for this root', async (reason, line) => {
    fs.mkdirSync(oldDir(), { recursive: true });
    fs.writeFileSync(getCurationMoveMarkerPath(home, root, reason), '');

    const data = await gatherLedgerCurationCounts(root, { home });

    expect(data).toEqual({ decisions: 0, pitfalls: 0, move: reason });
    expect(await rendered(data)).toBe(line);
  });

  it('a busy marker is not a refusal: the HUD still shows the pointer', async () => {
    fs.mkdirSync(oldDir(), { recursive: true });
    fs.writeFileSync(path.join(home, '.devflow', 'logs', `curation-move.${curationMoveMarkerKey(root)}.busy`), '');

    const data = await gatherLedgerCurationCounts(root, { home });

    expect(data).toEqual({ decisions: 0, pitfalls: 0, move: 'pointer' });
    expect(await rendered(data)).toBe(POINTER);
  });

  it('a marker for another root does not make this root refused', async () => {
    fs.mkdirSync(oldDir(), { recursive: true });
    fs.writeFileSync(getCurationMoveMarkerPath(home, path.join(base, 'other')), '');

    expect((await gatherLedgerCurationCounts(root, { home }))?.move).toBe('pointer');
  });

  it('shows neither when the old folder is absent, whatever the marker says', async () => {
    fs.writeFileSync(markerPath(), '');

    expect(await gatherLedgerCurationCounts(root, { home })).toBeNull();
  });

  it('never reads or counts the old ledger', async () => {
    fs.mkdirSync(oldDir(), { recursive: true });
    fs.writeFileSync(path.join(oldDir(), 'decisions-ledger.jsonl'), [makeRow('decision'), makeRow('pitfall')].join('\n') + '\n');

    expect(await gatherLedgerCurationCounts(root, { home })).toEqual({ decisions: 0, pitfalls: 0, move: 'pointer' });
  });

  it('does not test the old folder when the new ledger has counts', async () => {
    fs.mkdirSync(newDir(), { recursive: true });
    fs.writeFileSync(path.join(newDir(), 'decisions-ledger.jsonl'), makeRow('decision') + '\n');
    fs.mkdirSync(oldDir(), { recursive: true });
    fs.writeFileSync(markerPath(), '');

    expect(await gatherLedgerCurationCounts(root, { home })).toEqual({ decisions: 1, pitfalls: 0 });
  });

  it('shows the pointer when the new ledger holds only retired rows and the old folder exists', async () => {
    fs.mkdirSync(newDir(), { recursive: true });
    fs.writeFileSync(path.join(newDir(), 'decisions-ledger.jsonl'), makeRow('decision', { decisions_status: 'Retired' }) + '\n');
    fs.mkdirSync(oldDir(), { recursive: true });

    expect(await gatherLedgerCurationCounts(root, { home })).toEqual({ decisions: 0, pitfalls: 0, move: 'pointer' });
  });

  it('counts a link at the old name as present, as the shell does', async () => {
    fs.mkdirSync(path.join(base, 'elsewhere'));
    fs.mkdirSync(path.join(root, '.devflow'));
    fs.symlinkSync(path.join(base, 'elsewhere'), oldDir());

    expect((await gatherLedgerCurationCounts(root, { home }))?.move).toBe('pointer');
  });

  it('renders the notice only for empty counts: counts win over a stray notice', async () => {
    expect(await rendered({ decisions: 2, pitfalls: 0, move: 'pointer' })).toBe('Curation: 2 decisions');
  });

  it('keeps the label the same length as before the rename', async () => {
    expect('Curation:'.length).toBe('Learning:'.length);
    expect(await rendered({ decisions: 1, pitfalls: 1 })).toBe('Curation: 1 decision, 1 pitfall');
  });
});

describe('curationCounts component', () => {
  it('returns null when no data was gathered', async () => {
    expect(await curationCounts(makeCtx(null))).toBeNull();
  });

  it('returns null when counts are all zero', async () => {
    expect(await curationCounts(makeCtx({ decisions: 0, pitfalls: 0 }))).toBeNull();
  });

  it('renders decisions and pitfalls with singular/plural forms', async () => {
    const result = await curationCounts(makeCtx({ decisions: 1, pitfalls: 2 }));

    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Curation: 1 decision, 2 pitfalls');
  });

  it('omits zero-count parts', async () => {
    const result = await curationCounts(makeCtx({ decisions: 3, pitfalls: 0 }));

    expect(result).not.toBeNull();
    expect(result!.raw).toBe('Curation: 3 decisions');
  });

  it('dims the rendered text without altering content', async () => {
    const result = await curationCounts(makeCtx({ decisions: 2, pitfalls: 1 }));

    expect(result).not.toBeNull();
    expect(stripAnsi(result!.text)).toBe(result!.raw);
  });
});

// ---------------------------------------------------------------------------
// Contract test (D309): the HUD's active-row semantics must mirror
// render-decisions.cjs exactly, or the counts shown by the HUD would drift
// from the entries visible in decisions.md/pitfalls.md. This pins the
// mirror by comparing gatherCurationCounts' active/inactive determination
// (via count presence) against the renderer's isActive() — the curation
// store's, which it re-exports — for the full status matrix, rather than
// duplicating the inactive status list here.
// ---------------------------------------------------------------------------
describe('mirrors render-decisions.cjs active-row semantics (D309)', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-curation-mirror-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'curation'), { recursive: true });
    ledgerPath = path.join(tmpDir, '.devflow', 'curation', 'decisions-ledger.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const statusMatrix: Array<string | undefined> = [
    undefined,
    'Accepted',
    'Active',
    'Encoded',
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
      const counts = gatherCurationCounts(tmpDir);
      const actualActive = counts !== null && counts.decisions === 1;

      expect(actualActive).toBe(expectedActive);
    },
  );
});
