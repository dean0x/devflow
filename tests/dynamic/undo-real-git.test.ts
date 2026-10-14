/**
 * tests/dynamic/undo-real-git.test.ts
 *
 * #486, finding 1 — the wave's merge and the undo of a red merge, run against real git.
 *
 * The merge and the undo are lines the Git agent runs. A stub agent cannot show
 * what those lines do to a branch, so this test builds a repository, runs the
 * merge, baseSha and undo commands read from the built dynamic-build.md, and
 * reads the branch back. The commands are parsed from the build, never retyped
 * here, so a change to a shipped line changes what this test runs.
 *
 * The defect: a fast-forward merge has no merge commit of its own, so the
 * merge SHA is the ticket's last commit and `mergeSha^1` is the ticket's
 * earlier commit. Resetting there leaves part of a failed ticket on the
 * integration branch. The shipped merge now forces a merge commit and records
 * the integration head first, and the undo resets to that recorded head only
 * after three read-only checks agree.
 *
 * Every spawn passes cwd and the sandboxed environment (D-TEST-HOME-ISOLATION).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { requireDistFile, sandboxEnv } from '../helpers.js'

const BUILT = requireDistFile('dynamic-build.md')
const INTEGRATION = 'wave/undo-real-git'
const TICKET_BRANCH = 'feat/undo-real-git-work'
const GIT_BUDGET_MS = 20_000
const FORTY_HEX = /^[0-9a-f]{40}$/

/** The values the compiled prompts name as placeholders. */
interface Values {
  readonly integration: string
  readonly branch: string
  readonly mergeSha: string
  readonly baseSha: string
}

/** A command template from a prompt, a pattern to fill in. */
type Template = string

/** The Git spawn prompt that opens with `lead`: from the lead to its spawn options. */
function gitPromptStartingWith(text: string, lead: string): string {
  const at = text.indexOf(lead)
  const end = at === -1 ? -1 : text.indexOf('{ agentType: "Git" }', at)
  if (at === -1 || end === -1) throw new Error(`no Git spawn opens with ${lead}`)
  return text.slice(at, end)
}

/** The first group of `pattern` in `prompt`, or a thrown error naming what is missing. */
function required(prompt: string, pattern: RegExp, what: string): string {
  const hit = pattern.exec(prompt)
  if (hit === null) throw new Error(`the prompt carries no ${what}`)
  return hit[1]
}

/** Fill the prompt's placeholders; a placeholder left over is a thrown error. */
function fill(template: Template, v: Values): string {
  const filled = template
    .split('${INTEGRATION_BRANCH}').join(v.integration)
    .split('${engineResult.branch}').join(v.branch)
    .split('${merge.mergeSha}').join(v.mergeSha)
    .split('${merge.baseSha}').join(v.baseSha)
  if (filled.includes('${')) throw new Error(`a placeholder is left in: ${filled}`)
  return filled
}

/** Fill a git command template and split it into the arguments after `git`. */
function argsOf(template: Template, v: Values): string[] {
  const words = fill(template, v).split(' ')
  if (words[0] !== 'git') throw new Error(`not a git command: ${template}`)
  return words.slice(1)
}

/** The shipped merge prompt's two commands: the one that records baseSha and the merge itself. */
function shippedMerge(text: string): { readonly recordBase: Template; readonly merge: Template } {
  const prompt = gitPromptStartingWith(text, 'agent(`Merge ${engineResult.branch}')
  return {
    recordBase: required(prompt, /run (git rev-parse \$\{INTEGRATION_BRANCH\}) as baseSha/, 'baseSha command'),
    merge: required(prompt, /(git merge --no-ff \$\{engineResult\.branch\})/, 'git merge --no-ff line'),
  }
}

/** The shipped undo prompt's read-only checks, in order, each with the value it must print, and its one reset. */
function shippedUndo(text: string): { readonly checks: ReadonlyArray<{ readonly command: Template; readonly expected: Template }>; readonly reset: Template } {
  const prompt = gitPromptStartingWith(text, 'agent(`Undo the merge ${merge.mergeSha}')
  const checks = [...prompt.matchAll(/(git [^;]*?) must print (\$\{[A-Za-z_.]+\})/g)].map(m => ({ command: m[1], expected: m[2] }))
  return { checks, reset: required(prompt, /(git reset --keep \$\{merge\.\w+\}(?:\^1)?)/, 'git reset --keep line') }
}

let tmp: string
let home: string

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-undo-real-git-')))
  home = path.join(tmp, 'home')
  fs.mkdirSync(home, { recursive: true })
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** Run real git in `repo` under the sandboxed environment; returns the exit status and trimmed stdout. */
function run(repo: string, args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const r = spawnSync('git', [...args], {
    cwd: repo,
    env: sandboxEnv(home, { GIT_CONFIG_NOSYSTEM: '1', GIT_MERGE_AUTOEDIT: 'no' }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_BUDGET_MS,
  })
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr }
}

/** Run real git in `repo`; a non-zero exit is a fixture failure, so it throws. */
function git(repo: string, args: readonly string[]): string {
  const r = run(repo, args)
  if (r.status !== 0) throw new Error(`fixture: git ${args.join(' ')} failed (${r.status}): ${r.stderr}`)
  return r.stdout
}

/** Write each file, commit them together and return the commit SHA. */
function commit(repo: string, files: readonly string[], subject: string): string {
  for (const file of files) fs.writeFileSync(path.join(repo, file), `${subject}\n`)
  git(repo, ['add', ...files])
  git(repo, ['commit', '-q', '-m', subject])
  return git(repo, ['rev-parse', 'HEAD'])
}

interface Ticket {
  readonly repo: string
  /** A: the integration head before the merge. */
  readonly baseSha: string
  /** B1 and B2: the ticket's two commits, B2 the branch head. B2 edits shared.txt, a file A holds. */
  readonly ticketShas: readonly [string, string]
}

/** A repository with A on the integration branch, and the ticket's B1 and B2 on top of A on the ticket branch. */
function newTicketRepo(): Ticket {
  const repo = fs.mkdtempSync(path.join(tmp, 'repo-'))
  git(repo, ['init', '-q', '-b', INTEGRATION])
  git(repo, ['config', 'user.name', 'Wave Test'])
  git(repo, ['config', 'user.email', 'wave-test@example.invalid'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  const baseSha = commit(repo, ['a.txt', 'shared.txt'], 'A: the integration base')
  git(repo, ['checkout', '-q', '-b', TICKET_BRANCH])
  const b1 = commit(repo, ['b1.txt'], 'B1: the ticket first commit')
  const b2 = commit(repo, ['b2.txt', 'shared.txt'], 'B2: the ticket second commit')
  git(repo, ['checkout', '-q', INTEGRATION])
  return { repo, baseSha, ticketShas: [b1, b2] }
}

/** The pre-merge head as the shipped merge prompt records it. */
function recordBase(ticket: Ticket): string {
  const base = git(ticket.repo, argsOf(shippedMerge(BUILT).recordBase, { integration: INTEGRATION, branch: TICKET_BRANCH, mergeSha: '', baseSha: '' }))
  expect(base, 'the recorded baseSha is a SHA as git prints it').toMatch(FORTY_HEX)
  expect(base, 'the shipped command records the integration head').toBe(ticket.baseSha)
  return base
}

/** Run the shipped merge command, and return the merge SHA the integration branch ends on. */
function mergeAsShipped(ticket: Ticket): string {
  git(ticket.repo, argsOf(shippedMerge(BUILT).merge, { integration: INTEGRATION, branch: TICKET_BRANCH, mergeSha: '', baseSha: '' }))
  return git(ticket.repo, ['rev-parse', 'HEAD'])
}

interface UndoResult {
  readonly undone: boolean
  readonly head?: string
  readonly reason?: string
}

/**
 * Apply the shipped undo as the Git agent runs it: each read-only check in order, where a
 * non-zero exit or another value means not undone, then the one reset. Returns what the
 * agent would report.
 */
function applyShippedUndo(ticket: Ticket, v: Values): UndoResult {
  const undo = shippedUndo(BUILT)
  expect(undo.checks.length, 'the undo names three read-only checks').toBe(3)
  for (const check of undo.checks) {
    const r = run(ticket.repo, argsOf(check.command, v))
    if (r.status !== 0) return { undone: false, reason: `${check.command} exited ${r.status}` }
    if (r.stdout !== fill(check.expected, v)) return { undone: false, reason: `${check.command} printed another value` }
  }
  const reset = run(ticket.repo, argsOf(undo.reset, v))
  if (reset.status !== 0) return { undone: false, reason: `${undo.reset} exited ${reset.status}: ${reset.stderr.trim()}` }
  return { undone: true, head: git(ticket.repo, ['rev-parse', `refs/heads/${INTEGRATION}`]) }
}

/** Whether `commitSha` is reachable from the current HEAD. */
function reachableFromHead(repo: string, commitSha: string): boolean {
  const r = run(repo, ['merge-base', '--is-ancestor', commitSha, 'HEAD'])
  if (r.status !== 0 && r.status !== 1) throw new Error(`fixture: merge-base failed (${r.status}): ${r.stderr}`)
  return r.status === 0
}

/** The values the undo prompt fills in, after the shipped merge ran. */
function valuesOf(ticket: Ticket, mergeSha: string): Values {
  return { integration: INTEGRATION, branch: TICKET_BRANCH, mergeSha, baseSha: ticket.baseSha }
}

describe('dynamic-build: the merge and the undo of a red merge restore the pre-merge head in real git (#486, finding 1)', () => {
  it('a two-commit ticket that could fast-forward is merged with a merge commit and undone to the recorded pre-merge head, with both ticket commits unreachable', () => {
    const ticket = newTicketRepo()
    recordBase(ticket)
    const mergeSha = mergeAsShipped(ticket)
    expect(mergeSha, 'the merge added a commit').not.toBe(ticket.baseSha)
    expect(git(ticket.repo, ['rev-parse', `${mergeSha}^1`]), 'a merge commit has the recorded pre-merge head as its first parent').toBe(ticket.baseSha)

    const result = applyShippedUndo(ticket, valuesOf(ticket, mergeSha))

    expect(result).toEqual({ undone: true, head: ticket.baseSha })
    expect(git(ticket.repo, ['rev-parse', 'HEAD']), 'HEAD returns to the integration head before the merge').toBe(ticket.baseSha)
    for (const sha of ticket.ticketShas) expect(reachableFromHead(ticket.repo, sha), `ticket commit ${sha.slice(0, 7)} is still on the integration branch`).toBe(false)
    expect(git(ticket.repo, ['status', '--porcelain'])).toBe('')
  })

  it('a true fast-forward is refused, not half undone: the first-parent check stops it and the branch keeps the merge head', () => {
    const ticket = newTicketRepo()
    recordBase(ticket)
    git(ticket.repo, ['merge', '--ff-only', TICKET_BRANCH])
    const mergeSha = git(ticket.repo, ['rev-parse', 'HEAD'])
    expect(mergeSha, 'a fast-forward ends on the ticket head').toBe(ticket.ticketShas[1])
    expect(git(ticket.repo, ['rev-parse', `${mergeSha}^1`]), 'the caret target is the ticket\'s own earlier commit, the shape of finding 1').toBe(ticket.ticketShas[0])

    const result = applyShippedUndo(ticket, valuesOf(ticket, mergeSha))

    expect(result.undone).toBe(false)
    expect(result.reason).toContain('printed another value')
    expect(git(ticket.repo, ['rev-parse', 'HEAD']), 'HEAD stays on the merge head and never stops on the ticket\'s earlier commit').toBe(mergeSha)
    expect(git(ticket.repo, ['status', '--porcelain'])).toBe('')
  })

  it('a detached HEAD is refused by the first check and nothing moves', () => {
    const ticket = newTicketRepo()
    recordBase(ticket)
    const mergeSha = mergeAsShipped(ticket)
    git(ticket.repo, ['checkout', '-q', '--detach'])

    const result = applyShippedUndo(ticket, valuesOf(ticket, mergeSha))

    expect(result.undone).toBe(false)
    expect(result.reason).toContain('git symbolic-ref --short HEAD exited')
    expect(git(ticket.repo, ['rev-parse', 'HEAD'])).toBe(mergeSha)
    expect(git(ticket.repo, ['rev-parse', `refs/heads/${INTEGRATION}`])).toBe(mergeSha)
  })

  it('a dirty file the ticket did not touch survives the undo', () => {
    const ticket = newTicketRepo()
    recordBase(ticket)
    const mergeSha = mergeAsShipped(ticket)
    fs.writeFileSync(path.join(ticket.repo, 'a.txt'), 'a local edit the ticket never touched\n')

    const result = applyShippedUndo(ticket, valuesOf(ticket, mergeSha))

    expect(result).toEqual({ undone: true, head: ticket.baseSha })
    expect(git(ticket.repo, ['rev-parse', 'HEAD'])).toBe(ticket.baseSha)
    expect(fs.readFileSync(path.join(ticket.repo, 'a.txt'), 'utf8')).toBe('a local edit the ticket never touched\n')
    expect(git(ticket.repo, ['status', '--porcelain'])).toBe('M a.txt')
  })

  it('a local change to a file the ticket edited makes git refuse the reset: reported not undone, with HEAD and the change kept', () => {
    const ticket = newTicketRepo()
    recordBase(ticket)
    const mergeSha = mergeAsShipped(ticket)
    fs.writeFileSync(path.join(ticket.repo, 'shared.txt'), 'a local edit that conflicts with the undo\n')

    const result = applyShippedUndo(ticket, valuesOf(ticket, mergeSha))

    expect(result.undone).toBe(false)
    expect(result.reason).toContain('git reset --keep')
    expect(git(ticket.repo, ['rev-parse', 'HEAD']), 'HEAD stays on the merge').toBe(mergeSha)
    expect(fs.readFileSync(path.join(ticket.repo, 'shared.txt'), 'utf8')).toBe('a local edit that conflicts with the undo\n')
  })
})
