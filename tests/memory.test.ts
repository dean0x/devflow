import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { addMemoryHooks, removeMemoryHooks, hasMemoryHooks, countMemoryHooks, cleanQueueFiles, hasMemoryDir, filterProjectsWithMemory } from '../src/cli/commands/memory.js';

describe('addMemoryHooks', () => {
  it('adds all 3 memory hook types to empty settings', () => {
    const result = addMemoryHooks('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();
    expect(settings.hooks.SessionEnd).toBeUndefined();
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('memory-worker');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-memory');
  });

  it('does not touch UserPromptSubmit — owned by capture.ts, not memory.ts', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/run-hook preamble' }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
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
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker', timeout: 10 }] }],
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
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('memory-worker');
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
  it('removes all 3 memory hook types', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    const result = removeMemoryHooks(withHooks);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('does not touch UserPromptSubmit — owned by capture.ts, not memory.ts', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/run-hook preamble' }] },
          { hooks: [{ type: 'command', command: '/path/run-hook capture-prompt' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    // UserPromptSubmit is untouched — both entries survive; only Stop is cleared
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.Stop).toBeUndefined();
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
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
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
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
        // SessionStart, PreCompact already missing
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
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
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

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
  });
});

describe('hasMemoryHooks', () => {
  it('returns true when all 3 memory hooks present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(hasMemoryHooks(withHooks)).toBe(true);
  });

  it('returns false when none present', () => {
    expect(hasMemoryHooks('{}')).toBe(false);
  });

  it('returns false when partial (1 of 3)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });

  it('returns false when partial (2 of 3 — missing PreCompact)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });

  it('returns false when only unrelated hooks (e.g. ambient preamble) are present', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
      },
    });
    expect(hasMemoryHooks(input)).toBe(false);
  });
});

describe('countMemoryHooks', () => {
  it('returns 3 when all memory hooks present', () => {
    const withHooks = addMemoryHooks('{}', '/home/user/.devflow');
    expect(countMemoryHooks(withHooks)).toBe(3);
  });

  it('returns 0 when none present', () => {
    expect(countMemoryHooks('{}')).toBe(0);
  });

  it('returns correct partial count (2 of 3)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
      },
    });
    expect(countMemoryHooks(input)).toBe(2);
  });

  it('does not count unrelated UserPromptSubmit hooks toward the memory count', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/preamble' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '/path/memory-worker' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/session-start-memory' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: '/path/pre-compact-memory' }] }],
      },
    });
    expect(countMemoryHooks(input)).toBe(3);
  });
});

describe('countMemoryHooks accepts parsed Settings', () => {
  it('accepts a parsed Settings object (not just JSON string)', () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/memory-worker', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command' as const, command: '/path/session-start-memory', timeout: 10 }] }],
        PreCompact: [{ hooks: [{ type: 'command' as const, command: '/path/pre-compact-memory', timeout: 10 }] }],
      },
    };
    expect(countMemoryHooks(settings)).toBe(3);
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
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/memory-worker', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command' as const, command: '/path/session-start-memory', timeout: 10 }] }],
      },
    };
    expect(countMemoryHooks(settings)).toBe(2);
    expect(hasMemoryHooks(settings)).toBe(false);
  });
});

describe('hasMemoryDir', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-hasMemoryDir-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when .devflow/memory/ directory exists', async () => {
    await fs.mkdir(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    expect(await hasMemoryDir(tmpDir)).toBe(true);
  });

  it('returns false when .devflow/memory/ directory does not exist', async () => {
    expect(await hasMemoryDir(tmpDir)).toBe(false);
  });

  it('returns false when root itself does not exist', async () => {
    expect(await hasMemoryDir(path.join(tmpDir, 'nonexistent'))).toBe(false);
  });
});

describe('filterProjectsWithMemory', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-filterProjects-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no git roots provided', async () => {
    expect(await filterProjectsWithMemory([])).toEqual([]);
  });

  it('returns only projects that have .devflow/memory/', async () => {
    const projA = path.join(tmpDir, 'projA');
    const projB = path.join(tmpDir, 'projB');
    const projC = path.join(tmpDir, 'projC');
    await fs.mkdir(path.join(projA, '.devflow', 'memory'), { recursive: true });
    await fs.mkdir(projB, { recursive: true }); // no .devflow/memory/
    await fs.mkdir(path.join(projC, '.devflow', 'memory'), { recursive: true });

    const result = await filterProjectsWithMemory([projA, projB, projC]);
    expect(result).toEqual([projA, projC]);
  });

  it('returns empty array when no projects have .memory/', async () => {
    const projA = path.join(tmpDir, 'projA');
    await fs.mkdir(projA, { recursive: true });
    expect(await filterProjectsWithMemory([projA])).toEqual([]);
  });
});

describe('cleanQueueFiles', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-cleanQueue-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns cleaned=0 when no projects provided', async () => {
    const result = await cleanQueueFiles([]);
    expect(result).toEqual({ cleaned: 0, projects: [] });
  });

  it('cleans both queue files when both exist', async () => {
    const memDir = path.join(tmpDir, '.devflow', 'memory');
    await fs.mkdir(memDir, { recursive: true });
    await fs.writeFile(path.join(memDir, '.pending-turns.jsonl'), '{"role":"user"}');
    await fs.writeFile(path.join(memDir, '.pending-turns.processing'), '{"role":"user"}');

    const result = await cleanQueueFiles([tmpDir]);
    expect(result.cleaned).toBe(1);
    expect(result.projects).toEqual([tmpDir]);
    await expect(fs.access(path.join(memDir, '.pending-turns.jsonl'))).rejects.toThrow();
    await expect(fs.access(path.join(memDir, '.pending-turns.processing'))).rejects.toThrow();
  });

  it('cleans only .pending-turns.jsonl when only that file exists', async () => {
    const memDir = path.join(tmpDir, '.devflow', 'memory');
    await fs.mkdir(memDir, { recursive: true });
    await fs.writeFile(path.join(memDir, '.pending-turns.jsonl'), '{"role":"user"}');

    const result = await cleanQueueFiles([tmpDir]);
    expect(result.cleaned).toBe(1);
    await expect(fs.access(path.join(memDir, '.pending-turns.jsonl'))).rejects.toThrow();
  });

  it('returns cleaned=0 when neither queue file exists', async () => {
    const memDir = path.join(tmpDir, '.devflow', 'memory');
    await fs.mkdir(memDir, { recursive: true });

    const result = await cleanQueueFiles([tmpDir]);
    expect(result).toEqual({ cleaned: 0, projects: [] });
  });

  it('skips projects where lock directory is present', async () => {
    const memDir = path.join(tmpDir, '.devflow', 'memory');
    await fs.mkdir(memDir, { recursive: true });
    await fs.writeFile(path.join(memDir, '.pending-turns.jsonl'), '{"role":"user"}');
    // Create the lock directory to simulate active background updater
    await fs.mkdir(path.join(memDir, '.working-memory.lock'), { recursive: true });

    const result = await cleanQueueFiles([tmpDir]);
    expect(result).toEqual({ cleaned: 0, projects: [] });
    // File should remain untouched
    await expect(fs.access(path.join(memDir, '.pending-turns.jsonl'))).resolves.toBeUndefined();
  });

  it('cleans multiple projects in parallel', async () => {
    const projA = path.join(tmpDir, 'projA');
    const projB = path.join(tmpDir, 'projB');
    const projC = path.join(tmpDir, 'projC');

    for (const proj of [projA, projB, projC]) {
      await fs.mkdir(path.join(proj, '.devflow', 'memory'), { recursive: true });
      await fs.writeFile(path.join(proj, '.devflow', 'memory', '.pending-turns.jsonl'), '{"role":"user"}');
    }

    const result = await cleanQueueFiles([projA, projB, projC]);
    expect(result.cleaned).toBe(3);
    expect(result.projects).toContain(projA);
    expect(result.projects).toContain(projB);
    expect(result.projects).toContain(projC);
  });

  it('cleans unlocked projects and skips locked ones in same batch', async () => {
    const locked = path.join(tmpDir, 'locked');
    const unlocked = path.join(tmpDir, 'unlocked');

    await fs.mkdir(path.join(locked, '.devflow', 'memory', '.working-memory.lock'), { recursive: true });
    await fs.writeFile(path.join(locked, '.devflow', 'memory', '.pending-turns.jsonl'), 'data');

    await fs.mkdir(path.join(unlocked, '.devflow', 'memory'), { recursive: true });
    await fs.writeFile(path.join(unlocked, '.devflow', 'memory', '.pending-turns.jsonl'), 'data');

    const result = await cleanQueueFiles([locked, unlocked]);
    expect(result.cleaned).toBe(1);
    expect(result.projects).toEqual([unlocked]);
  });
});

describe('removeMemoryHooks accepts parsed Settings', () => {
  it('accepts a parsed Settings object and returns JSON string', () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/memory-worker', timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command' as const, command: '/path/session-start-memory', timeout: 10 }] }],
        PreCompact: [{ hooks: [{ type: 'command' as const, command: '/path/pre-compact-memory', timeout: 10 }] }],
      },
    };
    const result = removeMemoryHooks(settings);
    const parsed = JSON.parse(result);
    expect(parsed.hooks).toBeUndefined();
  });

  it('does not mutate the original Settings object when passed by reference', () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/memory-worker', timeout: 10 }] }],
      },
    };
    removeMemoryHooks(settings);
    // Original must be unchanged
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('consistent API: string and Settings produce same result', () => {
    const settingsObj = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command' as const, command: '/path/memory-worker', timeout: 10 }] }],
      },
    };
    const resultFromObj = removeMemoryHooks(settingsObj);
    const resultFromStr = removeMemoryHooks(JSON.stringify(settingsObj));
    expect(JSON.parse(resultFromObj)).toEqual(JSON.parse(resultFromStr));
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
    await fs.mkdir(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does not include PROJECT DECISIONS section (decisions TL;DR moved to session-start-context)', async () => {
    // Decisions TL;DR injection moved from session-start-memory to session-start-context.
    // session-start-memory only handles working memory (WORKING-MEMORY.md).
    await fs.writeFile(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '<!-- TL;DR: 2 decisions. Key: ADR-001 Result types, ADR-002 Single-coder -->\n# Architectural Decisions',
    );

    const output = await runHook(tmpDir);
    // With only decisions files (no WORKING-MEMORY.md), session-start-memory outputs nothing
    expect(output.trim()).toBe('');
  });

  it('does not include PROJECT DECISIONS section when no decisions files exist', async () => {
    // Empty tmpDir with just the directories — no decisions files, no WORKING-MEMORY.md
    const output = await runHook(tmpDir);
    // session-start-memory produces no output when there is no WORKING-MEMORY.md
    expect(output.trim()).toBe('');
  });
});

describe('session-start-context hook integration', () => {
  let tmpDir: string;
  const hookPath = path.resolve(__dirname, '..', 'scripts', 'hooks', 'session-start-context');

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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-context-hook-test-'));
    await fs.mkdir(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('injects PROJECT DECISIONS TL;DR from decisions files', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '<!-- TL;DR: 2 decisions. Key: ADR-001 Result types, ADR-002 Single-coder -->\n# Architectural Decisions',
    );
    await fs.writeFile(
      path.join(tmpDir, '.devflow', 'learning', 'pitfalls.md'),
      '<!-- TL;DR: 1 pitfall. Key: PF-001 Synthesizer glob -->\n# Known Pitfalls',
    );

    const output = await runHook(tmpDir);
    const json = JSON.parse(output);
    const ctx = json.hookSpecificOutput.additionalContext;

    expect(ctx).toContain('PROJECT DECISIONS (TL;DR)');
    expect(ctx).toContain('2 decisions. Key: ADR-001 Result types, ADR-002 Single-coder');
    expect(ctx).toContain('1 pitfall. Key: PF-001 Synthesizer glob');
  });

  it('produces no leading newlines when only decisions files exist', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '<!-- TL;DR: 1 decision. Key: ADR-001 Test -->\n# Architectural Decisions',
    );

    const output = await runHook(tmpDir);
    const json = JSON.parse(output);
    const ctx = json.hookSpecificOutput.additionalContext;

    expect(ctx).not.toMatch(/^\n/);
    expect(ctx).toMatch(/^---/);
  });

  it('does not include PROJECT DECISIONS section when no decisions files exist', async () => {
    // Empty tmpDir with decisions dir but no decisions files
    const output = await runHook(tmpDir);
    if (output.trim()) {
      const json = JSON.parse(output);
      const ctx = json.hookSpecificOutput.additionalContext;
      expect(ctx).not.toContain('PROJECT DECISIONS');
    }
    // If no output at all, that's also correct
  });
});

describe('removeMemoryHooks removes legacy hook registrations', () => {
  it('removes sidecar-dispatch from UserPromptSubmit (v3 sidecar→dream rename) — legacy sweep only, UserPromptSubmit untouched otherwise', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/run-hook sidecar-dispatch', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook preamble', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    // sidecar-dispatch removed; preamble preserved
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
  });

  it('removes sidecar-capture from Stop (v3 sidecar→dream rename)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/path/run-hook sidecar-capture', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);
    expect(settings.hooks).toBeUndefined();
  });

  it('removes sidecar-evaluate from SessionEnd (v3 sidecar→dream rename)', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/run-hook sidecar-evaluate', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);
    expect(settings.hooks).toBeUndefined();
  });

  it('removes prompt-capture-memory from UserPromptSubmit', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/run-hook prompt-capture-memory', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook preamble', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    // prompt-capture-memory removed; preamble preserved
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
  });

  it('removes stop-update-memory and stop-update-learning from Stop', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/path/run-hook stop-update-memory', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook stop-update-learning', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('removes session-end-learning, session-end-decisions, session-end-knowledge-refresh from SessionEnd', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-learning', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-decisions', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-knowledge-refresh', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    // Legacy pre-sidecar SessionEnd hooks removed via LEGACY_HOOK_MARKERS
    expect(settings.hooks).toBeUndefined();
  });

  it('removes the dream-dispatch/dream-capture/dream-evaluate marker pipeline (dream system simplification)', () => {
    // Upgrading users still carry the pre-cutover dream-* hook registrations —
    // these are swept via LEGACY_HOOK_MARKERS, not MEMORY_HOOK_CONFIG (which no
    // longer includes UserPromptSubmit or SessionEnd at all).
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/run-hook dream-dispatch', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook preamble', timeout: 10 }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: '/path/run-hook dream-capture', timeout: 10 }] },
        ],
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/run-hook dream-evaluate', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    // dream-dispatch removed; preamble preserved
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('preamble');
    // Stop and SessionEnd cleared entirely (only legacy entries were present)
    expect(settings.hooks.Stop).toBeUndefined();
    expect(settings.hooks.SessionEnd).toBeUndefined();
  });

  it('handles mix of old and new hooks — removes all legacy, preserves current registrations', () => {
    // Simulate an upgrading user with both old and new hooks installed
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/path/run-hook prompt-capture-memory', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook dream-dispatch', timeout: 10 }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: '/path/run-hook stop-update-memory', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook dream-capture', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook memory-worker', timeout: 10 }] },
        ],
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/run-hook session-end-learning', timeout: 10 }] },
          { hooks: [{ type: 'command', command: '/path/run-hook dream-evaluate', timeout: 10 }] },
        ],
        SessionStart: [
          { hooks: [{ type: 'command', command: '/path/run-hook session-start-memory', timeout: 10 }] },
        ],
        PreCompact: [
          { hooks: [{ type: 'command', command: '/path/run-hook pre-compact-memory', timeout: 10 }] },
        ],
      },
    });
    const result = removeMemoryHooks(input);
    const settings = JSON.parse(result);

    // Every entry present (across both legacy-swept and current MEMORY_HOOK_CONFIG
    // arrays) was either a legacy marker or a current memory hook, so nothing
    // survives — the whole `hooks` object is cleaned up entirely.
    expect(settings.hooks).toBeUndefined();
  });
});
