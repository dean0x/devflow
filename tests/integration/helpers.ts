import { execSync, spawn, ChildProcess } from 'child_process';

const CLASSIFICATION_PATTERN = /devflow:\s*(CHAT|EXPLORE|PLAN|IMPLEMENT|DEBUG|REVIEW|RESOLVE|PIPELINE)\s*\/\s*(QUICK|GUIDED|ORCHESTRATED)/i;

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
  `AMBIENT MODE ENABLED: Classify user intent and depth.
Intents: CHAT (greetings/confirmations), EXPLORE (find/explain/analyze/trace/map), PLAN (plan/design/architecture), IMPLEMENT (add/create/build/implement), REVIEW (check/review), RESOLVE (resolve review issues), DEBUG (fix/bug/error), PIPELINE (end-to-end).
Depth: QUICK (chat, simple lookups, git ops, config, rename/comment tweaks, 1-2 line edits) | GUIDED (code changes ≤2 files, clear bugs, focused reviews, focused exploration, focused design/plan) | ORCHESTRATED (>2 files, multi-module, vague bugs, full/branch/PR reviews, deep exploration, system-level design, RESOLVE and PIPELINE always).
QUICK: respond normally. No classification, no skills.
GUIDED/ORCHESTRATED: Load devflow:router skill FIRST via Skill tool for skill mappings. Then load all skills it specifies. State: Devflow: INTENT/DEPTH. Loading: [skills].`;

/** Result from a streaming claude invocation */
export interface StreamResult {
  /** Skill tool invocations detected (skill names) */
  skills: string[];
  /** Text fragments captured from assistant messages */
  textFragments: string[];
  /** Whether the process completed or was killed */
  killedEarly: boolean;
  /** Duration in ms */
  durationMs: number;
}

/**
 * Run a prompt through claude CLI with stream-json output.
 *
 * Reads events line-by-line as they stream. Resolves as soon as we detect
 * Skill tool invocations OR the timeout expires. Kills the process immediately
 * after detection — no waiting for completion.
 *
 * Uses --allowedTools Skill so the Skill tool actually executes (appears as tool_use events).
 */
export function runClaudeStreaming(
  prompt: string,
  options?: { timeout?: number; model?: string },
): Promise<StreamResult> {
  const timeout = options?.timeout ?? 45000;
  const model = options?.model ?? 'haiku';

  return new Promise((resolve) => {
    const startTime = Date.now();
    const skills: string[] = [];
    const textFragments: string[] = [];
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const args = [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--model', model,
      '--allowedTools', 'Skill',
      '--append-system-prompt', DEVFLOW_PREAMBLE,
      prompt,
    ];

    const proc: ChildProcess = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';

    const finish = (killedEarly: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      resolve({
        skills: [...new Set(skills)],
        textFragments,
        killedEarly,
        durationMs: Date.now() - startTime,
      });
    };

    // Safety timeout
    const timer = setTimeout(() => finish(true), timeout);

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Detect Skill tool_use in assistant messages
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              // tool_use block for Skill
              if (block.type === 'tool_use' && block.name === 'Skill' && block.input?.skill) {
                skills.push(block.input.skill);
              }
              // text block — capture for classification detection
              if (block.type === 'text' && block.text) {
                textFragments.push(block.text);
              }
            }

            // Once we have skills, give a brief window for more, then finish
            if (skills.length > 0 && !graceTimer) {
              graceTimer = setTimeout(() => {
                finish(true);
              }, 8000); // 8s grace for additional skill loads after first detection
            }
          }

          // Also check tool_result events — if Skill tool returned content, it worked
          if (event.type === 'user' && event.tool_use_result && skills.length > 0) {
            // Skill loaded successfully — we can finish soon
          }
        } catch {
          // Partial JSON line, skip
        }
      }
    });

    proc.on('close', () => {
      clearTimeout(timer);
      finish(false);
    });

    proc.on('error', () => {
      clearTimeout(timer);
      finish(true);
    });
  });
}

/**
 * Run a prompt with single-shot model fallback.
 *
 * One attempt with Haiku. If predicate fails, one attempt with Sonnet.
 * No retries — if the prompt doesn't work first try, the prompt needs fixing.
 */
export async function runClaudeStreamingWithRetry(
  prompt: string,
  predicate: (result: StreamResult) => boolean,
  options?: { timeout?: number; model?: string },
): Promise<{ result: StreamResult; attempts: number; passed: boolean; model: string }> {
  const timeout = options?.timeout ?? 45000;
  const primaryModel = options?.model ?? 'haiku';

  // Single shot with primary model
  const primaryResult = await runClaudeStreaming(prompt, { timeout, model: primaryModel });
  if (predicate(primaryResult)) {
    return { result: primaryResult, attempts: 1, passed: true, model: primaryModel };
  }

  // Single shot fallback to sonnet
  if (primaryModel === 'haiku') {
    const fallbackResult = await runClaudeStreaming(prompt, { timeout, model: 'sonnet' });
    if (predicate(fallbackResult)) {
      return { result: fallbackResult, attempts: 2, passed: true, model: 'sonnet' };
    }
    return { result: fallbackResult, attempts: 2, passed: false, model: 'sonnet' };
  }

  return { result: primaryResult, attempts: 1, passed: false, model: primaryModel };
}

// --- Detection helpers ---

export function hasSkillInvocations(result: StreamResult): boolean {
  return result.skills.length > 0;
}

export function getSkillInvocations(result: StreamResult): string[] {
  return result.skills;
}

export function hasClassification(result: StreamResult): boolean {
  const text = result.textFragments.join(' ');
  return CLASSIFICATION_PATTERN.test(text);
}

export function extractIntent(result: StreamResult): string | null {
  const text = result.textFragments.join(' ');
  const match = text.match(CLASSIFICATION_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

export function extractDepth(result: StreamResult): string | null {
  const text = result.textFragments.join(' ');
  const match = text.match(CLASSIFICATION_PATTERN);
  return match ? match[2].toUpperCase() : null;
}

export function hasDevFlowBranding(result: StreamResult): boolean {
  const text = result.textFragments.join(' ');
  return /devflow:\s*(CHAT|EXPLORE|PLAN|IMPLEMENT|DEBUG|REVIEW|RESOLVE|PIPELINE)/i.test(text);
}

/**
 * Check if required skills are present in the result.
 * Uses bounded matching: exact match, namespace-suffixed, or devflow-prefixed.
 */
export function hasRequiredSkills(result: StreamResult, required: string[]): boolean {
  return required.every((name) =>
    result.skills.some((s) => s === name || s.endsWith(`:${name}`) || s === `devflow:${name}`),
  );
}
