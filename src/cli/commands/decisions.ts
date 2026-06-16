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
  getDecisionsRunsTodayPath,
  getDecisionsBatchIdsPath,
  getDecisionsDisabledSentinel,
} from '../utils/project-paths.js';
import { updateFeature, isFeatureEnabled, readConfig } from '../utils/dream-config.js';
import { syncManifestFeature } from '../utils/manifest.js';
import { getDevFlowDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
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
      p.intro(color.bgCyan(color.black(' Decisions Learning ')));
      p.note(
        `${color.cyan('devflow decisions --enable')}      Register decisions hook\n` +
        `${color.cyan('devflow decisions --disable')}     Remove decisions hook\n` +
        `${color.cyan('devflow decisions --status')}      Show decisions status\n` +
        `${color.cyan('devflow decisions --list')}        Show all observations\n` +
        `${color.cyan('devflow decisions --configure')}   Configuration wizard\n` +
        `${color.cyan('devflow decisions --clear')}       Truncate decisions log\n` +
        `${color.cyan('devflow decisions --reset')}       Remove all state files`,
        'Usage',
      );
      p.outro(color.dim('Detects architectural decisions and known pitfalls from your sessions'));
      return;
    }

    const memoryDir = getMemoryDir(process.cwd());

    // Shared log path for --status, --list, --clear
    const logPath = getDecisionsLogPath(process.cwd());

    // --- --status ---
    if (options.status) {
      const gitRoot = await getGitRoot();
      if (!gitRoot) {
        p.log.info('Decisions learning: disabled (not in a git project)');
        return;
      }
      const enabled = await isFeatureEnabled(gitRoot, 'decisions');
      const dreamConfig = await readConfig(gitRoot);
      const { observations, invalidCount } = await readObservations(logPath);

      const decisionObs = observations.filter(o => o.type === 'decision' || o.type === 'pitfall');
      const decisions = observations.filter(o => o.type === 'decision');
      const pitfalls = observations.filter(o => o.type === 'pitfall');
      const created = decisionObs.filter(o => o.status === 'created');
      const ready = decisionObs.filter(o => o.status === 'ready');
      const observing = decisionObs.filter(o => o.status === 'observing');
      const deprecated = decisionObs.filter(o => o.status === 'deprecated');

      const lines: string[] = [`Decisions learning: ${enabled ? 'enabled' : 'disabled'}`];
      lines.push(`Auto-commit: ${dreamConfig.autoCommit ? 'ON' : 'OFF'} (chore(dream): commits after each Dream write)`);
      if (decisionObs.length === 0) {
        lines.push('Observations: none');
      } else {
        lines.push(`Observations: ${decisionObs.length} total`);
        lines.push(`  Decisions: ${decisions.length}, Pitfalls: ${pitfalls.length}`);
        lines.push(`  Status: ${observing.length} observing, ${ready.length} ready, ${created.length} promoted, ${deprecated.length} deprecated`);
      }
      p.log.info(lines.join('\n'));
      warnIfInvalid(invalidCount);
      return;
    }

    // --- --list ---
    if (options.list) {
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
      return;
    }

    // --- --configure ---
    if (options.configure) {
      p.intro(color.bgCyan(color.black(' Decisions Configuration ')));

      const maxRuns = await p.text({
        message: 'Maximum background runs per day',
        placeholder: '3',
        defaultValue: '3',
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 1 || n > 50) return 'Enter a number between 1 and 50';
          return undefined;
        },
      });
      if (p.isCancel(maxRuns)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const throttle = await p.text({
        message: 'Throttle interval (minutes between runs)',
        placeholder: '5',
        defaultValue: '5',
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 1 || n > 60) return 'Enter a number between 1 and 60';
          return undefined;
        },
      });
      if (p.isCancel(throttle)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const model = await p.select({
        message: 'Model for decision detection',
        options: [
          { value: 'sonnet', label: 'Sonnet', hint: 'Recommended — good balance of quality and speed' },
          { value: 'haiku', label: 'Haiku', hint: 'Fastest, lowest cost' },
          { value: 'opus', label: 'Opus', hint: 'Highest quality, highest cost' },
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
        max_daily_runs: Number(maxRuns),
        throttle_minutes: Number(throttle),
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
        await fs.mkdir(memoryDir, { recursive: true });
        const projectConfigPath = getDecisionsConfigPath(process.cwd());
        await fs.writeFile(projectConfigPath, configJson, 'utf-8');
        p.log.success(`Project config written to ${color.dim(projectConfigPath)}`);
      }

      p.outro(color.green('Configuration saved.'));
      return;
    }

    // --- --reset ---
    if (options.reset) {
      const lockDir = getDecisionsLockDir(process.cwd());

      // Acquire lock to prevent conflict with running background decisions agent.
      try {
        await fs.mkdir(lockDir);
      } catch {
        p.log.error('Decisions system is currently running. Try again in a moment.');
        return;
      }

      try {
        const stateFilePaths = [
          getDecisionsLogPath(process.cwd()),
          getDecisionsManifestPath(process.cwd()),
          getDecisionsNotificationsPath(process.cwd()),
          getDecisionsRunsTodayPath(process.cwd()),
          getDecisionsBatchIdsPath(process.cwd()),
          getDecisionsConfigPath(process.cwd()),
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

        // Remove decisions sentinel directory if present (may contain .disabled or other files).
        try {
          await fs.rm(getDecisionsDir(process.cwd()), { recursive: true, force: true });
        } catch { /* best effort */ }

        // Clean dream state files
        const dreamDir = getDreamDir(process.cwd());
        for (const f of ['.decisions-runs-today']) {
          try { await fs.unlink(path.join(dreamDir, f)); } catch { /* may not exist */ }
        }
        // Clean dream decisions markers
        try {
          const dreamFiles = await fs.readdir(dreamDir);
          for (const f of dreamFiles) {
            if (f.startsWith('decisions.') && f.endsWith('.json')) {
              try { await fs.unlink(path.join(dreamDir, f)); } catch { /* ignore */ }
            }
          }
        } catch { /* dream dir may not exist */ }

        p.log.success(`Reset complete — removed ${removed} file(s).`);
      } finally {
        try { await fs.rmdir(lockDir); } catch { /* already cleaned */ }
      }
      return;
    }

    // --- --clear ---
    if (options.clear) {
      try {
        await fs.access(logPath);
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

      await fs.writeFile(logPath, '', 'utf-8');
      p.log.success('Decisions log cleared.');
      return;
    }

    // --- --enable / --disable ---
    if (options.enable) {
      const gitRoot = await getGitRoot();
      if (gitRoot) {
        await updateFeature(gitRoot, 'decisions', true);
        // Remove decisions/.disabled sentinel if present (kept for session-start-context gating)
        try {
          await fs.unlink(getDecisionsDisabledSentinel(gitRoot));
        } catch { /* may not exist */ }
        await syncManifestFeature(getDevFlowDirectory(), 'decisions', true);
        p.log.success('Decisions learning enabled — configuration updated');
        p.log.info(color.dim('Architectural decisions and pitfalls will be detected from your sessions'));
      } else {
        p.log.warn('Could not resolve git root — configuration not updated');
      }
      return;
    }

    if (options.disable) {
      const gitRoot = await getGitRoot();
      if (gitRoot) {
        await updateFeature(gitRoot, 'decisions', false);
        // Create decisions/.disabled sentinel (gates session-start-context decisions section)
        const decisionsDir = getDecisionsDir(gitRoot);
        await fs.mkdir(decisionsDir, { recursive: true });
        await fs.writeFile(getDecisionsDisabledSentinel(gitRoot), '', 'utf-8');
        await syncManifestFeature(getDevFlowDirectory(), 'decisions', false);
        p.log.success('Decisions learning disabled — configuration updated');
      } else {
        p.log.warn('Could not resolve git root — configuration not updated');
      }
      return;
    }
  });
