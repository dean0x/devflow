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
} from '../src/core/plugins.js';
import { installRuleFile, installAllRules, installViaFileCopy, validateRuleShadow, type Spinner } from '../src/targets/claude-code/installer.js';
import { listShadowedRules, hasRuleShadow, seedRuleShadow } from '../src/cli/commands/rules.js';

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
      { name: 'devflow-plan', description: '', commands: [], agents: [], skills: [], rules: [] },
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

  it('core-skills has security, engineering, quality, reliability rules', () => {
    const coreSkills = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills')!;
    const map = buildRulesMap([coreSkills]);
    expect(map.get('security')).toBe('devflow-core-skills');
    expect(map.get('engineering')).toBe('devflow-core-skills');
    expect(map.get('quality')).toBe('devflow-core-skills');
    expect(map.get('reliability')).toBe('devflow-core-skills');
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

  it('includes the four core rules', () => {
    const names = getAllRuleNames();
    expect(names).toContain('security');
    expect(names).toContain('engineering');
    expect(names).toContain('quality');
    expect(names).toContain('reliability');
  });

  it('includes language-specific rules from optional plugins', () => {
    const names = getAllRuleNames();
    expect(names).toContain('typescript');
    expect(names).toContain('react');
    expect(names).toContain('go');
  });
});

// ---------------------------------------------------------------------------
// validateRuleShadow
// ---------------------------------------------------------------------------

describe('validateRuleShadow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rule-shadow-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('symlink → regular file: returns "valid"', async () => {
    const realFile = path.join(tmpDir, 'real.md');
    await fs.writeFile(realFile, '# Content', 'utf-8');
    const link = path.join(tmpDir, 'security.md');
    await fs.symlink(realFile, link);
    // fs.stat follows the link → sees a non-empty regular file → 'valid'
    expect(await validateRuleShadow(link)).toBe('valid');
  });

  it('symlink → directory: returns "not-a-file"', async () => {
    const realDir = path.join(tmpDir, 'real-dir');
    await fs.mkdir(realDir, { recursive: true });
    const link = path.join(tmpDir, 'security.md');
    await fs.symlink(realDir, link);
    // fs.stat follows the link → sees a directory → isFile() = false → 'not-a-file'
    expect(await validateRuleShadow(link)).toBe('not-a-file');
  });

  it('dangling symlink (target absent): returns "none"', async () => {
    const link = path.join(tmpDir, 'security.md');
    await fs.symlink(path.join(tmpDir, 'nonexistent.md'), link);
    // fs.stat follows the link → ENOENT on missing target → caught → 'none'
    expect(await validateRuleShadow(link)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// installRuleFile
// Signature after restructure: (ruleName, devflowDir, rulesTarget)
// Source is always read from rulesDir() = src/assets/rules/ (no pluginsDir param).
// ---------------------------------------------------------------------------

describe('installRuleFile', () => {
  let tmpDir: string;
  let devflowDir: string;
  let rulesTarget: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rules-'));
    devflowDir = path.join(tmpDir, 'devflow');
    rulesTarget = path.join(tmpDir, 'rules', 'devflow');

    await fs.mkdir(rulesTarget, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('copies rule from src/assets/rules/ when no shadow exists', async () => {
    // 'security' exists in src/assets/rules/security.md (real source)
    const outcome = await installRuleFile('security', devflowDir, rulesTarget);

    const targetFile = path.join(rulesTarget, 'security.md');
    const stat = await fs.stat(targetFile);
    expect(stat.isFile(), 'security.md should be installed at rulesTarget').toBe(true);
    expect(outcome).toBe('source');
  });

  it('copies shadow file when shadow exists, ignoring src/assets/rules/ source', async () => {
    const shadowDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'security.md'), '# Shadow Rule', 'utf-8');

    const outcome = await installRuleFile('security', devflowDir, rulesTarget);

    const content = await fs.readFile(path.join(rulesTarget, 'security.md'), 'utf-8');
    expect(content).toBe('# Shadow Rule');
    expect(outcome).toBe('shadow');
  });

  it('throws when declared rule source does not exist in src/assets/rules/ (WS6a)', async () => {
    // 'nonexistent-rule-xyz' is not in src/assets/rules/ — hard-error since it is declared.
    // Previously returned 'skipped'; now throws to surface build/packaging failures early.
    await expect(
      installRuleFile('nonexistent-rule-xyz', devflowDir, rulesTarget),
    ).rejects.toThrow(/Rule source not found for declared rule "nonexistent-rule-xyz"/);
  });

  it('places target file at rulesTarget/{name}.md (flat, no nesting)', async () => {
    // 'quality' exists in src/assets/rules/quality.md (real source)
    const outcome = await installRuleFile('quality', devflowDir, rulesTarget);

    const stat = await fs.stat(path.join(rulesTarget, 'quality.md'));
    expect(stat.isFile(), 'quality.md should be a flat file at rulesTarget').toBe(true);
    expect(outcome).toBe('source');
  });

  it('0-byte shadow file → installs source content and returns source-invalid-shadow:empty-shadow-file', async () => {
    const shadowDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'security.md'), '', 'utf-8');

    const outcome = await installRuleFile('security', devflowDir, rulesTarget);

    expect(outcome).toBe('source-invalid-shadow:empty-shadow-file');
    // Verify fallback to real source happened (file should exist)
    const stat = await fs.stat(path.join(rulesTarget, 'security.md'));
    expect(stat.isFile()).toBe(true);
  });

  it('directory at shadow path → installs source and returns source-invalid-shadow:not-a-file (no throw)', async () => {
    const shadowDir = path.join(devflowDir, 'rules');
    await fs.mkdir(path.join(shadowDir, 'security.md'), { recursive: true });

    const outcome = await installRuleFile('security', devflowDir, rulesTarget);

    expect(outcome).toBe('source-invalid-shadow:not-a-file');
    const stat = await fs.stat(path.join(rulesTarget, 'security.md'));
    expect(stat.isFile()).toBe(true);
  });

  it('valid shadow but copyFile fails → falls through to source install, returns "source" without throwing', async () => {
    const shadowDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowDir, { recursive: true });
    const shadowFile = path.join(shadowDir, 'security.md');
    await fs.writeFile(shadowFile, '# Shadow Rule', 'utf-8');
    await fs.chmod(shadowFile, 0o000);

    try {
      // Before fix: copyFile(shadowFile, targetFile) throws EACCES → whole call throws
      // After fix: try/catch around copy; falls through to source install
      const outcome = await installRuleFile('security', devflowDir, rulesTarget);
      expect(outcome).toBe('source');
      const stat = await fs.stat(path.join(rulesTarget, 'security.md'));
      expect(stat.isFile()).toBe(true);
    } finally {
      await fs.chmod(shadowFile, 0o644);
    }
  });

  it('empty shadow file with missing source → throws (WS6a hard-error)', async () => {
    // Shadow exists but is invalid (empty); 'orphan-rule' is not in src/assets/rules/.
    // Previously returned 'skipped'; now throws because the declared source is absent.
    // ADR-010 shadow tolerance still applies — the shadow is invalid, but the hard-error
    // fires for the missing declared source, not for the invalid shadow.
    const shadowDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'orphan-rule.md'), '', 'utf-8');

    await expect(
      installRuleFile('orphan-rule', devflowDir, rulesTarget),
    ).rejects.toThrow(/Rule source not found for declared rule "orphan-rule"/);
    await expect(fs.access(path.join(rulesTarget, 'orphan-rule.md'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// installViaFileCopy rules report
// ---------------------------------------------------------------------------

// installViaFileCopy rules report
// After restructure: FileCopyOptions no longer has pluginsDir or rootDir.
// installRuleFile reads from rulesDir() = src/assets/rules/ directly.

describe('installViaFileCopy rules report', () => {
  it('valid shadow recorded in shadowedRules', async () => {
    const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };
    const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rules-report-'));
    const localDevflowDir = path.join(localTmpDir, 'devflow');
    const localClaudeDir = path.join(localTmpDir, 'claude');

    try {
      // Create valid shadow — installRuleFile will pick it up over src/assets/rules/security.md
      const shadowRulesDir = path.join(localDevflowDir, 'rules');
      await fs.mkdir(shadowRulesDir, { recursive: true });
      await fs.writeFile(path.join(shadowRulesDir, 'security.md'), '# Shadow', 'utf-8');

      await fs.mkdir(path.join(localClaudeDir, 'rules', 'devflow'), { recursive: true });

      const report = await installViaFileCopy({
        plugins: [],
        claudeDir: localClaudeDir,
        devflowDir: localDevflowDir,
        skillsMap: new Map(),
        agentsMap: new Map(),
        rulesMap: new Map([['security', 'devflow-core-skills']]),
        isPartialInstall: true,
        spinner: noopSpinner,
      });

      expect(report.shadowedRules).toContain('security');
      expect(report.shadowedSkills).toHaveLength(0);
      expect(report.skippedShadows).toHaveLength(0);
    } finally {
      await fs.rm(localTmpDir, { recursive: true, force: true });
    }
  });

  it('0-byte shadow → skippedShadows includes {kind:"rule", reason:"empty-shadow-file"} and rule is not in shadowedRules', async () => {
    const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };
    const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rules-skip-empty-'));
    const localDevflowDir = path.join(localTmpDir, 'devflow');
    const localClaudeDir = path.join(localTmpDir, 'claude');

    try {
      // Create 0-byte shadow file (invalid — triggers skippedShadows)
      // fallback goes to src/assets/rules/security.md which exists → 'source-invalid-shadow:empty-shadow-file'
      const shadowRulesDir = path.join(localDevflowDir, 'rules');
      await fs.mkdir(shadowRulesDir, { recursive: true });
      await fs.writeFile(path.join(shadowRulesDir, 'security.md'), '', 'utf-8');

      await fs.mkdir(path.join(localClaudeDir, 'rules', 'devflow'), { recursive: true });

      const report = await installViaFileCopy({
        plugins: [],
        claudeDir: localClaudeDir,
        devflowDir: localDevflowDir,
        skillsMap: new Map(),
        agentsMap: new Map(),
        rulesMap: new Map([['security', 'devflow-core-skills']]),
        isPartialInstall: true,
        spinner: noopSpinner,
      });

      expect(report.skippedShadows).toContainEqual({ kind: 'rule', name: 'security', reason: 'empty-shadow-file' });
      expect(report.shadowedRules).not.toContain('security');
    } finally {
      await fs.rm(localTmpDir, { recursive: true, force: true });
    }
  });

  it('directory at shadow path → skippedShadows includes {kind:"rule", reason:"not-a-file"} and rule is not in shadowedRules', async () => {
    const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };
    const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rules-skip-dir-'));
    const localDevflowDir = path.join(localTmpDir, 'devflow');
    const localClaudeDir = path.join(localTmpDir, 'claude');

    try {
      // Put a directory where the shadow file should be (invalid — triggers skippedShadows)
      const shadowRulesDir = path.join(localDevflowDir, 'rules');
      await fs.mkdir(path.join(shadowRulesDir, 'security.md'), { recursive: true });

      await fs.mkdir(path.join(localClaudeDir, 'rules', 'devflow'), { recursive: true });

      const report = await installViaFileCopy({
        plugins: [],
        claudeDir: localClaudeDir,
        devflowDir: localDevflowDir,
        skillsMap: new Map(),
        agentsMap: new Map(),
        rulesMap: new Map([['security', 'devflow-core-skills']]),
        isPartialInstall: true,
        spinner: noopSpinner,
      });

      expect(report.skippedShadows).toContainEqual({ kind: 'rule', name: 'security', reason: 'not-a-file' });
      expect(report.shadowedRules).not.toContain('security');
    } finally {
      await fs.rm(localTmpDir, { recursive: true, force: true });
    }
  });

  it('empty shadow with missing source → installViaFileCopy throws (WS6a hard-error)', async () => {
    const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };
    const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rules-skip-missing-'));
    const localDevflowDir = path.join(localTmpDir, 'devflow');
    const localClaudeDir = path.join(localTmpDir, 'claude');

    try {
      // No source for 'orphan-rule' in src/assets/rules/ — only an empty (invalid) shadow exists.
      // Previously installViaFileCopy returned a report with no skippedShadows entry.
      // Now installRuleFile throws for the missing declared source, which propagates out of
      // installViaFileCopy. Hard-error surfaces packaging failures instead of silently skipping.
      const shadowRulesDir = path.join(localDevflowDir, 'rules');
      await fs.mkdir(shadowRulesDir, { recursive: true });
      await fs.writeFile(path.join(shadowRulesDir, 'orphan-rule.md'), '', 'utf-8');

      await fs.mkdir(path.join(localClaudeDir, 'rules', 'devflow'), { recursive: true });

      await expect(
        installViaFileCopy({
          plugins: [],
          claudeDir: localClaudeDir,
          devflowDir: localDevflowDir,
          skillsMap: new Map(),
          agentsMap: new Map(),
          rulesMap: new Map([['orphan-rule', 'devflow-core-skills']]),
          isPartialInstall: true,
          spinner: noopSpinner,
        }),
      ).rejects.toThrow(/Rule source not found for declared rule "orphan-rule"/);
    } finally {
      await fs.rm(localTmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// installAllRules
// ---------------------------------------------------------------------------

// installAllRules
// After restructure: signature is (rulesMap, devflowDir, rulesTarget) — no pluginsDir.
// Source is read from rulesDir() = src/assets/rules/ directly.

describe('installAllRules', () => {
  let tmpDir: string;
  let devflowDir: string;
  let rulesTarget: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-all-rules-'));
    devflowDir = path.join(tmpDir, 'devflow');
    rulesTarget = path.join(tmpDir, 'rules', 'devflow');
    await fs.mkdir(rulesTarget, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for empty rulesMap', async () => {
    const outcomes = await installAllRules(new Map(), devflowDir, rulesTarget);
    expect(outcomes).toEqual([]);
  });

  it('returns one outcome per rule with correct outcome for source install', async () => {
    // 'security' and 'quality' both exist in src/assets/rules/ (real sources)
    const rulesMap = new Map([
      ['security', 'devflow-core-skills'],
      ['quality', 'devflow-core-skills'],
    ]);

    const outcomes = await installAllRules(rulesMap, devflowDir, rulesTarget);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.find(o => o.ruleName === 'security')?.outcome).toBe('source');
    expect(outcomes.find(o => o.ruleName === 'quality')?.outcome).toBe('source');
  });

  it('returns shadow outcome for rule with valid shadow', async () => {
    const shadowRulesDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowRulesDir, { recursive: true });
    await fs.writeFile(path.join(shadowRulesDir, 'security.md'), '# Shadow', 'utf-8');

    const outcomes = await installAllRules(
      new Map([['security', 'devflow-core-skills']]),
      devflowDir,
      rulesTarget,
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('shadow');
  });
});

// ---------------------------------------------------------------------------
// listShadowedRules
// ---------------------------------------------------------------------------

describe('listShadowedRules', () => {
  it('returns empty array when rules directory does not exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-list-rules-'));
    try {
      const result = await listShadowedRules(tmpDir);
      expect(result).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns only .md basenames from rules directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-list-rules-'));
    try {
      const rulesDir = path.join(tmpDir, 'rules');
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(path.join(rulesDir, 'security.md'), '# security');
      await fs.writeFile(path.join(rulesDir, 'engineering.md'), '# engineering');
      await fs.writeFile(path.join(rulesDir, 'not-a-rule.txt'), 'txt');

      const result = await listShadowedRules(tmpDir);
      expect(result.sort()).toEqual(['engineering', 'security']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// hasRuleShadow
// ---------------------------------------------------------------------------

describe('hasRuleShadow', () => {
  it('returns true when shadow file exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-has-rule-'));
    try {
      const rulesDir = path.join(tmpDir, 'rules');
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(path.join(rulesDir, 'security.md'), '# shadow');
      expect(await hasRuleShadow('security', tmpDir)).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns false when shadow file does not exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-has-rule-'));
    try {
      expect(await hasRuleShadow('security', tmpDir)).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// seedRuleShadow
// ---------------------------------------------------------------------------

// seedRuleShadow
// After restructure: signature is (name, shadowFile, rulesTarget, devflowDir) — no pluginsDir.
// Tier 2 source fallback reads from rulesDir() = src/assets/rules/.

describe('seedRuleShadow', () => {
  let tmpDir: string;
  let devflowDir: string;
  let rulesTarget: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-seed-shadow-'));
    devflowDir = path.join(tmpDir, 'devflow');
    rulesTarget = path.join(tmpDir, 'rules', 'devflow');
    await fs.mkdir(rulesTarget, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 'installed' and copies the installed rule when it exists", async () => {
    await fs.writeFile(path.join(rulesTarget, 'security.md'), '# Installed Rule', 'utf-8');
    const shadowFile = path.join(devflowDir, 'rules', 'security.md');

    const tier = await seedRuleShadow('security', shadowFile, rulesTarget, devflowDir);

    expect(tier).toBe('installed');
    const content = await fs.readFile(shadowFile, 'utf-8');
    expect(content).toBe('# Installed Rule');
  });

  it("returns 'source' and copies from src/assets/rules/ when installed rule is absent", async () => {
    // No installed rule in rulesTarget — function falls to Tier 2: src/assets/rules/security.md
    const shadowFile = path.join(devflowDir, 'rules', 'security.md');

    const tier = await seedRuleShadow('security', shadowFile, rulesTarget, devflowDir);

    expect(tier).toBe('source');
    // Shadow file should exist with real content from src/assets/rules/security.md
    const stat = await fs.stat(shadowFile);
    expect(stat.isFile()).toBe(true);
  });

  it("'installed' tier takes precedence over 'source' when both exist", async () => {
    // Write a distinct installed rule to rulesTarget
    await fs.writeFile(path.join(rulesTarget, 'security.md'), '# Installed Rule', 'utf-8');
    const shadowFile = path.join(devflowDir, 'rules', 'security.md');

    const tier = await seedRuleShadow('security', shadowFile, rulesTarget, devflowDir);

    expect(tier).toBe('installed');
    const content = await fs.readFile(shadowFile, 'utf-8');
    expect(content).toBe('# Installed Rule');
  });

  it("returns 'none' and does not create shadow file when neither installed nor src/assets/rules/ source exists", async () => {
    // 'nonexistent-rule-xyz' is not in src/assets/rules/ and not in rulesTarget
    const shadowFile = path.join(devflowDir, 'rules', 'nonexistent-rule-xyz.md');

    const tier = await seedRuleShadow('nonexistent-rule-xyz', shadowFile, rulesTarget, devflowDir);

    expect(tier).toBe('none');
    await expect(fs.access(shadowFile)).rejects.toThrow();
  });

  it('creates the shadow directory before copying', async () => {
    await fs.writeFile(path.join(rulesTarget, 'security.md'), '# Installed Rule', 'utf-8');
    const shadowFile = path.join(devflowDir, 'rules', 'security.md');

    // Confirm devflowDir/rules does not exist yet
    await expect(fs.access(path.join(devflowDir, 'rules'))).rejects.toThrow();

    await seedRuleShadow('security', shadowFile, rulesTarget, devflowDir);

    const stat = await fs.stat(path.join(devflowDir, 'rules'));
    expect(stat.isDirectory()).toBe(true);
  });
});
