import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isValidRuleName,
  buildRulesMap,
  getAllRuleNames,
  DEVFLOW_PLUGINS,
  type PluginDefinition,
} from '../src/cli/plugins.js';
import { installRuleFile } from '../src/cli/utils/installer.js';

// ---------------------------------------------------------------------------
// isValidRuleName
// ---------------------------------------------------------------------------

describe('isValidRuleName', () => {
  it('accepts lowercase letters only', () => {
    expect(isValidRuleName('security')).toBe(true);
  });

  it('accepts lowercase letters and hyphens', () => {
    expect(isValidRuleName('ui-design')).toBe(true);
  });

  it('accepts lowercase letters and digits', () => {
    expect(isValidRuleName('rule1')).toBe(true);
  });

  it('rejects uppercase letters', () => {
    expect(isValidRuleName('Security')).toBe(false);
  });

  it('rejects path traversal sequences', () => {
    expect(isValidRuleName('../etc/passwd')).toBe(false);
  });

  it('rejects names with spaces', () => {
    expect(isValidRuleName('my rule')).toBe(false);
  });

  it('rejects names with underscores', () => {
    expect(isValidRuleName('my_rule')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidRuleName('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRulesMap
// ---------------------------------------------------------------------------

describe('buildRulesMap', () => {
  it('returns empty map for plugins with no rules', () => {
    const plugins: PluginDefinition[] = [
      { name: 'devflow-plan', description: '', commands: [], agents: [], skills: [] },
    ];
    expect(buildRulesMap(plugins).size).toBe(0);
  });

  it('maps rule names to their owning plugin', () => {
    const plugins: PluginDefinition[] = [
      { name: 'devflow-core-skills', description: '', commands: [], agents: [], skills: [], rules: ['security', 'engineering'] },
    ];
    const map = buildRulesMap(plugins);
    expect(map.get('security')).toBe('devflow-core-skills');
    expect(map.get('engineering')).toBe('devflow-core-skills');
  });

  it('first plugin wins when two plugins declare the same rule', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], rules: ['shared'] },
      { name: 'plugin-b', description: '', commands: [], agents: [], skills: [], rules: ['shared'] },
    ];
    expect(buildRulesMap(plugins).get('shared')).toBe('plugin-a');
  });

  it('merges rules from multiple plugins without duplicates', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], rules: ['rule-a'] },
      { name: 'plugin-b', description: '', commands: [], agents: [], skills: [], rules: ['rule-b'] },
    ];
    const map = buildRulesMap(plugins);
    expect(map.size).toBe(2);
    expect(map.get('rule-a')).toBe('plugin-a');
    expect(map.get('rule-b')).toBe('plugin-b');
  });

  it('throws on invalid rule name', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], rules: ['Bad Name'] },
    ];
    expect(() => buildRulesMap(plugins)).toThrow(/Invalid rule name/);
  });

  it('core-skills has security, engineering, quality rules', () => {
    const coreSkills = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills')!;
    const map = buildRulesMap([coreSkills]);
    expect(map.get('security')).toBe('devflow-core-skills');
    expect(map.get('engineering')).toBe('devflow-core-skills');
    expect(map.get('quality')).toBe('devflow-core-skills');
  });
});

// ---------------------------------------------------------------------------
// getAllRuleNames
// ---------------------------------------------------------------------------

describe('getAllRuleNames', () => {
  it('returns unique rule names across all plugins', () => {
    const names = getAllRuleNames();
    expect(names.length).toBeGreaterThan(0);
    // No duplicates
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes the three core rules', () => {
    const names = getAllRuleNames();
    expect(names).toContain('security');
    expect(names).toContain('engineering');
    expect(names).toContain('quality');
  });

  it('includes language-specific rules from optional plugins', () => {
    const names = getAllRuleNames();
    expect(names).toContain('typescript');
    expect(names).toContain('react');
    expect(names).toContain('go');
  });
});

// ---------------------------------------------------------------------------
// installRuleFile
// ---------------------------------------------------------------------------

describe('installRuleFile', () => {
  let tmpDir: string;
  let pluginsDir: string;
  let devflowDir: string;
  let rulesTarget: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rules-'));
    pluginsDir = path.join(tmpDir, 'plugins');
    devflowDir = path.join(tmpDir, 'devflow');
    rulesTarget = path.join(tmpDir, 'rules', 'devflow');

    await fs.mkdir(rulesTarget, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('copies rule from plugin source when no shadow exists', async () => {
    const sourceDir = path.join(pluginsDir, 'devflow-core-skills', 'rules');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'security.md'), '# Security Rule', 'utf-8');

    await installRuleFile('security', 'devflow-core-skills', pluginsDir, devflowDir, rulesTarget);

    const content = await fs.readFile(path.join(rulesTarget, 'security.md'), 'utf-8');
    expect(content).toBe('# Security Rule');
  });

  it('copies shadow file when shadow exists, ignoring plugin source', async () => {
    const sourceDir = path.join(pluginsDir, 'devflow-core-skills', 'rules');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'security.md'), '# Original Rule', 'utf-8');

    const shadowDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'security.md'), '# Shadow Rule', 'utf-8');

    await installRuleFile('security', 'devflow-core-skills', pluginsDir, devflowDir, rulesTarget);

    const content = await fs.readFile(path.join(rulesTarget, 'security.md'), 'utf-8');
    expect(content).toBe('# Shadow Rule');
  });

  it('skips silently when plugin source file is missing', async () => {
    // No source file created — installRuleFile should not throw
    await expect(
      installRuleFile('missing', 'devflow-core-skills', pluginsDir, devflowDir, rulesTarget),
    ).resolves.toBeUndefined();

    // Target file should not exist
    await expect(fs.access(path.join(rulesTarget, 'missing.md'))).rejects.toThrow();
  });

  it('places target file at rulesTarget/{name}.md (flat, no nesting)', async () => {
    const sourceDir = path.join(pluginsDir, 'devflow-core-skills', 'rules');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'quality.md'), '# Quality', 'utf-8');

    await installRuleFile('quality', 'devflow-core-skills', pluginsDir, devflowDir, rulesTarget);

    // Verify the exact target path — flat file, not a directory
    const stat = await fs.stat(path.join(rulesTarget, 'quality.md'));
    expect(stat.isFile()).toBe(true);
  });
});
