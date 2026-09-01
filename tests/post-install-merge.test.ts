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
 *  - statusLine preserved when already set by the user
 *  - attribution is NOT injected (managed by flags pipeline — D27)
 *  - Idempotent — double merge is the same as single merge
 *  - Template hook with no command string is skipped silently
 *  - Empty template → changed:false
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeDevflowSettingsTemplate, installSettings } from '../src/targets/claude-code/post-install.js';
import type { HookMatcher } from '../src/targets/claude-code/hooks.js';
import { FLAG_REGISTRY } from '../src/core/flags.js';
import type { SettingFlagTarget } from '../src/core/flags.js';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved repo root — installSettings needs it to locate the settings template.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHookMatcher(command: string, timeout = 10): HookMatcher {
  return { hooks: [{ type: 'command', command, timeout }] };
}

function makeTemplate(commands: string[], statusLine = 'devflow: {branch}'): Record<string, unknown> {
  const matchers = commands.map((cmd) => makeHookMatcher(cmd));
  return {
    hooks: {
      'SessionStart': matchers,
    },
    statusLine,
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

  /**
   * Registry-driven single-ownership guard: no flag with target.type === 'setting'
   * may have its target.key present as a top-level key in the settings merge template.
   * ADR-024: one writer per settings.json key class. D27: attribution (and all
   * other flag-owned keys) are written/removed exclusively by applyFlags/stripFlags.
   * A template key managed by a flag creates a double-write on every fresh install.
   */
  it('no flag-owned settings key appears as a top-level template key (ADR-024, D27)', async () => {
    const templatePath = path.join(REPO_ROOT, 'src/targets/claude-code/templates/settings.json');
    const template = JSON.parse(await fsp.readFile(templatePath, 'utf-8')) as Record<string, unknown>;

    // Non-vacuity: template must be a non-empty plain object
    expect(Object.keys(template).length).toBeGreaterThan(0);

    // Collect setting-target flags from the registry
    const settingFlags = FLAG_REGISTRY.filter(
      (f): f is typeof f & { target: SettingFlagTarget } => f.target.type === 'setting',
    );

    // Non-vacuity: at least one setting-target flag must exist in the registry
    expect(settingFlags.length).toBeGreaterThan(0);

    // Assert no flag-owned key appears in the template top-level
    for (const flag of settingFlags) {
      const key = flag.target.key;
      expect(
        key in template,
        `"${key}" (flag: ${flag.id}) is flag-owned — must not appear in the settings merge template (ADR-024, D27)`,
      ).toBe(false);
    }
  });

  it('does NOT inject attribution even when template carries an attribution block', () => {
    // Even when attribution appears in template (legacy or edge case), the
    // merge function must not write it into a user settings object that lacks one.
    // This falsifies re-introduced injection: if mergeDevflowSettingsTemplate were
    // ever to merge the attribution key, this test would fail because the template
    // carries the block and existing starts empty.
    const existing: Record<string, unknown> = {};
    const template: Record<string, unknown> = { statusLine: 's', attribution: { commit: '', pr: '' } };
    mergeDevflowSettingsTemplate(existing, template);
    expect(existing.attribution).toBeUndefined();
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
    const template = makeTemplate([cmd], 'devflow v2');

    mergeDevflowSettingsTemplate(existing, template);
    const snapshotAfterFirst = JSON.stringify(existing);

    // D-SETTINGS-1: second merge must be a no-op
    const { changed: changedOnSecond } = mergeDevflowSettingsTemplate(existing, template);
    expect(changedOnSecond).toBe(false);
    expect(JSON.stringify(existing)).toBe(snapshotAfterFirst);
  });

  // ── Shape guards (PF-023): `existing` is a hand-editable file ──────────────
  //
  // The merge mutates a user-authored object, so every branch validates shape at
  // the sink. A settings.json that is valid JSON but structurally odd must neither
  // throw (init would swallow it and skip hook installation entirely) nor lose the
  // user's own entries.

  it('leaves a non-object hooks value untouched instead of throwing', () => {
    const existing: Record<string, unknown> = { hooks: 'not-an-object' };
    const template = makeTemplate(['/devflow/scripts/hooks/run-hook memory-worker']);
    expect(() => mergeDevflowSettingsTemplate(existing, template)).not.toThrow();
    expect(existing.hooks).toBe('not-an-object');
  });

  it('leaves an array hooks value untouched instead of writing keys onto it', () => {
    const existing: Record<string, unknown> = { hooks: [] };
    const template: Record<string, unknown> = {
      hooks: { SessionStart: [makeHookMatcher('/devflow/scripts/hooks/run-hook memory-worker')] },
    };
    const { changed } = mergeDevflowSettingsTemplate(existing, template);
    // JSON.stringify would silently drop keys attached to an array — never touch it.
    expect(Array.isArray(existing.hooks)).toBe(true);
    expect((existing.hooks as unknown[]).length).toBe(0);
    expect(changed).toBe(false);
  });

  it('leaves a non-array per-event value untouched instead of throwing', () => {
    const existing: Record<string, unknown> = { hooks: { SessionStart: 'oops' } };
    const template = makeTemplate(['/devflow/scripts/hooks/run-hook memory-worker']);
    expect(() => mergeDevflowSettingsTemplate(existing, template)).not.toThrow();
    expect((existing.hooks as Record<string, unknown>).SessionStart).toBe('oops');
  });

  it('tolerates malformed existing matcher entries when deduping', () => {
    const cmd = '/devflow/scripts/hooks/run-hook memory-worker';
    const existing: Record<string, unknown> = {
      hooks: { SessionStart: ['a-string', { noHooksKey: true }, null] },
    };
    const template = makeTemplate([cmd]);
    expect(() => mergeDevflowSettingsTemplate(existing, template)).not.toThrow();
    const arr = (existing.hooks as Record<string, unknown[]>).SessionStart;
    // Foreign entries survive; the devflow hook is appended after them.
    expect(arr.length).toBe(4);
    expect(arr[0]).toBe('a-string');
  });

  it('does not introduce an empty hooks key when the template adds no hooks', () => {
    const existing: Record<string, unknown> = { model: 'claude-opus-4-5' };
    const template: Record<string, unknown> = { statusLine: 's' };
    mergeDevflowSettingsTemplate(existing, template);
    expect('hooks' in existing).toBe(false);
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

// ─── installSettings — parse-failure and merge wiring ────────────────────────
//
// These tests exercise installSettings(claudeDir, rootDir, devflowDir, verbose)
// against the real filesystem via real tmpdirs.  They complement the pure
// mergeDevflowSettingsTemplate unit tests above by pinning the I/O wiring and
// the parse-failure bail path (post-install.ts:926-935).

describe('installSettings — parse-failure and wiring (issue #313)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'devflow-settings-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('(a) leaves settings.json byte-identical on invalid JSON and leaves no .tmp.* residue', async () => {
    // Arrange — write a syntactically invalid JSON (trailing comma before closing brace)
    const invalidJson = '{ "hooks": { "SessionStart": [] } , }';
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fsp.writeFile(settingsPath, invalidJson, 'utf-8');
    const bytesBefore = await fsp.readFile(settingsPath);

    // Act — parse failure must bail without touching the file
    await installSettings(tmpDir, REPO_ROOT, '/fake/devflow', false);

    // Assert — file bytes are identical (no byte was changed)
    const bytesAfter = await fsp.readFile(settingsPath);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);

    // Assert — writeFileAtomicExclusive writes to a `.tmp.<pid>` sibling then renames;
    // on the parse-failure path it must never be created.
    const entries = await fsp.readdir(tmpDir);
    const tmpFiles = entries.filter((e) => e.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('(b) adds hooks while preserving env and permissions blocks byte-for-byte (wiring pin)', async () => {
    // Arrange — valid settings with env + permissions but no hooks
    const existingSettings: Record<string, unknown> = {
      env: { ANTHROPIC_BASE_URL: 'https://my-gateway.example.com', MY_VAR: 'keep-me' },
      permissions: { allow: ['Read(*)'], deny: ['Bash(rm -rf *)'] },
    };
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fsp.writeFile(settingsPath, JSON.stringify(existingSettings, null, 2) + '\n', 'utf-8');

    // Act — installSettings should merge the template hooks in
    await installSettings(tmpDir, REPO_ROOT, '/fake/devflow', false);

    // Assert — hooks were added (template carries hooks for SessionStart, Stop, etc.)
    const result = JSON.parse(await fsp.readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
    expect(result.hooks).toBeDefined();
    const hooks = result.hooks as Record<string, unknown[]>;
    const hookEventCount = Object.values(hooks).filter(
      (arr) => Array.isArray(arr) && arr.length > 0,
    ).length;
    expect(hookEventCount).toBeGreaterThan(0);

    // Assert — env block survived byte-for-byte
    expect(result.env).toEqual(existingSettings.env);

    // Assert — permissions block survived byte-for-byte
    expect(result.permissions).toEqual(existingSettings.permissions);
  });
});
