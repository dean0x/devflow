import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectPlatform, getSafeDeleteSuggestion, type Platform } from '../src/cli/utils/safe-delete.js';

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

describe('getSafeDeleteSuggestion', () => {
  it('returns trash info for macos', () => {
    const info = getSafeDeleteSuggestion('macos');
    expect(info).not.toBeNull();
    expect(info!.command).toBe('trash');
    expect(info!.installHint).toContain('brew');
    expect(info!.aliasHint).toContain('trash');
  });

  it('returns trash-put info for linux', () => {
    const info = getSafeDeleteSuggestion('linux');
    expect(info).not.toBeNull();
    expect(info!.command).toBe('trash-put');
    expect(info!.installHint).toContain('trash-cli');
    expect(info!.aliasHint).toContain('trash-put');
  });

  it('returns null for windows', () => {
    expect(getSafeDeleteSuggestion('windows')).toBeNull();
  });

  it('covers all platform variants', () => {
    const platforms: Platform[] = ['macos', 'linux', 'windows'];
    for (const p of platforms) {
      const result = getSafeDeleteSuggestion(p);
      if (p === 'windows') {
        expect(result).toBeNull();
      } else {
        expect(result).toHaveProperty('command');
        expect(result).toHaveProperty('installHint');
        expect(result).toHaveProperty('aliasHint');
      }
    }
  });
});
