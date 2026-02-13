import { execSync } from 'child_process';

export type Platform = 'macos' | 'linux' | 'windows';

export interface SafeDeleteInfo {
  command: string;
  installHint: string;
  aliasHint: string;
}

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

export function getSafeDeleteSuggestion(platform: Platform): SafeDeleteInfo | null {
  switch (platform) {
    case 'macos':
      return {
        command: 'trash',
        installHint: 'brew install trash-cli',
        aliasHint: "alias rm='trash'",
      };
    case 'linux':
      return {
        command: 'trash-put',
        installHint: 'sudo apt install trash-cli  # or: npm install -g trash-cli',
        aliasHint: "alias rm='trash-put'",
      };
    case 'windows':
      return null;
  }
}

export function hasSafeDelete(platform: Platform): boolean {
  const info = getSafeDeleteSuggestion(platform);
  if (!info) return false;
  try {
    execSync(`which ${info.command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
