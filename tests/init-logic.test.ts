import { describe, it, expect } from 'vitest';
import {
  parsePluginSelection,
  substituteSettingsTemplate,
  computeGitignoreAppend,
  buildExtrasOptions,
} from '../src/cli/commands/init.js';
import { DEVFLOW_PLUGINS } from '../src/cli/plugins.js';

describe('parsePluginSelection', () => {
  it('parses comma-separated plugin names', () => {
    const { selected, invalid } = parsePluginSelection('devflow-implement,devflow-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-review']);
    expect(invalid).toEqual([]);
  });

  it('normalizes shorthand names (adds devflow- prefix)', () => {
    const { selected, invalid } = parsePluginSelection('implement,review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-review']);
    expect(invalid).toEqual([]);
  });

  it('handles mixed shorthand and full names', () => {
    const { selected, invalid } = parsePluginSelection('implement,devflow-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-review']);
    expect(invalid).toEqual([]);
  });

  it('trims whitespace', () => {
    const { selected, invalid } = parsePluginSelection('  implement , review  ', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-review']);
    expect(invalid).toEqual([]);
  });

  it('reports unknown plugins', () => {
    const { selected, invalid } = parsePluginSelection('implement,nonexistent', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-nonexistent']);
    expect(invalid).toEqual(['devflow-nonexistent']);
  });

  it('reports multiple unknown plugins', () => {
    const { invalid } = parsePluginSelection('foo,bar', DEVFLOW_PLUGINS);
    expect(invalid).toEqual(['devflow-foo', 'devflow-bar']);
  });

  it('handles single plugin', () => {
    const { selected, invalid } = parsePluginSelection('implement', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement']);
    expect(invalid).toEqual([]);
  });
});

describe('substituteSettingsTemplate', () => {
  it('replaces ${DEVFLOW_DIR} placeholders', () => {
    const template = '{"scripts": "${DEVFLOW_DIR}/scripts", "hooks": "${DEVFLOW_DIR}/hooks"}';
    const result = substituteSettingsTemplate(template, '/home/user/.devflow');
    expect(result).toBe('{"scripts": "/home/user/.devflow/scripts", "hooks": "/home/user/.devflow/hooks"}');
  });

  it('returns template unchanged when no placeholders', () => {
    const template = '{"key": "value"}';
    const result = substituteSettingsTemplate(template, '/home/user/.devflow');
    expect(result).toBe('{"key": "value"}');
  });

  it('handles empty template', () => {
    expect(substituteSettingsTemplate('', '/dir')).toBe('');
  });

  it('handles multiple occurrences', () => {
    const template = '${DEVFLOW_DIR} and ${DEVFLOW_DIR} again';
    const result = substituteSettingsTemplate(template, '/d');
    expect(result).toBe('/d and /d again');
  });
});

describe('buildExtrasOptions', () => {
  it('returns settings, claude-md, safe-delete for user scope without gitRoot', () => {
    const options = buildExtrasOptions('user', null);
    const values = options.map(o => o.value);
    expect(values).toEqual(['settings', 'claude-md', 'safe-delete']);
  });

  it('adds claudeignore when gitRoot exists (user scope)', () => {
    const options = buildExtrasOptions('user', '/repo');
    const values = options.map(o => o.value);
    expect(values).toEqual(['settings', 'claude-md', 'claudeignore', 'safe-delete']);
  });

  it('returns all 6 options for local scope with gitRoot', () => {
    const options = buildExtrasOptions('local', '/repo');
    const values = options.map(o => o.value);
    expect(values).toEqual(['settings', 'claude-md', 'claudeignore', 'gitignore', 'docs', 'safe-delete']);
  });

  it('omits claudeignore and gitignore for local scope without gitRoot', () => {
    const options = buildExtrasOptions('local', null);
    const values = options.map(o => o.value);
    expect(values).toEqual(['settings', 'claude-md', 'docs', 'safe-delete']);
  });

  it('all options have non-empty label and hint', () => {
    const options = buildExtrasOptions('local', '/repo');
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('computeGitignoreAppend', () => {
  it('returns all entries when gitignore is empty', () => {
    const result = computeGitignoreAppend('', ['.claude/', '.devflow/']);
    expect(result).toEqual(['.claude/', '.devflow/']);
  });

  it('filters out existing entries', () => {
    const existing = '.claude/\nnode_modules/\n';
    const result = computeGitignoreAppend(existing, ['.claude/', '.devflow/']);
    expect(result).toEqual(['.devflow/']);
  });

  it('returns empty array when all entries exist', () => {
    const existing = '.claude/\n.devflow/\n';
    const result = computeGitignoreAppend(existing, ['.claude/', '.devflow/']);
    expect(result).toEqual([]);
  });

  it('handles entries with surrounding whitespace in gitignore', () => {
    const existing = '  .claude/  \n';
    const result = computeGitignoreAppend(existing, ['.claude/', '.devflow/']);
    expect(result).toEqual(['.devflow/']);
  });

  it('handles empty entries list', () => {
    const result = computeGitignoreAppend('something\n', []);
    expect(result).toEqual([]);
  });
});
