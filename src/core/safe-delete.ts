import { execSync } from 'child_process';
import { homedir } from 'os';
import * as path from 'path';

export type Platform = 'macos' | 'linux' | 'windows';
export type Shell = 'zsh' | 'bash' | 'fish' | 'powershell' | 'unknown';

export interface SafeDeleteInfo {
  command: string | null;
  installHint: string | null;
}

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

export function detectShell(): Shell {
  // PowerShell detection via PSModulePath (set in all PowerShell sessions)
  if (process.env.PSModulePath) {
    return 'powershell';
  }

  const shellPath = process.env.SHELL;
  if (!shellPath) return 'unknown';

  const shellName = path.basename(shellPath);
  switch (shellName) {
    case 'zsh': return 'zsh';
    case 'bash': return 'bash';
    case 'fish': return 'fish';
    default: return 'unknown';
  }
}

export function getProfilePath(shell: Shell): string | null {
  const home = process.env.HOME || homedir();

  switch (shell) {
    case 'zsh':
      return path.join(home, '.zshrc');
    case 'bash':
      return path.join(home, '.bashrc');
    case 'fish':
      return path.join(home, '.config', 'fish', 'functions', 'rm.fish');
    case 'powershell': {
      // PowerShell profile path varies by platform
      if (process.platform === 'win32') {
        const docs = process.env.USERPROFILE
          ? path.join(process.env.USERPROFILE, 'Documents')
          : path.join(home, 'Documents');
        return path.join(docs, 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
      }
      return path.join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1');
    }
    case 'unknown':
      return null;
  }
}

export function getSafeDeleteInfo(platform: Platform): SafeDeleteInfo {
  switch (platform) {
    case 'macos':
      return {
        command: 'trash',
        installHint: 'brew install trash-cli',
      };
    case 'linux':
      return {
        command: 'trash-put',
        installHint: 'sudo apt install trash-cli  # or: npm install -g trash-cli',
      };
    case 'windows':
      return {
        command: null,
        installHint: null,
      };
  }
}

export function hasSafeDelete(platform: Platform): boolean {
  if (platform === 'windows') return true; // Windows has recycle bin via .NET
  const info = getSafeDeleteInfo(platform);
  if (!info.command) return false;
  try {
    execSync(`which ${info.command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
