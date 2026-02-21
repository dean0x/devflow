import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parsePluginSelection,
  substituteSettingsTemplate,
  computeGitignoreAppend,
  buildExtrasOptions,
  stripTeamsConfig,
} from '../src/cli/commands/init.js';
import { installViaFileCopy, type Spinner } from '../src/cli/utils/installer.js';
import { DEVFLOW_PLUGINS, buildAssetMaps } from '../src/cli/plugins.js';

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

describe('stripTeamsConfig', () => {
  it('removes teammateMode and CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'test' },
      teammateMode: 'auto',
      env: {
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      },
    }, null, 2);

    const result = JSON.parse(stripTeamsConfig(input));
    expect(result.teammateMode).toBeUndefined();
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
    expect(result.statusLine).toEqual({ type: 'command', command: 'test' });
  });

  it('preserves all other settings', () => {
    const input = JSON.stringify({
      hooks: { Stop: [] },
      teammateMode: 'auto',
      env: {
        ENABLE_TOOL_SEARCH: 'true',
        ENABLE_LSP_TOOL: 'true',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      },
      permissions: { deny: ['Bash(rm -rf /*)'] },
    }, null, 2);

    const result = JSON.parse(stripTeamsConfig(input));
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env).toEqual({ ENABLE_TOOL_SEARCH: 'true', ENABLE_LSP_TOOL: 'true' });
    expect(result.permissions).toEqual({ deny: ['Bash(rm -rf /*)'] });
  });

  it('handles missing env and teammateMode gracefully', () => {
    const input = JSON.stringify({
      hooks: { Stop: [] },
      statusLine: { type: 'command' },
    }, null, 2);

    const result = JSON.parse(stripTeamsConfig(input));
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.statusLine).toEqual({ type: 'command' });
    expect(result.teammateMode).toBeUndefined();
    expect(result.env).toBeUndefined();
  });

  it('removes empty env object when AGENT_TEAMS is the only key', () => {
    const input = JSON.stringify({
      teammateMode: 'auto',
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
    }, null, 2);

    const result = JSON.parse(stripTeamsConfig(input));
    expect(result.env).toBeUndefined();
  });
});

describe('installViaFileCopy cleanup (isPartialInstall)', () => {
  let tmpDir: string;
  let claudeDir: string;
  let pluginsDir: string;
  let rootDir: string;
  let devflowDir: string;
  const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
    claudeDir = path.join(tmpDir, 'claude');
    pluginsDir = path.join(tmpDir, 'plugins');
    rootDir = tmpDir;
    devflowDir = path.join(tmpDir, 'devflow');

    // Seed a stale command and agent that should be cleaned on full install
    const commandsDir = path.join(claudeDir, 'commands', 'devflow');
    const agentsDir = path.join(claudeDir, 'agents', 'devflow');
    await fs.mkdir(commandsDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(path.join(commandsDir, 'stale.md'), '# stale');
    await fs.writeFile(path.join(agentsDir, 'stale.md'), '# stale');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('full install (isPartialInstall=false) removes stale commands and agents', async () => {
    await installViaFileCopy({
      plugins: [],
      claudeDir,
      pluginsDir,
      rootDir,
      devflowDir,
      skillsMap: new Map(),
      agentsMap: new Map(),
      isPartialInstall: false,
      teamsEnabled: false,
      spinner: noopSpinner,
    });

    // Stale dirs should be removed
    await expect(fs.access(path.join(claudeDir, 'commands', 'devflow', 'stale.md'))).rejects.toThrow();
    await expect(fs.access(path.join(claudeDir, 'agents', 'devflow', 'stale.md'))).rejects.toThrow();
  });

  it('partial install (isPartialInstall=true) preserves existing commands and agents', async () => {
    await installViaFileCopy({
      plugins: [],
      claudeDir,
      pluginsDir,
      rootDir,
      devflowDir,
      skillsMap: new Map(),
      agentsMap: new Map(),
      isPartialInstall: true,
      teamsEnabled: false,
      spinner: noopSpinner,
    });

    // Stale files should still exist
    const staleCommand = await fs.readFile(path.join(claudeDir, 'commands', 'devflow', 'stale.md'), 'utf-8');
    expect(staleCommand).toBe('# stale');
    const staleAgent = await fs.readFile(path.join(claudeDir, 'agents', 'devflow', 'stale.md'), 'utf-8');
    expect(staleAgent).toBe('# stale');
  });
});
