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
import { DEFAULT_LIMITS, MAX_PATH_CHARS, OPEN_WINDOW, WORKFLOW_RUN_ID_RE, inWindow, isRecord, sanitizeText } from './types.js';
import type { Limits, Result, TimeWindow } from './types.js';

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
  /**
   * True when the request follows an `end_turn` that was answered by a coordinator message (a
   * `user` entry with string content, or an `attachment` entry): the agent was resumed, not
   * continuing its own tool loop (D-AUDIT-MISS-CAUSE). Absent means not resumed.
   */
  readonly resumed?: boolean;
}

/** An `Agent`/`Task` tool_use: a subagent spawn. */
export interface SpawnCall {
  readonly toolUseId: string;
  readonly order: number;
  readonly subagentType: string;
  /**
   * `message.id` of the assistant message that carried the tool_use. Spawns sharing it were
   * launched together, so they started at the same moment (siblings). Absent when the entry had no id.
   */
  readonly messageId?: string;
}

/**
 * A `Workflow` tool_use paired with the run its tool_result reports. `runId` names the
 * `subagents/workflows/<runId>/` directory the run's subagents live in; `order` is the line of
 * the tool_use, the position that run is attributed to.
 */
export interface WorkflowRunCall {
  readonly runId: string;
  readonly toolUseId: string;
  readonly order: number;
}

/** A `Skill` tool_use. */
export interface SkillCall {
  readonly name: string;
  readonly order: number;
  readonly timestampMs: number | null;
  /** Sanitized `input.args`; absent when the call gave none. */
  readonly args?: string;
}

/** A `<command-name>` tag in a user message (a slash command the user ran). */
export interface CommandMention {
  readonly name: string;
  readonly order: number;
  /** Sanitized `<command-args>` of the same entry; absent when it had none. */
  readonly args?: string;
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
  /** True when a read-path or written-path set reached `maxReadPaths` (D-AUDIT-READS). */
  readonly pathsCapHit: boolean;
  /** True when the cited-id set reached `maxCitationIds` (D-AUDIT-READS). */
  readonly citationIdsCapHit: boolean;
}

/** What a Bash command mostly does, by its strongest tool (D-AUDIT-BASH-CLASS). Earlier entries win. */
export const BASH_CLASSES = ['test/build', 'git', 'grep/find', 'cat/sed/head', 'other'] as const;
export type BashClass = (typeof BASH_CLASSES)[number];

/** How much of the decisions index a spawn prompt carried (D-AUDIT-DECISIONS-SIGNAL). */
export const DECISIONS_SHAPES = ['full', 'slice', 'pointer', 'none'] as const;
export type DecisionsShape = (typeof DECISIONS_SHAPES)[number];

export interface DecisionsSignal {
  /** UTF-8 bytes of the DECISIONS_CONTEXT block, at most 65,536 characters of it; 0 for `none`. */
  readonly bytes: number;
  /** Lines of the block that are index entries (`ADR-NNN  title ...`). */
  readonly indexLines: number;
  readonly shape: DecisionsShape;
}

/**
 * Per-transcript counts the wave-4C analysis reads. All of them are counts, never content. Every
 * tool-call count covers the entries inside the date window only (D-AUDIT-WINDOW).
 */
export interface ParsedSignals {
  /** The `OPERATION:` value on the first line of the first user prompt; null when absent. */
  readonly operation: string | null;
  /** Read tool calls. A re-read is a path already read in this transcript; exact repeats the same range too. */
  readonly reads: {
    readonly calls: number;
    readonly rereads: number;
    readonly exactRereads: number;
    /** Calls that gave an `offset` or a `limit`. */
    readonly ranged: number;
  };
  /** Read calls that opened the learning ledger: `index.md`, and `decisions.md` or `pitfalls.md`. */
  readonly ledgerReads: { readonly index: number; readonly bodies: number };
  /** ADR/PF ids in assistant text. */
  readonly citations: { readonly total: number; readonly distinct: number };
  readonly decisionsContext: DecisionsSignal;
  readonly bashCalls: Readonly<Record<BashClass, number>>;
  readonly bashResultBytes: Readonly<Record<BashClass, number>>;
  /** test/build runs whose command carries a quiet flag (`--reporter=dot`, `--silent`, `--pretty false` ...). */
  readonly quietTestRuns: number;
  /** Edit and Write calls; `distinct` is the number of different paths they named. */
  readonly filesWritten: { readonly calls: number; readonly distinct: number };
}

export interface ParsedStream {
  readonly requests: readonly AuditRequest[];
  readonly spawns: readonly SpawnCall[];
  readonly workflowRuns: readonly WorkflowRunCall[];
  readonly skillCalls: readonly SkillCall[];
  readonly commands: readonly CommandMention[];
  readonly signals: ParsedSignals;
  readonly stats: StreamStats;
}

export type ParseError = OpenError;

/** The limits the parser reads. The two signal caps are optional so a caller that predates them keeps working. */
export type ParseLimits = Pick<Limits, 'maxLines' | 'maxLineChars'> & Partial<Pick<Limits, 'maxReadPaths' | 'maxCitationIds'>>;

const SYNTHETIC_MODEL = '<synthetic>';
const COMMAND_RE = /<command-name>\/?([^<\s]{1,128})<\/command-name>/g;
const MAX_COMMANDS_PER_ENTRY = 8;
const MAX_MODEL_CHARS = 64;
const MAX_NAME_CHARS = 128;
const MAX_ARGS_CHARS = 256;
const ARGS_RE = /<command-args>([^<]{1,1024})<\/command-args>/;

/** An in-flight request while its chunks are still arriving. */
interface Pending {
  readonly order: number;
  model: string;
  firstMs: number | null;
  lastMs: number | null;
  /** Timestamp of the last user entry before the first chunk. */
  startMs: number | null;
  usage: TokenCounts;
  readonly resumed: boolean;
}

// ── Signals ──────────────────────────────────────────────────────────────────

/** Longest slice of a spawn prompt read as the DECISIONS_CONTEXT block (D-AUDIT-DECISIONS-SIGNAL). */
const MAX_DECISIONS_BLOCK_CHARS = 65_536;
/** Index lines at or above which a block with no slice marker is the full index. */
const FULL_INDEX_MIN_LINES = 30;
const MAX_FIRST_LINE_CHARS = 256;
const MAX_BASH_COMMAND_CHARS = 8_192;
const MAX_BASH_SEGMENTS = 64;
const MAX_SEGMENT_TOKENS = 32;
const MAX_CLASSIFY_DEPTH = 3;
/** Bash tool_use calls waiting for their result; the oldest is dropped past this, so an unanswered call cannot grow the map. */
const MAX_PENDING_BASH = 1_024;

const OPERATION_RE = /^OPERATION:[ \t]*([A-Za-z][A-Za-z0-9_-]{0,31})\b/;
const DECISIONS_MARKER_RE = /^DECISIONS_CONTEXT\b/m;
const DECISIONS_NONE_RE = /^DECISIONS_CONTEXT\s*:\s*\(?\s*none\s*\)?\s*$/i;
const DECISIONS_SLICE_RE = /\(slice:\s*\d+\s+of\s+\d+\s+entries/;
/** The first line of the next prompt field (`HANDOFF_REQUIRED: true`, `PR_DESCRIPTION (...)`) ends the block. */
const FIELD_LINE_RE = /^[A-Z][A-Z0-9_]{2,}[ \t]*[:(]/;
const INDEX_LINE_RE = /^\s*(?:ADR|PF)-\d{3,4}\s{2,}\S/;
const LEDGER_PATH_RE = /(?:index|decisions|pitfalls)\.md|\.devflow\/learning/;
const CITATION_RE = /\b(?:ADR|PF)-\d{3,4}\b/g;

const QUOTED_RE = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
const SEGMENT_SPLIT_RE = /&&|\|\||\$\(|[;|&\n()`]/;
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PREFIX_WORDS: ReadonlySet<string> = new Set(['command', 'builtin', 'exec', 'time', 'nohup', 'sudo', 'env', 'then', 'do', 'else', '!']);
const BUILD_SCRIPT_RE = /^(?:t|test|build|typecheck|lint|check|tsc|vitest)(?:$|[:\-_.])/;
const COMPILER_SUBCOMMANDS: ReadonlySet<string> = new Set(['test', 'build', 'check', 'clippy', 'vet', 'bench']);
const TEST_TOOLS: ReadonlySet<string> = new Set(['vitest', 'jest', 'pytest', 'tsc', 'eslint', 'mocha', 'make', 'playwright']);
const GIT_TOOLS: ReadonlySet<string> = new Set(['git', 'gh']);
const SEARCH_TOOLS: ReadonlySet<string> = new Set(['grep', 'egrep', 'fgrep', 'ugrep', 'rg', 'find', 'fd', 'ag', 'ack']);
const READ_TOOLS: ReadonlySet<string> = new Set(['cat', 'sed', 'head', 'tail', 'less', 'more', 'nl', 'bat', 'awk']);
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(['npx', 'bunx', 'pnpx']);
const QUIET_FLAG_RE =
  /--reporter[= ](?:dot|min|basic|silent)\b|--silent\b|--quiet\b|--pretty[= ]false\b|(?:^|\s)-q(?:\s|$)|--loglevel[= ](?:silent|error|warn)\b/;

const NO_DECISIONS: DecisionsSignal = Object.freeze({ bytes: 0, indexLines: 0, shape: 'none' });

function classRecord(): Record<BashClass, number> {
  return { 'test/build': 0, git: 0, 'grep/find': 0, 'cat/sed/head': 0, other: 0 };
}

/** The class of one word and the words after it, or null when the word is no tool this audit sorts. */
function wordClass(head: string, rest: readonly string[], depth: number): BashClass | null {
  const name = head.slice(head.lastIndexOf('/') + 1);
  const positional = rest.filter(word => !word.startsWith('-'));
  const first = positional[0];
  if (TEST_TOOLS.has(name)) return 'test/build';
  if (GIT_TOOLS.has(name)) return 'git';
  if (SEARCH_TOOLS.has(name)) return 'grep/find';
  if (READ_TOOLS.has(name)) return 'cat/sed/head';
  if (name === 'cargo' || name === 'go') return first !== undefined && COMPILER_SUBCOMMANDS.has(first) ? 'test/build' : null;
  if (name === 'node') return rest.includes('--test') ? 'test/build' : null;
  if (PACKAGE_RUNNERS.has(name)) {
    return depth < MAX_CLASSIFY_DEPTH && first !== undefined ? wordClass(first, positional.slice(1), depth + 1) : null;
  }
  if (PACKAGE_MANAGERS.has(name)) {
    if (first === undefined) return null;
    if (first === 'run' || first === 'run-script') {
      const script = positional[1];
      return script !== undefined && BUILD_SCRIPT_RE.test(script) ? 'test/build' : null;
    }
    if (first === 'exec' || first === 'dlx') {
      const tool = positional[1];
      return depth < MAX_CLASSIFY_DEPTH && tool !== undefined ? wordClass(tool, positional.slice(2), depth + 1) : null;
    }
    return BUILD_SCRIPT_RE.test(first) ? 'test/build' : null;
  }
  if (name === 'skim') {
    const inner = depth < MAX_CLASSIFY_DEPTH && first !== undefined ? wordClass(first, positional.slice(1), depth + 1) : null;
    if (inner !== null) return inner;
    return first !== undefined && /[/.*]/.test(first) ? 'cat/sed/head' : null;
  }
  return null;
}

function segmentClass(segment: string): BashClass | null {
  const tokens = segment.trim().split(/\s+/, MAX_SEGMENT_TOKENS);
  let at = 0;
  while (at < tokens.length) {
    const token = tokens[at] ?? '';
    if (token !== '' && !ENV_ASSIGN_RE.test(token) && !PREFIX_WORDS.has(token)) break;
    at += 1;
  }
  const head = tokens[at];
  return head === undefined ? null : wordClass(head, tokens.slice(at + 1), 0);
}

/**
 * D-AUDIT-BASH-CLASS: a Bash command is sorted by its strongest tool, in the order test/build,
 * git, grep/find, cat/sed/head, other. The command is read lexically: quoted text is blanked
 * (so `echo "npm test"` is `other` and a commit message cannot name a tool), the rest is split at
 * `&&`, `||`, `;`, `|`, `&`, newlines, `$(`, parentheses and backticks, and the first word of each
 * segment, once leading prefixes (`command`, `env`, `VAR=x`, ...) are skipped, is looked up. So
 * `git log | head` is `git` and `tsc | grep error` is `test/build`: the class names what the
 * command is for, not how its output is trimmed. Lexical sorting can be fooled by unusual shell;
 * the table is a measurement aid, not a parser. The command is cut at 8,192 characters and at 64
 * segments before it is read, and a loop is bounded by that.
 */
export function classifyBash(command: string): BashClass {
  const text = command.slice(0, MAX_BASH_COMMAND_CHARS).replace(QUOTED_RE, '""');
  let best = BASH_CLASSES.length - 1;
  for (const segment of text.split(SEGMENT_SPLIT_RE, MAX_BASH_SEGMENTS)) {
    const found = segmentClass(segment);
    if (found !== null) best = Math.min(best, BASH_CLASSES.indexOf(found));
  }
  return BASH_CLASSES[best] ?? 'other';
}

/** True when a test or build command carries a flag that keeps its output short. */
export function isQuietTestRun(command: string): boolean {
  return QUIET_FLAG_RE.test(command.slice(0, MAX_BASH_COMMAND_CHARS));
}

function ledgerKind(path: string): 'index' | 'bodies' | null {
  const rooted = path.startsWith('/') ? path : `/${path}`;
  if (rooted.endsWith('/.devflow/learning/index.md')) return 'index';
  if (rooted.endsWith('/.devflow/learning/decisions.md') || rooted.endsWith('/.devflow/learning/pitfalls.md')) return 'bodies';
  return null;
}

function resultBytes(content: unknown): number {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (!Array.isArray(content)) return 0;
  let bytes = 0;
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') bytes += Buffer.byteLength(block['text'], 'utf8');
  }
  return bytes;
}

/**
 * D-AUDIT-DECISIONS-SIGNAL: the DECISIONS_CONTEXT block of a spawn prompt, read from the first line
 * that starts with that name to the line before the next prompt field, at most 65,536 characters.
 * Its shape is the first rule that applies:
 *   none     no such line, `(none)`, or a block with neither an index line nor a ledger path;
 *   slice    the header says `(slice: N of M entries`, or the block holds 1-29 index lines;
 *   full     the block holds 30 or more index lines (the full index is about 105);
 *   pointer  no index line, but the block names the ledger (`index.md`, `decisions.md`, `pitfalls.md`).
 * An index line is `ADR-NNN` or `PF-NNN` then two spaces, as the rendered index writes it. The
 * orchestrator writes the prompt, so the forms vary; the rules are the stable part. `bytes` is the
 * UTF-8 size of the block and is 0 for `none`.
 */
function readDecisions(prompt: string): DecisionsSignal {
  const at = prompt.search(DECISIONS_MARKER_RE);
  if (at < 0) return NO_DECISIONS;
  const lines = prompt.slice(at, at + MAX_DECISIONS_BLOCK_CHARS).split('\n');
  const header = lines[0] ?? '';
  if (DECISIONS_NONE_RE.test(header.trim())) return NO_DECISIONS;
  const kept = [header];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (FIELD_LINE_RE.test(line)) break;
    kept.push(line);
  }
  const block = kept.join('\n').trimEnd();
  const indexLines = kept.reduce((n, line) => (INDEX_LINE_RE.test(line) ? n + 1 : n), 0);
  const bytes = Buffer.byteLength(block, 'utf8');
  if (DECISIONS_SLICE_RE.test(header)) return { bytes, indexLines, shape: 'slice' };
  if (indexLines >= FULL_INDEX_MIN_LINES) return { bytes, indexLines, shape: 'full' };
  if (indexLines > 0) return { bytes, indexLines, shape: 'slice' };
  return LEDGER_PATH_RE.test(block) ? { bytes, indexLines, shape: 'pointer' } : NO_DECISIONS;
}

interface SignalCollector {
  /** The first real user prompt of the transcript: OPERATION and DECISIONS_CONTEXT come from it. */
  prompt(text: string): void;
  /** Assistant text: ADR/PF citations. */
  text(value: string): void;
  /** A deduplicated tool_use: Read, Edit, Write and Bash. */
  toolUse(name: unknown, id: string, input: Record<string, unknown>): void;
  /** A user entry's content: Bash results. */
  toolResults(content: unknown): void;
  hasPrompt(): boolean;
  capHits(): { readonly paths: boolean; readonly citationIds: boolean };
  result(): ParsedSignals;
}

/**
 * D-AUDIT-READS: a Read is a re-read when its `file_path` was already read in the same transcript
 * (one transcript is one spawn), and an exact re-read when `offset` and `limit` repeat too; it is
 * ranged when it gave either. A path in another spawn is new. Citations are ADR/PF ids in assistant
 * text blocks (never in prompts, thinking or tool input), counted in total and as a distinct set
 * per transcript. Every set holds at most `maxReadPaths` paths (reads and ranges, writes) or
 * `maxCitationIds` ids; the first one past the cap sets a flag the CLI reports as a CapNotice, and
 * counting goes on without it (a path past the cap can no longer be seen as a repeat). Citation
 * matching is linear in the text, which a line cap already bounds.
 */
function createSignalCollector(caps: { readonly maxReadPaths: number; readonly maxCitationIds: number }): SignalCollector {
  let operation: string | null = null;
  let decisions: DecisionsSignal = NO_DECISIONS;
  let promptSeen = false;
  let readCalls = 0;
  let rereads = 0;
  let exactRereads = 0;
  let ranged = 0;
  let ledgerIndex = 0;
  let ledgerBodies = 0;
  let writeCalls = 0;
  let pathsCapHit = false;
  let citationTotal = 0;
  let citationIdsCapHit = false;
  let quietTestRuns = 0;
  const readPaths = new Set<string>();
  const readRanges = new Set<string>();
  const writtenPaths = new Set<string>();
  const cited = new Set<string>();
  const bashCalls = classRecord();
  const bashBytes = classRecord();
  const pendingBash = new Map<string, BashClass>();

  const track = (set: Set<string>, key: string): void => {
    if (set.has(key)) return;
    if (set.size < caps.maxReadPaths) set.add(key);
    else pathsCapHit = true;
  };
  const pathOf = (input: Record<string, unknown>): string | null => {
    const path = input['file_path'];
    if (typeof path !== 'string' || path === '') return null;
    return path.length > MAX_PATH_CHARS ? path.slice(0, MAX_PATH_CHARS) : path;
  };
  const rangePart = (value: unknown): string => (typeof value === 'number' ? String(value) : '');

  const read = (input: Record<string, unknown>): void => {
    const path = pathOf(input);
    if (path === null) return;
    readCalls += 1;
    if (typeof input['offset'] === 'number' || typeof input['limit'] === 'number') ranged += 1;
    const ledger = ledgerKind(path);
    if (ledger === 'index') ledgerIndex += 1;
    else if (ledger === 'bodies') ledgerBodies += 1;
    const range = `${path}\0${rangePart(input['offset'])}\0${rangePart(input['limit'])}`;
    if (readPaths.has(path)) {
      rereads += 1;
      if (readRanges.has(range)) exactRereads += 1;
    }
    track(readPaths, path);
    track(readRanges, range);
  };

  const write = (input: Record<string, unknown>): void => {
    const path = pathOf(input);
    if (path === null) return;
    writeCalls += 1;
    track(writtenPaths, path);
  };

  const bash = (id: string, input: Record<string, unknown>): void => {
    const command = input['command'];
    if (typeof command !== 'string') return;
    const found = classifyBash(command);
    bashCalls[found] += 1;
    if (found === 'test/build' && isQuietTestRun(command)) quietTestRuns += 1;
    if (id === '') return;
    if (pendingBash.size >= MAX_PENDING_BASH) {
      const oldest = pendingBash.keys().next();
      if (!oldest.done) pendingBash.delete(oldest.value);
    }
    pendingBash.set(id, found);
  };

  return {
    prompt(text) {
      if (promptSeen || text.trim() === '') return;
      promptSeen = true;
      const newline = text.indexOf('\n');
      const firstLine = text.slice(0, newline < 0 ? MAX_FIRST_LINE_CHARS : Math.min(newline, MAX_FIRST_LINE_CHARS));
      operation = OPERATION_RE.exec(firstLine)?.[1] ?? null;
      decisions = readDecisions(text);
    },
    text(value) {
      for (const match of value.matchAll(CITATION_RE)) {
        citationTotal += 1;
        const id = match[0];
        if (cited.has(id)) continue;
        if (cited.size < caps.maxCitationIds) cited.add(id);
        else citationIdsCapHit = true;
      }
    },
    toolUse(name, id, input) {
      if (name === 'Read') read(input);
      else if (name === 'Edit' || name === 'Write') write(input);
      else if (name === 'Bash') bash(id, input);
    },
    toolResults(content) {
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (!isRecord(block) || block['type'] !== 'tool_result') continue;
        const id = block['tool_use_id'];
        const found = typeof id === 'string' ? pendingBash.get(id) : undefined;
        if (typeof id !== 'string' || found === undefined) continue;
        pendingBash.delete(id);
        bashBytes[found] += resultBytes(block['content']);
      }
    },
    hasPrompt: () => promptSeen,
    capHits: () => ({ paths: pathsCapHit, citationIds: citationIdsCapHit }),
    result: () => ({
      operation,
      reads: { calls: readCalls, rereads, exactRereads, ranged },
      ledgerReads: { index: ledgerIndex, bodies: ledgerBodies },
      citations: { total: citationTotal, distinct: cited.size },
      decisionsContext: decisions,
      bashCalls,
      bashResultBytes: bashBytes,
      quietTestRuns,
      filesWritten: { calls: writeCalls, distinct: writtenPaths.size },
    }),
  };
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
 * The `Workflow` tool_use a user entry's tool_result answers: the first `tool_result` block
 * whose `tool_use_id` is a known, not yet answered Workflow launch.
 */
function answeredWorkflowUse(content: unknown, pendingUses: ReadonlyMap<string, number>): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!isRecord(block) || block['type'] !== 'tool_result') continue;
    const id = block['tool_use_id'];
    if (typeof id === 'string' && pendingUses.has(id)) return id;
  }
  return null;
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
 *
 * D-AUDIT-WINDOW: the date window bounds the tool-call signals as it bounds token usage. A
 * transcript is read whole, since a spawn that began before `--since` or runs past `--until` is
 * one file, but each `tool_use`, `tool_result` and assistant text block counts only when its own
 * entry's timestamp is inside `window`, by the test the request filter uses (`inWindow`: `--since`
 * inclusive, `--until` exclusive, an undated entry outside a bounded window). An entry outside
 * the window is not seen at all: its path joins no read or written set, its Bash call waits for
 * no result, so a read of a file that was first read before the window is new inside it, and the
 * answer to a call from before the window adds no bytes. A tool_use id is judged once, at the
 * entry that wrote it first. The spawn prompt is no tool call: `operation` and `decisionsContext`
 * describe the spawn and are kept wherever the prompt falls. `spawns`, `workflowRuns`, `skillCalls`
 * and `commands` are the links between transcripts and are not windowed here; the report windows
 * the skill loads. With no `window` every entry is inside.
 */
export async function parseTranscriptLines(
  lines: AsyncIterable<string> | Iterable<string>,
  limits: ParseLimits,
  window: TimeWindow = OPEN_WINDOW,
): Promise<ParsedStream> {
  const signals = createSignalCollector({
    maxReadPaths: limits.maxReadPaths ?? DEFAULT_LIMITS.maxReadPaths,
    maxCitationIds: limits.maxCitationIds ?? DEFAULT_LIMITS.maxCitationIds,
  });
  const pending = new Map<string, Pending>();
  const spawns: SpawnCall[] = [];
  const workflowRuns: WorkflowRunCall[] = [];
  /** `Workflow` tool_use id -> line, until its tool_result arrives. */
  const pendingWorkflowUses = new Map<string, number>();
  const seenRunIds = new Set<string>();
  const skillCalls: SkillCall[] = [];
  const commands: CommandMention[] = [];
  const seenToolUses = new Set<string>();
  let lastUserMs: number | null = null;
  /** The previous entry ended its turn: the next entry decides whether the agent was resumed. */
  let endTurnPending = false;
  /** A coordinator message resumed the agent: the next new request carries `resumed`. */
  let resumeNext = false;
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

    if (endTurnPending) {
      endTurnPending = false;
      const content = isRecord(message) ? message['content'] : undefined;
      if (entry['type'] === 'attachment' || (entry['type'] === 'user' && typeof content === 'string')) resumeNext = true;
    }

    if (entry['type'] === 'user') {
      if (timestampMs !== null) lastUserMs = timestampMs;
      if (entry['toolUseResult'] === undefined && isRecord(message)) {
        const text = userText(message['content']);
        if (!signals.hasPrompt() && entry['isMeta'] !== true) signals.prompt(text);
        if (text.includes('<command-name>')) {
          const rawArgs = ARGS_RE.exec(text)?.[1];
          const args = rawArgs === undefined ? '' : sanitizeText(rawArgs, MAX_ARGS_CHARS);
          let found = 0;
          for (const match of text.matchAll(COMMAND_RE)) {
            if (found >= MAX_COMMANDS_PER_ENTRY) break;
            found += 1;
            commands.push({ name: sanitizeText(match[1] ?? '', MAX_NAME_CHARS), order, ...(args === '' ? {} : { args }) });
          }
        }
      }
      if (isRecord(message) && inWindow(timestampMs, window)) signals.toolResults(message['content']);
      const result = entry['toolUseResult'];
      if (isRecord(result) && isRecord(message)) {
        const runId = result['runId'];
        if (typeof runId === 'string' && WORKFLOW_RUN_ID_RE.test(runId) && !seenRunIds.has(runId)) {
          const toolUseId = answeredWorkflowUse(message['content'], pendingWorkflowUses);
          const useOrder = toolUseId === null ? undefined : pendingWorkflowUses.get(toolUseId);
          if (toolUseId !== null && useOrder !== undefined) {
            seenRunIds.add(runId);
            pendingWorkflowUses.delete(toolUseId);
            workflowRuns.push({ runId, toolUseId, order: useOrder });
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

    if (message['stop_reason'] === 'end_turn') endTurnPending = true;

    const content = message['content'];
    if (Array.isArray(content)) {
      const messageId = typeof message['id'] === 'string' ? message['id'].slice(0, MAX_NAME_CHARS) : '';
      const counted = inWindow(timestampMs, window);
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block['type'] === 'text') {
          if (counted && typeof block['text'] === 'string') signals.text(block['text']);
          continue;
        }
        if (block['type'] !== 'tool_use') continue;
        const id = typeof block['id'] === 'string' ? block['id'] : '';
        if (id !== '') {
          if (seenToolUses.has(id)) continue;
          seenToolUses.add(id);
        }
        const name = block['name'];
        const input = isRecord(block['input']) ? block['input'] : {};
        if (counted) signals.toolUse(name, id, input);
        if ((name === 'Agent' || name === 'Task') && id !== '') {
          const type = input['subagent_type'];
          spawns.push({
            toolUseId: id,
            order,
            subagentType: typeof type === 'string' ? sanitizeText(type, MAX_MODEL_CHARS) : '',
            ...(messageId === '' ? {} : { messageId }),
          });
        } else if (name === 'Workflow' && id !== '') {
          pendingWorkflowUses.set(id, order);
        } else if (name === 'Skill' && typeof input['skill'] === 'string') {
          const rawArgs = input['args'];
          const args = typeof rawArgs === 'string' ? sanitizeText(rawArgs, MAX_ARGS_CHARS) : '';
          skillCalls.push({
            name: sanitizeText(input['skill'], MAX_NAME_CHARS),
            order,
            timestampMs,
            ...(args === '' ? {} : { args }),
          });
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
        resumed: resumeNext,
      });
      resumeNext = false;
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
      resumed: request.resumed,
    });
    previous = request;
  }

  const capHits = signals.capHits();
  return {
    requests,
    spawns,
    workflowRuns,
    skillCalls,
    commands,
    signals: signals.result(),
    stats: {
      lines: order + 1,
      malformedLines,
      oversizeLines,
      syntheticDropped,
      chunksCollapsed,
      linesCapHit,
      pathsCapHit: capHits.paths,
      citationIdsCapHit: capHits.citationIds,
    },
  };
}

/**
 * Parse one transcript file. The file is opened symlink-refusing and size-bounded
 * (D-AUDIT-UNTRUSTED); every failure comes back as a `ParseError`. `window` bounds the tool-call
 * signals (D-AUDIT-WINDOW).
 */
export async function parseTranscriptFile(
  path: string,
  limits: ParseLimits & Pick<Limits, 'maxFileBytes'>,
  window: TimeWindow = OPEN_WINDOW,
): Promise<Result<ParsedStream, ParseError>> {
  const opened = await openRegularFile(path, limits.maxFileBytes);
  if (!opened.ok) return opened;
  const handle = opened.value;
  const stream = handle.createReadStream({ encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    return { ok: true, value: await parseTranscriptLines(reader, limits, window) };
  } catch (err) {
    return { ok: false, error: { kind: 'io', path, detail: describeError(err) } };
  } finally {
    reader.close();
    stream.destroy();
    await handle.close().catch(() => undefined);
  }
}
