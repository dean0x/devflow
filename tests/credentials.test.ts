import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readCredentialsFile, readKeychainToken, getCredentials, getClaudeDir } from '../src/cli/hud/credentials.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('getClaudeDir', () => {
  const originalEnv = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  });

  it('respects CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/custom/claude';
    expect(getClaudeDir()).toBe('/custom/claude');
  });

  it('falls back to ~/.claude', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const result = getClaudeDir();
    expect(result).toContain('.claude');
  });
});

describe('readCredentialsFile', () => {
  it('returns credentials from valid file', () => {
    const dir = '/tmp/test-creds-' + Date.now();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: { accessToken: 'test-token-123', subscriptionType: 'pro' },
      }),
    );
    const result = readCredentialsFile(dir);
    expect(result).toEqual({ accessToken: 'test-token-123', subscriptionType: 'pro' });
    fs.rmSync(dir, { recursive: true });
  });

  it('returns null for missing file', () => {
    const result = readCredentialsFile('/tmp/nonexistent-' + Date.now());
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const dir = '/tmp/test-creds-bad-' + Date.now();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.credentials.json'), 'not-json');
    const result = readCredentialsFile(dir);
    expect(result).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });

  it('returns null when accessToken is missing', () => {
    const dir = '/tmp/test-creds-notoken-' + Date.now();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { subscriptionType: 'pro' } }),
    );
    const result = readCredentialsFile(dir);
    expect(result).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });

  it('omits subscriptionType when not present', () => {
    const dir = '/tmp/test-creds-nosub-' + Date.now();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }),
    );
    const result = readCredentialsFile(dir);
    expect(result).toEqual({ accessToken: 'tok', subscriptionType: undefined });
    fs.rmSync(dir, { recursive: true });
  });
});

describe('readKeychainToken', () => {
  it('returns null on non-darwin platforms', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const result = await readKeychainToken();
      expect(result).toBeNull();
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    }
  });
});

describe('getCredentials', () => {
  it('returns file credentials on non-darwin', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const dir = '/tmp/test-getcreds-' + Date.now();
    const originalEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'file-token' } }),
    );

    try {
      const result = await getCredentials();
      expect(result).toEqual({ accessToken: 'file-token', subscriptionType: undefined });
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform!);
      if (originalEnv !== undefined) {
        process.env.CLAUDE_CONFIG_DIR = originalEnv;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('returns null when no credentials available on non-darwin', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const originalEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/nonexistent-' + Date.now();

    try {
      const result = await getCredentials();
      expect(result).toBeNull();
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform!);
      if (originalEnv !== undefined) {
        process.env.CLAUDE_CONFIG_DIR = originalEnv;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    }
  });
});
