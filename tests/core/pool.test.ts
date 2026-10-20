/**
 * pooled — bounded concurrency over an array, settling every item in input order.
 */
import { describe, it, expect } from 'vitest';
import { pooled } from '../../src/core/pool.js';

describe('pooled', () => {
  it('settles every item and keeps the input order, with a rejection in place', async () => {
    const results = await pooled([1, 2, 3, 4, 5], 2, async n => {
      if (n === 3) throw new Error('three failed');
      return n * 10;
    });
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(results.map(r => (r.status === 'fulfilled' ? r.value : null))).toEqual([10, 20, null, 40, 50]);
    const failed = results[2];
    expect(failed.status === 'rejected' && (failed.reason as Error).message).toBe('three failed');
  });

  it('never runs more than `limit` items at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await pooled(Array.from({ length: 7 }, (_, i) => i), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running -= 1;
    });
    expect(results).toHaveLength(7);
    expect(peak).toBe(3);
  });

  it('answers an empty list with no calls', async () => {
    let calls = 0;
    expect(await pooled([], 4, async () => { calls += 1; })).toEqual([]);
    expect(calls).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a limit of %s before it runs any item', async limit => {
    let calls = 0;
    await expect(pooled([1, 2], limit, async () => { calls += 1; })).rejects.toThrow(RangeError);
    expect(calls).toBe(0);
  });
});
