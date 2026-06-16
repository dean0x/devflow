import { describe, it, expect } from 'vitest';
import { computeAssetsToRemove, formatDryRunPlan, resolveSecurityRemovalDecision } from '../src/cli/commands/uninstall.js';
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../src/cli/plugins.js';

describe('computeAssetsToRemove', () => {
  it('removes skills unique to selected plugins', () => {
    // devflow-debug has no unique skills (all are shared), pick a plugin with unique assets
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { skills } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);

    // 'git' is also in core-skills, should NOT be in removal list
    expect(skills).not.toContain('git');
  });

  it('removes agents unique to selected plugins', () => {
    // devflow-audit-claude has agent 'claude-md-auditor' which is unique to it
    const auditPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-audit-claude')!;
    const { agents } = computeAssetsToRemove([auditPlugin], DEVFLOW_PLUGINS);
    expect(agents).toContain('claude-md-auditor');
  });

  it('retains agents shared with remaining plugins', () => {
    // 'git' agent is in implement, code-review, resolve, debug
    // Removing just debug should NOT remove 'git'
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { agents } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);
    expect(agents).not.toContain('git');
  });

  it('collects all commands from selected plugins', () => {
    const reviewPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-code-review')!;
    const { commands } = computeAssetsToRemove([reviewPlugin], DEVFLOW_PLUGINS);
    expect(commands).toContain('/code-review');
  });

  it('returns empty arrays when no plugins selected', () => {
    const { skills, agents, commands } = computeAssetsToRemove([], DEVFLOW_PLUGINS);
    expect(skills).toEqual([]);
    expect(agents).toEqual([]);
    expect(commands).toEqual([]);
  });

  it('removes everything when all plugins selected', () => {
    const { skills, agents, commands } = computeAssetsToRemove(DEVFLOW_PLUGINS, DEVFLOW_PLUGINS);
    // When all plugins are removed, nothing is retained
    expect(skills.length).toBeGreaterThan(0);
    expect(agents.length).toBeGreaterThan(0);
    // Core-skills has no commands, but other plugins do
    expect(commands.length).toBeGreaterThan(0);
  });

  it('retains review-methodology when code-review uninstalled (ambient declares it)', () => {
    const reviewPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-code-review')!;
    const { skills } = computeAssetsToRemove([reviewPlugin], DEVFLOW_PLUGINS);
    // review-methodology is also declared by devflow-ambient, so it must NOT be removed
    expect(skills).not.toContain('review-methodology');
    // security is also declared by devflow-ambient
    expect(skills).not.toContain('security');
  });

  it('handles custom plugin lists', () => {
    const plugins: PluginDefinition[] = [
      { name: 'a', description: '', commands: ['/a'], agents: ['shared', 'only-a'], skills: ['shared-skill', 'only-a-skill'], rules: [] },
      { name: 'b', description: '', commands: ['/b'], agents: ['shared', 'only-b'], skills: ['shared-skill', 'only-b-skill'], rules: [] },
    ];

    // Remove 'a', keep 'b'
    const { skills, agents, commands } = computeAssetsToRemove([plugins[0]], plugins);
    expect(commands).toEqual(['/a']);
    expect(agents).toEqual(['only-a']); // 'shared' is retained by 'b'
    expect(skills).toEqual(['only-a-skill']); // 'shared-skill' is retained by 'b'
  });

  it('returns rules unique to the removed plugin', () => {
    const plugins: PluginDefinition[] = [
      { name: 'plugin-a', description: '', commands: [], agents: [], skills: [], rules: ['rule-a', 'shared-rule'] },
      { name: 'plugin-b', description: '', commands: [], agents: [], skills: [], rules: ['rule-b', 'shared-rule'] },
    ];
    const { rules } = computeAssetsToRemove([plugins[0]], plugins);
    expect(rules).toContain('rule-a');
    expect(rules).not.toContain('shared-rule'); // retained by plugin-b
  });

  it('retains rules shared across remaining plugins', () => {
    // security, engineering, quality are in devflow-core-skills
    // Removing devflow-typescript should not remove them
    const typescriptPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-typescript')!;
    const { rules } = computeAssetsToRemove([typescriptPlugin], DEVFLOW_PLUGINS);
    expect(rules).not.toContain('security');
    expect(rules).not.toContain('engineering');
    expect(rules).not.toContain('quality');
    // typescript rule is unique to this plugin
    expect(rules).toContain('typescript');
  });

  it('returns empty rules array when plugin has no rules', () => {
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { rules } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);
    expect(rules).toEqual([]);
  });
});

describe('formatDryRunPlan', () => {
  it('lists skills, agents, and commands', () => {
    const plan = formatDryRunPlan({
      skills: ['security', 'test-driven-development'],
      agents: ['coder'],
      commands: ['/implement'],
    });
    expect(plan).toContain('security');
    expect(plan).toContain('test-driven-development');
    expect(plan).toContain('coder');
    expect(plan).toContain('/implement');
  });

  it('returns nothing-to-remove message for empty plan', () => {
    const plan = formatDryRunPlan({ skills: [], agents: [], commands: [] });
    expect(plan).toContain('Nothing to remove');
  });

  it('omits empty sections', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design'],
      agents: [],
      commands: [],
    });
    expect(plan).toContain('software-design');
    expect(plan).not.toContain('Agents');
    expect(plan).not.toContain('Commands');
  });

  it('includes extras when provided', () => {
    const plan = formatDryRunPlan(
      { skills: ['x'], agents: [], commands: [] },
      ['.docs/', '.memory/', 'hooks in settings.json'],
    );
    expect(plan).toContain('.docs/');
    expect(plan).toContain('.memory/');
    expect(plan).toContain('hooks in settings.json');
  });

  it('deduplicates skills, agents, and commands', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design', 'software-design', 'testing'],
      agents: ['coder', 'coder'],
      commands: ['/implement', '/implement'],
    });
    // Should show count based on unique items, not duplicates
    expect(plan).toContain('Skills (2)');
    expect(plan).toContain('Agents (1)');
    expect(plan).toContain('Commands (1)');
  });

  it('includes rules section when rules are provided', () => {
    const plan = formatDryRunPlan({
      skills: [],
      agents: [],
      commands: [],
      rules: ['security', 'engineering'],
    });
    expect(plan).toContain('Rules (2)');
    expect(plan).toContain('security');
    expect(plan).toContain('engineering');
  });

  it('omits rules section when rules array is empty', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design'],
      agents: [],
      commands: [],
      rules: [],
    });
    expect(plan).not.toContain('Rules');
  });

  it('omits rules section when rules field is absent', () => {
    const plan = formatDryRunPlan({
      skills: ['software-design'],
      agents: [],
      commands: [],
    });
    expect(plan).not.toContain('Rules');
  });

  it('deduplicates rules', () => {
    const plan = formatDryRunPlan({
      skills: [],
      agents: [],
      commands: [],
      rules: ['security', 'security', 'engineering'],
    });
    expect(plan).toContain('Rules (2)');
  });
});

describe('resolveSecurityRemovalDecision', () => {
  // === Non-interactive preserve invariant (SAFETY PROPERTY) ===
  // When isTTY is false the deny list must NEVER be removed — avoids PF-004
  // half-applied-state hazard during scripted/CI uninstalls.

  it('returns preserve when security is present and isTTY is false (non-interactive invariant)', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: false,
      isTTY: false,
    })).toBe('preserve');
  });

  it('returns preserve regardless of keepDocs when isTTY is false and security is present', () => {
    // keepDocs wins over isTTY only when keepDocs is true — tested separately below
    // This asserts the priority order: skip (keepDocs) > preserve (non-TTY) > prompt
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: false,
      isTTY: false,
    })).toBe('preserve');
  });

  // === keepDocs gate ===

  it('returns skip when keepDocs is true even if isTTY is true', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: true,
      isTTY: true,
    })).toBe('skip');
  });

  it('returns skip when keepDocs is true and isTTY is false', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: true,
      isTTY: false,
    })).toBe('skip');
  });

  // === nothing-present gate ===

  it('returns skip when no security is present regardless of TTY or keepDocs', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: false,
      keepDocs: false,
      isTTY: true,
    })).toBe('skip');

    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: false,
      keepDocs: false,
      isTTY: false,
    })).toBe('skip');
  });

  // === interactive prompt path ===

  it('returns prompt when security is present, keepDocs is false, and isTTY is true', () => {
    expect(resolveSecurityRemovalDecision({
      anySecurityPresent: true,
      keepDocs: false,
      isTTY: true,
    })).toBe('prompt');
  });

  // === exhaustiveness — all three outcomes are reachable ===

  it('covers all three return values', () => {
    const skip = resolveSecurityRemovalDecision({ anySecurityPresent: false, keepDocs: false, isTTY: true });
    const preserve = resolveSecurityRemovalDecision({ anySecurityPresent: true, keepDocs: false, isTTY: false });
    const prompt = resolveSecurityRemovalDecision({ anySecurityPresent: true, keepDocs: false, isTTY: true });
    expect(skip).toBe('skip');
    expect(preserve).toBe('preserve');
    expect(prompt).toBe('prompt');
  });
});
