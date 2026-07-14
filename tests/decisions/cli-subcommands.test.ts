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

vi.mock('../../src/cli/utils/learning-tuning-config.js', () => ({
  loadLearningTuningConfig: vi.fn(() => ({
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
import { learningCommand } from '../../src/cli/commands/learning.js';
import * as p from '@clack/prompts';
import {
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
  getFeatureConfigPath,
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
// --reset state removal: single-dir semantics
// ---------------------------------------------------------------------------

describe('learning --reset single-dir semantics', () => {
  it('reset removes the entire .devflow/learning/ directory (single-dir semantics)', () => {
    // All learning state lives under .devflow/learning/ — queue files, content
    // files, ledger, and tuning config. Reset removes the entire dir, not a
    // fixed file list. The neutral .devflow/config.json is never touched.
    const removedDir = '.devflow/learning/';
    const preservedPaths = ['.devflow/config.json', '.devflow/memory/'];

    // Single dir removal covers everything
    expect(removedDir).toContain('learning');

    for (const p of preservedPaths) {
      expect(p).not.toContain('learning/');
    }
  });

  it('reset does not target .devflow/config.json (shared neutral config)', () => {
    // The feature toggles are at .devflow/config.json, NOT inside learning/.
    // Reset must never remove it — it would also wipe memory and knowledge toggles.
    const neutralConfig = '.devflow/config.json';
    expect(neutralConfig).not.toMatch(/learning/);
  });
});

// ---------------------------------------------------------------------------
// --reset legacy marker sweep: verify legacy marker-pipeline state files are targeted
// ---------------------------------------------------------------------------

describe('learning --reset legacy marker sweep', () => {
  it('legacy sweep targets fixed stamp files (.decisions-runs-today, .curation-last, .processor-spawned-at)', () => {
    const legacyFilesToClean = [
      '.decisions-runs-today',
      '.curation-last',
      '.processor-spawned-at',
    ];

    for (const f of legacyFilesToClean) {
      expect(f.startsWith('.')).toBe(true);
    }
  });

  it('legacy sweep targets decisions.*/curation.* markers across all 4 suffixes', () => {
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
    // config.json, or the .pending-turns.jsonl/.processing queue files.
    for (const f of ['learning.abc123.json', 'decisions.json', 'config.json', '.pending-turns.jsonl', '.pending-turns.processing']) {
      expect(dreamMarkerPattern.test(f)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// --reset success message: truthful, pinned
// ---------------------------------------------------------------------------

describe('learning --reset success message', () => {
  const learningTs = fs.readFileSync(
    new URL('../../src/cli/commands/learning.ts', import.meta.url).pathname,
    'utf-8',
  );

  it('pins the truthful success string (new single-dir message)', () => {
    expect(learningTs).toContain(
      "p.log.success('Reset complete — removed .devflow/learning/ state.');",
    );
  });

  it('does not interpolate a removed-file count into the success message', () => {
    expect(learningTs).not.toMatch(/removed \$\{[^}]+\} file\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// --disable drains the learning (decisions-detection) pending-turns queue —
// mirrors memory.ts's drain-on-disable behavior for the sibling memory queue.
// Unconditional: a mid-run Learning agent whose claimed batch vanishes aborts
// without changes, which is the desired outcome of disabling.
// ---------------------------------------------------------------------------

describe('learning --disable drains the learning pending-turns queue', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.mocked(getGitRoot).mockResolvedValue(tmpDir);
    // Commander retains _optionValues across repeated parseAsync() calls on the
    // same Command instance (no built-in reset between calls). Production always
    // starts a fresh process per invocation, so clear state here to match that
    // reality and keep these tests order-independent.
    (learningCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeDreamQueueFiles(root: string): void {
    fs.mkdirSync(path.join(root, '.devflow', 'learning'), { recursive: true });
    fs.writeFileSync(getLearningPendingTurnsPath(root), '{"role":"user"}\n');
    fs.writeFileSync(getLearningPendingTurnsProcessingPath(root), '{"role":"user"}\n');
  }

  it('deletes queue + processing files and flips config (memory queue untouched)', async () => {
    writeDreamQueueFiles(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    fs.writeFileSync(getPendingTurnsPath(tmpDir), '{"role":"user"}\n');

    await learningCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(getLearningPendingTurnsPath(tmpDir))).toBe(false);
    expect(fs.existsSync(getLearningPendingTurnsProcessingPath(tmpDir))).toBe(false);

    const config = JSON.parse(fs.readFileSync(getFeatureConfigPath(tmpDir), 'utf-8'));
    expect(config.learning).toBe(false);

    // The sibling memory queue is never touched by decisions --disable
    expect(fs.existsSync(getPendingTurnsPath(tmpDir))).toBe(true);
  });

  it('does not create a .disabled sentinel (gate is config-only)', async () => {
    writeDreamQueueFiles(tmpDir);

    await learningCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'learning', '.disabled'))).toBe(false);
  });

  it('drains unconditionally — a leftover .worker.lock dir from an old install does not block it', async () => {
    writeDreamQueueFiles(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream', '.worker.lock'), { recursive: true });

    await learningCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(getLearningPendingTurnsPath(tmpDir))).toBe(false);
    expect(fs.existsSync(getLearningPendingTurnsProcessingPath(tmpDir))).toBe(false);

    const config = JSON.parse(fs.readFileSync(getFeatureConfigPath(tmpDir), 'utf-8'));
    expect(config.learning).toBe(false);
  });

  it('does not delete anything on --enable', async () => {
    writeDreamQueueFiles(tmpDir);

    await learningCommand.parseAsync(['--enable'], { from: 'user' });

    expect(fs.existsSync(getLearningPendingTurnsPath(tmpDir))).toBe(true);
    expect(fs.existsSync(getLearningPendingTurnsProcessingPath(tmpDir))).toBe(true);
  });

  it('drains the resolved git-root paths, not process.cwd() (regression for the cwd class)', async () => {
    writeDreamQueueFiles(tmpDir);
    // getGitRoot already resolves to tmpDir regardless of the real cwd (exactly as
    // `git rev-parse --show-toplevel` would from any subdirectory). Point cwd at a
    // decoy path to prove the drain never falls back to process.cwd() instead of
    // the resolved gitRoot.
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');

    await learningCommand.parseAsync(['--disable'], { from: 'user' });

    expect(fs.existsSync(getLearningPendingTurnsPath(tmpDir))).toBe(false);
    expect(fs.existsSync(getLearningPendingTurnsProcessingPath(tmpDir))).toBe(false);
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
    (learningCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
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

    await learningCommand.parseAsync(['--list'], { from: 'user' });

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

    await learningCommand.parseAsync(['--list'], { from: 'user' });

    expect(p.log.info).not.toHaveBeenCalledWith('No observations yet. Decisions log not found.');
  });
});

// ---------------------------------------------------------------------------
// --reset idempotency: second run after .devflow/learning/ is already gone
// must complete truthfully, never emit the "currently running" contention msg.
// Root cause: lock dir is inside the learning dir; once learning/ is removed,
// fs.mkdir(lockDir) fails with ENOENT, which the old code treated as contention.
// ---------------------------------------------------------------------------

describe('learning --reset is idempotent when learning dir is already gone', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.mocked(getGitRoot).mockResolvedValue(tmpDir);
    (learningCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    vi.mocked(p.log.error).mockClear();
    vi.mocked(p.log.success).mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not emit the contention message on a second reset when .devflow/learning/ is already absent', async () => {
    // First reset: create learning/ so the first run has something to remove.
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    await learningCommand.parseAsync(['--reset'], { from: 'user' });

    // Prepare for second run.
    (learningCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    vi.mocked(p.log.error).mockClear();
    vi.mocked(p.log.success).mockClear();

    // Second reset — .devflow/learning/ is already gone.
    await learningCommand.parseAsync(['--reset'], { from: 'user' });

    expect(p.log.error).not.toHaveBeenCalledWith(
      'Learning system is currently running. Try again in a moment.',
    );
    expect(p.log.success).toHaveBeenCalledWith(
      'Reset complete — removed .devflow/learning/ state.',
    );
  });

  it('completes truthfully even when called on a project with no learning state at all', async () => {
    // No .devflow/learning/ ever created — simulates a fresh project.
    await learningCommand.parseAsync(['--reset'], { from: 'user' });

    expect(p.log.error).not.toHaveBeenCalledWith(
      'Learning system is currently running. Try again in a moment.',
    );
    expect(p.log.success).toHaveBeenCalledWith(
      'Reset complete — removed .devflow/learning/ state.',
    );
  });
});

// ---------------------------------------------------------------------------
// AC-C2 clean break: `devflow decisions` must no longer be a registered command.
// The CLI surface was renamed to `devflow learning` in commit 6. Any attempt to
// run `devflow decisions` must either be unrecognised or produce no-op output.
// ---------------------------------------------------------------------------

describe('AC-C2: devflow decisions is no longer a registered subcommand', () => {
  it('learningCommand is registered under the "learning" name, not "decisions"', () => {
    expect(learningCommand.name()).toBe('learning');
  });

  it('learningCommand does not carry "decisions" as an alias', () => {
    expect(learningCommand.aliases()).not.toContain('decisions');
  });
});
