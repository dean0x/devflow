#!/usr/bin/env node

// src/assets/scripts/hooks/json-helper.cjs
// Provides jq-equivalent operations for hooks when jq is not installed.
// SECURITY: This is a local CLI helper invoked only by shell hooks with controlled arguments.
// File path arguments come from hook-owned variables, not from external/untrusted input.
// Usage: node json-helper.cjs <operation> [args...]
//
// Operations:
//   get-field <field> [default]           Read field from stdin JSON
//   get-field-file <file> <field> [def]   Read field from JSON file
//   validate                              Exit 0 if stdin is valid JSON, 1 otherwise
//   compact                               Compact stdin JSON to single line
//   construct <json-template> [--arg k v] Build JSON object with args
//   update-field <field> <value> [--json] Set field on stdin JSON (--json parses value)
//   update-fields <json-patches>          Apply multiple field updates from stdin JSON
//   extract-cwd-field <field>             Extract cwd + arbitrary field, SOH-byte delimited
//   extract-text-messages                 Extract text content from Claude message format
//   merge-evidence                        Flatten, dedupe, limit to 10 from stdin JSON
//   slurp-sort <file> <field> [limit]     Read JSONL, sort by field desc, limit results
//   slurp-cap <file> <field> <limit>      Read JSONL, sort by field desc, output limit lines
//   array-length <path>                   Get length of array at dotted path in stdin JSON
//   array-item <path> <index>             Get item at index from array at path in stdin JSON
//   session-output <context>              Build SessionStart output envelope
//   prompt-output <context>               Build UserPromptSubmit output envelope
//   backup-construct                      Build pre-compact backup JSON from --arg pairs
//   assign-anchor <type> <obs_id>         Claim next ADR/PF number, render both .md files
//   retire-anchor <anchor_id> <status>    Flip ledger row status, re-render both .md files
//   refresh-anchor <anchor_id>            Re-project log obs onto ledger row, re-render
//   rotate-observations [<log>] [<arch>]  Archive observing rows older than 30 days

'use strict';

const fs = require('fs');
const path = require('path');

const op = process.argv[2];
const args = process.argv.slice(3);

const { safePath } = require('./lib/safe-path.cjs');
const {
  getDecisionsUsagePath,
  getDecisionsLockDir,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getObservationsLockDir,
} = require('./lib/project-paths.cjs');
const {
  initDecisionsContent,
  toLedgerRow,
} = require('./lib/decisions-format.cjs');
const {
  renderAndWriteAll,
  parseLedger,
} = require('./lib/render-decisions.cjs');
const { acquireMkdirLock, releaseLock } = require('./lib/mkdir-lock.cjs');

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

function parseJsonl(file) {
  const lines = fs.readFileSync(safePath(file), 'utf8').trim().split('\n').filter(Boolean);
  return lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Strip leading YAML frontmatter from content that the model may have included
 * despite being told not to. Belt-and-suspenders defense against duplicate frontmatter.
 */
function stripLeadingFrontmatter(text) {
  if (!text) return '';
  const trimmed = text.replace(/^\s*\n/, '');
  if (!trimmed.startsWith('---')) return text;
  const match = trimmed.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? trimmed.slice(match[0].length) : text;
}

/**
 * Write `tmp` with O_EXCL (wx flag) so the kernel rejects the open if a file or
 * symlink already exists at that path, preventing TOCTOU symlink-follow attacks.
 * On EEXIST (stale or attacker-placed .tmp) we unlink and retry once.
 * @param {string} tmp - Path to the temporary file.
 * @param {string} content - Content to write.
 */
function writeExclusive(tmp, content) {
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Stale or attacker-placed .tmp — remove it and retry once.
    try { fs.unlinkSync(tmp); } catch { /* race — already removed */ }
    fs.writeFileSync(tmp, content, { flag: 'wx' });
  }
}

function writeJsonlAtomic(file, entries) {
  // PID-scope the tmp name so concurrent writers from different processes
  // never collide on the same .tmp path.  mirrors fs-atomic.ts and proxy-log.ts.
  const tmp = file + '.tmp.' + process.pid;
  const content = entries.length > 0
    ? entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  writeExclusive(tmp, content);
  fs.renameSync(tmp, file);
}

/** Atomically write a text file via a .tmp sibling and rename. */
function writeFileAtomic(file, content) {
  // PID-scope the tmp name so concurrent writers from different processes
  // never collide on the same .tmp path.  mirrors fs-atomic.ts and proxy-log.ts.
  const tmp = file + '.tmp.' + process.pid;
  writeExclusive(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * Compute the next anchor ID for the given type by scanning the anchored ledger.
 * O(anchored) — single pass. Includes ALL anchored rows (Retired, Deprecated, Superseded).
 * ADR and PF sequences are independent.
 *
 * @param {object[]} ledgerRows - All rows from the ledger (from parseLedger)
 * @param {'decision'|'pitfall'} type
 * @returns {{ anchorId: string, nextN: string }}
 */
function nextAnchorFromLedger(ledgerRows, type) {
  const prefix = type === 'decision' ? 'ADR' : 'PF';
  const prefixRe = new RegExp(`^${prefix}-`);
  let maxN = 0;
  for (const row of ledgerRows) {
    if (!row.anchor_id || !prefixRe.test(row.anchor_id)) continue;
    const m = row.anchor_id.match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    }
  }
  const nextN = (maxN + 1).toString().padStart(3, '0');
  return { anchorId: `${prefix}-${nextN}`, nextN };
}

/**
 * Read .decisions-usage.json. Returns {version, entries} or empty default.
 * @param {string} projectRoot - Path to project root (cwd)
 * @returns {{version: number, entries: Object}}
 */
function readUsageFile(projectRoot) {
  const filePath = getDecisionsUsagePath(projectRoot);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.version === 1 && typeof data.entries === 'object') return data;
  } catch { /* ENOENT or malformed — return default */ }
  return { version: 1, entries: {} };
}

/**
 * Write .decisions-usage.json atomically.
 * @param {string} projectRoot - Path to project root (cwd)
 * @param {{version: number, entries: Object}} data
 */
function writeUsageFile(projectRoot, data) {
  writeFileAtomic(getDecisionsUsagePath(projectRoot), JSON.stringify(data, null, 2) + '\n');
}

/**
 * Register an entry in .decisions-usage.json with initial cite count.
 * @param {string} projectRoot - Path to project root (cwd)
 * @param {string} anchorId - e.g. 'ADR-001' or 'PF-003'
 */
function registerUsageEntry(projectRoot, anchorId) {
  const data = readUsageFile(projectRoot);
  if (!data.entries[anchorId]) {
    data.entries[anchorId] = {
      cites: 0,
      last_cited: null,
      created: new Date().toISOString(),
    };
    writeUsageFile(projectRoot, data);
  }
}

/**
 * Internal rotation logic for rotate-observations. Separated for testability.
 * Moves rows where status === 'observing' AND no anchor_id AND age > 30 days
 * from logPath to archivePath (append). Returns count of rotated rows.
 *
 * @param {string} logPath - Path to decisions-log.jsonl
 * @param {string} archivePath - Path to decisions-log.archive.jsonl
 * @param {number} nowMs - Current time as epoch ms (injectable for tests)
 * @returns {number} count of rotated rows
 */
function rotateObservations(logPath, archivePath, nowMs) {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoffMs = nowMs - THIRTY_DAYS_MS;

  let logEntries = [];
  if (fs.existsSync(logPath)) {
    logEntries = parseLedger(logPath);
  }

  const kept = [];
  const stale = [];

  for (const row of logEntries) {
    // Only move 'observing' rows without anchor_id (unanchored)
    if (row.status !== 'observing' || row.anchor_id) {
      kept.push(row);
      continue;
    }
    // Check age using last_seen if present, else first_seen
    const tsField = row.last_seen || row.first_seen;
    if (!tsField) {
      kept.push(row);
      continue;
    }
    const rowMs = new Date(tsField).getTime();
    if (isNaN(rowMs) || rowMs > cutoffMs) {
      kept.push(row);
    } else {
      stale.push(row);
    }
  }

  if (stale.length === 0) return 0;

  // D003: Dedup stale rows against the existing archive by id before appending.
  // An interrupt-then-retry (process killed after archive write but before log
  // rewrite) would re-classify the same rows as stale and attempt to archive
  // them a second time. Reading existing archive IDs into a Set and filtering
  // prevents duplicate rows in the archive. Cost is O(archive) on retry; O(1)
  // on the normal path when the archive is absent.
  //
  // True append (appendFileSync) is used instead of read-entire-archive+rewrite
  // so cost is O(stale) rather than O(archive) on the write path. The archive
  // is gitignored/recovery-only, so an incomplete final newline on ENOENT is
  // safe — parseLedger handles trailing-newline variance.
  const existingArchiveIds = new Set();
  if (fs.existsSync(archivePath)) {
    const existingRows = parseLedger(archivePath);
    for (const r of existingRows) {
      if (r.id) existingArchiveIds.add(r.id);
    }
  }

  const newStale = stale.filter(r => !existingArchiveIds.has(r.id));
  if (newStale.length > 0) {
    // True append — O(newStale), not O(archive)
    const appendContent = newStale.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(archivePath, appendContent, 'utf8');
  }

  // Write remaining rows back to log
  writeJsonlAtomic(logPath, kept);

  return stale.length;
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
// Lock helpers — shared by the three decisions ledger ops (assign-anchor,
// retire-anchor, refresh-anchor). rotate-observations uses a DIFFERENT lock
// (.observations.lock) and keeps its own scaffold (avoids over-generalising).
// ---------------------------------------------------------------------------

/** Acquire-timeout for .decisions.lock (ms). Named to avoid magic numbers (COMP-4). */
const LOCK_ACQUIRE_TIMEOUT_MS = 30000;
/** Stale-break threshold for .decisions.lock (ms). Named to avoid magic numbers (COMP-4). */
const LOCK_STALE_MS = 60000;

/**
 * Run fn() under .decisions.lock.
 *
 * Never call process.exit() inside fn — throw instead (PF-014): the throw propagates
 * through the try/finally so releaseLock always runs. process.exit is reserved for
 * the acquire-failure path where no lock is held and no cleanup is needed.
 *
 * PF-013: parent directory of the lock dir is created before acquireMkdirLock is
 * called so a fresh-project cold-path does not throw ENOENT inside the lock lib.
 *
 * @param {string} opName - operation name for error messages
 * @param {string} projectRoot - project root (cwd)
 * @param {() => unknown} fn - body to execute under the lock
 */
function withDecisionsLock(opName, projectRoot, fn) {
  const lockDir = getDecisionsLockDir(projectRoot);
  // PF-013: ensure parent directory exists before acquiring lock
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  if (!acquireMkdirLock(lockDir, LOCK_ACQUIRE_TIMEOUT_MS, LOCK_STALE_MS)) {
    process.stderr.write(`${opName}: timeout acquiring lock at ${lockDir}\n`);
    process.exit(1);
  }
  try { return fn(); } finally { releaseLock(lockDir); }
}

/**
 * Serialize ledger rows to a JSONL string with trailing newline.
 * Extracted to avoid repeating the same expression at four sites (COMP-4).
 *
 * @param {object[]} rows
 * @returns {string}
 */
const serializeLedger = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

if (require.main === module) {
try {
  switch (op) {
    case 'get-field': {
      const input = JSON.parse(readStdin());
      const field = args[0];
      const def = args[1] || '';
      const val = getNestedField(input, field);
      console.log(val != null ? String(val) : def);
      break;
    }

    case 'get-field-file': {
      const file = safePath(args[0]);
      const field = args[1];
      const def = args[2] || '';
      const content = fs.readFileSync(file, 'utf8').trim();
      const input = JSON.parse(content);
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
      const file = args[0];
      const field = args[1];
      const limit = parseInt(args[2]) || 30;
      const parsed = parseJsonl(file);
      parsed.sort((a, b) => (b[field] || 0) - (a[field] || 0));
      console.log(JSON.stringify(parsed.slice(0, limit)));
      break;
    }

    case 'slurp-cap': {
      // Read JSONL, sort by field desc, output top N as JSONL (one per line)
      const file = args[0];
      const field = args[1];
      const limit = parseInt(args[2]) || 100;
      const parsed = parseJsonl(file);
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
    // assign-anchor <type> <obs_id>
    // AC-A2: Assign next anchor ID for the given type (decision|pitfall) to the
    // observation identified by obs_id in decisions-log.jsonl. Atomic under a
    // single .decisions.lock acquisition. Registers usage, re-renders both .md.
    //
    // Locking discipline: holds ONLY .decisions.lock (never .observations.lock).
    // O(anchored) — single pass for max numeric suffix (AC-P2).
    // -------------------------------------------------------------------------
    case 'assign-anchor': {
      const assignType = args[0]; // 'decision' or 'pitfall'
      const assignObsId = args[1];

      if (!assignType || !assignObsId) {
        process.stderr.write('assign-anchor: usage: assign-anchor <type> <obs_id>\n');
        process.exit(1);
      }
      if (assignType !== 'decision' && assignType !== 'pitfall') {
        process.stderr.write(`assign-anchor: type must be 'decision' or 'pitfall', got '${assignType}'\n`);
        process.exit(1);
      }

      const aaProjectRoot = process.cwd();
      const aaLedgerPath = getDecisionsLedgerPath(aaProjectRoot);
      const aaLogPath = getDecisionsLogPath(aaProjectRoot);

      withDecisionsLock('assign-anchor', aaProjectRoot, () => {
        // Read existing ledger (absent = empty)
        const aaLedgerRows = parseLedger(aaLedgerPath);

        // Compute next anchor — O(anchored), single pass
        const { anchorId: aaAnchorId } = nextAnchorFromLedger(aaLedgerRows, assignType);

        // Read observation from log
        let aaLogEntries = parseLedger(aaLogPath);
        const aaObsIdx = aaLogEntries.findIndex(e => e.id === assignObsId);
        if (aaObsIdx === -1) {
          throw new Error(`assign-anchor: obs_id '${assignObsId}' not found in ${aaLogPath}`);
        }
        const aaObs = aaLogEntries[aaObsIdx];

        // Precondition assertions — both checked under the lock so they are
        // race-free against concurrent assign-anchor callers (avoids silent
        // ledger corruption; assert-preconditions per reliability rule).
        //
        // (a) The newly computed anchor_id must not already appear in the ledger.
        //     nextAnchorFromLedger is deterministic-monotone, so this should
        //     never fire in normal operation — it guards against double-assign
        //     bugs (e.g. assign called twice for the same obs_id in a crash loop).
        if (aaLedgerRows.some(r => r.anchor_id === aaAnchorId)) {
          throw new Error(
            `assign-anchor: anchor_id '${aaAnchorId}' already present in ledger — ` +
            `possible double-assign; refusing to overwrite committed entry`
          );
        }
        //
        // (b) The target observation must not already have an anchor_id set.
        //     Re-anchoring an already-anchored obs would mint a duplicate number
        //     (the old anchor would remain in the ledger AND the new one would
        //     be added), corrupting the committed source of truth.
        if (aaObs.anchor_id) {
          throw new Error(
            `assign-anchor: obs_id '${assignObsId}' is already anchored as '${aaObs.anchor_id}'; ` +
            `use retire-anchor to change its status instead`
          );
        }

        // Build canonical committed-ledger row via toLedgerRow projector.
        // Whitelists only the canonical fields — excludes all observation-lifecycle
        // state (evidence, confidence, quality_ok, count, first_seen, last_seen, …)
        // that must stay in the log only. applies ADR-008.
        const aaDate = new Date().toISOString().slice(0, 10);
        const aaActiveStatus = assignType === 'decision' ? 'Accepted' : 'Active';
        // Date stamped on ALL entry types (decisions + pitfalls).  Prefer the
        // date from the observation (content authority per ADR-022); fall back
        // to today.  The old decision-only asymmetry is removed so that
        // refresh-anchor can re-project pitfall rows correctly (D3 / A3 fix).
        const aaEntryDate = aaObs.date || aaDate;
        const aaLedgerRow = toLedgerRow(aaObs, {
          anchorId: aaAnchorId,
          status: aaActiveStatus,
          date: aaEntryDate,
        });

        // Append anchored row to ledger (atomic temp+rename).
        //
        // D002: Crash window — if the process is killed between this write and
        // renderAndWriteAll below, the ledger will be ahead of decisions.md /
        // pitfalls.md. This is git-recoverable: the ledger is the source of
        // truth and `render-decisions.cjs render <worktree>` re-renders the
        // .md files. The render is kept as the FINAL write under the lock so
        // the window is as narrow as possible.
        const aaNewLedgerRows = [...aaLedgerRows, aaLedgerRow];
        writeFileAtomic(aaLedgerPath, serializeLedger(aaNewLedgerRows));

        // Mark log row as created and stamp anchor_id so guard (b) fires on
        // any subsequent assign-anchor call for the same obs_id.  Without this
        // write-back the guard is dead: aaObs.anchor_id would be undefined on
        // a re-read and a second assign would silently mint a duplicate number.
        // applies ADR-022 (log is content authority; anchor_id written back to arm guard).
        aaLogEntries[aaObsIdx] = Object.assign({}, aaObs, { status: 'created', anchor_id: aaAnchorId });
        writeJsonlAtomic(aaLogPath, aaLogEntries);

        // Register usage entry
        registerUsageEntry(aaProjectRoot, aaAnchorId);

        // Re-render both .md files (lock-free — we already hold .decisions.lock).
        // This is the FINAL write in the lock scope — see D002 above.
        renderAndWriteAll(aaProjectRoot, aaNewLedgerRows);

        // Print assigned anchor id to stdout
        process.stdout.write(aaAnchorId + '\n');
      });
      break;
    }

    // -------------------------------------------------------------------------
    // retire-anchor <anchor_id> <status>
    // AC-A3, AC-F5, AC-F7: Flip decisions_status on the ledger row. Idempotent.
    // Re-renders both .md (retired entry vanishes from .md, stays in ledger).
    //
    // status must be Deprecated | Superseded | Retired.
    // Locking discipline: holds ONLY .decisions.lock.
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

      const raProjectRoot = process.cwd();
      const raLedgerPath = getDecisionsLedgerPath(raProjectRoot);

      withDecisionsLock('retire-anchor', raProjectRoot, () => {
        const raRows = parseLedger(raLedgerPath);
        const raIdx = raRows.findIndex(r => r.anchor_id === retireAnchorId);
        if (raIdx === -1) {
          throw new Error(`retire-anchor: anchor_id '${retireAnchorId}' not found in ledger`);
        }

        // Idempotent: if already set to same status, still write (no-op equivalent)
        raRows[raIdx] = Object.assign({}, raRows[raIdx], { decisions_status: retireStatus });
        writeFileAtomic(raLedgerPath, serializeLedger(raRows));

        // Re-render both .md (lock-free — we already hold .decisions.lock)
        renderAndWriteAll(raProjectRoot, raRows);

        // Echo anchor_id to stdout matching the other three ops (CON-P1).
        process.stdout.write(retireAnchorId + '\n');
      });
      break;
    }

    // -------------------------------------------------------------------------
    // refresh-anchor <anchor_id> [<anchor_id>...]
    // ADR-022: Re-project log observations onto committed ledger rows and
    // re-render both .md files.  Variadic — accepts 1..N anchor ids and performs
    // ONE lock acquisition, ONE ledger parse, ONE log parse, and ONE render
    // (PERF-1: collapses N agent turns into 1, N re-renders into 1).
    //
    // All-or-nothing semantics: every anchor is validated before any write;
    // a throw on any anchor leaves the ledger and .md files untouched.
    //
    // Algorithm:
    //   1. Read ledger and log ONCE (outside the per-anchor loop).
    //   2. For each anchor: locate ledger row, run precondition checks, run
    //      REG-1 details divergence guard (pattern replacement is sanctioned
    //      per D3 — only details containment is enforced), re-project via
    //      toLedgerRow (which carries PF-023 sink validation for pattern/raw_body/type).
    //   3. Assert row count unchanged (REL-6 — bounds parseLedger silent-drop exposure).
    //   4. Write ledger once, render once, echo all ids to stdout (one per line).
    //
    // Locking discipline: holds ONLY .decisions.lock.
    // -------------------------------------------------------------------------
    case 'refresh-anchor': {
      const refreshAnchorIds = args.filter(Boolean);

      if (refreshAnchorIds.length === 0) {
        process.stderr.write('refresh-anchor: usage: refresh-anchor <anchor_id> [<anchor_id>...]\n');
        process.exit(1);
      }

      const rfProjectRoot = process.cwd();
      const rfLedgerPath = getDecisionsLedgerPath(rfProjectRoot);
      const rfLogPath = getDecisionsLogPath(rfProjectRoot);

      // SEC-S3: refuse when no ledger exists at the resolved project root. A refresh
      // is only valid for a project with a committed ledger — invoked from the wrong
      // cwd withDecisionsLock would otherwise silently materialise a stray
      // .devflow/learning/ tree before throwing 'not found in ledger'.
      if (!fs.existsSync(rfLedgerPath)) {
        throw new Error(
          `refresh-anchor: no decisions-ledger.jsonl found at '${rfLedgerPath}' — ` +
          `cannot refresh an entry where no ledger exists`
        );
      }

      withDecisionsLock('refresh-anchor', rfProjectRoot, () => {
        // (1) Read ledger and log ONCE — shared across all anchor ids (PERF-1).
        const rfLedgerRows = parseLedger(rfLedgerPath);
        const rfExpectedRowCount = rfLedgerRows.length;
        const rfLogEntries = parseLedger(rfLogPath);

        // (2) Validate and re-project each anchor — all-or-nothing: any throw
        //     propagates out of withDecisionsLock's fn() before any write occurs.
        for (const anchorId of refreshAnchorIds) {
          // Locate the existing ledger row by anchor_id (stable, canonical key).
          // Miss → throw (PF-014: throw, not process.exit, inside a lock scope).
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

          // Locate the log obs by the LEDGER ROW's id field (content authority, ADR-022).
          // Matching on id (not anchor_id) covers pre-existing obs written before
          // assign-anchor added anchor_id write-back to the log (avoids PF-041).
          const rfObs = rfLogEntries.find(r => r.id === rfExistingRow.id);
          if (!rfObs) {
            throw new Error(
              `refresh-anchor: log obs with id '${rfExistingRow.id}' ` +
              `(for anchor ${anchorId}) not found in log`
            );
          }

          // (c) Type must match the committed anchor — re-projecting across types would move
          //     a PF-NNN into decisions.md (or vice versa) and corrupt the rendered corpus.
          //     This check also satisfies toLedgerRow's expectType guard (PF-023 sink);
          //     both fire with their respective messages — this one fires first.
          if (rfObs.type !== rfExistingRow.type) {
            throw new Error(
              `refresh-anchor: log obs '${rfObs.id}' type '${rfObs.type}' does not match committed anchor ` +
              `${anchorId} type '${rfExistingRow.type}' — refusing to re-project across entry types`
            );
          }

          // REG-1 (avoids PF-044): divergence guard — refuse to silently overwrite
          // ledger-only curation content. Applies to DETAILS only: pattern replacement
          // is sanctioned per D3 (consumers match '## (ADR|PF)-NNN:' anchors, never
          // titles, so a sharpened log pattern may update the rendered heading).
          // raw_body is handled by isSafeRawBody inside toLedgerRow (PF-023 sink).
          const rfNormWS = (/** @type {unknown} */ s) =>
            typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
          const rfLedgerDetails = rfNormWS(rfExistingRow.details);
          const rfLogDetails = rfNormWS(rfObs.details);
          if (rfLedgerDetails && !rfLogDetails.includes(rfLedgerDetails)) {
            throw new Error(
              `refresh-anchor: ledger row '${anchorId}' carries content absent from log obs ` +
              `'${rfExistingRow.id}' (details: ledger ${rfLedgerDetails.length}B / log ${rfLogDetails.length}B). ` +
              `Reconcile the log row first — re-projecting would discard curated content (avoids PF-044).`
            );
          }

          // Re-project via toLedgerRow (strict canonical projection — ADR-022).
          // Preserve decisions_status and date from the ledger (ledger-owned fields).
          // expectType passed for PF-023 sink validation (redundant with the check above,
          // but ensures the guard holds even if future callers bypass the outer check).
          rfLedgerRows[rfLedgerIdx] = toLedgerRow(rfObs, {
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
        writeFileAtomic(rfLedgerPath, serializeLedger(rfLedgerRows));
        renderAndWriteAll(rfProjectRoot, rfLedgerRows);

        // Echo all refreshed ids to stdout — one per line, mirrors assign-anchor's
        // contract; callers can confirm which rows were refreshed without parsing stderr.
        process.stdout.write(refreshAnchorIds.join('\n') + '\n');
      });
      break;
    }

    // -------------------------------------------------------------------------
    // rotate-observations [<log>] [<archive>]
    // AC-F9, AC-P3: Move stale observing rows (>30 days old) to archive.
    // NEVER moves anchored or created/ready rows — only stale 'observing' rows.
    // Runs under .observations.lock (NOT .decisions.lock).
    //
    // Default paths derived from cwd. Accepts explicit log/archive paths as args.
    // For testability, _now_ is injectable via the _nowMs parameter in the
    // internal function; CLI always uses Date.now().
    // -------------------------------------------------------------------------
    case 'rotate-observations': {
      // Args may be: [] | [log] | [log, archive]
      const roProjectRoot = process.cwd();
      const roLogPath = args[0] ? safePath(args[0]) : getDecisionsLogPath(roProjectRoot);
      const roArchivePath = args[1] ? safePath(args[1]) : getDecisionsArchivePath(roProjectRoot);
      const roLockDir = getObservationsLockDir(roProjectRoot);

      fs.mkdirSync(path.dirname(roLogPath), { recursive: true });
      fs.mkdirSync(path.dirname(roArchivePath), { recursive: true });
      fs.mkdirSync(path.dirname(roLockDir), { recursive: true });

      if (!acquireMkdirLock(roLockDir, 30000, 60000)) {
        process.stderr.write('rotate-observations: timeout acquiring .observations.lock\n');
        process.exit(1);
      }

      try {
        const roRotated = rotateObservations(roLogPath, roArchivePath, Date.now());
        process.stdout.write(`rotated ${roRotated} observing rows\n`);
      } finally {
        releaseLock(roLockDir);
      }
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

// Expose helpers for unit testing (only when required as a module, not run as CLI)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    readUsageFile,
    writeUsageFile,
    registerUsageEntry,
    writeFileAtomic,
    writeJsonlAtomic,
    initDecisionsContent,
    nextAnchorFromLedger,
    rotateObservations,
  };
}
