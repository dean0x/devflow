import { describe, it, expect } from 'vitest';
import {
  DEVFLOW_PLUGINS,
  getAllSkillNames,
  getAllAgentNames,
  buildAssetMaps,
  type PluginDefinition,
} from '../src/cli/plugins.js';

describe('getAllSkillNames', () => {
  it('returns a deduplicated list of skills across all plugins', () => {
    const skills = getAllSkillNames();
    expect(skills.length).toBeGreaterThan(0);
    expect(new Set(skills).size).toBe(skills.length);
  });

  it('includes skills from multiple plugins', () => {
    const skills = getAllSkillNames();
    // 'accessibility' appears in core-skills, implement, and review
    expect(skills).toContain('accessibility');
    // 'agent-teams' appears in multiple plugins
    expect(skills).toContain('agent-teams');
  });
});

describe('getAllAgentNames', () => {
  it('returns a deduplicated list of agents across all plugins', () => {
    const agents = getAllAgentNames();
    expect(agents.length).toBeGreaterThan(0);
    expect(new Set(agents).size).toBe(agents.length);
  });

  it('includes agents from multiple plugins', () => {
    const agents = getAllAgentNames();
    // 'git' appears in implement, review, resolve, debug
    expect(agents).toContain('git');
    expect(agents).toContain('synthesizer');
  });
});

describe('buildAssetMaps', () => {
  it('assigns each asset to the first plugin that declares it', () => {
    const { skillsMap, agentsMap } = buildAssetMaps(DEVFLOW_PLUGINS);

    // 'accessibility' first appears in devflow-core-skills
    expect(skillsMap.get('accessibility')).toBe('devflow-core-skills');

    // 'git' first appears in devflow-implement
    expect(agentsMap.get('git')).toBe('devflow-implement');

    // 'synthesizer' first appears in devflow-specify
    expect(agentsMap.get('synthesizer')).toBe('devflow-specify');
  });

  it('returns empty maps for empty input', () => {
    const { skillsMap, agentsMap } = buildAssetMaps([]);
    expect(skillsMap.size).toBe(0);
    expect(agentsMap.size).toBe(0);
  });

  it('handles a single plugin', () => {
    const single: PluginDefinition[] = [{
      name: 'test-plugin',
      description: 'Test',
      commands: [],
      agents: ['agent-a'],
      skills: ['skill-a', 'skill-b'],
    }];
    const { skillsMap, agentsMap } = buildAssetMaps(single);
    expect(skillsMap.size).toBe(2);
    expect(agentsMap.size).toBe(1);
    expect(skillsMap.get('skill-a')).toBe('test-plugin');
    expect(agentsMap.get('agent-a')).toBe('test-plugin');
  });

  it('deduplicates overlapping skills/agents (first plugin wins)', () => {
    const plugins: PluginDefinition[] = [
      { name: 'first', description: '', commands: [], agents: ['shared-agent'], skills: ['shared-skill'] },
      { name: 'second', description: '', commands: [], agents: ['shared-agent'], skills: ['shared-skill'] },
    ];
    const { skillsMap, agentsMap } = buildAssetMaps(plugins);
    expect(skillsMap.get('shared-skill')).toBe('first');
    expect(agentsMap.get('shared-agent')).toBe('first');
    expect(skillsMap.size).toBe(1);
    expect(agentsMap.size).toBe(1);
  });
});

describe('DEVFLOW_PLUGINS integrity', () => {
  it('has no duplicate plugin names', () => {
    const names = DEVFLOW_PLUGINS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all plugins have required fields', () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      expect(plugin.name).toBeTruthy();
      expect(typeof plugin.name).toBe('string');
      expect(plugin.description).toBeTruthy();
      expect(typeof plugin.description).toBe('string');
      expect(Array.isArray(plugin.commands)).toBe(true);
      expect(Array.isArray(plugin.agents)).toBe(true);
      expect(Array.isArray(plugin.skills)).toBe(true);
    }
  });

  it('all skill and agent names are non-empty strings', () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      for (const skill of plugin.skills) {
        expect(typeof skill).toBe('string');
        expect(skill.length).toBeGreaterThan(0);
      }
      for (const agent of plugin.agents) {
        expect(typeof agent).toBe('string');
        expect(agent.length).toBeGreaterThan(0);
      }
    }
  });

  it('has at least 8 plugins', () => {
    expect(DEVFLOW_PLUGINS.length).toBeGreaterThanOrEqual(8);
  });
});
