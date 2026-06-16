import { describe, it, expect } from 'vitest';
import { countDenyEntries } from '../src/cli/commands/security.js';

describe('countDenyEntries', () => {
  it('returns the length of a valid deny array', () => {
    const settings = JSON.stringify({
      permissions: {
        deny: ['Bash(rm -rf /*)', 'Bash(sudo *)', 'Read(.env)'],
      },
    });
    expect(countDenyEntries(settings)).toBe(3);
  });

  it('returns 0 on JSON parse error', () => {
    expect(countDenyEntries('{ not valid json')).toBe(0);
  });

  it('returns 0 when the deny key is absent', () => {
    const settings = JSON.stringify({ permissions: { allow: [] } });
    expect(countDenyEntries(settings)).toBe(0);
  });

  it('returns 0 when deny is not an array (string value)', () => {
    const settings = JSON.stringify({ permissions: { deny: 'Bash(rm -rf /*)' } });
    expect(countDenyEntries(settings)).toBe(0);
  });

  it('returns 0 when permissions key is absent', () => {
    const settings = JSON.stringify({ hooks: {} });
    expect(countDenyEntries(settings)).toBe(0);
  });

  it('returns 0 for an empty deny array', () => {
    const settings = JSON.stringify({ permissions: { deny: [] } });
    expect(countDenyEntries(settings)).toBe(0);
  });

  it('returns 0 when deny is null', () => {
    const settings = JSON.stringify({ permissions: { deny: null } });
    expect(countDenyEntries(settings)).toBe(0);
  });
});
