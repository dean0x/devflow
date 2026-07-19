// tests/hud-config-counts.test.ts
// Tests for gatherConfigCounts — the function that reads .claude/rules directories
// and produces the data fed to the configCounts HUD component.
// Validates recursive rule discovery, cross-dir aggregation, graceful fallback,
// and file-exact counting (subdirectories with .md/.mdc names must not be counted).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { gatherConfigCounts } from '../src/hud/components/config-counts.js';

describe('gatherConfigCounts', () => {
  let tmpCwd: string;
  let tmpClaudeDir: string;
  let originalClaudeConfigDir: string | undefined;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-config-counts-cwd-'));
    tmpClaudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-config-counts-claude-'));
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tmpClaudeDir;
  });

  afterEach(() => {
    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    }
    fs.rmSync(tmpCwd, { recursive: true, force: true });
    fs.rmSync(tmpClaudeDir, { recursive: true, force: true });
  });

  it('counts nested rules across project and user dirs', () => {
    // Project dir: .claude/rules/devflow/a.md + .claude/rules/top.mdc
    fs.mkdirSync(path.join(tmpCwd, '.claude', 'rules', 'devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpCwd, '.claude', 'rules', 'devflow', 'a.md'), '# Rule A');
    fs.writeFileSync(path.join(tmpCwd, '.claude', 'rules', 'top.mdc'), '# Top Rule');

    // User (claudeDir) dir: rules/devflow/b.md
    fs.mkdirSync(path.join(tmpClaudeDir, 'rules', 'devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpClaudeDir, 'rules', 'devflow', 'b.md'), '# Rule B');

    const result = gatherConfigCounts(tmpCwd);
    // devflow/a.md + top.mdc (project) + devflow/b.md (user) = 3
    expect(result.rules).toBe(3);
  });

  it('ignores non-.md/.mdc files and handles missing dirs gracefully', () => {
    // Project rules dir exists but only has a .txt file
    fs.mkdirSync(path.join(tmpCwd, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmpCwd, '.claude', 'rules', 'ignore.txt'), 'not a rule');

    // User rules dir does not exist at all

    const result = gatherConfigCounts(tmpCwd);
    expect(result.rules).toBe(0);
  });

  it('does not count a subdirectory whose name ends in .md or .mdc', () => {
    // A directory literally named "weird.md" must not be counted as a rule file.
    // This was a bug with the old encoding:'utf-8' approach (which returned path
    // strings for all entries including dirs). The fixed withFileTypes:true
    // approach uses d.isFile() to exclude directories.
    fs.mkdirSync(path.join(tmpCwd, '.claude', 'rules', 'weird.md'), { recursive: true });
    fs.writeFileSync(path.join(tmpCwd, '.claude', 'rules', 'real-rule.md'), '# Real Rule');

    const result = gatherConfigCounts(tmpCwd);
    // Only the real file should count — the directory named 'weird.md' must not
    expect(result.rules).toBe(1);
  });
});
