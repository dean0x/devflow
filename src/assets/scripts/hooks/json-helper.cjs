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
//   validate                              Exit 0 if stdin is valid JSON, 1 otherwise
//   compact                               Compact stdin JSON to single line
//   construct <json-template> [--arg k v] Build JSON object with args
//   update-field <field> <value> [--json] Set field on stdin JSON (--json parses value)
//   update-fields <json-patches>          Apply multiple field updates from stdin JSON
//   extract-cwd-field <field>             Extract cwd + arbitrary field, SOH-byte delimited
//   extract-text-messages                 Extract text content from Claude message format
//   merge-evidence                        Flatten, dedupe, limit to 10 from stdin JSON
//   slurp-sort <field> [limit]            Read stdin JSONL, sort by field desc, limit results
//   slurp-cap <field> [limit]             Read stdin JSONL, sort by field desc, output limit lines
//   array-length <path>                   Get length of array at dotted path in stdin JSON
//   array-item <path> <index>             Get item at index from array at path in stdin JSON
//   session-output <context>              Build SessionStart output envelope
//   prompt-output <context>               Build UserPromptSubmit output envelope
//   backup-construct                      Build pre-compact backup JSON from --arg pairs
//   assign-anchor <decision|pitfall> <obs_id>
//                                          Promote a v2 observation to the next ADR/PF number,
//                                          skipping numbers tracked files cite; re-renders
//   retire-anchor <anchor_id> <status>    Flip ledger row status, re-render both .md files
//   refresh-anchor <anchor_id>            Re-project log obs onto ledger row, re-render
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

const op = process.argv[2];
const args = process.argv.slice(3);

/** The learning modules, once loaded; see learning(). */
let learningModules = null;

/**
 * The learning modules — the store, the path helpers, the formatter and the
 * renderer — loaded on first use and memoized. The generic ops never call it, so
 * a hook that falls back from jq to node never pays for loading them.
 *
 * @returns {{ store: object, paths: object, format: object, render: object }}
 */
function learning() {
  if (learningModules === null) {
    learningModules = {
      store: require('./lib/learning-store.cjs'),
      paths: require('./lib/project-paths.cjs'),
      format: require('./lib/decisions-format.cjs'),
      render: require('./lib/render-decisions.cjs'),
    };
  }
  return learningModules;
}

function readStdin() {
  try {
    return fs.readFileSync('/dev/stdin', 'utf8').trim();
  } catch {
    return '';
  }
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

/** The JSON values of a JSONL text's lines; a line that does not parse is skipped. */
function parseJsonlText(text) {
  const lines = text.split('\n').filter(Boolean);
  return lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function parseArgs(argList) {
  const result = {};
  const jsonArgs = {};
  for (let i = 0; i < argList.length; i++) {
    if (argList[i] === '--arg' && i + 2 < argList.length) {
      result[argList[i + 1]] = argList[i + 2];
      i += 2;
    } else if (argList[i] === '--argjson' && i + 2 < argList.length) {
      try {
        jsonArgs[argList[i + 1]] = JSON.parse(argList[i + 2]);
      } catch {
        jsonArgs[argList[i + 1]] = argList[i + 2];
      }
      i += 2;
    }
  }
  return { ...result, ...jsonArgs };
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

/** The most stdin a learning op reads: far above any valid input, so a runaway writer is refused, not parsed. */
const STDIN_JSON_MAX_BYTES = 64 * 1024;

/**
 * Read stdin from file descriptor 0, keeping at most `maxBytes`. It reads the
 * descriptor itself: opening /dev/stdin fails on macOS when stdin is a socket, as
 * a spawned process's is. The loop is bounded: each read takes at least one byte
 * or ends it, and it ends once the buffer holds one byte more than `maxBytes`.
 *
 * @param {number} maxBytes
 * @returns {string|null} the text, or null when stdin holds more than `maxBytes`
 */
function readStdinUpTo(maxBytes) {
  const buf = Buffer.alloc(maxBytes + 1);
  let total = 0;
  while (total < buf.length) {
    const read = fs.readSync(0, buf, total, buf.length - total, null);
    if (read === 0) break;
    total += read;
  }
  return total > maxBytes ? null : buf.toString('utf8', 0, total);
}

/**
 * A learning op's stdin as one JSON object: the one way text reaches a learning
 * op, so no field of it ever passes through argv or a shell word. Never throws.
 *
 * @param {string} opName - for the message
 * @returns {{ ok: true, value: object } | { ok: false, error: { kind: 'invalid-input', message: string } }}
 */
function readStdinJson(opName) {
  const refuse = message => ({ ok: false, error: { kind: 'invalid-input', message: `${opName}: ${message}` } });
  let text;
  try {
    text = readStdinUpTo(STDIN_JSON_MAX_BYTES);
  } catch (err) {
    return refuse(`stdin could not be read: ${err && err.message ? err.message : String(err)}`);
  }
  if (text === null) return refuse(`stdin holds more than ${STDIN_JSON_MAX_BYTES} bytes; it must hold one JSON object`);
  let value;
  try {
    value = JSON.parse(text);
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
  'assign-anchor', 'retire-anchor', 'refresh-anchor', 'rotate-observations',
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
// refuses, creating nothing, when .devflow/learning/ is absent (D-NO-STRAY-TREE).
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

    case 'validate': {
      try {
        const text = readStdin();
        if (!text) process.exit(1);
        JSON.parse(text);
        process.exit(0);
      } catch {
        process.exit(1);
      }
      break;
    }

    case 'compact': {
      const input = JSON.parse(readStdin());
      console.log(JSON.stringify(input));
      break;
    }

    case 'construct': {
      // Build JSON from --arg/--argjson pairs
      const template = parseArgs(args);
      console.log(JSON.stringify(template));
      break;
    }

    case 'update-field': {
      const input = JSON.parse(readStdin());
      const field = args[0];
      const value = args[1];
      const isJson = args[2] === '--json';
      input[field] = isJson ? JSON.parse(value) : value;
      console.log(JSON.stringify(input));
      break;
    }

    case 'update-fields': {
      // Read stdin JSON, apply field updates from args: field1=val1 field2=val2
      const input = JSON.parse(readStdin());
      for (const arg of args) {
        const eqIdx = arg.indexOf('=');
        if (eqIdx > 0) {
          const key = arg.slice(0, eqIdx);
          const val = arg.slice(eqIdx + 1);
          // Try to parse as JSON, fall back to string
          try { input[key] = JSON.parse(val); } catch { input[key] = val; }
        }
      }
      console.log(JSON.stringify(input));
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

    case 'extract-text-messages': {
      const input = JSON.parse(readStdin());
      const content = input?.message?.content;
      if (typeof content === 'string') {
        console.log(content);
        break;
      }
      if (!Array.isArray(content)) {
        console.log('');
        break;
      }
      const texts = content
        .filter(c => c.type === 'text')
        .map(c => c.text);
      console.log(texts.join('\n'));
      break;
    }

    case 'merge-evidence': {
      const input = JSON.parse(readStdin());
      // input is [[old_evidence], [new_evidence]] — flatten, dedupe, limit
      const flat = input.flat();
      const unique = [...new Set(flat)];
      console.log(JSON.stringify(unique.slice(0, 10)));
      break;
    }

    case 'slurp-sort': {
      const field = args[0];
      const limit = parseInt(args[1]) || 30;
      const parsed = parseJsonlText(readStdin());
      parsed.sort((a, b) => (b[field] || 0) - (a[field] || 0));
      console.log(JSON.stringify(parsed.slice(0, limit)));
      break;
    }

    case 'slurp-cap': {
      // Read JSONL, sort by field desc, output top N as JSONL (one per line)
      const field = args[0];
      const limit = parseInt(args[1]) || 100;
      const parsed = parseJsonlText(readStdin());
      parsed.sort((a, b) => (b[field] || 0) - (a[field] || 0));
      for (const item of parsed.slice(0, limit)) {
        console.log(JSON.stringify(item));
      }
      break;
    }

    case 'array-length': {
      const input = JSON.parse(readStdin());
      const dotPath = args[0];
      const arr = getNestedField(input, dotPath);
      console.log(Array.isArray(arr) ? arr.length : 0);
      break;
    }

    case 'array-item': {
      const input = JSON.parse(readStdin());
      const dotPath = args[0];
      const index = parseInt(args[1]);
      const arr = getNestedField(input, dotPath);
      if (Array.isArray(arr) && index >= 0 && index < arr.length) {
        console.log(JSON.stringify(arr[index]));
      } else {
        console.log('null');
      }
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
        process.stderr.write('assign-anchor: usage: assign-anchor <decision|pitfall> <obs_id> (run from the project root)\n');
        process.exit(1);
      }
      const aaResult = store.assignAnchor(process.cwd(), args[0], args[1]);
      if (aaResult.ok) {
        for (const skip of aaResult.value.skipped) {
          process.stderr.write(`assign-anchor: skipped ${skip.anchor_id}, cited in ${store.singleLine(skip.file)}:${skip.line}\n`);
        }
      }
      process.exitCode = emit(aaResult, assigned => assigned.anchor_id);
      break;
    }

    // -------------------------------------------------------------------------
    // retire-anchor <anchor_id> <status>
    // AC-A3, AC-F5, AC-F7: Flip decisions_status on the ledger row. Idempotent.
    // Re-renders both .md (retired entry vanishes from .md, stays in ledger).
    //
    // status must be Deprecated | Superseded | Retired.
    // -------------------------------------------------------------------------
    case 'retire-anchor': {
      const retireAnchorId = args[0];
      const retireStatus = args[1];

      const RETIRE_STATUSES = new Set(['Deprecated', 'Superseded', 'Retired']);

      if (!retireAnchorId || !retireStatus) {
        process.stderr.write('retire-anchor: usage: retire-anchor <anchor_id> <status>\n');
        process.exit(1);
      }
      if (!RETIRE_STATUSES.has(retireStatus)) {
        process.stderr.write(`retire-anchor: status must be Deprecated|Superseded|Retired, got '${retireStatus}'\n`);
        process.exit(1);
      }

      const { store, paths, render } = learning();
      const raProjectRoot = process.cwd();
      const raLedgerPath = paths.getDecisionsLedgerPath(raProjectRoot);

      const raResult = store.withDecisionsLock('retire-anchor', raProjectRoot, () => {
        const raRows = render.parseLedger(raLedgerPath);
        const raIdx = raRows.findIndex(r => r.anchor_id === retireAnchorId);
        if (raIdx === -1) {
          throw new Error(`retire-anchor: anchor_id '${retireAnchorId}' not found in ledger`);
        }

        // Idempotent: if already set to same status, still write (no-op equivalent)
        raRows[raIdx] = Object.assign({}, raRows[raIdx], { decisions_status: retireStatus });
        store.writeJsonlAtomic(raLedgerPath, raRows);

        // Re-render both .md (lock-free — we already hold .decisions.lock)
        render.renderAndWriteAll(raProjectRoot, raRows);
        return { ok: true, value: retireAnchorId };
      });
      // stdout: the anchor id, matching the other ops (CON-P1)
      process.exitCode = emit(raResult, anchorId => anchorId);
      break;
    }

    // -------------------------------------------------------------------------
    // refresh-anchor <anchor_id> [<anchor_id>...]
    // Re-project log observations onto committed ledger rows (D-LOG-CONTENT-AUTHORITY) and
    // re-render all three files (decisions.md, pitfalls.md, index.md).  Each write
    // is atomic; the sequence is not transactional — a crash between writes self-heals
    // on the next ledger op.  Variadic — accepts 1..N anchor ids and performs
    // ONE lock acquisition, ONE ledger parse, ONE log parse, and ONE render
    // (PERF-1: collapses N agent turns into 1, N re-renders into 1).
    //
    // All-or-nothing semantics: every anchor is validated before any write;
    // a throw on any anchor leaves the ledger and .md files untouched.
    //
    // Algorithm:
    //   1. Read ledger and log ONCE (outside the per-anchor loop).
    //   2. For each anchor: locate ledger row, run precondition checks, run
    //      REG-1 details divergence guard (consumers match anchor headings not
    //      titles so pattern replacement is sanctioned; only details containment is enforced),
    //      re-project via toLedgerRow (which carries sink validation for pattern/raw_body/type).
    //   3. Assert row count unchanged (REL-6 — bounds parseLedger silent-drop exposure).
    //   4. Write ledger once, render once, echo all ids to stdout (one per line).
    // -------------------------------------------------------------------------
    case 'refresh-anchor': {
      const refreshAnchorIds = args.filter(Boolean);

      if (refreshAnchorIds.length === 0) {
        process.stderr.write('refresh-anchor: usage: refresh-anchor <anchor_id> [<anchor_id>...]\n');
        process.exit(1);
      }

      const { store, paths, format, render } = learning();
      const rfProjectRoot = process.cwd();
      const rfLedgerPath = paths.getDecisionsLedgerPath(rfProjectRoot);
      const rfLogPath = paths.getDecisionsLogPath(rfProjectRoot);

      const rfResult = store.withDecisionsLock('refresh-anchor', rfProjectRoot, () => {
        // SEC-S3: a learning tree with no ledger has nothing to refresh; say so,
        // naming the ledger, rather than reporting each anchor as not found.
        if (!fs.existsSync(rfLedgerPath)) {
          throw new Error(
            `refresh-anchor: no decisions-ledger.jsonl found at '${rfLedgerPath}' — ` +
            `cannot refresh an entry where no ledger exists`
          );
        }

        // (1) Read ledger and log ONCE — shared across all anchor ids (PERF-1).
        const rfLedgerRows = render.parseLedger(rfLedgerPath);
        const rfExpectedRowCount = rfLedgerRows.length;
        const rfLogEntries = render.parseLedger(rfLogPath);

        // (2) Validate and re-project each anchor — all-or-nothing: any throw
        //     propagates out of withDecisionsLock's fn() before any write occurs.
        for (const anchorId of refreshAnchorIds) {
          // Locate the existing ledger row by anchor_id (stable, canonical key).
          // Miss → throw (not process.exit, which would skip the lock release).
          const rfLedgerIdx = rfLedgerRows.findIndex(r => r.anchor_id === anchorId);
          if (rfLedgerIdx === -1) {
            throw new Error(
              `refresh-anchor: anchor_id '${anchorId}' not found in ledger — ` +
              `cannot refresh a row that was never committed`
            );
          }

          const rfExistingRow = rfLedgerRows[rfLedgerIdx];

          // Precondition assertions — checked under the lock (assert-preconditions
          // per reliability rule). Mirrors assign-anchor's pattern.
          // (a) Ledger row must have an id — undefined===undefined would bind the wrong log row.
          if (!rfExistingRow.id) {
            throw new Error(
              `refresh-anchor: ledger row '${anchorId}' has no id — ` +
              `cannot resolve its log observation`
            );
          }
          // (b) Ledger row must have decisions_status — toLedgerRow passes it through;
          //     absent would cause JSON.stringify to drop the key from the projected row.
          if (!rfExistingRow.decisions_status) {
            throw new Error(
              `refresh-anchor: ledger row '${anchorId}' has no decisions_status — ` +
              `refusing to project a row that would drop it`
            );
          }

          // Locate the log obs by the LEDGER ROW's id field (D-LOG-CONTENT-AUTHORITY).
          // Matching on id (not anchor_id) covers pre-existing obs written before
          // assign-anchor added anchor_id write-back to the log.
          const rfObs = rfLogEntries.find(r => r.id === rfExistingRow.id);
          if (!rfObs) {
            throw new Error(
              `refresh-anchor: log obs with id '${rfExistingRow.id}' ` +
              `(for anchor ${anchorId}) not found in log`
            );
          }

          // (c) Type must match the committed anchor — re-projecting across types would move
          //     a PF-NNN into decisions.md (or vice versa) and corrupt the rendered corpus.
          //     This check also satisfies toLedgerRow's sink-side expectType guard;
          //     both fire with their respective messages — this one fires first.
          if (rfObs.type !== rfExistingRow.type) {
            throw new Error(
              `refresh-anchor: log obs '${rfObs.id}' type '${rfObs.type}' does not match committed anchor ` +
              `${anchorId} type '${rfExistingRow.type}' — refusing to re-project across entry types`
            );
          }

          // REG-1: divergence guard — refuse to silently overwrite
          // ledger-only curation content. Applies to DETAILS only: pattern replacement
          // is sanctioned (consumers match '## (ADR|PF)-NNN:' anchors, never
          // titles, so a sharpened log pattern may update the rendered heading).
          // raw_body is validated at the sink, by isSafeRawBody inside toLedgerRow.
          const rfNormWS = (/** @type {unknown} */ s) =>
            typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
          const rfLedgerDetails = rfNormWS(rfExistingRow.details);
          const rfLogDetails = rfNormWS(rfObs.details);
          if (rfLedgerDetails && !rfLogDetails.includes(rfLedgerDetails)) {
            throw new Error(
              `refresh-anchor: ledger row '${anchorId}' carries content absent from log obs ` +
              `'${rfExistingRow.id}' (details: ledger ${rfLedgerDetails.length}B / log ${rfLogDetails.length}B). ` +
              `Reconcile the log row first — re-projecting would discard curated content.`
            );
          }

          // Re-project via toLedgerRow (strict canonical projection, D-LOG-CONTENT-AUTHORITY).
          // Preserve decisions_status and date from the ledger (ledger-owned fields).
          // expectType passed for sink validation (redundant with the check above,
          // but ensures the guard holds even if future callers bypass the outer check).
          rfLedgerRows[rfLedgerIdx] = format.toLedgerRow(rfObs, {
            anchorId,
            status: rfExistingRow.decisions_status,
            date: rfExistingRow.date,
            expectType: rfExistingRow.type,
          });
        }

        // (3) REL-6: assert row count unchanged — bounds parseLedger silent-drop
        //     exposure. A whole-file rewrite that shrank the corpus is always a bug.
        if (rfLedgerRows.length !== rfExpectedRowCount) {
          throw new Error(
            `refresh-anchor: ledger row count changed during re-projection ` +
            `(${rfExpectedRowCount} → ${rfLedgerRows.length}) — refusing to write a lossy rewrite`
          );
        }

        // (4) Write once and render once (PERF-1 — N anchors, one I/O round-trip).
        store.writeJsonlAtomic(rfLedgerPath, rfLedgerRows);
        render.renderAndWriteAll(rfProjectRoot, rfLedgerRows);
        return { ok: true, value: refreshAnchorIds };
      });
      // stdout: every refreshed id, one per line, mirroring assign-anchor's contract,
      // so a caller can confirm which rows were refreshed without parsing stderr.
      process.exitCode = emit(rfResult, ids => ids.join('\n'));
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
      if (args.length > 0) {
        process.stderr.write('rotate-observations: usage: rotate-observations (no arguments; run from the project root)\n');
        process.exit(1);
      }
      const roResult = learning().store.rotateObservations(process.cwd());
      process.exitCode = emit(roResult, ({ rotated }) => `rotated ${rotated} observations`);
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
      const poMode = args.length === 1 ? PUT_MODES.get(args[0]) : undefined;
      if (poMode === undefined) {
        process.stderr.write('put-observation: usage: put-observation --create|--update|--reinforce (one JSON object on stdin; run from the project root)\n');
        process.exit(1);
      }
      const poInput = readStdinJson('put-observation');
      const poResult = poInput.ok ? learning().store.putObservation(process.cwd(), poMode, poInput.value) : poInput;
      process.exitCode = emit(poResult, put => [
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
      if (args.length > 0) {
        process.stderr.write('list: usage: list (no arguments; run from the project root)\n');
        process.exit(1);
      }
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
        process.stderr.write('show: usage: show <anchor|obs_id> (run from the project root)\n');
        process.exit(1);
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
      if (args.length > 0) {
        process.stderr.write('claim-due: usage: claim-due (no arguments; run from the project root)\n');
        process.exit(1);
      }
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
      if (args.length > 0) {
        process.stderr.write('claim-queue: usage: claim-queue (no arguments; run from the project root)\n');
        process.exit(1);
      }
      const cqResult = learning().store.claimQueue(process.cwd());
      process.exitCode = emit(cqResult, claim => (claim.state === 'claimed'
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
        process.stderr.write('release-claim: usage: release-claim <token> (the 16 hex characters claim-queue printed)\n');
        process.exit(1);
      }
      const rcResult = store.releaseClaim(process.cwd(), args[0]);
      process.exitCode = emit(rcResult, release => release.state);
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
