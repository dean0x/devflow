/**
 * D-LEDGER-MAIN-WORKTREE — `devflow learning` run from a linked worktree reads,
 * clears, resets and drains the ledger the hooks write: the main checkout's
 * `.devflow/learning/`, not the worktree's own (getLedgerRoot, not getGitRoot).
 *
 * Real git fixture (a main checkout with `.devflow/` and a linked worktree); only
 * the prompts and the machine devflow directory are stubbed. process.cwd() is
 * pointed at the worktree, exactly as a shell started there would be.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/targets/claude-code/claude-paths.js', () => ({
  getClaudeDirectory: vi.fn(() => '/home/user/.claude'),
  getDevFlowDirectory: vi.fn(() => '/home/user/.devflow'),
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
  note: vi.fn(),
  confirm: vi.fn(async () => true),
  select: vi.fn(async () => 'cancel'),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

import { getDevFlowDirectory } from '../../src/targets/claude-code/claude-paths.js';
import { learningCommand } from '../../src/cli/commands/learning.js';
import * as p from '@clack/prompts';
import {
  getDecisionsLogPath,
  getLearningDir,
  getLearningPendingTurnsPath,
} from '../../src/core/project-paths.js';

const OBS = JSON.stringify({
  id: 'obs_decision_001', type: 'decision', pattern: 'Use Result types', confidence: 0.8,
  observations: 5, first_seen: '2026-05-01T10:00:00Z', last_seen: '2026-05-06T10:00:00Z',
  status: 'observing', evidence: ['e'], details: 'context: a; decision: b; rationale: c',
}) + '\n';

function seedLedger(root: string): void {
  fs.mkdirSync(getLearningDir(root), { recursive: true });
  fs.writeFileSync(getDecisionsLogPath(root), OBS);
  fs.writeFileSync(getLearningPendingTurnsPath(root), '{"role":"user"}\n');
}

function resetCommand(): void {
  // Commander keeps option values across parseAsync() calls on one instance.
  (learningCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
}

// Real git fixture per case (init + commit + worktree add): budgeted past the 5 s default.
describe('devflow learning in a linked worktree acts on the main checkout\'s ledger', { timeout: 30_000 }, () => {
  let base: string;
  let main: string;
  let wt: string;
  let devflowDir: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ledger-root-')));
    main = path.join(base, 'main');
    fs.mkdirSync(main);
    execSync('git init -q', { cwd: main, stdio: 'pipe' });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: main, stdio: 'pipe' });
    wt = path.join(base, 'wt');
    execSync(`git worktree add -q "${wt}" -b feat`, { cwd: main, stdio: 'pipe' });
    seedLedger(main);

    devflowDir = path.join(base, 'machine-devflow');
    fs.mkdirSync(devflowDir);
    fs.writeFileSync(path.join(devflowDir, 'manifest.json'), JSON.stringify({
      version: '2.0.0', plugins: [], scope: 'user', features: { ambient: true, memory: true, learning: true },
      installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    vi.mocked(getDevFlowDirectory).mockReturnValue(devflowDir);
    vi.spyOn(process, 'cwd').mockReturnValue(wt);
    vi.mocked(p.log.info).mockClear();
    vi.mocked(p.log.success).mockClear();
    resetCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getDevFlowDirectory).mockReturnValue('/home/user/.devflow');
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('--status counts the main checkout\'s observations', async () => {
    await learningCommand.parseAsync(['--status'], { from: 'user' });
    const shown = vi.mocked(p.log.info).mock.calls.map(c => String(c[0])).join('\n');
    expect(shown).toContain('Observations: 1 total');
  });

  it('--list finds the main checkout\'s decisions log', async () => {
    await learningCommand.parseAsync(['--list'], { from: 'user' });
    expect(p.log.info).not.toHaveBeenCalledWith('No observations yet. Decisions log not found.');
    const shown = vi.mocked(p.log.info).mock.calls.map(c => String(c[0])).join('\n');
    expect(shown).toContain('Use Result types');
  });

  it('--clear truncates the main checkout\'s log and drains its queue', async () => {
    await learningCommand.parseAsync(['--clear'], { from: 'user' });
    expect(fs.readFileSync(getDecisionsLogPath(main), 'utf-8')).toBe('');
    expect(fs.existsSync(getLearningPendingTurnsPath(main))).toBe(false);
    expect(fs.existsSync(path.join(wt, '.devflow'))).toBe(false);
  });

  it('--reset removes the main checkout\'s learning state', async () => {
    await learningCommand.parseAsync(['--reset'], { from: 'user' });
    expect(fs.existsSync(getLearningDir(main))).toBe(false);
    expect(fs.existsSync(path.join(wt, '.devflow'))).toBe(false);
  });

  it('--disable drains the main checkout\'s learning queue', async () => {
    await learningCommand.parseAsync(['--disable'], { from: 'user' });
    expect(fs.existsSync(getLearningPendingTurnsPath(main))).toBe(false);
    expect(fs.existsSync(getDecisionsLogPath(main))).toBe(true);
  });
});
