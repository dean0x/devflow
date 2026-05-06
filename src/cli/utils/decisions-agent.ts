/**
 * Decisions agent runner for DECISION and PITFALL observation detection.
 *
 * Extracted from scripts/hooks/background-learning (bash) so the same prompt
 * construction and `claude -p` invocation logic can be reused by the TypeScript
 * decisions pipeline without duplicating the bash script.
 *
 * Uses Claude's structured output (`--output-format json --json-schema`) for
 * reliable DECISION/PITFALL extraction, then serializes the structured fields
 * into the semicolon-delimited `details` string format that process-observations
 * in json-helper.cjs already understands.
 *
 * DESIGN D10: The semicolon-delimited `details` format is the canonical wire format
 * for decision/pitfall observations. Structured JSON is only for reliable extraction.
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
// JSON schema for structured output
// ---------------------------------------------------------------------------

/**
 * JSON schema for Claude's structured output.
 * The model returns {"observations": [...]} with type-specific optional fields.
 */
const DECISIONS_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    observations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['decision', 'pitfall'] },
          pattern: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          // Decision-specific fields
          context: { type: 'string' },
          decision: { type: 'string' },
          rationale: { type: 'string' },
          // Pitfall-specific fields
          area: { type: 'string' },
          issue: { type: 'string' },
          impact: { type: 'string' },
          resolution: { type: 'string' },
          quality_ok: { type: 'boolean' },
        },
        required: ['id', 'type', 'pattern', 'evidence', 'quality_ok'],
      },
    },
  },
  required: ['observations'],
});

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface DecisionsAgentOpts {
  /** Project working directory. */
  cwd: string;
  /** Dialog pairs (prior assistant + user message) from transcript-filter.cjs. */
  dialogPairs: Array<{ prior: string; user: string }>;
  /** Model name (e.g. 'sonnet'). */
  model: string;
  /** Path to the decisions-log.jsonl file. */
  logFile: string;
  /** Path to json-helper.cjs. */
  jsonHelperPath: string;
}

/**
 * Run the decisions agent (`claude -p`) to detect DECISION and PITFALL
 * observation patterns from user/assistant dialog pairs.
 *
 * Builds a prompt with existing observations for deduplication, invokes
 * `claude -p --output-format json --json-schema`, extracts the structured output
 * from the response envelope, serializes type-specific fields into the canonical
 * semicolon-delimited `details` string (D10), writes the result to a temp file,
 * and returns the path.
 *
 * Uses `--dangerously-skip-permissions` because `claude -p` is non-interactive.
 *
 * @throws When `claude` exits with a non-zero status or the response cannot be parsed.
 * @returns Path to a temp file containing the normalized JSON response.
 */
export async function runDecisionsAgent(opts: DecisionsAgentOpts): Promise<string> {
  const { cwd, dialogPairs, model, logFile, jsonHelperPath } = opts;

  // Load existing observations for deduplication context.
  const existingObs = await loadExistingObservations(jsonHelperPath, logFile, ['decision', 'pitfall']);

  // Build the prompt.
  const prompt = _buildDecisionsPrompt(dialogPairs, existingObs);

  // Write response to temp file.
  const responseFile = path.join(os.tmpdir(), `.decisions-response-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);

  try {
    const { stdout } = await execFileAsync('claude', [
      '-p', prompt,
      '--model', model,
      '--output-format', 'json',
      '--json-schema', DECISIONS_JSON_SCHEMA,
      '--allowedTools', 'Read',
      '--dangerously-skip-permissions',
    ], {
      cwd,
      timeout: 180_000,
    });

    // Parse the structured output envelope: {"structured_output": {"observations": [...]}}
    const observations = _extractStructuredOutput(stdout);

    // Serialize type-specific fields into semicolon-delimited details (D10).
    const normalized = _normalizeObservations(observations);

    const responseJson = JSON.stringify({ observations: normalized });
    await fs.writeFile(responseFile, responseJson, { encoding: 'utf-8', mode: 0o600 });
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
 * Build the prompt for DECISION + PITFALL detection.
 * Exported for testing (prompt content verification).
 */
export function _buildDecisionsPrompt(
  dialogPairs: Array<{ prior: string; user: string }>,
  existingObs: string,
): string {
  const pairsText = dialogPairs.length > 0
    ? dialogPairs.map(p => `[PRIOR]: ${p.prior}\n[USER]: ${p.user}`).join('\n\n')
    : '(no dialog pairs)';

  return `You are a pattern detection agent. Analyze the user's session dialog to identify two types of learnable patterns. Your output will be merged into a persistent learning log and used to materialize project decisions entries.

# === CONTEXT ===

EXISTING OBSERVATIONS (for deduplication — reuse IDs for matching patterns):
${existingObs}

DIALOG_PAIRS (user turn with its immediately-preceding assistant turn, used for decision/pitfall detection):
${pairsText}

# === OBSERVATION TYPES ===

Detect two types of patterns. Do not lower the bar when evidence is scarce — emit fewer observations instead.

## 1. DECISION — architectural or scope commitment with explicit rationale
Source: DIALOG_PAIRS. The prior assistant turn is used only to disambiguate what the user is committing to.
The key signal is INTENT + RATIONALE in a single user statement or adjacent sentences. The user must say BOTH what they want AND why.
Template patterns: "I want X because Y"; "let's go with X — Y"; "X is better than Y because Z"; "not X, but Y, because Z"
Strong rationale anchors (must be present in user text for a valid observation): "because", "since", "so that", "to avoid", "the reason", "the point is".
Weak signals (reject): one-word approvals ("yes", "ok"), preferences without reasoning, restatement of the assistant's recommendation.
Quality gate: before emitting, ask — "if I delete the 'because ___' clause from the user's words, does the statement still capture a decision worth recording?" If yes, the rationale is not load-bearing and the observation should be skipped.
Evidence requirement: 1 user statement with the rationale anchor present AND quotable.

Required fields: id, type ("decision"), pattern, evidence, context, decision, rationale, quality_ok.

## 2. PITFALL — user correction of something the assistant did or proposed
Source: DIALOG_PAIRS. Both the prior assistant content AND the user correction MUST be cited in the evidence array.
Examples:
- prior: "I'll add a try/catch around the Result parsing"; user: "no — we use Result types precisely to avoid try/catch. Do not wrap."
- prior: "Let me amend the previous commit"; user: "don't amend pushed commits. Create a new one."
Strong signals: explicit negation after an assistant action ("no", "don't", "stop"), question-form redirects, re-emphasis, counter-instructions.
Weak signals (reject): stylistic preferences, typo corrections, clarifying questions, generic warnings.
PRIOR CONTEXT REQUIREMENT: You CANNOT emit a pitfall observation without quoting the prior assistant text. If DIALOG_PAIRS does not contain an assistant turn immediately before the user's correction, skip the observation.
Quality gate: the pitfall must be tied to a concrete file, tool, command, or subsystem named in the dialog. Generic warnings are rejected.
Evidence requirement: at least one DIALOG_PAIR where (a) the prior assistant text proposed or performed an action, and (b) the user's next message rejects/undoes/warns against it.

Required fields: id, type ("pitfall"), pattern, evidence, area, issue, impact, resolution, quality_ok.

# === QUALITY GATE ===

For EVERY observation you emit, include a "quality_ok" field (boolean). Set to true ONLY if:
- The evidence array contains quoted text that supports the pattern.
- For decision: the rationale anchor phrase is present in at least one evidence item.
- For pitfall: both the assistant's action phrase AND the user's rejection phrase are present in evidence.

If quality_ok is false, still emit the observation so its count increments — but the downstream system will NOT materialize it.

# === DEDUPLICATION ===

- If an existing observation matches a pattern from this session, report it with the SAME id so the count can increment.
- For new patterns, generate a new id: obs_ followed by 6 random alphanumeric chars.
- Do not create near-duplicate observations — prefer fewer, higher-signal entries.

If no patterns detected, return {"observations": []}.

Do NOT emit artifact content, rendered markdown, YAML frontmatter, or templates. Rendering is a separate step handled by the render layer. Your only job is to produce structured observation metadata.`;
}

// ---------------------------------------------------------------------------
// Response processing
// ---------------------------------------------------------------------------

interface RawObservation {
  id: string;
  type: string;
  pattern: string;
  evidence: string[];
  quality_ok: boolean;
  // Decision fields
  context?: string;
  decision?: string;
  rationale?: string;
  // Pitfall fields
  area?: string;
  issue?: string;
  impact?: string;
  resolution?: string;
}

interface NormalizedObservation {
  id: string;
  type: string;
  pattern: string;
  evidence: string[];
  details: string;
  quality_ok: boolean;
}

/**
 * Type guard for RawObservation — validates all required fields are present
 * and have the expected types. Used to filter LLM output before serialization.
 */
function isRawObservation(value: unknown): value is RawObservation {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['type'] === 'string' &&
    typeof v['pattern'] === 'string' &&
    Array.isArray(v['evidence']) &&
    typeof v['quality_ok'] === 'boolean'
  );
}

/**
 * Extract the observations array from Claude's structured output envelope.
 * Claude wraps structured output in: {"structured_output": {...actual response...}}
 *
 * Individual elements are validated via isRawObservation() — malformed elements
 * are logged and dropped rather than propagating garbage into serialization.
 *
 * @throws When the envelope cannot be parsed.
 */
export function _extractStructuredOutput(stdout: string): RawObservation[] {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Decisions agent returned invalid JSON: ${stdout.slice(0, 200)}`);
  }

  if (typeof envelope !== 'object' || envelope === null) {
    throw new Error(`Decisions agent response is not a JSON object`);
  }

  // Try structured_output envelope first (Claude's JSON mode wrapping).
  const env = envelope as Record<string, unknown>;
  const inner = 'structured_output' in env ? env['structured_output'] : envelope;

  if (typeof inner !== 'object' || inner === null || !Array.isArray((inner as Record<string, unknown>)['observations'])) {
    throw new Error(`Decisions agent response missing "observations" array`);
  }

  const rawArray = (inner as Record<string, unknown[]>)['observations'];
  const valid: RawObservation[] = [];
  for (const item of rawArray) {
    if (isRawObservation(item)) {
      valid.push(item);
    } else {
      // Warn on malformed elements rather than silently producing garbage output.
      process.stderr.write(`[decisions-agent] Dropping malformed observation (missing required fields): ${JSON.stringify(item).slice(0, 200)}\n`);
    }
  }
  return valid;
}

/**
 * Normalize raw observations by serializing type-specific structured fields
 * into the canonical semicolon-delimited `details` string (D10).
 *
 * decision: "context: X; decision: Y; rationale: Z"
 * pitfall:  "area: X; issue: Y; impact: Z; resolution: W"
 */
export function _normalizeObservations(observations: RawObservation[]): NormalizedObservation[] {
  return observations.map(obs => {
    const details = obs.type === 'decision'
      ? _serializeDecision(obs)
      : obs.type === 'pitfall'
        ? _serializePitfall(obs)
        : '';

    return {
      id: obs.id,
      type: obs.type,
      pattern: obs.pattern,
      evidence: obs.evidence,
      details,
      quality_ok: obs.quality_ok,
    };
  });
}

function _serializeDecision(obs: RawObservation): string {
  const parts: string[] = [];
  if (obs.context) parts.push(`context: ${obs.context}`);
  if (obs.decision) parts.push(`decision: ${obs.decision}`);
  if (obs.rationale) parts.push(`rationale: ${obs.rationale}`);
  return parts.join('; ');
}

function _serializePitfall(obs: RawObservation): string {
  const parts: string[] = [];
  if (obs.area) parts.push(`area: ${obs.area}`);
  if (obs.issue) parts.push(`issue: ${obs.issue}`);
  if (obs.impact) parts.push(`impact: ${obs.impact}`);
  if (obs.resolution) parts.push(`resolution: ${obs.resolution}`);
  return parts.join('; ');
}

