import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  getLearningDir,
  getLearningTuningConfigPath,
  getDecisionsLogPath,
  getDecisionsLockDir,
} from '../utils/project-paths.js';
import { updateFeature, isFeatureEnabled } from '../utils/feature-config.js';
import { syncManifestFeature } from '../utils/manifest.js';
import { getDevFlowDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { sweepLegacyDreamMarkers, drainLearningQueue } from '../utils/learning-queue-cleanup.js';
import {
  type DecisionsEntryStatus,
} from '../utils/observations.js';
import {
  readObservations,
  warnIfInvalid,
} from '../utils/observation-io.js';

/**
 * DecisionsEntryStatus is defined in observations.ts (pure data module) and
 * re-exported here for consumers that import from the learning command module.
 */
export type { DecisionsEntryStatus };

// ---------------------------------------------------------------------------
// Sub-command handlers
// ---------------------------------------------------------------------------

function printUsage(): void {
  p.intro(color.bgCyan(color.black(' Learning ')));
  p.note(
    `${color.cyan('devflow learning --enable')}      Enable learning (decision + pitfall detection)\n` +
    `${color.cyan('devflow learning --disable')}     Disable learning (drains queue)\n` +
    `${color.cyan('devflow learning --status')}      Show learning status\n` +
    `${color.cyan('devflow learning --list')}        Show all observations\n` +
    `${color.cyan('devflow learning --configure')}   Configuration wizard\n` +
    `${color.cyan('devflow learning --clear')}       Truncate decisions log\n` +
    `${color.cyan('devflow learning --reset')}       Remove all learning state files`,
    'Usage',
  );
  p.outro(color.dim('Detects architectural decisions and known pitfalls from your sessions'));
}

/**
 * Resolve the git root for a state-mutating subcommand, warning and
 * returning null if the caller isn't inside a git project. `actionSuffix`
 * completes "Could not resolve git root — {actionSuffix}".
 */
async function requireGitRoot(actionSuffix: string): Promise<string | null> {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    p.log.warn(`Could not resolve git root — ${actionSuffix}`);
  }
  return gitRoot;
}

async function handleStatus(): Promise<void> {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    p.log.info('Learning: disabled (not in a git project)');
    return;
  }
  const logPath = getDecisionsLogPath(gitRoot);
  const enabled = await isFeatureEnabled(gitRoot, 'learning');
  const { observations, invalidCount } = await readObservations(logPath);

  const decisionObs = observations.filter(o => o.type === 'decision' || o.type === 'pitfall');
  const decisions = observations.filter(o => o.type === 'decision');
  const pitfalls = observations.filter(o => o.type === 'pitfall');
  const created = decisionObs.filter(o => o.status === 'created');
  const ready = decisionObs.filter(o => o.status === 'ready');
  const observing = decisionObs.filter(o => o.status === 'observing');
  const deprecated = decisionObs.filter(o => o.status === 'deprecated');

  const lines: string[] = [`Learning: ${enabled ? 'enabled' : 'disabled'}`];
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

  p.intro(color.bgCyan(color.black(' Learning Observations ')));
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
  p.intro(color.bgCyan(color.black(' Learning Configuration ')));

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
      { value: 'project', label: 'Project', hint: 'This project only (.devflow/learning/learning.json)' },
      { value: 'global', label: 'Global', hint: 'All projects (~/.devflow/learning.json)' },
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
    await fs.writeFile(path.join(globalDir, 'learning.json'), configJson, 'utf-8');
    p.log.success(`Global config written to ${color.dim(path.join(globalDir, 'learning.json'))}`);
  } else {
    // FIX: mkdir the learning dir (parent of learning.json), not the memory dir
    const learningDir = getLearningDir(process.cwd());
    await fs.mkdir(learningDir, { recursive: true });
    const projectConfigPath = getLearningTuningConfigPath(process.cwd());
    await fs.writeFile(projectConfigPath, configJson, 'utf-8');
    p.log.success(`Project config written to ${color.dim(projectConfigPath)}`);
  }

  p.outro(color.green('Configuration saved.'));
}

async function handleReset(): Promise<void> {
  const gitRoot = await requireGitRoot('reset not performed');
  if (!gitRoot) return;

  const lockDir = getDecisionsLockDir(gitRoot);

  // Ensure the parent directory exists so a second reset (after .devflow/learning/
  // was already removed) does not fail with ENOENT and emit a false contention error.
  await fs.mkdir(path.dirname(lockDir), { recursive: true });

  // Acquire lock to prevent conflict with a concurrent `devflow learning` invocation.
  // Non-recursive: EEXIST still means genuine contention.
  try {
    await fs.mkdir(lockDir);
  } catch {
    p.log.error('Learning system is currently running. Try again in a moment.');
    return;
  }

  try {
    if (process.stdin.isTTY) {
      const confirm = await p.confirm({
        message: 'Remove all learning state files? This cannot be undone.',
        initialValue: false,
      });
      if (p.isCancel(confirm) || !confirm) {
        p.log.info('Reset cancelled.');
        return;
      }
    }

    // Remove the entire learning directory (contains queue files, content files,
    // ledger, and tuning config). Single-dir semantics: all learning state lives here.
    try {
      await fs.rm(getLearningDir(gitRoot), { recursive: true, force: true });
    } catch { /* best effort */ }

    // Clean legacy dream marker-pipeline stamps from old installs.
    // Best-effort: sweeps the now-absent dir silently (ENOENT-tolerant).
    try {
      await sweepLegacyDreamMarkers(getLearningDir(gitRoot));
    } catch { /* best effort */ }

    p.log.success('Reset complete — removed .devflow/learning/ state.');
  } finally {
    try { await fs.rmdir(lockDir); } catch { /* already cleaned */ }
  }
}

async function handleClear(): Promise<void> {
  const gitRoot = await requireGitRoot('clear not performed');
  if (!gitRoot) return;

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

  // Drain the learning (decisions-detection) queue so stale turns don't process
  // on the next session — mirrors memory.ts's drain-on-disable behavior for
  // the sibling memory queue. A mid-run Learning agent whose claimed batch
  // vanishes aborts without changes — the desired outcome of clearing.
  await drainLearningQueue(gitRoot);

  p.log.success('Decisions log cleared.');
}

async function handleEnable(): Promise<void> {
  const gitRoot = await requireGitRoot('configuration not updated');
  if (!gitRoot) return;

  await updateFeature(gitRoot, 'learning', true);
  await syncManifestFeature(getDevFlowDirectory(), 'learning', true);
  p.log.success('Learning enabled — configuration updated');
  p.log.info(color.dim('Architectural decisions and pitfalls will be detected from your sessions'));
}

async function handleDisable(): Promise<void> {
  const gitRoot = await requireGitRoot('configuration not updated');
  if (!gitRoot) return;

  await updateFeature(gitRoot, 'learning', false);

  // Drain the learning (decisions-detection) queue so stale turns don't process
  // on re-enable — mirrors memory.ts's drain-on-disable behavior for the
  // sibling memory queue. Unconditional: a mid-run Learning agent whose claimed
  // batch vanishes aborts without changes — the desired outcome of disabling.
  await drainLearningQueue(gitRoot);

  await syncManifestFeature(getDevFlowDirectory(), 'learning', false);
  p.log.success('Learning disabled — configuration updated');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

interface LearningOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
  configure?: boolean;
  clear?: boolean;
  reset?: boolean;
}

export const learningCommand = new Command('learning')
  .description('Enable or disable learning (decision/pitfall detection + knowledge base)')
  .option('--enable', 'Enable learning')
  .option('--disable', 'Disable learning')
  .option('--status', 'Show learning status and observation counts')
  .option('--list', 'Show all decision/pitfall observations sorted by confidence')
  .option('--configure', 'Interactive configuration wizard for learning.json')
  .option('--clear', 'Truncate decisions log (removes all observations)')
  .option('--reset', 'Remove all learning state files and artifacts')
  .action(async (options: LearningOptions) => {
    const knownFlags: (keyof LearningOptions)[] = [
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

