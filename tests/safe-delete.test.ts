import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectPlatform, getSafeDeleteInfo, detectShell, getProfilePath, type Platform, type Shell } from '../src/cli/utils/safe-delete.js';
import * as path from 'path';

describe('detectPlatform', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns macos for darwin', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    expect(detectPlatform()).toBe('macos');
  });

  it('returns windows for win32', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(detectPlatform()).toBe('windows');
  });

  it('returns linux for linux', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    expect(detectPlatform()).toBe('linux');
  });

  it('returns linux for unknown platforms', () => {
    vi.stubGlobal('process', { ...process, platform: 'freebsd' });
    expect(detectPlatform()).toBe('linux');
  });
});

describe('getSafeDeleteInfo', () => {
  it('returns trash info for macos', () => {
    const info = getSafeDeleteInfo('macos');
    expect(info.command).toBe('trash');
    expect(info.installHint).toContain('brew');
  });

  it('returns trash-put info for linux', () => {
    const info = getSafeDeleteInfo('linux');
    expect(info.command).toBe('trash-put');
    expect(info.installHint).toContain('trash-cli');
  });

  it('returns null command and installHint for windows', () => {
    const info = getSafeDeleteInfo('windows');
    expect(info.command).toBeNull();
    expect(info.installHint).toBeNull();
  });

  it('covers all platform variants', () => {
    const platforms: Platform[] = ['macos', 'linux', 'windows'];
    for (const p of platforms) {
      const result = getSafeDeleteInfo(p);
      expect(result).toHaveProperty('command');
      expect(result).toHaveProperty('installHint');
    }
  });
});

describe('detectShell', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns zsh for SHELL=/bin/zsh', () => {
    vi.stubEnv('PSModulePath', '');
    vi.stubEnv('SHELL', '/bin/zsh');
    expect(detectShell()).toBe('zsh');
  });

  it('returns bash for SHELL=/bin/bash', () => {
    vi.stubEnv('PSModulePath', '');
    vi.stubEnv('SHELL', '/bin/bash');
    expect(detectShell()).toBe('bash');
  });

  it('returns fish for SHELL=/usr/bin/fish', () => {
    vi.stubEnv('PSModulePath', '');
    vi.stubEnv('SHELL', '/usr/bin/fish');
    expect(detectShell()).toBe('fish');
  });

  it('returns powershell when PSModulePath is set', () => {
    vi.stubEnv('PSModulePath', '/some/path');
    vi.stubEnv('SHELL', '/bin/zsh');
    expect(detectShell()).toBe('powershell');
  });

  it('returns unknown when SHELL is not set', () => {
    vi.stubEnv('PSModulePath', '');
    vi.stubEnv('SHELL', '');
    expect(detectShell()).toBe('unknown');
  });

  it('returns unknown for unrecognized shell', () => {
    vi.stubEnv('PSModulePath', '');
    vi.stubEnv('SHELL', '/usr/local/bin/tcsh');
    expect(detectShell()).toBe('unknown');
  });
});

describe('getProfilePath', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns ~/.zshrc for zsh', () => {
    vi.stubEnv('HOME', '/home/test');
    const result = getProfilePath('zsh');
    expect(result).toBe(path.join('/home/test', '.zshrc'));
  });

  it('returns ~/.bashrc for bash', () => {
    vi.stubEnv('HOME', '/home/test');
    const result = getProfilePath('bash');
    expect(result).toBe(path.join('/home/test', '.bashrc'));
  });

  it('returns fish functions path for fish', () => {
    vi.stubEnv('HOME', '/home/test');
    const result = getProfilePath('fish');
    expect(result).toBe(path.join('/home/test', '.config', 'fish', 'functions', 'rm.fish'));
  });

  it('returns powershell profile for powershell on unix', () => {
    vi.stubEnv('HOME', '/home/test');
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    const result = getProfilePath('powershell');
    expect(result).toBe(path.join('/home/test', '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'));
  });

  it('returns null for unknown shell', () => {
    expect(getProfilePath('unknown')).toBeNull();
  });
});
