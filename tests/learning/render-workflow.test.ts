// tests/learning/render-workflow.test.ts
// Snapshot tests for rendered workflow command files (D5).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runHelper } from './helpers.js';

function makeReadyWorkflow(id: string, pattern: string, details?: string, evidence?: string[]): object {
  const now = new Date().toISOString();
  return {
    id,
    type: 'workflow',
    pattern,
    confidence: 0.95,
    observations: 3,
    first_seen: new Date(Date.now() - 4 * 86400000).toISOString(),
    last_seen: now,
    status: 'ready',
    evidence: evidence || ['user typed step 1 then step 2', 'user repeated the sequence later'],
    details: details || '1. Run tests\n2. Run typecheck\n3. Commit and push',
    quality_ok: true,
  };
}

describe('render-ready — workflow type (D5 snapshot tests)', () => {
  let tmpDir: string;
  let logFile: string;
  let commandsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-wf-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    commandsDir = path.join(tmpDir, '.claude', 'commands', 'self-learning');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes command file to correct path with kebab-case slug', () => {
    const obs = makeReadyWorkflow('obs_wf001', 'run tests then commit and push');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    expect(fs.existsSync(commandsDir)).toBe(true);
    const files = fs.readdirSync(commandsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.md$/);
    // Slug should be kebab-cased pattern
    expect(files[0]).toContain('run-tests-then-commit-and-push');
  });

  it('rendered file has YAML frontmatter with description and devflow-learning comment', () => {
    const obs = makeReadyWorkflow('obs_wf001', 'run tests then commit');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const files = fs.readdirSync(commandsDir);
    const content = fs.readFileSync(path.join(commandsDir, files[0]), 'utf8');

    expect(content).toMatch(/^---/);
    expect(content).toContain('description:');
    expect(content).toContain('run tests then commit');
    expect(content).toContain('devflow-learning: auto-generated');
    expect(content).toContain('confidence:');
    expect(content).toContain('obs:');
    expect(content).toContain('---');
  });

  it('rendered file body contains pattern heading and evidence section', () => {
    const evidence = ['first user instruction about steps', 'second user instruction confirms'];
    const obs = makeReadyWorkflow('obs_wf001', 'deploy workflow sequence', '1. build\n2. test\n3. deploy', evidence);
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const files = fs.readdirSync(commandsDir);
    const content = fs.readFileSync(path.join(commandsDir, files[0]), 'utf8');

    expect(content).toContain('# deploy workflow sequence');
    expect(content).toContain('## Evidence');
    expect(content).toContain('- first user instruction about steps');
    expect(content).toContain('- second user instruction confirms');
    expect(content).toContain('1. build');
  });

  it('slug is capped at 50 characters', () => {
    const longPattern = 'this is a very long workflow pattern that goes well beyond fifty characters total';
    const obs = makeReadyWorkflow('obs_wf_long', longPattern);
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const files = fs.readdirSync(commandsDir);
    // File name without .md extension should be <= 50 chars
    const slug = files[0].replace('.md', '');
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it('updates manifest with correct type and path', () => {
    const obs = makeReadyWorkflow('obs_wf001', 'build test deploy');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const manifestFile = path.join(tmpDir, '.memory', '.learning-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries[0].type).toBe('workflow');
    expect(manifest.entries[0].path).toContain('.claude/commands/self-learning/');
    expect(manifest.entries[0].anchorId).toBeUndefined(); // workflows don't have anchor IDs
  });

  it('renders multiple workflow observations in one call', () => {
    const obs1 = makeReadyWorkflow('obs_wf001', 'build test deploy');
    const obs2 = makeReadyWorkflow('obs_wf002', 'squash merge and cleanup');
    fs.writeFileSync(logFile, JSON.stringify(obs1) + '\n' + JSON.stringify(obs2) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.rendered).toHaveLength(2);

    const files = fs.readdirSync(commandsDir);
    expect(files.length).toBe(2);
  });
});
