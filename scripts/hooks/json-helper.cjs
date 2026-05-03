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
//   learning-created <file>               Extract created artifacts from learning log
//   learning-new <file> <since_epoch>     Find new artifacts since epoch
//   temporal-decay <file>                 Apply temporal decay to learning log entries
//   process-observations <resp> <log>     Merge model observations into learning log
//   create-artifacts <resp> <log> <dir>   Create command/skill files from ready observations
//   filter-observations <file> [sort] [n] Filter valid observations, sort desc, limit
//   render-ready <log> <baseDir>          Render ready observations to files (D5)
//   reconcile-manifest <cwd>             Session-start reconciler: sync manifest vs FS (D6, D13)
//   merge-observation <log> <newObsJson> Dedup/reinforce with in-place merge (D14)
//   decisions-append <file> <type> <obs> Append ADR/PF entry to decisions file
//   read-sidecar <file> <field>          Read field from sidecar JSON (allowed fields only; returns [] on any error)

'use strict';

const fs = require('fs');
const path = require('path');

const op = process.argv[2];
const args = process.argv.slice(3);

const { safePath } = require('./lib/safe-path.cjs');

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
const DECAY_FACTORS = [1.0, 0.90, 0.81, 0.73, 0.66, 0.59, 0.53];
const CONFIDENCE_FLOOR = 0.10;
const DECAY_PERIOD_DAYS = 30;
const REQUIRED_OBSERVATIONS = 5;
const TEMPORAL_SPREAD_SECS = 604800; // 7 days
const INITIAL_CONFIDENCE = 0.33; // seed value for first observation (higher than calculateConfidence(1) to reduce noise)

/**
 * Per-type promotion thresholds.
 * DESIGN: D3 — each observation type has distinct evidence requirements reflecting
 * how often the pattern must recur before materialization. Workflow/procedural require
 * temporal spread to guard against single-session spikes; decision/pitfall require
 * only count (rationale quality is enforced by quality_ok, not frequency).
 */
const THRESHOLDS = {
  workflow:   { required: 3, spread: 3 * 86400, promote: 0.60 },
  procedural: { required: 4, spread: 5 * 86400, promote: 0.70 },
  decision:   { required: 2, spread: 0,          promote: 0.65 },
  pitfall:    { required: 2, spread: 0,          promote: 0.65 },
};

// D17: softCapExceeded repurposed to hard ceiling (100), not removed.
// Threshold shifts from 50→100; most call sites unchanged. Constants renamed to DECISIONS_*.
const DECISIONS_SOFT_START = 50;
const DECISIONS_HARD_CEILING = 100;
const DECISIONS_THRESHOLDS = [50, 60, 70, 80, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100];

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
 * @param {'decision'|'pitfall'} type
 * @returns {string}
 */
function initDecisionsContent(type) {
  return type === 'decision'
    ? '<!-- TL;DR: 0 decisions. Key: -->\n# Architectural Decisions\n\nAppend-only. Status changes allowed; deletions prohibited.\n'
    : '<!-- TL;DR: 0 pitfalls. Key: -->\n# Known Pitfalls\n\nArea-specific gotchas, fragile areas, and past bugs.\n';
}

/**
 * Find the highest numeric suffix (NNN) among heading matches and return next padded ID.
 * @param {RegExpMatchArray[]} matches
 * @param {string} prefix - 'ADR' or 'PF'
 * @returns {{ nextN: string, anchorId: string }}
 */
function nextDecisionsId(matches, prefix) {
  let maxN = 0;
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
  }
  const nextN = (maxN + 1).toString().padStart(3, '0');
  return { nextN, anchorId: `${prefix}-${nextN}` };
}

/**
 * Extract the content of a single ADR-NNN / PF-NNN section from a decisions file.
 * Returns the text from the matching `## <anchorId>` heading through the next `## ADR-`
 * or `## PF-` heading (exclusive), or to end-of-file.  Returns null when the anchor is
 * not present.  The anchorId is sanitised before use to eliminate ReDoS surface.
 *
 * Shared by reconcileExisting (anchored hash path) and the heal block — eliminates the
 * duplicated inline regex that appeared at three reconcile-manifest call sites (A2).
 *
 * @param {string} content   - Full file content
 * @param {string} anchorId  - e.g. 'ADR-001' or 'PF-007'
 * @returns {string|null}
 */
function sliceDecisionsSection(content, anchorId) {
  const safe = anchorId.replace(/[^A-Z0-9-]/gi, '');
  const sectionRe = new RegExp(`(##\\s+${safe}[\\s\\S]*?)(?=\\n##\\s+(?:ADR|PF)-|\\s*$)`);
  const m = content.match(sectionRe);
  return m ? m[1] : null;
}

/**
 * Return a zeroed reconcile-manifest result object.
 * Centralises the five-place inline shape `{ deletions: 0, edits: 0, unchanged: 0, healed: 0 }`
 * so that adding a counter in the future is a one-line change (C3).
 *
 * @returns {{ deletions: number, edits: number, unchanged: number, healed: number }}
 */
function emptyReconcileResult() {
  return { deletions: 0, edits: 0, unchanged: 0, healed: 0 };
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
 * Scan decisions.md and pitfalls.md for anchors (ADR-NNN / PF-NNN) that are present in
 * the files but not tracked in the manifest. Returns an array of unmanaged anchor descriptors.
 * Used by reconcile-manifest to self-heal render-ready crash-window duplicates.
 *
 * Only sections that contain the `- **Source**: self-learning:` marker qualify — pre-v2
 * seeded entries (which lack the marker) are excluded so they cannot be falsely paired
 * with a current `ready` log obs by normalised heading match. Pre-v2 entries are removed
 * separately by the v3 migration; until that runs they must remain inert here.
 *
 * `fileContent` is threaded through the returned descriptor so the heal block can reuse
 * the already-read bytes instead of re-reading the file a second time (A3).
 *
 * Skips scanning when `logMap` contains no `ready` observations — there is nothing to
 * pair with, so the I/O would be wasted (P2).
 *
 * @param {string} memoryDir - Path to .memory dir
 * @param {Set<string>} managedAnchors - Anchor IDs already tracked in the manifest
 * @param {Map<string,Object>} logMap - Current observation log keyed by obs ID
 * @returns {Array<{anchorId: string, type: string, path: string, headingText: string, fileContent: string}>}
 */
function findUnmanagedAnchors(memoryDir, managedAnchors, logMap) {
  // P2: short-circuit when no ready observations exist — nothing can be healed.
  if (!Array.from(logMap.values()).some(o => o.status === 'ready')) return [];

  // Use only literal (non-dynamic) regexes to avoid ReDoS surface on tainted data.
  // prefix values are hardcoded: 'ADR' for decisions, 'PF' for pitfalls.
  const result = [];
  const files = [
    { file: path.join(memoryDir, 'decisions', 'decisions.md'), type: 'decision', re: /^## (ADR-\d+):\s*([^\n]+)/gm },
    { file: path.join(memoryDir, 'decisions', 'pitfalls.md'),  type: 'pitfall',  re: /^## (PF-\d+):\s*([^\n]+)/gm },
  ];
  for (const { file, type, re } of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(content)) !== null) {
      if (managedAnchors.has(m[1])) continue;
      // Slice out this section's body (heading → next ## heading or eof) and require the
      // self-learning source marker — this excludes pre-v2 seeded content from the heal path.
      const sectionStart = m.index;
      const nextHeadingIdx = content.indexOf('\n## ', sectionStart + 1);
      const section = nextHeadingIdx !== -1
        ? content.slice(sectionStart, nextHeadingIdx)
        : content.slice(sectionStart);
      if (!section.includes('\n- **Source**: self-learning:')) continue;
      // A3: thread fileContent so the heal block does not re-read this file.
      result.push({ anchorId: m[1], type, path: file, headingText: m[2].trim(), fileContent: content });
    }
  }
  return result;
}

/**
 * Read .decisions-usage.json from .memory dir. Returns {version, entries} or empty default.
 * @param {string} memoryDir
 * @returns {{version: number, entries: Object}}
 */
function readUsageFile(memoryDir) {
  const filePath = path.join(memoryDir, '.decisions-usage.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.version === 1 && typeof data.entries === 'object') return data;
  } catch { /* ENOENT or malformed — return default */ }
  return { version: 1, entries: {} };
}

/**
 * Write .decisions-usage.json atomically.
 * @param {string} memoryDir
 * @param {{version: number, entries: Object}} data
 */
function writeUsageFile(memoryDir, data) {
  writeFileAtomic(path.join(memoryDir, '.decisions-usage.json'), JSON.stringify(data, null, 2) + '\n');
}

/**
 * Read .notifications.json from .memory dir.
 * @param {string} memoryDir
 * @returns {Object}
 */
function readNotifications(memoryDir) {
  const filePath = path.join(memoryDir, '.notifications.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
  } catch { /* ENOENT or malformed — return empty */ }
  return {};
}

/**
 * Write .notifications.json atomically.
 * @param {string} memoryDir
 * @param {Object} data
 */
function writeNotifications(memoryDir, data) {
  writeFileAtomic(path.join(memoryDir, '.notifications.json'), JSON.stringify(data, null, 2) + '\n');
}

/**
 * D22: Compute which thresholds were crossed going from prev to next count.
 * Returns array of crossed threshold values (ascending).
 * @param {number} prev
 * @param {number} next
 * @returns {number[]}
 */
function crossedThresholds(prev, next) {
  if (next <= prev) return [];
  return DECISIONS_THRESHOLDS.filter(t => t > prev && t <= next);
}

/**
 * D26: Build the updated TL;DR comment for a decisions file after appending a new entry.
 * Scans existingContent for active (non-deprecated/superseded) headings, appends the new
 * anchorId, takes the last 5, and returns the replacement comment string.
 *
 * @param {string} existingContent - File content BEFORE the new entry was appended
 * @param {string} entryPrefix - 'ADR' or 'PF'
 * @param {boolean} isDecision
 * @param {string} anchorId - The newly appended anchor ID
 * @param {number} newCount - Total active count after append
 * @returns {string} Complete updated content with TL;DR replaced
 */
function buildUpdatedTldr(existingContent, newContent, entryPrefix, isDecision, anchorId, newCount) {
  const headingRe = isDecision ? /^## ADR-(\d+):/gm : /^## PF-(\d+):/gm;
  const activeIds = [];
  let hMatch;
  while ((hMatch = headingRe.exec(existingContent)) !== null) {
    const sectionStart = hMatch.index;
    const nextH = existingContent.indexOf('\n## ', sectionStart + 1);
    const section = nextH !== -1 ? existingContent.slice(sectionStart, nextH) : existingContent.slice(sectionStart);
    const statusM = section.match(/- \*\*Status\*\*:\s*(\w+)/);
    if (statusM && (statusM[1] === 'Deprecated' || statusM[1] === 'Superseded')) continue;
    activeIds.push(`${entryPrefix}-${hMatch[1].padStart(3, '0')}`);
  }
  activeIds.push(anchorId);
  const allIds = activeIds.slice(-5);
  const tldrLabel = isDecision ? 'decisions' : 'pitfalls';
  return newContent.replace(
    /^<!-- TL;DR:.*-->/m,
    `<!-- TL;DR: ${newCount} ${tldrLabel}. Key: ${allIds.join(', ')} -->`
  );
}

/**
 * D21/D22/D24/D28: Update .notifications.json after a decisions entry is appended.
 * Handles first-run seed, threshold crossing, severity escalation, and re-fire on dismiss.
 *
 * @param {string} memoryDir
 * @param {string} notifKey - e.g. 'knowledge-capacity-decisions'
 * @param {number} previousCount - Active count before the append
 * @param {number} newCount - Active count after the append
 */
function updateCapacityNotification(memoryDir, notifKey, previousCount, newCount) {
  const notifications = readNotifications(memoryDir);
  const existingNotif = notifications[notifKey];

  // D21: first-run seed — if no notification existed and count >= soft start,
  // pretend we started from 0 so all crossed thresholds fire on first pass.
  let effectivePrevCount = previousCount;
  if (!existingNotif && newCount >= DECISIONS_SOFT_START) {
    effectivePrevCount = 0;
  }

  const crossed = crossedThresholds(effectivePrevCount, newCount);
  if (crossed.length === 0) return;

  const highestCrossed = crossed[crossed.length - 1];
  // D24: severity escalates with count
  let severity = 'dim';
  if (highestCrossed >= 90) severity = 'error';
  else if (highestCrossed >= 70) severity = 'warning';

  notifications[notifKey] = {
    active: true,
    threshold: highestCrossed,
    count: newCount,
    ceiling: DECISIONS_HARD_CEILING,
    dismissed_at_threshold: (existingNotif && existingNotif.dismissed_at_threshold) || null,
    severity,
    created_at: (existingNotif && existingNotif.created_at) || new Date().toISOString(),
  };

  // D28: if user dismissed at a lower threshold, re-fire at new threshold
  if (existingNotif && existingNotif.dismissed_at_threshold && highestCrossed > existingNotif.dismissed_at_threshold) {
    notifications[notifKey].dismissed_at_threshold = null;
  }

  writeNotifications(memoryDir, notifications);
}

/**
 * D20: Register an entry in .decisions-usage.json with initial cite count.
 * @param {string} memoryDir
 * @param {string} anchorId - e.g. 'ADR-001' or 'PF-003'
 */
function registerUsageEntry(memoryDir, anchorId) {
  const data = readUsageFile(memoryDir);
  if (!data.entries[anchorId]) {
    data.entries[anchorId] = {
      cites: 0,
      last_cited: null,
      created: new Date().toISOString(),
    };
    writeUsageFile(memoryDir, data);
  }
}

/**
 * Acquire .decisions-usage.lock with a 2-second timeout.
 * Separate from .decisions.lock to avoid blocking decisions writes.
 * @param {string} memoryDir
 * @returns {boolean}
 */
function acquireDecisionsUsageLock(memoryDir) {
  const lockDir = path.join(memoryDir, '.decisions-usage.lock');
  return acquireMkdirLock(lockDir, 2000, 5000);
}

/**
 * Release .decisions-usage.lock.
 * @param {string} memoryDir
 */
function releaseDecisionsUsageLock(memoryDir) {
  const lockDir = path.join(memoryDir, '.decisions-usage.lock');
  releaseLock(lockDir);
}

/**
 * Calculate confidence for a given observation count and type.
 * DESIGN: D3 — uses per-type required count from THRESHOLDS so workflow (req=3) reaches
 * 0.95 faster than procedural (req=4). Type defaults to 'procedural' if unrecognized
 * to keep legacy calls working.
 *
 * @param {number} count
 * @param {string} [type] - observation type key (workflow|procedural|decision|pitfall)
 * @returns {number} confidence in [0, 0.95]
 */
function calculateConfidence(count, type) {
  const req = (THRESHOLDS[type] || THRESHOLDS.procedural).required;
  return Math.min(Math.floor(count * 100 / req), 95) / 100;
}

function mergeEvidence(oldEvidence, newEvidence) {
  const flat = [...(oldEvidence || []), ...(newEvidence || [])];
  const unique = [...new Set(flat)];
  return unique.slice(0, 10);
}

/**
 * Acquire a mkdir-based lock. Returns true on success, false on timeout.
 * DESIGN: Shared locking utility used by render-ready, reconcile-manifest, merge-observation,
 * and decisions-append. Callers pass their own timeoutMs/staleMs to suit their workload:
 *   - .decisions.lock writes (render-ready, decisions-append): 30 000 ms / 60 000 ms stale
 *   - .learning.lock (reconcile-manifest): 15 000 ms / 60 000 ms stale
 *   - .decisions-usage.lock (acquireDecisionsUsageLock): 2 000 ms / 5 000 ms stale
 * The bash acquire_lock in background-learning uses different defaults (90 s wait / 300 s stale)
 * because it guards the entire Sonnet analysis pipeline (up to 180 s watchdog timeout), not
 * just file I/O. Those higher values are intentional — see background-learning:68-81.
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

/**
 * Compute a simple hash of content for change detection in the manifest.
 * Uses a djb2-style rolling hash — adequate for detecting edits, not cryptographic.
 * @param {string} content
 * @returns {string}
 */
function contentHash(content) {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h * 33) ^ content.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/**
 * Normalize a string for dedup comparisons: lowercase, strip punctuation, trim.
 * @param {string} s
 * @returns {string}
 */
function normalizeForDedup(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Approximate similarity ratio between two strings using character overlap.
 * Used in merge-observation to detect divergent details that warrant flagging.
 * For short strings this is O(n) and "good enough" — not a full Levenshtein.
 * Returns a value in [0, 1] where 1 = identical.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function longestCommonSubsequenceRatio(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Count common characters (order-independent) — fast approximation
  const countA = {};
  for (const c of a) countA[c] = (countA[c] || 0) + 1;
  let common = 0;
  for (const c of b) {
    if (countA[c] > 0) { common++; countA[c]--; }
  }
  return (2 * common) / (a.length + b.length);
}

/**
 * Convert pattern string to kebab-case slug (max 50 chars).
 * @param {string} pattern
 * @returns {string}
 */
function toSlug(pattern) {
  return (pattern || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Extract artifact display name from its file path. */
function artifactName(obs) {
  const parts = (obs.artifact_path || '').split('/');
  if (obs.type === 'workflow') {
    return (parts.pop() || '').replace(/\.md$/, '');
  }
  return parts.length >= 2 ? parts[parts.length - 2] : '';
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
  if (op === 'read-sidecar') {
    const sidecarOps = require('./lib/sidecar-ops.cjs');
    if (sidecarOps.handle(op, args, process.cwd())) {
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

    case 'learning-created': {
      // Extract created artifacts from learning log JSONL
      const file = args[0];
      const parsed = parseJsonl(file);

      const created = parsed.filter(o => o.status === 'created' && o.artifact_path);

      const formatEntry = o => ({
        name: artifactName(o),
        conf: (Math.floor(o.confidence * 10) / 10).toString(),
      });

      const commands = created.filter(o => o.type === 'workflow').slice(0, 5).map(formatEntry);
      const skills = created.filter(o => o.type === 'procedural').slice(0, 5).map(formatEntry);

      console.log(JSON.stringify({ commands, skills }));
      break;
    }

    case 'learning-new': {
      const file = args[0];
      const parsed = parseJsonl(file);

      const created = parsed.filter(o => o.status === 'created' && o.last_seen);
      const messages = created.map(o => {
        const name = artifactName(o);
        return o.type === 'workflow'
          ? `NEW: /self-learning/${name} command created from repeated workflow`
          : `NEW: ${name} skill created from procedural knowledge`;
      });

      console.log(messages.join('\n'));
      break;
    }

    case 'temporal-decay': {
      const file = safePath(args[0]);
      if (!fs.existsSync(file)) {
        console.log(JSON.stringify({ removed: 0, decayed: 0 }));
        break;
      }
      const entries = parseJsonl(file);
      const now = Date.now() / 1000;
      let removed = 0;
      let decayed = 0;
      const results = [];
      for (const entry of entries) {
        if (entry.last_seen) {
          const lastDate = new Date(entry.last_seen);
          if (isNaN(lastDate.getTime())) {
            learningLog(`Warning: invalid date in ${entry.id || 'unknown'}: ${entry.last_seen}`);
            results.push(entry);
            continue;
          }
          const lastEpoch = lastDate.getTime() / 1000;
          const days = Math.floor((now - lastEpoch) / 86400);
          const periods = Math.floor(days / DECAY_PERIOD_DAYS);
          if (periods > 0) {
            const factor = periods < DECAY_FACTORS.length
              ? DECAY_FACTORS[periods] : DECAY_FACTORS[DECAY_FACTORS.length - 1];
            const newConf = Math.round(entry.confidence * factor * 100) / 100;
            if (newConf < CONFIDENCE_FLOOR) {
              removed++;
              learningLog(`Removed ${entry.id || 'unknown'}: confidence ${newConf} below threshold`);
              continue;
            }
            entry.confidence = newConf;
            decayed++;
          }
        }
        results.push(entry);
      }
      writeJsonlAtomic(file, results);
      learningLog(`Temporal decay: removed=${removed}, decayed=${decayed}`);
      console.log(JSON.stringify({ removed, decayed }));
      break;
    }

    case 'process-observations': {
      const responseFile = safePath(args[0]);
      const logFile = safePath(args[1]);
      const response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      const observations = response.observations || [];

      let logEntries = [];
      if (fs.existsSync(logFile)) {
        logEntries = parseJsonl(logFile);
      }
      const logMap = new Map(logEntries.map(e => [e.id, e]));
      const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      let updated = 0, created = 0, skipped = 0;

      // All 4 types are now supported (D3)
      const VALID_TYPES = new Set(['workflow', 'procedural', 'decision', 'pitfall']);

      for (let i = 0; i < observations.length; i++) {
        const obs = observations[i];
        if (!obs.id || !obs.type || !obs.pattern) {
          learningLog(`Skipping observation ${i}: missing required field (id='${obs.id || ''}' type='${obs.type || ''}')`);
          skipped++;
          continue;
        }
        if (!VALID_TYPES.has(obs.type)) {
          learningLog(`Skipping observation ${i}: invalid type '${obs.type}'`);
          skipped++;
          continue;
        }
        if (!obs.id.startsWith('obs_')) {
          learningLog(`Skipping observation ${i}: invalid id format '${obs.id}'`);
          skipped++;
          continue;
        }

        // Store quality_ok from the model (D4 — LLM sets quality_ok, downstream checks it)
        const qualityOk = obs.quality_ok === true;

        const existing = logMap.get(obs.id);
        if (existing) {
          const newCount = (existing.observations || 0) + 1;
          existing.observations = newCount;
          existing.evidence = mergeEvidence(existing.evidence || [], obs.evidence || []);
          existing.confidence = calculateConfidence(newCount, existing.type);
          existing.last_seen = nowIso;
          if (obs.pattern) existing.pattern = obs.pattern;
          if (obs.details) existing.details = obs.details;
          // DESIGN: D4 — quality_ok is sticky once true. A single low-confidence
          // model call cannot regress the rationale quality of an already-promoted
          // observation; the model can only confirm or upgrade it.
          if (qualityOk) existing.quality_ok = true;

          // DESIGN: D3 + D4 — per-type promotion requires BOTH the confidence
          // threshold AND quality_ok. quality_ok gates materialization; without it
          // we keep accumulating observations (so the count still grows) but the
          // downstream render-ready will skip the entry. See render-ready (line ~838).
          if (existing.status !== 'created') {
            const th = THRESHOLDS[existing.type] || THRESHOLDS.procedural;
            if (existing.confidence >= th.promote && existing.quality_ok === true) {
              const firstSeenMs = existing.first_seen ? new Date(existing.first_seen).getTime() : 0;
              const spread = (Date.now() - firstSeenMs) / 1000;
              if (!isNaN(firstSeenMs) && spread >= th.spread) {
                existing.status = 'ready';
              }
            }
          }

          learningLog(`Updated ${obs.id}: confidence ${existing.confidence}, status ${existing.status}`);
          updated++;
        } else {
          const newEntry = {
            id: obs.id,
            type: obs.type,
            pattern: obs.pattern,
            confidence: INITIAL_CONFIDENCE,
            observations: 1,
            first_seen: nowIso,
            last_seen: nowIso,
            status: 'observing',
            evidence: obs.evidence || [],
            details: obs.details || '',
            quality_ok: qualityOk,
          };
          logMap.set(obs.id, newEntry);
          learningLog(`New observation ${obs.id}: type=${obs.type} confidence=${INITIAL_CONFIDENCE} quality_ok=${qualityOk}`);
          created++;
        }
      }

      const logDir = path.dirname(logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      writeJsonlAtomic(logFile, Array.from(logMap.values()));
      console.log(JSON.stringify({ updated, created, skipped }));
      break;
    }

    case 'create-artifacts': {
      const responseFile = safePath(args[0]);
      const logFile = safePath(args[1]);
      const baseDir = safePath(args[2]);
      const response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      const artifacts = response.artifacts || [];

      if (artifacts.length === 0) {
        console.log(JSON.stringify({ created: [], skipped: 0 }));
        break;
      }

      let logEntries = [];
      if (fs.existsSync(logFile)) {
        logEntries = parseJsonl(logFile);
      }
      const logMap = new Map(logEntries.map(e => [e.id, e]));
      const createdPaths = [];
      let skippedCount = 0;
      const artDate = new Date().toISOString().slice(0, 10);

      for (const art of artifacts) {
        let name = (art.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);
        if (!name) {
          learningLog('Skipping artifact with empty/invalid name');
          skippedCount++;
          continue;
        }

        const obs = logMap.get(art.observation_id);
        if (!obs || obs.status !== 'ready') {
          learningLog(`Skipping artifact for ${art.observation_id} (status: ${obs ? obs.status : 'not found'}, need: ready)`);
          skippedCount++;
          continue;
        }

        let artDir, artPath;
        if (art.type === 'command') {
          artDir = path.join(baseDir, '.claude', 'commands', 'self-learning');
          artPath = path.join(artDir, `${name}.md`);
        } else {
          artDir = path.join(baseDir, '.claude', 'skills', name);
          artPath = path.join(artDir, 'SKILL.md');
        }

        if (fs.existsSync(artPath)) {
          learningLog(`Artifact already exists at ${artPath} — skipping`);
          skippedCount++;
          continue;
        }

        const desc = (art.description || '').replace(/"/g, '\\"');
        const conf = obs.confidence || 0;
        const obsN = obs.observations || 0;

        fs.mkdirSync(artDir, { recursive: true });

        let content;
        if (art.type === 'command') {
          content = [
            '---',
            `description: "${desc}"`,
            `# devflow-learning: auto-generated (${artDate}, confidence: ${conf}, obs: ${obsN})`,
            '---',
            '',
            stripLeadingFrontmatter(art.content || ''),
            '',
          ].join('\n');
        } else {
          content = [
            '---',
            `name: self-learning:${name}`,
            `description: "${desc}"`,
            'user-invocable: false',
            'allowed-tools: Read, Grep, Glob',
            `# devflow-learning: auto-generated (${artDate}, confidence: ${conf}, obs: ${obsN})`,
            '---',
            '',
            stripLeadingFrontmatter(art.content || ''),
            '',
          ].join('\n');
        }

        fs.writeFileSync(artPath, content);
        obs.status = 'created';
        obs.artifact_path = artPath;
        learningLog(`Created artifact: ${artPath}`);
        createdPaths.push(artPath);
      }

      if (createdPaths.length > 0) {
        writeJsonlAtomic(logFile, Array.from(logMap.values()));
      }

      console.log(JSON.stringify({ created: createdPaths, skipped: skippedCount }));
      break;
    }

    case 'filter-observations': {
      const file = args[0];
      const sortField = args[1] || 'confidence';
      const limit = parseInt(args[2]) || 30;
      if (!fs.existsSync(safePath(file))) {
        console.log('[]');
        break;
      }
      const entries = parseJsonl(file);
      // All 4 types now valid (D3)
      const validTypes = new Set(['workflow', 'procedural', 'decision', 'pitfall']);
      const valid = entries.filter(e =>
        e.id && e.id.startsWith('obs_') &&
        validTypes.has(e.type) &&
        e.pattern
      );
      valid.sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0));
      console.log(JSON.stringify(valid.slice(0, limit)));
      break;
    }

    // -------------------------------------------------------------------------
    // render-ready <log> <baseDir>
    // DESIGN: D5 — deterministic rendering replaces LLM-generated artifact content.
    // The model provides structured metadata (pattern, details, evidence, type);
    // rendering is a pure template application. This separates detection from materialization.
    // -------------------------------------------------------------------------
    case 'render-ready': {
      const logFile = safePath(args[0]);
      const baseDir = safePath(args[1]);
      if (!fs.existsSync(logFile)) {
        console.log(JSON.stringify({ rendered: [], skipped: 0 }));
        break;
      }

      const entries = parseJsonl(logFile);
      const logMap = new Map(entries.map(e => [e.id, e]));
      const manifestPath = path.join(baseDir, '.memory', '.learning-manifest.json');
      const artDate = new Date().toISOString().slice(0, 10);

      // Load or init manifest (schemaVersion 1)
      let manifest = { schemaVersion: 1, entries: [] };
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (!manifest.entries) manifest.entries = [];
        } catch { manifest = { schemaVersion: 1, entries: [] }; }
      }
      const manifestMap = new Map(manifest.entries.map(e => [e.observationId, e]));

      const rendered = [];
      let skipped = 0;
      const decisionsLockDir = path.join(baseDir, '.memory', '.decisions.lock');

      for (const obs of entries) {
        if (obs.status !== 'ready') continue;
        // quality_ok must be true for materialization (D4)
        if (obs.quality_ok !== true) {
          learningLog(`Skipping render for ${obs.id}: quality_ok is not true`);
          skipped++;
          continue;
        }

        const slug = toSlug(obs.pattern);
        if (!slug) { skipped++; continue; }

        try {
          if (obs.type === 'workflow') {
            // --- Workflow: write command file ---
            const artDir = path.join(baseDir, '.claude', 'commands', 'self-learning');
            const artPath = path.join(artDir, `${slug}.md`);
            fs.mkdirSync(artDir, { recursive: true });

            const conf = obs.confidence || 0;
            const obsN = obs.observations || 0;
            const evidenceList = (obs.evidence || []).map(e => `- ${e}`).join('\n');
            const content = [
              '---',
              `description: "${(obs.pattern || '').replace(/"/g, '\\"')}"`,
              `# devflow-learning: auto-generated (${artDate}, confidence: ${conf}, obs: ${obsN})`,
              '---',
              '',
              `# ${obs.pattern}`,
              '',
              obs.details || '',
              '',
              '## Evidence',
              evidenceList,
              '',
            ].join('\n');

            writeFileAtomic(artPath, content);

            obs.status = 'created';
            obs.artifact_path = artPath;

            manifestMap.set(obs.id, {
              observationId: obs.id,
              type: obs.type,
              path: artPath,
              contentHash: contentHash(content),
              renderedAt: new Date().toISOString(),
            });
            rendered.push(artPath);
            learningLog(`Rendered workflow: ${artPath}`);

          } else if (obs.type === 'procedural') {
            // --- Procedural: write skill file ---
            const artDir = path.join(baseDir, '.claude', 'skills', `self-learning:${slug}`);
            const artPath = path.join(artDir, 'SKILL.md');
            fs.mkdirSync(artDir, { recursive: true });

            const conf = obs.confidence || 0;
            const obsN = obs.observations || 0;
            const patternUpper = (obs.pattern || '').toUpperCase();
            const content = [
              '---',
              `name: self-learning:${slug}`,
              `description: "This skill should be used when ${(obs.pattern || '').replace(/"/g, '\\"')}"`,
              'user-invocable: false',
              'allowed-tools: Read, Grep, Glob',
              `# devflow-learning: auto-generated (${artDate}, confidence: ${conf}, obs: ${obsN})`,
              '---',
              '',
              `# ${obs.pattern}`,
              '',
              obs.details || '',
              '',
              '## Iron Law',
              '',
              `> **${patternUpper}**`,
              '',
              '---',
              '',
              '## When This Skill Activates',
              '- Based on detected patterns',
              '',
              '## Procedure',
              obs.details || '',
              '',
            ].join('\n');

            writeFileAtomic(artPath, content);

            obs.status = 'created';
            obs.artifact_path = artPath;

            manifestMap.set(obs.id, {
              observationId: obs.id,
              type: obs.type,
              path: artPath,
              contentHash: contentHash(content),
              renderedAt: new Date().toISOString(),
            });
            rendered.push(artPath);
            learningLog(`Rendered procedural: ${artPath}`);

          } else if (obs.type === 'decision' || obs.type === 'pitfall') {
            // --- Decision / Pitfall: append to decisions file ---
            const isDecision = obs.type === 'decision';
            const decisionsDir = path.join(baseDir, '.memory', 'decisions');
            const decisionsFile = path.join(decisionsDir, isDecision ? 'decisions.md' : 'pitfalls.md');
            const entryPrefix = isDecision ? 'ADR' : 'PF';
            const headingRe = isDecision ? /^## ADR-(\d+):/gm : /^## PF-(\d+):/gm;

            // Acquire decisions lock (D — lock protocol from decisions-format SKILL.md)
            if (!acquireMkdirLock(decisionsLockDir, 30000, 60000)) {
              learningLog(`Timeout acquiring decisions lock for ${obs.id} — skipping`);
              skipped++;
              continue;
            }
            try {
              fs.mkdirSync(decisionsDir, { recursive: true });

              const existingContent = fs.existsSync(decisionsFile)
                ? fs.readFileSync(decisionsFile, 'utf8')
                : initDecisionsContent(obs.type);

              // existingMatches needed for nextDecisionsId (uses Math.max on match groups)
              const existingMatches = [...existingContent.matchAll(headingRe)];

              // D18: count only active (non-deprecated/superseded) headings for capacity check
              const previousCount = countActiveHeadings(existingContent, obs.type);

              const memoryDir = path.join(baseDir, '.memory');
              const notifKey = isDecision ? 'knowledge-capacity-decisions' : 'knowledge-capacity-pitfalls';

              // D17: hard ceiling at DECISIONS_HARD_CEILING (100); softCapExceeded repurposed
              // from old 50-entry soft cap — now signals the hard ceiling was hit.
              if (previousCount >= DECISIONS_HARD_CEILING) {
                // D15: set softCapExceeded — surfaces to HUD and `devflow learn --review`
                // so the user can decide which entry to deprecate before a new one lands.
                obs.softCapExceeded = true;
                // Write error-level notification for hard ceiling
                const notifications = readNotifications(memoryDir);
                notifications[notifKey] = {
                  active: true,
                  threshold: DECISIONS_HARD_CEILING,
                  count: previousCount,
                  ceiling: DECISIONS_HARD_CEILING,
                  dismissed_at_threshold: null,
                  severity: 'error',
                  created_at: new Date().toISOString(),
                };
                writeNotifications(memoryDir, notifications);
                learningLog(`Decisions file at hard ceiling (${previousCount}/${DECISIONS_HARD_CEILING}), skipping ${obs.id}`);
                skipped++;
                continue; // lock still held; released in finally
              }

              // Dedup for pitfalls: compare Area + Issue first 40 chars
              if (!isDecision) {
                let details = obs.details || '';
                let areaMatch = details.match(/area:\s*([^\n;]+)/i);
                let issueMatch = details.match(/issue:\s*([^\n;]+)/i);
                let area = normalizeForDedup((areaMatch || [])[1] || '').slice(0, 40);
                let issue = normalizeForDedup((issueMatch || [])[1] || '').slice(0, 40);
                if (area && issue) {
                  const dupRe = /##\s+PF-\d+:[\s\S]*?(?=##\s+PF-|\s*$)/g;
                  let isDuplicate = false;
                  for (const m of existingContent.matchAll(dupRe)) {
                    const block = m[0];
                    const bArea = normalizeForDedup((block.match(/\*\*Area\*\*:\s*([^\n]+)/) || [])[1] || '').slice(0, 40);
                    const bIssue = normalizeForDedup((block.match(/\*\*Issue\*\*:\s*([^\n]+)/) || [])[1] || '').slice(0, 40);
                    if (bArea === area && bIssue === issue) {
                      learningLog(`Duplicate pitfall detected for ${obs.id} — skipping`);
                      skipped++;
                      isDuplicate = true;
                      break;
                    }
                  }
                  if (isDuplicate) continue; // lock released in finally
                }
              }

              const { anchorId } = nextDecisionsId(existingMatches, entryPrefix);

              let entry;
              const detailsStr = obs.details || '';
              if (isDecision) {
                // Parse "context: ...; decision: ...; rationale: ..." from details
                const contextMatch = detailsStr.match(/context:\s*([^;]+)/i);
                const decisionMatch = detailsStr.match(/decision:\s*([^;]+)/i);
                const rationaleMatch = detailsStr.match(/rationale:\s*([^;]+)/i);
                entry = [
                  `\n## ${anchorId}: ${obs.pattern}`,
                  '',
                  `- **Date**: ${artDate}`,
                  `- **Status**: Accepted`,
                  `- **Context**: ${(contextMatch || [])[1] || detailsStr}`,
                  `- **Decision**: ${(decisionMatch || [])[1] || obs.pattern}`,
                  `- **Consequences**: ${(rationaleMatch || [])[1] || ''}`,
                  `- **Source**: self-learning:${obs.id}`,
                  '',
                ].join('\n');
              } else {
                const areaMatch2 = detailsStr.match(/area:\s*([^;]+)/i);
                const issueMatch2 = detailsStr.match(/issue:\s*([^;]+)/i);
                const impactMatch = detailsStr.match(/impact:\s*([^;]+)/i);
                const resMatch = detailsStr.match(/resolution:\s*([^;]+)/i);
                // Status: Active — added so `devflow learn --review` deprecate
                // can flip it to Deprecated consistently with ADR entries.
                entry = [
                  `\n## ${anchorId}: ${obs.pattern}`,
                  '',
                  `- **Area**: ${(areaMatch2 || [])[1] || detailsStr}`,
                  `- **Issue**: ${(issueMatch2 || [])[1] || detailsStr}`,
                  `- **Impact**: ${(impactMatch || [])[1] || ''}`,
                  `- **Resolution**: ${(resMatch || [])[1] || ''}`,
                  `- **Status**: Active`,
                  `- **Source**: self-learning:${obs.id}`,
                  '',
                ].join('\n');
              }

              const newContent = existingContent + entry;

              // D26: TL;DR shows active-only count (excludes deprecated/superseded)
              const newCount = previousCount + 1;

              const updatedContent = buildUpdatedTldr(existingContent, newContent, entryPrefix, isDecision, anchorId, newCount);
              writeFileAtomic(decisionsFile, updatedContent);

              // D20: register in usage tracking so cite counts start at 0
              registerUsageEntry(memoryDir, anchorId);

              // D21/D22/D24/D28: update capacity notification (first-run seed + threshold crossing)
              updateCapacityNotification(memoryDir, notifKey, previousCount, newCount);

              obs.status = 'created';
              obs.artifact_path = `${decisionsFile}#${anchorId}`;

              manifestMap.set(obs.id, {
                observationId: obs.id,
                type: obs.type,
                path: decisionsFile,
                contentHash: contentHash(entry),
                renderedAt: new Date().toISOString(),
                anchorId,
              });
              rendered.push(obs.artifact_path);
              learningLog(`Rendered ${obs.type}: ${obs.artifact_path}`);
            } finally {
              releaseLock(decisionsLockDir);
            }
          }
        } catch (renderErr) {
          learningLog(`Render error for ${obs.id}: ${renderErr.message}`);
          skipped++;
        }
      }

      // Write updated log and manifest atomically
      writeJsonlAtomic(logFile, Array.from(logMap.values()));
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      manifest.entries = Array.from(manifestMap.values());
      writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));

      console.log(JSON.stringify({ rendered, skipped }));
      break;
    }

    // -------------------------------------------------------------------------
    // reconcile-manifest <cwd>
    // DESIGN: D6 — reconciler runs at session-start (not PostToolUse) to avoid
    // write-time overhead. This amortizes the filesystem check over session boundaries.
    // DESIGN: D13 — edits to artifact content are silently ignored (hash update only,
    // no confidence penalty). Users should be free to improve their own artifacts.
    // -------------------------------------------------------------------------
    case 'reconcile-manifest': {
      const cwd = safePath(args[0]);
      const manifestPath = path.join(cwd, '.memory', '.learning-manifest.json');
      const logFile = path.join(cwd, '.memory', 'learning-log.jsonl');
      const lockDir = path.join(cwd, '.memory', '.learning.lock');

      // A1: require only the log file (not the manifest) before proceeding.
      // The heal path must be able to run even when the manifest has never been written
      // (e.g. render-ready crashed before its manifest write).  A missing manifest is
      // treated as an empty one; the heal block then reconstructs it from the log + files.
      if (!fs.existsSync(logFile)) {
        console.log(JSON.stringify(emptyReconcileResult()));
        break;
      }

      if (!acquireMkdirLock(lockDir, 15000, 60000)) {
        learningLog('reconcile-manifest: timeout acquiring lock, skipping');
        console.log(JSON.stringify(emptyReconcileResult()));
        break;
      }

      try {
        // C1: loadReconcileState — read manifest (or construct empty) + build logMap.
        let manifest;
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest.entries) manifest.entries = [];
          } catch {
            // Corrupt manifest — treat as empty so the heal path can still recover.
            manifest = { schemaVersion: 1, entries: [] };
          }
        } else {
          // A1: no manifest yet; construct empty in-memory so heal can populate it.
          manifest = { schemaVersion: 1, entries: [] };
        }

        const logEntries = parseJsonl(logFile);
        const logMap = new Map(logEntries.map(e => [e.id, e]));

        // C1: reconcileExisting — walk manifest entries, detect deletions / edits.
        const counters = emptyReconcileResult();
        const keptEntries = [];

        for (const entry of manifest.entries) {
          // Stale manifest entry: no matching obs in log → drop silently
          const obs = logMap.get(entry.observationId);
          if (!obs) {
            learningLog(`reconcile: dropping stale manifest entry ${entry.observationId}`);
            continue;
          }

          // Check file existence
          const filePath = entry.path;
          if (!fs.existsSync(filePath)) {
            // Deletion detected: penalize confidence
            obs.confidence = Math.round(obs.confidence * 0.3 * 100) / 100;
            obs.status = 'deprecated';
            obs.deprecated_at = new Date().toISOString();
            learningLog(`reconcile: deletion detected for ${entry.observationId}, confidence -> ${obs.confidence}`);
            counters.deletions++;
            // Remove manifest entry (don't keep it)
            continue;
          }

          // File exists — check anchor for decisions entries
          if (entry.anchorId) {
            const content = fs.readFileSync(filePath, 'utf8');
            const anchorPattern = new RegExp(`##\\s+${entry.anchorId}\\b`);
            if (!anchorPattern.test(content)) {
              // Anchor missing — treat as deletion (D13 exception: anchor loss = deletion)
              obs.confidence = Math.round(obs.confidence * 0.3 * 100) / 100;
              obs.status = 'deprecated';
              obs.deprecated_at = new Date().toISOString();
              learningLog(`reconcile: anchor ${entry.anchorId} missing for ${entry.observationId}`);
              counters.deletions++;
              continue;
            }
            // A2: use shared sliceDecisionsSection — eliminates duplicated inline regex.
            const sectionContent = sliceDecisionsSection(content, entry.anchorId) ?? content;
            const currentHash = contentHash(sectionContent);
            if (currentHash !== entry.contentHash) {
              // D13: silently update hash only, no confidence penalty
              entry.contentHash = currentHash;
              counters.edits++;
            } else {
              counters.unchanged++;
            }
          } else {
            const content = fs.readFileSync(filePath, 'utf8');
            const currentHash = contentHash(content);
            if (currentHash !== entry.contentHash) {
              // D13: silently update hash only
              entry.contentHash = currentHash;
              counters.edits++;
            } else {
              counters.unchanged++;
            }
          }

          keptEntries.push(entry);
        }

        // C1: healUnmanagedAnchors — recover from render-ready crash-window duplicates.
        // If render-ready wrote the decisions file but crashed before updating the log
        // and manifest, the anchor exists in the file but the log still shows status=ready
        // and the manifest has no entry.  We detect this by scanning decisions files for
        // anchors not tracked in the manifest, then matching them against ready log
        // observations with a matching normalised pattern.
        // DESIGN: D-D — skip silently when zero or multiple log entries match (ambiguity guard).
        const memoryDir = path.join(cwd, '.memory');
        const managedAnchors = new Set(keptEntries.filter(e => e.anchorId).map(e => e.anchorId));
        // P2 early-exit is inside findUnmanagedAnchors; pass logMap so it can check.
        const unmanaged = findUnmanagedAnchors(memoryDir, managedAnchors, logMap);
        for (const u of unmanaged) {
          const headingNorm = normalizeForDedup(u.headingText);
          const candidates = Array.from(logMap.values()).filter(o =>
            o.type === u.type && o.status === 'ready' &&
            normalizeForDedup(o.pattern) === headingNorm,
          );
          if (candidates.length !== 1) continue; // 0 = user-curated, >1 = ambiguous (D-D: silent)
          const obs = candidates[0];
          obs.status = 'created';
          obs.artifact_path = `${u.path}#${u.anchorId}`;
          // A2: use shared sliceDecisionsSection; A3: use fileContent already read by findUnmanagedAnchors.
          const section = sliceDecisionsSection(u.fileContent, u.anchorId);
          keptEntries.push({
            observationId: obs.id, type: u.type, path: u.path,
            contentHash: contentHash(section ?? u.headingText),
            renderedAt: new Date().toISOString(), anchorId: u.anchorId,
          });
          registerUsageEntry(memoryDir, u.anchorId);
          counters.healed++;
          learningLog(`reconcile: healed ${obs.id} → ${u.anchorId}`);
        }

        // Atomic writes
        writeJsonlAtomic(logFile, Array.from(logMap.values()));
        manifest.entries = keptEntries;
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));

        console.log(JSON.stringify(counters));
      } finally {
        releaseLock(lockDir);
      }
      break;
    }

    // -------------------------------------------------------------------------
    // merge-observation <log> <newObsJson>
    // DESIGN: D14 — in-place merge (not supersede). When an observation arrives that
    // matches an existing entry (same type + pattern or pitfall Area+Issue), we merge
    // evidence and metadata rather than creating a duplicate. If the artifact is already
    // created (status=created), we trigger in-place re-render of the target section.
    // D11 — ID collision recovery: if a new obs ID collides with an existing entry of
    // a different type, the new ID is suffixed with '_b' to avoid trampling.
    // D12 — evidence array capped at 10 (FIFO).
    // -------------------------------------------------------------------------
    case 'merge-observation': {
      const logFile = safePath(args[0]);
      const newObsJson = args[1];
      let newObs;
      try { newObs = JSON.parse(newObsJson); } catch {
        process.stderr.write('merge-observation: invalid JSON for new observation\n');
        process.exit(1);
      }

      let logEntries = [];
      if (fs.existsSync(logFile)) {
        logEntries = parseJsonl(logFile);
      }
      const logMap = new Map(logEntries.map(e => [e.id, e]));
      const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

      // Attempt to find matching active entry
      let existing = null;
      for (const entry of logMap.values()) {
        if (entry.type !== newObs.type) continue;
        if (entry.status === 'deprecated') continue;

        const normExisting = normalizeForDedup(entry.pattern || '');
        const normNew = normalizeForDedup(newObs.pattern || '');

        if (normExisting === normNew) {
          existing = entry;
          break;
        }

        // For pitfalls: also match on Area + Issue first 40 chars
        if (entry.type === 'pitfall') {
          const existArea = normalizeForDedup((entry.details || '').match(/area:\s*([^;]+)/i)?.[1] || '').slice(0, 40);
          const newArea = normalizeForDedup((newObs.details || '').match(/area:\s*([^;]+)/i)?.[1] || '').slice(0, 40);
          const existIssue = normalizeForDedup((entry.details || '').match(/issue:\s*([^;]+)/i)?.[1] || '').slice(0, 40);
          const newIssue = normalizeForDedup((newObs.details || '').match(/issue:\s*([^;]+)/i)?.[1] || '').slice(0, 40);
          if (existArea && newArea && existArea === newArea && existIssue === newIssue) {
            existing = entry;
            break;
          }
        }
      }

      let merged = false;
      if (existing) {
        // Merge: append evidence (FIFO cap 10), increment count, update last_seen (D12)
        const newCount = (existing.observations || 0) + 1;
        existing.observations = newCount;
        existing.evidence = mergeEvidence(existing.evidence || [], newObs.evidence || []);
        existing.confidence = calculateConfidence(newCount, existing.type);
        existing.last_seen = nowIso;

        // Pattern update: if new pattern is >20% longer, use it
        const oldLen = (existing.pattern || '').length;
        const newLen = (newObs.pattern || '').length;
        if (newLen > oldLen * 1.2) existing.pattern = newObs.pattern;

        // Details merge: longer field wins; add missing fields
        if ((newObs.details || '').length > (existing.details || '').length) {
          existing.details = newObs.details;
        }

        // If details diverge significantly, flag for review and append new version
        // as an additional bullet rather than silently overwriting.
        const existDetails = normalizeForDedup(existing.details || '');
        const newDetails = normalizeForDedup(newObs.details || '');
        if (existDetails.length > 0 && newDetails.length > 0) {
          const similarity = longestCommonSubsequenceRatio(existDetails, newDetails);
          if (similarity < 0.6) {
            existing.needsReview = true;
            existing.details = (existing.details || '') + '\n\n**Additional observation**: ' + newObs.details;
          }
        }

        if (newObs.quality_ok === true) existing.quality_ok = true;

        merged = true;
        learningLog(`merge-observation: merged into ${existing.id} (count=${newCount})`);
      } else {
        // D11: ID collision recovery
        let newId = newObs.id;
        if (logMap.has(newId)) {
          // Collision with different type entry — suffix with _b
          newId = newId + '_b';
          learningLog(`merge-observation: ID collision resolved: ${newObs.id} -> ${newId}`);
        }
        const entry = {
          id: newId,
          type: newObs.type,
          pattern: newObs.pattern,
          confidence: INITIAL_CONFIDENCE,
          observations: 1,
          first_seen: nowIso,
          last_seen: nowIso,
          status: 'observing',
          evidence: (newObs.evidence || []).slice(0, 10),
          details: newObs.details || '',
          quality_ok: newObs.quality_ok === true,
        };
        logMap.set(newId, entry);
        learningLog(`merge-observation: new entry ${newId}`);
      }

      writeJsonlAtomic(logFile, Array.from(logMap.values()));
      console.log(JSON.stringify({ merged, id: existing ? existing.id : newObs.id }));
      break;
    }

    // -------------------------------------------------------------------------
    // decisions-append <file> <type> <obsJson>
    // Standalone op for appending to decisions files (decisions.md or pitfalls.md).
    // Acquires the shared `.memory/.decisions.lock` to serialize against render-ready
    // and any CLI updateDecisionsStatus callers. Lock path derivation matches the
    // render-ready handler: sibling of the `decisions/` directory.
    // -------------------------------------------------------------------------
    case 'decisions-append': {
      const decisionsFile = safePath(args[0]);
      const entryType = args[1]; // 'decision' or 'pitfall'
      let obs;
      try { obs = JSON.parse(args[2]); } catch {
        process.stderr.write('decisions-append: invalid JSON for observation\n');
        process.exit(1);
      }

      const isDecision = entryType === 'decision';
      const entryPrefix = isDecision ? 'ADR' : 'PF';
      const headingRe = isDecision ? /^## ADR-(\d+):/gm : /^## PF-(\d+):/gm;
      const artDate = new Date().toISOString().slice(0, 10);

      const decisionsDir = path.dirname(decisionsFile);
      const memoryDir = path.dirname(decisionsDir);
      const decisionsLockDir = path.join(memoryDir, '.decisions.lock');

      fs.mkdirSync(decisionsDir, { recursive: true });

      if (!acquireMkdirLock(decisionsLockDir, 30000, 60000)) {
        process.stderr.write(`decisions-append: timeout acquiring lock at ${decisionsLockDir}\n`);
        process.exit(1);
      }

      try {
        const existingContent = fs.existsSync(decisionsFile)
          ? fs.readFileSync(decisionsFile, 'utf8')
          : initDecisionsContent(entryType);

        // existingMatches needed for nextDecisionsId (uses Math.max on match groups)
        const existingMatches = [...existingContent.matchAll(headingRe)];

        // D18: count only active headings (latent bug fix — decisions-append never had capacity check)
        const previousCount = countActiveHeadings(existingContent, entryType);

        // D17: hard ceiling enforcement — same threshold as render-ready
        if (previousCount >= DECISIONS_HARD_CEILING) {
          process.stderr.write(`decisions-append: hard ceiling reached (${previousCount}/${DECISIONS_HARD_CEILING})\n`);
          console.log(JSON.stringify({ error: 'hard_ceiling', count: previousCount }));
          break; // exits switch, lock released in finally
        }

        const { anchorId } = nextDecisionsId(existingMatches, entryPrefix);

        const detailsStr = obs.details || '';
        let entry;
        if (isDecision) {
          const contextM = detailsStr.match(/context:\s*([^;]+)/i);
          const decisionM = detailsStr.match(/decision:\s*([^;]+)/i);
          const rationaleM = detailsStr.match(/rationale:\s*([^;]+)/i);
          entry = `\n## ${anchorId}: ${obs.pattern}\n\n- **Date**: ${artDate}\n- **Status**: Accepted\n- **Context**: ${(contextM||[])[1]||detailsStr}\n- **Decision**: ${(decisionM||[])[1]||obs.pattern}\n- **Consequences**: ${(rationaleM||[])[1]||''}\n- **Source**: self-learning:${obs.id || 'unknown'}\n`;
        } else {
          const areaM = detailsStr.match(/area:\s*([^;]+)/i);
          const issueM = detailsStr.match(/issue:\s*([^;]+)/i);
          const impactM = detailsStr.match(/impact:\s*([^;]+)/i);
          const resM = detailsStr.match(/resolution:\s*([^;]+)/i);
          // Status: Active — kept in sync with render-ready pitfall template so
          // `devflow learn --review` can deprecate entries appended via this op too.
          entry = `\n## ${anchorId}: ${obs.pattern}\n\n- **Area**: ${(areaM||[])[1]||detailsStr}\n- **Issue**: ${(issueM||[])[1]||detailsStr}\n- **Impact**: ${(impactM||[])[1]||''}\n- **Resolution**: ${(resM||[])[1]||''}\n- **Status**: Active\n- **Source**: self-learning:${obs.id || 'unknown'}\n`;
        }

        const newContent = existingContent + entry;

        // D26: TL;DR shows active-only count (excludes deprecated/superseded)
        const newActiveCount = countActiveHeadings(newContent, entryType);

        const updatedContent = buildUpdatedTldr(existingContent, newContent, entryPrefix, isDecision, anchorId, newActiveCount);
        writeFileAtomic(decisionsFile, updatedContent);

        // D20: register in usage tracking so cite counts start at 0
        registerUsageEntry(memoryDir, anchorId);

        // D21/D22/D24/D28: update capacity notification (first-run seed + threshold crossing)
        const notifKey = isDecision ? 'knowledge-capacity-decisions' : 'knowledge-capacity-pitfalls';
        updateCapacityNotification(memoryDir, notifKey, previousCount, newActiveCount);

        console.log(JSON.stringify({ anchorId, file: decisionsFile }));
      } finally {
        releaseLock(decisionsLockDir);
      }
      break;
    }

    // -------------------------------------------------------------------------
    // count-active <file> <type>
    // D23: Single source of truth bridge — TS CLI calls this to get active count
    // from countActiveHeadings without duplicating the logic.
    // -------------------------------------------------------------------------
    case 'count-active': {
      const filePath = safePath(args[0]);
      const entryType = args[1]; // 'decision' or 'pitfall'
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch { /* file doesn't exist — count is 0 */ }
      const count = countActiveHeadings(content, entryType);
      console.log(JSON.stringify({ count }));
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
    readUsageFile,
    writeUsageFile,
    readNotifications,
    writeNotifications,
    crossedThresholds,
    registerUsageEntry,
    acquireDecisionsUsageLock,
    releaseDecisionsUsageLock,
    DECISIONS_SOFT_START,
    DECISIONS_HARD_CEILING,
    DECISIONS_THRESHOLDS,
    writeFileAtomic,
    initDecisionsContent,
    nextDecisionsId,
  };
}
