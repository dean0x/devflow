/**
 * Tests for src/targets/claude-code/behavior-install.ts
 *
 * D-BEHAVIOR-OPT-IN: the behavior rule is feature-owned and installs only when the
 * install includes rules AND `features.behavior` is on. Every other state converges to
 * "the file is absent".
 *
 * All tests use injected tmp dirs — never the real HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { convergeBehaviorRule, convergeBehaviorFromManifest } from '../src/targets/claude-code/behavior-install.js';
import { refusedFolderMessage } from '../src/targets/claude-code/linked-folder.js';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let warnings: string[];

const SOURCE = path.join(import.meta.dirname, '..', 'src', 'assets', 'rules', 'behavior.md');
const ruleFile = (): string => path.join(claudeDir, 'rules', 'devflow', 'behavior.md');
const warn = (msg: string): void => { warnings.push(msg); };
/** A converge that met no link: both lists are empty. */
const NO_LINKS = { replacedLinks: [], refusedFolders: [] };

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-behavior-install-'));
  claudeDir = path.join(tmp, '.claude');
  devflowDir = path.join(tmp, '.devflow');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  warnings = [];
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('convergeBehaviorRule', () => {
  it('on and rules on: installs the rule, byte for byte from the source', async () => {
    const result = await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: true, warn });
    expect(result).toEqual({ installed: true, removed: false, converged: true, ...NO_LINKS });
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));
    expect(warnings).toEqual([]);
  });

  it('on and rules off: installs nothing', async () => {
    const result = await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: false, warn });
    expect(result).toEqual({ installed: false, removed: false, converged: true, ...NO_LINKS });
    expect(await exists(ruleFile())).toBe(false);
  });

  it('on and rules off: removes a copy installed earlier', async () => {
    await fs.mkdir(path.dirname(ruleFile()), { recursive: true });
    await fs.writeFile(ruleFile(), 'stale', 'utf-8');
    const result = await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: false, warn });
    expect(result).toEqual({ installed: false, removed: true, converged: true, ...NO_LINKS });
    expect(await exists(ruleFile())).toBe(false);
  });

  it('off: leaves the file absent on a fresh machine and reports nothing removed', async () => {
    const result = await convergeBehaviorRule({ claudeDir, devflowDir, enabled: false, rulesEnabled: true, warn });
    expect(result).toEqual({ installed: false, removed: false, converged: true, ...NO_LINKS });
    expect(await exists(ruleFile())).toBe(false);
  });

  it('off: removes a copy installed earlier and keeps the other rules', async () => {
    await fs.mkdir(path.dirname(ruleFile()), { recursive: true });
    await fs.writeFile(ruleFile(), 'old copy', 'utf-8');
    const other = path.join(path.dirname(ruleFile()), 'security.md');
    await fs.writeFile(other, 'keep me', 'utf-8');
    const result = await convergeBehaviorRule({ claudeDir, devflowDir, enabled: false, rulesEnabled: true, warn });
    expect(result).toEqual({ installed: false, removed: true, converged: true, ...NO_LINKS });
    expect(await exists(ruleFile())).toBe(false);
    expect(await fs.readFile(other, 'utf-8')).toBe('keep me');
  });

  it('replaces an out-of-date copy with the source (drift is converged)', async () => {
    await fs.mkdir(path.dirname(ruleFile()), { recursive: true });
    await fs.writeFile(ruleFile(), 'drifted', 'utf-8');
    await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: true, warn });
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));
  });

  it('is idempotent: a second run changes nothing', async () => {
    await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: true, warn });
    const first = await fs.readFile(ruleFile(), 'utf-8');
    const again = await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: true, warn });
    expect(again).toEqual({ installed: true, removed: false, converged: true, ...NO_LINKS });
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(first);
  });

  it('honours a valid shadow at ~/.devflow/rules/behavior.md', async () => {
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'behavior.md'), '---\npaths: []\n---\n# Mine\n', 'utf-8');
    await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: true, warn });
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe('---\npaths: []\n---\n# Mine\n');
  });

  it('ignores a shadow when the switch is off: the file stays absent', async () => {
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'behavior.md'), '# Mine\n', 'utf-8');
    await convergeBehaviorRule({ claudeDir, devflowDir, enabled: false, rulesEnabled: true, warn });
    expect(await exists(ruleFile())).toBe(false);
  });

  it('falls back to the source for an empty shadow', async () => {
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'behavior.md'), '', 'utf-8');
    await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: true, warn });
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));
  });

  it('warns and reports not converged for a relative claudeDir, and writes nothing', async () => {
    const result = await convergeBehaviorRule({ claudeDir: 'relative/dir', devflowDir, enabled: true, rulesEnabled: true, warn });
    expect(result).toEqual({ installed: false, removed: false, converged: false, ...NO_LINKS });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not an absolute path/);
  });

  it('warns instead of throwing when the rule cannot be written', async () => {
    // A file where the rules directory belongs makes the install fail.
    await fs.writeFile(path.join(claudeDir, 'rules'), 'not a directory', 'utf-8');
    const result = await convergeBehaviorRule({ claudeDir, devflowDir, enabled: true, rulesEnabled: true, warn });
    const folder = path.join(claudeDir, 'rules', 'devflow');
    expect(result.installed).toBe(false);
    expect(result.converged).toBe(false);
    expect(result.refusedFolders, 'the folder that is not a folder is refused and named').toEqual([folder]);
    expect(warnings).toEqual([refusedFolderMessage(folder)]);
  });
});

describe('convergeBehaviorFromManifest', () => {
  it('reads the switch and the rules flag from the manifest slice', async () => {
    const result = await convergeBehaviorFromManifest({
      claudeDir,
      devflowDir,
      manifest: { features: { behavior: true, rules: true } },
      warn,
    });
    expect(result.installed).toBe(true);
    expect(await exists(ruleFile())).toBe(true);
  });

  it('installs nothing when the manifest has rules off', async () => {
    const result = await convergeBehaviorFromManifest({
      claudeDir,
      devflowDir,
      manifest: { features: { behavior: true, rules: false } },
      warn,
    });
    expect(result.installed).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
  });

  it('lets rulesEnabledOverride replace the rules flag', async () => {
    const result = await convergeBehaviorFromManifest({
      claudeDir,
      devflowDir,
      manifest: { features: { behavior: true, rules: true } },
      warn,
      rulesEnabledOverride: false,
    });
    expect(result.installed).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
  });
});
