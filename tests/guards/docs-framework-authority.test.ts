/**
 * D-DOCS-NAMES-AUTHORITY — `devflow:docs-framework` is the one authority for the names under
 * `.devflow/docs/`, so every command that writes or looks up such a path must agree with it.
 *
 * The skill had drifted from what the commands write: it knew nothing of the `handoff-*` and
 * `evidence-*` files or the multi-issue and no-issue design documents. This guard holds the two
 * sides together:
 *
 *  - every path family a compiled command names under `.devflow/docs/` appears in the skill;
 *  - the skill's two topic-slug derivations (its helper and its inline line) give one answer;
 *  - every site that derives `branch_slug` derives it the same way, and every site that names a
 *    `handoff-*` or `evidence-*` file spells it the way the skill does.
 *
 * Each arm runs through a named collector, and the known-bad probes feed the same collectors.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import { ROOT, requireDistFile, requireDistFiles } from '../helpers.js'

const SKILL = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'docs-framework', 'SKILL.md'), 'utf-8')
const PR_EVIDENCE_OP = readFileSync(
  path.join(ROOT, 'dist', 'skills', 'git', 'references', 'pr', 'update-pr-evidence.md'), 'utf-8')
const SCRIPT_DIR = path.join(ROOT, 'src', 'assets', 'scripts')

/** Every family the compiled commands name directly under `.devflow/docs/`. */
const EXPECTED_FAMILIES = [
  'bug-analysis', 'design', 'evidence-', 'handoff-', 'research', 'reviews',
] as const

interface NamedText {
  readonly name: string
  readonly text: string
}

function compiledCommands(): NamedText[] {
  return requireDistFiles().map(name => ({ name, text: requireDistFile(name) }))
}

/** Named collector: the first path segment of every `.devflow/docs/<segment>` a command names. */
export function collectDocFamilies(commands: readonly NamedText[]): Map<string, string[]> {
  const families = new Map<string, string[]>()
  for (const { name, text } of commands) {
    for (const m of text.matchAll(/\.devflow\/docs\/([^\s"'`)]+)/g)) {
      const family = m[1].split(/[/{$<]/)[0]
      if (!/^[a-z]/.test(family)) continue
      families.set(family, [...(families.get(family) ?? []), name])
    }
  }
  return families
}

/** Named collector: the families the skill does not mention. */
export function collectUnknownFamilies(families: Iterable<string>, skill: string): string[] {
  return [...families].filter(f => !skill.includes(f)).sort()
}

describe('the skill names every path family the commands write', () => {
  it('the compiled commands name exactly the families the skill is held to', () => {
    const found = [...collectDocFamilies(compiledCommands()).keys()].sort()
    expect(found).toEqual([...EXPECTED_FAMILIES].sort())
  })

  it('every family appears in the skill', () => {
    expect(collectUnknownFamilies(collectDocFamilies(compiledCommands()).keys(), SKILL)).toEqual([])
  })

  it('the skill tree carries the design folder, the handoff and evidence files and the files in the run folders', () => {
    for (const piece of [
      'design/\n', 'handoff-{branch-slug}.md', 'evidence-{branch-slug}.md',
      'resolution-summary.md', 'evidence.md', 'stale-plan.md',
      'plan/{timestamp}/', '{agent}-{k}.md', '{pr-description,prior-resolutions}.txt', 'plan-files.cjs claim',
    ]) {
      expect(SKILL, `the skill does not carry ${JSON.stringify(piece)}`).toContain(piece)
    }
  })

  it('known-bad probe: a skill without the reviews directory is reported', () => {
    const probe = SKILL.replaceAll('reviews', 'rvws')
    expect(collectUnknownFamilies(collectDocFamilies(compiledCommands()).keys(), probe)).toEqual(['reviews'])
  })
})

describe('/plan writes the three design-document names the skill lists', () => {
  /** The three `- If … issue:` path lines of Phase 14, as skill-relative templates. */
  function planDesignNames(plan: string): string[] {
    return plan.split('\n')
      .filter(l => /^- If (?:one issue|multi-issue|no issue):/.test(l))
      .map(l => /`\{worktree\}\/\.devflow\/docs\/design\/([^`]+)`/.exec(l)?.[1] ?? '')
      .map(n => n.replace('{YYYY-MM-DD_HHMM}', '{timestamp}'))
  }

  it('each of them is in the skill, and there are three', () => {
    const names = planDesignNames(requireDistFile('plan.md'))
    expect(names).toHaveLength(3)
    // The last row of the design folder is drawn with └──, the others with ├──.
    for (const n of names) expect(SKILL, n).toContain(`── ${n}`)
  })

  it('known-bad probe: a skill with only the single-issue variant is reported', () => {
    const probe = SKILL.replace('├── multi-{topic-slug}.{timestamp}.md', '├── gone')
    const missing = planDesignNames(requireDistFile('plan.md')).filter(n => !probe.includes(`── ${n}`))
    expect(missing).toEqual(['multi-{topic-slug}.{timestamp}.md'])
  })
})

// ---------------------------------------------------------------------------
// The skill's topic slug: one rule, two spellings
// ---------------------------------------------------------------------------

/** The skill's own topic-slug helper, run in bash on one topic. */
function skillTopicSlug(topic: string): string {
  const helper = /^get_topic_slug\(\) \{.*\}$/m.exec(SKILL)?.[0]
  if (helper === undefined) throw new Error('get_topic_slug not found in the skill')
  return execFileSync('bash', ['-c', `${helper}\nget_topic_slug "$1"`, 'bash', topic], {
    encoding: 'utf-8', env: { ...process.env, LC_ALL: 'C' },
  }).trimEnd()
}

/** The skill's inline `TOPIC_SLUG=` line, run in bash on one topic. */
function skillInlineTopicSlug(topic: string): string {
  const line = /^TOPIC_SLUG=.*$/m.exec(SKILL)?.[0]
  if (line === undefined) throw new Error('the TOPIC_SLUG line was not found in the skill')
  return execFileSync('bash', ['-c', `TOPIC="$1"\n${line}\nprintf '%s' "$TOPIC_SLUG"`, 'bash', topic], {
    encoding: 'utf-8', env: { ...process.env, LC_ALL: 'C' },
  })
}

const TOPICS = [
  'JWT Authentication',
  'OAuth 2.0 Integration',
  "Bug: User can't login (v2.0)",
  'JWT/Auth_Tokens',
  '  --  ',
  '!!!',
  'Ünïcode café',
  `${'a'.repeat(44)} bcdefg hij`,
  `${'x'.repeat(49)} yz`,
  'This is a very long topic name that describes the entire feature and more words',
]

describe('the skill derives a topic slug one way: its inline line and its helper agree', () => {
  it('the inline line gives the helper\'s answer for every topic', () => {
    for (const topic of TOPICS) {
      expect(skillInlineTopicSlug(topic), JSON.stringify(topic)).toBe(skillTopicSlug(topic))
    }
  })

  it('the slug is capped at 50, never ends in a dash and is `untitled` when nothing is left', () => {
    expect(skillTopicSlug(`${'x'.repeat(49)} yz`)).toBe('x'.repeat(49))
    expect(skillTopicSlug(TOPICS[TOPICS.length - 1]).length).toBeLessThanOrEqual(50)
    expect(skillTopicSlug('!!!')).toBe('untitled')
    expect(skillInlineTopicSlug('!!!')).toBe('untitled')
  })

  it('known-bad probe: a 40-character cap in the helper is reported', () => {
    const helper = /^get_topic_slug\(\) \{.*\}$/m.exec(SKILL)?.[0] ?? ''
    const capped = helper.replace('cut -c1-50', 'cut -c1-40')
    expect(capped).not.toBe(helper)
    const run = (fn: string): string => execFileSync('bash', ['-c', `${fn}\nget_topic_slug "$1"`, 'bash', 'x'.repeat(60)], {
      encoding: 'utf-8', env: { ...process.env, LC_ALL: 'C' },
    }).trimEnd()
    expect(run(capped).length).toBe(40)
    expect(run(helper).length).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// branch_slug: one derivation at every site
// ---------------------------------------------------------------------------

const BRANCH_GATE = '^[A-Za-z0-9._-]{1,200}$'

interface BranchSite {
  readonly label: string
  readonly file: string
  /** The sentence that derives `branch_slug` at this site. */
  readonly sentence: string
}

const BRANCH_SITES: readonly BranchSite[] = [
  { label: '/code-review', file: 'code-review.md',
    sentence: '`branch_slug` is `git -C "{worktree}" branch --show-current` with every `/` replaced by `-`.' },
  { label: '/bug-analysis', file: 'bug-analysis.md',
    sentence: '`branch_slug` is `git -C "{worktree}" branch --show-current` with every `/` replaced by `-`.' },
  { label: '/implement', file: 'implement.md',
    sentence: '`branch_slug`: `TASK_ID` with every `/` replaced by `-`.' },
]

/** Named collector: the ways a site's `branch_slug` derivation departs from the skill's. */
export function collectBranchSlugDefects(sites: readonly BranchSite[], read: (file: string) => string): string[] {
  const out: string[] = []
  for (const site of sites) {
    const text = read(site.file)
    if (!text.includes(site.sentence)) out.push(`${site.label}: does not derive branch_slug as "${site.sentence}"`)
    if (!text.includes(BRANCH_GATE)) out.push(`${site.label}: does not gate branch_slug on ${BRANCH_GATE}`)
  }
  return out
}

describe('branch_slug is derived one way at every site', () => {
  it('the skill states the rule and the gate the sites apply', () => {
    expect(SKILL).toContain('The branch name with every `/` replaced by `-`')
    expect(SKILL).toContain(BRANCH_GATE)
  })

  it('/code-review, /bug-analysis and /implement agree with it', () => {
    expect(collectBranchSlugDefects(BRANCH_SITES, requireDistFile)).toEqual([])
  })

  it('known-bad probe: a derivation in the wrong checkout, a lost gate and a lost derivation are reported', () => {
    const real = (file: string): string => requireDistFile(file)
    const noC = (file: string): string => file === 'bug-analysis.md'
      ? real(file).replace('git -C "{worktree}" branch --show-current', 'git branch --show-current') : real(file)
    expect(collectBranchSlugDefects(BRANCH_SITES, noC)).toEqual([
      '/bug-analysis: does not derive branch_slug as "`branch_slug` is `git -C "{worktree}" branch --show-current` with every `/` replaced by `-`."',
    ])
    const ungated = (file: string): string => file === 'implement.md' ? real(file).replaceAll(BRANCH_GATE, '') : real(file)
    expect(collectBranchSlugDefects(BRANCH_SITES, ungated)).toEqual([`/implement: does not gate branch_slug on ${BRANCH_GATE}`])
    const lost = (file: string): string => file === 'implement.md'
      ? real(file).replace('`TASK_ID` with every `/` replaced by `-`', '`TASK_ID`') : real(file)
    expect(collectBranchSlugDefects(BRANCH_SITES, lost)).toHaveLength(1)
  })

  it('the skill\'s shell helper replaces every slash, and a detached HEAD is standalone', () => {
    const helper = /^get_branch_slug\(\) \{.*\}$/m.exec(SKILL)?.[0]
    expect(helper, 'get_branch_slug is in the skill').toBeDefined()
    const repo = mkdtempSync(path.join(tmpdir(), 'docs-framework-authority-'))
    const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf-8' })
    const slug = (): string => execFileSync('bash', ['-c', `${helper}\nget_branch_slug`], { cwd: repo, encoding: 'utf-8' }).trimEnd()
    try {
      git('init', '-q', '-b', 'feat/447/deep.name_x')
      git('commit', '-q', '--allow-empty', '-m', 'init')
      expect(slug()).toBe('feat-447-deep.name_x')
      git('checkout', '-q', '--detach')
      expect(slug()).toBe('standalone')
    } finally {
      rmSync(repo, { recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// handoff-* and evidence-*: one spelling, written and read
// ---------------------------------------------------------------------------

/** The spellings a command may name a handoff or evidence file by (under `.devflow/docs/`). */
const FILE_SPELLINGS = new Set(['handoff-{branch_slug}.md', 'evidence-{branch_slug}.md'])

/** Named collector: every handoff-* / evidence-* spelling in the commands that is not an admitted one. */
export function collectFileSpellings(commands: readonly NamedText[]): { all: Set<string>; strays: string[] } {
  const all = new Set<string>()
  const strays: string[] = []
  for (const { name, text } of commands) {
    for (const m of text.matchAll(/\.devflow\/docs\/((?:handoff|evidence)-[^\s"'`)]+)/g)) {
      all.add(m[1])
      if (!FILE_SPELLINGS.has(m[1])) strays.push(`${name}: ${m[1]}`)
    }
  }
  return { all, strays }
}

describe('handoff-* and evidence-* files are spelled one way wherever they are written or read', () => {
  it('every command site uses one of the two admitted spellings, and both occur', () => {
    const { all, strays } = collectFileSpellings(compiledCommands())
    expect(strays).toEqual([])
    expect([...all].sort()).toEqual([...FILE_SPELLINGS].sort())
  })

  it('known-bad probe: a hyphenated slug placeholder is reported', () => {
    const probe = [{ name: 'probe.md', text: 'write {worktree}/.devflow/docs/handoff-{branch-slug}.md' }]
    expect(collectFileSpellings(probe).strays).toEqual(['probe.md: handoff-{branch-slug}.md'])
  })

  it('the skill lists each spelling, with the hyphen placeholder its tree uses', () => {
    for (const spelling of FILE_SPELLINGS) {
      expect(SKILL, spelling).toContain(spelling.replace('{branch_slug}', '{branch-slug}'))
    }
  })

  it('the repo-relative EVIDENCE_FILE of every admitted slug passes update-pr-evidence\'s value gate', () => {
    const gate = /only a value matching `(\^[^`]+\$)` reaches the shell/.exec(PR_EVIDENCE_OP)?.[1]
    expect(gate, 'the op\'s EVIDENCE_FILE gate is found').toBe('^[A-Za-z0-9._/-]{1,255}$')
    const re = new RegExp(gate!)
    const branchGate = new RegExp(BRANCH_GATE)
    const longest = 'a'.repeat(200)
    expect(branchGate.test(longest)).toBe(true)
    expect(re.test(`.devflow/docs/evidence-${longest}.md`)).toBe(true)
    // Negative control: a slug the branch gate refuses is refused by the op's gate too.
    expect(branchGate.test('feat+x')).toBe(false)
    expect(re.test('.devflow/docs/evidence-feat+x.md')).toBe(false)
  })

  it('the evidence scripts take the file as an argument and never name or locate it', () => {
    for (const script of ['verify-evidence.cjs', 'pr-evidence.cjs']) {
      const text = readFileSync(path.join(SCRIPT_DIR, script), 'utf-8')
      expect(/handoff-|evidence-(?:\{|\$|[a-z]*slug)/.test(text), script).toBe(false)
    }
    expect(readFileSync(path.join(SCRIPT_DIR, 'verify-evidence.cjs'), 'utf-8')).toContain('--evidence <file>')
  })
})

// ---------------------------------------------------------------------------
// Run directories, and the topic slug /plan and /research take from the skill
// ---------------------------------------------------------------------------

/** The commands that create their own timestamped run directory, and so meet a same-minute second run. */
const RUN_DIRECTORY_COMMANDS = ['code-review.md', 'bug-analysis.md', 'research.md'] as const

/** Named collector: the run-directory commands that do not say what to do when the directory exists. */
export function collectCollisionDefects(read: (file: string) => string): string[] {
  return RUN_DIRECTORY_COMMANDS
    .filter(file => !(/same-minute/.test(read(file)) && read(file).includes('`YYYY-MM-DD_HHMMSS`')))
    .map(file => `${file}: does not append seconds on a same-minute collision`)
}

describe('a same-minute second run takes seconds, in the skill and in every command that creates the directory', () => {
  it('/code-review, /bug-analysis and /research each state it', () => {
    expect(collectCollisionDefects(requireDistFile)).toEqual([])
  })

  it('the skill says which four commands do, and what the suffix is', () => {
    expect(SKILL).toContain('`/code-review`, `/bug-analysis`, `/research` and `/plan` create their run directory themselves')
    expect(SKILL).toContain('appends seconds (`2025-12-26_143005`)')
  })

  it('known-bad probe: /research without the rule is reported', () => {
    const probe = (file: string): string => file === 'research.md'
      ? requireDistFile(file).replace('a same-minute collision', 'a repeat').replace('`YYYY-MM-DD_HHMMSS`', 'seconds')
      : requireDistFile(file)
    expect(collectCollisionDefects(probe)).toEqual(['research.md: does not append seconds on a same-minute collision'])
  })
})

describe('/plan and /research build their paths from the skill\'s topic slug', () => {
  it('/plan names the slug as the artifact\'s slug: value', () => {
    expect(requireDistFile('plan.md')).toContain(
      "`{topic-slug}` is its topic slug of the feature title, the same value as the artifact's `slug:` frontmatter")
  })

  it('/research takes the slug of the research question from the skill, not from a loose rule of its own', () => {
    const research = requireDistFile('research.md')
    expect(research).toContain('`{topic-slug}` is its topic slug of the research question')
    expect(research).not.toContain('no articles')
    expect(research).not.toContain('{timestamp}')
  })
})
