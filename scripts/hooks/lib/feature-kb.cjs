// scripts/hooks/lib/feature-kb.cjs
// Runtime module for per-feature knowledge base management.
//
// DESIGN: Feature KBs live under .features/{slug}/KNOWLEDGE.md with a central
// index at .features/index.json (keyed by slug). This module is the single
// source of truth for all KB operations — loading, staleness detection, index
// mutation, and listing. A mkdir-based lock guards concurrent index writes.
//
// ARCHITECTURE EXCEPTION: This is a developer-facing CLI tool invoked exclusively
// by trusted orchestration scripts within Claude Code. The worktree path argument
// is controlled by the Claude Code session, not by end users. Path traversal
// analysis (CWE-23) flags the worktreePath→fs I/O flow as a risk, but this is
// inherent to a tool whose sole purpose is to manage files in a git worktree.
// The same pattern exists in scripts/hooks/lib/knowledge-context.cjs (accepted).
// For command execution, we use execFileSync with array args (not shell strings)
// to prevent injection attacks from index content.
//
// CLI interface (see if-require.main block at bottom):
//   node feature-kb.cjs list <worktree>
//   node feature-kb.cjs stale <worktree> [slug]
//   node feature-kb.cjs update-index <worktree> --slug=X --name=Y ...
//   node feature-kb.cjs find-overlapping <worktree> <file1> [file2...]
//   node feature-kb.cjs remove <worktree> <slug>

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Sentinel returned whenever a KB is confirmed non-stale or a fallback is needed. */
const NOT_STALE = Object.freeze({ stale: false, changedFiles: [] });

/**
 * Parse git log output into a deduplicated list of changed file paths.
 * @param {string} output - raw stdout from `git log --name-only`
 * @returns {string[]}
 */
function parseGitChangedFiles(output) {
  return [...new Set(output.split('\n').map(l => l.trim()).filter(Boolean))];
}

/**
 * Parse git log output with dates into a map of file → latest change timestamp.
 * Expects `--pretty=format:%aI` output: ISO date, blank line, file names, blank, repeat.
 * Reverse chronological order means first occurrence = latest change.
 * @param {string} output
 * @returns {Map<string, number>}
 */
function parseGitLogWithDates(output) {
  const fileLatestChange = new Map();
  let currentDate = null;
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      currentDate = new Date(trimmed).getTime();
      continue;
    }
    if (currentDate !== null && !fileLatestChange.has(trimmed)) {
      fileLatestChange.set(trimmed, currentDate);
    }
  }
  return fileLatestChange;
}

/**
 * Validate that a slug is safe for use as a directory name.
 * Rejects path traversal attempts (e.g., '../etc'), absolute paths,
 * and characters unsafe for filesystem use.
 *
 * D52: Defense-in-depth — even though callers are trusted orchestration
 * scripts, validate at the boundary closest to the filesystem operation.
 *
 * @param {string} slug
 * @returns {void}
 * @throws {Error} if slug is invalid
 */
function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('Slug must be a non-empty string');
  }
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    throw new Error(`Invalid slug '${slug}': must not contain '..', '/', or '\\'`);
  }
  if (slug.startsWith('.')) {
    throw new Error(`Invalid slug '${slug}': must not start with '.'`);
  }
  // Only allow kebab-case identifiers: lowercase letters, digits, hyphens
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid slug '${slug}': must be kebab-case (lowercase letters, digits, hyphens)`);
  }
}

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 *   directories: string[],
 *   referencedFiles: string[],
 *   lastUpdated: string,
 *   createdBy: string
 * }} FeatureEntry
 */

/**
 * Load and parse .features/index.json from a worktree path.
 * Returns null when the file is absent or contains invalid JSON.
 *
 * @param {string} worktreePath
 * @returns {{ version: number, features: Record<string, FeatureEntry> } | null}
 */
function loadIndex(worktreePath) {
  const indexPath = path.join(worktreePath, '.features', 'index.json');
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Load KB content for a given slug.
 * Returns null when the KNOWLEDGE.md file is absent.
 *
 * @param {string} worktreePath
 * @param {string} slug
 * @returns {string | null}
 */
function loadKBContent(worktreePath, slug) {
  validateSlug(slug);
  const kbPath = path.join(worktreePath, '.features', slug, 'KNOWLEDGE.md');
  try {
    return fs.readFileSync(kbPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Check staleness for a single feature entry by running git log against its referencedFiles.
 * Callers are responsible for the git-dir check — this helper assumes the repo exists.
 *
 * @param {string} worktreePath
 * @param {FeatureEntry} entry
 * @returns {{ stale: boolean, changedFiles: string[] }}
 */
function checkEntryFiles(worktreePath, entry) {
  const files = entry.referencedFiles || [];
  if (files.length === 0) return NOT_STALE;

  try {
    // Use execFileSync with array args to prevent command injection.
    // lastUpdated comes from the index (a controlled ISO timestamp), but we
    // avoid string interpolation into a shell command as a defense-in-depth measure.
    const result = execFileSync(
      'git',
      ['log', `--after=${entry.lastUpdated}`, '--name-only', '--pretty=format:', '--', ...files],
      { cwd: worktreePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const changedFiles = parseGitChangedFiles(result);
    return { stale: changedFiles.length > 0, changedFiles };
  } catch {
    return NOT_STALE;
  }
}

/**
 * Check if a KB is stale by comparing lastUpdated against git log of referencedFiles.
 * Returns { stale: false } for non-git repos or when the entry is not found.
 *
 * @param {string} worktreePath
 * @param {string} slug
 * @returns {{ stale: boolean, changedFiles: string[] }}
 */
function checkStaleness(worktreePath, slug) {
  validateSlug(slug);
  const index = loadIndex(worktreePath);
  if (!index || !index.features[slug]) return NOT_STALE;

  try {
    // Check if in git repo — use execFileSync to avoid shell injection
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: worktreePath, stdio: 'pipe' });
  } catch {
    return NOT_STALE; // Non-git fallback
  }

  return checkEntryFiles(worktreePath, index.features[slug]);
}

/**
 * Check staleness for all KBs in the index.
 * Loads the index once, checks git-dir once, and runs a single git log call
 * to detect all changed files since the oldest lastUpdated timestamp.
 * Uses the oldest timestamp as the --after cutoff to minimize git calls,
 * then compares each file's latest change date against each entry's own
 * lastUpdated to avoid false-positive staleness.
 *
 * @param {string} worktreePath
 * @param {{ version: number; features: Record<string, unknown> } | null} [cachedIndex] - Optional pre-loaded index to avoid double reads
 * @returns {Record<string, { stale: boolean, changedFiles: string[] }>}
 */
function checkAllStaleness(worktreePath, cachedIndex) {
  const index = cachedIndex !== undefined ? cachedIndex : loadIndex(worktreePath);
  if (!index) return {};

  const slugs = Object.keys(index.features);
  if (slugs.length === 0) return {};

  // Check git-dir once for the whole batch
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: worktreePath, stdio: 'pipe' });
  } catch {
    // Non-git repo — all entries non-stale
    return Object.fromEntries(slugs.map(slug => [slug, NOT_STALE]));
  }

  // Collect all referenced files and find the oldest lastUpdated timestamp
  const allFiles = [];
  let oldestTimestamp = null;
  for (const slug of slugs) {
    const entry = index.features[slug];
    const files = entry.referencedFiles || [];
    for (const f of files) {
      if (!allFiles.includes(f)) allFiles.push(f);
    }
    if (entry.lastUpdated) {
      const ts = new Date(entry.lastUpdated).getTime();
      if (!isNaN(ts) && (oldestTimestamp === null || ts < oldestTimestamp)) {
        oldestTimestamp = ts;
      }
    }
  }

  // If no files or no timestamp, fall back to per-entry checks
  if (allFiles.length === 0 || oldestTimestamp === null) {
    const results = {};
    for (const slug of slugs) {
      results[slug] = checkEntryFiles(worktreePath, index.features[slug]);
    }
    return results;
  }

  // Single git log call for all files since oldest timestamp, with author dates
  let fileLatestChange;
  try {
    const gitOutput = execFileSync(
      'git',
      ['log', `--after=${new Date(oldestTimestamp).toISOString()}`, '--name-only', '--pretty=format:%aI', '--', ...allFiles],
      { cwd: worktreePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    fileLatestChange = parseGitLogWithDates(gitOutput);
  } catch {
    // Git call failed — fall back to per-entry checks
    const results = {};
    for (const slug of slugs) {
      results[slug] = checkEntryFiles(worktreePath, index.features[slug]);
    }
    return results;
  }

  // For each entry, compare its files' latest change dates against its own lastUpdated
  const results = {};
  for (const slug of slugs) {
    const entry = index.features[slug];
    const files = entry.referencedFiles || [];
    if (files.length === 0) {
      results[slug] = NOT_STALE;
      continue;
    }
    const entryTimestamp = entry.lastUpdated ? new Date(entry.lastUpdated).getTime() : 0;
    const changedForEntry = files.filter(f => {
      const changeTs = fileLatestChange.get(f);
      return changeTs !== undefined && changeTs > entryTimestamp;
    });
    results[slug] = { stale: changedForEntry.length > 0, changedFiles: changedForEntry };
  }
  return results;
}

/**
 * Attempt to break a stale mkdir-based lock.
 * Returns true when the lock is gone (either removed or already absent),
 * false when the lock is still live (within staleMs).
 *
 * @param {string} lockPath
 * @param {number} staleMs
 * @returns {boolean}
 */
function tryBreakStaleLock(lockPath, staleMs) {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) {
      try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
      return true;
    }
  } catch {
    return true; // lock disappeared
  }
  return false;
}

/**
 * Acquire a mkdir-based lock. Follows the same pattern as .memory/.knowledge.lock.
 * Returns true when the lock is acquired within timeoutMs, false otherwise.
 *
 * @param {string} lockPath
 * @param {number} [timeoutMs=30000]
 * @param {number} [staleMs=60000]
 * @returns {boolean}
 */
function acquireLock(lockPath, timeoutMs = 30000, staleMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      fs.mkdirSync(lockPath);
      return true;
    } catch {
      if (!tryBreakStaleLock(lockPath, staleMs)) {
        // Wait 100ms before retrying (Atomics.wait avoids shell dependency)
        try {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        } catch { /* Node < 16 fallback: busy-wait */ }
      }
    }
  }
  return false;
}

/**
 * Release a mkdir-based lock.
 *
 * @param {string} lockPath
 */
function releaseLock(lockPath) {
  try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
}

/**
 * Create or update an entry in index.json with the mkdir-based lock protocol.
 *
 * @param {string} worktreePath
 * @param {{
 *   slug: string,
 *   name: string,
 *   description?: string,
 *   directories: string[],
 *   referencedFiles: string[],
 *   createdBy?: string
 * }} entry
 * @param {number} [lockTimeoutMs=30000] optional lock timeout for testability
 */
function updateIndex(worktreePath, entry, lockTimeoutMs = 30000) {
  validateSlug(entry.slug);
  const featuresDir = path.join(worktreePath, '.features');
  fs.mkdirSync(featuresDir, { recursive: true });
  const lockPath = path.join(featuresDir, '.kb.lock');
  const indexPath = path.join(featuresDir, 'index.json');

  if (!acquireLock(lockPath, lockTimeoutMs)) {
    throw new Error('Failed to acquire .features/.kb.lock within timeout');
  }

  try {
    let index = { version: 1, features: {} };
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch { /* start fresh */ }

    const existing = index.features[entry.slug] || {};
    index.features[entry.slug] = {
      name: entry.name,
      description: entry.description ?? existing.description ?? '',
      directories: entry.directories,
      referencedFiles: entry.referencedFiles,
      lastUpdated: new Date().toISOString(),
      createdBy: entry.createdBy || existing.createdBy || 'manual',
    };

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * Find KBs whose referencedFiles overlap with the given changed file list.
 * Uses directory-boundary matching to avoid false positives (e.g., `src/foo`
 * matching `src/foobar`). Returns the list of slugs with overlapping files.
 *
 * @param {string} worktreePath
 * @param {string[]} changedFiles
 * @returns {string[]} slugs that have overlapping referenced files
 */
function findOverlapping(worktreePath, changedFiles) {
  const index = loadIndex(worktreePath);
  if (!index) return [];

  const overlappingSlugs = [];
  for (const [slug, entry] of Object.entries(index.features)) {
    const refs = entry.referencedFiles || [];
    const overlap = refs.some(ref =>
      changedFiles.some(f => f === ref || f.startsWith(ref + '/') || ref.startsWith(f + '/'))
    );
    if (overlap) overlappingSlugs.push(slug);
  }
  return overlappingSlugs;
}

/**
 * Remove a KB entry from index.json and delete its directory.
 * No-op if the slug does not exist in the index or if .features/ is absent.
 *
 * @param {string} worktreePath
 * @param {string} slug
 * @param {number} [lockTimeoutMs=30000] optional lock timeout for testability
 */
function removeEntry(worktreePath, slug, lockTimeoutMs = 30000) {
  validateSlug(slug);
  const featuresDir = path.join(worktreePath, '.features');
  if (!fs.existsSync(featuresDir)) return;
  const lockPath = path.join(featuresDir, '.kb.lock');
  const indexPath = path.join(featuresDir, 'index.json');

  if (!acquireLock(lockPath, lockTimeoutMs)) {
    throw new Error('Failed to acquire .features/.kb.lock within timeout');
  }

  try {
    let index;
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch {
      return; // nothing to remove — preserve existing (possibly corrupt) file
    }

    delete index.features[slug];
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');

    const kbDir = path.join(featuresDir, slug);
    try {
      fs.rmSync(kbDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * List all KBs with their metadata (slug + FeatureEntry fields).
 *
 * @param {string} worktreePath
 * @returns {Array<{ slug: string } & FeatureEntry>}
 */
/**
 * @param {string} worktreePath
 * @param {{ version: number; features: Record<string, unknown> } | null} [cachedIndex] - Optional pre-loaded index to avoid double reads
 */
function listKBs(worktreePath, cachedIndex) {
  const index = cachedIndex !== undefined ? cachedIndex : loadIndex(worktreePath);
  if (!index) return [];
  return Object.entries(index.features).map(([slug, entry]) => ({ slug, ...entry }));
}

// ---------------------------------------------------------------------------
// CLI interface
//
// Usage:
//   node feature-kb.cjs list <worktree>
//   node feature-kb.cjs stale <worktree> [slug]
//   node feature-kb.cjs update-index <worktree> --slug=X --name=Y --directories='[...]' --referencedFiles='[...]' [--description=Y] [--createdBy=Z]
//   node feature-kb.cjs find-overlapping <worktree> <file1> [file2...]
//   node feature-kb.cjs remove <worktree> <slug>
//   node feature-kb.cjs stale-slugs <worktree>
//   node feature-kb.cjs refresh-context <worktree> <slug>
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  /**
   * Parse --key=value style arguments from an argv array.
   * @param {string[]} args
   * @returns {Record<string, string>}
   */
  function parseKeyValue(args) {
    const result = {};
    for (const arg of args) {
      const m = arg.match(/^--([^=]+)=(.*)$/s);
      if (m) result[m[1]] = m[2];
    }
    return result;
  }

  const USAGE = [
    'Usage:',
    '  node feature-kb.cjs list <worktree>',
    '  node feature-kb.cjs stale <worktree> [slug]',
    '  node feature-kb.cjs update-index <worktree> --slug=X --name=Y --directories=\'[...]\' --referencedFiles=\'[...]\' [--description=Y] [--createdBy=Z]',
    '  node feature-kb.cjs find-overlapping <worktree> <file1> [file2...]',
    '  node feature-kb.cjs remove <worktree> <slug>',
    '  node feature-kb.cjs stale-slugs <worktree>',
    '  node feature-kb.cjs refresh-context <worktree> <slug>',
  ].join('\n');

  /**
   * Resolve and validate a worktree path argument.
   * Exits with an error message if missing or not a valid directory.
   * @param {string[]} cliArgv
   * @returns {string}
   */
  function requireWorktree(cliArgv) {
    const p = cliArgv[1] ? path.resolve(cliArgv[1]) : null;
    if (!p) {
      process.stderr.write('Error: missing worktree argument\n' + USAGE + '\n');
      process.exit(1);
    }
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
      process.stderr.write(`Error: '${p}' is not a valid directory\n`);
      process.exit(1);
    }
    return p;
  }

  /** @type {Record<string, () => void>} */
  const dispatch = {
    list() {
      const worktreePath = requireWorktree(argv);
      const entries = listKBs(worktreePath);
      process.stderr.write(`[feature-kb] mode=list worktree=${worktreePath} count=${entries.length}\n`);
      process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      process.exit(0);
    },

    stale() {
      const worktreePath = requireWorktree(argv);
      const slug = argv[2];
      if (slug) {
        const result = checkStaleness(worktreePath, slug);
        process.stderr.write(`[feature-kb] mode=stale worktree=${worktreePath} slug=${slug} stale=${result.stale}\n`);
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        const result = checkAllStaleness(worktreePath);
        process.stderr.write(`[feature-kb] mode=stale worktree=${worktreePath} all=true\n`);
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      }
      process.exit(0);
    },

    'update-index'() {
      const worktreePath = requireWorktree(argv);
      const kv = parseKeyValue(argv.slice(2));
      if (!kv.slug || !kv.name || !kv.directories || !kv.referencedFiles) {
        process.stderr.write('Error: missing required flags (slug, name, directories, referencedFiles)\n' + USAGE + '\n');
        process.exit(1);
      }
      let directories;
      let referencedFiles;
      try {
        directories = JSON.parse(kv.directories);
        referencedFiles = JSON.parse(kv.referencedFiles);
      } catch (e) {
        process.stderr.write(`Error: --directories and --referencedFiles must be valid JSON arrays: ${e.message}\n`);
        process.exit(1);
      }
      updateIndex(worktreePath, {
        slug: kv.slug,
        name: kv.name,
        description: kv.description,
        directories,
        referencedFiles,
        createdBy: kv.createdBy,
      });
      process.stderr.write(`[feature-kb] mode=update-index worktree=${worktreePath} slug=${kv.slug}\n`);
      process.stdout.write(JSON.stringify({ ok: true, slug: kv.slug }) + '\n');
      process.exit(0);
    },

    'find-overlapping'() {
      const worktreePath = requireWorktree(argv);
      const changedFiles = argv.slice(2);
      const overlapping = findOverlapping(worktreePath, changedFiles);
      process.stderr.write(`[feature-kb] mode=find-overlapping worktree=${worktreePath} overlappingCount=${overlapping.length}\n`);
      process.stdout.write(JSON.stringify(overlapping, null, 2) + '\n');
      process.exit(0);
    },

    remove() {
      const worktreePath = requireWorktree(argv);
      const slug = argv[2];
      if (!slug) {
        process.stderr.write('Error: missing slug argument\n' + USAGE + '\n');
        process.exit(1);
      }
      removeEntry(worktreePath, slug);
      process.stderr.write(`[feature-kb] mode=remove worktree=${worktreePath} slug=${slug}\n`);
      process.stdout.write(JSON.stringify({ ok: true, slug }) + '\n');
      process.exit(0);
    },

    'stale-slugs'() {
      const worktreePath = requireWorktree(argv);
      const staleness = checkAllStaleness(worktreePath);
      for (const [slug, info] of Object.entries(staleness)) {
        if (info.stale) {
          process.stdout.write(slug + '\n');
        }
      }
      process.exit(0);
    },

    'refresh-context'() {
      const worktreePath = requireWorktree(argv);
      const slug = argv[2];
      if (!slug) {
        process.stderr.write('Error: missing slug argument\n' + USAGE + '\n');
        process.exit(1);
      }
      validateSlug(slug);
      const index = loadIndex(worktreePath);
      if (!index || !index.features[slug]) {
        process.stderr.write(`Error: KB '${slug}' not found in index\n`);
        process.exit(1);
      }
      const entry = index.features[slug];
      const staleness = checkStaleness(worktreePath, slug);
      // Tab-separated: name, directories JSON, changed files JSON
      process.stdout.write([
        entry.name,
        JSON.stringify(entry.directories),
        JSON.stringify(staleness.changedFiles),
      ].join('\t') + '\n');
      process.exit(0);
    },
  };

  if (!subcommand) {
    process.stderr.write(USAGE + '\n');
    process.exit(1);
  }

  const handler = dispatch[subcommand];
  if (!handler) {
    process.stderr.write(`Error: unknown subcommand '${subcommand}'\n` + USAGE + '\n');
    process.exit(1);
  }
  handler();
}

module.exports = { loadIndex, loadKBContent, checkStaleness, checkAllStaleness, updateIndex, findOverlapping, removeEntry, listKBs, validateSlug };
// Note: loadIndex is already exported above, enabling callers to read the index once
// and pass it to listKBs/checkAllStaleness via their optional cachedIndex parameter.
