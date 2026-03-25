import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
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
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt' }] }],
      },
    });
    const result = addMemoryHooks(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('ambient-prompt');
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
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt' }] }],
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
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt' }] }],
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

  it('migrates debug logs from .memory/ to ~/.devflow/logs/', async () => {
    const memoryDir = path.join(tmpDir, '.memory');
    await fs.writeFile(path.join(memoryDir, '.learning-update.log'), 'learning log');
    await fs.writeFile(path.join(memoryDir, '.working-memory-update.log'), 'memory log');

    const count = await migrateMemoryFiles(false, tmpDir);
    expect(count).toBe(2);

    // Old files should be gone
    await expect(fs.access(path.join(memoryDir, '.learning-update.log'))).rejects.toThrow();
    await expect(fs.access(path.join(memoryDir, '.working-memory-update.log'))).rejects.toThrow();

    // New files should exist at ~/.devflow/logs/{slug}/
    const slug = tmpDir.replace(/^\//, '').replace(/\//g, '-');
    const logsDir = path.join(os.homedir(), '.devflow', 'logs', slug);
    const learningLog = await fs.readFile(path.join(logsDir, '.learning-update.log'), 'utf-8');
    expect(learningLog).toBe('learning log');
    const memoryLog = await fs.readFile(path.join(logsDir, '.working-memory-update.log'), 'utf-8');
    expect(memoryLog).toBe('memory log');

    // Cleanup migrated files
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  it('auto-purges invalid learning observations during migration', async () => {
    const memoryDir = path.join(tmpDir, '.memory');
    const validEntry = JSON.stringify({ id: 'obs_abc123', type: 'workflow', pattern: 'real' });
    const emptyId = JSON.stringify({ id: '', type: 'workflow', pattern: 'bad' });
    const emptyPattern = JSON.stringify({ id: 'obs_def456', type: 'procedural', pattern: '' });
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

describe('knowledge file format', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
    await fs.mkdir(path.join(tmpDir, '.memory', 'knowledge'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('parses TL;DR from decisions.md comment header', async () => {
    const content = '<!-- TL;DR: 2 decisions. Key: ADR-001 Result types, ADR-002 Single-coder -->\n# Architectural Decisions';
    await fs.writeFile(path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'), content);

    const firstLine = (await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'), 'utf-8')).split('\n')[0];
    const tldr = firstLine.replace('<!-- TL;DR: ', '').replace(' -->', '');

    expect(tldr).toBe('2 decisions. Key: ADR-001 Result types, ADR-002 Single-coder');
  });

  it('parses TL;DR from pitfalls.md comment header', async () => {
    const content = '<!-- TL;DR: 1 pitfall. Key: PF-001 Synthesizer glob -->\n# Known Pitfalls';
    await fs.writeFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), content);

    const firstLine = (await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), 'utf-8')).split('\n')[0];
    const tldr = firstLine.replace('<!-- TL;DR: ', '').replace(' -->', '');

    expect(tldr).toBe('1 pitfall. Key: PF-001 Synthesizer glob');
  });

  it('extracts highest ADR number via regex', async () => {
    const content = [
      '<!-- TL;DR: 3 decisions. Key: ADR-001 A, ADR-002 B, ADR-003 C -->',
      '# Architectural Decisions',
      '',
      '## ADR-001: First decision',
      '- **Status**: Accepted',
      '',
      '## ADR-002: Second decision',
      '- **Status**: Accepted',
      '',
      '## ADR-003: Third decision',
      '- **Status**: Accepted',
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'), content);

    const fileContent = await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'), 'utf-8');
    const matches = [...fileContent.matchAll(/^## ADR-(\d+)/gm)];
    const highest = matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1], 10))) : 0;

    expect(highest).toBe(3);
  });

  it('returns 0 for empty file with no ADR entries', async () => {
    const content = '<!-- TL;DR: 0 decisions. Key: -->\n# Architectural Decisions\n\nAppend-only.';
    await fs.writeFile(path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'), content);

    const fileContent = await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'decisions.md'), 'utf-8');
    const matches = [...fileContent.matchAll(/^## ADR-(\d+)/gm)];
    const highest = matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1], 10))) : 0;

    expect(highest).toBe(0);
  });

  it('detects duplicate pitfall by Area + Issue match', async () => {
    const content = [
      '<!-- TL;DR: 1 pitfall. Key: PF-001 Synthesizer glob -->',
      '# Known Pitfalls',
      '',
      '## PF-001: Synthesizer review glob matched zero files',
      '- **Area**: shared/agents/synthesizer.md',
      '- **Issue**: Glob didn\'t match reviewer output filenames',
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), content);

    const fileContent = await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), 'utf-8');

    // Check if an entry with matching Area and Issue already exists
    const newArea = 'shared/agents/synthesizer.md';
    const newIssue = 'Glob didn\'t match reviewer output filenames';
    const isDuplicate = fileContent.includes(`**Area**: ${newArea}`) && fileContent.includes(`**Issue**: ${newIssue}`);

    expect(isDuplicate).toBe(true);
  });

  it('gracefully handles missing knowledge files', async () => {
    // Verify no error when reading non-existent knowledge files
    const knowledgeDir = path.join(tmpDir, '.memory', 'knowledge');
    const decisionsPath = path.join(knowledgeDir, 'decisions.md');
    const pitfallsPath = path.join(knowledgeDir, 'pitfalls.md');

    // Simulate the graceful degradation pattern from session-start hook
    let tldrLines: string[] = [];
    for (const kf of [decisionsPath, pitfallsPath]) {
      try {
        await fs.access(kf);
        const firstLine = (await fs.readFile(kf, 'utf-8')).split('\n')[0];
        if (firstLine.startsWith('<!-- TL;DR:')) {
          tldrLines.push(firstLine.replace('<!-- TL;DR: ', '').replace(' -->', ''));
        }
      } catch {
        // File doesn't exist — skip silently
      }
    }

    expect(tldrLines).toHaveLength(0);
  });

  it('updates TL;DR to reflect new entry count after append', async () => {
    const content = [
      '<!-- TL;DR: 1 pitfall. Key: PF-001 Synthesizer glob -->',
      '# Known Pitfalls',
      '',
      '## PF-001: Synthesizer review glob matched zero files',
      '- **Area**: shared/agents/synthesizer.md',
      '- **Issue**: Glob pattern mismatch',
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), content);

    // Simulate appending a new entry and updating TL;DR
    let fileContent = await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), 'utf-8');
    const newEntry = '\n\n## PF-002: Race condition in background hook\n- **Area**: scripts/hooks/stop-update-memory\n- **Issue**: Concurrent writes to memory file';
    fileContent += newEntry;

    // Update TL;DR
    const matches = [...fileContent.matchAll(/^## PF-(\d+)/gm)];
    const count = matches.length;
    const keys = matches.map(m => `PF-${m[1].padStart(3, '0')}`).join(', ');
    fileContent = fileContent.replace(/^<!-- TL;DR:.*-->/, `<!-- TL;DR: ${count} pitfalls. Key: ${keys} -->`);

    await fs.writeFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), fileContent);

    const updated = await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), 'utf-8');
    const updatedTldr = updated.split('\n')[0];

    expect(updatedTldr).toBe('<!-- TL;DR: 2 pitfalls. Key: PF-001, PF-002 -->');
    expect(updated).toContain('## PF-002');
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
