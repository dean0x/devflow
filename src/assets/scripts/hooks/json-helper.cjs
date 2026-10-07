#!/usr/bin/env node

// src/assets/scripts/hooks/json-helper.cjs
// Provides jq-equivalent operations for hooks when jq is not installed, and the
// learning ops the Learning agent runs from the project root.
// SECURITY: This is a local CLI helper invoked only by shell hooks and the
// Learning agent with controlled arguments. No operation takes a file path: a
// file's content arrives on stdin (json-parse redirects it), and the learning ops
// build every path from the current directory.
// Usage: node json-helper.cjs <operation> [args...]
//
// Operations:
//   get-field <field> [default]           Read field from stdin JSON
//   extract-cwd-field <field>             Extract cwd + arbitrary field, SOH-byte delimited
//   session-output <context>              Build SessionStart output envelope
//   prompt-output <context>               Build UserPromptSubmit output envelope
//   backup-construct                      Build pre-compact backup JSON from --arg pairs
//   assign-anchor <decision|pitfall> <obs_id>
//                                          Promote a v2 observation to the next ADR/PF number,
//                                          skipping numbers tracked files cite; re-renders
//   retire-anchor <anchor> <Encoded|Superseded|Retired|Deprecated>
//                                          Make an entry inactive with the one JSON object on
//                                          stdin its status takes; re-renders
//   restore-anchor <anchor>               Make an inactive entry active again and due for
//                                          maintenance again, ordered after integrity problems and
//                                          legacy entries (among them if it is one); re-renders
//   refresh-anchor <anchor>... [--verified]
//                                          Re-project active v2 entries from the log, or stamp
//                                          them verified today; re-renders
//   rotate-observations                   Archive unreferenced observations idle 30+ days
//   put-observation --create|--update|--reinforce
//                                          Store one observation from one JSON object on
//                                          stdin; re-projects and re-renders its entries
//   list                                  Read-only: print the ledger and the log by section
//   show <anchor|obs_id>                  Read-only: print one entry as pretty JSON
//   claim-due                             Hand out the entries due for maintenance, leased
//                                          for a day, after the ref their claims are checked at
//   claim-queue                           Claim the learning queue for this run; prints
//                                          claimed <token>[ takeover] | busy | none
//   release-claim <token>                 Release the claim the token owns; prints
//                                          released | not-owner | gone
//
// Every learning op above except claim-queue and release-claim first refreshes
// the mtime of an existing queue claim — the heartbeat (D-OWNED-CLAIM).

'use strict';

const fs = require('fs');
const { constants: { MAX_STRING_LENGTH } } = require('buffer');

const op = process.argv[2];
const args = process.argv.slice(3);

/** The learning modules, once loaded; see learning(). */
let learningModules = null;

/**
 * The learning store, loaded on first use and memoized. The generic ops never
 * call it, so a hook that falls back from jq to node never pays for loading it,
 * and the store loads the renderer only when an op renders.
 *
 * @returns {{ store: object }}
 */
function learning() {
  if (learningModules === null) {
    learningModules = { store: require('./lib/learning-store.cjs') };
  }
  return learningModules;
}

/** The bytes each read of stdin asks for. */
const STDIN_READ_BYTES = 64 * 1024;

/** How long a read of stdin sleeps when a non-blocking descriptor has no input yet. */
const STDIN_WAIT_MS = 10;

/** The most sleeps one read of stdin takes: 10 s in all, long after any writer the helper's callers use has written. */
const STDIN_MAX_WAITS = 1000;

/** What Atomics.wait sleeps on: nothing notifies it, so each wait runs its full time. */
const STDIN_WAIT_CELL = new Int32Array(new SharedArrayBuffer(4));

/**
 * Read stdin to its end, keeping at most `maxBytes`. Every op that reads stdin
 * reads it here, so the generic ops and the learning ops cannot read it two ways.
 * Never throws: a failure is a refusal.
 *
 * D-STDIN-FD0: stdin is read from file descriptor 0 itself, in reads repeated
 * until one returns no bytes — never by opening /dev/stdin, and never by the size
 * fstat reports. Reason: Linux opens /dev/stdin through /proc/self/fd/0, which
 * refuses a socket with ENXIO, and a node parent's 'pipe' hands its child a
 * socket; and for a pipe or a socket fstat reports only what is buffered so far,
 * 0 on Linux, not what the writer has still to send.
 *
 * A read of a non-blocking descriptor with no input yet fails with EAGAIN (Linux
 * and macOS give EWOULDBLOCK the same number, which node reports as EAGAIN). That
 * is not the end of the input: the reader sleeps STDIN_WAIT_MS and reads again,
 * at most STDIN_MAX_WAITS times in all. The loop is bounded: each pass takes at
 * least one byte, ends it, or spends one of those waits, and it stops once it
 * holds one byte more than `maxBytes`, so it never reads past that byte.
 *
 * @param {number} maxBytes
 * @returns {{ ok: true, value: string } | { ok: false, error: { kind: 'too-large' | 'unreadable', message: string } }}
 *   the text; or `too-large` when stdin holds more than `maxBytes`, `unreadable` when a read fails
 */
function readStdinUpTo(maxBytes) {
  const buf = Buffer.alloc(Math.min(STDIN_READ_BYTES, maxBytes + 1));
  const chunks = [];
  let total = 0;
  let waits = 0;
  while (total <= maxBytes) {
    let read;
    try {
      read = fs.readSync(0, buf, 0, Math.min(buf.length, maxBytes + 1 - total), null);
    } catch (err) {
      if (!err || err.code !== 'EAGAIN') {
        return { ok: false, error: { kind: 'unreadable', message: `stdin could not be read: ${err && err.message ? err.message : String(err)}` } };
      }
      if (waits === STDIN_MAX_WAITS) {
        return { ok: false, error: { kind: 'unreadable', message: `stdin could not be read: it had not ended after ${STDIN_MAX_WAITS * STDIN_WAIT_MS} ms of waiting for input` } };
      }
      waits += 1;
      Atomics.wait(STDIN_WAIT_CELL, 0, 0, STDIN_WAIT_MS);
      continue;
    }
    if (read === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, read)));
    total += read;
  }
  if (total > maxBytes) return { ok: false, error: { kind: 'too-large', message: `stdin holds more than ${maxBytes} bytes` } };
  return { ok: true, value: Buffer.concat(chunks, total).toString('utf8') };
}

/**
 * The most stdin a generic op reads: the longest string node can build. A hook's
 * input, a Stop hook's last assistant message among it, has no limit of its own,
 * so a generic op refuses only what it could not hold as text.
 */
const STDIN_TEXT_MAX_BYTES = MAX_STRING_LENGTH;

/** A generic op's stdin, trimmed: '' when it cannot be read, so the op fails as it does on empty input. */
function readStdin() {
  const text = readStdinUpTo(STDIN_TEXT_MAX_BYTES);
  return text.ok ? text.value.trim() : '';
}

function getNestedField(obj, field) {
  const parts = field.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function parseArgs(argList) {
  const result = {};
  for (let i = 0; i < argList.length; i++) {
    if (argList[i] === '--arg' && i + 2 < argList.length) {
      result[argList[i + 1]] = argList[i + 2];
      i += 2;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Learning-op adapter
// ---------------------------------------------------------------------------

/**
 * Print a learning op's Result: `format(value)` and a newline on stdout, or the
 * error message and a newline on stderr. Returns the exit code for the op to set
 * as process.exitCode, so the process exits once, after the op has returned and
 * every lock it took is released.
 *
 * @param {{ ok: true, value: unknown } | { ok: false, error: { message: string } }} result
 * @param {(value: any) => string} format - the stdout text for the value
 * @returns {0|1}
 */
function emit(result, format) {
  if (result.ok) {
    process.stdout.write(`${format(result.value)}\n`);
    return 0;
  }
  process.stderr.write(`${result.error.message}\n`);
  return 1;
}

/**
 * Refuse a malformed command line: print `<op>: usage: <usage>` on stderr and exit 1,
 * before the op takes any lock.
 *
 * @param {string} usage - the usage text, starting with the op's name
 * @returns {never}
 */
function exitWithUsage(usage) {
  process.stderr.write(`${op}: usage: ${usage}\n`);
  process.exit(1);
}

/** The most stdin a learning op reads: far above any valid input, so a runaway writer is refused, not parsed. */
const STDIN_JSON_MAX_BYTES = 64 * 1024;

/**
 * A learning op's stdin as one JSON object: the one way text reaches a learning
 * op, so no field of it ever passes through argv or a shell word. Never throws.
 *
 * @param {string} opName - for the message
 * @returns {{ ok: true, value: object } | { ok: false, error: { kind: 'invalid-input', message: string } }}
 */
function readStdinJson(opName) {
  const refuse = message => ({ ok: false, error: { kind: 'invalid-input', message: `${opName}: ${message}` } });
  const text = readStdinUpTo(STDIN_JSON_MAX_BYTES);
  if (!text.ok) {
    return refuse(text.error.kind === 'too-large' ? `${text.error.message}; it must hold one JSON object` : text.error.message);
  }
  let value;
  try {
    value = JSON.parse(text.value);
  } catch {
    return refuse('stdin must hold one JSON object');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse('stdin must hold one JSON object');
  return { ok: true, value };
}

/** put-observation's flags and the store modes they name. */
const PUT_MODES = new Map([['--create', 'create'], ['--update', 'update'], ['--reinforce', 'reinforce']]);

/** The entry types assign-anchor takes. */
const ENTRY_TYPES = new Set(['decision', 'pitfall']);

/**
 * The learning ops whose run sends the claim heartbeat first (D-OWNED-CLAIM).
 * claim-queue and release-claim manage the claim themselves, and the generic ops
 * never touch it. A new learning op joins this set.
 */
const LEARNING_OPS = new Set([
  'assign-anchor', 'retire-anchor', 'restore-anchor', 'refresh-anchor', 'rotate-observations',
  'put-observation', 'list', 'show', 'claim-due',
]);

/** Send the claim heartbeat; a failure is reported on stderr and never stops the op. */
function heartbeat(root) {
  const beat = learning().store.touchClaim(root);
  if (!beat.ok) process.stderr.write(`${beat.error.message}\n`);
}

// The learning ops run from the project root and take no path to a learning file:
// each builds its paths from the current directory. Every op that writes takes the
// store's one learning lock through withDecisionsLock (D-ONE-LEARNING-LOCK) and
// refuses, creating nothing, when .devflow/learning/ is absent (D-NO-STRAY-TREE)
// or when it, or .devflow, is a symbolic link (D-NO-LINKED-TREE).
// A locked body returns its Result; emit prints it once the lock is released.
if (require.main === module) {
try {
  if (LEARNING_OPS.has(op)) heartbeat(process.cwd());
  switch (op) {
    case 'get-field': {
      const input = JSON.parse(readStdin());
      const field = args[0];
      const def = args[1] || '';
      const val = getNestedField(input, field);
      console.log(val != null ? String(val) : def);
      break;
    }

    case 'extract-cwd-field': {
      // Extract cwd and an arbitrary top-level field from hook JSON in one pass.
      // Outputs: cwd + ASCII SOH (0x01) + field value (no trailing newline).
      // Caller splits with bash parameter expansion on $'\001' (bash 3.2 safe).
      const field = args[0];
      const input = JSON.parse(readStdin());
      const cwd = input.cwd || '';
      const value = (field && input[field]) || '';
      process.stdout.write(cwd + '\x01' + value);
      break;
    }

    case 'session-output': {
      const ctx = args[0];
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: ctx,
        },
      }));
      break;
    }

    case 'prompt-output': {
      const ctx = args[0];
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: ctx,
        },
      }));
      break;
    }

    case 'backup-construct': {
      const data = parseArgs(args);
      console.log(JSON.stringify({
        timestamp: data.ts || '',
        trigger: 'pre-compact',
        memory_snapshot: data.memory || '',
        git: {
          branch: data.branch || '',
          status: data.status || '',
          log: data.log || '',
          diff_stat: data.diff || '',
        },
      }, null, 2));
      break;
    }

    // -------------------------------------------------------------------------
    // assign-anchor <decision|pitfall> <obs_id>
    // Promote a v2 observation no ledger row carries to the next entry of its
    // type, skipping each number a tracked file cites (assignAnchor,
    // learning-store.cjs: D-LEDGER-REGISTRY, D-E4-SKIP). It never writes the log.
    // stdout: the anchor; stderr: `assign-anchor: skipped <anchor>, cited in
    // <path>:<line>` for each number skipped
    // -------------------------------------------------------------------------
    case 'assign-anchor': {
      const { store } = learning();
      if (args.length !== 2 || !ENTRY_TYPES.has(args[0]) || !store.OBS_ID_RE.test(args[1])) {
        exitWithUsage('assign-anchor <decision|pitfall> <obs_id> (run from the project root)');
      }
      const result = store.assignAnchor(process.cwd(), args[0], args[1]);
      if (result.ok) {
        for (const skip of result.value.skipped) {
          process.stderr.write(`assign-anchor: skipped ${skip.anchor_id}, cited in ${store.singleLine(skip.file)}:${skip.line}\n`);
        }
      }
      process.exitCode = emit(result, assigned => assigned.anchor_id);
      break;
    }

    // -------------------------------------------------------------------------
    // retire-anchor <anchor> <Encoded|Superseded|Retired|Deprecated>
    // Make an active entry inactive with the one JSON object on stdin its status
    // takes: { reason } for Retired and Deprecated, { by } for Superseded, and
    // { at, quote } for Encoded, the quote checked at the verify ref
    // (retireAnchor, learning-store.cjs: D-ENCODED-QUOTE).
    // stdout: the new status in lower case and the anchor, then `repointed
    // <anchor>` for each entry re-pointed to the successor
    // -------------------------------------------------------------------------
    case 'retire-anchor': {
      const { store } = learning();
      if (args.length !== 2 || !store.ANCHOR_ID_RE.test(args[0]) || !store.INACTIVE_STATUSES.includes(args[1])) {
        exitWithUsage('retire-anchor <anchor> <Encoded|Superseded|Retired|Deprecated> (one JSON object on stdin; run from the project root)');
      }
      const input = readStdinJson('retire-anchor');
      const result = input.ok ? store.retireAnchor(process.cwd(), args[0], args[1], input.value) : input;
      process.exitCode = emit(result, retired => [
        `${retired.status.toLowerCase()} ${retired.anchor_id}`,
        ...retired.repointed.map(anchorId => `repointed ${anchorId}`),
      ].join('\n'));
      break;
    }

    // -------------------------------------------------------------------------
    // restore-anchor <anchor>
    // Make an inactive entry active again, its notes, last_verified and
    // last_attempt cleared so it is due for maintenance again, ordered after
    // integrity problems and legacy entries, or among them when it is one
    // (restoreAnchor, learning-store.cjs: D-DUE-ORDER).
    // stdout: restored <anchor>
    // -------------------------------------------------------------------------
    case 'restore-anchor': {
      const { store } = learning();
      if (args.length !== 1 || !store.ANCHOR_ID_RE.test(args[0])) {
        exitWithUsage('restore-anchor <anchor> (run from the project root)');
      }
      process.exitCode = emit(store.restoreAnchor(process.cwd(), args[0]), restored => `restored ${restored.anchor_id}`);
      break;
    }

    // -------------------------------------------------------------------------
    // refresh-anchor <anchor> [<anchor>...] [--verified]
    // Re-project active v2 entries from their log rows, or under --verified stamp
    // them verified today; all or nothing (refreshAnchors, learning-store.cjs).
    // stdout: `reprojected <anchor>` or `unchanged <anchor>` per anchor, or
    // `verified <anchor>` under --verified, in the order given
    // -------------------------------------------------------------------------
    case 'refresh-anchor': {
      const { store } = learning();
      const verifiedFlags = args.filter(arg => arg === '--verified').length;
      const anchors = args.filter(arg => arg !== '--verified');
      if (verifiedFlags > 1 || anchors.length === 0 || !anchors.every(arg => store.ANCHOR_ID_RE.test(arg))) {
        exitWithUsage('refresh-anchor <anchor> [<anchor>...] [--verified] (run from the project root)');
      }
      const result = store.refreshAnchors(process.cwd(), anchors, { verified: verifiedFlags === 1 });
      process.exitCode = emit(result, ({ refreshed }) => refreshed.map(entry => `${entry.state} ${entry.anchor_id}`).join('\n'));
      break;
    }

    // -------------------------------------------------------------------------
    // rotate-observations
    // Archive the log rows no ledger row carries once 30 days have passed since
    // their last activity, and delete the usage telemetry's leftovers
    // (D-ROTATE-UNREFERENCED, learning-store.cjs). Takes no argument: the log and
    // the archive are the project root's.
    // stdout: rotated <N> observations
    // -------------------------------------------------------------------------
    case 'rotate-observations': {
      if (args.length > 0) exitWithUsage('rotate-observations (no arguments; run from the project root)');
      const result = learning().store.rotateObservations(process.cwd());
      process.exitCode = emit(result, ({ rotated }) => `rotated ${rotated} observations`);
      break;
    }

    // -------------------------------------------------------------------------
    // put-observation --create|--update|--reinforce
    // Store one observation from the JSON object on stdin (D-PUT-NOT-MERGE,
    // D-PUT-REPROJECTS, learning-store.cjs). Exactly one mode flag; no other argv.
    // stdout: created <id> | updated <id> | unchanged <id> | reinforced <id> <n>,
    // then one `reprojected <anchor>` line per entry re-projected
    // -------------------------------------------------------------------------
    case 'put-observation': {
      const mode = args.length === 1 ? PUT_MODES.get(args[0]) : undefined;
      if (mode === undefined) {
        exitWithUsage('put-observation --create|--update|--reinforce (one JSON object on stdin; run from the project root)');
      }
      const input = readStdinJson('put-observation');
      const result = input.ok ? learning().store.putObservation(process.cwd(), mode, input.value) : input;
      process.exitCode = emit(result, put => [
        put.outcome === 'reinforced' ? `reinforced ${put.id} ${put.observations}` : `${put.outcome} ${put.id}`,
        ...put.reprojected.map(anchorId => `reprojected ${anchorId}`),
      ].join('\n'));
      break;
    }

    // -------------------------------------------------------------------------
    // list
    // Print the ledger and the log by section, read-only (readListing and
    // formatListing, learning-store.cjs). Takes no argument.
    // stdout: the ACTIVE, INACTIVE, OBSERVATIONS and INTEGRITY sections, then
    // MALFORMED when lines were skipped
    // -------------------------------------------------------------------------
    case 'list': {
      if (args.length > 0) exitWithUsage('list (no arguments; run from the project root)');
      const { store } = learning();
      process.exitCode = emit(store.readListing(process.cwd()), store.formatListing);
      break;
    }

    // -------------------------------------------------------------------------
    // show <anchor|obs_id>
    // Print one entry, read-only (showByKey, learning-store.cjs).
    // stdout: pretty JSON { key, ledger, log, history_versions, flags }, plus
    // malformed when lines were skipped
    // -------------------------------------------------------------------------
    case 'show': {
      const { store } = learning();
      if (args.length !== 1 || !(store.ANCHOR_ID_RE.test(args[0]) || store.OBS_ID_RE.test(args[0]))) {
        exitWithUsage('show <anchor|obs_id> (run from the project root)');
      }
      process.exitCode = emit(store.showByKey(process.cwd(), args[0]), shown => JSON.stringify(shown, null, 2));
      break;
    }

    // -------------------------------------------------------------------------
    // claim-due
    // Hand out the entries due for maintenance and lease each for a day
    // (claimDue, learning-store.cjs: D-DUE-ORDER, D-VERIFY-REF). Takes no argument.
    // stdout: ref <origin/HEAD|HEAD> <sha12>, or ref none; then one
    // `<anchor> <reason> <bytes>` line per entry handed out, or due none
    // -------------------------------------------------------------------------
    case 'claim-due': {
      if (args.length > 0) exitWithUsage('claim-due (no arguments; run from the project root)');
      const { store } = learning();
      process.exitCode = emit(store.claimDue(process.cwd()), ({ ref, due }) => [
        ref === null ? 'ref none' : `ref ${ref.ref} ${ref.commit.slice(0, 12)}`,
        ...(due.length > 0 ? due.map(entry => `${store.singleLine(entry.anchor_id)} ${entry.reason} ${entry.bytes}`) : ['due none']),
      ].join('\n'));
      break;
    }

    // -------------------------------------------------------------------------
    // claim-queue
    // Claim the learning queue for this run (D-OWNED-CLAIM, learning-store.cjs).
    // Takes no argument; mints the token itself.
    // stdout: claimed <token> | claimed <token> takeover | busy | none
    // -------------------------------------------------------------------------
    case 'claim-queue': {
      if (args.length > 0) exitWithUsage('claim-queue (no arguments; run from the project root)');
      const result = learning().store.claimQueue(process.cwd());
      process.exitCode = emit(result, claim => (claim.state === 'claimed'
        ? `claimed ${claim.token}${claim.takeover ? ' takeover' : ''}`
        : claim.state));
      break;
    }

    // -------------------------------------------------------------------------
    // release-claim <token>
    // Release the claim the token owns (D-OWNED-CLAIM, learning-store.cjs).
    // stdout: released | not-owner | gone
    // -------------------------------------------------------------------------
    case 'release-claim': {
      const { store } = learning();
      if (args.length !== 1 || !store.CLAIM_TOKEN_RE.test(args[0])) {
        exitWithUsage('release-claim <token> (the 16 hex characters claim-queue printed)');
      }
      process.exitCode = emit(store.releaseClaim(process.cwd(), args[0]), release => release.state);
      break;
    }

    default:
      process.stderr.write(`json-helper: unknown operation "${op}"\n`);
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`json-helper error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
}
} // end if (require.main === module)
