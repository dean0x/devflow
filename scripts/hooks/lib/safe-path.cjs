'use strict';

const path = require('path');

function safePath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.includes('..')) {
    throw new Error(`Refused path with traversal: ${filePath}`);
  }
  return resolved;
}

module.exports = { safePath };
