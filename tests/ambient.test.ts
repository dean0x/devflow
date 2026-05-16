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
    expect(hasClassification(textResult('Devflow: IMPLEMENT. Loading: devflow:implement:triage.'))).toBe(true);
    expect(hasClassification(textResult('Devflow: DEBUG. Loading: devflow:debug:triage.'))).toBe(true);
  });

  it('returns false when no classification', () => {
    expect(hasClassification(textResult('Here is the code you asked for.'))).toBe(false);
    expect(hasClassification(textResult(''))).toBe(false);
  });

  it('rejects old INTENT/DEPTH format', () => {
    expect(hasClassification(textResult('Devflow: IMPLEMENT/ORCHESTRATED'))).toBe(false);
    expect(hasClassification(textResult('Devflow: IMPLEMENT/GUIDED'))).toBe(false);
    expect(hasClassification(textResult('Devflow: DEBUG/ORCHESTRATED'))).toBe(false);
  });

  it('extracts intent', () => {
    expect(extractIntent(textResult('Devflow: IMPLEMENT. Loading: devflow:implement:triage.'))).toBe('IMPLEMENT');
    expect(extractIntent(textResult('Devflow: DEBUG. Loading: devflow:debug:triage.'))).toBe('DEBUG');
    expect(extractIntent(textResult('Devflow: REVIEW. Loading: devflow:review:triage.'))).toBe('REVIEW');
    expect(extractIntent(textResult('Devflow: PLAN. Loading: devflow:plan:triage.'))).toBe('PLAN');
    expect(extractIntent(textResult('Devflow: RESOLVE. Loading: devflow:resolve:orch.'))).toBe('RESOLVE');
    expect(extractIntent(textResult('Devflow: RESEARCH. Loading: devflow:research:triage.'))).toBe('RESEARCH');
  });

  it('returns null for old INTENT/DEPTH format', () => {
    expect(extractIntent(textResult('Devflow: IMPLEMENT/ORCHESTRATED'))).toBeNull();
    expect(extractIntent(textResult('Devflow: DEBUG/GUIDED'))).toBeNull();
  });

  it('extracts depth from triage output', () => {
    expect(extractDepth(textResult('Scope: GUIDED'))).toBe('GUIDED');
    expect(extractDepth(textResult('Scope: ORCHESTRATED'))).toBe('ORCHESTRATED');
  });

  it('extractDepth handles casing and whitespace variations', () => {
    expect(extractDepth(textResult('scope: guided'))).toBe('GUIDED');
    expect(extractDepth(textResult('SCOPE: ORCHESTRATED'))).toBe('ORCHESTRATED');
    expect(extractDepth(textResult('Scope:  ORCHESTRATED'))).toBe('ORCHESTRATED');
  });

  it('extractDepth returns null for old INTENT/DEPTH format', () => {
    expect(extractDepth(textResult('Devflow: IMPLEMENT/ORCHESTRATED'))).toBeNull();
    expect(extractDepth(textResult('Devflow: DEBUG/GUIDED'))).toBeNull();
  });

  it('returns null for missing classification', () => {
    expect(extractIntent(textResult('no classification here'))).toBeNull();
    expect(extractDepth(textResult('no classification here'))).toBeNull();
  });

  it('CLASSIFICATION_PATTERN matches model output variations', () => {
    // Canonical format (model instruction says "Devflow: INTENT. Loading:")
    expect(hasClassification(textResult('Devflow: IMPLEMENT. Loading: devflow:implement:triage.'))).toBe(true);
    // Lowercase (model might vary casing)
    expect(hasClassification(textResult('devflow: implement. Loading: devflow:implement:triage.'))).toBe(true);
    // No space after colon
    expect(hasClassification(textResult('Devflow:IMPLEMENT.'))).toBe(true);
    // Extra whitespace
    expect(hasClassification(textResult('Devflow:  PLAN.'))).toBe(true);
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
        { type: 'text', text: 'Devflow: IMPLEMENT. Loading: devflow:implement:triage.' },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.textFragments).toEqual(['Devflow: IMPLEMENT. Loading: devflow:implement:triage.']);
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
        { type: 'text', text: 'Devflow: DEBUG. Loading: devflow:debug:triage.' },
        { type: 'tool_use', name: 'Skill', input: { skill: 'devflow:debug:triage' } },
        { type: 'text', text: 'Loading debug triage.' },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.skills).toEqual(['devflow:debug:triage']);
    expect(parsed.textFragments).toEqual(['Devflow: DEBUG. Loading: devflow:debug:triage.', 'Loading debug triage.']);
  });
});

describe('skill invocation helpers', () => {
  it('detects skill invocations', () => {
    expect(hasSkillInvocations(textResult('', ['devflow:patterns', 'devflow:test-driven-development']))).toBe(true);
  });

  it('returns false when no skills', () => {
    expect(hasSkillInvocations(textResult('some text'))).toBe(false);
  });
});

/** Parse router SKILL.md single-column Workflow Skills table into intent→skill map */
function parseWorkflowTable(content: string): Map<string, string> {
  const table = new Map<string, string>();

  let inSection = false;

  for (const line of content.split('\n')) {
    if (line.startsWith('## Workflow Skills')) { inSection = true; continue; }
    if (line.startsWith('## ') && inSection) break;

    if (!inSection) continue;

    const match = line.match(/^\|\s*(\w+)\s*\|\s*(.+?)\s*\|$/);
    if (!match || match[1] === 'Intent') continue;

    table.set(match[1], match[2].trim());
  }

  return table;
}

/** Extract lines between <!-- PATTERN: {name} --> markers */
function extractPatternBlock(content: string, name: string = 'ci-status-gate'): string[] {
  const lines = content.split('\n');
  const result: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.includes(`<!-- PATTERN: ${name}`)) { inside = true; continue; }
    if (line.includes(`<!-- /PATTERN: ${name} -->`)) break;
    if (inside) result.push(line);
  }
  return result;
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

  it('router covers all non-CHAT intents (every intent has a row with a skill)', async () => {
    const rulesContent = await fs.readFile(rulesPath, 'utf-8');
    const routerContent = await fs.readFile(routerPath, 'utf-8');

    const nonChatIntents = parseClassificationIntents(rulesContent).filter(i => i !== 'CHAT');
    const table = parseWorkflowTable(routerContent);

    for (const intent of nonChatIntents) {
      expect(table.has(intent), `Workflow Skills table missing intent: ${intent}`).toBe(true);
    }
  });

  it('dual-mode intents map to :triage skills, orch-only intents map to :orch skills', async () => {
    const routerContent = await fs.readFile(routerPath, 'utf-8');
    const table = parseWorkflowTable(routerContent);

    const orchOnly = new Set(['RESOLVE', 'PIPELINE']);

    for (const [intent, skill] of table) {
      if (orchOnly.has(intent)) {
        expect(skill, `${intent}: orch-only intent must map to :orch skill`).toMatch(/^devflow:\w[\w-]*:orch$/);
      } else {
        expect(skill, `${intent}: dual-mode intent must map to :triage skill`).toMatch(/^devflow:\w[\w-]*:triage$/);
      }
    }
  });

  it('router table skills are canonical — every ref exists in shared/skills/', async () => {
    const routerContent = await fs.readFile(routerPath, 'utf-8');
    const table = parseWorkflowTable(routerContent);

    const entries = await fs.readdir(sharedSkillsDir);

    for (const [intent, skill] of table) {
      const skillName = skill.replace('devflow:', '');
      expect(entries, `shared/skills/${skillName}/ not found — router references nonexistent skill`).toContain(skillName);
    }
  });

  it('all 7 triage skills exist with correct frontmatter', async () => {
    const triageIntents = ['implement', 'debug', 'explore', 'plan', 'review', 'research', 'release'];

    for (const intent of triageIntents) {
      const skillPath = path.join(sharedSkillsDir, `${intent}:triage`, 'SKILL.md');
      const content = await fs.readFile(skillPath, 'utf-8');

      expect(content, `${intent}:triage missing name in frontmatter`).toContain(`name: ${intent}:triage`);
      expect(content, `${intent}:triage must be non-user-invocable`).toContain('user-invocable: false');
      expect(content, `${intent}:triage must have Skill in allowed-tools`).toContain('Skill');
      expect(content, `${intent}:triage must reference :guided target`).toContain(`${intent}:guided`);
      expect(content, `${intent}:triage must reference :orch target`).toContain(`${intent}:orch`);
      expect(content, `${intent}:triage must have Scope Assessment section`).toContain('## Scope Assessment');
      expect(content, `${intent}:triage must have Orchestration Hint Override section`).toContain('## Orchestration Hint Override');
    }
  });

  it('ci-status-gate PATTERN block is consistent across implement:orch and resolve:orch', async () => {
    const implementContent = await fs.readFile(
      path.join(sharedSkillsDir, 'implement:orch', 'SKILL.md'),
      'utf-8',
    );
    const resolveContent = await fs.readFile(
      path.join(sharedSkillsDir, 'resolve:orch', 'SKILL.md'),
      'utf-8',
    );

    const implementLines = extractPatternBlock(implementContent);
    const resolveLines = extractPatternBlock(resolveContent);

    expect(implementLines.length, 'implement:orch PATTERN block not found').toBeGreaterThan(0);
    expect(resolveLines.length, 'resolve:orch PATTERN block not found').toBeGreaterThan(0);

    // Steps 2-6 (shared polling logic) must be identical; step 1 is context-specific and may differ
    const implementShared = implementLines.filter(l => /^\d+\./.test(l.trimStart()) && !l.trimStart().startsWith('1.'));
    const resolveShared = resolveLines.filter(l => /^\d+\./.test(l.trimStart()) && !l.trimStart().startsWith('1.'));

    expect(
      implementShared.join('\n'),
      'ci-status-gate polling steps (2-6) diverged between implement:orch and resolve:orch',
    ).toBe(resolveShared.join('\n'));
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

    // Must contain all 10 intents
    expect(rulesContent).toContain('CHAT');
    expect(rulesContent).toContain('EXPLORE');
    expect(rulesContent).toContain('PLAN');
    expect(rulesContent).toContain('IMPLEMENT');
    expect(rulesContent).toContain('REVIEW');
    expect(rulesContent).toContain('RESOLVE');
    expect(rulesContent).toContain('DEBUG');
    expect(rulesContent).toContain('PIPELINE');
    expect(rulesContent).toContain('RESEARCH');
    expect(rulesContent).toContain('RELEASE');

    // Must contain QUICK criteria
    expect(rulesContent).toContain('QUICK');
    expect(rulesContent).toContain('## QUICK Criteria');

    // Must NOT contain depth criteria section (moved to triage skills)
    expect(rulesContent).not.toContain('## Depth Criteria');

    // Must reference devflow:router
    expect(rulesContent).toContain('devflow:router');
  });

  it('router SKILL.md contains workflow skills table', async () => {
    const routerPath = path.resolve(__dirname, '../shared/skills/router/SKILL.md');
    const routerContent = await fs.readFile(routerPath, 'utf-8');

    // Must contain Workflow Skills table with single Skill column
    expect(routerContent).toContain('## Workflow Skills');
    expect(routerContent).toContain('| Skill |');

    // Must contain classification output format
    expect(routerContent).toContain('Devflow:');
    expect(routerContent).toContain('Loading:');

    // Must contain intent names in table
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
