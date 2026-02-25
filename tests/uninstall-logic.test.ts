import { describe, it, expect } from 'vitest';
import { computeAssetsToRemove } from '../src/cli/commands/uninstall.js';
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../src/cli/plugins.js';

describe('computeAssetsToRemove', () => {
  it('removes skills unique to selected plugins', () => {
    // devflow-debug has no unique skills (agent-teams + git-safety shared), pick a plugin with unique assets
    const debugPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-debug')!;
    const { skills } = computeAssetsToRemove([debugPlugin], DEVFLOW_PLUGINS);

    // 'agent-teams' is shared with other plugins, should NOT be in removal list
    expect(skills).not.toContain('agent-teams');
    // 'git-safety' is also in core-skills, should NOT be in removal list
    expect(skills).not.toContain('git-safety');
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

  it('handles custom plugin lists', () => {
    const plugins: PluginDefinition[] = [
      { name: 'a', description: '', commands: ['/a'], agents: ['shared', 'only-a'], skills: ['shared-skill', 'only-a-skill'] },
      { name: 'b', description: '', commands: ['/b'], agents: ['shared', 'only-b'], skills: ['shared-skill', 'only-b-skill'] },
    ];

    // Remove 'a', keep 'b'
    const { skills, agents, commands } = computeAssetsToRemove([plugins[0]], plugins);
    expect(commands).toEqual(['/a']);
    expect(agents).toEqual(['only-a']); // 'shared' is retained by 'b'
    expect(skills).toEqual(['only-a-skill']); // 'shared-skill' is retained by 'b'
  });
});
