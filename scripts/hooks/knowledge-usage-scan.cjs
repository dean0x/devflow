#!/usr/bin/env node
'use strict';

// D29: Scanner runs after queue append, not before.
// D19: Citation scanner is a separate .cjs module — independently testable.

const fs = require('fs');
const path = require('path');

// Parse --cwd argument
const cwdIdx = process.argv.indexOf('--cwd');
const rawCwd = cwdIdx !== -1 && process.argv[cwdIdx + 1] ? process.argv[cwdIdx + 1] : null;
if (!rawCwd) process.exit(0); // silent fail

// Security: reject relative input BEFORE resolving (prevents CWE-23 path traversal).
// path.resolve() unconditionally returns an absolute path, so checking isAbsolute *after*
// resolving is a no-op. We must reject relative inputs first, then resolve to normalise
// traversal sequences (e.g. /foo/../bar → /bar).
// All legitimate callers (stop-hook) pass an absolute $CWD from bash.
if (!path.isAbsolute(rawCwd)) {
  console.error('cwd must be absolute, got:', rawCwd);
  process.exit(2);
}
const cwd = path.resolve(rawCwd);

const memoryDir = path.join(cwd, '.memory');
if (!fs.existsSync(memoryDir)) process.exit(0); // no .memory dir — nothing to scan

// Read stdin synchronously
let input = '';
try {
  input = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
} catch {
  process.exit(0); // no stdin — nothing to scan
}

if (!input) process.exit(0);

// Scan for ADR-NNN or PF-NNN citations
const pattern = /(ADR|PF)-\d{3}/g;
const matches = new Set();
let match;
while ((match = pattern.exec(input)) !== null) {
  matches.add(match[0]);
}

if (matches.size === 0) process.exit(0);

// Read usage file
const usagePath = path.join(memoryDir, '.knowledge-usage.json');
const lockDir = path.join(memoryDir, '.knowledge-usage.lock');

// Yield the current thread for the given number of milliseconds without spinning.
// Atomics.wait on a freshly allocated SharedArrayBuffer never resolves (value never
// changes), so it blocks the synchronous thread for exactly `ms` milliseconds with
// zero CPU usage — unlike a busy-wait loop.
function syncSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Simple mkdir-based lock with 2s timeout
function acquireLock() {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false;
      // Check for stale lock (>5s old)
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > 5000) {
          try { fs.rmdirSync(lockDir); } catch { /* race */ }
        }
      } catch { /* stat failed — retry */ }
      // Yield for 10 ms instead of busy-spinning to avoid pegging the CPU.
      syncSleep(10);
    }
  }
  return false;
}

function releaseLock() {
  try { fs.rmdirSync(lockDir); } catch { /* already released */ }
}

if (!acquireLock()) process.exit(0); // can't acquire lock — skip silently

try {
  let data = { version: 1, entries: {} };
  try {
    const raw = fs.readFileSync(usagePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && typeof parsed.entries === 'object') {
      data = parsed;
    }
  } catch { /* ENOENT or malformed — use default */ }

  const now = new Date().toISOString();
  let changed = false;

  for (const id of matches) {
    // Only increment existing entries (D19: ignores unregistered IDs)
    if (data.entries[id]) {
      data.entries[id].cites = (data.entries[id].cites || 0) + 1;
      data.entries[id].last_cited = now;
      changed = true;
    }
  }

  if (changed) {
    const tmp = usagePath + '.tmp';
    const content = JSON.stringify(data, null, 2) + '\n';
    // Use wx (O_EXCL) to reject any pre-existing file or symlink at the .tmp path,
    // preventing TOCTOU symlink-follow attacks. On EEXIST, unlink and retry once.
    try {
      fs.writeFileSync(tmp, content, { flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try { fs.unlinkSync(tmp); } catch { /* race — already removed */ }
      fs.writeFileSync(tmp, content, { flag: 'wx' });
    }
    fs.renameSync(tmp, usagePath);
  }
} finally {
  releaseLock();
}
