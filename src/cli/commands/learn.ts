import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';
import { cleanSelfLearningArtifacts, AUTO_GENERATED_MARKER } from '../utils/learning-cleanup.js';

/**
 * Shape of a single entry in `.memory/.notifications.json`.
 * Mirrors the NotificationEntry in `src/cli/hud/notifications.ts` (read-path)
 * and the structure written by `json-helper.cjs` (write-path).
 */
interface NotificationFileEntry {
  active?: boolean;
  threshold?: number;
  count?: number;
  ceiling?: number;
  dismissed_at_threshold?: number | null;
  severity?: string;
  created_at?: string;
}

/**
 * Learning observation stored in learning-log.jsonl (one JSON object per line).
 * v2 extends type to include 'decision' and 'pitfall', and adds attention flags.
 */
export interface LearningObservation {
  id: string;
  type: 'workflow' | 'procedural' | 'decision' | 'pitfall';
  pattern: string;
  confidence: number;
  observations: number;
  first_seen: string;
  last_seen: string;
  status: 'observing' | 'ready' | 'created' | 'deprecated';
  evidence: string[];
  details: string;
  artifact_path?: string;
  /** Set by staleness checker (D16) when code refs in artifact file are missing */
  mayBeStale?: boolean;
  staleReason?: string;
  /** Set by merge-observation when an incoming observation's details diverge
   *  significantly from the existing entry (Levenshtein ratio < 0.6). See D14. */
  needsReview?: boolean;
  /** D17: Set when knowledge file hits hard ceiling (100 entries) — repurposed from 50 soft cap */
  softCapExceeded?: boolean;
  quality_ok?: boolean;
}

/**
 * Merged learning configuration from global and project-level config files.
 */
export interface LearningConfig {
  max_daily_runs: number;
  throttle_minutes: number;
  model: string;
  debug: boolean;
  /** Number of observations processed per learning run. Default 3, adaptive 5 at 15+ observations. */
  batch_size: number;
}

/**
 * Type guard for validating raw JSON as a LearningObservation.
 * Accepts all 4 types (v2: decision + pitfall added) and all statuses including deprecated.
 */
export function isLearningObservation(obj: unknown): obj is LearningObservation {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.id === 'string' && o.id.length > 0
    && (o.type === 'workflow' || o.type === 'procedural' || o.type === 'decision' || o.type === 'pitfall')
    && typeof o.pattern === 'string' && o.pattern.length > 0
    && typeof o.confidence === 'number'
    && typeof o.observations === 'number'
    && typeof o.first_seen === 'string'
    && typeof o.last_seen === 'string'
    && (o.status === 'observing' || o.status === 'ready' || o.status === 'created' || o.status === 'deprecated')
    && Array.isArray(o.evidence)
    && typeof o.details === 'string';
}

const LEARNING_HOOK_MARKER = 'session-end-learning';
const LEGACY_HOOK_MARKER = 'stop-update-learning';

/**
 * Add the learning SessionEnd hook to settings JSON.
 * Idempotent — returns unchanged JSON if current hook already exists.
 * Self-upgrading — removes legacy Stop hook before adding SessionEnd hook.
 */
export function addLearningHook(settingsJson: string, devflowDir: string): string {
  const hookState = hasLearningHook(settingsJson);

  if (hookState === 'current') {
    return settingsJson;
  }

  // Remove any legacy Stop hooks before adding the new SessionEnd hook
  const cleanedJson = removeLearningHook(settingsJson);
  const settings: Settings = JSON.parse(cleanedJson);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' session-end-learning';

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
 * Remove the learning hook from settings JSON.
 * Checks BOTH SessionEnd (new) and Stop (legacy cleanup).
 * Idempotent — returns unchanged JSON if hook not present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export function removeLearningHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = false;

  function removeFromEvent(event: 'SessionEnd' | 'Stop', marker: string): void {
    const matchers = settings.hooks?.[event];
    if (!matchers) return;
    const before = matchers.length;
    settings.hooks![event] = matchers.filter(
      (m) => !m.hooks.some((h) => h.command.includes(marker)),
    );
    if (settings.hooks![event]!.length < before) changed = true;
    if (settings.hooks![event]!.length === 0) delete settings.hooks![event];
  }

  removeFromEvent('SessionEnd', LEARNING_HOOK_MARKER);
  removeFromEvent('Stop', LEGACY_HOOK_MARKER);

  if (!changed) {
    return settingsJson;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the learning hook is registered in settings JSON or parsed Settings object.
 * Returns 'current' for SessionEnd hook, 'legacy' for old Stop hook, or false if absent.
 */
export function hasLearningHook(input: string | Settings): 'current' | 'legacy' | false {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;

  const hasSessionEnd = settings.hooks?.SessionEnd?.some((matcher) =>
    matcher.hooks.some((h) => h.command.includes(LEARNING_HOOK_MARKER)),
  ) ?? false;

  if (hasSessionEnd) {
    return 'current';
  }

  const hasLegacyStop = settings.hooks?.Stop?.some((matcher) =>
    matcher.hooks.some((h) => h.command.includes(LEGACY_HOOK_MARKER)),
  ) ?? false;

  if (hasLegacyStop) {
    return 'legacy';
  }

  return false;
}

/**
 * Parse a JSONL learning log into typed observations.
 * Skips empty and malformed lines.
 */
export function parseLearningLog(logContent: string): LearningObservation[] {
  if (!logContent.trim()) {
    return [];
  }

  const observations: LearningObservation[] = [];

  for (const line of logContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isLearningObservation(parsed)) {
        observations.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return observations;
}

/**
 * Parse a JSONL log and return valid observations plus the count of invalid entries.
 * Centralises the raw-line-count + parse pattern used by --status, --list, and --purge.
 */
export function loadAndCountObservations(logContent: string): {
  observations: LearningObservation[];
  invalidCount: number;
} {
  const rawLines = logContent.split('\n').filter(l => l.trim()).length;
  const observations = parseLearningLog(logContent);
  return { observations, invalidCount: rawLines - observations.length };
}

/**
 * Format a human-readable status summary for learning state.
 * hookState: 'current' (SessionEnd), 'legacy' (old Stop hook), or false (disabled).
 */
export function formatLearningStatus(observations: LearningObservation[], hookState: 'current' | 'legacy' | false): string {
  const lines: string[] = [];

  if (hookState === 'legacy') {
    lines.push('Self-learning: enabled (legacy — run `devflow learn --disable && devflow learn --enable` to upgrade)');
  } else {
    lines.push(`Self-learning: ${hookState ? 'enabled' : 'disabled'}`);
  }

  if (observations.length === 0) {
    lines.push('Observations: none');
    return lines.join('\n');
  }

  const workflows = observations.filter((o) => o.type === 'workflow');
  const procedurals = observations.filter((o) => o.type === 'procedural');
  const decisions = observations.filter((o) => o.type === 'decision');
  const pitfalls = observations.filter((o) => o.type === 'pitfall');
  const created = observations.filter((o) => o.status === 'created');
  const ready = observations.filter((o) => o.status === 'ready');
  const observing = observations.filter((o) => o.status === 'observing');
  const deprecated = observations.filter((o) => o.status === 'deprecated');
  const needReview = observations.filter((o) => o.mayBeStale || o.needsReview || o.softCapExceeded);

  lines.push(`Observations: ${observations.length} total`);
  lines.push(`  Workflows: ${workflows.length}, Procedural: ${procedurals.length}, Decisions: ${decisions.length}, Pitfalls: ${pitfalls.length}`);
  lines.push(`  Status: ${observing.length} observing, ${ready.length} ready, ${created.length} promoted, ${deprecated.length} deprecated`);
  if (needReview.length > 0) {
    lines.push(`  ${color.yellow('⚠')} ${needReview.length} need review — run 'devflow learn --review'`);
  }

  return lines.join('\n');
}

/**
 * Apply a single JSON config layer onto a LearningConfig, returning a new object.
 * Skips fields with wrong types; swallows parse errors.
 */
// SYNC: Config loading duplicated in scripts/hooks/background-learning load_config()
// Synced fields: max_daily_runs, throttle_minutes, model, debug
// Note: batch_size is loaded here and in session-end-learning, but not in background-learning
export function applyConfigLayer(config: LearningConfig, json: string): LearningConfig {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      max_daily_runs: typeof raw.max_daily_runs === 'number' ? raw.max_daily_runs : config.max_daily_runs,
      throttle_minutes: typeof raw.throttle_minutes === 'number' ? raw.throttle_minutes : config.throttle_minutes,
      model: typeof raw.model === 'string' ? raw.model : config.model,
      debug: typeof raw.debug === 'boolean' ? raw.debug : config.debug,
      batch_size: typeof raw.batch_size === 'number' ? raw.batch_size : config.batch_size,
    };
  } catch {
    return { ...config };
  }
}

/**
 * Load and merge learning configuration from global and project config JSON strings.
 * Project config overrides global config; both override defaults.
 */
export function loadLearningConfig(globalJson: string | null, projectJson: string | null): LearningConfig {
  let config: LearningConfig = {
    max_daily_runs: 5,
    throttle_minutes: 5,
    model: 'sonnet',
    debug: false,
    batch_size: 3,
  };

  if (globalJson) config = applyConfigLayer(config, globalJson);
  if (projectJson) config = applyConfigLayer(config, projectJson);

  return config;
}

/**
 * Read and parse observations from the learning log file.
 * Returns empty results if the file does not exist.
 */
async function readObservations(logPath: string): Promise<{ observations: LearningObservation[]; invalidCount: number }> {
  try {
    const logContent = await fs.readFile(logPath, 'utf-8');
    return loadAndCountObservations(logContent);
  } catch {
    return { observations: [], invalidCount: 0 };
  }
}

/**
 * Acquire a mkdir-based lock directory.
 *
 * Used by CLI writers (`--review`, `--purge-legacy-knowledge`) to serialize
 * against the background learning pipeline. `.learning.lock` guards log mutations;
 * `.knowledge.lock` guards decisions.md / pitfalls.md — the caller picks the path.
 *
 * Stale detection: if the lock directory is older than `staleMs` we assume the
 * previous holder crashed and remove it. Matches the contract documented in
 * `shared/skills/knowledge-persistence/SKILL.md` and mirrored in json-helper.cjs
 * so all lock holders interpret staleness consistently.
 *
 * @returns true when the lock was acquired, false on timeout.
 */
async function acquireMkdirLock(lockDir: string, timeoutMs = 30_000, staleMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockDir);
      return true;
    } catch {
      try {
        const stat = await fs.stat(lockDir);
        if (Date.now() - stat.mtimeMs > staleMs) {
          try { await fs.rmdir(lockDir); } catch { /* race condition OK */ }
          continue;
        }
      } catch { /* lock vanished between EEXIST and stat */ }
      if (Date.now() - start >= timeoutMs) return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

/**
 * Warn the user if invalid entries were found in the learning log.
 */
function warnIfInvalid(invalidCount: number): void {
  if (invalidCount > 0) {
    p.log.warn(`Note: ${invalidCount} invalid entry(ies) found. Run 'devflow learn --purge' to clean.`);
  }
}

/**
 * Atomically write a text file by writing to a sibling `.tmp` file and renaming.
 * Mirrors scripts/hooks/json-helper.cjs writeFileAtomic — single POSIX rename
 * ensures readers either see the old content or the new content, never a partial write.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, filePath);
}

/**
 * Write observations back to the log file atomically.
 * Each observation is serialized as a JSON line. Uses a `.tmp` sibling + rename so
 * concurrent readers (e.g. background-learning during a race) never observe a
 * half-written file.
 */
async function writeObservations(logPath: string, observations: LearningObservation[]): Promise<void> {
  const lines = observations.map(o => JSON.stringify(o));
  const content = lines.join('\n') + (lines.length ? '\n' : '');
  await writeFileAtomic(logPath, content);
}

/**
 * Update the Status: field for a decision or pitfall entry in a knowledge file.
 * Locates the entry by anchor ID (from artifact_path fragment), sets Status to the given value.
 * Acquires a mkdir-based lock before writing. Returns true if the file was updated.
 *
 * The lock path MUST match the render-ready writer in json-helper.cjs so CLI updates
 * serialize against the background learning pipeline.
 */
export async function updateKnowledgeStatus(
  filePath: string,
  anchorId: string,
  newStatus: string,
): Promise<boolean> {
  // Lock path MUST be `.memory/.knowledge.lock` (sibling of `knowledge/`) to match
  // scripts/hooks/json-helper.cjs render-ready + knowledge-append writers.
  // Knowledge files live at `.memory/knowledge/{decisions,pitfalls}.md` so we go up
  // one level from the file's parent directory.
  const memoryDir = path.dirname(path.dirname(filePath));
  const lockPath = path.join(memoryDir, '.knowledge.lock');

  const acquired = await acquireMkdirLock(lockPath);
  if (!acquired) return false;

  try {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return false; // File doesn't exist
    }

    // Find the anchor heading and update Status: field
    const anchorPattern = new RegExp(`(##[^#][^\n]*${escapeRegExp(anchorId)}[^\n]*\n(?:(?!^##)[^\n]*\n)*?)(- \\*\\*Status\\*\\*: )[^\n]+`, 'm');
    const updated = content.replace(anchorPattern, `$1$2${newStatus}`);

    if (updated === content) {
      // Try a simpler replacement: find the Status line after the anchor heading
      const lines = content.split('\n');
      let inSection = false;
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(anchorId)) {
          inSection = true;
        } else if (inSection && lines[i].startsWith('## ')) {
          break; // Past the section
        } else if (inSection && lines[i].match(/^- \*\*Status\*\*: /)) {
          lines[i] = `- **Status**: ${newStatus}`;
          changed = true;
          break;
        }
      }
      if (!changed) return false;
      await writeFileAtomic(filePath, lines.join('\n'));
    } else {
      await writeFileAtomic(filePath, updated);
    }
    return true;
  } finally {
    try { await fs.rmdir(lockPath); } catch { /* already cleaned */ }
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format a stale reason string for display.
 */
function formatStaleReason(obs: LearningObservation): string {
  const reasons: string[] = [];
  if (obs.mayBeStale && obs.staleReason) {
    reasons.push(`stale: ${obs.staleReason}`);
  } else if (obs.mayBeStale) {
    reasons.push('may be stale');
  }
  if (obs.needsReview) reasons.push('artifact missing (deleted?)');
  if (obs.softCapExceeded) reasons.push('knowledge file at capacity');
  return reasons.join(', ') || 'flagged for review';
}

interface LearnOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
  configure?: boolean;
  clear?: boolean;
  reset?: boolean;
  purge?: boolean;
  review?: boolean;
  purgeLegacyKnowledge?: boolean;
  dismissCapacity?: boolean;
}

export const learnCommand = new Command('learn')
  .description('Enable or disable self-learning (workflow detection + auto-commands)')
  .option('--enable', 'Register SessionEnd hook for self-learning')
  .option('--disable', 'Remove self-learning hook')
  .option('--status', 'Show learning status and observation counts')
  .option('--list', 'Show all observations sorted by confidence')
  .option('--configure', 'Interactive configuration wizard')
  .option('--clear', 'Reset learning log (removes all observations)')
  .option('--reset', 'Remove all self-learning artifacts, log, and transient state')
  .option('--purge', 'Remove invalid/corrupted entries from learning log')
  .option('--review', 'Interactively review flagged observations (stale, missing, at capacity)')
  .option('--purge-legacy-knowledge', 'One-time removal of legacy low-signal knowledge entries (ADR-002, PF-001, PF-003, PF-005)')
  .option('--dismiss-capacity', 'Dismiss the current capacity notification for a knowledge file')
  .action(async (options: LearnOptions) => {
    const hasFlag = options.enable || options.disable || options.status || options.list || options.configure || options.clear || options.reset || options.purge || options.review || options.purgeLegacyKnowledge || options.dismissCapacity;
    if (!hasFlag) {
      p.intro(color.bgYellow(color.black(' Self-Learning ')));
      p.note(
        `${color.cyan('devflow learn --enable')}      Register learning hook\n` +
        `${color.cyan('devflow learn --disable')}     Remove learning hook\n` +
        `${color.cyan('devflow learn --status')}      Show learning status\n` +
        `${color.cyan('devflow learn --list')}        Show all observations\n` +
        `${color.cyan('devflow learn --configure')}   Configuration wizard\n` +
        `${color.cyan('devflow learn --clear')}       Reset learning log\n` +
        `${color.cyan('devflow learn --reset')}       Remove artifacts + log + state\n` +
        `${color.cyan('devflow learn --purge')}       Remove invalid entries\n` +
        `${color.cyan('devflow learn --review')}      Review flagged observations interactively\n` +
        `${color.cyan('devflow learn --dismiss-capacity')} Dismiss capacity notification`,
        'Usage',
      );
      p.outro(color.dim('Detects repeated workflows and creates slash commands automatically'));
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      if (options.status) {
        p.log.info('Self-learning: disabled (no settings.json found)');
        return;
      }
      settingsContent = '{}';
    }

    // Shared log path for --status, --list, --purge, --clear
    const logPath = path.join(process.cwd(), '.memory', 'learning-log.jsonl');

    // --- --status ---
    if (options.status) {
      const hookState = hasLearningHook(settingsContent);
      const { observations, invalidCount } = await readObservations(logPath);

      const status = formatLearningStatus(observations, hookState);
      p.log.info(status);
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
        p.log.info('No observations yet. Learning log not found.');
        return;
      }

      const { observations, invalidCount } = await readObservations(logPath);

      if (observations.length === 0) {
        p.log.info('No observations recorded yet.');
        return;
      }

      // Sort by confidence descending
      observations.sort((a, b) => b.confidence - a.confidence);

      p.intro(color.bgYellow(color.black(' Learning Observations ')));
      for (const obs of observations) {
        const typeIconMap = { workflow: 'W', procedural: 'P', decision: 'D', pitfall: 'F' } as const;
        const typeIcon = typeIconMap[obs.type] ?? 'F';
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
      p.outro(color.dim(`${observations.length} observation(s) total`));
      return;
    }

    // --- --configure ---
    if (options.configure) {
      p.intro(color.bgYellow(color.black(' Learning Configuration ')));

      const maxRuns = await p.text({
        message: 'Maximum background runs per day',
        placeholder: '5',
        defaultValue: '5',
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
        message: 'Model for pattern detection',
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

      const batchSize = await p.text({
        message: 'Observations per learning run (adaptive: 5 at 15+ observations)',
        placeholder: '3',
        defaultValue: '3',
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 1 || n > 20) return 'Enter a number between 1 and 20';
          return undefined;
        },
      });
      if (p.isCancel(batchSize)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const scope = await p.select({
        message: 'Configuration scope',
        options: [
          { value: 'project', label: 'Project', hint: 'This project only (.memory/learning.json)' },
          { value: 'global', label: 'Global', hint: 'All projects (~/.devflow/learning.json)' },
        ],
      });
      if (p.isCancel(scope)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const config: LearningConfig = {
        max_daily_runs: Number(maxRuns),
        throttle_minutes: Number(throttle),
        model: model as string,
        debug: debugMode,
        batch_size: Number(batchSize),
      };

      const configJson = JSON.stringify(config, null, 2) + '\n';

      if (scope === 'global') {
        const globalDir = path.join(process.env.HOME || '~', '.devflow');
        await fs.mkdir(globalDir, { recursive: true });
        await fs.writeFile(path.join(globalDir, 'learning.json'), configJson, 'utf-8');
        p.log.success(`Global config written to ${color.dim(path.join(globalDir, 'learning.json'))}`);
      } else {
        const cwd = process.cwd();
        const memoryDir = path.join(cwd, '.memory');
        await fs.mkdir(memoryDir, { recursive: true });
        await fs.writeFile(path.join(memoryDir, 'learning.json'), configJson, 'utf-8');
        p.log.success(`Project config written to ${color.dim(path.join(memoryDir, 'learning.json'))}`);
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
        p.log.info('No learning log to purge.');
        return;
      }

      const { observations, invalidCount } = loadAndCountObservations(logContent);

      if (invalidCount === 0) {
        p.log.info('No invalid entries found. Learning log is clean.');
        return;
      }

      const validLines = observations.map(o => JSON.stringify(o));
      await fs.writeFile(logPath, validLines.join('\n') + (validLines.length ? '\n' : ''), 'utf-8');
      p.log.success(`Purged ${invalidCount} invalid entry(ies). ${observations.length} valid observation(s) remain.`);
      return;
    }

    // --- --reset ---
    if (options.reset) {
      const memoryDir = path.join(process.cwd(), '.memory');
      const lockDir = path.join(memoryDir, '.learning.lock');

      // Acquire lock to prevent conflict with running background-learning
      try {
        await fs.mkdir(lockDir);
      } catch {
        p.log.error('Learning system is currently running. Try again in a moment.');
        return;
      }

      try {
        // Inventory what will be removed (dry-run) before asking for confirmation
        const { observations } = await readObservations(logPath);

        // Count artifacts without removing them
        const skillsDir = path.join(claudeDir, 'skills');
        const commandsDir = path.join(claudeDir, 'commands', 'self-learning');
        let skillCount = 0;
        let cmdCount = 0;
        try {
          const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
          for (const entry of skillEntries) {
            if (!entry.isDirectory() || entry.name.startsWith('devflow:')) continue;
            const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
            try {
              const content = await fs.readFile(skillFile, 'utf-8');
              if (content.split('\n').slice(0, 10).join('\n').includes(AUTO_GENERATED_MARKER)) {
                skillCount++;
              }
            } catch { /* file doesn't exist */ }
          }
        } catch { /* skills dir doesn't exist */ }
        try {
          const cmdEntries = await fs.readdir(commandsDir, { withFileTypes: true });
          for (const entry of cmdEntries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            try {
              const content = await fs.readFile(path.join(commandsDir, entry.name), 'utf-8');
              if (content.split('\n').slice(0, 10).join('\n').includes(AUTO_GENERATED_MARKER)) {
                cmdCount++;
              }
            } catch { /* file doesn't exist */ }
          }
        } catch { /* commands dir doesn't exist */ }

        const transientFiles = [
          '.learning-session-count',
          '.learning-batch-ids',
          '.learning-runs-today',
          '.learning-notified-at',
          '.notifications.json',
          '.knowledge-usage.json',
          '.learning-manifest.json',
        ];
        let transientCount = 0;
        for (const f of transientFiles) {
          try {
            await fs.access(path.join(memoryDir, f));
            transientCount++;
          } catch { /* doesn't exist */ }
        }

        if (skillCount === 0 && cmdCount === 0 && observations.length === 0 && transientCount === 0) {
          p.log.info('Nothing to clean — no self-learning artifacts or state found.');
          return;
        }

        // Build and show confirmation prompt
        const lines: string[] = ['This will remove:'];
        if (skillCount > 0) lines.push(`  - ${skillCount} self-learning skill(s)`);
        if (cmdCount > 0) lines.push(`  - ${cmdCount} self-learning command(s)`);
        if (observations.length > 0) lines.push(`  - Learning log (${observations.length} observations)`);
        if (transientCount > 0) lines.push(`  - ${transientCount} transient state file(s)`);

        if (process.stdin.isTTY) {
          p.log.info(lines.join('\n'));
          const confirm = await p.confirm({
            message: 'Continue? This cannot be undone.',
            initialValue: false,
          });
          if (p.isCancel(confirm) || !confirm) {
            p.log.info('Reset cancelled.');
            return;
          }
        }

        // User confirmed — now actually remove everything
        const artifactResult = await cleanSelfLearningArtifacts(claudeDir);

        // Truncate learning log
        try {
          await fs.writeFile(logPath, '', 'utf-8');
        } catch { /* file may not exist */ }

        // Remove transient state files
        for (const f of transientFiles) {
          try {
            await fs.unlink(path.join(memoryDir, f));
          } catch { /* file may not exist */ }
        }

        // Clean up knowledge-usage lock directory if stale
        try {
          await fs.rmdir(path.join(memoryDir, '.knowledge-usage.lock'));
        } catch { /* doesn't exist or already cleaned */ }

        // Remove stale `enabled` field from learning.json (migration)
        const configPath = path.join(memoryDir, 'learning.json');
        try {
          const configContent = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(configContent) as Record<string, unknown>;
          if ('enabled' in config) {
            delete config.enabled;
            if (Object.keys(config).length === 0) {
              await fs.unlink(configPath);
            } else {
              await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
            }
          }
        } catch { /* config may not exist */ }

        const parts: string[] = [];
        if (artifactResult.removed > 0) parts.push(`${artifactResult.removed} artifact(s)`);
        if (observations.length > 0) parts.push('learning log');
        if (transientCount > 0) parts.push('transient state');

        p.log.success(`Reset complete — removed ${parts.join(', ')}.`);
      } finally {
        // Release lock
        try { await fs.rmdir(lockDir); } catch { /* already cleaned */ }
      }
      return;
    }

    // --- --clear ---
    if (options.clear) {
      try {
        await fs.access(logPath);
      } catch {
        p.log.info('No learning log to clear.');
        return;
      }

      if (process.stdin.isTTY) {
        const confirm = await p.confirm({
          message: 'Clear all learning observations? This cannot be undone.',
          initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) {
          p.log.info('Clear cancelled.');
          return;
        }
      }

      await fs.writeFile(logPath, '', 'utf-8');
      p.log.success('Learning log cleared.');
      return;
    }

    // --- --review ---
    if (options.review) {
      const mode = await p.select({
        message: 'Review mode:',
        options: [
          { value: 'observations', label: 'Review flagged observations', hint: 'stale, missing, at capacity' },
          { value: 'capacity', label: 'Review knowledge capacity', hint: 'deprecate least-used entries' },
          { value: 'cancel', label: 'Cancel' },
        ],
      });

      if (p.isCancel(mode) || mode === 'cancel') {
        return;
      }

      if (mode === 'observations') {
        const { observations, invalidCount } = await readObservations(logPath);
        warnIfInvalid(invalidCount);

        const flagged = observations.filter(
          (o) => o.mayBeStale || o.needsReview || o.softCapExceeded,
        );

        if (flagged.length === 0) {
          p.log.info('No observations flagged for review. All clear.');
          return;
        }

        // Acquire .learning.lock so we don't race with background-learning during the
        // interactive loop. The internal updateKnowledgeStatus call still takes its own
        // .knowledge.lock — different lock directories, no deadlock.
        const memoryDirForReview = path.join(process.cwd(), '.memory');
        const learningLockDir = path.join(memoryDirForReview, '.learning.lock');
        const lockAcquired = await acquireMkdirLock(learningLockDir);
        if (!lockAcquired) {
          p.log.error('Learning system is currently running. Try again in a moment.');
          return;
        }

        p.intro(color.bgYellow(color.black(' Learning Review ')));
        p.log.info(`${flagged.length} observation(s) flagged for review.`);

        const updatedObservations = [...observations];

        try {
          for (const obs of flagged) {
            const typeLabel = obs.type.charAt(0).toUpperCase() + obs.type.slice(1);
            const reason = formatStaleReason(obs);

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
              // Persist any changes made so far before exiting so the user keeps
              // partial progress (and log/knowledge stay consistent).
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

              // Update Status: field in knowledge file for decisions/pitfalls
              if ((obs.type === 'decision' || obs.type === 'pitfall') && obs.artifact_path) {
                const hashIdx = obs.artifact_path.indexOf('#');
                if (hashIdx !== -1) {
                  const knowledgePath = obs.artifact_path.slice(0, hashIdx);
                  const anchorId = obs.artifact_path.slice(hashIdx + 1);
                  const absPath = path.isAbsolute(knowledgePath)
                    ? knowledgePath
                    : path.join(process.cwd(), knowledgePath);
                  const updated = await updateKnowledgeStatus(absPath, anchorId, 'Deprecated');
                  if (updated) {
                    p.log.success(`Updated Status to Deprecated in ${path.basename(absPath)}`);
                  } else {
                    p.log.warn(`Could not update Status in ${path.basename(absPath)} — update manually`);
                  }
                }
              }

              // Persist log after each deprecation so Ctrl-C never leaves the log
              // out of sync with the knowledge file updates.
              await writeObservations(logPath, updatedObservations);
              p.log.success(`Marked '${obs.pattern}' as deprecated.`);
            } else if (action === 'keep') {
              updatedObservations[idx] = {
                ...updatedObservations[idx],
                mayBeStale: undefined,
                needsReview: undefined,
                softCapExceeded: undefined,
              };
              // Keep writes are flag-clears only; still persist immediately for
              // consistent on-disk state if the loop is interrupted.
              await writeObservations(logPath, updatedObservations);
              p.log.success(`Cleared review flags for '${obs.pattern}'.`);
            }
            // 'skip' — no change
          }

          // Final write is a no-op if every branch already persisted, but cheap
          // and keeps the success path explicit.
          await writeObservations(logPath, updatedObservations);
        } finally {
          try { await fs.rmdir(learningLockDir); } catch { /* already cleaned */ }
        }

        p.outro(color.green('Review complete.'));
        return;
      }

      if (mode === 'capacity') {
        const memoryDir = path.join(process.cwd(), '.memory');
        const knowledgeDir = path.join(memoryDir, 'knowledge');
        const decisionsPath = path.join(knowledgeDir, 'decisions.md');
        const pitfallsPath = path.join(knowledgeDir, 'pitfalls.md');

        // D23: parse knowledge entries from both files
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
          p.log.info('No active knowledge entries found.');
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
          const raw = await fs.readFile(path.join(memoryDir, '.knowledge-usage.json'), 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed && parsed.version === 1) usageData = parsed.entries || {};
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

        p.intro(color.bgYellow(color.black(' Knowledge Capacity Review ')));
        p.log.info(
          `${allEntries.length} active entries across knowledge files.\n` +
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

        // Batch deprecation
        const learningLockDir = path.join(memoryDir, '.learning.lock');
        const lockAcquired = await acquireMkdirLock(learningLockDir);
        if (!lockAcquired) {
          p.log.error('Learning system is currently running. Try again in a moment.');
          return;
        }

        try {
          let deprecatedCount = 0;
          for (const entryId of selected as string[]) {
            const entry = candidates.find(e => e.id === entryId);
            if (!entry) continue;

            const updated = await updateKnowledgeStatus(entry.filePath, entry.id, 'Deprecated');
            if (updated) {
              deprecatedCount++;
              p.log.success(`Deprecated ${entry.id}: ${entry.pattern}`);
            } else {
              p.log.warn(`Could not update ${entry.id} — update manually`);
            }
          }

          // D28: Check if counts dropped below soft start, clear notifications if so
          let notifications: Record<string, NotificationFileEntry> = {};
          try {
            notifications = JSON.parse(
              await fs.readFile(path.join(memoryDir, '.notifications.json'), 'utf-8'),
            );
          } catch { /* no notifications file — nothing to clear */ }

          const devflowDir = getDevFlowDirectory();
          const jsonHelperPath = path.join(devflowDir, 'scripts', 'hooks', 'json-helper.cjs');

          for (const [filePath, type, notifKey] of [
            [decisionsPath, 'decision', 'knowledge-capacity-decisions'],
            [pitfallsPath, 'pitfall', 'knowledge-capacity-pitfalls'],
          ] as const) {
            try {
              // D23: Use count-active op via json-helper.cjs (single source of truth)
              const result = JSON.parse(
                execSync(
                  `node "${jsonHelperPath}" count-active "${filePath}" "${type}"`,
                  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
                ).trim(),
              );
              const activeCount = result.count ?? 0;

              // D28: if count dropped below soft start, clear notification
              if (activeCount < 50 && notifications[notifKey]) {
                notifications[notifKey].active = false;
                notifications[notifKey].dismissed_at_threshold = null;
              }
            } catch { /* count-active failed — skip notification update */ }
          }

          await writeFileAtomic(path.join(memoryDir, '.notifications.json'), JSON.stringify(notifications, null, 2) + '\n');

          p.log.success(`Deprecated ${deprecatedCount} entry(ies).`);
        } finally {
          try { await fs.rmdir(learningLockDir); } catch { /* already cleaned */ }
        }

        p.outro(color.green('Capacity review complete.'));
        return;
      }

      return;
    }

    // --- --purge-legacy-knowledge ---
    if (options.purgeLegacyKnowledge) {
      // Hard-coded targets from the v2 signal-quality audit — these were the only
      // agent-summary entries that survived review; widen this list only with
      // another audit.
      const LEGACY_IDS = ['ADR-002', 'PF-001', 'PF-003', 'PF-005'];
      const memoryDirForPurge = path.join(process.cwd(), '.memory');
      const knowledgeDir = path.join(memoryDirForPurge, 'knowledge');
      const decisionsPath = path.join(knowledgeDir, 'decisions.md');
      const pitfallsPath = path.join(knowledgeDir, 'pitfalls.md');

      p.intro(color.bgYellow(color.black(' Purge Legacy Knowledge ')));
      p.log.info(
        `This will remove the following low-signal legacy entries:\n` +
        LEGACY_IDS.map(id => `  - ${id}`).join('\n') +
        '\n\nThese were created by agent-summary extraction (v1) and replaced by transcript-based extraction (v2).',
      );

      if (process.stdin.isTTY) {
        const confirm = await p.confirm({
          message: 'Proceed with removal? This cannot be undone.',
          initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) {
          p.cancel('Purge cancelled.');
          return;
        }
      }

      // Acquire the same `.knowledge.lock` used by json-helper.cjs render-ready /
      // knowledge-append and by updateKnowledgeStatus — concurrent writers must
      // all serialize on this single lock directory.
      const knowledgeLockDir = path.join(memoryDirForPurge, '.knowledge.lock');
      const purgeLockAcquired = await acquireMkdirLock(knowledgeLockDir);
      if (!purgeLockAcquired) {
        p.log.error('Knowledge files are currently being written. Try again in a moment.');
        return;
      }

      let removed = 0;
      try {
        for (const filePath of [decisionsPath, pitfallsPath]) {
          let content: string;
          try {
            content = await fs.readFile(filePath, 'utf-8');
          } catch {
            continue; // File doesn't exist
          }

          const prefix = filePath.includes('decisions') ? 'ADR' : 'PF';
          const legacyInFile = LEGACY_IDS.filter(id => id.startsWith(prefix));

          let updatedContent = content;
          for (const legacyId of legacyInFile) {
            // Remove the section from `## LEGACYID:` to the next `## ` or end-of-file
            const sectionRegex = new RegExp(
              `\\n## ${escapeRegExp(legacyId)}:[^\\n]*(?:\\n(?!## )[^\\n]*)*`,
              'g',
            );
            const before = updatedContent;
            updatedContent = updatedContent.replace(sectionRegex, '');
            if (updatedContent !== before) removed++;
          }

          if (updatedContent !== content) {
            // Update TL;DR count
            const headingMatches = updatedContent.match(/^## (ADR|PF)-/gm) || [];
            const count = headingMatches.length;
            const label = prefix === 'ADR' ? 'decisions' : 'pitfalls';
            updatedContent = updatedContent.replace(
              /<!-- TL;DR: \d+ (decisions|pitfalls)[^>]*-->/,
              `<!-- TL;DR: ${count} ${label}. Key: -->`,
            );
            await writeFileAtomic(filePath, updatedContent);
          }
        }

        // Remove orphan PROJECT-PATTERNS.md — stale artifact, nothing generates/reads it
        const projectPatternsPath = path.join(memoryDirForPurge, 'PROJECT-PATTERNS.md');
        try {
          await fs.unlink(projectPatternsPath);
          removed++;
          p.log.info('Removed orphan PROJECT-PATTERNS.md');
        } catch { /* File doesn't exist — fine */ }
      } finally {
        try { await fs.rmdir(knowledgeLockDir); } catch { /* already cleaned */ }
      }

      if (removed === 0) {
        p.log.info('No legacy entries found — already clean.');
      } else {
        p.log.success(`Removed ${removed} legacy entry(ies).`);
      }
      p.outro(color.green('Legacy purge complete.'));
      return;
    }

    // --- --dismiss-capacity ---
    if (options.dismissCapacity) {
      const memoryDir = path.join(process.cwd(), '.memory');
      const notifPath = path.join(memoryDir, '.notifications.json');

      let notifications: Record<string, NotificationFileEntry>;
      try {
        notifications = JSON.parse(await fs.readFile(notifPath, 'utf-8'));
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
        const fileType = key.replace('knowledge-capacity-', '');
        p.log.success(`Dismissed capacity notification for ${fileType} (at threshold ${entry.threshold}).`);
      }

      await writeFileAtomic(notifPath, JSON.stringify(notifications, null, 2) + '\n');
      return;
    }

    // --- --enable / --disable ---
    // Resolve devflow scripts directory from settings.json hooks or default
    let devflowDir: string;
    try {
      const settings: Settings = JSON.parse(settingsContent);
      // Try to extract devflowDir from existing hooks (SessionEnd first, Stop fallback)
      const sessionEndHook = settings.hooks?.SessionEnd?.[0]?.hooks?.[0]?.command;
      const stopHook = settings.hooks?.Stop?.[0]?.hooks?.[0]?.command;
      const hookCommand = sessionEndHook || stopHook;
      if (hookCommand) {
        const hookBinary = hookCommand.split(' ')[0];
        devflowDir = path.resolve(hookBinary, '..', '..', '..');
      } else {
        devflowDir = getDevFlowDirectory();
      }
    } catch {
      devflowDir = getDevFlowDirectory();
    }

    if (options.enable) {
      const priorState = hasLearningHook(settingsContent);
      const updated = addLearningHook(settingsContent, devflowDir);
      if (updated === settingsContent) {
        p.log.info('Self-learning already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      if (priorState === 'legacy') {
        p.log.success('Self-learning upgraded — legacy Stop hook replaced with SessionEnd hook');
      } else {
        p.log.success('Self-learning enabled — SessionEnd hook registered');
      }
      p.log.info(color.dim('Repeated workflows will be detected and turned into slash commands'));
    }

    if (options.disable) {
      const updated = removeLearningHook(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Self-learning already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Self-learning disabled — hook removed');
    }
  });
