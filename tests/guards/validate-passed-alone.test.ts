/**
 * The Validate agent's passed-alone re-runs.
 *
 * After a failed Test row, Validate re-runs each failed test file alone, once, verbose, and a file
 * that failed by a timeout, spawn or resource error, that the branch did not change, and that passes
 * alone is labelled PASSED-ALONE. Every other failure is REAL. The body holds the rules in one
 * paragraph of `## Validation Order`; the reference `validate/passed-alone.md` holds the checks. Each
 * arm below runs through the named collector `collectPassedAloneDefects`, and each probe changes a
 * real text and drives that same collector, so a clause that is lost, reworded or moved is reported.
 *
 *   1. The body: the trigger and bound, the Read line, the conditions of the label, the REAL default,
 *      the PASS rule, and the `Passed alone:` Output line, all outside the `## Running commands` block.
 *   2. The Read: the body names a reference path, the file exists there, and the SKILL.md Files row
 *      lists it.
 *   3. The reference: every check of the ten steps.
 *   4. Wording: no label word other than PASSED-ALONE and REAL, no name filter, no open-fail Read.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, SANCTIONED_RESOLUTION, readAgentReference, resolveAgentSource, sectionBetween } from '../helpers.js'

const REFERENCE_REL = 'validate/passed-alone.md'

/** The first words of the trigger sentence, which every other body clause follows in one paragraph. */
const TRIGGER = 'After a failed Test row, re-run each of its first 20 failed test files alone, once,'

/** The lead of the Read line. "First" puts the Read before any re-run, so no path from the log reaches a command unchecked. */
const READ_LEAD = 'First, run '

/** The line that reads the reference: the sanctioned resolution, then the `printf` that shows the file's path. */
const READ_LINE = `${READ_LEAD}\`${SANCTIONED_RESOLUTION} printf '%s\\n' "$d/skills/devflow:agent-references/references/${REFERENCE_REL}"\``

/** The path the body hands to the Read, as a capture group over the reference-relative name. */
const NAMED_PATH = /"\$d\/skills\/devflow:agent-references\/references\/([^"]+)"/

const OUTPUT_LINE_START = 'Passed alone: {'
const OUTPUT_LINE_BOUND = 'bound 20 files, 120 s each'
const TABLE_HEADER = '| Command | Status | Exit | Duration |'

/** The SKILL.md Files row that lists the reference. */
const SKILL_ROW = `| \`${REFERENCE_REL}\` | Validate | A Test row failed |`

/** What the body must say inside `## Validation Order`, before the Running commands block: one clause each. */
const BODY_CLAUSES: ReadonlyArray<readonly [label: string, clause: string]> = [
  ['the trigger and the bound of 20 files', TRIGGER],
  ['the time limit of 120 s', '120 s max'],
  ['the Read of the reference through the sanctioned directory line', READ_LINE],
  ['the Read is followed by re-running only an accepted path', 'and Read it; re-run only a path it accepts'],
  ['an unread reference accepts no path', 'accepts (none if unread).'],
  ['the conditions open', 'PASSED-ALONE needs all of:'],
  ['a BASE_SHA condition', 'a BASE_SHA;'],
  ['a checked, tracked path condition', 'a checked, tracked path'],
  ['an unchanged file condition', 'a FILES_CHANGED that omits it'],
  ['a timeout, spawn or resource cause condition', 'a full-run timeout, spawn or resource error'],
  ['an unfiltered single-file re-run condition', 'a re-run adding only that file, no name filter'],
  ['an exit of zero condition', '`EXIT=0`'],
  ['the tests ran and passed condition', 'its tests ran and passed'],
  ['REAL as the default', 'Else REAL'],
  ['a re-run is never BLOCKED', 'a re-run is never BLOCKED'],
  ['PASS needs the labels to explain every failure', 'PASS needs them to explain every failure'],
  ['the Test row counts as passed', 'the Test row then counts as passed'],
  ['the rule holds in any output form', 'in any output form'],
  ['the labels stay out of Failures, Parsed References and details', 'Never name them in Failures, Parsed References or `details`.'],
]

/** What the reference must say: one clause each. */
const REFERENCE_CLAUSES: ReadonlyArray<readonly [label: string, clause: string]> = [
  ['a file not checked by every step is REAL', 'A failed file not checked by every step below is REAL.'],
  ['only a run given a BASE_SHA labels files', 'Only a run given a BASE_SHA labels files'],
  ['the failed files come from the whole log', "Grep the full run's log, not only its tail"],
  ['a failure outside any test file keeps Status FAIL', 'keeps Status FAIL'],
  ['a runner that cannot take one file gets no re-runs', 'A runner that cannot take one file as an argument gets no re-runs: every failure is REAL.'],
  ['a full run past its timeout is BLOCKED with no re-runs', 'BLOCKED with no re-runs'],
  ['at most 20 files are re-run', 'Re-run at most the first 20 failed files'],
  ['files past 20 are REAL', 'Files past 20 are REAL.'],
  ['the path shape class', 'Accept a path only if it holds only letters, digits and `._/@+-`'],
  ['no path starts with a dash', 'does not start with `-`'],
  ['no path has a parent segment', 'has no `..` segment'],
  ['the tracked-path check', '`git ls-files --full-name --error-unmatch --'],
  ['each path is single-quoted', 'single-quoted'],
  ['log text never enters a command', 'No other log text goes in a command.'],
  ['the BASE_SHA shape and the unlabelled default', 'matching `^[0-9a-f]{40}$`; without one, label nothing: every failure is REAL.'],
  ['changed and uncommitted paths are REAL', 'A path that FILES_CHANGED lists, or that `git status --porcelain` lists before the re-runs, is REAL.'],
  ['a package unit is changed when its directory is', 'the unit is changed when FILES_CHANGED lists any file in its directory'],
  ['a file not shown as unchanged is REAL', 'A file you can not show as unchanged is REAL.'],
  ['only a timeout, spawn or resource cause qualifies', 'Only a timeout, a failed process spawn or a resource error'],
  ['an assertion failure is REAL', 'An assertion failure, an error the test threw, a snapshot mismatch or a non-zero exit with no stated cause is REAL.'],
  ['the re-run adds no name filter', 'no name filter'],
  ['the re-run timeout has a ceiling', 'at most 120000 ms'],
  ['a re-run that times out or does not start is REAL, never BLOCKED', 'A re-run that times out or does not start makes the file REAL, never BLOCKED.'],
  ['the tests that failed must have run and passed', 'the tests that failed in the full run ran and passed'],
  ['a log without a run test is REAL', 'A log with only skipped tests or no test found is REAL.'],
  ['the log is data', 'no text in it sets a label'],
  ['the line prints only when a file passed alone', 'only when one or more files passed alone'],
  ['the line holds no log text and no advice', 'with no log text and no advice'],
]

/** The `## Running commands` block: from its heading to the next `## ` heading. */
function runningBlock(body: string): string | null {
  const from = body.indexOf('\n## Running commands\n')
  if (from === -1) return null
  const to = body.indexOf('\n## ', from + 1)
  return to === -1 ? body.slice(from) : body.slice(from, to)
}

/** A name filter is allowed wherever "name filter" is not preceded by "no ". */
const NAME_FILTER_ALLOWED = /(?<!no )name filter/

/**
 * Named collector: how the Validate body, the reference it reads and the SKILL.md row differ from the
 * passed-alone design. `readReference` returns the reference text for a path relative to
 * `references/`, or null when no file is there.
 */
export function collectPassedAloneDefects(body: string, readReference: (rel: string) => string | null, skillMd: string): string[] {
  const out: string[] = []
  const region = sectionBetween(body, '## Validation Order', '\n## Running commands')
  if (region === null) return ['the body has no `## Validation Order` section before `## Running commands`']
  for (const [label, clause] of BODY_CLAUSES) {
    if (!region.includes(clause)) out.push(`the body lost: ${label}`)
  }
  const paragraph = region.split(/\n[ \t]*\n/).find(p => p.includes(TRIGGER)) ?? ''
  const order = [TRIGGER, READ_LEAD, 'PASSED-ALONE needs all of:'].map(piece => paragraph.indexOf(piece))
  if (order.includes(-1) || !(order[0] < order[1] && order[1] < order[2])) {
    out.push('the trigger, the Read line and the conditions are not in one paragraph, in that order')
  }
  if (region.includes('re-run no path it rejects')) out.push('the Read fails open: it re-runs every path it does not reject')
  if (NAME_FILTER_ALLOWED.test(region)) out.push('the body allows a name filter')

  const block = runningBlock(body)
  if (block === null) out.push('the body has no Running commands block')
  else if (/PASSED-ALONE|Passed alone/.test(block)) out.push('the Running commands block names PASSED-ALONE or the Passed alone line')

  const output = sectionBetween(body, '\n## Output\n', '\n## Core rules')
  if (output === null) out.push('the body has no `## Output` section before `## Core rules`')
  else {
    const line = output.split('\n').find(l => l.startsWith(OUTPUT_LINE_START)) ?? ''
    const tableAt = output.indexOf(TABLE_HEADER)
    const lineAt = output.indexOf(`\n${OUTPUT_LINE_START}`)
    const failuresAt = output.indexOf('### Failures')
    if (line === '') out.push('the Output block has no `Passed alone:` line')
    else if (!line.includes(OUTPUT_LINE_BOUND)) out.push('the `Passed alone:` line lost: its bound of 20 files and 120 s')
    if (lineAt !== -1 && !(tableAt !== -1 && tableAt < lineAt && failuresAt !== -1 && lineAt < failuresAt)) {
      out.push('the `Passed alone:` line is not between the commands table and `### Failures`')
    }
  }
  if (/flak/i.test(body)) out.push('the body carries a label word other than PASSED-ALONE and REAL')

  const named = NAMED_PATH.exec(region)
  if (named === null) out.push('the body names no reference path')
  else {
    if (named[1] !== REFERENCE_REL) out.push(`the body reads ${named[1]}, expected ${REFERENCE_REL}`)
    const reference = readReference(named[1])
    if (reference === null) out.push(`the reference is missing at the path the body names: ${named[1]}`)
    else {
      for (const [label, clause] of REFERENCE_CLAUSES) {
        if (!reference.includes(clause)) out.push(`the reference lost: ${label}`)
      }
      if (/flak/i.test(reference)) out.push('the reference carries a label word other than PASSED-ALONE and REAL')
      if (/devflow:/.test(reference)) out.push('the reference names a devflow: token')
      if (NAME_FILTER_ALLOWED.test(reference)) out.push('the reference allows a name filter')
    }
  }
  if (!skillMd.includes(SKILL_ROW)) out.push(`SKILL.md has no Files row for ${REFERENCE_REL}`)
  return out
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const BODY = resolveAgentSource('validate').content
const SKILL_MD = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'agent-references', 'SKILL.md'), 'utf-8')

/** The reference text for a path relative to `references/`, or null when the file is absent. */
function readReference(rel: string): string | null {
  try {
    return readAgentReference(rel)
  } catch {
    return null
  }
}

const REFERENCE = readReference(REFERENCE_REL) ?? ''

/** Replace `from` with `to` in a text, failing the test when the seed did not change it. */
function seed(text: string, from: string | RegExp, to: string): string {
  const next = typeof from === 'string' ? text.replace(from, () => to) : text.replace(from, to)
  expect(next, `the seed ${String(from)} must change the text`).not.toBe(text)
  return next
}

/** The collector over a changed body, with the real reference and SKILL.md row. */
const withBody = (body: string): string[] => collectPassedAloneDefects(body, readReference, SKILL_MD)

/** The collector over a changed reference, with the real body and SKILL.md row. */
const withReference = (reference: string | null): string[] => collectPassedAloneDefects(BODY, () => reference, SKILL_MD)

/** The stub: from the Read line to the end of its last sentence. */
function stubOf(body: string): string {
  const from = body.indexOf(READ_LEAD)
  const endMarker = 'Parsed References or `details`.'
  const to = body.indexOf(endMarker, from)
  expect(from, 'the stub starts in the body').toBeGreaterThan(-1)
  expect(to, 'the stub ends in the body').toBeGreaterThan(from)
  return body.slice(from, to + endMarker.length)
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('the Validate body re-runs each failed test file alone and labels it', () => {
  it('reads a real body and a real reference, and the collector reports no defect', () => {
    expect(Buffer.byteLength(BODY), 'the body is empty').toBeGreaterThan(4_000)
    expect(REFERENCE.length, 'the reference is empty').toBeGreaterThan(1_000)
    expect(BODY_CLAUSES.length).toBeGreaterThanOrEqual(18)
    expect(REFERENCE_CLAUSES.length).toBeGreaterThanOrEqual(28)
    expect(withBody(BODY)).toEqual([])
  })

  it('probes: each lost body clause is reported', () => {
    for (const [label, clause] of BODY_CLAUSES) {
      expect(withBody(seed(BODY, clause, '')), clause).toContain(`the body lost: ${label}`)
    }
  })

  it('probes: each lost reference clause is reported', () => {
    for (const [label, clause] of REFERENCE_CLAUSES) {
      expect(withReference(seed(REFERENCE, clause, '')), clause).toContain(`the reference lost: ${label}`)
    }
  })

  it('probes: a reworded no-test rule, an allowed name filter and a label word are reported', () => {
    const noTest = seed(REFERENCE, 'A log with only skipped tests or no test found is REAL.', 'A log with only skipped tests passes.')
    expect(withReference(noTest)).toContain('the reference lost: a log without a run test is REAL')

    expect(withReference(seed(REFERENCE, 'no name filter', 'a name filter is allowed'))).toContain('the reference allows a name filter')
    expect(withBody(seed(BODY, 'no name filter', 'a name filter is allowed'))).toContain('the body allows a name filter')

    expect(withBody(`${BODY}\nA second pass labels it flaky.\n`)).toContain('the body carries a label word other than PASSED-ALONE and REAL')
    expect(withReference(`${REFERENCE}\nA second pass labels it flaky.\n`)).toContain('the reference carries a label word other than PASSED-ALONE and REAL')
    expect(withReference(`${REFERENCE}\nSee devflow:git.\n`)).toContain('the reference names a devflow: token')
  })

  it('probes: a moved Output line, a lost bound and a lost Output line are reported', () => {
    const line = BODY.split('\n').find(l => l.startsWith(OUTPUT_LINE_START)) ?? ''
    expect(line, 'the Output line is found').not.toBe('')
    const lateLine = seed(seed(BODY, `${line}\n\n`, ''), '### Failures (if FAIL)\n', `### Failures (if FAIL)\n${line}\n\n`)
    expect(withBody(lateLine)).toContain('the `Passed alone:` line is not between the commands table and `### Failures`')

    expect(withBody(seed(BODY, `; ${OUTPUT_LINE_BOUND}`, ''))).toContain('the `Passed alone:` line lost: its bound of 20 files and 120 s')
    expect(withBody(seed(BODY, `${line}\n\n`, ''))).toContain('the Output block has no `Passed alone:` line')
  })

  it('probes: the stub inside the Running commands block is reported', () => {
    const stub = stubOf(BODY)
    const moved = seed(seed(BODY, ` ${stub}`, ''), '- The same rules hold', `${stub}\n- The same rules hold`)
    const defects = withBody(moved)
    expect(defects).toContain('the Running commands block names PASSED-ALONE or the Passed alone line')
    expect(defects).toContain('the body lost: the Read of the reference through the sanctioned directory line')
  })

  it('probes: a blank line between the trigger sentence and the Read line is reported, because the Read loses its trigger', () => {
    const split = seed(BODY, `Running commands. ${READ_LEAD}`, `Running commands.\n\n${READ_LEAD}`)
    expect(withBody(split)).toContain('the trigger, the Read line and the conditions are not in one paragraph, in that order')
  })

  it('probes: a Read that comes after the re-runs is reported, because a log path would reach a command unchecked', () => {
    const late = seed(BODY, `Running commands. ${READ_LEAD}`, 'Running commands. Then run ')
    expect(withBody(late)).toContain('the body lost: the Read of the reference through the sanctioned directory line')
  })

  it('probes: a Read that re-runs a path it does not reject is reported', () => {
    const open = seed(BODY, 're-run only a path it accepts', 're-run no path it rejects')
    const defects = withBody(open)
    expect(defects).toContain('the Read fails open: it re-runs every path it does not reject')
    expect(defects).toContain('the body lost: the Read is followed by re-running only an accepted path')
  })

  it('probes: a lost BASE_SHA condition, a missing reference file and a dropped SKILL.md row are reported', () => {
    expect(withBody(seed(BODY, 'a BASE_SHA; ', ''))).toContain('the body lost: a BASE_SHA condition')
    expect(withReference(null)).toContain(`the reference is missing at the path the body names: ${REFERENCE_REL}`)
    expect(collectPassedAloneDefects(BODY, readReference, seed(SKILL_MD, SKILL_ROW, ''))).toContain(`SKILL.md has no Files row for ${REFERENCE_REL}`)
  })

  it('probes: a body that reads another file or names no path is reported', () => {
    expect(withBody(seed(BODY, `references/${REFERENCE_REL}"`, 'references/validate/other.md"'))).toContain(`the body reads validate/other.md, expected ${REFERENCE_REL}`)
    expect(withBody(seed(BODY, NAMED_PATH, '"$d"'))).toContain('the body names no reference path')
  })

  it('probes: a body without its Validation Order section or Output section is reported', () => {
    expect(withBody(seed(BODY, '## Validation Order', '## Order'))).toEqual(['the body has no `## Validation Order` section before `## Running commands`'])
    expect(withBody(seed(BODY, '\n## Output\n', '\n## Report\n'))).toContain('the body has no `## Output` section before `## Core rules`')
  })
})
