import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { addMemoryHooks, removeMemoryHooks, hasMemoryHooks, countMemoryHooks } from '../src/cli/commands/memory.js';
import { createMemoryDir, migrateMemoryFiles } from '../src/cli/utils/post-install.js';

describe('addMemoryHooks', () => {
  it('adds all 3 hook types to empty settings', () => {
    const result = addMemoryHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('stop-update-memory');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory');
  });

  it('preserves existing hooks (UserPromptSubmit/ambient untouched)', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt.sh' }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('ambient-prompt.sh');
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
  });

  it('is idempotent — calling twice returns identical JSON', () => {
    const first = addMemoryHooks('{}', '/home/user/.devflow');
    const second = addMemoryHooks(first, '/home/user/.devflow');

    expect(second).toBe(first);
  });

  it('adds only missing hooks when partial state (1 hook missing)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory', timeout: 10 }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Existing hooks preserved
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    // Missing hook added
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory');
  });

  it('creates hooks object if missing', () => {
    const input = JSON.stringify({ statusLine: { type: 'command' } });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('uses correct devflowDir path in command via run-hook wrapper', () => {
    const result = addMemoryHooks('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop[0].hooks[0].command).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('stop-update-memory');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('run-hook');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('run-hook');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory');
  });

  it('preserves other settings (statusLine, env)', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'statusline.sh' },
      env: { SOME_VAR: '1' },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('statusline.sh');
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('sets timeout to 10 for all hooks', () => {
    const result = addMemoryHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.PreCompact[0].hooks[0].timeout).toBe(10);
  });
});

describe('removeMemoryHooks', () => {
  it('removes all 3 hook types', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    const result = removeMemoryHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hooks (UserPromptSubmit)', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt.sh' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toBeUndefined();
    expect(settings.hooks.SessionStart).toBeUndefined();
    expect(settings.hooks.PreCompact).toBeUndefined();
  });

  it('is idempotent — safe to call when not present', () => {
    const input = JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other.sh' }] }] },
    });
    const result = removeMemoryHooks(input);

    expect(result).toBe(input);
  });

  it('cleans empty hook type arrays', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('cleans empty hooks object when all arrays removed', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    const result = removeMemoryHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('removes only the hooks that exist (partial)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        // SessionStart and PreCompact already missing
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command' },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toEqual({ type: 'command' });
  });
});

describe('hasMemoryHooks', () => {
  it('returns true when all 3 present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(hasMemoryHooks(withHooks)).toBe(true);
  });

  it('returns false when none present', () => {
    expect(hasMemoryHooks('{}')).toBe(false);
  });

  it('returns false when partial (1 or 2 of 3)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });

  it('returns false for non-memory hooks only', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt.sh' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });
});

describe('countMemoryHooks', () => {
  it('returns 3 when all present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(countMemoryHooks(withHooks)).toBe(3);
  });

  it('returns 0 when none present', () => {
    expect(countMemoryHooks('{}')).toBe(0);
  });

  it('returns correct partial count', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
      },
    });
    expect(countMemoryHooks(input)).toBe(2);
  });
});

describe('createMemoryDir', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .memory/ directory', async () => {
    await createMemoryDir(false, tmpDir);
    const stat = await fs.stat(path.join(tmpDir, '.memory'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('is idempotent — calling twice succeeds without error', async () => {
    await createMemoryDir(false, tmpDir);
    await createMemoryDir(false, tmpDir);
    const stat = await fs.stat(path.join(tmpDir, '.memory'));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('migrateMemoryFiles', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
    await fs.mkdir(path.join(tmpDir, '.memory'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 on fresh install (no .docs/ files)', async () => {
    const count = await migrateMemoryFiles(false, tmpDir);
    expect(count).toBe(0);
  });

  it('migrates all 3 files from .docs/ to .memory/', async () => {
    const docsDir = path.join(tmpDir, '.docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, 'WORKING-MEMORY.md'), '# Working Memory');
    await fs.writeFile(path.join(docsDir, 'patterns.md'), '# Patterns');
    await fs.writeFile(path.join(docsDir, 'working-memory-backup.json'), '{}');

    const count = await migrateMemoryFiles(false, tmpDir);
    expect(count).toBe(3);

    // Verify destinations exist
    const wm = await fs.readFile(path.join(tmpDir, '.memory', 'WORKING-MEMORY.md'), 'utf-8');
    expect(wm).toBe('# Working Memory');

    const patterns = await fs.readFile(path.join(tmpDir, '.memory', 'PROJECT-PATTERNS.md'), 'utf-8');
    expect(patterns).toBe('# Patterns');

    const backup = await fs.readFile(path.join(tmpDir, '.memory', 'backup.json'), 'utf-8');
    expect(backup).toBe('{}');

    // Verify sources removed
    await expect(fs.access(path.join(docsDir, 'WORKING-MEMORY.md'))).rejects.toThrow();
    await expect(fs.access(path.join(docsDir, 'patterns.md'))).rejects.toThrow();
    await expect(fs.access(path.join(docsDir, 'working-memory-backup.json'))).rejects.toThrow();
  });

  it('skips migration when destination already exists (no clobber)', async () => {
    const docsDir = path.join(tmpDir, '.docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, 'WORKING-MEMORY.md'), 'old content');
    await fs.writeFile(path.join(tmpDir, '.memory', 'WORKING-MEMORY.md'), 'existing content');

    const count = await migrateMemoryFiles(false, tmpDir);
    expect(count).toBe(0);

    // Existing content preserved
    const content = await fs.readFile(path.join(tmpDir, '.memory', 'WORKING-MEMORY.md'), 'utf-8');
    expect(content).toBe('existing content');
  });

  it('cleans up ephemeral files from .docs/', async () => {
    const docsDir = path.join(tmpDir, '.docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, '.working-memory-update.log'), 'log content');
    await fs.writeFile(path.join(docsDir, '.working-memory-last-trigger'), '');
    await fs.mkdir(path.join(docsDir, '.working-memory.lock'), { recursive: true });

    await migrateMemoryFiles(false, tmpDir);

    await expect(fs.access(path.join(docsDir, '.working-memory-update.log'))).rejects.toThrow();
    await expect(fs.access(path.join(docsDir, '.working-memory-last-trigger'))).rejects.toThrow();
    await expect(fs.access(path.join(docsDir, '.working-memory.lock'))).rejects.toThrow();
  });
});
