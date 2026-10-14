import { promises as fs, constants as fsConstants } from 'fs';
import * as path from 'path';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { hasRequiredManifestFields } from './manifest.js';
import { describeEchoedValue } from './echo-value.js';

/**
 * The gate level: how much checking a command applies. One of three words, from
 * most to least checking.
 *
 * `features.gateLevel` in `~/.devflow/manifest.json` is the MACHINE default, and
 * `gateLevel` in a repository's personal `.devflow/config.json` overrides it.
 * Neither is a feature switch: a switch can only be narrowed by a repository
 * layer, but a level may be raised or lowered by the personal file. The settings
 * resolver (`resolve-settings.cjs`) folds both into the `GATE_LEVEL=` field of its
 * settings line; this module owns the closed set, the parser and the machine
 * layer's raw reader and writer. No code here chooses a level from a task or a
 * diff.
 *
 * A present value that is not one of the three words is MALFORMED. A reader reads
 * it as `full` and leaves it on disk as written: no read and no unrelated write
 * heals it to absent, which would lower the level without a word.
 */
export const GATE_LEVELS = Object.freeze(['full', 'standard', 'lean'] as const);

export type GateLevel = (typeof GATE_LEVELS)[number];

/** The level when neither the personal file nor the manifest records one. */
export const DEFAULT_GATE_LEVEL: GateLevel = 'standard';

/**
 * Largest manifest read, in bytes. Pinned by a parity test to the resolver
 * library's MAX_MANIFEST_BYTES, so the CLI and a prompt never disagree about a
 * manifest that is too large to read.
 */
export const MAX_MANIFEST_BYTES = 1048576;

const VALID_LEVELS_LIST = GATE_LEVELS.join(', ');

export type GateLevelParse =
  | { readonly ok: true; readonly value: GateLevel }
  | { readonly ok: false; readonly error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGateLevel(value: unknown): value is GateLevel {
  return typeof value === 'string' && (GATE_LEVELS as readonly string[]).includes(value);
}

/**
 * Strict boundary parser for a gate level typed on the command line.
 *
 * REJECT, NEVER REPAIR: membership is byte-exact. No trim, no case folding, no
 * alias. `Lean` and `lean ` are errors, not `lean`. The message names every valid
 * level and echoes the offending value only in the sanitized form of
 * {@link describeEchoedValue}.
 */
export function parseGateLevel(value: unknown): GateLevelParse {
  if (isGateLevel(value)) return { ok: true, value };
  if (value === undefined || value === '') {
    return { ok: false, error: `Missing gate level. Valid levels: ${VALID_LEVELS_LIST}` };
  }
  return {
    ok: false,
    error: `Unknown gate level: "${describeEchoedValue(value)}". Valid levels: ${VALID_LEVELS_LIST}`,
  };
}

/**
 * The machine layer's level in a RAW parsed manifest. Pure and total.
 *
 *   null       no level is recorded: not an object, `features` not an object, or
 *              no own `gateLevel` key
 *   'invalid'  a `gateLevel` key is present and is not one of the three words
 *   a level    the recorded level
 *
 * Deliberately NOT built on readManifest(): that reader rejects a manifest
 * missing a required field and heal-writes, and a read-only status must do
 * neither. The resolver script's `machineGateLevel` is the CommonJS twin; a
 * table test holds the two to the same rows.
 */
export function machineGateLevel(raw: unknown): GateLevel | 'invalid' | null {
  if (!isPlainObject(raw)) return null;
  const features = raw.features;
  if (!isPlainObject(features)) return null;
  if (!Object.hasOwn(features, 'gateLevel')) return null;
  const value = features.gateLevel;
  return isGateLevel(value) ? value : 'invalid';
}

/**
 * Set `features.gateLevel` in a RAW parsed manifest. Pure — returns a new object
 * and never mutates its input. Null when the top level or `features` is not a
 * plain object (there is no `features` record to write into).
 *
 * Only `features.gateLevel` and `updatedAt` change; every other key is carried
 * verbatim, including keys this build does not model.
 */
export function setMachineGateLevel(
  raw: Record<string, unknown>,
  level: GateLevel,
  now: string,
): Record<string, unknown> | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.features)) return null;
  return {
    ...raw,
    features: { ...raw.features, gateLevel: level },
    updatedAt: now,
  };
}

/**
 * What {@link readGateManifest} found at `<devflowDir>/manifest.json`.
 *
 *   absent     no file
 *   corrupt    anything else that stops a read: not a regular file, over
 *              {@link MAX_MANIFEST_BYTES}, a failed stat or read, a file that grew
 *              during the read, bytes that are not UTF-8 or not JSON, or a top
 *              level or `features` value that is not a plain object
 *   rejected   a plain object with a plain `features` object that
 *              readManifest() would still reject, because a required field is
 *              missing or mistyped (the fault lies in another key) or because
 *              the file starts with a byte-order mark, which readManifest()
 *              cannot parse
 *   object     a plain object readManifest() would accept
 */
export type GateManifestRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'rejected' | 'object'; readonly raw: Record<string, unknown> };

const ABSENT: GateManifestRead = Object.freeze({ kind: 'absent' });
const CORRUPT: GateManifestRead = Object.freeze({ kind: 'corrupt' });

function startsWithBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** Bytes of the manifest, or why not: one bounded read of a regular file, followed through links. */
async function readManifestBytes(manifestPath: string): Promise<Buffer | 'absent' | 'corrupt'> {
  try {
    let st;
    try {
      st = await fs.stat(manifestPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'corrupt';
    }
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return 'corrupt';

    // O_NONBLOCK: a FIFO swapped in after the stat cannot block the open.
    const handle = await fs.open(manifestPath, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK || 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_MANIFEST_BYTES) return 'corrupt';
      // One byte past the stat'd size: a file that grew between the stat and the
      // read is refused rather than truncated into something that parses. Each
      // pass reads at least one byte or stops, so the loop is bounded by the buffer.
      const buf = Buffer.alloc(opened.size + 1);
      let total = 0;
      for (let pass = 0; pass < buf.length && total < buf.length; pass++) {
        const { bytesRead } = await handle.read(buf, total, buf.length - total, null);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      return total > opened.size ? 'corrupt' : buf.subarray(0, total);
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    return 'corrupt';
  }
}

/**
 * Read `<devflowDir>/manifest.json` raw, for the gate level. Never throws, never
 * exits and never writes: unlike readManifest() it heals nothing, models no key
 * and keeps every key it does not name.
 *
 * It follows the resolver library's rules, so the CLI and a prompt see the same
 * file: the path is followed through links, a missing path is absent, and every
 * other failure is corrupt. Bytes decode as UTF-8 with a fatal error, which also
 * strips a leading BOM, and then parse as JSON, so the level is read past a BOM
 * as it is in the resolver. A file with a BOM is still `rejected`, because
 * readManifest() parses the text as read and refuses it.
 */
export async function readGateManifest(devflowDir: string): Promise<GateManifestRead> {
  const bytes = await readManifestBytes(path.join(devflowDir, 'manifest.json'));
  if (bytes === 'absent') return ABSENT;
  if (bytes === 'corrupt') return CORRUPT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return CORRUPT;
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.features)) return CORRUPT;
  const readable = !startsWithBom(bytes) && hasRequiredManifestFields(parsed);
  return { kind: readable ? 'object' : 'rejected', raw: parsed };
}

/** What {@link writeMachineGateLevel} did. */
export type GateWriteResult =
  /** The level was written. */
  | { readonly kind: 'written' }
  /** The manifest already records exactly this level; nothing was written. */
  | { readonly kind: 'unchanged' }
  /** No manifest: devflow is not installed on this machine (`devflow init`). */
  | { readonly kind: 'not-installed' }
  /** A manifest exists and cannot be read as an object with a `features` object; nothing was written. */
  | { readonly kind: 'unreadable'; readonly path: string }
  /** The write failed; `reason` is the error code only. */
  | { readonly kind: 'write-failed'; readonly path: string; readonly reason: string }
  /** `level` is not one of the three words (a caller bypassed the type); nothing was read or written. */
  | { readonly kind: 'invalid-level' };

/**
 * Write the machine default to `<devflowDir>/manifest.json` (atomic temp +
 * rename). Never throws. Refuses with `invalid-level`, before any I/O, a level
 * that is not one of the three words, because the type is no check at run time.
 * Refuses with `not-installed` when there is no manifest to write into — a
 * manifest is created by `devflow init`, never by this write.
 *
 * Only `features.gateLevel` and `updatedAt` change. A write to the level the
 * manifest already records changes nothing, `updatedAt` included, because that
 * field means "the manifest's content last changed". A manifest that
 * readManifest() would reject for another key gets the same write as one it
 * accepts: its level is valid, and the fault is not this write's to fix.
 *
 * `now` is injected so a test fixes the timestamp.
 */
export async function writeMachineGateLevel(
  devflowDir: string,
  level: GateLevel,
  now: () => string,
): Promise<GateWriteResult> {
  if (!isGateLevel(level)) return { kind: 'invalid-level' };
  const manifestPath = path.join(devflowDir, 'manifest.json');
  const read = await readGateManifest(devflowDir);
  if (read.kind === 'absent') return { kind: 'not-installed' };
  if (read.kind === 'corrupt') return { kind: 'unreadable', path: manifestPath };
  const features = read.raw.features;
  if (isPlainObject(features) && features.gateLevel === level) return { kind: 'unchanged' };
  try {
    const next = setMachineGateLevel(read.raw, level, now());
    if (next === null) return { kind: 'unreadable', path: manifestPath };
    await writeFileAtomicExclusive(manifestPath, JSON.stringify(next, null, 2) + '\n');
    return { kind: 'written' };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return { kind: 'write-failed', path: manifestPath, reason: typeof code === 'string' ? code : 'unknown error' };
  }
}
