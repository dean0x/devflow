#!/usr/bin/env node
'use strict';

// D29: Scanner runs after queue append, not before.
// D19: Citation scanner is a separate .cjs module — independently testable.

const fs = require('fs');
const path = require('path');

// Parse --cwd argument
const cwdIdx = process.argv.indexOf('--cwd');
const cwd = cwdIdx !== -1 && process.argv[cwdIdx + 1] ? process.argv[cwdIdx + 1] : null;
if (!cwd) process.exit(0); // silent fail

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
      // Brief spin wait
      const end = Date.now() + 10;
      while (Date.now() < end) { /* spin */ }
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
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, usagePath);
  }
} finally {
  releaseLock();
}
