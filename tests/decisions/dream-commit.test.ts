// tests/decisions/dream-commit.test.ts
//
// Tests for the scripts/hooks/dream-commit shell plumbing helper.
//
// AC-A9: dream-commit produces commits matching the documented format/trailer
//        touching only allowed paths.
// AC-F10: Dream maintenance is auto-committed in the documented format, scoped
//         to .devflow maintenance paths, never bundling user code; skipped safely
//         during rebase/merge/detached-HEAD and when clean.
//
// Also covers SKILL wiring assertions: dream-decisions, dream-curation,
// dream-knowledge all reference dream-commit with the correct invocation pattern.

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DREAM_COMMIT_BIN = path.join(ROOT, 'scripts/hooks/dream-commit');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initGitRepo(dir: string, withInitialCommit = true): void {
  // Init with deterministic author to avoid system config dependency
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@devflow.test"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  if (withInitialCommit) {
    // Need at least one commit so HEAD is valid and staging works
    fs.writeFileSync(path.join(dir, 'README.md'), 'test\n', 'utf8');
    execSync('git add README.md', { cwd: dir });
    execSync('git commit -m "initial commit"', { cwd: dir });
  }
}

function writeDevflowFiles(dir: string): void {
  const decisionsDir = path.join(dir, '.devflow', 'decisions');
  fs.mkdirSync(decisionsDir, { recursive: true });
  fs.writeFileSync(path.join(decisionsDir, 'decisions-ledger.jsonl'), '{"anchor_id":"ADR-001"}\n', 'utf8');
  fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '# Decisions\n', 'utf8');
  fs.writeFileSync(path.join(decisionsDir, 'pitfalls.md'), '# Pitfalls\n', 'utf8');
}

function writeKnowledgeFiles(dir: string, slug = 'test-feature'): void {
  const featuresDir = path.join(dir, '.devflow', 'features');
  fs.mkdirSync(path.join(featuresDir, slug), { recursive: true });
  fs.writeFileSync(path.join(featuresDir, 'index.json'), '{"test-feature":{}}\n', 'utf8');
  fs.writeFileSync(path.join(featuresDir, slug, 'KNOWLEDGE.md'), '# Knowledge\n', 'utf8');
}

function writeDreamConfig(dir: string, config: Record<string, unknown>): void {
  const dreamDir = path.join(dir, '.devflow', 'dream');
  fs.mkdirSync(dreamDir, { recursive: true });
  fs.writeFileSync(path.join(dreamDir, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function runCommit(
  args: string,
  cwd: string,
  env?: Record<string, string>,
): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`bash "${DREAM_COMMIT_BIN}" ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(env ?? {}) },
    });
    return { stdout, stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number; stderr?: string };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: err.status ?? 1,
    };
  }
}

/** Get git log from a repo */
function getGitLog(dir: string, format: string = '%s'): string {
  try {
    return execSync(`git log --format="${format}"`, {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

/** Get staged files (relative paths) */
function getStagedFiles(dir: string): string[] {
  try {
    const out = execSync('git diff --cached --name-only', {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    return out ? out.split('\n') : [];
  } catch {
    return [];
  }
}

/** Count total commits */
function countCommits(dir: string): number {
  try {
    return parseInt(execSync('git rev-list --count HEAD', {
      cwd: dir,
      encoding: 'utf8',
    }).trim(), 10);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-commit-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Format: subject + trailers
// ---------------------------------------------------------------------------

describe('commit format', () => {
  it('creates a commit with chore(dream): subject prefix', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    const result = runCommit('decisions "add ADR-001" session123', tmpDir);
    expect(result.code).toBe(0);

    const subject = getGitLog(tmpDir, '%s');
    expect(subject.split('\n')[0]).toBe('chore(dream): add ADR-001');
  });

  it('body contains Dream-Task: decisions trailer', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('decisions "add ADR-001" session123', tmpDir);

    const body = getGitLog(tmpDir, '%b');
    expect(body).toContain('Dream-Task: decisions');
  });

  it('body contains Dream-Session: trailer with provided session id', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('decisions "add ADR-001" session123', tmpDir);

    const body = getGitLog(tmpDir, '%b');
    expect(body).toContain('Dream-Session: session123');
  });

  it('body contains Co-Authored-By trailer', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('decisions "add ADR-001" session123', tmpDir);

    const body = getGitLog(tmpDir, '%b');
    expect(body).toContain('Co-Authored-By: Devflow Dream <dream@devflow.local>');
  });

  it('session_id defaults to unknown when omitted', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('decisions "add ADR-001"', tmpDir);

    const body = getGitLog(tmpDir, '%b');
    expect(body).toContain('Dream-Session: unknown');
  });

  it('curation task produces Dream-Task: curation', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('curation "retire 2 stale entries" sess456', tmpDir);

    const subject = getGitLog(tmpDir, '%s');
    const body = getGitLog(tmpDir, '%b');
    expect(subject.split('\n')[0]).toBe('chore(dream): retire 2 stale entries');
    expect(body).toContain('Dream-Task: curation');
  });

  it('knowledge task produces Dream-Task: knowledge', () => {
    initGitRepo(tmpDir);
    writeKnowledgeFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('knowledge "refresh cli-rules knowledge" sess789', tmpDir);

    const subject = getGitLog(tmpDir, '%s');
    const body = getGitLog(tmpDir, '%b');
    expect(subject.split('\n')[0]).toBe('chore(dream): refresh cli-rules knowledge');
    expect(body).toContain('Dream-Task: knowledge');
  });

  it('commit is greppable via git log --grep chore(dream)', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('decisions "add ADR-019" sessXYZ', tmpDir);

    const grepResult = execSync("git log --grep='chore(dream)' --oneline", {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim();
    expect(grepResult).toContain('chore(dream): add ADR-019');
  });

  it('commit is greppable via git log --grep Dream-Task:', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });

    runCommit('decisions "add ADR-019" sessXYZ', tmpDir);

    const grepResult = execSync("git log --grep='Dream-Task:' --oneline", {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim();
    expect(grepResult).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// Path scope: only allowed .devflow paths staged; user files never staged
// ---------------------------------------------------------------------------

describe('path scope', () => {
  it('stages decisions-ledger.jsonl for decisions task', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);

    runCommit('decisions "add ADR-001" s1', tmpDir);

    const committedFiles = execSync('git show --name-only --format="" HEAD', {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);

    const committedRelative = committedFiles.map(f => f.replace(/\\/g, '/'));
    const expectedPaths = [
      '.devflow/decisions/decisions-ledger.jsonl',
      '.devflow/decisions/decisions.md',
      '.devflow/decisions/pitfalls.md',
    ];
    for (const p of expectedPaths) {
      expect(committedRelative.some(f => f.endsWith(p.split('/').slice(-1)[0]) || f.includes(p))).toBe(true);
    }
  });

  it('does NOT stage a dirty user file in the same repo', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    // Write a dirty user file (tracked but modified)
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'user dirty content\n', 'utf8');

    runCommit('decisions "add ADR-001" s1', tmpDir);

    // README.md should NOT be in the commit
    const committedFiles = execSync('git show --name-only --format="" HEAD', {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);

    expect(committedFiles.some(f => f.includes('README.md'))).toBe(false);
    // And it should still be dirty (unstaged)
    const status = execSync('git status --porcelain', { cwd: tmpDir, encoding: 'utf8' }).trim();
    expect(status).toContain('README.md');
  });

  it('does NOT stage decisions-log.jsonl (gitignored observation lifecycle log)', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    // Write decisions-log.jsonl (should NOT be committed)
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.writeFileSync(path.join(decisionsDir, 'decisions-log.jsonl'), '{"status":"observing"}\n', 'utf8');

    runCommit('decisions "add ADR-001" s1', tmpDir);

    const committedFiles = execSync('git show --name-only --format="" HEAD', {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);

    expect(committedFiles.some(f => f.includes('decisions-log.jsonl'))).toBe(false);
  });

  it('stages KNOWLEDGE.md files for knowledge task', () => {
    initGitRepo(tmpDir);
    writeKnowledgeFiles(tmpDir);

    runCommit('knowledge "refresh test-feature knowledge" s1', tmpDir);

    const committedFiles = execSync('git show --name-only --format="" HEAD', {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);

    expect(committedFiles.some(f => f.includes('KNOWLEDGE.md'))).toBe(true);
    expect(committedFiles.some(f => f.includes('index.json'))).toBe(true);
  });

  it('does NOT stage KNOWLEDGE.md for decisions task', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    writeKnowledgeFiles(tmpDir);

    // Only run decisions task — KNOWLEDGE.md should not be staged
    runCommit('decisions "add ADR-001" s1', tmpDir);

    const committedFiles = execSync('git show --name-only --format="" HEAD', {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);

    expect(committedFiles.some(f => f.includes('KNOWLEDGE.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No-op when clean
// ---------------------------------------------------------------------------

describe('no-op when clean', () => {
  it('exits 0 without creating a commit when nothing staged', () => {
    initGitRepo(tmpDir);
    // No .devflow files — nothing to stage

    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });

  it('exits 0 without creating a commit when .devflow files already committed (clean)', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    execSync('git add .devflow/', { cwd: tmpDir });
    execSync('git commit -m "add devflow files"', { cwd: tmpDir });

    // Run commit again — no new changes, nothing to stage
    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Skip during rebase / merge / detached HEAD
// ---------------------------------------------------------------------------

describe('safety rails', () => {
  it('skips cleanly when MERGE_HEAD exists', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);

    // Simulate mid-merge by creating MERGE_HEAD state file
    const gitDir = execSync('git rev-parse --git-dir', { cwd: tmpDir, encoding: 'utf8' }).trim();
    const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(tmpDir, gitDir);
    fs.writeFileSync(path.join(absGitDir, 'MERGE_HEAD'), 'fakehash\n', 'utf8');

    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });

  it('skips cleanly when CHERRY_PICK_HEAD exists', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);

    const gitDir = execSync('git rev-parse --git-dir', { cwd: tmpDir, encoding: 'utf8' }).trim();
    const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(tmpDir, gitDir);
    fs.writeFileSync(path.join(absGitDir, 'CHERRY_PICK_HEAD'), 'fakehash\n', 'utf8');

    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });

  it('skips cleanly when rebase-merge directory exists', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);

    const gitDir = execSync('git rev-parse --git-dir', { cwd: tmpDir, encoding: 'utf8' }).trim();
    const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(tmpDir, gitDir);
    fs.mkdirSync(path.join(absGitDir, 'rebase-merge'), { recursive: true });

    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });

  it('skips cleanly when rebase-apply directory exists', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);

    const gitDir = execSync('git rev-parse --git-dir', { cwd: tmpDir, encoding: 'utf8' }).trim();
    const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(tmpDir, gitDir);
    fs.mkdirSync(path.join(absGitDir, 'rebase-apply'), { recursive: true });

    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });

  it('skips cleanly when HEAD is detached', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    // Add a second commit so we can detach
    fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'v2\n', 'utf8');
    execSync('git add file2.txt', { cwd: tmpDir });
    execSync('git commit -m "second commit"', { cwd: tmpDir });
    // Detach HEAD by checking out a specific commit
    const sha = execSync('git rev-parse HEAD~1', { cwd: tmpDir, encoding: 'utf8' }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: tmpDir });

    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Config gate: autoCommit OFF disables commits
// ---------------------------------------------------------------------------

describe('config gate', () => {
  it('skips commit when autoCommit is false in dream config', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    writeDreamConfig(tmpDir, { memory: true, decisions: true, knowledge: true, autoCommit: false });

    const before = countCommits(tmpDir);
    const result = runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(result.code).toBe(0);
    expect(countCommits(tmpDir)).toBe(before);
  });

  it('commits when autoCommit is true in dream config', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    writeDreamConfig(tmpDir, { memory: true, decisions: true, knowledge: true, autoCommit: true });

    const before = countCommits(tmpDir);
    runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(countCommits(tmpDir)).toBeGreaterThan(before);
  });

  it('commits when autoCommit key is absent in dream config (defaults ON)', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    // Config without autoCommit key
    writeDreamConfig(tmpDir, { memory: true, decisions: true, knowledge: true });

    const before = countCommits(tmpDir);
    runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(countCommits(tmpDir)).toBeGreaterThan(before);
  });

  it('commits when no dream config file exists (defaults ON)', () => {
    initGitRepo(tmpDir);
    writeDevflowFiles(tmpDir);
    // No dream config file at all

    const before = countCommits(tmpDir);
    runCommit('decisions "add ADR-001" s1', tmpDir);

    expect(countCommits(tmpDir)).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

describe('argument validation', () => {
  it('exits 1 when task argument is missing', () => {
    initGitRepo(tmpDir);
    const result = runCommit('', tmpDir);
    expect(result.code).toBe(1);
  });

  it('exits 1 when action argument is missing', () => {
    initGitRepo(tmpDir);
    const result = runCommit('decisions', tmpDir);
    expect(result.code).toBe(1);
  });

  it('exits 1 for unknown task', () => {
    initGitRepo(tmpDir);
    const result = runCommit('unknown "some action"', tmpDir);
    expect(result.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SKILL wiring assertions — dream-decisions, dream-curation, dream-knowledge
// must all reference dream-commit with the correct invocation pattern.
// ---------------------------------------------------------------------------

describe('SKILL wiring: dream-decisions calls dream-commit after assign-anchor', () => {
  const SKILL_PATH = path.join(ROOT, 'shared/skills/dream-decisions/SKILL.md');
  let skillContent: string;

  beforeAll(() => {
    skillContent = fs.readFileSync(SKILL_PATH, 'utf8');
  });

  it('references dream-commit helper', () => {
    expect(skillContent).toContain('dream-commit');
  });

  it('uses decisions task in the invocation', () => {
    expect(skillContent).toContain('dream-commit" decisions');
  });

  it('includes "add <anchor_id>" pattern in the invocation', () => {
    expect(skillContent).toContain('add <anchor_id>');
  });

  it('instructs to run AFTER the lock is released', () => {
    expect(skillContent).toMatch(/after.*lock.*released|lock is released/i);
  });

  it('documents that it is best-effort (exits 0 silently)', () => {
    expect(skillContent).toMatch(/best.effort|exits 0/i);
  });

  it('invokes the INSTALLED helper at $HOME/.devflow/scripts/hooks/dream-commit', () => {
    expect(skillContent).toContain('$HOME/.devflow/scripts/hooks/dream-commit');
  });
});

describe('SKILL wiring: dream-curation calls dream-commit after retire-anchor', () => {
  const SKILL_PATH = path.join(ROOT, 'shared/skills/dream-curation/SKILL.md');
  let skillContent: string;

  beforeAll(() => {
    skillContent = fs.readFileSync(SKILL_PATH, 'utf8');
  });

  it('references dream-commit helper', () => {
    expect(skillContent).toContain('dream-commit');
  });

  it('uses curation task in the invocation', () => {
    expect(skillContent).toContain('dream-commit" curation');
  });

  it('instructs to run AFTER all retire-anchor calls complete', () => {
    expect(skillContent).toMatch(/after all.*retire-anchor|retire-anchor.*calls complete/i);
  });

  it('documents that it is best-effort', () => {
    expect(skillContent).toMatch(/best.effort|exits 0/i);
  });

  it('invokes the INSTALLED helper at $HOME/.devflow/scripts/hooks/dream-commit', () => {
    expect(skillContent).toContain('$HOME/.devflow/scripts/hooks/dream-commit');
  });
});

describe('SKILL wiring: dream-knowledge calls dream-commit after slug refresh', () => {
  const SKILL_PATH = path.join(ROOT, 'shared/skills/dream-knowledge/SKILL.md');
  let skillContent: string;

  beforeAll(() => {
    skillContent = fs.readFileSync(SKILL_PATH, 'utf8');
  });

  it('references dream-commit helper', () => {
    expect(skillContent).toContain('dream-commit');
  });

  it('uses knowledge task in the invocation', () => {
    expect(skillContent).toContain('dream-commit" knowledge');
  });

  it('includes "refresh <slug> knowledge" pattern', () => {
    expect(skillContent).toContain('refresh <slug> knowledge');
  });

  it('documents that it is best-effort', () => {
    expect(skillContent).toMatch(/best.effort|exits 0/i);
  });

  it('invokes the INSTALLED helper at $HOME/.devflow/scripts/hooks/dream-commit', () => {
    expect(skillContent).toContain('$HOME/.devflow/scripts/hooks/dream-commit');
  });
});

// ---------------------------------------------------------------------------
// DreamConfig interface: autoCommit key present with default ON
// ---------------------------------------------------------------------------

describe('DreamConfig autoCommit key', () => {
  it('dream-config.ts DreamConfig interface includes autoCommit boolean', () => {
    const dreamConfigPath = path.join(ROOT, 'src/cli/utils/dream-config.ts');
    const content = fs.readFileSync(dreamConfigPath, 'utf8');
    expect(content).toContain('autoCommit: boolean');
  });

  it('DEFAULT_CONFIG has autoCommit: true', () => {
    const dreamConfigPath = path.join(ROOT, 'src/cli/utils/dream-config.ts');
    const content = fs.readFileSync(dreamConfigPath, 'utf8');
    // Find the DEFAULT_CONFIG block and verify autoCommit is true
    expect(content).toMatch(/autoCommit:\s*true/);
  });

  it('coerceConfig reads autoCommit with boolean typeof guard', () => {
    const dreamConfigPath = path.join(ROOT, 'src/cli/utils/dream-config.ts');
    const content = fs.readFileSync(dreamConfigPath, 'utf8');
    expect(content).toContain("typeof p.autoCommit === 'boolean'");
  });
});

// ---------------------------------------------------------------------------
// decisions --status reports auto-commit state
// ---------------------------------------------------------------------------

describe('decisions --status auto-commit reporting', () => {
  it('decisions.ts --status imports readConfig from dream-config', () => {
    const decisionsPath = path.join(ROOT, 'src/cli/commands/decisions.ts');
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toContain('readConfig');
    expect(content).toContain('dream-config');
  });

  it('decisions.ts --status includes Auto-commit line in status output', () => {
    const decisionsPath = path.join(ROOT, 'src/cli/commands/decisions.ts');
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toContain('Auto-commit:');
    // Verify it uses the dreamConfig value
    expect(content).toContain('dreamConfig.autoCommit');
  });

  it('decisions.ts --status shows ON/OFF for auto-commit', () => {
    const decisionsPath = path.join(ROOT, 'src/cli/commands/decisions.ts');
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toMatch(/autoCommit.*'ON'.*'OFF'|'ON'.*'OFF'.*autoCommit/);
  });
});
