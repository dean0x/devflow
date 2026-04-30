'use strict';

const path = require('path');

/**
 * Resolve a file path to an absolute path, optionally validating it
 * falls within an allowed root directory.
 *
 * @param {string} filePath
 * @param {string} [allowedRoot] — when provided, throws if resolved path escapes this root
 * @returns {string}
 */
function safePath(filePath, allowedRoot) {
  const resolved = path.resolve(filePath);
  if (typeof allowedRoot === 'string') {
    const root = path.resolve(allowedRoot);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Refused path outside ${root}: ${filePath}`);
    }
  }
  return resolved;
}

module.exports = { safePath };
