/**
 * Aggregation and rendering for the token-audit tool. `buildReport` is pure: parsed
 * sessions in, an `AuditReport` out. `renderMarkdown` and `renderJson` turn it into text.
 */

import type { AuditRequest, SkillCall } from './parse.js';
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
}

export interface SessionData {
  readonly sessionId: string;
  readonly main: {
    readonly requests: readonly AuditRequest[];
    readonly segments: Segments;
    readonly skillCalls: readonly SkillCall[];
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

export interface AgentTypeRow {
  readonly agentType: string;
  readonly spawns: number;
  readonly turns: number;
  readonly medianTurns: number;
  readonly medianStartupContext: number;
  readonly p90StartupContext: number;
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

export interface MissSummary {
  readonly events: number;
  readonly cacheWriteTokens: number;
  readonly shareOfCacheWrites: number;
  readonly byGap: readonly GapBinRow[];
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
  readonly workflows: { readonly byLabel: readonly WorkflowRow[]; readonly runs: readonly RunRow[] };
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
}

function newMiss(): MissAcc {
  return { events: 0, tokens: 0, writeTokens: 0, byGap: new Map() };
}

function freezeMiss(acc: MissAcc): MissSummary {
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
  };
}

function dominantTtl(t: TokenCounts): MissEvent['ttl'] {
  if (t.cacheWrite1h >= t.cacheWrite5m && t.cacheWrite1h >= t.cacheWriteUnknown) return '1h';
  return t.cacheWrite5m >= t.cacheWriteUnknown ? '5m' : 'unknown';
}

function familyCeRecord(): Record<ModelFamily, number> {
  return { opus: 0, sonnet: 0, haiku: 0, other: 0 };
}

interface RunAcc {
  readonly session: string;
  readonly workflow: string;
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

  const runFor = (segment: Segment): RunAcc => {
    const existing = runs.get(segment.id);
    if (existing !== undefined) return existing;
    const created: RunAcc = {
      session: segment.sessionId,
      workflow: segment.label,
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

    if (session.main !== null) {
      for (const request of session.main.requests) {
        if (!countWindow(request.timestampMs)) continue;
        sessionHasData = true;
        addTo(mainTotals, request.usage);
        const ce = costEquivalent(request.usage);
        recordFamily(request.model, 'main', ce);
        recordCache(request, 'main', session.sessionId, 'main', mainTtl, mainMiss);
        const run = runFor(segmentAt(session.main.segments, request.order));
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

      const run = runFor(agent.segment);
      run.spawns += 1;
      run.subCe += agentCe;
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
  const typeRows: AgentTypeRow[] = [...types.entries()]
    .map(([agentType, t]) => ({
      agentType,
      spawns: t.spawns,
      turns: t.turns.reduce((a, b) => a + b, 0),
      medianTurns: quantile(t.turns, 0.5),
      medianStartupContext: quantile(t.startups, 0.5),
      p90StartupContext: quantile(t.startups, 0.9),
      ce: Math.round(t.ce),
      shareOfSubagentCe: share(t.ce, subTotals.ce),
      startupCeShare: share(t.startupCe, t.ce),
      modelMix: {
        opus: share(t.familyCe.opus, t.ce),
        sonnet: share(t.familyCe.sonnet, t.ce),
        haiku: share(t.familyCe.haiku, t.ce),
        other: share(t.familyCe.other, t.ce),
      },
    }))
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
      workflows: { byLabel: labelRows, runs: runRows },
      spawnBins: binRows,
      ttl: { main: freezeTtl(mainTtl), subagent: freezeTtl(subTtl) },
      cacheMisses: { main: freezeMiss(mainMiss), subagent: freezeMiss(subMiss), top: topMisses },
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
