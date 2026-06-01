import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { addAmbientHook, removeAmbientHook, hasAmbientHook, removeLegacyCommandsRule, COMMANDS_RULE_PATH } from '../src/cli/commands/ambient.js';
import type { StreamResult } from './integration/helpers.js';
import {
  hasSkillInvocations,
  parseStreamEvent,
} from './integration/helpers.js';

/** Helper to create a StreamResult from text for unit-testing helpers. */
function textResult(text: string, skills: string[] = []): StreamResult {
  return { skills, textFragments: [text], killedEarly: false, durationMs: 0 };
}

describe('addAmbientHook', () => {
  beforeEach(() => {
    // removeLegacyCommandsRule() unlinks COMMANDS_RULE_PATH — stub out the
    // underlying fs operations so unit tests produce no real filesystem side-effects.
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds hook to empty settings', async () => {
    const result = await addAmbientHook('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].timeout).toBe(5);
  });

  it('does NOT add SessionStart classification hook', async () => {
    const result = await addAmbientHook('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    // New architecture: no SessionStart classification hook
    expect(settings.hooks.SessionStart).toBeUndefined();
  });

  it('adds alongside existing hooks', async () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    });
    const result = await addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    // No SessionStart added
    expect(settings.hooks.SessionStart).toBeUndefined();
  });

  it('adds alongside existing UserPromptSubmit hooks', async () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other-hook.sh' }] }],
      },
    });
    const result = await addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
    expect(settings.hooks.UserPromptSubmit[1].hooks[0].command).toContain('preamble');
  });

  it('preserves existing SessionStart hooks (session-start-memory) — does not touch them', async () => {
    const input = JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/to/run-hook session-start-memory' }] }],
      },
    });
    const result = await addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // SessionStart untouched — still only has session-start-memory
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
  });

  it('is idempotent — does not add duplicate hooks', async () => {
    const first = await addAmbientHook('{}', '/home/user/.devflow');
    const second = await addAmbientHook(first, '/home/user/.devflow');

    expect(second).toBe(first);
  });

  it('purges legacy rule even when preamble hook already present (ordering invariant)', async () => {
    // When the hook is already registered addAmbientHook takes the early-return path.
    // removeLegacyCommandsRule MUST still run so stale commands.md files are cleaned up.
    const withHook = await addAmbientHook('{}', '/home/user/.devflow');
    vi.restoreAllMocks();
    // Re-stub so we can assert on the second call
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    await addAmbientHook(withHook, '/home/user/.devflow');

    expect(fs.unlink).toHaveBeenCalledWith(COMMANDS_RULE_PATH);
  });

  it('preserves other settings', async () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'statusline.sh' },
      env: { SOME_VAR: '1' },
    });
    const result = await addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('statusline.sh');
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('uses correct devflowDir path in command via run-hook wrapper', async () => {
    const result = await addAmbientHook('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);
    const preambleCmd = settings.hooks.UserPromptSubmit[0].hooks[0].command;

    expect(preambleCmd).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(preambleCmd).toContain('preamble');
    // No classification command — no SessionStart hook added
    expect(settings.hooks.SessionStart).toBeUndefined();
  });

  it('replaces legacy ambient-prompt hook with new preamble hook', async () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    const result = await addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Legacy removed, new preamble added
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).not.toContain('ambient-prompt');
  });

  it('replaces legacy hook while preserving other UserPromptSubmit hooks', async () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    const result = await addAmbientHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
    expect(settings.hooks.UserPromptSubmit[1].hooks[0].command).toContain('preamble');
  });
});

describe('removeAmbientHook', () => {
  beforeEach(() => {
    // removeLegacyCommandsRule() unlinks COMMANDS_RULE_PATH — stub fs side-effects to keep tests pure.
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes ambient hook — clears UserPromptSubmit', async () => {
    const withHook = await addAmbientHook('{}', '/home/user/.devflow');
    const result = await removeAmbientHook(withHook);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('also removes stale SessionStart classification hook from previous installs', async () => {
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
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    // session-start-memory preserved, session-start-classification cleaned up
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();
  });

  it('preserves other UserPromptSubmit hooks', async () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
  });

  it('cleans empty hooks object when last hook removed', async () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hook event types', async () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();
  });

  it('is idempotent — safe to call when not present', async () => {
    const input = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }] } });
    const result = await removeAmbientHook(input);

    expect(result).toBe(input);
  });

  it('preserves other settings', async () => {
    const input = JSON.stringify({
      statusLine: { type: 'command' },
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/preamble' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toEqual({ type: 'command' });
  });

  it('removes legacy ambient-prompt hook', async () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('removes both legacy and new hooks at once', async () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook ambient-prompt' }] },
          { hooks: [{ type: 'command', command: '/path/to/run-hook preamble' }] },
          { hooks: [{ type: 'command', command: 'other-hook.sh' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-hook.sh');
  });

  it('removes stale classification hook when no UserPromptSubmit hooks exist', async () => {
    // Edge case: user only has a stale SessionStart classification hook from a previous
    // install, with no UserPromptSubmit ambient hooks. removeAmbientHook must still clean
    // up the stale classification hook and return a changed JSON.
    const input = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook session-start-classification' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
    // Returned JSON must differ from input — change was detected via removedClassification
    expect(result).not.toBe(input);
  });
});

describe('removeLegacyCommandsRule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unlinks COMMANDS_RULE_PATH when file exists', async () => {
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
    await removeLegacyCommandsRule();
    expect(fs.unlink).toHaveBeenCalledWith(COMMANDS_RULE_PATH);
  });

  it('swallows ENOENT — idempotent when file does not exist', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.spyOn(fs, 'unlink').mockRejectedValue(enoent);
    await expect(removeLegacyCommandsRule()).resolves.toBeUndefined();
  });

  it('re-throws non-ENOENT errors — e.g. EACCES', async () => {
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    vi.spyOn(fs, 'unlink').mockRejectedValue(eacces);
    await expect(removeLegacyCommandsRule()).rejects.toMatchObject({ code: 'EACCES' });
  });
});

describe('hasAmbientHook', () => {
  beforeEach(() => {
    // addAmbientHook (called in one test) triggers removeLegacyCommandsRule — stub fs side-effects.
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when current preamble hook present', async () => {
    const withHook = await addAmbientHook('{}', '/home/user/.devflow');
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

  it('returns false for SessionStart-only classification hook (stale from previous install)', () => {
    // Classification hook alone is no longer a positive signal
    const input = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook session-start-classification' }] },
        ],
      },
    });
    expect(hasAmbientHook(input)).toBe(false);
  });
});

describe('parseStreamEvent', () => {
  it('extracts skills from assistant tool_use events', () => {
    const event = {
      type: 'assistant',
      message: { content: [
        { type: 'tool_use', name: 'Skill', input: { skill: 'devflow:implement' } },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.skills).toEqual(['devflow:implement']);
    expect(parsed.textFragments).toEqual([]);
  });

  it('extracts text from assistant text blocks', () => {
    const event = {
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'EXECUTION_PLAN detected. Invoke `devflow:implement` via the Skill tool to execute this plan.' },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.textFragments).toEqual(['EXECUTION_PLAN detected. Invoke `devflow:implement` via the Skill tool to execute this plan.']);
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
        { type: 'text', text: 'EXECUTION_PLAN detected.' },
        { type: 'tool_use', name: 'Skill', input: { skill: 'devflow:implement' } },
        { type: 'text', text: 'Executing plan.' },
      ] },
    };
    const parsed = parseStreamEvent(event);
    expect(parsed.skills).toEqual(['devflow:implement']);
    expect(parsed.textFragments).toEqual(['EXECUTION_PLAN detected.', 'Executing plan.']);
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
