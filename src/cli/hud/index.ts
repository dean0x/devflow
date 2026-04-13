import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { readStdin } from './stdin.js';
import { loadConfig, resolveComponents } from './config.js';
import { gatherGitStatus } from './git.js';
import { parseTranscript } from './transcript.js';
import { fetchUsageData } from './usage-api.js';
import { gatherConfigCounts } from './components/config-counts.js';
import { getLearningCounts } from './learning-counts.js';
import { getActiveNotification } from './notifications.js';
import { render } from './render.js';
import type { GatherContext } from './types.js';

const OVERALL_TIMEOUT = 2000; // 2 second overall timeout

async function main(): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), OVERALL_TIMEOUT),
  );

  try {
    const result = await Promise.race([run(), timeoutPromise]);
    process.stdout.write(result);
  } catch {
    // Timeout or error — output nothing (graceful degradation)
  }
}

async function run(): Promise<string> {
  const stdin = await readStdin();

  // Debug: dump raw stdin to file when DEVFLOW_HUD_DEBUG is set
  if (process.env.DEVFLOW_HUD_DEBUG) {
    fs.writeFileSync(process.env.DEVFLOW_HUD_DEBUG, JSON.stringify(stdin, null, 2));
  }

  const config = loadConfig();
  const resolved = resolveComponents(config);
  const components = new Set(resolved);
  const cwd = stdin.cwd || process.cwd();
  const devflowDir =
    process.env.DEVFLOW_DIR ||
    path.join(process.env.HOME || homedir(), '.devflow');

  // Determine what data to gather based on enabled components
  const needsGit =
    components.has('gitBranch') ||
    components.has('gitAheadBehind') ||
    components.has('diffStats') ||
    components.has('releaseInfo') ||
    components.has('worktreeCount');
  const needsTranscript =
    components.has('todoProgress') ||
    components.has('configCounts');
  const needsUsage = components.has('usageQuota');
  const needsConfigCounts = components.has('configCounts');
  const needsLearningCounts = components.has('learningCounts');
  const needsNotifications = components.has('notifications');

  // Parallel data gathering — only fetch what's needed
  const [git, transcript, usage] = await Promise.all([
    needsGit ? gatherGitStatus(cwd) : Promise.resolve(null),
    needsTranscript && stdin.transcript_path
      ? parseTranscript(stdin.transcript_path)
      : Promise.resolve(null),
    needsUsage ? fetchUsageData() : Promise.resolve(null),
  ]);

  // Session start time from transcript file creation time
  let sessionStartTime: number | null = null;
  if (stdin.transcript_path) {
    try {
      const stat = fs.statSync(stdin.transcript_path);
      sessionStartTime = stat.birthtime.getTime();
    } catch { /* file may not exist yet */ }
  }

  // Config counts (fast, synchronous filesystem reads)
  const configCountsData = needsConfigCounts
    ? gatherConfigCounts(cwd)
    : null;

  // Learning counts (fast, synchronous filesystem reads; graceful if log missing)
  const learningCountsData = needsLearningCounts
    ? getLearningCounts(cwd)
    : null;

  // D24: Notification data (fast, synchronous filesystem read)
  const notificationsData = needsNotifications
    ? getActiveNotification(cwd)
    : null;

  // Terminal width via stderr (stdout is piped to Claude Code)
  const terminalWidth = process.stderr.columns || 120;

  const ctx: GatherContext = {
    stdin,
    git,
    transcript,
    usage,
    configCounts: configCountsData,
    learningCounts: learningCountsData,
    notifications: notificationsData,
    config: { ...config, components: resolved } as GatherContext['config'],
    devflowDir,
    sessionStartTime,
    terminalWidth,
  };

  return render(ctx);
}

main();
