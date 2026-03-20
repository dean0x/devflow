import { execSync, execFileSync } from 'child_process';

const CLASSIFICATION_PATTERN = /ambient:\s*(IMPLEMENT|DEBUG|REVIEW|PLAN|EXPLORE|CHAT)\s*\/\s*(QUICK|GUIDED|ORCHESTRATED)/i;
const LOADING_PATTERN = /loading:\s*[\w-]+(?:,\s*[\w-]+)*/i;

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

const AMBIENT_PREAMBLE =
  'AMBIENT MODE ACTIVE: Before responding, silently classify this prompt using the ambient-router skill already in your session context. If QUICK, respond normally without stating classification. If GUIDED or ORCHESTRATED, you MUST load the selected skills using the Skill tool before proceeding.';

/**
 * Run a prompt through claude CLI in non-interactive mode.
 * Injects the ambient preamble via --append-system-prompt since
 * UserPromptSubmit hooks don't fire in -p (non-interactive) mode.
 * Returns the text output.
 */
export function runClaude(prompt: string, options?: { timeout?: number; ambient?: boolean }): string {
  const timeout = options?.timeout ?? 30000;
  const ambient = options?.ambient ?? true;

  const args = ['-p', '--output-format', 'text', '--model', 'haiku'];
  if (ambient) {
    args.push('--append-system-prompt', AMBIENT_PREAMBLE);
  }
  args.push(prompt);

  const result = execFileSync(
    'claude',
    args,
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
 * Classification markers look like: "Ambient: IMPLEMENT/GUIDED"
 */
export function hasClassification(output: string): boolean {
  return CLASSIFICATION_PATTERN.test(output);
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
  const match = output.match(CLASSIFICATION_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract the depth from a classification marker.
 */
export function extractDepth(output: string): string | null {
  const match = output.match(CLASSIFICATION_PATTERN);
  return match ? match[2].toUpperCase() : null;
}

/**
 * Check if the output contains a "Loading:" marker indicating skills were loaded.
 */
export function hasSkillLoading(output: string): boolean {
  return LOADING_PATTERN.test(output);
}

/**
 * Extract the list of skill names from a "Loading:" marker.
 */
export function extractLoadedSkills(output: string): string[] {
  const match = output.match(LOADING_PATTERN);
  if (!match) return [];
  return match[0].replace(/^loading:\s*/i, '').split(',').map(s => s.trim());
}
