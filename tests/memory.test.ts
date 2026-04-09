import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { addMemoryHooks, removeMemoryHooks, hasMemoryHooks, countMemoryHooks } from '../src/cli/commands/memory.js';
import { createMemoryDir, migrateMemoryFiles } from '../src/cli/utils/post-install.js';

describe('addMemoryHooks', () => {
  it('adds all 4 hook types to empty settings', () => {
    const result = addMemoryHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('prompt-capture-memory');
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('stop-update-memory');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory');
  });

  it('preserves existing ambient preamble hook when adding memory hooks', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Ambient preamble preserved alongside prompt-capture-memory
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('preamble');
    expect(settings.hooks.UserPromptSubmit[1].hooks[0].command).toContain('prompt-capture-memory');
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
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/prompt-capture-memory', timeout: 10 }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory', timeout: 10 }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Existing hooks preserved
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    // Missing hook added
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory');
  });

  it('adds UserPromptSubmit prompt-capture-memory alongside existing preamble (upgrade path)', () => {
    // Simulate a 3-hook install (pre-upgrade) that already has ambient preamble
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/preamble' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory', timeout: 10 }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory', timeout: 10 }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // prompt-capture-memory added; preamble kept
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    const commands = settings.hooks.UserPromptSubmit.map((m: { hooks: { command: string }[] }) => m.hooks[0].command);
    expect(commands.some((c: string) => c.includes('preamble'))).toBe(true);
    expect(commands.some((c: string) => c.includes('prompt-capture-memory'))).toBe(true);
    // Other hooks unchanged
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
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

    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('prompt-capture-memory');
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

    expect(settings.hooks.UserPromptSubmit[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    expect(settings.hooks.PreCompact[0].hooks[0].timeout).toBe(10);
  });
});

describe('removeMemoryHooks', () => {
  it('removes all 4 hook types', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    const result = removeMemoryHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves ambient preamble when removing memory hooks (preamble != prompt-capture-memory)', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'preamble' }] },
          { hooks: [{ type: 'command', command: '/path/prompt-capture-memory' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    // Ambient preamble preserved; prompt-capture-memory removed
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('preamble');
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
        // UserPromptSubmit, SessionStart, PreCompact already missing
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
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/prompt-capture-memory' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.statusLine).toEqual({ type: 'command' });
  });

  it('toggle cycle: enable → disable → enable produces clean state', () => {
    const enabled = addMemoryHooks('{}', '/home/user/.devflow');
    const disabled = removeMemoryHooks(enabled);
    const reEnabled = addMemoryHooks(disabled, '/home/user/.devflow');
    const settings = JSON.parse(reEnabled);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
  });
});

describe('hasMemoryHooks', () => {
  it('returns true when all 4 present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(hasMemoryHooks(withHooks)).toBe(true);
  });

  it('returns false when none present', () => {
    expect(hasMemoryHooks('{}')).toBe(false);
  });

  it('returns false when partial (1 of 4)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });

  it('returns false when partial (3 of 4 — old install missing UserPromptSubmit)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });

  it('returns false for ambient preamble only (not a memory hook)', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });
});

describe('countMemoryHooks', () => {
  it('returns 4 when all present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(countMemoryHooks(withHooks)).toBe(4);
  });

  it('returns 0 when none present', () => {
    expect(countMemoryHooks('{}')).toBe(0);
  });

  it('returns correct partial count (2 of 4)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
      },
    });
    expect(countMemoryHooks(input)).toBe(2);
  });

  it('does not count ambient preamble as prompt-capture-memory', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/preamble' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/stop-update-memory' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory' }] }],
      },
    });
    // preamble does not match 'prompt-capture-memory' marker
    expect(countMemoryHooks(input)).toBe(3);
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

  it('creates .memory/knowledge/ subdirectory', async () => {
    await createMemoryDir(false, tmpDir);
    const stat = await fs.stat(path.join(tmpDir, '.memory', 'knowledge'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('is idempotent — calling twice succeeds without error', async () => {
    await createMemoryDir(false, tmpDir);
    await createMemoryDir(false, tmpDir);
    const stat = await fs.stat(path.join(tmpDir, '.memory'));
    expect(stat.isDirectory()).toBe(true);
    const knowledgeStat = await fs.stat(path.join(tmpDir, '.memory', 'knowledge'));
    expect(knowledgeStat.isDirectory()).toBe(true);
  });

  it('does not throw when path is invalid (verbose logs warning)', async () => {
    // Create a file where the directory would go — mkdir will fail
    const blockerPath = path.join(tmpDir, '.memory');
    await fs.writeFile(blockerPath, 'not a directory');

    // Should not throw even though mkdir fails
    await expect(createMemoryDir(false, tmpDir)).resolves.toBeUndefined();
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

  it('migrates memory files from .docs/ to .memory/', async () => {
    const docsDir = path.join(tmpDir, '.docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, 'WORKING-MEMORY.md'), '# Working Memory');
    await fs.writeFile(path.join(docsDir, 'working-memory-backup.json'), '{}');

    const count = await migrateMemoryFiles(false, tmpDir);
    expect(count).toBe(2);

    // Verify destinations exist
    const wm = await fs.readFile(path.join(tmpDir, '.memory', 'WORKING-MEMORY.md'), 'utf-8');
    expect(wm).toBe('# Working Memory');

    const backup = await fs.readFile(path.join(tmpDir, '.memory', 'backup.json'), 'utf-8');
    expect(backup).toBe('{}');

    // Verify sources removed
    await expect(fs.access(path.join(docsDir, 'WORKING-MEMORY.md'))).rejects.toThrow();
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

  it('migrates debug logs from .memory/ to devflow logs dir', async () => {
    const memoryDir = path.join(tmpDir, '.memory');
    await fs.writeFile(path.join(memoryDir, '.learning-update.log'), 'learning log');
    await fs.writeFile(path.join(memoryDir, '.working-memory-update.log'), 'memory log');

    // Use tmpDir-based devflow dir for test isolation
    const testDevflowDir = path.join(tmpDir, '.devflow-test');
    const count = await migrateMemoryFiles(false, tmpDir, testDevflowDir);
    expect(count).toBe(2);

    // Old files should be gone
    await expect(fs.access(path.join(memoryDir, '.learning-update.log'))).rejects.toThrow();
    await expect(fs.access(path.join(memoryDir, '.working-memory-update.log'))).rejects.toThrow();

    // New files should exist in the injected devflow dir
    const slug = tmpDir.replace(/^\//, '').replace(/\//g, '-');
    const logsDir = path.join(testDevflowDir, 'logs', slug);
    const learningLog = await fs.readFile(path.join(logsDir, '.learning-update.log'), 'utf-8');
    expect(learningLog).toBe('learning log');
    const memoryLog = await fs.readFile(path.join(logsDir, '.working-memory-update.log'), 'utf-8');
    expect(memoryLog).toBe('memory log');
  });

  it('auto-purges invalid learning observations during migration', async () => {
    const memoryDir = path.join(tmpDir, '.memory');
    const validEntry = JSON.stringify({
      id: 'obs_abc123', type: 'workflow', pattern: 'real',
      confidence: 0.5, observations: 1, first_seen: 't', last_seen: 't',
      status: 'observing', evidence: [], details: 'd',
    });
    const emptyId = JSON.stringify({
      id: '', type: 'workflow', pattern: 'bad',
      confidence: 0.5, observations: 1, first_seen: 't', last_seen: 't',
      status: 'observing', evidence: [], details: 'd',
    });
    const emptyPattern = JSON.stringify({
      id: 'obs_def456', type: 'procedural', pattern: '',
      confidence: 0.5, observations: 1, first_seen: 't', last_seen: 't',
      status: 'observing', evidence: [], details: 'd',
    });
    const malformed = 'not json';

    await fs.writeFile(
      path.join(memoryDir, 'learning-log.jsonl'),
      [validEntry, emptyId, emptyPattern, malformed].join('\n') + '\n',
    );

    await migrateMemoryFiles(false, tmpDir);

    const content = await fs.readFile(path.join(memoryDir, 'learning-log.jsonl'), 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).id).toBe('obs_abc123');
  });

  it('skips auto-purge when no learning-log.jsonl exists', async () => {
    // Should not throw
    await expect(migrateMemoryFiles(false, tmpDir)).resolves.toBe(0);
  });
});

describe('countMemoryHooks accepts parsed Settings', () => {
  it('accepts a parsed Settings object (not just JSON string)', () => {
    const settings = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command' as const, command: '/path/prompt-capture-memory', timeout: 10 }] }],
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/stop-update-memory', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command' as const, command: '/path/session-start-memory', timeout: 10 }] }],
        PreCompact: [{ hooks: [{ type: 'command' as const, command: '/path/pre-compact-memory', timeout: 10 }] }],
      },
    };
    expect(countMemoryHooks(settings)).toBe(4);
    expect(hasMemoryHooks(settings)).toBe(true);
  });

  it('accepts parsed Settings with no hooks', () => {
    const settings = {};
    expect(countMemoryHooks(settings)).toBe(0);
    expect(hasMemoryHooks(settings)).toBe(false);
  });

  it('accepts parsed Settings with partial hooks', () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/stop-update-memory', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command' as const, command: '/path/session-start-memory', timeout: 10 }] }],
      },
    };
    expect(countMemoryHooks(settings)).toBe(2);
    expect(hasMemoryHooks(settings)).toBe(false);
  });
});

describe('session-start-memory hook integration', () => {
  let tmpDir: string;
  const hookPath = path.resolve(__dirname, '..', 'scripts', 'hooks', 'session-start-memory');

  function runHook(cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = exec(`bash "${hookPath}"`, { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Hook failed: ${err.message}\nstderr: ${stderr}`));
        resolve(stdout);
      });
      child.stdin?.write(JSON.stringify({ cwd }));
      child.stdin?.end();
    });
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-hook-test-'));
    await fs.mkdir(path.join(tmpDir, '.memory', 'knowledge'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('injects PROJECT KNOWLEDGE TL;DR from knowledge files', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'),
      '<!-- TL;DR: 2 decisions. Key: ADR-001 Result types, ADR-002 Single-coder -->\n# Architectural Decisions',
    );
    await fs.writeFile(
      path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'),
      '<!-- TL;DR: 1 pitfall. Key: PF-001 Synthesizer glob -->\n# Known Pitfalls',
    );

    const output = await runHook(tmpDir);
    const json = JSON.parse(output);
    const ctx = json.hookSpecificOutput.additionalContext;

    expect(ctx).toContain('PROJECT KNOWLEDGE (TL;DR)');
    expect(ctx).toContain('2 decisions. Key: ADR-001 Result types, ADR-002 Single-coder');
    expect(ctx).toContain('1 pitfall. Key: PF-001 Synthesizer glob');
  });

  it('produces no leading newlines when only knowledge files exist (no working memory)', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'),
      '<!-- TL;DR: 1 decision. Key: ADR-001 Test -->\n# Architectural Decisions',
    );

    const output = await runHook(tmpDir);
    const json = JSON.parse(output);
    const ctx = json.hookSpecificOutput.additionalContext;

    expect(ctx).not.toMatch(/^\n/);
    expect(ctx).toMatch(/^---/);
  });

  it('does not include PROJECT KNOWLEDGE section when no knowledge files exist', async () => {
    // Empty tmpDir with just the directories — no knowledge files
    const output = await runHook(tmpDir);
    // May still have ambient output depending on user settings, but should not have knowledge
    if (output.trim()) {
      const json = JSON.parse(output);
      const ctx = json.hookSpecificOutput.additionalContext;
      expect(ctx).not.toContain('PROJECT KNOWLEDGE');
    }
    // If no output at all, that's also correct
  });
});
