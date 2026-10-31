/**
 * temp-write-method — a prompt step that Writes a temp file Writes a new file in a
 * `mktemp -d` folder, never into a file that `mktemp` made.
 *
 * The Write tool refuses an existing file that the session did not Read first.
 * `mktemp` creates the file, so a step that runs `mktemp` and then Writes pays a
 * refused call, or a Read before every Write. A new file in a `mktemp -d` folder
 * does not exist yet, so the first Write succeeds. One method serves every site.
 *
 * The rule works per sentence: a sentence that names the Write tool and a plain
 * `mktemp` file (`` `mktemp` `` or `$(mktemp)`, not `mktemp -d` and not
 * `` `mktemp`-style ``) is a violation. A Bash step that fills its own `mktemp`
 * file names no Write, so it passes.
 *
 * Scope: every prompt source under `src/assets/` (`.md` and `.mds`).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, walkFiles } from '../helpers.js'

const ASSETS_DIR = path.join(ROOT, 'src', 'assets')

const WRITE_TOOL = /\bWrite\b/
const PLAIN_MKTEMP = /`mktemp`(?!-)|\$\(mktemp\)/

/** The sentences of `text` that Write into a file made by `mktemp`. */
function tempWriteViolations(text: string): string[] {
  return text
    .split('\n')
    .flatMap(line => line.split(/(?<=[.!?])\s+/))
    .filter(sentence => WRITE_TOOL.test(sentence) && PLAIN_MKTEMP.test(sentence))
}

describe('temp-write-method', () => {
  it('no prompt source Writes into a file that mktemp made', () => {
    const files = walkFiles(ASSETS_DIR, file => ['.md', '.mds'].includes(path.extname(file)))
    expect(files.length, 'the corpus reaches the prompt sources').toBeGreaterThan(100)
    const defects = files.flatMap(file =>
      tempWriteViolations(readFileSync(file, 'utf8')).map(s => `${path.relative(ROOT, file)}: ${s.slice(0, 160)}`),
    )
    expect(defects).toEqual([])
  })

  it('flags the known-bad forms and admits the mktemp -d form', () => {
    expect(tempWriteViolations('Write it byte for byte to a fresh `mktemp` file with the Write tool.')).toHaveLength(1)
    expect(tempWriteViolations('Run `F="$(mktemp)" && echo "F=$F"`, Read that file, and Write the title to it.')).toHaveLength(1)
    expect(tempWriteViolations('longer material goes to a `mktemp` file (via Bash or Write).')).toHaveLength(1)
    expect(tempWriteViolations('Write it byte for byte to a new file in a `mktemp -d` folder with the Write tool.')).toEqual([])
    expect(tempWriteViolations('Capture in one Bash call: `LOG=$(mktemp); <command> >"$LOG"`.')).toEqual([])
    expect(tempWriteViolations('longer material goes to a unique `mktemp`-style temp file written with Write.')).toEqual([])
  })
})
