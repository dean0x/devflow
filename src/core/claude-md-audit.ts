/**
 * The CLI's view of the CLAUDE.md import audit — a typed seam onto the package's
 * own `claude-md-audit.cjs`, never a second implementation of it.
 *
 * D-CLAUDE-MD-IMPORT-AUDIT: the logic (import grammar, bounds, thresholds, display
 * text, stamp format) lives once, in src/assets/scripts/claude-md-audit.cjs, because
 * the SessionStart hook reaches only `~/.devflow/scripts/`, which `composeScripts`
 * fills by copying `src/assets/scripts/` verbatim. This module is the typed facade
 * `devflow init` calls, loaded with the evidence-policy seam's `loadScript` against
 * an explicit surface map (D-POLICY-CJS-SEAM). The interfaces below are TRANSCRIBED
 * from the script's JSDoc and are this side's only shape authority; the module is
 * required from `scriptsDir()` (the package's own copy), never from the installed
 * `~/.devflow/scripts`, which may be older than this CLI.
 *
 * Nothing here throws: a load failure, a script that throws and a stamp that cannot
 * be written are `Result` errors, and init prints at most one degraded line for them
 * and keeps its exit code.
 *
 * D-AUDIT-STAMP (the caller's half): the audit writes nothing; this module writes the
 * stamp after the install, only under an existing machine root (a command never
 * creates `~/.devflow` for it), only through a sibling temp file renamed into place
 * ({@link writeFileAtomicExclusive}), and never through a link. Because
 * `writeFileAtomicExclusive` does not refuse a symlink at the target, the write does
 * its own `lstat` regular-file check first (AC-437): a stamp path that is a symbolic
 * link or any other non-regular file is refused and nothing is written.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { scriptsDir } from './assets.js';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import {
  loadScript,
  type EvidencePolicyLoadError,
  type Result,
  type SurfaceKind,
} from './evidence-policy.js';

/** The script, relative to src/assets/scripts/ (and ~/.devflow/scripts/). */
export const CLAUDE_MD_AUDIT_SCRIPT_NAME = 'claude-md-audit.cjs';

/** The stamp's basename under the machine root (`~/.devflow`). */
export const CLAUDE_MD_AUDIT_STAMP_FILE = '.claude-md-audit';

/**
 * The prefix of the stamp's sibling temp file, `<stamp>.tmp.<pid>`: the one name
 * the hook and {@link writeFileAtomicExclusive} both create, so a crash between the
 * write and the rename leaves a name uninstall can sweep.
 */
export const CLAUDE_MD_AUDIT_STAMP_TMP_PREFIX = `${CLAUDE_MD_AUDIT_STAMP_FILE}.tmp.`;

// ── Transcribed shapes (claude-md-audit.cjs JSDoc) ─────────────────────────────

/** A finding: an import over the file threshold, or a root whose chain totals over the chain threshold. */
export type ClaudeMdAuditFinding =
  | { readonly kind: 'file'; readonly path: string; readonly size: number; readonly mtime: number; readonly hop: number }
  | {
      readonly kind: 'chain';
      readonly path: string;
      readonly total: number;
      readonly mtime: number;
      readonly largest: { readonly path: string; readonly size: number };
      readonly truncated: boolean;
    };

/** One examined path: `flag` 0 absent, 1 regular file, 2 exists but is not a regular file. */
export interface ClaudeMdAuditPath {
  readonly path: string;
  readonly flag: 0 | 1 | 2;
}

/** `audit()`'s answer. `lines` are the display lines of the findings not yet displayed; `stamp` is the new stamp text. */
export interface ClaudeMdAuditResult {
  readonly ok: true;
  readonly roots: ReadonlyArray<{
    readonly path: string;
    readonly exists: boolean;
    readonly size: number;
    readonly total: number;
    readonly largest: { readonly path: string; readonly size: number } | null;
    readonly truncated: boolean;
  }>;
  readonly findings: readonly ClaudeMdAuditFinding[];
  readonly examined: readonly ClaudeMdAuditPath[];
  readonly filesExamined: number;
  readonly pathsExamined: number;
  readonly bytesRead: number;
  readonly truncated: boolean;
  readonly lines: readonly string[];
  readonly shown: readonly string[];
  readonly stamp: string;
}

/** `parseStamp()`'s answer. */
export interface ClaudeMdAuditStamp {
  readonly valid: boolean;
  readonly roots: readonly string[];
  readonly examined: readonly ClaudeMdAuditPath[];
  readonly keys: readonly string[];
  readonly error: boolean;
}

/** The part of the script's `module.exports` the CLI relies on. */
export interface ClaudeMdAuditModule {
  readonly FILE_THRESHOLD_BYTES: number;
  readonly CHAIN_THRESHOLD_BYTES: number;
  readonly MAX_HOPS: number;
  readonly MAX_PATHS_PER_ROOT: number;
  readonly SCAN_BYTES: number;
  readonly MAX_BYTES_READ: number;
  readonly MAX_STAMP_BYTES: number;
  readonly MAX_KEYS: number;
  readonly SKIP_FILE_BYTES: number;
  readonly NOT_SHOWN: string;
  readonly HOOK_MAGIC: string;
  readonly HOOK_END: string;
  extractImports(text: string): string[];
  isDisplayable(p: string): boolean;
  isRecordable(text: string): boolean;
  formatFinding(finding: ClaudeMdAuditFinding): string;
  findingKey(finding: ClaudeMdAuditFinding): string;
  parseStamp(text: unknown): ClaudeMdAuditStamp;
  renderStamp(stamp: {
    readonly roots: readonly string[];
    readonly examined: readonly ClaudeMdAuditPath[];
    readonly keys: readonly string[];
    readonly error?: boolean;
  }): string;
  readStampFile(stampPath: string): string | null;
  audit(input: { readonly roots: readonly string[]; readonly home: string; readonly keys?: readonly string[] }): ClaudeMdAuditResult;
  main(argv: readonly string[], stdout: { write(chunk: string): unknown }): number;
}

/** Every key of ClaudeMdAuditModule and the runtime kind the loader requires of it. */
export const CLAUDE_MD_AUDIT_MODULE_SURFACE = Object.freeze({
  FILE_THRESHOLD_BYTES: 'number',
  CHAIN_THRESHOLD_BYTES: 'number',
  MAX_HOPS: 'number',
  MAX_PATHS_PER_ROOT: 'number',
  SCAN_BYTES: 'number',
  MAX_BYTES_READ: 'number',
  MAX_STAMP_BYTES: 'number',
  MAX_KEYS: 'number',
  SKIP_FILE_BYTES: 'number',
  NOT_SHOWN: 'string',
  HOOK_MAGIC: 'string',
  HOOK_END: 'string',
  extractImports: 'function',
  isDisplayable: 'function',
  isRecordable: 'function',
  formatFinding: 'function',
  findingKey: 'function',
  parseStamp: 'function',
  renderStamp: 'function',
  readStampFile: 'function',
  audit: 'function',
  main: 'function',
} as const satisfies Record<keyof ClaudeMdAuditModule, SurfaceKind>);

export type ClaudeMdAuditLoad = Result<ClaudeMdAuditModule, EvidencePolicyLoadError>;

/**
 * Load the audit script from `dir` (default: the package's own scripts directory)
 * and shape-check its surface. Never throws.
 */
export function loadClaudeMdAuditModule(dir: string = scriptsDir()): ClaudeMdAuditLoad {
  return loadScript<ClaudeMdAuditModule>(join(dir, CLAUDE_MD_AUDIT_SCRIPT_NAME), CLAUDE_MD_AUDIT_MODULE_SURFACE);
}

// ── Roots ──────────────────────────────────────────────────────────────────────

/**
 * The gated root set, in the order the hook passes it: `CLAUDE.md` in the Claude
 * config directory, then (only for a git project that is not HOME — the caller
 * passes `null` otherwise) the project's `CLAUDE.md`, `.claude/CLAUDE.md` and
 * `CLAUDE.local.md` at its toplevel. Ancestor directories, lazily loaded
 * subdirectory files and `rules/*.md` are not roots.
 */
export function claudeMdAuditRoots(claudeDir: string, projectRoot: string | null): string[] {
  const roots = [join(claudeDir, 'CLAUDE.md')];
  if (projectRoot !== null) {
    roots.push(
      join(projectRoot, 'CLAUDE.md'),
      join(projectRoot, '.claude', 'CLAUDE.md'),
      join(projectRoot, 'CLAUDE.local.md'),
    );
  }
  return roots;
}

// ── Running the audit ──────────────────────────────────────────────────────────

/** Why the audit could not run. */
export type ClaudeMdAuditError =
  | { readonly kind: 'load'; readonly detail: EvidencePolicyLoadError }
  | { readonly kind: 'failed'; readonly detail: string };

export interface RunClaudeMdAuditOptions {
  readonly claudeDir: string;
  /** The git toplevel when the run is inside a project that is not HOME; null otherwise. */
  readonly projectRoot: string | null;
  readonly home: string;
  /** The machine root (`~/.devflow`) whose stamp supplies the already-displayed keys. */
  readonly devflowDir: string;
  /** The directory holding the script; defaults to the package's own. Injectable for tests. */
  readonly scriptsDir?: string;
}

/** The stamp's text when it is a regular file of at most MAX_STAMP_BYTES, else null (read as absent). */
export async function readClaudeMdAuditStamp(devflowDir: string, maxBytes: number): Promise<string | null> {
  const stampPath = join(devflowDir, CLAUDE_MD_AUDIT_STAMP_FILE);
  try {
    const st = await fs.lstat(stampPath);
    if (!st.isFile() || st.size > maxBytes) return null;
    return await fs.readFile(stampPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Run the audit over the gated roots. Reads only; the stamp is written by
 * {@link writeClaudeMdAuditStamp}. Never throws.
 */
export async function runClaudeMdAudit(opts: RunClaudeMdAuditOptions): Promise<Result<ClaudeMdAuditResult, ClaudeMdAuditError>> {
  const loaded = loadClaudeMdAuditModule(opts.scriptsDir);
  if (!loaded.ok) return { ok: false, error: { kind: 'load', detail: loaded.error } };
  const audit = loaded.value;
  try {
    const stampText = await readClaudeMdAuditStamp(opts.devflowDir, audit.MAX_STAMP_BYTES);
    const keys = stampText === null ? [] : audit.parseStamp(stampText).keys;
    const result = audit.audit({ roots: claudeMdAuditRoots(opts.claudeDir, opts.projectRoot), home: opts.home, keys });
    return { ok: true, value: result };
  } catch (err: unknown) {
    return { ok: false, error: { kind: 'failed', detail: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * The display lines of an audit result, as ONE note body, or null when nothing is
 * flagged. The single formatter both init paths (Recommended and Advanced) use; the
 * lines themselves are produced by the script's own formatter, the one the hook
 * shows in its systemMessage.
 */
export function formatClaudeMdAuditNote(result: ClaudeMdAuditResult): string | null {
  return result.lines.length === 0 ? null : result.lines.join('\n');
}

/** The one degraded line printed when the audit could not run. */
export function formatClaudeMdAuditUnavailable(error: ClaudeMdAuditError): string {
  if (error.kind === 'load') {
    return error.detail.kind === 'not-found'
      ? 'CLAUDE.md import audit unavailable: audit script not found — reinstall devflow-kit'
      : 'CLAUDE.md import audit unavailable: audit script failed to load — reinstall devflow-kit';
  }
  return 'CLAUDE.md import audit unavailable: the audit failed';
}

// ── Writing the stamp ──────────────────────────────────────────────────────────

/** Why the stamp was not written. */
export type ClaudeMdAuditStampError =
  /** `~/.devflow` does not exist: a command never creates the machine root for the stamp. */
  | { readonly kind: 'no-machine-root' }
  /** The stamp path is a symbolic link or another non-regular file. */
  | { readonly kind: 'refused'; readonly detail: string }
  | { readonly kind: 'write-failed'; readonly detail: string };

/**
 * Write the stamp text to `<devflowDir>/.claude-md-audit` (AC-437, D-AUDIT-STAMP).
 *
 * Refuses, writing nothing: a machine root that does not exist; a stamp path that is
 * a symbolic link, a directory, a FIFO or any other non-regular file (an `lstat`
 * check made here, because the atomic writer renames over the target without
 * looking at what it is). Otherwise the text lands in a sibling temp file renamed
 * into place. Never throws.
 */
export async function writeClaudeMdAuditStamp(devflowDir: string, text: string): Promise<Result<void, ClaudeMdAuditStampError>> {
  try {
    const root = await fs.stat(devflowDir).catch(() => null);
    if (root === null || !root.isDirectory()) return { ok: false, error: { kind: 'no-machine-root' } };

    const stampPath = join(devflowDir, CLAUDE_MD_AUDIT_STAMP_FILE);
    const existing = await fs.lstat(stampPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    if (existing !== null && !existing.isFile()) {
      return { ok: false, error: { kind: 'refused', detail: existing.isSymbolicLink() ? 'the stamp path is a symbolic link' : 'the stamp path is not a regular file' } };
    }
    await writeFileAtomicExclusive(stampPath, text);
    return { ok: true, value: undefined };
  } catch (err: unknown) {
    return { ok: false, error: { kind: 'write-failed', detail: err instanceof Error ? err.message : String(err) } };
  }
}
