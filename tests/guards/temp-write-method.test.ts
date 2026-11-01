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
const PLAIN_MKTEMP = /`mktemp`(?!-)|\$\(mktemp(?:\s+(?!-d\b)[^)]*)?\)/

/** The sentences of `text` that Write into a file made by `mktemp`. */
function tempWriteViolations(text: string): string[] {
  return text
    .split('\n')
    .flatMap(line => line.split(/(?<=[.!?])\s+/))
    .filter(sentence => WRITE_TOOL.test(sentence) && PLAIN_MKTEMP.test(sentence))
}

/**
 * The folder rule: a step that makes its file in a `mktemp -d` folder and removes that file removes the
 * folder too, with `rmdir -- "${F%/*}"` after the file removal. `rmdir` refuses a folder that holds
 * anything, so it never reaches a file the step did not make. A recursive delete of the folder is no
 * way to do it. The rule works per source line, because each site states the folder and its removal
 * in one line. A line that names no file removal (a report-overflow line keeps its file for the reader)
 * and a plain `mktemp` file make no folder, so they are out of the rule.
 */
const TEMP_DIR = /`mktemp -d`/
const FILE_REMOVAL = /\brm -- "(?:\$F|\{[^}"]* file\})"/
const FOLDER_REMOVAL = 'rmdir -- "${F%/*}"'
const RECURSIVE_REMOVAL = /\brm\s+-[A-Za-z]*[rR]/

/** The lines that remove a `mktemp -d` file and leave its folder, or remove the folder recursively. */
function folderRemovalDefects(text: string): string[] {
  return text
    .split('\n')
    .filter(line => TEMP_DIR.test(line))
    .filter(line => RECURSIVE_REMOVAL.test(line) || (FILE_REMOVAL.test(line) && !line.includes(FOLDER_REMOVAL)))
}

/** The lines that remove a `mktemp -d` file together with its folder. */
function folderRemovalSites(text: string): string[] {
  return text.split('\n').filter(line => TEMP_DIR.test(line) && FILE_REMOVAL.test(line) && line.includes(FOLDER_REMOVAL))
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
    expect(tempWriteViolations('Run `F="$(mktemp -t x)"`, then Write the title to it.')).toHaveLength(1)
    expect(tempWriteViolations('Run `D="$(mktemp -d)"`, then Write the title to a new file in it.')).toEqual([])
    expect(tempWriteViolations('Write it byte for byte to a new file in a `mktemp -d` folder with the Write tool.')).toEqual([])
    expect(tempWriteViolations('Capture in one Bash call: `LOG=$(mktemp); <command> >"$LOG"`.')).toEqual([])
    expect(tempWriteViolations('longer material goes to a unique `mktemp`-style temp file written with Write.')).toEqual([])
  })

  it('every prompt step that removes a file of a mktemp -d folder removes the folder too', () => {
    const files = walkFiles(ASSETS_DIR, file => ['.md', '.mds'].includes(path.extname(file)))
    const texts = files.map(file => [file, readFileSync(file, 'utf8')] as const)
    const defects = texts.flatMap(([file, text]) => folderRemovalDefects(text).map(line => `${path.relative(ROOT, file)}: ${line.slice(0, 160)}`))
    expect(defects).toEqual([])
    // Non-vacuity: the three sites (the PR create in 4a, the retitle in 4c, the fresh base of /implement).
    const sites = texts.flatMap(([, text]) => folderRemovalSites(text))
    expect(sites.length, 'the corpus holds no folder removal, so this guard proves nothing').toBeGreaterThanOrEqual(3)
  })

  it('flags a removal that leaves the folder or deletes it recursively, and admits the joined form', () => {
    const old4c = 'Write the title to a new file in a `mktemp -d` folder (`{title file}`). A missing title skips the retitle after `rm -- "{title file}"`. Otherwise run `F="{title file}"; trap \'rm -- "$F"\' EXIT; test -s "$F"`.'
    const old4a = 'Then Write `BASE_BRANCH` to a new file in a `mktemp -d` folder (`{name file}`), then `rm -- "$F"`. That `rm` runs when the shell reaches it.'
    const recursive = 'Write the name to a new file in a `mktemp -d` folder, then run `rm -rf "$D"`.'
    const joined = 'Write the name to a new file in a `mktemp -d` folder, then run `F="{name file}"; trap \'rm -- "$F"; rmdir -- "${F%/*}"\' EXIT;`.'
    expect(folderRemovalDefects(old4c)).toHaveLength(1)
    expect(folderRemovalDefects(old4a)).toHaveLength(1)
    expect(folderRemovalDefects(recursive)).toHaveLength(1)
    expect(folderRemovalDefects('Write the name to a new file in a `mktemp -d` folder, then run `rm -r "$D"`.')).toHaveLength(1)
    expect(folderRemovalDefects(joined)).toEqual([])
    expect(folderRemovalSites(joined)).toHaveLength(1)
    // A report-overflow line keeps its file, and a plain `mktemp` file makes no folder.
    expect(folderRemovalDefects('longer material goes to a new file in a `mktemp -d` folder and the message gives its path.')).toEqual([])
    expect(folderRemovalDefects('Run `F="$(mktemp)"; trap \'rm -- "$F"\' EXIT`.')).toEqual([])
  })
})
