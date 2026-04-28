'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve a file path argument to an absolute path.
 * Rejects any path that still contains '..' after resolution.
 */
function safePath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.includes('..')) {
    throw new Error(`Refused path with traversal: ${filePath}`);
  }
  return resolved;
}

/**
 * Handle sidecar-related operations.
 * Returns true if the command was handled, false otherwise.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {boolean}
 */
function handle(command, args) {
  if (command !== 'read-sidecar') return false;

  if (!args[0] || !args[1]) {
    console.log('[]');
    return true;
  }
  const sidecarFile = safePath(args[0]);
  const field = args[1];
  try {
    const data = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
    const value = data[field];
    console.log(Array.isArray(value) ? JSON.stringify(value.filter(v => typeof v === 'string')) : '[]');
  } catch {
    console.log('[]');
  }
  return true;
}

module.exports = { handle };
