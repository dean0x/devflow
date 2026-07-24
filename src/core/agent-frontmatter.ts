/**
 * Agent frontmatter rewriting utilities.
 *
 * Pure module — zero I/O. All functions take content strings and return
 * new content strings; callers own file reads and writes.
 *
 * applies ADR-013: pure core-layer module, no Claude Code adapter concerns.
 * avoids PF-014: no process.exit(); all fallible paths return Result.
 *
 * Regex scoping guarantee: ALL operations are confined to the FIRST `---…---`
 * block. Model/effort lines in the document body are never touched.
 *
 * EOL safety: CRLF files are detected by checking the first frontmatter
 * delimiter line. The EOL token is threaded through all replacements so the
 * output preserves the file's original line-ending style byte-for-byte.
 */

// ---------------------------------------------------------------------------
// Result type (local; matches codebase per-module pattern)
// ---------------------------------------------------------------------------

export type FrontmatterError = 'no-frontmatter' | 'unterminated-frontmatter';

export type Result<T, E = FrontmatterError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Detect EOL style from the opening `---` line.
 * Returns '\r\n' for CRLF files, '\n' for LF files.
 */
function detectEol(content: string): '\r\n' | '\n' {
  return content.startsWith('---\r\n') ? '\r\n' : '\n';
}

/**
 * Extract the frontmatter block (between the first pair of `---` delimiters).
 *
 * Returns:
 *   { fmBody, openDelim, closeDelim, afterClose }
 * where `fmBody` is the text between the two delimiters (excluding EOLs of
 * the delimiters themselves), and `afterClose` is everything after the
 * closing delimiter line.
 *
 * Frontmatter regex is scoped strictly to the first `---…---` block so a
 * `model:` line in the document body is never matched.
 */
interface FmParts {
  fmBody: string;
  openDelim: string;  // `---` + EOL
  closeDelim: string; // `---` + EOL  (or `---` at EOF)
  afterClose: string;
  eol: '\r\n' | '\n';
}

function parseFrontmatter(content: string): Result<FmParts, FrontmatterError> {
  const eol = detectEol(content);

  // Must begin with `---<EOL>`
  if (!content.startsWith(`---${eol}`)) {
    return Err('no-frontmatter');
  }

  // Regex for the FIRST `---…---` block only.
  // Capture groups: 1=body, 2=line-ending of closing delimiter (may be empty at EOF).
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
  const m = FM_RE.exec(content);
  if (!m) {
    return Err('unterminated-frontmatter');
  }

  const fullMatch = m[0];
  const fmBody = m[1];
  const closeEol = m[2];

  const openDelim = `---${eol}`;
  const closeDelim = `---${closeEol}`;
  const afterClose = content.slice(fullMatch.length);

  return Ok({ fmBody, openDelim, closeDelim, afterClose, eol });
}

// ---------------------------------------------------------------------------
// readFrontmatterModel
// ---------------------------------------------------------------------------

/**
 * Read the `model:` value from the first frontmatter block.
 *
 * Returns Result<string, FrontmatterError> where the string is the trimmed
 * model identifier. Returns an error for missing or unterminated frontmatter.
 * Does NOT error if no `model:` line exists (returns Ok('')).
 *
 * Scoped to the frontmatter block only — a `model:` line in the body is ignored.
 */
export function readFrontmatterModel(content: string): Result<string, FrontmatterError> {
  const parts = parseFrontmatter(content);
  if (!parts.ok) return Err(parts.error);

  const MODEL_RE = /^model:[ \t]*(.*?)[ \t]*$/m;
  const m = MODEL_RE.exec(parts.value.fmBody);
  return Ok(m ? m[1] : '');
}

// ---------------------------------------------------------------------------
// rewriteAgentFrontmatter
// ---------------------------------------------------------------------------

export interface RewriteOptions {
  /** New model identifier to write. */
  model: string;
  /**
   * Effort level to set, or null to remove the effort line.
   * When null and no effort line exists, content is unchanged.
   */
  effort: string | null;
}

export interface RewriteResult {
  /** The (possibly updated) file content. */
  content: string;
  /**
   * True when the output is byte-different from the input.
   * False means the input was already in the desired state.
   */
  changed: boolean;
}

/**
 * Rewrite the `model:` and optionally `effort:` lines in the first
 * frontmatter block of `content`.
 *
 * Rules:
 *  - Only the FIRST `---…---` block is modified; body bytes are untouched.
 *  - EOL style (LF or CRLF) is detected and preserved throughout.
 *  - `effort: null` removes the effort line (collapsing any resulting double
 *    blank line, mirroring the build-mds.ts:114 idiom).
 *  - When effort is a string: insert after model line (if absent) or replace
 *    existing effort line.
 *  - `changed` is a byte-level comparison — cheap idempotency check.
 *
 * Returns Result error for:
 *  - `no-frontmatter`: content does not begin with `---<EOL>`.
 *  - `unterminated-frontmatter`: opening `---` has no closing `---`.
 */
export function rewriteAgentFrontmatter(
  content: string,
  opts: RewriteOptions,
): Result<RewriteResult, FrontmatterError> {
  const partsResult = parseFrontmatter(content);
  if (!partsResult.ok) return Err(partsResult.error);

  const { fmBody, openDelim, closeDelim, afterClose, eol } = partsResult.value;

  // -------------------------------------------------------------------------
  // 1. Update model line
  // -------------------------------------------------------------------------
  const MODEL_RE = /^model:[ \t]*(.*?)[ \t]*$/m;
  const modelMatch = MODEL_RE.exec(fmBody);
  const currentModel = modelMatch ? modelMatch[1] : '';

  let newBody = fmBody;

  if (currentModel !== opts.model) {
    if (modelMatch) {
      // Replace the first model line (only)
      newBody = newBody.replace(MODEL_RE, `model: ${opts.model}`);
    } else {
      // No model line — insert before the first key-value line as a fallback.
      // (All real agent files have a model line, so this path exists for robustness.)
      newBody = `model: ${opts.model}${eol}${newBody}`;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Update effort line
  // -------------------------------------------------------------------------
  const EFFORT_RE = /^effort:[ \t]*(.*?)[ \t]*$/m;
  const effortMatch = EFFORT_RE.exec(newBody);
  const currentEffort = effortMatch ? effortMatch[1] : null;

  if (opts.effort !== null) {
    // Add or replace
    if (effortMatch) {
      if (currentEffort !== opts.effort) {
        newBody = newBody.replace(EFFORT_RE, `effort: ${opts.effort}`);
      }
    } else {
      // Insert immediately after the model line
      const MODEL_RE2 = /^model:[ \t]*.*$/m;
      newBody = newBody.replace(MODEL_RE2, (match) => `${match}${eol}effort: ${opts.effort}`);
    }
  } else {
    // effort: null — remove effort line if present
    if (effortMatch) {
      // Remove the effort line; handle both LF and CRLF.
      newBody = newBody.replace(/^effort:[ \t]*.*(\r?\n|$)/m, '');
      // Collapse any double blank line that may result (mirrors build-mds.ts:114 idiom).
      // Inside a frontmatter body the only "blank" lines would be lines with just \r.
      // We clean up consecutive empty lines (matching `\n\n` sequences in the body).
      newBody = newBody.replace(/\n{2,}/g, '\n');
      if (eol === '\r\n') {
        // For CRLF files: collapse \r\n\r\n (double blank) → \r\n
        newBody = newBody.replace(/(\r\n){2,}/g, '\r\n');
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Reassemble and check for changes
  // -------------------------------------------------------------------------
  const newContent = openDelim + newBody + eol + closeDelim + afterClose;
  const changed = newContent !== content;

  return Ok({ content: newContent, changed });
}
