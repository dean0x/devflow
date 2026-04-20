import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Must set DEVFLOW_DIR before importing to control getCostFilePaths.
// cost-history.ts has module-level singletons (sessionsDirCreated, cachedAggregation)
// that must be reset between tests. vi.resetModules() clears the module cache so each
// dynamic import gets a fresh module instance with those singletons reset to initial values.

let tmpDir: string;

function setDevflowDir(dir: string): void {
  process.env.DEVFLOW_DIR = dir;
}

function getSessionsDir(): string {
  return path.join(tmpDir, 'costs', 'sessions');
}

function getArchivePath(): string {
  return path.join(tmpDir, 'costs', 'archive.jsonl');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-history-test-'));
  setDevflowDir(tmpDir);
  // Reset module cache so module-level singletons (sessionsDirCreated, cachedAggregation)
  // are re-initialized on the next dynamic import.
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DEVFLOW_DIR;
});

// Dynamic imports so DEVFLOW_DIR is respected
async function importCostHistory() {
  // Dynamic import — getCostFilePaths reads DEVFLOW_DIR at call time
  const mod = await import('../src/cli/hud/cost-history.js');
  return mod;
}

describe('getCostFilePaths', () => {
  it('uses DEVFLOW_DIR env var', async () => {
    const { getCostFilePaths } = await importCostHistory();
    const { sessionsDir, archivePath } = getCostFilePaths();
    expect(sessionsDir).toBe(path.join(tmpDir, 'costs', 'sessions'));
    expect(archivePath).toBe(path.join(tmpDir, 'costs', 'archive.jsonl'));
  });
});

describe('persistSessionCost', () => {
  it('creates sessions/ directory on first write', async () => {
    const { persistSessionCost } = await importCostHistory();
    expect(fs.existsSync(getSessionsDir())).toBe(false);
    persistSessionCost('session-1', 1.42, '/test/cwd');
    expect(fs.existsSync(getSessionsDir())).toBe(true);
  });

  it('writes sessions/{session_id}.json with correct format', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('session-abc', 2.50, '/my/project');

    const filePath = path.join(getSessionsDir(), 'session-abc.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw) as { session_id: string; cost_usd: number; timestamp: number; cwd: string };
    expect(entry.session_id).toBe('session-abc');
    expect(entry.cost_usd).toBe(2.50);
    expect(typeof entry.timestamp).toBe('number');
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.cwd).toBe('/my/project');
  });

  it('performs atomic write (no .tmp file after completion)', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('session-atomic', 1.00, '/cwd');

    const sessionsDir = getSessionsDir();
    const files = fs.readdirSync(sessionsDir);
    // Only the final .json file, no .tmp
    expect(files).toContain('session-atomic.json');
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('skips write when cost is 0', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('session-zero', 0, '/cwd');
    expect(fs.existsSync(getSessionsDir())).toBe(false);
  });

  it('skips write when cost is undefined/falsy', async () => {
    const { persistSessionCost } = await importCostHistory();
    // TypeScript won't normally let us pass undefined, but test the runtime guard
    persistSessionCost('session-undef', undefined as unknown as number, '/cwd');
    expect(fs.existsSync(getSessionsDir())).toBe(false);
  });

  it('overwrites same session file on subsequent renders', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('session-overwrite', 1.00, '/cwd');
    persistSessionCost('session-overwrite', 2.00, '/cwd');

    const filePath = path.join(getSessionsDir(), 'session-overwrite.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw) as { cost_usd: number };
    expect(entry.cost_usd).toBe(2.00);
  });

  it('concurrent sessions write to separate files', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('session-a', 1.00, '/cwd');
    persistSessionCost('session-b', 2.00, '/cwd');
    persistSessionCost('session-c', 3.00, '/cwd');

    const files = fs.readdirSync(getSessionsDir()).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(3);
    expect(files).toContain('session-a.json');
    expect(files).toContain('session-b.json');
    expect(files).toContain('session-c.json');
  });

  it('path traversal guard: sessionId containing / does not create a file', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('../../etc/passwd', 1.00, '/cwd');
    expect(fs.existsSync(getSessionsDir())).toBe(false);
  });

  it('path traversal guard: sessionId containing \\ does not create a file', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('..\\evil', 1.00, '/cwd');
    expect(fs.existsSync(getSessionsDir())).toBe(false);
  });

  it('path traversal guard: empty string sessionId does not create a file', async () => {
    const { persistSessionCost } = await importCostHistory();
    persistSessionCost('', 1.00, '/cwd');
    expect(fs.existsSync(getSessionsDir())).toBe(false);
  });
});

describe('runCleanup', () => {
  it('archives session files older than 24 hours to archive.jsonl', async () => {
    const { persistSessionCost } = await importCostHistory();

    // Directly write a stale session file (timestamp > 24h ago)
    const sessionsDir = getSessionsDir();
    fs.mkdirSync(sessionsDir, { recursive: true });
    const staleTimestamp = Math.floor(Date.now() / 1000) - 2 * 86400; // 2 days ago
    const staleEntry = {
      session_id: 'stale-session',
      cost_usd: 3.50,
      timestamp: staleTimestamp,
      cwd: '/cwd',
    };
    fs.writeFileSync(
      path.join(sessionsDir, 'stale-session.json'),
      JSON.stringify(staleEntry),
    );

    // Trigger cleanup by calling persistSessionCost with a timestamp divisible by 50.
    // We control the clock indirectly: find the next epoch second % 50 === 0.
    // Simpler approach: call the internal via a sessionId that triggers it on a
    // matching second. Instead, directly call with a cost and verify via side-effects
    // by calling persistSessionCost repeatedly until cleanup fires — this is fragile.
    // Better: export runCleanup or test it via the archiveStaleSessionFiles path.
    // Since runCleanup is not exported, we write a fresh session and then manually
    // verify by directly writing a file with a stale timestamp and calling
    // persistSessionCost with a specially crafted epoch.
    //
    // The simplest approach without exporting runCleanup: write the stale file,
    // then use the module's internal trigger (timestamp % 50 === 0).
    // We mock Date.now to return an epoch where the seconds % 50 === 0.
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    // Find the nearest future second divisible by 50
    const targetSec = nowSec + (50 - (nowSec % 50)) % 50;
    const savedNow = Date.now;
    // Temporarily override Date.now so that nowEpoch() returns targetSec
    Date.now = () => targetSec * 1000;
    try {
      persistSessionCost('trigger-cleanup', 1.00, '/cwd');
    } finally {
      Date.now = savedNow;
    }

    // stale-session.json should have been archived
    expect(fs.existsSync(path.join(sessionsDir, 'stale-session.json'))).toBe(false);
    const archivePath = getArchivePath();
    expect(fs.existsSync(archivePath)).toBe(true);
    const archiveContent = fs.readFileSync(archivePath, 'utf-8');
    const lines = archiveContent.split('\n').filter((l) => l.trim().length > 0);
    const found = lines.some((line) => {
      try {
        const parsed = JSON.parse(line) as { session_id: string };
        return parsed.session_id === 'stale-session';
      } catch {
        return false;
      }
    });
    expect(found).toBe(true);
  });

  it('removes orphaned .tmp files older than 1 hour', async () => {
    const { runCleanup } = await importCostHistory();
    const sessionsDir = getSessionsDir();
    fs.mkdirSync(sessionsDir, { recursive: true });

    const tmpPath = path.join(sessionsDir, 'stale.json.tmp');
    fs.writeFileSync(tmpPath, 'stale-data');
    // Backdate mtime to 2 hours ago
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
    fs.utimesSync(tmpPath, new Date(twoHoursAgo), new Date(twoHoursAgo));

    runCleanup();

    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('keeps .tmp files younger than 1 hour', async () => {
    const { runCleanup } = await importCostHistory();
    const sessionsDir = getSessionsDir();
    fs.mkdirSync(sessionsDir, { recursive: true });

    const tmpPath = path.join(sessionsDir, 'recent.json.tmp');
    fs.writeFileSync(tmpPath, 'recent-data');
    // mtime is now (just created) — well within 1 hour

    runCleanup();

    expect(fs.existsSync(tmpPath)).toBe(true);
  });

  it('trims archive entries older than 90 days when exceeding threshold', async () => {
    const { runCleanup } = await importCostHistory();
    const sessionsDir = getSessionsDir();
    const archivePath = getArchivePath();
    fs.mkdirSync(sessionsDir, { recursive: true });

    const nowSec = Math.floor(Date.now() / 1000);
    const lines: string[] = [];

    // 300 entries from 100 days ago (older than 90-day cutoff)
    for (let i = 0; i < 300; i++) {
      lines.push(JSON.stringify({
        session_id: `old-${i}`,
        cost_usd: 1.00,
        timestamp: nowSec - 100 * 86400,
        cwd: '/cwd',
      }));
    }
    // 250 entries from 10 days ago (within 90-day cutoff)
    for (let i = 0; i < 250; i++) {
      lines.push(JSON.stringify({
        session_id: `recent-${i}`,
        cost_usd: 2.00,
        timestamp: nowSec - 10 * 86400,
        cwd: '/cwd',
      }));
    }

    fs.writeFileSync(archivePath, lines.join('\n') + '\n');
    expect(lines).toHaveLength(550); // exceeds 500 threshold

    runCleanup();

    const trimmed = fs.readFileSync(archivePath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    // Only the 250 recent entries should remain
    expect(trimmed).toHaveLength(250);
    const allRecent = trimmed.every((line) => {
      const entry = JSON.parse(line) as { session_id: string };
      return entry.session_id.startsWith('recent-');
    });
    expect(allRecent).toBe(true);
  });

  it('does not trim archive when under threshold', async () => {
    const { runCleanup } = await importCostHistory();
    const sessionsDir = getSessionsDir();
    const archivePath = getArchivePath();
    fs.mkdirSync(sessionsDir, { recursive: true });

    const nowSec = Math.floor(Date.now() / 1000);
    const lines: string[] = [];
    // 100 entries (well under 500 threshold), all old
    for (let i = 0; i < 100; i++) {
      lines.push(JSON.stringify({
        session_id: `old-${i}`,
        cost_usd: 1.00,
        timestamp: nowSec - 100 * 86400,
        cwd: '/cwd',
      }));
    }

    fs.writeFileSync(archivePath, lines.join('\n') + '\n');

    runCleanup();

    const after = fs.readFileSync(archivePath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    // All 100 entries remain — under threshold, no trimming
    expect(after).toHaveLength(100);
  });
});

describe('aggregateCosts', () => {
  it('returns null when no files exist', async () => {
    const { aggregateCosts } = await importCostHistory();
    const result = aggregateCosts('session-1', 0);
    expect(result).toBeNull();
  });

  it('reads single session file correctly', async () => {
    const { persistSessionCost, aggregateCosts } = await importCostHistory();
    persistSessionCost('session-1', 5.00, '/cwd');
    const result = aggregateCosts('session-1', 5.00);
    expect(result).not.toBeNull();
    expect(result!.weeklyCost).toBeGreaterThan(0);
    expect(result!.monthlyCost).toBeGreaterThan(0);
  });

  it('reads multiple concurrent session files', async () => {
    const { persistSessionCost, aggregateCosts } = await importCostHistory();
    persistSessionCost('session-a', 1.00, '/cwd');
    persistSessionCost('session-b', 2.00, '/cwd');
    persistSessionCost('session-c', 3.00, '/cwd');

    const result = aggregateCosts('session-x', 4.00);
    expect(result).not.toBeNull();
    // session-a + session-b + session-c + session-x = 10.00
    expect(result!.weeklyCost).toBeCloseTo(10.00, 2);
    expect(result!.monthlyCost).toBeCloseTo(10.00, 2);
  });

  it('reads archive.jsonl entries', async () => {
    const { aggregateCosts } = await importCostHistory();

    const archivePath = getArchivePath();
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const entry = JSON.stringify({
      session_id: 'archived-1',
      cost_usd: 7.50,
      timestamp: nowSeconds - 2 * 86400, // 2 days ago (within week)
      cwd: '/cwd',
    });
    fs.writeFileSync(archivePath, entry + '\n');

    const result = aggregateCosts('current-session', 1.00);
    expect(result).not.toBeNull();
    // archived-1 (7.50) + current (1.00) = 8.50
    expect(result!.weeklyCost).toBeCloseTo(8.50, 2);
  });

  it('merges session files and archive correctly', async () => {
    const { persistSessionCost, aggregateCosts } = await importCostHistory();

    // Write an active session
    persistSessionCost('session-active', 3.00, '/cwd');

    // Write an archive entry
    const archivePath = getArchivePath();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const archiveEntry = JSON.stringify({
      session_id: 'session-archived',
      cost_usd: 4.00,
      timestamp: nowSeconds - 3 * 86400, // 3 days ago
      cwd: '/cwd',
    });
    fs.writeFileSync(archivePath, archiveEntry + '\n');

    const result = aggregateCosts('session-current', 2.00);
    expect(result).not.toBeNull();
    // active(3) + archived(4) + current(2) = 9
    expect(result!.weeklyCost).toBeCloseTo(9.00, 2);
  });

  it('current session stdin is authoritative (overrides file)', async () => {
    const { persistSessionCost, aggregateCosts } = await importCostHistory();
    // File has old cost
    persistSessionCost('session-current', 1.00, '/cwd');
    // Stdin reports higher cost
    const result = aggregateCosts('session-current', 5.00);
    expect(result).not.toBeNull();
    // Should use stdin cost (5.00), not file cost (1.00)
    expect(result!.weeklyCost).toBeCloseTo(5.00, 2);
  });

  it('deduplicates by session_id (takes max cost)', async () => {
    const { aggregateCosts } = await importCostHistory();

    // Write archive with two entries for same session
    const archivePath = getArchivePath();
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lines = [
      JSON.stringify({ session_id: 'dup-session', cost_usd: 2.00, timestamp: nowSeconds - 3600, cwd: '/cwd' }),
      JSON.stringify({ session_id: 'dup-session', cost_usd: 5.00, timestamp: nowSeconds - 1800, cwd: '/cwd' }),
    ];
    fs.writeFileSync(archivePath, lines.join('\n') + '\n');

    const result = aggregateCosts('other-session', 1.00);
    expect(result).not.toBeNull();
    // dup-session deduplicates to max=5.00, plus other-session=1.00 = 6.00
    expect(result!.weeklyCost).toBeCloseTo(6.00, 2);
  });

  it('weekly sum: only sessions within last 7 days', async () => {
    const { aggregateCosts } = await importCostHistory();

    const archivePath = getArchivePath();
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lines = [
      // Within 7 days
      JSON.stringify({ session_id: 'recent', cost_usd: 10.00, timestamp: nowSeconds - 3 * 86400, cwd: '/cwd' }),
      // Outside 7 days
      JSON.stringify({ session_id: 'old', cost_usd: 50.00, timestamp: nowSeconds - 10 * 86400, cwd: '/cwd' }),
    ];
    fs.writeFileSync(archivePath, lines.join('\n') + '\n');

    const result = aggregateCosts('current-session', 2.00);
    expect(result).not.toBeNull();
    // recent(10) + current(2) = 12; old(50) excluded from weekly
    expect(result!.weeklyCost).toBeCloseTo(12.00, 2);
    // old(50) + recent(10) + current(2) = 62 (within 30 days)
    expect(result!.monthlyCost).toBeCloseTo(62.00, 2);
  });

  it('monthly sum: only sessions within last 30 days', async () => {
    const { aggregateCosts } = await importCostHistory();

    const archivePath = getArchivePath();
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lines = [
      // Within 30 days
      JSON.stringify({ session_id: 'monthly', cost_usd: 20.00, timestamp: nowSeconds - 25 * 86400, cwd: '/cwd' }),
      // Outside 30 days
      JSON.stringify({ session_id: 'veryold', cost_usd: 100.00, timestamp: nowSeconds - 35 * 86400, cwd: '/cwd' }),
    ];
    fs.writeFileSync(archivePath, lines.join('\n') + '\n');

    const result = aggregateCosts('current-session', 1.00);
    expect(result).not.toBeNull();
    // monthly(20) + current(1) = 21; veryold excluded
    expect(result!.monthlyCost).toBeCloseTo(21.00, 2);
    // Only current(1) within 7 days
    expect(result!.weeklyCost).toBeCloseTo(1.00, 2);
  });

  it('ignores malformed JSON lines in archive', async () => {
    const { aggregateCosts } = await importCostHistory();

    const archivePath = getArchivePath();
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lines = [
      'not-valid-json',
      JSON.stringify({ session_id: 'valid', cost_usd: 5.00, timestamp: nowSeconds - 1800, cwd: '/cwd' }),
      '{"broken":',
    ];
    fs.writeFileSync(archivePath, lines.join('\n') + '\n');

    const result = aggregateCosts('current', 0);
    // valid(5) is summed; malformed lines are ignored; current=0 means only file
    expect(result).not.toBeNull();
    expect(result!.weeklyCost).toBeCloseTo(5.00, 2);
  });

  it('ignores malformed session files', async () => {
    const { aggregateCosts } = await importCostHistory();

    const sessionsDir = getSessionsDir();
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'bad.json'), 'not-json');
    const nowSeconds = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(sessionsDir, 'good.json'),
      JSON.stringify({ session_id: 'good', cost_usd: 3.00, timestamp: nowSeconds, cwd: '/cwd' }),
    );

    const result = aggregateCosts('current', 0);
    expect(result).not.toBeNull();
    // good(3) is counted; bad.json skipped
    expect(result!.weeklyCost).toBeCloseTo(3.00, 2);
  });

  it('returns weeklyCost: null when no sessions in 7 days (only old archive entries)', async () => {
    const { aggregateCosts } = await importCostHistory();

    const archivePath = getArchivePath();
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Entry is older than 7 days but within 30 days
    const entry = JSON.stringify({
      session_id: 'old-session',
      cost_usd: 15.00,
      timestamp: nowSeconds - 10 * 86400,
      cwd: '/cwd',
    });
    fs.writeFileSync(archivePath, entry + '\n');

    // currentCostUsd=0 means no current session contribution
    const result = aggregateCosts('current-session', 0);
    // No session within last 7 days (current=0 is not counted)
    // Session map contains old-session only (10 days old)
    // weeklyCost is null because nothing is within 7 days
    // monthlyCost = 15 (within 30 days)
    expect(result).not.toBeNull();
    expect(result!.weeklyCost).toBeNull();
    expect(result!.monthlyCost).toBeCloseTo(15.00, 2);
  });
});
