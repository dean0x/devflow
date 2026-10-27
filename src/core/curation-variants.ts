/**
 * Variant splitter: one compiled prompt body in, its variants out, on two marker
 * axes: curation and compliance.
 *
 * Pure module, zero I/O. Every refusal is a Result; the exiting shells are
 * scripts/build-mds.ts, which renders the split errors into the build's single exit,
 * and the installer, which refuses an install on a manifest error.
 *
 * D-LEARNING-VARIANTS: when curation is off on a machine, the decisions text is
 * ABSENT from every prompt it would have reached, not merely gated at run time.
 * The build therefore emits two variants of a prompt that carries curation text:
 * the curation-on variant at today's path (dist/commands/x.md, dist/agents/x.md)
 * and the curation-off variant at dist/curation-off/{commands,agents}/x.md, only
 * for a host that has an arm. A prompt with no arm has one variant and no
 * curation-off file. The compliance axis works the same way: a body is split on
 * both axes into four variants, keyed `on`, `curation-off`, `compliance-off` and
 * `both-off`, and the build writes a variant only for a host that has an arm on
 * each axis that variant turns off. The off variants go to dist/curation-off/,
 * dist/compliance-off/ and dist/curation-compliance-off/, and the manifest
 * dist/variant-axes.json records which axes each host carries an arm on. The install
 * order of the trees per machine is owned by src/core/assets.ts, and the install refusal
 * for a compliance-off machine by src/targets/claude-code/installer.ts.
 *
 * The arms are whole-line markers in the host or in a partial it expands. Each
 * axis has the same three:
 *
 *   <!-- curation:on -->     opens an arm that only the curation-on variants keep
 *   <!-- curation:off -->    opens an arm that only the curation-off variants keep;
 *                            directly after an on arm it is that arm's else
 *   <!-- curation:end -->    closes the arm
 *
 * and `<!-- compliance:on -->`, `<!-- compliance:off -->` and
 * `<!-- compliance:end -->` do the same for the compliance variants.
 *
 * A marker line matches VARIANT_MARKER_RE. It may be indented and may sit inside
 * a fenced block, a list, a define body or an agent's second frontmatter block,
 * because MDS passes an HTML comment through untouched. The splitter runs on the
 * COMPILED body, after the MDS compile, so it adds no compileFile call, no import
 * into an MDS module and nothing against the per-module compile-time guard. A
 * marker line is removed whole, with its newline. Every other line is kept byte
 * for byte, so a blank line is content: put the blank line a paragraph needs
 * inside the arm that owns the paragraph, and the other variant gets none of it.
 * A line goes into a variant only when every arm open at that line matches the
 * variant, so a body with no compliance marker splits on the curation axis to the
 * same bytes it always did, and the compliance state of the variant changes nothing.
 *
 * One axis may nest fully inside an arm of the other. Two arms of one axis never
 * nest, and arms of two axes never overlap: at most one arm per axis is open, and
 * the arm opened last is the one that closes first.
 *
 * The markers are INTERIM. MDS 0.4.4 emits an `@if` inside a code fence or on an
 * indented line as literal text (its lexer requires column 0), and the arms have
 * to sit exactly there: inside fenced spawn blocks, scripts, list items and
 * frontmatter. They are replaced by native conditionals once mdscript ships
 * fence- and indent-aware `@if` (dean0x/mdscript#452). That swap, with the
 * @mdscript/mds upgrade it rides on proven byte-identical in dist/ and this module
 * deleted, is dean0x/devflow#439; the compliance axis rides the same swap
 * (dean0x/devflow#648). The mapping is one to one, per axis: `<!-- curation:on -->`
 * becomes `@if curation:` and `<!-- compliance:on -->` becomes `@if compliance:`,
 * `off` becomes `@else:` and `end` becomes `@end`. A standalone `off` arm, with no
 * on arm before it, becomes an `@if <axis>:` with an empty body followed by
 * `@else:`. One axis nested inside the other becomes one `@if` inside the other,
 * and an interleaving, which no `@if` nesting expresses, is a refusal here.
 *
 * What the splitter refuses, each as a VariantSplitError with the source line:
 *   - nesting: an `on` marker while an arm of its axis is open, or a second `off`
 *     in one arm;
 *   - an interleaving: an `off` or `end` marker for an arm while an arm of the other
 *     axis, opened after it, is still open;
 *   - an `end` with no open arm of its axis;
 *   - an arm still open at the end of the body;
 *   - an empty arm (no line with content between its marker and the next);
 *   - a retired marker: a line that names the pre-rename spelling of the marker, in
 *     any spacing or case, which would otherwise ship as prompt text;
 *   - a stray marker: a line that names `<!-- curation:` or `<!-- compliance:` but
 *     is not a whole-line marker, which would otherwise ship as prompt text.
 *
 * The retired spelling is never accepted as an alias: the build fails on it, so a
 * host that still carries it cannot ship a prompt with both variants silently equal.
 *
 * Scope guarantee: this module answers one question (what are the variants of this
 * body, and where do they land?) and a cheap one per axis for the build to ask of a
 * body that must carry no arms (containsCurationMarker, containsComplianceMarker). It
 * also renders the variant manifest the build writes beside the trees
 * (renderVariantManifest) and parses it for the installer (parseVariantManifest), so the
 * build and the installer share one layout. It decides
 * nothing about WHICH text belongs in an arm: that is authoring, and the guards over
 * the built trees hold it.
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
// Where the off variants land
// ---------------------------------------------------------------------------

/** The host kinds that can carry a curation or compliance arm: the ones whose output is a prompt, not a reference. */
export type VariantKind = 'commands' | 'agents';

/**
 * Repo-relative root of the curation-off variants.
 *
 * Exported because the build's orphan prune names this directory even when no
 * host carries an arm, which is exactly the case where every file in it is an
 * orphan, so it cannot be derived from the plan.
 */
export const CURATION_OFF_OUTPUT_DIR = 'dist/curation-off';

/**
 * Repo-relative root of the compliance-off variants: curation on, compliance off.
 *
 * Exported for the same reason as CURATION_OFF_OUTPUT_DIR: the orphan prune names it
 * even when no host carries a compliance arm.
 */
export const COMPLIANCE_OFF_OUTPUT_DIR = 'dist/compliance-off';

/**
 * Repo-relative root of the both-off variants: curation off and compliance off.
 *
 * A sibling of the two single-axis trees, never inside one, so the prune of one
 * tree cannot reach the files of another.
 */
export const BOTH_OFF_OUTPUT_DIR = 'dist/curation-compliance-off';

/**
 * Repo-relative root of the retired off tree, from before the rename.
 *
 * The build removes this folder whole after a clean run, so a checkout that built
 * before the rename keeps no stale prompts there: nothing reads the folder, and the
 * package would otherwise ship it.
 */
export const LEGACY_OFF_OUTPUT_DIR = 'dist/learning-off';

/** A variant that turns an axis off: every variant key but `on`. */
export type OffVariantKey = Exclude<VariantKey, 'on'>;

/**
 * The tree each off variant is written under. Total over OffVariantKey, so a new key cannot go without a tree.
 *
 * Exported so the build derives its orphan prune from this map: every off key has its tree swept.
 */
export const OFF_OUTPUT_DIRS: Readonly<Record<OffVariantKey, string>> = {
  'curation-off': CURATION_OFF_OUTPUT_DIR,
  'compliance-off': COMPLIANCE_OFF_OUTPUT_DIR,
  'both-off': BOTH_OFF_OUTPUT_DIR,
};

/**
 * POSIX repo-relative path of an off variant of an output file: the kind's folder
 * under the tree of the variant key.
 *
 * `fileName` is the already-validated basename the `on` variant is written under,
 * so every variant of one host shares a name.
 */
export function variantOffRelPath(key: OffVariantKey, kind: VariantKind, fileName: string): string {
  return `${OFF_OUTPUT_DIRS[key]}/${kind}/${fileName}`;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** The two marker axes. Curation is listed first: it is the older axis and the first one a stray line is tested against. */
export const VARIANT_AXES = ['curation', 'compliance'] as const;

export type VariantAxis = (typeof VARIANT_AXES)[number];

/** A machine's settled switch on each axis. A named record, so the two flags cannot be swapped at a call site. */
export type VariantSwitches = Readonly<Record<VariantAxis, boolean>>;

/** Every switch on: the machine whose prompts come from the normal compiled files. */
export const ALL_SWITCHES_ON: VariantSwitches = Object.freeze({ curation: true, compliance: true });

/**
 * A whole-line marker of either axis. Group 1 captures the axis; group 2 captures
 * `on`, `off` or `end`.
 *
 * Anchored at both ends with no nested quantifier, so a match is linear in the
 * line length. Leading and trailing space or tab is allowed; anything else on the
 * line is not a marker.
 */
export const VARIANT_MARKER_RE = /^[ \t]*<!-- (curation|compliance):(on|off|end) -->[ \t]*$/;

/**
 * The fragment that makes a line a marker ATTEMPT on one axis: loose on spacing and
 * case so a malformed marker is caught rather than shipped. Every valid marker of
 * the axis contains it. None is global, so `test` keeps no state between lines.
 */
const MARKER_FRAGMENT_RES: Readonly<Record<VariantAxis, RegExp>> = {
  curation: /<!--\s*curation\s*:/i,
  compliance: /<!--\s*compliance\s*:/i,
};

/**
 * The same attempt test for the retired spelling of the marker. No spelling of it is
 * valid, so a line that matches is always refused.
 */
const LEGACY_MARKER_FRAGMENT_RE = /<!--\s*learning\s*:/i;

/** True when the text names a curation marker anywhere, in the current or the retired spelling, valid or not. */
export function containsCurationMarker(text: string): boolean {
  return MARKER_FRAGMENT_RES.curation.test(text) || LEGACY_MARKER_FRAGMENT_RE.test(text);
}

/** True when the text names a compliance marker anywhere, valid or not. */
export function containsComplianceMarker(text: string): boolean {
  return MARKER_FRAGMENT_RES.compliance.test(text);
}

/** True when the text names a marker of either axis, or the retired spelling, valid or not. */
export function containsVariantMarker(text: string): boolean {
  return containsCurationMarker(text) || containsComplianceMarker(text);
}

type MarkerWord = 'on' | 'off' | 'end';

interface Marker {
  readonly axis: VariantAxis;
  readonly word: MarkerWord;
}

function markerOf(line: string): Marker | null {
  // A CRLF body carries the carriage return on the line; it is not part of the marker.
  const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
  const match = VARIANT_MARKER_RE.exec(bare);
  return match === null ? null : { axis: match[1] as VariantAxis, word: match[2] as MarkerWord };
}

/** The axis whose marker the line attempts, or null when it attempts none. */
function attemptedAxisOf(line: string): VariantAxis | null {
  for (const axis of VARIANT_AXES) {
    if (MARKER_FRAGMENT_RES[axis].test(line)) return axis;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

export type VariantArm = 'on' | 'off';

/** The four variants of a body, named by the axes they turn off. */
export const VARIANT_KEYS = ['on', 'curation-off', 'compliance-off', 'both-off'] as const;

export type VariantKey = (typeof VARIANT_KEYS)[number];

/** Every variant that turns an axis off, in VARIANT_KEYS order. */
export const OFF_VARIANT_KEYS: readonly OffVariantKey[] = VARIANT_KEYS.filter(
  (key): key is OffVariantKey => key !== 'on',
);

/** The arm each axis keeps in each variant. */
const VARIANT_STATES: Readonly<Record<VariantKey, Readonly<Record<VariantAxis, VariantArm>>>> = {
  on: { curation: 'on', compliance: 'on' },
  'curation-off': { curation: 'off', compliance: 'on' },
  'compliance-off': { curation: 'on', compliance: 'off' },
  'both-off': { curation: 'off', compliance: 'off' },
};

export interface VariantSplit {
  /**
   * The body of every variant. A variant keeps an `on` arm of an axis only when that
   * axis is on in it, and an `off` arm only when that axis is off in it.
   */
  readonly bodies: Readonly<Record<VariantKey, string>>;
  /**
   * Per axis: true when the body carried at least one marker of that axis. When an
   * axis has no arms, the variants that differ only on that axis are the same body.
   */
  readonly hasArms: Readonly<Record<VariantAxis, boolean>>;
}

/**
 * The variants the build writes for a body, `on` first.
 *
 * A variant is written only for a host that has an arm on each axis the variant turns
 * off: `curation-off` when the body carries a curation arm, `compliance-off` when it
 * carries a compliance arm, and `both-off` when it carries both. A body with no arm
 * has the one variant, because every key would give the same bytes.
 */
export function emittedVariantKeys(hasArms: Readonly<Record<VariantAxis, boolean>>): readonly VariantKey[] {
  const keys: VariantKey[] = ['on'];
  if (hasArms.curation) keys.push('curation-off');
  if (hasArms.compliance) keys.push('compliance-off');
  if (hasArms.curation && hasArms.compliance) keys.push('both-off');
  return keys;
}

/** Why a body cannot be split. Every line number is 1-based, in the body that was passed. */
export type VariantSplitError =
  | { kind: 'nested-arm'; axis: VariantAxis; line: number; arm: VariantArm; openedAt: number }
  | {
      kind: 'interleaved-arm';
      /** The axis of the marker at `line`, whose arm was opened at `openedAt`. */
      axis: VariantAxis;
      marker: 'off' | 'end';
      line: number;
      openedAt: number;
      /** The arm of the other axis that was opened after it and is still open. */
      innerAxis: VariantAxis;
      innerOpenedAt: number;
    }
  | { kind: 'repeated-off'; axis: VariantAxis; line: number; openedAt: number }
  | { kind: 'unopened-end'; axis: VariantAxis; line: number }
  | { kind: 'unclosed-arm'; axis: VariantAxis; arm: VariantArm; openedAt: number }
  | { kind: 'empty-arm'; axis: VariantAxis; arm: VariantArm; openedAt: number; closedAt: number }
  | { kind: 'legacy-marker'; line: number; text: string }
  | { kind: 'stray-marker'; axis: VariantAxis; line: number; text: string };

/** The longest stretch of a stray line a refusal quotes. */
const STRAY_QUOTE_MAX = 80;

/** An arm that is open at the current line. Local to one split. */
interface OpenArm {
  readonly axis: VariantAxis;
  readonly arm: VariantArm;
  /** The line of the marker that opened it. */
  readonly openedAt: number;
  /** Whether it has held a line with content yet. */
  hasContent: boolean;
}

/**
 * Handle a line that is not a marker: refuse it when it attempts one (the retired
 * spelling first, then a current one), else keep it in every variant that agrees with
 * every open arm and mark each open arm as holding content when the line is not blank.
 *
 * Reads no module state. It changes only the `kept` and `open` accumulators of the
 * split that passed them in.
 */
function takeContentLine(
  line: string,
  lineNo: number,
  kept: Record<VariantKey, string[]>,
  open: readonly OpenArm[],
): VariantSplitError | null {
  if (LEGACY_MARKER_FRAGMENT_RE.test(line)) {
    return { kind: 'legacy-marker', line: lineNo, text: line.trim().slice(0, STRAY_QUOTE_MAX) };
  }
  const attempted = attemptedAxisOf(line);
  if (attempted !== null) {
    return { kind: 'stray-marker', axis: attempted, line: lineNo, text: line.trim().slice(0, STRAY_QUOTE_MAX) };
  }
  for (const key of VARIANT_KEYS) {
    if (open.every(arm => arm.arm === VARIANT_STATES[key][arm.axis])) kept[key].push(line);
  }
  if (line.trim() !== '') {
    for (const arm of open) arm.hasContent = true;
  }
  return null;
}

/**
 * The refusal for a marker that would close `current`, the open arm of its axis (an
 * `off` that ends an on arm, or an `end`), or null when the arm may close. An open
 * arm of the other axis is checked first, because it must close before this one;
 * an arm that held no content is checked second.
 */
function checkClose(
  axis: VariantAxis,
  word: 'off' | 'end',
  lineNo: number,
  current: OpenArm,
  inner: OpenArm | null,
): VariantSplitError | null {
  if (inner !== null) {
    return {
      kind: 'interleaved-arm', axis, marker: word, line: lineNo, openedAt: current.openedAt,
      innerAxis: inner.axis, innerOpenedAt: inner.openedAt,
    };
  }
  if (!current.hasContent) {
    return { kind: 'empty-arm', axis, arm: current.arm, openedAt: current.openedAt, closedAt: lineNo };
  }
  return null;
}

/**
 * Apply one marker to the open arms: open an arm, turn an on arm to its else, or close
 * an arm. Returns the refusal when the marker is not allowed there, and null after it
 * changed `open`.
 *
 * Reads no module state. It changes only the `open` stack of the split that passed it in.
 */
function applyMarker(marker: Marker, lineNo: number, open: OpenArm[]): VariantSplitError | null {
  const { axis } = marker;
  const at = open.findIndex(arm => arm.axis === axis);
  const current = at === -1 ? null : open[at];
  // The arm of the other axis opened after this axis's arm, if any: the one that must close first.
  const inner = at !== -1 && at + 1 < open.length ? open[at + 1] : null;

  switch (marker.word) {
    case 'on':
      if (current !== null) {
        return { kind: 'nested-arm', axis, line: lineNo, arm: current.arm, openedAt: current.openedAt };
      }
      open.push({ axis, arm: 'on', openedAt: lineNo, hasContent: false });
      return null;
    case 'off': {
      if (current === null) {
        open.push({ axis, arm: 'off', openedAt: lineNo, hasContent: false });
        return null;
      }
      if (current.arm === 'off') {
        return { kind: 'repeated-off', axis, line: lineNo, openedAt: current.openedAt };
      }
      // Directly after an on arm this is its else: the on arm ends here.
      const refused = checkClose(axis, 'off', lineNo, current, inner);
      if (refused !== null) return refused;
      open[at] = { axis, arm: 'off', openedAt: lineNo, hasContent: false };
      return null;
    }
    case 'end': {
      if (current === null) return { kind: 'unopened-end', axis, line: lineNo };
      const refused = checkClose(axis, 'end', lineNo, current, inner);
      if (refused !== null) return refused;
      open.pop();
      return null;
    }
    default: {
      const unhandled: never = marker.word;
      return { kind: 'stray-marker', axis, line: lineNo, text: String(unhandled) };
    }
  }
}

/**
 * Split a compiled body into its four variants.
 *
 * Total and pure: the same input gives the same output, and a refusal is a
 * Result. The loop is one pass over the body's lines, so its bound is the body's
 * own length. The open arms are a stack, outermost first. It holds at most one arm
 * per axis, because a second `on` of an axis is refused, so it never holds more
 * arms than there are axes.
 *
 * An arm needs a line with content in it, and a line inside an inner arm is also
 * inside every arm around it. An arm that holds only blank lines is refused as
 * empty, because it would add blank lines to one variant and nothing to the
 * other, which is a mistake rather than a design.
 */
export function splitVariants(body: string): Result<VariantSplit, VariantSplitError> {
  const lines = body.split('\n');
  const kept: Record<VariantKey, string[]> = { on: [], 'curation-off': [], 'compliance-off': [], 'both-off': [] };
  const seen: Record<VariantAxis, boolean> = { curation: false, compliance: false };
  const open: OpenArm[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNo = index + 1;
    const marker = markerOf(line);
    if (marker !== null) seen[marker.axis] = true;
    const refused = marker === null ? takeContentLine(line, lineNo, kept, open) : applyMarker(marker, lineNo, open);
    if (refused !== null) return Err(refused);
  }

  // The arm opened last is the one an `end` would close first.
  const unclosed = open.length > 0 ? open[open.length - 1] : null;
  if (unclosed !== null) {
    return Err({ kind: 'unclosed-arm', axis: unclosed.axis, arm: unclosed.arm, openedAt: unclosed.openedAt });
  }
  return Ok({
    bodies: {
      on: kept.on.join('\n'),
      'curation-off': kept['curation-off'].join('\n'),
      'compliance-off': kept['compliance-off'].join('\n'),
      'both-off': kept['both-off'].join('\n'),
    },
    hasArms: seen,
  });
}

/**
 * Render a refusal as one line a person can act on.
 *
 * One arm per kind with a `never` default, so a kind added to the union cannot
 * fall through into a message that does not describe it. Shared by the build and
 * the tests, so the text asserted is the text shipped.
 */
export function describeVariantSplitError(error: VariantSplitError): string {
  switch (error.kind) {
    case 'nested-arm':
      return (
        `line ${error.line}: a ${error.axis}:on marker inside the ${error.arm} arm opened at line ` +
        `${error.openedAt} — arms do not nest; close it with ${error.axis}:end first`
      );
    case 'interleaved-arm':
      return (
        `line ${error.line}: a ${error.axis}:${error.marker} marker ends the ${error.axis} arm opened at line ` +
        `${error.openedAt} while the ${error.innerAxis} arm opened at line ${error.innerOpenedAt} is still ` +
        `open — arms of two axes may nest but not overlap; close the ${error.innerAxis} arm with ` +
        `${error.innerAxis}:end first`
      );
    case 'repeated-off':
      return (
        `line ${error.line}: a second ${error.axis}:off marker inside the off arm opened at line ` +
        `${error.openedAt} — an arm has at most one else`
      );
    case 'unopened-end':
      return `line ${error.line}: a ${error.axis}:end marker with no open arm`;
    case 'unclosed-arm':
      return `the ${error.arm} arm opened at line ${error.openedAt} is never closed with ${error.axis}:end`;
    case 'empty-arm':
      return (
        `lines ${error.openedAt}-${error.closedAt}: the ${error.axis}:${error.arm} arm holds no line with content — ` +
        `delete the arm or put its text inside it`
      );
    case 'legacy-marker':
      return (
        `line ${error.line}: "${error.text}" uses the retired learning marker — rename it to ` +
        `<!-- curation:on -->, <!-- curation:off --> or <!-- curation:end -->`
      );
    case 'stray-marker':
      return (
        `line ${error.line}: "${error.text}" names a ${error.axis} marker but is not one — a marker ` +
        `is a whole line, exactly <!-- ${error.axis}:on -->, <!-- ${error.axis}:off --> or <!-- ${error.axis}:end -->`
      );
    default: {
      const unhandled: never = error;
      return `unhandled variant split error ${JSON.stringify(unhandled)}`;
    }
  }
}

// ---------------------------------------------------------------------------
// The variant manifest
// ---------------------------------------------------------------------------

/**
 * Repo-relative path of the variant manifest, written beside the variant trees.
 *
 * The installer reads it to learn which compiled prompts carry a curation arm and
 * which carry a compliance arm, so it never has to guess from the files it finds.
 */
export const VARIANT_MANIFEST_REL_PATH = 'dist/variant-axes.json';

/** The manifest format version. A change to the shape of the file raises it. */
export const VARIANT_MANIFEST_VERSION = 1;

/** One compiled prompt of the manifest: its kind, its output name and the axes it carries an arm on. */
export interface VariantManifestHost {
  readonly kind: VariantKind;
  /** The validated output basename, without `.md`. */
  readonly name: string;
  readonly axes: Readonly<Record<VariantAxis, boolean>>;
}

/** Why a manifest cannot be rendered. */
export type VariantManifestError = { kind: 'duplicate-host'; host: string };

/** The manifest key of a host: the same `<kind>/<name>` spelling the host rosters use. */
function manifestKeyOf(host: VariantManifestHost): string {
  return `${host.kind}/${host.name}`;
}

/** Order by UTF-16 code unit, so the order does not depend on the locale of the machine that builds. */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Render the manifest of a build as JSON text.
 *
 * Total and pure, and deterministic: the hosts are sorted by key, each host lists
 * its axes in the VARIANT_AXES order whatever order its input object holds them in,
 * and the text ends in a newline, so the same roster always gives the same bytes. A
 * kind and name that appear twice are refused, because the two hosts would write one
 * file and one of the entries would be wrong.
 */
export function renderVariantManifest(hosts: readonly VariantManifestHost[]): Result<string, VariantManifestError> {
  const entries = new Map<string, Record<VariantAxis, boolean>>();
  for (const host of hosts) {
    const key = manifestKeyOf(host);
    if (entries.has(key)) return Err({ kind: 'duplicate-host', host: key });
    entries.set(key, { curation: host.axes.curation, compliance: host.axes.compliance });
  }
  const sorted: Record<string, Record<VariantAxis, boolean>> = {};
  for (const key of [...entries.keys()].sort(byCodeUnit)) {
    const axes = entries.get(key);
    if (axes !== undefined) sorted[key] = axes;
  }
  return Ok(`${JSON.stringify({ version: VARIANT_MANIFEST_VERSION, hosts: sorted }, null, 2)}\n`);
}

/** Render a manifest refusal as one line a person can act on. */
export function describeVariantManifestError(error: VariantManifestError): string {
  switch (error.kind) {
    case 'duplicate-host':
      return `two hosts write ${error.host}.md — a variant manifest names each compiled prompt once`;
    default: {
      const unhandled: never = error.kind;
      return `unhandled variant manifest error ${String(unhandled)}`;
    }
  }
}

/** The most hosts a manifest may name. The shipped roster is named in tests/fixtures/mds-manifest.ts; the bound keeps a corrupt file from driving an unbounded loop. */
export const MAX_VARIANT_MANIFEST_HOSTS = 1024;

/** A manifest key: a prompt kind, a slash and an output basename, the same charset the build validates names against. */
const MANIFEST_HOST_KEY_RE = /^(commands|agents)\/([a-z0-9][a-z0-9._-]{0,63})$/;

/** Why a manifest cannot be read. */
export type VariantManifestParseError =
  | { kind: 'not-json' }
  | { kind: 'not-an-object' }
  | { kind: 'unsupported-version' }
  | { kind: 'bad-hosts' }
  | { kind: 'too-many-hosts'; count: number }
  | { kind: 'bad-host-key'; key: string }
  | { kind: 'bad-host-axes'; host: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse the text of a variant manifest into its hosts, in file order.
 *
 * The parse boundary of the file the build wrote: it trusts nothing in the text. The
 * version must be the one this module renders, the host map must be a plain object
 * within MAX_VARIANT_MANIFEST_HOSTS, every key must be `<kind>/<name>` with a known kind
 * and a valid basename (so a key can never name a path outside a variant tree), and both
 * axes of every host must be booleans. The first fault is the refusal. Pure and total:
 * the JSON parse is the only call that can throw and it is caught here.
 */
export function parseVariantManifest(text: string): Result<readonly VariantManifestHost[], VariantManifestParseError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Err({ kind: 'not-json' });
  }
  if (!isPlainRecord(parsed)) return Err({ kind: 'not-an-object' });
  if (parsed.version !== VARIANT_MANIFEST_VERSION) return Err({ kind: 'unsupported-version' });
  const rawHosts = parsed.hosts;
  if (!isPlainRecord(rawHosts)) return Err({ kind: 'bad-hosts' });

  const entries = Object.entries(rawHosts);
  if (entries.length > MAX_VARIANT_MANIFEST_HOSTS) return Err({ kind: 'too-many-hosts', count: entries.length });

  const hosts: VariantManifestHost[] = [];
  for (const [key, value] of entries) {
    const match = MANIFEST_HOST_KEY_RE.exec(key);
    if (match === null) return Err({ kind: 'bad-host-key', key });
    if (!isPlainRecord(value) || typeof value.curation !== 'boolean' || typeof value.compliance !== 'boolean') {
      return Err({ kind: 'bad-host-axes', host: key });
    }
    hosts.push({
      kind: match[1] as VariantKind,
      name: match[2],
      axes: { curation: value.curation, compliance: value.compliance },
    });
  }
  return Ok(hosts);
}

/** Render a manifest parse refusal as one line a person can act on. */
export function describeVariantManifestParseError(error: VariantManifestParseError): string {
  switch (error.kind) {
    case 'not-json':
      return 'the text is not JSON';
    case 'not-an-object':
      return 'the top level is not an object';
    case 'unsupported-version':
      return `the version is not ${VARIANT_MANIFEST_VERSION}`;
    case 'bad-hosts':
      return '"hosts" is missing or is not an object';
    case 'too-many-hosts':
      return `${error.count} hosts exceed the bound of ${MAX_VARIANT_MANIFEST_HOSTS}`;
    case 'bad-host-key':
      return `the host key "${error.key}" is not <commands|agents>/<name>`;
    case 'bad-host-axes':
      return `the host ${error.host} does not carry a boolean "curation" and a boolean "compliance"`;
    default: {
      const unhandled: never = error;
      return `unhandled variant manifest parse error ${JSON.stringify(unhandled)}`;
    }
  }
}

/**
 * The variant a machine with these switches installs for a host with these arms.
 *
 * An axis counts as off for a host only when the machine has it off AND the host carries
 * an arm on it, because a host with no arm on an axis has one body on that axis. The
 * result is therefore always a variant the build wrote for the host (see
 * emittedVariantKeys): a host with both arms on a both-off machine gets `both-off`, a host
 * with only a compliance arm gets `compliance-off`, never the curation-off file it does not
 * have and never the on file.
 */
export function machineVariantKey(
  machine: VariantSwitches,
  hasArms: Readonly<Record<VariantAxis, boolean>>,
): VariantKey {
  const curationOff = !machine.curation && hasArms.curation;
  const complianceOff = !machine.compliance && hasArms.compliance;
  if (curationOff && complianceOff) return 'both-off';
  if (curationOff) return 'curation-off';
  return complianceOff ? 'compliance-off' : 'on';
}

/**
 * The repo-relative off files a machine must find for the hosts that carry a compliance
 * arm, in manifest order. Empty when compliance is on: that machine reads no off file for
 * the axis.
 *
 * A compliance-armed host has no safe fall-through on a machine with compliance off: the
 * normal file, and on a both-off machine the curation-off file, both carry the compliance
 * text the machine has switched off. A host with no compliance arm is not listed: its
 * normal (or curation-off) file is the right one.
 */
export function requiredComplianceVariantFiles(
  machine: VariantSwitches,
  hosts: readonly VariantManifestHost[],
): readonly string[] {
  if (machine.compliance) return [];
  const files: string[] = [];
  for (const host of hosts) {
    if (!host.axes.compliance) continue;
    const key = machineVariantKey(machine, host.axes);
    if (key === 'on') continue;
    files.push(variantOffRelPath(key, host.kind, `${host.name}.md`));
  }
  return files;
}
