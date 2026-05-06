'use strict';

/**
 * split-migration.cjs
 *
 * One-time idempotent migration that partitions existing learning-log.jsonl
 * entries by observation type into two separate files:
 *   - learning-log.jsonl  → workflow + procedural observations (unchanged location)
 *   - decisions-log.jsonl → decision + pitfall observations (new file)
 *
 * Also splits .learning-manifest.json into:
 *   - .learning-manifest.json  → workflow + procedural manifest entries
 *   - .decisions-manifest.json → decision + pitfall manifest entries
 *
 * And renames .notifications.json → .decisions-notifications.json if present.
 *
 * Usage: node split-migration.cjs <cwd>
 *   <cwd>: project root directory; all paths relative to <cwd>/.memory/
 *
 * Idempotency: sentinel file .memory/.migration-split-done prevents re-runs.
 * Atomic writes: write to .tmp suffix, then rename.
 */

const fs = require('fs');
const path = require('path');
const { safePath } = require('./safe-path.cjs');

// Types that stay in learning-log.jsonl
const WORKFLOW_TYPES = new Set(['workflow', 'procedural']);
// Types that move to decisions-log.jsonl
const DECISIONS_TYPES = new Set(['decision', 'pitfall']);

/**
 * Atomic write: write content to <target>.tmp then rename to <target>.
 * @param {string} target      Absolute path to write to
 * @param {string} content     String content to write
 * @param {string} allowedRoot Root that both target and its .tmp must reside under
 */
function atomicWrite(target, content, allowedRoot) {
  const safeTarget = safePath(target, allowedRoot);
  const tmp = safeTarget + '.tmp';
  // tmp is safeTarget + literal string — still within allowedRoot
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, safeTarget);
}

/**
 * Parse JSONL — one JSON object per line. Returns array of parsed objects.
 * Silently skips blank or malformed lines.
 * @param {string} filePath    Absolute path to the JSONL file
 * @param {string} allowedRoot Root that filePath must reside under
 * @returns {object[]}
 */
function parseJsonl(filePath, allowedRoot) {
  const safeFile = safePath(filePath, allowedRoot);
  const text = fs.readFileSync(safeFile, 'utf8');
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Serialize an array of objects to JSONL format (trailing newline).
 * @param {object[]} entries
 * @returns {string}
 */
function toJsonl(entries) {
  if (entries.length === 0) return '';
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

function main() {
  const rawCwd = process.argv[2];
  if (!rawCwd) {
    process.stderr.write('split-migration: missing <cwd> argument\n');
    process.exit(1);
  }

  // Resolve and validate the cwd argument to prevent path traversal.
  // safePath() resolves to an absolute path; all derived paths are then
  // validated against this resolved root before any filesystem operation.
  const cwd = safePath(rawCwd);
  const memoryDir = path.join(cwd, '.memory');
  const sentinelPath = path.join(memoryDir, '.migration-split-done');

  // --- Idempotency check ---
  if (fs.existsSync(sentinelPath)) {
    // Already migrated; nothing to do
    return;
  }

  const logPath = path.join(memoryDir, 'learning-log.jsonl');

  // --- No log file → nothing to migrate ---
  if (!fs.existsSync(logPath)) {
    // Still write sentinel so we don't re-check on every session start
    atomicWrite(sentinelPath, '', cwd);
    return;
  }

  // --- Parse the log ---
  const allEntries = parseJsonl(logPath, cwd);

  // --- Partition by type ---
  const workflowEntries = [];
  const decisionsEntries = [];

  for (const entry of allEntries) {
    if (DECISIONS_TYPES.has(entry.type)) {
      decisionsEntries.push(entry);
    } else {
      // Default: keep in learning-log (workflow, procedural, or unknown types)
      workflowEntries.push(entry);
    }
  }

  // --- Build id→type lookup from log for manifest splitting ---
  const idToType = new Map();
  for (const entry of allEntries) {
    if (entry.id) {
      idToType.set(entry.id, entry.type);
    }
  }

  // --- Split manifest if present ---
  const manifestPath = path.join(memoryDir, '.learning-manifest.json');
  const decisionsManifestPath = path.join(memoryDir, '.decisions-manifest.json');

  if (fs.existsSync(manifestPath)) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(safePath(manifestPath, cwd), 'utf8'));
    } catch {
      // Corrupt manifest — skip splitting it
      manifest = null;
    }

    if (manifest && Array.isArray(manifest.entries)) {
      const workflowManifestEntries = [];
      const decisionsManifestEntries = [];

      for (const entry of manifest.entries) {
        const obsId = entry.observationId;
        const obsType = idToType.get(obsId);

        if (DECISIONS_TYPES.has(obsType)) {
          decisionsManifestEntries.push(entry);
        } else {
          workflowManifestEntries.push(entry);
        }
      }

      // Write decisions manifest (only if non-empty)
      if (decisionsManifestEntries.length > 0) {
        const decisionsManifest = {
          schemaVersion: manifest.schemaVersion || 1,
          entries: decisionsManifestEntries,
        };
        atomicWrite(decisionsManifestPath, JSON.stringify(decisionsManifest, null, 2), cwd);
      } else {
        // Create empty decisions manifest so downstream callers have a stable path
        const emptyManifest = { schemaVersion: 1, entries: [] };
        atomicWrite(decisionsManifestPath, JSON.stringify(emptyManifest, null, 2), cwd);
      }

      // Rewrite the learning manifest with only workflow/procedural entries
      const updatedManifest = {
        schemaVersion: manifest.schemaVersion || 1,
        entries: workflowManifestEntries,
      };
      atomicWrite(manifestPath, JSON.stringify(updatedManifest, null, 2), cwd);
    }
  }

  // --- Rename notifications file if present ---
  const notificationsPath = path.join(memoryDir, '.notifications.json');
  const decisionsNotificationsPath = path.join(memoryDir, '.decisions-notifications.json');

  if (fs.existsSync(notificationsPath) && !fs.existsSync(decisionsNotificationsPath)) {
    fs.renameSync(safePath(notificationsPath, cwd), safePath(decisionsNotificationsPath, cwd));
  }

  // --- Write split files atomically ---
  // decisions-log.jsonl: new file (decision + pitfall entries)
  const decisionsLogPath = path.join(memoryDir, 'decisions-log.jsonl');
  atomicWrite(decisionsLogPath, toJsonl(decisionsEntries), cwd);

  // learning-log.jsonl: rewritten with only workflow + procedural entries
  atomicWrite(logPath, toJsonl(workflowEntries), cwd);

  // --- Write sentinel ---
  atomicWrite(sentinelPath, '', cwd);
}

main();
