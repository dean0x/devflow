/**
 * Tests for FIX 1 (issue #313): mergeDevflowSettingsTemplate in post-install.ts.
 *
 * D-SETTINGS-1: installSettings must MERGE devflow hook entries into an existing
 * settings.json rather than replacing it. A user's env block, permissions, apiKeyHelper,
 * or model assignment must never be destroyed. Parse failure must leave the file
 * byte-identical. Idempotent by exact command string.
 *
 * Coverage:
 *  - Hooks already present → changed:false (no duplicate insertion)
 *  - Hooks absent → changed:true (added)
 *  - Preserves user-owned keys untouched (env, permissions, model, etc.)
 *  - statusLine set only when absent
 *  - attribution set only when absent
 *  - statusLine preserved when already set by the user
 *  - Idempotent — double merge is the same as single merge
 *  - Template hook with no command string is skipped silently
 *  - Empty template → changed:false
 */

import { describe, it, expect } from 'vitest';
import { mergeDevflowSettingsTemplate } from '../src/targets/claude-code/post-install.js';
import type { HookMatcher } from '../src/targets/claude-code/hooks.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHookMatcher(command: string, timeout = 10): HookMatcher {
  return { hooks: [{ type: 'command', command, timeout }] };
}

function makeTemplate(commands: string[], statusLine = 'devflow: {branch}', attribution = 'Devflow'): Record<string, unknown> {
  const matchers = commands.map((cmd) => makeHookMatcher(cmd));
  return {
    hooks: {
      'SessionStart': matchers,
    },
    statusLine,
    attribution,
  };
}

// ─── mergeDevflowSettingsTemplate ────────────────────────────────────────────

describe('mergeDevflowSettingsTemplate — FIX 1 (issue #313)', () => {

  it('returns changed:true and adds hooks when existing has none', () => {
    const existing: Record<string, unknown> = {};
    const template = makeTemplate(['/devflow/scripts/hooks/run-hook memory-worker']);
    const { changed } = mergeDevflowSettingsTemplate(existing, template);
    expect(changed).toBe(true);
    const hooks = (existing.hooks as Record<string, HookMatcher[]>)['SessionStart'] ?? [];
    expect(hooks.length).toBe(1);
    expect(hooks[0]?.hooks[0]?.command).toBe('/devflow/scripts/hooks/run-hook memory-worker');
  });

  it('returns changed:false when all template hooks are already present', () => {
    const cmd = '/devflow/scripts/hooks/run-hook memory-worker';
    const existing: Record<string, unknown> = {
      hooks: {
        'SessionStart': [makeHookMatcher(cmd)],
      },
      statusLine: 'devflow: {branch}',
      attribution: 'Devflow',
    };
    const template = makeTemplate([cmd]);
    const { changed } = mergeDevflowSettingsTemplate(existing, template);
    expect(changed).toBe(false);
  });

  it('does not duplicate a hook that already exists (exact command match)', () => {
    const cmd = '/devflow/scripts/hooks/run-hook capture-turn';
    const existing: Record<string, unknown> = {
      hooks: {
        'SessionStart': [makeHookMatcher(cmd)],
      },
    };
    const template = makeTemplate([cmd]);
    mergeDevflowSettingsTemplate(existing, template);
    mergeDevflowSettingsTemplate(existing, template); // second pass
    const hooks = (existing.hooks as Record<string, HookMatcher[]>)['SessionStart'] ?? [];
    const count = hooks.filter((m) => m.hooks.some((h) => h.command === cmd)).length;
    expect(count).toBe(1);
  });

  it('preserves user keys: env block is never touched', () => {
    const existing: Record<string, unknown> = {
      env: { ANTHROPIC_API_KEY: 'sk-test-keep-me', CUSTOM_VAR: 'value' },
    };
    const template = makeTemplate(['/devflow/scripts/hooks/run-hook preamble']);
    mergeDevflowSettingsTemplate(existing, template);
    // env block must survive unchanged
    const env = existing.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-keep-me');
    expect(env.CUSTOM_VAR).toBe('value');
  });

  it('preserves user keys: permissions block is never touched', () => {
    const existing: Record<string, unknown> = {
      permissions: { deny: ['Bash(*)', 'Edit(*)'] },
    };
    const template = makeTemplate(['/devflow/scripts/hooks/run-hook preamble']);
    mergeDevflowSettingsTemplate(existing, template);
    const perms = existing.permissions as Record<string, unknown>;
    expect(perms.deny).toEqual(['Bash(*)', 'Edit(*)']);
  });

  it('preserves user keys: model field is never touched', () => {
    const existing: Record<string, unknown> = {
      model: 'claude-opus-4-5',
    };
    const template = makeTemplate(['/devflow/scripts/hooks/run-hook preamble']);
    mergeDevflowSettingsTemplate(existing, template);
    expect(existing.model).toBe('claude-opus-4-5');
  });

  it('preserves user keys: apiKeyHelper is never touched', () => {
    const existing: Record<string, unknown> = {
      apiKeyHelper: '/usr/local/bin/get-api-key',
    };
    const template = makeTemplate(['/devflow/scripts/hooks/run-hook preamble']);
    mergeDevflowSettingsTemplate(existing, template);
    expect(existing.apiKeyHelper).toBe('/usr/local/bin/get-api-key');
  });

  it('sets statusLine from template when absent on existing', () => {
    const existing: Record<string, unknown> = {};
    const template = makeTemplate([], 'devflow v2');
    mergeDevflowSettingsTemplate(existing, template);
    expect(existing.statusLine).toBe('devflow v2');
  });

  it('does NOT overwrite statusLine when user already has one', () => {
    const existing: Record<string, unknown> = { statusLine: 'my-custom-status-line' };
    const template = makeTemplate([], 'devflow v2');
    mergeDevflowSettingsTemplate(existing, template);
    expect(existing.statusLine).toBe('my-custom-status-line');
  });

  it('sets attribution from template when absent on existing', () => {
    const existing: Record<string, unknown> = {};
    const template = { statusLine: 's', attribution: 'Devflow' };
    mergeDevflowSettingsTemplate(existing, template);
    expect(existing.attribution).toBe('Devflow');
  });

  it('does NOT overwrite attribution when user already has one', () => {
    const existing: Record<string, unknown> = { attribution: 'my-org' };
    const template = { statusLine: 's', attribution: 'Devflow' };
    mergeDevflowSettingsTemplate(existing, template);
    expect(existing.attribution).toBe('my-org');
  });

  it('adds only the missing hooks when some are present and some are not', () => {
    const cmd1 = '/devflow/scripts/hooks/run-hook memory-worker';
    const cmd2 = '/devflow/scripts/hooks/run-hook capture-turn';
    const existing: Record<string, unknown> = {
      hooks: { 'SessionStart': [makeHookMatcher(cmd1)] }, // cmd1 present, cmd2 absent
    };
    const template: Record<string, unknown> = {
      hooks: { 'SessionStart': [makeHookMatcher(cmd1), makeHookMatcher(cmd2)] },
    };
    const { changed } = mergeDevflowSettingsTemplate(existing, template);
    expect(changed).toBe(true);
    const hooks = (existing.hooks as Record<string, HookMatcher[]>)['SessionStart'] ?? [];
    const cmds = hooks.flatMap((m) => m.hooks.map((h) => h.command));
    expect(cmds).toContain(cmd1);
    expect(cmds).toContain(cmd2);
    // cmd1 appears exactly once — no duplicate
    expect(cmds.filter((c) => c === cmd1).length).toBe(1);
  });

  it('handles multiple hook events independently', () => {
    const cmd = '/devflow/scripts/hooks/run-hook ensure-proxy';
    const existing: Record<string, unknown> = {};
    const template: Record<string, unknown> = {
      hooks: {
        'SessionStart': [makeHookMatcher(cmd)],
        'UserPromptSubmit': [makeHookMatcher(cmd)],
      },
    };
    mergeDevflowSettingsTemplate(existing, template);
    const ss = (existing.hooks as Record<string, HookMatcher[]>)['SessionStart'] ?? [];
    const up = (existing.hooks as Record<string, HookMatcher[]>)['UserPromptSubmit'] ?? [];
    expect(ss.some((m) => m.hooks.some((h) => h.command === cmd))).toBe(true);
    expect(up.some((m) => m.hooks.some((h) => h.command === cmd))).toBe(true);
  });

  it('skips a template hook entry that has no command string', () => {
    const existing: Record<string, unknown> = {};
    const template: Record<string, unknown> = {
      hooks: {
        'SessionStart': [{ hooks: [] } as unknown as HookMatcher], // no command
      },
    };
    const { changed } = mergeDevflowSettingsTemplate(existing, template);
    // No command → nothing to add → not changed from hooks (hooks key initialized but no entry pushed)
    expect(changed).toBe(false);
  });

  it('empty template results in changed:false', () => {
    const existing: Record<string, unknown> = { model: 'claude-opus-4-5' };
    const template: Record<string, unknown> = {};
    const { changed } = mergeDevflowSettingsTemplate(existing, template);
    expect(changed).toBe(false);
    expect(existing.model).toBe('claude-opus-4-5');
  });

  it('is idempotent — double merge produces same result as single merge', () => {
    const cmd = '/devflow/scripts/hooks/run-hook memory-worker';
    const existing: Record<string, unknown> = {};
    const template = makeTemplate([cmd], 'devflow v2', 'Devflow');

    mergeDevflowSettingsTemplate(existing, template);
    const snapshotAfterFirst = JSON.stringify(existing);

    // D-SETTINGS-1: second merge must be a no-op
    const { changed: changedOnSecond } = mergeDevflowSettingsTemplate(existing, template);
    expect(changedOnSecond).toBe(false);
    expect(JSON.stringify(existing)).toBe(snapshotAfterFirst);
  });

  it('preserves existing hook order — devflow hooks appended, not prepended', () => {
    const existingCmd = '/user/custom-hook';
    const devflowCmd = '/devflow/scripts/hooks/run-hook memory-worker';
    const existing: Record<string, unknown> = {
      hooks: { 'SessionStart': [makeHookMatcher(existingCmd)] },
    };
    const template = makeTemplate([devflowCmd]);
    mergeDevflowSettingsTemplate(existing, template);
    const hooks = (existing.hooks as Record<string, HookMatcher[]>)['SessionStart'] ?? [];
    expect(hooks[0]?.hooks[0]?.command).toBe(existingCmd); // user hook comes first
    expect(hooks[1]?.hooks[0]?.command).toBe(devflowCmd);  // devflow hook appended
  });
});
