// tests/decisions/usage-telemetry-removed.test.ts
//
// The decisions usage telemetry is retired. No usage scanner ships with the hooks,
// capture-turn counts no citations, no op registers a usage entry, and `devflow
// init` sweeps the scanner an older install left in the hooks directory. Each test
// asserts the absence through behaviour or through the installed surface, and each
// fails against a tree that still carries the telemetry.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runHook } from '../shell-hooks-helpers.js';
import { ROOT, JSON_HELPER, initGitRepo, makeV2LogRow, runJsonHelper, seedLearningTree } from './learning-fixtures.js';

const requireCjs = createRequire(import.meta.url);

const HOOKS_DIR = path.join(ROOT, 'src/assets/scripts/hooks');
const CAPTURE_TURN = path.join(HOOKS_DIR, 'capture-turn');

/** A usage file in the shape the retired scanner read and wrote, with one registered entry. */
const USAGE_FILE_BYTES = `${JSON.stringify({ version: 1, entries: { 'ADR-001': { cites: 0, last_cited: null } } }, null, 2)}\n`;

function usageFilePath(project: string): string {
  return path.join(project, '.devflow', 'learning', '.decisions-usage.json');
}

describe('the usage scanner is not shipped', () => {
  it('the hooks directory holds no usage scanner', () => {
    const scanners = fs.readdirSync(HOOKS_DIR).filter(name => name.includes('usage'));
    expect(scanners).toEqual([]);
  });

  it('init sweeps the scanner an older install left in the hooks directory', () => {
    const initSource = fs.readFileSync(path.join(ROOT, 'src/cli/commands/init.ts'), 'utf8');
    const legacy = /const LEGACY_HOOK_FILES\s*=\s*\[([\s\S]*?)\];/.exec(initSource);
    expect(legacy, 'LEGACY_HOOK_FILES keeps its literal array shape').not.toBeNull();
    const entries = [...legacy![1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(entries).toContain('decisions-usage-scan.cjs');
  });
});

describe('no hook or op counts citations', { timeout: 30_000 }, () => {
  let project: string;
  let home: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-removed-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-removed-home-'));
    fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('capture-turn queues a turn that names an anchor and leaves the usage file as it was', () => {
    // A git project whose memory and learning trees both exist: the retired scanner
    // ran here, and only when the turn named an anchor the usage file had registered.
    fs.mkdirSync(path.join(project, '.git'));
    fs.mkdirSync(path.join(project, '.devflow', 'memory'), { recursive: true });
    seedLearningTree(project);
    fs.writeFileSync(usageFilePath(project), USAGE_FILE_BYTES);
    const message = 'The renderer keeps v1 bytes, as ADR-001 requires.';

    const run = runHook(CAPTURE_TURN, { cwd: project, session_id: 't', last_assistant_message: message }, home);

    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(usageFilePath(project), 'utf8')).toBe(USAGE_FILE_BYTES);
    // Non-vacuity: the hook ran through to the queue append.
    const queued = fs.readFileSync(path.join(project, '.devflow', 'learning', '.pending-turns.jsonl'), 'utf8');
    expect(queued.trim().split('\n').map(line => JSON.parse(line).content)).toEqual([message]);
  });

  it('assign-anchor promotes an observation and creates no usage file', () => {
    initGitRepo(project);
    seedLearningTree(project, { log: [makeV2LogRow({ id: 'obs_usage_free' })] });

    const run = runJsonHelper(project, ['assign-anchor', 'decision', 'obs_usage_free']);

    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toBe('ADR-001');
    expect(fs.existsSync(usageFilePath(project))).toBe(false);
  });

  it('rotate-observations deletes the usage file and usage lock an older install left', () => {
    seedLearningTree(project);
    const usageLock = path.join(project, '.devflow', 'learning', '.decisions-usage.lock');
    fs.writeFileSync(usageFilePath(project), USAGE_FILE_BYTES);
    fs.mkdirSync(usageLock);

    const run = runJsonHelper(project, ['rotate-observations']);

    expect(run).toEqual({ code: 0, stdout: 'rotated 0 observations\n', stderr: '' });
    expect(fs.existsSync(usageFilePath(project))).toBe(false);
    expect(fs.existsSync(usageLock)).toBe(false);
  });

  it('json-helper exports no usage helper', () => {
    const helper = requireCjs(JSON_HELPER) as Record<string, unknown>;
    expect(Object.keys(helper).filter(name => /usage/i.test(name))).toEqual([]);
  });

  it('project-paths names no usage file or usage lock, in either module', async () => {
    const cjsPaths = requireCjs(path.join(HOOKS_DIR, 'lib/project-paths.cjs')) as Record<string, unknown>;
    const tsPaths = (await import('../../src/core/project-paths.js')) as Record<string, unknown>;
    for (const surface of [cjsPaths, tsPaths]) {
      expect(Object.keys(surface).filter(name => /usage/i.test(name))).toEqual([]);
    }
  });
});
