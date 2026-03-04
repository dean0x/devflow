import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateSafeDeleteBlock,
  isAlreadyInstalled,
  installToProfile,
  removeFromProfile,
  getInstalledVersion,
  SAFE_DELETE_BLOCK_VERSION,
} from '../src/cli/utils/safe-delete-install.js';

describe('generateSafeDeleteBlock', () => {
  it('generates bash/zsh block with markers, existence check, and both functions', () => {
    const block = generateSafeDeleteBlock('zsh', 'darwin', 'trash');
    expect(block).not.toBeNull();
    expect(block).toContain('# >>> DevFlow safe-delete >>>');
    expect(block).toContain('# <<< DevFlow safe-delete <<<');
    expect(block).toContain('rm() {');
    expect(block).toContain('command() {');
    expect(block).toContain('[ -e "$f" ] || [ -L "$f" ]');
    expect(block).toContain('existing+=("$f")');
    expect(block).toContain('trash "${existing[@]}"');
  });

  it('generates bash block with trash-put command', () => {
    const block = generateSafeDeleteBlock('bash', 'linux', 'trash-put');
    expect(block).toContain('trash-put "${existing[@]}"');
  });

  it('generates fish block with fish syntax and existence check', () => {
    const block = generateSafeDeleteBlock('fish', 'darwin', 'trash');
    expect(block).not.toBeNull();
    expect(block).toContain('# >>> DevFlow safe-delete >>>');
    expect(block).toContain('function rm --description "Safe delete via trash"');
    expect(block).toContain('test -e $f; or test -L $f');
    expect(block).toContain('set existing $existing $f');
    expect(block).toContain('trash $existing');
    expect(block).not.toContain('command()');
  });

  it('generates PowerShell Windows block with .NET SendToRecycleBin', () => {
    const block = generateSafeDeleteBlock('powershell', 'win32', null);
    expect(block).not.toBeNull();
    expect(block).toContain('Microsoft.VisualBasic');
    expect(block).toContain('SendToRecycleBin');
    expect(block).toContain('Remove-Alias rm');
  });

  it('generates PowerShell macOS/Linux block with trash command and existence check', () => {
    const block = generateSafeDeleteBlock('powershell', 'darwin', 'trash');
    expect(block).not.toBeNull();
    expect(block).toContain('Test-Path $_');
    expect(block).toContain('& trash @existing');
    expect(block).not.toContain('Microsoft.VisualBasic');
  });

  it('generates PowerShell Windows block with Resolve-Path existence check', () => {
    const block = generateSafeDeleteBlock('powershell', 'win32', null);
    expect(block).not.toBeNull();
    expect(block).toContain('Resolve-Path $f -ErrorAction SilentlyContinue');
    expect(block).toContain('Test-Path $p -PathType Container');
  });

  it('returns null for unknown shell', () => {
    expect(generateSafeDeleteBlock('unknown', 'darwin', 'trash')).toBeNull();
  });

  it('includes version stamp in all shell variants', () => {
    const versionLine = `# v${SAFE_DELETE_BLOCK_VERSION}`;
    const variants: Array<[Parameters<typeof generateSafeDeleteBlock>[0], NodeJS.Platform, string | null]> = [
      ['bash', 'linux', 'trash-put'],
      ['zsh', 'darwin', 'trash'],
      ['fish', 'darwin', 'trash'],
      ['powershell', 'win32', null],
      ['powershell', 'darwin', 'trash'],
    ];
    for (const [shell, platform, cmd] of variants) {
      const block = generateSafeDeleteBlock(shell, platform, cmd);
      expect(block, `${shell}/${platform} should include version stamp`).toContain(versionLine);
    }
  });
});

describe('getInstalledVersion', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-delete-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 for missing file', async () => {
    expect(await getInstalledVersion(path.join(tmpDir, 'nonexistent'))).toBe(0);
  });

  it('returns 0 for file without markers', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, 'some unrelated content\n');
    expect(await getInstalledVersion(filePath)).toBe(0);
  });

  it('returns 1 for legacy block without version line', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, [
      '# >>> DevFlow safe-delete >>>',
      'rm() { trash "$@"; }',
      '# <<< DevFlow safe-delete <<<',
    ].join('\n'));
    expect(await getInstalledVersion(filePath)).toBe(1);
  });

  it('returns version number for versioned block', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, [
      '# >>> DevFlow safe-delete >>>',
      '# v2',
      'rm() { trash "$@"; }',
      '# <<< DevFlow safe-delete <<<',
    ].join('\n'));
    expect(await getInstalledVersion(filePath)).toBe(2);
  });
});

describe('isAlreadyInstalled', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-delete-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when both markers present', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, [
      'existing content',
      '# >>> DevFlow safe-delete >>>',
      'rm() { trash "$@"; }',
      '# <<< DevFlow safe-delete <<<',
    ].join('\n'));
    expect(await isAlreadyInstalled(filePath)).toBe(true);
  });

  it('returns false for missing file', async () => {
    expect(await isAlreadyInstalled(path.join(tmpDir, 'nonexistent'))).toBe(false);
  });

  it('returns false for partial markers', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, '# >>> DevFlow safe-delete >>>\nsome content\n');
    expect(await isAlreadyInstalled(filePath)).toBe(false);
  });

  it('returns false for empty file', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, '');
    expect(await isAlreadyInstalled(filePath)).toBe(false);
  });
});

describe('installToProfile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-delete-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('appends to existing file', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, 'existing content\n');
    await installToProfile(filePath, '# block');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('existing content');
    expect(content).toContain('# block');
  });

  it('creates new file when none exists', async () => {
    const filePath = path.join(tmpDir, '.bashrc');
    await installToProfile(filePath, '# block');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('# block\n');
  });

  it('creates parent directories', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'profile');
    await installToProfile(filePath, '# block');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('# block\n');
  });
});

describe('removeFromProfile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-delete-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes block and preserves surrounding content', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, [
      'before content',
      '',
      '# >>> DevFlow safe-delete >>>',
      'rm() { trash "$@"; }',
      '# <<< DevFlow safe-delete <<<',
      '',
      'after content',
    ].join('\n'));

    const removed = await removeFromProfile(filePath);
    expect(removed).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('before content');
    expect(content).toContain('after content');
    expect(content).not.toContain('DevFlow safe-delete');
  });

  it('returns false for missing file', async () => {
    expect(await removeFromProfile(path.join(tmpDir, 'nonexistent'))).toBe(false);
  });

  it('deletes file when block is the only content', async () => {
    const filePath = path.join(tmpDir, 'rm.fish');
    await fs.writeFile(filePath, [
      '# >>> DevFlow safe-delete >>>',
      'function rm; trash $argv; end',
      '# <<< DevFlow safe-delete <<<',
    ].join('\n'));

    const removed = await removeFromProfile(filePath);
    expect(removed).toBe(true);

    // File should be deleted
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('cleans up surrounding newlines', async () => {
    const filePath = path.join(tmpDir, '.zshrc');
    await fs.writeFile(filePath, [
      'content above',
      '',
      '',
      '# >>> DevFlow safe-delete >>>',
      'block',
      '# <<< DevFlow safe-delete <<<',
      '',
      '',
    ].join('\n'));

    await removeFromProfile(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    // Should not have excessive blank lines
    expect(content).toBe('content above\n');
  });
});
