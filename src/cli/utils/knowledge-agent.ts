import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { readAgentResult, type AgentResult } from './agent-result.js';
import { getDevFlowDirectory } from './paths.js';
import { getKnowledgePath } from './project-paths.js';

const execFileAsync = promisify(execFile);

/** Tools passed to `claude -p` when spawning the Knowledge agent. */
const KNOWLEDGE_AGENT_TOOLS = 'Read,Grep,Glob,Write,Skill';

/**
 * Load the compact DECISIONS_CONTEXT index (ADR/PF entries) for cross-referencing.
 * Returns '(none)' when no decisions files exist or the script is not installed.
 */
export function loadDecisionsContext(worktreePath: string): string {
  const scriptPath = path.join(
    getDevFlowDirectory(), 'scripts', 'hooks', 'lib', 'decisions-index.cjs',
  );

  if (!existsSync(scriptPath)) return '(none)';

  try {
    return execFileSync('node', [scriptPath, 'index', worktreePath], {
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
  } catch {
    return '(none)';
  }
}

export interface RunKnowledgeAgentOptions {
  worktreePath: string;
  slug: string;
  /** Prompt to pass to the Knowledge agent. */
  prompt: string;
  /** Result filename: '.create-result.json' or '.refresh-result.json' */
  resultFileName: string;
}

export interface RunKnowledgeAgentResult {
  result: AgentResult;
}

/**
 * Spawn the Knowledge agent via `claude -p`, then read and clean up the result file.
 *
 * The agent is expected to write a JSON file at
 * `.devflow/features/{slug}/{resultFileName}` with `referencedFiles` and optionally `description`.
 * If the file is absent (agent failure), an empty AgentResult is returned.
 *
 * Using async execFile keeps the event loop free so the clack spinner can
 * animate while the agent runs.
 *
 * Uses `--dangerously-skip-permissions` because `claude -p` is non-interactive
 * and cannot prompt for approval; tool access is restricted via `--allowedTools`.
 *
 * @throws When `claude` exits with a non-zero status (propagates execFile error).
 */
export async function runKnowledgeAgent(opts: RunKnowledgeAgentOptions): Promise<RunKnowledgeAgentResult> {
  const { worktreePath, slug, prompt, resultFileName } = opts;
  // Build result path in .devflow/features/{slug}/ (same directory as KNOWLEDGE.md)
  const resultPath = path.join(path.dirname(getKnowledgePath(worktreePath, slug)), resultFileName);

  // Pre-clean any leftover file from a previous run
  try { await fs.unlink(resultPath); } catch { /* doesn't exist — that's fine */ }

  // Spawn Knowledge agent (async — keeps event loop free for spinner animation)
  await execFileAsync('claude', [
    '-p', prompt,
    '--model', 'sonnet',
    '--allowedTools', KNOWLEDGE_AGENT_TOOLS,
    '--dangerously-skip-permissions',
  ], {
    cwd: worktreePath,
    timeout: 300_000,
  });

  // Read result file written by the agent (returns {} if missing/invalid)
  const result = await readAgentResult(resultPath);

  // Post-clean — best effort; callers should not rely on the file persisting
  try { await fs.unlink(resultPath); } catch { /* already cleaned or never written */ }

  return { result };
}
