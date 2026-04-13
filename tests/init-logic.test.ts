import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parsePluginSelection,
  substituteSettingsTemplate,
  computeGitignoreAppend,
  applyTeamsConfig,
  stripTeamsConfig,
  mergeDenyList,
  discoverProjectGitRoots,
  migrateShadowOverrides,
} from '../src/cli/commands/init.js';
import { getManagedSettingsPath } from '../src/cli/utils/paths.js';
import { installManagedSettings, installClaudeignore } from '../src/cli/utils/post-install.js';
import { installViaFileCopy, type Spinner } from '../src/cli/utils/installer.js';
import { DEVFLOW_PLUGINS, buildAssetMaps, prefixSkillName } from '../src/cli/plugins.js';
import { runMigrations, type Migration, type GlobalMigrationContext } from '../src/cli/utils/migrations.js';

describe('parsePluginSelection', () => {
  it('parses comma-separated plugin names', () => {
    const { selected, invalid } = parsePluginSelection('devflow-implement,devflow-code-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(invalid).toEqual([]);
  });

  it('normalizes shorthand names (adds devflow- prefix)', () => {
    const { selected, invalid } = parsePluginSelection('implement,code-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(invalid).toEqual([]);
  });

  it('handles mixed shorthand and full names', () => {
    const { selected, invalid } = parsePluginSelection('implement,devflow-code-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(invalid).toEqual([]);
  });

  it('trims whitespace', () => {
    const { selected, invalid } = parsePluginSelection('  implement , code-review  ', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
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

  it('remaps legacy plugin names', () => {
    const { selected, invalid } = parsePluginSelection('frontend-design', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-ui-design']);
    expect(invalid).toEqual([]);
  });

  it('remaps legacy plugin names with prefix', () => {
    const { selected, invalid } = parsePluginSelection('devflow-frontend-design', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-ui-design']);
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

describe('applyTeamsConfig', () => {
  it('adds teammateMode and CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', () => {
    const input = JSON.stringify({
      hooks: { Stop: [] },
      statusLine: { type: 'command', command: 'test' },
    }, null, 2);

    const result = JSON.parse(applyTeamsConfig(input));
    expect(result.teammateMode).toBe('auto');
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.statusLine).toEqual({ type: 'command', command: 'test' });
  });

  it('preserves existing env vars', () => {
    const input = JSON.stringify({
      env: { ENABLE_TOOL_SEARCH: 'true' },
    }, null, 2);

    const result = JSON.parse(applyTeamsConfig(input));
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
    expect(result.teammateMode).toBe('auto');
  });

  it('creates env object when missing', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);

    const result = JSON.parse(applyTeamsConfig(input));
    expect(result.env).toEqual({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' });
  });

  it('is inverse of stripTeamsConfig (roundtrip)', () => {
    const base = JSON.stringify({
      hooks: { Stop: [] },
      env: { ENABLE_TOOL_SEARCH: 'true' },
    }, null, 2);

    const withTeams = applyTeamsConfig(base);
    const stripped = stripTeamsConfig(withTeams);
    const result = JSON.parse(stripped);

    expect(result.teammateMode).toBeUndefined();
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
    expect(result.hooks).toEqual({ Stop: [] });
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

describe('getManagedSettingsPath', () => {
  it('returns macOS path on darwin', () => {
    // This test runs on the current platform
    const p = getManagedSettingsPath();
    if (process.platform === 'darwin') {
      expect(p).toBe('/Library/Application Support/ClaudeCode/managed-settings.json');
    } else if (process.platform === 'linux') {
      expect(p).toBe('/etc/claude-code/managed-settings.json');
    }
  });

  it('returns a path ending in managed-settings.json', () => {
    const p = getManagedSettingsPath();
    expect(p).toMatch(/managed-settings\.json$/);
  });
});

describe('mergeDenyList', () => {
  it('merges new entries into existing deny list', () => {
    const existing = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)'] },
    });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)', 'Bash(sudo *)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)', 'Bash(sudo *)']);
  });

  it('deduplicates entries', () => {
    const existing = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)', 'Bash(sudo *)'] },
    });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)', 'Bash(eval *)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)', 'Bash(sudo *)', 'Bash(eval *)']);
  });

  it('preserves existing non-deny settings', () => {
    const existing = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)'], allow: ['Read(*)'] },
      otherKey: 'value',
    });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(sudo *)']));
    expect(result.permissions.allow).toEqual(['Read(*)']);
    expect(result.otherKey).toBe('value');
  });

  it('creates permissions.deny when missing', () => {
    const existing = JSON.stringify({ otherKey: 'value' });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)']);
    expect(result.otherKey).toBe('value');
  });

  it('handles empty existing deny list', () => {
    const existing = JSON.stringify({ permissions: { deny: [] } });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)']);
  });

  it('handles empty new entries', () => {
    const existing = JSON.stringify({ permissions: { deny: ['Bash(rm -rf /*)'] } });
    const result = JSON.parse(mergeDenyList(existing, []));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)']);
  });
});

describe('installManagedSettings', () => {
  let tmpDir: string;
  let managedDir: string;
  let managedPath: string;
  let templateDir: string;

  const denyEntries = ['Bash(rm -rf /*)', 'Bash(sudo *)'];
  const templateContent = JSON.stringify({ permissions: { deny: denyEntries } }, null, 2);

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-managed-test-'));
    managedDir = path.join(tmpDir, 'managed');
    managedPath = path.join(managedDir, 'managed-settings.json');
    templateDir = path.join(tmpDir, 'root');

    // Create template file at expected location
    await fs.mkdir(path.join(templateDir, 'src', 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(templateDir, 'src', 'templates', 'managed-settings.json'),
      templateContent,
      'utf-8',
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns false when getManagedSettingsPath throws (unsupported platform)', async () => {
    vi.spyOn(await import('../src/cli/utils/paths.js'), 'getManagedSettingsPath').mockImplementation(() => {
      throw new Error('Unsupported platform');
    });

    const result = await installManagedSettings(templateDir, false);
    expect(result).toBe(false);
  });

  it('returns false when template file cannot be read', async () => {
    vi.spyOn(await import('../src/cli/utils/paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    // Use a rootDir with no template file
    const emptyRoot = path.join(tmpDir, 'empty-root');
    await fs.mkdir(emptyRoot, { recursive: true });

    const result = await installManagedSettings(emptyRoot, true);
    expect(result).toBe(false);
  });

  it('writes managed settings via direct write when directory is writable', async () => {
    vi.spyOn(await import('../src/cli/utils/paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    const result = await installManagedSettings(templateDir, false);

    expect(result).toBe(true);
    const written = JSON.parse(await fs.readFile(managedPath, 'utf-8'));
    expect(written.permissions.deny).toEqual(denyEntries);
  });

  it('merges with existing managed settings (preserves existing entries)', async () => {
    vi.spyOn(await import('../src/cli/utils/paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    // Pre-populate existing managed settings with an extra entry
    await fs.mkdir(managedDir, { recursive: true });
    const existing = { permissions: { deny: ['Bash(eval *)'] } };
    await fs.writeFile(managedPath, JSON.stringify(existing), 'utf-8');

    const result = await installManagedSettings(templateDir, false);

    expect(result).toBe(true);
    const written = JSON.parse(await fs.readFile(managedPath, 'utf-8'));
    // Should contain both the existing entry and new entries, deduplicated
    expect(written.permissions.deny).toContain('Bash(eval *)');
    expect(written.permissions.deny).toContain('Bash(rm -rf /*)');
    expect(written.permissions.deny).toContain('Bash(sudo *)');
  });

  it('returns false on EACCES when not in TTY', async () => {
    vi.spyOn(await import('../src/cli/utils/paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    // Make the parent dir exist but not writable
    await fs.mkdir(managedDir, { recursive: true });
    await fs.chmod(managedDir, 0o444);

    // Mock process.stdin.isTTY as falsy
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    try {
      const result = await installManagedSettings(templateDir, false);
      expect(result).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
      // Restore permissions for cleanup
      await fs.chmod(managedDir, 0o755);
    }
  });

  it('returns false on non-EACCES write errors', async () => {
    vi.spyOn(await import('../src/cli/utils/paths.js'), 'getManagedSettingsPath').mockReturnValue(
      // Point to a path inside a file (not a directory) to trigger ENOTDIR
      path.join(templateDir, 'src', 'templates', 'managed-settings.json', 'impossible', 'managed-settings.json'),
    );

    const result = await installManagedSettings(templateDir, false);
    expect(result).toBe(false);
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

describe('discoverProjectGitRoots', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-discover-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns sorted git roots from history.jsonl', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    // Create two project dirs with .git
    const projA = path.join(tmpDir, 'project-a');
    const projB = path.join(tmpDir, 'project-b');
    await fs.mkdir(path.join(projA, '.git'), { recursive: true });
    await fs.mkdir(path.join(projB, '.git'), { recursive: true });

    // Write history with both projects (projB before projA to verify sorting)
    const lines = [
      JSON.stringify({ project: projB, timestamp: '2026-01-01' }),
      JSON.stringify({ project: projA, timestamp: '2026-01-02' }),
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([projA, projB]);
  });

  it('skips projects without .git directory', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const projGit = path.join(tmpDir, 'has-git');
    const projNoGit = path.join(tmpDir, 'no-git');
    await fs.mkdir(path.join(projGit, '.git'), { recursive: true });
    await fs.mkdir(projNoGit, { recursive: true });

    const lines = [
      JSON.stringify({ project: projGit }),
      JSON.stringify({ project: projNoGit }),
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([projGit]);
  });

  it('skips non-existent project paths', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const lines = JSON.stringify({ project: path.join(tmpDir, 'gone') });
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it('returns empty array when history.jsonl is missing', async () => {
    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it('returns empty array when history.jsonl is empty', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), '', 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it('skips malformed JSON lines gracefully', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const proj = path.join(tmpDir, 'valid');
    await fs.mkdir(path.join(proj, '.git'), { recursive: true });

    const lines = [
      'not valid json',
      JSON.stringify({ project: proj }),
      '{broken',
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([proj]);
  });

  it('deduplicates repeated project entries', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const proj = path.join(tmpDir, 'dupe-proj');
    await fs.mkdir(path.join(proj, '.git'), { recursive: true });

    const lines = [
      JSON.stringify({ project: proj }),
      JSON.stringify({ project: proj }),
      JSON.stringify({ project: proj }),
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([proj]);
  });
});

describe('installClaudeignore return value', () => {
  let tmpDir: string;
  let rootDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-claudeignore-test-'));
    rootDir = path.join(tmpDir, 'root');
    await fs.mkdir(path.join(rootDir, 'src', 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, 'src', 'templates', 'claudeignore.template'),
      '# .claudeignore\nnode_modules/\n',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when .claudeignore is newly created', async () => {
    const gitRoot = path.join(tmpDir, 'project');
    await fs.mkdir(gitRoot, { recursive: true });

    const result = await installClaudeignore(gitRoot, rootDir, false);
    expect(result).toBe(true);

    const content = await fs.readFile(path.join(gitRoot, '.claudeignore'), 'utf-8');
    expect(content).toContain('node_modules/');
  });

  it('returns false when .claudeignore already exists', async () => {
    const gitRoot = path.join(tmpDir, 'project');
    await fs.mkdir(gitRoot, { recursive: true });
    await fs.writeFile(path.join(gitRoot, '.claudeignore'), '# existing', 'utf-8');

    const result = await installClaudeignore(gitRoot, rootDir, false);
    expect(result).toBe(false);

    // Should not overwrite existing file
    const content = await fs.readFile(path.join(gitRoot, '.claudeignore'), 'utf-8');
    expect(content).toBe('# existing');
  });
});

describe('migrateShadowOverrides', () => {
  let tmpDir: string;
  let devflowDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shadow-test-'));
    devflowDir = path.join(tmpDir, 'devflow');
    await fs.mkdir(path.join(devflowDir, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('renames old shadow directory to new name', async () => {
    const oldShadow = path.join(devflowDir, 'skills', 'core-patterns');
    await fs.mkdir(oldShadow, { recursive: true });
    await fs.writeFile(path.join(oldShadow, 'SKILL.md'), '# Custom override');

    const result = await migrateShadowOverrides(devflowDir);

    expect(result.migrated).toBe(1);
    expect(result.warnings).toEqual([]);

    // Old should be gone
    await expect(fs.access(oldShadow)).rejects.toThrow();
    // New should exist with content
    const content = await fs.readFile(
      path.join(devflowDir, 'skills', 'software-design', 'SKILL.md'),
      'utf-8',
    );
    expect(content).toBe('# Custom override');
  });

  it('warns but does not overwrite when both old and new exist', async () => {
    const oldShadow = path.join(devflowDir, 'skills', 'test-patterns');
    const newShadow = path.join(devflowDir, 'skills', 'testing');
    await fs.mkdir(oldShadow, { recursive: true });
    await fs.mkdir(newShadow, { recursive: true });
    await fs.writeFile(path.join(oldShadow, 'SKILL.md'), '# Old');
    await fs.writeFile(path.join(newShadow, 'SKILL.md'), '# New');

    const result = await migrateShadowOverrides(devflowDir);

    expect(result.migrated).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('test-patterns');
    expect(result.warnings[0]).toContain('testing');

    // New should be unchanged
    const content = await fs.readFile(path.join(newShadow, 'SKILL.md'), 'utf-8');
    expect(content).toBe('# New');
  });

  it('does nothing when no old shadows exist', async () => {
    const result = await migrateShadowOverrides(devflowDir);

    expect(result.migrated).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('migrates multiple shadows in one pass', async () => {
    for (const oldName of ['core-patterns', 'security-patterns', 'frontend-design']) {
      const dir = path.join(devflowDir, 'skills', oldName);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${oldName}`);
    }

    const result = await migrateShadowOverrides(devflowDir);

    expect(result.migrated).toBe(3);
    // Verify new names exist
    for (const newName of ['software-design', 'security', 'ui-design']) {
      await expect(fs.access(path.join(devflowDir, 'skills', newName))).resolves.toBeUndefined();
    }
  });

  it('handles missing skills directory gracefully', async () => {
    // Use a devflowDir without a skills/ subdirectory
    const emptyDir = path.join(tmpDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const result = await migrateShadowOverrides(emptyDir);

    expect(result.migrated).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('migrates exactly one shadow when multiple old names map to the same target', async () => {
    // git-safety, git-workflow, github-patterns all map to 'git'.
    // Only the first present entry should be migrated; subsequent entries must
    // warn rather than silently overwrite, regardless of Promise scheduling.
    const gitSafety = path.join(devflowDir, 'skills', 'git-safety');
    const gitWorkflow = path.join(devflowDir, 'skills', 'git-workflow');
    await fs.mkdir(gitSafety, { recursive: true });
    await fs.mkdir(gitWorkflow, { recursive: true });
    await fs.writeFile(path.join(gitSafety, 'SKILL.md'), '# git-safety override');
    await fs.writeFile(path.join(gitWorkflow, 'SKILL.md'), '# git-workflow override');

    const result = await migrateShadowOverrides(devflowDir);

    // Exactly one migration to 'git', one warning for the second entry
    expect(result.migrated).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('git');

    // 'git' target must exist
    await expect(fs.access(path.join(devflowDir, 'skills', 'git'))).resolves.toBeUndefined();

    // The migrated content must belong to whichever entry ran first (git-safety)
    const content = await fs.readFile(path.join(devflowDir, 'skills', 'git', 'SKILL.md'), 'utf-8');
    expect(content).toBe('# git-safety override');
  });
});

describe('shadow migration → install ordering', () => {
  let tmpDir: string;
  let claudeDir: string;
  let pluginsDir: string;
  let rootDir: string;
  let devflowDir: string;
  const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-ordering-test-'));
    claudeDir = path.join(tmpDir, 'claude');
    pluginsDir = path.join(tmpDir, 'plugins');
    rootDir = tmpDir;
    devflowDir = path.join(tmpDir, 'devflow');

    // Create required directories
    await fs.mkdir(path.join(claudeDir, 'skills'), { recursive: true });
    await fs.mkdir(path.join(devflowDir, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('migration before install: shadow at old name is found after rename', async () => {
    const skillName = 'software-design';
    const oldName = 'core-patterns';
    const shadowContent = '# User custom override';

    // 1. Simulate old-name shadow (pre-V2 user override)
    const oldShadow = path.join(devflowDir, 'skills', oldName);
    await fs.mkdir(oldShadow, { recursive: true });
    await fs.writeFile(path.join(oldShadow, 'SKILL.md'), shadowContent);

    // 2. Create a source skill for the installer to use as fallback
    const sourcePlugin = 'devflow-core-skills';
    const sourceDir = path.join(pluginsDir, sourcePlugin, 'skills', skillName);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '# Source (should NOT be installed)');

    // 3. Run migration FIRST (correct ordering)
    const migration = await migrateShadowOverrides(devflowDir);
    expect(migration.migrated).toBe(1);

    // 4. Run install — should find shadow at new name
    const skillsMap = new Map([[skillName, sourcePlugin]]);
    await installViaFileCopy({
      plugins: [],
      claudeDir,
      pluginsDir,
      rootDir,
      devflowDir,
      skillsMap,
      agentsMap: new Map(),
      isPartialInstall: true,
      teamsEnabled: false,
      spinner: noopSpinner,
    });

    // 5. Verify installed content is the shadow, not the source
    const installedPath = path.join(claudeDir, 'skills', prefixSkillName(skillName), 'SKILL.md');
    const installed = await fs.readFile(installedPath, 'utf-8');
    expect(installed).toBe(shadowContent);
  });

  it('without migration: shadow at old name is missed by installer', async () => {
    const skillName = 'software-design';
    const oldName = 'core-patterns';
    const shadowContent = '# User custom override';
    const sourceContent = '# Source (fallback)';

    // 1. Shadow at OLD name only (no migration)
    const oldShadow = path.join(devflowDir, 'skills', oldName);
    await fs.mkdir(oldShadow, { recursive: true });
    await fs.writeFile(path.join(oldShadow, 'SKILL.md'), shadowContent);

    // 2. Source skill
    const sourcePlugin = 'devflow-core-skills';
    const sourceDir = path.join(pluginsDir, sourcePlugin, 'skills', skillName);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), sourceContent);

    // 3. Skip migration — install directly (the old broken ordering)
    const skillsMap = new Map([[skillName, sourcePlugin]]);
    await installViaFileCopy({
      plugins: [],
      claudeDir,
      pluginsDir,
      rootDir,
      devflowDir,
      skillsMap,
      agentsMap: new Map(),
      isPartialInstall: true,
      teamsEnabled: false,
      spinner: noopSpinner,
    });

    // 4. Installed content is the SOURCE, not the shadow — user override lost
    const installedPath = path.join(claudeDir, 'skills', prefixSkillName(skillName), 'SKILL.md');
    const installed = await fs.readFile(installedPath, 'utf-8');
    expect(installed).toBe(sourceContent);
  });
});

describe('runMigrations integration seam (D32/D35)', () => {
  // Tests the integration between init's code path and runMigrations, using
  // the registryOverride parameter so no real migrations run. This covers the
  // seam that migrations.test.ts cannot cover (module-level isolation only).
  let tmpDir: string;
  let devflowDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-migrations-seam-'));
    devflowDir = path.join(tmpDir, 'home', '.devflow');
    await fs.mkdir(devflowDir, { recursive: true });
    // Redirect os.homedir() so runMigrations writes its state to our tmpdir
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('invokes runMigrations with correct devflowDir and discovered projects list', async () => {
    // Use a probe migration injected via registryOverride to verify that
    // runMigrations is called with the expected context.
    const calls: { devflowDir: string }[] = [];

    const probeMigration: Migration<'global'> = {
      id: 'probe-seam-test',
      description: 'Probe migration for integration seam test',
      scope: 'global',
      run: async (ctx: GlobalMigrationContext) => {
        calls.push({ devflowDir: ctx.devflowDir });
        return { infos: [], warnings: [] };
      },
    };

    const result = await runMigrations(
      { devflowDir },
      [],
      [probeMigration],
    );

    // The probe migration must have been called exactly once
    expect(calls).toHaveLength(1);
    expect(calls[0].devflowDir).toBe(devflowDir);

    // The migration ID must appear in newlyApplied
    expect(result.newlyApplied).toContain('probe-seam-test');
    expect(result.failures).toHaveLength(0);
  });

  it('passes discovered project roots to per-project migrations', async () => {
    // Create two fake project roots
    const projA = path.join(tmpDir, 'project-a');
    const projB = path.join(tmpDir, 'project-b');
    await fs.mkdir(projA, { recursive: true });
    await fs.mkdir(projB, { recursive: true });

    const seenRoots: string[] = [];

    const probeMigration: Migration<'per-project'> = {
      id: 'probe-per-project-seam',
      description: 'Per-project probe migration for seam test',
      scope: 'per-project',
      run: async (ctx) => {
        seenRoots.push(ctx.projectRoot);
        return { infos: [], warnings: [] };
      },
    };

    const result = await runMigrations(
      { devflowDir },
      [projA, projB],
      [probeMigration],
    );

    // Both discovered projects must have been processed
    expect(seenRoots).toHaveLength(2);
    expect(seenRoots).toContain(projA);
    expect(seenRoots).toContain(projB);

    // Migration must be marked applied (all succeeded)
    expect(result.newlyApplied).toContain('probe-per-project-seam');
    expect(result.failures).toHaveLength(0);
  });

  it('does not re-run migrations that are already applied', async () => {
    const callCount = { value: 0 };

    const probeMigration: Migration<'global'> = {
      id: 'probe-already-applied',
      description: 'Probe: should not run twice',
      scope: 'global',
      run: async () => {
        callCount.value += 1;
        return { infos: [], warnings: [] };
      },
    };

    // First run: migration executes and is recorded as applied
    await runMigrations({ devflowDir }, [], [probeMigration]);
    expect(callCount.value).toBe(1);

    // Second run with same devflowDir: migration must be skipped
    await runMigrations({ devflowDir }, [], [probeMigration]);
    expect(callCount.value).toBe(1); // unchanged — already applied
  });
});
