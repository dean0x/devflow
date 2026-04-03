import { execSync, execFileSync } from 'child_process';

const CLASSIFICATION_PATTERN = /devflow:\s*(IMPLEMENT|DEBUG|REVIEW|PLAN|EXPLORE|CHAT|RESOLVE|PIPELINE)\s*\/\s*(QUICK|GUIDED|ORCHESTRATED)/i;
const LOADING_PATTERN = /loading:\s*[\w:-]+(?:,\s*[\w:-]+)*/i;

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

// SYNC: must match scripts/hooks/preamble PREAMBLE structure
const DEVFLOW_PREAMBLE =
  `DEVFLOW MODE: Classify user intent and depth.
Intents: IMPLEMENT (add/create/build), DEBUG (fix/bug/error), REVIEW (check/review), RESOLVE (resolve review issues), PIPELINE (end-to-end), PLAN (design/architecture), EXPLORE (find/explain), CHAT (greetings/confirmations), MULTI_WORKTREE (all worktrees/branches).
Depth: QUICK (chat, explore, git ops, config, trivial) | GUIDED (code changes ≤2 files, clear bugs, focused reviews) | ORCHESTRATED (>2 files, multi-module, vague bugs, full/branch/PR reviews, RESOLVE and PIPELINE always).
QUICK: respond normally. No classification, no skills.
GUIDED/ORCHESTRATED: Load devflow:router skill FIRST via Skill tool for skill mappings. Then load all skills it specifies. State: DevFlow: INTENT/DEPTH. Loading: [skills].`;

/** Structured result from a claude -p invocation */
export interface ClaudeResult {
  /** Final text output */
  text: string;
  /** Tool calls that were denied by permission system */
  permissionDenials: Array<{ toolName: string; toolInput: Record<string, unknown> }>;
  /** Whether the invocation succeeded */
  success: boolean;
}

/**
 * Run a prompt through claude CLI in non-interactive mode.
 * Uses JSON output to capture permission_denials (Skill tool invocation attempts).
 */
export function runClaude(prompt: string, options?: { timeout?: number; ambient?: boolean }): ClaudeResult {
  const timeout = options?.timeout ?? 60000;
  const ambient = options?.ambient ?? true;

  const args = ['-p', '--output-format', 'json', '--model', 'haiku'];
  if (ambient) {
    args.push('--append-system-prompt', DEVFLOW_PREAMBLE);
  }
  args.push(prompt);

  const raw = execFileSync(
    'claude',
    args,
    {
      stdio: 'pipe',
      timeout,
      encoding: 'utf-8',
    },
  );

  const json = JSON.parse(raw.trim());
  const denials = (json.permission_denials ?? []).map((d: { tool_name: string; tool_input: Record<string, unknown> }) => ({
    toolName: d.tool_name,
    toolInput: d.tool_input,
  }));

  return {
    text: json.result ?? '',
    permissionDenials: denials,
    success: !json.is_error,
  };
}

/**
 * Run a prompt with retries for non-deterministic classification tests.
 * Returns the first result where the predicate passes, or the last result if none pass.
 */
export function runClaudeWithRetry(
  prompt: string,
  predicate: (result: ClaudeResult) => boolean,
  options?: { timeout?: number; maxAttempts?: number },
): { result: ClaudeResult; attempts: number; passed: boolean } {
  const maxAttempts = options?.maxAttempts ?? 3;
  const timeout = options?.timeout ?? 60000;

  let lastResult: ClaudeResult | null = null;

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const result = runClaude(prompt, { timeout });
      lastResult = result;
      if (predicate(result)) {
        return { result, attempts: i, passed: true };
      }
    } catch (err) {
      // Rethrow on final attempt so non-transient errors (e.g. SyntaxError) surface
      if (i === maxAttempts) throw err;
      // Otherwise treat as transient and retry
    }
  }

  // All attempts failed or didn't match predicate
  const fallback: ClaudeResult = lastResult ?? { text: '', permissionDenials: [], success: false };
  return { result: fallback, attempts: maxAttempts, passed: false };
}

// --- Classification helpers (text output) ---

export function hasClassification(output: string): boolean {
  return CLASSIFICATION_PATTERN.test(output);
}

export function isQuietResponse(output: string): boolean {
  return !hasClassification(output);
}

export function extractIntent(output: string): string | null {
  const match = output.match(CLASSIFICATION_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

export function extractDepth(output: string): string | null {
  const match = output.match(CLASSIFICATION_PATTERN);
  return match ? match[2].toUpperCase() : null;
}

export function hasSkillLoading(output: string): boolean {
  return LOADING_PATTERN.test(output);
}

export function extractLoadedSkills(output: string): string[] {
  const match = output.match(LOADING_PATTERN);
  if (!match) return [];
  return match[0].replace(/^loading:\s*/i, '').split(',').map(s => s.trim());
}

// --- Skill invocation helpers (permission_denials) ---

/**
 * Extract Skill tool invocation attempts from permission denials.
 * In -p mode, Skill tool calls appear as denials since they require permission.
 */
export function getSkillInvocations(result: ClaudeResult): string[] {
  return result.permissionDenials
    .filter(d => d.toolName === 'Skill')
    .map(d => (d.toolInput as { skill: string }).skill)
    .filter(Boolean);
}

/**
 * Check if the model attempted to load any skills via the Skill tool.
 */
export function hasSkillInvocations(result: ClaudeResult): boolean {
  return getSkillInvocations(result).length > 0;
}

/**
 * Check if a specific skill was invoked (or attempted).
 */
export function hasSkillInvocation(result: ClaudeResult, skillName: string): boolean {
  return getSkillInvocations(result).includes(skillName);
}
