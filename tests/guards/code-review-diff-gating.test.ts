/**
 * /code-review diff-class gating and diff files (#428).
 *
 * D-DIFF-CLASS-GATE: Phase 1 classifies each worktree's diff as `code`, `docs-only`, `tests-only` or
 * `lockfile-only` (a mixed non-code diff keeps each class it holds) and a reduced class runs a reduced
 * focus set instead of the eight mandatory reviewers on every diff. The rules sit at the step that
 * applies them, because an agent follows a gate reliably only where it stands: instruction and config
 * paths are code first, then docs, tests and lockfiles, and a path that matches no class (or an empty
 * list) is code. Language and conditional triggers inside a reduced class are suppressed.
 *
 * D-DIFF-FILE-ONCE: the orchestrator writes `diff.patch` once per worktree, by redirect, and a
 * `diff-{focus}.patch` for each language focus it spawns; Review reads its file through `DIFF_FILE`
 * and runs no git itself. Every `git ... diff` in the command is the bounded `--name-only` listing
 * redirected into `paths.txt` or a redirect into a patch file, so no diff content reaches the main
 * thread; Principles 1 and 3 name those as the exceptions that print nothing.
 *
 * D-LANGUAGE-FOCUS-STAMP: the language gate is one fixed-prefix line the installer rewrites, not a
 * run-time `test -f` probe. The installer side is held by tests/installer/language-stamp*.test.ts;
 * this file holds the prompt side, in both learning variants.
 *
 * Decision 1 of the plan keeps /dynamic-build out: its sources carry none of this.
 *
 * Every arm runs through a named collector and has a known-bad probe over the same collector, so a
 * green result cannot come from a collector that finds nothing.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile, requireDistFiles, resolveAgentSource, resolveLearningOffSource } from '../helpers.js'

const CORE = ['security', 'architecture', 'performance', 'complexity', 'consistency', 'regression', 'testing', 'reliability'] as const
const LANGUAGE = ['typescript', 'react', 'accessibility', 'ui-design', 'go', 'java', 'python', 'rust'] as const
const FULL_DIFF_CONDITIONAL = ['database', 'dependencies', 'documentation', 'compliance'] as const

/** The reduced sets of plan decision 2, in the order the step lists them. */
const REDUCED_SETS: Readonly<Record<string, readonly string[]>> = {
  'docs-only': ['documentation', 'consistency', 'security'],
  'tests-only': ['testing', 'reliability', 'consistency', 'security'],
  'lockfile-only': ['dependencies', 'security'],
}

/** Pathspecs of the eight extension-triggered focuses (ticket item 2). */
const LANGUAGE_PATHSPECS: Readonly<Record<string, string>> = {
  typescript: "'*.ts' '*.tsx'",
  react: "'*.tsx' '*.jsx'",
  accessibility: "'*.tsx' '*.jsx'",
  'ui-design': "'*.tsx' '*.jsx' '*.css' '*.scss'",
  go: "'*.go'",
  java: "'*.java'",
  python: "'*.py'",
  rust: "'*.rs'",
}

const LIST_COMMAND = 'git -C "{WORKTREE_PATH}" diff --name-only --no-renames {DIFF_RANGE} > "{REVIEW_DIR}/paths.txt"'
const COUNT_COMMAND = 'wc -l < "{REVIEW_DIR}/paths.txt"'
const PATCH_COMMAND = 'git -C "{WORKTREE_PATH}" diff --no-color --no-ext-diff --no-textconv {DIFF_RANGE} > "{REVIEW_DIR}/diff.patch"'
const FOCUS_PATCH_PREFIX = 'git -C "{WORKTREE_PATH}" diff --no-color --no-ext-diff --no-textconv {DIFF_RANGE} -- '
const FOCUS_PATCH_TARGET = '> "{REVIEW_DIR}/diff-{focus}.patch"'
const STAMP_PREFIX = 'Installed language focuses: '

/** Instruction and config paths of plan decision 2: code before anything else. */
const INSTRUCTION_PATHS = [
  'CLAUDE.md', 'AGENTS.md', '.claude/', 'src/assets/', '*.mds', 'agents/', 'skills/', 'commands/',
  '.devflow/project.json', '.devflow/conventions.md',
] as const
/** Manifests and build files that a docs or lockfile pattern could otherwise swallow. */
const MANIFEST_PATHS = ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements*.txt', 'CMakeLists.txt'] as const
const DOCS_PATTERNS = ['*.md', '*.mdx', '*.rst', '*.txt', 'docs/**', 'CHANGELOG*'] as const
const TESTS_PATTERNS = ['tests/**', '**/__tests__/**', '*.test.*', '*.spec.*', '*_test.go', 'test_*.py', '*_test.py'] as const
const LOCKFILES = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'composer.lock',
] as const

// ---------------------------------------------------------------------------
// Section readers
// ---------------------------------------------------------------------------

/** The text from `start` up to (not including) `end`, or null when either anchor is absent. */
export function sectionBetween(body: string, start: string, end: string | null): string | null {
  const from = body.indexOf(start)
  if (from === -1) return null
  if (end === null) return body.slice(from)
  const to = body.indexOf(end, from + start.length)
  return to === -1 ? null : body.slice(from, to)
}

const phase1 = (body: string): string | null => sectionBetween(body, '### Phase 1: Analyze Changed Files', '### Phase 1b:')
const phase2 = (body: string): string | null => sectionBetween(body, '### Phase 2: Run Reviews', '### Phase 3:')
const step = (body: string, n: '1.1' | '1.2' | '1.3'): string | null => {
  const next = n === '1.1' ? '#### Step 1.2:' : n === '1.2' ? '#### Step 1.3:' : '### Phase 1b:'
  const all = phase1(body)
  return all === null ? null : sectionBetween(all + '### Phase 1b:', `#### Step ${n}:`, next)
}
const principles = (body: string): string | null => sectionBetween(body, '## Principles', null)

/** Table rows of a section, as trimmed cells, separator rows dropped. */
export function tableRows(section: string): string[][] {
  return section.split('\n')
    .filter(line => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
}

/** Every fenced code line of a section. */
export function fencedLines(section: string): string[] {
  const out: string[] = []
  let inside = false
  for (const line of section.split('\n')) {
    if (/^```/.test(line)) { inside = !inside; continue }
    if (inside) out.push(line)
  }
  return out
}

const hasAll = (text: string, needles: readonly string[]): string[] => needles.filter(n => !text.includes(n))

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

/** AC-301, AC-302, AC-303, AC-304, AC-306, AC-325: the classification step. */
export function collectClassifyDefects(body: string): string[] {
  const s = step(body, '1.1')
  if (s === null) return ['no Step 1.1 (Classify the diff) in Phase 1']
  const out: string[] = []
  const lines = fencedLines(s)
  if (!lines.includes(LIST_COMMAND)) out.push('the listing command is not the name-only, no-renames redirect into paths.txt')
  if (!lines.includes(COUNT_COMMAND)) out.push('the step does not print the line count with wc -l')
  if (!/in ranges of about 40 lines/.test(s) || !/once when the count is about 40 or fewer/.test(s)) out.push('the ranged-read rule (about 40 lines) is missing')
  if (!/drop `-C "\{WORKTREE_PATH\}"` when there is no `WORKTREE_PATH`/.test(s)) out.push('the no-WORKTREE_PATH form of the listing is not stated')
  for (const cls of ['code', 'docs-only', 'tests-only', 'lockfile-only']) {
    if (!s.includes(`\`${cls}\``)) out.push(`class ${cls} is not named at the step`)
  }
  // The rules, in order: instruction/config, docs, tests, lockfile, mixed, fail-safe.
  const rule = (n: number): string => {
    const m = new RegExp(`^${n}\\. [^\\n]*`, 'm').exec(s)
    return m === null ? '' : m[0]
  }
  const rules = [1, 2, 3, 4, 5, 6].map(rule)
  rules.forEach((r, i) => { if (r === '') out.push(`rule ${i + 1} is missing`) })
  const first = rules[0]
  for (const p of hasAll(first, [...INSTRUCTION_PATHS, ...MANIFEST_PATHS])) out.push(`rule 1 does not name ${p}`)
  if (!/never `docs-only`/.test(first)) out.push('rule 1 does not say a diff of only instruction files is never docs-only')
  if (!/^2\. \*\*`docs-only`/.test(rules[1])) out.push('rule 2 is not the docs-only rule')
  for (const p of hasAll(rules[1], DOCS_PATTERNS)) out.push(`the docs rule does not name ${p}`)
  if (!/^3\. \*\*`tests-only`/.test(rules[2])) out.push('rule 3 is not the tests-only rule')
  for (const p of hasAll(rules[2], TESTS_PATTERNS)) out.push(`the tests rule does not name ${p}`)
  if (!/^4\. \*\*`lockfile-only`/.test(rules[3])) out.push('rule 4 is not the lockfile-only rule')
  for (const p of hasAll(rules[3], LOCKFILES)) out.push(`the lockfile rule does not name ${p}`)
  if (!/^5\. \*\*Mixed non-code/.test(rules[4])) out.push('rule 5 is not the mixed non-code rule')
  if (!/^6\. \*\*Fail-safe/.test(rules[5]) || !/matches no class pattern/.test(rules[5]) || !/empty path list/.test(rules[5])) {
    out.push('rule 6 does not state both fail-safes (no class pattern, empty path list)')
  }
  if (!/manifest change is `code`/.test(rules[5])) out.push('rule 6 does not say a manifest change is code')
  // Reduced sets, exactly.
  for (const [cls, focuses] of Object.entries(REDUCED_SETS)) {
    const m = new RegExp(`^- \`${cls}\`: ([^\\n]+)$`, 'm').exec(s)
    if (m === null) { out.push(`no reduced set line for ${cls}`); continue }
    const got = m[1].split(', ').map(x => x.trim())
    if (got.join(',') !== focuses.join(',')) out.push(`${cls} set is "${got.join(', ')}", expected "${focuses.join(', ')}"`)
  }
  if (!/union of the sets of the classes it holds/.test(s)) out.push('the mixed-diff union rule is missing')
  if (!/language and conditional triggers inside a reduced class are suppressed/i.test(s)) out.push('the suppression of triggers inside a reduced class is not stated')
  if (!/every member reading `diff\.patch`/.test(s)) out.push('reduced-class members are not told to read diff.patch')
  // The order of the rules in the text: instruction/config strictly before docs.
  if (s.indexOf(rules[0]) > s.indexOf(rules[1])) out.push('the instruction/config rule does not come before the docs rule')
  return out
}

/** AC-312, AC-318: the focus choice and the stamp gate. */
export function collectFocusDefects(body: string): string[] {
  const s = step(body, '1.2')
  if (s === null) return ['no Step 1.2 (Choose the focuses) in Phase 1']
  const out: string[] = []
  if (!/When `DIFF_CLASS` is `code`/.test(s)) out.push('Step 1.2 is not scoped to the code class')
  const stampLines = s.split('\n').filter(l => l.startsWith(STAMP_PREFIX))
  if (stampLines.length !== 1) out.push(`${stampLines.length} stamp lines in Step 1.2, expected 1`)
  const para = /\*\*Language focus stamp\.\*\* The eight language focuses — ([^\n]*?) — ship with/.exec(s)
  if (para === null) out.push('the Language focus stamp paragraph is missing')
  else {
    const named = [...para[1].matchAll(/`([\w-]+)`/g)].map(m => m[1])
    if (named.join(',') !== LANGUAGE.join(',')) out.push(`the paragraph names "${named.join(', ')}", expected the eight language focuses in order`)
  }
  if (!/spawned only when its file-type condition above fires AND its name appears in that stamped line/.test(s)) {
    out.push('a language focus is not gated on both its trigger and the stamp')
  }
  if (!/missing from the line is never spawned, even when its trigger fires/.test(s)) out.push('a focus missing from the stamp is not said to be never spawned')
  if (/test -f/.test(s)) out.push('Step 1.2 still probes with test -f')
  for (const focus of LANGUAGE) {
    if (!s.includes(`| ${focus} |`)) out.push(`the trigger table has no ${focus} row`)
  }
  return out
}

/** AC-307, AC-321: the diff files. */
export function collectDiffFileDefects(body: string): string[] {
  const s = step(body, '1.3')
  if (s === null) return ['no Step 1.3 (Write the diff files) in Phase 1']
  const out: string[] = []
  const lines = fencedLines(s)
  if (!lines.includes(PATCH_COMMAND)) out.push('diff.patch is not written by the quoted redirect command')
  const focusLine = lines.find(l => l.startsWith(FOCUS_PATCH_PREFIX))
  if (focusLine === undefined) out.push('no per-focus patch command with quoted pathspecs')
  else if (!focusLine.endsWith(FOCUS_PATCH_TARGET)) out.push(`the per-focus patch is not redirected to ${FOCUS_PATCH_TARGET}`)
  if (!/once per worktree, by redirect/.test(s)) out.push('diff.patch is not said to be written once per worktree by redirect')
  const rows = new Map(tableRows(s).map(r => [r[0], r[1]]))
  const spec = (focuses: string): string | undefined => rows.get(focuses)
  const expectRow = (label: string, focuses: readonly string[]): void => {
    const cell = spec(label)
    if (cell === undefined) { out.push(`no pathspec row for ${label}`); return }
    const want = LANGUAGE_PATHSPECS[focuses[0]]
    if (cell !== `\`${want}\``) out.push(`${label} pathspecs are ${cell}, expected \`${want}\``)
  }
  expectRow('typescript', ['typescript'])
  expectRow('react, accessibility', ['react'])
  expectRow('ui-design', ['ui-design'])
  for (const f of ['go', 'java', 'python', 'rust']) expectRow(f, [f])
  for (const focus of FULL_DIFF_CONDITIONAL) {
    if (rows.has(focus) || s.includes(`diff-${focus}.patch`)) out.push(`${focus} must read the full diff.patch, not a per-focus patch`)
  }
  if (!/read `diff\.patch`/.test(s)) out.push('the full-diff readers are not stated')
  if (!/never committed, posted or passed to the Git agent/.test(s)) out.push('the diff files are not said to stay local (never committed, posted or passed to the Git agent)')
  if (!/gitignored `\.devflow\/` tree/.test(s)) out.push('the diff files are not placed under the gitignored .devflow tree')
  return out
}

/** AC-305, AC-308, AC-319: the Phase 2 table and spawn block. */
export function collectPhase2Defects(body: string): string[] {
  const s = phase2(body)
  if (s === null) return ['no Phase 2 section']
  const out: string[] = []
  const rows = new Map(tableRows(s).filter(r => r.length === 4).map(r => [r[0], r]))
  for (const focus of CORE) {
    const r = rows.get(focus)
    if (r === undefined) { out.push(`no ${focus} row`); continue }
    if (r[3] !== 'diff.patch') out.push(`mandatory focus ${focus} is given ${r[3]}, not diff.patch`)
    if (r[1] !== '✓') out.push(`mandatory focus ${focus} is marked ${r[1]}, not ✓`)
  }
  for (const focus of LANGUAGE) {
    const r = rows.get(focus)
    if (r === undefined) { out.push(`no ${focus} row`); continue }
    if (r[3] !== `diff-${focus}.patch`) out.push(`language focus ${focus} is given ${r[3]}`)
    if (r[1] !== 'stamp-gated') out.push(`language focus ${focus} is marked ${r[1]}, not stamp-gated`)
  }
  for (const focus of FULL_DIFF_CONDITIONAL) {
    const r = rows.get(focus)
    if (r === undefined) { out.push(`no ${focus} row`); continue }
    if (r[3] !== 'diff.patch') out.push(`conditional focus ${focus} is given ${r[3]}, not the full diff.patch`)
  }
  const fences = [...s.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1])
  const spawn = fences.find(f => f.includes('Agent(subagent_type="Review"'))
  if (spawn === undefined) return [...out, 'no Review spawn block']
  if (!/^DIFF_FILE: \{diff_file\}/m.test(spawn)) out.push('the Review spawn does not declare DIFF_FILE')
  if (!/^DIFF_RANGE: \{DIFF_RANGE\}/m.test(spawn)) out.push('the Review spawn does not declare DIFF_RANGE')
  if (/DIFF_COMMAND/.test(s)) out.push('Phase 2 still names DIFF_COMMAND')
  if (/diff-\{focus\}\.patch/.test(spawn) === false) out.push('the spawn block does not show the per-focus path form')
  if (!/absolute/.test(spawn)) out.push('the spawn block does not say DIFF_FILE is an absolute path')
  // The class text at the step that spawns.
  for (const [cls, focuses] of Object.entries(REDUCED_SETS)) {
    if (!s.includes(`\`${cls}\``)) out.push(`Phase 2 does not name ${cls}`)
    void focuses
  }
  if (!/union/.test(s)) out.push('Phase 2 does not state the union for a mixed diff')
  if (!/No language or conditional focus is spawned/.test(s)) out.push('Phase 2 does not state the suppression in a reduced class')
  if (/Always run 8 core reviews/.test(s)) out.push('Phase 2 still says "Always run 8 core reviews"')
  if (!/Requires:\*\* [^\n]*DIFF_CLASS, DIFF_FILES/.test(s)) out.push('Phase 2 Requires does not list DIFF_CLASS and DIFF_FILES')
  return out
}

/**
 * AC-320: every `git ... diff` command is the bounded listing or a redirect into a patch file.
 *
 * A command is a line that starts with `git` and names diff, or an inline code span that does; prose that
 * merely mentions git and a diff (Principle 1, the rebase edge case) is not a command. Quoted pathspecs may
 * hold `<` and `>`, so single-quoted segments are skipped before the redirect is checked.
 */
export function collectGitDiffDefects(body: string): string[] {
  const out: string[] = []
  const redirectedPatch = /^git (?:-C "\{WORKTREE_PATH\}" )?diff (?:[^|;&<>'"]|'[^']*')*> "\{REVIEW_DIR\}\/diff(?:-\{focus\})?\.patch"$/
  body.split('\n').forEach((line, i) => {
    const commandLine = /^\s*git\b[^\n]*\bdiff\b/.test(line)
    const inlineSpan = /`[^`\n]*\bgit\b[^`\n]*\bdiff\b[^`\n]*`/.test(line)
    if (!commandLine && !inlineSpan) return
    if (line === LIST_COMMAND) return
    if (redirectedPatch.test(line)) return
    out.push(`line ${i + 1}: ${line.trim().slice(0, 140)}`)
  })
  return out
}

/** AC-320, AC-326: Principles 1 and 3 name the exceptions that print nothing. */
export function collectPrincipleDefects(body: string): string[] {
  const s = principles(body)
  if (s === null) return ['no Principles section']
  const out: string[] = []
  const line = (n: number): string => (new RegExp(`^${n}\\. [^\\n]*`, 'm').exec(s) ?? [''])[0]
  for (const n of [1, 3]) {
    const p = line(n)
    if (p === '') { out.push(`principle ${n} is missing`); continue }
    if (!/redirect-only/.test(p) || !/print nothing/.test(p)) out.push(`principle ${n} does not say redirect-only writes print nothing`)
  }
  const p1 = line(1)
  for (const probe of ['git worktree list', 'branch --show-current', 'cat-file -t']) {
    if (!p1.includes(probe)) out.push(`principle 1 does not name the Phase 0 probe ${probe}`)
  }
  if (!/bounded Phase 1 path listing/.test(p1)) out.push('principle 1 does not name the bounded path listing')
  if (!/`diff\.patch`/.test(p1) || !/`diff-\{focus\}\.patch`/.test(p1)) out.push('principle 1 does not name the patch writes')
  if (!/exceptions? named in Principle 1/.test(line(3))) out.push('principle 3 does not point at the exceptions of Principle 1')
  return out
}

/** AC-317: no probe of installed skills, no DIFF_COMMAND in the Review spawn, and a positive control. */
export function collectProbeDefects(files: ReadonlyArray<{ name: string; content: string }>): string[] {
  const out: string[] = []
  for (const { name, content } of files) {
    if (/test -f [^\n]*skills\/devflow:/.test(content)) out.push(`${name}: probes skills/devflow:{focus}/SKILL.md with test -f`)
    if (name.endsWith('code-review.md')) {
      if (/\{claude_dir\}/.test(content)) out.push(`${name}: still carries a {claude_dir} placeholder`)
      if (/DIFF_COMMAND/.test(content)) out.push(`${name}: the Review spawn still carries DIFF_COMMAND`)
      if (!/^DIFF_FILE: /m.test(content)) out.push(`${name}: positive control failed, no DIFF_FILE line`)
    }
  }
  return out
}

/** The stamp line itself: one per variant, a fixed prefix, no braces, outside any learning arm. */
export function collectStampLineDefects(body: string): string[] {
  const lines = body.split('\n').filter(l => l.startsWith(STAMP_PREFIX))
  const out: string[] = []
  if (lines.length !== 1) out.push(`${lines.length} lines start with the stamp prefix, expected 1`)
  for (const l of lines) {
    if (/[{}]/.test(l)) out.push('the stamp line carries braces')
    if (l !== `${STAMP_PREFIX}(none)`) out.push(`the shipped stamp line is "${l}", expected the (none) default`)
  }
  return out
}

/** Edge Cases rows and the Architecture tree. */
export function collectDocsOfBehaviourDefects(body: string): string[] {
  const out: string[] = []
  const edge = sectionBetween(body, '## Edge Cases', '## Backwards Compatibility')
  if (edge === null) return ['no Edge Cases section']
  const rows = tableRows(edge).map(r => r.join(' | '))
  const need: ReadonlyArray<readonly [string, RegExp]> = [
    ['a docs-only row', /^Docs-only diff/],
    ['a tests-only row', /^Tests-only diff/],
    ['a lockfile-only row', /^Lockfile-only diff/],
    ['a mixed non-code row', /^Mixed non-code diff/],
    ['a fail-safe row', /^A path matching no class pattern, or an empty path list/],
    ['a moved-file row', /^A file moved across classes/],
    ['a long path listing row', /^Path listing above about 40 lines/],
    ['a language file with no installed plugin row', /^Language files changed, plugin not installed/],
  ]
  for (const [label, re] of need) if (!rows.some(r => re.test(r))) out.push(`Edge Cases has no ${label}`)
  const tree = sectionBetween(body, '## Architecture', '## Edge Cases')
  if (tree === null) return [...out, 'no Architecture section']
  if (!/Classify the diff/.test(tree)) out.push('the Architecture tree does not show the classification')
  if (!/docs-only \/ tests-only \/ lockfile-only/.test(tree)) out.push('the Architecture tree does not show the reduced classes')
  if (!/diff\.patch/.test(tree)) out.push('the Architecture tree does not show the diff files')
  return out
}

/** AC-308: review.md's Input, Responsibilities 3 and 9. */
export function collectReviewAgentDefects(review: string): string[] {
  const out: string[] = []
  if (/DIFF_COMMAND/.test(review)) out.push('review.md still declares DIFF_COMMAND')
  const file = /^- \*\*DIFF_FILE\*\* \(optional\): [^\n]*$/m.exec(review)
  if (file === null) out.push('review.md Input does not declare DIFF_FILE')
  else {
    if (!/absolute path/i.test(file[0])) out.push('DIFF_FILE is not described as an absolute path')
    if (!/Page a `DIFF_FILE` larger than one Read with offset\/limit\./.test(file[0])) out.push('the paging sentence for a large DIFF_FILE is missing')
    if (!file[0].includes('`git diff {base_branch}...HEAD`')) out.push('the default git diff fallback is missing from the DIFF_FILE bullet')
  }
  const range = /^- \*\*DIFF_RANGE\*\* \(optional\): [^\n]*$/m.exec(review)
  if (range === null) out.push('review.md Input does not declare DIFF_RANGE')
  else if (!/information only/.test(range[0])) out.push('DIFF_RANGE is not marked information only')
  const identify = review.match(/^\d+\. \*\*Identify changed lines\*\*[^\n]*$/gm) ?? []
  if (identify.length === 0) out.push('no Identify changed lines responsibility')
  for (const line of identify) if (!line.includes('`DIFF_FILE`')) out.push(`Identify changed lines does not read DIFF_FILE: ${line.slice(0, 60)}`)
  const verify = /Self-verify findings[\s\S]*?finding at original confidence\./.exec(review)
  if (verify === null) out.push('no Self-verify responsibility')
  else {
    if (!/ranged read of 30 lines either side/.test(verify[0])) out.push('Responsibility 9 does not require a ranged read of 30 lines either side')
    if (!/never the whole file/.test(verify[0])) out.push('Responsibility 9 does not forbid a whole-file read')
    if (!/already visible in the diff output, skip the Read/.test(verify[0])) out.push('Responsibility 9 lost the skip-when-visible rule')
  }
  return out
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const VARIANTS: ReadonlyArray<{ label: string; body: string }> = (() => {
  const off = resolveLearningOffSource('commands', 'code-review')
  if (off === null) throw new Error('dist/learning-off/commands/code-review.md is absent: run `npm run build:mds`')
  return [
    { label: 'learning on', body: requireDistFile('code-review.md') },
    { label: 'learning off', body: off },
  ]
})()

const REVIEW_VARIANTS: ReadonlyArray<{ label: string; body: string }> = (() => {
  const off = resolveLearningOffSource('agents', 'review')
  if (off === null) throw new Error('dist/learning-off/agents/review.md is absent: run `npm run build:mds`')
  return [
    { label: 'learning on', body: resolveAgentSource('review').content },
    { label: 'learning off', body: off },
  ]
})()

const ON = VARIANTS[0].body

/** Replace `from` with `to` in `body`, failing the test when the seed did not land. */
function seed(body: string, from: string | RegExp, to: string): string {
  const next = body.replace(from, to)
  expect(next, `the seed ${String(from)} must change the text`).not.toBe(body)
  return next
}

describe('the corpus is real', () => {
  it('reads both variants of the command and the agent, with the gate text in them', () => {
    for (const { label, body } of [...VARIANTS, ...REVIEW_VARIANTS]) {
      expect(body.length, `${label}: nothing read`).toBeGreaterThan(5000)
    }
    for (const { label, body } of VARIANTS) {
      expect(phase1(body), `${label}: Phase 1`).not.toBeNull()
      expect(phase2(body), `${label}: Phase 2`).not.toBeNull()
      expect(principles(body), `${label}: Principles`).not.toBeNull()
    }
  })
})

describe('Phase 1 classifies the diff at the step that applies the rules (AC-301..AC-304, AC-306, AC-325)', () => {
  it.each(VARIANTS)('$label: the classification step is complete', ({ body }) => {
    expect(collectClassifyDefects(body)).toEqual([])
  })

  it('known-bad probes: a rule moved, a class lost, a fail-safe dropped and a reduced set changed are each reported', () => {
    expect(collectClassifyDefects(seed(ON, 'wc -l < "{REVIEW_DIR}/paths.txt"', 'cat "{REVIEW_DIR}/paths.txt"')))
      .toContain('the step does not print the line count with wc -l')
    expect(collectClassifyDefects(seed(ON, '--no-renames {DIFF_RANGE} > "{REVIEW_DIR}/paths.txt"', '{DIFF_RANGE} > "{REVIEW_DIR}/paths.txt"')))
      .toContain('the listing command is not the name-only, no-renames redirect into paths.txt')
    expect(collectClassifyDefects(seed(ON, 'in ranges of about 40 lines', 'in one read')))
      .toContain('the ranged-read rule (about 40 lines) is missing')
    expect(collectClassifyDefects(seed(ON, 'and so does an empty path list', 'and so does a short list')))
      .toContain('rule 6 does not state both fail-safes (no class pattern, empty path list)')
    expect(collectClassifyDefects(seed(ON, '- `docs-only`: documentation, consistency, security', '- `docs-only`: documentation, consistency')))
      .toContain('docs-only set is "documentation, consistency", expected "documentation, consistency, security"')
    expect(collectClassifyDefects(seed(ON, '- `tests-only`: testing, reliability, consistency, security', '- `tests-only`: testing, consistency, security')))
      .toContain('tests-only set is "testing, consistency, security", expected "testing, reliability, consistency, security"')
    expect(collectClassifyDefects(seed(ON, '- `lockfile-only`: dependencies, security', '- `lockfile-only`: dependencies')))
      .toContain('lockfile-only set is "dependencies", expected "dependencies, security"')
    expect(collectClassifyDefects(seed(ON, 'union of the sets of the classes it holds', 'first set of the classes it holds')))
      .toContain('the mixed-diff union rule is missing')
    expect(collectClassifyDefects(seed(ON, /Language and conditional triggers inside a reduced class are suppressed/, 'Language and conditional triggers inside a reduced class are added')))
      .toContain('the suppression of triggers inside a reduced class is not stated')
  })

  it('known-bad probe: putting the docs rule ahead of the instruction/config rule is reported as an order defect', () => {
    const s = step(ON, '1.1') as string
    const r1 = /^1\. [^\n]*$/m.exec(s)![0]
    const r2 = /^2\. [^\n]*$/m.exec(s)![0]
    const swapped = ON.replace(r1, () => '@@A@@').replace(r2, () => r1.replace(/^1\./, '2.')).replace('@@A@@', () => r2.replace(/^2\./, '1.'))
    expect(swapped).not.toBe(ON)
    const defects = collectClassifyDefects(swapped)
    expect(defects).toContain('rule 2 is not the docs-only rule')
    expect(defects).toContain('rule 1 does not name CLAUDE.md')
  })

  it('the classification names CLAUDE.md, the claude directory, and the agent, skill and command sources as code', () => {
    const s = step(ON, '1.1') as string
    const rule1 = /^1\. [^\n]*$/m.exec(s)![0]
    for (const p of ['CLAUDE.md', '.claude/', 'src/assets/', '*.mds', 'agents/', 'skills/', 'commands/']) expect(rule1).toContain(p)
  })
})

describe('Phase 1 chooses focuses by trigger AND stamp (AC-312, AC-318)', () => {
  it.each(VARIANTS)('$label: the stamp gate is stated at the step', ({ body }) => {
    expect(collectFocusDefects(body)).toEqual([])
  })

  it('known-bad probes: a trigger-only spawn, a probe, a shortened list and a second stamp line are each reported', () => {
    expect(collectFocusDefects(seed(ON, 'AND its name appears in that stamped line', 'whatever the stamped line holds')))
      .toContain('a language focus is not gated on both its trigger and the stamp')
    expect(collectFocusDefects(seed(ON, 'is never spawned, even when its trigger fires', 'may be spawned')))
      .toContain('a focus missing from the stamp is not said to be never spawned')
    expect(collectFocusDefects(seed(ON, '`java`, `python`, `rust` — ship with', '`java`, `python` — ship with')).join('\n'))
      .toMatch(/the paragraph names/)
    expect(collectFocusDefects(seed(ON, 'A language focus is spawned only', 'Run test -f "$d/skills/devflow:{focus}/SKILL.md" first. A language focus is spawned only')))
      .toContain('Step 1.2 still probes with test -f')
    expect(collectFocusDefects(seed(ON, 'A language focus is spawned only', `${STAMP_PREFIX}go\n\nA language focus is spawned only`)))
      .toContain('2 stamp lines in Step 1.2, expected 1')
  })

  it('the stamp line is one per variant, braces-free, the (none) default, and outside any learning arm', () => {
    for (const { label, body } of VARIANTS) {
      expect(collectStampLineDefects(body), label).toEqual([])
    }
    expect(collectStampLineDefects(seed(ON, `${STAMP_PREFIX}(none)`, `${STAMP_PREFIX}{typescript}`)).join('\n')).toMatch(/braces/)
    expect(collectStampLineDefects(seed(ON, `${STAMP_PREFIX}(none)`, `${STAMP_PREFIX}go`)).join('\n')).toMatch(/\(none\) default/)
    expect(collectStampLineDefects(ON.replace(`${STAMP_PREFIX}(none)\n`, ''))).toContain('0 lines start with the stamp prefix, expected 1')
  })

  it('no compiled command probes for installed skills with test -f (positive control: the DIFF_FILE line exists)', () => {
    const commands = requireDistFiles().map(name => ({ name: `dist/commands/${name}`, content: requireDistFile(name) }))
    expect(commands.length, 'the corpus is the command set').toBeGreaterThanOrEqual(14)
    expect(commands.map(c => c.name)).toContain('dist/commands/code-review.md')
    for (const { label, body } of VARIANTS) {
      expect(collectProbeDefects([{ name: `${label}/code-review.md`, content: body }]), label).toEqual([])
    }
    expect(collectProbeDefects(commands.filter(c => !c.name.endsWith('code-review.md')))).toEqual([])
  })

  it('known-bad probes: a seeded test -f probe, a DIFF_COMMAND spawn line and a missing DIFF_FILE are each reported', () => {
    const probe = `${ON}\nd="$HOME/.claude"; test -f "$d/skills/devflow:{focus}/SKILL.md"; echo "exit=$?"\n`
    expect(collectProbeDefects([{ name: 'dist/commands/code-review.md', content: probe }]).join('\n')).toMatch(/probes skills\/devflow/)
    const command = seed(ON, /^DIFF_FILE: .*$/m, 'DIFF_COMMAND: git -C {WORKTREE_PATH} diff {DIFF_RANGE}')
    const defects = collectProbeDefects([{ name: 'dist/commands/code-review.md', content: command }]).join('\n')
    expect(defects).toMatch(/still carries DIFF_COMMAND/)
    expect(defects).toMatch(/positive control failed, no DIFF_FILE line/)
    expect(collectProbeDefects([{ name: 'dist/commands/code-review.md', content: `${ON}\nfocus dir {claude_dir}/skills\n` }]).join('\n'))
      .toMatch(/\{claude_dir\}/)
  })
})

describe('Phase 1 writes the diff files once, by redirect (AC-307, AC-321)', () => {
  it.each(VARIANTS)('$label: diff.patch and the per-focus patches', ({ body }) => {
    expect(collectDiffFileDefects(body)).toEqual([])
  })

  it('known-bad probes: a changed pathspec, a filtered conditional focus and an unredirected patch are each reported', () => {
    expect(collectDiffFileDefects(seed(ON, "| typescript | `'*.ts' '*.tsx'` |", "| typescript | `'*.ts'` |")).join('\n')).toMatch(/typescript pathspecs/)
    expect(collectDiffFileDefects(seed(ON, "| rust | `'*.rs'` |", "| rust | `'*.rs' '*.toml'` |")).join('\n')).toMatch(/rust pathspecs/)
    expect(collectDiffFileDefects(seed(ON, "| ui-design | `'*.tsx' '*.jsx' '*.css' '*.scss'` |", "| ui-design | `'*.css' '*.scss'` |")).join('\n')).toMatch(/ui-design pathspecs/)
    expect(collectDiffFileDefects(seed(ON, "| rust | `'*.rs'` |", "| rust | `'*.rs'` |\n| database | `'*.sql'` |")))
      .toContain('database must read the full diff.patch, not a per-focus patch')
    expect(collectDiffFileDefects(seed(ON, /(--no-textconv \{DIFF_RANGE\}) > "\{REVIEW_DIR\}\/diff\.patch"/, '$1')))
      .toContain('diff.patch is not written by the quoted redirect command')
    expect(collectDiffFileDefects(seed(ON, 'never committed, posted or passed to the Git agent', 'committed with the review')))
      .toContain('the diff files are not said to stay local (never committed, posted or passed to the Git agent)')
  })

  it('patch files use the .patch extension and no Git-agent or Synthesize spawn carries one', () => {
    for (const { label, body } of VARIANTS) {
      const spawns = [...body.matchAll(/```\n(Agent\(subagent_type="(Git|Synthesize)"[\s\S]*?)```/g)]
      expect(spawns.length, `${label}: Git and Synthesize spawns found`).toBeGreaterThanOrEqual(3)
      for (const [, block, kind] of spawns) {
        expect(block, `${label}: ${kind} spawn`).not.toMatch(/paths\.txt|\.patch|DIFF_FILE|DIFF_RANGE/)
      }
      const fileNames = [...body.matchAll(/diff(?:-[\w{}-]+)?\.(\w+)"/g)].map(m => m[1])
      expect(fileNames.length, `${label}: patch targets found`).toBeGreaterThan(1)
      expect(new Set(fileNames)).toEqual(new Set(['patch']))
    }
  })

  it('the Synthesize and resolve review globs are *.md, so they match neither paths.txt nor a patch', () => {
    const synthesize = resolveAgentSource('synthesize').content
    expect(synthesize).toContain('${REVIEW_BASE_DIR}/*.md')
    const resolve = readFileSync(path.join(ROOT, 'src/assets/commands/resolve.mds'), 'utf-8')
    expect(resolve).toContain('{TARGET_DIR}/*.md')
    for (const glob of [synthesize.match(/\$\{REVIEW_BASE_DIR\}\/(\S+?)`/)?.[1], resolve.match(/\{TARGET_DIR\}\/(\S+?)`/)?.[1]]) {
      expect(glob).toBe('*.md')
      expect('paths.txt'.endsWith('.md')).toBe(false)
      expect('diff.patch'.endsWith('.md')).toBe(false)
      expect('diff-typescript.patch'.endsWith('.md')).toBe(false)
    }
  })
})

describe('Phase 2 spawns the focus set DIFF_CLASS selects, each with its DIFF_FILE (AC-305, AC-308, AC-319)', () => {
  it.each(VARIANTS)('$label: the table and the spawn block', ({ body }) => {
    expect(collectPhase2Defects(body)).toEqual([])
  })

  it('known-bad probes: a mandatory focus on a filtered patch, a trigger-only language row and a DIFF_COMMAND spawn are each reported', () => {
    expect(collectPhase2Defects(seed(ON, '| security | ✓ | devflow:security | diff.patch |', '| security | ✓ | devflow:security | diff-security.patch |')))
      .toContain('mandatory focus security is given diff-security.patch, not diff.patch')
    expect(collectPhase2Defects(seed(ON, '| reliability | ✓ | devflow:reliability | diff.patch |', '| reliability | ✓ | devflow:reliability | diff-reliability.patch |')))
      .toContain('mandatory focus reliability is given diff-reliability.patch, not diff.patch')
    expect(collectPhase2Defects(seed(ON, '| go | stamp-gated | devflow:go | diff-go.patch |', '| go | conditional | devflow:go | diff-go.patch |')))
      .toContain('language focus go is marked conditional, not stamp-gated')
    expect(collectPhase2Defects(seed(ON, '| database | conditional | devflow:database | diff.patch |', '| database | conditional | devflow:database | diff-database.patch |')))
      .toContain('conditional focus database is given diff-database.patch, not the full diff.patch')
    expect(collectPhase2Defects(seed(ON, /^DIFF_FILE: .*$/m, 'DIFF_COMMAND: git -C {WORKTREE_PATH} diff {DIFF_RANGE}')))
      .toContain('the Review spawn does not declare DIFF_FILE')
    expect(collectPhase2Defects(seed(ON, /^DIFF_RANGE: .*$/m, '')))
      .toContain('the Review spawn does not declare DIFF_RANGE')
    expect(collectPhase2Defects(seed(ON, 'No language or conditional focus is spawned', 'Language and conditional focuses are spawned')))
      .toContain('Phase 2 does not state the suppression in a reduced class')
  })

  it('on a code diff the eight mandatory focuses are exactly the table rows marked ✓, all on diff.patch', () => {
    const rows = tableRows(phase2(ON) as string).filter(r => r.length === 4)
    const core = rows.filter(r => r[1] === '✓')
    expect(core.map(r => r[0])).toEqual([...CORE])
    expect(core.every(r => r[3] === 'diff.patch')).toBe(true)
    expect(rows.filter(r => r[1] === 'stamp-gated').map(r => r[0])).toEqual([...LANGUAGE])
  })

  it('Phase 2 no longer assumes "always 8", and its Requires lists the new state in both variants', () => {
    for (const { label, body } of VARIANTS) {
      expect(body, label).not.toContain('Always run 8 core reviews')
      expect(body, label).not.toContain('8 always-active')
      expect(phase2(body) as string, label).toMatch(/\*\*Requires:\*\* DIFF_RANGE, REVIEW_DIR, TIMESTAMP, [^\n]*DIFF_CLASS, DIFF_FILES/)
    }
  })

  it('the Review spawn inputs and review.md Input agree: DIFF_FILE and DIFF_RANGE are passed and declared', () => {
    for (const { label, body } of REVIEW_VARIANTS) {
      const spawn = (phase2(ON) as string).match(/```\n(Agent\(subagent_type="Review"[\s\S]*?)```/)![1]
      for (const input of ['DIFF_FILE', 'DIFF_RANGE']) {
        expect(spawn, `${label}: spawn passes ${input}`).toContain(`${input}:`)
        expect(body, `${label}: review.md declares ${input}`).toContain(`**${input}**`)
      }
    }
  })
})

describe('review.md reads DIFF_FILE and verifies with ranged reads (AC-308)', () => {
  it.each(REVIEW_VARIANTS)('$label: Input, Responsibility 3 and Responsibility 9', ({ body }) => {
    expect(collectReviewAgentDefects(body)).toEqual([])
  })

  it('known-bad probes: DIFF_COMMAND back, no paging sentence, a whole-file read and a lost fallback are each reported', () => {
    const review = REVIEW_VARIANTS[0].body
    expect(collectReviewAgentDefects(`${review}\n- **DIFF_COMMAND** (optional): x\n`)).toContain('review.md still declares DIFF_COMMAND')
    expect(collectReviewAgentDefects(seed(review, 'Page a `DIFF_FILE` larger than one Read with offset/limit. ', '')))
      .toContain('the paging sentence for a large DIFF_FILE is missing')
    expect(collectReviewAgentDefects(seed(review, 'ranged read of 30 lines either side', 'read of the whole file')))
      .toContain('Responsibility 9 does not require a ranged read of 30 lines either side')
    expect(collectReviewAgentDefects(seed(review, ' If not provided, default to `git diff {base_branch}...HEAD`.', '')))
      .toContain('the default git diff fallback is missing from the DIFF_FILE bullet')
    expect(collectReviewAgentDefects(seed(review, /\*\*Identify changed lines\*\* - Read the diff from `DIFF_FILE`/, '**Identify changed lines** - Read the diff from the base')).join('\n'))
      .toMatch(/Identify changed lines does not read DIFF_FILE/)
  })

  it('the DIFF_COMMAND of /bug-analysis (a Diagnose input) is untouched', () => {
    expect(resolveAgentSource('diagnose').content).toContain('**DIFF_COMMAND**')
    expect(readFileSync(path.join(ROOT, 'src/assets/commands/bug-analysis.mds'), 'utf-8')).toContain('DIFF_COMMAND: git diff {DIFF_RANGE}')
  })
})

describe('the main thread never prints or reads diff contents (AC-320, AC-326)', () => {
  it.each(VARIANTS)('$label: every git ... diff is the bounded listing or a redirect into a patch file', ({ body }) => {
    expect(collectGitDiffDefects(body)).toEqual([])
    // Non-vacuity: the three allowed forms are present.
    expect(body).toContain(LIST_COMMAND)
    expect(body).toContain(PATCH_COMMAND)
    expect(body.split('\n').some(l => l.startsWith(FOCUS_PATCH_PREFIX) && l.endsWith(FOCUS_PATCH_TARGET))).toBe(true)
  })

  it('known-bad probes: a bare diff, a piped diff, an unquoted target and a diff to another file are each reported', () => {
    expect(collectGitDiffDefects(`${ON}\ngit -C "{WORKTREE_PATH}" diff {DIFF_RANGE}\n`)).toHaveLength(1)
    expect(collectGitDiffDefects(`${ON}\ngit -C "{WORKTREE_PATH}" diff {DIFF_RANGE} | head -200\n`)).toHaveLength(1)
    expect(collectGitDiffDefects(`${ON}\ngit -C "{WORKTREE_PATH}" diff {DIFF_RANGE} > {REVIEW_DIR}/diff.patch\n`)).toHaveLength(1)
    expect(collectGitDiffDefects(`${ON}\ngit -C "{WORKTREE_PATH}" diff {DIFF_RANGE} > "/tmp/x.patch"\n`)).toHaveLength(1)
    expect(collectGitDiffDefects(`${ON}\ngit diff --stat {DIFF_RANGE}\n`)).toHaveLength(1)
  })

  it.each(VARIANTS)('$label: Principles 1 and 3 name the exceptions, and redirect-only writes print nothing', ({ body }) => {
    expect(collectPrincipleDefects(body)).toEqual([])
  })

  it('known-bad probes: a Principle that claims no git, or drops the print-nothing statement, is reported', () => {
    expect(collectPrincipleDefects(seed(ON, /^1\. \*\*Orchestration only\*\*.*$/m, "1. **Orchestration only** - Command spawns agents, doesn't do git/review work itself")).join('\n'))
      .toMatch(/principle 1 does not say redirect-only writes print nothing/)
    expect(collectPrincipleDefects(seed(ON, /^3\. \*\*Git agent for git work\*\*.*$/m, '3. **Git agent for git work** - All git operations go through Git agent')).join('\n'))
      .toMatch(/principle 3 does not say redirect-only writes print nothing/)
    expect(collectPrincipleDefects(seed(ON, 'bounded Phase 1 path listing', 'Phase 1 listing')))
      .toContain('principle 1 does not name the bounded path listing')
  })

  it('the orchestrator charter still carries its ad-hoc rule: the command states its own exceptions instead of amending it', () => {
    const charter = readFileSync(path.join(ROOT, 'src/assets/scripts/hooks/assets/orchestrator-charter.md'), 'utf-8')
    expect(charter).toMatch(/never a diff, log or test run/)
    expect(charter).not.toMatch(/redirect|diff\.patch|paths\.txt/)
  })
})

describe('the command text and the Architecture tree describe the new behaviour', () => {
  it.each(VARIANTS)('$label: Edge Cases rows and the tree', ({ body }) => {
    expect(collectDocsOfBehaviourDefects(body)).toEqual([])
  })

  it('known-bad probes: a missing row and a stale tree are each reported', () => {
    expect(collectDocsOfBehaviourDefects(seed(ON, /^\| Docs-only diff \|.*$/m, ''))).toContain('Edge Cases has no a docs-only row')
    expect(collectDocsOfBehaviourDefects(seed(ON, /^\| A path matching no class pattern, or an empty path list \|.*$/m, '')))
      .toContain('Edge Cases has no a fail-safe row')
    expect(collectDocsOfBehaviourDefects(seed(ON, /Classify the diff/g, 'Detect file types'))).toContain('the Architecture tree does not show the classification')
  })
})

describe('/dynamic-build is out of #428 (decision 1, AC-314)', () => {
  const sources = ['_partials/_engine.mds', 'dynamic-build.mds', '_partials/_wave.mds'].map(f => ({
    name: `src/assets/commands/${f}`,
    content: readFileSync(path.join(ROOT, 'src/assets/commands', f), 'utf-8'),
  }))

  /** Named collector: every gating token these sources must not carry. */
  function collectDynamicBuildLeaks(files: ReadonlyArray<{ name: string; content: string }>): string[] {
    const tokens: ReadonlyArray<readonly [string, RegExp]> = [
      ['DIFF_FILE', /\bDIFF_FILE\b/],
      ['DIFF_CLASS', /\bDIFF_CLASS\b/],
      ['a patch file', /\bdiff(?:-[\w{}-]+)?\.patch\b/],
      ['a reduced class', /\b(?:docs-only|tests-only|lockfile-only)\b/],
      ['the language stamp', /Installed language focuses/],
      ['a stamp-gated row', /stamp-gated/],
    ]
    return files.flatMap(f => tokens.filter(([, re]) => re.test(f.content)).map(([label]) => `${f.name}: ${label}`))
  }

  it('the engine, the command and the wave partial carry no filter, stamp or DIFF_FILE', () => {
    expect(sources).toHaveLength(3)
    expect(sources.every(s => s.content.length > 2000)).toBe(true)
    expect(collectDynamicBuildLeaks(sources)).toEqual([])
    expect(collectDynamicBuildLeaks([{ name: 'compiled dynamic-build', content: requireDistFile('dynamic-build.md') }])).toEqual([])
  })

  it('known-bad probe: a stamp or DIFF_FILE seeded into the engine is reported', () => {
    const engine = sources[0]
    expect(collectDynamicBuildLeaks([{ ...engine, content: `${engine.content}\nDIFF_FILE: x\n` }])).toEqual([`${engine.name}: DIFF_FILE`])
    expect(collectDynamicBuildLeaks([{ ...engine, content: `${engine.content}\nInstalled language focuses: go\n` }])).toEqual([`${engine.name}: the language stamp`])
  })
})
