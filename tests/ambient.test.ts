import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { addAmbientHook, removeAmbientHook, removeLegacyAmbientHook, hasAmbientHook } from '../src/cli/commands/ambient.js';
import type { StreamResult } from './integration/helpers.js';
import {
  hasClassification,
  extractIntent,
  extractDepth,
  hasDevFlowBranding,
  hasSkillInvocations,
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

  it('is idempotent — does not add duplicate hooks', () => {
    const first = addAmbientHook('{}', '/home/user/.devflow');
    const second = addAmbientHook(first, '/home/user/.devflow');

    expect(second).toBe(first);
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
  });

  it('uses correct devflowDir path in command via run-hook wrapper', () => {
    const result = addAmbientHook('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);
    const command = settings.hooks.UserPromptSubmit[0].hooks[0].command;

    expect(command).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(command).toContain('preamble');
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
});

describe('removeAmbientHook', () => {
  it('removes ambient hook', () => {
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

  it('detects Devflow branding', () => {
    expect(hasDevFlowBranding(textResult('Devflow: IMPLEMENT/GUIDED. Loading: devflow:patterns.'))).toBe(true);
  });

  it('returns false for non-Devflow branding', () => {
    expect(hasDevFlowBranding(textResult('Some random text without branding.'))).toBe(false);
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

describe('preamble drift detection', () => {
  it('preamble PREAMBLE contains required classification elements', async () => {
    const hookPath = path.resolve(__dirname, '../scripts/hooks/preamble');
    const hookContent = await fs.readFile(hookPath, 'utf-8');

    // Extract the PREAMBLE string from the shell script (may be multiline)
    const match = hookContent.match(/PREAMBLE="([^"]+)"/);
    expect(match).not.toBeNull();
    const shellPreamble = match![1];

    // The preamble is detection-only: classification rules + router skill reference.
    // Verify structural elements rather than exact string match to allow wording refinement.
    expect(shellPreamble).toContain('AMBIENT MODE');

    // Must contain depth definitions
    expect(shellPreamble).toContain('QUICK');
    expect(shellPreamble).toContain('GUIDED');
    expect(shellPreamble).toContain('ORCHESTRATED');

    // Must contain intent names for each category
    expect(shellPreamble).toContain('CHAT');
    expect(shellPreamble).toContain('EXPLORE');
    expect(shellPreamble).toContain('PLAN');
    expect(shellPreamble).toContain('IMPLEMENT');
    expect(shellPreamble).toContain('REVIEW');
    expect(shellPreamble).toContain('RESOLVE');
    expect(shellPreamble).toContain('DEBUG');
    expect(shellPreamble).toContain('PIPELINE');

    // Must reference the router skill (detection-only: no direct skill mappings)
    expect(shellPreamble).toContain('devflow:router');

    // Must instruct Skill tool invocation
    expect(shellPreamble).toContain('Skill tool');

    // Must include classification output format
    expect(shellPreamble).toContain('Devflow:');
    expect(shellPreamble).toContain('Loading:');
  });
});
