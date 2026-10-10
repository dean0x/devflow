/**
 * Tests for scripts/token-audit (dev tooling, not shipped).
 *
 * Fixtures under tests/fixtures/token-audit/project/ are synthetic transcripts whose entry
 * shapes were sampled from real Claude Code transcripts (user turns are `type: "user"`,
 * assistant requests arrive as several chunks sharing message.id + requestId); every content
 * value is redacted. All expected numbers below are hand-computed from the fixture, so they
 * are independent of the code under test.
 *
 * Fixture map (session 1 = 5a1f...0001, session 2 = 5a1f...0002):
 *   main S1  7 requests  (one duplicate-chunk pair, one <synthetic>, one malformed line)
 *   subagents S1: acode01 Code 3 req | aval01 Validate 2 | anest01 Code 1 (links via parent)
 *                 aorph01 Review 1 | anometa01 (no meta) 1 | workflows/wf_run01 general-purpose 1
 *                 agent-bad.name.jsonl (bad name, never read)
 *   main S2  2 requests (August) | subagent bsub01 Code 1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  SUBAGENT_FILE_RE,
  claudeConfigDir,
  discoverSessions,
  encodeProjectDir,
  parseSubagentMeta,
  projectTranscriptDir,
  readSubagentMeta,
} from '../scripts/token-audit/discover.js';
import type { SubagentFile } from '../scripts/token-audit/discover.js';
import { parseCliArgs, parseWindow, runAudit, runCli } from '../scripts/token-audit/index.js';
import type { AuditOptions } from '../scripts/token-audit/index.js';
import { parseTranscriptFile, parseTranscriptLines } from '../scripts/token-audit/parse.js';
import { gapBin, inWindow, renderMarkdown } from '../scripts/token-audit/report.js';
import type { AuditReport } from '../scripts/token-audit/report.js';
import { buildSegments, linkSubagents, segmentAt } from '../scripts/token-audit/segment.js';
import { costEquivalent, modelFamily, normalizeUsage } from '../scripts/token-audit/tokens.js';
import { DEFAULT_LIMITS, exitCodeFor, mdCell, sanitizeText } from '../scripts/token-audit/types.js';

const FIXTURE_DIR = path.join(import.meta.dirname, 'fixtures', 'token-audit', 'project');
const S1 = '5a1f0000-0000-4000-8000-000000000001';
const S2 = '5a1f0000-0000-4000-8000-000000000002';
const NO_ENV = { env: {}, home: '/nonexistent-home' } as const;

function options(over: Partial<AuditOptions> = {}): AuditOptions {
  return {
    dir: FIXTURE_DIR,
    exclude: [],
    session: null,
    since: null,
    until: null,
    agentType: null,
    json: false,
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

async function audit(over: Partial<AuditOptions> = {}): Promise<AuditReport> {
  const result = await runAudit(options(over));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`audit failed: ${result.error.kind}: ${result.error.message}`);
  return result.value;
}

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'token-audit-test-'));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

let counter = 0;
async function freshDir(): Promise<string> {
  counter += 1;
  const dir = path.join(scratch, `case-${counter}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** One assistant chunk as it appears in a transcript. */
function chunk(opts: {
  id?: string;
  req?: string;
  model?: string;
  usage: Record<string, unknown>;
  ts?: string;
  content?: unknown[];
}): string {
  return JSON.stringify({
    type: 'assistant',
    requestId: opts.req,
    timestamp: opts.ts ?? '2026-09-01T10:00:00.000Z',
    message: { id: opts.id, model: opts.model ?? 'claude-opus-4-5', role: 'assistant', content: opts.content ?? [], usage: opts.usage },
  });
}

const LIMITS = { maxLines: 1000, maxLineChars: 100_000 };

// ── Project encoding ─────────────────────────────────────────────────────────

describe('project directory encoding (D-AUDIT-PROJECT-ENCODING)', () => {
  it('replaces every non-alphanumeric character with a hyphen', () => {
    expect(encodeProjectDir('/Users/dean/Sandbox/devflow')).toBe('-Users-dean-Sandbox-devflow');
  });

  it('maps "." and "_" too, not just "/"', () => {
    expect(encodeProjectDir('/Users/dean/.claude/worktrees/feat_x.y')).toBe('-Users-dean--claude-worktrees-feat-x-y');
  });

  it('puts the transcript directory under $CLAUDE_CONFIG_DIR when absolute, else ~/.claude', () => {
    expect(projectTranscriptDir('/a/b.c', { CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u')).toBe('/cfg/projects/-a-b-c');
    expect(projectTranscriptDir('/a/b.c', {}, '/home/u')).toBe('/home/u/.claude/projects/-a-b-c');
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: 'relative/dir' }, '/home/u')).toBe('/home/u/.claude');
  });

  it('--project resolves a dotted cwd to the directory Claude Code actually wrote', async () => {
    const config = await freshDir();
    const cwd = '/work/proj.v2';
    await cp(FIXTURE_DIR, path.join(config, 'projects', encodeProjectDir(cwd)), { recursive: true });
    const result = await runCli(['--project', cwd, '--json'], { env: { CLAUDE_CONFIG_DIR: config }, home: '/nonexistent-home' }, '/');
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as AuditReport).totals.main.requests).toBe(9);
  });
});

// ── Usage normalization, TTL split, weights ──────────────────────────────────

describe('TTL classification (D-AUDIT-TTL-SPLIT)', () => {
  it('reads the 5m and 1h figures from cache_creation', () => {
    const usage = normalizeUsage({
      input_tokens: 1,
      cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
    });
    expect(usage).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 200, cacheWriteUnknown: 0 });
  });

  it('classifies a 1h-only write as 1h', () => {
    const usage = normalizeUsage({
      cache_creation_input_tokens: 70,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 70 },
    });
    expect(usage).toMatchObject({ cacheWrite5m: 0, cacheWrite1h: 70, cacheWriteUnknown: 0 });
  });

  it('sends the whole write to unknown when cache_creation is absent', () => {
    const usage = normalizeUsage({ input_tokens: 3, cache_creation_input_tokens: 400, cache_read_input_tokens: 100, output_tokens: 5 });
    expect(usage).toEqual({
      input: 3,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheWriteUnknown: 400,
      cacheRead: 100,
      output: 5,
    });
  });

  it('keeps the part of the write the split does not account for as unknown', () => {
    const usage = normalizeUsage({
      cache_creation_input_tokens: 500,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 150 },
    });
    expect(usage).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 150, cacheWriteUnknown: 250 });
  });

  it('treats negative, non-numeric and non-finite counts as zero and rejects a non-object', () => {
    const usage = normalizeUsage({ input_tokens: -5, cache_read_input_tokens: 'lots', output_tokens: Number.NaN });
    expect(usage).toEqual({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnknown: 0, cacheRead: 0, output: 0 });
    expect(normalizeUsage('nope')).toBeNull();
    expect(normalizeUsage(null)).toBeNull();
  });

  it('weights input 1, cache write 1.25 (5m, unknown) or 2.0 (1h), cache read 0.1, output 5', () => {
    const ce = costEquivalent({
      input: 10,
      cacheWrite5m: 100,
      cacheWrite1h: 100,
      cacheWriteUnknown: 100,
      cacheRead: 1000,
      output: 10,
    });
    expect(ce).toBe(10 + 125 + 200 + 125 + 100 + 50);
  });

  it('maps model names to priced families and everything else to other', () => {
    expect(modelFamily('claude-opus-4-5')).toBe('opus');
    expect(modelFamily('Claude-Sonnet-4-5')).toBe('sonnet');
    expect(modelFamily('claude-haiku-4-5')).toBe('haiku');
    expect(modelFamily('claude-fable-5-1')).toBe('other');
  });
});

// ── Dedupe ───────────────────────────────────────────────────────────────────

describe('request dedupe (D-AUDIT-DEDUPE)', () => {
  const a = (extra: Record<string, unknown>): Record<string, unknown> => ({ input_tokens: 0, ...extra });

  it('merges chunks sharing message.id + requestId: last chunk input/cache wins, output is the max', async () => {
    const parsed = await parseTranscriptLines(
      [
        chunk({ id: 'm', req: 'r', usage: a({ input_tokens: 1, cache_creation_input_tokens: 900, output_tokens: 300 }) }),
        chunk({ id: 'm', req: 'r', usage: a({ input_tokens: 2, cache_creation_input_tokens: 1000, output_tokens: 120 }) }),
      ],
      LIMITS,
    );
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0]?.usage).toMatchObject({ input: 2, cacheWriteUnknown: 1000, output: 300 });
    expect(parsed.stats.chunksCollapsed).toBe(1);
  });

  it('takes the larger output even when it arrives in the last chunk', async () => {
    const parsed = await parseTranscriptLines(
      [
        chunk({ id: 'm', req: 'r', usage: a({ output_tokens: 5 }) }),
        chunk({ id: 'm', req: 'r', usage: a({ output_tokens: 90 }) }),
      ],
      LIMITS,
    );
    expect(parsed.requests[0]?.usage.output).toBe(90);
  });

  it('does not merge the same message.id under a different requestId', async () => {
    const parsed = await parseTranscriptLines(
      [chunk({ id: 'm', req: 'r1', usage: a({ input_tokens: 1 }) }), chunk({ id: 'm', req: 'r2', usage: a({ input_tokens: 1 }) })],
      LIMITS,
    );
    expect(parsed.requests).toHaveLength(2);
  });

  it('never merges chunks that carry no message.id', async () => {
    const parsed = await parseTranscriptLines(
      [chunk({ usage: a({ input_tokens: 4 }) }), chunk({ usage: a({ input_tokens: 4 }) })],
      LIMITS,
    );
    expect(parsed.requests).toHaveLength(2);
  });

  it('drops <synthetic> entries and counts them', async () => {
    const parsed = await parseTranscriptLines(
      [
        chunk({ id: 'syn', req: 's', model: '<synthetic>', usage: a({ input_tokens: 7777, output_tokens: 7777 }) }),
        chunk({ id: 'real', req: 'r', usage: a({ input_tokens: 1 }) }),
      ],
      LIMITS,
    );
    expect(parsed.requests.map(r => r.usage.input)).toEqual([1]);
    expect(parsed.stats.syntheticDropped).toBe(1);
  });

  it('applies to the fixture: duplicate chunks collapse and the synthetic entry never reaches the totals', async () => {
    const result = await parseTranscriptFile(path.join(FIXTURE_DIR, `${S1}.jsonl`), DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stream = result.value;
    expect(stream.requests).toHaveLength(7);
    expect(stream.requests[0]?.usage).toEqual({
      input: 2,
      cacheWrite5m: 0,
      cacheWrite1h: 1000,
      cacheWriteUnknown: 0,
      cacheRead: 0,
      output: 300,
    });
    expect(stream.stats).toMatchObject({ syntheticDropped: 1, chunksCollapsed: 2, malformedLines: 1, linesCapHit: false });
  });
});

// ── Transcript entry types: a user turn is "user", never "human" ───────────

describe('user-turn detection', () => {
  it('reads <command-name> tags from entries of type "user" only', async () => {
    const result = await parseTranscriptFile(path.join(FIXTURE_DIR, `${S1}.jsonl`), DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commands.map(c => c.name)).toEqual(['devflow:implement', 'clear']);
  });

  it('ignores a command tag on an entry typed "human" and on a tool result', async () => {
    const tag = { role: 'user', content: '<command-name>/devflow:resolve</command-name>' };
    const parsed = await parseTranscriptLines(
      [
        JSON.stringify({ type: 'human', message: tag }),
        JSON.stringify({ type: 'user', toolUseResult: {}, message: tag }),
        JSON.stringify({ type: 'user', message: tag }),
      ],
      LIMITS,
    );
    expect(parsed.commands).toEqual([{ name: 'devflow:resolve', order: 2 }]);
  });
});

// ── Segmentation and subagent linking ────────────────────────────────────────

describe('segmentation', () => {
  it('opens a run at a workflow command or workflow Skill call and ends it at /clear', () => {
    const segments = buildSegments(
      'S',
      [
        { name: 'devflow:implement', order: 0 },
        { name: 'clear', order: 9 },
        { name: 'devflow:unrelated', order: 12 },
      ],
      [
        { name: 'devflow:plan', order: 7, timestampMs: null },
        { name: 'devflow:typescript', order: 8, timestampMs: null },
      ],
    );
    expect(segments.map(s => s.id)).toEqual(['S:adhoc@-1', 'S:devflow:implement@0', 'S:devflow:plan@7', 'S:adhoc@9']);
    expect(segmentAt(segments, 0).label).toBe('devflow:implement');
    expect(segmentAt(segments, 6).label).toBe('devflow:implement');
    expect(segmentAt(segments, 7).label).toBe('devflow:plan');
    expect(segmentAt(segments, 9).label).toBe('adhoc');
    expect(segmentAt(segments, 500).label).toBe('adhoc');
    expect(segmentAt(segments, -1).label).toBe('adhoc');
  });

  it('links a subagent by toolUseId first, then through parentAgentId, else to unattributed', () => {
    const segments = buildSegments('S', [{ name: 'devflow:implement', order: 0 }], [{ name: 'devflow:plan', order: 7, timestampMs: null }]);
    const links = linkSubagents(
      'S',
      segments,
      [
        { toolUseId: 'tu_code', order: 2, subagentType: 'Code' },
        { toolUseId: 'tu_val', order: 8, subagentType: 'Validate' },
      ],
      [
        { agentId: 'code', toolUseId: 'tu_code', parentAgentId: null },
        { agentId: 'val', toolUseId: 'tu_val', parentAgentId: null },
        { agentId: 'nested', toolUseId: 'tu_elsewhere', parentAgentId: 'code' },
        { agentId: 'orphan', toolUseId: 'tu_missing', parentAgentId: null },
        { agentId: 'bare', toolUseId: null, parentAgentId: 'ghost' },
      ],
    );
    expect(links.get('code')?.label).toBe('devflow:implement');
    expect(links.get('val')?.label).toBe('devflow:plan');
    expect(links.get('nested')?.label).toBe('devflow:implement');
    expect(links.get('orphan')?.label).toBe('unattributed');
    expect(links.get('bare')?.label).toBe('unattributed');
  });

  it('terminates on a parentAgentId cycle', () => {
    const segments = buildSegments('S', [], []);
    const links = linkSubagents('S', segments, [], [
      { agentId: 'a', toolUseId: null, parentAgentId: 'b' },
      { agentId: 'b', toolUseId: null, parentAgentId: 'a' },
    ]);
    expect(links.get('a')?.label).toBe('unattributed');
    expect(links.get('b')?.label).toBe('unattributed');
  });

  it('attributes the fixture to runs: spawns, main turns and cost per run', async () => {
    const report = await audit();
    const run = (workflow: string, session: string): AuditReport['workflows']['runs'][number] | undefined =>
      report.workflows.runs.find(r => r.workflow === workflow && r.session === session);

    expect(run('devflow:implement', S1)).toMatchObject({ spawns: 2, mainTurns: 2, mainCe: 3853, subagentCe: 8180, totalCe: 12033 });
    expect(run('devflow:plan', S1)).toMatchObject({ spawns: 1, mainTurns: 1, mainCe: 171, subagentCe: 1102 });
    expect(run('adhoc', S1)).toMatchObject({ spawns: 0, mainTurns: 4, mainCe: 1797 });
    expect(run('unattributed', S1)).toMatchObject({ spawns: 3, mainTurns: 0, subagentCe: 633 });
    expect(run('adhoc', S2)).toMatchObject({ mainTurns: 2, mainCe: 212 });
    expect(run('unattributed', S2)).toMatchObject({ spawns: 1, subagentCe: 106 });
    expect(report.workflows.runs).toHaveLength(6);
    expect(report.workflows.runs[0]?.workflow).toBe('devflow:implement');
    expect(run('devflow:implement', S1)?.subagentTypes).toEqual([{ agentType: 'Code', spawns: 2, ce: 8180 }]);
  });
});

// ── Full-report numbers over the fixture ─────────────────────────────────────

describe('report over the fixture', () => {
  let report: AuditReport;
  beforeAll(async () => {
    report = await audit();
  });

  it('splits cost-equivalent between main and subagents', () => {
    expect(report.totals.main).toMatchObject({ requests: 9, ce: 6033, cacheWrite5m: 940, cacheWrite1h: 1000, cacheWriteUnknown: 400 });
    expect(report.totals.subagent).toMatchObject({ requests: 10, ce: 10021, cacheWrite5m: 2100, cacheWrite1h: 3250, cacheWriteUnknown: 0 });
    expect(report.totals.combined.ce).toBe(16054);
    expect(report.totals.subagentShareOfCe).toBeCloseTo(10021 / 16054, 6);
    expect(report.scope).toMatchObject({ requests: 19, sessions: 2, mainTranscripts: 2, subagentTranscripts: 7 });
  });

  it('prices opus 5, sonnet 3, haiku 1 and counts an unknown family as unpriced', () => {
    const byFamily = Object.fromEntries(report.models.families.map(f => [f.family, f]));
    expect(byFamily['opus']).toMatchObject({ requests: 11, ce: 12299, price: 5, priced: 61495 });
    expect(byFamily['sonnet']).toMatchObject({ requests: 4, ce: 1964, price: 3, priced: 5892 });
    expect(byFamily['haiku']).toMatchObject({ requests: 3, ce: 1640, price: 1, priced: 1640 });
    expect(report.models.pricedTotal).toBe(69027);
    expect(byFamily['other']).toMatchObject({ requests: 1, ce: 151, price: null, priced: null });
    expect(report.models.unpriced).toMatchObject({ requests: 1, ce: 151, models: [{ model: 'claude-fable-5-1', requests: 1, ce: 151 }] });
    expect(renderMarkdown(report)).toContain('Unpriced: 1 requests, 0.00M ce excluded from the priced total (claude-fable-5-1 x1).');
  });

  it('reports per agent type: spawns, turns, startup context, ce, model mix', () => {
    const code = report.agentTypes.find(a => a.agentType === 'Code');
    expect(code).toMatchObject({ spawns: 3, turns: 5, ce: 8286, medianTurns: 1, medianStartupContext: 301, p90StartupContext: 2002 });
    expect(code?.modelMix.opus).toBeCloseTo((7529 + 106) / 8286, 6);
    expect(code?.modelMix.sonnet).toBeCloseTo(651 / 8286, 6);
    expect(report.agentTypes.map(a => a.agentType)).toEqual(['Code', 'Validate', 'general-purpose', 'Review', 'unknown']);
    expect(report.agentTypes.find(a => a.agentType === 'Validate')?.modelMix.haiku).toBe(1);
    expect(report.agentTypes.find(a => a.agentType === 'unknown')?.spawns).toBe(1);
  });

  it('bins spawns by length', () => {
    expect(report.spawnBins.find(b => b.bin === '1-4')).toMatchObject({ spawns: 7, turns: 10, ce: 10021 });
    expect(report.spawnBins.filter(b => b.bin !== '1-4').every(b => b.spawns === 0)).toBe(true);
  });

  it('reports the TTL split separately for main and subagents', () => {
    expect(report.ttl.main).toMatchObject({ requestsWithWrites: 5, tokens5m: 940, tokens1h: 1000, tokensUnknown: 400 });
    expect(report.ttl.main.share1h).toBeCloseTo(1000 / 2340, 6);
    expect(report.ttl.subagent).toMatchObject({ requestsWithWrites: 8, tokens5m: 2100, tokens1h: 3250, tokensUnknown: 0 });
  });

  it('finds cache misses and labels them with the idle gap before them', () => {
    expect(report.cacheMisses.main).toMatchObject({ events: 1, cacheWriteTokens: 800 });
    expect(report.cacheMisses.main.byGap.find(g => g.gap === '>60m')).toMatchObject({ events: 1, cacheWriteTokens: 800 });
    expect(report.cacheMisses.subagent).toMatchObject({ events: 1, cacheWriteTokens: 2100 });
    expect(report.cacheMisses.subagent.byGap.find(g => g.gap === '15-60m')).toMatchObject({ events: 1 });
    expect(report.cacheMisses.top).toEqual([
      { stream: 'subagent', session: S1.slice(0, 8), agentType: 'Code', cacheWriteTokens: 2100, ttl: '5m', gap: '15-60m', gapSeconds: 1819 },
      { stream: 'main', session: S1.slice(0, 8), agentType: 'main', cacheWriteTokens: 800, ttl: '5m', gap: '>60m', gapSeconds: 8873 },
    ]);
  });

  it('does not call a first request, or a request that read cache, a miss', async () => {
    // The first request of every stream writes cache with cache_read = 0; none of those count.
    const total = report.cacheMisses.main.events + report.cacheMisses.subagent.events;
    expect(total).toBe(2);
    const parsed = await parseTranscriptLines(
      [
        chunk({ id: 'a', req: 'a', usage: { cache_creation_input_tokens: 100 } }),
        chunk({ id: 'b', req: 'b', usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 50 } }),
      ],
      LIMITS,
    );
    expect(parsed.requests.map(r => r.isFirst)).toEqual([true, false]);
  });

  it('counts main-session skill loads by name', () => {
    expect(report.skillLoads.totalLoads).toBe(3);
    expect(report.skillLoads.distinct).toBe(3);
    const names = report.skillLoads.rows.map(r => r.skill).sort();
    expect(names).toEqual(['devflow:plan', 'devflow:typescript', 'x|y z']);
    expect(report.skillLoads.rows.every(r => r.loads === 1 && r.sessions === 1)).toBe(true);
  });

  it('counts what it skipped instead of dropping it silently', () => {
    expect(report.skipped).toMatchObject({
      malformedLines: 1,
      badNames: 1,
      symlinks: 0,
      unreadableFiles: 0,
      badMeta: 0,
      emptySubagents: 0,
      syntheticDropped: 1,
      chunksCollapsed: 3,
    });
    expect(report.caps).toEqual([]);
  });

  it('prints every section header', () => {
    const md = renderMarkdown(report);
    for (const header of [
      '## Main vs subagent (cost-equivalent)',
      '## Price-weighted by model family',
      '## Per agent type',
      '## Per workflow run',
      '## Spawn-length bins',
      '## Cache TTL split (cache-write tokens)',
      '## Cache-miss events',
      '## Main-session skill loads',
      '## Caps and skips',
    ]) {
      expect(md).toContain(header);
    }
    expect(md).toContain('Caps hit: none.');
  });
});

// ── Filters ──────────────────────────────────────────────────────────────────

describe('filters', () => {
  it('--exclude drops a session by exact id and is repeatable', async () => {
    const withoutS1 = await audit({ exclude: [S1] });
    expect(withoutS1.scope).toMatchObject({ sessions: 1, mainTranscripts: 1, subagentTranscripts: 1 });
    expect(withoutS1.totals.main.requests).toBe(2);
    const withoutS2 = await audit({ exclude: [S2] });
    expect(withoutS2.totals.main.requests).toBe(7);
    const none = await runAudit(options({ exclude: [S1, S2] }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.kind).toBe('no-sessions');
  });

  it('--exclude matches the whole id, not a prefix', async () => {
    const report = await audit({ exclude: [S1.slice(0, 12)] });
    expect(report.scope.sessions).toBe(2);
  });

  it('--session restricts to one session and its subagents', async () => {
    const report = await audit({ session: S2 });
    expect(report.totals.main.requests).toBe(2);
    expect(report.totals.subagent.requests).toBe(1);
    expect(report.totals.combined.ce).toBe(212 + 106);
  });

  it('--since keeps requests at or after the date', async () => {
    const report = await audit({ since: '2026-09-01' });
    expect(report.scope.sessions).toBe(1);
    expect(report.totals.main.requests).toBe(7);
    expect(report.totals.subagent.requests).toBe(9);
  });

  it('--until with a date-only value covers that whole day', async () => {
    const report = await audit({ until: '2026-08-01' });
    expect(report.totals.main.requests).toBe(2);
    expect(report.totals.subagent.requests).toBe(1);
  });

  it('--until with a timestamp is exclusive', async () => {
    const report = await audit({ until: '2026-08-01T09:00:10Z' });
    expect(report.totals.main.requests).toBe(1);
    expect(report.totals.subagent.requests).toBe(0);
    expect(report.skipped.emptySubagents).toBe(7);
  });

  it('filters per request, so a window inside a session keeps only the requests inside it', async () => {
    const report = await audit({ since: '2026-09-01T12:00:00Z', until: '2026-09-02' });
    expect(report.totals.main.requests).toBe(4);
    expect(report.totals.subagent.requests).toBe(0);
    expect(report.skipped.emptySubagents).toBe(7);
  });

  it('--agent-type keeps only that subagent type and leaves main alone', async () => {
    const report = await audit({ agentType: 'Validate' });
    expect(report.agentTypes.map(a => a.agentType)).toEqual(['Validate']);
    expect(report.scope.subagentTranscripts).toBe(1);
    expect(report.totals.subagent.ce).toBe(1102);
    expect(report.totals.main.requests).toBe(9);
  });

  it('inWindow never admits an undated request into a bounded window', () => {
    expect(inWindow(null, { sinceMs: 1, untilMs: null })).toBe(false);
    expect(inWindow(null, { sinceMs: null, untilMs: null })).toBe(true);
    expect(inWindow(5, { sinceMs: 5, untilMs: 6 })).toBe(true);
    expect(inWindow(6, { sinceMs: 5, untilMs: 6 })).toBe(false);
  });

  it('parseWindow rejects malformed and inverted bounds', () => {
    expect(parseWindow('yesterday', null).ok).toBe(false);
    expect(parseWindow('2026-09-01T10:00:00', null).ok).toBe(false);
    expect(parseWindow('2026-09-02', '2026-09-01').ok).toBe(false);
    const day = parseWindow('2026-09-01', '2026-09-01');
    expect(day.ok).toBe(true);
    if (day.ok) expect(day.value.untilMs).toBe(Date.parse('2026-09-02'));
  });
});

// ── Cache-miss rule ──────────────────────────────────────────────────────────

describe('cache-miss rule', () => {
  it('counts only a non-first request with cache read = 0 and cache write > 0', async () => {
    const dir = await freshDir();
    const at = (n: number): string => `2026-09-01T10:0${n}:00.000Z`;
    const lines = [
      // first request: writes the prefix, never a miss
      chunk({ id: 'm0', req: 'r0', ts: at(0), usage: { cache_creation_input_tokens: 100 } }),
      // read the cache: no miss
      chunk({ id: 'm1', req: 'r1', ts: at(1), usage: { cache_creation_input_tokens: 10, cache_read_input_tokens: 100 } }),
      // read nothing and wrote nothing (no cache involved): no miss
      chunk({ id: 'm2', req: 'r2', ts: at(2), usage: { input_tokens: 500 } }),
      // read nothing, rewrote the prefix: the one miss
      chunk({ id: 'm3', req: 'r3', ts: at(3), usage: { cache_creation_input_tokens: 70 } }),
    ];
    await writeFile(path.join(dir, 's1.jsonl'), `${lines.join('\n')}\n`);
    const report = await audit({ dir });
    expect(report.cacheMisses.main).toMatchObject({ events: 1, cacheWriteTokens: 70 });
    expect(report.cacheMisses.main.shareOfCacheWrites).toBeCloseTo(70 / 180, 6);
  });
});

// ── Gaps ─────────────────────────────────────────────────────────────────────

describe('idle gap', () => {
  it('measures previous request end to this request start and bins it', () => {
    expect(gapBin(30_000)).toBe('<1m');
    expect(gapBin(60_000)).toBe('1-5m');
    expect(gapBin(299_999)).toBe('1-5m');
    expect(gapBin(300_000)).toBe('5-15m');
    expect(gapBin(3_599_999)).toBe('15-60m');
    expect(gapBin(3_600_000)).toBe('>60m');
    expect(gapBin(null)).toBe('unknown');
  });

  it('is derived from the last user entry before the request, not from when the response finished streaming', async () => {
    const result = await parseTranscriptFile(path.join(FIXTURE_DIR, `${S1}.jsonl`), DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gaps = result.value.requests.map(r => r.gapMs);
    // m2: user tool-result at 10:01:00 after m1 ended at 10:00:06; m4: user prompt at 12:29:58 after m3 ended at 10:02:05.
    expect(gaps[0]).toBeNull();
    expect(gaps[1]).toBe(54_000);
    expect(gaps[3]).toBe(8_873_000);
  });
});

// ── CLI ──────────────────────────────────────────────────────────────────────

describe('CLI', () => {
  it('prints the markdown report for --dir with exit 0', async () => {
    const result = await runCli(['--dir', FIXTURE_DIR], NO_ENV, '/');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.startsWith('# Token audit')).toBe(true);
  });

  it('prints JSON for --json', async () => {
    const result = await runCli(['--dir', FIXTURE_DIR, '--json', '--exclude', S2, '--exclude', 'unused-id'], NO_ENV, '/');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as AuditReport;
    expect(parsed.totals.main.requests).toBe(7);
    expect(parsed.scope.exclude).toEqual([S2, 'unused-id']);
  });

  it('prints usage and exits 0 for --help', async () => {
    const result = await runCli(['--help'], NO_ENV, '/');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--project');
  });

  it.each([
    ['no source', []],
    ['both sources', ['--project', '/a', '--dir', '/b']],
    ['unknown option', ['--dir', '/a', '--bogus']],
    ['stray positional', ['--dir', '/a', 'extra']],
    ['bad --since', ['--dir', '/a', '--since', 'last week']],
    ['inverted window', ['--dir', '/a', '--since', '2026-02-01', '--until', '2026-01-01']],
    ['bad --session', ['--dir', '/a', '--session', '../escape']],
    ['bad --exclude', ['--dir', '/a', '--exclude', 'a/b']],
    ['empty --dir', ['--dir', '']],
  ])('exits 1 on bad arguments: %s', async (_name, argv) => {
    const result = await runCli(argv, NO_ENV, '/');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error:');
  });

  it('exits 2 for an empty directory', async () => {
    const result = await runCli(['--dir', await freshDir()], NO_ENV, '/');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('no sessions');
  });

  it('exits 2 for a missing directory', async () => {
    const result = await runCli(['--dir', path.join(scratch, 'does-not-exist')], NO_ENV, '/');
    expect(result.exitCode).toBe(2);
  });

  it('exits 2 when the window leaves no requests', async () => {
    const result = await runCli(['--dir', FIXTURE_DIR, '--since', '2030-01-01'], NO_ENV, '/');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('no requests');
  });

  it('maps every error kind to an exit code', () => {
    expect(exitCodeFor({ kind: 'usage', message: '' })).toBe(1);
    expect(exitCodeFor({ kind: 'io', message: '' })).toBe(1);
    expect(exitCodeFor({ kind: 'not-found', message: '' })).toBe(2);
    expect(exitCodeFor({ kind: 'no-sessions', message: '' })).toBe(2);
    expect(exitCodeFor({ kind: 'no-data', message: '' })).toBe(2);
  });

  it('resolves --project against the given cwd', () => {
    const parsed = parseCliArgs(['--project', 'sub/dir'], { env: {}, home: '/h' }, '/work');
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.kind === 'run') {
      expect(parsed.value.options.dir).toBe('/h/.claude/projects/-work-sub-dir');
    }
  });
});

// ── Empty and malformed input ────────────────────────────────────────────────

describe('empty and malformed input', () => {
  it('returns a no-sessions error for a directory with no transcripts', async () => {
    const dir = await freshDir();
    await mkdir(path.join(dir, 'memory'));
    await writeFile(path.join(dir, 'notes.txt'), 'x');
    const result = await runAudit(options({ dir }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-sessions');
  });

  it('returns a no-data error for a session whose transcript has no requests', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'empty-session.jsonl'), '\n\n');
    const result = await runAudit(options({ dir }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-data');
  });

  it('skips and counts malformed lines and keeps the good ones', async () => {
    const parsed = await parseTranscriptLines(
      ['{broken', '[1,2]', '42', '', chunk({ id: 'a', req: 'a', usage: { input_tokens: 5 } })],
      LIMITS,
    );
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0]?.usage.input).toBe(5);
    expect(parsed.stats.malformedLines).toBe(3);
  });

  it('ignores unknown fields and entries with no usable usage', async () => {
    const parsed = await parseTranscriptLines(
      [
        chunk({ id: 'a', req: 'a', usage: { input_tokens: 2, surprise: { nested: [1, 2, 3] } } }),
        JSON.stringify({ type: 'assistant', message: { id: 'z', model: 'm', usage: 'oops' } }),
        JSON.stringify({ type: 'attachment', attachment: {} }),
      ],
      LIMITS,
    );
    expect(parsed.requests).toHaveLength(1);
  });

  it('counts a sidecar meta that is not valid JSON and still reads the subagent', async () => {
    const dir = await freshDir();
    const sub = path.join(dir, 's1', 'subagents');
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(dir, 's1.jsonl'), `${chunk({ id: 'a', req: 'a', usage: { input_tokens: 1 } })}\n`);
    await writeFile(path.join(sub, 'agent-x1.jsonl'), `${chunk({ id: 'b', req: 'b', usage: { input_tokens: 2 } })}\n`);
    await writeFile(path.join(sub, 'agent-x1.meta.json'), '{not json');
    const report = await audit({ dir });
    expect(report.skipped.badMeta).toBe(1);
    expect(report.agentTypes.map(a => a.agentType)).toEqual(['unknown']);
  });
});

// ── Caps (D-AUDIT-UNTRUSTED) ─────────────────────────────────────────────────

describe('caps are reported, never silent', () => {
  it('reports the per-file line cap', async () => {
    const parsed = await parseTranscriptLines(
      [1, 2, 3, 4].map(n => chunk({ id: `m${n}`, req: `r${n}`, usage: { input_tokens: n } })),
      { maxLines: 2, maxLineChars: 100_000 },
    );
    expect(parsed.requests).toHaveLength(2);
    expect(parsed.stats.linesCapHit).toBe(true);

    const report = await audit({ limits: { ...DEFAULT_LIMITS, maxLines: 3 } });
    expect(report.caps.some(c => c.kind === 'maxLines' && c.limit === 3)).toBe(true);
    expect(renderMarkdown(report)).toContain('- maxLines (limit 3):');
  });

  it('does not report the line cap when a file has exactly maxLines lines', async () => {
    const parsed = await parseTranscriptLines(
      [1, 2].map(n => chunk({ id: `m${n}`, req: `r${n}`, usage: { input_tokens: n } })),
      { maxLines: 2, maxLineChars: 100_000 },
    );
    expect(parsed.requests).toHaveLength(2);
    expect(parsed.stats.linesCapHit).toBe(false);
  });

  it('skips and reports a line over the character cap', async () => {
    const small = chunk({ id: 'a', req: 'a', usage: { input_tokens: 1 } });
    const parsed = await parseTranscriptLines([small, 'x'.repeat(500), small.replace('"a"', '"b"').replace('"a"', '"b"')], {
      maxLines: 100,
      maxLineChars: 400,
    });
    expect(parsed.stats.oversizeLines).toBe(1);
    expect(parsed.requests).toHaveLength(2);

    const report = await audit({ limits: { ...DEFAULT_LIMITS, maxLineChars: 700 } });
    expect(report.skipped.oversizeLines).toBeGreaterThan(0);
    expect(report.caps.some(c => c.kind === 'maxLineChars')).toBe(true);
  });

  it('reports the directory entry cap during discovery', async () => {
    const found = await discoverSessions({ dir: FIXTURE_DIR, session: null, exclude: new Set(), limits: { maxEntries: 3 } });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.caps).toEqual([{ kind: 'maxEntries', limit: 3, where: FIXTURE_DIR }]);
    const uncapped = await discoverSessions({ dir: FIXTURE_DIR, session: null, exclude: new Set(), limits: { maxEntries: 1000 } });
    expect(uncapped.ok && uncapped.value.caps).toEqual([]);
  });

  it('refuses a file over the byte cap and reports it', async () => {
    // 2000 bytes refuses the session-1 main transcript (8230 B) and agent-acode01 (3583 B) only.
    const report = await audit({ limits: { ...DEFAULT_LIMITS, maxFileBytes: 2000 } });
    expect(report.skipped.unreadableFiles).toBe(2);
    expect(report.caps.filter(c => c.kind === 'maxFileBytes' && c.limit === 2000)).toHaveLength(2);
    expect(report.totals.main.requests).toBe(2);
  });

  it('reports the skill-name cap', async () => {
    const report = await audit({ limits: { ...DEFAULT_LIMITS, maxSkillNames: 2 } });
    expect(report.skillLoads.distinct).toBe(2);
    expect(report.caps.some(c => c.kind === 'maxSkillNames')).toBe(true);
  });

  it('reports the unpriced-model list cap', async () => {
    const dir = await freshDir();
    const lines = ['fable-1', 'fable-2', 'fable-3'].map(m => chunk({ id: m, req: m, model: m, usage: { input_tokens: 1 } }));
    await writeFile(path.join(dir, 's1.jsonl'), `${lines.join('\n')}\n`);
    const report = await audit({ dir, limits: { ...DEFAULT_LIMITS, maxUnpricedModels: 2 } });
    expect(report.models.unpriced.requests).toBe(3);
    expect(report.models.unpriced.models).toHaveLength(2);
    expect(report.models.unpriced.modelsOmitted).toBe(1);
    expect(report.caps.some(c => c.kind === 'maxUnpricedModels')).toBe(true);
  });
});

// ── Untrusted input (D-AUDIT-UNTRUSTED) ──────────────────────────────────────

describe('transcripts are untrusted', () => {
  it('accepts only agent-<id>.jsonl names of bounded length', () => {
    expect(SUBAGENT_FILE_RE.test('agent-a01fb32b87aefc6ab.jsonl')).toBe(true);
    expect(SUBAGENT_FILE_RE.test(`agent-${'a'.repeat(128)}.jsonl`)).toBe(true);
    expect(SUBAGENT_FILE_RE.test(`agent-${'a'.repeat(129)}.jsonl`)).toBe(false);
    for (const bad of ['agent-.jsonl', 'agent-a b.jsonl', 'agent-../x.jsonl', 'agent-a.b.jsonl', 'agent-a.jsonl\n', 'xagent-a.jsonl', 'agent-a.json']) {
      expect(SUBAGENT_FILE_RE.test(bad)).toBe(false);
    }
  });

  it('does not read a subagent file whose name fails the pattern', async () => {
    const found = await discoverSessions({ dir: FIXTURE_DIR, session: S1, exclude: new Set(), limits: { maxEntries: 1000 } });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const names = found.value.sessions.flatMap(s => s.subagents.map(f => path.basename(f.path)));
    expect(names).toContain('agent-acode01.jsonl');
    expect(names).toContain('agent-awork01.jsonl');
    expect(names).not.toContain('agent-bad.name.jsonl');
    expect(found.value.skipped.badNames).toBe(1);
    expect(names).toHaveLength(6);
  });

  it('never follows a symlinked transcript', async () => {
    const outside = await freshDir();
    await writeFile(path.join(outside, 'real.jsonl'), `${chunk({ id: 'a', req: 'a', usage: { input_tokens: 5 } })}\n`);
    const dir = await freshDir();
    await symlink(path.join(outside, 'real.jsonl'), path.join(dir, 'linked-session.jsonl'));
    const found = await discoverSessions({ dir, session: null, exclude: new Set(), limits: { maxEntries: 100 } });
    expect(found.ok && found.value.sessions).toEqual([]);
    expect(found.ok && found.value.skipped.symlinks).toBe(1);
    const result = await runAudit(options({ dir }));
    expect(result.ok).toBe(false);
  });

  it('never follows a symlinked subagents directory or subagent file', async () => {
    const outside = await freshDir();
    await writeFile(path.join(outside, 'agent-evil1.jsonl'), `${chunk({ id: 'a', req: 'a', usage: { input_tokens: 5 } })}\n`);
    const dir = await freshDir();
    await writeFile(path.join(dir, 's1.jsonl'), `${chunk({ id: 'm', req: 'm', usage: { input_tokens: 1 } })}\n`);
    await mkdir(path.join(dir, 's1'));
    await symlink(outside, path.join(dir, 's1', 'subagents'));
    await mkdir(path.join(dir, 's2', 'subagents'), { recursive: true });
    await writeFile(path.join(dir, 's2.jsonl'), `${chunk({ id: 'n', req: 'n', usage: { input_tokens: 1 } })}\n`);
    await symlink(path.join(outside, 'agent-evil1.jsonl'), path.join(dir, 's2', 'subagents', 'agent-evil1.jsonl'));
    const report = await audit({ dir });
    expect(report.scope.subagentTranscripts).toBe(0);
    expect(report.totals.subagent.requests).toBe(0);
    expect(report.skipped.symlinks).toBe(2);
  });

  it('refuses to open a symlink even if discovery is bypassed', async () => {
    const outside = await freshDir();
    await writeFile(path.join(outside, 'real.jsonl'), `${chunk({ id: 'a', req: 'a', usage: { input_tokens: 5 } })}\n`);
    await symlink(path.join(outside, 'real.jsonl'), path.join(outside, 'link.jsonl'));
    const direct = await parseTranscriptFile(path.join(outside, 'link.jsonl'), DEFAULT_LIMITS);
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.error.kind).toBe('symlink');
  });

  it('keeps hostile ids in a sidecar out of the join keys and sanitizes the agent type', () => {
    const parsed = parseSubagentMeta(
      JSON.stringify({
        agentType: 'Co|de\n\u0007<b>',
        toolUseId: '../../etc/passwd',
        parentAgentId: 'agent-ok_1',
        unknownField: { deep: true },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({ agentType: 'Co|de <b>', toolUseId: null, parentAgentId: 'ok_1' });
    expect(parseSubagentMeta('[]').ok).toBe(false);
    expect(parseSubagentMeta('nope').ok).toBe(false);
  });

  it('treats a missing sidecar as empty rather than an error', async () => {
    const file: SubagentFile = {
      agentId: 'x',
      path: path.join(scratch, 'agent-x.jsonl'),
      metaPath: path.join(scratch, 'agent-x.meta.json'),
      layout: 'flat',
    };
    const meta = await readSubagentMeta(file);
    expect(meta).toEqual({ ok: true, value: { agentType: null, toolUseId: null, parentAgentId: null } });
  });

  it('strips control characters and escapes table syntax in printed text', () => {
    expect(sanitizeText('a\u0000b\u0007c\u202ed\r\ne')).toBe('a b c d e');
    expect(sanitizeText('x'.repeat(200), 10)).toHaveLength(10);
    expect(mdCell('a|b')).toBe('a\\|b');
    expect(mdCell('<script>')).toBe('&lt;script&gt;');
    expect(mdCell('end\\')).toBe('end\\\\');
  });

  it('keeps a hostile skill name from breaking out of its table cell', async () => {
    const md = renderMarkdown(await audit());
    expect(md).toContain('| x\\|y z | 1 | 1 |');
    expect(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(md)).toBe(false);
  });
});
