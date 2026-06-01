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
//   filter-observations <file> [sort] [n] Filter valid observations, sort desc, limit
//   merge-observation <log> <newObsJson>  Reinforce existing observation by id (D14)
//   decisions-append <file> <type> <obs>  Append ADR/PF entry to decisions file
//   decisions-usage-scan                  Scan session context for ADR/PF cite counts
//   read-sidecar <file> <field>           Read field from sidecar JSON (allowed fields only; returns [] on any error)

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
  getLearningLogPath,
} = require('./lib/project-paths.cjs');

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

function mergeEvidence(oldEvidence, newEvidence) {
  const flat = [...(oldEvidence || []), ...(newEvidence || [])];
  const unique = [...new Set(flat)];
  return unique.slice(0, 10);
}

/**
 * Acquire a mkdir-based lock. Returns true on success, false on timeout.
 * DESIGN: Shared locking utility used by merge-observation and decisions-append.
 * Callers pass their own timeoutMs/staleMs to suit their workload:
 *   - .decisions.lock writes (decisions-append): 30 000 ms / 60 000 ms stale
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
    // merge-observation <log> <newObsJson>
    // ID-keyed reinforce op: if the id exists in the log, increment count, merge evidence,
    // update last_seen, and store LLM-provided confidence/status/quality_ok verbatim.
    // If the id is new, insert a new entry with LLM-provided fields verbatim.
    // D11: ID collision with different-type entry → suffix _b to avoid trampling.
    // D12: evidence array capped at 10 (FIFO).
    // D53: merge-observation is locked EXTERNALLY by the caller (SKILL.md processor acquires/
    // releases .devflow/sidecar/.reinforce.lock around the Bash subshell call), while
    // decisions-append self-locks INTERNALLY via .decisions.lock. These are two distinct lock
    // domains — merge-observation itself never acquires a lock; it relies on the caller to
    // serialize concurrent writes. This is intentional: the subshell pattern in the processor
    // spec acquires the lock, invokes this op, and releases — all in a single Bash call.
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

        logMap.set(newId, entry);
        learningLog(`merge-observation: new entry ${newId} confidence=${entry.confidence}`);
      }

      writeJsonlAtomic(logFile, Array.from(logMap.values()));
      console.log(JSON.stringify({ merged, id: existing ? existing.id : newObs.id }));
      break;
    }

    // -------------------------------------------------------------------------
    // decisions-append <file> <type> <obsJson>
    // Standalone op for appending to decisions files (decisions.md or pitfalls.md).
    // Acquires the shared `.devflow/decisions/.decisions.lock` to serialize concurrent
    // decisions-append writers and CLI updateDecisionsStatus callers. Lock path derivation
    // (sibling of the `decisions/` directory) must match updateDecisionsStatus in observation-io.ts.
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
      const devflowDir = path.dirname(decisionsDir);
      const projectRoot = path.dirname(devflowDir);
      const decisionsLockDir = getDecisionsLockDir(projectRoot);

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
          entry = `\n## ${anchorId}: ${obs.pattern}\n\n- **Area**: ${(areaM||[])[1]||detailsStr}\n- **Issue**: ${(issueM||[])[1]||detailsStr}\n- **Impact**: ${(impactM||[])[1]||''}\n- **Resolution**: ${(resM||[])[1]||''}\n- **Status**: Active\n- **Source**: self-learning:${obs.id || 'unknown'}\n`;
        }

        const newContent = existingContent + entry;

        // Count active headings for TL;DR (D26: excludes deprecated/superseded)
        const newActiveCount = countActiveHeadings(newContent, entryType);

        const updatedContent = buildUpdatedTldr(existingContent, newContent, entryPrefix, isDecision, anchorId, newActiveCount);
        writeFileAtomic(decisionsFile, updatedContent);

        // Register in usage tracking so cite counts start at 0
        registerUsageEntry(projectRoot, anchorId);

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
    registerUsageEntry,
    writeFileAtomic,
    initDecisionsContent,
    nextDecisionsId,
  };
}
