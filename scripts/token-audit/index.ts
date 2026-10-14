#!/usr/bin/env node
/**
 * token-audit — measure where Claude Code token spend goes, from local transcripts.
 *
 * Dev tooling, not shipped (package.json `files` excludes scripts/). Read-only over the
 * transcript tree.
 *
 * Usage: npm run audit:tokens -- (--project <cwd> | --dir <path>) [options]
 *
 * Exit codes: 0 report written; 1 bad arguments or an unreadable directory;
 *             2 no transcript directory, no sessions, or no data in the window.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { SESSION_ID_RE, discoverSessions, projectTranscriptDir, readSubagentMeta } from './discover.js';
import type { SessionFiles, SubagentMeta } from './discover.js';
import { parseTranscriptFile } from './parse.js';
import type { ParsedStream } from './parse.js';
import { buildReport, canonicalAgentType, renderJson, renderMarkdown } from './report.js';
import type { AuditReport, SessionData, SubagentData } from './report.js';
import { buildSegments, linkSubagents } from './segment.js';
import { DEFAULT_LIMITS, MAX_PATH_CHARS, NO_SKIPS, addSkips, exitCodeFor, sanitizeText } from './types.js';
import type { AuditError, CapNotice, Limits, Result, SkipCounts, TimeWindow } from './types.js';

const USAGE = `Usage: npm run audit:tokens -- (--project <cwd> | --dir <path>) [options]

  --project <cwd>       project working directory; its transcripts are read from
                        <claude dir>/projects/<encoded cwd> ($CLAUDE_CONFIG_DIR, else ~/.claude)
  --dir <path>          transcript directory to read directly
  --exclude <id>        drop a main session by exact id (repeatable)
  --session <id>        keep only this main session (and its subagents)
  --since <date>        keep requests and tool calls at or after this ISO date or timestamp (date-only is UTC)
  --until <date>        keep requests and tool calls before this ISO timestamp; a date-only value includes that day
  --agent-type <type>   keep only subagents of this type, old or current spelling (main sessions are unaffected)
  --json                print the report as JSON
  --help                print this help

Exit codes: 0 ok, 1 bad arguments or unreadable directory, 2 no sessions or no data.`;

export interface CliEnv {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly limits?: Limits;
}

export interface CliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

export interface AuditOptions {
  readonly dir: string;
  readonly exclude: readonly string[];
  readonly session: string | null;
  readonly since: string | null;
  readonly until: string | null;
  readonly agentType: string | null;
  readonly json: boolean;
  readonly limits: Limits;
}

// ── Arguments ────────────────────────────────────────────────────────────────

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MAX_ARG_CHARS = 4096;

function usageError(message: string): Result<never, AuditError> {
  return { ok: false, error: { kind: 'usage', message } };
}

/** `--since` is inclusive; `--until` is exclusive, except that a date-only value covers its whole day. */
export function parseWindow(since: string | null, until: string | null): Result<TimeWindow, AuditError> {
  const bound = (value: string | null, name: string, wholeDay: boolean): Result<number | null, AuditError> => {
    if (value === null) return { ok: true, value: null };
    const ms = ISO_RE.test(value) ? Date.parse(value) : Number.NaN;
    if (Number.isNaN(ms)) {
      return usageError(`--${name} must be an ISO 8601 date or timestamp with a zone, got "${sanitizeText(value, 40)}"`);
    }
    return { ok: true, value: wholeDay && DATE_ONLY_RE.test(value) ? ms + DAY_MS : ms };
  };
  const from = bound(since, 'since', false);
  if (!from.ok) return from;
  const to = bound(until, 'until', true);
  if (!to.ok) return to;
  if (from.value !== null && to.value !== null && from.value >= to.value) {
    return usageError('--since must be before --until');
  }
  return { ok: true, value: { sinceMs: from.value, untilMs: to.value } };
}

export type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly options: AuditOptions };

interface RawArgs {
  readonly project: string | undefined;
  readonly dir: string | undefined;
  readonly exclude: readonly string[];
  readonly session: string | undefined;
  readonly since: string | undefined;
  readonly until: string | undefined;
  readonly agentType: string | undefined;
  readonly json: boolean;
  readonly help: boolean;
  readonly positionals: readonly string[];
}

/** The one place `parseArgs` runs; it throws on unknown options, so the throw is caught here. */
function readRawArgs(argv: readonly string[]): Result<RawArgs, AuditError> {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        project: { type: 'string' },
        dir: { type: 'string' },
        exclude: { type: 'string', multiple: true },
        session: { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
        'agent-type': { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
    return {
      ok: true,
      value: {
        project: values.project,
        dir: values.dir,
        exclude: values.exclude ?? [],
        session: values.session,
        since: values.since,
        until: values.until,
        agentType: values['agent-type'],
        json: values.json === true,
        help: values.help === true,
        positionals,
      },
    };
  } catch (err) {
    return usageError(err instanceof Error ? sanitizeText(err.message, 200) : 'invalid arguments');
  }
}

export function parseCliArgs(argv: readonly string[], ctx: CliEnv, cwd: string): Result<ParsedCommand, AuditError> {
  const read = readRawArgs(argv);
  if (!read.ok) return read;
  const raw = read.value;

  if (raw.help) return { ok: true, value: { kind: 'help' } };
  const stray = raw.positionals[0];
  if (stray !== undefined) return usageError(`unexpected argument "${sanitizeText(stray, 40)}"`);

  const named: ReadonlyArray<readonly [string, string | undefined]> = [
    ['project', raw.project],
    ['dir', raw.dir],
    ['session', raw.session],
    ['since', raw.since],
    ['until', raw.until],
    ['agent-type', raw.agentType],
  ];
  for (const [name, value] of named) {
    if (value !== undefined && (value === '' || value.length > MAX_ARG_CHARS)) {
      return usageError(`--${name} needs a non-empty value`);
    }
  }
  if ((raw.project === undefined) === (raw.dir === undefined)) return usageError('give exactly one of --project or --dir');
  if (raw.session !== undefined && !SESSION_ID_RE.test(raw.session)) return usageError('--session is not a valid session id');
  for (const id of raw.exclude) {
    if (!SESSION_ID_RE.test(id)) return usageError('--exclude is not a valid session id');
  }
  const window = parseWindow(raw.since ?? null, raw.until ?? null);
  if (!window.ok) return window;

  const dir =
    raw.project !== undefined
      ? projectTranscriptDir(resolve(cwd, raw.project), ctx.env, ctx.home)
      : resolve(cwd, raw.dir ?? '');
  return {
    ok: true,
    value: {
      kind: 'run',
      options: {
        dir,
        exclude: raw.exclude,
        session: raw.session ?? null,
        since: raw.since ?? null,
        until: raw.until ?? null,
        agentType: raw.agentType ?? null,
        json: raw.json,
        limits: ctx.limits ?? DEFAULT_LIMITS,
      },
    },
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

interface LoadedSession {
  readonly data: SessionData;
  readonly skipped: SkipCounts;
  readonly caps: readonly CapNotice[];
  readonly lines: number;
  readonly syntheticDropped: number;
  readonly chunksCollapsed: number;
  readonly mainTranscripts: number;
  readonly subagentTranscripts: number;
}

function streamSkips(stream: ParsedStream): Partial<SkipCounts> {
  return { malformedLines: stream.stats.malformedLines, oversizeLines: stream.stats.oversizeLines };
}

function capsFor(stream: ParsedStream, where: string, limits: Limits): CapNotice[] {
  const caps: CapNotice[] = [];
  if (stream.stats.linesCapHit) caps.push({ kind: 'maxLines', limit: limits.maxLines, where });
  if (stream.stats.oversizeLines > 0) caps.push({ kind: 'maxLineChars', limit: limits.maxLineChars, where });
  if (stream.stats.pathsCapHit) caps.push({ kind: 'maxReadPaths', limit: limits.maxReadPaths, where });
  if (stream.stats.citationIdsCapHit) caps.push({ kind: 'maxCitationIds', limit: limits.maxCitationIds, where });
  return caps;
}

async function loadSession(files: SessionFiles, opts: AuditOptions, window: TimeWindow): Promise<LoadedSession> {
  const limits = opts.limits;
  let skipped = NO_SKIPS;
  const caps: CapNotice[] = [];
  let lines = 0;
  let syntheticDropped = 0;
  let chunksCollapsed = 0;
  let mainTranscripts = 0;

  let main: SessionData['main'] = null;
  let spawns: ParsedStream['spawns'] = [];
  let workflowRuns: ParsedStream['workflowRuns'] = [];
  let segments = buildSegments(files.sessionId, [], []);
  if (files.mainPath !== null) {
    const parsed = await parseTranscriptFile(files.mainPath, limits, window);
    if (parsed.ok) {
      const stream = parsed.value;
      mainTranscripts = 1;
      segments = buildSegments(files.sessionId, stream.commands, stream.skillCalls);
      spawns = stream.spawns;
      workflowRuns = stream.workflowRuns;
      main = { requests: stream.requests, segments, skillCalls: stream.skillCalls, commands: stream.commands };
      skipped = addSkips(skipped, streamSkips(stream));
      caps.push(...capsFor(stream, `${sanitizeText(files.sessionId)}.jsonl`, limits));
      lines += stream.stats.lines;
      syntheticDropped += stream.stats.syntheticDropped;
      chunksCollapsed += stream.stats.chunksCollapsed;
    } else {
      skipped = addSkips(skipped, { unreadableFiles: 1, symlinks: parsed.error.kind === 'symlink' ? 1 : 0 });
      if (parsed.error.kind === 'too-large') {
        caps.push({ kind: 'maxFileBytes', limit: limits.maxFileBytes, where: `${sanitizeText(files.sessionId)}.jsonl` });
      }
    }
  }

  const loaded: Array<{
    readonly agentId: string;
    readonly meta: SubagentMeta;
    readonly workflowRunId: string | null;
    readonly stream: ParsedStream;
  }> = [];
  for (const file of files.subagents) {
    const metaRead = await readSubagentMeta(file);
    if (!metaRead.ok) skipped = addSkips(skipped, { badMeta: 1 });
    const meta = metaRead.ok ? metaRead.value : { agentType: null, toolUseId: null, parentAgentId: null };
    const type = meta.agentType ?? 'unknown';
    if (opts.agentType !== null && canonicalAgentType(type) !== canonicalAgentType(opts.agentType)) continue;
    const parsed = await parseTranscriptFile(file.path, limits, window);
    if (!parsed.ok) {
      skipped = addSkips(skipped, { unreadableFiles: 1, symlinks: parsed.error.kind === 'symlink' ? 1 : 0 });
      if (parsed.error.kind === 'too-large') {
        caps.push({ kind: 'maxFileBytes', limit: limits.maxFileBytes, where: `agent-${sanitizeText(file.agentId)}.jsonl` });
      }
      continue;
    }
    skipped = addSkips(skipped, streamSkips(parsed.value));
    caps.push(...capsFor(parsed.value, `agent-${sanitizeText(file.agentId)}.jsonl`, limits));
    lines += parsed.value.stats.lines;
    syntheticDropped += parsed.value.stats.syntheticDropped;
    chunksCollapsed += parsed.value.stats.chunksCollapsed;
    loaded.push({ agentId: file.agentId, meta, workflowRunId: file.workflowRunId, stream: parsed.value });
  }

  const links = linkSubagents(
    files.sessionId,
    segments,
    spawns,
    loaded.map(l => ({
      agentId: l.agentId,
      toolUseId: l.meta.toolUseId,
      parentAgentId: l.meta.parentAgentId,
      workflowRunId: l.workflowRunId,
    })),
    workflowRuns,
  );
  // D-AUDIT-FIRST-TURN: a spawn is a sibling when another tool_use of the same parent message
  // launched a spawn too. Nested spawns live in their parent subagent's transcript, so every
  // stream of the session contributes its spawns.
  const messageOfUse = new Map<string, string>();
  const spawnsPerMessage = new Map<string, number>();
  for (const spawn of [...spawns, ...loaded.flatMap(l => l.stream.spawns)]) {
    if (spawn.messageId === undefined || messageOfUse.has(spawn.toolUseId)) continue;
    messageOfUse.set(spawn.toolUseId, spawn.messageId);
    spawnsPerMessage.set(spawn.messageId, (spawnsPerMessage.get(spawn.messageId) ?? 0) + 1);
  }
  const isSibling = (toolUseId: string | null): boolean => {
    const message = toolUseId === null ? undefined : messageOfUse.get(toolUseId);
    return message !== undefined && (spawnsPerMessage.get(message) ?? 0) > 1;
  };
  const subagents: SubagentData[] = [];
  for (const l of loaded) {
    const segment = links.get(l.agentId);
    if (segment === undefined) continue;
    subagents.push({
      agentId: l.agentId,
      agentType: l.meta.agentType ?? 'unknown',
      segment,
      requests: l.stream.requests,
      signals: l.stream.signals,
      sibling: isSibling(l.meta.toolUseId),
    });
  }

  return {
    data: { sessionId: files.sessionId, main, subagents },
    skipped,
    caps,
    lines,
    syntheticDropped,
    chunksCollapsed,
    mainTranscripts,
    subagentTranscripts: loaded.length,
  };
}

/** Discover, parse and aggregate. Every failure is a `Result` error. */
export async function runAudit(opts: AuditOptions): Promise<Result<AuditReport, AuditError>> {
  const window = parseWindow(opts.since, opts.until);
  if (!window.ok) return window;

  const discovered = await discoverSessions({
    dir: opts.dir,
    session: opts.session,
    exclude: new Set(opts.exclude),
    limits: opts.limits,
  });
  if (!discovered.ok) return discovered;
  const { sessions, skipped: discoverSkips, caps: discoverCaps } = discovered.value;
  if (sessions.length === 0) {
    return { ok: false, error: { kind: 'no-sessions', message: `no sessions found in ${sanitizeText(opts.dir, 200)}` } };
  }

  const data: SessionData[] = [];
  let skipped = discoverSkips;
  const caps: CapNotice[] = [...discoverCaps];
  let lines = 0;
  let syntheticDropped = 0;
  let chunksCollapsed = 0;
  let mainTranscripts = 0;
  let subagentTranscripts = 0;
  for (const files of sessions) {
    const loaded = await loadSession(files, opts, window.value);
    data.push(loaded.data);
    skipped = addSkips(skipped, loaded.skipped);
    caps.push(...loaded.caps);
    lines += loaded.lines;
    syntheticDropped += loaded.syntheticDropped;
    chunksCollapsed += loaded.chunksCollapsed;
    mainTranscripts += loaded.mainTranscripts;
    subagentTranscripts += loaded.subagentTranscripts;
  }

  return buildReport({
    sessions: data,
    scope: {
      dir: sanitizeText(opts.dir, MAX_PATH_CHARS),
      session: opts.session,
      exclude: opts.exclude,
      agentType: opts.agentType,
      since: opts.since,
      until: opts.until,
      mainTranscripts,
      subagentTranscripts,
    },
    window: window.value,
    skipped,
    parseTotals: { lines, syntheticDropped, chunksCollapsed },
    caps,
    limits: opts.limits,
  });
}

/** The whole CLI as a function of its inputs, so it can be driven without a process. */
export async function runCli(argv: readonly string[], ctx: CliEnv, cwd: string): Promise<CliResult> {
  const parsed = parseCliArgs(argv, ctx, cwd);
  if (!parsed.ok) {
    return { exitCode: exitCodeFor(parsed.error), stdout: '', stderr: `error: ${parsed.error.message}\n\n${USAGE}\n` };
  }
  if (parsed.value.kind === 'help') return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };

  const result = await runAudit(parsed.value.options);
  if (!result.ok) {
    return { exitCode: exitCodeFor(result.error), stdout: '', stderr: `error: ${result.error.message}\n` };
  }
  const body = parsed.value.options.json ? renderJson(result.value) : renderMarkdown(result.value);
  return { exitCode: 0, stdout: body, stderr: '' };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  // A reader that closes the pipe early (`| head`) is not an error.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw err;
  });
  runCli(process.argv.slice(2), { env: process.env, home: homedir() }, process.cwd()).then(
    result => {
      if (result.stdout !== '') process.stdout.write(result.stdout);
      if (result.stderr !== '') process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    },
    (err: unknown) => {
      process.stderr.write(`error: unexpected failure (${err instanceof Error ? sanitizeText(err.name, 40) : 'unknown'})\n`);
      process.exitCode = 1;
    },
  );
}
