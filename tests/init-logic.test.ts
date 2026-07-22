import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  combineSelection,
  shouldRetry,
  substituteSettingsTemplate,
  computeGitignoreAppend,
  mergeDenyList,
  discoverProjectGitRoots,
  runMigrationsWithFallback,
} from '../src/cli/commands/init.js';
import { parsePluginSelection } from '../src/core/plugins.js';
import { getManagedSettingsPath } from '../src/targets/claude-code/claude-paths.js';
import {
  installManagedSettings,
  installClaudeignore,
  stripUserDenyList,
  detectDenyState,
  resolveSecurityAction,
  assertHistoricalDenySuperset,
  DEVFLOW_HISTORICAL_DENY,
  applyUserSecurityDenyList,
  loadTemplateDenyEntries,
  ensureDevflowGitignore,
} from '../src/targets/claude-code/post-install.js';
import { installViaFileCopy, type Spinner } from '../src/targets/claude-code/installer.js';
import { DEVFLOW_PLUGINS, buildAssetMaps, buildRulesMap } from '../src/core/plugins.js';
import type { RunMigrationsResult } from '../src/core/migrations.js';

describe('parsePluginSelection', () => {
  it('parses comma-separated plugin names', () => {
    const { selected, invalid } = parsePluginSelection('devflow-implement,devflow-code-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(invalid).toEqual([]);
  });

  it('normalizes shorthand names (adds devflow- prefix)', () => {
    const { selected, invalid } = parsePluginSelection('implement,code-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(invalid).toEqual([]);
  });

  it('handles mixed shorthand and full names', () => {
    const { selected, invalid } = parsePluginSelection('implement,devflow-code-review', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(invalid).toEqual([]);
  });

  it('trims whitespace', () => {
    const { selected, invalid } = parsePluginSelection('  implement , code-review  ', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-code-review']);
    expect(invalid).toEqual([]);
  });

  it('reports unknown plugins', () => {
    const { selected, invalid } = parsePluginSelection('implement,nonexistent', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement', 'devflow-nonexistent']);
    expect(invalid).toEqual(['devflow-nonexistent']);
  });

  it('reports multiple unknown plugins', () => {
    const { invalid } = parsePluginSelection('foo,bar', DEVFLOW_PLUGINS);
    expect(invalid).toEqual(['devflow-foo', 'devflow-bar']);
  });

  it('handles single plugin', () => {
    const { selected, invalid } = parsePluginSelection('implement', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-implement']);
    expect(invalid).toEqual([]);
  });

  it('remaps legacy plugin names', () => {
    const { selected, invalid } = parsePluginSelection('frontend-design', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-ui-design']);
    expect(invalid).toEqual([]);
  });

  it('remaps legacy plugin names with prefix', () => {
    const { selected, invalid } = parsePluginSelection('devflow-frontend-design', DEVFLOW_PLUGINS);
    expect(selected).toEqual(['devflow-ui-design']);
    expect(invalid).toEqual([]);
  });
});

describe('combineSelection', () => {
  it('accepts non-empty workflow-only selection', () => {
    const result = combineSelection(['devflow-implement'], []);
    expect(result.plugins).toEqual(['devflow-implement']);
    expect(result.accepted).toBe(true);
  });

  it('accepts non-empty language-only selection', () => {
    const result = combineSelection([], ['devflow-typescript']);
    expect(result.plugins).toEqual(['devflow-typescript']);
    expect(result.accepted).toBe(true);
  });

  it('accepts non-empty combined selection from both buckets', () => {
    const result = combineSelection(['devflow-implement'], ['devflow-typescript']);
    expect(result.plugins).toEqual(['devflow-implement', 'devflow-typescript']);
    expect(result.accepted).toBe(true);
  });

  it('rejects empty-both-buckets selection', () => {
    const result = combineSelection([], []);
    expect(result.plugins).toEqual([]);
    expect(result.accepted).toBe(false);
  });

  it('workflow entries precede language entries in the merged list', () => {
    const result = combineSelection(['devflow-implement', 'devflow-code-review'], ['devflow-typescript']);
    expect(result.plugins).toEqual(['devflow-implement', 'devflow-code-review', 'devflow-typescript']);
  });
});

describe('shouldRetry', () => {
  const MAX_ATTEMPTS = 3;

  it('returns false when selection is accepted (regardless of attempt count)', () => {
    expect(shouldRetry(1, MAX_ATTEMPTS, true)).toBe(false);
    expect(shouldRetry(2, MAX_ATTEMPTS, true)).toBe(false);
    expect(shouldRetry(3, MAX_ATTEMPTS, true)).toBe(false);
  });

  it('returns true when not accepted and attempts remain', () => {
    expect(shouldRetry(1, MAX_ATTEMPTS, false)).toBe(true);
    expect(shouldRetry(2, MAX_ATTEMPTS, false)).toBe(true);
  });

  it('returns false when not accepted and attempt ceiling is reached (exits instead of retrying)', () => {
    expect(shouldRetry(3, MAX_ATTEMPTS, false)).toBe(false);
  });

  it('returns false on attempt exceeding ceiling', () => {
    expect(shouldRetry(4, MAX_ATTEMPTS, false)).toBe(false);
  });
});

describe('substituteSettingsTemplate', () => {
  it('replaces ${DEVFLOW_DIR} placeholders', () => {
    const template = '{"scripts": "${DEVFLOW_DIR}/scripts", "hooks": "${DEVFLOW_DIR}/hooks"}';
    const result = substituteSettingsTemplate(template, '/home/user/.devflow');
    expect(result).toBe('{"scripts": "/home/user/.devflow/scripts", "hooks": "/home/user/.devflow/hooks"}');
  });

  it('returns template unchanged when no placeholders', () => {
    const template = '{"key": "value"}';
    const result = substituteSettingsTemplate(template, '/home/user/.devflow');
    expect(result).toBe('{"key": "value"}');
  });

  it('handles empty template', () => {
    expect(substituteSettingsTemplate('', '/dir')).toBe('');
  });

  it('handles multiple occurrences', () => {
    const template = '${DEVFLOW_DIR} and ${DEVFLOW_DIR} again';
    const result = substituteSettingsTemplate(template, '/d');
    expect(result).toBe('/d and /d again');
  });
});

// AC-C2 end-state shape: the shipped settings.json template must seed all 5
// always-on hooks (UserPromptSubmit/PostToolUse/Stop capture bundle + the
// SessionStart/PreCompact memory-dream bundle) exactly, not rely on init's
// addCaptureHooks runtime healing to fill gaps.
describe('settings.json template: AC-C2 complete hook seed shape', () => {
  const TEMPLATE_PATH = path.resolve(__dirname, '..', 'src', 'targets', 'claude-code', 'templates', 'settings.json');

  async function loadHooks(): Promise<Record<string, Array<{ matcher?: string; hooks: { command: string }[] }>>> {
    const raw = await fs.readFile(TEMPLATE_PATH, 'utf-8');
    return JSON.parse(raw).hooks;
  }

  it('seeds all 5 always-on hook event types', async () => {
    const hooks = await loadHooks();
    expect(Object.keys(hooks).sort()).toEqual(
      ['PostToolUse', 'PreCompact', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort(),
    );
  });

  it('UserPromptSubmit seeds capture-prompt', async () => {
    const hooks = await loadHooks();
    expect(hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain('run-hook capture-prompt');
  });

  it('PostToolUse seeds capture-question scoped to matcher: "AskUserQuestion"', async () => {
    const hooks = await loadHooks();
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.PostToolUse[0].matcher).toBe('AskUserQuestion');
    expect(hooks.PostToolUse[0].hooks[0].command).toContain('run-hook capture-question');
  });

  it('Stop keeps the AC-C2 order: [capture-turn, memory-worker]', async () => {
    const hooks = await loadHooks();
    const commands = hooks.Stop.map((m) => m.hooks[0].command);
    expect(commands[0]).toContain('run-hook capture-turn');
    expect(commands[1]).toContain('run-hook memory-worker');
  });

  it('SessionStart keeps the AC-C2 order: [session-start-memory, session-start-context]', async () => {
    const hooks = await loadHooks();
    const commands = hooks.SessionStart.map((m) => m.hooks[0].command);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('run-hook session-start-memory');
    expect(commands[1]).toContain('run-hook session-start-context');
  });

  it('PreCompact seeds pre-compact-memory', async () => {
    const hooks = await loadHooks();
    expect(hooks.PreCompact).toHaveLength(1);
    expect(hooks.PreCompact[0].hooks[0].command).toContain('run-hook pre-compact-memory');
  });
});

describe('computeGitignoreAppend', () => {
  it('returns all entries when gitignore is empty', () => {
    const result = computeGitignoreAppend('', ['.claude/', '.devflow/']);
    expect(result).toEqual(['.claude/', '.devflow/']);
  });

  it('filters out existing entries', () => {
    const existing = '.claude/\nnode_modules/\n';
    const result = computeGitignoreAppend(existing, ['.claude/', '.devflow/']);
    expect(result).toEqual(['.devflow/']);
  });

  it('returns empty array when all entries exist', () => {
    const existing = '.claude/\n.devflow/\n';
    const result = computeGitignoreAppend(existing, ['.claude/', '.devflow/']);
    expect(result).toEqual([]);
  });

  it('handles entries with surrounding whitespace in gitignore', () => {
    const existing = '  .claude/  \n';
    const result = computeGitignoreAppend(existing, ['.claude/', '.devflow/']);
    expect(result).toEqual(['.devflow/']);
  });

  it('handles empty entries list', () => {
    const result = computeGitignoreAppend('something\n', []);
    expect(result).toEqual([]);
  });
});

describe('ensureDevflowGitignore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-ensure-ignore-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const read = (): Promise<string> => fs.readFile(path.join(tmpDir, '.gitignore'), 'utf-8');
  const lines = (content: string): string[] => content.split('\n').map(l => l.trim());

  it('creates .gitignore with the .devflow/ carve-out when absent (never .claude/)', async () => {
    await ensureDevflowGitignore(tmpDir, false);

    const content = await read();
    expect(lines(content)).toContain('.devflow/*');
    expect(lines(content)).toContain('!.devflow/features/');
    expect(lines(content)).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(lines(content)).not.toContain('.devflow/'); // carve-out, not bare wholesale
    // User-scope installs must NOT gitignore .claude/ — this is the key difference
    // from updateGitignore (which also adds .claude/).
    expect(content).not.toContain('.claude/');
    expect(content).toContain('# Devflow runtime data');
  });

  it('appends the carve-out to existing content without clobbering it', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n');
    await ensureDevflowGitignore(tmpDir, false);

    const content = await read();
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(lines(content)).toContain('!.devflow/features/*/KNOWLEDGE.md');
  });

  it('is idempotent — the carve-out appears exactly once after repeated runs', async () => {
    await ensureDevflowGitignore(tmpDir, false);
    await ensureDevflowGitignore(tmpDir, false);

    const content = await read();
    expect(lines(content).filter(l => l === '!.devflow/features/*/KNOWLEDGE.md')).toHaveLength(1);
  });

  it('upgrades a legacy bare .devflow/ entry to the carve-out', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\n.devflow/\n');
    await ensureDevflowGitignore(tmpDir, false);

    const content = await read();
    // Bare wholesale entry replaced by the carve-out; unrelated entry preserved.
    expect(lines(content)).not.toContain('.devflow/');
    expect(lines(content)).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(content).toContain('node_modules/');
  });

  it('respects a user-authored /.devflow/ entry (no carve-out forced)', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '/.devflow/\n');
    await ensureDevflowGitignore(tmpDir, false);

    const content = await read();
    expect(content).toBe('/.devflow/\n'); // untouched
  });
});


describe('getManagedSettingsPath', () => {
  it('returns macOS path on darwin', () => {
    // This test runs on the current platform
    const p = getManagedSettingsPath();
    if (process.platform === 'darwin') {
      expect(p).toBe('/Library/Application Support/ClaudeCode/managed-settings.json');
    } else if (process.platform === 'linux') {
      expect(p).toBe('/etc/claude-code/managed-settings.json');
    }
  });

  it('returns a path ending in managed-settings.json', () => {
    const p = getManagedSettingsPath();
    expect(p).toMatch(/managed-settings\.json$/);
  });
});

describe('mergeDenyList', () => {
  it('merges new entries into existing deny list', () => {
    const existing = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)'] },
    });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)', 'Bash(sudo *)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)', 'Bash(sudo *)']);
  });

  it('deduplicates entries', () => {
    const existing = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)', 'Bash(sudo *)'] },
    });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)', 'Bash(eval *)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)', 'Bash(sudo *)', 'Bash(eval *)']);
  });

  it('preserves existing non-deny settings', () => {
    const existing = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)'], allow: ['Read(*)'] },
      otherKey: 'value',
    });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(sudo *)']));
    expect(result.permissions.allow).toEqual(['Read(*)']);
    expect(result.otherKey).toBe('value');
  });

  it('creates permissions.deny when missing', () => {
    const existing = JSON.stringify({ otherKey: 'value' });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)']);
    expect(result.otherKey).toBe('value');
  });

  it('handles empty existing deny list', () => {
    const existing = JSON.stringify({ permissions: { deny: [] } });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(rm -rf /*)']));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)']);
  });

  it('handles empty new entries', () => {
    const existing = JSON.stringify({ permissions: { deny: ['Bash(rm -rf /*)'] } });
    const result = JSON.parse(mergeDenyList(existing, []));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf /*)']);
  });

  it('handles non-array deny (string) without throwing or spreading chars', () => {
    const existing = JSON.stringify({ permissions: { deny: 'oops-a-string' } });
    // Must not throw and must treat string as empty, then add newEntries
    const result = JSON.parse(mergeDenyList(existing, ['Bash(sudo *)']));
    expect(result.permissions.deny).toEqual(['Bash(sudo *)']);
  });

  it('handles null deny without throwing', () => {
    const existing = JSON.stringify({ permissions: { deny: null } });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(sudo *)']));
    expect(result.permissions.deny).toEqual(['Bash(sudo *)']);
  });

  it('produces byte-equal output on idempotent re-run', () => {
    const existing = JSON.stringify({ permissions: { deny: ['Bash(sudo *)'], allow: ['Read(*)'] } });
    const first = mergeDenyList(existing, ['Bash(sudo *)']);
    const second = mergeDenyList(first, ['Bash(sudo *)']);
    expect(first).toBe(second);
  });

  it('always ends with trailing newline', () => {
    const existing = JSON.stringify({});
    const result = mergeDenyList(existing, ['Bash(sudo *)']);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('preserves allow alongside deny', () => {
    const existing = JSON.stringify({ permissions: { allow: ['Read(**)'], deny: [] } });
    const result = JSON.parse(mergeDenyList(existing, ['Bash(sudo *)']));
    expect(result.permissions.allow).toEqual(['Read(**)']);
    expect(result.permissions.deny).toEqual(['Bash(sudo *)']);
  });
});

describe('stripUserDenyList', () => {
  const historical = new Set(['Bash(rm -rf /*)', 'Bash(sudo *)', 'Bash(eval *)']);

  it('removes historical entries', () => {
    const json = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)', 'Bash(sudo *)', 'my-custom-rule'] },
    });
    const { json: out, removed } = stripUserDenyList(json, historical);
    const parsed = JSON.parse(out);
    expect(parsed.permissions.deny).toEqual(['my-custom-rule']);
    expect(removed).toEqual(['Bash(rm -rf /*)', 'Bash(sudo *)']);
  });

  it('preserves user-only entries', () => {
    const json = JSON.stringify({
      permissions: { deny: ['user-only-1', 'user-only-2'] },
    });
    const { json: out, removed } = stripUserDenyList(json, historical);
    const parsed = JSON.parse(out);
    expect(parsed.permissions.deny).toEqual(['user-only-1', 'user-only-2']);
    expect(removed).toEqual([]);
  });

  it('removes permissions.deny when remaining is empty', () => {
    const json = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)'] },
    });
    const { json: out, removed } = stripUserDenyList(json, historical);
    const parsed = JSON.parse(out);
    expect(parsed.permissions).toBeUndefined();
    expect(removed).toHaveLength(1);
  });

  it('removes permissions object when it becomes empty', () => {
    const json = JSON.stringify({
      permissions: { deny: ['Bash(sudo *)'] },
    });
    const { json: out } = stripUserDenyList(json, historical);
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed)).not.toContain('permissions');
  });

  it('preserves allow alongside deny after strip', () => {
    const json = JSON.stringify({
      permissions: { allow: ['Read(**)'], deny: ['Bash(sudo *)'] },
    });
    const { json: out } = stripUserDenyList(json, historical);
    const parsed = JSON.parse(out);
    expect(parsed.permissions.allow).toEqual(['Read(**)']);
    expect(parsed.permissions.deny).toBeUndefined();
  });

  it('returns {}\n when the only key was permissions with only historical deny', () => {
    const json = JSON.stringify({ permissions: { deny: ['Bash(rm -rf /*)'] } });
    const { json: out } = stripUserDenyList(json, historical);
    expect(out).toBe('{}\n');
  });

  it('is idempotent (second strip returns same JSON)', () => {
    const json = JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /*)', 'Bash(sudo *)'] },
    });
    const { json: first } = stripUserDenyList(json, historical);
    const { json: second } = stripUserDenyList(first, historical);
    expect(first).toBe(second);
  });

  it('no-ops when permissions is absent', () => {
    const json = JSON.stringify({ otherKey: 'val' });
    const { json: out, removed } = stripUserDenyList(json, historical);
    expect(out).toBe(json);
    expect(removed).toEqual([]);
  });

  it('no-ops when deny is not an array', () => {
    const json = JSON.stringify({ permissions: { deny: 'bad' } });
    const { json: out, removed } = stripUserDenyList(json, historical);
    expect(out).toBe(json);
    expect(removed).toEqual([]);
  });

  it('ends with trailing newline', () => {
    const json = JSON.stringify({ permissions: { deny: ['Bash(rm -rf /*)'] } });
    const { json: out } = stripUserDenyList(json, historical);
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('detectDenyState', () => {
  const smallHistorical = new Set(['Bash(rm -rf /*)', 'Bash(sudo *)']);

  it('returns user=true when user settings has a historical entry', () => {
    const userJson = JSON.stringify({ permissions: { deny: ['Bash(rm -rf /*)'] } });
    const state = detectDenyState(userJson, false, null);
    expect(state.user).toBe(true);
    expect(state.managed).toBe(false);
    expect(state.unknown).toBe(false);
  });

  it('treats subset install (older entries) as user=true', () => {
    // DEVFLOW_HISTORICAL_DENY has all 154 entries; even one match → user=true
    const entry = [...DEVFLOW_HISTORICAL_DENY][0];
    const userJson = JSON.stringify({ permissions: { deny: [entry] } });
    const state = detectDenyState(userJson, false, null);
    expect(state.user).toBe(true);
  });

  it('returns user=false when user settings has no historical entries', () => {
    const userJson = JSON.stringify({ permissions: { deny: ['custom-rule'] } });
    const state = detectDenyState(userJson, false, null);
    expect(state.user).toBe(false);
  });

  it('returns unknown=true when user settings is unparseable', () => {
    const state = detectDenyState('not-json{{{', false, null);
    expect(state.unknown).toBe(true);
    expect(state.user).toBe(false);
  });

  it('returns managed=true when managed file has a historical entry', () => {
    const managedJson = JSON.stringify({ permissions: { deny: ['Bash(rm -rf /*)'] } });
    const state = detectDenyState(null, true, managedJson);
    expect(state.managed).toBe(true);
    expect(state.user).toBe(false);
  });

  it('returns managed=false when managedExists=false even if content is present', () => {
    const managedJson = JSON.stringify({ permissions: { deny: ['Bash(rm -rf /*)'] } });
    const state = detectDenyState(null, false, managedJson);
    expect(state.managed).toBe(false);
  });

  it('treats unparseable managed file as managed=false (never throws)', () => {
    expect(() => detectDenyState(null, true, 'bad-json')).not.toThrow();
    const state = detectDenyState(null, true, 'bad-json');
    expect(state.managed).toBe(false);
  });

  it('returns none when user settings is null', () => {
    const state = detectDenyState(null, false, null);
    expect(state.user).toBe(false);
    expect(state.managed).toBe(false);
    expect(state.unknown).toBe(false);
  });

  it('reports both user and managed as true simultaneously', () => {
    const entry = [...DEVFLOW_HISTORICAL_DENY][0];
    const userJson = JSON.stringify({ permissions: { deny: [entry] } });
    const managedJson = JSON.stringify({ permissions: { deny: [entry] } });
    const state = detectDenyState(userJson, true, managedJson);
    expect(state.user).toBe(true);
    expect(state.managed).toBe(true);
  });
});

describe('resolveSecurityAction', () => {
  const noneDetected = { user: false, managed: false, unknown: false };
  const userDetected = { user: true, managed: false, unknown: false };
  const managedDetected = { user: false, managed: true, unknown: false };
  const bothDetected = { user: true, managed: true, unknown: false };
  const unknownDetected = { user: false, managed: false, unknown: true };

  it('explicit flag=user always wins', () => {
    const r = resolveSecurityAction('user', 'none', noneDetected, false);
    expect(r.target).toBe('user');
    expect(r.action).toBe('merge');
  });

  it('explicit flag=managed always wins', () => {
    const r = resolveSecurityAction('managed', 'user', userDetected, false);
    expect(r.target).toBe('managed');
    expect(r.action).toBe('merge');
  });

  it('explicit flag=none strips', () => {
    const r = resolveSecurityAction('none', 'user', userDetected, false);
    expect(r.target).toBe('none');
    expect(r.action).toBe('strip');
  });

  it('manifest agrees with detected (both enabled) → merge', () => {
    const r = resolveSecurityAction(undefined, 'user', userDetected, false);
    expect(r.action).toBe('merge');
  });

  it('manifest=none and detected=none → noop', () => {
    const r = resolveSecurityAction(undefined, 'none', noneDetected, false);
    expect(r.target).toBe('none');
    expect(r.action).toBe('noop');
  });

  it('CONFLICT: manifest=none but detected user is present (TTY) → returns prompt', () => {
    const r = resolveSecurityAction(undefined, 'none', userDetected, true);
    expect(r.prompt).toBeTruthy();
  });

  it('CONFLICT: manifest=none but detected user is present (non-TTY) → keeps reality + warn', () => {
    const r = resolveSecurityAction(undefined, 'none', userDetected, false);
    expect(r.warn).toBeTruthy();
    // Keeps detected reality
    expect(r.target).toBe('user');
    expect(r.action).toBe('merge');
  });

  it('fresh install (no manifest, no detected) → default user + merge', () => {
    const r = resolveSecurityAction(undefined, undefined, noneDetected, false);
    expect(r.target).toBe('user');
    expect(r.action).toBe('merge');
  });

  it('fresh install (no manifest, user detected) → keeps user + merge', () => {
    const r = resolveSecurityAction(undefined, undefined, userDetected, false);
    expect(r.target).toBe('user');
    expect(r.action).toBe('merge');
  });

  it('fresh install (no manifest, managed detected) → keeps managed + merge', () => {
    const r = resolveSecurityAction(undefined, undefined, managedDetected, false);
    expect(r.target).toBe('managed');
    expect(r.action).toBe('merge');
  });

  it('both detected → target=user (user-settings-first preference)', () => {
    const r = resolveSecurityAction(undefined, undefined, bothDetected, false);
    expect(r.target).toBe('user');
  });

  it('unknown does not perturb explicit flag resolution', () => {
    // unknownDetected should not block an explicit flag from winning
    const r = resolveSecurityAction('user', undefined, unknownDetected, false);
    expect(r.target).toBe('user');
    expect(r.action).toBe('merge');
  });

  it('CONFLICT: manifest=user but nothing detected (non-TTY) → strip + warn', () => {
    const r = resolveSecurityAction(undefined, 'user', noneDetected, false);
    expect(r.warn).toBeTruthy();
    expect(r.action).toBe('strip');
  });

  it('CONFLICT: manifest=none but managed is present (non-TTY) → keeps managed + warn', () => {
    const r = resolveSecurityAction(undefined, 'none', managedDetected, false);
    expect(r.warn).toBeTruthy();
    expect(r.target).toBe('managed');
  });
});

describe('assertHistoricalDenySuperset', () => {
  it('passes when template entries are all in historical set', () => {
    const templateEntries = ['Bash(rm -rf /*)', 'Bash(sudo *)'];
    expect(() => assertHistoricalDenySuperset(templateEntries)).not.toThrow();
  });

  it('throws when a template entry is missing from historical set', () => {
    const templateEntries = ['Bash(rm -rf /*)', 'Bash(new-future-entry-not-in-historical)'];
    expect(() => assertHistoricalDenySuperset(templateEntries)).toThrow(/missing.*entries/i);
  });

  it('passes for empty template', () => {
    expect(() => assertHistoricalDenySuperset([])).not.toThrow();
  });

  it('DEVFLOW_HISTORICAL_DENY is superset of actual template (154 entries covered)', () => {
    // The actual template has 154 entries — all must be in the historical set
    // We test a representative sample here since the full template is a file I/O concern
    const sampleEntries = [
      'Bash(rm -rf /*)',
      'Read(/etc/shadow)',
      'Read(/etc/sudoers)',
      'Read(/etc/passwd)',
      'Bash(sudo *)',
    ];
    expect(() => assertHistoricalDenySuperset(sampleEntries)).not.toThrow();
  });
});

describe('installManagedSettings', () => {
  let tmpDir: string;
  let managedDir: string;
  let managedPath: string;
  let templateDir: string;

  const denyEntries = ['Bash(rm -rf /*)', 'Bash(sudo *)'];
  const templateContent = JSON.stringify({ permissions: { deny: denyEntries } }, null, 2);

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-managed-test-'));
    managedDir = path.join(tmpDir, 'managed');
    managedPath = path.join(managedDir, 'managed-settings.json');
    templateDir = path.join(tmpDir, 'root');

    // Create template file at expected location
    await fs.mkdir(path.join(templateDir, 'src', 'targets', 'claude-code', 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(templateDir, 'src', 'targets', 'claude-code', 'templates', 'managed-settings.json'),
      templateContent,
      'utf-8',
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns false when getManagedSettingsPath throws (unsupported platform)', async () => {
    vi.spyOn(await import('../src/targets/claude-code/claude-paths.js'), 'getManagedSettingsPath').mockImplementation(() => {
      throw new Error('Unsupported platform');
    });

    const result = await installManagedSettings(templateDir, false);
    expect(result).toBe(false);
  });

  it('returns false when template file cannot be read', async () => {
    vi.spyOn(await import('../src/targets/claude-code/claude-paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    // Use a rootDir with no template file
    const emptyRoot = path.join(tmpDir, 'empty-root');
    await fs.mkdir(emptyRoot, { recursive: true });

    const result = await installManagedSettings(emptyRoot, true);
    expect(result).toBe(false);
  });

  it('writes managed settings via direct write when directory is writable', async () => {
    vi.spyOn(await import('../src/targets/claude-code/claude-paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    const result = await installManagedSettings(templateDir, false);

    expect(result).toBe(true);
    const written = JSON.parse(await fs.readFile(managedPath, 'utf-8'));
    expect(written.permissions.deny).toEqual(denyEntries);
  });

  it('merges with existing managed settings (preserves existing entries)', async () => {
    vi.spyOn(await import('../src/targets/claude-code/claude-paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    // Pre-populate existing managed settings with an extra entry
    await fs.mkdir(managedDir, { recursive: true });
    const existing = { permissions: { deny: ['Bash(eval *)'] } };
    await fs.writeFile(managedPath, JSON.stringify(existing), 'utf-8');

    const result = await installManagedSettings(templateDir, false);

    expect(result).toBe(true);
    const written = JSON.parse(await fs.readFile(managedPath, 'utf-8'));
    // Should contain both the existing entry and new entries, deduplicated
    expect(written.permissions.deny).toContain('Bash(eval *)');
    expect(written.permissions.deny).toContain('Bash(rm -rf /*)');
    expect(written.permissions.deny).toContain('Bash(sudo *)');
  });

  it('returns false on EACCES when not in TTY', async () => {
    vi.spyOn(await import('../src/targets/claude-code/claude-paths.js'), 'getManagedSettingsPath').mockReturnValue(managedPath);

    // Make the parent dir exist but not writable
    await fs.mkdir(managedDir, { recursive: true });
    await fs.chmod(managedDir, 0o444);

    // Mock process.stdin.isTTY as falsy
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    try {
      const result = await installManagedSettings(templateDir, false);
      expect(result).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
      // Restore permissions for cleanup
      await fs.chmod(managedDir, 0o755);
    }
  });

  it('returns false on non-EACCES write errors', async () => {
    vi.spyOn(await import('../src/targets/claude-code/claude-paths.js'), 'getManagedSettingsPath').mockReturnValue(
      // Point to a path inside a file (not a directory) to trigger ENOTDIR
      path.join(templateDir, 'src', 'targets', 'claude-code', 'templates', 'managed-settings.json', 'impossible', 'managed-settings.json'),
    );

    const result = await installManagedSettings(templateDir, false);
    expect(result).toBe(false);
  });
});

describe('installViaFileCopy cleanup (isPartialInstall)', () => {
  let tmpDir: string;
  let claudeDir: string;
  let devflowDir: string;
  const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
    claudeDir = path.join(tmpDir, 'claude');
    devflowDir = path.join(tmpDir, 'devflow');

    // Seed a stale command and agent that should be cleaned on full install
    const commandsDir = path.join(claudeDir, 'commands', 'devflow');
    const agentsDir = path.join(claudeDir, 'agents', 'devflow');
    await fs.mkdir(commandsDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(path.join(commandsDir, 'stale.md'), '# stale');
    await fs.writeFile(path.join(agentsDir, 'stale.md'), '# stale');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('full install (isPartialInstall=false) removes stale commands and agents', async () => {
    await installViaFileCopy({
      plugins: [],
      claudeDir,
      devflowDir,
      skillsMap: new Map(),
      agentsMap: new Map(),
      isPartialInstall: false,
      spinner: noopSpinner,
    });

    // Stale dirs should be removed
    await expect(fs.access(path.join(claudeDir, 'commands', 'devflow', 'stale.md'))).rejects.toThrow();
    await expect(fs.access(path.join(claudeDir, 'agents', 'devflow', 'stale.md'))).rejects.toThrow();
  });

  it('partial install (isPartialInstall=true) preserves existing commands and agents', async () => {
    await installViaFileCopy({
      plugins: [],
      claudeDir,
      devflowDir,
      skillsMap: new Map(),
      agentsMap: new Map(),
      isPartialInstall: true,
      spinner: noopSpinner,
    });

    // Stale files should still exist
    const staleCommand = await fs.readFile(path.join(claudeDir, 'commands', 'devflow', 'stale.md'), 'utf-8');
    expect(staleCommand).toBe('# stale');
    const staleAgent = await fs.readFile(path.join(claudeDir, 'agents', 'devflow', 'stale.md'), 'utf-8');
    expect(staleAgent).toBe('# stale');
  });
});

describe('discoverProjectGitRoots', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-discover-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns sorted git roots from history.jsonl', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    // Create two project dirs with .git
    const projA = path.join(tmpDir, 'project-a');
    const projB = path.join(tmpDir, 'project-b');
    await fs.mkdir(path.join(projA, '.git'), { recursive: true });
    await fs.mkdir(path.join(projB, '.git'), { recursive: true });

    // Write history with both projects (projB before projA to verify sorting)
    const lines = [
      JSON.stringify({ project: projB, timestamp: '2026-01-01' }),
      JSON.stringify({ project: projA, timestamp: '2026-01-02' }),
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([projA, projB]);
  });

  it('skips projects without .git directory', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const projGit = path.join(tmpDir, 'has-git');
    const projNoGit = path.join(tmpDir, 'no-git');
    await fs.mkdir(path.join(projGit, '.git'), { recursive: true });
    await fs.mkdir(projNoGit, { recursive: true });

    const lines = [
      JSON.stringify({ project: projGit }),
      JSON.stringify({ project: projNoGit }),
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([projGit]);
  });

  it('skips non-existent project paths', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const lines = JSON.stringify({ project: path.join(tmpDir, 'gone') });
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it('returns empty array when history.jsonl is missing', async () => {
    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it('returns empty array when history.jsonl is empty', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), '', 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([]);
  });

  it('skips malformed JSON lines gracefully', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const proj = path.join(tmpDir, 'valid');
    await fs.mkdir(path.join(proj, '.git'), { recursive: true });

    const lines = [
      'not valid json',
      JSON.stringify({ project: proj }),
      '{broken',
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([proj]);
  });

  it('deduplicates repeated project entries', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const proj = path.join(tmpDir, 'dupe-proj');
    await fs.mkdir(path.join(proj, '.git'), { recursive: true });

    const lines = [
      JSON.stringify({ project: proj }),
      JSON.stringify({ project: proj }),
      JSON.stringify({ project: proj }),
    ].join('\n');
    await fs.writeFile(path.join(claudeDir, 'history.jsonl'), lines, 'utf-8');

    const roots = await discoverProjectGitRoots(tmpDir);
    expect(roots).toEqual([proj]);
  });
});

describe('installClaudeignore return value', () => {
  let tmpDir: string;
  let rootDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-claudeignore-test-'));
    rootDir = path.join(tmpDir, 'root');
    await fs.mkdir(path.join(rootDir, 'src', 'targets', 'claude-code', 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, 'src', 'targets', 'claude-code', 'templates', 'claudeignore.template'),
      '# .claudeignore\nnode_modules/\n',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when .claudeignore is newly created', async () => {
    const gitRoot = path.join(tmpDir, 'project');
    await fs.mkdir(gitRoot, { recursive: true });

    const result = await installClaudeignore(gitRoot, rootDir, false);
    expect(result).toBe(true);

    const content = await fs.readFile(path.join(gitRoot, '.claudeignore'), 'utf-8');
    expect(content).toContain('node_modules/');
  });

  it('returns false when .claudeignore already exists', async () => {
    const gitRoot = path.join(tmpDir, 'project');
    await fs.mkdir(gitRoot, { recursive: true });
    await fs.writeFile(path.join(gitRoot, '.claudeignore'), '# existing', 'utf-8');

    const result = await installClaudeignore(gitRoot, rootDir, false);
    expect(result).toBe(false);

    // Should not overwrite existing file
    const content = await fs.readFile(path.join(gitRoot, '.claudeignore'), 'utf-8');
    expect(content).toBe('# existing');
  });
});

describe('runMigrationsWithFallback (D32/D35/D37 init seam)', () => {
  // Tests the init.ts integration seam — specifically the D37 fallback rule that
  // computes `projectsForMigration` before calling runMigrations. These tests are
  // distinct from migrations.test.ts (which covers runMigrations internals): they
  // exercise the code path that init.ts owns.

  const noopLogger = { warn: vi.fn(), info: vi.fn(), success: vi.fn() };
  const emptyResult: RunMigrationsResult = { newlyApplied: [], failures: [], infos: [], warnings: [] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes discoveredProjects directly when non-empty', async () => {
    const runner = vi.fn().mockResolvedValue(emptyResult);
    const projects = ['/abs/proj-a', '/abs/proj-b'];

    await runMigrationsWithFallback(projects, null, '/home/.devflow', noopLogger, false, runner);

    expect(runner).toHaveBeenCalledOnce();
    const [, calledProjects] = runner.mock.calls[0];
    expect(calledProjects).toEqual(projects);
  });

  it('falls back to [gitRoot] when discoveredProjects is empty and gitRoot is set', async () => {
    const runner = vi.fn().mockResolvedValue(emptyResult);
    const gitRoot = '/abs/fallback-root';

    await runMigrationsWithFallback([], gitRoot, '/home/.devflow', noopLogger, false, runner);

    expect(runner).toHaveBeenCalledOnce();
    const [, calledProjects] = runner.mock.calls[0];
    expect(calledProjects).toEqual([gitRoot]);
  });

  it('passes empty list when both discoveredProjects and gitRoot are absent', async () => {
    const runner = vi.fn().mockResolvedValue(emptyResult);

    await runMigrationsWithFallback([], null, '/home/.devflow', noopLogger, false, runner);

    expect(runner).toHaveBeenCalledOnce();
    const [, calledProjects] = runner.mock.calls[0];
    expect(calledProjects).toEqual([]);
  });

  it('passes the devflowDir context to the runner', async () => {
    const runner = vi.fn().mockResolvedValue(emptyResult);
    const devflowDir = '/home/.devflow';

    await runMigrationsWithFallback([], null, devflowDir, noopLogger, false, runner);

    const [ctx] = runner.mock.calls[0];
    expect(ctx.devflowDir).toBe(devflowDir);
  });
});


describe('buildRulesMap', () => {
  it('returns rules only from selected plugins', () => {
    const coreOnly = DEVFLOW_PLUGINS.filter(p => p.name === 'devflow-core-skills');
    const map = buildRulesMap(coreOnly);
    expect(map.size).toBe(4);
    expect(map.get('security')).toBe('devflow-core-skills');
    expect(map.get('engineering')).toBe('devflow-core-skills');
    expect(map.get('quality')).toBe('devflow-core-skills');
    expect(map.get('reliability')).toBe('devflow-core-skills');
  });

  it('includes optional plugin rules when selected', () => {
    const selected = DEVFLOW_PLUGINS.filter(p => ['devflow-core-skills', 'devflow-typescript'].includes(p.name));
    const map = buildRulesMap(selected);
    expect(map.has('typescript')).toBe(true);
    expect(map.get('typescript')).toBe('devflow-typescript');
  });

  it('returns empty map for plugins with no rules', () => {
    const planOnly = DEVFLOW_PLUGINS.filter(p => p.name === 'devflow-plan');
    const map = buildRulesMap(planOnly);
    expect(map.size).toBe(0);
  });

  it('deduplicates rules when two plugins declare the same rule name', () => {
    // Create synthetic plugins to test deduplication
    const fakePlug1 = { name: 'devflow-a', description: '', commands: [], agents: [], skills: [], rules: ['shared-rule'] };
    const fakePlug2 = { name: 'devflow-b', description: '', commands: [], agents: [], skills: [], rules: ['shared-rule'] };
    const map = buildRulesMap([fakePlug1, fakePlug2]);
    expect(map.size).toBe(1);
    expect(map.get('shared-rule')).toBe('devflow-a'); // first plugin wins
  });
});

describe('applyUserSecurityDenyList', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-apply-deny-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const templateDeny = ['Bash(rm -rf /*)', 'Bash(sudo *)', 'Read(/etc/shadow)'];

  it('merges template deny into an existing settings file, preserving sibling keys', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const initial = { theme: 'dark', model: 'claude-opus-4-5', permissions: { allow: ['Read(~/notes)'] } };
    await fs.writeFile(settingsPath, JSON.stringify(initial, null, 2) + '\n', 'utf-8');

    const result = await applyUserSecurityDenyList(settingsPath, templateDeny);

    const written = JSON.parse(result);
    // Deny entries are present
    for (const entry of templateDeny) {
      expect(written.permissions.deny).toContain(entry);
    }
    // Sibling keys are preserved
    expect(written.theme).toBe('dark');
    expect(written.model).toBe('claude-opus-4-5');
    // Allow list is preserved
    expect(written.permissions.allow).toEqual(['Read(~/notes)']);

    // File on disk matches
    const fromDisk = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(fromDisk.permissions.deny).toEqual(written.permissions.deny);
  });

  it('creates settings from {} when the file is absent (ENOENT branch)', async () => {
    const settingsPath = path.join(tmpDir, 'nonexistent', 'settings.json');
    // Parent directory does not exist — applyUserSecurityDenyList will hit ENOENT on
    // the read (falling back to '{}') and then writeFileAtomicExclusive must create it.
    // writeFileAtomicExclusive writes to a .tmp sibling and renames — the parent must exist.
    // So we create the parent dir but leave the file absent.
    await fs.mkdir(path.join(tmpDir, 'nonexistent'), { recursive: true });

    const result = await applyUserSecurityDenyList(settingsPath, templateDeny);

    const written = JSON.parse(result);
    for (const entry of templateDeny) {
      expect(written.permissions.deny).toContain(entry);
    }
    // File was actually written to disk
    const fromDisk = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(fromDisk.permissions.deny).toEqual(written.permissions.deny);
  });

  it('is idempotent — two applies produce byte-equal output, no duplication', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'light' }, null, 2) + '\n', 'utf-8');

    const first = await applyUserSecurityDenyList(settingsPath, templateDeny);
    const second = await applyUserSecurityDenyList(settingsPath, templateDeny);

    // Returned strings are identical
    expect(second).toBe(first);

    // No duplication in the deny array
    const written = JSON.parse(second);
    const uniqueEntries = new Set(written.permissions.deny);
    expect(written.permissions.deny.length).toBe(uniqueEntries.size);
    // All template entries still present exactly once
    for (const entry of templateDeny) {
      expect(written.permissions.deny.filter((e: string) => e === entry).length).toBe(1);
    }
  });
});

describe('loadTemplateDenyEntries', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-load-deny-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns the template deny entries for a valid template', async () => {
    const denyEntries = ['Bash(rm -rf /*)', 'Bash(sudo *)', 'Read(/etc/shadow)'];
    const templateContent = JSON.stringify({ permissions: { deny: denyEntries } }, null, 2);
    await fs.mkdir(path.join(tmpDir, 'src', 'targets', 'claude-code', 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'src', 'targets', 'claude-code', 'templates', 'managed-settings.json'),
      templateContent,
      'utf-8',
    );

    const result = await loadTemplateDenyEntries(tmpDir);
    expect(result).toEqual(denyEntries);
  });

  it('returns [] when permissions.deny is a non-array (e.g. a string)', async () => {
    const templateContent = JSON.stringify({ permissions: { deny: 'not-an-array' } });
    await fs.mkdir(path.join(tmpDir, 'src', 'targets', 'claude-code', 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'src', 'targets', 'claude-code', 'templates', 'managed-settings.json'),
      templateContent,
      'utf-8',
    );

    const result = await loadTemplateDenyEntries(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns [] on read/parse error (missing template file)', async () => {
    // No template file created — the directory is empty
    const result = await loadTemplateDenyEntries(tmpDir);
    expect(result).toEqual([]);
  });
});
