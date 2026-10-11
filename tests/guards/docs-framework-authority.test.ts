/**
 * D-DOCS-NAMES-AUTHORITY — `devflow:docs-framework` is the one authority for the names under
 * `.devflow/docs/`, so every command that writes or looks up such a path must agree with it.
 *
 * The skill had drifted from what the commands write: it knew nothing of `/dynamic-plan`'s per-ticket
 * `design/{slug}/{ts}/` folders, the `handoff-*` and `evidence-*` files or the multi-issue and
 * no-issue design documents, while `/dynamic-tickets` and `/dynamic-plan` stamped UTC and capped slugs
 * at 40 where the skill says local time and 50. This guard holds the two sides together:
 *
 *  - every path family a compiled command names under `.devflow/docs/` appears in the skill;
 *  - the timestamp and slug expressions the workflow scripts run give the answers the skill's own
 *    helpers give, so a rule changed on one side fails here;
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

/** The four commands whose workflow scripts stamp or slug a docs path. */
const DYNAMIC_HOSTS = ['dynamic-build', 'dynamic-plan', 'dynamic-profile', 'dynamic-tickets'] as const

/** Every family the compiled commands name directly under `.devflow/docs/`. */
const EXPECTED_FAMILIES = [
  'bug-analysis', 'design', 'evidence-', 'evidence-wave-', 'handoff-', 'research', 'reviews', 'tickets', 'waves',
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

  it('the skill tree carries the dynamic layouts, with the sub-folders and the files in them', () => {
    for (const piece of [
      'design/\n', '└── {slug}/{timestamp}/', '{ticket-slug}-plan.md', 'DECISIONS-NEEDED.md',
      'tickets/{slug}/{timestamp}/', 'tracking-issue.md', 'waves/{slug}/{timestamp}/wave-report.md',
      'handoff-{branch-slug}.md', 'evidence-{branch-slug}.md', 'evidence-wave-{slug}.md',
      'resolution-summary.md', 'evidence.md', 'stale-plan.md',
    ]) {
      expect(SKILL, `the skill does not carry ${JSON.stringify(piece)}`).toContain(piece)
    }
  })

  it('known-bad probe: a skill without the waves directory is reported', () => {
    const probe = SKILL.replaceAll('waves', 'wafts')
    expect(collectUnknownFamilies(collectDocFamilies(compiledCommands()).keys(), probe)).toEqual(['waves'])
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
    for (const n of names) expect(SKILL, n).toContain(`├── ${n}`)
  })

  it('known-bad probe: a skill with only the single-issue variant is reported', () => {
    const probe = SKILL.replace('├── multi-{topic-slug}.{timestamp}.md', '├── gone')
    const missing = planDesignNames(requireDistFile('plan.md')).filter(n => !probe.includes(`├── ${n}`))
    expect(missing).toEqual(['multi-{topic-slug}.{timestamp}.md'])
  })
})

// ---------------------------------------------------------------------------
// The workflow scripts' timestamp and slug expressions
// ---------------------------------------------------------------------------

/** The script lines that bind `slug` and `ts`: from `const slug = args.slug` to the `const ts =` line. */
export function scriptStampLines(command: string): string {
  const lines = command.split('\n')
  const from = lines.findIndex(l => l.startsWith('const slug = args.slug'))
  const to = lines.findIndex((l, i) => i > from && l.startsWith('const ts ='))
  if (from === -1 || to === -1) throw new Error('the slug/ts lines of the workflow script were not found')
  return lines.slice(from, to + 1).join('\n')
}

/** A clock whose local fields and UTC string disagree, so only a local-time expression passes. */
class SkewedDate {
  getFullYear(): number { return 2026 }
  getMonth(): number { return 3 }
  getDate(): number { return 7 }
  getHours(): number { return 9 }
  getMinutes(): number { return 5 }
  toISOString(): string { return '2026-04-07T14:05:00.000Z' }
}

/** Run the script's slug/ts lines for an `initiative` and `args`, with the skewed clock. */
export function runStampLines(command: string, args: Record<string, string>, initiative: string): { slug: string; ts: string } {
  const body = `${scriptStampLines(command)}\nreturn { slug, ts }`
  return new Function('args', 'initiative', 'Date', body)(args, initiative, SkewedDate) as { slug: string; ts: string }
}

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

describe('the workflow scripts follow the skill: local time, one slug rule', () => {
  const tickets = requireDistFile('dynamic-tickets.md')
  const plan = requireDistFile('dynamic-plan.md')

  it('both scripts stamp YYYY-MM-DD_HHMM from the local clock, not the UTC string', () => {
    expect(runStampLines(tickets, {}, 'x').ts).toBe('2026-04-07_0905')
    expect(runStampLines(plan, {}, 'x').ts).toBe('2026-04-07_0905')
  })

  it('known-bad probe: the retired UTC expression is reported', () => {
    const utc = tickets.replace(/^const ts =.*$/m,
      "const ts = new Date().toISOString().slice(0,16).replace(/[-:T]/g, (c) => c === 'T' ? '_' : c === ':' ? '' : c);")
    expect(runStampLines(utc, {}, 'x').ts).not.toBe('2026-04-07_0905')
  })

  it('/dynamic-tickets derives the initiative slug as the skill does, for every topic', () => {
    for (const topic of TOPICS) {
      const fromScript = runStampLines(tickets, {}, topic).slug
      expect(fromScript, JSON.stringify(topic)).toBe(skillTopicSlug(topic))
      expect(skillInlineTopicSlug(topic), JSON.stringify(topic)).toBe(fromScript)
    }
  })

  it('the slug is capped at 50 and never ends in a dash', () => {
    const long = runStampLines(tickets, {}, `${'x'.repeat(49)} yz`).slug
    expect(long).toBe('x'.repeat(49))
    expect(runStampLines(tickets, {}, TOPICS[TOPICS.length - 1]).slug.length).toBeLessThanOrEqual(50)
  })

  it('a slug handed in as an argument wins, in both scripts', () => {
    expect(runStampLines(tickets, { slug: 'given' }, 'ignored').slug).toBe('given')
    expect(runStampLines(plan, { slug: 'given' }, 'ignored').slug).toBe('given')
    expect(runStampLines(plan, {}, 'ignored').slug).toBe('wave')
  })

  it('known-bad probe: the retired 40-character cap is reported', () => {
    const capped = tickets.replace('.slice(0, 50)', '.slice(0, 40)')
    expect(runStampLines(capped, {}, 'x'.repeat(60)).slug.length).toBe(40)
    expect(runStampLines(tickets, {}, 'x'.repeat(60)).slug.length).toBe(50)
  })

  it('/dynamic-plan passes the slug of the ticket set it plans, and names its plans by the ticket slug', () => {
    expect(plan).toContain("and its `slug` argument: the `{slug}` of the ticket directory (`tickets/{slug}/{ts}/`) when that is the ticket source, otherwise `wave`.")
    expect(plan).toContain("{ticket-slug} being the ticket's file name without .md when it came from a ticket directory, otherwise the ticket title run through title.toLowerCase().replace(/[^a-z0-9]+/g, '-') with nothing trimmed")
  })

  it('the skill documents the ticket-slug exception and the dynamic commands apply that rule', () => {
    const rule = "title.toLowerCase().replace(/[^a-z0-9]+/g, '-') with nothing trimmed"
    expect(tickets).toContain(rule)
    expect(plan).toContain(rule)
    expect(SKILL).toContain('nothing trimmed and no length cap')
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
  /** True when the site gates the slug before it builds a path. */
  readonly gated: boolean
}

const BRANCH_SITES: readonly BranchSite[] = [
  { label: '/code-review', file: 'code-review.md', gated: true,
    sentence: '`branch_slug` is `git -C "{worktree}" branch --show-current` with every `/` replaced by `-`.' },
  { label: '/bug-analysis', file: 'bug-analysis.md', gated: true,
    sentence: '`branch_slug` is `git -C "{worktree}" branch --show-current` with every `/` replaced by `-`.' },
  { label: '/implement', file: 'implement.md', gated: true,
    sentence: '`branch_slug`: `TASK_ID` with every `/` replaced by `-`.' },
  ...DYNAMIC_HOSTS.map((host): BranchSite => ({
    label: `/${host}`, file: `${host}.md`, gated: false,
    sentence: "`{branch_slug}` being the ticket's branch name with every `/` replaced by `-`",
  })),
]

/** Named collector: the ways a site's `branch_slug` derivation departs from the skill's. */
export function collectBranchSlugDefects(sites: readonly BranchSite[], read: (file: string) => string): string[] {
  const out: string[] = []
  for (const site of sites) {
    const text = read(site.file)
    if (!text.includes(site.sentence)) out.push(`${site.label}: does not derive branch_slug as "${site.sentence}"`)
    if (site.gated && !text.includes(BRANCH_GATE)) out.push(`${site.label}: does not gate branch_slug on ${BRANCH_GATE}`)
  }
  return out
}

describe('branch_slug is derived one way at every site', () => {
  it('the skill states the rule and the gate the sites apply', () => {
    expect(SKILL).toContain('The branch name with every `/` replaced by `-`')
    expect(SKILL).toContain(BRANCH_GATE)
  })

  it('/code-review, /bug-analysis, /implement and the four dynamic commands agree with it', () => {
    expect(collectBranchSlugDefects(BRANCH_SITES, requireDistFile)).toEqual([])
  })

  it('known-bad probe: a derivation in the wrong checkout, a lost gate and a missing site are reported', () => {
    const real = (file: string): string => requireDistFile(file)
    const noC = (file: string): string => file === 'bug-analysis.md'
      ? real(file).replace('git -C "{worktree}" branch --show-current', 'git branch --show-current') : real(file)
    expect(collectBranchSlugDefects(BRANCH_SITES, noC)).toEqual([
      '/bug-analysis: does not derive branch_slug as "`branch_slug` is `git -C "{worktree}" branch --show-current` with every `/` replaced by `-`."',
    ])
    const ungated = (file: string): string => file === 'implement.md' ? real(file).replaceAll(BRANCH_GATE, '') : real(file)
    expect(collectBranchSlugDefects(BRANCH_SITES, ungated)).toEqual([`/implement: does not gate branch_slug on ${BRANCH_GATE}`])
    const lost = (file: string): string => file === 'dynamic-plan.md'
      ? real(file).replace("`{branch_slug}` being the ticket's branch name", '`{branch_slug}`') : real(file)
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
const FILE_SPELLINGS = new Set(['handoff-{branch_slug}.md', 'evidence-{branch_slug}.md', 'evidence-wave-{slug}.md'])

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
  it('every command site uses one of the three admitted spellings, and all three occur', () => {
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

  it('evidence-wave-{slug}.md is evidence-{branch_slug}.md for the branch wave/{slug}', () => {
    const branchSlug = (branch: string): string => branch.replaceAll('/', '-')
    for (const slug of ['auth', 'sdlc-pr6-2026', 'a'.repeat(60)]) {
      expect(`evidence-${branchSlug(`wave/${slug}`)}.md`).toBe(`evidence-wave-${slug}.md`)
    }
    expect(SKILL).toContain("the `evidence-{branch-slug}.md` of the branch `wave/{slug}`")
  })

  it('the repo-relative EVIDENCE_FILE of every admitted slug passes update-pr-evidence\'s value gate', () => {
    const gate = /only a value matching `(\^[^`]+\$)` reaches the shell/.exec(PR_EVIDENCE_OP)?.[1]
    expect(gate, 'the op\'s EVIDENCE_FILE gate is found').toBe('^[A-Za-z0-9._/-]{1,255}$')
    const re = new RegExp(gate!)
    const branchGate = new RegExp(BRANCH_GATE)
    const longest = 'a'.repeat(200)
    expect(branchGate.test(longest)).toBe(true)
    expect(re.test(`.devflow/docs/evidence-${longest}.md`)).toBe(true)
    expect(re.test(`.devflow/docs/evidence-wave-${'a'.repeat(60)}.md`)).toBe(true)
    // Negative control: a slug the branch gate refuses is refused by the op's gate too.
    expect(branchGate.test('feat+x')).toBe(false)
    expect(re.test('.devflow/docs/evidence-feat+x.md')).toBe(false)
  })

  it('the evidence scripts take the file as an argument and never name or locate it', () => {
    for (const script of ['verify-evidence.cjs', 'pr-evidence.cjs']) {
      const text = readFileSync(path.join(SCRIPT_DIR, script), 'utf-8')
      expect(/handoff-|evidence-(?:\{|\$|wave-|[a-z]*slug)/.test(text), script).toBe(false)
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

  it('the skill says which three commands do, and what the suffix is', () => {
    expect(SKILL).toContain('`/code-review`, `/bug-analysis` and `/research` create their run directory themselves')
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
