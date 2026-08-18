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
 * Dormancy semantics:
 *   A mapping entry whose model is an external GPT model (classified via
 *   isDormantExternalModel — the complement of isClaudeModelName) materializes
 *   into frontmatter ONLY when proxyEnabled=true. When the proxy is disabled,
 *   the entry stays saved but the SHIPPED DEFAULT model is applied instead.
 *   Effort is orthogonal — it ALWAYS applies regardless of proxy state.
 *
 * Dependency direction:
 *   core/proxy-state ← core/agent-models ← cli commands
 *   (no cycles)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { isDormantExternalModel, isClaudeModelName } from './external-models.js';
import { rewriteAgentFrontmatter, readFrontmatterModel, isValidModelName } from './agent-frontmatter.js';
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
 * Valid effort level identifiers.
 * Invalid values are dropped with a warning on mapping read.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Literal union of valid effort level identifiers. */
export type EffortLevel = typeof EFFORT_LEVELS[number];

/**
 * Membership set typed as ReadonlySet<string> so .has() accepts a plain
 * string argument without a cast — TypeScript's Set<T>.has() requires T, and
 * EFFORT_LEVELS[number] is a literal union, not string (applies ADR-003).
 */
const EFFORT_LEVELS_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);

// ---------------------------------------------------------------------------
// Key migration
// ---------------------------------------------------------------------------

/**
 * Maps old agent keys (form A slugs) to their canonical replacement keys.
 *
 * 13 agents renamed from noun form (coder, reviewer, …) to action-verb form
 * (code, review, …). The canonicalise-agent-keys-v1 migration in migrations.ts
 * calls canonicaliseAgentKeys() to rewrite ~/.devflow/agent-models.json on the
 * user's first init after upgrading.
 *
 * PROTOTYPE SAFETY: Object.create(null) prevents prototype-pollution.
 * Every lookup MUST use Object.hasOwn — never key in LEGACY_AGENT_KEYS or
 * direct bracket access. `--set constructor` would otherwise return a function
 * that flows into path.join (the object-literal lookup on argv trap).
 *
 * DORMANCY: entries here are stored whether or not the key rename has been
 * applied to the file yet. canonicaliseAgentKeys() is idempotent, so
 * double-execution from concurrent sessions is a harmless no-op — the second
 * run finds the file already migrated and makes zero writes.
 */
export const LEGACY_AGENT_KEYS: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    // Phase 4 — agent-action-verbs rename (old slug → new slug)
    'coder':        'code',
    'designer':     'design',
    'evaluator':    'evaluate',
    'researcher':   'research',
    'reviewer':     'review',
    'scrutinizer':  'scrutinize',
    'simplifier':   'simplify',
    'skimmer':      'skim',
    'synthesizer':  'synthesize',
    'tester':       'test',
    'triager':      'triage',
    'validator':    'validate',
    'bug-analyzer': 'diagnose',
  },
);

/**
 * Canonicalise agent keys in a raw agents map by applying LEGACY_AGENT_KEYS.
 *
 * For each old key found in the map:
 *   - If the new (canonical) key is NOT already present: rename old → new.
 *   - If the new key IS already present (collision): new wins, old dropped, one warning.
 *
 * Collision detection is against the ORIGINAL map so results are order-independent.
 *
 * The function is pure and idempotent: calling it twice on the same input
 * produces the same result as calling it once (idempotent under concurrent execution).
 *
 * __proto__ is skipped on both read and write sides — setting it would mutate
 * the prototype instead of creating a property, violating byte-identity.
 *
 * @param rawAgents - The `agents` field from the raw JSON file (any value types).
 * @param onWarning - Optional callback for collision warnings.
 * @returns { agents, didMutate } — caller persists iff didMutate is true.
 */
export function canonicaliseAgentKeys(
  rawAgents: Record<string, unknown>,
  onWarning?: (msg: string) => void,
): { agents: Record<string, unknown>; didMutate: boolean } {
  const warn = onWarning ?? (() => undefined);

  // Fast path: no legacy keys defined — skip without reading input.
  if (Object.keys(LEGACY_AGENT_KEYS).length === 0) {
    return { agents: rawAgents, didMutate: false };
  }

  // Snapshot the original keys for collision detection (order-independent result).
  const originalKeys = new Set(Object.keys(rawAgents));

  const result: Record<string, unknown> = { ...rawAgents };
  let didMutate = false;

  for (const oldKey of originalKeys) {
    // Skip the __proto__ key — assigning to it sets the prototype, not a property.
    if (oldKey === '__proto__') continue;
    if (!Object.hasOwn(LEGACY_AGENT_KEYS, oldKey)) continue;

    const newKey = LEGACY_AGENT_KEYS[oldKey] as string;
    // Guard new key for the same reason: __proto__ must not be created.
    if (newKey === '__proto__') continue;

    if (originalKeys.has(newKey)) {
      // Collision: new (canonical) key already present → new wins, old dropped, one warning.
      warn(
        `agent-models: migrating key '${oldKey}' → '${newKey}' — '${newKey}' already exists, keeping existing value and dropping '${oldKey}'`,
      );
    } else {
      result[newKey] = result[oldKey];
    }
    // Remove the legacy key regardless of collision outcome.
    delete result[oldKey];
    didMutate = true;
  }

  return { agents: result, didMutate };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Per-agent mapping entry. All fields optional — omit to inherit defaults. */
export interface AgentMapping {
  model?: string;
  effort?: EffortLevel;
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

    // Guard: agents must be a plain object — not null, not an array.
    // Array.isArray passes every typeof === 'object' check and causes wrong
    // entries (numeric indices) to leak into the mapping silently.
    const rawAgents =
      typeof data.agents === 'object' && data.agents !== null && !Array.isArray(data.agents)
        ? (data.agents as Record<string, unknown>)
        : {};

    const agents: Record<string, AgentMapping> = {};
    for (const [name, entry] of Object.entries(rawAgents)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const raw = entry as Record<string, unknown>;
      const mapping: AgentMapping = {};

      if (typeof raw.model === 'string') {
        // Tighten to the same charset used by rewriteAgentFrontmatter.
        // The effort field is enum-validated below; model must be equally strict.
        // An invalid entry is dropped with a warning rather than silently
        // persisting and permanently poisoning that agent on every reapply.
        if (isValidModelName(raw.model)) {
          mapping.model = raw.model;
        } else {
          warn(`agent-models: invalid-model name for agent "${name}" — dropping entry`);
        }
      }

      if (typeof raw.effort === 'string') {
        if (EFFORT_LEVELS_SET.has(raw.effort)) {
          // Sound narrowing: has() proved membership; EffortLevel is a literal
          // subtype of string so the assertion is not a compensating cast.
          mapping.effort = raw.effort as EffortLevel;
        } else {
          warn(`agent-models: dropping invalid effort "${raw.effort}" for agent "${name}"`);
        }
      }

      agents[name] = mapping;
    }

    // Apply key migration: old keys (e.g. 'coder', 'reviewer') are transparently renamed
    // on every read, covering all four call sites (agents.ts --set, proxy.ts, init.ts × 2).
    const { agents: migratedAgents } = canonicaliseAgentKeys(
      agents as Record<string, unknown>,
      warn,
    );

    return Ok({ version: 1, agents: migratedAgents as Record<string, AgentMapping> });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return Ok({ version: 1, agents: {} });
    }
    return Err(`Failed to read agent-models.json: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// readInstalledAgentNames
// ---------------------------------------------------------------------------

/**
 * Return the set of agent names currently installed in `installDir`.
 *
 * Uses a single fs.readdir call — O(dir) not O(agents) — replacing the
 * previous per-name fs.access loop (T8 assertion: exactly ONE readdir,
 * ZERO fs.access calls).
 *
 * A missing directory returns an empty set rather than throwing (ENOENT is
 * not an error — the install dir may not exist on a fresh machine before
 * `devflow init` runs). Any other OS error is re-thrown.
 *
 * @param installDir - Path to ~/.claude/agents/devflow (or equivalent).
 */
export async function readInstalledAgentNames(
  installDir: string,
): Promise<ReadonlySet<string>> {
  try {
    const entries = await fs.readdir(installDir);
    return new Set(
      entries
        .filter((e: string) => e.endsWith('.md'))
        .map((e: string) => e.slice(0, -'.md'.length)),
    );
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Set<string>();
    throw err;
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
  /** The effort to write (or undefined to remove). */
  effort: EffortLevel | undefined;
}

/**
 * Compute the effective model/effort for an agent, applying dormancy semantics.
 *
 * Dormancy rule (plan D5):
 *   If the mapping entry's model is an external GPT model (classified via
 *   isDormantExternalModel) AND proxyEnabled is false → the entry is DORMANT.
 *   The shipped default model is used instead. The entry remains saved.
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

  let model: string | undefined;
  if (entry?.model !== undefined) {
    // Dormant: external model configured but proxy is off → fall back to shipped default.
    model = isDormantExternalModel(entry.model, proxyEnabled)
      ? shippedDefaults[agentName]
      : entry.model;
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

  const mdFiles = entries.filter(file => file.endsWith('.md'));

  const pairs = await Promise.all(
    mdFiles.map(async (file): Promise<readonly [string, string] | null> => {
      const agentName = file.slice(0, -3); // strip .md
      try {
        const content = await fs.readFile(path.join(sourceDir, file), 'utf-8');
        const result = readFrontmatterModel(content);
        if (result.ok && result.value) {
          return [agentName, result.value] as const;
        }
      } catch {
        // Silently skip unreadable files
      }
      return null;
    })
  );

  for (const pair of pairs) {
    if (pair !== null) {
      defaults[pair[0]] = pair[1];
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
  /**
   * Agent names skipped because their model name in agent-models.json is invalid.
   * Distinct bucket so callers can point the user at the right artifact
   * (agent-models.json, not the installed .md file).
   */
  invalidMapping: string[];
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
    return { updated: [], unchanged: [], skippedMissing: [], invalidMapping: [], warnings };
  }
  const mapping = mappingResult.value;

  const shippedDefaults = await loadShippedDefaults();

  // Build the union of: all registered agent names + all names in the mapping
  // (so agents not yet in the registry but configured are also processed).
  const registryNames = new Set(getAllAgentNames());
  const mappingNames = new Set(Object.keys(mapping.agents));
  const allNames = new Set([...registryNames, ...mappingNames]);

  // 'write-error' = warning emitted but agent placed in no bucket (original semantics).
  // 'invalid-mapping' = model name in agent-models.json was invalid.
  type AgentBucket = 'updated' | 'unchanged' | 'skipped' | 'write-error' | 'invalid-mapping';
  type AgentOutcome = { bucket: AgentBucket; localWarnings: string[] };

  // Stable iteration order — Set preserves insertion order, array fixes it for the map.
  const allNamesList = [...allNames];

  const perResults = await Promise.all(
    allNamesList.map(async (agentName): Promise<AgentOutcome> => {
      const localWarnings: string[] = [];
      // Emit to callback immediately for live feedback; collect for deterministic aggregation.
      const localWarn = (msg: string): void => {
        localWarnings.push(msg);
        opts.onWarning?.(msg);
      };

      const installPath = path.join(opts.installDir, `${agentName}.md`);

      let currentContent: string;
      try {
        currentContent = await fs.readFile(installPath, 'utf-8');
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          localWarn(`reapplyAgentMapping: cannot read ${agentName}.md — ${(err as Error).message}`);
        }
        return { bucket: 'skipped', localWarnings };
      }

      const effective = resolveEffective(agentName, mapping, shippedDefaults, opts.proxyEnabled);

      if (effective.model === undefined) {
        // No shipped default and no mapping → nothing to write
        return { bucket: 'unchanged', localWarnings };
      }

      const rewriteResult = rewriteAgentFrontmatter(currentContent, {
        model: effective.model,
        effort: effective.effort ?? null,
      });

      if (!rewriteResult.ok) {
        if (rewriteResult.error === 'invalid-model') {
          // The invalid model came from agent-models.json (the mapping),
          // not from the installed .md file. Name the real artifact so the user
          // knows where to look; file under invalidMapping (not skippedMissing).
          localWarn(
            `reapplyAgentMapping: invalid-model name in agent-models.json for "${agentName}" — skipping`
          );
          return { bucket: 'invalid-mapping', localWarnings };
        }
        localWarn(
          `reapplyAgentMapping: malformed frontmatter in ${agentName}.md (${rewriteResult.error}) — skipping`
        );
        return { bucket: 'skipped', localWarnings }; // treated as unprocessable
      }

      if (!rewriteResult.value.changed) {
        return { bucket: 'unchanged', localWarnings };
      }

      try {
        await writeFileAtomicExclusive(installPath, rewriteResult.value.content);
        return { bucket: 'updated', localWarnings };
      } catch (err: unknown) {
        localWarn(`reapplyAgentMapping: failed to write ${agentName}.md — ${(err as Error).message}`);
        return { bucket: 'write-error', localWarnings };
      }
    })
  );

  // Aggregate in allNamesList order — deterministic warning order and bucket assignment.
  const updated: string[] = [];
  const unchanged: string[] = [];
  const skippedMissing: string[] = [];
  const invalidMapping: string[] = [];

  for (let i = 0; i < allNamesList.length; i++) {
    const agentName = allNamesList[i];
    const { bucket, localWarnings } = perResults[i];
    warnings.push(...localWarnings);
    switch (bucket) {
      case 'updated':         updated.push(agentName); break;
      case 'unchanged':       unchanged.push(agentName); break;
      case 'skipped':         skippedMissing.push(agentName); break;
      case 'invalid-mapping': invalidMapping.push(agentName); break;
      case 'write-error':     break; // warning already emitted; no bucket (original semantics)
    }
  }

  return { updated, unchanged, skippedMissing, invalidMapping, warnings };
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
 * Count the number of mapping entries whose model requires the Devflow proxy
 * (i.e., is not a Claude model name and not 'default').
 *
 * Uses the complement predicate (isClaudeModelName — isDormantExternalModel's
 * building block) so that alias-shaped names are correctly counted as
 * external — preventing "External-mapped agents: none" when a user has
 * pinned every agent to a non-Claude alias (avoids AC-C6 live-correctness
 * bug where discovery-driven counting would miss such entries).
 *
 * Used by: proxy --status display.
 * Pure function — no I/O.
 */
export function countExternalMappedAgents(mapping: AgentMappingFile): number {
  let count = 0;
  for (const entry of Object.values(mapping.agents)) {
    if (isDormantExternalModel(entry.model, false)) {
      count++;
    }
  }
  return count;
}
