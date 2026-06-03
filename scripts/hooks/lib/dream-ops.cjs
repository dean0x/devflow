'use strict';

const fs = require('fs');
const { safePath } = require('./safe-path.cjs');

const ALLOWED_FIELDS = new Set(['referencedFiles', 'description']);

/**
 * Handle sidecar-related operations.
 * Returns true if the command was handled, false otherwise.
 *
 * read-sidecar <file> <field>:
 *   Only fields in ALLOWED_FIELDS are permitted.
 *   Array fields → JSON-stringified array (string elements only)
 *   String fields → raw string value
 *   Other/missing/disallowed → '[]'
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd — working directory used as safePath root
 * @returns {boolean}
 */
function handle(command, args, cwd) {
  if (command !== 'read-sidecar') return false;

  if (!args[0] || !args[1]) {
    console.log('[]');
    return true;
  }

  const field = args[1];
  if (!ALLOWED_FIELDS.has(field)) {
    console.log('[]');
    return true;
  }

  try {
    const sidecarFile = safePath(args[0], cwd);
    const data = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
    const value = data[field];
    if (Array.isArray(value)) {
      console.log(JSON.stringify(value.filter(v => typeof v === 'string')));
    } else if (typeof value === 'string') {
      console.log(value);
    } else {
      console.log('[]');
    }
  } catch {
    console.log('[]');
  }
  return true;
}

module.exports = { handle };
