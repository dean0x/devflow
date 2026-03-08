import { execSync, execFileSync } from 'child_process';

/**
 * Check if the `claude` CLI is available on this machine.
 */
export function isClaudeAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a prompt through claude CLI in non-interactive mode.
 * Returns the text output.
 */
export function runClaude(prompt: string, options?: { timeout?: number }): string {
  const timeout = options?.timeout ?? 30000;

  const result = execFileSync(
    'claude',
    ['-p', '--output-format', 'text', '--model', 'haiku', prompt],
    {
      stdio: 'pipe',
      timeout,
      encoding: 'utf-8',
    },
  );

  return result.trim();
}

/**
 * Assert that output contains a classification marker (case-insensitive).
 * Classification markers look like: "Ambient: BUILD/GUIDED"
 */
export function hasClassification(output: string): boolean {
  return /ambient:\s*(BUILD|DEBUG|REVIEW|PLAN|EXPLORE|CHAT)\s*\/\s*(QUICK|GUIDED|ELEVATE)/i.test(output);
}

/**
 * Assert that output does NOT contain a classification marker.
 * QUICK responses should be silent — no classification output.
 */
export function isQuietResponse(output: string): boolean {
  return !hasClassification(output);
}

/**
 * Extract the intent from a classification marker.
 */
export function extractIntent(output: string): string | null {
  const match = output.match(/ambient:\s*(BUILD|DEBUG|REVIEW|PLAN|EXPLORE|CHAT)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract the depth from a classification marker.
 */
export function extractDepth(output: string): string | null {
  const match = output.match(/ambient:\s*\w+\s*\/\s*(QUICK|GUIDED|ELEVATE)/i);
  return match ? match[1].toUpperCase() : null;
}
