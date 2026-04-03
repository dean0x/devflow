import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { addAmbientHook, removeAmbientHook, hasAmbientHook } from '../src/cli/commands/ambient.js';
import { hasClassification, isQuietResponse, extractIntent, extractDepth, hasSkillLoading, extractLoadedSkills } from './integration/helpers.js';

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
});

describe('hasAmbientHook', () => {
  it('returns true when present', () => {
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
});

describe('classification helpers', () => {
  it('detects classification marker', () => {
    expect(hasClassification('DevFlow: IMPLEMENT/GUIDED. Loading: devflow:software-design.')).toBe(true);
    expect(hasClassification('DevFlow: DEBUG/ORCHESTRATED. Loading: devflow:debug.')).toBe(true);
  });

  it('returns false when no classification', () => {
    expect(hasClassification('Here is the code you asked for.')).toBe(false);
    expect(hasClassification('')).toBe(false);
  });

  it('isQuietResponse is inverse of hasClassification', () => {
    expect(isQuietResponse('Just a normal response')).toBe(true);
    expect(isQuietResponse('DevFlow: IMPLEMENT/GUIDED. Loading: x.')).toBe(false);
  });

  it('extracts intent', () => {
    expect(extractIntent('DevFlow: IMPLEMENT/GUIDED. Loading: devflow:software-design.')).toBe('IMPLEMENT');
    expect(extractIntent('DevFlow: DEBUG/ORCHESTRATED. Loading: devflow:debug.')).toBe('DEBUG');
    expect(extractIntent('DevFlow: REVIEW/GUIDED. Loading: devflow:self-review.')).toBe('REVIEW');
    expect(extractIntent('DevFlow: PLAN/GUIDED. Loading: devflow:software-design.')).toBe('PLAN');
    expect(extractIntent('DevFlow: EXPLORE/QUICK')).toBe('EXPLORE');
    expect(extractIntent('DevFlow: CHAT/QUICK')).toBe('CHAT');
  });

  it('extracts depth', () => {
    expect(extractDepth('DevFlow: IMPLEMENT/GUIDED. Loading: devflow:software-design.')).toBe('GUIDED');
    expect(extractDepth('DevFlow: DEBUG/ORCHESTRATED. Loading: devflow:debug.')).toBe('ORCHESTRATED');
  });

  it('returns null for missing classification', () => {
    expect(extractIntent('no classification here')).toBeNull();
    expect(extractDepth('no classification here')).toBeNull();
  });
});

describe('skill loading helpers', () => {
  it('detects Loading marker', () => {
    expect(hasSkillLoading('DevFlow: IMPLEMENT/GUIDED. Loading: devflow:patterns, devflow:research.')).toBe(true);
    expect(hasSkillLoading('Loading: devflow:software-design')).toBe(true);
  });

  it('returns false when no Loading marker', () => {
    expect(hasSkillLoading('DevFlow: IMPLEMENT/GUIDED.')).toBe(false);
    expect(hasSkillLoading('Just some text')).toBe(false);
  });

  it('extracts single skill', () => {
    expect(extractLoadedSkills('Loading: devflow:software-design')).toEqual(['devflow:software-design']);
  });

  it('extracts multiple skills', () => {
    expect(extractLoadedSkills('DevFlow: IMPLEMENT/GUIDED. Loading: devflow:patterns, devflow:research, devflow:typescript.')).toEqual([
      'devflow:patterns',
      'devflow:research',
      'devflow:typescript',
    ]);
  });

  it('returns empty array when no Loading marker', () => {
    expect(extractLoadedSkills('no skills here')).toEqual([]);
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
    expect(shellPreamble).toContain('DEVFLOW MODE');

    // Must contain depth definitions
    expect(shellPreamble).toContain('QUICK');
    expect(shellPreamble).toContain('GUIDED');
    expect(shellPreamble).toContain('ORCHESTRATED');

    // Must contain intent names for each category
    expect(shellPreamble).toContain('IMPLEMENT');
    expect(shellPreamble).toContain('DEBUG');
    expect(shellPreamble).toContain('REVIEW');
    expect(shellPreamble).toContain('RESOLVE');
    expect(shellPreamble).toContain('PIPELINE');
    expect(shellPreamble).toContain('PLAN');

    // Must contain multi-worktree awareness
    expect(shellPreamble).toContain('MULTI_WORKTREE');

    // Must reference the router skill (detection-only: no direct skill mappings)
    expect(shellPreamble).toContain('devflow:router');

    // Must instruct Skill tool invocation
    expect(shellPreamble).toContain('Skill tool');

    // Must include classification output format
    expect(shellPreamble).toContain('DevFlow:');
    expect(shellPreamble).toContain('Loading:');
  });
});
