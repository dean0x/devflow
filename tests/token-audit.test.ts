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
import type { AuditRequest } from '../scripts/token-audit/parse.js';
import { buildReport, gapBin, inWindow, renderJson, renderMarkdown } from '../scripts/token-audit/report.js';
import type { AuditReport, ReportInput, SessionData } from '../scripts/token-audit/report.js';
import { buildSegments, linkSubagents, segmentAt } from '../scripts/token-audit/segment.js';
import { costEquivalent, modelFamily, normalizeUsage } from '../scripts/token-audit/tokens.js';
import type { TokenCounts } from '../scripts/token-audit/tokens.js';
import { DEFAULT_LIMITS, NO_SKIPS, WORKFLOW_RUN_ID_RE, exitCodeFor, mdCell, sanitizeText } from '../scripts/token-audit/types.js';

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
        { name: 'devflow:research', order: 12 },
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

// ── Workflow-tool spawns (D-AUDIT-SEGMENT-LINK) ──────────────────────────────

/** The assistant entry that launches a workflow (or another tool), as Claude Code writes it. */
function launchLine(toolUseId: string, name: string = 'Workflow', inputTokens: number = 1): string {
  return chunk({
    id: `m-${toolUseId}`,
    req: `r-${toolUseId}`,
    usage: { input_tokens: inputTokens },
    content: [{ type: 'tool_use', id: toolUseId, name, input: { script: 'redacted' } }],
  });
}

/** The user entry carrying the tool_result of a launched workflow: `toolUseResult.runId` names the run directory. */
function launchedLine(toolUseId: string, runId: string): string {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-09-01T10:00:01.000Z',
    toolUseResult: {
      status: 'async_launched',
      taskId: 'redacted',
      taskType: 'local_workflow',
      workflowName: 'redacted',
      runId,
      summary: 'redacted',
      transcriptDir: `/redacted/${runId}`,
      scriptPath: '/redacted/script.js',
    },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'redacted', is_error: false }] },
  });
}

describe('workflow-tool spawns (D-AUDIT-SEGMENT-LINK)', () => {
  it('pairs each Workflow tool_use with the run id its tool_result reports', async () => {
    const parsed = await parseTranscriptLines(
      [launchLine('toolu_a'), launchedLine('toolu_a', 'wf_run-A'), launchLine('toolu_b'), launchedLine('toolu_b', 'wf_run-B')],
      LIMITS,
    );
    expect(parsed.workflowRuns).toEqual([
      { runId: 'wf_run-A', toolUseId: 'toolu_a', order: 0 },
      { runId: 'wf_run-B', toolUseId: 'toolu_b', order: 2 },
    ]);
  });

  it('ignores a run id that is malformed, belongs to a non-Workflow tool_use or names an unknown tool_use', async () => {
    const parsed = await parseTranscriptLines(
      [
        launchLine('toolu_a'),
        launchedLine('toolu_a', '../wf_evil'),
        launchedLine('toolu_a', `wf_${'x'.repeat(129)}`),
        launchedLine('toolu_a', 'run-without-prefix'),
        launchLine('toolu_agent', 'Agent'),
        launchedLine('toolu_agent', 'wf_run-C'),
        launchedLine('toolu_unknown', 'wf_run-D'),
      ],
      LIMITS,
    );
    expect(parsed.workflowRuns).toEqual([]);
    expect(parsed.spawns.map(s => s.toolUseId)).toEqual(['toolu_agent']);
  });

  it('keeps the first run id when a tool_use is reported twice', async () => {
    const parsed = await parseTranscriptLines(
      [launchLine('toolu_a'), launchedLine('toolu_a', 'wf_first'), launchedLine('toolu_a', 'wf_second')],
      LIMITS,
    );
    expect(parsed.workflowRuns.map(r => r.runId)).toEqual(['wf_first']);
  });

  it('accepts only wf_<id> run names of bounded length', () => {
    expect(WORKFLOW_RUN_ID_RE.test('wf_4f2746aa-aae')).toBe(true);
    expect(WORKFLOW_RUN_ID_RE.test(`wf_${'a'.repeat(128)}`)).toBe(true);
    for (const bad of [`wf_${'a'.repeat(129)}`, 'wf_', 'wf_a/b', 'wf_a b', 'wf_a\n', 'xwf_a', '../wf_a']) {
      expect(WORKFLOW_RUN_ID_RE.test(bad)).toBe(false);
    }
  });

  it('records the run directory a workflow subagent lives in, and null for a flat one', async () => {
    const found = await discoverSessions({ dir: FIXTURE_DIR, session: S1, exclude: new Set(), limits: { maxEntries: 1000 } });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const files = found.value.sessions.flatMap(s => s.subagents);
    expect(files.find(f => f.agentId === 'awork01')).toMatchObject({ layout: 'workflow', workflowRunId: 'wf_run01' });
    expect(files.find(f => f.agentId === 'acode01')).toMatchObject({ layout: 'flat', workflowRunId: null });
  });

  it('links a workflow subagent to the segment holding the Workflow tool_use that launched its run', () => {
    const segments = buildSegments('S', [{ name: 'devflow:implement', order: 0 }, { name: 'clear', order: 9 }], []);
    const links = linkSubagents(
      'S',
      segments,
      [{ toolUseId: 'tu_code', order: 2, subagentType: 'Code' }],
      [
        { agentId: 'w1', toolUseId: null, parentAgentId: null, workflowRunId: 'wf_a' },
        { agentId: 'w2', toolUseId: null, parentAgentId: null, workflowRunId: 'wf_b' },
        { agentId: 'w3', toolUseId: null, parentAgentId: null, workflowRunId: 'wf_unknown' },
        { agentId: 'both', toolUseId: 'tu_code', parentAgentId: null, workflowRunId: 'wf_b' },
        { agentId: 'flat', toolUseId: null, parentAgentId: null, workflowRunId: null },
      ],
      [
        { runId: 'wf_a', toolUseId: 'tw_a', order: 4 },
        { runId: 'wf_b', toolUseId: 'tw_b', order: 12 },
      ],
    );
    expect(links.get('w1')?.label).toBe('devflow:implement');
    expect(links.get('w2')?.label).toBe('adhoc');
    expect(links.get('w3')?.label).toBe('unattributed');
    expect(links.get('both')?.label).toBe('devflow:implement');
    expect(links.get('flat')?.label).toBe('unattributed');
  });

  it('end to end: workflow subagents join the run that launched them, the rest stay unattributed', async () => {
    const dir = await freshDir();
    const runs = path.join(dir, 'wfsess01', 'subagents', 'workflows');
    const command = (name: string): string =>
      JSON.stringify({ type: 'user', timestamp: '2026-09-01T10:00:00.000Z', message: { role: 'user', content: `<command-name>/${name}</command-name>` } });
    await writeFile(
      path.join(dir, 'wfsess01.jsonl'),
      `${[
        command('devflow:implement'),
        launchLine('toolu_wf_a', 'Workflow', 10),
        launchedLine('toolu_wf_a', 'wf_runA'),
        command('clear'),
        chunk({ id: 'plain', req: 'plain', usage: { input_tokens: 20 } }),
        launchLine('toolu_wf_b', 'Workflow', 30),
        launchedLine('toolu_wf_b', 'wf_runB'),
      ].join('\n')}\n`,
    );
    for (const [runId, agentId, inputTokens] of [
      ['wf_runA', 'aw1', 100],
      ['wf_runB', 'aw2', 200],
      ['wf_runC', 'aw3', 400],
    ] as const) {
      await mkdir(path.join(runs, runId), { recursive: true });
      await writeFile(path.join(runs, runId, `agent-${agentId}.jsonl`), `${chunk({ id: agentId, req: agentId, usage: { input_tokens: inputTokens } })}\n`);
      await writeFile(path.join(runs, runId, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'general-purpose' }));
    }

    const report = await audit({ dir });
    const run = (workflow: string): AuditReport['workflows']['runs'][number] | undefined =>
      report.workflows.runs.find(r => r.workflow === workflow);
    expect(run('devflow:implement')).toMatchObject({ spawns: 1, mainTurns: 1, mainCe: 10, subagentCe: 100 });
    expect(run('adhoc')).toMatchObject({ spawns: 1, mainTurns: 2, mainCe: 50, subagentCe: 200 });
    expect(run('unattributed')).toMatchObject({ spawns: 1, mainTurns: 0, mainCe: 0, subagentCe: 400 });
    expect(report.workflows.runs).toHaveLength(3);
  });
});

// ── Output rounding: float noise at the boundary, exact aggregation ──────────

const NO_COUNTS: TokenCounts = { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnknown: 0, cacheRead: 0, output: 0 };

function request(order: number, usage: Partial<TokenCounts>): AuditRequest {
  return { order, model: 'claude-opus-4-5', timestampMs: null, usage: { ...NO_COUNTS, ...usage }, isFirst: order === 0, gapMs: null };
}

function build(sessions: readonly SessionData[]): AuditReport {
  const input: ReportInput = {
    sessions,
    scope: { dir: '/d', session: null, exclude: [], agentType: null, since: null, until: null, mainTranscripts: sessions.length, subagentTranscripts: 0 },
    window: { sinceMs: null, untilMs: null },
    skipped: NO_SKIPS,
    parseTotals: { lines: 0, syntheticDropped: 0, chunksCollapsed: 0 },
    caps: [],
    limits: { maxSkillNames: 500, maxUnpricedModels: 20 },
  };
  const result = buildReport(input);
  if (!result.ok) throw new Error(`report failed: ${result.error.kind}`);
  return result.value;
}

/** A session with only a main transcript of one request carrying `usage`. */
function mainOnly(sessionId: string, usage: Partial<TokenCounts>): SessionData {
  return { sessionId, main: { requests: [request(0, usage)], segments: buildSegments(sessionId, [], []), skillCalls: [] }, subagents: [] };
}

describe('output rounding', () => {
  it('rounds a share to 6 decimals instead of printing float noise', () => {
    // Cache-read tokens weigh 0.1 each. Two Code agents of [1,1] and [1,4] tokens sum to 0.1+0.1 | 0.1+0.4 per agent,
    // but the stream total adds the requests one by one: the two orders differ in the last bits (0.9999999999999999).
    const segment = buildSegments('S', [], [])[0];
    const agent = (agentId: string, reads: readonly number[]): SessionData['subagents'][number] => ({
      agentId,
      agentType: 'Code',
      segment,
      requests: reads.map((cacheRead, i) => request(i, { cacheRead })),
    });
    const report = build([{ sessionId: 'S', main: null, subagents: [agent('a1', [1, 1]), agent('a2', [1, 4])] }]);
    expect(report.agentTypes[0]?.shareOfSubagentCe).toBe(1);
    expect(report.totals.subagentShareOfCe).toBe(1);
  });

  it('prints no number with more than 6 decimals in the JSON', async () => {
    const json = renderJson(await audit());
    expect(json.match(/\d+\.\d{7,}/g)).toBeNull();
    expect(JSON.parse(json).totals.subagentShareOfCe).toBe(Math.round((10021 / 16054) * 1e6) / 1e6);
  });

  it('keeps byLabel, runs and totals in agreement by summing unrounded parts and rounding once', () => {
    // Two sessions of one 0.4 ce request each: rounding each part first gives 0 + 0, summing first gives 0.8 -> 1.
    const report = build([mainOnly('s1', { cacheRead: 4 }), mainOnly('s2', { cacheRead: 4 })]);
    expect(report.totals.main.ce).toBe(1);
    expect(report.totals.combined.ce).toBe(1);
    expect(report.workflows.byLabel).toHaveLength(1);
    expect(report.workflows.byLabel[0]).toMatchObject({ workflow: 'adhoc', runs: 2, spawns: 0, mainCe: 1, subagentCe: 0, totalCe: 1 });
    expect(report.workflows.runs.map(r => r.totalCe)).toEqual([0, 0]);
  });
});

// ── Markdown paths ───────────────────────────────────────────────────────────

describe('markdown directory line', () => {
  it('prints the whole directory path, not a truncated one', async () => {
    const dir = path.join(await freshDir(), 'a'.repeat(150), 'b'.repeat(150), 'c'.repeat(150));
    await mkdir(dir, { recursive: true });
    await cp(FIXTURE_DIR, dir, { recursive: true });
    expect(dir.length).toBeGreaterThan(450);
    const result = await runCli(['--dir', dir], NO_ENV, '/');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`- Directory: \`${dir}\``);
    expect(result.stdout).not.toContain('…');
  });

  it('still strips control characters and escapes pipes in the path', async () => {
    const report = await audit();
    const hostile = `/x/${'p'.repeat(300)}|y\u0007z`;
    const md = renderMarkdown({ ...report, scope: { ...report.scope, dir: hostile } });
    expect(md).toContain(`- Directory: \`/x/${'p'.repeat(300)}\\|y z\``);
    expect(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(md)).toBe(false);
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
    expect(report.skipped.emptySubagents).toBe(0);
    expect(report.filtered.subagentsOutsideWindow).toBe(7);
  });

  it('filters per request, so a window inside a session keeps only the requests inside it', async () => {
    const report = await audit({ since: '2026-09-01T12:00:00Z', until: '2026-09-02' });
    expect(report.totals.main.requests).toBe(4);
    expect(report.totals.subagent.requests).toBe(0);
    expect(report.skipped.emptySubagents).toBe(0);
    expect(report.filtered.subagentsOutsideWindow).toBe(7);
  });

  it('keeps subagents the window filtered out apart from subagents that have no requests at all', async () => {
    const dir = await freshDir();
    const sub = path.join(dir, 's1', 'subagents');
    await mkdir(sub, { recursive: true });
    const at = (ts: string, id: string): string => `${chunk({ id, req: id, ts, usage: { input_tokens: 1 } })}\n`;
    await writeFile(path.join(dir, 's1.jsonl'), at('2026-09-02T10:00:00.000Z', 'm'));
    await writeFile(path.join(sub, 'agent-early1.jsonl'), at('2026-08-01T10:00:00.000Z', 'e'));
    await writeFile(path.join(sub, 'agent-late1.jsonl'), at('2026-09-03T10:00:00.000Z', 'l'));
    await writeFile(path.join(sub, 'agent-empty1.jsonl'), `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}\n`);

    const windowed = await audit({ dir, since: '2026-09-01' });
    expect(windowed.skipped.emptySubagents).toBe(1);
    expect(windowed.filtered.subagentsOutsideWindow).toBe(1);
    expect(windowed.totals.subagent.requests).toBe(1);

    const unwindowed = await audit({ dir });
    expect(unwindowed.skipped.emptySubagents).toBe(1);
    expect(unwindowed.filtered.subagentsOutsideWindow).toBe(0);

    const md = renderMarkdown(windowed);
    expect(md).toContain('1 subagents with no requests');
    expect(md).toContain('Filtered by the window: 1 subagents with every request outside it.');
    expect(md).not.toMatch(/Skipped:[^\n]*outside it/);
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
      workflowRunId: null,
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

// ── Wave-4C signals: parser (D-AUDIT-READS, D-AUDIT-DECISIONS-SIGNAL, D-AUDIT-BASH-CLASS) ──
//
// Entry shapes sampled from real subagent transcripts: an assistant chunk carries
// `message.id`, `message.stop_reason`, `message.content` blocks and a top-level `requestId`;
// a tool result is a `user` entry with `toolUseResult` and a `tool_result` block; a
// coordinator message is a `user` entry with string content or an `attachment` entry.

/** One assistant chunk with a stop_reason, as Claude Code writes it. */
function turnLine(opts: {
  id: string;
  ts?: string;
  content?: unknown[];
  stop?: string | null;
  usage?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: 'assistant',
    requestId: `req_${opts.id}`,
    timestamp: opts.ts ?? '2026-09-01T10:00:00.000Z',
    message: {
      id: opts.id,
      model: 'claude-opus-4-5',
      role: 'assistant',
      content: opts.content ?? [],
      stop_reason: opts.stop ?? null,
      usage: opts.usage ?? { input_tokens: 1 },
    },
  });
}

function use(id: string, name: string, input: Record<string, unknown>): Record<string, unknown> {
  return { type: 'tool_use', id, name, input };
}

/** A user entry with string content: the spawn prompt, or a coordinator message. */
function promptLine(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'user', timestamp: '2026-09-01T10:00:00.000Z', message: { role: 'user', content: text }, ...extra });
}

/** A tool result: a `user` entry with `toolUseResult` and a `tool_result` block. */
function resultLine(toolUseId: string, content: unknown): string {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-09-01T10:00:00.000Z',
    toolUseResult: { stdout: 'redacted', stderr: '', interrupted: false },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: false }] },
  });
}

function attachmentLine(): string {
  return JSON.stringify({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['redacted'] } });
}

async function signalsOf(lines: readonly string[], limits: Partial<typeof DEFAULT_LIMITS> = {}) {
  const parsed = await parseTranscriptLines(lines, { ...LIMITS, ...limits });
  return parsed;
}

describe('AC-104 resumed flag (parser side of D-AUDIT-MISS-CAUSE)', () => {
  it('marks a request resumed when a coordinator message follows an end_turn', async () => {
    const parsed = await signalsOf([
      turnLine({ id: 'm1', stop: 'end_turn' }),
      promptLine('The coordinator sent a message while you were working: carry on'),
      turnLine({ id: 'm2', stop: 'tool_use', content: [use('t1', 'Bash', { command: 'ls' })] }),
      resultLine('t1', 'ok'),
      turnLine({ id: 'm3', stop: 'end_turn' }),
      attachmentLine(),
      turnLine({ id: 'm4', stop: 'end_turn' }),
      resultLine('t9', 'unrelated array-content user entry'),
      turnLine({ id: 'm5' }),
    ]);
    // m1 first; m2 after end_turn + string user; m3 after a tool_use; m4 after end_turn + attachment;
    // m5 after end_turn + an array-content user entry (not a resume).
    expect(parsed.requests.map(r => r.resumed === true)).toEqual([false, true, false, true, false]);
  });
});

describe('AC-103 reads and re-reads (D-AUDIT-READS)', () => {
  it('counts re-reads per path, exact repeats and ranged reads', async () => {
    const read = (n: number, input: Record<string, unknown>): string =>
      turnLine({ id: `r${n}`, content: [use(`tr${n}`, 'Read', input)] });
    const parsed = await signalsOf([
      read(1, { file_path: '/w/a.ts' }), //                          new
      read(2, { file_path: '/w/a.ts', offset: 5, limit: 20 }), //     re-read, ranged
      read(3, { file_path: '/w/b.ts' }), //                          new
      read(4, { file_path: '/w/a.ts' }), //                          re-read, exact (matches #1)
      read(5, { file_path: '/w/a.ts', offset: 5, limit: 20 }), //     re-read, exact (matches #2), ranged
      read(6, { file_path: '/w/c.ts', limit: 50 }), //                new, ranged
      read(7, { offset: 1 }), //                                     no path: not a Read call we can track
    ]);
    expect(parsed.signals.reads).toEqual({ calls: 6, rereads: 3, exactRereads: 2, ranged: 3 });
    expect(parsed.stats.pathsCapHit).toBe(false);
  });

  it('counts a path read in another transcript as new, because the repeat is per spawn', async () => {
    const one = [turnLine({ id: 'a', content: [use('t1', 'Read', { file_path: '/w/shared.ts' })] })];
    const first = await signalsOf(one);
    const second = await signalsOf([turnLine({ id: 'b', content: [use('t2', 'Read', { file_path: '/w/shared.ts' })] })]);
    expect(first.signals.reads.rereads + second.signals.reads.rereads).toBe(0);
  });

  it('counts a tool_use id once even when its chunk repeats', async () => {
    const twice = turnLine({ id: 'm', content: [use('t1', 'Read', { file_path: '/w/a.ts' })] });
    const parsed = await signalsOf([twice, twice]);
    expect(parsed.signals.reads).toEqual({ calls: 1, rereads: 0, exactRereads: 0, ranged: 0 });
  });

  it('counts ledger reads: the index and the decisions or pitfalls bodies', async () => {
    const read = (n: number, file: string): string => turnLine({ id: `l${n}`, content: [use(`tl${n}`, 'Read', { file_path: file })] });
    const parsed = await signalsOf([
      read(1, '/w/.devflow/learning/index.md'),
      read(2, '/w/.devflow/learning/pitfalls.md'),
      read(3, '/w/.devflow/learning/decisions.md'),
      read(4, '/w/src/index.md'), //            not the ledger
      read(5, '/w/learning/index.md'), //        not under .devflow
      read(6, '.devflow/learning/index.md'), //   a relative ledger path
    ]);
    expect(parsed.signals.ledgerReads).toEqual({ index: 2, bodies: 2 });
  });

  it('reports the read-path cap and keeps counting calls past it', async () => {
    const read = (n: number, file: string): string => turnLine({ id: `c${n}`, content: [use(`tc${n}`, 'Read', { file_path: file })] });
    const lines = [read(1, '/w/p1'), read(2, '/w/p2'), read(3, '/w/p3'), read(4, '/w/p1'), read(5, '/w/p3')];
    const capped = await signalsOf(lines, { maxReadPaths: 2 });
    // p1 and p2 are tracked; p3 is not, so neither p3 read can be told apart as a repeat.
    expect(capped.signals.reads).toEqual({ calls: 5, rereads: 1, exactRereads: 1, ranged: 0 });
    expect(capped.stats.pathsCapHit).toBe(true);
    const roomy = await signalsOf(lines, { maxReadPaths: 3 });
    expect(roomy.signals.reads.rereads).toBe(2);
    expect(roomy.stats.pathsCapHit).toBe(false);
  });
});

describe('AC-105 citations (D-AUDIT-READS)', () => {
  const cited = [
    turnLine({ id: 'c1', content: [{ type: 'text', text: 'applies ADR-007 and PF-012; ADR-007 again' }] }),
    turnLine({ id: 'c2', content: [{ type: 'text', text: 'avoids PF-4321, not PF-12345 nor ADR-7 nor xADR-100' }] }),
    promptLine('the user quotes PF-999'),
    turnLine({ id: 'c3', content: [use('tc', 'Bash', { command: 'echo ADR-555' })] }),
    turnLine({ id: 'c4', content: [{ type: 'thinking', thinking: 'considering PF-777', text: 'PF-778' }] }),
  ];

  it('counts ADR/PF ids in assistant text only: total and distinct', async () => {
    const parsed = await signalsOf(cited);
    expect(parsed.signals.citations).toEqual({ total: 4, distinct: 3 });
    expect(parsed.stats.citationIdsCapHit).toBe(false);
  });

  it('reports the citation-id cap and keeps counting the total', async () => {
    const parsed = await signalsOf(cited, { maxCitationIds: 2 });
    expect(parsed.signals.citations).toEqual({ total: 4, distinct: 2 });
    expect(parsed.stats.citationIdsCapHit).toBe(true);
  });
});

describe('AC-105 DECISIONS_CONTEXT shape and bytes (D-AUDIT-DECISIONS-SIGNAL)', () => {
  const header = 'DECISIONS_CONTEXT: (slice: 2 of 105 entries — full index: /w/.devflow/learning/index.md)';
  const entries = ['  PF-004  Key turn detection on the entry type  —  src/hud/transcript.ts', '  ADR-007  Workflows read a pre-rendered index  —  src/assets/commands/**'];
  const footer = 'ADR-NNN entries live in /w/.devflow/learning/decisions.md';

  async function decisionsOf(prompt: string) {
    return (await signalsOf([promptLine(prompt)])).signals.decisionsContext;
  }

  it('reads a slice: the marker, the index lines, and the block in UTF-8 bytes up to the next field', async () => {
    const block = [header, ...entries, footer].join('\n');
    const found = await decisionsOf(`OPERATION: implement\n${block}\nHANDOFF_REQUIRED: true\n`);
    // The block stops before HANDOFF_REQUIRED. It is 293 characters; its 3 em dashes weigh 3 bytes each in UTF-8,
    // which makes 293 + 3 * 2 = 299 bytes.
    expect(found).toEqual({ bytes: 299, indexLines: 2, shape: 'slice' });
  });

  it('reads a pointer: a ledger path and no index lines', async () => {
    const line = 'DECISIONS_CONTEXT: read /w/.devflow/learning/index.md (the rendered ADR/PF index)';
    const found = await decisionsOf(`OPERATION: issue-fix\n${line}\nHANDOFF_REQUIRED: false`);
    expect(found).toEqual({ bytes: 81, indexLines: 0, shape: 'pointer' });
  });

  it('reads none: an absent field, "(none)", a mid-line mention and a bare field list', async () => {
    const none = { bytes: 0, indexLines: 0, shape: 'none' };
    expect(await decisionsOf('OPERATION: implement\nTASK_ID: t1')).toEqual(none);
    expect(await decisionsOf('DECISIONS_CONTEXT: (none)\nTASK_ID: t1')).toEqual(none);
    expect(await decisionsOf('see DECISIONS_CONTEXT in the doc')).toEqual(none);
    // A bare field list carries no index line and no ledger path: nothing was passed.
    expect(await decisionsOf('DECISIONS_CONTEXT (the active ADR/PF index), PR_DESCRIPTION (the PR body)')).toEqual(none);
  });

  it('calls 30 index lines the full index and 29 without a marker a slice', async () => {
    const lines = (n: number): string => Array.from({ length: n }, (_, i) => `  PF-${String(100 + i)}  title ${i}  —  area`).join('\n');
    expect((await decisionsOf(`DECISIONS_CONTEXT:\n${lines(30)}`)).shape).toBe('full');
    expect((await decisionsOf(`DECISIONS_CONTEXT:\n${lines(29)}`)).shape).toBe('slice');
    expect((await decisionsOf(`DECISIONS_CONTEXT:\n${lines(30)}`)).indexLines).toBe(30);
  });

  it('caps the block at 65,536 characters', async () => {
    const found = await decisionsOf(`DECISIONS_CONTEXT: read /w/.devflow/learning/index.md\n${'x'.repeat(70_000)}`);
    expect(found.bytes).toBe(65_536);
  });

  it('takes the prompt from the first real user entry only', async () => {
    const parsed = await signalsOf([
      promptLine('skill text', { isMeta: true }),
      resultLine('t1', 'DECISIONS_CONTEXT: (none)'),
      promptLine('OPERATION: qa-fix\nDECISIONS_CONTEXT: read /w/.devflow/learning/index.md'),
      promptLine('OPERATION: implement\nDECISIONS_CONTEXT: (none)'),
    ]);
    expect(parsed.signals.operation).toBe('qa-fix');
    expect(parsed.signals.decisionsContext.shape).toBe('pointer');
  });

  it('reads OPERATION from the first line only', async () => {
    expect((await signalsOf([promptLine('OPERATION: issue-fix\nTASK_ID: x')])).signals.operation).toBe('issue-fix');
    expect((await signalsOf([promptLine('TASK_ID: x\nOPERATION: implement')])).signals.operation).toBeNull();
    expect((await signalsOf([promptLine('OPERATION: <b>x|y</b>')])).signals.operation).toBeNull();
  });
});

describe('AC-107 Bash result classes and files written (D-AUDIT-BASH-CLASS)', () => {
  it('classes each command by its strongest tool and sums result bytes per class', async () => {
    const bash = (n: number, command: string, content: unknown): string[] => [
      turnLine({ id: `b${n}`, content: [use(`tb${n}`, 'Bash', { command })] }),
      resultLine(`tb${n}`, content),
    ];
    const parsed = await signalsOf([
      ...bash(1, 'cd /w && npx vitest run tests/x.test.ts --reporter=dot', 'a'.repeat(100)),
      ...bash(2, 'LOG=$(mktemp); npm run build >"$LOG" 2>&1; tail -n 40 "$LOG"', 'b'.repeat(50)),
      ...bash(3, 'git log --oneline | head -5', 'c'.repeat(30)),
      ...bash(4, 'command grep -n foo src | head -3', 'd'.repeat(20)),
      ...bash(5, 'cat a.txt | sed -n 1,5p', 'e'.repeat(10)),
      ...bash(6, 'ls -la', 'é'.repeat(3) + 'f'), // 3 two-byte chars + 1 byte = 7 bytes
      ...bash(7, 'git commit -m "$(cat <<\'EOF\'\nfeat: x\nEOF\n)"', 'g'.repeat(5)),
      ...bash(8, 'echo "done; git status"', 'h'.repeat(3)), // a tool named inside quotes is text, not a command
      ...bash(9, 'tsc --noEmit | grep error', [
        { type: 'text', text: 'i'.repeat(25) },
        { type: 'text', text: 'j'.repeat(15) },
      ]),
      resultLine('tb_unknown', 'z'.repeat(999)), // answers no Bash call: ignored
    ]);
    expect(parsed.signals.bashCalls).toEqual({ 'test/build': 3, git: 2, 'grep/find': 1, 'cat/sed/head': 1, other: 2 });
    expect(parsed.signals.bashResultBytes).toEqual({ 'test/build': 190, git: 35, 'grep/find': 20, 'cat/sed/head': 10, other: 10 });
    // Of the three test/build runs, only the vitest one carries a quiet flag (--reporter=dot).
    expect(parsed.signals.quietTestRuns).toBe(1);
  });

  it('counts files written by Edit and Write: calls and distinct paths', async () => {
    const parsed = await signalsOf([
      turnLine({ id: 'w1', content: [use('e1', 'Edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y' })] }),
      turnLine({ id: 'w2', content: [use('e2', 'Edit', { file_path: '/w/a.ts', old_string: 'y', new_string: 'z' })] }),
      turnLine({ id: 'w3', content: [use('e3', 'Write', { file_path: '/w/b.ts', content: 'redacted' })] }),
      turnLine({ id: 'w4', content: [use('e4', 'Edit', { old_string: 'x' })] }), // no path: ignored
    ]);
    expect(parsed.signals.filesWritten).toEqual({ calls: 3, distinct: 2 });
  });

  it('shares the path-set cap with reads', async () => {
    const write = (n: number, file: string): string => turnLine({ id: `p${n}`, content: [use(`tp${n}`, 'Write', { file_path: file })] });
    const parsed = await signalsOf([write(1, '/w/a'), write(2, '/w/b'), write(3, '/w/c')], { maxReadPaths: 2 });
    expect(parsed.signals.filesWritten).toEqual({ calls: 3, distinct: 2 });
    expect(parsed.stats.pathsCapHit).toBe(true);
  });
});

// ── Wave-4C signals: report ──────────────────────────────────────────────────
//
// Fixture map (tests/fixtures/token-audit/signals/, one session, 12 requests):
//   main      /devflow:implement given a plan document (`x.md`); two Code spawns launched in one
//             assistant message (siblings) and, ten minutes later, one Code-fix spawn.
//   asig01    Code    4 requests, ctx 3002 3503 3904 3925, OPERATION implement, a 2-line slice of the
//                     decisions index (299 B), Reads shared.ts twice and index.md, Edit a.ts, Write b.ts,
//                     one quiet vitest run (100 B back), cites ADR-007 x2 and PF-004.
//   asig02    Code    4 requests, ctx 3002 3103 3101 3112, OPERATION implement, DECISIONS_CONTEXT (none),
//                     Reads shared.ts once, ends its turn at 09:00:15 and is resumed at 09:00:30: its next
//                     request (15 s later) is a cache miss of 3100 tokens; one `git status` (40 B back).
//   asig03    Code-fix 2 requests, ctx 2502 2533, OPERATION validation-fix, a pointer to index.md (81 B),
//                     Reads index.md and pitfalls.md (offset 10, limit 25), cites PF-012; its first request
//                     read 2000 cached tokens.

const SIGNALS_DIR = path.join(import.meta.dirname, 'fixtures', 'token-audit', 'signals');
const T0 = Date.parse('2026-09-01T10:00:00.000Z');

type Spawn = SessionData['subagents'][number];
type Sig = NonNullable<Spawn['signals']>;

const NO_SIGNALS: Sig = {
  operation: null,
  reads: { calls: 0, rereads: 0, exactRereads: 0, ranged: 0 },
  ledgerReads: { index: 0, bodies: 0 },
  citations: { total: 0, distinct: 0 },
  decisionsContext: { bytes: 0, indexLines: 0, shape: 'none' },
  bashCalls: { 'test/build': 0, git: 0, 'grep/find': 0, 'cat/sed/head': 0, other: 0 },
  bashResultBytes: { 'test/build': 0, git: 0, 'grep/find': 0, 'cat/sed/head': 0, other: 0 },
  quietTestRuns: 0,
  filesWritten: { calls: 0, distinct: 0 },
};

function sig(over: Partial<Sig>): Sig {
  return { ...NO_SIGNALS, ...over };
}

/** A request `atSec` seconds after T0. */
function timedRequest(order: number, atSec: number, usage: Partial<TokenCounts>, over: Partial<AuditRequest> = {}): AuditRequest {
  return { ...request(order, usage), timestampMs: T0 + atSec * 1000, ...over };
}

function spawnOf(agentId: string, agentType: string, requests: readonly AuditRequest[], over: Partial<Spawn> = {}): Spawn {
  return { agentId, agentType, segment: buildSegments('S', [], [])[0], requests, ...over };
}

function subagentsOnly(subagents: readonly Spawn[]): AuditReport {
  return build([{ sessionId: 'S', main: null, subagents }]);
}

describe('AC-101 peak context and turn spread (D-AUDIT-PEAK-CTX)', () => {
  it('p90 turns and peak context per type', async () => {
    // Spawn i makes i requests and request k has read 1000 * k tokens, so spawn i peaks at 1000 * i.
    // Turns 1..11: median index round(0.5 * 10) = 5 -> 6, p90 index round(0.9 * 10) = 9 -> 10, total 66.
    // Peaks 1000..11000: median 6000, p90 10000, max 11000.
    const spawns = Array.from({ length: 11 }, (_, n) =>
      spawnOf(`c${n + 1}`, 'Code', Array.from({ length: n + 1 }, (__, k) => request(k, { cacheRead: 1000 * (k + 1) }))),
    );
    const code = subagentsOnly(spawns).agentTypes.find(a => a.agentType === 'Code');
    expect(code).toMatchObject({ spawns: 11, turns: 66, medianTurns: 6, p90Turns: 10, medianPeakContext: 6000, p90PeakContext: 10000, maxPeakContext: 11000 });

    // Over the fixture: Code peaks at 3925 (asig01) and 3112 (asig02); the Code-fix transcript (read as Fix) at 2533.
    const report = await audit({ dir: SIGNALS_DIR });
    const byType = Object.fromEntries(report.agentTypes.map(a => [a.agentType, a]));
    expect(byType['Code']).toMatchObject({ spawns: 2, turns: 8, medianTurns: 4, p90Turns: 4, medianPeakContext: 3925, p90PeakContext: 3925, maxPeakContext: 3925 });
    expect(byType['Fix']).toMatchObject({ spawns: 1, turns: 2, p90Turns: 2, medianPeakContext: 2533, p90PeakContext: 2533, maxPeakContext: 2533 });
  });
});

describe('AC-102 first turn, siblings and staggered spawns (D-AUDIT-FIRST-TURN)', () => {
  // Seven Code spawns in one session, times in seconds after T0 (start-end):
  //   A 0-60 cold   B 1-61 cold, a sibling   C 120-150 read 4000   D 451-451 cold (301 s after C ended)
  //   E 460-470 read 4500   F 480-480 read 6000   G 500-500 first request cut off by the window.
  const code = (id: string, requests: AuditRequest[], over: Partial<Spawn> = {}): Spawn => spawnOf(id, 'Code', requests, over);
  const spawns = [
    code('A', [timedRequest(0, 0, { cacheWrite5m: 5000 }), timedRequest(1, 60, { cacheRead: 5000 })]),
    code('B', [timedRequest(0, 1, { cacheWrite5m: 5000 }), timedRequest(1, 61, { cacheRead: 5000 })], { sibling: true }),
    code('C', [timedRequest(0, 120, { cacheRead: 4000, cacheWrite5m: 1000 }), timedRequest(1, 150, { cacheRead: 5000 })]),
    code('D', [timedRequest(0, 451, { cacheWrite5m: 5000 })]),
    code('E', [timedRequest(0, 460, { cacheRead: 4500, cacheWrite5m: 500 }), timedRequest(1, 470, { cacheRead: 5000 })]),
    code('F', [timedRequest(0, 480, { cacheRead: 6000, cacheWrite5m: 2000 })]),
    code('G', [timedRequest(3, 500, { cacheRead: 4000, cacheWrite5m: 1000 }, { isFirst: false })]),
  ];

  it('counts only first requests: hit share, read ratio, static prefix', () => {
    const row = subagentsOnly(spawns).agentTypes.find(a => a.agentType === 'Code');
    // Six spawns have their first request in the window (G does not); C, E and F read cache on it: 3 / 6.
    // A's later turn also read 5000 and must not count. Read ratios 0 0 0.8 0 0.9 0.75 sort to
    // [0, 0, 0, 0.75, 0.8, 0.9]: median index round(2.5) = 3 -> 0.75. First-turn reads [0 0 4000 0 4500 6000]
    // sort to [0 0 0 4000 4500 6000]: median 4000. The static prefix is the least positive read, 4000.
    expect(row).toMatchObject({
      spawns: 7,
      firstTurnSpawns: 6,
      firstTurnCacheHitShare: 0.5,
      medianFirstTurnReadRatio: 0.75,
      medianFirstTurnCacheRead: 4000,
      staticPrefixEstimate: 4000,
    });
  });

  it('flags siblings and the staggered subset (a later spawn of the type under 5 minutes after, not a sibling)', () => {
    const row = subagentsOnly(spawns).agentTypes.find(a => a.agentType === 'Code');
    // B is a sibling. A has no earlier spawn, D follows C by 301 s (the TTL is over), so C, E and F are
    // staggered (G is too, but has no first turn to judge). Their reads [4000 4500 6000]: all hit,
    // median 4500, and only F's 6000 exceeds 4000 + 1000.
    expect(row?.siblingSpawns).toBe(1);
    expect(row?.staggered).toEqual({ spawns: 3, hits: 3, hitShare: 1, medianCacheRead: 4500, aboveStaticPrefix: 1 });
  });

  it('keeps types and sessions apart when looking for an earlier spawn', () => {
    const other = (id: string, agentType: string, session: string): Spawn => ({ ...spawnOf(id, agentType, [timedRequest(0, 30, { cacheRead: 100 })]) , agentId: `${session}-${id}` });
    const report = build([
      { sessionId: 'S1', main: null, subagents: [spawnOf('x1', 'Code', [timedRequest(0, 0, { cacheWrite5m: 10 })]), other('y', 'Review', 'S1')] },
      { sessionId: 'S2', main: null, subagents: [other('z', 'Code', 'S2')] },
    ]);
    // z (session S2) follows x1 (session S1) by 30 s, y is another type: neither is staggered.
    expect(report.agentTypes.find(a => a.agentType === 'Code')?.staggered.spawns).toBe(0);
    expect(report.agentTypes.find(a => a.agentType === 'Review')?.staggered.spawns).toBe(0);
  });

  it('reads the sibling flag from the parent message of the spawn tool_use', async () => {
    const main = await parseTranscriptFile(path.join(SIGNALS_DIR, '5a1f0000-0000-4000-8000-000000000003.jsonl'), DEFAULT_LIMITS);
    expect(main.ok).toBe(true);
    if (!main.ok) return;
    const ids = Object.fromEntries(main.value.spawns.map(s => [s.toolUseId, s.messageId]));
    expect(ids).toEqual({ toolu_sib1: 'msg_par1', toolu_sib2: 'msg_par1', toolu_solo: 'msg_solo' });
    const report = await audit({ dir: SIGNALS_DIR });
    const byType = Object.fromEntries(report.agentTypes.map(a => [a.agentType, a]));
    expect(byType['Code']).toMatchObject({ siblingSpawns: 2, firstTurnSpawns: 2, firstTurnCacheHitShare: 0, staticPrefixEstimate: 0 });
    expect(byType['Code']?.staggered.spawns).toBe(0);
    // The Code-fix spawn (read as Fix) came alone; its first request read 2000 of its 2502 context tokens (2000 / 2502).
    expect(byType['Fix']).toMatchObject({ siblingSpawns: 0, firstTurnCacheHitShare: 1, medianFirstTurnReadRatio: 0.799361, medianFirstTurnCacheRead: 2000, staticPrefixEstimate: 2000 });
  });
});

describe('AC-103 re-reads, ranged reads and the path cap (D-AUDIT-READS)', () => {
  it('re-read means the same path in the same spawn; ranged means an offset or a limit', async () => {
    const report = await audit({ dir: SIGNALS_DIR });
    // Both Code spawns read src/shared.ts, but only asig01 read it twice: 1 re-read in 4 reads.
    // asig03 read pitfalls.md with an offset and a limit: 1 ranged read in 2.
    expect(report.reads).toEqual([
      { agentType: 'Code', spawns: 2, readCalls: 4, rereads: 1, rereadShare: 0.25, exactRereads: 1, ranged: 0, rangedShare: 0, indexReads: 1, bodyReads: 0 },
      { agentType: 'Fix', spawns: 1, readCalls: 2, rereads: 0, rereadShare: 0, exactRereads: 0, ranged: 1, rangedShare: 0.5, indexReads: 1, bodyReads: 1 },
    ]);
  });

  it('reports the read-path and citation caps as notices', async () => {
    const report = await audit({ dir: SIGNALS_DIR, limits: { ...DEFAULT_LIMITS, maxReadPaths: 1, maxCitationIds: 1 } });
    // asig01 and asig03 read two paths each and asig01 also writes two; asig02 reads one. Only asig01 cites two ids.
    const where = (kind: string): string[] => report.caps.filter(c => c.kind === kind).map(c => c.where).sort();
    expect(where('maxReadPaths')).toEqual(['agent-asig01.jsonl', 'agent-asig03.jsonl']);
    expect(where('maxCitationIds')).toEqual(['agent-asig01.jsonl']);
    expect(report.caps.find(c => c.kind === 'maxReadPaths')?.limit).toBe(1);
    expect(renderMarkdown(report)).toContain('- maxReadPaths (limit 1): agent-asig01.jsonl');
    expect((await audit({ dir: SIGNALS_DIR })).caps).toEqual([]);
  });
});

describe('AC-104 miss cause (D-AUDIT-MISS-CAUSE)', () => {
  // Ten misses after a first request; each has cache_read 0. The first column is the write and its TTL.
  const miss = (order: number, usage: Partial<TokenCounts>, gapMs: number | null, resumed: boolean = false): AuditRequest => ({
    ...request(order, usage),
    gapMs,
    resumed,
  });
  const requests = [
    request(0, { cacheWrite5m: 100 }),
    miss(1, { cacheWrite5m: 1000 }, 400_000), //            5m, gap over the TTL                 -> ttl
    miss(2, { cacheWrite5m: 2000 }, 100_000), //            5m, inside, own tool loop            -> within-ttl
    miss(3, { cacheWrite5m: 3000 }, 100_000, true), //      5m, inside, resumed                  -> within-ttl-resume
    miss(4, { cacheWrite1h: 4000 }, 400_000), //            1h, 400 s is inside an hour          -> within-ttl
    miss(5, { cacheWrite1h: 5000 }, 400_000, true), //      1h, inside, resumed                  -> within-ttl-resume
    miss(6, { cacheWrite1h: 6000 }, 4_000_000), //          1h, over the TTL                     -> ttl
    miss(7, { cacheWrite5m: 7000 }, null), //               gap unknown                          -> unknown
    miss(8, { cacheWriteUnknown: 8000 }, 100_000), //       TTL unknown                          -> unknown
    miss(9, { cacheWrite5m: 9000 }, 300_000), //            gap equal to the TTL has expired     -> ttl
    miss(10, { cacheWrite5m: 10_000 }, 299_999, true), //   one ms inside, resumed               -> within-ttl-resume
  ];

  it('sorts each miss into ttl, within-ttl, within-ttl-resume or unknown', () => {
    const report = subagentsOnly([spawnOf('m', 'Code', requests)]);
    const summary = report.cacheMisses.subagent;
    expect(summary.events).toBe(10);
    // ce of a cause = its tokens at their write weight: ttl 1000 + 9000 at 1.25 and 6000 at 2 = 24,500;
    // within-ttl 2000 at 1.25 and 4000 at 2 = 10,500; within-ttl-resume 3000 + 10,000 at 1.25 and 5000 at 2
    // = 26,250; unknown 7000 + 8000 at 1.25 = 18,750. The stream's ce is those 80,000 plus 125 of the first request.
    expect(summary.byCause.map(c => [c.cause, c.events, c.cacheWriteTokens, c.ce])).toEqual([
      ['ttl', 3, 16_000, 24_500],
      ['within-ttl', 2, 6000, 10_500],
      ['within-ttl-resume', 3, 18_000, 26_250],
      ['unknown', 2, 15_000, 18_750],
    ]);
    expect(summary.byCause[0]?.shareOfStreamCe).toBeCloseTo(24_500 / 80_125, 6);
    expect(report.cacheMisses.main.byCause.every(c => c.events === 0)).toBe(true);
  });

  it('finds a resumed within-TTL miss end to end from the transcript', async () => {
    const report = await audit({ dir: SIGNALS_DIR });
    // asig02 ended its turn at 09:00:15, was resumed at 09:00:30 and missed at 09:00:35: 15 s idle, 3100 tokens written at 1.25.
    expect(report.cacheMisses.subagent.byCause).toEqual([
      { cause: 'ttl', events: 0, cacheWriteTokens: 0, ce: 0, shareOfStreamCe: 0 },
      { cause: 'within-ttl', events: 0, cacheWriteTokens: 0, ce: 0, shareOfStreamCe: 0 },
      { cause: 'within-ttl-resume', events: 1, cacheWriteTokens: 3100, ce: 3875, shareOfStreamCe: expect.closeTo(3875 / 15_439.4, 6) },
      { cause: 'unknown', events: 0, cacheWriteTokens: 0, ce: 0, shareOfStreamCe: 0 },
    ]);
    expect(report.cacheMisses.subagent.events).toBe(1);
  });
});

describe('AC-105 decisions context, citations and self-reads (D-AUDIT-DECISIONS-SIGNAL)', () => {
  it('reports DECISIONS_CONTEXT shape and bytes, distinct citations per spawn, index and body self-reads', async () => {
    const report = await audit({ dir: SIGNALS_DIR });
    const row = (shape: string) => report.decisions.find(d => d.shape === shape);
    expect(report.decisions.map(d => d.shape)).toEqual(['full', 'slice', 'pointer', 'none']);
    // slice  asig01: 299 B, 2 index lines, ADR-007 x2 + PF-004 = 2 distinct ids, opened index.md.
    // pointer asig03: 81 B, PF-012 = 1 id, opened index.md and pitfalls.md.   none asig02: no block, no citation.
    expect(row('full')).toMatchObject({ spawns: 0, totalBytes: 0, indexSelfReadShare: 0 });
    expect(row('slice')).toEqual({
      shape: 'slice', spawns: 1, totalBytes: 299, medianBytes: 299, p90Bytes: 299, medianIndexLines: 2,
      citingSpawns: 1, medianDistinctCitations: 2, totalDistinctCitations: 2,
      indexSelfReadSpawns: 1, indexSelfReadShare: 1, bodySelfReadSpawns: 0, bodySelfReadShare: 0,
    });
    expect(row('pointer')).toEqual({
      shape: 'pointer', spawns: 1, totalBytes: 81, medianBytes: 81, p90Bytes: 81, medianIndexLines: 0,
      citingSpawns: 1, medianDistinctCitations: 1, totalDistinctCitations: 1,
      indexSelfReadSpawns: 1, indexSelfReadShare: 1, bodySelfReadSpawns: 1, bodySelfReadShare: 1,
    });
    expect(row('none')).toMatchObject({ spawns: 1, totalBytes: 0, citingSpawns: 0, totalDistinctCitations: 0, indexSelfReadSpawns: 0 });
  });

  it('leaves a spawn without parser counts out of the signal tables', () => {
    const report = subagentsOnly([spawnOf('bare', 'Code', [request(0, { input: 1 })])]);
    expect(report.reads).toEqual([]);
    expect(report.decisions.every(d => d.spawns === 0)).toBe(true);
    expect(report.bash.every(b => b.calls === 0)).toBe(true);
    expect(report.filesWritten.spawns).toBe(0);
  });
});

describe('AC-106 run distribution (D-AUDIT-RUN-DIST)', () => {
  // One session with three /implement runs: #1 given a plan document (`docs/plan.md`), #2 and #3 not.
  const segments = buildSegments(
    'S',
    [
      { name: 'devflow:implement', order: 10, args: 'docs/plan.md' },
      { name: 'devflow:implement', order: 50 },
      { name: 'devflow:implement', order: 90, args: 'build the thing' },
    ],
    [],
  );
  const commands = [
    { name: 'devflow:implement', order: 10, args: 'docs/plan.md' },
    { name: 'devflow:implement', order: 50 },
    { name: 'devflow:implement', order: 90, args: 'build the thing' },
  ];
  const at = (index: 1 | 2 | 3, id: string, agentType: string, input: number, operation: string | null): Spawn => ({
    agentId: id,
    agentType,
    segment: segments[index],
    requests: [request(0, { input })],
    signals: sig({ operation }),
  });
  const mainRequest = (order: number): AuditRequest => request(order, { input: 100 });
  const session: SessionData = {
    sessionId: 'S',
    main: { requests: [mainRequest(11), mainRequest(51), mainRequest(91)], segments, skillCalls: [], commands },
    subagents: [
      at(1, 'a1', 'Code', 1000, 'implement'),
      at(1, 'a2', 'Code', 1000, 'implement'),
      at(1, 'a3', 'Code-fix', 500, 'validation-fix'),
      at(2, 'b1', 'Code', 2000, 'implement'),
      at(2, 'b2', 'Validate', 300, null),
    ],
  };

  it('reports median and p90 spawns and ce per run, per type, with zero-type runs included', () => {
    const rows = build([session]).workflows.distribution;
    expect(rows.map(r => r.workflow)).toEqual(['devflow:implement']);
    const row = rows[0];
    // Spawns per run [3, 2, 0]: sorted [0 2 3], median index 1 -> 2, p90 index round(1.8) = 2 -> 3.
    // ce per run: 100 + 1000 + 1000 + 500 = 2600, 100 + 2000 + 300 = 2400, 100: median 2400, p90 2600.
    expect(row).toMatchObject({ runs: 3, spawns: { median: 2, p90: 3 }, ce: { median: 2400, p90: 2600 } });
    const type = (name: string) => row?.byType.find(t => t.agentType === name);
    // Code per run [2, 1, 0] and Fix (spawned as Code-fix) [1, 0, 0]: the third run counts as a zero for both.
    expect(type('Code')).toEqual({ agentType: 'Code', totalSpawns: 3, runsWithType: 2, spawns: { median: 1, p90: 2 }, ce: { median: 2000, p90: 2000 } });
    expect(type('Fix')).toEqual({ agentType: 'Fix', totalSpawns: 1, runsWithType: 1, spawns: { median: 0, p90: 1 }, ce: { median: 0, p90: 500 } });
    expect(type('Validate')).toMatchObject({ runsWithType: 1, spawns: { median: 0, p90: 1 } });
  });

  it('splits /implement runs by plan document and Code-fix spawns by OPERATION', () => {
    const row = build([session]).workflows.distribution[0];
    // Run 1 has the plan document. Runs 2 and 3 have [2, 0] spawns: sorted [0 2], median index round(0.5) = 1 -> 2, p90 -> 2.
    expect(row?.byPlan).toEqual([
      { planDocument: true, runs: 1, spawns: { median: 3, p90: 3 }, ce: { median: 2600, p90: 2600 } },
      { planDocument: false, runs: 2, spawns: { median: 2, p90: 2 }, ce: { median: 2400, p90: 2400 } },
    ]);
    expect(row?.codeFixByOperation).toEqual([{ operation: 'validation-fix', totalSpawns: 1, runsWithOperation: 1, spawns: { median: 0, p90: 1 } }]);
  });

  it('takes the plan document from a Skill call too, and only for /implement', () => {
    const skillSegments = buildSegments('S', [], [{ name: 'devflow:implement', order: 5, timestampMs: null, args: 'plan.md' }]);
    const planned = build([
      {
        sessionId: 'S',
        main: { requests: [request(6, { input: 1 })], segments: skillSegments, skillCalls: [{ name: 'devflow:implement', order: 5, timestampMs: null, args: 'plan.md' }] },
        subagents: [],
      },
    ]);
    expect(planned.workflows.distribution[0]?.byPlan.find(p => p.planDocument)?.runs).toBe(1);
    const resolveSegments = buildSegments('S', [{ name: 'devflow:resolve', order: 5, args: 'plan.md' }], []);
    const resolved = build([
      { sessionId: 'S', main: { requests: [request(6, { input: 1 })], segments: resolveSegments, skillCalls: [], commands: [{ name: 'devflow:resolve', order: 5, args: 'plan.md' }] }, subagents: [] },
    ]);
    expect(resolved.workflows.distribution[0]).toMatchObject({ workflow: 'devflow:resolve', byPlan: [] });
  });

  it('reads the run over the fixture: one /implement run given a plan document with three spawns', async () => {
    const report = await audit({ dir: SIGNALS_DIR });
    // Main ce 1255 + 228 = 1483; subagent ce 5945.9 + 8377.8 + 1115.7 = 15,439.4; the run holds both = 16,922.4.
    const row = report.workflows.distribution[0];
    expect(row).toMatchObject({ workflow: 'devflow:implement', runs: 1, spawns: { median: 3, p90: 3 }, ce: { median: 16_922, p90: 16_922 } });
    expect(row?.byPlan).toMatchObject([{ planDocument: true, runs: 1 }, { planDocument: false, runs: 0 }]);
    expect(row?.codeFixByOperation).toMatchObject([{ operation: 'validation-fix', totalSpawns: 1 }]);
    expect(row?.byType.map(t => [t.agentType, t.totalSpawns])).toEqual([['Code', 2], ['Fix', 1]]);
  });
});

describe('AC-107 Bash result classes and files written (D-AUDIT-BASH-CLASS)', () => {
  it('sums Bash result bytes by class over the spawns', async () => {
    const report = await audit({ dir: SIGNALS_DIR });
    // asig01 ran one quiet vitest run that returned 100 B; asig02 ran `git status` and got 40 B back. 140 B in all.
    expect(report.bash.map(b => b.class)).toEqual(['test/build', 'git', 'grep/find', 'cat/sed/head', 'other']);
    expect(report.bash).toEqual([
      { class: 'test/build', calls: 1, resultBytes: 100, shareOfBytes: 0.714286, bytesPerCall: 100, quietCalls: 1 },
      { class: 'git', calls: 1, resultBytes: 40, shareOfBytes: 0.285714, bytesPerCall: 40, quietCalls: null },
      { class: 'grep/find', calls: 0, resultBytes: 0, shareOfBytes: 0, bytesPerCall: 0, quietCalls: null },
      { class: 'cat/sed/head', calls: 0, resultBytes: 0, shareOfBytes: 0, bytesPerCall: 0, quietCalls: null },
      { class: 'other', calls: 0, resultBytes: 0, shareOfBytes: 0, bytesPerCall: 0, quietCalls: null },
    ]);
  });

  it('counts files written per Code implement spawn and tabulates them against turns', () => {
    const codeSpawn = (id: string, files: number, turns: number, over: Partial<Sig> = {}, agentType: string = 'Code'): Spawn =>
      spawnOf(id, agentType, Array.from({ length: turns }, (_, k) => request(k, { input: 1 })), {
        signals: sig({ operation: 'implement', filesWritten: { calls: files * 2, distinct: files }, ...over }),
      });
    const report = subagentsOnly([
      codeSpawn('s0', 0, 3),
      codeSpawn('s1', 1, 10),
      codeSpawn('s2', 3, 20),
      codeSpawn('s3', 3, 40),
      codeSpawn('s4', 12, 100),
      codeSpawn('s5', 45, 200),
      codeSpawn('fix', 99, 5, {}, 'Code-fix'), //                 not a Code spawn
      codeSpawn('other', 99, 5, { operation: 'issue-fix' }), //  not the implement operation
    ]);
    // Six spawns: files [0 1 3 3 12 45] -> median index round(2.5) = 3 -> 3, p90 index round(4.5) = 5 -> 45;
    // turns [3 10 20 40 100 200] -> median 40, p90 200.
    expect(report.filesWritten).toMatchObject({ spawns: 6, medianFiles: 3, p90Files: 45, maxFiles: 45, medianTurns: 40, p90Turns: 200 });
    // 1-4 files: (1, 10) (3, 20) (3, 40) = 7 files in 70 turns, 10 turns a file; 10-19: 100 / 12; 40+: 200 / 45.
    expect(report.filesWritten.byFiles).toEqual([
      { files: '0', spawns: 1, totalFiles: 0, totalTurns: 3, medianTurns: 3, p90Turns: 3, turnsPerFile: 0 },
      { files: '1-4', spawns: 3, totalFiles: 7, totalTurns: 70, medianTurns: 20, p90Turns: 40, turnsPerFile: 10 },
      { files: '5-9', spawns: 0, totalFiles: 0, totalTurns: 0, medianTurns: 0, p90Turns: 0, turnsPerFile: 0 },
      { files: '10-19', spawns: 1, totalFiles: 12, totalTurns: 100, medianTurns: 100, p90Turns: 100, turnsPerFile: 8.333333 },
      { files: '20-39', spawns: 0, totalFiles: 0, totalTurns: 0, medianTurns: 0, p90Turns: 0, turnsPerFile: 0 },
      { files: '40+', spawns: 1, totalFiles: 45, totalTurns: 200, medianTurns: 200, p90Turns: 200, turnsPerFile: 4.444444 },
    ]);
  });

  it('reads files written over the fixture: asig01 wrote two files, asig02 none', async () => {
    const report = await audit({ dir: SIGNALS_DIR });
    expect(report.filesWritten).toMatchObject({ spawns: 2, medianFiles: 2, p90Files: 2, maxFiles: 2, medianTurns: 4, p90Turns: 4 });
    expect(report.filesWritten.byFiles.filter(b => b.spawns > 0)).toEqual([
      { files: '0', spawns: 1, totalFiles: 0, totalTurns: 4, medianTurns: 4, p90Turns: 4, turnsPerFile: 0 },
      { files: '1-4', spawns: 1, totalFiles: 2, totalTurns: 4, medianTurns: 4, p90Turns: 4, turnsPerFile: 2 },
    ]);
  });
});

describe('AC-108 every new section prints', () => {
  let report: AuditReport;
  let md: string;
  beforeAll(async () => {
    report = await audit({ dir: SIGNALS_DIR });
    md = renderMarkdown(report);
  });

  it('prints the peak context and first turn section after "Per agent type"', () => {
    expect(md).toContain('## Peak context and first turn per agent type');
    expect(md.indexOf('## Per agent type')).toBeLessThan(md.indexOf('## Peak context and first turn per agent type'));
    expect(md).toContain('| Code | 2 | 4 | 3,925 | 3,925 | 3,925 | 0.0% of 2 |');
    expect(md).toContain('| Fix | 1 | 2 | 2,533 | 2,533 | 2,533 | 100.0% of 1 | 79.9% | 2,000 | 2,000 | 0 | 0 |');
  });

  it('prints the reads section', () => {
    expect(md).toContain('## Reads per agent type');
    expect(md).toContain('| Code | 2 | 4 | 1 | 25.0% | 1 | 0 | 0.0% | 1 | 0 |');
  });

  it('prints the decisions context section', () => {
    expect(md).toContain('## Decisions context shape');
    expect(md).toContain('| slice | 1 | 299 | 299 | 299 | 2 | 1 | 2 | 1 (100.0%) | 0 (0.0%) |');
    expect(md).toContain('| pointer | 1 | 81 | 81 | 81 | 0 | 1 | 1 | 1 (100.0%) | 1 (100.0%) |');
  });

  it('prints the Bash results section', () => {
    expect(md).toContain('## Bash results by class');
    expect(md).toContain('| test/build | 1 | 100 | 71.4% | 100 | 1 of 1 |');
    expect(md).toContain('| git | 1 | 40 | 28.6% | 40 | - |');
  });

  it('prints the files-written section, and says so when no Code spawn implemented', () => {
    expect(md).toContain('## Files written by Code implement spawns');
    expect(md).toContain('2 spawns: median 2, p90 2, max 2 files written; median 4, p90 4 turns.');
    expect(md).toContain('| 1-4 | 1 | 2 | 4 | 4 | 4 | 2.00 |');
    const none = renderMarkdown(subagentsOnly([spawnOf('x', 'Review', [request(0, { input: 1 })])]));
    expect(none).toContain('## Files written by Code implement spawns');
    expect(none).toContain('No Code spawn ran the implement operation.');
  });

  it('prints the run distribution section', () => {
    expect(md).toContain('## Run distribution per workflow');
    expect(md).toContain('| devflow:implement | 1 | 3 / 3 | 0.02M / 0.02M |');
    expect(md).toContain('| Fix | 1 | 1 of 1 | 1 / 1 | 0.00M / 0.00M |');
    expect(md).toContain('| a plan document | 1 | 3 / 3 |');
    expect(md).toContain('| validation-fix | 1 | 1 of 1 | 1 / 1 |');
  });

  it('prints the cache-miss causes section', () => {
    expect(md).toContain('## Cache-miss causes');
    expect(md).toContain('| subagent | within-ttl-resume | 1 | 0.00M | 0.00M | 25.1% |');
    expect(md).toContain('| main | ttl | 0 | 0.00M | 0.00M | 0.0% |');
  });

  it('carries the same tables in the JSON', () => {
    const json = JSON.parse(renderJson(report));
    expect(Object.keys(json)).toEqual(expect.arrayContaining(['reads', 'decisions', 'bash', 'filesWritten']));
    expect(json.workflows.distribution[0].workflow).toBe('devflow:implement');
    expect(json.agentTypes[0]).toHaveProperty('p90Turns');
    expect(json.agentTypes[0]).toHaveProperty('staggered');
    expect(json.cacheMisses.subagent.byCause).toHaveLength(4);
    expect(renderJson(report).match(/\d+\.\d{7,}/g)).toBeNull();
  });
});

// ── Wave-4C signals: the date window bounds the tool-call signals (D-AUDIT-WINDOW) ──
//
// One Code spawn whose tool calls fall before --since, inside the window and after --until. The
// window is [10:10:00.000, 10:20:00.000): --since is inclusive, --until is exclusive, the same
// convention the request filter uses. A tool_use, a tool_result and an assistant text block each
// count by the timestamp of their own entry. Every number below is hand-counted from the three
// phases, not read back from the parser.

const WIN_SINCE = '2026-09-01T10:10:00.000Z';
const WIN_UNTIL = '2026-09-01T10:20:00.000Z';
const WIN = { sinceMs: Date.parse(WIN_SINCE), untilMs: Date.parse(WIN_UNTIL) };

const stampAt = (clock: string): string => `2026-09-01T${clock}Z`;

/** One tool call as its own assistant entry (and so its own API request). */
function callAt(clock: string, id: string, name: string, input: Record<string, unknown>): string {
  return turnLine({ id: `m_${id}`, ts: stampAt(clock), content: [use(id, name, input)] });
}

function wordsAt(clock: string, id: string, text: string): string {
  return turnLine({ id: `m_${id}`, ts: stampAt(clock), content: [{ type: 'text', text }] });
}

/** The tool_result for `toolUseId`, `bytes` long, in a user entry stamped `clock`. */
function answerAt(clock: string, toolUseId: string, bytes: number): string {
  return JSON.stringify({
    type: 'user',
    timestamp: stampAt(clock),
    toolUseResult: { stdout: 'redacted', stderr: '', interrupted: false },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'r'.repeat(bytes), is_error: false }] },
  });
}

const WIN_PROMPT = promptLine(
  'OPERATION: implement\nDECISIONS_CONTEXT (slice: 2 of 105 entries):\n  ADR-001  one\n  PF-001  two\nHANDOFF_REQUIRED: false',
);

const BEFORE_WINDOW = [
  callAt('10:05:00.000', 'b1', 'Read', { file_path: '/w/a.ts' }),
  callAt('10:05:10.000', 'b2', 'Read', { file_path: '/w/.devflow/learning/index.md' }),
  callAt('10:05:20.000', 'b3', 'Bash', { command: 'npx vitest run --reporter=dot' }),
  answerAt('10:05:21.000', 'b3', 100),
  callAt('10:05:30.000', 'b4', 'Edit', { file_path: '/w/old.ts' }),
  callAt('10:05:35.000', 'b5', 'Write', { file_path: '/w/old2.ts' }),
  wordsAt('10:05:40.000', 'b6', 'applies ADR-001 and PF-001'),
  callAt('10:09:59.000', 'b7', 'Bash', { command: 'git status' }),
];

const IN_WINDOW = [
  callAt('10:10:00.000', 'w1', 'Read', { file_path: '/w/a.ts', offset: 1, limit: 10 }), //     exactly --since: inside
  answerAt('10:10:30.000', 'b7', 7), //                                                         answers a call from before the window
  callAt('10:12:00.000', 'w2', 'Read', { file_path: '/w/a.ts', offset: 1, limit: 10 }),
  callAt('10:13:00.000', 'w3', 'Read', { file_path: '/w/.devflow/learning/pitfalls.md' }),
  callAt('10:13:30.000', 'w4', 'Read', { file_path: '/w/.devflow/learning/index.md' }),
  callAt('10:14:00.000', 'w5', 'Bash', { command: 'git status' }),
  answerAt('10:14:01.000', 'w5', 40),
  callAt('10:15:00.000', 'w6', 'Bash', { command: 'npm test' }),
  answerAt('10:15:05.000', 'w6', 70),
  callAt('10:16:00.000', 'w7', 'Bash', { command: 'npx vitest run --reporter=dot' }),
  answerAt('10:16:05.000', 'w7', 30),
  callAt('10:17:00.000', 'w8', 'Bash', { command: 'grep -rn foo src' }),
  answerAt('10:17:02.000', 'w8', 20),
  callAt('10:17:30.000', 'w9', 'Edit', { file_path: '/w/new.ts' }),
  callAt('10:17:40.000', 'w10', 'Write', { file_path: '/w/new.ts' }),
  wordsAt('10:18:00.000', 'w11', 'applies ADR-007 and PF-012; ADR-007 again'),
  callAt('10:19:59.000', 'w12', 'Bash', { command: 'ls' }),
];

const AFTER_WINDOW = [
  callAt('10:20:00.000', 'a1', 'Read', { file_path: '/w/z.ts' }), //                            exactly --until: outside
  answerAt('10:20:01.000', 'w12', 9), //                                                        answers a call from inside the window
  callAt('10:25:00.000', 'a2', 'Bash', { command: 'npm run build -- --silent' }),
  answerAt('10:25:05.000', 'a2', 500),
  callAt('10:25:10.000', 'a3', 'Bash', { command: 'git log --oneline' }),
  answerAt('10:25:12.000', 'a3', 60),
  callAt('10:25:20.000', 'a4', 'Edit', { file_path: '/w/after.ts' }),
  callAt('10:25:25.000', 'a5', 'Write', { file_path: '/w/after2.ts' }),
  callAt('10:25:30.000', 'a6', 'Read', { file_path: '/w/a.ts', offset: 1, limit: 10 }),
  callAt('10:25:35.000', 'a7', 'Read', { file_path: '/w/.devflow/learning/index.md' }),
  wordsAt('10:25:40.000', 'a8', 'avoids PF-999 and ADR-007'),
];

const WIN_TRANSCRIPT = [WIN_PROMPT, ...BEFORE_WINDOW, ...IN_WINDOW, ...AFTER_WINDOW];

describe('D-AUDIT-WINDOW the date window bounds every tool-call signal', () => {
  it('counts every signal family from the entries inside the window only', async () => {
    const parsed = await parseTranscriptLines(WIN_TRANSCRIPT, LIMITS, WIN);
    // Reads w1 w2 w3 w4: w2 repeats w1 exactly; a path read only before the window is new inside it.
    expect(parsed.signals.reads).toEqual({ calls: 4, rereads: 1, exactRereads: 1, ranged: 2 });
    expect(parsed.signals.ledgerReads).toEqual({ index: 1, bodies: 1 });
    // Assistant text w11: ADR-007 twice and PF-012.
    expect(parsed.signals.citations).toEqual({ total: 3, distinct: 2 });
    // w5 git, w6 + w7 test/build (w7 quiet), w8 grep/find, w12 other.
    expect(parsed.signals.bashCalls).toEqual({ 'test/build': 2, git: 1, 'grep/find': 1, 'cat/sed/head': 0, other: 1 });
    expect(parsed.signals.quietTestRuns).toBe(1);
    // Results answered inside the window: 70 + 30, 40, 20. The ls answer (10:20:01) is outside, and so is the
    // answer to the call made before --since.
    expect(parsed.signals.bashResultBytes).toEqual({ 'test/build': 100, git: 40, 'grep/find': 20, 'cat/sed/head': 0, other: 0 });
    // Edit then Write of new.ts.
    expect(parsed.signals.filesWritten).toEqual({ calls: 2, distinct: 1 });
  });

  it('keeps what the spawn prompt says about the spawn, wherever the prompt falls', async () => {
    const parsed = await parseTranscriptLines(WIN_TRANSCRIPT, LIMITS, WIN);
    // The prompt is stamped 10:00, before --since: it describes the spawn, not activity in the window.
    expect(parsed.signals.operation).toBe('implement');
    expect(parsed.signals.decisionsContext).toMatchObject({ shape: 'slice', indexLines: 2 });
  });

  it('sees every entry when no window is given, which is what the windowed counts are cut from', async () => {
    const parsed = await parseTranscriptLines(WIN_TRANSCRIPT, LIMITS);
    expect(parsed.signals.reads).toEqual({ calls: 9, rereads: 5, exactRereads: 4, ranged: 3 });
    expect(parsed.signals.ledgerReads).toEqual({ index: 3, bodies: 1 });
    expect(parsed.signals.citations).toEqual({ total: 7, distinct: 5 });
    expect(parsed.signals.bashCalls).toEqual({ 'test/build': 4, git: 3, 'grep/find': 1, 'cat/sed/head': 0, other: 1 });
    expect(parsed.signals.quietTestRuns).toBe(3);
    expect(parsed.signals.bashResultBytes).toEqual({ 'test/build': 700, git: 107, 'grep/find': 20, 'cat/sed/head': 0, other: 9 });
    expect(parsed.signals.filesWritten).toEqual({ calls: 6, distinct: 5 });
  });

  it('counts an entry stamped exactly --since and drops one stamped exactly --until', async () => {
    const read = (clock: string, id: string): string => callAt(clock, id, 'Read', { file_path: `/w/${id}.ts` });
    const parsed = await parseTranscriptLines(
      [
        read('10:09:59.999', 'early'), //  1 ms before --since
        read('10:10:00.000', 'first'), //  --since itself
        read('10:19:59.999', 'last'), //   1 ms before --until
        read('10:20:00.000', 'late'), //   --until itself
      ],
      LIMITS,
      WIN,
    );
    expect(parsed.signals.reads.calls).toBe(2);
  });

  it('drops an undated entry from a bounded window and keeps it when the window is open', async () => {
    const undated = JSON.stringify({
      ...JSON.parse(callAt('10:15:00.000', 'u1', 'Edit', { file_path: '/w/u.ts' })),
      timestamp: undefined,
    });
    const dated = callAt('10:15:00.000', 'd1', 'Edit', { file_path: '/w/d.ts' });
    const bounded = await parseTranscriptLines([undated, dated], LIMITS, WIN);
    expect(bounded.signals.filesWritten).toEqual({ calls: 1, distinct: 1 });
    const open = await parseTranscriptLines([undated, dated], LIMITS);
    expect(open.signals.filesWritten).toEqual({ calls: 2, distinct: 2 });
  });

  it('judges a tool_use that is written twice by its first sighting', async () => {
    const early = callAt('10:05:00.000', 'dup', 'Edit', { file_path: '/w/dup.ts' });
    const replayed = callAt('10:15:00.000', 'dup', 'Edit', { file_path: '/w/dup.ts' });
    const inside = callAt('10:12:00.000', 'once', 'Edit', { file_path: '/w/once.ts' });
    const replayedLate = callAt('10:30:00.000', 'once', 'Edit', { file_path: '/w/once.ts' });
    const parsed = await parseTranscriptLines([early, replayed, inside, replayedLate], LIMITS, WIN);
    expect(parsed.signals.filesWritten).toEqual({ calls: 1, distinct: 1 });
  });

  it('reaches the report: a spawn that keeps working after --until leaves the window figures alone', async () => {
    const dir = await freshDir();
    const session = '5a1f0000-0000-4000-8000-000000000009';
    const subagents = path.join(dir, session, 'subagents');
    await mkdir(subagents, { recursive: true });
    await writeFile(
      path.join(dir, `${session}.jsonl`),
      [
        JSON.stringify({ type: 'user', timestamp: stampAt('10:00:00.000'), message: { role: 'user', content: '<command-name>/devflow:implement</command-name>' } }),
        callAt('10:00:05.000', 'toolu_win', 'Agent', { subagent_type: 'Code', description: 'redacted' }),
      ].join('\n') + '\n',
    );
    await writeFile(path.join(subagents, 'agent-win01.meta.json'), JSON.stringify({ agentType: 'Code', toolUseId: 'toolu_win', spawnDepth: 1 }));
    const transcript = path.join(subagents, 'agent-win01.jsonl');

    await writeFile(transcript, [WIN_PROMPT, ...BEFORE_WINDOW, ...IN_WINDOW].join('\n') + '\n');
    const whileRunning = await audit({ dir, since: WIN_SINCE, until: WIN_UNTIL });
    await writeFile(transcript, WIN_TRANSCRIPT.join('\n') + '\n');
    const afterwards = await audit({ dir, since: WIN_SINCE, until: WIN_UNTIL });

    const signalTables = (r: AuditReport) => ({ reads: r.reads, decisions: r.decisions, bash: r.bash, filesWritten: r.filesWritten, totals: r.totals });
    expect(signalTables(afterwards)).toEqual(signalTables(whileRunning));

    expect(afterwards.reads).toEqual([
      { agentType: 'Code', spawns: 1, readCalls: 4, rereads: 1, rereadShare: 0.25, exactRereads: 1, ranged: 2, rangedShare: 0.5, indexReads: 1, bodyReads: 1 },
    ]);
    expect(afterwards.bash).toEqual([
      { class: 'test/build', calls: 2, resultBytes: 100, shareOfBytes: 0.625, bytesPerCall: 50, quietCalls: 1 },
      { class: 'git', calls: 1, resultBytes: 40, shareOfBytes: 0.25, bytesPerCall: 40, quietCalls: null },
      { class: 'grep/find', calls: 1, resultBytes: 20, shareOfBytes: 0.125, bytesPerCall: 20, quietCalls: null },
      { class: 'cat/sed/head', calls: 0, resultBytes: 0, shareOfBytes: 0, bytesPerCall: 0, quietCalls: null },
      { class: 'other', calls: 1, resultBytes: 0, shareOfBytes: 0, bytesPerCall: 0, quietCalls: null },
    ]);
    expect(afterwards.filesWritten).toMatchObject({ spawns: 1, medianFiles: 1, maxFiles: 1 });
    expect(afterwards.decisions.find(d => d.shape === 'slice')).toMatchObject({
      spawns: 1, citingSpawns: 1, totalDistinctCitations: 2, indexSelfReadSpawns: 1, bodySelfReadSpawns: 1,
    });
  });
});

describe('historical agent names count as the agent they became', () => {
  // Transcripts keep the spelling of the day, and the audit never rewrites them. A spawn of the
  // agent that was Code-fix then is Fix now, so a window that spans the rename reads as one row.
  const spawn = (id: string, agentType: string): Spawn => spawnOf(id, agentType, [request(0, { input: 100 })]);

  it.each([
    ['Code-fix', 'Fix'],
    ['Code-edit', 'Refactor'],
    ['Scrutinize', 'Harden'],
    ['Simplify', 'Polish'],
    ['Diagnose', 'Debug'],
    ['Learning', 'Curate'],
    ['Scrutinizer', 'Harden'],
    ['Simplifier', 'Polish'],
    ['Bug-analyzer', 'Debug'],
  ])('a %s spawn is reported as %s', (before, after) => {
    const types = subagentsOnly([spawn('a1', before)]).agentTypes.map(a => a.agentType);

    expect(types).toEqual([after]);
  });

  it('adds the spawns of the old and the new name into one row', () => {
    const report = subagentsOnly([spawn('a1', 'Code-fix'), spawn('a2', 'Code-fix'), spawn('a3', 'Fix')]);

    expect(report.agentTypes.map(a => [a.agentType, a.spawns])).toEqual([['Fix', 3]]);
  });

  it('leaves names that are not retired alone', () => {
    const types = subagentsOnly(['Code', 'Validate', 'general-purpose', 'unknown', 'Explore'].map((t, i) => spawn(`a${i}`, t)))
      .agentTypes.map(a => a.agentType)
      .sort();

    expect(types).toEqual(['Code', 'Explore', 'Validate', 'general-purpose', 'unknown']);
  });

  it('puts a Code-fix transcript of the fixture under Fix, and --agent-type matches either spelling', async () => {
    const all = await audit({ dir: SIGNALS_DIR });
    expect(all.agentTypes.map(a => a.agentType)).toContain('Fix');
    expect(all.agentTypes.map(a => a.agentType)).not.toContain('Code-fix');

    for (const filter of ['Fix', 'Code-fix']) {
      const filtered = await audit({ dir: SIGNALS_DIR, agentType: filter });
      expect(filtered.agentTypes.map(a => [a.agentType, a.spawns]), `--agent-type ${filter}`).toEqual([['Fix', 1]]);
    }
  });
});
