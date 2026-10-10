/**
 * Streaming JSONL transcript parser for the token-audit tool: one transcript file in,
 * typed API requests out.
 *
 * Entry shapes were sampled from real Claude Code transcripts. A user turn is the top-level
 * entry type `user` (never `human`); an API request is one or more `assistant` entries
 * ("chunks") sharing `message.id` + `requestId`.
 */

import { createInterface } from 'node:readline';
import { describeError, openRegularFile } from './fs-safe.js';
import type { OpenError } from './fs-safe.js';
import { normalizeUsage } from './tokens.js';
import type { TokenCounts } from './tokens.js';
import { isRecord, sanitizeText } from './types.js';
import type { Limits, Result } from './types.js';

/** One deduplicated API request. */
export interface AuditRequest {
  /** Line index of the request's first chunk. Orders requests against markers in the same file. */
  readonly order: number;
  readonly model: string;
  /** Timestamp of the first chunk (ms since epoch), or null when absent or unparseable. */
  readonly timestampMs: number | null;
  readonly usage: TokenCounts;
  /** True for the first request in its transcript. */
  readonly isFirst: boolean;
  /** Idle time between the previous request finishing and this one starting; null when unknown or first. */
  readonly gapMs: number | null;
}

/** An `Agent`/`Task` tool_use: a subagent spawn. */
export interface SpawnCall {
  readonly toolUseId: string;
  readonly order: number;
  readonly subagentType: string;
}

/** A `Skill` tool_use. */
export interface SkillCall {
  readonly name: string;
  readonly order: number;
  readonly timestampMs: number | null;
}

/** A `<command-name>` tag in a user message (a slash command the user ran). */
export interface CommandMention {
  readonly name: string;
  readonly order: number;
}

export interface StreamStats {
  readonly lines: number;
  readonly malformedLines: number;
  readonly oversizeLines: number;
  /** `<synthetic>` model entries dropped. */
  readonly syntheticDropped: number;
  /** Extra chunks merged into an already-seen request. */
  readonly chunksCollapsed: number;
  /** True when the per-file line cap stopped the read. */
  readonly linesCapHit: boolean;
}

export interface ParsedStream {
  readonly requests: readonly AuditRequest[];
  readonly spawns: readonly SpawnCall[];
  readonly skillCalls: readonly SkillCall[];
  readonly commands: readonly CommandMention[];
  readonly stats: StreamStats;
}

export type ParseError = OpenError;

const SYNTHETIC_MODEL = '<synthetic>';
const COMMAND_RE = /<command-name>\/?([^<\s]{1,128})<\/command-name>/g;
const MAX_COMMANDS_PER_ENTRY = 8;
const MAX_MODEL_CHARS = 64;
const MAX_NAME_CHARS = 128;

/** An in-flight request while its chunks are still arriving. */
interface Pending {
  readonly order: number;
  model: string;
  firstMs: number | null;
  lastMs: number | null;
  /** Timestamp of the last user entry before the first chunk. */
  startMs: number | null;
  usage: TokenCounts;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') parts.push(block['text']);
  }
  return parts.join(' ');
}

/**
 * Parse transcript lines into requests. Pure over its input: the caller supplies the lines
 * (a file stream in production, an array in tests).
 *
 * D-AUDIT-DEDUPE: a request is keyed `message.id + "\0" + requestId`. Claude Code writes one
 * `assistant` entry per content block, so a request arrives as several chunks. The last
 * chunk's input and cache figures win; `output_tokens` takes the maximum across chunks;
 * entries whose model is `<synthetic>` are dropped. A chunk with no usable id is never merged
 * with another (it is keyed by its line).
 *
 * D-AUDIT-UNTRUSTED: every line is parsed defensively. A malformed line is skipped and
 * counted, a line over `maxLineChars` is skipped and counted, and the read stops at
 * `maxLines` with `linesCapHit` set. Unknown fields are ignored.
 */
export async function parseTranscriptLines(
  lines: AsyncIterable<string> | Iterable<string>,
  limits: Pick<Limits, 'maxLines' | 'maxLineChars'>,
): Promise<ParsedStream> {
  const pending = new Map<string, Pending>();
  const spawns: SpawnCall[] = [];
  const skillCalls: SkillCall[] = [];
  const commands: CommandMention[] = [];
  const seenToolUses = new Set<string>();
  let lastUserMs: number | null = null;
  let order = -1;
  let malformedLines = 0;
  let oversizeLines = 0;
  let syntheticDropped = 0;
  let chunksCollapsed = 0;
  let linesCapHit = false;

  for await (const line of lines) {
    if (order + 1 >= limits.maxLines) {
      linesCapHit = true;
      break;
    }
    order += 1;
    if (line.length > limits.maxLineChars) {
      oversizeLines += 1;
      continue;
    }
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    if (!isRecord(entry)) {
      malformedLines += 1;
      continue;
    }
    const message = entry['message'];
    const timestampMs = parseTimestamp(entry['timestamp']);

    if (entry['type'] === 'user') {
      if (timestampMs !== null) lastUserMs = timestampMs;
      if (entry['toolUseResult'] === undefined && isRecord(message)) {
        const text = userText(message['content']);
        if (text.includes('<command-name>')) {
          let found = 0;
          for (const match of text.matchAll(COMMAND_RE)) {
            if (found >= MAX_COMMANDS_PER_ENTRY) break;
            found += 1;
            commands.push({ name: sanitizeText(match[1] ?? '', MAX_NAME_CHARS), order });
          }
        }
      }
      continue;
    }

    if (entry['type'] !== 'assistant' || !isRecord(message)) continue;
    const model = typeof message['model'] === 'string' ? message['model'] : '';
    if (model === SYNTHETIC_MODEL) {
      syntheticDropped += 1;
      continue;
    }

    const content = message['content'];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block) || block['type'] !== 'tool_use') continue;
        const id = typeof block['id'] === 'string' ? block['id'] : '';
        if (id !== '') {
          if (seenToolUses.has(id)) continue;
          seenToolUses.add(id);
        }
        const name = block['name'];
        const input = isRecord(block['input']) ? block['input'] : {};
        if ((name === 'Agent' || name === 'Task') && id !== '') {
          const type = input['subagent_type'];
          spawns.push({
            toolUseId: id,
            order,
            subagentType: typeof type === 'string' ? sanitizeText(type, MAX_MODEL_CHARS) : '',
          });
        } else if (name === 'Skill' && typeof input['skill'] === 'string') {
          skillCalls.push({ name: sanitizeText(input['skill'], MAX_NAME_CHARS), order, timestampMs });
        }
      }
    }

    const usage = normalizeUsage(message['usage']);
    if (usage === null) continue;
    const messageId = typeof message['id'] === 'string' ? message['id'] : '';
    const requestId = typeof entry['requestId'] === 'string' ? entry['requestId'] : '';
    const key = messageId === '' ? `line\0${order}` : `${messageId}\0${requestId}`;
    const safeModel = sanitizeText(model, MAX_MODEL_CHARS);
    const existing = pending.get(key);
    if (existing === undefined) {
      pending.set(key, {
        order,
        model: safeModel,
        firstMs: timestampMs,
        lastMs: timestampMs,
        startMs: lastUserMs,
        usage,
      });
    } else {
      chunksCollapsed += 1;
      existing.model = safeModel;
      existing.lastMs = timestampMs ?? existing.lastMs;
      existing.usage = { ...usage, output: Math.max(existing.usage.output, usage.output) };
    }
  }

  const requests: AuditRequest[] = [];
  let previous: Pending | undefined;
  for (const request of pending.values()) {
    let gapMs: number | null = null;
    if (previous !== undefined && previous.lastMs !== null) {
      const start =
        request.startMs !== null && request.startMs >= previous.lastMs ? request.startMs : request.firstMs;
      gapMs = start === null ? null : Math.max(0, start - previous.lastMs);
    }
    requests.push({
      order: request.order,
      model: request.model,
      timestampMs: request.firstMs,
      usage: request.usage,
      isFirst: previous === undefined,
      gapMs,
    });
    previous = request;
  }

  return {
    requests,
    spawns,
    skillCalls,
    commands,
    stats: {
      lines: order + 1,
      malformedLines,
      oversizeLines,
      syntheticDropped,
      chunksCollapsed,
      linesCapHit,
    },
  };
}

/**
 * Parse one transcript file. The file is opened symlink-refusing and size-bounded
 * (D-AUDIT-UNTRUSTED); every failure comes back as a `ParseError`.
 */
export async function parseTranscriptFile(
  path: string,
  limits: Pick<Limits, 'maxLines' | 'maxLineChars' | 'maxFileBytes'>,
): Promise<Result<ParsedStream, ParseError>> {
  const opened = await openRegularFile(path, limits.maxFileBytes);
  if (!opened.ok) return opened;
  const handle = opened.value;
  const stream = handle.createReadStream({ encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    return { ok: true, value: await parseTranscriptLines(reader, limits) };
  } catch (err) {
    return { ok: false, error: { kind: 'io', path, detail: describeError(err) } };
  } finally {
    reader.close();
    stream.destroy();
    await handle.close().catch(() => undefined);
  }
}
