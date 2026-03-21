/**
 * StdinData — the JSON that Claude Code pipes to statusLine commands.
 */
export interface StdinData {
  model?: { display_name?: string; id?: string };
  cwd?: string;
  context_window?: {
    context_window_size?: number;
    current_usage?: { input_tokens?: number };
  };
  session_id?: string;
  transcript_path?: string;
}

/**
 * Component IDs — the 14 HUD components.
 */
export type ComponentId =
  | 'directory'
  | 'gitBranch'
  | 'gitAheadBehind'
  | 'diffStats'
  | 'model'
  | 'contextUsage'
  | 'versionBadge'
  | 'sessionDuration'
  | 'usageQuota'
  | 'toolActivity'
  | 'agentActivity'
  | 'todoProgress'
  | 'speed'
  | 'configCounts';

/**
 * Preset names.
 */
export type PresetName = 'minimal' | 'classic' | 'standard' | 'full';

/**
 * HUD config persisted to ~/.devflow/hud.json.
 */
export interface HudConfig {
  preset: PresetName | 'custom';
  components: ComponentId[];
}

/**
 * Component render result.
 */
export interface ComponentResult {
  text: string; // ANSI-formatted
  raw: string; // plain text (for width calculation)
}

/**
 * Component function signature.
 */
export type ComponentFn = (ctx: GatherContext) => Promise<ComponentResult | null>;

/**
 * Git status data gathered from the working directory.
 */
export interface GitStatus {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  filesChanged: number;
  additions: number;
  deletions: number;
}

/**
 * Transcript data parsed from session JSONL.
 */
export interface TranscriptData {
  tools: Array<{ name: string; status: 'running' | 'completed' }>;
  agents: Array<{ name: string; model?: string; status: 'running' | 'completed' }>;
  todos: { completed: number; total: number };
}

/**
 * Usage API data.
 */
export interface UsageData {
  dailyUsagePercent: number | null;
  weeklyUsagePercent: number | null;
}

/**
 * Speed tracking data.
 */
export interface SpeedData {
  tokensPerSecond: number | null;
}

/**
 * Config counts data for the configCounts component.
 */
export interface ConfigCountsData {
  claudeMdFiles: number;
  rules: number;
  mcpServers: number;
  hooks: number;
}

/**
 * Gather context passed to all component render functions.
 */
export interface GatherContext {
  stdin: StdinData;
  git: GitStatus | null;
  transcript: TranscriptData | null;
  usage: UsageData | null;
  speed: SpeedData | null;
  configCounts: ConfigCountsData | null;
  config: HudConfig;
  devflowDir: string;
  sessionStartTime: number | null;
  terminalWidth: number;
}
