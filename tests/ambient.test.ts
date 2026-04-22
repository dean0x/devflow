import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { addAmbientHook, removeAmbientHook, removeLegacyAmbientHook, hasAmbientHook } from '../src/cli/commands/ambient.js';
import type { StreamResult } from './integration/helpers.js';
import {
  hasClassification,
  extractIntent,
  extractDepth,
  hasSkillInvocations,
  parseStreamEvent,
} from './integration/helpers.js';

/** Helper to create a StreamResult from text for unit-testing classification helpers. */
function textResult(text: string, skills: string[] = []): StreamResult {
  return { skills, textFragments: [text], killedEarly: false, durationMs: 0 };
}

describe('addAmbientHook', () => {
  it('adds hook to empty settings', () => {
    const result = addAmbientHook('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].timeout).toBe(5);
  });

  it('adds SessionStart classification hook to empty settings', () => {
    const result = addAmbientHook('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-classification');
    expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(5);
  });

  it('adds alongside existing hooks', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    });
    const result = addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('adds alongside existing UserPromptSubmit hooks', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other-hook.sh' }] }],
      },
    });
    const result = addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
    expect(settings.hooks.UserPromptSubmit[1].hooks[0].command).toContain('preamble');
  });

  it('preserves existing SessionStart hooks (session-start-memory)', () => {
    const input = JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/to/run-hook session-start-memory' }] }],
      },
    });
    const result = addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('session-start-classification');
  });

  it('is idempotent — does not add duplicate hooks', () => {
    const first = addAmbientHook('{}', '/home/user/.devflow');
    const second = addAmbientHook(first, '/home/user/.devflow');

    expect(second).toBe(first);
  });

  it('idempotent for SessionStart classification hook', () => {
    const first = addAmbientHook('{}', '/home/user/.devflow');
    const second = addAmbientHook(first, '/home/user/.devflow');
    const settings = JSON.parse(second);

    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'statusline.sh' },
      env: { SOME_VAR: '1' },
    });
    const result = addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('statusline.sh');
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('uses correct devflowDir path in command via run-hook wrapper', () => {
    const result = addAmbientHook('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);
    const preambleCmd = settings.hooks.UserPromptSubmit[0].hooks[0].command;
    const classificationCmd = settings.hooks.SessionStart[0].hooks[0].command;

    expect(preambleCmd).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(preambleCmd).toContain('preamble');
    expect(classificationCmd).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(classificationCmd).toContain('session-start-classification');
  });

  it('replaces legacy ambient-prompt hook with new preamble hook', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    const result = addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Legacy removed, new preamble added
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).not.toContain('ambient-prompt');
  });

  it('replaces legacy hook while preserving other UserPromptSubmit hooks', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    const result = addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
    expect(settings.hooks.UserPromptSubmit[1].hooks[0].command).toContain('preamble');
  });

  it('adds SessionStart hook even when preamble already exists (upgrade path)', () => {
    // Simulates existing user who has preamble but not classification hook
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/home/user/.devflow/scripts/hooks/run-hook preamble', timeout: 5 }] },
        ],
      },
    });
    const result = addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Preamble preserved (not duplicated)
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    // SessionStart classification hook added
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-classification');
  });
});

describe('removeAmbientHook', () => {
  it('removes ambient hook — clears both UserPromptSubmit and SessionStart', () => {
    const withHook = addAmbientHook('{}', '/home/user/.devflow');
    const result = removeAmbientHook(withHook);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other UserPromptSubmit hooks', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
  });

  it('preserves other SessionStart hooks when removing classification', () => {
    const input = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook session-start-memory' }] },
          { hooks: [{ type: 'command', command: '/path/to/run-hook session-start-classification' }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();
  });

  it('cleans empty hooks object when last hook removed', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hook event types', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();
  });

  it('is idempotent — safe to call when not present', () => {
    const input = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }] } });
    const result = removeAmbientHook(input);

    expect(result).toBe(input);
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command' },
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toEqual({ type: 'command' });
  });

  it('removes legacy ambient-prompt hook', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    const result = removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('removes both legacy and new hooks at once', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
          { hooks: [{ type: 'command', command: '/path/to/run-hook preamble' }] },
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
        ],
      },
    });
    const result = removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
  });
});

describe('removeLegacyAmbientHook', () => {
  it('removes only legacy ambient-prompt hook', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
          { hooks: [{ type: 'command', command: '/path/to/run-hook preamble' }] },
        ],
      },
    });
    const result = removeLegacyAmbientHook(input);
    const settings = JSON.parse(result);

    // Preamble hook preserved, legacy removed
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
  });

  it('is idempotent when no legacy hook present', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook preamble' }] },
        ],
      },
    });
    const result = removeLegacyAmbientHook(input);
    expect(result).toBe(input);
  });

  it('cleans empty structures after removing legacy hook', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    const result = removeLegacyAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });
});

describe('hasAmbientHook', () => {
  it('returns true when current preamble hook present', () => {
    const withHook = addAmbientHook('{}', '/home/user/.devflow');
    expect(hasAmbientHook(withHook)).toBe(true);
  });

  it('returns false when absent', () => {
    expect(hasAmbientHook('{}')).toBe(false);
  });

  it('returns false for non-ambient UserPromptSubmit hooks', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
        ],
      },
    });
    expect(hasAmbientHook(input)).toBe(false);
  });

  it('returns true when ambient hook is among other hooks', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    expect(hasAmbientHook(input)).toBe(true);
  });

  it('detects legacy ambient-prompt hook', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    expect(hasAmbientHook(input)).toBe(true);
  });
});

describe('classification helpers', () => {
  it('detects classification marker', () => {
    expect(hasClassification(textResult('Devflow: IMPLEMENT/GUIDED. Loading: devflow:software-design.'))).toBe(true);
    expect(hasClassification(textResult('Devflow: DEBUG/ORCHESTRATED. Loading: devflow:debug:orch.'))).toBe(true);
  });

  it('returns false when no classification', () => {
    expect(hasClassification(textResult('Here is the code you asked for.'))).toBe(false);
    expect(hasClassification(textResult(''))).toBe(false);
  });

  it('extracts intent', () => {
    expect(extractIntent(textResult('Devflow: IMPLEMENT/GUIDED. Loading: devflow:software-design.'))).toBe('IMPLEMENT');
    expect(extractIntent(textResult('Devflow: DEBUG/ORCHESTRATED. Loading: devflow:debug:orch.'))).toBe('DEBUG');
    expect(extractIntent(textResult('Devflow: REVIEW/GUIDED. Loading: devflow:quality-gates.'))).toBe('REVIEW');
    expect(extractIntent(textResult('Devflow: PLAN/GUIDED. Loading: devflow:software-design.'))).toBe('PLAN');
    expect(extractIntent(textResult('Devflow: EXPLORE/QUICK'))).toBe('EXPLORE');
    expect(extractIntent(textResult('Devflow: CHAT/QUICK'))).toBe('CHAT');
  });

  it('extracts depth', () => {
    expect(extractDepth(textResult('Devflow: IMPLEMENT/GUIDED. Loading: devflow:software-design.'))).toBe('GUIDED');
    expect(extractDepth(textResult('Devflow: DEBUG/ORCHESTRATED. Loading: devflow:debug:orch.'))).toBe('ORCHESTRATED');
  });

  it('returns null for missing classification', () => {
    expect(extractIntent(textResult('no classification here'))).toBeNull();
    expect(extractDepth(textResult('no classification here'))).toBeNull();
  });

  it('CLASSIFICATION_PATTERN matches model output variations', () => {
    // Canonical format (model instruction says "Devflow: INTENT/DEPTH")
    expect(hasClassification(textResult('Devflow: IMPLEMENT/GUIDED'))).toBe(true);
    // Lowercase (model might vary casing)
    expect(hasClassification(textResult('devflow: implement/guided'))).toBe(true);
    // No space after colon
    expect(hasClassification(textResult('Devflow:CHAT/QUICK'))).toBe(true);
    // Extra whitespace
    expect(hasClassification(textResult('Devflow:  PLAN / ORCHESTRATED'))).toBe(true);
  });
});

describe('parseStreamEvent', () => {
  it('extracts skills from assistant tool_use events', () => {
    const event = {
      type: 'assistant',
      message: { content: [
        { type: 'tool_use', name: 'Skill', input: { skill: 'devflow:router' } },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.skills).toEqual(['devflow:router']);
    expect(parsed.textFragments).toEqual([]);
  });

  it('extracts text from assistant text blocks', () => {
    const event = {
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'Devflow: IMPLEMENT/GUIDED' },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.textFragments).toEqual(['Devflow: IMPLEMENT/GUIDED']);
    expect(parsed.skills).toEqual([]);
  });

  it('returns empty arrays for non-assistant events', () => {
    expect(parseStreamEvent({ type: 'user', message: { content: [] } })).toEqual({ skills: [], textFragments: [] });
    expect(parseStreamEvent({ type: 'system', message: { content: [] } })).toEqual({ skills: [], textFragments: [] });
  });

  it('returns empty arrays for malformed events', () => {
    expect(parseStreamEvent(null)).toEqual({ skills: [], textFragments: [] });
    expect(parseStreamEvent(undefined)).toEqual({ skills: [], textFragments: [] });
    expect(parseStreamEvent({})).toEqual({ skills: [], textFragments: [] });
    expect(parseStreamEvent({ type: 'assistant' })).toEqual({ skills: [], textFragments: [] });
    expect(parseStreamEvent({ type: 'assistant', message: {} })).toEqual({ skills: [], textFragments: [] });
  });

  it('handles mixed content blocks', () => {
    const event = {
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'Devflow: DEBUG/ORCHESTRATED' },
        { type: 'tool_use', name: 'Skill', input: { skill: 'devflow:debug:orch' } },
        { type: 'text', text: 'Loading debug orchestrator.' },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.skills).toEqual(['devflow:debug:orch']);
    expect(parsed.textFragments).toEqual(['Devflow: DEBUG/ORCHESTRATED', 'Loading debug orchestrator.']);
  });
});

describe('skill invocation helpers', () => {
  it('detects skill invocations', () => {
    expect(hasSkillInvocations(textResult('', ['devflow:patterns', 'devflow:research']))).toBe(true);
  });

  it('returns false when no skills', () => {
    expect(hasSkillInvocations(textResult('some text'))).toBe(false);
  });
});

/** Parse router SKILL.md markdown tables into intent→skills maps */
function parseRouterTables(content: string): { guided: Map<string, string[]>; orchestrated: Map<string, string[]> } {
  const guided = new Map<string, string[]>();
  const orchestrated = new Map<string, string[]>();

  let currentSection: 'guided' | 'orchestrated' | null = null;

  for (const line of content.split('\n')) {
    if (line.startsWith('## GUIDED')) { currentSection = 'guided'; continue; }
    if (line.startsWith('## ORCHESTRATED')) { currentSection = 'orchestrated'; continue; }
    if (line.startsWith('## ') && currentSection) { currentSection = null; continue; }

    if (!currentSection) continue;

    const match = line.match(/^\|\s*(\w+)\s*\|\s*(.+?)\s*\|$/);
    if (!match || match[1] === 'Intent') continue;

    const intent = match[1];
    const skillsStr = match[2].trim();
    const skills = skillsStr === '—' || skillsStr === '-'
      ? []
      : skillsStr.split(',').map(s => s.trim());

    const table = currentSection === 'guided' ? guided : orchestrated;
    table.set(intent, skills);
  }

  return { guided, orchestrated };
}

/** Extract intent names from classification-rules.md Intent Signals section only */
function parseClassificationIntents(content: string): string[] {
  const intents: string[] = [];
  let inIntentSection = false;

  for (const line of content.split('\n')) {
    if (line.includes('Intent Signals')) { inIntentSection = true; continue; }
    if (line.startsWith('## ') && inIntentSection) break; // left the section

    if (!inIntentSection) continue;

    const match = line.match(/^\-\s*\*\*(\w+)\*\*/);
    if (match) intents.push(match[1]);
  }
  return intents;
}

describe('router structural validation', () => {
  const routerPath = path.resolve(__dirname, '../shared/skills/router/SKILL.md');
  const rulesPath = path.resolve(__dirname, '../shared/skills/router/classification-rules.md');
  const sharedSkillsDir = path.resolve(__dirname, '../shared/skills');

  it('router covers all ORCHESTRATED intents (every non-CHAT intent has a row)', async () => {
    const rulesContent = await fs.readFile(rulesPath, 'utf-8');
    const routerContent = await fs.readFile(routerPath, 'utf-8');

    const nonChatIntents = parseClassificationIntents(rulesContent).filter(i => i !== 'CHAT');
    const { orchestrated } = parseRouterTables(routerContent);

    for (const intent of nonChatIntents) {
      expect(orchestrated.has(intent), `ORCHESTRATED table missing intent: ${intent}`).toBe(true);
    }
  });

  it('RESOLVE and PIPELINE have no GUIDED rows (always ORCHESTRATED)', async () => {
    const routerContent = await fs.readFile(routerPath, 'utf-8');
    const { guided } = parseRouterTables(routerContent);

    expect(guided.has('RESOLVE'), 'RESOLVE must not have a GUIDED row — classification says always ORCHESTRATED').toBe(false);
    expect(guided.has('PIPELINE'), 'PIPELINE must not have a GUIDED row — classification says always ORCHESTRATED').toBe(false);
  });

  it('router table skills are canonical — every prefixed ref exists in shared/skills/', async () => {
    const routerContent = await fs.readFile(routerPath, 'utf-8');
    const { guided, orchestrated } = parseRouterTables(routerContent);

    const allSkills = new Set<string>();
    for (const skills of [...guided.values(), ...orchestrated.values()]) {
      for (const skill of skills) {
        if (skill.startsWith('devflow:')) {
          allSkills.add(skill.replace('devflow:', ''));
        }
      }
    }

    const entries = await fs.readdir(sharedSkillsDir);

    for (const skill of allSkills) {
      expect(entries, `shared/skills/${skill}/ not found — router references nonexistent skill`).toContain(skill);
    }
  });

  it('integration test expectations align with router skill tables', async () => {
    const integrationPath = path.resolve(__dirname, './integration/ambient-activation.test.ts');
    const routerContent = await fs.readFile(routerPath, 'utf-8');
    const testContent = await fs.readFile(integrationPath, 'utf-8');
    const { guided, orchestrated } = parseRouterTables(routerContent);

    // Split integration tests into blocks and extract intent/depth + expected/required arrays
    const blocks = testContent.split(/\bit\(/);

    for (const block of blocks) {
      const nameMatch = block.match(/^'([^']+)'/);
      if (!nameMatch) continue;
      const name = nameMatch[1];

      const classMatch = name.match(/(IMPLEMENT|EXPLORE|DEBUG|PLAN|REVIEW|RESOLVE|PIPELINE)\/(GUIDED|ORCHESTRATED)/);
      if (!classMatch) continue;

      const [, intent, depth] = classMatch;
      const table = depth === 'GUIDED' ? guided : orchestrated;
      const routerSkills = table.get(intent);

      // Extract expected or required array from block
      const arrayMatch = block.match(/const (?:expected|required) = \[([^\]]*)\]/);
      if (!arrayMatch) continue; // Some tests (like EXPLORE/GUIDED) have no expected array — skip

      const testSkills = arrayMatch[1]
        .split(',')
        .map(s => s.trim().replace(/['"]/g, ''))
        .filter(Boolean)
        .map(s => `devflow:${s}`);

      expect(routerSkills, `${name}: router has no ${depth} row for ${intent}`).toBeDefined();
      if (!routerSkills) return;

      // Every skill the test asserts must appear in the router table row
      for (const skill of testSkills) {
        expect(
          routerSkills.includes(skill),
          `${name}: test asserts '${skill}' but router ${depth} ${intent} row is [${routerSkills.join(', ')}]`,
        ).toBe(true);
      }
    }
  });
});

describe('preamble drift detection', () => {
  it('preamble contains classify and devflow:router instructions', async () => {
    const hookPath = path.resolve(__dirname, '../scripts/hooks/preamble');
    const hookContent = await fs.readFile(hookPath, 'utf-8');

    // Extract the PREAMBLE string from the shell script
    const match = hookContent.match(/PREAMBLE="([^"]+)"/);
    expect(match).not.toBeNull();
    if (!match) return;
    const shellPreamble = match[1];

    // SYNC: preamble must instruct classification + router loading
    expect(shellPreamble.toLowerCase()).toContain('classify');
    expect(shellPreamble).toContain('devflow:router');
  });

  it('classification-rules.md contains required classification elements', async () => {
    const rulesPath = path.resolve(__dirname, '../shared/skills/router/classification-rules.md');
    const rulesContent = await fs.readFile(rulesPath, 'utf-8');

    // Must contain Intent Signals heading
    expect(rulesContent).toContain('Intent Signals');

    // Must contain all 8 intents
    expect(rulesContent).toContain('CHAT');
    expect(rulesContent).toContain('EXPLORE');
    expect(rulesContent).toContain('PLAN');
    expect(rulesContent).toContain('IMPLEMENT');
    expect(rulesContent).toContain('REVIEW');
    expect(rulesContent).toContain('RESOLVE');
    expect(rulesContent).toContain('DEBUG');
    expect(rulesContent).toContain('PIPELINE');

    // Must contain all 3 depths
    expect(rulesContent).toContain('QUICK');
    expect(rulesContent).toContain('GUIDED');
    expect(rulesContent).toContain('ORCHESTRATED');

    // Must reference devflow:router for GUIDED/ORCHESTRATED
    expect(rulesContent).toContain('devflow:router');
  });

  it('router SKILL.md contains skill lookup tables', async () => {
    const routerPath = path.resolve(__dirname, '../shared/skills/router/SKILL.md');
    const routerContent = await fs.readFile(routerPath, 'utf-8');

    // Must contain GUIDED/ORCHESTRATED headings
    expect(routerContent).toContain('## GUIDED');
    expect(routerContent).toContain('## ORCHESTRATED');

    // Must contain classification output format
    expect(routerContent).toContain('Devflow:');
    expect(routerContent).toContain('Loading:');

    // Must contain intent names in tables
    expect(routerContent).toContain('IMPLEMENT');
    expect(routerContent).toContain('EXPLORE');
    expect(routerContent).toContain('DEBUG');
    expect(routerContent).toContain('PLAN');
    expect(routerContent).toContain('REVIEW');

    // Must contain Phase Protocol section
    expect(routerContent).toContain('## Phase Protocol');
    expect(routerContent).toContain('Announce');
    expect(routerContent).toContain('No silent skips');
  });

  it('session-start-classification hook reads classification-rules.md', async () => {
    const hookPath = path.resolve(__dirname, '../scripts/hooks/session-start-classification');
    const hookContent = await fs.readFile(hookPath, 'utf-8');

    expect(hookContent).toContain('classification-rules.md');
  });
});

describe('phase protocol structural validation', () => {
  const sharedSkillsDir = path.resolve(__dirname, '../shared/skills');

  async function discoverOrchSkills(): Promise<string[]> {
    const entries = await fs.readdir(sharedSkillsDir);
    return entries.filter(e => e.endsWith(':orch')).sort();
  }

  it('every orch skill has a Phase Completion Checklist', async () => {
    for (const skill of await discoverOrchSkills()) {
      const content = await fs.readFile(
        path.join(sharedSkillsDir, skill, 'SKILL.md'),
        'utf-8',
      );
      expect(content, `${skill} missing Phase Completion Checklist`).toContain(
        '## Phase Completion Checklist',
      );
    }
  });

  it('every orch skill has Produces: annotations', async () => {
    for (const skill of await discoverOrchSkills()) {
      const content = await fs.readFile(
        path.join(sharedSkillsDir, skill, 'SKILL.md'),
        'utf-8',
      );
      expect(content, `${skill} missing Produces: annotations`).toContain(
        '**Produces:**',
      );
    }
  });

  it('every orch skill has Requires: annotations', async () => {
    for (const skill of await discoverOrchSkills()) {
      const content = await fs.readFile(
        path.join(sharedSkillsDir, skill, 'SKILL.md'),
        'utf-8',
      );
      expect(content, `${skill} missing Requires: annotations`).toContain(
        '**Requires:**',
      );
    }
  });

  it('plan:orch and implement:orch have Continuation Detection', async () => {
    for (const skill of ['plan:orch', 'implement:orch']) {
      const content = await fs.readFile(
        path.join(sharedSkillsDir, skill, 'SKILL.md'),
        'utf-8',
      );
      expect(content, `${skill} missing Continuation Detection`).toContain(
        '## Continuation Detection',
      );
    }
  });

  it('checklist item count matches phase count in each orch skill', async () => {
    for (const skill of await discoverOrchSkills()) {
      const content = await fs.readFile(
        path.join(sharedSkillsDir, skill, 'SKILL.md'),
        'utf-8',
      );

      // Count phase headings (## Phase N or ### Phase N — digit distinguishes from ## Phase Completion Checklist)
      const phaseHeadings = content.match(/^#{2,3}\s+Phase\s+\d/gm) ?? [];

      // Count checklist items (- [ ] Phase)
      const checklistItems = content.match(/^- \[ \] Phase/gm) ?? [];

      expect(
        checklistItems.length,
        `${skill}: ${checklistItems.length} checklist items but ${phaseHeadings.length} phases`,
      ).toBe(phaseHeadings.length);
    }
  });
});

describe('command Produces/Requires validation', () => {
  const pluginsDir = path.resolve(__dirname, '../plugins');
  const phaseStepPattern = /^#{2,4}\s+(Phase|Step)\s+\d/;

  function headingLevel(line: string): number {
    return (line.match(/^(#+)/) ?? ['', ''])[1].length;
  }

  async function discoverCommandFiles(): Promise<string[]> {
    const plugins = await fs.readdir(pluginsDir);
    const files: string[] = [];
    for (const plugin of plugins) {
      const cmdDir = path.join(pluginsDir, plugin, 'commands');
      try {
        const entries = await fs.readdir(cmdDir);
        for (const f of entries) {
          if (f.endsWith('.md')) files.push(path.join(cmdDir, f));
        }
      } catch { /* no commands dir */ }
    }
    return files.sort();
  }

  it('every command file has Produces: annotations', async () => {
    for (const file of await discoverCommandFiles()) {
      const content = await fs.readFile(file, 'utf-8');
      const name = path.relative(pluginsDir, file);
      expect(content, `${name} missing Produces:`).toContain('**Produces:**');
    }
  });

  it('every command file has Requires: annotations', async () => {
    for (const file of await discoverCommandFiles()) {
      const content = await fs.readFile(file, 'utf-8');
      const name = path.relative(pluginsDir, file);
      expect(content, `${name} missing Requires:`).toContain('**Requires:**');
    }
  });

  it('every phase/step heading is followed by a Produces or Requires annotation', async () => {
    for (const file of await discoverCommandFiles()) {
      const content = await fs.readFile(file, 'utf-8');
      const name = path.relative(pluginsDir, file);
      const lines = content.split('\n');

      const headingIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (phaseStepPattern.test(lines[i])) headingIndices.push(i);
      }

      for (let h = 0; h < headingIndices.length; h++) {
        const idx = headingIndices[h];
        const currentLevel = headingLevel(lines[idx]);

        // Skip container headings (next heading is deeper level = substeps)
        if (h + 1 < headingIndices.length) {
          if (headingLevel(lines[headingIndices[h + 1]]) > currentLevel) continue;
        }

        const endIdx = h + 1 < headingIndices.length ? headingIndices[h + 1] : lines.length;
        const body = lines.slice(idx + 1, endIdx).join('\n');

        expect(
          body.includes('**Produces:**') || body.includes('**Requires:**'),
          `${name}: "${lines[idx].trim()}" missing Produces/Requires annotation`,
        ).toBe(true);
      }
    }
  });
});
