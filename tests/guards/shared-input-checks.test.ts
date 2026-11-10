/**
 * Three command steps use the shared input checks (#781).
 *
 *   folder arm   /code-review, /bug-analysis and /research make their run folder, and /plan its design folder,
 *                only with `plan-files.cjs claim`, never with `mkdir -p`. Only the script's success line sets the
 *                folder; any other result stops the step. /plan runs `check` on the design path before the Write.
 *   slug arm     the docs-framework skill and its patterns reference hold no shell form of the topic slug: no
 *                shell call takes a title. The skill, /plan and /research state the slug pattern
 *                `^[a-z0-9-]{1,50}$` and the `untitled` fallback.
 *   PR arm       /code-review, /bug-analysis and /resolve fetch the PR body only when `pr_number` is digits only.
 *
 * Each arm runs through a named collector, and the known-bad probes feed the same collector. The compiled files are
 * read, never the sources, because the compiled file is what a user installs. A missing build is an error.
 *
 * What a green run does NOT prove: it proves the files carry the text. It does not prove that a model follows it.
 * tests/evidence-policy/plan-files.test.ts proves what the script itself refuses.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, compiledBuilds, seedOnce, type Build } from '../helpers.js'

const SCRIPT = 'node "$HOME/.devflow/scripts/plan-files.cjs"'
const TOPIC_SLUG_PATTERN = '`^[a-z0-9-]{1,50}$`'

// ---------------------------------------------------------------------------
// 1. The folder arm
// ---------------------------------------------------------------------------

interface FolderSite {
  readonly command: string
  /** The claim call, byte for byte. */
  readonly claim: string
  /** The sentence that lets only the script's success line set the folder. */
  readonly rule: string
}

const FOLDER_SITES: readonly FolderSite[] = [
  {
    command: 'code-review',
    claim: `\`(cd '{worktree}' && ${SCRIPT} claim reviews '{branch-slug}'); echo "exit=$?"\``,
    rule: 'Only a `RUN_DIR=<path>` line with `exit=0` sets `REVIEW_DIR` to that path and `TIMESTAMP` to its last part; else stop with the script\'s reason.',
  },
  {
    command: 'bug-analysis',
    claim: `\`(cd '{worktree}' && ${SCRIPT} claim bug-analysis '{branch-slug}'); echo "exit=$?"\``,
    rule: 'Only a `RUN_DIR=<path>` line with `exit=0` sets `ANALYSIS_DIR` to that path; else stop with the script\'s reason.',
  },
  {
    command: 'research',
    claim: `\`(cd '{worktree}' && ${SCRIPT} claim research '{topic-slug}'); echo "exit=$?"\``,
    rule: 'Only a `RUN_DIR=<path>` line with `exit=0` sets `{RESEARCH_DIR}` to that path, `{worktree}/.devflow/docs/research/{topic-slug}/<stamp>`; else stop with the script\'s reason.',
  },
  {
    command: 'plan',
    claim: `\`${SCRIPT} claim design && ${SCRIPT} check '{the artifact path}'; echo "exit=$?"\``,
    rule: 'Only an `OK=` line with `exit=0` lets the next step run; else stop, make no artifact, and report the script\'s reason.',
  },
]

const WORKTREE_STOP = 'Stop on `\'` or a control character in `{worktree}`.'
const UNCHECKED_MKDIR_RE = /mkdir -p[^`\n]*\.devflow\/docs/
const PLAN_WRITE = '**Write the artifact now**'

/** Named collector: the ways a build makes a docs folder without the shared check. */
export function collectFolderDefects(site: FolderSite, build: Build): string[] {
  const out: string[] = []
  const text = build.text
  const claimAt = text.indexOf(site.claim)
  if (claimAt === -1) out.push(`${build.label}: no claim call`)
  else if (text.indexOf(site.claim, claimAt + 1) !== -1) out.push(`${build.label}: a second claim call`)
  if (!text.includes(site.rule)) out.push(`${build.label}: no rule that only the success line sets the folder`)
  const stopAt = text.indexOf(WORKTREE_STOP)
  if (stopAt === -1 || (claimAt !== -1 && stopAt > claimAt)) out.push(`${build.label}: no stop on a quote in the worktree before the claim`)
  if (UNCHECKED_MKDIR_RE.test(text)) out.push(`${build.label}: a mkdir -p of a docs folder`)
  if (site.command === 'plan') {
    const writeAt = text.indexOf(PLAN_WRITE)
    if (writeAt === -1 || claimAt === -1 || claimAt > writeAt) out.push(`${build.label}: the design check is not before the write`)
  }
  return out
}

const folderBuilds = (site: FolderSite): Build[] => compiledBuilds('commands', site.command)

describe('the run and design folders are made only by the shared claim (#781)', () => {
  for (const site of FOLDER_SITES) {
    it(`${site.command}: every build claims its folder and makes no docs folder with mkdir -p`, () => {
      const builds = folderBuilds(site)
      expect(builds.length).toBeGreaterThan(0)
      expect(builds.flatMap(b => collectFolderDefects(site, b))).toEqual([])
    })
  }

  it('known-bad probes: each lost clause is reported by its name', () => {
    const site = FOLDER_SITES[0]
    const build = folderBuilds(site)[0]
    const probe = (text: string): string[] => collectFolderDefects(site, { ...build, text })
    expect(probe(seedOnce(build.text, site.claim, '`mkdir -p {worktree}/.devflow/docs/reviews/x/`')))
      .toEqual([`${build.label}: no claim call`, `${build.label}: a mkdir -p of a docs folder`])
    expect(probe(seedOnce(build.text, site.rule, 'Set `REVIEW_DIR`.'))).toEqual([`${build.label}: no rule that only the success line sets the folder`])
    expect(probe(seedOnce(build.text, WORKTREE_STOP, ''))).toEqual([`${build.label}: no stop on a quote in the worktree before the claim`])
    expect(probe(`${build.text}\n${site.claim}`)).toEqual([`${build.label}: a second claim call`])
  })

  it('known-bad probe: a design check after the write is reported', () => {
    const site = FOLDER_SITES[3]
    const build = folderBuilds(site)[0]
    const moved = seedOnce(seedOnce(build.text, site.claim, 'CLAIM_GONE'), PLAN_WRITE, `${PLAN_WRITE} ${site.claim}`)
    expect(collectFolderDefects(site, { ...build, text: moved })).toEqual([`${build.label}: the design check is not before the write`])
  })
})

// ---------------------------------------------------------------------------
// 2. The slug arm
// ---------------------------------------------------------------------------

const SKILL_DIR = path.join(ROOT, 'src', 'assets', 'skills', 'docs-framework')
const SKILL_FILES = [
  { label: 'docs-framework SKILL.md', text: readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8') },
  { label: 'docs-framework patterns.md', text: readFileSync(path.join(SKILL_DIR, 'references', 'patterns.md'), 'utf-8') },
]

/** A shell form of the topic-slug rule: the helper, the inline variable, or the lower-casing pipe. */
const SHELL_SLUG_RE = /get_topic_slug|TOPIC_SLUG=|\$TOPIC\b|tr '\[:upper:\]' '\[:lower:\]'/

const SLUG_RULE = `A command makes the slug in prose; no shell call takes the topic. It uses the slug only when it matches ${TOPIC_SLUG_PATTERN}, else \`untitled\`.`

/** Named collector: a docs-framework file that holds a shell form of the topic slug, or (the skill) lacks the prose rule. */
export function collectSkillSlugDefects(files: readonly { label: string; text: string }[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (SHELL_SLUG_RE.test(f.text)) out.push(`${f.label}: a shell form of the topic slug`)
  }
  if (!files[0].text.includes(SLUG_RULE)) out.push(`${files[0].label}: no prose slug rule with its pattern`)
  return out
}

const COMMAND_SLUG_RULES: readonly { command: string; rule: string }[] = [
  { command: 'plan', rule: `made in prose; no shell call takes the title. Use the slug only when it matches ${TOPIC_SLUG_PATTERN}, else use \`untitled\`.` },
  { command: 'research', rule: `made in prose; no shell call takes the question. Use the slug only when it matches ${TOPIC_SLUG_PATTERN}, else use \`untitled\`.` },
]

/** Named collector: a /plan or /research build without the prose slug rule. */
export function collectCommandSlugDefects(rule: string, build: Build): string[] {
  return build.text.includes(rule) ? [] : [`${build.label}: no prose slug rule with its pattern`]
}

describe('no shell call takes a title to make the topic slug (#781)', () => {
  it('the skill and its patterns reference hold no shell form, and the skill states the prose rule', () => {
    expect(collectSkillSlugDefects(SKILL_FILES)).toEqual([])
  })

  for (const { command, rule } of COMMAND_SLUG_RULES) {
    it(`${command}: every build makes the slug in prose and checks its pattern`, () => {
      const builds = compiledBuilds('commands', command)
      expect(builds.length).toBeGreaterThan(0)
      expect(builds.flatMap(b => collectCommandSlugDefects(rule, b))).toEqual([])
    })
  }

  it('known-bad probes: a restored helper, a restored inline line and a lost rule are each reported', () => {
    const [skill, patterns] = SKILL_FILES
    const helper = { ...patterns, text: `${patterns.text}\nget_topic_slug "Some Title"\n` }
    expect(collectSkillSlugDefects([skill, helper])).toEqual([`${patterns.label}: a shell form of the topic slug`])
    const inline = { ...skill, text: seedOnce(skill.text, SLUG_RULE, 'TOPIC_SLUG=$(echo "$TOPIC")') }
    expect(collectSkillSlugDefects([inline, patterns])).toEqual([
      `${skill.label}: a shell form of the topic slug`,
      `${skill.label}: no prose slug rule with its pattern`,
    ])
    const build = compiledBuilds('commands', 'research')[0]
    const rule = COMMAND_SLUG_RULES[1].rule
    expect(collectCommandSlugDefects(rule, { ...build, text: seedOnce(build.text, rule, 'made by the skill.') }))
      .toEqual([`${build.label}: no prose slug rule with its pattern`])
  })
})

// ---------------------------------------------------------------------------
// 3. The PR arm
// ---------------------------------------------------------------------------

const PR_FETCH = 'gh pr view {pr_number} --json body'

const PR_SITES: readonly { command: string; gate: string }[] = [
  { command: 'code-review', gate: 'Then, only when `pr_number` is digits only, fetch the PR body:' },
  { command: 'bug-analysis', gate: '**Fetch PR body** (after extracting `pr_number`), only when `pr_number` is digits only:' },
  { command: 'resolve', gate: '**Fetch PR body** (after extracting `pr_number`), only when `pr_number` is digits only:' },
]

/** Named collector: a PR-body fetch with no digits-only gate on the line before its block. */
export function collectPrFetchDefects(gate: string, build: Build): string[] {
  const fetchAt = build.text.indexOf(PR_FETCH)
  if (fetchAt === -1) return [`${build.label}: no PR-body fetch`]
  if (build.text.indexOf(PR_FETCH, fetchAt + 1) !== -1) return [`${build.label}: a second PR-body fetch`]
  const gateAt = build.text.indexOf(gate)
  const between = gateAt === -1 ? '' : build.text.slice(gateAt + gate.length, fetchAt)
  return gateAt !== -1 && gateAt < fetchAt && between.split('\n').length <= 4 ? [] : [`${build.label}: the PR-body fetch has no digits-only gate`]
}

describe('the PR body is fetched only for a PR number of digits (#781)', () => {
  for (const { command, gate } of PR_SITES) {
    it(`${command}: every build gates the fetch`, () => {
      const builds = compiledBuilds('commands', command)
      expect(builds.length).toBeGreaterThan(0)
      expect(builds.flatMap(b => collectPrFetchDefects(gate, b))).toEqual([])
    })
  }

  it('known-bad probes: a lost gate and a second fetch are each reported', () => {
    for (const { command, gate } of PR_SITES) {
      const build = compiledBuilds('commands', command)[0]
      expect(collectPrFetchDefects(gate, { ...build, text: seedOnce(build.text, gate, '**Fetch PR body**:') }))
        .toEqual([`${build.label}: the PR-body fetch has no digits-only gate`])
      expect(collectPrFetchDefects(gate, { ...build, text: `${build.text}\n${PR_FETCH}` }))
        .toEqual([`${build.label}: a second PR-body fetch`])
    }
  })
})
