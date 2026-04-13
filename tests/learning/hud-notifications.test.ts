import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getActiveNotification } from '../../src/cli/hud/notifications.js';
import { isNotificationMap } from '../../src/cli/utils/notifications-shape.js';

describe('getActiveNotification', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-notif-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no notifications file', () => {
    expect(getActiveNotification(tmpDir)).toBeNull();
  });

  it('returns null when all notifications inactive', () => {
    fs.writeFileSync(
      path.join(memoryDir, '.notifications.json'),
      JSON.stringify({ 'knowledge-capacity-decisions': { active: false, threshold: 50, count: 50, ceiling: 100, severity: 'dim' } }),
    );
    expect(getActiveNotification(tmpDir)).toBeNull();
  });

  it('returns active notification with correct text', () => {
    fs.writeFileSync(
      path.join(memoryDir, '.notifications.json'),
      JSON.stringify({
        'knowledge-capacity-decisions': {
          active: true, threshold: 70, count: 72, ceiling: 100,
          dismissed_at_threshold: null, severity: 'warning',
          created_at: '2026-01-01T00:00:00Z',
        },
      }),
    );
    const result = getActiveNotification(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('warning');
    expect(result!.text).toContain('decisions at 72/100');
    expect(result!.text).toContain('devflow learn --review');
  });

  it('returns null when notification is dismissed at current threshold', () => {
    fs.writeFileSync(
      path.join(memoryDir, '.notifications.json'),
      JSON.stringify({
        'knowledge-capacity-decisions': {
          active: true, threshold: 70, count: 72, ceiling: 100,
          dismissed_at_threshold: 70, severity: 'warning',
        },
      }),
    );
    expect(getActiveNotification(tmpDir)).toBeNull();
  });

  it('returns notification when dismissed at lower threshold but new threshold crossed', () => {
    fs.writeFileSync(
      path.join(memoryDir, '.notifications.json'),
      JSON.stringify({
        'knowledge-capacity-decisions': {
          active: true, threshold: 80, count: 82, ceiling: 100,
          dismissed_at_threshold: 70, severity: 'warning',
        },
      }),
    );
    const result = getActiveNotification(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('warning');
  });

  it('picks worst severity when multiple files have notifications (D27)', () => {
    fs.writeFileSync(
      path.join(memoryDir, '.notifications.json'),
      JSON.stringify({
        'knowledge-capacity-decisions': {
          active: true, threshold: 60, count: 62, ceiling: 100,
          dismissed_at_threshold: null, severity: 'dim',
        },
        'knowledge-capacity-pitfalls': {
          active: true, threshold: 90, count: 92, ceiling: 100,
          dismissed_at_threshold: null, severity: 'error',
        },
      }),
    );
    const result = getActiveNotification(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.text).toContain('pitfalls at 92/100');
  });

  it('handles malformed JSON gracefully', () => {
    fs.writeFileSync(path.join(memoryDir, '.notifications.json'), '{bad');
    expect(getActiveNotification(tmpDir)).toBeNull();
  });

  it('isSeverity fallback: unknown severity value falls back to dim', () => {
    // Verify that a notification with a non-standard severity string still returns
    // a result — isSeverity('purple') → false, so the guard falls back to 'dim'.
    fs.writeFileSync(
      path.join(memoryDir, '.notifications.json'),
      JSON.stringify({
        'knowledge-capacity-decisions': {
          active: true, threshold: 70, count: 72, ceiling: 100,
          dismissed_at_threshold: null, severity: 'purple',
          created_at: '2026-01-01T00:00:00Z',
        },
      }),
    );
    const result = getActiveNotification(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('dim');
  });

  it('isSeverity fallback: null severity falls back to dim', () => {
    fs.writeFileSync(
      path.join(memoryDir, '.notifications.json'),
      JSON.stringify({
        'knowledge-capacity-decisions': {
          active: true, threshold: 70, count: 72, ceiling: 100,
          dismissed_at_threshold: null, severity: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      }),
    );
    const result = getActiveNotification(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('dim');
  });
});

describe('isNotificationMap adversarial inputs', () => {
  it('rejects null', () => {
    expect(isNotificationMap(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isNotificationMap(undefined)).toBe(false);
  });

  it('rejects array', () => {
    expect(isNotificationMap([])).toBe(false);
  });

  it('rejects number', () => {
    expect(isNotificationMap(42)).toBe(false);
  });

  it('rejects string', () => {
    expect(isNotificationMap('string')).toBe(false);
  });

  it('rejects map with primitive entry value', () => {
    // The STRONGER guard: each value must itself be a non-null object
    expect(isNotificationMap({ foo: 42 })).toBe(false);
  });

  it('rejects map with null entry value', () => {
    expect(isNotificationMap({ foo: null })).toBe(false);
  });

  it('rejects map with array entry value', () => {
    expect(isNotificationMap({ foo: [] })).toBe(false);
  });

  it('accepts empty map', () => {
    expect(isNotificationMap({})).toBe(true);
  });

  it('accepts map with valid object entries', () => {
    expect(isNotificationMap({ foo: { active: true, count: 1 } })).toBe(true);
  });

  it('accepts map with multiple valid entries', () => {
    expect(isNotificationMap({
      'knowledge-capacity-decisions': { active: true, count: 72, ceiling: 100, severity: 'warning' },
      'knowledge-capacity-pitfalls': { active: false },
    })).toBe(true);
  });
});
