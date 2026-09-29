// src/assets/scripts/lib/project-config.cjs
//
// The ONE parser of devflow's per-repository config files — the team-committed
// `.devflow/project.json` and the personal, uncommitted `.devflow/config.json`
// (applies PF-023: the invariant lives at the sink every reader passes through).
// Installed beside its two callers as ~/.devflow/scripts/lib/project-config.cjs:
//   resolve-evidence-policy.cjs  reads `evidence` and `compliance` at every source
//   resolve-settings.cjs         reads every key of both files, locally
//
// Pure except the two readers (readBoundedRegularFile, readMachineManifest), which
// only ever read. Nothing here writes, spawns or prints: devflow never writes
// project.json (applies ADR-024).
//
// D-PROJECT-CONFIG: `.devflow/project.json` is a JSON object whose every key is
// optional and whose unknown keys are ignored:
//   {"version":1,"evidence":"required|standard","compliance":["gdpr",…],
//    "tracker":{"provider":"github|jira|linear","site":"https://…","key":"ACME"},
//    "reviewPublication":"off|auto|full",
//    "features":{"memory":false,"learning":false,"knowledge":false}}
// Each known key is classified on its own — absent, valid or malformed — so one
// bad value never takes its neighbours down with it (AC-26). What a malformed
// value MEANS is the consumer's decision, made once in each caller's fold:
// evidence ⇒ required, compliance ⇒ generic, tracker ⇒ TRACKER_WARN=invalid,
// reviewPublication ⇒ off, a feature switch ⇒ not narrowed.
//
// Whole-file rule: that per-key classification applies only INSIDE a file that
// reads as a JSON object. A file that exists but does not — empty, unparseable,
// not an object, a BOM, not UTF-8, over MAX_CONFIG_BYTES, too deeply nested, or
// (at the reader) a symlink or other non-regular file — is `invalid` as a whole,
// never `absent`, so no key of it can be mistaken for "not set". Each caller
// fails closed on it: resolve-evidence-policy.cjs resolves `required`,
// resolve-settings.cjs prints its fail-closed line, and the hooks' switch gate
// narrows nothing.
//
// D-PROJECT-STRICT-KEYS: keys are read with hasOwnProperty (a `__proto__` key is
// an own data property after JSON.parse, never the prototype), and a key that
// appears TWICE in the same object is malformed. JSON.parse keeps the last
// duplicate silently, so the file would say two things while the parser heard
// one; duplicates are therefore found in the raw text (collectDuplicateKeyPaths)
// before any value is trusted. A duplicate `evidence` is the case that matters —
// `{"evidence":"required","evidence":"standard"}` must not read as standard.
// Strictness is per key only inside a readable object: a file that is not one is
// `invalid` whole (the whole-file rule above), whatever keys it appears to hold.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Largest config file read or decoded, in bytes — one bound for project.json and config.json. */
const MAX_CONFIG_BYTES = 4096;

/** Every evidence policy value, strictest first (resolve-evidence-policy.cjs POLICIES). */
const POLICIES = Object.freeze(['required', 'standard']);

/** Every review-publication value, in ascending order: off < auto < full. */
const PUBLICATIONS = Object.freeze(['off', 'auto', 'full']);

/**
 * The registered tracker providers — transcribed from TRACKER_PROVIDERS in
 * src/core/tracker.ts and pinned to it by a parity test.
 */
const TRACKER_PROVIDER_IDS = Object.freeze(['github', 'jira', 'linear']);

/**
 * The registered compliance frameworks, in registry order — transcribed from
 * COMPLIANCE_FRAMEWORKS in src/core/compliance.ts and pinned to it by a parity test.
 */
const COMPLIANCE_IDS = Object.freeze(['gdpr', 'hipaa', 'pci-dss', 'soc2', 'iso-27001', 'sox']);

/** The feature switches a repo layer may narrow. */
const FEATURE_SWITCHES = Object.freeze(['memory', 'learning', 'knowledge']);

/**
 * A tracker site: the Jira setup-task gate (src/assets/mds/tracker/_jira.mds,
 * `**Site.**`) exactly — https, a hostname, no userinfo, no port, no path. Each
 * `+` run is separated by a literal `.`, so the match is linear.
 */
const TRACKER_SITE_RE = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)+$/;

/** Longest site admitted — a DNS name is at most 253 octets, plus the scheme. */
const MAX_SITE_LENGTH = 261;

/** A tracker project key: the Jira key shape, which the Linear team key also fits. */
const TRACKER_KEY_RE = /^[A-Z][A-Z0-9_]{1,9}$/;

/** Largest machine manifest read, in bytes. */
const MAX_MANIFEST_BYTES = 1048576;

/** Deepest nesting the duplicate-key scan follows; deeper is invalid. */
const MAX_JSON_DEPTH = 32;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * @template T
 * @typedef {{ kind: 'absent' } | { kind: 'malformed' } | { kind: 'valid', value: T }} Field
 *
 * @typedef {{ provider: Field<string>, site: Field<string>, key: Field<string> }} ProjectTracker
 * @typedef {{ memory: Field<boolean>, learning: Field<boolean>, knowledge: Field<boolean> }} FeatureFields
 *
 * @typedef {{ kind: 'absent' } | { kind: 'invalid' } | {
 *   kind: 'parsed',
 *   version: Field<1>,
 *   evidence: Field<'required' | 'standard'>,
 *   compliance: Field<string[]>,
 *   tracker: Field<ProjectTracker>,
 *   reviewPublication: Field<'off' | 'auto' | 'full'>,
 *   features: Field<FeatureFields>,
 * }} ProjectConfig
 *   `invalid` is a file that exists but is not a JSON object within the byte
 *   rules (size, BOM, UTF-8, grammar, depth) — every key of it is unknowable.
 *   `compliance` valid is the registry ids it names, normalized (possibly empty).
 *
 * @typedef {{ kind: 'absent' } | { kind: 'invalid' } | {
 *   kind: 'parsed',
 *   tracker: Field<string>,
 *   reviewPublication: Field<'off' | 'auto' | 'full'>,
 *   features: Field<FeatureFields>,
 * }} PersonalConfig
 *   The personal file's `tracker` is the per-repo provider override: a provider
 *   id string (an empty string reads as absent, as parseTrackerOverride does).
 *
 * @typedef {{ kind: 'absent' } | { kind: 'refused' } | { kind: 'ok', bytes: Buffer }} BoundedRead
 */

/** @type {{ kind: 'absent' }} */
const ABSENT_FIELD = Object.freeze({ kind: 'absent' });
/** @type {{ kind: 'malformed' }} */
const MALFORMED_FIELD = Object.freeze({ kind: 'malformed' });
/** @type {{ kind: 'absent' }} */
const ABSENT_FILE = Object.freeze({ kind: 'absent' });
/** @type {{ kind: 'invalid' }} */
const INVALID_FILE = Object.freeze({ kind: 'invalid' });

/**
 * @template T
 * @param {T} value
 * @returns {Field<T>}
 */
function validField(value) {
  return Object.freeze({ kind: 'valid', value });
}

// ---------------------------------------------------------------------------
// Bytes → text (the byte rules both files share)
// ---------------------------------------------------------------------------

/**
 * Decode config-file bytes, or say why not. `null`/`undefined` is "no file"; an
 * empty file is text (`''`), which every JSON consumer then refuses.
 *
 * The byte checks run before decoding — size, then a UTF-8 BOM, which is invalid
 * rather than skipped — and decoding is fatal on a malformed sequence.
 *
 * @param {unknown} buf
 * @returns {{ kind: 'absent' } | { kind: 'invalid' } | { kind: 'text', text: string }}
 */
function decodeConfigBytes(buf) {
  if (buf === null || buf === undefined) return ABSENT_FILE;
  if (!(buf instanceof Uint8Array)) return INVALID_FILE;
  if (buf.length > MAX_CONFIG_BYTES) return INVALID_FILE;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return INVALID_FILE;
  try {
    // Fatal decoding would silently strip a leading BOM; the byte check above
    // is what makes one invalid.
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(buf) };
  } catch (_) {
    return INVALID_FILE;
  }
}

// ---------------------------------------------------------------------------
// Bounded file reads
// ---------------------------------------------------------------------------

/**
 * Read a regular file of at most `maxBytes`, or say why not.
 *
 * The stat runs first and decides without opening: a non-regular file (with
 * `followSymlinks` false this includes a symlink; always a directory, FIFO,
 * socket or device) is refused unopened, and an oversize one unread. The open
 * then adds O_NONBLOCK (a FIFO swapped in after the stat cannot block) and, when
 * not following, O_NOFOLLOW (a symlink swapped in fails the open); the fstat
 * re-checks the opened object. The read loop is bounded by the byte count.
 *
 * @param {string} filePath
 * @param {number} maxBytes
 * @param {boolean} followSymlinks
 * @returns {BoundedRead}
 */
function readBoundedRegularFile(filePath, maxBytes, followSymlinks) {
  let st;
  try {
    st = followSymlinks ? fs.statSync(filePath) : fs.lstatSync(filePath);
  } catch (/** @type {any} */ err) {
    return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? { kind: 'absent' } : { kind: 'refused' };
  }
  if (!st.isFile() || st.size > maxBytes) return { kind: 'refused' };

  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NONBLOCK || 0)
    | (followSymlinks ? 0 : (fs.constants.O_NOFOLLOW || 0));
  let fd;
  try {
    fd = fs.openSync(filePath, flags);
  } catch (_) {
    return { kind: 'refused' };
  }
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.size > maxBytes) return { kind: 'refused' };
    // One byte past the stat'd size: a file that grew between the stat and the
    // read is refused rather than truncated into something that parses.
    const buf = Buffer.alloc(fst.size + 1);
    let total = 0;
    for (let i = 0; i < buf.length; i++) {
      const n = fs.readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
      if (total === buf.length) break;
    }
    if (total > fst.size) return { kind: 'refused' };
    return { kind: 'ok', bytes: buf.subarray(0, total) };
  } catch (_) {
    return { kind: 'refused' };
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* the read already decided; a close error changes nothing */ }
  }
}

/**
 * The devflow machine root: ~/.devflow, else null (a home directory that is not
 * absolute would resolve against cwd). No environment variable relocates it
 * (D-ONE-HOME in src/targets/claude-code/claude-paths.ts).
 *
 * @returns {string | null}
 */
function machineDevflowDir() {
  let home;
  try {
    home = os.homedir();
  } catch (_) {
    // No HOME and no passwd entry: there is no manifest to read, which is not an error.
    return null;
  }
  return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.devflow') : null;
}

/**
 * The parsed machine manifest (~/.devflow/manifest.json), or undefined when it is
 * absent, not a regular file, over MAX_MANIFEST_BYTES, not UTF-8 or not JSON.
 * Read directly — never through the CLI's manifest reader, which heal-writes.
 * Followed through a symlink: the manifest is the user's own file, not a
 * repository's.
 *
 * @returns {unknown}
 */
function readMachineManifest() {
  const dir = machineDevflowDir();
  if (dir === null) return undefined;
  const read = readBoundedRegularFile(path.join(dir, 'manifest.json'), MAX_MANIFEST_BYTES, true);
  if (read.kind !== 'ok') return undefined;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes));
  } catch (_) {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Duplicate keys (D-PROJECT-STRICT-KEYS)
// ---------------------------------------------------------------------------

/**
 * The key path of an object member, as a lookup string: JSON of the key array,
 * so no key spelling can collide with another path.
 *
 * @param {readonly string[]} keys
 * @returns {string}
 */
function keyPath(keys) {
  return JSON.stringify(keys);
}

/**
 * Every object-member path that occurs more than once in `text`, which must
 * already be valid JSON (the caller runs JSON.parse first). Null when the text
 * nests deeper than MAX_JSON_DEPTH or a key does not decode — the caller then
 * treats the whole file as invalid.
 *
 * A key is the first string in an object after `{` or `,`, decoded with
 * JSON.parse so an escaped spelling (`"evidence"`) is the key it spells.
 * Array elements share the `[]` path segment. Both loops are bounded by the text
 * length, which the caller bounds by MAX_CONFIG_BYTES.
 *
 * @param {string} text
 * @returns {Set<string> | null}
 */
function collectDuplicateKeyPaths(text) {
  /** @type {Set<string>} */
  const duplicates = new Set();
  /** @type {Array<{ isObject: boolean, keys: Set<string>, path: string[], expectKey: boolean }>} */
  const stack = [];
  /** @type {string} */
  let lastKey = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return null;
      if (top !== undefined && top.isObject && top.expectKey) {
        let key;
        try {
          key = JSON.parse(text.slice(i, j + 1));
        } catch (_) {
          return null;
        }
        if (typeof key !== 'string') return null;
        if (top.keys.has(key)) duplicates.add(keyPath(top.path.concat([key])));
        top.keys.add(key);
        top.expectKey = false;
        lastKey = key;
      }
      i = j;
    } else if (ch === '{' || ch === '[') {
      if (stack.length >= MAX_JSON_DEPTH) return null;
      const path = top === undefined ? [] : top.path.concat([top.isObject ? lastKey : '[]']);
      stack.push({ isObject: ch === '{', keys: new Set(), path, expectKey: ch === '{' });
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    } else if (ch === ',' && top !== undefined && top.isObject) {
      top.expectKey = true;
    }
  }
  return duplicates;
}

/**
 * Whether `path`, or any object containing it, is a duplicated member.
 *
 * @param {Set<string>} duplicates
 * @param {readonly string[]} path
 * @returns {boolean}
 */
function isDuplicated(duplicates, path) {
  for (let n = 1; n <= path.length; n++) {
    if (duplicates.has(keyPath(path.slice(0, n)))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Value classifiers
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @returns {boolean}
 */
function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Normalize one framework spelling exactly as src/core/compliance.ts normalizeId
 * does: trim, lowercase, whitespace runs to `-`, and the `iso27001` alias.
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeComplianceId(s) {
  const normalized = s.trim().toLowerCase().replace(/\s+/g, '-');
  return normalized === 'iso27001' ? 'iso-27001' : normalized;
}

/**
 * The registry ids a framework list names — src/core/compliance.ts
 * normalizeFrameworks exactly, behind a parity test: normalized, unknown ids
 * dropped, first occurrence kept.
 *
 * @param {readonly string[]} frameworks
 * @returns {string[]}
 */
function normalizeComplianceIds(frameworks) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const raw of frameworks) {
    const id = normalizeComplianceId(raw);
    if (!COMPLIANCE_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The fields of one object, each classified on its own.
 *
 * @template T
 * @param {Record<string, unknown>} obj
 * @param {Set<string>} duplicates
 * @param {readonly string[]} parentPath
 * @param {string} key
 * @param {(value: unknown) => { ok: true, value: T } | { ok: false }} classify
 * @returns {Field<T>}
 */
function fieldOf(obj, duplicates, parentPath, key, classify) {
  if (!own(obj, key)) return ABSENT_FIELD;
  const path = parentPath.concat([key]);
  if (isDuplicated(duplicates, path)) return MALFORMED_FIELD;
  const verdict = classify(obj[key]);
  return verdict.ok ? validField(verdict.value) : MALFORMED_FIELD;
}

/**
 * @template T
 * @param {readonly T[]} allowed
 * @returns {(value: unknown) => { ok: true, value: T } | { ok: false }}
 */
function oneOf(allowed) {
  return value => (allowed.includes(/** @type {T} */ (value)) ? { ok: true, value: /** @type {T} */ (value) } : { ok: false });
}

/** @param {unknown} value */
function asBoolean(value) {
  return typeof value === 'boolean' ? { ok: /** @type {const} */ (true), value } : { ok: /** @type {const} */ (false) };
}

/** @param {unknown} value */
function asVersion(value) {
  return value === 1 ? { ok: /** @type {const} */ (true), value: /** @type {1} */ (1) } : { ok: /** @type {const} */ (false) };
}

/** @param {unknown} value */
function asComplianceList(value) {
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) return { ok: /** @type {const} */ (false) };
  return { ok: /** @type {const} */ (true), value: Object.freeze(normalizeComplianceIds(value)) };
}

/** @param {unknown} value */
function asSite(value) {
  return typeof value === 'string' && value.length <= MAX_SITE_LENGTH && TRACKER_SITE_RE.test(value)
    ? { ok: /** @type {const} */ (true), value }
    : { ok: /** @type {const} */ (false) };
}

/** @param {unknown} value */
function asKey(value) {
  return typeof value === 'string' && TRACKER_KEY_RE.test(value)
    ? { ok: /** @type {const} */ (true), value }
    : { ok: /** @type {const} */ (false) };
}

/**
 * The `features` object: each switch its own field, boolean only. A consumer
 * narrows on a literal `false` alone.
 *
 * @param {Record<string, unknown>} obj
 * @param {Set<string>} duplicates
 * @returns {Field<FeatureFields>}
 */
function featuresField(obj, duplicates) {
  return fieldOf(obj, duplicates, [], 'features', value => {
    if (!isPlainObject(value)) return { ok: false };
    const base = ['features'];
    return {
      ok: true,
      value: Object.freeze({
        memory: fieldOf(value, duplicates, base, 'memory', asBoolean),
        learning: fieldOf(value, duplicates, base, 'learning', asBoolean),
        knowledge: fieldOf(value, duplicates, base, 'knowledge', asBoolean),
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/**
 * Bytes → a plain JSON object and its duplicated paths, or the file-level verdict.
 *
 * @param {unknown} buf
 * @returns {{ kind: 'absent' } | { kind: 'invalid' } | { kind: 'object', obj: Record<string, unknown>, duplicates: Set<string> }}
 */
function parseEnvelope(buf) {
  const decoded = decodeConfigBytes(buf);
  if (decoded.kind !== 'text') return decoded;
  let parsed;
  try {
    parsed = JSON.parse(decoded.text);
  } catch (_) {
    return INVALID_FILE;
  }
  if (!isPlainObject(parsed)) return INVALID_FILE;
  const duplicates = collectDuplicateKeyPaths(decoded.text);
  if (duplicates === null) return INVALID_FILE;
  return { kind: 'object', obj: parsed, duplicates };
}

/**
 * Classify `.devflow/project.json` bytes (D-PROJECT-CONFIG, D-PROJECT-STRICT-KEYS).
 * `null`/`undefined` is "no file". Never throws.
 *
 * @param {unknown} buf
 * @returns {ProjectConfig}
 */
function parseProjectBytes(buf) {
  const env = parseEnvelope(buf);
  if (env.kind !== 'object') return env;
  const { obj, duplicates } = env;
  return Object.freeze({
    kind: 'parsed',
    version: fieldOf(obj, duplicates, [], 'version', asVersion),
    evidence: fieldOf(obj, duplicates, [], 'evidence', oneOf(POLICIES)),
    compliance: fieldOf(obj, duplicates, [], 'compliance', asComplianceList),
    tracker: fieldOf(obj, duplicates, [], 'tracker', value => {
      if (!isPlainObject(value)) return { ok: false };
      const base = ['tracker'];
      return {
        ok: true,
        value: Object.freeze({
          provider: fieldOf(value, duplicates, base, 'provider', oneOf(TRACKER_PROVIDER_IDS)),
          site: fieldOf(value, duplicates, base, 'site', asSite),
          key: fieldOf(value, duplicates, base, 'key', asKey),
        }),
      };
    }),
    reviewPublication: fieldOf(obj, duplicates, [], 'reviewPublication', oneOf(PUBLICATIONS)),
    features: featuresField(obj, duplicates),
  });
}

/**
 * Classify the personal `.devflow/config.json` bytes with the same rules. Only
 * the keys a personal file may carry are read: `reviewPublication`, `features`
 * and the `tracker` override. The retired top-level switches (`memory`,
 * `learning`, `knowledge`, `decisions`) are never read — `features` is a new
 * namespace, so a stale `learning: false` left from the per-repo-install era
 * cannot come back to life. Never throws.
 *
 * @param {unknown} buf
 * @returns {PersonalConfig}
 */
function parsePersonalBytes(buf) {
  const env = parseEnvelope(buf);
  if (env.kind !== 'object') return env;
  const { obj, duplicates } = env;
  // `"tracker": ""` is an unset key with a character in it (parseTrackerOverride).
  const tracker = own(obj, 'tracker') && obj.tracker === '' && !isDuplicated(duplicates, ['tracker'])
    ? ABSENT_FIELD
    : fieldOf(obj, duplicates, [], 'tracker', oneOf(TRACKER_PROVIDER_IDS));
  return Object.freeze({
    kind: 'parsed',
    tracker,
    reviewPublication: fieldOf(obj, duplicates, [], 'reviewPublication', oneOf(PUBLICATIONS)),
    features: featuresField(obj, duplicates),
  });
}

module.exports = Object.freeze({
  MAX_CONFIG_BYTES,
  POLICIES,
  PUBLICATIONS,
  TRACKER_PROVIDER_IDS,
  COMPLIANCE_IDS,
  FEATURE_SWITCHES,
  TRACKER_SITE_RE,
  TRACKER_KEY_RE,
  decodeConfigBytes,
  readBoundedRegularFile,
  machineDevflowDir,
  readMachineManifest,
  collectDuplicateKeyPaths,
  normalizeComplianceIds,
  parseProjectBytes,
  parsePersonalBytes,
});
