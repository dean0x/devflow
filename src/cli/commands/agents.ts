/**
 * devflow agents — Manage per-agent model/effort assignments.
 *
 * applies ADR-013: CLI-layer module; core logic in src/core/agent-models.ts.
 * avoids PF-014: never process.exit() inside a finally-guarded scope (terminal.ts
 *   handles cleanup in Promise resolve, not process.exit).
 *
 * Branding note: "subswitch" must NEVER appear in user-visible strings.
 * User-facing vocabulary: "external model routing" / "Devflow proxy" /
 * "GPT models via your OpenAI/Codex subscription".
 *
 * Subcommands:
 *   devflow agents           → interactive TUI (requires TTY)
 *   devflow agents --list    → tabular list (safe in non-TTY)
 *   devflow agents --set <agent> --model <m> --effort <e>
 *   devflow agents --reset [--yes]
 */

import { Command } from 'commander';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  EFFORT_LEVELS,
  LEGACY_AGENT_KEYS,
  readAgentMapping,
  saveAgentMapping,
  reapplyAgentMapping,
  loadShippedDefaults,
  readInstalledAgentNames,
  type AgentMappingFile,
  type AgentMapping,
  type EffortLevel,
} from '../../core/agent-models.js';
import {
  CLAUDE_MODEL_ALIASES,
  isDormantExternalModel,
} from '../../core/external-models.js';
import {
  classifyAgentState,
  AGENT_STATE_LABELS,
  type AgentState,
} from '../../core/agent-state.js';
import { isValidModelName } from '../../core/agent-frontmatter.js';
import { isProxyEnabled } from '../../core/proxy-state.js';
import { getAllAgentNames } from '../../core/plugins.js';
import {
  getClaudeDirectory,
  getDevFlowDirectory,
} from '../../targets/claude-code/claude-paths.js';
import {
  buildRow,
  buildModelCycle,
  buildPickerNameMap,
  computeViewportHeight,
  type AgentsViewState,
  type AgentRow,
} from '../agents-view/index.js';
import { stripAnsi } from '../../hud/colors.js';
import {
  discoverExternalModels,
  getExternalModelsCached,
  type ExternalModelCatalog,
} from '../../core/model-discovery.js';
import { modelCacheDir } from '../../core/cache.js';

// ---------------------------------------------------------------------------
// Result type (local pattern)
// ---------------------------------------------------------------------------

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Pure helper: validateSetArgs
// ---------------------------------------------------------------------------

export interface SetArgs {
  model?: string;
  effort?: string;
}

/**
 * Validate --set arguments against the given catalog.
 *
 * When catalog is known (live cache hit): reject models absent from
 *   'default' ∪ CLAUDE_MODEL_ALIASES ∪ catalog.selectableNames.
 *
 * When catalog is unknown ({known:false}, cache miss): accept any model name —
 *   the existing dormancy warning at the call site fires for non-Claude names.
 *   This preserves the configure-first-then-enable provisioning flow and keeps
 *   `--set` at zero subprocess cost (AC-P9: cache-only, 0 spawns).
 *
 * Returns Err when:
 *  - neither model nor effort is provided
 *  - model is unknown AND catalog is known
 *  - effort is unknown (not in EFFORT_LEVELS ∪ 'default')
 */
export function validateSetArgs(
  args: SetArgs,
  catalog: ExternalModelCatalog = { known: false },
): Result<SetArgs> {
  const { model, effort } = args;

  if (model === undefined && effort === undefined) {
    return Err('Specify at least one of --model or --effort');
  }

  if (model !== undefined) {
    // Charset gate: applied at every trust boundary regardless of catalog state.
    // Rejects injection payloads (newlines, YAML metacharacters) before they can
    // propagate to agent-models.json or agent frontmatter. avoids PF-017: allowlist
    // what the callee actually consumes rather than denylist individual bad chars.
    if (!isValidModelName(model)) {
      return Err(
        `Invalid model name "${model}". Model names must start with an alphanumeric character ` +
        `and contain only alphanumeric, dot, underscore, or hyphen characters (max 64 chars).`
      );
    }

    if (catalog.known) {
      // Full validation against the discovered catalog.
      const valid: string[] = ['default', ...CLAUDE_MODEL_ALIASES, ...catalog.selectableNames];
      if (!valid.includes(model)) {
        return Err(
          `Unknown model "${model}". Valid: ${valid.join(', ')}`
        );
      }
    }
    // else: catalog unknown (cache miss) → charset-valid name accepted; dormancy
    // warning fires at agents.ts call site if the proxy is off.
  }

  if (effort !== undefined) {
    const valid: string[] = ['default', ...EFFORT_LEVELS];
    if (!valid.includes(effort)) {
      return Err(
        `Unknown effort "${effort}". Valid: ${valid.join(', ')}`
      );
    }
  }

  return Ok(args);
}

// ---------------------------------------------------------------------------
// Pure helper: applySetMapping
// ---------------------------------------------------------------------------

/**
 * Return a new AgentMappingFile with the given model/effort applied to agentName.
 * 'default' clears the respective key.
 * Does not mutate the input mapping.
 */
export function applySetMapping(
  mapping: AgentMappingFile,
  agentName: string,
  args: SetArgs,
): AgentMappingFile {
  const existing: AgentMapping = { ...mapping.agents[agentName] };

  if (args.model !== undefined) {
    if (args.model === 'default') {
      delete existing.model;
    } else {
      existing.model = args.model;
    }
  }

  if (args.effort !== undefined) {
    if (args.effort === 'default') {
      delete existing.effort;
    } else {
      // Sound narrowing: validateSetArgs already confirmed args.effort is a valid
      // EffortLevel before this function is called. SetArgs.effort is string to keep
      // the CLI entry type permissive; the assertion here is not a compensating cast.
      existing.effort = args.effort as EffortLevel;
    }
  }

  return {
    version: 1,
    agents: {
      ...mapping.agents,
      [agentName]: existing,
    },
  };
}

// ---------------------------------------------------------------------------
// Pure helper: buildListRows
// ---------------------------------------------------------------------------

/** D-001: RowState uses AgentState from agent-state (single source of truth for both --list and TUI). */
export interface ListRow {
  name: string;
  defaultModel: string;
  configured: string;
  effort: string;
  state: AgentState;
}

export interface BuildListRowsInput {
  agentNames: string[];
  mapping: AgentMappingFile;
  installDir: string;
  shippedDefaults: Record<string, string>;
  proxyEnabled: boolean;
}

/**
 * Build list row data for each agent.
 * Uses readInstalledAgentNames for a single readdir (Foundation B).
 */
export async function buildListRows(
  input: BuildListRowsInput,
): Promise<ListRow[]> {
  const { agentNames, mapping, installDir, shippedDefaults, proxyEnabled } = input;

  // Foundation B: one readdir replaces N fs.access calls.
  const installedNames = await readInstalledAgentNames(installDir);

  const rows: ListRow[] = agentNames.map((name): ListRow => {
    const entry = mapping.agents[name];
    const configured = entry?.model ?? 'default';
    const effort = entry?.effort ?? 'default';
    const defaultModel = shippedDefaults[name] ?? 'unknown';
    const installed = installedNames.has(name);
    // inRegistry is always true here — agentNames comes from the registry.
    const state = classifyAgentState({ configured, proxyEnabled, installed, inRegistry: true });
    return { name, defaultModel, configured, effort, state };
  });

  return rows;
}

// ---------------------------------------------------------------------------
// --list output formatting
// ---------------------------------------------------------------------------

function formatListOutput(rows: ListRow[], proxyEnabled: boolean): string {
  const lines: string[] = [];
  const AGENT_W = 20;
  const DEFAULT_W = 10;
  const CONFIGURED_W = 16;
  const EFFORT_W = 12;

  // Header
  lines.push(
    [
      color.gray('AGENT'.padEnd(AGENT_W)),
      color.gray('DEFAULT'.padEnd(DEFAULT_W)),
      color.gray('CONFIGURED'.padEnd(CONFIGURED_W)),
      color.gray('EFFORT'.padEnd(EFFORT_W)),
      color.gray('STATE'),
    ].join('  ')
  );

  // Rows
  for (const row of rows) {
    let stateStr: string;
    switch (row.state) {
      case 'active':
        stateStr = color.green(AGENT_STATE_LABELS['active']);
        break;
      case 'saved-inactive':
        stateStr = color.yellow(AGENT_STATE_LABELS['saved-inactive']);
        break;
      case 'not-installed':
        stateStr = color.dim(AGENT_STATE_LABELS['not-installed']);
        break;
      case 'unknown':
        stateStr = color.dim(AGENT_STATE_LABELS['unknown']);
        break;
      default: {
        const _: never = row.state;
        void _;
        stateStr = '';
      }
    }

    // Strip escape sequences from all user-derived fields before column
    // arithmetic and terminal output to prevent injection via model IDs.
    lines.push(
      [
        stripAnsi(row.name).padEnd(AGENT_W).slice(0, AGENT_W),
        stripAnsi(row.defaultModel).padEnd(DEFAULT_W).slice(0, DEFAULT_W),
        stripAnsi(row.configured).padEnd(CONFIGURED_W).slice(0, CONFIGURED_W),
        stripAnsi(row.effort).padEnd(EFFORT_W).slice(0, EFFORT_W),
        stateStr,
      ].join('  ')
    );
  }

  const installed = rows.filter(r => r.state !== 'not-installed').length;
  const configured = rows.filter(r => r.configured !== 'default' || r.effort !== 'default').length;
  const proxyLabel = proxyEnabled ? color.green('enabled') : color.yellow('disabled');
  lines.push('');
  lines.push(
    `${installed}/${rows.length} installed · ${configured} configured · proxy: ${proxyLabel}`
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Catalog source selector
// ---------------------------------------------------------------------------

/**
 * Return the synchronous model catalog for the interactive TUI.
 *
 * Proxy-off path: cache-only, zero spawns (getExternalModelsCached).
 *   This is the same source as --set, preserving the
 *   configure-first-then-enable flow for dormant GPT mappings.
 * Proxy-on path: returns {known:false}; the caller starts async discovery
 *   via discoverExternalModels so the spinner can overlap TUI init.
 *
 * Exported as a testable seam: allows tests to assert that the proxy-off
 * path reads from the cache rather than returning a hard-coded {known:false}.
 */
export function selectCatalog(proxyEnabled: boolean, cacheDir: string): ExternalModelCatalog {
  if (proxyEnabled) return { known: false };
  return getExternalModelsCached(cacheDir);
}

// ---------------------------------------------------------------------------
// TUI state builder
// ---------------------------------------------------------------------------

/**
 * Build the initial AgentsViewState for the interactive TUI.
 *
 * Builds modelCycle ONCE from the catalog and stores it in state.
 * The pure reducer reads state.modelCycle directly — never reallocates per
 * keypress (AC-P6).
 */
async function buildTuiState(
  agentNames: string[],
  mapping: AgentMappingFile,
  shippedDefaults: Record<string, string>,
  proxyEnabled: boolean,
  catalog: ExternalModelCatalog,
  installDir: string,
): Promise<AgentsViewState> {
  // Build the cycle and picker-name map once — shared across all rows and all keypresses.
  const modelCycle = buildModelCycle(catalog);
  const pickerNameMap = buildPickerNameMap(catalog);

  // Foundation B: one readdir for install state of all agents.
  const installedNames = await readInstalledAgentNames(installDir);

  // Registry rows (in sorted order)
  const registrySet = new Set(agentNames);
  const rows: AgentRow[] = agentNames.map(name => {
    const entry = mapping.agents[name];
    return buildRow({
      name,
      shippedDefault: shippedDefaults[name] ?? 'unknown',
      savedModel: entry?.model,
      savedEffort: entry?.effort,
      proxyEnabled,
      modelCycle,
      pickerNameMap,
      installed: installedNames.has(name),
      inRegistry: true,
    });
  });

  // Orphan rows: keys in agent-models.json not present in the registry.
  // Appended at the end so they are visually separated from known agents.
  for (const orphanKey of Object.keys(mapping.agents)) {
    if (registrySet.has(orphanKey)) continue;
    const entry = mapping.agents[orphanKey];
    rows.push(buildRow({
      name: orphanKey,
      shippedDefault: 'unknown',
      savedModel: entry?.model,
      savedEffort: entry?.effort,
      proxyEnabled,
      modelCycle,
      pickerNameMap,
      installed: installedNames.has(orphanKey),
      inRegistry: false,
    }));
  }

  return {
    rows,
    cursor: 0,
    activeField: 'model',
    viewportOffset: 0,
    viewportHeight: computeViewportHeight(process.stdout.rows ?? 24),
    proxyEnabled,
    modelCycle,
  };
}

// ---------------------------------------------------------------------------
// mergeTuiRowsIntoMapping — pure helper (Fix 2)
// ---------------------------------------------------------------------------

/**
 * Merge dirty TUI rows back into the original mapping.
 *
 * Only rows with changed fields update the mapping — untouched rows (including
 * dormant GPT entries) are preserved byte-identical. This is the "inertness"
 * guarantee of Fix 2: a row that was never edited produces no write.
 *
 * Pure function — no I/O, no side effects.
 */
export function mergeTuiRowsIntoMapping(
  rows: readonly AgentRow[],
  originalMapping: AgentMappingFile,
): AgentMappingFile {
  const newAgents: Record<string, AgentMapping> = { ...originalMapping.agents };

  for (const row of rows) {
    const modelDirty = row.configuredModel !== row.originalModel;
    const effortDirty = row.configuredEffort !== row.originalEffort;

    if (!modelDirty && !effortDirty) continue;

    const entry: AgentMapping = { ...newAgents[row.name] };

    if (modelDirty) {
      if (row.configuredModel === 'default') {
        delete entry.model;
      } else {
        entry.model = row.configuredModel;
      }
    }
    if (effortDirty) {
      if (row.configuredEffort === 'default') {
        delete entry.effort;
      } else {
        entry.effort = row.configuredEffort;
      }
    }

    // Remove empty entries (no model, no effort → no deviation from defaults)
    if (Object.keys(entry).length === 0) {
      delete newAgents[row.name];
    } else {
      newAgents[row.name] = entry;
    }
  }

  return { version: 1, agents: newAgents };
}

// ---------------------------------------------------------------------------
// Apply TUI save result
// ---------------------------------------------------------------------------

async function applyTuiSave(
  tuiState: AgentsViewState,
  originalMapping: AgentMappingFile,
  devflowDir: string,
  installDir: string,
  proxyEnabled: boolean,
): Promise<Result<{ updated: number; unchanged: number; warnings: string[] }>> {
  const newMapping = mergeTuiRowsIntoMapping(tuiState.rows, originalMapping);
  const persistResult = await saveAgentMapping(devflowDir, newMapping);
  if (!persistResult.ok) {
    return Err(persistResult.error);
  }

  const reapplyResult = await reapplyAgentMapping({
    installDir,
    devflowDir,
    proxyEnabled,
  });

  return Ok({
    updated: reapplyResult.updated.length,
    unchanged: reapplyResult.unchanged.length,
    warnings: reapplyResult.warnings,
  });
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

interface AgentsOptions {
  list?: boolean;
  set?: string;
  model?: string;
  effort?: string;
  reset?: boolean;
  yes?: boolean;
}

export const agentsCommand = new Command('agents')
  .description(
    'Manage per-agent model/effort assignments for external model routing'
  )
  .option('--list', 'List all agents with their current configuration')
  .option('--set <agent>', 'Set model/effort for a specific agent')
  .option('--model <model>', 'Model to assign (use with --set)')
  .option('--effort <level>', 'Effort level to assign (use with --set)')
  .option('--reset', 'Clear all agent customisations and restore defaults')
  .option('--yes', 'Skip confirmation prompt (use with --reset)')
  .action(async (options: AgentsOptions) => {
    const claudeDir = getClaudeDirectory();
    const devflowDir = getDevFlowDirectory();
    const installDir = path.join(claudeDir, 'agents', 'devflow');
    // Cache directory for model discovery — authoritative path from cache.ts (avoids PF-013).
    const cacheDir = modelCacheDir(devflowDir);
    // Log path mirrors proxy.ts for unified proxy diagnostics.
    const logPath = path.join(devflowDir, 'logs', 'proxy.log');

    const mappingResult = await readAgentMapping(devflowDir, {
      onWarning: (msg) => p.log.warn(msg),
    });
    if (!mappingResult.ok) {
      p.log.error(`Failed to read agent mapping: ${mappingResult.error}`);
      process.exitCode = 1;
      return;
    }
    const mapping = mappingResult.value;

    const proxyEnabled = await isProxyEnabled(devflowDir);
    const shippedDefaults = await loadShippedDefaults();

    // ── --list ──────────────────────────────────────────────────────────────
    if (options.list) {
      const agentNames = getAllAgentNames().sort();
      const rows = await buildListRows({
        agentNames,
        mapping,
        installDir,
        shippedDefaults,
        proxyEnabled,
      });
      process.stdout.write(formatListOutput(rows, proxyEnabled) + '\n');
      return;
    }

    // ── --reset ─────────────────────────────────────────────────────────────
    if (options.reset) {
      const isInteractive =
        process.stdin.isTTY && process.stdout.isTTY;

      let confirmed: boolean;
      if (options.yes) {
        confirmed = true;
      } else if (!isInteractive) {
        p.log.error(
          'Non-TTY environment: pass --yes to confirm reset without a prompt.'
        );
        process.exitCode = 1;
        return;
      } else {
        const answer = await p.confirm({
          message:
            'Reset all agent model/effort customisations to shipped defaults?',
          initialValue: false,
        });
        if (p.isCancel(answer)) {
          p.outro(color.dim('Cancelled.'));
          return;
        }
        confirmed = answer as boolean;
      }

      if (!confirmed) {
        p.outro(color.dim('No changes made.'));
        return;
      }

      const emptyMapping: AgentMappingFile = { version: 1, agents: {} };
      const saveResult = await saveAgentMapping(devflowDir, emptyMapping);
      if (!saveResult.ok) {
        p.log.error(`Failed to save mapping: ${saveResult.error}`);
        process.exitCode = 1;
        return;
      }

      const reapplyResult = await reapplyAgentMapping({
        installDir,
        devflowDir,
        proxyEnabled,
      });

      for (const warn of reapplyResult.warnings) {
        p.log.warn(warn);
      }
      p.outro(
        `Reset complete. Updated ${color.green(String(reapplyResult.updated.length))} agent${reapplyResult.updated.length !== 1 ? 's' : ''}.`
      );
      return;
    }

    // ── --set ────────────────────────────────────────────────────────────────
    if (options.set) {
      // Transparently rewrite legacy agent names to their canonical counterparts,
      // mirroring how parsePluginSelection handles legacy plugin names.
      let agentName = options.set;
      if (Object.hasOwn(LEGACY_AGENT_KEYS, agentName)) {
        const canonical = LEGACY_AGENT_KEYS[agentName] as string;
        p.log.info(`Agent '${agentName}' has been renamed to '${canonical}' — using canonical name.`);
        agentName = canonical;
      }

      // Validate agent name
      const knownAgents = getAllAgentNames();
      const knownMapping = Object.keys(mapping.agents);
      const allKnown = new Set([...knownAgents, ...knownMapping]);
      if (!allKnown.has(agentName)) {
        p.log.error(
          `Unknown agent "${agentName}". Valid: ${[...allKnown].sort().join(', ')}`
        );
        process.exitCode = 1;
        return;
      }

      // Cache-only discovery — 0 spawns (AC-P9). On cache miss, catalog is
      // {known:false} and validateSetArgs accepts any non-Claude name (the
      // dormancy warning below fires if needed). This preserves the
      // configure-first-then-enable provisioning flow.
      const setCatalog = getExternalModelsCached(cacheDir);

      const validation = validateSetArgs(
        { model: options.model, effort: options.effort },
        setCatalog,
      );
      if (!validation.ok) {
        p.log.error(validation.error);
        process.exitCode = 1;
        return;
      }

      const newMapping = applySetMapping(mapping, agentName, {
        model: options.model,
        effort: options.effort,
      });

      const saveResult = await saveAgentMapping(devflowDir, newMapping);
      if (!saveResult.ok) {
        p.log.error(`Failed to save mapping: ${saveResult.error}`);
        process.exitCode = 1;
        return;
      }

      const reapplyResult = await reapplyAgentMapping({
        installDir,
        devflowDir,
        proxyEnabled,
      });

      // Warn on non-Claude model while proxy off.
      // Distinguish: catalog-known (verified dormant) vs cache-miss (unverified).
      // On a cache miss "dormant" implies the model will work when the proxy is
      // enabled — that is actively wrong for a typo or misremembered model ID.
      if (isDormantExternalModel(options.model, proxyEnabled)) {
        if (setCatalog.known) {
          p.log.warn(
            `GPT model saved — inactive until you run ${color.bold('devflow proxy --enable')}`
          );
        } else {
          // Cache miss: model name was not verified against the live catalog.
          p.log.warn(
            `Model saved but not yet verified against the external catalog (cache cold or proxy off). ` +
            `Run ${color.bold('devflow proxy --enable')} then ` +
            `${color.bold('devflow agents --list')} to confirm the model is recognised.`
          );
        }
      }

      for (const warn of reapplyResult.warnings) {
        p.log.warn(warn);
      }

      const updatedCount = reapplyResult.updated.length;
      const unchangedCount = reapplyResult.unchanged.length;
      p.outro(
        `Updated ${color.green(String(updatedCount))} agent${updatedCount !== 1 ? 's' : ''}, ` +
        `${color.dim(`${unchangedCount} unchanged`)}.`
      );
      return;
    }

    // ── Bare `devflow agents` ────────────────────────────────────────────────
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (!isInteractive) {
      // Non-TTY: print list and exit 1 with note
      const agentNames = getAllAgentNames().sort();
      const rows = await buildListRows({
        agentNames,
        mapping,
        installDir,
        shippedDefaults,
        proxyEnabled,
      });
      process.stdout.write(formatListOutput(rows, proxyEnabled) + '\n');
      process.stderr.write(
        'Note: interactive view requires a terminal. Use --list for non-TTY output.\n'
      );
      process.exitCode = 1;
      return;
    }

    // Interactive TUI
    //
    // Start discovery without awaiting — overlaps with TUI initialization work.
    // Only in the interactive path: --list, --set, --reset never discover (AC-P4).
    // Proxy-off: cache-only via selectCatalog (0 spawns, same source as --set).
    // Proxy-on: live async discovery via discoverExternalModels.
    const discoveryPromise: Promise<ExternalModelCatalog> = proxyEnabled
      ? discoverExternalModels(cacheDir, logPath)
      : Promise.resolve(selectCatalog(false, cacheDir));

    p.intro(color.bgCyan(color.black(' Devflow Agents ')));

    const agentNames = getAllAgentNames().sort();

    // Await the catalog. Show a spinner only if discovery exceeds 250 ms so the
    // TUI never sits silently. On fast cache hits (typical) no spinner appears.
    const DISCOVERY_SPINNER_DELAY_MS = 250;
    let catalog: ExternalModelCatalog;
    type RaceResult =
      | { kind: 'done'; catalog: ExternalModelCatalog }
      | { kind: 'timeout' };
    // Capture the timer so we can clear it on the fast path. Without
    // clearTimeout, a fast cache hit leaves a 250ms handle pending and keeps
    // the event loop alive after the TUI resolves.
    let spinnerTimer: ReturnType<typeof setTimeout> | undefined;
    const raceOutcome = await Promise.race<RaceResult>([
      discoveryPromise.then(c => ({ kind: 'done' as const, catalog: c })),
      new Promise<RaceResult>(r => {
        spinnerTimer = setTimeout(() => r({ kind: 'timeout' }), DISCOVERY_SPINNER_DELAY_MS);
      }),
    ]);
    if (raceOutcome.kind === 'done') {
      // Fast path: disarm the pending timer so it does not hold the event loop.
      clearTimeout(spinnerTimer);
      catalog = raceOutcome.catalog;
    } else {
      // Slow path: timer has already fired; show a spinner for the remaining wait.
      // try/finally ensures spinner.stop() runs even if discoveryPromise rejects.
      const spinner = p.spinner();
      spinner.start('Discovering available GPT models…');
      try {
        catalog = await discoveryPromise;
      } finally {
        spinner.stop('');
      }
    }

    const tuiState = await buildTuiState(
      agentNames,
      mapping,
      shippedDefaults,
      proxyEnabled,
      catalog,
      installDir,
    );

    // Lazy-import terminal to avoid loading readline/tty in non-TTY paths
    const { runAgentsTui } = await import('../agents-view/terminal.js');
    const result = await runAgentsTui(tuiState);

    if (result.action === 'cancel') {
      p.outro(color.dim('No changes made.'));
      return;
    }

    // Save
    const saveResult = await applyTuiSave(
      result.state,
      mapping,
      devflowDir,
      installDir,
      proxyEnabled,
    );
    if (!saveResult.ok) {
      p.log.error(`Save failed: ${saveResult.error}`);
      process.exitCode = 1;
      return;
    }

    const { updated, unchanged, warnings } = saveResult.value;
    for (const warn of warnings) {
      p.log.warn(warn);
    }
    p.outro(
      `Updated ${color.green(String(updated))} agent${updated !== 1 ? 's' : ''}, ` +
      `${color.dim(`${unchanged} unchanged`)}.`
    );
  });
