/**
 * Three command steps use the shared input checks (#781).
 *
 *   folder arm   /code-review, /bug-analysis and /research make their run folder, and /plan its design folder,
 *                only with `plan-files.cjs claim`, never with `mkdir -p`. Only the script's success line sets the
 *                folder; any other result stops the step. A quote or a control character in the quoted path stops the
 *                step first. /plan runs `check` on the design path before the Write, and takes seconds in the stamp
 *                once when a file stands at that path.
 *   slug arm     the docs-framework skill and its patterns reference hold no shell form of the topic slug: no
 *                shell call takes a title. The skill, /plan and /research state the slug pattern
 *                `^[a-z0-9-]{1,50}$` and the `untitled` fallback.
 *   PR arm       /code-review, /bug-analysis and /resolve fetch the PR body only when `pr_number` is digits only.
 *   Git PR arm   the Git agent's PR operations (post-review-summary, post-resolution-summary, check-merge-readiness,
 *                update-pr-evidence) pass `PR_NUMBER` to `gh pr view` or a `--pr` flag only when it is digits only, and
 *                every such use in a build is gated.
 *
 * Each arm runs through a named collector, and the known-bad probes feed the same collector. The compiled files are
 * read, never the sources, because the compiled file is what a user installs. A missing build is an error.
 *
 * What a green run does NOT prove: it proves the files carry the text. It does not prove that a model follows it.
 * tests/evidence-policy/plan-files.test.ts proves what the script itself refuses.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, compiledBuilds, seedOnce, type Build } from '../helpers.js'

const SCRIPT = 'node "$HOME/.devflow/scripts/plan-files.cjs"'
const TOPIC_SLUG_PATTERN = '`^[a-z0-9-]{1,50}$`'

// ---------------------------------------------------------------------------
// 1. The folder arm
// ---------------------------------------------------------------------------

const WORKTREE_STOP = 'Stop on `\'` or a control character in `{worktree}`.'

interface FolderSite {
  readonly command: string
  /** The claim call, byte for byte. */
  readonly claim: string
  /** The sentence that lets only the script's success line set the folder. */
  readonly rule: string
  /** The stop on a quote or a control character in the path that the shell call quotes. */
  readonly stop: string
}

const FOLDER_SITES: readonly FolderSite[] = [
  {
    command: 'code-review',
    claim: `\`(cd '{worktree}' && ${SCRIPT} claim reviews '{branch-slug}'); echo "exit=$?"\``,
    rule: 'Only a `RUN_DIR=<path>` line with `exit=0` sets `REVIEW_DIR` to that path and `TIMESTAMP` to its last part; else stop with the script\'s reason.',
    stop: WORKTREE_STOP,
  },
  {
    command: 'bug-analysis',
    claim: `\`(cd '{worktree}' && ${SCRIPT} claim bug-analysis '{branch-slug}'); echo "exit=$?"\``,
    rule: 'Only a `RUN_DIR=<path>` line with `exit=0` sets `ANALYSIS_DIR` to that path and `{timestamp}` to its last part; else stop with the script\'s reason.',
    stop: WORKTREE_STOP,
  },
  {
    command: 'research',
    claim: `\`(cd '{worktree}' && ${SCRIPT} claim research '{topic-slug}'); echo "exit=$?"\``,
    rule: 'Only a `RUN_DIR=<path>` line with `exit=0` sets `{RESEARCH_DIR}` to that path, `{worktree}/.devflow/docs/research/{topic-slug}/<stamp>`; else stop with the script\'s reason.',
    stop: WORKTREE_STOP,
  },
  {
    command: 'plan',
    claim: `\`(cd '{worktree}' && ${SCRIPT} claim design && ${SCRIPT} check '{the artifact path}'); echo "exit=$?"\``,
    rule: 'Only an `OK=` line with `exit=0` lets the next step run; else stop, make no artifact, and report the script\'s reason.',
    stop: 'Stop on `\'` or a control character in the artifact path.',
  },
]

const PLAN_RETRY = 'When the check refuses because a file stands at the path, give the stamp seconds (`YYYY-MM-DD_HHMMSS`) and check once more.'
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
  const stopAt = text.indexOf(site.stop)
  if (stopAt === -1 || (claimAt !== -1 && stopAt > claimAt)) out.push(`${build.label}: no stop on a quote in the quoted path before the claim`)
  if (UNCHECKED_MKDIR_RE.test(text)) out.push(`${build.label}: a mkdir -p of a docs folder`)
  if (site.command === 'plan') {
    const writeAt = text.indexOf(PLAN_WRITE)
    if (writeAt === -1 || claimAt === -1 || claimAt > writeAt) out.push(`${build.label}: the design check is not before the write`)
    if (!text.includes(PLAN_RETRY)) out.push(`${build.label}: no seconds retry when a file stands at the design path`)
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
    expect(probe(seedOnce(build.text, WORKTREE_STOP, ''))).toEqual([`${build.label}: no stop on a quote in the quoted path before the claim`])
    expect(probe(`${build.text}\n${site.claim}`)).toEqual([`${build.label}: a second claim call`])
  })

  it('known-bad probe: a design check after the write is reported', () => {
    const site = FOLDER_SITES[3]
    const build = folderBuilds(site)[0]
    const moved = seedOnce(seedOnce(build.text, site.claim, 'CLAIM_GONE'), PLAN_WRITE, `${PLAN_WRITE} ${site.claim}`)
    expect(collectFolderDefects(site, { ...build, text: moved })).toEqual([`${build.label}: the design check is not before the write`])
    expect(collectFolderDefects(site, { ...build, text: seedOnce(build.text, PLAN_RETRY, '') }))
      .toEqual([`${build.label}: no seconds retry when a file stands at the design path`])
    expect(collectFolderDefects(site, { ...build, text: seedOnce(build.text, site.stop, 'Stop on `\'` in `{worktree}`.') }))
      .toEqual([`${build.label}: no stop on a quote in the quoted path before the claim`])
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

// ---------------------------------------------------------------------------
// 4. The Git-agent PR arm
// ---------------------------------------------------------------------------

/** Every build tree that can hold a compiled PR operation of the Git skill. */
const PR_OP_TREES = ['', 'compliance-off', 'curation-off', 'curation-compliance-off']

/** Every compiled build of one PR operation; a missing on-build is an error, never a skip. */
function prOpBuilds(op: string): Build[] {
  const builds = PR_OP_TREES.flatMap(tree => {
    const file = path.join(ROOT, 'dist', tree, 'skills', 'git', 'references', 'pr', `${op}.md`)
    return existsSync(file) ? [{ key: (tree || 'on') as Build['key'], label: `${op} (${tree || 'on'})`, text: readFileSync(file, 'utf-8') }] : []
  })
  if (!builds.some(b => b.label.endsWith('(on)'))) throw new Error(`dist/skills/git/references/pr/${op}.md is absent: run \`npm run build:mds\``)
  return builds
}

const COMMENTS_GATE = 'Only when `PR_NUMBER` is digits only (else post nothing and report `TRACEABILITY: DEGRADED (PR number not digits)`): `gh pr view {PR_NUMBER} --json comments'
const READINESS_GATE = 'Run the script only when `PR_NUMBER` is digits only (any other value is `TRACEABILITY: DEGRADED (readiness unavailable)`), from `WORKTREE_PATH` (else cwd), and print its stdout, nothing else: `node "$HOME/.devflow/scripts/verify-evidence.cjs" readiness --pr {PR_NUMBER}'
/** check-merge-readiness runs only its script: its steps, the review-decision fetch included, are the script's specification. */
const SPEC_ONLY = 'The script makes the reads and applies the ladder below, so the steps are its specification: run none of them yourself.'
const EVIDENCE_GATE = '4. Read the test-plan evidence at the current head, for a `PR_NUMBER` of digits only, from `WORKTREE_PATH` (else cwd): `node "$HOME/.devflow/scripts/verify-evidence.cjs" verify --pr {PR_NUMBER}'
const PUBLISH_GATE = 'only a `PR_NUMBER` of digits only and a value matching `^[A-Za-z0-9._/-]{1,255}$` reach the shell; any other is a failed run.'

/** The PR-number shell sites of the Git agent: each operation, and the gated text that each of its sites must carry. */
const GIT_PR_SITES: readonly { op: string; gates: readonly string[] }[] = [
  { op: 'post-review-summary', gates: [COMMENTS_GATE] },
  { op: 'post-resolution-summary', gates: [COMMENTS_GATE] },
  { op: 'check-merge-readiness', gates: [READINESS_GATE, SPEC_ONLY, EVIDENCE_GATE] },
  { op: 'update-pr-evidence', gates: [PUBLISH_GATE] },
]

/** A PR-number placeholder that reaches a `gh pr view` or a `--pr` flag. */
const PR_NUMBER_USE_RE = /gh pr view \{PR_NUMBER\}|--pr \{PR_NUMBER\}/g

/** Named collector: a Git-agent PR operation whose PR number reaches a command with no digits-only gate. */
export function collectGitPrDefects(gates: readonly string[], build: Build): string[] {
  const out: string[] = []
  for (const gate of gates) {
    if (!build.text.includes(gate)) out.push(`${build.label}: no digits-only gate "${gate.slice(0, 40)}"`)
  }
  const uses = [...build.text.matchAll(PR_NUMBER_USE_RE)].length
  if (uses !== gates.length) out.push(`${build.label}: ${uses} PR-number uses, ${gates.length} gated`)
  return out
}

describe('the Git agent passes a PR number to a command only when it is digits only (#781)', () => {
  for (const { op, gates } of GIT_PR_SITES) {
    it(`${op}: every build gates each PR-number use`, () => {
      expect(prOpBuilds(op).flatMap(b => collectGitPrDefects(gates, b))).toEqual([])
    })
  }

  it('known-bad probes: a lost gate and an ungated second use are each reported', () => {
    for (const { op, gates } of GIT_PR_SITES) {
      const build = prOpBuilds(op)[0]
      for (const gate of gates) {
        const head = gate.slice(0, gate.indexOf('`gh pr view') === -1 ? gate.indexOf('`node') : gate.indexOf('`gh pr view'))
        expect(collectGitPrDefects(gates, { ...build, text: seedOnce(build.text, head, '') }), gate)
          .toEqual([`${build.label}: no digits-only gate "${gate.slice(0, 40)}"`])
      }
      expect(collectGitPrDefects(gates, { ...build, text: `${build.text}\nRun \`gh pr view {PR_NUMBER} --json body\`.` }))
        .toEqual([`${build.label}: ${gates.length + 1} PR-number uses, ${gates.length} gated`])
    }
  })
})
