'use strict';

const fs = require('fs');
const { safePath } = require('./safe-path.cjs');

const ALLOWED_FIELDS = new Set(['referencedFiles', 'description']);

/**
 * Handle dream-related operations.
 * Returns true if the command was handled, false otherwise.
 *
 * read-dream <file> <field>:
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
  if (command !== 'read-dream') return false;

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
    const dreamFile = safePath(args[0], cwd);
    const data = JSON.parse(fs.readFileSync(dreamFile, 'utf8'));
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
