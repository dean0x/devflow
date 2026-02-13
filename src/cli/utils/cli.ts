import { execSync } from 'child_process';

/**
 * Check if Claude CLI is available in the system PATH
 */
export function isClaudeCliAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
