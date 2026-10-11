/**
 * Transcript discovery for the token-audit tool: where a project's Claude Code transcripts
 * live and which session and subagent files are in them.
 *
 * Layout (verified against a real ~/.claude/projects tree):
 *   <projectDir>/<sessionId>.jsonl                                      main session
 *   <projectDir>/<sessionId>/subagents/agent-<id>.jsonl                 subagent
 *   <projectDir>/<sessionId>/subagents/agent-<id>.meta.json             optional sidecar
 *   <projectDir>/<sessionId>/subagents/workflows/wf_<id>/agent-<id>.*  workflow-run subagent
 */

import { lstat, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describeError, readSmallText } from './fs-safe.js';
import { WORKFLOW_RUN_ID_RE, isRecord, sanitizeText } from './types.js';
import type { CapNotice, Limits, Result, SkipCounts } from './types.js';
import { NO_SKIPS, addSkips } from './types.js';

/**
 * D-AUDIT-PROJECT-ENCODING: Claude Code names a project's transcript directory by replacing
 * every character outside [A-Za-z0-9] in the cwd with `-` (so `.` and `_` map too, not just
 * `/`). This is the one shared encoder: the integration test helpers import it rather than
 * keeping a second, divergent copy.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** The Claude Code directory: `$CLAUDE_CONFIG_DIR` when absolute, else `~/.claude`. */
export function claudeConfigDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const configured = env['CLAUDE_CONFIG_DIR'];
  return configured !== undefined && configured !== '' && isAbsolute(configured) ? configured : join(home, '.claude');
}

export function projectTranscriptDir(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  return join(claudeConfigDir(env, home), 'projects', encodeProjectDir(cwd));
}

/** D-AUDIT-UNTRUSTED: subagent transcript names, anchored and bounded. */
export const SUBAGENT_FILE_RE = /^agent-[A-Za-z0-9_-]{1,128}\.jsonl$/;
/** Main-session ids (the file or directory stem). */
export const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const META_MAX_BYTES = 65_536;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface SubagentFile {
  /** The id after the `agent-` prefix. */
  readonly agentId: string;
  readonly path: string;
  readonly metaPath: string;
  readonly layout: 'flat' | 'workflow';
  /** The `wf_*` run directory a workflow-layout file lives in (already shape-checked); null for a flat file. */
  readonly workflowRunId: string | null;
}

export interface SessionFiles {
  readonly sessionId: string;
  /** Null when only the session directory survives. */
  readonly mainPath: string | null;
  readonly subagents: readonly SubagentFile[];
}

export interface DiscoverOptions {
  readonly dir: string;
  /** Restrict to this session id (exact match). */
  readonly session: string | null;
  /** Session ids to drop (exact match). */
  readonly exclude: ReadonlySet<string>;
  readonly limits: Pick<Limits, 'maxEntries'>;
}

export interface Discovery {
  readonly sessions: readonly SessionFiles[];
  readonly skipped: SkipCounts;
  readonly caps: readonly CapNotice[];
}

export type DiscoverError =
  | { readonly kind: 'not-found'; readonly message: string }
  | { readonly kind: 'io'; readonly message: string };

interface Budget {
  remaining: number;
  exhausted: boolean;
}

function spend(budget: Budget): boolean {
  if (budget.remaining <= 0) {
    budget.exhausted = true;
    return false;
  }
  budget.remaining -= 1;
  return true;
}

async function listDir(path: string): Promise<Result<Dirent[], 'missing' | 'io'>> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { ok: true, value: entries };
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code: unknown }).code : undefined;
    return { ok: false, error: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'io' };
  }
}

/** What `path` is without following a symlink; D-AUDIT-UNTRUSTED. */
async function entryKind(path: string): Promise<'directory' | 'symlink' | 'other' | 'missing'> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return 'symlink';
    return info.isDirectory() ? 'directory' : 'other';
  } catch {
    return 'missing';
  }
}

/** Internal accumulator for one session's subagent scan; never escapes this module. */
interface SubagentScan {
  files: SubagentFile[];
  skipped: SkipCounts;
}

function subagentFile(dir: string, name: string, workflowRunId: string | null): SubagentFile {
  const stem = name.slice(0, -'.jsonl'.length);
  return {
    agentId: stem.slice('agent-'.length),
    path: join(dir, name),
    metaPath: join(dir, `${stem}.meta.json`),
    layout: workflowRunId === null ? 'flat' : 'workflow',
    workflowRunId,
  };
}

/**
 * Scan one `subagents/` directory (`workflowRunId` null) or one `workflows/wf_*` directory
 * (`workflowRunId` is that directory's name).
 */
async function scanSubagentDir(
  dir: string,
  workflowRunId: string | null,
  budget: Budget,
  acc: SubagentScan,
): Promise<void> {
  const listed = await listDir(dir);
  if (!listed.ok) return;
  let hasWorkflows = false;
  for (const entry of listed.value) {
    if (!spend(budget)) return;
    if (entry.isSymbolicLink()) {
      acc.skipped = addSkips(acc.skipped, { symlinks: 1 });
    } else if (entry.isFile() && SUBAGENT_FILE_RE.test(entry.name)) {
      acc.files.push(subagentFile(dir, entry.name, workflowRunId));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      acc.skipped = addSkips(acc.skipped, { badNames: 1 });
    } else if (workflowRunId === null && entry.isDirectory() && entry.name === 'workflows') {
      hasWorkflows = true;
    }
  }
  if (!hasWorkflows) return;
  const workflowsDir = join(dir, 'workflows');
  const runs = await listDir(workflowsDir);
  if (!runs.ok) return;
  for (const run of runs.value) {
    if (!spend(budget)) return;
    if (run.isSymbolicLink()) {
      acc.skipped = addSkips(acc.skipped, { symlinks: 1 });
    } else if (run.isDirectory() && WORKFLOW_RUN_ID_RE.test(run.name)) {
      await scanSubagentDir(join(workflowsDir, run.name), run.name, budget, acc);
    }
  }
}

/**
 * Find the session and subagent transcripts under `opts.dir`.
 *
 * D-AUDIT-UNTRUSTED: only directory listings decide what is read. Names are matched against
 * anchored patterns, symlinks are counted and skipped (readdir reports them without following
 * them), and the number of entries visited is capped; when the cap is hit it is returned in
 * `caps`.
 */
export async function discoverSessions(opts: DiscoverOptions): Promise<Result<Discovery, DiscoverError>> {
  try {
    const root = await stat(opts.dir);
    if (!root.isDirectory()) {
      return { ok: false, error: { kind: 'io', message: `not a directory: ${sanitizeText(opts.dir, 200)}` } };
    }
  } catch (err) {
    const missing = typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'ENOENT';
    return {
      ok: false,
      error: missing
        ? { kind: 'not-found', message: `no transcript directory at ${sanitizeText(opts.dir, 200)}` }
        : { kind: 'io', message: `cannot read ${sanitizeText(opts.dir, 200)} (${describeError(err)})` },
    };
  }

  const top = await listDir(opts.dir);
  if (!top.ok) {
    return { ok: false, error: { kind: 'io', message: `cannot list ${sanitizeText(opts.dir, 200)}` } };
  }

  const budget: Budget = { remaining: opts.limits.maxEntries, exhausted: false };
  let skipped = NO_SKIPS;
  const mains = new Map<string, string>();
  const dirs = new Set<string>();
  for (const entry of top.value) {
    if (!spend(budget)) break;
    if (entry.isSymbolicLink()) {
      skipped = addSkips(skipped, { symlinks: 1 });
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const stem = entry.name.slice(0, -'.jsonl'.length);
      if (SESSION_ID_RE.test(stem)) mains.set(stem, join(opts.dir, entry.name));
      else skipped = addSkips(skipped, { badNames: 1 });
    } else if (entry.isDirectory() && SESSION_ID_RE.test(entry.name)) {
      dirs.add(entry.name);
    }
  }

  const wanted = [...new Set([...mains.keys(), ...dirs])]
    .filter(id => (opts.session === null || id === opts.session) && !opts.exclude.has(id))
    .sort();

  const sessions: SessionFiles[] = [];
  for (const sessionId of wanted) {
    const scan: SubagentScan = { files: [], skipped: NO_SKIPS };
    if (dirs.has(sessionId)) {
      const subagentsDir = join(opts.dir, sessionId, 'subagents');
      const kind = await entryKind(subagentsDir);
      if (kind === 'directory') await scanSubagentDir(subagentsDir, null, budget, scan);
      else if (kind === 'symlink') scan.skipped = addSkips(scan.skipped, { symlinks: 1 });
    }
    skipped = addSkips(skipped, scan.skipped);
    const mainPath = mains.get(sessionId) ?? null;
    if (mainPath !== null || scan.files.length > 0) {
      sessions.push({ sessionId, mainPath, subagents: scan.files });
    }
  }

  const caps: CapNotice[] = budget.exhausted
    ? [{ kind: 'maxEntries', limit: opts.limits.maxEntries, where: sanitizeText(opts.dir, 200) }]
    : [];
  return { ok: true, value: { sessions, skipped, caps } };
}

/** What a subagent's sidecar meta file says about it. Every field is optional. */
export interface SubagentMeta {
  readonly agentType: string | null;
  readonly toolUseId: string | null;
  readonly parentAgentId: string | null;
}

export const EMPTY_META: SubagentMeta = Object.freeze({ agentType: null, toolUseId: null, parentAgentId: null });

function idField(value: unknown, stripAgentPrefix: boolean): string | null {
  if (typeof value !== 'string') return null;
  const id = stripAgentPrefix && value.startsWith('agent-') ? value.slice('agent-'.length) : value;
  return ID_RE.test(id) ? id : null;
}

/**
 * Parse the text of a sidecar meta file. Unknown fields are ignored; ids must match a
 * conservative shape because they are used as map keys against other transcript content.
 */
export function parseSubagentMeta(text: string): Result<SubagentMeta, string> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'meta is not valid JSON' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'meta is not an object' };
  const type = typeof raw['agentType'] === 'string' ? sanitizeText(raw['agentType'], 64) : '';
  return {
    ok: true,
    value: {
      agentType: type === '' ? null : type,
      toolUseId: idField(raw['toolUseId'], false),
      parentAgentId: idField(raw['parentAgentId'], true),
    },
  };
}

/** Read a subagent's sidecar. A missing sidecar is not an error: it yields `EMPTY_META`. */
export async function readSubagentMeta(file: SubagentFile): Promise<Result<SubagentMeta, string>> {
  const read = await readSmallText(file.metaPath, META_MAX_BYTES);
  if (!read.ok) {
    return read.error.kind === 'not-found' ? { ok: true, value: EMPTY_META } : { ok: false, error: read.error.kind };
  }
  return parseSubagentMeta(read.value);
}
