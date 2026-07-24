/**
 * Agent model mapping engine — schema, persistence, and convergence for the
 * per-agent model configuration feature.
 *
 * applies ADR-013: pure core-layer module, no Claude Code adapter concerns.
 * avoids PF-014: all fallible operations return Result, no process.exit().
 *
 * Mapping file: ~/.devflow/agent-models.json
 *   { version: 1, agents: { [name]: { model?, effort? } } }
 *   Deviations-only: omit an agent to inherit its shipped default.
 *   Unknown agent names are tolerated and preserved on save (plugin may not be installed).
 *   Invalid effort values are dropped with a warning.
 *
 * Dormancy semantics (plan D5):
 *   A mapping entry whose model is an external GPT model (per externalModelIds())
 *   materializes into frontmatter ONLY when proxyEnabled=true. When the proxy is
 *   disabled, the entry stays saved but the SHIPPED DEFAULT model is applied instead.
 *   Effort is orthogonal — it ALWAYS applies regardless of proxy state.
 *
 * Dependency direction:
 *   core/proxy-state ← core/agent-models ← cli commands
 *   (no cycles)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { externalModelIds } from './external-models.js';
import { isProxyEnabled } from './proxy-state.js';
import { rewriteAgentFrontmatter, readFrontmatterModel } from './agent-frontmatter.js';
import { agentsDir } from './assets.js';
import { getAllAgentNames } from './plugins.js';

// ---------------------------------------------------------------------------
// Result type (local; matches codebase per-module pattern)
// ---------------------------------------------------------------------------

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Claude model short-alias identifiers.
 * A mapping entry with one of these model values applies unconditionally
 * (it is NOT a GPT model and is NOT subject to proxy dormancy).
 */
export const CLAUDE_MODEL_ALIASES: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable'];

/**
 * Valid effort level identifiers.
 * Invalid values are dropped with a warning on mapping read.
 */
export const EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Per-agent mapping entry. All fields optional — omit to inherit defaults. */
export interface AgentMapping {
  model?: string;
  effort?: string;
}

/** The agent-models.json file schema. */
export interface AgentMappingFile {
  version: 1;
  agents: Record<string, AgentMapping>;
}

// ---------------------------------------------------------------------------
// readAgentMapping
// ---------------------------------------------------------------------------

/** Optional callback for warning events during mapping parse. */
export interface ReadAgentMappingOptions {
  onWarning?: (message: string) => void;
}

/**
 * Read and tolerantly parse ~/.devflow/agent-models.json.
 * Returns an empty mapping when the file is missing.
 * Drops invalid effort values with a warning; preserves unknown agent names.
 */
export async function readAgentMapping(
  devflowDir: string,
  opts?: ReadAgentMappingOptions,
): Promise<Result<AgentMappingFile, string>> {
  const filePath = path.join(devflowDir, 'agent-models.json');
  const warn = opts?.onWarning ?? (() => undefined);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;

    const rawAgents = typeof data.agents === 'object' && data.agents !== null
      ? (data.agents as Record<string, unknown>)
      : {};

    const agents: Record<string, AgentMapping> = {};
    for (const [name, entry] of Object.entries(rawAgents)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const raw = entry as Record<string, unknown>;
      const mapping: AgentMapping = {};

      if (typeof raw.model === 'string') {
        mapping.model = raw.model;
      }

      if (typeof raw.effort === 'string') {
        if ((EFFORT_LEVELS as readonly string[]).includes(raw.effort)) {
          mapping.effort = raw.effort;
        } else {
          warn(`agent-models: dropping invalid effort "${raw.effort}" for agent "${name}"`);
        }
      }

      agents[name] = mapping;
    }

    return Ok({ version: 1, agents });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return Ok({ version: 1, agents: {} });
    }
    return Err(`Failed to read agent-models.json: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// saveAgentMapping
// ---------------------------------------------------------------------------

/**
 * Atomically write the agent mapping to ~/.devflow/agent-models.json.
 * Creates the directory if needed.
 */
export async function saveAgentMapping(
  devflowDir: string,
  mapping: AgentMappingFile,
): Promise<Result<void, string>> {
  const filePath = path.join(devflowDir, 'agent-models.json');
  try {
    await fs.mkdir(devflowDir, { recursive: true });
    await writeFileAtomicExclusive(filePath, JSON.stringify(mapping, null, 2) + '\n');
    return Ok(undefined);
  } catch (err: unknown) {
    return Err(`Failed to write agent-models.json: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// resolveEffective
// ---------------------------------------------------------------------------

export interface EffectiveConfig {
  /** The model to write to frontmatter. Undefined when no default is available. */
  model: string | undefined;
  /** The effort to write (or null/undefined to remove). */
  effort: string | undefined;
}

/**
 * Compute the effective model/effort for an agent, applying dormancy semantics.
 *
 * Dormancy rule (plan D5):
 *   If the mapping entry's model is an external GPT model (per externalModelIds())
 *   AND proxyEnabled is false → the entry is DORMANT. The shipped default model
 *   is used instead. The entry remains saved.
 *
 * Effort is ALWAYS applied regardless of proxy state.
 *
 * Pure function — no I/O.
 *
 * @param agentName - The agent's short name (e.g., 'coder').
 * @param mapping - The full mapping file.
 * @param shippedDefaults - Map of agent name → shipped default model.
 * @param proxyEnabled - Whether the Devflow proxy is currently active.
 */
export function resolveEffective(
  agentName: string,
  mapping: AgentMappingFile,
  shippedDefaults: Record<string, string>,
  proxyEnabled: boolean,
): EffectiveConfig {
  const entry = mapping.agents[agentName];
  const gptIds = externalModelIds();

  let model: string | undefined;
  if (entry?.model !== undefined) {
    const isGpt = gptIds.includes(entry.model);
    if (isGpt && !proxyEnabled) {
      // Dormant: GPT model configured but proxy is off → fall back to shipped default.
      model = shippedDefaults[agentName];
    } else {
      model = entry.model;
    }
  } else {
    // No mapping entry → use shipped default.
    model = shippedDefaults[agentName];
  }

  const effort = entry?.effort;
  return { model, effort };
}

// ---------------------------------------------------------------------------
// loadShippedDefaults
// ---------------------------------------------------------------------------

/**
 * Load shipped default models from the source agent files.
 * Reads every file in agentsDir() and parses the frontmatter model field.
 * Unknown or malformed files are silently skipped.
 */
export async function loadShippedDefaults(): Promise<Record<string, string>> {
  const sourceDir = agentsDir();
  const defaults: Record<string, string> = {};

  let entries: string[];
  try {
    entries = await fs.readdir(sourceDir);
  } catch {
    return defaults;
  }

  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const agentName = file.slice(0, -3); // strip .md
    try {
      const content = await fs.readFile(path.join(sourceDir, file), 'utf-8');
      const result = readFrontmatterModel(content);
      if (result.ok && result.value) {
        defaults[agentName] = result.value;
      }
    } catch {
      // Silently skip unreadable files
    }
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// reapplyAgentMapping — convergence function
// ---------------------------------------------------------------------------

export interface ReapplyOptions {
  /** Directory containing installed agent *.md files (e.g., ~/.claude/agents/devflow/). */
  installDir: string;
  /** Devflow state directory (e.g., ~/.devflow/). */
  devflowDir: string;
  /** Whether the Devflow proxy is currently enabled. */
  proxyEnabled: boolean;
  /** Optional warning callback. */
  onWarning?: (message: string) => void;
}

export interface ReapplyResult {
  /** Agent names whose installed files were updated. */
  updated: string[];
  /** Agent names whose installed files were already correct (unchanged). */
  unchanged: string[];
  /** Agent names whose installed files were not found (skipped silently). */
  skippedMissing: string[];
  /** Warning messages emitted during processing. */
  warnings: string[];
}

/**
 * Idempotent convergence function: walk every installed agent file and
 * rewrite frontmatter model/effort to match the effective mapping.
 *
 * - Reads shipped defaults LIVE from src/assets/agents/ sources.
 * - Gets the agent name list from the registry (getAllAgentNames()) plus
 *   any mapping entries for agents not in the registry.
 * - Missing installed files → skip silently (recorded in skippedMissing).
 * - Malformed frontmatter → warn and leave file untouched.
 * - DOES NOT store previousModel anywhere (plan D4): computes from shipped defaults.
 */
export async function reapplyAgentMapping(opts: ReapplyOptions): Promise<ReapplyResult> {
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
    opts.onWarning?.(msg);
  };

  const mappingResult = await readAgentMapping(opts.devflowDir, { onWarning: warn });
  if (!mappingResult.ok) {
    warn(`reapplyAgentMapping: failed to read mapping — ${mappingResult.error}`);
    return { updated: [], unchanged: [], skippedMissing: [], warnings };
  }
  const mapping = mappingResult.value;

  const shippedDefaults = await loadShippedDefaults();

  // Build the union of: all registered agent names + all names in the mapping
  // (so agents not yet in the registry but configured are also processed).
  const registryNames = new Set(getAllAgentNames());
  const mappingNames = new Set(Object.keys(mapping.agents));
  const allNames = new Set([...registryNames, ...mappingNames]);

  const updated: string[] = [];
  const unchanged: string[] = [];
  const skippedMissing: string[] = [];

  for (const agentName of allNames) {
    const installPath = path.join(opts.installDir, `${agentName}.md`);

    // Check if installed file exists
    let currentContent: string;
    try {
      currentContent = await fs.readFile(installPath, 'utf-8');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        skippedMissing.push(agentName);
        continue;
      }
      warn(`reapplyAgentMapping: cannot read ${agentName}.md — ${(err as Error).message}`);
      skippedMissing.push(agentName);
      continue;
    }

    const effective = resolveEffective(agentName, mapping, shippedDefaults, opts.proxyEnabled);

    if (effective.model === undefined) {
      // No shipped default and no mapping → nothing to write
      unchanged.push(agentName);
      continue;
    }

    const rewriteResult = rewriteAgentFrontmatter(currentContent, {
      model: effective.model,
      effort: effective.effort ?? null,
    });

    if (!rewriteResult.ok) {
      warn(`reapplyAgentMapping: malformed frontmatter in ${agentName}.md (${rewriteResult.error}) — skipping`);
      skippedMissing.push(agentName); // treated as unprocessable
      continue;
    }

    if (!rewriteResult.value.changed) {
      unchanged.push(agentName);
      continue;
    }

    try {
      await writeFileAtomicExclusive(installPath, rewriteResult.value.content);
      updated.push(agentName);
    } catch (err: unknown) {
      warn(`reapplyAgentMapping: failed to write ${agentName}.md — ${(err as Error).message}`);
    }
  }

  return { updated, unchanged, skippedMissing, warnings };
}

// ---------------------------------------------------------------------------
// revertExternalAgents
// ---------------------------------------------------------------------------

export interface RevertOptions {
  /** Directory containing installed agent *.md files. */
  installDir: string;
  /** Devflow state directory. */
  devflowDir: string;
  /** Optional warning callback. */
  onWarning?: (message: string) => void;
}

/**
 * Revert all installed agent files to their shipped default models.
 * Equivalent to reapplyAgentMapping({proxyEnabled: false}).
 *
 * Used by: proxy --disable, uninstall pre-cleanup.
 */
export async function revertExternalAgents(opts: RevertOptions): Promise<ReapplyResult> {
  return reapplyAgentMapping({
    installDir: opts.installDir,
    devflowDir: opts.devflowDir,
    proxyEnabled: false,
    onWarning: opts.onWarning,
  });
}

// ---------------------------------------------------------------------------
// countExternalMappedAgents
// ---------------------------------------------------------------------------

/**
 * Count the number of mapping entries whose model is an external GPT model.
 * Used by: proxy --status display.
 * Pure function — no I/O.
 */
export function countExternalMappedAgents(mapping: AgentMappingFile): number {
  const gptIds = new Set(externalModelIds());
  let count = 0;
  for (const entry of Object.values(mapping.agents)) {
    if (entry.model !== undefined && gptIds.has(entry.model)) {
      count++;
    }
  }
  return count;
}
