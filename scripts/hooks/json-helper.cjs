#!/usr/bin/env node

// scripts/hooks/json-helper.cjs
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
//   extract-cwd-prompt                    Extract cwd + prompt fields, NUL-byte delimited
//   extract-text-messages                 Extract text content from Claude message format
//   merge-evidence                        Flatten, dedupe, limit to 10 from stdin JSON
//   slurp-sort <file> <field> [limit]     Read JSONL, sort by field desc, limit results
//   slurp-cap <file> <field> <limit>      Read JSONL, sort by field desc, output limit lines
//   array-length <path>                   Get length of array at dotted path in stdin JSON
//   array-item <path> <index>             Get item at index from array at path in stdin JSON
//   session-output <context>              Build SessionStart output envelope
//   prompt-output <context>               Build UserPromptSubmit output envelope
//   backup-construct                      Build pre-compact backup JSON from --arg pairs
//   merge-observation <log> <newObsJson>  Reinforce existing observation by id (D14)
//   decisions-usage-scan                  Scan session context for ADR/PF cite counts
//   read-dream <file> <field>             Read field from dream JSON (allowed fields only; returns [] on any error)

'use strict';

const fs = require('fs');
const path = require('path');

const op = process.argv[2];
const args = process.argv.slice(3);

const { safePath } = require('./lib/safe-path.cjs');
const {
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsUsagePath,
  getDecisionsLockDir,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getObservationsLockDir,
} = require('./lib/project-paths.cjs');
const {
  initDecisionsContent: _initDecisionsContent,
  formatDecisionBody,
  formatPitfallBody,
} = require('./lib/decisions-format.cjs');
const {
  renderAndWriteAll,
  parseLedger,
} = require('./lib/render-decisions.cjs');

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

// --- Learning system constants ---
// (Phase 3: deterministic confidence/promotion constants removed.
//  The LLM now sets confidence/status/quality_ok fields directly.)

function learningLog(msg) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  process.stderr.write(`[${ts}] ${msg}\n`);
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
  const tmp = file + '.tmp';
  const content = entries.length > 0
    ? entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  writeExclusive(tmp, content);
  fs.renameSync(tmp, file);
}

/** Atomically write a text file via a .tmp sibling and rename. */
function writeFileAtomic(file, content) {
  const tmp = file + '.tmp';
  writeExclusive(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * Return the initial header content for a new decisions file.
 * Delegates to decisions-format.cjs so the byte-compat strings live in one place.
 * @param {'decision'|'pitfall'} type
 * @returns {string}
 */
function initDecisionsContent(type) {
  return _initDecisionsContent(type);
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
 * Count active anchored rows of the given type in the ledger.
 * Active = decisions_status is undefined | 'Accepted' | 'Active'.
 *
 * @param {object[]} ledgerRows - All rows from the ledger
 * @param {'decision'|'pitfall'} type
 * @returns {number}
 */
function countActiveLedgerRows(ledgerRows, type) {
  const INACTIVE = new Set(['Deprecated', 'Superseded', 'Retired']);
  let count = 0;
  for (const row of ledgerRows) {
    if (row.type !== type) continue;
    if (!row.anchor_id) continue;
    if (row.decisions_status && INACTIVE.has(row.decisions_status)) continue;
    count++;
  }
  return count;
}

/**
 * D18: Count only non-deprecated headings in a decisions file.
 * Scans ## ADR-NNN: or ## PF-NNN: headings, then checks the next Status
 * line — if `Deprecated` or `Superseded`, the entry is excluded from the count.
 * @param {string} content - File content
 * @param {'decision'|'pitfall'} entryType
 * @returns {number}
 */
function countActiveHeadings(content, entryType) {
  const prefix = entryType === 'decision' ? 'ADR' : 'PF';
  const headingRe = new RegExp(`^## ${prefix}-(\\d+):`, 'gm');
  let count = 0;
  let match;
  while ((match = headingRe.exec(content)) !== null) {
    // Limit search to the section between this heading and the next ## heading
    const sectionStart = match.index;
    const nextHeadingIdx = content.indexOf('\n## ', sectionStart + 1);
    const section = nextHeadingIdx !== -1
      ? content.slice(sectionStart, nextHeadingIdx)
      : content.slice(sectionStart);
    const statusMatch = section.match(/- \*\*Status\*\*:\s*(\w+)/);
    if (statusMatch) {
      const status = statusMatch[1];
      if (status === 'Deprecated' || status === 'Superseded') continue;
    }
    count++;
  }
  return count;
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

  // Append stale rows to archive
  let existingArchive = [];
  if (fs.existsSync(archivePath)) {
    existingArchive = parseLedger(archivePath);
  }
  const archiveContent = [...existingArchive, ...stale].map(r => JSON.stringify(r)).join('\n') + '\n';
  writeFileAtomic(archivePath, archiveContent);

  // Write remaining rows back to log
  writeJsonlAtomic(logPath, kept);

  return stale.length;
}

function mergeEvidence(oldEvidence, newEvidence) {
  const flat = [...(oldEvidence || []), ...(newEvidence || [])];
  const unique = [...new Set(flat)];
  return unique.slice(0, 10);
}

/**
 * Acquire a mkdir-based lock. Returns true on success, false on timeout.
 * DESIGN: Shared locking utility used by assign-anchor, retire-anchor, rotate-observations,
 * and the render-decisions.cjs CLI. Callers pass their own timeoutMs/staleMs to suit their
 * workload: .decisions.lock writers use 30 000 ms / 60 000 ms stale.
 *
 * @param {string} lockDir - path to lock directory
 * @param {number} [timeoutMs=30000] - max wait in milliseconds
 * @param {number} [staleMs=60000] - age after which lock is considered stale
 * @returns {boolean}
 */
function acquireMkdirLock(lockDir, timeoutMs = 30000, staleMs = 60000) {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      return true; // acquired
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Check staleness
      try {
        const stat = fs.statSync(lockDir);
        const age = Date.now() - stat.mtimeMs;
        if (age > staleMs) {
          try { fs.rmdirSync(lockDir); } catch { /* already gone */ }
          continue;
        }
      } catch { /* lock gone between check and stat */ }
      if (Date.now() - start >= timeoutMs) return false;
      // Busy-wait with tiny sleep via sync trick (Atomics.wait on SharedArrayBuffer)
      // Falls back to a do-nothing loop if SharedArrayBuffer is unavailable.
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      } catch {
        const end = Date.now() + 50;
        while (Date.now() < end) { /* spin */ }
      }
    }
  }
}

function releaseLock(lockDir) {
  try { fs.rmdirSync(lockDir); } catch { /* already released */ }
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

if (require.main === module) {
try {
  // Route to domain modules first; fall through to the main switch if not handled.
  if (op === 'read-dream') {
    const dreamOps = require('./lib/dream-ops.cjs');
    if (dreamOps.handle(op, args, process.cwd())) {
      process.exit(0);
    }
  }

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

    case 'extract-cwd-prompt': {
      // Extract cwd and prompt from hook JSON in one pass.
      // Outputs: cwd + ASCII SOH (0x01) + prompt (no trailing newline).
      // Caller splits with: cut -d$'\001' -f1 and cut -d$'\001' -f2-
      // SOH is used (not NUL) for bash 3.2 compatibility with cut.
      const input = JSON.parse(readStdin());
      const cwd = input.cwd || '';
      const prompt = input.prompt || '';
      process.stdout.write(cwd + '\x01' + prompt);
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
    // merge-observation <log> <newObsJson>
    // ID-keyed reinforce op: if the id exists in the log, increment count, merge evidence,
    // update last_seen, and store LLM-provided confidence/status/quality_ok verbatim.
    // If the id is new, insert a new entry with LLM-provided fields verbatim.
    // D11: ID collision with different-type entry → suffix _b to avoid trampling.
    // D12: evidence array capped at 10 (FIFO).
    // D53: merge-observation is locked EXTERNALLY by the caller (dream agent acquires/
    // releases .devflow/dream/.observations.lock around the Bash subshell call), while
    // assign-anchor self-locks INTERNALLY via .decisions.lock. These are two distinct lock
    // domains — merge-observation itself never acquires a lock; it relies on the caller to
    // serialize concurrent writes. This is intentional: the subshell pattern in the Dream
    // agent acquires the lock, invokes this op, and releases — all in a single Bash call.
    // -------------------------------------------------------------------------
    case 'merge-observation': {
      const logFile = safePath(args[0]);
      const newObsJson = args[1];
      let newObs;
      try { newObs = JSON.parse(newObsJson); } catch {
        process.stderr.write('merge-observation: invalid JSON for new observation\n');
        process.exit(1);
      }

      // D54 (E1): self-create parent directory on first write (fresh project, file+dir absent).
      // The prior batch-merge op created the dir; merge-observation matches that so callers
      // do not need to pre-create the log directory.
      const logDir = path.dirname(logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      let logEntries = [];
      if (fs.existsSync(logFile)) {
        logEntries = parseJsonl(logFile);
      }
      const logMap = new Map(logEntries.map(e => [e.id, e]));
      const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

      // ID-keyed lookup: match by obs_xxx id only
      const existing = logMap.get(newObs.id);
      let merged = false;

      if (existing) {
        // Reinforce: increment count, merge evidence (FIFO cap 10), update last_seen.
        // Store LLM-provided confidence/status/quality_ok verbatim (no recalculation).
        const newCount = (existing.observations || 0) + 1;
        existing.observations = newCount;
        existing.evidence = mergeEvidence(existing.evidence || [], newObs.evidence || []);
        if (typeof newObs.confidence === 'number') existing.confidence = newObs.confidence;
        if (newObs.status) existing.status = newObs.status;
        existing.last_seen = nowIso;
        if (newObs.pattern) existing.pattern = newObs.pattern;
        if (newObs.details) existing.details = newObs.details;
        if (newObs.quality_ok === true) existing.quality_ok = true;
        // Passthrough new ledger fields from incoming obs (if LLM sets them)
        if (newObs.anchor_id !== undefined) existing.anchor_id = newObs.anchor_id;
        if (newObs.date !== undefined) existing.date = newObs.date;
        if (newObs.decisions_status !== undefined) existing.decisions_status = newObs.decisions_status;
        if (newObs.amendments !== undefined) existing.amendments = newObs.amendments;
        if (newObs.raw_body !== undefined) existing.raw_body = newObs.raw_body;

        merged = true;
        learningLog(`merge-observation: merged into ${existing.id} (count=${newCount})`);
      } else {
        // D11: ID collision recovery
        let newId = newObs.id;
        if (logMap.has(newId)) {
          newId = newId + '_b';
          learningLog(`merge-observation: ID collision resolved: ${newObs.id} -> ${newId}`);
        }
        const entry = {
          id: newId,
          type: newObs.type,
          pattern: newObs.pattern,
          confidence: typeof newObs.confidence === 'number' ? newObs.confidence : 0,
          observations: 1,
          first_seen: nowIso,
          last_seen: nowIso,
          status: newObs.status || 'observing',
          evidence: (newObs.evidence || []).slice(0, 10),
          details: newObs.details || '',
          quality_ok: newObs.quality_ok === true,
        };
        // Passthrough new ledger fields if present on the new obs
        if (newObs.anchor_id !== undefined) entry.anchor_id = newObs.anchor_id;
        if (newObs.date !== undefined) entry.date = newObs.date;
        if (newObs.decisions_status !== undefined) entry.decisions_status = newObs.decisions_status;
        if (newObs.amendments !== undefined) entry.amendments = newObs.amendments;
        if (newObs.raw_body !== undefined) entry.raw_body = newObs.raw_body;

        logMap.set(newId, entry);
        learningLog(`merge-observation: new entry ${newId} confidence=${entry.confidence}`);
      }

      writeJsonlAtomic(logFile, Array.from(logMap.values()));
      console.log(JSON.stringify({ merged, id: existing ? existing.id : newObs.id }));
      break;
    }

    // -------------------------------------------------------------------------
    // count-active <worktree-or-file> <type>
    // D23: Count active anchored rows from the ledger (preferred) or from
    // .md heading scan (legacy/pre-migration fallback).
    //
    // Two calling conventions (backward compat):
    //   count-active <worktree> <type>    — reads ledger, falls back to .md scan
    //   count-active <file.md> <type>     — legacy: reads the .md file directly
    //
    // Detection: if the argument ends with '.md' OR is a regular file (not dir),
    // treat as legacy .md file path. Otherwise treat as worktree.
    // -------------------------------------------------------------------------
    case 'count-active': {
      const caArg = safePath(args[0]);
      const entryType = args[1]; // 'decision' or 'pitfall'

      // Detect legacy .md file path vs worktree path
      let caIsLegacyFilePath = caArg.endsWith('.md');
      if (!caIsLegacyFilePath) {
        try {
          const st = fs.statSync(caArg);
          caIsLegacyFilePath = st.isFile();
        } catch { /* path doesn't exist — treat as worktree */ }
      }

      if (caIsLegacyFilePath) {
        // Legacy: .md file path passed directly
        let content = '';
        try {
          content = fs.readFileSync(caArg, 'utf8');
        } catch { /* file doesn't exist — count is 0 */ }
        const count = countActiveHeadings(content, entryType);
        console.log(JSON.stringify({ count }));
      } else {
        // Worktree path: read from ledger, fallback to .md scan when no ledger
        const caLedgerPath = getDecisionsLedgerPath(caArg);
        const caLedgerRows = parseLedger(caLedgerPath);
        if (caLedgerRows.length > 0) {
          const count = countActiveLedgerRows(caLedgerRows, entryType);
          console.log(JSON.stringify({ count }));
        } else {
          const mdPath = entryType === 'decision'
            ? getDecisionsFilePath(caArg)
            : getPitfallsFilePath(caArg);
          let content = '';
          try {
            content = fs.readFileSync(mdPath, 'utf8');
          } catch { /* file doesn't exist — count is 0 */ }
          const count = countActiveHeadings(content, entryType);
          console.log(JSON.stringify({ count }));
        }
      }
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
      const aaDecisionsDir = path.join(aaProjectRoot, '.devflow', 'decisions');
      const aaLedgerPath = getDecisionsLedgerPath(aaProjectRoot);
      const aaLogPath = getDecisionsLogPath(aaProjectRoot);
      const aaLockDir = getDecisionsLockDir(aaProjectRoot);

      fs.mkdirSync(aaDecisionsDir, { recursive: true });

      if (!acquireMkdirLock(aaLockDir, 30000, 60000)) {
        process.stderr.write(`assign-anchor: timeout acquiring lock at ${aaLockDir}\n`);
        process.exit(1);
      }

      try {
        // Read existing ledger (absent = empty)
        const aaLedgerRows = parseLedger(aaLedgerPath);

        // Compute next anchor — O(anchored), single pass
        const { anchorId: aaAnchorId } = nextAnchorFromLedger(aaLedgerRows, assignType);

        // Read observation from log
        let aaLogEntries = parseLedger(aaLogPath);
        const aaObsIdx = aaLogEntries.findIndex(e => e.id === assignObsId);
        if (aaObsIdx === -1) {
          process.stderr.write(`assign-anchor: obs_id '${assignObsId}' not found in ${aaLogPath}\n`);
          process.exit(1);
        }
        const aaObs = aaLogEntries[aaObsIdx];

        // Build anchored ledger row
        const aaDate = new Date().toISOString().slice(0, 10);
        const aaActiveStatus = assignType === 'decision' ? 'Accepted' : 'Active';

        const aaLedgerRow = Object.assign({}, aaObs, {
          anchor_id: aaAnchorId,
          decisions_status: aaActiveStatus,
        });
        // Set date on decisions only (not pitfalls — byte-compat asymmetry from formatDecisionBody)
        if (assignType === 'decision') {
          aaLedgerRow.date = aaObs.date || aaDate;
        }

        // Append anchored row to ledger (atomic)
        const aaNewLedgerRows = [...aaLedgerRows, aaLedgerRow];
        const aaLedgerContent = aaNewLedgerRows.map(r => JSON.stringify(r)).join('\n') + '\n';
        writeFileAtomic(aaLedgerPath, aaLedgerContent);

        // Mark log row as created
        aaLogEntries[aaObsIdx] = Object.assign({}, aaObs, { status: 'created' });
        writeJsonlAtomic(aaLogPath, aaLogEntries);

        // Register usage entry
        registerUsageEntry(aaProjectRoot, aaAnchorId);

        // Re-render both .md files (lock-free — we already hold .decisions.lock)
        renderAndWriteAll(aaProjectRoot, aaNewLedgerRows);

        // Print assigned anchor id to stdout
        process.stdout.write(aaAnchorId + '\n');
      } finally {
        releaseLock(aaLockDir);
      }
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
      const raLockDir = getDecisionsLockDir(raProjectRoot);

      fs.mkdirSync(path.join(raProjectRoot, '.devflow', 'decisions'), { recursive: true });

      if (!acquireMkdirLock(raLockDir, 30000, 60000)) {
        process.stderr.write(`retire-anchor: timeout acquiring lock at ${raLockDir}\n`);
        process.exit(1);
      }

      try {
        const raRows = parseLedger(raLedgerPath);
        const raIdx = raRows.findIndex(r => r.anchor_id === retireAnchorId);
        if (raIdx === -1) {
          process.stderr.write(`retire-anchor: anchor_id '${retireAnchorId}' not found in ledger\n`);
          process.exit(1);
        }

        // Idempotent: if already set to same status, still write (no-op equivalent)
        raRows[raIdx] = Object.assign({}, raRows[raIdx], { decisions_status: retireStatus });
        const raLedgerContent = raRows.map(r => JSON.stringify(r)).join('\n') + '\n';
        writeFileAtomic(raLedgerPath, raLedgerContent);

        // Re-render both .md (lock-free — we already hold .decisions.lock)
        renderAndWriteAll(raProjectRoot, raRows);
      } finally {
        releaseLock(raLockDir);
      }
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
    countActiveHeadings,
    countActiveLedgerRows,
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
