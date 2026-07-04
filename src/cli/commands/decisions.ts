import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  getMemoryDir,
  getDreamDir,
  getDecisionsDir,
  getDecisionsConfigPath,
  getDecisionsLogPath,
  getDecisionsManifestPath,
  getDecisionsLockDir,
  getDecisionsNotificationsPath,
  getDecisionsBatchIdsPath,
  getDreamPendingTurnsPath,
  getDreamPendingTurnsProcessingPath,
} from '../utils/project-paths.js';
import { updateFeature, isFeatureEnabled } from '../utils/dream-config.js';
import { syncManifestFeature } from '../utils/manifest.js';
import { getDevFlowDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { sweepLegacyDreamMarkers, drainDreamQueue } from '../utils/dream-cleanup.js';
import {
  type DecisionsEntryStatus,
} from '../utils/observations.js';
import {
  readObservations,
  warnIfInvalid,
} from '../utils/observation-io.js';

/**
 * DecisionsEntryStatus is defined in observations.ts (pure data module) and
 * re-exported here for consumers that import from the decisions command module.
 */
export type { DecisionsEntryStatus };

// ---------------------------------------------------------------------------
// Sub-command handlers
// ---------------------------------------------------------------------------

function printUsage(): void {
  p.intro(color.bgCyan(color.black(' Decisions Learning ')));
  p.note(
    `${color.cyan('devflow decisions --enable')}      Enable decisions detection\n` +
    `${color.cyan('devflow decisions --disable')}     Disable decisions detection (drains queue)\n` +
    `${color.cyan('devflow decisions --status')}      Show decisions status\n` +
    `${color.cyan('devflow decisions --list')}        Show all observations\n` +
    `${color.cyan('devflow decisions --configure')}   Configuration wizard\n` +
    `${color.cyan('devflow decisions --clear')}       Truncate decisions log\n` +
    `${color.cyan('devflow decisions --reset')}       Remove all state files`,
    'Usage',
  );
  p.outro(color.dim('Detects architectural decisions and known pitfalls from your sessions'));
}

async function handleStatus(): Promise<void> {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    p.log.info('Decisions learning: disabled (not in a git project)');
    return;
  }
  const logPath = getDecisionsLogPath(gitRoot);
  const enabled = await isFeatureEnabled(gitRoot, 'decisions');
  const { observations, invalidCount } = await readObservations(logPath);

  const decisionObs = observations.filter(o => o.type === 'decision' || o.type === 'pitfall');
  const decisions = observations.filter(o => o.type === 'decision');
  const pitfalls = observations.filter(o => o.type === 'pitfall');
  const created = decisionObs.filter(o => o.status === 'created');
  const ready = decisionObs.filter(o => o.status === 'ready');
  const observing = decisionObs.filter(o => o.status === 'observing');
  const deprecated = decisionObs.filter(o => o.status === 'deprecated');

  const lines: string[] = [`Decisions learning: ${enabled ? 'enabled' : 'disabled'}`];
  if (decisionObs.length === 0) {
    lines.push('Observations: none');
  } else {
    lines.push(`Observations: ${decisionObs.length} total`);
    lines.push(`  Decisions: ${decisions.length}, Pitfalls: ${pitfalls.length}`);
    lines.push(`  Status: ${observing.length} observing, ${ready.length} ready, ${created.length} promoted, ${deprecated.length} deprecated`);
  }
  p.log.info(lines.join('\n'));
  warnIfInvalid(invalidCount);
}

async function handleList(): Promise<void> {
  // Resolve the log from the git root (matches --status, --clear, --reset,
  // --disable) so `--list` run from a subdirectory finds the real log
  // instead of a nonexistent one under process.cwd(). Falls back to cwd
  // when not in a git project, preserving the prior behavior for that case.
  const gitRoot = await getGitRoot();
  const logPath = getDecisionsLogPath(gitRoot ?? process.cwd());

  let logExists = true;
  try {
    await fs.access(logPath);
  } catch {
    logExists = false;
  }

  if (!logExists) {
    p.log.info('No observations yet. Decisions log not found.');
    return;
  }

  const { observations, invalidCount } = await readObservations(logPath);
  const filtered = observations.filter(o => o.type === 'decision' || o.type === 'pitfall');

  if (filtered.length === 0) {
    p.log.info('No decision/pitfall observations recorded yet.');
    return;
  }

  // Sort by confidence descending
  filtered.sort((a, b) => b.confidence - a.confidence);

  p.intro(color.bgCyan(color.black(' Decisions Observations ')));
  for (const obs of filtered) {
    const typeIcon = obs.type === 'decision' ? 'D' : 'F';
    const statusIcon = obs.status === 'created' ? color.green('created')
      : obs.status === 'ready' ? color.yellow('ready')
      : obs.status === 'deprecated' ? color.dim('deprecated')
      : color.dim('observing');
    const conf = (obs.confidence * 100).toFixed(0);
    p.log.info(
      `[${typeIcon}] ${color.cyan(obs.pattern)} (${conf}% | ${obs.observations}x | ${statusIcon})`,
    );
  }
  warnIfInvalid(invalidCount);
  p.outro(color.dim(`${filtered.length} observation(s) total`));
}

async function handleConfigure(): Promise<void> {
  p.intro(color.bgCyan(color.black(' Decisions Configuration ')));

  const model = await p.select({
    message: 'Model for decision detection',
    options: [
      { value: 'opus', label: 'Opus', hint: 'Recommended — highest quality for detection + curation judgment' },
      { value: 'sonnet', label: 'Sonnet', hint: 'Good balance of quality and speed' },
      { value: 'haiku', label: 'Haiku', hint: 'Fastest, lowest cost' },
    ],
  });
  if (p.isCancel(model)) {
    p.cancel('Configuration cancelled.');
    return;
  }

  const debugMode = await p.confirm({
    message: 'Enable debug logging? (logs session content excerpts to ~/.devflow/logs/)',
    initialValue: false,
  });
  if (p.isCancel(debugMode)) {
    p.cancel('Configuration cancelled.');
    return;
  }

  const scope = await p.select({
    message: 'Configuration scope',
    options: [
      { value: 'project', label: 'Project', hint: 'This project only (.devflow/decisions/decisions.json)' },
      { value: 'global', label: 'Global', hint: 'All projects (~/.devflow/decisions.json)' },
    ],
  });
  if (p.isCancel(scope)) {
    p.cancel('Configuration cancelled.');
    return;
  }

  const config = {
    model,
    debug: debugMode,
  };

  const configJson = JSON.stringify(config, null, 2) + '\n';

  if (scope === 'global') {
    const globalDir = path.join(process.env.HOME || '~', '.devflow');
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(path.join(globalDir, 'decisions.json'), configJson, 'utf-8');
    p.log.success(`Global config written to ${color.dim(path.join(globalDir, 'decisions.json'))}`);
  } else {
    const memoryDir = getMemoryDir(process.cwd());
    await fs.mkdir(memoryDir, { recursive: true });
    const projectConfigPath = getDecisionsConfigPath(process.cwd());
    await fs.writeFile(projectConfigPath, configJson, 'utf-8');
    p.log.success(`Project config written to ${color.dim(projectConfigPath)}`);
  }

  p.outro(color.green('Configuration saved.'));
}

async function handleReset(): Promise<void> {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    p.log.warn('Could not resolve git root — reset not performed');
    return;
  }

  const lockDir = getDecisionsLockDir(gitRoot);

  // Acquire lock to prevent conflict with a concurrent `devflow decisions` invocation.
  try {
    await fs.mkdir(lockDir);
  } catch {
    p.log.error('Decisions system is currently running. Try again in a moment.');
    return;
  }

  try {
    const stateFilePaths = [
      getDecisionsLogPath(gitRoot),
      getDecisionsManifestPath(gitRoot),
      getDecisionsNotificationsPath(gitRoot),
      getDecisionsBatchIdsPath(gitRoot),
      getDecisionsConfigPath(gitRoot),
      getDreamPendingTurnsPath(gitRoot),
      getDreamPendingTurnsProcessingPath(gitRoot),
    ];

    if (process.stdin.isTTY) {
      const confirm = await p.confirm({
        message: 'Remove all decisions-specific state files? This cannot be undone.',
        initialValue: false,
      });
      if (p.isCancel(confirm) || !confirm) {
        p.log.info('Reset cancelled.');
        return;
      }
    }

    let removed = 0;
    for (const filePath of stateFilePaths) {
      try {
        await fs.unlink(filePath);
        removed++;
      } catch { /* may not exist */ }
    }

    // Remove the decisions directory if present (rendered files, ledger, config).
    try {
      await fs.rm(getDecisionsDir(gitRoot), { recursive: true, force: true });
    } catch { /* best effort */ }

    // Clean legacy dream marker-pipeline stamps from old installs
    // (config.json and the queue files are handled above/never touched here).
    // Best-effort: reset must still finish (and release its lock) even if the
    // dream directory is inaccessible.
    try {
      await sweepLegacyDreamMarkers(getDreamDir(gitRoot));
    } catch { /* best effort */ }

    p.log.success(`Reset complete — removed ${removed} file(s).`);
  } finally {
    try { await fs.rmdir(lockDir); } catch { /* already cleaned */ }
  }
}

async function handleClear(): Promise<void> {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    p.log.warn('Could not resolve git root — clear not performed');
    return;
  }

  const decisionsLogPath = getDecisionsLogPath(gitRoot);
  try {
    await fs.access(decisionsLogPath);
  } catch {
    p.log.info('No decisions log to clear.');
    return;
  }

  if (process.stdin.isTTY) {
    const confirm = await p.confirm({
      message: 'Clear all decision/pitfall observations? This cannot be undone.',
      initialValue: false,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.log.info('Clear cancelled.');
      return;
    }
  }

  await fs.writeFile(decisionsLogPath, '', 'utf-8');

  // Drain the dream (decisions-detection) queue so stale turns don't process
  // on the next session — mirrors memory.ts's drain-on-disable behavior for
  // the sibling memory queue. A mid-run Dream agent whose claimed batch
  // vanishes aborts without changes — the desired outcome of clearing.
  await drainDreamQueue(gitRoot);

  p.log.success('Decisions log cleared.');
}

async function handleEnable(): Promise<void> {
  const gitRoot = await getGitRoot();
  if (gitRoot) {
    await updateFeature(gitRoot, 'decisions', true);
    await syncManifestFeature(getDevFlowDirectory(), 'decisions', true);
    p.log.success('Decisions learning enabled — configuration updated');
    p.log.info(color.dim('Architectural decisions and pitfalls will be detected from your sessions'));
  } else {
    p.log.warn('Could not resolve git root — configuration not updated');
  }
}

async function handleDisable(): Promise<void> {
  const gitRoot = await getGitRoot();
  if (gitRoot) {
    await updateFeature(gitRoot, 'decisions', false);

    // Drain the dream (decisions-detection) queue so stale turns don't process
    // on re-enable — mirrors memory.ts's drain-on-disable behavior for the
    // sibling memory queue. Unconditional: a mid-run Dream agent whose claimed
    // batch vanishes aborts without changes — the desired outcome of disabling.
    await drainDreamQueue(gitRoot);

    await syncManifestFeature(getDevFlowDirectory(), 'decisions', false);
    p.log.success('Decisions learning disabled — configuration updated');
  } else {
    p.log.warn('Could not resolve git root — configuration not updated');
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

interface DecisionsOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
  configure?: boolean;
  clear?: boolean;
  reset?: boolean;
}

export const decisionsCommand = new Command('decisions')
  .description('Enable or disable decisions/pitfall learning (decision detection + knowledge base)')
  .option('--enable', 'Enable decisions learning')
  .option('--disable', 'Disable decisions learning')
  .option('--status', 'Show decisions status and observation counts')
  .option('--list', 'Show all decision/pitfall observations sorted by confidence')
  .option('--configure', 'Interactive configuration wizard for decisions.json')
  .option('--clear', 'Truncate decisions log (removes all observations)')
  .option('--reset', 'Remove all decisions-specific state files and artifacts')
  .action(async (options: DecisionsOptions) => {
    const knownFlags: (keyof DecisionsOptions)[] = [
      'enable', 'disable', 'status', 'list', 'configure',
      'clear', 'reset',
    ];
    const hasFlag = knownFlags.some((f) => options[f]);
    if (!hasFlag) {
      printUsage();
      return;
    }

    // Thin router — dispatch order matches the precedence of the original
    // inline implementation (status, list, configure, reset, clear, enable,
    // disable). Each handler owns its own path resolution and I/O.
    if (options.status) {
      await handleStatus();
      return;
    }
    if (options.list) {
      await handleList();
      return;
    }
    if (options.configure) {
      await handleConfigure();
      return;
    }
    if (options.reset) {
      await handleReset();
      return;
    }
    if (options.clear) {
      await handleClear();
      return;
    }
    if (options.enable) {
      await handleEnable();
      return;
    }
    if (options.disable) {
      await handleDisable();
      return;
    }
  });
