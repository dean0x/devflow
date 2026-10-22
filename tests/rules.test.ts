import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isValidRuleName,
  buildRulesMap,
  getAllRuleNames,
  DEVFLOW_PLUGINS,
  FEATURE_OWNED_RULES,
  type PluginDefinition,
} from '../src/core/plugins.js';
import { installRuleFile, installAllRules, installViaFileCopy, validateRuleShadow, type Spinner } from '../src/targets/claude-code/installer.js';
import { listShadowedRules, hasRuleShadow, seedRuleShadow } from '../src/cli/commands/rules.js';
import { COMPLIANCE_RULE_PLACEHOLDER } from '../src/core/compliance.js';

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
      { name: 'devflow-plan', description: '', commands: [], agents: [], skills: [], requires: [], rules: [] },
    ];
    expect(buildRulesMap(plugins).size).toBe(0);
  });

  it('maps rule names to their owning plugin', () => {
    const plugins: PluginDefinition[] = [
      { name: 'devflow-core-skills', description: '', commands: [], agents: [], skills: [], requires: [], rules: ['security', 'engineering'] },
    ];
    const map = buildRulesMap(plugins);
    expect(map.get('security')).toBe('devflow-core-skills');
    expect(map.get('engineering')).toBe('devflow-core-skills');
  });

  it('first plugin wins when two plugins declare the same rule', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], requires: [], rules: ['shared'] },
      { name: 'plugin-b', description: '', commands: [], agents: [], skills: [], requires: [], rules: ['shared'] },
    ];
    expect(buildRulesMap(plugins).get('shared')).toBe('plugin-a');
  });

  it('merges rules from multiple plugins without duplicates', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], requires: [], rules: ['rule-a'] },
      { name: 'plugin-b', description: '', commands: [], agents: [], skills: [], requires: [], rules: ['rule-b'] },
    ];
    const map = buildRulesMap(plugins);
    expect(map.size).toBe(2);
    expect(map.get('rule-a')).toBe('plugin-a');
    expect(map.get('rule-b')).toBe('plugin-b');
  });

  it('throws on invalid rule name', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], requires: [], rules: ['Bad Name'] },
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
    // Invalid-shadow tolerance still applies — the shadow is invalid, but the hard-error
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
        curation: true,
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
        curation: true,
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
        curation: true,
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
          curation: true,
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

  it('FEATURE_OWNED_RULES (compliance): skips stamped installed file, seeds from canonical source with placeholder (I24)', async () => {
    // The installed compliance.md is already stamped — ${DEVFLOW_COMPLIANCE_FRAMEWORKS} has been
    // replaced with label text. Seeding a shadow from it destroys the placeholder and permanently
    // disables framework stamping. seedRuleShadow must skip Tier 1 for FEATURE_OWNED_RULES and
    // use Tier 2 (canonical src/assets/rules/compliance.md which contains the placeholder).
    const stampedContent = '# Compliance\n- Active frameworks: GDPR, SOX\n'; // no placeholder
    await fs.writeFile(path.join(rulesTarget, 'compliance.md'), stampedContent, 'utf-8');
    const shadowFile = path.join(devflowDir, 'rules', 'compliance.md');

    const tier = await seedRuleShadow('compliance', shadowFile, rulesTarget, devflowDir);

    // Must choose Tier 2 (canonical source), not Tier 1 (stamped installed file)
    expect(tier).toBe('source');
    const content = await fs.readFile(shadowFile, 'utf-8');
    expect(content).toContain(COMPLIANCE_RULE_PLACEHOLDER);
    expect(content).not.toBe(stampedContent);
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

// ---------------------------------------------------------------------------
// D-CONTEXT-ECONOMY-RULE (#427)
// ---------------------------------------------------------------------------

/**
 * D-CONTEXT-ECONOMY-RULE: reading discipline is a core rule that reaches every session. Its body is
 * about 400 characters (a hard ceiling of 450, because the rule is billed in every session), holds
 * three directives, and names no search binary and no count flag, so the count directive stays
 * tool-neutral. The core plugin registers it (src/core/plugins.ts carries the D-name at the
 * registration), and every rule-count statement in the docs equals the number of rule files.
 */
const RULES_SRC = path.join(import.meta.dirname, '..', 'src', 'assets', 'rules');
const CONTEXT_ECONOMY_PATH = path.join(RULES_SRC, 'context-economy.md');

/** The three directives, one regex each, matched against the body. */
const CONTEXT_ECONOMY_DIRECTIVES: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'list a large file\'s headings, then read the ranges needed', re: /over about 40 KB: list its headings first, then read only the ranges you need/ },
  { label: 'list or count matches before printing, and treat an error as refused, not zero', re: /list or count them[^\n]*confirm the search accepted the pattern[^\n]*refused, not zero/ },
  { label: 'never print a large file whole', re: /Never print a large file whole/ },
];

/** Named collector: how a rule file departs from the context-economy design. */
export function collectContextEconomyDefects(text: string): string[] {
  const out: string[] = [];
  const m = /^---\npaths: \[\]\n---\n/.exec(text);
  if (!m) out.push('the frontmatter is not exactly `paths: []`');
  const body = text.slice(m ? m[0].length : 0).trim();
  if (body.length < 400 || body.length > 450) out.push(`the body is ${body.length} characters, expected 400 to 450`);
  for (const { label, re } of CONTEXT_ECONOMY_DIRECTIVES) if (!re.test(body)) out.push(`missing directive: ${label}`);
  if (/\b(?:grep|rg|ripgrep|ugrep|ack|wc)\b/i.test(body)) out.push('names a search or count binary');
  if (/(?:^|\s)-[cl]\b/.test(body)) out.push('names a count flag');
  return out;
}

describe('context-economy rule (D-CONTEXT-ECONOMY-RULE)', () => {
  it('the rule file exists with empty-paths frontmatter, three directives and a body of 400 to 450 characters', async () => {
    const text = await fs.readFile(CONTEXT_ECONOMY_PATH, 'utf-8');
    expect(collectContextEconomyDefects(text)).toEqual([]);
  });

  it('the core plugin registers it, and the registry knows it as a valid rule name', () => {
    const core = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills')!;
    expect(core.rules).toContain('context-economy');
    expect(buildRulesMap([core]).get('context-economy')).toBe('devflow-core-skills');
    expect(getAllRuleNames()).toContain('context-economy');
    expect(isValidRuleName('context-economy')).toBe(true);
  });

  it('installRuleFile installs it flat, frontmatter intact', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-context-economy-'));
    try {
      const target = path.join(tmp, 'rules', 'devflow');
      await fs.mkdir(target, { recursive: true });
      expect(await installRuleFile('context-economy', path.join(tmp, 'devflow'), target)).toBe('source');
      const installed = await fs.readFile(path.join(target, 'context-economy.md'), 'utf-8');
      expect(installed).toBe(await fs.readFile(CONTEXT_ECONOMY_PATH, 'utf-8'));
      expect(installed.startsWith('---\npaths: []\n---\n')).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('every rule-count statement in the docs equals the number of rule files', async () => {
    const files = (await fs.readdir(RULES_SRC)).filter(f => f.endsWith('.md'));
    expect(files.length, 'nothing counted').toBeGreaterThan(10);
    const statements: Array<[string, RegExp]> = [
      ['docs/reference/file-organization.md', /# (\d+) rules \(flat \.md files\)/],
      ['CONTRIBUTING.md', /# (\d+) rules \(single source of truth, flat \.md files\)/],
    ];
    for (const [rel, re] of statements) {
      const text = await fs.readFile(path.join(import.meta.dirname, '..', rel), 'utf-8');
      const match = re.exec(text);
      expect(match, `${rel}: no rule-count statement`).not.toBeNull();
      expect(Number(match![1]), rel).toBe(files.length);
    }
  });

  it('known-bad probe: a longer body, a moved paths line, a lost directive, a named binary and a count flag are each reported', async () => {
    const real = await fs.readFile(CONTEXT_ECONOMY_PATH, 'utf-8');
    expect(collectContextEconomyDefects(real)).toEqual([]);
    expect(collectContextEconomyDefects(`${real}\n- ${'padding '.repeat(10)}`)).toEqual([
      expect.stringMatching(/the body is \d+ characters, expected 400 to 450/),
    ]);
    expect(collectContextEconomyDefects(real.replace('paths: []', 'paths: ["**/*"]'))).toContain('the frontmatter is not exactly `paths: []`');
    expect(collectContextEconomyDefects(real.replace('Never print a large file whole', 'Print what you like'))).toContain(
      'missing directive: never print a large file whole',
    );
    expect(collectContextEconomyDefects(real.replace('list or count them', 'grep -c them'))).toEqual(
      expect.arrayContaining(['names a search or count binary', 'names a count flag']),
    );
    expect(collectContextEconomyDefects(real.replace('list or count them', 'run wc on them'))).toContain('names a search or count binary');
    expect(collectContextEconomyDefects('no frontmatter')).toContain('the frontmatter is not exactly `paths: []`');
  });
});

// ---------------------------------------------------------------------------
// D-BEHAVIOR-RULE
// ---------------------------------------------------------------------------

/**
 * D-BEHAVIOR-RULE: how agents reply and act is a rule, not a skill, because it must reach
 * every session and every subagent that loads the rules, with no activation step. It is OPT-IN
 * (D-BEHAVIOR-OPT-IN): feature-owned like the compliance rule, off by default, installed only
 * while the install includes rules and `features.behavior` is on. The rule is a
 * title and a bullet list, one bullet per behavior, and no other prose. The first behavior is the
 * reply style: the maintainer runs many agent sessions in parallel and loses track of each one, so
 * every reply is written in ASD-STE100 Simplified Technical English. That bullet covers replies
 * only, and code, commands and quoted text keep their own form. The rule is billed in every
 * session, so the body stays under a hard ceiling of 500 characters, and each sentence follows the
 * 25-word limit the reply style sets for a description. A new behavior fits the ceiling or retires
 * one; the ceiling does not rise.
 */
const BEHAVIOR_PATH = path.join(RULES_SRC, 'behavior.md');
const BEHAVIOR_BODY_CEILING = 500;
const BEHAVIOR_SENTENCE_WORDS = 25;

/** The behaviors the rule holds, one regex each, matched against the body. */
const BEHAVIOR_BULLETS: ReadonlyArray<{ label: string; re: RegExp }> = [
  {
    label: 'write replies in ASD-STE100 Simplified Technical English, with its style points and scope',
    re: /^- Write replies in ASD-STE100 Simplified Technical English: short sentences, one idea each, common words, active voice, simple tenses\. Code, commands and quoted text keep their own form\.$/m,
  },
];

/** Named collector: how a rule file departs from the behavior-rule design. */
export function collectBehaviorDefects(text: string): string[] {
  const out: string[] = [];
  const m = /^---\npaths: \[\]\n---\n/.exec(text);
  if (!m) out.push('the frontmatter is not exactly `paths: []`');
  const body = text.slice(m ? m[0].length : 0).trim();
  if (body.length > BEHAVIOR_BODY_CEILING) {
    out.push(`the body is ${body.length} characters, over the ${BEHAVIOR_BODY_CEILING} ceiling`);
  }
  const lines = body.split('\n').filter(line => line.trim() !== '');
  if (lines[0] !== '# Behavior') out.push('the first line is not the title `# Behavior`');
  for (const line of lines.slice(1)) if (!line.startsWith('- ')) out.push(`a line is not a bullet: "${line}"`);
  for (const { label, re } of BEHAVIOR_BULLETS) if (!re.test(body)) out.push(`missing behavior: ${label}`);
  const sentences = lines.slice(1).flatMap(line => line.replace(/^-\s+/, '').split(/[.:]/)).map(s => s.trim()).filter(s => s.length > 0);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).length;
    if (words > BEHAVIOR_SENTENCE_WORDS) out.push(`a sentence has ${words} words, over ${BEHAVIOR_SENTENCE_WORDS}: "${sentence}"`);
  }
  return out;
}

describe('behavior rule (D-BEHAVIOR-RULE)', () => {
  it('the rule file exists with empty-paths frontmatter, a title, only bullets, the reply behavior and a body under the ceiling', async () => {
    const text = await fs.readFile(BEHAVIOR_PATH, 'utf-8');
    expect(collectBehaviorDefects(text)).toEqual([]);
  });

  it('is feature-owned: no plugin declares it, so no install carries it unless the switch is on', () => {
    expect(FEATURE_OWNED_RULES).toContain('behavior');
    expect(getAllRuleNames()).not.toContain('behavior');
    for (const plugin of DEVFLOW_PLUGINS) {
      expect(plugin.rules, `${plugin.name} must not declare the opt-in behavior rule`).not.toContain('behavior');
    }
    expect(buildRulesMap(DEVFLOW_PLUGINS).has('behavior')).toBe(false);
    expect(isValidRuleName('behavior')).toBe(true);
  });

  it('installRuleFile installs it flat, frontmatter intact', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-behavior-'));
    try {
      const target = path.join(tmp, 'rules', 'devflow');
      await fs.mkdir(target, { recursive: true });
      expect(await installRuleFile('behavior', path.join(tmp, 'devflow'), target)).toBe('source');
      const installed = await fs.readFile(path.join(target, 'behavior.md'), 'utf-8');
      expect(installed).toBe(await fs.readFile(BEHAVIOR_PATH, 'utf-8'));
      expect(installed.startsWith('---\npaths: []\n---\n')).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('known-bad probe: a longer body, a moved paths line, a lost behavior, a prose line and a long sentence are each reported', async () => {
    const real = await fs.readFile(BEHAVIOR_PATH, 'utf-8');
    expect(collectBehaviorDefects(real)).toEqual([]);
    expect(collectBehaviorDefects(`${real}- ${'padding '.repeat(60)}\n`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/the body is \d+ characters, over the 500 ceiling/)]),
    );
    expect(collectBehaviorDefects(real.replace('paths: []', 'paths: ["**/*"]'))).toContain('the frontmatter is not exactly `paths: []`');
    expect(collectBehaviorDefects(real.replace('active voice', 'any voice'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^missing behavior: write replies in ASD-STE100/)]),
    );
    expect(collectBehaviorDefects(`${real}\nSome prose.\n`)).toContain('a line is not a bullet: "Some prose."');
    expect(collectBehaviorDefects(real.replace('# Behavior', '# Plain English'))).toContain('the first line is not the title `# Behavior`');
    const longSentence = Array.from({ length: BEHAVIOR_SENTENCE_WORDS + 1 }, () => 'a').join(' ');
    expect(collectBehaviorDefects(`${real}- ${longSentence}.\n`)).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`a sentence has ${BEHAVIOR_SENTENCE_WORDS + 1} words`))]),
    );
    expect(collectBehaviorDefects('no frontmatter')).toContain('the frontmatter is not exactly `paths: []`');
  });
});

// ---------------------------------------------------------------------------
// quality rule cleanup bullet
// ---------------------------------------------------------------------------

/**
 * The quality rule has one bullet that opens `- Cut `. It tells every agent that loads the rules
 * what to remove while it writes, because /implement and /resolve skip Polish at `standard` and
 * `lean`. Its trust-boundary and fail-closed qualifier protects runtime checks and catches only.
 * A debug statement is removed at a trust boundary too, because a debug line there prints a
 * request body or a token. The bullet is billed in every session, so it has a byte ceiling that
 * does not rise. The guard reads the bullet by its opening words, so a reword keeps the shape.
 */
const QUALITY_PATH = path.join(RULES_SRC, 'quality.md');
const QUALITY_CUT_BULLET_CEILING = 240;
const QUALITY_QUALIFIER = /trust boundary|fail-closed path/;

/** Named collector: how the quality cleanup bullet departs from its design. */
export function collectQualityCutBulletDefects(text: string): string[] {
  const bullets = text.split('\n').filter(line => line.startsWith('- Cut '));
  if (bullets.length !== 1) return [`expected one bullet that opens "- Cut ", found ${bullets.length}`];
  const bullet = bullets[0];
  const out: string[] = [];
  const bytes = Buffer.byteLength(bullet, 'utf-8');
  if (bytes > QUALITY_CUT_BULLET_CEILING) {
    out.push(`the cut bullet is ${bytes} bytes, over the ${QUALITY_CUT_BULLET_CEILING} ceiling`);
  }
  for (const phrase of ['trust boundary', 'fail-closed path']) {
    if (!bullet.includes(phrase)) out.push(`the cut bullet lost "${phrase}"`);
  }
  const clauses = bullet.split(';');
  const debugClauses = clauses.filter(clause => clause.includes('debug statements'));
  const checkClauses = clauses.filter(clause => /checks|catches/.test(clause));
  if (debugClauses.length === 0) out.push('the cut bullet does not name debug statements');
  if (checkClauses.length === 0) out.push('the cut bullet does not name checks and catches');
  if (debugClauses.some(clause => QUALITY_QUALIFIER.test(clause))) {
    out.push('the trust-boundary qualifier binds to debug statements');
  }
  if (checkClauses.some(clause => !QUALITY_QUALIFIER.test(clause))) {
    out.push('the trust-boundary qualifier does not bind to the checks and catches');
  }
  return out;
}

const OVER_CEILING = new RegExp(`^the cut bullet is \\d+ bytes, over the ${QUALITY_CUT_BULLET_CEILING} ceiling$`);

/** A well-formed cut bullet with no padding. It does not depend on the shipped bullet. */
const BASE_CUT_BULLET =
  '- Cut leftover debug statements; cut checks and catches around code that cannot throw, never at a trust boundary or fail-closed path';

/**
 * The base bullet padded to exactly CEILING - 1 characters, plus one last character. With an
 * ASCII `last` the bullet is CEILING bytes. With a multibyte `last` it is CEILING characters and
 * more than CEILING bytes, so only a collector that counts bytes reports it.
 */
function cutBulletAtCeiling(last: string): string {
  const room = QUALITY_CUT_BULLET_CEILING - 1 - BASE_CUT_BULLET.length;
  expect(room, 'the base bullet must fit under the ceiling with room to pad').toBeGreaterThan(0);
  return BASE_CUT_BULLET.replace('debug statements', `debug statements${'x'.repeat(room)}${last}`);
}

/** The bullet as first shipped: one sentence, so the qualifier also covers debug statements. */
const UNSPLIT_CUT_BULLET =
  '- Cut leftover debug statements, unused imports, variables used once right after assignment, nested ternaries, checks the type system enforces and catches around code that cannot throw — never at a trust boundary or a fail-closed path';

describe('quality rule cleanup bullet', () => {
  it('binds the qualifier to the checks and catches only, and stays within the byte ceiling', async () => {
    const text = await fs.readFile(QUALITY_PATH, 'utf-8');
    expect(collectQualityCutBulletDefects(text)).toEqual([]);
  });

  it('known-bad probe: each departure from the design is reported by the same collector', async () => {
    const real = await fs.readFile(QUALITY_PATH, 'utf-8');
    const bullet = real.split('\n').find(line => line.startsWith('- Cut '))!;
    expect(collectQualityCutBulletDefects(real)).toEqual([]);

    expect(collectQualityCutBulletDefects(real.replace(bullet, UNSPLIT_CUT_BULLET))).toContain(
      'the trust-boundary qualifier binds to debug statements',
    );
    expect(collectQualityCutBulletDefects(real.replace(bullet, `${bullet} ${'padding '.repeat(10)}`))).toEqual(
      expect.arrayContaining([expect.stringMatching(OVER_CEILING)]),
    );
    expect(collectQualityCutBulletDefects(real.replace(bullet, cutBulletAtCeiling('x')))).toEqual([]);
    const widened = cutBulletAtCeiling('—');
    expect(widened.length).toBe(QUALITY_CUT_BULLET_CEILING);
    expect(Buffer.byteLength(widened, 'utf-8')).toBeGreaterThan(QUALITY_CUT_BULLET_CEILING);
    expect(collectQualityCutBulletDefects(real.replace(bullet, widened))).toEqual([
      `the cut bullet is ${Buffer.byteLength(widened, 'utf-8')} bytes, over the ${QUALITY_CUT_BULLET_CEILING} ceiling`,
    ]);
    expect(collectQualityCutBulletDefects(real.replace(bullet, bullet.replace(/, never at a trust boundary or fail-closed path$/, '')))).toEqual(
      expect.arrayContaining([
        'the cut bullet lost "trust boundary"',
        'the cut bullet lost "fail-closed path"',
        'the trust-boundary qualifier does not bind to the checks and catches',
      ]),
    );
    const moved = '- Cut leftover debug statements, never at a trust boundary or fail-closed path; cut checks the types enforce and catches around code that cannot throw';
    expect(collectQualityCutBulletDefects(real.replace(bullet, moved))).toContain(
      'the trust-boundary qualifier binds to debug statements',
    );
    const unqualifiedCheck = '- Cut leftover debug statements, checks the types enforce; cut checks and catches around code that cannot throw, never at a trust boundary or fail-closed path';
    expect(collectQualityCutBulletDefects(real.replace(bullet, unqualifiedCheck))).toEqual([
      'the trust-boundary qualifier does not bind to the checks and catches',
    ]);
    expect(collectQualityCutBulletDefects(real.replace(bullet, ''))).toEqual([
      'expected one bullet that opens "- Cut ", found 0',
    ]);
    expect(collectQualityCutBulletDefects(`${real}${bullet}\n`)).toEqual([
      'expected one bullet that opens "- Cut ", found 2',
    ]);
  });
});

// ---------------------------------------------------------------------------
// quality rule doc-sweep and owner bullets, testing skill assertion probe
// ---------------------------------------------------------------------------

/**
 * Three always-on lines target the review findings that come most often: a doc that still states a
 * fact the change replaced, a parallel copy of code that already has an owner, and an assertion
 * that still passes with the change reverted. The two quality bullets are billed in every session
 * that loads the rules, so they share one byte ceiling that does not rise. The probe line is an
 * item in the Quality Gates of the testing skill. The guard finds each line by its opening words,
 * so a reword keeps the shape, and pins the limits that keep each line safe: a security fix is
 * described by its effect only, a check at a trust boundary is not a copy, and the revert that
 * proves an assertion is temporary. The sweep bullet must not name CLAUDE.md, an agent instruction file.
 */
const TESTING_SKILL_PATH = path.join(import.meta.dirname, '..', 'src', 'assets', 'skills', 'testing', 'SKILL.md');
const QUALITY_SWEEP_OWNER_BULLETS_CEILING = 324;

interface PinnedLine {
  /** How a defect names the line. */
  readonly name: string;
  readonly file: 'quality' | 'testing';
  /** The opening words that find the line, exactly once, in its file. */
  readonly prefix: string;
  /** Limits that stay in the line. */
  readonly phrases: readonly string[];
  /** The line directly before this one opens with these words. */
  readonly after?: string;
  /** The heading, without its `## `, of the section that holds the line. */
  readonly section?: string;
  /** Text the line must not hold, with the defect that reports it. */
  readonly forbidden?: readonly { readonly text: string; readonly defect: string }[];
}

const SWEEP_BULLET: PinnedLine = {
  name: 'doc-sweep bullet',
  file: 'quality',
  prefix: '- When a change alters a name, path or behavior',
  phrases: [
    'current tracked docs that state the old fact',
    'not released changelog entries',
    'for a security fix, state the effect only',
  ],
  after: '- Leave the end-state',
  forbidden: [{ text: 'CLAUDE.md', defect: 'the doc-sweep bullet names CLAUDE.md' }],
};

const OWNER_BULLET: PinnedLine = {
  name: 'owner bullet',
  file: 'quality',
  prefix: '- Find the existing owner first',
  phrases: ['shares its job', 'never add a parallel copy', 'a check at a trust boundary is not a copy'],
  after: '- Single responsibility',
};

const PROBE_LINE: PinnedLine = {
  name: 'probe line',
  file: 'testing',
  prefix: '- [ ] Each new assertion',
  phrases: ['would fail, not error, with the change reverted', 'RED run counts', 'temporary uncommitted revert'],
  section: 'Quality Gates',
  forbidden: [{ text: 'known-bad', defect: 'the probe line names "known-bad"' }],
};

const PINNED_LINES: readonly PinnedLine[] = [SWEEP_BULLET, OWNER_BULLET, PROBE_LINE];

/** True when the line at `index` sits between the `## <section>` heading and the next `## ` heading. */
function lineIsInSection(lines: readonly string[], index: number, section: string): boolean {
  const start = lines.findIndex(line => line.startsWith(`## ${section}`));
  if (start === -1 || index < start) return false;
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return next === -1 || index < next;
}

/** Named collector: how the doc-sweep, owner and probe lines depart from their design. */
export function collectSweepOwnerProbeDefects(quality: string, testing: string): string[] {
  const texts = { quality, testing };
  const out: string[] = [];
  const found = new Map<PinnedLine, string>();
  for (const pinned of PINNED_LINES) {
    const lines = texts[pinned.file].split('\n');
    const matches = lines.filter(line => line.startsWith(pinned.prefix));
    if (matches.length !== 1) {
      out.push(`expected one ${pinned.name} that opens "${pinned.prefix}", found ${matches.length}`);
      continue;
    }
    const line = matches[0];
    const index = lines.indexOf(line);
    found.set(pinned, line);
    for (const phrase of pinned.phrases) {
      if (!line.includes(phrase)) out.push(`the ${pinned.name} lost "${phrase}"`);
    }
    if (pinned.after !== undefined && !lines[index - 1]?.startsWith(pinned.after)) {
      out.push(`the ${pinned.name} does not follow the line that opens "${pinned.after}"`);
    }
    if (/[^\x20-\x7e]/.test(line)) out.push(`the ${pinned.name} holds a non-ASCII character`);
    if (pinned.file === 'quality' && line.endsWith('.')) out.push(`the ${pinned.name} ends with a period`);
    if (pinned.section !== undefined && !lineIsInSection(lines, index, pinned.section)) {
      out.push(`the ${pinned.name} is not in the ${pinned.section} section`);
    }
    for (const { text, defect } of pinned.forbidden ?? []) {
      if (line.includes(text)) out.push(defect);
    }
  }
  const sweep = found.get(SWEEP_BULLET);
  const owner = found.get(OWNER_BULLET);
  if (sweep !== undefined && owner !== undefined) {
    const bytes = Buffer.byteLength(sweep, 'utf-8') + Buffer.byteLength(owner, 'utf-8');
    if (bytes > QUALITY_SWEEP_OWNER_BULLETS_CEILING) {
      out.push(`the doc-sweep and owner bullets are ${bytes} bytes, over the ${QUALITY_SWEEP_OWNER_BULLETS_CEILING} ceiling`);
    }
  }
  return out;
}

async function readSweepOwnerProbeTexts(): Promise<{ quality: string; testing: string }> {
  return {
    quality: await fs.readFile(QUALITY_PATH, 'utf-8'),
    testing: await fs.readFile(TESTING_SKILL_PATH, 'utf-8'),
  };
}

describe('quality rule doc-sweep and owner bullets, testing skill assertion probe', () => {
  it('pins the three lines, their limits and their placement, and holds the two bullets under the byte ceiling', async () => {
    const { quality, testing } = await readSweepOwnerProbeTexts();
    expect(collectSweepOwnerProbeDefects(quality, testing)).toEqual([]);
  });

  it('known-bad probe: each departure from the design is reported by the same collector', async () => {
    const real = await readSweepOwnerProbeTexts();
    const lineOf = (pinned: PinnedLine): string =>
      real[pinned.file].split('\n').find(line => line.startsWith(pinned.prefix))!;
    const replaceLine = (text: string, line: string, replacement: string): string =>
      text.replace(line, () => replacement);
    /** The collector's report for the real texts with one pinned line's file edited. */
    const defectsWith = (pinned: PinnedLine, edit: (text: string, line: string) => string): string[] => {
      const edited = { ...real, [pinned.file]: edit(real[pinned.file], lineOf(pinned)) };
      return collectSweepOwnerProbeDefects(edited.quality, edited.testing);
    };
    /** The line with a multibyte character in place of the separator after its prefix. The quality bullets keep their byte count. */
    const withNonAscii = (pinned: PinnedLine, line: string): string =>
      `${pinned.prefix}é${line.slice(pinned.prefix.length).replace(/^[:, ]+/, '')}`;
    /** The line with a final period in place of the separator after its prefix. The quality bullets keep their byte count. */
    const withPeriod = (pinned: PinnedLine, line: string): string =>
      `${pinned.prefix}${line.slice(pinned.prefix.length + 1)}.`;

    // Non-vacuity: the real texts give no defect and hold every prefix, phrase and anchor the seeds below rely on.
    expect(collectSweepOwnerProbeDefects(real.quality, real.testing)).toEqual([]);
    for (const pinned of PINNED_LINES) {
      expect(real[pinned.file]).toContain(pinned.prefix);
      for (const phrase of pinned.phrases) expect(lineOf(pinned)).toContain(phrase);
      if (pinned.after !== undefined) expect(real[pinned.file]).toContain(pinned.after);
      if (pinned.section !== undefined) expect(real[pinned.file]).toContain(`## ${pinned.section}`);
    }

    for (const pinned of PINNED_LINES) {
      expect(defectsWith(pinned, (text, line) => replaceLine(text, line, ''))).toEqual([
        `expected one ${pinned.name} that opens "${pinned.prefix}", found 0`,
      ]);
      expect(defectsWith(pinned, (text, line) => replaceLine(text, line, `${line}\n${line}`))).toEqual([
        `expected one ${pinned.name} that opens "${pinned.prefix}", found 2`,
      ]);
      for (const phrase of pinned.phrases) {
        expect(defectsWith(pinned, (text, line) => replaceLine(text, line, line.replace(phrase, '')))).toEqual([
          `the ${pinned.name} lost "${phrase}"`,
        ]);
      }
      expect(defectsWith(pinned, (text, line) => replaceLine(text, line, withNonAscii(pinned, line)))).toEqual([
        `the ${pinned.name} holds a non-ASCII character`,
      ]);
    }

    for (const pinned of PINNED_LINES.filter(candidate => candidate.after !== undefined)) {
      const atEndOfFile = (text: string, line: string): string => `${replaceLine(text, `${line}\n`, '')}${line}\n`;
      expect(defectsWith(pinned, atEndOfFile)).toEqual([
        `the ${pinned.name} does not follow the line that opens "${pinned.after}"`,
      ]);
    }

    for (const pinned of PINNED_LINES.filter(candidate => candidate.file === 'quality')) {
      expect(defectsWith(pinned, (text, line) => replaceLine(text, line, withPeriod(pinned, line)))).toEqual([
        `the ${pinned.name} ends with a period`,
      ]);
    }

    // The two bullets can sit at the byte ceiling, so a seed that only adds the name can also trip it. This seed puts
    // the name in place of two longer words, and every pinned phrase stays.
    expect(defectsWith(SWEEP_BULLET, (text, line) => replaceLine(text, line, line.replace('update the', 'CLAUDE.md')))).toEqual([
      'the doc-sweep bullet names CLAUDE.md',
    ]);
    expect(defectsWith(PROBE_LINE, (text, line) => replaceLine(text, line, `${line} known-bad`))).toEqual([
      'the probe line names "known-bad"',
    ]);

    const aboveHeading = (text: string, line: string): string =>
      replaceLine(text, `${line}\n`, '').replace('## Quality Gates', () => `${line}\n\n## Quality Gates`);
    expect(defectsWith(PROBE_LINE, aboveHeading)).toEqual(['the probe line is not in the Quality Gates section']);
    expect(defectsWith(PROBE_LINE, text => text.replace('## Quality Gates', () => '## Gates'))).toEqual([
      'the probe line is not in the Quality Gates section',
    ]);
    // Quality Gates is the last `## ` heading, so only a heading added after it gives the section an end above the line.
    const belowNextHeading = (text: string, line: string): string =>
      `${replaceLine(text, `${line}\n`, '').trimEnd()}\n\n## Appendix\n\n${line}\n`;
    expect(defectsWith(PROBE_LINE, belowNextHeading)).toEqual(['the probe line is not in the Quality Gates section']);

    // Oversize seeds compute their padding from the shipped size, so they stay valid when a later edit shortens a bullet.
    const realTotal = Buffer.byteLength(lineOf(SWEEP_BULLET), 'utf-8') + Buffer.byteLength(lineOf(OWNER_BULLET), 'utf-8');
    const room = QUALITY_SWEEP_OWNER_BULLETS_CEILING - realTotal;
    expect(room, 'the two bullets must fit under the ceiling').toBeGreaterThanOrEqual(0);
    const padOwner = (text: string, line: string, pad: string): string =>
      replaceLine(text, line, line.replace('extend it', `extend it${pad}`));
    expect(defectsWith(OWNER_BULLET, (text, line) => padOwner(text, line, 'x'.repeat(room)))).toEqual([]);
    expect(defectsWith(OWNER_BULLET, (text, line) => padOwner(text, line, 'x'.repeat(room + 1)))).toEqual([
      `the doc-sweep and owner bullets are ${QUALITY_SWEEP_OWNER_BULLETS_CEILING + 1} bytes, over the ${QUALITY_SWEEP_OWNER_BULLETS_CEILING} ceiling`,
    ]);

    // A multibyte seed: the two bullets total exactly the ceiling in characters and more in bytes, so only a
    // collector that counts bytes reports it. The multibyte character is also a non-ASCII defect.
    const multibyteOwner = lineOf(OWNER_BULLET).replace('extend it', `extend—it${'x'.repeat(room)}`);
    const multibyteChars = lineOf(SWEEP_BULLET).length + multibyteOwner.length;
    const multibyteBytes = Buffer.byteLength(lineOf(SWEEP_BULLET), 'utf-8') + Buffer.byteLength(multibyteOwner, 'utf-8');
    expect(multibyteChars).toBe(QUALITY_SWEEP_OWNER_BULLETS_CEILING);
    expect(multibyteBytes).toBeGreaterThan(QUALITY_SWEEP_OWNER_BULLETS_CEILING);
    expect(defectsWith(OWNER_BULLET, (text, line) => replaceLine(text, line, multibyteOwner))).toEqual([
      'the owner bullet holds a non-ASCII character',
      `the doc-sweep and owner bullets are ${multibyteBytes} bytes, over the ${QUALITY_SWEEP_OWNER_BULLETS_CEILING} ceiling`,
    ]);
  });
});
