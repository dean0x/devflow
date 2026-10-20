/**
 * Claude-directory guard (#406, item 2) — D-CLAUDE-DIR-PROMPTS.
 *
 * Claude Code reads `CLAUDE_CONFIG_DIR` when it is set to an absolute path, else
 * `~/.claude` (D-CLAUDE-CONFIG-DIR, src/targets/claude-code/claude-paths.ts), and
 * the installer writes skills there by the same rule. A prompt must follow that
 * rule. A prompt that probes or reads `~/.claude/…` directly disagrees with the
 * installer whenever the variable holds an absolute path. A prompt that expands the
 * variable in a looser way disagrees whenever it holds a value that is not an
 * absolute path.
 *
 * THE SANCTIONED FORM is one shell line that resolves the directory the way the
 * installer does, and a prompt names paths under the result (`$d/…`,
 * `<that directory>/…`, `{claude_dir}/…`):
 *
 *   d="${CLAUDE_CONFIG_DIR:-}"; case "$d" in /*) ;; *) d="$HOME/.claude" ;; esac;
 *
 * A parity test runs the line in bash and calls getClaudeDirectory under the same
 * environment, and the two must print the same directory.
 *
 * THIS GUARD IS AN ALLOWLIST. Per file, each exact copy of the sanctioned line is
 * removed, and each piece of rule prose in ALLOWED_RULE_PROSE that is scoped to that
 * file is replaced by its short form. What is left is the residue, and the residue
 * may not name the variable. `collectClaudeDirDefects` runs one function per rule,
 * and every defect names its rule.
 *
 * Four rules read the residue. For them the order of the text does not matter:
 * - `stray-variable`: fires on `CLAUDE_CONFIG_DIR` in any other spelling or place;
 * - `home-claude-path`: fires on a path INTO the home Claude directory
 *   (`~/.claude/x`, `$HOME/.claude/x`, `${HOME}/.claude/x`) and on the directory
 *   ITSELF, whatever verb surrounds it and whether or not the variable is named
 *   beside it;
 * - `unrooted-path`: fires on a `skills/devflow:`, `commands/devflow/`,
 *   `agents/devflow/` or `rules/devflow` path that does not sit directly under
 *   `$d/`, `<that directory>/` or `{claude_dir}/`;
 * - `d-reassigned`: fires on any `d=` assignment outside the sanctioned line, at the
 *   start of a line or after whitespace, `;`, `&`, `|`, `(` or a backtick, and on a
 *   `for d in` loop. `cut -d=` stays clean.
 *
 * Three rules read the whole file as written, and each checks a root against its
 * binder:
 * - `unbound-d-root`: fires on a `$d/` that has no sanctioned line earlier on the
 *   SAME line. Order and line both matter, because each Bash call is a fresh shell
 *   and `d` does not carry from one line to the next;
 * - `unbound-that-directory`: fires when the first `<that directory>` of a file has
 *   no sanctioned line followed by its `printf` earlier in the file. Order matters,
 *   and the binder may sit on another line;
 * - `unbound-claude-dir-root`: fires on `{claude_dir}/` in a file that holds neither
 *   the sanctioned line nor the text of an ALLOWED_RULE_PROSE entry that carries
 *   `binds` and is scoped to that file. It checks presence only, because the rule
 *   prose that defines `{claude_dir}` follows its first use in the file.
 *
 * SITE_ROWS fixes how many sanctioned lines each file holds. A line that differs
 * from the constant by any byte does not count as a site, so its row fails.
 *
 * WHAT A CLEAN RESULT DOES NOT COVER: a path assembled from parts
 * (`$HOME` + `/.claude`), a variable holding the literal, an absolute path spelt
 * with the user's own home (`/Users/x/.claude`), an empty `HOME` (the installer
 * refuses it, where the sanctioned line yields `/.claude`), an unset `HOME` (the
 * installer falls back to the system user's home directory, where the sanctioned
 * line yields `/.claude`; a known-divergence test for each case pins the line's
 * value), a reassignment of `d` that `d-reassigned` does not match (it matches `d=`
 * and `for d in` only, so `d+=`, `unset d`, `read d` and `printf -v d` pass), and
 * anything outside the corpus below. Of the hook, only
 * the compaction directive (the text of `COMPACT_SECTION`) is scanned, because the
 * model follows it as text; the hook's own `case` tests are code, and they stay out
 * of scope. Other hooks and the TypeScript CLI resolve the directory in code
 * (getClaudeDirectory) and are held to it by their own tests.
 *
 * THE CORPUS is the installed prompt surface by class, each with a sentinel and a
 * floor so a class that went missing fails by name: compiled commands, every
 * agent as installed (dist-first), the compiled git references, the hand-authored
 * skills and rules, the learning-off builds of commands and agents, and the
 * compaction directive of the session-start hook.
 *
 * THE COMPILED CLASSES MUST BE CURRENT, WITHIN THE LIMITS OF THE CHECK. The first test
 * fails by name when a compiled prompt is older than the inputs `compiledPrompts`
 * names for it (`collectStaleOutputs`, shared with the no-config-read guard): a
 * command against its own host and the command partials, an agent against its own
 * generator host only, and a reference against the reference modules. An edit to a
 * partial that agents share (for example `src/assets/agents/_partials/_code.mds`)
 * without a rebuild is NOT detected, so run `npm run build:mds` after such an edit.
 */

import { describe, it, expect, vi } from 'vitest'
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { MIN_COMPILED_PROMPTS, RETIRED_INLINE_EXPANSION, ROOT, SANCTIONED_RESOLUTION, SANCTIONED_RESOLUTION_PRINT, collectStaleOutputs, compactDirectiveFrom, compactDirectiveText, compiledPrompts, requireDistFile, requireDistFiles, resolveAgentSource, resolveAllAgents, resolveLearningOffSource, sectionBetween, walkFiles } from '../helpers.js'
import { DEVFLOW_PLUGINS, buildScopedSkillsMap, getAllAgentNames } from '../../src/core/plugins.js'
import { installViaFileCopy } from '../../src/targets/claude-code/installer.js'
import { getClaudeDirectory } from '../../src/targets/claude-code/claude-paths.js'

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

/** The skills path /plan reads at a gate level: the levels reference, under the resolved directory. */
const PLAN_LEVEL_REFERENCE_PATH = 'skills/devflow:agent-references/references/commands/plan-levels.md'

/** The other skills path /plan reads: the compliance reference that the Phase 5 compliance spawn reads. */
const PLAN_COMPLIANCE_REFERENCE_PATH = 'skills/devflow:gap-analysis/references/compliance.md'

/**
 * How many times a compiled /plan holds each of the three counts: one read in the gate-level block and one in
 * the Phase 5 compliance spawn. The figure comes from measuring the compiled command, never from a read line
 * edited to fit it.
 */
const PLAN_DIR_READS = 2

/**
 * Named collector: how a compiled /plan reaches the Claude directory. Two reads are allowed, each through the
 * sanctioned resolution line: the levels reference inside the gate-level block, with the line before the path,
 * and the compliance reference in the Phase 5 compliance spawn.
 */
export function collectPlanDirReadDefects(body: string): string[] {
  const out: string[] = []
  const lines = countOf(body, SANCTIONED_RESOLUTION)
  if (lines !== PLAN_DIR_READS) out.push(`${lines} sanctioned resolution lines, expected ${PLAN_DIR_READS}`)
  const names = countOf(body, 'CLAUDE_CONFIG_DIR')
  if (names !== PLAN_DIR_READS) out.push(`${names} CLAUDE_CONFIG_DIR names, expected ${PLAN_DIR_READS}`)
  const skillPaths = (body.match(/skills\/devflow:[^\s`'")]*/g) ?? []).sort()
  const wanted = [PLAN_COMPLIANCE_REFERENCE_PATH, PLAN_LEVEL_REFERENCE_PATH].sort()
  if (skillPaths.length !== PLAN_DIR_READS) out.push(`${skillPaths.length} skills/devflow: paths, expected ${PLAN_DIR_READS}`)
  else if (skillPaths.join(' ') !== wanted.join(' ')) out.push(`the skills paths are ${skillPaths.join(', ')}, expected ${wanted.join(', ')}`)
  const block = sectionBetween(body, '**Gate level.**', '#### Phase 3:')
  if (block === null) out.push('no gate-level block')
  else {
    const resolution = block.indexOf(SANCTIONED_RESOLUTION)
    const levels = block.indexOf(PLAN_LEVEL_REFERENCE_PATH)
    if (resolution === -1) out.push('the sanctioned resolution line sits outside the gate-level block')
    if (levels === -1) out.push('the levels reference path sits outside the gate-level block')
    if (resolution !== -1 && levels !== -1 && levels < resolution) out.push('the levels reference path comes before the sanctioned resolution line')
  }
  if (body.includes('{claude_dir}')) out.push('a {claude_dir} placeholder')
  return out
}

/** A path under the home Claude directory: `~/.claude/x`, `$HOME/.claude/x`, `${HOME}/.claude/x`. */
const PATH_UNDER_HOME_CLAUDE = /(?:~|\$HOME|\$\{HOME\})\/\.claude\/[^\s`'")]/

/** The home Claude directory itself, not followed by more of a name. */
const HOME_CLAUDE_DIR = /(?:~|\$HOME|\$\{HOME\})\/\.claude(?![\w.-])/

/** A devflow install path: the part a root must directly precede. */
const DEVFLOW_INSTALL_PATH = /skills\/devflow:|commands\/devflow\/|agents\/devflow\/|rules\/devflow/g

/** The three roots a devflow install path may sit under. */
const BOUND_ROOTS = ['$d/', '<that directory>/', '{claude_dir}/'] as const

/** How much text before a devflow install path holds its root: the longest root. */
const ROOT_LOOKBEHIND = Math.max(...BOUND_ROOTS.map(root => root.length))

/** A `d=` assignment after the start of a line, whitespace, `;`, `&`, `|`, `(` or a backtick, or a `for d in` loop; `cut -d=` stays clean. */
const D_ASSIGNMENT = /(?:^|[\s;&|(`])d=|\bfor d in\b/

/** The name of the compaction directive entry in the corpus: the hook file and the variable that holds the text. */
export const COMPACTION_ENTRY = 'src/assets/scripts/hooks/session-start-context#COMPACT_SECTION'

interface PromptFile {
  readonly name: string
  readonly content: string
}

/** The placeholder a prompt names the resolved Claude directory by. */
const CLAUDE_DIR_PLACEHOLDER = '{claude_dir}'

/** Rule prose that states the rule in words and may therefore name the variable, in the listed files only. */
export interface AllowedRuleProse {
  readonly id: string
  readonly text: string
  readonly replaceWith: string
  readonly files: readonly string[]
  /** The placeholder this prose gives its meaning to in the files it is scoped to; absent when it binds none. */
  readonly binds?: typeof CLAUDE_DIR_PLACEHOLDER
}

export const ALLOWED_RULE_PROSE: readonly AllowedRuleProse[] = [
  {
    id: 'rule-prose',
    text: '`CLAUDE_CONFIG_DIR` when that is set to an absolute path, else `$HOME/.claude`',
    replaceWith: CLAUDE_DIR_PLACEHOLDER,
    binds: CLAUDE_DIR_PLACEHOLDER,
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

/** The corpus name of a file: its path from the repository root, with forward slashes. */
const rel = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/')

/** The corpus name of a named agent: the path of the file the harness resolves for it. */
const agentFile = (name: string): string => rel(resolveAgentSource(name).path)

const SYNTHESIZE_FILE = agentFile('synthesize')
const CURATE_FILE = agentFile('curate')

/** Sanctioned-line counts by file name. A name can be absent, so a lookup yields `undefined` and the caller states the default. */
type SiteRows = Readonly<Partial<Record<string, number>>>

/** How many sanctioned lines each file holds. A file that is not listed holds none. */
export const SITE_ROWS: SiteRows = {
  'dist/commands/code-review.md': 1,
  'dist/commands/dynamic-profile.md': 1,
  'dist/commands/plan.md': 2,
  'dist/commands/implement.md': 3,
  'dist/commands/resolve.md': 1,
  'dist/learning-off/commands/code-review.md': 1,
  'dist/learning-off/commands/dynamic-profile.md': 1,
  'dist/learning-off/commands/plan.md': 2,
  'dist/learning-off/commands/implement.md': 3,
  'dist/learning-off/commands/resolve.md': 1,
  [SYNTHESIZE_FILE]: 1,
  [CURATE_FILE]: 2,
}

/** What a file holds once the sanctioned line is taken out and each prose entry scoped to the file is replaced. */
function residueOf(file: PromptFile, allowed: readonly AllowedRuleProse[]): string {
  let text = file.content.split(SANCTIONED_RESOLUTION).join('')
  for (const entry of allowed) {
    if (entry.files.includes(file.name)) text = text.split(entry.text).join(entry.replaceWith)
  }
  return text
}

/** One place in a prompt file that reaches the Claude directory by a route the rules refuse. */
export interface ClaudeDirDefect {
  readonly file: string
  /** One-based line number in the file. */
  readonly line: number
  readonly rule: string
  /** The trimmed text of that line. */
  readonly text: string
}

/** A defect as one message line, for the live corpus assertion. */
const formatDefect = (defect: ClaudeDirDefect): string =>
  `${defect.file}:${defect.line}: [${defect.rule}] ${defect.text.slice(0, 240)}`

const lineDefect = (file: PromptFile, rule: string, text: string, index: number): ClaudeDirDefect =>
  ({ file: file.name, line: index + 1, rule, text: text.trim() })

/** The zero-based line that holds the character at `position`. */
const lineAt = (text: string, position: number): number => text.slice(0, position).split('\n').length - 1

/** One defect for the line of `content` that holds `position`. */
function defectAt(file: PromptFile, rule: string, content: string, position: number): ClaudeDirDefect {
  const index = lineAt(content, position)
  return lineDefect(file, rule, content.split('\n')[index], index)
}

/** One defect per line of `residue` that satisfies `matches`. */
const lineDefects = (file: PromptFile, rule: string, residue: string, matches: (text: string) => boolean): ClaudeDirDefect[] =>
  residue.split('\n').flatMap((text, index) => matches(text) ? [lineDefect(file, rule, text, index)] : [])

/** Rule `stray-variable`: the variable name anywhere in what is left. */
function ruleStrayVariable(file: PromptFile, residue: string): ClaudeDirDefect[] {
  return lineDefects(file, 'stray-variable', residue, text => text.includes('CLAUDE_CONFIG_DIR'))
}

/** Rule `home-claude-path`: a path into the home Claude directory, or the directory itself, with no exemption for the variable name. */
function ruleHomeClaudePath(file: PromptFile, residue: string): ClaudeDirDefect[] {
  return lineDefects(file, 'home-claude-path', residue, text => PATH_UNDER_HOME_CLAUDE.test(text) || HOME_CLAUDE_DIR.test(text))
}

/** Rule `unrooted-path`: a devflow install path whose directly preceding text is not one of the three roots. */
function ruleUnrootedPath(file: PromptFile, residue: string): ClaudeDirDefect[] {
  const out: ClaudeDirDefect[] = []
  for (const match of residue.matchAll(DEVFLOW_INSTALL_PATH)) {
    const at = match.index ?? 0
    const before = residue.slice(Math.max(0, at - ROOT_LOOKBEHIND), at)
    if (!BOUND_ROOTS.some(root => before.endsWith(root))) out.push(defectAt(file, 'unrooted-path', residue, at))
  }
  return out
}

/** A defect when `root` is used in `file` before `binder` appears, or when `binder` never appears. */
function unboundRoot(file: PromptFile, rule: string, root: string, binder: string): ClaudeDirDefect[] {
  const use = file.content.indexOf(root)
  if (use < 0) return []
  const set = file.content.indexOf(binder)
  return set >= 0 && set < use ? [] : [defectAt(file, rule, file.content, use)]
}

/** Rule `unbound-claude-dir-root`: `{claude_dir}/` used in a file that holds neither the sanctioned line nor the text of an allowlist entry that binds it. */
function ruleUnboundClaudeDirRoot(file: PromptFile, allowed: readonly AllowedRuleProse[]): ClaudeDirDefect[] {
  const use = file.content.indexOf(`${CLAUDE_DIR_PLACEHOLDER}/`)
  if (use < 0) return []
  const stated = allowed.some(entry => entry.binds === CLAUDE_DIR_PLACEHOLDER && entry.files.includes(file.name) && file.content.includes(entry.text))
  if (stated || file.content.includes(SANCTIONED_RESOLUTION)) return []
  return [defectAt(file, 'unbound-claude-dir-root', file.content, use)]
}

/** Rule `unbound-d-root`: a `$d/` use with no sanctioned line before it on its own line. Each Bash call is a fresh shell, so `d` does not carry from one line to the next. */
function ruleUnboundDRoot(file: PromptFile): ClaudeDirDefect[] {
  return lineDefects(file, 'unbound-d-root', file.content, text => {
    const use = text.indexOf('$d/')
    const bound = text.indexOf(SANCTIONED_RESOLUTION)
    return use >= 0 && !(bound >= 0 && bound < use)
  })
}

/** Rule `d-reassigned`: a `d=` assignment in what is left once the sanctioned line is gone. */
function ruleDReassigned(file: PromptFile, residue: string): ClaudeDirDefect[] {
  return lineDefects(file, 'd-reassigned', residue, text => D_ASSIGNMENT.test(text))
}

/** Named collector: every place in the corpus that reaches the Claude directory by any route but the sanctioned ones. */
export function collectClaudeDirDefects(corpus: readonly PromptFile[], allowed: readonly AllowedRuleProse[] = ALLOWED_RULE_PROSE): ClaudeDirDefect[] {
  const out: ClaudeDirDefect[] = []
  for (const file of corpus) {
    const residue = residueOf(file, allowed)
    out.push(
      ...ruleStrayVariable(file, residue),
      ...ruleHomeClaudePath(file, residue),
      ...ruleUnrootedPath(file, residue),
      // Rule `unbound-that-directory`: the sanctioned line and its `printf` set the directory before it is named.
      ...unboundRoot(file, 'unbound-that-directory', '<that directory>', SANCTIONED_RESOLUTION_PRINT),
      ...ruleUnboundDRoot(file),
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
export function collectSiteRowDefects(corpus: readonly PromptFile[], rows: SiteRows = SITE_ROWS): string[] {
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

/** The corpus file named `name`; a name the corpus does not hold is an error that names it. */
function corpusFile(name: string): PromptFile {
  const file = wholeCorpus().find(f => f.name === name)
  if (file === undefined) throw new Error(`${name} is not in the prompt corpus`)
  return file
}

/** A real corpus file with a probe appended, as a one-file corpus. */
function seeded(host: string, addition: string): PromptFile[] {
  const file = corpusFile(host)
  return [{ name: file.name, content: `${file.content}\n${addition}\n` }]
}

/** The allowlist entry with the given id; an id the allowlist does not hold is an error that names it. */
function allowedEntry(id: string): AllowedRuleProse {
  const entry = ALLOWED_RULE_PROSE.find(e => e.id === id)
  if (entry === undefined) throw new Error(`${id} is not an ALLOWED_RULE_PROSE entry`)
  return entry
}

/** The distinct files the defects name, in the order they first appear. */
const filesOf = (defects: readonly ClaudeDirDefect[]): string[] => [...new Set(defects.map(d => d.file))]

/** A real file that holds the sanctioned line and its `printf`, and one that holds neither. */
const WITH_LINE = 'dist/commands/code-review.md'
const WITHOUT_LINE = 'dist/commands/debug.md'

/** Assert that the collector reports `addition`, seeded into the real file `host`, as a defect of the named rule. */
function expectReported(host: string, addition: string, rule: string): void {
  const defects = collectClaudeDirDefects(seeded(host, addition))
  expect(defects.filter(d => d.rule === rule && d.file === host), `${JSON.stringify(addition)} in ${host} is not reported by rule ${rule}`).not.toEqual([])
}

/** The directory the sanctioned line prints in a clean shell holding, unless undefined, `HOME` and `CLAUDE_CONFIG_DIR`. */
function sanctionedLineDirectory(home: string | undefined, configured: string | undefined): string {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH }
  if (home !== undefined) env.HOME = home
  if (configured !== undefined) env.CLAUDE_CONFIG_DIR = configured
  return spawnSync('bash', ['-c', `${SANCTIONED_RESOLUTION} printf '%s' "$d"`], { encoding: 'utf-8', env }).stdout
}

/** The directory the installer resolves under the same environment: `getClaudeDirectory()` with the process environment stubbed. */
function installerDirectory(home: string, configured: string | undefined): string {
  vi.stubEnv('HOME', home)
  vi.stubEnv('CLAUDE_CONFIG_DIR', configured)
  try {
    return getClaudeDirectory()
  } finally {
    vi.unstubAllEnvs()
  }
}

describe('no prompt reaches the Claude directory outside the CLAUDE_CONFIG_DIR rule (D-CLAUDE-DIR-PROMPTS)', () => {
  it('the compiled prompt corpus is current: no dist/ output is older than a source it is compiled from', () => {
    // First, so a stale build is named before any scan reads text nobody ships. It fails; it never skips.
    expect(compiledPrompts().length, 'no compiled prompt found — run `npm run build:mds`').toBeGreaterThanOrEqual(MIN_COMPILED_PROMPTS)
    expect(
      collectStaleOutputs(),
      'dist/ is older than its sources, so every scan below reads text nobody ships — run `npm run build:mds`',
    ).toEqual([])
  })

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

  it('the directive reader takes exactly one COMPACT_SECTION assignment, and a missing hook file fails loudly', async () => {
    const assignment = "    COMPACT_SECTION='read the command file'"
    expect(compactDirectiveFrom(`case x in\n${assignment}\nesac\n`)).toBe('read the command file')
    expect(() => compactDirectiveFrom('COMPACT_SECTION="read the command file"\n')).toThrow('found 0')
    expect(() => compactDirectiveFrom(`${assignment}\n${assignment}\n`)).toThrow('found 2')
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-claude-dir-hook-'))
    try {
      expect(() => compactDirectiveText(root)).toThrow()
      const hooks = path.join(root, 'src', 'assets', 'scripts', 'hooks')
      await mkdir(hooks, { recursive: true })
      await writeFile(path.join(hooks, 'session-start-context'), `${assignment}\n`)
      expect(compactDirectiveText(root)).toBe('read the command file')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('no prompt names the variable outside the sanctioned line and the allowlisted prose, and every devflow install path sits under a bound root', () => {
    const defects = collectClaudeDirDefects(wholeCorpus())
    expect(defects, defects.map(formatDefect).join('\n')).toEqual([])
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

  it('the sanctioned line resolves the same directory as getClaudeDirectory under the same environment', () => {
    const rows: Array<string | undefined> = [undefined, '', 'relative/dir', '/opt/claude config', '~/x', ' /abs', '/']
    const resolved = new Set<string>()
    for (const configured of rows) {
      const expected = installerDirectory('/home/probe', configured)
      expect(sanctionedLineDirectory('/home/probe', configured), `CLAUDE_CONFIG_DIR=${JSON.stringify(configured)}`).toBe(expected)
      resolved.add(expected)
    }
    // Non-vacuity: the rows reach both answers, the fallback and a configured directory.
    expect([...resolved].sort()).toEqual(['/', '/home/probe/.claude', '/opt/claude config'])
  })

  it('known divergence, an empty HOME: the sanctioned line yields /.claude where the installer refuses an empty HOME', () => {
    // The installer reads HOME and, with HOME empty, Node reports an empty home, so getHomeDirectory throws.
    // The throw is platform-dependent (tests/paths.test.ts), so only the line's value is pinned here.
    expect(sanctionedLineDirectory('', undefined)).toBe('/.claude')
  })

  it('known divergence, an unset HOME: the sanctioned line yields /.claude where the installer falls back to the system user home directory', () => {
    // The installer reads HOME and, with HOME absent, takes the home directory Node reports for the system user
    // (readHomeDirectory), so it resolves under a real home. The line has no such fallback and expands the absent
    // HOME to nothing. The installer's value depends on the machine, so only the line's value is pinned here.
    // The environment holds PATH alone: HOME and CLAUDE_CONFIG_DIR are both absent, whatever the parent process holds.
    expect(sanctionedLineDirectory(undefined, undefined)).toBe('/.claude')
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

  it("/plan's directory reads are the levels reference in the gate-level block and the compliance reference, each through the sanctioned line", () => {
    // Both builds, with every count taken from the measurement of the compiled command: two sanctioned lines,
    // two CLAUDE_CONFIG_DIR names and two skills paths, and no {claude_dir} placeholder.
    const plan = requireDistFile('plan.md')
    expect(collectPlanDirReadDefects(plan)).toEqual([])
    const off = resolveLearningOffSource('commands', 'plan')
    expect(off, 'dist/learning-off/commands/plan.md is absent: run `npm run build:mds`').not.toBeNull()
    expect(collectPlanDirReadDefects(off as string)).toEqual([])
    // Non-vacuity: the compiled command holds the levels path and the compliance path the collector expects.
    for (const body of [plan, off as string]) {
      expect(body).toContain(PLAN_LEVEL_REFERENCE_PATH)
      expect(body).toContain(PLAN_COMPLIANCE_REFERENCE_PATH)
    }
  })

  it("red probes: a third sanctioned line, a third skills path, the levels read moved out of the gate-level block, the path before the line and a {claude_dir} placeholder are each reported in /plan", () => {
    const plan = requireDistFile('plan.md')
    const seed = (body: string, from: string, to: string): string => {
      const next = body.replace(from, () => to)
      expect(next, `the seed ${JSON.stringify(from.slice(0, 40))} must change the text`).not.toBe(body)
      return next
    }
    const anchor = 'No gate may be skipped.'
    expect(collectPlanDirReadDefects(seed(plan, anchor, `${anchor} Run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash.`))).toEqual([
      '3 sanctioned resolution lines, expected 2',
      '3 CLAUDE_CONFIG_DIR names, expected 2',
    ])
    expect(collectPlanDirReadDefects(seed(plan, anchor, `${anchor} Read \`<that directory>/skills/devflow:go/SKILL.md\` with the Read tool.`)))
      .toEqual(['3 skills/devflow: paths, expected 2'])
    expect(collectPlanDirReadDefects(seed(plan, PLAN_COMPLIANCE_REFERENCE_PATH, 'skills/devflow:gap-analysis/references/other.md')))
      .toEqual([`the skills paths are skills/devflow:agent-references/references/commands/plan-levels.md, skills/devflow:gap-analysis/references/other.md, expected ${PLAN_LEVEL_REFERENCE_PATH}, ${PLAN_COMPLIANCE_REFERENCE_PATH}`])
    const readPart = `run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash and Read \`<that directory>/${PLAN_LEVEL_REFERENCE_PATH}\` with the Read tool`
    expect(plan, 'the levels read is in the compiled command').toContain(readPart)
    const phase3 = '#### Phase 3: Explore Requirements (Parallel)\n\n'
    const moved = seed(seed(plan, readPart, 'read the levels reference'), phase3, `${phase3}${readPart}.\n\n`)
    expect(collectPlanDirReadDefects(moved)).toEqual([
      'the sanctioned resolution line sits outside the gate-level block',
      'the levels reference path sits outside the gate-level block',
    ])
    const pathFirst = `Read \`<that directory>/${PLAN_LEVEL_REFERENCE_PATH}\` with the Read tool, after you run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash`
    expect(collectPlanDirReadDefects(seed(plan, readPart, pathFirst))).toEqual(['the levels reference path comes before the sanctioned resolution line'])
    expect(collectPlanDirReadDefects(`${plan}\nRead {claude_dir}/x.`)).toEqual(['a {claude_dir} placeholder'])
  })

  it('red probe: the superseded presence gate, seeded into the real compiled command, is reported', () => {
    const review = { name: WITH_LINE, content: requireDistFile('code-review.md') }
    expect(collectClaudeDirDefects([review])).toEqual([])
    const seededReview = {
      ...review,
      content: `${review.content}\nfor each language focus, check whether \`~/.claude/skills/devflow:{focus}/SKILL.md\` exists (one file-existence check per candidate focus).\n`,
    }
    expect(filesOf(collectClaudeDirDefects([seededReview]))).toEqual(['dist/commands/code-review.md'])
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
    const probes = [
      `Read \`${RETIRED_INLINE_EXPANSION}/skills/devflow:agent-references/SKILL.md\` with the Read tool.`,
      `resolve \`${RETIRED_INLINE_EXPANSION}\` in Bash`,
      `echo "${RETIRED_INLINE_EXPANSION}/skills/devflow:agent-references/references/synthesize"`,
      `cd "<project root>" && find "${RETIRED_INLINE_EXPANSION}/rules/devflow" -name '*.md'`,
      '${CLAUDE_CONFIG_DIR-/opt/claude}',
      '${CLAUDE_CONFIG_DIR:=/opt/claude}',
      '$CLAUDE_CONFIG_DIR/skills/devflow:agent-references',
      '"${CLAUDE_CONFIG_DIR}"/skills/devflow:agent-references',
      '{$CLAUDE_CONFIG_DIR or ~/.claude}/commands/devflow/<name>.md',
      'Read it from `CLAUDE_CONFIG_DIR`, else `~/.claude`.',
      'd="${CLAUDE_CONFIG_DIR:-}"; case "$d" in ?*) ;; *) d="$HOME/.claude" ;; esac;',
      `${SANCTIONED_RESOLUTION} echo "\${CLAUDE_CONFIG_DIR}"`,
    ]
    for (const probe of probes) expectReported(WITH_LINE, probe, 'stray-variable')
  })

  it('red probes: a devflow install path with no bound root before it is reported', () => {
    for (const probe of ['.claude/skills/devflow:agent-references/SKILL.md', 'Read skills/devflow:go/SKILL.md', 'find rules/devflow', 'ls commands/devflow/', 'ls agents/devflow/']) {
      expectReported(WITH_LINE, probe, 'unrooted-path')
    }
  })

  it('red probes: a root with no binder, a root used before its binder, and a `d=` assignment outside the sanctioned line are each reported', () => {
    expectReported(WITHOUT_LINE, 'ls "$d/skills/devflow:agent-references"', 'unbound-d-root')
    expectReported(WITHOUT_LINE, `Read "$d/skills/devflow:agent-references" first, then ${SANCTIONED_RESOLUTION}`, 'unbound-d-root')
    expectReported(WITHOUT_LINE, 'Read `<that directory>/skills/devflow:agent-references`.', 'unbound-that-directory')
    expectReported(WITHOUT_LINE, `Run \`${SANCTIONED_RESOLUTION}\` in Bash, Read \`<that directory>/skills/devflow:agent-references\`.`, 'unbound-that-directory')
    expectReported(WITHOUT_LINE, 'Read `{claude_dir}/skills/devflow:agent-references`.', 'unbound-claude-dir-root')
    expectReported(WITH_LINE, `${SANCTIONED_RESOLUTION} d="/elsewhere"; ls "$d"`, 'd-reassigned')
    expectReported(WITH_LINE, `\`${SANCTIONED_RESOLUTION}d=/elsewhere\``, 'd-reassigned')
    expectReported(WITHOUT_LINE, 'echo ready; d=/elsewhere', 'd-reassigned')
  })

  it('red probes: a `d=` assignment after `&`, `|`, `(` or a tab, and a `for d in` loop, are reported', () => {
    expectReported(WITHOUT_LINE, 'true&&d=/elsewhere', 'd-reassigned')
    expectReported(WITHOUT_LINE, 'false||d=/elsewhere', 'd-reassigned')
    expectReported(WITHOUT_LINE, '(d=/elsewhere; ls "$d")', 'd-reassigned')
    expectReported(WITHOUT_LINE, 'echo ready\td=/elsewhere', 'd-reassigned')
    expectReported(WITHOUT_LINE, 'for d in /one /two; do ls "$d"; done', 'd-reassigned')
  })

  it('red probes: a `$d/` use binds to the sanctioned line on its own line, not to one earlier in the file', () => {
    // Each Bash call starts a fresh shell, so the variable does not carry from one line to the next.
    expectReported(WITH_LINE, 'ls "$d/skills/devflow:agent-references"', 'unbound-d-root')
    expectReported(SYNTHESIZE_FILE, 'ls "$d/skills/devflow:agent-references"', 'unbound-d-root')
    expectReported(SYNTHESIZE_FILE, `${SANCTIONED_RESOLUTION}\nls "$d/skills/devflow:agent-references"`, 'unbound-d-root')
  })

  it('the {claude_dir} binder is the allowlist entry that declares it, whatever its id', () => {
    const host = 'src/assets/skills/agent-references/SKILL.md'
    const file = wholeCorpus().filter(f => f.name === host)
    expect(file, `${host} is not in the corpus`).toHaveLength(1)
    expect(file[0].content, `${host} no longer uses a {claude_dir}/ path`).toContain('{claude_dir}/')
    const renamed = ALLOWED_RULE_PROSE.map(entry => entry.binds === undefined ? entry : { ...entry, id: 'renamed-binder' })
    expect(collectClaudeDirDefects(file, renamed)).toEqual([])
    const unbinding = ALLOWED_RULE_PROSE.map(entry => ({ ...entry, binds: undefined }))
    expect(collectClaudeDirDefects(file, unbinding).filter(d => d.rule === 'unbound-claude-dir-root')).not.toEqual([])
  })

  it('negative controls: the rule itself and paths under a bound root are not reported', () => {
    const controls = [
      SANCTIONED_RESOLUTION,
      `${SANCTIONED_RESOLUTION_PRINT}; ls "$d/skills/devflow:agent-references"`,
      'Read `<that directory>/skills/devflow:agent-references`.',
      'Read `{claude_dir}/skills/devflow:agent-references`.',
      'rg -l "AskUserQuestion" "{claude_dir}/projects/" 2>/dev/null | head -50',
      `${SANCTIONED_RESOLUTION} test -f "$d/skills/devflow:{focus}/SKILL.md"`,
      'deploy.ts          # AI editors (.claude/, .cursor/ dirs)',
      'the installed copies under `~/.devflow` are produced from these',
      'cut -d= -f1',
    ]
    for (const control of controls) expect(collectClaudeDirDefects(seeded(WITH_LINE, control)), control).toEqual([])
  })

  it('the corpus classes are live: the old form seeded into the sentinel of each class is reported against that file', () => {
    const retired = `${RETIRED_INLINE_EXPANSION}/skills/devflow:agent-references`
    for (const { label, sentinel } of surface()) {
      const defects = collectClaudeDirDefects(seeded(sentinel, retired))
      expect(filesOf(defects), `${label}: the old form seeded into ${sentinel} is not reported against it`).toContain(sentinel)
    }
  })

  it('the allowlist entries are scoped: removing one reports each of its files, and the prose out of its files is reported', () => {
    const corpus = wholeCorpus()
    for (const entry of ALLOWED_RULE_PROSE) {
      const without = ALLOWED_RULE_PROSE.filter(e => e.id !== entry.id)
      const reported = filesOf(collectClaudeDirDefects(corpus, without)).sort()
      expect(reported, `removing ${entry.id}`).toEqual([...entry.files].sort())
    }
    const ruleProse = allowedEntry('rule-prose')
    expect(filesOf(collectClaudeDirDefects([{ name: 'control.md', content: ruleProse.text }]))).toContain('control.md')
    expectReported(WITH_LINE, allowedEntry('compaction-rule').text, 'stray-variable')
  })

  it('the allowlist collector reports a file the corpus lacks and a text the file does not hold once', () => {
    const corpus = wholeCorpus()
    const ruleProse = allowedEntry('rule-prose')
    expect(collectAllowlistDefects(corpus, [{ ...ruleProse, files: ['dist/commands/absent.md'] }])).toEqual([`${ruleProse.id}: dist/commands/absent.md is not in the corpus`])
    expect(collectAllowlistDefects(corpus, [{ ...ruleProse, text: `${ruleProse.text} and more` }])).toHaveLength(ruleProse.files.length)
  })

  it('the site-row collector reports a surplus line, a line in an unlisted file, a drifted copy and a row whose file is gone', () => {
    expect(collectSiteRowDefects(seeded(WITH_LINE, SANCTIONED_RESOLUTION), { [WITH_LINE]: 1 })).toEqual([`${WITH_LINE}: 2 sanctioned lines, expected 1`])
    expect(collectSiteRowDefects(seeded(WITHOUT_LINE, SANCTIONED_RESOLUTION))).toContain(`${WITHOUT_LINE}: 1 sanctioned lines, expected 0`)
    const withLine = corpusFile(WITH_LINE)
    const drifted = { name: withLine.name, content: withLine.content.replace(SANCTIONED_RESOLUTION, SANCTIONED_RESOLUTION.replace('/*)', '?*)')) }
    expect(collectSiteRowDefects([drifted], { [WITH_LINE]: 1 })).toEqual([`${WITH_LINE}: 0 sanctioned lines, expected 1`])
    expect(collectSiteRowDefects(wholeCorpus().filter(f => f.name !== CURATE_FILE))).toEqual([`${CURATE_FILE}: a site row names a file that is not in the corpus`])
  })
})
