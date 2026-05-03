import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  MIGRATIONS,
  type PerProjectMigrationContext,
} from '../../src/cli/utils/migrations.js';

describe('rename-knowledge-to-decisions migration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rename-mig-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const renameMigration = MIGRATIONS.find(m => m.id === 'rename-knowledge-to-decisions')!;

  function makeCtx(projectRoot: string): PerProjectMigrationContext {
    return {
      scope: 'per-project',
      devflowDir: path.join(tmpDir, 'home', '.devflow'),
      memoryDir: path.join(projectRoot, '.memory'),
      projectRoot,
    };
  }

  it('is registered in MIGRATIONS array', () => {
    expect(renameMigration).toBeDefined();
    expect(renameMigration.id).toBe('rename-knowledge-to-decisions');
    expect(renameMigration.scope).toBe('per-project');
  });

  it('no-ops on fresh project with no .memory/knowledge/', async () => {
    const projectRoot = path.join(tmpDir, 'fresh-project');
    await fs.mkdir(path.join(projectRoot, '.memory'), { recursive: true });

    const result = await renameMigration.run(makeCtx(projectRoot));

    expect(result).toEqual({ infos: [], warnings: [] });
  });

  it('renames .memory/knowledge/ to .memory/decisions/', async () => {
    const projectRoot = path.join(tmpDir, 'rename-project');
    const knowledgeDir = path.join(projectRoot, '.memory', 'knowledge');
    await fs.mkdir(knowledgeDir, { recursive: true });
    await fs.writeFile(path.join(knowledgeDir, 'decisions.md'), '## ADR-001: Test\n', 'utf-8');
    await fs.writeFile(path.join(knowledgeDir, 'pitfalls.md'), '## PF-001: Test\n', 'utf-8');

    const result = await renameMigration.run(makeCtx(projectRoot));

    expect(result!.infos).toContain('Renamed .memory/knowledge/ to .memory/decisions/');
    const newDir = path.join(projectRoot, '.memory', 'decisions');
    const decisions = await fs.readFile(path.join(newDir, 'decisions.md'), 'utf-8');
    expect(decisions).toBe('## ADR-001: Test\n');
    const pitfalls = await fs.readFile(path.join(newDir, 'pitfalls.md'), 'utf-8');
    expect(pitfalls).toBe('## PF-001: Test\n');
    await expect(fs.stat(knowledgeDir)).rejects.toThrow();
  });

  it('renames .knowledge.lock to .decisions.lock', async () => {
    const projectRoot = path.join(tmpDir, 'lock-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });
    await fs.mkdir(path.join(memoryDir, '.knowledge.lock'), { recursive: true });

    await renameMigration.run(makeCtx(projectRoot));

    await expect(fs.stat(path.join(memoryDir, '.decisions.lock'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(memoryDir, '.knowledge.lock'))).rejects.toThrow();
  });

  it('renames .knowledge-usage.json to .decisions-usage.json', async () => {
    const projectRoot = path.join(tmpDir, 'usage-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });
    await fs.writeFile(path.join(memoryDir, '.knowledge-usage.json'), '{}', 'utf-8');

    await renameMigration.run(makeCtx(projectRoot));

    const content = await fs.readFile(path.join(memoryDir, '.decisions-usage.json'), 'utf-8');
    expect(content).toBe('{}');
    await expect(fs.stat(path.join(memoryDir, '.knowledge-usage.json'))).rejects.toThrow();
  });

  it('updates manifest paths from .memory/knowledge/ to .memory/decisions/', async () => {
    const projectRoot = path.join(tmpDir, 'manifest-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });

    const manifest = {
      entries: {
        'ADR-001': { path: '/project/.memory/knowledge/decisions.md', confidence: 1.0 },
        'PF-001': { path: '/project/.memory/knowledge/pitfalls.md', confidence: 0.8 },
      },
    };
    await fs.writeFile(
      path.join(memoryDir, '.learning-manifest.json'),
      JSON.stringify(manifest),
      'utf-8',
    );

    await renameMigration.run(makeCtx(projectRoot));

    const updated = JSON.parse(
      await fs.readFile(path.join(memoryDir, '.learning-manifest.json'), 'utf-8'),
    );
    expect(updated.entries['ADR-001'].path).toBe('/project/.memory/decisions/decisions.md');
    expect(updated.entries['PF-001'].path).toBe('/project/.memory/decisions/pitfalls.md');
  });

  it('updates learning log artifact_path from .memory/knowledge/ to .memory/decisions/', async () => {
    const projectRoot = path.join(tmpDir, 'log-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });

    const logLines = [
      JSON.stringify({ id: 'obs-1', status: 'created', artifact_path: '.memory/knowledge/decisions.md#ADR-001' }),
      JSON.stringify({ id: 'obs-2', status: 'observing', pattern: 'test' }),
      JSON.stringify({ id: 'obs-3', status: 'created', artifact_path: '.memory/knowledge/pitfalls.md#PF-001' }),
    ];
    await fs.writeFile(
      path.join(memoryDir, 'learning-log.jsonl'),
      logLines.join('\n') + '\n',
      'utf-8',
    );

    await renameMigration.run(makeCtx(projectRoot));

    const raw = await fs.readFile(path.join(memoryDir, 'learning-log.jsonl'), 'utf-8');
    const entries = raw.trim().split('\n').map(l => JSON.parse(l));
    expect(entries[0].artifact_path).toBe('.memory/decisions/decisions.md#ADR-001');
    expect(entries[1].artifact_path).toBeUndefined();
    expect(entries[2].artifact_path).toBe('.memory/decisions/pitfalls.md#PF-001');
  });

  it('is idempotent — second run is a no-op', async () => {
    const projectRoot = path.join(tmpDir, 'idem-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });
    await fs.writeFile(path.join(memoryDir, 'knowledge', 'decisions.md'), 'test', 'utf-8');

    await renameMigration.run(makeCtx(projectRoot));
    const result2 = await renameMigration.run(makeCtx(projectRoot));

    expect(result2!.infos).toEqual([]);
    expect(result2!.warnings).toEqual([]);
    const content = await fs.readFile(path.join(memoryDir, 'decisions', 'decisions.md'), 'utf-8');
    expect(content).toBe('test');
  });

  it('handles partial state — .memory/decisions/ exists but manifest has old paths', async () => {
    const projectRoot = path.join(tmpDir, 'partial-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'decisions'), { recursive: true });
    await fs.writeFile(path.join(memoryDir, 'decisions', 'decisions.md'), 'test', 'utf-8');

    const manifest = {
      entries: {
        'ADR-001': { path: '/project/.memory/knowledge/decisions.md', confidence: 1.0 },
      },
    };
    await fs.writeFile(
      path.join(memoryDir, '.learning-manifest.json'),
      JSON.stringify(manifest),
      'utf-8',
    );

    await renameMigration.run(makeCtx(projectRoot));

    const updated = JSON.parse(
      await fs.readFile(path.join(memoryDir, '.learning-manifest.json'), 'utf-8'),
    );
    expect(updated.entries['ADR-001'].path).toBe('/project/.memory/decisions/decisions.md');
  });

  it('handles empty manifest without error', async () => {
    const projectRoot = path.join(tmpDir, 'empty-manifest-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });
    await fs.writeFile(path.join(memoryDir, '.learning-manifest.json'), '{}', 'utf-8');

    const result = await renameMigration.run(makeCtx(projectRoot));

    expect(result!.warnings).toEqual([]);
    const content = await fs.readFile(path.join(memoryDir, '.learning-manifest.json'), 'utf-8');
    expect(content).toBe('{}');
  });

  it('only updates knowledge paths — leaves non-knowledge artifact_paths untouched', async () => {
    const projectRoot = path.join(tmpDir, 'mixed-project');
    const memoryDir = path.join(projectRoot, '.memory');
    await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });

    const manifest = {
      entries: {
        'ADR-001': { path: '/project/.memory/knowledge/decisions.md', confidence: 1.0 },
        'cmd-1': { path: '/project/.claude/commands/self-learning/foo.md', confidence: 0.9 },
      },
    };
    await fs.writeFile(
      path.join(memoryDir, '.learning-manifest.json'),
      JSON.stringify(manifest),
      'utf-8',
    );

    await renameMigration.run(makeCtx(projectRoot));

    const updated = JSON.parse(
      await fs.readFile(path.join(memoryDir, '.learning-manifest.json'), 'utf-8'),
    );
    expect(updated.entries['ADR-001'].path).toBe('/project/.memory/decisions/decisions.md');
    expect(updated.entries['cmd-1'].path).toBe('/project/.claude/commands/self-learning/foo.md');
  });
});
