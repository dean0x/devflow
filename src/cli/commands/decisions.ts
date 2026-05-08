import { Command } from 'commander';
import { promises as fs, readFileSync } from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';
import { writeFileAtomicExclusive } from '../utils/fs-atomic.js';
import { type NotificationFileEntry, isNotificationMap } from '../utils/notifications-shape.js';
import {
  acquireBackgroundLock,
  releaseBackgroundLock,
  registerLockCleanup,
  extractBatchMessages,
  applyTemporalDecay,
  capEntries,
  checkStaleness,
} from '../utils/background-runner.js';
import { runDecisionsAgent } from '../utils/decisions-agent.js';
import { loadDecisionsConfig } from '../utils/decisions-config.js';
import {
  isLearningObservation,
  readObservations,
  warnIfInvalid,
  writeObservations,
  updateDecisionsStatus,
  type LearningObservation,
} from './learn.js';

/**
 * D-SEC2: Runtime guard for the `count-active` JSON result from json-helper.cjs.
 * Accepts any object that carries a numeric `count` field (extra fields are ignored).
 * (Local copy — decisions.ts does not import from learn.ts for this guard.)
 */
function isCountActiveResult(v: unknown): v is { count: number } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).count === 'number';
}

// ---------------------------------------------------------------------------
// Hook management
// ---------------------------------------------------------------------------

const DECISIONS_HOOK_MARKER = 'session-end-decisions';

/**
 * Add the decisions SessionEnd hook to settings JSON.
 * Idempotent — returns unchanged JSON if the hook already exists.
 */
export function addDecisionsHook(settingsJson: string, devflowDir: string): string {
  if (hasDecisionsHook(settingsJson)) {
    return settingsJson;
  }

  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' session-end-decisions';

  const newEntry: HookMatcher = {
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 10,
      },
    ],
  };

  if (!settings.hooks.SessionEnd) {
    settings.hooks.SessionEnd = [];
  }

  settings.hooks.SessionEnd.push(newEntry);

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the decisions hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export function removeDecisionsHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = false;

  const matchers = settings.hooks?.SessionEnd;
  if (matchers) {
    const before = matchers.length;
    settings.hooks!.SessionEnd = matchers.filter(
      (m) => !m.hooks.some((h) => h.command.includes(DECISIONS_HOOK_MARKER)),
    );
    if (settings.hooks!.SessionEnd!.length < before) changed = true;
    if (settings.hooks!.SessionEnd!.length === 0) delete settings.hooks!.SessionEnd;
  }

  if (!changed) {
    return settingsJson;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the decisions hook is registered in settings JSON or parsed Settings object.
 * Returns true if present, false otherwise.
 */
export function hasDecisionsHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;

  return settings.hooks?.SessionEnd?.some((matcher) =>
    matcher.hooks.some((h) => h.command.includes(DECISIONS_HOOK_MARKER)),
  ) ?? false;
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
  purge?: boolean;
  review?: boolean;
  dismissCapacity?: boolean;
  runBackground?: boolean;
  cwd?: string;
}

export const decisionsCommand = new Command('decisions')
  .description('Enable or disable decisions/pitfall learning (decision detection + knowledge base)')
  .option('--enable', 'Register SessionEnd hook for decisions learning')
  .option('--disable', 'Remove decisions hook and create disabled sentinel')
  .option('--status', 'Show decisions status and observation counts')
  .option('--list', 'Show all decision/pitfall observations sorted by confidence')
  .option('--configure', 'Interactive configuration wizard for decisions.json')
  .option('--clear', 'Truncate decisions log (removes all observations)')
  .option('--reset', 'Remove all decisions-specific state files and artifacts')
  .option('--purge', 'Remove invalid/corrupted entries from decisions log')
  .option('--review', 'Interactively review flagged decision/pitfall observations')
  .option('--dismiss-capacity', 'Dismiss the current capacity notification')
  .option('--run-background', 'Run decisions agent in background mode')
  .option('--cwd <path>', 'Working directory for background mode')
  .action(async (options: DecisionsOptions) => {
    const knownFlags: (keyof DecisionsOptions)[] = [
      'enable', 'disable', 'status', 'list', 'configure',
      'clear', 'reset', 'purge', 'review', 'dismissCapacity', 'runBackground',
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
        `${color.cyan('devflow decisions --reset')}       Remove all state files\n` +
        `${color.cyan('devflow decisions --purge')}       Remove invalid entries\n` +
        `${color.cyan('devflow decisions --review')}      Review flagged observations interactively\n` +
        `${color.cyan('devflow decisions --dismiss-capacity')} Dismiss capacity notification`,
        'Usage',
      );
      p.outro(color.dim('Detects architectural decisions and known pitfalls from your sessions'));
      return;
    }

    // --- --run-background ---
    if (options.runBackground) {
      const cwd = options.cwd ?? process.cwd();
      const devflowDir = getDevFlowDirectory();
      const scriptDir = path.join(devflowDir, 'scripts', 'hooks');
      const jsonHelperPath = path.join(scriptDir, 'json-helper.cjs');
      const stalenessModulePath = path.join(scriptDir, 'lib', 'staleness.cjs');
      const memoryDir = path.join(cwd, '.memory');

      // Validate that the resolved cwd is a devflow-enabled project directory.
      // This guards against passing an arbitrary path via --cwd from the CLI.
      try {
        await fs.access(memoryDir);
      } catch {
        process.stderr.write(`[decisions] --cwd path does not contain a .memory directory: ${cwd}\n`);
        process.exit(1);
      }

      const lockDir = path.join(memoryDir, '.decisions.lock');
      const logFile = path.join(memoryDir, 'decisions-log.jsonl');
      const batchIdsFile = path.join(memoryDir, '.decisions-batch-ids');
      const manifestPath = path.join(memoryDir, '.decisions-manifest.json');
      const notificationsPath = path.join(memoryDir, '.decisions-notifications.json');

      await acquireBackgroundLock(lockDir);
      const cleanupLock = registerLockCleanup(lockDir);

      try {
        const config = loadDecisionsConfig(cwd);

        // Daily cap is checked and incremented by the calling hook
        // (session-end-decisions) before spawning this background process.
        // No cap check needed here — the hook already gates the invocation.

        const { dialogPairs } = await extractBatchMessages(batchIdsFile, cwd);

        await applyTemporalDecay(jsonHelperPath, logFile);
        capEntries(logFile, 100);

        const responseFile = await runDecisionsAgent({
          cwd,
          dialogPairs,
          model: config.model,
          logFile,
          jsonHelperPath,
        });

        // Merge observations into decisions log (decision + pitfall types only).
        execFileSync('node', [jsonHelperPath, 'process-observations', responseFile, logFile, '--types', 'decision,pitfall'], {
          stdio: 'pipe',
        });

        // Render ready observations to artifacts with decisions-specific paths.
        execFileSync('node', [
          jsonHelperPath, 'render-ready', logFile, cwd,
          '--manifest-path', manifestPath,
          '--notifications-path', notificationsPath,
        ], { stdio: 'pipe' });

        await checkStaleness(stalenessModulePath, logFile, cwd);
        // Daily cap is incremented by the calling hook (session-end-decisions)
        // before spawning this background process. Do not increment again here.
      } finally {
        cleanupLock();
        releaseBackgroundLock(lockDir);
      }
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');
    const memoryDir = path.join(process.cwd(), '.memory');

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      if (options.status) {
        p.log.info('Decisions learning: disabled (no settings.json found)');
        return;
      }
      settingsContent = '{}';
    }

    // Shared log path for --status, --list, --purge, --clear
    const logPath = path.join(process.cwd(), '.memory', 'decisions-log.jsonl');

    // --- --status ---
    if (options.status) {
      const hookEnabled = hasDecisionsHook(settingsContent);
      const { observations, invalidCount } = await readObservations(logPath);

      const decisionObs = observations.filter(o => o.type === 'decision' || o.type === 'pitfall');
      const decisions = observations.filter(o => o.type === 'decision');
      const pitfalls = observations.filter(o => o.type === 'pitfall');
      const created = decisionObs.filter(o => o.status === 'created');
      const ready = decisionObs.filter(o => o.status === 'ready');
      const observing = decisionObs.filter(o => o.status === 'observing');
      const deprecated = decisionObs.filter(o => o.status === 'deprecated');
      const needReview = decisionObs.filter(o => o.mayBeStale || o.needsReview || o.softCapExceeded);

      const lines: string[] = [`Decisions learning: ${hookEnabled ? 'enabled' : 'disabled'}`];
      if (decisionObs.length === 0) {
        lines.push('Observations: none');
      } else {
        lines.push(`Observations: ${decisionObs.length} total`);
        lines.push(`  Decisions: ${decisions.length}, Pitfalls: ${pitfalls.length}`);
        lines.push(`  Status: ${observing.length} observing, ${ready.length} ready, ${created.length} promoted, ${deprecated.length} deprecated`);
        if (needReview.length > 0) {
          lines.push(`  ${color.yellow('⚠')} ${needReview.length} need review — run 'devflow decisions --review'`);
        }
      }
      p.log.info(lines.join('\n'));
      warnIfInvalid(invalidCount, 'devflow decisions --purge');

      // Show daily run count
      const capsFile = path.join(memoryDir, '.decisions-runs-today');
      try {
        const capsContent = readFileSync(capsFile, 'utf-8').trim();
        const [date, countStr] = capsContent.split('\t');
        const today = new Date().toISOString().slice(0, 10);
        if (date === today) {
          p.log.info(`Daily runs today: ${countStr}`);
        }
      } catch { /* cap file absent — 0 runs today */ }

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
      warnIfInvalid(invalidCount, 'devflow decisions --purge');
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
          { value: 'project', label: 'Project', hint: 'This project only (.memory/decisions.json)' },
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
        await fs.writeFile(path.join(memoryDir, 'decisions.json'), configJson, 'utf-8');
        p.log.success(`Project config written to ${color.dim(path.join(memoryDir, 'decisions.json'))}`);
      }

      p.outro(color.green('Configuration saved.'));
      return;
    }

    // --- --purge ---
    if (options.purge) {
      let logContent: string;
      try {
        logContent = await fs.readFile(logPath, 'utf-8');
      } catch {
        p.log.info('No decisions log to purge.');
        return;
      }

      const rawLines = logContent.split('\n').filter(l => l.trim()).length;
      const valid: LearningObservation[] = [];
      for (const line of logContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (isLearningObservation(parsed) && (parsed.type === 'decision' || parsed.type === 'pitfall')) {
            valid.push(parsed);
          }
        } catch { /* skip malformed */ }
      }
      const invalidCount = rawLines - valid.length;

      if (invalidCount === 0) {
        p.log.info('No invalid entries found. Decisions log is clean.');
        return;
      }

      await writeObservations(logPath, valid);
      p.log.success(`Purged ${invalidCount} invalid entry(ies). ${valid.length} valid observation(s) remain.`);
      return;
    }

    // --- --reset ---
    if (options.reset) {
      const lockDir = path.join(memoryDir, '.decisions.lock');

      // Acquire lock to prevent conflict with running background decisions agent.
      try {
        await fs.mkdir(lockDir);
      } catch {
        p.log.error('Decisions system is currently running. Try again in a moment.');
        return;
      }

      try {
        const stateFiles = [
          'decisions-log.jsonl',
          '.decisions-manifest.json',
          '.decisions-notifications.json',
          '.decisions-runs-today',
          '.decisions-batch-ids',
        ];
        const configFiles = ['decisions.json'];

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
        for (const f of [...stateFiles, ...configFiles]) {
          try {
            await fs.unlink(path.join(memoryDir, f));
            removed++;
          } catch { /* may not exist */ }
        }

        // Remove decisions sentinel directory if present (may contain .disabled or other files).
        try {
          await fs.rm(path.join(memoryDir, 'decisions'), { recursive: true, force: true });
        } catch { /* best effort */ }

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

    // --- --review ---
    if (options.review) {
      const mode = await p.select({
        message: 'Review mode:',
        options: [
          { value: 'observations', label: 'Review flagged observations', hint: 'stale, missing, at capacity' },
          { value: 'capacity', label: 'Review decisions capacity', hint: 'deprecate least-used entries' },
          { value: 'cancel', label: 'Cancel' },
        ],
      });

      if (p.isCancel(mode) || mode === 'cancel') {
        return;
      }

      if (mode === 'observations') {
        const { observations, invalidCount } = await readObservations(logPath);
        warnIfInvalid(invalidCount, 'devflow decisions --purge');

        const flagged = observations.filter(
          (o) => (o.type === 'decision' || o.type === 'pitfall') && (o.mayBeStale || o.needsReview || o.softCapExceeded),
        );

        if (flagged.length === 0) {
          p.log.info('No observations flagged for review. All clear.');
          return;
        }

        const decisionsLockDir = path.join(memoryDir, '.decisions.lock');
        let lockAcquired = false;
        try {
          await fs.mkdir(decisionsLockDir);
          lockAcquired = true;
        } catch {
          p.log.error('Decisions system is currently running. Try again in a moment.');
          return;
        }

        p.intro(color.bgCyan(color.black(' Decisions Review ')));
        p.log.info(`${flagged.length} observation(s) flagged for review.`);

        const updatedObservations = [...observations];

        try {
          for (const obs of flagged) {
            const typeLabel = obs.type === 'decision' ? 'Decision' : 'Pitfall';
            const reasons: string[] = [];
            if (obs.mayBeStale) reasons.push(obs.staleReason ? `stale: ${obs.staleReason}` : 'may be stale');
            if (obs.needsReview) reasons.push('artifact missing (deleted?)');
            if (obs.softCapExceeded) reasons.push('decisions file at capacity');
            const reason = reasons.join(', ') || 'flagged for review';

            p.log.info(
              `\n[${typeLabel}] ${color.cyan(obs.pattern)}\n` +
              `  Reason: ${color.yellow(reason)}\n` +
              (obs.artifact_path ? `  Artifact: ${color.dim(obs.artifact_path)}\n` : '') +
              `  Details: ${color.dim(obs.details.slice(0, 100))}${obs.details.length > 100 ? '...' : ''}`,
            );

            const action = await p.select({
              message: 'Action:',
              options: [
                { value: 'deprecate', label: 'Mark as deprecated', hint: 'Remove from active use' },
                { value: 'keep', label: 'Keep active', hint: 'Clear review flags' },
                { value: 'skip', label: 'Skip', hint: 'No change' },
              ],
            });

            if (p.isCancel(action)) {
              await writeObservations(logPath, updatedObservations);
              p.cancel('Review cancelled — partial progress saved.');
              return;
            }

            const idx = updatedObservations.findIndex(o => o.id === obs.id);
            if (idx === -1) continue;

            if (action === 'deprecate') {
              updatedObservations[idx] = {
                ...updatedObservations[idx],
                status: 'deprecated',
                mayBeStale: undefined,
                needsReview: undefined,
                softCapExceeded: undefined,
              };
              await writeObservations(logPath, updatedObservations);
              p.log.success(`Marked '${obs.pattern}' as deprecated.`);
            } else if (action === 'keep') {
              updatedObservations[idx] = {
                ...updatedObservations[idx],
                mayBeStale: undefined,
                needsReview: undefined,
                softCapExceeded: undefined,
              };
              await writeObservations(logPath, updatedObservations);
              p.log.success(`Cleared review flags for '${obs.pattern}'.`);
            }
            // 'skip' — no change
          }
        } finally {
          if (lockAcquired) {
            try { await fs.rmdir(decisionsLockDir); } catch { /* already cleaned */ }
          }
        }

        p.outro(color.green('Review complete.'));
        return;
      }

      if (mode === 'capacity') {
        const decisionsDir = path.join(memoryDir, 'decisions');
        const decisionsPath = path.join(decisionsDir, 'decisions.md');
        const pitfallsPath = path.join(decisionsDir, 'pitfalls.md');

        // D23: parse decisions entries from both files
        const allEntries: Array<{
          id: string;
          pattern: string;
          file: string;
          filePath: string;
          status: string;
          createdDate: string | null;
        }> = [];

        for (const [filePath, type] of [[decisionsPath, 'decision'], [pitfallsPath, 'pitfall']] as const) {
          let content: string;
          try {
            content = await fs.readFile(filePath, 'utf-8');
          } catch {
            continue; // File doesn't exist
          }

          const prefix = type === 'decision' ? 'ADR' : 'PF';
          const headingRe = new RegExp(`^## (${prefix}-\\d+):\\s*(.+)$`, 'gm');
          let match;
          while ((match = headingRe.exec(content)) !== null) {
            const entryId = match[1];
            const pattern = match[2].trim();

            // Extract Status from section
            const sectionStart = match.index;
            const nextHeading = content.indexOf('\n## ', sectionStart + 1);
            const section = nextHeading !== -1
              ? content.slice(sectionStart, nextHeading)
              : content.slice(sectionStart);
            const statusMatch = section.match(/- \*\*Status\*\*:\s*(\w+)/);
            const status = statusMatch ? statusMatch[1] : 'Unknown';

            // Skip deprecated/superseded entries
            if (status === 'Deprecated' || status === 'Superseded') continue;

            // Extract Date for protection check
            const dateMatch = section.match(/- \*\*Date\*\*:\s*(\d{4}-\d{2}-\d{2})/);
            const createdDate = dateMatch ? dateMatch[1] : null;

            allEntries.push({
              id: entryId,
              pattern,
              file: type === 'decision' ? 'decisions' : 'pitfalls',
              filePath,
              status,
              createdDate,
            });
          }
        }

        if (allEntries.length === 0) {
          p.log.info('No active decisions entries found.');
          return;
        }

        // D23: Filter out entries created within 7 days (protected)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const eligible = allEntries.filter(e => {
          if (!e.createdDate) return true; // No date — eligible
          return e.createdDate <= sevenDaysAgo;
        });

        if (eligible.length === 0) {
          p.log.info('All active entries are within the 7-day protection window.');
          return;
        }

        // Load usage data for sorting
        let usageData: Record<string, { cites: number; last_cited: string | null; created: string | null }> = {};
        try {
          const raw = await fs.readFile(path.join(memoryDir, '.decisions-usage.json'), 'utf-8');
          const parsed = JSON.parse(raw);
          // D-SEC2: Guard against non-object/null/array shapes before narrowing into typed record.
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            parsed.version === 1 &&
            parsed.entries !== null &&
            typeof parsed.entries === 'object' &&
            !Array.isArray(parsed.entries)
          ) {
            usageData = parsed.entries as typeof usageData;
          }
        } catch { /* no usage data — all cites=0 */ }

        // D23: Sort by least used: (cites ASC, last_cited ASC NULLS FIRST, created ASC)
        const sorted = [...eligible].sort((a, b) => {
          const aUsage = usageData[a.id] || { cites: 0, last_cited: null, created: null };
          const bUsage = usageData[b.id] || { cites: 0, last_cited: null, created: null };

          // cites ASC
          if (aUsage.cites !== bUsage.cites) return aUsage.cites - bUsage.cites;

          // last_cited ASC NULLS FIRST
          if (aUsage.last_cited === null && bUsage.last_cited !== null) return -1;
          if (aUsage.last_cited !== null && bUsage.last_cited === null) return 1;
          if (aUsage.last_cited && bUsage.last_cited) {
            if (aUsage.last_cited < bUsage.last_cited) return -1;
            if (aUsage.last_cited > bUsage.last_cited) return 1;
          }

          // created ASC
          const aCreated = a.createdDate || '';
          const bCreated = b.createdDate || '';
          return aCreated.localeCompare(bCreated);
        });

        // Take top 20
        const candidates = sorted.slice(0, 20);

        p.intro(color.bgCyan(color.black(' Decisions Capacity Review ')));
        p.log.info(
          `${allEntries.length} active entries across decisions files.\n` +
          `${eligible.length} eligible for review (${allEntries.length - eligible.length} within 7-day protection).\n` +
          `Showing ${candidates.length} least-used entries.`,
        );

        // D23: p.multiselect with unchecked default
        const selected = await p.multiselect({
          message: 'Select entries to deprecate:',
          options: candidates.map(e => ({
            value: e.id,
            label: `[${e.file}] ${e.id}: ${e.pattern}`,
            hint: `${usageData[e.id]?.cites ?? 0} cites, ${e.status}`,
          })),
          required: false,
        });

        if (p.isCancel(selected) || !Array.isArray(selected) || selected.length === 0) {
          p.log.info('No entries selected. Capacity review cancelled.');
          return;
        }

        // Batch deprecation — each updateDecisionsStatus acquires .decisions.lock internally;
        // no outer lock needed (no reentrancy issue since calls are sequential).
        let deprecatedCount = 0;
        for (const entryId of selected as string[]) {
          const entry = candidates.find(e => e.id === entryId);
          if (!entry) continue;

          const updated = await updateDecisionsStatus(entry.filePath, entry.id, 'Deprecated');
          if (updated) {
            deprecatedCount++;
            p.log.success(`Deprecated ${entry.id}: ${entry.pattern}`);
          } else {
            p.log.warn(`Could not update ${entry.id} — update manually`);
          }
        }

        // D28: Check if counts dropped below soft start, clear notifications if so
        let notifications: Record<string, NotificationFileEntry> = {};
        const notifPath = path.join(memoryDir, '.decisions-notifications.json');
        try {
          const raw = JSON.parse(await fs.readFile(notifPath, 'utf-8'));
          if (isNotificationMap(raw)) {
            notifications = raw;
          } else {
            p.log.warn('Notifications file has unexpected shape — treating as empty.');
          }
        } catch { /* no notifications file — nothing to clear */ }

        const devflowDir = getDevFlowDirectory();
        const jsonHelperPath = path.join(devflowDir, 'scripts', 'hooks', 'json-helper.cjs');

        for (const [filePath, type, notifKey] of [
          [decisionsPath, 'decision', 'decisions-capacity-decisions'],
          [pitfallsPath, 'pitfall', 'decisions-capacity-pitfalls'],
        ] as const) {
          try {
            // D23: Use count-active op via json-helper.cjs (single source of truth)
            // D-SEC3: execFileSync with argv array — no shell interpolation of cwd-derived paths.
            const raw = JSON.parse(
              execFileSync('node', [jsonHelperPath, 'count-active', filePath, type], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
              }).trim(),
            );
            const activeCount = isCountActiveResult(raw) ? raw.count : 0;

            // D28: if count dropped below soft start, clear notification
            if (activeCount < 50 && notifications[notifKey]) {
              notifications[notifKey].active = false;
              notifications[notifKey].dismissed_at_threshold = null;
            }
          } catch { /* count-active failed — skip notification update */ }
        }

        await writeFileAtomicExclusive(notifPath, JSON.stringify(notifications, null, 2) + '\n');

        p.log.success(`Deprecated ${deprecatedCount} entry(ies).`);
        p.outro(color.green('Capacity review complete.'));
        return;
      }

      return;
    }

    // --- --dismiss-capacity ---
    if (options.dismissCapacity) {
      const notifPath = path.join(memoryDir, '.decisions-notifications.json');

      let notifications: Record<string, NotificationFileEntry>;
      try {
        const raw = JSON.parse(await fs.readFile(notifPath, 'utf-8'));
        if (!isNotificationMap(raw)) {
          p.log.warn('Notifications file has unexpected shape — treating as empty.');
          p.log.info('No active capacity notifications to dismiss.');
          return;
        }
        notifications = raw;
      } catch {
        p.log.info('No capacity notifications found.');
        return;
      }

      const activeKeys = Object.entries(notifications)
        .filter(([, v]) => v && v.active && (v.dismissed_at_threshold == null || v.dismissed_at_threshold < (v.threshold ?? 0)))
        .map(([k]) => k);

      if (activeKeys.length === 0) {
        p.log.info('No active capacity notifications to dismiss.');
        return;
      }

      for (const key of activeKeys) {
        const entry = notifications[key];
        entry.dismissed_at_threshold = entry.threshold;
        const fileType = key.replace('decisions-capacity-', '');
        p.log.success(`Dismissed capacity notification for ${fileType} (at threshold ${entry.threshold}).`);
      }

      await writeFileAtomicExclusive(notifPath, JSON.stringify(notifications, null, 2) + '\n');
      return;
    }

    // --- --enable / --disable ---
    let devflowDir: string;
    try {
      const settings: Settings = JSON.parse(settingsContent);
      const sessionEndHook = settings.hooks?.SessionEnd?.[0]?.hooks?.[0]?.command;
      if (sessionEndHook) {
        const hookBinary = sessionEndHook.split(' ')[0].replace(/^"/, '').replace(/"$/, '');
        devflowDir = path.resolve(hookBinary, '..', '..', '..');
      } else {
        devflowDir = getDevFlowDirectory();
      }
    } catch {
      devflowDir = getDevFlowDirectory();
    }

    if (options.enable) {
      const updated = addDecisionsHook(settingsContent, devflowDir);
      if (updated === settingsContent) {
        p.log.info('Decisions learning already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');

      // Remove disabled sentinel if present.
      const disabledSentinel = path.join(memoryDir, 'decisions', '.disabled');
      try {
        await fs.unlink(disabledSentinel);
      } catch { /* may not exist */ }

      p.log.success('Decisions learning enabled — SessionEnd hook registered');
      p.log.info(color.dim('Architectural decisions and pitfalls will be detected from your sessions'));
    }

    if (options.disable) {
      const updated = removeDecisionsHook(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Decisions learning already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');

      // Create disabled sentinel.
      const decisionsDir = path.join(memoryDir, 'decisions');
      await fs.mkdir(decisionsDir, { recursive: true });
      await fs.writeFile(path.join(decisionsDir, '.disabled'), '', 'utf-8');

      p.log.success('Decisions learning disabled — hook removed');
    }
  });
