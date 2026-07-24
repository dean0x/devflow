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
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  CLAUDE_MODEL_ALIASES,
  EFFORT_LEVELS,
  readAgentMapping,
  saveAgentMapping,
  reapplyAgentMapping,
  loadShippedDefaults,
  type AgentMappingFile,
  type AgentMapping,
} from '../../core/agent-models.js';
import { externalModelIds } from '../../core/external-models.js';
import { isProxyEnabled } from '../../core/proxy-state.js';
import { getAllAgentNames } from '../../core/plugins.js';
import {
  getClaudeDirectory,
  getDevFlowDirectory,
} from '../../targets/claude-code/claude-paths.js';
import {
  buildRow,
  type AgentsViewState,
  type AgentRow,
} from '../agents-view/index.js';

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
 * Validate --set arguments.
 * Returns Err when:
 *  - neither model nor effort is provided
 *  - model is unknown (not in CLAUDE_MODEL_ALIASES ∪ externalModelIds() ∪ 'default')
 *  - effort is unknown (not in EFFORT_LEVELS ∪ 'default')
 */
export function validateSetArgs(args: SetArgs): Result<SetArgs> {
  const { model, effort } = args;

  if (model === undefined && effort === undefined) {
    return Err('Specify at least one of --model or --effort');
  }

  if (model !== undefined) {
    const valid = [
      'default',
      ...(CLAUDE_MODEL_ALIASES as readonly string[]),
      ...externalModelIds(),
    ];
    if (!valid.includes(model)) {
      return Err(
        `Unknown model "${model}". Valid: ${valid.join(', ')}`
      );
    }
  }

  if (effort !== undefined) {
    const valid = ['default', ...(EFFORT_LEVELS as readonly string[])];
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
      existing.effort = args.effort;
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

export type RowState = 'active' | 'saved-inactive' | 'not-installed';

export interface ListRow {
  name: string;
  defaultModel: string;
  configured: string;
  effort: string;
  state: RowState;
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
 * Checks whether the installed file exists (async fs.access).
 */
export async function buildListRows(
  input: BuildListRowsInput,
): Promise<ListRow[]> {
  const { agentNames, mapping, installDir, shippedDefaults, proxyEnabled } = input;
  const gptIds = externalModelIds();

  const rows: ListRow[] = await Promise.all(
    agentNames.map(async (name): Promise<ListRow> => {
      const entry = mapping.agents[name];
      const configured = entry?.model ?? 'default';
      const effort = entry?.effort ?? 'default';
      const defaultModel = shippedDefaults[name] ?? 'unknown';

      // Check if installed file is present
      let installed = false;
      try {
        await fs.access(path.join(installDir, `${name}.md`));
        installed = true;
      } catch {
        installed = false;
      }

      let state: RowState;
      if (!installed) {
        state = 'not-installed';
      } else if (configured !== 'default' && gptIds.includes(configured) && !proxyEnabled) {
        state = 'saved-inactive';
      } else {
        state = 'active';
      }

      return { name, defaultModel, configured, effort, state };
    }),
  );

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
        stateStr = color.green('active');
        break;
      case 'saved-inactive':
        stateStr = color.yellow('saved — inactive (proxy off)');
        break;
      case 'not-installed':
        stateStr = color.dim('not installed');
        break;
      default: {
        const _: never = row.state;
        void _;
        stateStr = '';
      }
    }

    lines.push(
      [
        row.name.padEnd(AGENT_W).slice(0, AGENT_W),
        row.defaultModel.padEnd(DEFAULT_W).slice(0, DEFAULT_W),
        row.configured.padEnd(CONFIGURED_W).slice(0, CONFIGURED_W),
        row.effort.padEnd(EFFORT_W).slice(0, EFFORT_W),
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
// TUI state builder
// ---------------------------------------------------------------------------

async function buildTuiState(
  agentNames: string[],
  mapping: AgentMappingFile,
  shippedDefaults: Record<string, string>,
  proxyEnabled: boolean,
): Promise<AgentsViewState> {
  const rows: AgentRow[] = agentNames.map(name => {
    const entry = mapping.agents[name];
    return buildRow({
      name,
      shippedDefault: shippedDefaults[name] ?? 'unknown',
      savedModel: entry?.model,
      savedEffort: entry?.effort,
      proxyEnabled,
    });
  });

  return {
    rows,
    cursor: 0,
    activeField: 'model',
    viewportOffset: 0,
    viewportHeight: Math.max(1, (process.stdout.rows ?? 24) - 9),
    proxyEnabled,
  };
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
): Promise<{ updated: number; unchanged: number; warnings: string[] }> {
  // Build new mapping by merging dirty fields from TUI state onto original.
  // Per plan D: only dirty rows modify the mapping — dormant entries for
  // untouched rows are preserved byte-identical from the original.
  const newAgents: Record<string, AgentMapping> = { ...originalMapping.agents };

  for (const row of tuiState.rows) {
    const origModel = originalMapping.agents[row.name]?.model;
    const origEffort = originalMapping.agents[row.name]?.effort;

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

  const newMapping: AgentMappingFile = { version: 1, agents: newAgents };
  const saveResult = await saveAgentMapping(devflowDir, newMapping);
  if (!saveResult.ok) {
    throw new Error(saveResult.error);
  }

  const reapplyResult = await reapplyAgentMapping({
    installDir,
    devflowDir,
    proxyEnabled,
  });

  return {
    updated: reapplyResult.updated.length,
    unchanged: reapplyResult.unchanged.length,
    warnings: reapplyResult.warnings,
  };
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
      const agentName = options.set;

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

      const validation = validateSetArgs({
        model: options.model,
        effort: options.effort,
      });
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

      // Warn on GPT model while proxy off
      const gptIds = externalModelIds();
      if (options.model && gptIds.includes(options.model) && !proxyEnabled) {
        p.log.warn(
          `GPT model saved — inactive until you run ${color.bold('devflow proxy --enable')}`
        );
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
    p.intro(color.bgCyan(color.black(' Devflow Agents ')));

    const agentNames = getAllAgentNames().sort();
    const tuiState = await buildTuiState(
      agentNames,
      mapping,
      shippedDefaults,
      proxyEnabled,
    );

    // Lazy-import terminal to avoid loading readline/tty in non-TTY paths
    const { runAgentsTui } = await import('../agents-view/terminal.js');
    const result = await runAgentsTui(tuiState);

    if (result.action === 'cancel') {
      p.outro(color.dim('No changes made.'));
      return;
    }

    // Save
    try {
      const { updated, unchanged, warnings } = await applyTuiSave(
        result.state,
        mapping,
        devflowDir,
        installDir,
        proxyEnabled,
      );

      for (const warn of warnings) {
        p.log.warn(warn);
      }
      p.outro(
        `Saved. Updated ${color.green(String(updated))} agent${updated !== 1 ? 's' : ''}, ` +
        `${color.dim(`${unchanged} unchanged`)}.`
      );
    } catch (err: unknown) {
      p.log.error(`Save failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });
