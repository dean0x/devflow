/**
 * Claude-directory guard (#406, item 2) — D-CLAUDE-DIR-PROMPTS.
 *
 * Claude Code reads `CLAUDE_CONFIG_DIR` when it is set to an absolute path, else
 * `~/.claude` (D-CLAUDE-CONFIG-DIR, src/targets/claude-code/claude-paths.ts), and
 * the installer writes skills there by the same rule. A prompt must follow that
 * rule: one that probes or reads `~/.claude/…` directly, or that expands the
 * variable in a looser way, disagrees with both the moment the variable holds
 * anything but an absolute path.
 *
 * THE SANCTIONED FORM is one shell line that resolves the directory the way the
 * installer does, and a prompt names paths under the result (`$d/…`,
 * `<that directory>/…`, `{claude_dir}/…`):
 *
 *   d="${CLAUDE_CONFIG_DIR:-}"; case "$d" in /*) ;; *) d="$HOME/.claude" ;; esac;
 *
 * THIS GUARD IS AN ALLOWLIST. Per file, each exact copy of the sanctioned line is
 * removed, and so is each piece of rule prose in ALLOWED_RULE_PROSE that is scoped
 * to that file (it is replaced by its short form). Nothing else may name the
 * variable. What is left is checked by `collectClaudeDirDefects`, one function per
 * rule, and every defect names its rule:
 * - `stray-variable`: `CLAUDE_CONFIG_DIR` in any other spelling or place;
 * - `home-claude-path`: a path INTO the home Claude directory (`~/.claude/x`,
 *   `$HOME/.claude/x`, `${HOME}/.claude/x`), or the directory ITSELF, whatever
 *   verb surrounds it and whether or not the variable is named beside it;
 * - `unrooted-path`: a `skills/devflow:`, `commands/devflow/`, `agents/devflow/`
 *   or `rules/devflow` path not directly under `$d/`, `<that directory>/` or
 *   `{claude_dir}/`;
 * - `unbound-that-directory`, `unbound-d-root`, `unbound-claude-dir-root`: a root
 *   used in a file that never sets it (the sanctioned line followed by the
 *   `printf`, the sanctioned line, or that line or allowlist entry (a));
 * - `d-reassigned`: a `d=` assignment that follows the sanctioned line.
 * SITE_ROWS fixes how many sanctioned lines each file holds, so a copy that drifts
 * from the constant byte for byte is not a site.
 *
 * WHAT A CLEAN RESULT DOES NOT COVER: a path assembled from parts
 * (`$HOME` + `/.claude`), a variable holding the literal, an absolute path spelt
 * with the user's own home (`/Users/x/.claude`), and anything outside the corpus
 * below. Of the hook, only the compaction directive (the text of `COMPACT_SECTION`)
 * is scanned, because the model follows it as text; the hook's own `case` tests
 * are code, and they stay out of scope. Other hooks and the TypeScript CLI resolve
 * the directory in code (getClaudeDirectory) and are held to it by their own tests.
 *
 * THE CORPUS is the installed prompt surface by class, each with a sentinel and a
 * floor so a class that went missing fails by name: compiled commands, every
 * agent as installed (dist-first), the compiled git references, the hand-authored
 * skills and rules, the learning-off builds of commands and agents, and the
 * compaction directive of the session-start hook.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { ROOT, SANCTIONED_RESOLUTION, compactDirectiveText, requireDistFile, requireDistFiles, resolveAllAgents, resolveLearningOffSource, sectionBetween, walkFiles } from '../helpers.js'
import { DEVFLOW_PLUGINS, buildScopedSkillsMap, getAllAgentNames } from '../../src/core/plugins.js'
import { installViaFileCopy } from '../../src/targets/claude-code/installer.js'

const countOf = (text: string, needle: string): number => text.split(needle).length - 1

/** The one skills path /code-review reads: the gate-level reference, under the resolved directory. */
const LEVEL_REFERENCE_PATH = 'skills/devflow:agent-references/references/commands/code-review-levels.md'

/**
 * Named collector: how a compiled /code-review reaches the Claude directory. Exactly one read is allowed:
 * the sanctioned resolution line, once, inside the gate-level block, followed by the one level-reference path.
 */
export function collectCodeReviewDirReadDefects(body: string): string[] {
  const out: string[] = []
  const lines = countOf(body, SANCTIONED_RESOLUTION)
  if (lines !== 1) out.push(`${lines} sanctioned resolution lines, expected 1`)
  const names = countOf(body, 'CLAUDE_CONFIG_DIR')
  if (names !== 1) out.push(`${names} CLAUDE_CONFIG_DIR names, expected 1`)
  const skillPaths = body.match(/skills\/devflow:[^\s`'")]*/g) ?? []
  if (skillPaths.length !== 1) out.push(`${skillPaths.length} skills/devflow: paths, expected 1`)
  else if (skillPaths[0] !== LEVEL_REFERENCE_PATH) out.push(`the one skills path is ${skillPaths[0]}, expected the level reference`)
  const block = sectionBetween(body, '**Gate level.**', '#### Step 1.3:')
  if (block === null) out.push('no gate-level block')
  else if (!block.includes(SANCTIONED_RESOLUTION)) out.push('the sanctioned resolution line sits outside the gate-level block')
  if (body.includes('{claude_dir}')) out.push('a {claude_dir} placeholder')
  return out
}

/** A path under the home Claude directory: `~/.claude/x`, `$HOME/.claude/x`, `${HOME}/.claude/x`. */
const PATH_UNDER_HOME_CLAUDE = /(?:~|\$HOME|\$\{HOME\})\/\.claude\/[^\s`'")]/

/** The home Claude directory itself, not followed by more of a name. */
const HOME_CLAUDE_DIR = /(?:~|\$HOME|\$\{HOME\})\/\.claude(?![\w.-])/

/** The sanctioned line followed by the `printf` that shows the directory it resolved. */
const SANCTIONED_RESOLUTION_PRINT = `${SANCTIONED_RESOLUTION} printf '%s\\n' "$d"`

/** A devflow install path: the part a root must directly precede. */
const DEVFLOW_INSTALL_PATH = /skills\/devflow:|commands\/devflow\/|agents\/devflow\/|rules\/devflow/g

/** The three roots a devflow install path may sit under. */
const BOUND_ROOTS = ['$d/', '<that directory>/', '{claude_dir}/'] as const

/** The `d=` assignment that follows the start of a line, a space, `;` or a backtick; `cut -d=` stays clean. */
const D_ASSIGNMENT = /(?:^|[ ;`])d=/

/** The name of the compaction directive entry in the corpus: the hook file and the variable that holds the text. */
export const COMPACTION_ENTRY = 'src/assets/scripts/hooks/session-start-context#COMPACT_SECTION'

interface PromptFile {
  readonly name: string
  readonly content: string
}

/** Rule prose that states the rule in words and may therefore name the variable, in the listed files only. */
export interface AllowedRuleProse {
  readonly id: string
  readonly text: string
  readonly replaceWith: string
  readonly files: readonly string[]
}

/** Entry (a): the prose rule that gives `{claude_dir}` its meaning. */
const RULE_PROSE_ID = 'rule-prose'

export const ALLOWED_RULE_PROSE: readonly AllowedRuleProse[] = [
  {
    id: RULE_PROSE_ID,
    text: '`CLAUDE_CONFIG_DIR` when that is set to an absolute path, else `$HOME/.claude`',
    replaceWith: '{claude_dir}',
    files: [
      'dist/commands/dynamic-profile.md',
      'dist/learning-off/commands/dynamic-profile.md',
      'src/assets/skills/agent-references/SKILL.md',
    ],
  },
  {
    id: 'compaction-rule',
    text: 'commands/devflow/<name>.md in $CLAUDE_CONFIG_DIR if absolute, else ~/.claude',
    replaceWith: '{claude_dir}/commands/devflow/<name>.md',
    files: [COMPACTION_ENTRY],
  },
]

/** How many sanctioned lines each file holds. A file that is not listed holds none. */
export const SITE_ROWS: Readonly<Record<string, number>> = {
  'dist/commands/code-review.md': 1,
  'dist/commands/dynamic-profile.md': 1,
  'dist/commands/plan.md': 1,
  'dist/commands/implement.md': 2,
  'dist/learning-off/commands/code-review.md': 1,
  'dist/learning-off/commands/dynamic-profile.md': 1,
  'dist/learning-off/commands/plan.md': 1,
  'dist/learning-off/commands/implement.md': 2,
  'src/assets/agents/synthesize.md': 1,
  'src/assets/agents/curate.md': 2,
}

/** What a file holds once the sanctioned line is taken out and each prose entry scoped to the file is replaced. */
function residueOf(file: PromptFile, allowed: readonly AllowedRuleProse[]): string {
  let text = file.content.split(SANCTIONED_RESOLUTION).join('')
  for (const entry of allowed) {
    if (entry.files.includes(file.name)) text = text.split(entry.text).join(entry.replaceWith)
  }
  return text
}

const lineDefect = (file: PromptFile, rule: string, text: string, index: number): string =>
  `${file.name}:${index + 1}: [${rule}] ${text.trim().slice(0, 240)}`

/** The zero-based line that holds the character at `position`. */
const lineAt = (text: string, position: number): number => text.slice(0, position).split('\n').length - 1

/** One defect for the line of `content` that holds `position`. */
function defectAt(file: PromptFile, rule: string, content: string, position: number): string {
  const index = lineAt(content, position)
  return lineDefect(file, rule, content.split('\n')[index], index)
}

/** One defect per line of `residue` that satisfies `matches`. */
const lineDefects = (file: PromptFile, rule: string, residue: string, matches: (text: string) => boolean): string[] =>
  residue.split('\n').flatMap((text, index) => matches(text) ? [lineDefect(file, rule, text, index)] : [])

/** Rule `stray-variable`: the variable name anywhere in what is left. */
function ruleStrayVariable(file: PromptFile, residue: string): string[] {
  return lineDefects(file, 'stray-variable', residue, text => text.includes('CLAUDE_CONFIG_DIR'))
}

/** Rule `home-claude-path`: a path into the home Claude directory, or the directory itself, with no exemption for the variable name. */
function ruleHomeClaudePath(file: PromptFile, residue: string): string[] {
  return lineDefects(file, 'home-claude-path', residue, text => PATH_UNDER_HOME_CLAUDE.test(text) || HOME_CLAUDE_DIR.test(text))
}

/** Rule `unrooted-path`: a devflow install path whose directly preceding text is not one of the three roots. */
function ruleUnrootedPath(file: PromptFile, residue: string): string[] {
  const out: string[] = []
  for (const match of residue.matchAll(DEVFLOW_INSTALL_PATH)) {
    const at = match.index ?? 0
    const before = residue.slice(Math.max(0, at - 24), at)
    if (!BOUND_ROOTS.some(root => before.endsWith(root))) out.push(defectAt(file, 'unrooted-path', residue, at))
  }
  return out
}

/** A defect when `root` is used in `file` before `binder` appears, or when `binder` never appears. */
function unboundRoot(file: PromptFile, rule: string, root: string, binder: string): string[] {
  const use = file.content.indexOf(root)
  if (use < 0) return []
  const set = file.content.indexOf(binder)
  return set >= 0 && set < use ? [] : [defectAt(file, rule, file.content, use)]
}

/** Rule `unbound-claude-dir-root`: `{claude_dir}/` used in a file that holds neither the sanctioned line nor entry (a). */
function ruleUnboundClaudeDirRoot(file: PromptFile, allowed: readonly AllowedRuleProse[]): string[] {
  const use = file.content.indexOf('{claude_dir}/')
  if (use < 0) return []
  const prose = allowed.find(entry => entry.id === RULE_PROSE_ID)
  const stated = prose !== undefined && prose.files.includes(file.name) && file.content.includes(prose.text)
  if (stated || file.content.includes(SANCTIONED_RESOLUTION)) return []
  return [defectAt(file, 'unbound-claude-dir-root', file.content, use)]
}

/** Rule `d-reassigned`: a `d=` assignment in what is left once the sanctioned line is gone. */
function ruleDReassigned(file: PromptFile, residue: string): string[] {
  return lineDefects(file, 'd-reassigned', residue, text => D_ASSIGNMENT.test(text))
}

/** Named collector: every place in the corpus that reaches the Claude directory by any route but the sanctioned ones. */
export function collectClaudeDirDefects(corpus: readonly PromptFile[], allowed: readonly AllowedRuleProse[] = ALLOWED_RULE_PROSE): string[] {
  const out: string[] = []
  for (const file of corpus) {
    const residue = residueOf(file, allowed)
    out.push(
      ...ruleStrayVariable(file, residue),
      ...ruleHomeClaudePath(file, residue),
      ...ruleUnrootedPath(file, residue),
      // Rules `unbound-that-directory` (the sanctioned line and its `printf`) and `unbound-d-root` (the sanctioned line).
      ...unboundRoot(file, 'unbound-that-directory', '<that directory>', SANCTIONED_RESOLUTION_PRINT),
      ...unboundRoot(file, 'unbound-d-root', '$d/', SANCTIONED_RESOLUTION),
      ...ruleUnboundClaudeDirRoot(file, allowed),
      ...ruleDReassigned(file, residue),
    )
  }
  return out
}

/** Named collector: each (entry, file) pair of the allowlist is live: the file is in the corpus and holds the text once. */
export function collectAllowlistDefects(corpus: readonly PromptFile[], allowed: readonly AllowedRuleProse[] = ALLOWED_RULE_PROSE): string[] {
  const out: string[] = []
  for (const entry of allowed) {
    for (const name of entry.files) {
      const file = corpus.find(f => f.name === name)
      if (file === undefined) out.push(`${entry.id}: ${name} is not in the corpus`)
      else if (countOf(file.content, entry.text) !== 1) out.push(`${entry.id}: ${name} holds the text ${countOf(file.content, entry.text)} times, expected 1`)
    }
  }
  return out
}

/** Named collector: the number of sanctioned lines in each corpus file is the number its site row states. */
export function collectSiteRowDefects(corpus: readonly PromptFile[], rows: Readonly<Record<string, number>> = SITE_ROWS): string[] {
  const out: string[] = []
  for (const name of Object.keys(rows)) {
    if (!corpus.some(f => f.name === name)) out.push(`${name}: a site row names a file that is not in the corpus`)
  }
  for (const file of corpus) {
    const found = countOf(file.content, SANCTIONED_RESOLUTION)
    const expected = rows[file.name] ?? 0
    if (found !== expected) out.push(`${file.name}: ${found} sanctioned lines, expected ${expected}`)
  }
  return out
}

interface CorpusClass {
  readonly label: string
  readonly files: readonly PromptFile[]
  readonly sentinel: string
  readonly floor: number
}

const rel = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/')

function readTree(dir: string): PromptFile[] {
  return walkFiles(path.join(ROOT, dir), f => f.endsWith('.md')).map(f => ({ name: rel(f), content: readFileSync(f, 'utf-8') }))
}

function promptSurface(): CorpusClass[] {
  const commands = requireDistFiles().map(n => ({ name: `dist/commands/${n}`, content: requireDistFile(n) }))
  const agents = [...resolveAllAgents().values()].map(a => ({ name: rel(a.path), content: a.content }))
  return [
    { label: 'commands', files: commands, sentinel: 'dist/commands/code-review.md', floor: 14 },
    { label: 'agents', files: agents, sentinel: 'dist/agents/git.md', floor: getAllAgentNames().length },
    { label: 'references', files: readTree('dist/skills'), sentinel: 'dist/skills/git/references/publication-gate.md', floor: 20 },
    { label: 'skills', files: readTree('src/assets/skills'), sentinel: 'src/assets/skills/worktree-support/SKILL.md', floor: 30 },
    { label: 'rules', files: readTree('src/assets/rules'), sentinel: 'src/assets/rules/security.md', floor: 4 },
    { label: 'learning-off', files: readTree('dist/learning-off'), sentinel: 'dist/learning-off/commands/code-review.md', floor: 25 },
    { label: 'compaction directive', files: [{ name: COMPACTION_ENTRY, content: compactDirectiveText() }], sentinel: COMPACTION_ENTRY, floor: 1 },
  ]
}

let surfaceCache: CorpusClass[] | undefined
const surface = (): CorpusClass[] => (surfaceCache ??= promptSurface())
const wholeCorpus = (): PromptFile[] => surface().flatMap(c => c.files)

/** A real corpus file with a probe appended, as a one-file corpus. */
function seeded(host: string, addition: string): PromptFile[] {
  const file = wholeCorpus().find(f => f.name === host)
  if (file === undefined) throw new Error(`${host} is not in the prompt corpus`)
  return [{ name: file.name, content: `${file.content}\n${addition}\n` }]
}

/** The file a defect message starts with. */
const defectFile = (defect: string): string => defect.replace(/:\d+: \[.*$/s, '')

/** A real file that holds the sanctioned line and its `printf`, and one that holds neither. */
const WITH_LINE = 'dist/commands/code-review.md'
const WITHOUT_LINE = 'dist/commands/debug.md'

/** Assert that the collector reports `addition`, seeded into the real file `host`, as a defect of the named rule. */
function expectReported(host: string, addition: string, rule: string): void {
  const defects = collectClaudeDirDefects(seeded(host, addition))
  expect(defects.filter(d => d.includes(`[${rule}]`)), `${JSON.stringify(addition)} in ${host} is not reported by rule ${rule}`).not.toEqual([])
}

describe('no prompt reaches the Claude directory outside the CLAUDE_CONFIG_DIR rule (D-CLAUDE-DIR-PROMPTS)', () => {
  it('reads a real corpus: every class is present, by sentinel and by floor', () => {
    for (const { label, files, sentinel, floor } of surface()) {
      expect(files.map(f => f.name), `${label}: sentinel ${sentinel} not in the corpus`).toContain(sentinel)
      expect(files.length, `${label}: ${files.length} files, below the floor of ${floor}`).toBeGreaterThanOrEqual(floor)
    }
  })

  it('the compaction directive class holds the directive text itself', () => {
    const entry = wholeCorpus().find(f => f.name === COMPACTION_ENTRY)
    expect(entry, 'the compaction directive is not in the corpus').toBeDefined()
    expect(entry?.content).toContain('commands/devflow/')
    expect(entry?.content.length).toBeGreaterThan(100)
  })

  it('no prompt names the variable outside the sanctioned line and the allowlisted prose, and every devflow install path sits under a bound root', () => {
    expect(collectClaudeDirDefects(wholeCorpus())).toEqual([])
  })

  it('the allowlist is live: each entry names corpus files that hold its text exactly once', () => {
    expect(collectAllowlistDefects(wholeCorpus())).toEqual([])
  })

  it('each file holds the number of sanctioned lines its site row states, and no other file holds one', () => {
    expect(collectSiteRowDefects(wholeCorpus())).toEqual([])
  })

  it('the consumer carries the sanctioned resolution: /dynamic-profile', () => {
    // The positive half: a clean scan must mean the probe moved onto the rule,
    // not that it was deleted.
    const profile = requireDistFile('dynamic-profile.md')
    expect(profile).toContain(SANCTIONED_RESOLUTION_PRINT)
    for (const sub of ['{claude_dir}/projects/', '{claude_dir}/history.jsonl', '{claude_dir}/rules/']) {
      expect(profile, `dynamic-profile reads ${sub} under the resolved directory`).toContain(sub)
    }
  })

  it("/code-review's language gate is the install-time stamp, and its one directory read is the level reference (D-LANGUAGE-FOCUS-STAMP)", async () => {
    // The positive half for the command whose probe moved: the compiled command carries the
    // stamp rule and the stamp line, and its only read under the Claude directory is the level
    // reference, through the sanctioned resolution line; the installed copy carries the list.
    // tests/installer/language-stamp*.test.ts holds the rest of the installer side.
    const review = requireDistFile('code-review.md')
    expect(review).toContain('A language focus is spawned only when its file-type condition above fires AND its name appears in that stamped line.')
    expect(review.split('\n').filter(line => line.startsWith('Installed language focuses: '))).toHaveLength(1)
    expect(collectCodeReviewDirReadDefects(review)).toEqual([])
    const off = resolveLearningOffSource('commands', 'code-review')
    expect(off, 'dist/learning-off/commands/code-review.md is absent: run `npm run build:mds`').not.toBeNull()
    expect(collectCodeReviewDirReadDefects(off as string)).toEqual([])

    // The installed copy, into injected temp directories (never the real home): a selection with
    // devflow-typescript installs a code-review whose stamp lists typescript.
    const claudeDir = await mkdtemp(path.join(os.tmpdir(), 'devflow-claude-dir-claude-'))
    const devflowDir = await mkdtemp(path.join(os.tmpdir(), 'devflow-claude-dir-home-'))
    try {
      const plugins = ['devflow-core-skills', 'devflow-code-review', 'devflow-typescript']
        .map(name => DEVFLOW_PLUGINS.find(p => p.name === name)!)
      await installViaFileCopy({
        plugins, claudeDir, devflowDir, learning: true,
        skillsMap: buildScopedSkillsMap(plugins), agentsMap: new Map(), isPartialInstall: false,
        spinner: { start() {}, stop() {}, message() {} },
      })
      const installed = await readFile(path.join(claudeDir, 'commands', 'devflow', 'code-review.md'), 'utf-8')
      expect(installed.split('\n').filter(line => line.startsWith('Installed language focuses: '))).toEqual(['Installed language focuses: typescript'])
    } finally {
      await rm(claudeDir, { recursive: true, force: true })
      await rm(devflowDir, { recursive: true, force: true })
    }
  })

  it('the sanctioned line resolves CLAUDE_CONFIG_DIR only when absolute, as getClaudeDirectory does', () => {
    const run = (env: Record<string, string | undefined>): string => {
      const clean: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: '/home/probe' }
      for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v
      return spawnSync('bash', ['-c', `${SANCTIONED_RESOLUTION} printf '%s' "$d"`], { encoding: 'utf-8', env: clean }).stdout
    }
    expect(run({})).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: '' })).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: 'relative/dir' })).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: '/opt/claude config' })).toBe('/opt/claude config')
    expect(run({ CLAUDE_CONFIG_DIR: '~/x' })).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: ' /abs' })).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: '/' })).toBe('/')
    expect(run({ HOME: '' })).toBe('/.claude')
  })

  it('red probes: a second sanctioned line, a language skill Read and the read moved out of the gate-level block are each reported', () => {
    const review = requireDistFile('code-review.md')
    const seed = (body: string, from: string, to: string): string => {
      const next = body.replace(from, () => to)
      expect(next, `the seed ${JSON.stringify(from.slice(0, 40))} must change the text`).not.toBe(body)
      return next
    }
    const stampEnd = 'are never stamp-gated.'
    const second = seed(review, stampEnd, `${stampEnd} Run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash.`)
    expect(collectCodeReviewDirReadDefects(second)).toEqual([
      '2 sanctioned resolution lines, expected 1',
      '2 CLAUDE_CONFIG_DIR names, expected 1',
    ])
    const skillRead = seed(review, stampEnd, `${stampEnd} Read \`<that directory>/skills/devflow:go/SKILL.md\` with the Read tool.`)
    expect(collectCodeReviewDirReadDefects(skillRead)).toEqual(['2 skills/devflow: paths, expected 1'])
    const readParagraph = review.split('\n\n').find(p => p.includes(LEVEL_REFERENCE_PATH))
    expect(readParagraph, 'the read paragraph is in the compiled command').toBeDefined()
    const moved = seed(seed(review, `${readParagraph}\n\n`, ''), 'Set `DIFF_CLASS` by these rules', `${readParagraph}\n\nSet \`DIFF_CLASS\` by these rules`)
    expect(collectCodeReviewDirReadDefects(moved)).toEqual(['the sanctioned resolution line sits outside the gate-level block'])
    expect(collectCodeReviewDirReadDefects(`${review}\nRead {claude_dir}/x.`)).toEqual(['a {claude_dir} placeholder'])
  })

  it('red probe: the superseded presence gate, seeded into the real compiled command, is reported', () => {
    const review = { name: WITH_LINE, content: requireDistFile('code-review.md') }
    expect(collectClaudeDirDefects([review])).toEqual([])
    const seededReview = {
      ...review,
      content: `${review.content}\nfor each language focus, check whether \`~/.claude/skills/devflow:{focus}/SKILL.md\` exists (one file-existence check per candidate focus).\n`,
    }
    expect([...new Set(collectClaudeDirDefects([seededReview]).map(defectFile))]).toEqual(['dist/commands/code-review.md'])
  })

  it('red probes: every spelling of a read or probe under the home Claude directory is reported', () => {
    const probes = [
      'check whether `~/.claude/skills/devflow:{focus}/SKILL.md` exists',
      '1. Run: rg -l "AskUserQuestion" ~/.claude/projects/ 2>/dev/null | head -50',
      '3. Read ~/.claude/history.jsonl if it exists',
      '4. Read all files in ~/.claude/rules/ (small — read fully).',
      'test -f "$HOME/.claude/skills/devflow:go/SKILL.md"',
      '[ -d "${HOME}/.claude/agents/devflow" ] && echo installed',
      'cat $HOME/.claude/settings.json',
      'ls ~/.claude',
      'Glob the transcripts under `$HOME/.claude`.',
    ]
    for (const probe of probes) expectReported(WITH_LINE, probe, 'home-claude-path')
  })

  it('red probes: every form of the retired inline expansion, in the shapes a read site takes, is reported', () => {
    const retired = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}'
    const probes = [
      `Read \`${retired}/skills/devflow:x/SKILL.md\` with the Read tool.`,
      `resolve \`${retired}\` in Bash`,
      `echo "${retired}/skills/devflow:agent-references/references/synthesize"`,
      `cd "<project root>" && find "${retired}/rules/devflow" -name '*.md'`,
      '${CLAUDE_CONFIG_DIR-/opt/claude}',
      '${CLAUDE_CONFIG_DIR:=/opt/claude}',
      '$CLAUDE_CONFIG_DIR/skills/devflow:x',
      '"${CLAUDE_CONFIG_DIR}"/skills/devflow:x',
      '{$CLAUDE_CONFIG_DIR or ~/.claude}/commands/devflow/<name>.md',
      'Read it from `CLAUDE_CONFIG_DIR`, else `~/.claude`.',
      'd="${CLAUDE_CONFIG_DIR:-}"; case "$d" in ?*) ;; *) d="$HOME/.claude" ;; esac;',
      `${SANCTIONED_RESOLUTION} echo "\${CLAUDE_CONFIG_DIR}"`,
    ]
    for (const probe of probes) expectReported(WITH_LINE, probe, 'stray-variable')
  })

  it('red probes: a devflow install path with no bound root before it is reported', () => {
    for (const probe of ['.claude/skills/devflow:x/SKILL.md', 'Read skills/devflow:go/SKILL.md', 'find rules/devflow', 'ls commands/devflow/', 'ls agents/devflow/']) {
      expectReported(WITH_LINE, probe, 'unrooted-path')
    }
  })

  it('red probes: a root used in a file that never sets it, and a `d=` assignment after the sanctioned line, are reported', () => {
    expectReported(WITHOUT_LINE, 'ls "$d/skills/devflow:x"', 'unbound-d-root')
    expectReported(WITHOUT_LINE, `Read "$d/skills/devflow:x" first, then ${SANCTIONED_RESOLUTION}`, 'unbound-d-root')
    expectReported(WITHOUT_LINE, 'Read `<that directory>/skills/devflow:x`.', 'unbound-that-directory')
    expectReported(WITHOUT_LINE, `Run \`${SANCTIONED_RESOLUTION}\` in Bash, Read \`<that directory>/skills/devflow:x\`.`, 'unbound-that-directory')
    expectReported(WITHOUT_LINE, 'Read `{claude_dir}/skills/devflow:x`.', 'unbound-claude-dir-root')
    expectReported(WITH_LINE, `${SANCTIONED_RESOLUTION} d="/elsewhere"; ls "$d"`, 'd-reassigned')
    expectReported(WITH_LINE, `\`${SANCTIONED_RESOLUTION}d=/elsewhere\``, 'd-reassigned')
    expectReported(WITHOUT_LINE, 'echo ready; d=/elsewhere', 'd-reassigned')
  })

  it('negative controls: the rule itself and paths under a bound root are not reported', () => {
    const controls = [
      SANCTIONED_RESOLUTION,
      `${SANCTIONED_RESOLUTION_PRINT}; ls "$d/skills/devflow:x"`,
      'Read `<that directory>/skills/devflow:x`.',
      'Read `{claude_dir}/skills/devflow:x`.',
      'rg -l "AskUserQuestion" "{claude_dir}/projects/" 2>/dev/null | head -50',
      'test -f "$d/skills/devflow:{focus}/SKILL.md"',
      'deploy.ts          # AI editors (.claude/, .cursor/ dirs)',
      'the installed copies under `~/.devflow` are produced from these',
      'cut -d= -f1',
    ]
    for (const control of controls) expect(collectClaudeDirDefects(seeded(WITH_LINE, control)), control).toEqual([])
  })

  it('the corpus classes are live: the old form seeded into the sentinel of each class is reported against that file', () => {
    const retired = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/devflow:x'
    for (const { label, sentinel } of surface()) {
      const defects = collectClaudeDirDefects(seeded(sentinel, retired))
      expect(defects.map(defectFile), `${label}: the old form seeded into ${sentinel} is not reported against it`).toContain(sentinel)
    }
  })

  it('the allowlist entries are scoped: removing one reports each of its files, and the prose out of its files is reported', () => {
    const corpus = wholeCorpus()
    for (const entry of ALLOWED_RULE_PROSE) {
      const without = ALLOWED_RULE_PROSE.filter(e => e.id !== entry.id)
      const reported = [...new Set(collectClaudeDirDefects(corpus, without).map(defectFile))].sort()
      expect(reported, `removing ${entry.id}`).toEqual([...entry.files].sort())
    }
    const [ruleProse, compaction] = ALLOWED_RULE_PROSE
    expect(collectClaudeDirDefects([{ name: 'control.md', content: ruleProse.text }]).map(defectFile)).toContain('control.md')
    expectReported(WITH_LINE, compaction.text, 'stray-variable')
  })

  it('the allowlist and site-row collectors report a missing file, a changed text and a drifted count', () => {
    const corpus = wholeCorpus()
    const [ruleProse] = ALLOWED_RULE_PROSE
    expect(collectAllowlistDefects(corpus, [{ ...ruleProse, files: ['dist/commands/absent.md'] }])).toEqual([`${ruleProse.id}: dist/commands/absent.md is not in the corpus`])
    expect(collectAllowlistDefects(corpus, [{ ...ruleProse, text: `${ruleProse.text} and more` }])).toHaveLength(ruleProse.files.length)
    expect(collectSiteRowDefects(seeded(WITH_LINE, SANCTIONED_RESOLUTION), { [WITH_LINE]: 1 })).toEqual([`${WITH_LINE}: 2 sanctioned lines, expected 1`])
    expect(collectSiteRowDefects(seeded(WITHOUT_LINE, SANCTIONED_RESOLUTION))).toContain(`${WITHOUT_LINE}: 1 sanctioned lines, expected 0`)
    const drifted = { name: WITH_LINE, content: wholeCorpus().find(f => f.name === WITH_LINE)!.content.replace(SANCTIONED_RESOLUTION, SANCTIONED_RESOLUTION.replace('/*)', '?*)')) }
    expect(collectSiteRowDefects([drifted], { [WITH_LINE]: 1 })).toEqual([`${WITH_LINE}: 0 sanctioned lines, expected 1`])
    expect(collectSiteRowDefects(wholeCorpus().filter(f => f.name !== 'src/assets/agents/curate.md'))).toEqual(['src/assets/agents/curate.md: a site row names a file that is not in the corpus'])
  })
})
