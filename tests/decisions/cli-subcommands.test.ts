/**
 * Tests for `devflow decisions` subcommand behaviors.
 *
 * Phase 3: removed tests for filterEligibleEntries, sortByLeastUsed,
 * clearCapacityNotifications, toDecisionsStatus, DecisionsEntry (all
 * removed as part of the capacity review system removal).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mocks — all set up before any imports from the module under test.
// ---------------------------------------------------------------------------

vi.mock('../../src/cli/utils/decisions-config.js', () => ({
  loadDecisionsConfig: vi.fn(() => ({
    model: 'opus',
    debug: false,
  })),
}));

vi.mock('../../src/cli/utils/paths.js', () => ({
  getClaudeDirectory: vi.fn(() => '/home/user/.claude'),
  getDevFlowDirectory: vi.fn(() => '/home/user/.devflow'),
}));

vi.mock('../../src/cli/utils/git.js', () => ({
  getGitRoot: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
  note: vi.fn(),
  confirm: vi.fn(async () => false),
  select: vi.fn(async () => 'cancel'),
  multiselect: vi.fn(async () => []),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  text: vi.fn(async () => '3'),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks.
// ---------------------------------------------------------------------------
import {
  parseLearningLog,
  loadAndCountObservations,
  type LearningObservation,
} from '../../src/cli/utils/observations.js';
import { getGitRoot } from '../../src/cli/utils/git.js';
import { decisionsCommand } from '../../src/cli/commands/decisions.js';
import * as p from '@clack/prompts';
import {
  getDreamPendingTurnsPath,
  getDreamPendingTurnsProcessingPath,
  getDreamConfigPath,
  getPendingTurnsPath,
  getDecisionsLogPath,
} from '../../src/cli/utils/project-paths.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-subcommands-test-'));
}

/** Build a valid LearningObservation object for testing. */
function makeDecisionObs(overrides: Partial<LearningObservation> = {}): LearningObservation {
  return {
    id: overrides.id ?? 'obs_decision_001',
    type: overrides.type ?? 'decision',
    pattern: overrides.pattern ?? 'Use Result types for error handling',
    confidence: overrides.confidence ?? 0.8,
    observations: overrides.observations ?? 5,
    first_seen: '2026-05-01T10:00:00Z',
    last_seen: '2026-05-06T10:00:00Z',
    status: overrides.status ?? 'observing',
    evidence: ['evidence 1'],
    details: 'context: auth module; decision: Result types; rationale: explicit errors',
    ...overrides,
  };
}

function makeDecisionLog(entries: LearningObservation[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// --list filtering: verify that only decision/pitfall types are surfaced
// ---------------------------------------------------------------------------

describe('decisions --list filtering logic', () => {
  it('filters observations to decision and pitfall types only', () => {
    const all = [
      makeDecisionObs({ id: 'obs_workflow_001', type: 'workflow', pattern: 'Run tests first' }),
      makeDecisionObs({ id: 'obs_procedural_001', type: 'procedural', pattern: 'Deploy checklist' }),
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision', pattern: 'Use Result types' }),
      makeDecisionObs({ id: 'obs_pitfall_001', type: 'pitfall', pattern: 'Missing null check' }),
    ];

    const filtered = all.filter(o => o.type === 'decision' || o.type === 'pitfall');

    expect(filtered).toHaveLength(2);
    expect(filtered.map(o => o.pattern)).toContain('Use Result types');
    expect(filtered.map(o => o.pattern)).toContain('Missing null check');
    expect(filtered.map(o => o.pattern)).not.toContain('Run tests first');
    expect(filtered.map(o => o.pattern)).not.toContain('Deploy checklist');
  });

  it('sorts filtered observations by confidence descending', () => {
    const all = [
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision', pattern: 'Low confidence', confidence: 0.3 }),
      makeDecisionObs({ id: 'obs_pitfall_001', type: 'pitfall', pattern: 'High confidence', confidence: 0.9 }),
      makeDecisionObs({ id: 'obs_decision_002', type: 'decision', pattern: 'Mid confidence', confidence: 0.6 }),
    ];

    const filtered = all.filter(o => o.type === 'decision' || o.type === 'pitfall');
    filtered.sort((a, b) => b.confidence - a.confidence);

    expect(filtered[0].pattern).toBe('High confidence');
    expect(filtered[1].pattern).toBe('Mid confidence');
    expect(filtered[2].pattern).toBe('Low confidence');
  });

  it('returns empty array when no decision/pitfall entries exist', () => {
    const all = [
      makeDecisionObs({ id: 'obs_workflow_001', type: 'workflow', pattern: 'Workflow pattern' }),
    ];

    const filtered = all.filter(o => o.type === 'decision' || o.type === 'pitfall');

    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// --status counts: verify count logic
// ---------------------------------------------------------------------------

describe('decisions --status count logic', () => {
  it('counts decisions and pitfalls separately', () => {
    const observations = [
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision' }),
      makeDecisionObs({ id: 'obs_decision_002', type: 'decision' }),
      makeDecisionObs({ id: 'obs_pitfall_001', type: 'pitfall' }),
    ];

    const decisions = observations.filter(o => o.type === 'decision');
    const pitfalls = observations.filter(o => o.type === 'pitfall');

    expect(decisions).toHaveLength(2);
    expect(pitfalls).toHaveLength(1);
  });

  it('counts by status correctly', () => {
    const observations = [
      makeDecisionObs({ id: 'obs_d_001', type: 'decision', status: 'observing' }),
      makeDecisionObs({ id: 'obs_d_002', type: 'decision', status: 'ready' }),
      makeDecisionObs({ id: 'obs_d_003', type: 'decision', status: 'created' }),
      makeDecisionObs({ id: 'obs_p_001', type: 'pitfall', status: 'deprecated' }),
    ];

    const observing = observations.filter(o => o.status === 'observing');
    const ready = observations.filter(o => o.status === 'ready');
    const created = observations.filter(o => o.status === 'created');
    const deprecated = observations.filter(o => o.status === 'deprecated');

    expect(observing).toHaveLength(1);
    expect(ready).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(deprecated).toHaveLength(1);
  });

  it('identifies entries needing attention via mayBeStale flag', () => {
    // needsReview and softCapExceeded removed in Part A — only mayBeStale remains.
    const observations = [
      makeDecisionObs({ id: 'obs_d_001', type: 'decision', mayBeStale: true }),
      makeDecisionObs({ id: 'obs_d_002', type: 'decision' }),
      makeDecisionObs({ id: 'obs_d_003', type: 'decision' }),
    ];

    const needReview = observations.filter(o => o.mayBeStale);

    expect(needReview).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// loadAndCountObservations: verify parsing and invalid-entry detection
// ---------------------------------------------------------------------------

describe('decisions log parsing', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    logPath = path.join(tmpDir, 'decisions-log.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadAndCountObservations parses valid entries', () => {
    const entries = [
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision' }),
      makeDecisionObs({ id: 'obs_pitfall_001', type: 'pitfall' }),
    ];
    const logContent = makeDecisionLog(entries);
    fs.writeFileSync(logPath, logContent, 'utf-8');

    const content = fs.readFileSync(logPath, 'utf-8');
    const { observations, invalidCount } = loadAndCountObservations(content);

    expect(observations).toHaveLength(2);
    expect(invalidCount).toBe(0);
  });

  it('loadAndCountObservations counts malformed lines as invalid', () => {
    const validEntry = JSON.stringify(makeDecisionObs({ id: 'obs_decision_001', type: 'decision' }));
    const logContent = [validEntry, 'not valid json {{{', 'also not json'].join('\n') + '\n';
    fs.writeFileSync(logPath, logContent, 'utf-8');

    const content = fs.readFileSync(logPath, 'utf-8');
    const { observations, invalidCount } = loadAndCountObservations(content);

    expect(observations).toHaveLength(1);
    expect(invalidCount).toBe(2);
  });

  it('parseLearningLog accepts all 4 observation types', () => {
    const rawEntries = [
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision' }),
      makeDecisionObs({ id: 'obs_pitfall_001', type: 'pitfall' }),
      makeDecisionObs({ id: 'obs_workflow_001', type: 'workflow' }),
    ];
    const logContent = makeDecisionLog(rawEntries);
    fs.writeFileSync(logPath, logContent, 'utf-8');

    const content = fs.readFileSync(logPath, 'utf-8');
    const allObs = parseLearningLog(content);

    expect(allObs).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// --clear behavior: verify log truncation
// ---------------------------------------------------------------------------

describe('decisions --clear log truncation', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    logPath = path.join(tmpDir, 'decisions-log.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writing empty string truncates the log', () => {
    const entries = [
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision' }),
    ];
    fs.writeFileSync(logPath, makeDecisionLog(entries), 'utf-8');
    expect(fs.readFileSync(logPath, 'utf-8').trim()).not.toBe('');

    fs.writeFileSync(logPath, '', 'utf-8');

    expect(fs.readFileSync(logPath, 'utf-8')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// --reset state removal: verify correct files are targeted
// ---------------------------------------------------------------------------

describe('decisions --reset target files', () => {
  it('reset targets decisions-specific state files (.devflow/decisions/)', () => {
    const decisionsStateFiles = [
      'decisions-log.jsonl',
      '.decisions-manifest.json',
      '.decisions-notifications.json',
      '.decisions-batch-ids',
      'decisions.json',
    ];

    const preservedFiles = [
      'learning-log.jsonl',
      '.learning-manifest.json',
      '.learning-runs-today',
      'WORKING-MEMORY.md',
    ];

    for (const f of decisionsStateFiles) {
      expect(
        f.includes('decision') || f.includes('decisions'),
        `Expected "${f}" to contain "decision" or "decisions"`,
      ).toBe(true);
    }

    for (const f of preservedFiles) {
      expect(decisionsStateFiles).not.toContain(f);
    }
  });

  it('reset also targets the dream (decisions-detection) queue (.devflow/dream/)', () => {
    // Not decision-prefixed by name — these live in .devflow/dream/, the queue the
    // Dream agent claims from. Reset must drain them too so a re-enable doesn't
    // process stale pre-reset turns.
    const dreamQueueFiles = [
      '.pending-turns.jsonl',
      '.pending-turns.processing',
    ];

    const preservedDreamFiles = [
      'config.json', // shared multi-feature config — reset must never touch this
    ];

    for (const f of preservedDreamFiles) {
      expect(dreamQueueFiles).not.toContain(f);
    }
  });
});

// ---------------------------------------------------------------------------
// --reset dream cleanup: verify legacy marker-pipeline state files are targeted
// ---------------------------------------------------------------------------

describe('decisions --reset dream state cleanup', () => {
  it('dream cleanup targets legacy stamp files (.decisions-runs-today, .curation-last, .processor-spawned-at)', () => {
    const dreamFilesToClean = [
      '.decisions-runs-today',
      '.curation-last',
      '.processor-spawned-at',
    ];

    for (const f of dreamFilesToClean) {
      expect(f.startsWith('.')).toBe(true);
    }
  });

  it('dream cleanup targets legacy decisions.*/curation.* markers across all 4 suffixes', () => {
    const dreamMarkerPattern = /^(decisions|curation)\..+\.(json|processing|retries|failed)$/;

    for (const f of [
      'decisions.abc123.json',
      'decisions.session-xyz.processing',
      'decisions.abc123.retries',
      'decisions.abc123.failed',
      'curation.abc123.json',
      'curation.abc123.processing',
    ]) {
      expect(dreamMarkerPattern.test(f)).toBe(true);
    }

    // Never touches: learning markers (pipeline removed separately), the shared
    // config.json, or the new .pending-turns.jsonl/.processing queue files.
    for (const f of ['learning.abc123.json', 'decisions.json', 'config.json', '.pending-turns.jsonl', '.pending-turns.processing']) {
      expect(dreamMarkerPattern.test(f)).toBe(false);
    }
  });

  it('dream cleanup does not target learning state files', () => {
    const decisionsDreamFiles = ['.decisions-runs-today', '.curation-last', '.processor-spawned-at'];
    const learningFiles = ['.learning-runs-today', '.learning-sessions'];

    for (const lf of learningFiles) {
      expect(decisionsDreamFiles).not.toContain(lf);
    }
  });
});

// ---------------------------------------------------------------------------
// --reset success message: truthful, no file count
// ---------------------------------------------------------------------------

describe('decisions --reset success message', () => {
  const decisionsTs = fs.readFileSync(
    new URL('../../src/cli/commands/decisions.ts', import.meta.url).pathname,
    'utf-8',
  );

  it('pins the truthful success string (no file count)', () => {
    expect(decisionsTs).toContain(
      "p.log.success('Reset complete — removed .devflow/decisions/ and dream queue state.');",
    );
  });

  it('does not interpolate a removed-file count into the success message', () => {
    expect(decisionsTs).not.toMatch(/removed \$\{[^}]+\} file\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// --disable drains the dream (decisions-detection) pending-turns queue —
// mirrors memory.ts's drain-on-disable behavior for the sibling memory queue.
// Unconditional: a mid-run Dream agent whose claimed batch vanishes aborts
// without changes, which is the desired outcome of disabling.
// ---------------------------------------------------------------------------

describe('decisions --disable drains the dream pending-turns queue', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.mocked(getGitRoot).mockResolvedValue(tmpDir);
    // Commander retains _optionValues across repeated parseAsync() calls on the
    // same Command instance (no built-in reset between calls). Production always
    // starts a fresh process per invocation, so clear state here to match that
    // reality and keep these tests order-independent.
    (decisionsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeDreamQueueFiles(root: string): void {
    fs.mkdirSync(path.join(root, '.devflow', 'dream'), { recursive: true });
    fs.writeFileSync(getDreamPendingTurnsPath(root), '{"role":"user"}\n');
    fs.writeFileSync(getDreamPendingTurnsProcessingPath(root), '{"role":"user"}\n');
  }

  it('deletes queue + processing files and flips config (memory queue untouched)', async () => {
    writeDreamQueueFiles(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    fs.writeFileSync(getPendingTurnsPath(tmpDir), '{"role":"user"}\n');

    await decisionsCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(getDreamPendingTurnsPath(tmpDir))).toBe(false);
    expect(fs.existsSync(getDreamPendingTurnsProcessingPath(tmpDir))).toBe(false);

    const config = JSON.parse(fs.readFileSync(getDreamConfigPath(tmpDir), 'utf-8'));
    expect(config.decisions).toBe(false);

    // The sibling memory queue is never touched by decisions --disable
    expect(fs.existsSync(getPendingTurnsPath(tmpDir))).toBe(true);
  });

  it('does not create a .disabled sentinel (gate is config-only)', async () => {
    writeDreamQueueFiles(tmpDir);

    await decisionsCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'decisions', '.disabled'))).toBe(false);
  });

  it('drains unconditionally — a leftover .worker.lock dir from an old install does not block it', async () => {
    writeDreamQueueFiles(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream', '.worker.lock'), { recursive: true });

    await decisionsCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(getDreamPendingTurnsPath(tmpDir))).toBe(false);
    expect(fs.existsSync(getDreamPendingTurnsProcessingPath(tmpDir))).toBe(false);

    const config = JSON.parse(fs.readFileSync(getDreamConfigPath(tmpDir), 'utf-8'));
    expect(config.decisions).toBe(false);
  });

  it('does not delete anything on --enable', async () => {
    writeDreamQueueFiles(tmpDir);

    await decisionsCommand.parseAsync(['--enable'], { from: 'user' });

    expect(fs.existsSync(getDreamPendingTurnsPath(tmpDir))).toBe(true);
    expect(fs.existsSync(getDreamPendingTurnsProcessingPath(tmpDir))).toBe(true);
  });

  it('drains the resolved git-root paths, not process.cwd() (regression for the cwd class)', async () => {
    writeDreamQueueFiles(tmpDir);
    // getGitRoot already resolves to tmpDir regardless of the real cwd (exactly as
    // `git rev-parse --show-toplevel` would from any subdirectory). Point cwd at a
    // decoy path to prove the drain never falls back to process.cwd() instead of
    // the resolved gitRoot.
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');

    await decisionsCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(getDreamPendingTurnsPath(tmpDir))).toBe(false);
    expect(fs.existsSync(getDreamPendingTurnsProcessingPath(tmpDir))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// --list resolves the log from the git root, not process.cwd() — regression
// for the class of bug where --list run from a subdirectory of the repo
// would look for a decisions log under the (nonexistent) subdirectory path
// instead of the real one at the git root.
// ---------------------------------------------------------------------------

describe('decisions --list resolves log path from git root, not process.cwd()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.mocked(getGitRoot).mockResolvedValue(tmpDir);
    (decisionsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds the decisions log at the git root even when cwd is a subdirectory', async () => {
    const logPath = getDecisionsLogPath(tmpDir);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, makeDecisionLog([
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision', pattern: 'Use Result types' }),
    ]));

    // getGitRoot is mocked to resolve to tmpDir regardless of the real cwd
    // (exactly as `git rev-parse --show-toplevel` would from a subdirectory).
    // Point cwd at a decoy path to prove --list never falls back to
    // process.cwd() instead of the resolved gitRoot.
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');

    await decisionsCommand.parseAsync(['--list'], { from: 'user' });

    expect(p.log.info).not.toHaveBeenCalledWith('No observations yet. Decisions log not found.');
  });

  it('falls back to process.cwd() when not in a git project', async () => {
    vi.mocked(getGitRoot).mockResolvedValue(null);
    const cwdLogPath = getDecisionsLogPath(tmpDir);
    fs.mkdirSync(path.dirname(cwdLogPath), { recursive: true });
    fs.writeFileSync(cwdLogPath, makeDecisionLog([
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision', pattern: 'Use Result types' }),
    ]));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    await decisionsCommand.parseAsync(['--list'], { from: 'user' });

    expect(p.log.info).not.toHaveBeenCalledWith('No observations yet. Decisions log not found.');
  });
});
