import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as path from 'path';
import { readSidecar, type SidecarData } from './sidecar.js';

const execFileAsync = promisify(execFile);

/** Tools passed to `claude -p` when spawning the Knowledge agent. */
const KB_AGENT_TOOLS = 'Read,Grep,Glob,Write';

export interface RunKbAgentOptions {
  worktreePath: string;
  slug: string;
  /** Prompt to pass to the Knowledge agent. */
  prompt: string;
  /** Sidecar filename: '.create-result.json' or '.refresh-result.json' */
  sidecarName: string;
}

export interface RunKbAgentResult {
  sidecar: SidecarData;
}

/**
 * Spawn the Knowledge agent via `claude -p`, then read and clean up the sidecar file.
 *
 * The agent is expected to write a sidecar JSON file at
 * `.features/{slug}/{sidecarName}` with `referencedFiles` and optionally `description`.
 * If the sidecar is absent (agent failure), an empty SidecarData is returned.
 *
 * Using async execFile keeps the event loop free so the clack spinner can
 * animate while the agent runs.
 *
 * @throws When `claude` exits with a non-zero status (propagates execFile error).
 */
export async function runKbAgent(opts: RunKbAgentOptions): Promise<RunKbAgentResult> {
  const { worktreePath, slug, prompt, sidecarName } = opts;
  const sidecarPath = path.join(worktreePath, '.features', slug, sidecarName);

  // Pre-clean any leftover sidecar from a previous run
  try { await fs.unlink(sidecarPath); } catch { /* doesn't exist — that's fine */ }

  // Spawn Knowledge agent (async — keeps event loop free for spinner animation)
  await execFileAsync('claude', [
    '-p', prompt,
    '--model', 'sonnet',
    '--allowedTools', KB_AGENT_TOOLS,
    '--dangerously-skip-permissions',
  ], {
    cwd: worktreePath,
    timeout: 300_000,
  });

  // Read sidecar written by the agent (returns {} if missing/invalid)
  const sidecar = await readSidecar(sidecarPath);

  // Post-clean — best effort; callers should not rely on the sidecar persisting
  try { await fs.unlink(sidecarPath); } catch { /* already cleaned or never written */ }

  return { sidecar };
}
