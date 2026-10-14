/**
 * Render an untrusted value for a terminal message.
 *
 * A neutral home for the sanitizer that every parser echoing a rejected value
 * shares (the tracker provider and the gate level today), so no parser imports
 * another feature's module just to reach it.
 */

/** Longest rejected value echoed back to the terminal, in CODE POINTS. */
const MAX_ECHOED_VALUE = 40;

/**
 * Render an untrusted token for a terminal message.
 *
 * Rejected values are echoed so the user can see what they typed, so they are
 * third-party input at a display sink: control characters (terminal escapes,
 * BEL, newlines) are replaced and the value is truncated.
 *
 * Takes `unknown`, and a non-string renders as its TYPE: the never-throws
 * contract of the callers has to hold for what reaches this sink, not
 * only for what the signature says — a caller reads hand-editable
 * files, and a caller-side guard is one edit from being gone. Naming the type
 * also keeps the render total, where `String()` would hand control to a
 * caller-supplied `toString` — itself both a throw path and an echo path this
 * function exists to close.
 */
export function describeEchoedValue(raw: unknown): string {
  if (typeof raw !== 'string') return `<${raw === null ? 'null' : typeof raw}>`;
  // The class is written with ESCAPES, never literal control bytes. A raw NUL
  // makes grep classify this whole file as binary — it prints "Binary file
  // matches" and skips the lines — so every grep-based sweep over src/core/
  // silently stops covering the file while still exiting 0. Pinned by
  // tests/guards/no-control-bytes.test.ts.
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, '?');
  // Cut by CODE POINT. `slice` cuts UTF-16 code units, so a cut landing inside an
  // astral character (emoji, CJK ext-B) emits the lone surrogate half of it.
  const points = [...stripped];
  return points.length > MAX_ECHOED_VALUE
    ? `${points.slice(0, MAX_ECHOED_VALUE).join('')}…`
    : stripped;
}
