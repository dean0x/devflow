import { readStdin } from './stdin.js';
import { loadConfig, resolveComponents } from './config.js';
import { gatherGitStatus } from './git.js';
import { parseTranscript } from './transcript.js';
import { fetchUsageData } from './usage-api.js';
import { gatherConfigCounts } from './components/config-counts.js';
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
  const config = loadConfig();
  const components = new Set(resolveComponents(config));
  const cwd = stdin.cwd || process.cwd();
  const devflowDir =
    process.env.DEVFLOW_DIR ||
    (await import('node:path')).join(
      process.env.HOME || '~',
      '.devflow',
    );

  // Determine what data to gather based on enabled components
  const needsGit =
    components.has('gitBranch') ||
    components.has('gitAheadBehind') ||
    components.has('diffStats');
  const needsTranscript =
    components.has('toolActivity') ||
    components.has('agentActivity') ||
    components.has('todoProgress') ||
    components.has('speed');
  const needsUsage = components.has('usageQuota');
  const needsConfigCounts = components.has('configCounts');

  // Parallel data gathering — only fetch what's needed
  const [git, transcript, usage] = await Promise.all([
    needsGit ? gatherGitStatus(cwd) : Promise.resolve(null),
    needsTranscript && stdin.transcript_path
      ? parseTranscript(stdin.transcript_path)
      : Promise.resolve(null),
    needsUsage ? fetchUsageData() : Promise.resolve(null),
  ]);

  // Session start time from session_id presence (approximate via process uptime)
  let sessionStartTime: number | null = null;
  if (stdin.session_id) {
    sessionStartTime = Date.now() - process.uptime() * 1000;
  }

  // Config counts (fast, synchronous filesystem reads)
  const configCountsData = needsConfigCounts
    ? gatherConfigCounts(cwd)
    : null;

  // Terminal width via stderr (stdout is piped to Claude Code)
  const terminalWidth = process.stderr.columns || 120;

  const ctx: GatherContext = {
    stdin,
    git,
    transcript,
    usage,
    speed: null, // Speed requires cross-render state tracking (future enhancement)
    configCounts: configCountsData,
    config: { ...config, components: resolveComponents(config) },
    devflowDir,
    sessionStartTime,
    terminalWidth,
  };

  return render(ctx);
}

main();
