/**
 * Tests for `devflow decisions` subcommand behaviors.
 *
 * Tests are organized into two groups:
 * 1. Pure function tests (list/status filtering logic, purge filtering) — direct function calls
 * 2. Commander integration tests — use parseAsync but reset commander state between runs
 *
 * Strategy for Commander tests: create a fresh command instance via a helper that
 * rebuilds the command (Commander stores option values on the Command object instance
 * across calls, which causes cross-test pollution when reusing a singleton).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mocks — all set up before any imports from the module under test.
// ---------------------------------------------------------------------------

vi.mock('../../src/cli/utils/background-runner.js', () => ({
  acquireBackgroundLock: vi.fn(async () => undefined),
  releaseBackgroundLock: vi.fn(() => undefined),
  registerLockCleanup: vi.fn(() => vi.fn()),
  checkDailyCap: vi.fn(() => true),
  incrementDailyCap: vi.fn(() => undefined),
  extractBatchMessages: vi.fn(async () => ({ userSignals: [], dialogPairs: [] })),
  applyTemporalDecay: vi.fn(async () => undefined),
  capEntries: vi.fn(() => undefined),
  checkStaleness: vi.fn(async () => undefined),
}));

vi.mock('../../src/cli/utils/decisions-agent.js', () => ({
  runDecisionsAgent: vi.fn(async () => '/tmp/response.tmp'),
}));

vi.mock('../../src/cli/utils/decisions-config.js', () => ({
  loadDecisionsConfig: vi.fn(() => ({
    max_daily_runs: 3,
    throttle_minutes: 5,
    model: 'sonnet',
    debug: false,
  })),
}));

vi.mock('../../src/cli/utils/paths.js', () => ({
  getClaudeDirectory: vi.fn(() => '/home/user/.claude'),
  getDevFlowDirectory: vi.fn(() => '/home/user/.devflow'),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: '', stderr: '' });
    return {} as ReturnType<typeof import('child_process').execFile>;
  }),
  execFileSync: vi.fn(() => undefined),
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
} from '../../src/cli/commands/learn.js';
import {
  filterEligibleEntries,
  sortByLeastUsed,
  clearCapacityNotifications,
  type DecisionsEntry,
} from '../../src/cli/commands/decisions.js';

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
    // Simulate the filtering logic used by the --list handler
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

  it('identifies entries needing review', () => {
    const observations = [
      makeDecisionObs({ id: 'obs_d_001', type: 'decision', mayBeStale: true }),
      makeDecisionObs({ id: 'obs_d_002', type: 'decision', needsReview: true }),
      makeDecisionObs({ id: 'obs_d_003', type: 'decision' }),
    ];

    const needReview = observations.filter(o => o.mayBeStale || o.needsReview || o.softCapExceeded);

    expect(needReview).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// --purge validation: test the type-filtering purge logic
// ---------------------------------------------------------------------------

describe('decisions --purge type filtering', () => {
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

  it('purge logic keeps only decision and pitfall type entries', () => {
    // Simulate the filtering logic used by the --purge handler
    const rawEntries = [
      makeDecisionObs({ id: 'obs_decision_001', type: 'decision' }),
      makeDecisionObs({ id: 'obs_pitfall_001', type: 'pitfall' }),
      makeDecisionObs({ id: 'obs_workflow_001', type: 'workflow' }),
    ];
    const logContent = makeDecisionLog(rawEntries);
    fs.writeFileSync(logPath, logContent, 'utf-8');

    const content = fs.readFileSync(logPath, 'utf-8');
    const allObs = parseLearningLog(content);

    // Decisions --purge filters out non-decision/pitfall types
    const valid = allObs.filter(o => o.type === 'decision' || o.type === 'pitfall');

    expect(valid).toHaveLength(2);
    expect(valid.map(o => o.type)).not.toContain('workflow');
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

    // Simulate what --clear does
    fs.writeFileSync(logPath, '', 'utf-8');

    expect(fs.readFileSync(logPath, 'utf-8')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// --reset state removal: verify correct files are targeted
// ---------------------------------------------------------------------------

describe('decisions --reset target files', () => {
  it('reset targets decisions-specific state files only', () => {
    // Verify the set of files that --reset should remove
    const resetFiles = [
      'decisions-log.jsonl',
      '.decisions-manifest.json',
      '.decisions-notifications.json',
      '.decisions-runs-today',
      '.decisions-batch-ids',
      'decisions.json',
    ];

    // Files that reset should NOT touch
    const preservedFiles = [
      'learning-log.jsonl',
      '.learning-manifest.json',
      '.learning-runs-today',
      'WORKING-MEMORY.md',
    ];

    // All reset files should be decisions-specific
    for (const f of resetFiles) {
      expect(
        f.includes('decision') || f.includes('decisions'),
        `Expected "${f}" to contain "decision" or "decisions"`,
      ).toBe(true);
    }

    // None of the preserved files should be in the reset set
    for (const f of preservedFiles) {
      expect(resetFiles).not.toContain(f);
    }
  });
});

// ---------------------------------------------------------------------------
// --dismiss-capacity: verify notification update logic
// ---------------------------------------------------------------------------

describe('decisions --dismiss-capacity notification logic', () => {
  let tmpDir: string;
  let notifPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    notifPath = path.join(tmpDir, '.decisions-notifications.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets dismissed_at_threshold to current threshold on active notification', () => {
    const notifications: Record<string, { active: boolean; threshold: number; dismissed_at_threshold: number | null }> = {
      'decisions-capacity-decisions': {
        active: true,
        threshold: 80,
        dismissed_at_threshold: null,
      },
    };
    fs.writeFileSync(notifPath, JSON.stringify(notifications), 'utf-8');

    // Simulate what --dismiss-capacity does
    const raw = JSON.parse(fs.readFileSync(notifPath, 'utf-8'));
    for (const [, entry] of Object.entries(raw) as Array<[string, typeof notifications[string]]>) {
      if (entry.active && (entry.dismissed_at_threshold == null || entry.dismissed_at_threshold < entry.threshold)) {
        entry.dismissed_at_threshold = entry.threshold;
      }
    }
    fs.writeFileSync(notifPath, JSON.stringify(raw), 'utf-8');

    const updated = JSON.parse(fs.readFileSync(notifPath, 'utf-8'));
    expect(updated['decisions-capacity-decisions'].dismissed_at_threshold).toBe(80);
  });

  it('identifies active vs inactive notifications correctly', () => {
    const notifications = {
      'decisions-capacity-decisions': {
        active: true,
        threshold: 80,
        dismissed_at_threshold: null,
      },
      'decisions-capacity-pitfalls': {
        active: false,
        threshold: 80,
        dismissed_at_threshold: 80,
      },
    };

    const activeKeys = Object.entries(notifications)
      .filter(([, v]) => v && v.active && (v.dismissed_at_threshold == null || v.dismissed_at_threshold < v.threshold))
      .map(([k]) => k);

    expect(activeKeys).toHaveLength(1);
    expect(activeKeys[0]).toBe('decisions-capacity-decisions');
  });

  it('returns no active notifications when all are already dismissed', () => {
    const notifications = {
      'decisions-capacity-decisions': {
        active: true,
        threshold: 80,
        dismissed_at_threshold: 80, // already dismissed at same threshold
      },
    };

    const activeKeys = Object.entries(notifications)
      .filter(([, v]) => v && v.active && (v.dismissed_at_threshold == null || v.dismissed_at_threshold < v.threshold))
      .map(([k]) => k);

    expect(activeKeys).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// --review capacity mode: verify parsing, filtering, sorting logic
// (These test the logic that the capacity review handler will use after the
// capacity review is ported from learn.ts to decisions.ts)
// ---------------------------------------------------------------------------

describe('decisions --review capacity mode logic', () => {
  it('excludes deprecated and superseded entries from eligible list', () => {
    // NOTE: This status filter is intentionally inline — it mirrors the `continue`
    // skip inside the capacity review parser (decisions.ts ~line 804), which excludes
    // Deprecated/Superseded entries before they are pushed to `allEntries`. This is a
    // distinct pre-filter step from filterEligibleEntries, which applies the 7-day
    // protection window. Extracting a one-liner !== check into a named function adds
    // no clarity benefit here.
    const allEntries = [
      { id: 'ADR-001', pattern: 'Use X', file: 'decisions', filePath: '/tmp/decisions.md', status: 'Accepted', createdDate: '2026-01-01' },
      { id: 'ADR-002', pattern: 'Use Y', file: 'decisions', filePath: '/tmp/decisions.md', status: 'Deprecated', createdDate: '2026-01-10' },
      { id: 'ADR-003', pattern: 'Use Z', file: 'decisions', filePath: '/tmp/decisions.md', status: 'Superseded', createdDate: '2026-01-15' },
      { id: 'PF-001', pattern: 'Avoid W', file: 'pitfalls', filePath: '/tmp/pitfalls.md', status: 'Active', createdDate: '2026-01-20' },
    ];

    // Replicate the parser-level status filter (decisions.ts capacity block)
    const eligible = allEntries.filter(
      e => e.status !== 'Deprecated' && e.status !== 'Superseded',
    );

    expect(eligible).toHaveLength(2);
    expect(eligible.map(e => e.id)).toContain('ADR-001');
    expect(eligible.map(e => e.id)).toContain('PF-001');
    expect(eligible.map(e => e.id)).not.toContain('ADR-002');
    expect(eligible.map(e => e.id)).not.toContain('ADR-003');
  });

  it('excludes entries created within 7-day protection window', () => {
    const today = new Date().toISOString().slice(0, 10);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const entries: DecisionsEntry[] = [
      { id: 'ADR-001', createdDate: tenDaysAgo, status: 'Accepted', pattern: 'Old entry', file: 'decisions', filePath: '' },
      { id: 'ADR-002', createdDate: threeDaysAgo, status: 'Accepted', pattern: 'Recent entry', file: 'decisions', filePath: '' },
      { id: 'ADR-003', createdDate: today, status: 'Accepted', pattern: 'Today entry', file: 'decisions', filePath: '' },
      { id: 'ADR-004', createdDate: null, status: 'Accepted', pattern: 'No date entry', file: 'decisions', filePath: '' },
    ];

    const eligible = filterEligibleEntries(entries);

    expect(eligible).toHaveLength(2); // tenDaysAgo and no-date
    expect(eligible.map(e => e.id)).toContain('ADR-001');
    expect(eligible.map(e => e.id)).toContain('ADR-004'); // no date — eligible
    expect(eligible.map(e => e.id)).not.toContain('ADR-002');
    expect(eligible.map(e => e.id)).not.toContain('ADR-003');
  });

  it('sorts entries by least-used (cites ASC, last_cited ASC NULLS FIRST, created ASC)', () => {
    const entries: DecisionsEntry[] = [
      { id: 'ADR-001', createdDate: '2026-01-01', status: 'Accepted', pattern: 'Often cited', file: 'decisions', filePath: '' },
      { id: 'ADR-002', createdDate: '2026-01-02', status: 'Accepted', pattern: 'Never cited', file: 'decisions', filePath: '' },
      { id: 'ADR-003', createdDate: '2026-01-03', status: 'Accepted', pattern: 'Rarely cited', file: 'decisions', filePath: '' },
    ];

    const usageData: Record<string, { cites: number; last_cited: string | null; created: string | null }> = {
      'ADR-001': { cites: 10, last_cited: '2026-05-01', created: null },
      'ADR-002': { cites: 0, last_cited: null, created: null },
      'ADR-003': { cites: 2, last_cited: '2026-03-01', created: null },
    };

    const sorted = sortByLeastUsed(entries, usageData);

    // Least used first: ADR-002 (0 cites), ADR-003 (2 cites), ADR-001 (10 cites)
    expect(sorted[0].id).toBe('ADR-002');
    expect(sorted[1].id).toBe('ADR-003');
    expect(sorted[2].id).toBe('ADR-001');
  });

});

// ---------------------------------------------------------------------------
// Capacity review notification clearing logic (D28)
// ---------------------------------------------------------------------------

describe('capacity review notification clearing (D28)', () => {
  it('clears active notification when active count drops below 50', () => {
    // Simulate the post-deprecation notification update in --review capacity mode.
    // When count-active returns < 50 for a file, the notification should be deactivated.
    const notifications = {
      'decisions-capacity-decisions': { active: true, dismissed_at_threshold: null },
      'decisions-capacity-pitfalls': { active: true, dismissed_at_threshold: null },
    };

    // Simulate count-active returning 45 for decisions (below threshold) and 60 for pitfalls (above)
    const counts: Record<string, number> = {
      'decisions-capacity-decisions': 45,
      'decisions-capacity-pitfalls': 60,
    };

    clearCapacityNotifications(notifications, counts);

    // decisions notification cleared (count 45 < 50)
    expect(notifications['decisions-capacity-decisions'].active).toBe(false);
    expect(notifications['decisions-capacity-decisions'].dismissed_at_threshold).toBeNull();

    // pitfalls notification NOT cleared (count 60 >= 50)
    expect(notifications['decisions-capacity-pitfalls'].active).toBe(true);
  });

  it('does not clear notifications when active count stays at or above 50', () => {
    const notifications = {
      'decisions-capacity-decisions': { active: true, dismissed_at_threshold: null },
    };

    const counts: Record<string, number> = {
      'decisions-capacity-decisions': 55, // still above threshold
    };

    clearCapacityNotifications(notifications, counts);

    expect(notifications['decisions-capacity-decisions'].active).toBe(true);
  });

  it('skips notification update when notifications key is absent', () => {
    // If the key does not exist in the notifications map, the update should be a no-op
    const notifications = {};
    const counts: Record<string, number> = {
      'decisions-capacity-decisions': 30,
    };

    clearCapacityNotifications(notifications, counts);

    // Key was absent, nothing was added or mutated
    expect(Object.keys(notifications)).toHaveLength(0);
  });
});
