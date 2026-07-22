import { describe, it, expect } from 'vitest';
import {
  stripDevflowTeammateModeFromJson,
} from '../src/core/teammate-mode-cleanup.js';

describe('stripDevflowTeammateModeFromJson (string pipeline)', () => {
  it('removes teammateMode when value is exactly "auto"', () => {
    const input = JSON.stringify({ teammateMode: 'auto', env: { TOOL: 'true' } }, null, 2) + '\n';
    const result = JSON.parse(stripDevflowTeammateModeFromJson(input));
    expect(result.teammateMode).toBeUndefined();
    expect(result.env.TOOL).toBe('true');
  });

  it('preserves teammateMode when value is not "auto"', () => {
    const input = JSON.stringify({ teammateMode: 'tmux' }, null, 2) + '\n';
    const output = stripDevflowTeammateModeFromJson(input);
    expect(JSON.parse(output).teammateMode).toBe('tmux');
  });

  it('is a no-op when teammateMode key is absent', () => {
    const input = JSON.stringify({ hooks: { Stop: [] } }, null, 2) + '\n';
    expect(stripDevflowTeammateModeFromJson(input)).toBe(input);
  });

  it('returns input unchanged for malformed JSON', () => {
    const bad = 'not valid json {{{';
    expect(stripDevflowTeammateModeFromJson(bad)).toBe(bad);
  });

  it('returns input unchanged and does not throw for valid-JSON non-object roots (null, array, primitive)', () => {
    // Regression for JSON.parse("null") → null → null['teammateMode'] TypeError.
    // These inputs parse successfully but must be treated as no-ops because only
    // plain-object roots can carry the key.
    expect(stripDevflowTeammateModeFromJson('null')).toBe('null');
    expect(stripDevflowTeammateModeFromJson('[]')).toBe('[]');
    expect(stripDevflowTeammateModeFromJson('42')).toBe('42');
  });
});

