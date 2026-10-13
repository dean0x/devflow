// tests/hud-codex-usage.test.ts
// Tests for the HUD's Codex usage reader: newest-modified rollout selection,
// bounded tail scan, record filtering and the 30 s cache (D-CODEX-LOCAL-LOGS-ONLY).
// Fixtures follow the token_count lines Codex CLI 0.162.1 writes to
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl; every path is a temp dir.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CODEX_MAX_AGE_MS,
  CODEX_TAIL_BYTES,
  CODEX_TAIL_RETRY_BYTES,
  codexSessionsDir,
  gatherCodexUsage,
  readCodexUsage,
} from '../src/hud/codex-usage.js';
import { hudCacheDir } from '../src/core/cache.js';

const NOW = Date.UTC(2026, 9, 13, 8, 0, 0); // 2026-10-13T08:00:00Z
const DAY_MS = 24 * 60 * 60 * 1000;
const RESETS_AT = Math.floor(NOW / 1000) + 6 * 86400;

interface WindowFixture {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_at?: unknown;
}

function window(minutes: number, usedPercent: number, resetsAt = RESETS_AT): WindowFixture {
  return { used_percent: usedPercent, window_minutes: minutes, resets_at: resetsAt };
}

/** A token_count line shaped like a real one; `rateLimits` replaces the rate_limits value. */
function tokenCountLine(rateLimits: unknown, timestamp = '2026-10-13T07:43:10.706Z'): string {
  return JSON.stringify({
    timestamp,
    ordinal: 2745,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: 49487461, output_tokens: 326154 } },
      rate_limits: rateLimits,
    },
  });
}

function codexRecord(
  primary: WindowFixture | null,
  secondary: WindowFixture | null = null,
  reached: string | null = null,
): string {
  return tokenCountLine({
    limit_id: 'codex',
    limit_name: null,
    primary,
    secondary,
    credits: { has_credits: false, unlimited: false, balance: '0' },
    individual_limit: null,
    spend_control_reached: null,
    plan_type: 'prolite',
    rate_limit_reached_type: reached,
  });
}

const NOISE_LINE = JSON.stringify({ type: 'response_item', payload: { type: 'message', text: 'x'.repeat(900) } });

describe('Codex usage reader', () => {
  let tmpRoot: string;
  let sessionsDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-codex-usage-'));
    sessionsDir = path.join(tmpRoot, '.codex', 'sessions');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** Write a rollout under sessions/<day>/ and stamp its mtime `ageMs` before NOW. */
  function writeRollout(day: string, name: string, content: string, ageMs = 60_000): string {
    const dir = path.join(sessionsDir, ...day.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    const mtime = new Date(NOW - ageMs);
    fs.utimesSync(file, mtime, mtime);
    return file;
  }

  const lines = (...rows: string[]): string => rows.join('\n') + '\n';

  describe('record selection', () => {
    it('reads the weekly window on a plan whose only window is primary (prolite)', () => {
      writeRollout('2026/10/13', 'rollout-a.jsonl', lines(codexRecord(window(10080, 2))));
      expect(readCodexUsage(sessionsDir, NOW)).toEqual({
        windows: [{ minutes: 10080, usedPercent: 2, resetsAt: RESETS_AT }],
        limitReached: null,
      });
    });

    it('reads both windows on a plan with a 5h primary and a 7d secondary (team)', () => {
      writeRollout('2026/10/13', 'rollout-a.jsonl', lines(codexRecord(window(300, 40, RESETS_AT - 5 * 86400), window(10080, 12))));
      const usage = readCodexUsage(sessionsDir, NOW);
      expect(usage?.windows.map((w) => [w.minutes, w.usedPercent])).toEqual([[300, 40], [10080, 12]]);
    });

    it('identifies a window by window_minutes, never by its slot', () => {
      writeRollout('2026/10/13', 'rollout-a.jsonl', lines(codexRecord(window(10080, 12), window(300, 40))));
      const usage = readCodexUsage(sessionsDir, NOW);
      expect(usage?.windows.map((w) => w.minutes)).toEqual([300, 10080]);
    });

    it('takes the last valid record in the file', () => {
      writeRollout(
        '2026/10/13',
        'rollout-a.jsonl',
        lines(codexRecord(window(10080, 2)), NOISE_LINE, codexRecord(window(10080, 7)), NOISE_LINE),
      );
      expect(readCodexUsage(sessionsDir, NOW)?.windows[0]?.usedPercent).toBe(7);
    });

    it('carries rate_limit_reached_type as limitReached', () => {
      writeRollout('2026/10/13', 'rollout-a.jsonl', lines(codexRecord(window(10080, 100), null, 'rate_limit_reached')));
      expect(readCodexUsage(sessionsDir, NOW)?.limitReached).toBe('rate_limit_reached');
    });

    it('clamps used_percent into 0-100', () => {
      writeRollout('2026/10/13', 'rollout-a.jsonl', lines(codexRecord(window(300, 140), window(10080, -5))));
      expect(readCodexUsage(sessionsDir, NOW)?.windows.map((w) => w.usedPercent)).toEqual([100, 0]);
    });

    it('skips premium, null-primary, null rate_limits, non-token_count and malformed lines', () => {
      const premium = tokenCountLine({ limit_id: 'premium', primary: null, secondary: null });
      const nullPrimary = codexRecord(null, null);
      const nullRateLimits = tokenCountLine(null);
      const otherEvent = JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', rate_limits: { limit_id: 'codex', primary: window(10080, 99) } } });
      const missingFields = codexRecord({ used_percent: 50, window_minutes: 10080 });
      const stringPercent = codexRecord({ used_percent: '50', window_minutes: 10080, resets_at: RESETS_AT });
      const malformed = '{"timestamp":"2026-10-13T07:43:10.706Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex"';
      writeRollout(
        '2026/10/13',
        'rollout-a.jsonl',
        lines(codexRecord(window(10080, 3)), premium, nullPrimary, nullRateLimits, otherEvent, missingFields, stringPercent, '{not json', malformed),
      );
      expect(readCodexUsage(sessionsDir, NOW)?.windows).toEqual([{ minutes: 10080, usedPercent: 3, resetsAt: RESETS_AT }]);
    });

    it('keeps the valid window when the other window is incomplete', () => {
      writeRollout('2026/10/13', 'rollout-a.jsonl', lines(codexRecord(window(300, 40), { used_percent: 12, window_minutes: 10080 })));
      expect(readCodexUsage(sessionsDir, NOW)?.windows.map((w) => w.minutes)).toEqual([300]);
    });
  });

  describe('file selection', () => {
    it('prefers the newest-modified rollout over the newest-named folder (D-CODEX-NEWEST-MTIME)', () => {
      writeRollout('2026/10/13', 'rollout-new-folder.jsonl', lines(codexRecord(window(10080, 10))), 3 * DAY_MS);
      writeRollout('2026/10/10', 'rollout-old-session-still-written.jsonl', lines(codexRecord(window(10080, 50))), 60_000);
      expect(readCodexUsage(sessionsDir, NOW)?.windows[0]?.usedPercent).toBe(50);
    });

    it('falls back to the next-newest rollout when the newest has no valid record', () => {
      writeRollout('2026/10/13', 'rollout-fresh-empty.jsonl', lines(JSON.stringify({ type: 'session_meta', payload: {} })), 1_000);
      writeRollout('2026/10/12', 'rollout-earlier.jsonl', lines(codexRecord(window(10080, 21))), 2 * 3_600_000);
      expect(readCodexUsage(sessionsDir, NOW)?.windows[0]?.usedPercent).toBe(21);
    });

    it('tries only the three newest rollouts', () => {
      const empty = lines(JSON.stringify({ type: 'session_meta', payload: {} }));
      writeRollout('2026/10/13', 'rollout-1.jsonl', empty, 1_000);
      writeRollout('2026/10/13', 'rollout-2.jsonl', empty, 2_000);
      writeRollout('2026/10/13', 'rollout-3.jsonl', empty, 3_000);
      writeRollout('2026/10/13', 'rollout-4.jsonl', lines(codexRecord(window(10080, 21))), 4_000);
      expect(readCodexUsage(sessionsDir, NOW)).toBeNull();
    });

    it('ignores files that are not rollout-*.jsonl or are symbolic links', () => {
      writeRollout('2026/10/12', 'rollout-real.jsonl', lines(codexRecord(window(10080, 30))), 5 * 3_600_000);
      writeRollout('2026/10/13', 'notes.jsonl', lines(codexRecord(window(10080, 80))));
      writeRollout('2026/10/13', 'rollout-a.txt', lines(codexRecord(window(10080, 81))));
      const linked = path.join(tmpRoot, 'elsewhere.jsonl');
      fs.writeFileSync(linked, lines(codexRecord(window(10080, 82))));
      fs.utimesSync(linked, new Date(NOW - 1_000), new Date(NOW - 1_000));
      fs.symlinkSync(linked, path.join(sessionsDir, '2026', '10', '13', 'rollout-link.jsonl'));
      expect(readCodexUsage(sessionsDir, NOW)?.windows[0]?.usedPercent).toBe(30);
    });

    it('searches only the 14 newest day directories', () => {
      const record = lines(codexRecord(window(10080, 5)));
      for (let day = 2; day <= 15; day++) {
        fs.mkdirSync(path.join(sessionsDir, '2026', '10', String(day).padStart(2, '0')), { recursive: true });
      }
      writeRollout('2026/10/01', 'rollout-outside.jsonl', record);
      expect(readCodexUsage(sessionsDir, NOW)).toBeNull();
      writeRollout('2026/10/02', 'rollout-inside.jsonl', record);
      expect(readCodexUsage(sessionsDir, NOW)?.windows[0]?.usedPercent).toBe(5);
    });

    it('orders day directories across month and year boundaries', () => {
      const record = lines(codexRecord(window(10080, 8)));
      for (let day = 2; day <= 14; day++) {
        fs.mkdirSync(path.join(sessionsDir, '2026', '01', String(day).padStart(2, '0')), { recursive: true });
      }
      writeRollout('2025/12/31', 'rollout-a.jsonl', record);
      expect(readCodexUsage(sessionsDir, NOW)?.windows[0]?.usedPercent).toBe(8);
      fs.mkdirSync(path.join(sessionsDir, '2026', '01', '01'), { recursive: true });
      expect(readCodexUsage(sessionsDir, NOW)).toBeNull();
    });

    it('returns null when the newest rollout is older than 8 days', () => {
      writeRollout('2026/10/05', 'rollout-a.jsonl', lines(codexRecord(window(10080, 9))), CODEX_MAX_AGE_MS + 60_000);
      expect(readCodexUsage(sessionsDir, NOW)).toBeNull();
    });

    it('returns null when there is no sessions directory', () => {
      expect(readCodexUsage(sessionsDir, NOW)).toBeNull();
    });

    it('returns null when the sessions directory is empty', () => {
      fs.mkdirSync(sessionsDir, { recursive: true });
      expect(readCodexUsage(sessionsDir, NOW)).toBeNull();
    });
  });

  describe('bounded tail', () => {
    const padTo = (bytes: number): string[] => {
      const rows: string[] = [];
      for (let size = 0; size < bytes; size += NOISE_LINE.length + 1) rows.push(NOISE_LINE);
      return rows;
    };

    it('finds a record beyond the first tail through the one larger retry', () => {
      const content = lines(codexRecord(window(10080, 17)), ...padTo(CODEX_TAIL_BYTES + 4096));
      expect(content.length).toBeLessThan(CODEX_TAIL_RETRY_BYTES);
      writeRollout('2026/10/13', 'rollout-a.jsonl', content);
      expect(readCodexUsage(sessionsDir, NOW)?.windows[0]?.usedPercent).toBe(17);
    });

    it('stops at the retry tail: a record beyond it is not found', () => {
      const content = lines(codexRecord(window(10080, 17)), ...padTo(CODEX_TAIL_RETRY_BYTES + 4096));
      writeRollout('2026/10/13', 'rollout-a.jsonl', content);
      expect(readCodexUsage(sessionsDir, NOW)).toBeNull();
    });
  });
});

describe('gatherCodexUsage', () => {
  let tmpRoot: string;
  let sessionsDir: string;
  let devflowDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-codex-gather-'));
    sessionsDir = path.join(tmpRoot, '.codex', 'sessions');
    devflowDir = path.join(tmpRoot, '.devflow');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function seedRollout(percent: number): void {
    const dir = path.join(sessionsDir, '2026', '10', '13');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'rollout-a.jsonl');
    fs.writeFileSync(file, codexRecord(window(10080, percent)) + '\n');
    const mtime = new Date(NOW - 60_000);
    fs.utimesSync(file, mtime, mtime);
  }

  const cacheFile = (): string => path.join(hudCacheDir(devflowDir), 'codex-quota.json');

  it('reads the logs, then serves the cache while it is fresh', async () => {
    seedRollout(2);
    const first = await gatherCodexUsage(devflowDir, sessionsDir, NOW);
    expect(first?.windows[0]?.usedPercent).toBe(2);
    expect(fs.existsSync(cacheFile())).toBe(true);

    seedRollout(9);
    const second = await gatherCodexUsage(devflowDir, sessionsDir, NOW);
    expect(second?.windows[0]?.usedPercent).toBe(2);
  });

  it('returns null and writes no cache entry when there is no Codex data', async () => {
    expect(await gatherCodexUsage(devflowDir, sessionsDir, NOW)).toBeNull();
    expect(fs.existsSync(cacheFile())).toBe(false);
  });

  it('rereads the logs when the cache entry fails validation', async () => {
    seedRollout(4);
    fs.mkdirSync(hudCacheDir(devflowDir), { recursive: true });
    fs.writeFileSync(
      cacheFile(),
      JSON.stringify({ data: { windows: [{ minutes: 'x' }], limitReached: null }, timestamp: Date.now(), ttl: 30_000 }),
    );
    expect((await gatherCodexUsage(devflowDir, sessionsDir, NOW))?.windows[0]?.usedPercent).toBe(4);
  });
});

describe('codexSessionsDir', () => {
  it('resolves under <home>/.codex/sessions', () => {
    expect(codexSessionsDir('/home/someone')).toBe(path.join('/home/someone', '.codex', 'sessions'));
  });
});
