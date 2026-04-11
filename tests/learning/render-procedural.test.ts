// tests/learning/render-procedural.test.ts
// Snapshot tests for rendered procedural skill files (D5).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const JSON_HELPER = path.resolve(__dirname, '../../scripts/hooks/json-helper.cjs');

function runHelper(args: string): string {
  return execSync(`node "${JSON_HELPER}" ${args}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function makeReadyProcedural(id: string, pattern: string, details?: string): object {
  const now = new Date().toISOString();
  return {
    id,
    type: 'procedural',
    pattern,
    confidence: 0.95,
    observations: 4,
    first_seen: new Date(Date.now() - 6 * 86400000).toISOString(),
    last_seen: now,
    status: 'ready',
    evidence: ['when debugging hooks, check lock first', 'to debug hooks, tail the log file'],
    details: details || 'When debugging hook failures: 1. Check .memory/.learning.lock. 2. Tail the log file. 3. Look for stale locks.',
    quality_ok: true,
  };
}

describe('render-ready — procedural type (D5 snapshot tests)', () => {
  let tmpDir: string;
  let logFile: string;
  let skillsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-proc-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    skillsDir = path.join(tmpDir, '.claude', 'skills');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes SKILL.md to self-learning:<slug> directory', () => {
    const obs = makeReadyProcedural('obs_proc001', 'debug hook failures');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    expect(fs.existsSync(skillsDir)).toBe(true);
    const skillDirs = fs.readdirSync(skillsDir);
    expect(skillDirs.length).toBe(1);
    expect(skillDirs[0]).toMatch(/^self-learning:/);
    expect(skillDirs[0]).toContain('debug-hook-failures');

    const skillFile = path.join(skillsDir, skillDirs[0], 'SKILL.md');
    expect(fs.existsSync(skillFile)).toBe(true);
  });

  it('SKILL.md has correct YAML frontmatter', () => {
    const obs = makeReadyProcedural('obs_proc001', 'debug hook failures');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const skillDirs = fs.readdirSync(skillsDir);
    const content = fs.readFileSync(path.join(skillsDir, skillDirs[0], 'SKILL.md'), 'utf8');

    expect(content).toMatch(/^---/);
    expect(content).toContain('name: self-learning:');
    expect(content).toContain('description: "This skill should be used when');
    expect(content).toContain('user-invocable: false');
    expect(content).toContain('allowed-tools: Read, Grep, Glob');
    expect(content).toContain('devflow-learning: auto-generated');
  });

  it('SKILL.md body has Iron Law section with uppercase pattern name', () => {
    const obs = makeReadyProcedural('obs_proc001', 'debug hook failures');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const skillDirs = fs.readdirSync(skillsDir);
    const content = fs.readFileSync(path.join(skillsDir, skillDirs[0], 'SKILL.md'), 'utf8');

    expect(content).toContain('## Iron Law');
    expect(content).toContain('> **DEBUG HOOK FAILURES**');
    expect(content).toContain('## When This Skill Activates');
    expect(content).toContain('## Procedure');
  });

  it('SKILL.md body contains pattern heading and details', () => {
    const obs = makeReadyProcedural('obs_proc001', 'regenerate grammar files');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const skillDirs = fs.readdirSync(skillsDir);
    const content = fs.readFileSync(path.join(skillsDir, skillDirs[0], 'SKILL.md'), 'utf8');

    expect(content).toContain('# regenerate grammar files');
  });

  it('manifest entry has no anchorId for procedural skills', () => {
    const obs = makeReadyProcedural('obs_proc001', 'debug hook failures');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const manifestFile = path.join(tmpDir, '.memory', '.learning-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.entries[0].type).toBe('procedural');
    expect(manifest.entries[0].anchorId).toBeUndefined();
    expect(manifest.entries[0].path).toContain('SKILL.md');
  });

  it('log entry updated to status=created with artifact_path', () => {
    const obs = makeReadyProcedural('obs_proc001', 'debug hook failures');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(updated.status).toBe('created');
    expect(updated.artifact_path).toContain('SKILL.md');
  });
});
