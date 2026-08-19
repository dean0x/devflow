import { describe, it, expect } from 'vitest';
import { noop } from '../src/core/noop.js';

describe('noop', () => {
  it('returns undefined when called with no arguments', () => {
    expect(noop()).toBeUndefined();
  });

  it('returns undefined when called with multiple arguments', () => {
    expect(noop(1, 'two', { three: 3 })).toBeUndefined();
  });
});
