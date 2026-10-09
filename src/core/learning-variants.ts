/**
 * Learning-variant splitter: one compiled prompt body in, its learning-on and
 * learning-off variants out.
 *
 * Pure module, zero I/O. Every refusal is a Result; the exiting shell is
 * scripts/build-mds.ts, which renders these errors into the build's single exit.
 *
 * D-LEARNING-VARIANTS: when learning is off on a machine, the decisions text is
 * ABSENT from every prompt it would have reached, not merely gated at run time.
 * The build therefore emits two variants of a prompt that carries learning text:
 * the learning-on variant at today's path (dist/commands/x.md, dist/agents/x.md)
 * and the learning-off variant at dist/learning-off/{commands,agents}/x.md, only
 * for a host that has an arm. A prompt with no arm has one variant and no
 * learning-off file.
 *
 * The arms are whole-line markers in the host or in a partial it expands:
 *
 *   <!-- learning:on -->     opens an arm that only the learning-on variant keeps
 *   <!-- learning:off -->    opens an arm that only the learning-off variant keeps;
 *                            directly after an on arm it is that arm's else
 *   <!-- learning:end -->    closes the arm
 *
 * A marker line matches LEARNING_MARKER_RE. It may be indented and may sit inside
 * a fenced block, a list, a define body or an agent's second frontmatter block,
 * because MDS passes an HTML comment through untouched. The splitter runs on the
 * COMPILED body, after the MDS compile, so it adds no compileFile call, no import
 * into an MDS module and nothing against the per-module compile-time guard. A
 * marker line is removed whole, with its newline. Every other line is kept byte
 * for byte, so a blank line is content: put the blank line a paragraph needs
 * inside the arm that owns the paragraph, and the other variant gets none of it.
 *
 * The markers are INTERIM. MDS 0.4.4 emits an `@if` inside a code fence or on an
 * indented line as literal text (its lexer requires column 0), and the arms have
 * to sit exactly there: inside fenced spawn blocks, scripts, list items and
 * frontmatter. They are replaced by native conditionals once mdscript ships
 * fence- and indent-aware `@if` (dean0x/mdscript#452). That swap, with the
 * @mdscript/mds upgrade it rides on proven byte-identical in dist/ and this module
 * deleted, is dean0x/devflow#439. The mapping is one to one: `on` becomes
 * `@if learning:`, `off` becomes `@else:` and `end` becomes `@end`. A standalone
 * `off` arm, with no on arm before it, becomes an `@if learning:` with an empty
 * body followed by `@else:`.
 *
 * What the splitter refuses, each as a LearningSplitError with the source line:
 *   - nesting: an `on` marker while an arm is open, or a second `off` in one arm;
 *   - an `end` with no open arm;
 *   - an arm still open at the end of the body;
 *   - an empty arm (no line with content between its marker and the next);
 *   - a stray marker: a line that names `<!-- learning:` but is not a whole-line
 *     marker, which would otherwise ship as prompt text.
 *
 * Scope guarantee: this module answers one question (what are the two variants of
 * this body?) and one cheap one for the build to ask of a body that must carry no
 * arms (containsLearningMarker). It decides nothing about WHICH text belongs in an
 * arm: that is authoring, and the guards over the built trees hold it.
 */

// ---------------------------------------------------------------------------
// Result type (local; matches codebase per-module pattern)
// ---------------------------------------------------------------------------

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Where the learning-off variant lands
// ---------------------------------------------------------------------------

/** The host kinds that can carry a learning arm: the ones whose output is a prompt, not a reference. */
export type LearningVariantKind = 'commands' | 'agents';

/**
 * Repo-relative root of the learning-off variants.
 *
 * Exported because the build's orphan prune names this directory even when no
 * host carries an arm, which is exactly the case where every file in it is an
 * orphan, so it cannot be derived from the plan.
 */
export const LEARNING_OFF_OUTPUT_DIR = 'dist/learning-off';

/**
 * POSIX repo-relative path of the learning-off variant of an output file.
 *
 * `fileName` is the already-validated basename the learning-on variant is written
 * under (`implement.md`), so the two variants of one host always share a name.
 */
export function learningOffRelPath(kind: LearningVariantKind, fileName: string): string {
  return `${LEARNING_OFF_OUTPUT_DIR}/${kind}/${fileName}`;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/**
 * A whole-line learning marker. The group captures `on`, `off` or `end`.
 *
 * Anchored at both ends with no nested quantifier, so a match is linear in the
 * line length. Leading and trailing space or tab is allowed; anything else on the
 * line is not a marker.
 */
export const LEARNING_MARKER_RE = /^[ \t]*<!-- learning:(on|off|end) -->[ \t]*$/;

/**
 * The fragment that makes a line a marker ATTEMPT: loose on spacing and case so a
 * malformed marker is caught rather than shipped. Every valid marker contains it.
 */
const MARKER_FRAGMENT_RE = /<!--\s*learning\s*:/i;

/** True when the text names a learning marker anywhere, valid or not. */
export function containsLearningMarker(text: string): boolean {
  return MARKER_FRAGMENT_RE.test(text);
}

type MarkerWord = 'on' | 'off' | 'end';

function markerOf(line: string): MarkerWord | null {
  // A CRLF body carries the carriage return on the line; it is not part of the marker.
  const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
  const match = LEARNING_MARKER_RE.exec(bare);
  return match === null ? null : (match[1] as MarkerWord);
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

export type LearningArm = 'on' | 'off';

export interface LearningSplit {
  /** The body with every `on` arm kept and every `off` arm dropped. */
  readonly on: string;
  /** The body with every `off` arm kept and every `on` arm dropped. */
  readonly off: string;
  /** True when the body carried at least one marker. When false, `on` and `off` are the body. */
  readonly hasArms: boolean;
}

/** Why a body cannot be split. Every line number is 1-based, in the body that was passed. */
export type LearningSplitError =
  | { kind: 'nested-arm'; line: number; arm: LearningArm; openedAt: number }
  | { kind: 'repeated-off'; line: number; openedAt: number }
  | { kind: 'unopened-end'; line: number }
  | { kind: 'unclosed-arm'; arm: LearningArm; openedAt: number }
  | { kind: 'empty-arm'; arm: LearningArm; openedAt: number; closedAt: number }
  | { kind: 'stray-marker'; line: number; text: string };

/** The longest stretch of a stray line a refusal quotes. */
const STRAY_QUOTE_MAX = 80;

/**
 * Split a compiled body into its learning-on and learning-off variants.
 *
 * Total and pure: the same input gives the same output, and a refusal is a
 * Result. The loop is one pass over the body's lines, so its bound is the body's
 * own length.
 *
 * An arm needs a line with content in it. An arm that holds only blank lines is
 * refused as empty, because it would add blank lines to one variant and nothing to
 * the other, which is a mistake rather than a design.
 */
export function splitLearningVariants(body: string): Result<LearningSplit, LearningSplitError> {
  const lines = body.split('\n');
  const on: string[] = [];
  const off: string[] = [];
  let hasArms = false;

  // The open arm, if any: which one, the line of the marker that opened it, and
  // whether it has held a line with content yet.
  let arm: LearningArm | null = null;
  let armOpenedAt = 0;
  let armHasContent = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNo = index + 1;
    const marker = markerOf(line);

    if (marker === null) {
      if (MARKER_FRAGMENT_RE.test(line)) {
        return Err({ kind: 'stray-marker', line: lineNo, text: line.trim().slice(0, STRAY_QUOTE_MAX) });
      }
      if (arm !== 'off') on.push(line);
      if (arm !== 'on') off.push(line);
      if (arm !== null && line.trim() !== '') armHasContent = true;
      continue;
    }

    hasArms = true;
    switch (marker) {
      case 'on':
        if (arm !== null) return Err({ kind: 'nested-arm', line: lineNo, arm, openedAt: armOpenedAt });
        arm = 'on';
        armOpenedAt = lineNo;
        armHasContent = false;
        break;
      case 'off':
        if (arm === 'off') return Err({ kind: 'repeated-off', line: lineNo, openedAt: armOpenedAt });
        // Directly after an on arm this is its else: the on arm ends here.
        if (arm === 'on' && !armHasContent) {
          return Err({ kind: 'empty-arm', arm, openedAt: armOpenedAt, closedAt: lineNo });
        }
        arm = 'off';
        armOpenedAt = lineNo;
        armHasContent = false;
        break;
      case 'end':
        if (arm === null) return Err({ kind: 'unopened-end', line: lineNo });
        if (!armHasContent) {
          return Err({ kind: 'empty-arm', arm, openedAt: armOpenedAt, closedAt: lineNo });
        }
        arm = null;
        break;
      default: {
        const unhandled: never = marker;
        return Err({ kind: 'stray-marker', line: lineNo, text: String(unhandled) });
      }
    }
  }

  if (arm !== null) return Err({ kind: 'unclosed-arm', arm, openedAt: armOpenedAt });
  return Ok({ on: on.join('\n'), off: off.join('\n'), hasArms });
}

/**
 * Render a refusal as one line a person can act on.
 *
 * One arm per kind with a `never` default, so a kind added to the union cannot
 * fall through into a message that does not describe it. Shared by the build and
 * the tests, so the text asserted is the text shipped.
 */
export function describeLearningSplitError(error: LearningSplitError): string {
  switch (error.kind) {
    case 'nested-arm':
      return (
        `line ${error.line}: a learning:on marker inside the ${error.arm} arm opened at line ` +
        `${error.openedAt} — arms do not nest; close it with learning:end first`
      );
    case 'repeated-off':
      return (
        `line ${error.line}: a second learning:off marker inside the off arm opened at line ` +
        `${error.openedAt} — an arm has at most one else`
      );
    case 'unopened-end':
      return `line ${error.line}: a learning:end marker with no open arm`;
    case 'unclosed-arm':
      return `the ${error.arm} arm opened at line ${error.openedAt} is never closed with learning:end`;
    case 'empty-arm':
      return (
        `lines ${error.openedAt}-${error.closedAt}: the ${error.arm} arm holds no line with content — ` +
        `delete the arm or put its text inside it`
      );
    case 'stray-marker':
      return (
        `line ${error.line}: "${error.text}" names a learning marker but is not one — a marker ` +
        `is a whole line, exactly <!-- learning:on -->, <!-- learning:off --> or <!-- learning:end -->`
      );
    default: {
      const unhandled: never = error;
      return `unhandled learning split error ${JSON.stringify(unhandled)}`;
    }
  }
}
