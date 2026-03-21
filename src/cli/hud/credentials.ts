import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

const KEYCHAIN_TIMEOUT = 3000; // 3s

export interface OAuthCredentials {
  accessToken: string;
  subscriptionType?: string;
}

const DEBUG = !!process.env.DEVFLOW_HUD_DEBUG;

function debugLog(msg: string, data?: Record<string, unknown>): void {
  if (!DEBUG) return;
  const entry = { ts: new Date().toISOString(), source: 'credentials', msg, ...data };
  fs.appendFileSync('/tmp/hud-debug.log', JSON.stringify(entry) + '\n');
}

/** Resolve the Claude config directory, respecting CLAUDE_CONFIG_DIR. */
export function getClaudeDir(): string {
  return (
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || homedir(), '.claude')
  );
}

/** Read OAuth credentials from ~/.claude/.credentials.json. Injectable claudeDir for tests. */
export function readCredentialsFile(claudeDir?: string): OAuthCredentials | null {
  try {
    const dir = claudeDir ?? getClaudeDir();
    const filePath = path.join(dir, '.credentials.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const creds = JSON.parse(raw) as Record<string, unknown>;
    const oauth = creds.claudeAiOauth as Record<string, unknown> | undefined;
    const accessToken = oauth?.accessToken;
    if (typeof accessToken !== 'string' || !accessToken) return null;
    const subscriptionType =
      typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : undefined;
    debugLog('credentials file read', { filePath, hasSubscriptionType: !!subscriptionType });
    return { accessToken, subscriptionType };
  } catch {
    return null;
  }
}

/** Read OAuth token from macOS Keychain. Returns null on non-darwin or failure. */
export function readKeychainToken(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: KEYCHAIN_TIMEOUT },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          debugLog('keychain read failed', { error: err?.message });
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
          const oauth = parsed.claudeAiOauth as Record<string, unknown> | undefined;
          const token = oauth?.accessToken;
          if (typeof token === 'string' && token) {
            debugLog('keychain token found');
            resolve(token);
          } else {
            debugLog('keychain: no accessToken in parsed data');
            resolve(null);
          }
        } catch {
          // Keychain value might be the raw token string
          const trimmed = stdout.trim();
          if (trimmed.length > 20) {
            debugLog('keychain: raw token string');
            resolve(trimmed);
          } else {
            debugLog('keychain: unparseable value');
            resolve(null);
          }
        }
      },
    );
  });
}

/**
 * Get OAuth credentials using platform-appropriate strategy.
 * macOS: Keychain first, then file fallback. Other platforms: file only.
 * Hybrid: if Keychain has token but no subscriptionType, merge from file.
 */
export async function getCredentials(): Promise<OAuthCredentials | null> {
  const fileCreds = readCredentialsFile();

  if (process.platform !== 'darwin') {
    debugLog('non-darwin: file credentials only', { found: !!fileCreds });
    return fileCreds;
  }

  // macOS: try Keychain first
  const keychainToken = await readKeychainToken();
  if (keychainToken) {
    // Merge subscriptionType from file if Keychain doesn't have it
    const subscriptionType = fileCreds?.subscriptionType;
    debugLog('using keychain token', { hasSubscriptionType: !!subscriptionType });
    return { accessToken: keychainToken, subscriptionType };
  }

  // Fallback to file
  debugLog('keychain failed, falling back to file', { found: !!fileCreds });
  return fileCreds;
}
