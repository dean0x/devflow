'use strict';

const path = require('path');

/**
 * Resolve a file path argument to an absolute path.
 * Note: path.resolve() normalizes away '..' segments, so the includes check
 * only catches the rare case of a literal '..' directory name surviving resolution.
 * Primary value is ensuring all file operations use absolute paths.
 *
 * @param {string} filePath
 * @returns {string}
 */
function safePath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.includes('..')) {
    throw new Error(`Refused path with traversal: ${filePath}`);
  }
  return resolved;
}

module.exports = { safePath };
