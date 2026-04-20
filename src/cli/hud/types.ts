/**
 * StdinData — the JSON that Claude Code pipes to statusLine commands.
 */
export interface StdinData {
  model?: { display_name?: string; id?: string };
  cwd?: string;
  context_window?: {
    context_window_size?: number;
    current_usage?: { input_tokens?: number; output_tokens?: number };
    used_percentage?: number;
  };
  cost?: { total_cost_usd?: number };
  session_id?: string;
  transcript_path?: string;
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number };
    seven_day?: { used_percentage?: number; resets_at?: number };
  };
}

/**
 * Component IDs — the 16 HUD components.
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
  | 'todoProgress'
  | 'configCounts'
  | 'sessionCost'
  | 'releaseInfo'
  | 'worktreeCount'
  | 'learningCounts'
  | 'notifications';

/**
 * HUD config persisted to ~/.devflow/hud.json.
 */
export interface HudConfig {
  enabled: boolean;
  detail: boolean;
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
  staged: boolean;
  ahead: number;
  behind: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  lastTag: string | null;
  commitsSinceTag: number;
  worktreeCount: number;
}

/**
 * Transcript data parsed from session JSONL.
 */
export interface TranscriptData {
  tools: Array<{ name: string; status: 'running' | 'completed'; target?: string; description?: string }>;
  agents: Array<{ name: string; model?: string; status: 'running' | 'completed'; description?: string }>;
  todos: { completed: number; total: number };
  skills: string[];
}

/**
 * Usage quota data extracted from stdin rate_limits.
 */
export interface UsageData {
  fiveHourPercent: number | null;
  sevenDayPercent: number | null;
  fiveHourResetsAt: number | null;
  sevenDayResetsAt: number | null;
}

/**
 * Aggregated cost across sessions for weekly/monthly tracking.
 */
export interface CostAggregation {
  weeklyCost: number | null;
  monthlyCost: number | null;
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
 * Learning counts data for the learningCounts HUD component.
 * @devflow-design-decision D15: Hard ceiling (100) + HUD attention counter, not auto-pruning.
 * We cannot reliably detect 'irrelevance' without human judgment. The hard ceiling (D17)
 * prevents unbounded growth; the HUD shifts the decision to the user at the point where it matters.
 */
export interface LearningCountsData {
  workflows: number;
  procedural: number;
  decisions: number;
  pitfalls: number;
  needReview: number;
}

/**
 * D24: Notification data for the HUD notifications component.
 */
export interface NotificationData {
  id: string;
  severity: 'dim' | 'warning' | 'error';
  text: string;
  count?: number;
  ceiling?: number;
}

/**
 * Gather context passed to all component render functions.
 */
export interface GatherContext {
  stdin: StdinData;
  git: GitStatus | null;
  transcript: TranscriptData | null;
  usage: UsageData | null;
  configCounts: ConfigCountsData | null;
  learningCounts: LearningCountsData | null;
  notifications?: NotificationData | null;
  costHistory: CostAggregation | null;
  config: HudConfig & { components: ComponentId[] };
  devflowDir: string;
  sessionStartTime: number | null;
  terminalWidth: number;
}
