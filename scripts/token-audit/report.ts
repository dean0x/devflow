/**
 * Aggregation and rendering for the token-audit tool. `buildReport` is pure: parsed
 * sessions in, an `AuditReport` out. `renderMarkdown` and `renderJson` turn it into text.
 */

import { BASH_CLASSES, DECISIONS_SHAPES } from './parse.js';
import type { AuditRequest, BashClass, CommandMention, DecisionsShape, ParsedSignals, SkillCall } from './parse.js';
import { segmentAt } from './segment.js';
import type { Segment, Segments } from './segment.js';
import {
  FAMILY_PRICE,
  PRICED_FAMILIES,
  WEIGHTS,
  cacheWriteTotal,
  contextSize,
  costEquivalent,
  inputSideCe,
  modelFamily,
} from './tokens.js';
import type { ModelFamily, TokenCounts } from './tokens.js';
import { MAX_PATH_CHARS, mdCell, sanitizeText } from './types.js';
import type { AuditError, CapNotice, Limits, Result, SkipCounts } from './types.js';

// ── Input ────────────────────────────────────────────────────────────────────

export interface SubagentData {
  readonly agentId: string;
  readonly agentType: string;
  readonly segment: Segment;
  readonly requests: readonly AuditRequest[];
  /** The parser's counts for this transcript. Absent when the data was built without the parser: such a spawn feeds no signal table. */
  readonly signals?: ParsedSignals;
  /** True when another spawn was launched in the same parent message (D-AUDIT-FIRST-TURN). Absent means not. */
  readonly sibling?: boolean;
}

export interface SessionData {
  readonly sessionId: string;
  readonly main: {
    readonly requests: readonly AuditRequest[];
    readonly segments: Segments;
    readonly skillCalls: readonly SkillCall[];
    /** The slash commands the user ran, with their arguments: they tell a plan-document `/implement` run from the rest (D-AUDIT-RUN-DIST). */
    readonly commands?: readonly CommandMention[];
  } | null;
  readonly subagents: readonly SubagentData[];
}

/** Date window in epoch ms; `untilMs` is exclusive. A null bound is open. */
export interface TimeWindow {
  readonly sinceMs: number | null;
  readonly untilMs: number | null;
}

export interface ReportScope {
  readonly dir: string;
  readonly session: string | null;
  readonly exclude: readonly string[];
  readonly agentType: string | null;
  readonly since: string | null;
  readonly until: string | null;
  readonly mainTranscripts: number;
  readonly subagentTranscripts: number;
}

export interface ParseTotals {
  readonly lines: number;
  readonly syntheticDropped: number;
  readonly chunksCollapsed: number;
}

export interface ReportInput {
  readonly sessions: readonly SessionData[];
  readonly scope: ReportScope;
  readonly window: TimeWindow;
  readonly skipped: SkipCounts;
  readonly parseTotals: ParseTotals;
  readonly caps: readonly CapNotice[];
  readonly limits: Pick<Limits, 'maxSkillNames' | 'maxUnpricedModels'>;
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface TotalsRow {
  readonly requests: number;
  readonly input: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheWriteUnknown: number;
  readonly cacheRead: number;
  readonly output: number;
  readonly ce: number;
}

export interface FamilyRow {
  readonly family: ModelFamily;
  readonly requests: number;
  readonly ceMain: number;
  readonly ceSubagent: number;
  readonly ce: number;
  /** Null for the unpriced family. */
  readonly price: number | null;
  /** `ce * price`; null when unpriced. */
  readonly priced: number | null;
  readonly pricedShare: number | null;
}

export interface UnpricedModel {
  readonly model: string;
  readonly requests: number;
  readonly ce: number;
}

/** First turns of one agent type that came after another spawn of the type, not launched with it (D-AUDIT-FIRST-TURN). */
export interface StaggeredRow {
  readonly spawns: number;
  /** Spawns whose first request read cache. */
  readonly hits: number;
  readonly hitShare: number;
  readonly medianCacheRead: number;
  /** Spawns whose first-turn cache read exceeds the type's static-prefix estimate by more than 1,000 tokens. */
  readonly aboveStaticPrefix: number;
}

export interface AgentTypeRow {
  readonly agentType: string;
  readonly spawns: number;
  readonly turns: number;
  readonly medianTurns: number;
  readonly p90Turns: number;
  /** Per spawn: the largest context any of its requests carried (D-AUDIT-PEAK-CTX). */
  readonly medianPeakContext: number;
  readonly p90PeakContext: number;
  readonly maxPeakContext: number;
  readonly medianStartupContext: number;
  readonly p90StartupContext: number;
  /** Spawns whose first request is inside the window: the base of every first-turn figure below. */
  readonly firstTurnSpawns: number;
  /** Share of those spawns whose first request read cache (cache_read > 0). */
  readonly firstTurnCacheHitShare: number;
  /** Median over those spawns of first-turn cache read / first-turn context. */
  readonly medianFirstTurnReadRatio: number;
  readonly medianFirstTurnCacheRead: number;
  /** Smallest positive first-turn cache read of the type: what a warm first turn reads of the shared prefix. 0 when none read. */
  readonly staticPrefixEstimate: number;
  /** Spawns launched in the same parent message as another spawn. */
  readonly siblingSpawns: number;
  readonly staggered: StaggeredRow;
  readonly ce: number;
  readonly shareOfSubagentCe: number;
  readonly startupCeShare: number;
  /** Share of the type's ce by model family. */
  readonly modelMix: Readonly<Record<ModelFamily, number>>;
}

export interface WorkflowRow {
  readonly workflow: string;
  readonly runs: number;
  readonly spawns: number;
  readonly mainCe: number;
  readonly subagentCe: number;
  readonly totalCe: number;
  readonly subagentShare: number;
}

export interface RunRow {
  readonly session: string;
  readonly workflow: string;
  readonly spawns: number;
  readonly mainTurns: number;
  readonly mainCe: number;
  readonly subagentCe: number;
  readonly totalCe: number;
  readonly subagentTypes: ReadonlyArray<{ readonly agentType: string; readonly spawns: number; readonly ce: number }>;
}

export interface SpawnBinRow {
  readonly bin: string;
  readonly spawns: number;
  readonly turns: number;
  readonly ce: number;
  readonly shareOfSubagentCe: number;
  readonly startupCeShare: number;
}

export interface TtlRow {
  readonly requestsWithWrites: number;
  readonly tokens5m: number;
  readonly tokens1h: number;
  readonly tokensUnknown: number;
  readonly share5m: number;
  readonly share1h: number;
  readonly shareUnknown: number;
}

export interface GapBinRow {
  readonly gap: string;
  readonly events: number;
  readonly cacheWriteTokens: number;
}

export const MISS_CAUSES = ['ttl', 'within-ttl', 'within-ttl-resume', 'unknown'] as const;
export type MissCause = (typeof MISS_CAUSES)[number];

export interface CauseRow {
  readonly cause: MissCause;
  readonly events: number;
  readonly cacheWriteTokens: number;
  /** Cost-equivalent of writing those tokens again (their write weight, 1.25 or 2 each). */
  readonly ce: number;
  /** `ce` over the stream's total ce. */
  readonly shareOfStreamCe: number;
}

export interface MissSummary {
  readonly events: number;
  readonly cacheWriteTokens: number;
  readonly shareOfCacheWrites: number;
  readonly byGap: readonly GapBinRow[];
  /** Every cause in the order of `MISS_CAUSES`, zeros included (D-AUDIT-MISS-CAUSE). */
  readonly byCause: readonly CauseRow[];
}

export interface MissEvent {
  readonly stream: 'main' | 'subagent';
  readonly session: string;
  readonly agentType: string;
  readonly cacheWriteTokens: number;
  readonly ttl: '5m' | '1h' | 'unknown';
  readonly gap: string;
  readonly gapSeconds: number | null;
}

export interface SkillRow {
  readonly skill: string;
  readonly loads: number;
  readonly sessions: number;
}

export interface ReadRow {
  readonly agentType: string;
  readonly spawns: number;
  readonly readCalls: number;
  readonly rereads: number;
  readonly rereadShare: number;
  readonly exactRereads: number;
  readonly ranged: number;
  readonly rangedShare: number;
  /** Read calls on the ledger `index.md` / on `decisions.md` or `pitfalls.md`. */
  readonly indexReads: number;
  readonly bodyReads: number;
}

export interface DecisionRow {
  readonly shape: DecisionsShape;
  readonly spawns: number;
  readonly totalBytes: number;
  readonly medianBytes: number;
  readonly p90Bytes: number;
  readonly medianIndexLines: number;
  /** Spawns whose assistant text cited at least one ADR or PF id. */
  readonly citingSpawns: number;
  /** Per spawn: distinct ids cited. */
  readonly medianDistinctCitations: number;
  readonly totalDistinctCitations: number;
  /** Spawns that opened the ledger index / the decisions or pitfalls bodies themselves. */
  readonly indexSelfReadSpawns: number;
  readonly indexSelfReadShare: number;
  readonly bodySelfReadSpawns: number;
  readonly bodySelfReadShare: number;
}

export interface BashRow {
  readonly class: BashClass;
  readonly calls: number;
  readonly resultBytes: number;
  readonly shareOfBytes: number;
  readonly bytesPerCall: number;
  /** test/build only: runs whose command carried a quiet flag. Null for every other class. */
  readonly quietCalls: number | null;
}

export interface FilesWrittenBin {
  readonly files: string;
  readonly spawns: number;
  readonly totalFiles: number;
  readonly totalTurns: number;
  readonly medianTurns: number;
  readonly p90Turns: number;
  readonly turnsPerFile: number;
}

/** Code spawns that ran `OPERATION: implement`, by how many distinct files they wrote. */
export interface FilesWrittenReport {
  readonly spawns: number;
  readonly medianFiles: number;
  readonly p90Files: number;
  readonly maxFiles: number;
  readonly medianTurns: number;
  readonly p90Turns: number;
  readonly byFiles: readonly FilesWrittenBin[];
}

export interface DistStat {
  readonly median: number;
  readonly p90: number;
}

export interface TypeDistRow {
  readonly agentType: string;
  readonly totalSpawns: number;
  /** Runs of the workflow that spawned the type at least once. */
  readonly runsWithType: number;
  /** Per run, over every run of the workflow (a run with none counts 0). */
  readonly spawns: DistStat;
  readonly ce: DistStat;
}

export interface OperationDistRow {
  readonly operation: string;
  readonly totalSpawns: number;
  readonly runsWithOperation: number;
  readonly spawns: DistStat;
}

export interface PlanDistRow {
  /** True for a run started with a plan document (`/implement path.md`). */
  readonly planDocument: boolean;
  readonly runs: number;
  readonly spawns: DistStat;
  readonly ce: DistStat;
}

export interface WorkflowDistributionRow {
  readonly workflow: string;
  readonly runs: number;
  /** Subagent spawns per run. */
  readonly spawns: DistStat;
  /** Main plus subagent ce per run. */
  readonly ce: DistStat;
  readonly byType: readonly TypeDistRow[];
  /** Code-fix spawns per run, by the OPERATION of the spawn prompt. */
  readonly codeFixByOperation: readonly OperationDistRow[];
  /** `/implement` only: runs with and without a plan document. */
  readonly byPlan: readonly PlanDistRow[];
}

export interface AuditReport {
  readonly scope: ReportScope & { readonly requests: number; readonly sessions: number };
  readonly totals: {
    readonly main: TotalsRow;
    readonly subagent: TotalsRow;
    readonly combined: TotalsRow;
    readonly subagentShareOfCe: number;
  };
  readonly models: {
    readonly families: readonly FamilyRow[];
    readonly pricedTotal: number;
    readonly unpriced: {
      readonly requests: number;
      readonly ce: number;
      readonly models: readonly UnpricedModel[];
      readonly modelsOmitted: number;
    };
  };
  readonly agentTypes: readonly AgentTypeRow[];
  readonly workflows: {
    readonly byLabel: readonly WorkflowRow[];
    readonly runs: readonly RunRow[];
    readonly distribution: readonly WorkflowDistributionRow[];
  };
  /** Reads per agent type (subagents with parser counts only). */
  readonly reads: readonly ReadRow[];
  /** DECISIONS_CONTEXT shapes, always the four of `DECISIONS_SHAPES` in order. */
  readonly decisions: readonly DecisionRow[];
  /** Bash results, always the five of `BASH_CLASSES` in order. */
  readonly bash: readonly BashRow[];
  readonly filesWritten: FilesWrittenReport;
  readonly spawnBins: readonly SpawnBinRow[];
  readonly ttl: { readonly main: TtlRow; readonly subagent: TtlRow };
  readonly cacheMisses: {
    readonly main: MissSummary;
    readonly subagent: MissSummary;
    readonly top: readonly MissEvent[];
  };
  readonly skillLoads: {
    readonly totalLoads: number;
    readonly distinct: number;
    readonly rows: readonly SkillRow[];
  };
  readonly weights: typeof WEIGHTS;
  readonly caps: readonly CapNotice[];
  readonly skipped: SkipCounts & {
    /** Subagents whose transcript holds no request at all. */
    readonly emptySubagents: number;
    readonly undatedExcluded: number;
    readonly syntheticDropped: number;
    readonly chunksCollapsed: number;
  };
  /** What the date window removed; not a skip, the transcripts were read and had data. */
  readonly filtered: {
    /** Subagents with requests, every one of them outside the window. */
    readonly subagentsOutsideWindow: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FAMILIES: readonly ModelFamily[] = [...PRICED_FAMILIES, 'other'];
const SPAWN_BINS: ReadonlyArray<{ readonly label: string; readonly min: number; readonly max: number }> = [
  { label: '1-4', min: 1, max: 4 },
  { label: '5-19', min: 5, max: 19 },
  { label: '20-49', min: 20, max: 49 },
  { label: '50-99', min: 50, max: 99 },
  { label: '100+', min: 100, max: Number.POSITIVE_INFINITY },
];
const GAP_BINS: ReadonlyArray<{ readonly label: string; readonly belowMs: number }> = [
  { label: '<1m', belowMs: 60_000 },
  { label: '1-5m', belowMs: 300_000 },
  { label: '5-15m', belowMs: 900_000 },
  { label: '15-60m', belowMs: 3_600_000 },
  { label: '>60m', belowMs: Number.POSITIVE_INFINITY },
];
const UNKNOWN_GAP = 'unknown';
const TOP_MISS_EVENTS = 10;
const MARKDOWN_TOP_RUNS = 10;
const MARKDOWN_TOP_WORKFLOWS = 8;
const MARKDOWN_TOP_TYPES = 12;
const MARKDOWN_TOP_SKILLS = 25;
const SESSION_LABEL_CHARS = 8;

export function gapBin(gapMs: number | null): string {
  if (gapMs === null) return UNKNOWN_GAP;
  for (const bin of GAP_BINS) {
    if (gapMs < bin.belowMs) return bin.label;
  }
  return GAP_BINS[GAP_BINS.length - 1]?.label ?? UNKNOWN_GAP;
}

export function inWindow(timestampMs: number | null, window: TimeWindow): boolean {
  if (window.sinceMs === null && window.untilMs === null) return true;
  if (timestampMs === null) return false;
  if (window.sinceMs !== null && timestampMs < window.sinceMs) return false;
  if (window.untilMs !== null && timestampMs >= window.untilMs) return false;
  return true;
}

function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

/** Decimal places kept on every share and ratio in the output. */
const SHARE_DECIMALS = 6;
const SHARE_SCALE = 10 ** SHARE_DECIMALS;

/**
 * `part / whole`, rounded to `SHARE_DECIMALS` for output. It is only called where a value
 * enters a report row, on accumulators that are still unrounded, so the float noise of summing
 * in different orders (0.9999999999999981) never reaches the JSON and no rounding feeds back
 * into the aggregation.
 */
function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * SHARE_SCALE) / SHARE_SCALE : 0;
}

function round6(value: number): number {
  return Math.round(value * SHARE_SCALE) / SHARE_SCALE;
}

interface TotalsAcc {
  requests: number;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheWriteUnknown: number;
  cacheRead: number;
  output: number;
  ce: number;
}

function newTotals(): TotalsAcc {
  return { requests: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnknown: 0, cacheRead: 0, output: 0, ce: 0 };
}

function addTo(acc: TotalsAcc, t: TokenCounts): void {
  acc.requests += 1;
  acc.input += t.input;
  acc.cacheWrite5m += t.cacheWrite5m;
  acc.cacheWrite1h += t.cacheWrite1h;
  acc.cacheWriteUnknown += t.cacheWriteUnknown;
  acc.cacheRead += t.cacheRead;
  acc.output += t.output;
  acc.ce += costEquivalent(t);
}

function freezeTotals(acc: TotalsAcc): TotalsRow {
  return { ...acc, ce: Math.round(acc.ce) };
}

function sumTotals(a: TotalsAcc, b: TotalsAcc): TotalsAcc {
  return {
    requests: a.requests + b.requests,
    input: a.input + b.input,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheWriteUnknown: a.cacheWriteUnknown + b.cacheWriteUnknown,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    ce: a.ce + b.ce,
  };
}

interface TtlAcc {
  requestsWithWrites: number;
  tokens5m: number;
  tokens1h: number;
  tokensUnknown: number;
}

function freezeTtl(acc: TtlAcc): TtlRow {
  const total = acc.tokens5m + acc.tokens1h + acc.tokensUnknown;
  return {
    ...acc,
    share5m: share(acc.tokens5m, total),
    share1h: share(acc.tokens1h, total),
    shareUnknown: share(acc.tokensUnknown, total),
  };
}

interface MissAcc {
  events: number;
  tokens: number;
  writeTokens: number;
  byGap: Map<string, { events: number; tokens: number }>;
  byCause: Map<MissCause, { events: number; tokens: number; ce: number }>;
}

function newMiss(): MissAcc {
  return { events: 0, tokens: 0, writeTokens: 0, byGap: new Map(), byCause: new Map() };
}

/** `streamCe` is the stream's total cost-equivalent: the base of each cause's share. */
function freezeMiss(acc: MissAcc, streamCe: number): MissSummary {
  const labels = [...GAP_BINS.map(b => b.label), UNKNOWN_GAP];
  return {
    events: acc.events,
    cacheWriteTokens: acc.tokens,
    shareOfCacheWrites: share(acc.tokens, acc.writeTokens),
    byGap: labels.map(gap => ({
      gap,
      events: acc.byGap.get(gap)?.events ?? 0,
      cacheWriteTokens: acc.byGap.get(gap)?.tokens ?? 0,
    })),
    byCause: MISS_CAUSES.map(cause => {
      const slot = acc.byCause.get(cause) ?? { events: 0, tokens: 0, ce: 0 };
      return { cause, events: slot.events, cacheWriteTokens: slot.tokens, ce: Math.round(slot.ce), shareOfStreamCe: share(slot.ce, streamCe) };
    }),
  };
}

function dominantTtl(t: TokenCounts): MissEvent['ttl'] {
  if (t.cacheWrite1h >= t.cacheWrite5m && t.cacheWrite1h >= t.cacheWriteUnknown) return '1h';
  return t.cacheWrite5m >= t.cacheWriteUnknown ? '5m' : 'unknown';
}

const TTL_MS: Readonly<Record<'5m' | '1h', number>> = { '5m': 300_000, '1h': 3_600_000 };

/**
 * D-AUDIT-MISS-CAUSE: why a cache miss happened, from facts the transcript holds. A miss is a
 * non-first request with `cache_read == 0` and `cache_creation > 0`; its TTL is the request's
 * `dominantTtl` (the larger of the 1h and 5m write, 5m on a tie with unknown) and its idle gap is
 * the time before it:
 *   ttl                the gap reached the TTL, so the entry had expired;
 *   within-ttl-resume  the gap is inside the TTL and the agent had ended its turn and was resumed
 *                      by a coordinator message (`resumed`): the prefix was probably changed;
 *   within-ttl         the gap is inside the TTL and the agent was in its own tool loop: the
 *                      miss has no cause the transcript shows (a prefix change, an evicted entry);
 *   unknown            the gap or the TTL is not known, so the two cannot be compared.
 * A gap equal to the TTL has expired. `ce` of a cause is what rewriting the tokens cost (their write
 * weight), an upper bound of the waste: a read would still have cost 0.1 per token.
 */
export function missCause(request: AuditRequest): MissCause {
  const ttl = dominantTtl(request.usage);
  if (request.gapMs === null || ttl === 'unknown') return 'unknown';
  if (request.gapMs >= TTL_MS[ttl]) return 'ttl';
  return request.resumed === true ? 'within-ttl-resume' : 'within-ttl';
}

/** Cost-equivalent of the cache-write tokens of a request, at their write weights. */
function writeCe(t: TokenCounts): number {
  return t.cacheWrite5m * WEIGHTS.cacheWrite5m + t.cacheWrite1h * WEIGHTS.cacheWrite1h + t.cacheWriteUnknown * WEIGHTS.cacheWriteUnknown;
}

function familyCeRecord(): Record<ModelFamily, number> {
  return { opus: 0, sonnet: 0, haiku: 0, other: 0 };
}

interface RunAcc {
  readonly session: string;
  readonly workflow: string;
  /** True for an `/implement` run started with a plan document (D-AUDIT-RUN-DIST). */
  readonly planDocument: boolean;
  /** Code-fix spawns of the run by the OPERATION of their prompt. */
  readonly codeFix: Map<string, number>;
  spawns: number;
  mainTurns: number;
  mainCe: number;
  subCe: number;
  readonly types: Map<string, { spawns: number; ce: number }>;
}

interface TypeAcc {
  spawns: number;
  turns: number[];
  startups: number[];
  ce: number;
  startupCe: number;
  familyCe: Record<ModelFamily, number>;
}

interface BinAcc {
  spawns: number;
  turns: number;
  ce: number;
  startupCe: number;
}

/** Cost-equivalent a spawn pays to carry its startup context: the first request's input side, then a cache read per later turn. */
function startupCost(first: TokenCounts, turns: number): number {
  return inputSideCe(first) + contextSize(first) * WEIGHTS.cacheRead * Math.max(0, turns - 1);
}

// ── Spawn records and the wave-4C tables ─────────────────────────────────────

/**
 * D-AUDIT-PEAK-CTX: a spawn's peak context is the largest context (input + cache write + cache read)
 * any of its windowed requests carried: how full the model's window got, which startup context (the
 * first request's) does not show. A type reports the median, p90 and max of its spawns' peaks beside
 * the p90 of their turn counts. Medians and p90 use the report's nearest-rank rule, index
 * `round(p * (n - 1))` of the sorted values, so a p90 over fewer than 10 spawns is the maximum.
 *
 * One subagent spawn as the wave-4C tables see it: the windowed requests reduced to what they need.
 */
interface SpawnRecord {
  readonly session: string;
  readonly agentType: string;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly turns: number;
  /** The largest context any request of the spawn carried (D-AUDIT-PEAK-CTX). */
  readonly peakContext: number;
  /** The spawn's first request; null when the window cut it off, so the spawn has no first turn to judge. */
  readonly firstTurn: { readonly cacheRead: number; readonly context: number } | null;
  readonly sibling: boolean;
  readonly signals: ParsedSignals | null;
}

function spawnRecord(session: string, agent: SubagentData, requests: readonly AuditRequest[]): SpawnRecord {
  let startMs: number | null = null;
  let endMs: number | null = null;
  let peakContext = 0;
  for (const request of requests) {
    const at = request.timestampMs;
    if (at !== null) {
      startMs = startMs === null ? at : Math.min(startMs, at);
      endMs = endMs === null ? at : Math.max(endMs, at);
    }
    peakContext = Math.max(peakContext, contextSize(request.usage));
  }
  const first = requests[0];
  return {
    session,
    agentType: agent.agentType,
    startMs,
    endMs,
    turns: requests.length,
    peakContext,
    firstTurn: first?.isFirst === true ? { cacheRead: first.usage.cacheRead, context: contextSize(first.usage) } : null,
    sibling: agent.sibling === true,
    signals: agent.signals ?? null,
  };
}

/** A staggered first turn must beat the static-prefix estimate by more than this to count as reading past it. */
const STATIC_PREFIX_SLACK_TOKENS = 1_000;
/** A spawn is staggered when it starts less than this after another spawn of its type last ran. */
const STAGGER_WINDOW_MS = 300_000;

/**
 * D-AUDIT-FIRST-TURN: the first request of a spawn carries the agent's static prefix (system prompt,
 * tools, preloaded skills and rules, the same for every spawn of the type) plus its own task prompt. If
 * an earlier spawn of the type wrote that prefix inside the cache TTL, the first request reads it.
 *   hit share         spawns whose first request read cache, over spawns whose first request is in
 *                     the window (a later turn never counts);
 *   read ratio        first-turn cache read over first-turn context, median over those spawns;
 *   static prefix     the smallest positive first-turn cache read of the type (a warm first turn reads
 *                     at least the shared prefix), 0 when none read;
 *   sibling           launched in the same parent message as another spawn (`SubagentData.sibling`):
 *                     it starts at the same moment, so it cannot read the other's write;
 *   staggered         not a sibling, and some spawn of the same type in the same session started no
 *                     later and last ran less than 5 minutes before this one starts (running at the
 *                     same time counts): its prefix should be warm. A staggered miss is the one that
 *                     says the prefix varies between spawns; `aboveStaticPrefix` counts staggered
 *                     first turns that read more than the prefix plus 1,000 tokens.
 */
function staggeredSpawns(records: readonly SpawnRecord[]): ReadonlySet<SpawnRecord> {
  const lanes = new Map<string, SpawnRecord[]>();
  for (const record of records) {
    if (record.startMs === null || record.endMs === null) continue;
    const key = `${record.session}\0${record.agentType}`;
    const lane = lanes.get(key) ?? [];
    lane.push(record);
    lanes.set(key, lane);
  }
  const staggered = new Set<SpawnRecord>();
  for (const lane of lanes.values()) {
    lane.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    let latestEnd: number | null = null;
    for (const record of lane) {
      if (!record.sibling && latestEnd !== null && (record.startMs ?? 0) - latestEnd < STAGGER_WINDOW_MS) staggered.add(record);
      latestEnd = latestEnd === null ? record.endMs : Math.max(latestEnd, record.endMs ?? latestEnd);
    }
  }
  return staggered;
}

interface FirstTurnStats {
  readonly firstTurnSpawns: number;
  readonly firstTurnCacheHitShare: number;
  readonly medianFirstTurnReadRatio: number;
  readonly medianFirstTurnCacheRead: number;
  readonly staticPrefixEstimate: number;
  readonly siblingSpawns: number;
  readonly staggered: StaggeredRow;
}

function firstTurnStats(group: readonly SpawnRecord[], staggered: ReadonlySet<SpawnRecord>): FirstTurnStats {
  const firsts = group.flatMap(record => (record.firstTurn === null ? [] : [{ record, ...record.firstTurn }]));
  const positive = firsts.filter(f => f.cacheRead > 0).map(f => f.cacheRead);
  const staticPrefix = positive.reduce((least, read) => Math.min(least, read), positive[0] ?? 0);
  const late = firsts.filter(f => staggered.has(f.record));
  const lateHits = late.filter(f => f.cacheRead > 0).length;
  return {
    firstTurnSpawns: firsts.length,
    firstTurnCacheHitShare: share(positive.length, firsts.length),
    medianFirstTurnReadRatio: round6(quantile(firsts.map(f => (f.context > 0 ? f.cacheRead / f.context : 0)), 0.5)),
    medianFirstTurnCacheRead: quantile(firsts.map(f => f.cacheRead), 0.5),
    staticPrefixEstimate: staticPrefix,
    siblingSpawns: group.filter(record => record.sibling).length,
    staggered: {
      spawns: late.length,
      hits: lateHits,
      hitShare: share(lateHits, late.length),
      medianCacheRead: quantile(late.map(f => f.cacheRead), 0.5),
      aboveStaticPrefix: late.filter(f => f.cacheRead > staticPrefix + STATIC_PREFIX_SLACK_TOKENS).length,
    },
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function withSignals(records: readonly SpawnRecord[]): ReadonlyArray<{ readonly record: SpawnRecord; readonly signals: ParsedSignals }> {
  return records.flatMap(record => (record.signals === null ? [] : [{ record, signals: record.signals }]));
}

/** D-AUDIT-READS: re-read, ranged and ledger-read counts per agent type, from the parser's per-spawn counts. */
function readRows(records: readonly SpawnRecord[]): ReadRow[] {
  const groups = new Map<string, ParsedSignals[]>();
  for (const { record, signals } of withSignals(records)) {
    const list = groups.get(record.agentType) ?? [];
    list.push(signals);
    groups.set(record.agentType, list);
  }
  return [...groups.entries()]
    .map(([agentType, list]) => {
      const calls = sum(list.map(x => x.reads.calls));
      const rereads = sum(list.map(x => x.reads.rereads));
      const ranged = sum(list.map(x => x.reads.ranged));
      return {
        agentType,
        spawns: list.length,
        readCalls: calls,
        rereads,
        rereadShare: share(rereads, calls),
        exactRereads: sum(list.map(x => x.reads.exactRereads)),
        ranged,
        rangedShare: share(ranged, calls),
        indexReads: sum(list.map(x => x.ledgerReads.index)),
        bodyReads: sum(list.map(x => x.ledgerReads.bodies)),
      };
    })
    .sort((a, b) => b.readCalls - a.readCalls || (a.agentType < b.agentType ? -1 : 1));
}

/** D-AUDIT-DECISIONS-SIGNAL: one row per shape (all four, zeros included), over spawns with parser counts. */
function decisionRows(records: readonly SpawnRecord[]): DecisionRow[] {
  const all = withSignals(records);
  return DECISIONS_SHAPES.map(shape => {
    const list = all.filter(x => x.signals.decisionsContext.shape === shape).map(x => x.signals);
    const bytes = list.map(x => x.decisionsContext.bytes);
    const distinct = list.map(x => x.citations.distinct);
    const index = list.filter(x => x.ledgerReads.index > 0).length;
    const bodies = list.filter(x => x.ledgerReads.bodies > 0).length;
    return {
      shape,
      spawns: list.length,
      totalBytes: sum(bytes),
      medianBytes: quantile(bytes, 0.5),
      p90Bytes: quantile(bytes, 0.9),
      medianIndexLines: quantile(list.map(x => x.decisionsContext.indexLines), 0.5),
      citingSpawns: distinct.filter(n => n > 0).length,
      medianDistinctCitations: quantile(distinct, 0.5),
      totalDistinctCitations: sum(distinct),
      indexSelfReadSpawns: index,
      indexSelfReadShare: share(index, list.length),
      bodySelfReadSpawns: bodies,
      bodySelfReadShare: share(bodies, list.length),
    };
  });
}

/** D-AUDIT-BASH-CLASS: one row per class (all five, zeros included), summed over spawns with parser counts. */
function bashRows(records: readonly SpawnRecord[]): BashRow[] {
  const all = withSignals(records).map(x => x.signals);
  const totalBytes = sum(all.flatMap(x => BASH_CLASSES.map(c => x.bashResultBytes[c])));
  return BASH_CLASSES.map(cls => {
    const calls = sum(all.map(x => x.bashCalls[cls]));
    const bytes = sum(all.map(x => x.bashResultBytes[cls]));
    return {
      class: cls,
      calls,
      resultBytes: bytes,
      shareOfBytes: share(bytes, totalBytes),
      bytesPerCall: calls > 0 ? Math.round(bytes / calls) : 0,
      quietCalls: cls === 'test/build' ? sum(all.map(x => x.quietTestRuns)) : null,
    };
  });
}

const FILE_BINS: ReadonlyArray<{ readonly label: string; readonly min: number; readonly max: number }> = [
  { label: '0', min: 0, max: 0 },
  { label: '1-4', min: 1, max: 4 },
  { label: '5-9', min: 5, max: 9 },
  { label: '10-19', min: 10, max: 19 },
  { label: '20-39', min: 20, max: 39 },
  { label: '40+', min: 40, max: Number.POSITIVE_INFINITY },
];
const CODE_AGENT = 'Code';
const IMPLEMENT_OPERATION = 'implement';

/** Code spawns that ran the implement operation, by distinct files written: how many turns a file costs. */
function filesWrittenReport(records: readonly SpawnRecord[]): FilesWrittenReport {
  const implement = withSignals(records).filter(
    x => x.record.agentType === CODE_AGENT && x.signals.operation === IMPLEMENT_OPERATION,
  );
  const files = implement.map(x => x.signals.filesWritten.distinct);
  const turns = implement.map(x => x.record.turns);
  return {
    spawns: implement.length,
    medianFiles: quantile(files, 0.5),
    p90Files: quantile(files, 0.9),
    maxFiles: files.reduce((a, b) => Math.max(a, b), 0),
    medianTurns: quantile(turns, 0.5),
    p90Turns: quantile(turns, 0.9),
    byFiles: FILE_BINS.map(bin => {
      const inBin = implement.filter(x => x.signals.filesWritten.distinct >= bin.min && x.signals.filesWritten.distinct <= bin.max);
      const binTurns = inBin.map(x => x.record.turns);
      const totalFiles = sum(inBin.map(x => x.signals.filesWritten.distinct));
      return {
        files: bin.label,
        spawns: inBin.length,
        totalFiles,
        totalTurns: sum(binTurns),
        medianTurns: quantile(binTurns, 0.5),
        p90Turns: quantile(binTurns, 0.9),
        turnsPerFile: share(sum(binTurns), totalFiles),
      };
    }),
  };
}

const IMPLEMENT_RUN = 'devflow:implement';
const CODE_FIX_AGENT = 'Code-fix';
const UNKNOWN_OPERATION = 'unknown';
const PLAN_DOCUMENT_RE = /^\S+\.md$/i;

/**
 * D-AUDIT-RUN-DIST: the spread of spawns and ce per workflow run. A run is a segment with main turns
 * or spawns; its ce is main plus subagent. Per agent type (and per Code-fix OPERATION) the figures
 * run over every run of the workflow, so a run that never spawned the type counts as 0: the median
 * of a rarely used type is then 0, not the median of the runs that used it. The plan flag is read
 * from the run's start: an `/implement` whose argument is a single path ending in `.md` was given a
 * plan document (the command's own rule) and skips exploration and planning; any other is planned in
 * the run. Only `/implement` rows carry the split.
 */
function distributionRows(runs: readonly RunAcc[]): WorkflowDistributionRow[] {
  const byWorkflow = new Map<string, RunAcc[]>();
  for (const run of runs) {
    const list = byWorkflow.get(run.workflow) ?? [];
    list.push(run);
    byWorkflow.set(run.workflow, list);
  }
  const spawnStat = (values: readonly number[]): DistStat => ({ median: quantile(values, 0.5), p90: quantile(values, 0.9) });
  const ceStat = (values: readonly number[]): DistStat => ({
    median: Math.round(quantile(values, 0.5)),
    p90: Math.round(quantile(values, 0.9)),
  });
  const runCe = (run: RunAcc): number => run.mainCe + run.subCe;

  return [...byWorkflow.entries()]
    .map(([workflow, list]): WorkflowDistributionRow => {
      const types = new Set(list.flatMap(run => [...run.types.keys()]));
      const operations = new Set(list.flatMap(run => [...run.codeFix.keys()]));
      const byType = [...types]
        .map((agentType): TypeDistRow => {
          const spawns = list.map(run => run.types.get(agentType)?.spawns ?? 0);
          return {
            agentType,
            totalSpawns: sum(spawns),
            runsWithType: spawns.filter(n => n > 0).length,
            spawns: spawnStat(spawns),
            ce: ceStat(list.map(run => run.types.get(agentType)?.ce ?? 0)),
          };
        })
        .sort((a, b) => b.totalSpawns - a.totalSpawns || (a.agentType < b.agentType ? -1 : 1));
      const codeFixByOperation = [...operations]
        .map((operation): OperationDistRow => {
          const spawns = list.map(run => run.codeFix.get(operation) ?? 0);
          return { operation, totalSpawns: sum(spawns), runsWithOperation: spawns.filter(n => n > 0).length, spawns: spawnStat(spawns) };
        })
        .sort((a, b) => b.totalSpawns - a.totalSpawns || (a.operation < b.operation ? -1 : 1));
      const byPlan =
        workflow === IMPLEMENT_RUN
          ? [true, false].map((planDocument): PlanDistRow => {
              const part = list.filter(run => run.planDocument === planDocument);
              return { planDocument, runs: part.length, spawns: spawnStat(part.map(run => run.spawns)), ce: ceStat(part.map(runCe)) };
            })
          : [];
      return {
        workflow,
        runs: list.length,
        spawns: spawnStat(list.map(run => run.spawns)),
        ce: ceStat(list.map(runCe)),
        byType,
        codeFixByOperation,
        byPlan,
      };
    })
    .sort((a, b) => b.runs - a.runs || (a.workflow < b.workflow ? -1 : 1));
}

/** Segment starts of `/implement` runs given a plan document, from the commands and Skill calls that opened them. */
function planDocumentStarts(main: NonNullable<SessionData['main']>): ReadonlySet<number> {
  const starts = new Set<number>();
  for (const command of main.commands ?? []) {
    if (command.name === IMPLEMENT_RUN && PLAN_DOCUMENT_RE.test((command.args ?? '').trim())) starts.add(command.order);
  }
  for (const call of main.skillCalls) {
    if (call.name === IMPLEMENT_RUN && PLAN_DOCUMENT_RE.test((call.args ?? '').trim())) starts.add(call.order);
  }
  return starts;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Aggregate parsed sessions into a report. Returns a `no-data` error when no request falls
 * inside the window (so an empty result is never mistaken for a real zero).
 *
 * Cache-miss rule: a request that is not first in its transcript, has `cache_read == 0` and
 * `cache_creation > 0` is a cache miss; it is labelled with the idle gap before it (the time
 * between the previous request finishing and this one starting).
 */
export function buildReport(input: ReportInput): Result<AuditReport, AuditError> {
  const mainTotals = newTotals();
  const subTotals = newTotals();
  const mainTtl: TtlAcc = { requestsWithWrites: 0, tokens5m: 0, tokens1h: 0, tokensUnknown: 0 };
  const subTtl: TtlAcc = { requestsWithWrites: 0, tokens5m: 0, tokens1h: 0, tokensUnknown: 0 };
  const mainMiss = newMiss();
  const subMiss = newMiss();
  const missEvents: MissEvent[] = [];
  const families = new Map<ModelFamily, { requests: number; ceMain: number; ceSub: number }>();
  const unpriced = new Map<string, { requests: number; ce: number }>();
  const runs = new Map<string, RunAcc>();
  const records: SpawnRecord[] = [];
  const types = new Map<string, TypeAcc>();
  const bins = new Map<string, BinAcc>();
  const skills = new Map<string, { loads: number; sessions: Set<string> }>();
  const caps: CapNotice[] = [...input.caps];
  let skillNamesCapped = false;
  let skillLoadTotal = 0;
  let emptySubagents = 0;
  let subagentsOutsideWindow = 0;
  let undatedExcluded = 0;
  let sessionsWithData = 0;

  const countWindow = (ts: number | null): boolean => {
    if (inWindow(ts, input.window)) return true;
    if (ts === null) undatedExcluded += 1;
    return false;
  };

  const recordFamily = (model: string, kind: 'main' | 'subagent', ce: number): ModelFamily => {
    const family = modelFamily(model);
    const row = families.get(family) ?? { requests: 0, ceMain: 0, ceSub: 0 };
    row.requests += 1;
    if (kind === 'main') row.ceMain += ce;
    else row.ceSub += ce;
    families.set(family, row);
    if (family === 'other') {
      const label = model === '' ? '(none)' : model;
      const entry = unpriced.get(label) ?? { requests: 0, ce: 0 };
      entry.requests += 1;
      entry.ce += ce;
      unpriced.set(label, entry);
    }
    return family;
  };

  const recordCache = (
    request: AuditRequest,
    kind: 'main' | 'subagent',
    session: string,
    agentType: string,
    ttl: TtlAcc,
    miss: MissAcc,
  ): void => {
    const writes = cacheWriteTotal(request.usage);
    miss.writeTokens += writes;
    if (writes > 0) {
      ttl.requestsWithWrites += 1;
      ttl.tokens5m += request.usage.cacheWrite5m;
      ttl.tokens1h += request.usage.cacheWrite1h;
      ttl.tokensUnknown += request.usage.cacheWriteUnknown;
    }
    if (!request.isFirst && request.usage.cacheRead === 0 && writes > 0) {
      const gap = gapBin(request.gapMs);
      miss.events += 1;
      miss.tokens += writes;
      const slot = miss.byGap.get(gap) ?? { events: 0, tokens: 0 };
      slot.events += 1;
      slot.tokens += writes;
      miss.byGap.set(gap, slot);
      const cause = missCause(request);
      const causeSlot = miss.byCause.get(cause) ?? { events: 0, tokens: 0, ce: 0 };
      causeSlot.events += 1;
      causeSlot.tokens += writes;
      causeSlot.ce += writeCe(request.usage);
      miss.byCause.set(cause, causeSlot);
      missEvents.push({
        stream: kind,
        session: sanitizeText(session.slice(0, SESSION_LABEL_CHARS)),
        agentType,
        cacheWriteTokens: writes,
        ttl: dominantTtl(request.usage),
        gap,
        gapSeconds: request.gapMs === null ? null : Math.round(request.gapMs / 1000),
      });
    }
  };

  const runFor = (segment: Segment, planStarts: ReadonlySet<number>): RunAcc => {
    const existing = runs.get(segment.id);
    if (existing !== undefined) return existing;
    const created: RunAcc = {
      session: segment.sessionId,
      workflow: segment.label,
      planDocument: segment.label === IMPLEMENT_RUN && planStarts.has(segment.startOrder),
      codeFix: new Map(),
      spawns: 0,
      mainTurns: 0,
      mainCe: 0,
      subCe: 0,
      types: new Map(),
    };
    runs.set(segment.id, created);
    return created;
  };

  for (const session of input.sessions) {
    let sessionHasData = false;
    const planStarts = session.main === null ? new Set<number>() : planDocumentStarts(session.main);

    if (session.main !== null) {
      for (const request of session.main.requests) {
        if (!countWindow(request.timestampMs)) continue;
        sessionHasData = true;
        addTo(mainTotals, request.usage);
        const ce = costEquivalent(request.usage);
        recordFamily(request.model, 'main', ce);
        recordCache(request, 'main', session.sessionId, 'main', mainTtl, mainMiss);
        const run = runFor(segmentAt(session.main.segments, request.order), planStarts);
        run.mainTurns += 1;
        run.mainCe += ce;
      }
      for (const call of session.main.skillCalls) {
        if (!inWindow(call.timestampMs, input.window)) continue;
        skillLoadTotal += 1;
        let entry = skills.get(call.name);
        if (entry === undefined) {
          if (skills.size >= input.limits.maxSkillNames) {
            skillNamesCapped = true;
            continue;
          }
          entry = { loads: 0, sessions: new Set() };
          skills.set(call.name, entry);
        }
        entry.loads += 1;
        entry.sessions.add(session.sessionId);
      }
    }

    for (const agent of session.subagents) {
      const requests = agent.requests.filter(r => countWindow(r.timestampMs));
      const first = requests[0];
      if (first === undefined) {
        if (agent.requests.length === 0) emptySubagents += 1;
        else subagentsOutsideWindow += 1;
        continue;
      }
      sessionHasData = true;
      let agentCe = 0;
      const familyCe = familyCeRecord();
      for (const request of requests) {
        addTo(subTotals, request.usage);
        const ce = costEquivalent(request.usage);
        agentCe += ce;
        familyCe[recordFamily(request.model, 'subagent', ce)] += ce;
        recordCache(request, 'subagent', session.sessionId, agent.agentType, subTtl, subMiss);
      }
      const startup = startupCost(first.usage, requests.length);

      records.push(spawnRecord(session.sessionId, agent, requests));
      const run = runFor(agent.segment, planStarts);
      run.spawns += 1;
      run.subCe += agentCe;
      if (agent.agentType === CODE_FIX_AGENT) {
        const operation = agent.signals?.operation ?? UNKNOWN_OPERATION;
        run.codeFix.set(operation, (run.codeFix.get(operation) ?? 0) + 1);
      }
      const runType = run.types.get(agent.agentType) ?? { spawns: 0, ce: 0 };
      runType.spawns += 1;
      runType.ce += agentCe;
      run.types.set(agent.agentType, runType);

      const typeAcc =
        types.get(agent.agentType) ??
        { spawns: 0, turns: [], startups: [], ce: 0, startupCe: 0, familyCe: familyCeRecord() };
      typeAcc.spawns += 1;
      typeAcc.turns.push(requests.length);
      typeAcc.startups.push(contextSize(first.usage));
      typeAcc.ce += agentCe;
      typeAcc.startupCe += startup;
      for (const family of FAMILIES) typeAcc.familyCe[family] += familyCe[family];
      types.set(agent.agentType, typeAcc);

      const bin = SPAWN_BINS.find(b => requests.length >= b.min && requests.length <= b.max);
      if (bin !== undefined) {
        const binAcc = bins.get(bin.label) ?? { spawns: 0, turns: 0, ce: 0, startupCe: 0 };
        binAcc.spawns += 1;
        binAcc.turns += requests.length;
        binAcc.ce += agentCe;
        binAcc.startupCe += startup;
        bins.set(bin.label, binAcc);
      }
    }

    if (sessionHasData) sessionsWithData += 1;
  }

  const combined = sumTotals(mainTotals, subTotals);
  if (combined.requests === 0) {
    return { ok: false, error: { kind: 'no-data', message: 'no requests found in the selected transcripts and window' } };
  }

  // Model families and price weighting.
  const pricedCe = (family: Exclude<ModelFamily, 'other'>): number => {
    const row = families.get(family);
    return row === undefined ? 0 : (row.ceMain + row.ceSub) * FAMILY_PRICE[family];
  };
  const pricedTotal = PRICED_FAMILIES.reduce((sum, family) => sum + pricedCe(family), 0);
  const familyRows: FamilyRow[] = FAMILIES.map(family => {
    const row = families.get(family) ?? { requests: 0, ceMain: 0, ceSub: 0 };
    const ce = row.ceMain + row.ceSub;
    if (family === 'other') {
      return {
        family,
        requests: row.requests,
        ceMain: Math.round(row.ceMain),
        ceSubagent: Math.round(row.ceSub),
        ce: Math.round(ce),
        price: null,
        priced: null,
        pricedShare: null,
      };
    }
    const priced = pricedCe(family);
    return {
      family,
      requests: row.requests,
      ceMain: Math.round(row.ceMain),
      ceSubagent: Math.round(row.ceSub),
      ce: Math.round(ce),
      price: FAMILY_PRICE[family],
      priced: Math.round(priced),
      pricedShare: share(priced, pricedTotal),
    };
  });
  const unpricedModels = [...unpriced.entries()]
    .map(([model, v]) => ({ model, requests: v.requests, ce: Math.round(v.ce) }))
    .sort((a, b) => b.ce - a.ce || (a.model < b.model ? -1 : 1));
  const otherRow = families.get('other') ?? { requests: 0, ceMain: 0, ceSub: 0 };
  if (unpricedModels.length > input.limits.maxUnpricedModels) {
    caps.push({ kind: 'maxUnpricedModels', limit: input.limits.maxUnpricedModels, where: 'unpriced model list' });
  }
  if (skillNamesCapped) {
    caps.push({ kind: 'maxSkillNames', limit: input.limits.maxSkillNames, where: 'skill-load table' });
  }

  // Agent types and spawn bins.
  const staggered = staggeredSpawns(records);
  const recordsByType = new Map<string, SpawnRecord[]>();
  for (const record of records) {
    const list = recordsByType.get(record.agentType) ?? [];
    list.push(record);
    recordsByType.set(record.agentType, list);
  }
  const typeRows: AgentTypeRow[] = [...types.entries()]
    .map(([agentType, t]) => {
      const group = recordsByType.get(agentType) ?? [];
      const peaks = group.map(record => record.peakContext);
      return {
        agentType,
        spawns: t.spawns,
        turns: t.turns.reduce((a, b) => a + b, 0),
        medianTurns: quantile(t.turns, 0.5),
        p90Turns: quantile(t.turns, 0.9),
        medianPeakContext: quantile(peaks, 0.5),
        p90PeakContext: quantile(peaks, 0.9),
        maxPeakContext: peaks.reduce((a, b) => Math.max(a, b), 0),
        medianStartupContext: quantile(t.startups, 0.5),
        p90StartupContext: quantile(t.startups, 0.9),
        ...firstTurnStats(group, staggered),
        ce: Math.round(t.ce),
        shareOfSubagentCe: share(t.ce, subTotals.ce),
        startupCeShare: share(t.startupCe, t.ce),
        modelMix: {
          opus: share(t.familyCe.opus, t.ce),
          sonnet: share(t.familyCe.sonnet, t.ce),
          haiku: share(t.familyCe.haiku, t.ce),
          other: share(t.familyCe.other, t.ce),
        },
      };
    })
    .sort((a, b) => b.ce - a.ce || (a.agentType < b.agentType ? -1 : 1));
  const binRows: SpawnBinRow[] = SPAWN_BINS.map(bin => {
    const acc = bins.get(bin.label) ?? { spawns: 0, turns: 0, ce: 0, startupCe: 0 };
    return {
      bin: bin.label,
      spawns: acc.spawns,
      turns: acc.turns,
      ce: Math.round(acc.ce),
      shareOfSubagentCe: share(acc.ce, subTotals.ce),
      startupCeShare: share(acc.startupCe, acc.ce),
    };
  });

  // Workflow runs. Rows and labels are both rounded once, from the unrounded accumulators, so
  // a label's figures agree with the totals instead of summing already-rounded parts.
  const liveRuns = [...runs.values()].filter(r => r.mainTurns > 0 || r.spawns > 0);
  const runRows: RunRow[] = liveRuns
    .map(r => ({
      session: sanitizeText(r.session),
      workflow: r.workflow,
      spawns: r.spawns,
      mainTurns: r.mainTurns,
      mainCe: Math.round(r.mainCe),
      subagentCe: Math.round(r.subCe),
      totalCe: Math.round(r.mainCe + r.subCe),
      subagentTypes: [...r.types.entries()]
        .map(([agentType, v]) => ({ agentType, spawns: v.spawns, ce: Math.round(v.ce) }))
        .sort((a, b) => b.ce - a.ce || (a.agentType < b.agentType ? -1 : 1)),
    }))
    .sort((a, b) => b.totalCe - a.totalCe || (a.session < b.session ? -1 : 1));
  const labels = new Map<string, { runs: number; spawns: number; mainCe: number; subCe: number }>();
  for (const r of liveRuns) {
    const acc = labels.get(r.workflow) ?? { runs: 0, spawns: 0, mainCe: 0, subCe: 0 };
    acc.runs += 1;
    acc.spawns += r.spawns;
    acc.mainCe += r.mainCe;
    acc.subCe += r.subCe;
    labels.set(r.workflow, acc);
  }
  const labelRows: WorkflowRow[] = [...labels.entries()]
    .map(([workflow, v]) => ({
      workflow,
      runs: v.runs,
      spawns: v.spawns,
      mainCe: Math.round(v.mainCe),
      subagentCe: Math.round(v.subCe),
      totalCe: Math.round(v.mainCe + v.subCe),
      subagentShare: share(v.subCe, v.mainCe + v.subCe),
    }))
    .sort((a, b) => b.totalCe - a.totalCe || (a.workflow < b.workflow ? -1 : 1));

  const skillRows: SkillRow[] = [...skills.entries()]
    .map(([skill, v]) => ({ skill, loads: v.loads, sessions: v.sessions.size }))
    .sort((a, b) => b.loads - a.loads || (a.skill < b.skill ? -1 : 1));

  const topMisses = [...missEvents]
    .sort((a, b) => b.cacheWriteTokens - a.cacheWriteTokens)
    .slice(0, TOP_MISS_EVENTS);

  return {
    ok: true,
    value: {
      scope: { ...input.scope, requests: combined.requests, sessions: sessionsWithData },
      totals: {
        main: freezeTotals(mainTotals),
        subagent: freezeTotals(subTotals),
        combined: freezeTotals(combined),
        subagentShareOfCe: share(subTotals.ce, combined.ce),
      },
      models: {
        families: familyRows,
        pricedTotal: Math.round(pricedTotal),
        unpriced: {
          requests: otherRow.requests,
          ce: Math.round(otherRow.ceMain + otherRow.ceSub),
          models: unpricedModels.slice(0, input.limits.maxUnpricedModels),
          modelsOmitted: Math.max(0, unpricedModels.length - input.limits.maxUnpricedModels),
        },
      },
      agentTypes: typeRows,
      workflows: { byLabel: labelRows, runs: runRows, distribution: distributionRows(liveRuns) },
      reads: readRows(records),
      decisions: decisionRows(records),
      bash: bashRows(records),
      filesWritten: filesWrittenReport(records),
      spawnBins: binRows,
      ttl: { main: freezeTtl(mainTtl), subagent: freezeTtl(subTtl) },
      cacheMisses: { main: freezeMiss(mainMiss, mainTotals.ce), subagent: freezeMiss(subMiss, subTotals.ce), top: topMisses },
      skillLoads: { totalLoads: skillLoadTotal, distinct: skills.size, rows: skillRows },
      weights: WEIGHTS,
      caps,
      skipped: {
        ...input.skipped,
        emptySubagents,
        undatedExcluded,
        syntheticDropped: input.parseTotals.syntheticDropped,
        chunksCollapsed: input.parseTotals.chunksCollapsed,
      },
      filtered: { subagentsOutsideWindow },
    },
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function int(n: number): string {
  return INTEGER.format(n);
}

function mega(n: number): string {
  return `${(n / 1e6).toFixed(2)}M`;
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const head = `| ${headers.join(' | ')} |`;
  const rule = `| ${headers.map(() => '---').join(' | ')} |`;
  return [head, rule, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
}

function totalsRow(label: string, t: TotalsRow, share: number): string[] {
  return [
    label,
    int(t.requests),
    mega(t.input),
    mega(t.cacheWrite5m),
    mega(t.cacheWrite1h),
    mega(t.cacheWriteUnknown),
    mega(t.cacheRead),
    mega(t.output),
    mega(t.ce),
    pct(share),
  ];
}

function mixText(mix: Readonly<Record<ModelFamily, number>>): string {
  const parts = FAMILIES.filter(f => mix[f] >= 0.005).map(f => `${f} ${Math.round(mix[f] * 100)}%`);
  return parts.length === 0 ? '-' : parts.join(', ');
}

function ttlRow(label: string, t: TtlRow): string[] {
  const total = t.tokens5m + t.tokens1h + t.tokensUnknown;
  return [
    label,
    int(t.requestsWithWrites),
    mega(total),
    `${mega(t.tokens5m)} (${pct(t.share5m)})`,
    `${mega(t.tokens1h)} (${pct(t.share1h)})`,
    `${mega(t.tokensUnknown)} (${pct(t.shareUnknown)})`,
  ];
}

function missRows(label: string, m: MissSummary): string[][] {
  return [
    [label, 'all', int(m.events), mega(m.cacheWriteTokens), pct(m.shareOfCacheWrites)],
    ...m.byGap.filter(g => g.events > 0).map(g => [label, g.gap, int(g.events), mega(g.cacheWriteTokens), '']),
  ];
}

function causeRows(label: string, m: MissSummary): string[][] {
  return m.byCause.map(c => [label, c.cause, int(c.events), mega(c.cacheWriteTokens), mega(c.ce), pct(c.shareOfStreamCe)]);
}

function distText(stat: DistStat, format: (n: number) => string): string {
  return `${format(stat.median)} / ${format(stat.p90)}`;
}

function renderSignalSections(report: AuditReport, out: string[]): void {
  out.push('## Peak context and first turn per agent type', '');
  out.push(
    'Peak context: the largest request context of each spawn. First-turn figures count each spawn\'s first request only. Siblings were launched in one parent message; staggered spawns follow another spawn of the type by under 5 minutes.',
    '',
  );
  out.push(
    table(
      [
        'Agent type',
        'Spawns',
        'p90 turns',
        'Median peak ctx',
        'p90 peak ctx',
        'Max peak ctx',
        'First-turn hit',
        'Median read ratio',
        'Median first-turn read',
        'Static prefix',
        'Siblings',
        'Staggered',
        'Staggered hit',
        'Staggered above prefix',
      ],
      report.agentTypes.map(a => [
        mdCell(a.agentType),
        int(a.spawns),
        int(a.p90Turns),
        int(a.medianPeakContext),
        int(a.p90PeakContext),
        int(a.maxPeakContext),
        `${pct(a.firstTurnCacheHitShare)} of ${int(a.firstTurnSpawns)}`,
        pct(a.medianFirstTurnReadRatio),
        int(a.medianFirstTurnCacheRead),
        int(a.staticPrefixEstimate),
        int(a.siblingSpawns),
        int(a.staggered.spawns),
        `${pct(a.staggered.hitShare)} (median read ${int(a.staggered.medianCacheRead)})`,
        int(a.staggered.aboveStaticPrefix),
      ]),
    ),
  );
  out.push('');

  out.push('## Reads per agent type', '');
  if (report.reads.length === 0) {
    out.push('No spawn carried read counts.', '');
  } else {
    out.push('A re-read is the same path read again in one spawn; ranged reads gave an offset or a limit.', '');
    out.push(
      table(
        ['Agent type', 'Spawns', 'Reads', 'Re-reads', 'Re-read share', 'Exact repeats', 'Ranged', 'Ranged share', 'Index reads', 'Body reads'],
        report.reads.map(r => [
          mdCell(r.agentType),
          int(r.spawns),
          int(r.readCalls),
          int(r.rereads),
          pct(r.rereadShare),
          int(r.exactRereads),
          int(r.ranged),
          pct(r.rangedShare),
          int(r.indexReads),
          int(r.bodyReads),
        ]),
      ),
    );
    out.push('');
  }

  out.push('## Decisions context shape', '');
  out.push('How much of the decisions index each spawn prompt carried, and whether the spawn then cited or opened the ledger itself.', '');
  out.push(
    table(
      [
        'Shape',
        'Spawns',
        'Median bytes',
        'p90 bytes',
        'Total bytes',
        'Median index lines',
        'Citing spawns',
        'Median distinct cites',
        'Index self-read',
        'Body self-read',
      ],
      report.decisions.map(d => [
        d.shape,
        int(d.spawns),
        int(d.medianBytes),
        int(d.p90Bytes),
        int(d.totalBytes),
        int(d.medianIndexLines),
        int(d.citingSpawns),
        int(d.medianDistinctCitations),
        `${int(d.indexSelfReadSpawns)} (${pct(d.indexSelfReadShare)})`,
        `${int(d.bodySelfReadSpawns)} (${pct(d.bodySelfReadShare)})`,
      ]),
    ),
  );
  out.push('');

  out.push('## Bash results by class', '');
  out.push('Subagent Bash calls by their strongest tool; result bytes are what came back into the context.', '');
  out.push(
    table(
      ['Class', 'Calls', 'Result bytes', 'Share of bytes', 'Bytes per call', 'Quiet runs'],
      report.bash.map(b => [
        b.class,
        int(b.calls),
        int(b.resultBytes),
        pct(b.shareOfBytes),
        int(b.bytesPerCall),
        b.quietCalls === null ? '-' : `${int(b.quietCalls)} of ${int(b.calls)}`,
      ]),
    ),
  );
  out.push('');

  const fw = report.filesWritten;
  out.push('## Files written by Code implement spawns', '');
  if (fw.spawns === 0) {
    out.push('No Code spawn ran the implement operation.', '');
  } else {
    out.push(
      `${int(fw.spawns)} spawns: median ${int(fw.medianFiles)}, p90 ${int(fw.p90Files)}, max ${int(fw.maxFiles)} files written; median ${int(fw.medianTurns)}, p90 ${int(fw.p90Turns)} turns.`,
      '',
    );
    out.push(
      table(
        ['Files written', 'Spawns', 'Files', 'Turns', 'Median turns', 'p90 turns', 'Turns per file'],
        fw.byFiles.map(b => [b.files, int(b.spawns), int(b.totalFiles), int(b.totalTurns), int(b.medianTurns), int(b.p90Turns), b.turnsPerFile.toFixed(2)]),
      ),
    );
    out.push('');
  }
}

function renderDistribution(report: AuditReport, out: string[]): void {
  const rows = report.workflows.distribution;
  out.push('## Run distribution per workflow', '');
  out.push('Median / p90 per run. A run that never spawned a type counts 0 for it.', '');
  out.push(
    table(
      ['Workflow', 'Runs', 'Spawns per run', 'ce per run'],
      rows.map(r => [mdCell(r.workflow), int(r.runs), distText(r.spawns, int), distText(r.ce, mega)]),
    ),
  );
  out.push('');
  for (const row of rows.slice(0, MARKDOWN_TOP_WORKFLOWS)) {
    out.push(`### ${mdCell(row.workflow)}`, '');
    out.push(
      table(
        ['Agent type', 'Spawns', 'Runs with it', 'Spawns per run', 'ce per run'],
        row.byType
          .slice(0, MARKDOWN_TOP_TYPES)
          .map(t => [mdCell(t.agentType), int(t.totalSpawns), `${int(t.runsWithType)} of ${int(row.runs)}`, distText(t.spawns, int), distText(t.ce, mega)]),
      ),
    );
    if (row.byType.length > MARKDOWN_TOP_TYPES) out.push('', `${int(row.byType.length - MARKDOWN_TOP_TYPES)} more types in --json.`);
    out.push('');
    if (row.byPlan.length > 0) {
      out.push(
        table(
          ['Started with', 'Runs', 'Spawns per run', 'ce per run'],
          row.byPlan.map(p => [p.planDocument ? 'a plan document' : 'no plan document', int(p.runs), distText(p.spawns, int), distText(p.ce, mega)]),
        ),
        '',
      );
    }
    if (row.codeFixByOperation.length > 0) {
      out.push(
        table(
          ['Code-fix operation', 'Spawns', 'Runs with it', 'Spawns per run'],
          row.codeFixByOperation.map(o => [mdCell(o.operation), int(o.totalSpawns), `${int(o.runsWithOperation)} of ${int(row.runs)}`, distText(o.spawns, int)]),
        ),
        '',
      );
    }
  }
  if (rows.length > MARKDOWN_TOP_WORKFLOWS) out.push(`${int(rows.length - MARKDOWN_TOP_WORKFLOWS)} more workflows in --json.`, '');
}

export function renderMarkdown(report: AuditReport): string {
  const out: string[] = [];
  const s = report.scope;
  const w = report.weights;

  out.push('# Token audit', '');
  out.push(`- Directory: \`${mdCell(s.dir, MAX_PATH_CHARS)}\``);
  out.push(
    `- Sessions with data: ${int(s.sessions)} (${int(s.mainTranscripts)} main transcripts, ${int(s.subagentTranscripts)} subagent transcripts)`,
  );
  out.push(`- Requests (deduplicated): ${int(s.requests)}`);
  const filters = [
    s.session === null ? null : `session ${mdCell(s.session)}`,
    s.exclude.length === 0 ? null : `excluding ${s.exclude.map(mdCell).join(', ')}`,
    s.agentType === null ? null : `agent type ${mdCell(s.agentType)} (subagents only)`,
    s.since === null ? null : `since ${mdCell(s.since)}`,
    s.until === null ? null : `until ${mdCell(s.until)}`,
  ].filter((f): f is string => f !== null);
  out.push(`- Filters: ${filters.length === 0 ? 'none' : filters.join('; ')}`);
  out.push(
    `- Weights (ce): input ${w.input}, cache write ${w.cacheWrite5m} (5m) / ${w.cacheWrite1h} (1h) / ${w.cacheWriteUnknown} (unknown TTL), cache read ${w.cacheRead}, output ${w.output}`,
  );
  out.push('');

  out.push('## Main vs subagent (cost-equivalent)', '');
  const t = report.totals;
  out.push(
    table(
      ['Stream', 'Requests', 'Input', 'Write 5m', 'Write 1h', 'Write unknown', 'Read', 'Output', 'ce', 'Share of ce'],
      [
        totalsRow('main', t.main, 1 - t.subagentShareOfCe),
        totalsRow('subagent', t.subagent, t.subagentShareOfCe),
        totalsRow('total', t.combined, 1),
      ],
    ),
  );
  out.push('');

  out.push('## Price-weighted by model family', '');
  out.push(
    table(
      ['Family', 'Requests', 'ce main', 'ce subagent', 'ce total', 'Price', 'ce x price', 'Share'],
      report.models.families.map(f => [
        f.family === 'other' ? 'other (unpriced)' : f.family,
        int(f.requests),
        mega(f.ceMain),
        mega(f.ceSubagent),
        mega(f.ce),
        f.price === null ? '-' : String(f.price),
        f.priced === null ? '-' : mega(f.priced),
        f.pricedShare === null ? '-' : pct(f.pricedShare),
      ]),
    ),
  );
  out.push('');
  const un = report.models.unpriced;
  if (un.requests > 0) {
    const names = un.models.map(m => `${mdCell(m.model)} x${int(m.requests)}`).join(', ');
    const omitted = un.modelsOmitted > 0 ? `, +${int(un.modelsOmitted)} more` : '';
    out.push(`Unpriced: ${int(un.requests)} requests, ${mega(un.ce)} ce excluded from the priced total (${names}${omitted}).`);
  } else {
    out.push('Unpriced: 0 requests.');
  }
  out.push('');

  out.push('## Per agent type', '');
  out.push(
    table(
      ['Agent type', 'Spawns', 'Turns', 'Median turns', 'Median startup ctx', 'p90 startup ctx', 'ce', 'Share of subagent ce', 'Startup share', 'Model mix'],
      report.agentTypes.map(a => [
        mdCell(a.agentType),
        int(a.spawns),
        int(a.turns),
        int(a.medianTurns),
        int(a.medianStartupContext),
        int(a.p90StartupContext),
        mega(a.ce),
        pct(a.shareOfSubagentCe),
        pct(a.startupCeShare),
        mixText(a.modelMix),
      ]),
    ),
  );
  out.push('');

  renderSignalSections(report, out);

  out.push('## Per workflow run', '');
  out.push(
    table(
      ['Workflow', 'Runs', 'Spawns', 'ce main', 'ce subagent', 'ce total', 'Subagent share'],
      report.workflows.byLabel.map(r => [
        mdCell(r.workflow),
        int(r.runs),
        int(r.spawns),
        mega(r.mainCe),
        mega(r.subagentCe),
        mega(r.totalCe),
        pct(r.subagentShare),
      ]),
    ),
  );
  out.push('');
  const topRuns = report.workflows.runs.slice(0, MARKDOWN_TOP_RUNS);
  out.push(`Top ${topRuns.length} of ${int(report.workflows.runs.length)} runs by ce:`, '');
  out.push(
    table(
      ['Session', 'Workflow', 'Spawns', 'Main turns', 'ce main', 'ce subagent', 'ce total', 'Top subagent types'],
      topRuns.map(r => [
        mdCell(r.session.slice(0, SESSION_LABEL_CHARS)),
        mdCell(r.workflow),
        int(r.spawns),
        int(r.mainTurns),
        mega(r.mainCe),
        mega(r.subagentCe),
        mega(r.totalCe),
        r.subagentTypes
          .slice(0, 3)
          .map(x => `${mdCell(x.agentType)} x${x.spawns}`)
          .join(', ') || '-',
      ]),
    ),
  );
  out.push('');

  renderDistribution(report, out);

  out.push('## Spawn-length bins', '');
  out.push(
    table(
      ['Turns', 'Spawns', 'Total turns', 'ce', 'Share of subagent ce', 'Startup share'],
      report.spawnBins.map(b => [b.bin, int(b.spawns), int(b.turns), mega(b.ce), pct(b.shareOfSubagentCe), pct(b.startupCeShare)]),
    ),
  );
  out.push('');

  out.push('## Cache TTL split (cache-write tokens)', '');
  out.push(
    table(
      ['Stream', 'Requests with writes', 'Written', '5m', '1h', 'Unknown'],
      [ttlRow('main', report.ttl.main), ttlRow('subagent', report.ttl.subagent)],
    ),
  );
  out.push('');

  out.push('## Cache-miss events', '');
  out.push('A non-first request with cache read = 0 and cache write > 0, by idle gap before it.', '');
  out.push(
    table(
      ['Stream', 'Gap', 'Events', 'Tokens rewritten', 'Share of stream writes'],
      [...missRows('main', report.cacheMisses.main), ...missRows('subagent', report.cacheMisses.subagent)],
    ),
  );
  out.push('');
  if (report.cacheMisses.top.length > 0) {
    out.push(`Largest ${report.cacheMisses.top.length}:`, '');
    out.push(
      table(
        ['Stream', 'Session', 'Agent type', 'Tokens rewritten', 'TTL', 'Gap'],
        report.cacheMisses.top.map(e => [
          e.stream,
          mdCell(e.session),
          mdCell(e.agentType),
          int(e.cacheWriteTokens),
          e.ttl,
          e.gapSeconds === null ? e.gap : `${e.gap} (${int(e.gapSeconds)}s)`,
        ]),
      ),
    );
    out.push('');
  }

  out.push('## Cache-miss causes', '');
  out.push(
    'Why each miss happened: ttl (the gap reached the cache TTL), within-ttl (inside it, in the agent\'s own tool loop), within-ttl-resume (inside it, after the agent was resumed by a coordinator message), unknown (no gap or no TTL). ce is the cost of writing the tokens again.',
    '',
  );
  out.push(
    table(
      ['Stream', 'Cause', 'Events', 'Tokens rewritten', 'ce', 'Share of stream ce'],
      [...causeRows('main', report.cacheMisses.main), ...causeRows('subagent', report.cacheMisses.subagent)],
    ),
  );
  out.push('');

  out.push('## Main-session skill loads', '');
  const sk = report.skillLoads;
  out.push(`${int(sk.totalLoads)} loads across ${int(sk.distinct)} distinct skills.`, '');
  if (sk.rows.length > 0) {
    out.push(
      table(
        ['Skill', 'Loads', 'Sessions'],
        sk.rows.slice(0, MARKDOWN_TOP_SKILLS).map(r => [mdCell(r.skill), int(r.loads), int(r.sessions)]),
      ),
    );
    if (sk.rows.length > MARKDOWN_TOP_SKILLS) out.push('', `${int(sk.rows.length - MARKDOWN_TOP_SKILLS)} more in --json.`);
    out.push('');
  }

  out.push('## Caps and skips', '');
  if (report.caps.length === 0) {
    out.push('Caps hit: none.');
  } else {
    out.push('Caps hit:');
    for (const cap of report.caps) out.push(`- ${cap.kind} (limit ${int(cap.limit)}): ${mdCell(cap.where)}`);
  }
  const k = report.skipped;
  out.push(
    '',
    `Skipped: ${int(k.symlinks)} symlinks, ${int(k.badNames)} unexpected file names, ${int(k.unreadableFiles)} unreadable files, ${int(k.badMeta)} bad meta files, ${int(k.malformedLines)} malformed lines, ${int(k.oversizeLines)} oversize lines, ${int(k.emptySubagents)} subagents with no requests, ${int(k.undatedExcluded)} undated requests outside the window.`,
    `Filtered by the window: ${int(report.filtered.subagentsOutsideWindow)} subagents with every request outside it.`,
    `Dropped or merged: ${int(k.syntheticDropped)} synthetic entries, ${int(k.chunksCollapsed)} duplicate chunks.`,
    '',
  );
  return out.join('\n');
}

export function renderJson(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
