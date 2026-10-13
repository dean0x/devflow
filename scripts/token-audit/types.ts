/**
 * Shared types and text hygiene for the token-audit dev tool (not shipped).
 *
 * `Result` is the repo's own discriminated union, re-exported rather than redefined.
 *
 * D-AUDIT-UNTRUSTED: transcripts are untrusted input. Every string lifted out of a
 * transcript (agent type, model, skill name, session id) passes `sanitizeText` before it
 * is stored, and `mdCell` before it is printed into a markdown table. Nothing read from
 * a transcript ever becomes part of a filesystem path.
 */

import type { Result } from '../../src/core/evidence-policy.js';

export type { Result };

/** Every cap this tool enforces and the value it ran with. A cap that hits is reported, never silent. */
export interface Limits {
  /** Directory entries visited during discovery (junk entries count). */
  readonly maxEntries: number;
  /** JSONL lines read from one transcript. */
  readonly maxLines: number;
  /** Characters in one JSONL line; a longer line is skipped and counted. */
  readonly maxLineChars: number;
  /** Bytes in one transcript file; a larger file is skipped and counted. */
  readonly maxFileBytes: number;
  /** Distinct skill names tracked in the main-session skill-load table. */
  readonly maxSkillNames: number;
  /** Distinct unpriced model names listed on the unpriced line. */
  readonly maxUnpricedModels: number;
  /**
   * Distinct file paths tracked per transcript for re-read and files-written counting (D-AUDIT-READS).
   * The read-path set and the written-path set each hold this many; a path past it still counts as a
   * call but cannot be recognised as a repeat.
   */
  readonly maxReadPaths: number;
  /** Distinct ADR/PF ids tracked per transcript for the citation count (D-AUDIT-READS). */
  readonly maxCitationIds: number;
}

export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxEntries: 50_000,
  maxLines: 2_000_000,
  maxLineChars: 16_777_216,
  maxFileBytes: 536_870_912,
  maxSkillNames: 500,
  maxUnpricedModels: 20,
  maxReadPaths: 4_096,
  maxCitationIds: 512,
});

export type CapKind = keyof Limits;

/** One cap that was reached. `where` is a short sanitized locator (a file name, a directory). */
export interface CapNotice {
  readonly kind: CapKind;
  readonly limit: number;
  readonly where: string;
}

export interface SkipCounts {
  /** Symlinks met in the transcript tree; never followed. */
  readonly symlinks: number;
  /** Entries named like a transcript that do not match the accepted name shape. */
  readonly badNames: number;
  /** Transcript files that could not be opened or were refused (not a regular file, too large). */
  readonly unreadableFiles: number;
  /** Sidecar meta files that were unreadable or malformed. */
  readonly badMeta: number;
  /** JSONL lines that were not valid JSON objects. */
  readonly malformedLines: number;
  /** JSONL lines longer than the per-line character cap. */
  readonly oversizeLines: number;
}

export const NO_SKIPS: SkipCounts = Object.freeze({
  symlinks: 0,
  badNames: 0,
  unreadableFiles: 0,
  badMeta: 0,
  malformedLines: 0,
  oversizeLines: 0,
});

export function addSkips(a: SkipCounts, b: Partial<SkipCounts>): SkipCounts {
  return {
    symlinks: a.symlinks + (b.symlinks ?? 0),
    badNames: a.badNames + (b.badNames ?? 0),
    unreadableFiles: a.unreadableFiles + (b.unreadableFiles ?? 0),
    badMeta: a.badMeta + (b.badMeta ?? 0),
    malformedLines: a.malformedLines + (b.malformedLines ?? 0),
    oversizeLines: a.oversizeLines + (b.oversizeLines ?? 0),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_LABEL_CHARS = 80;

/** Longest path printed whole (Linux PATH_MAX). A longer one is cut, and the cut shows as "…". */
export const MAX_PATH_CHARS = 4096;

/**
 * D-AUDIT-UNTRUSTED: a workflow run id, which is also the name of its `workflows/wf_*` directory.
 * The one shape both discovery (the directory name) and the parser (`toolUseResult.runId`)
 * accept, so the two can only ever join on a value that passed this pattern.
 */
export const WORKFLOW_RUN_ID_RE = /^wf_[A-Za-z0-9_-]{1,128}$/;

/**
 * Make a transcript-derived string safe to store and print: control characters, format
 * characters (zero-width, bidi, BOM) and line/paragraph separators become spaces, runs of
 * whitespace collapse, and the length is capped.
 */
export function sanitizeText(input: string, maxChars: number = MAX_LABEL_CHARS): string {
  const cleaned = input.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned;
}

/** Sanitize, then escape for one markdown table cell: backslash, pipe and angle brackets. */
export function mdCell(input: string, maxChars: number = MAX_LABEL_CHARS): string {
  return sanitizeText(input, maxChars)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Why a run produced no report. `exit` is the process exit code the CLI maps it to. */
export type AuditError =
  | { readonly kind: 'usage'; readonly message: string }
  | { readonly kind: 'not-found'; readonly message: string }
  | { readonly kind: 'no-sessions'; readonly message: string }
  | { readonly kind: 'no-data'; readonly message: string }
  | { readonly kind: 'io'; readonly message: string };

export function exitCodeFor(error: AuditError): 1 | 2 {
  switch (error.kind) {
    case 'usage':
    case 'io':
      return 1;
    case 'not-found':
    case 'no-sessions':
    case 'no-data':
      return 2;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
