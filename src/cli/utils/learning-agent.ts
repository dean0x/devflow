/**
 * Learning agent runner for WORKFLOW and PROCEDURAL observation detection.
 *
 * Extracted from scripts/hooks/background-learning (bash) so the same prompt
 * construction and `claude -p` invocation logic can be reused by the TypeScript
 * decisions pipeline without duplicating the bash script.
 *
 * These functions intentionally use simple throw/catch rather than Result types
 * because they are internal infrastructure utilities, not domain-facing APIs.
 * Callers should wrap in try/finally and release locks on failure.
 */

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { loadExistingObservations } from './background-runner.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface LearningAgentOpts {
  /** Project working directory. */
  cwd: string;
  /** Clean user messages from transcript-filter.cjs extractChannels. */
  userSignals: string[];
  /** Model name (e.g. 'sonnet'). */
  model: string;
  /** Path to the learning-log.jsonl file. */
  logFile: string;
  /** Path to json-helper.cjs. */
  jsonHelperPath: string;
}

/**
 * Run the learning agent (`claude -p`) to detect WORKFLOW and PROCEDURAL
 * observation patterns from user session signals.
 *
 * Builds a prompt with existing observations for deduplication, invokes
 * `claude -p --output-format text`, strips markdown fences from the response,
 * validates the JSON, writes the result to a temp file, and returns the path.
 *
 * Uses `--dangerously-skip-permissions` because `claude -p` is non-interactive.
 *
 * @throws When `claude` exits with a non-zero status or the response is not valid JSON.
 * @returns Path to a temp file containing the validated JSON response.
 */
export async function runLearningAgent(opts: LearningAgentOpts): Promise<string> {
  const { cwd, userSignals, model, logFile, jsonHelperPath } = opts;

  // Load existing observations for deduplication context.
  const existingObs = await loadExistingObservations(jsonHelperPath, logFile, ['workflow', 'procedural']);

  // Build the prompt.
  const prompt = _buildLearningPrompt(userSignals, existingObs);

  // Write prompt to temp file and invoke claude -p.
  const responseFile = path.join(os.tmpdir(), `.learning-response-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);

  try {
    const { stdout } = await execFileAsync('claude', [
      '-p', prompt,
      '--model', model,
      '--output-format', 'text',
      '--allowedTools', 'Read',
      '--dangerously-skip-permissions',
    ], {
      cwd,
      timeout: 180_000,
    });

    // Strip markdown fences if present.
    const stripped = _stripMarkdownFences(stdout);

    // Validate JSON.
    _validateObservationsJson(stripped);

    await fs.writeFile(responseFile, stripped, { encoding: 'utf-8', mode: 0o600 });
    return responseFile;
  } catch (err) {
    // Clean up temp file on error.
    await fs.unlink(responseFile).catch(() => { /* best effort */ });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the prompt for WORKFLOW + PROCEDURAL detection.
 * Exported for testing (prompt content verification).
 */
export function _buildLearningPrompt(userSignals: string[], existingObs: string): string {
  const signalsText = userSignals.join('\n') || '(no signals)';

  return `You are a pattern detection agent. Analyze the user's session messages to identify two types of learnable patterns. Your output will be merged into a persistent learning log.

# === CONTEXT ===

EXISTING OBSERVATIONS (for deduplication — reuse IDs for matching patterns):
${existingObs}

USER_SIGNALS (clean user text, one per line, used for workflow/procedural detection):
${signalsText}

# === OBSERVATION TYPES ===

Detect two types of patterns. Each has its own evidence requirement. Do not lower the bar when evidence is scarce — emit fewer observations instead.

## 1. WORKFLOW — multi-step sequences the user instructs repeatedly
Source: USER_SIGNALS only.
Examples: "squash merge the PR, pull main, delete the feature branch"; "implement the plan, then run /self-review, then commit and push"; "first run the tests, then the typecheck, then format"
Strong signals: imperative verbs chained with "then"/"next"/"after that", numbered lists the user typed, "Implement the following plan:" followed by steps, explicit ordering words.
Weak signals (reject): a single imperative, a question, restatement of the assistant's suggestion.
Evidence requirement: 2+ distinct user statements that describe the same sequence.

## 2. PROCEDURAL — durable "how to do X in this project" knowledge
Source: USER_SIGNALS only.
Examples: "when debugging hook failures, check the lock dir first, then tail the log"; "to regenerate the grammar, always run \`make lex\` first"; "the way to update classification rules is to edit classification-rules.md, then update the router, then align tests"
Strong signals: "when <situation>, <action>" phrasing, "to <goal>, <action>" phrasing, references to specific project tools/files/commands by name.
Weak signals (reject): single imperative with no explanation, generic advice applicable to any project.
Evidence requirement: 2+ user statements describing the same how-to, OR 1 statement with strong instructional tone referencing project-specific entities.

# === QUALITY GATE ===

For EVERY observation you emit, include a "quality_ok" field (boolean). Set to true ONLY if:
- The evidence array contains quoted text that supports the pattern.
- For workflow/procedural: at least 2 distinct evidence items are quoted.

If quality_ok is false, still emit the observation so its count increments — but the downstream system will NOT materialize it.

# === DEDUPLICATION ===

- If an existing observation matches a pattern from this session, report it with the SAME id so the count can increment.
- For new patterns, generate a new id: obs_ followed by 6 random alphanumeric chars.
- Do not create near-duplicate observations — prefer fewer, higher-signal entries.

# === OUTPUT FORMAT ===

Output ONLY the JSON object. No markdown fences, no explanation.

{
  "observations": [
    {
      "id": "obs_a1b2c3",
      "type": "workflow",
      "pattern": "Short name for the pattern",
      "evidence": ["quoted user message 1", "quoted user message 2"],
      "details": "Type-specific structured body. workflow: numbered step list. procedural: method explanation.",
      "quality_ok": true
    }
  ]
}

If no patterns detected, return {"observations": []}.

Do NOT emit artifact content, rendered markdown, YAML frontmatter, or templates. Rendering is a separate step handled by the render layer. Your only job is to produce structured observation metadata.`;
}

/**
 * Strip markdown code fences from a response string.
 * Handles: ```json\n{...}\n``` and ```\n{...}\n```
 */
export function _stripMarkdownFences(text: string): string {
  return text
    .replace(/^```json\n/, '')
    .replace(/^```\n/, '')
    .replace(/\n```$/, '')
    .trim();
}

/**
 * Validate that the response is a JSON object with an `observations` array.
 * @throws When the JSON is malformed or missing the `observations` field.
 */
function _validateObservationsJson(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Learning agent returned invalid JSON: ${text.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>)['observations'])) {
    throw new Error(`Learning agent response missing "observations" array`);
  }
}
