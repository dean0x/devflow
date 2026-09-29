/**
 * No-config-read guard (#392, AC-41, TP-36) — D-SETTINGS-LINE.
 *
 * Prompts never read the repository's config files. The committed
 * `.devflow/project.json` and the personal `.devflow/config.json` are folded by
 * `resolve-settings.cjs` alone (the shared parser is their only validator,
 * PF-023), and a prompt learns their values from the one closed-vocabulary
 * line `_partials/_settings.mds` accepts. A prompt that read either file itself
 * would be a second, unvalidated parser — the divergence the settings line exists
 * to remove.
 *
 * WHAT COUNTS AS A READ (the matcher). Shipped prompts phrase a read in three
 * ways, and each is a shape here rather than a word list tuned to one file:
 *
 *   verb      an imperative or gerund read verb — Read, read, reading, open,
 *             load, parse, consult, inspect, check, examine, view, extract,
 *             fetch, "look at/in/into" (and their -ing forms) — BEFORE the
 *             path on the same line, within READ_WINDOW characters: "Read the
 *             current worktree's `.devflow/config.json`", "read rungs 1 and 2 …
 *             (1) the `tracker` key in the project's `.devflow/config.json`".
 *   shell     a reading command or call before the path: cat, head, tail, jq,
 *             grep, rg, sed, awk, readFileSync, readFile, require,
 *             Get-Content — "cat .devflow/config.json".
 *   redirect  input redirection from the path: "< .devflow/project.json", and
 *             the `$(<file)` read.
 *
 * Deliberately NOT verbs: `source` and `type`, which prompts use as nouns ("the
 * only source of these values") beside the paths far more than as commands.
 *
 * The unit is a line, with backslash-continued shell lines joined first, because
 * prompts write a paragraph or a list item as one line and an instruction often
 * names its object after an enumeration ("read rungs 1 and 2 … (1) … the file")
 * that a sentence split would cut off. The window is what keeps a line-scoped
 * match from pairing a verb with an unrelated path a paragraph later.
 *
 * WHAT IS NOT A READ, and why the matcher passes it:
 *   - a third-person description — "the script alone folds …", "the resolver
 *     reads …": `reads`/`folds` are not imperative forms, so a prompt may say who
 *     reads the file (the settings partial documents its sources this way);
 *   - a negated instruction — "never read", "do not open", "without reading":
 *     NEGATION_BEFORE_VERB, checked in the few characters before the verb;
 *   - a location or ownership mention — a table row, a gitignore carve-out line,
 *     "`.devflow/project.json` is git-tracked": no read verb precedes the path.
 * Each of these is a negative control below, so loosening the matcher to pass
 * them is a visible change rather than a silent one.
 *
 * WHAT A CLEAN RESULT DOES NOT COVER (PF-064): a path assembled from parts
 * (`.devflow/` + a variable file name), a glob (`.devflow/*.json`), a passive
 * instruction ("… is read at step 1"), a verb that follows its object, a read
 * named on a different line from its path ("read that file"), and any prompt
 * outside the corpus below — hooks and scripts are plumbing, not prompts, and
 * read these files by design.
 *
 * THE CORPUS is the installed prompt surface by class, each with a sentinel:
 * compiled commands, every agent as installed (dist-first, so the compiled
 * `dist/agents/git.md`), the compiled git references, and the hand-authored
 * skills and rules. A non-empty total says nothing about a class that went
 * missing, so every class is asserted by name (PF-064 amendment).
 *
 * NO EXEMPTIONS (TP-42). The Git agent, the last reader, resolves its tracker
 * provider, site and key from the settings line like every other prompt. The
 * list stays declared and asserted empty, so re-admitting a reader is a visible
 * edit to this file rather than a quiet filter, and a git.md carrying the
 * settings line is asserted positively below, so an empty result is not an
 * agent that stopped resolving its tracker at all.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile, requireDistFiles, resolveAllAgents, walkFiles } from '../helpers.js'
import { getAllAgentNames } from '../../src/core/plugins.js'

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

/** The two repository config files, however the prompt prefixes them (`{worktree}/`, `$ROOT/`). */
const CONFIG_PATH_RE = /\.devflow\/(?:project|config)\.json\b/g

/** Imperative and gerund read verbs, and reading commands. `reads`, `read-only` and `thread` never match. */
const READ_VERB_RE =
  /(?<![\w-])(?:read|reading|open|opening|load|loading|parse|parsing|consult|consulting|inspect|inspecting|check|checking|examine|examining|view|viewing|extract|extracting|fetch|fetching|look(?:ing)?\s+(?:at|in|into)|cat|head|tail|jq|grep|rg|sed|awk|readFileSync|readFile|require|Get-Content)(?![\w-])/gi

/** Input redirection straight from a config path. */
const REDIRECT_RE = /<\s*["']?[^\s"'<>|;&]*\.devflow\/(?:project|config)\.json/

/** A negation in the few characters before a verb: "never read", "do not open", "without reading". */
const NEGATION_BEFORE_VERB = /\b(?:never|not|no|nor|without|n't)\s+(?:\w+\s+)?$/i

/** How far after a read verb its object may sit on the same line. */
const READ_WINDOW = 200

/** How far back from a verb a negation is looked for. */
const NEGATION_LOOKBACK = 24

interface PromptFile {
  /** Repo-relative path, as the exemption list spells it. */
  readonly name: string
  readonly content: string
}

interface ConfigRead {
  readonly file: string
  readonly line: number
  readonly text: string
}

/** Lines of a prompt, with backslash-continued shell lines joined onto the line they continue. */
function logicalLines(content: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  const raw = content.split('\n')
  for (let i = 0; i < raw.length; i++) {
    const start = i
    let text = raw[i]
    while (text.endsWith('\\') && i + 1 < raw.length) {
      i++
      text = `${text.slice(0, -1)} ${raw[i].trim()}`
    }
    out.push({ line: start + 1, text })
  }
  return out
}

/** Whether one line instructs a read of a config path. */
function isConfigRead(text: string): boolean {
  if (REDIRECT_RE.test(text)) return true
  const paths = [...text.matchAll(CONFIG_PATH_RE)].map(m => m.index ?? 0)
  if (paths.length === 0) return false
  for (const verb of text.matchAll(READ_VERB_RE)) {
    const at = verb.index ?? 0
    const before = text.slice(Math.max(0, at - NEGATION_LOOKBACK), at)
    if (NEGATION_BEFORE_VERB.test(before)) continue
    const end = at + verb[0].length
    if (paths.some(p => p >= end && p - end <= READ_WINDOW)) return true
  }
  return false
}

/** Named collector: every line in the corpus that instructs a read of a config path. */
function collectConfigReads(corpus: readonly PromptFile[]): ConfigRead[] {
  const out: ConfigRead[] = []
  for (const { name, content } of corpus) {
    for (const { line, text } of logicalLines(content)) {
      if (isConfigRead(text)) out.push({ file: name, line, text: text.trim().slice(0, 240) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

interface CorpusClass {
  readonly label: string
  readonly files: readonly PromptFile[]
  /** A file that must be present, proving this class was actually read. */
  readonly sentinel: string
  /** The fewest files this class may hold. */
  readonly floor: number
}

const rel = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/')

function readTree(dir: string): PromptFile[] {
  return walkFiles(path.join(ROOT, dir), f => f.endsWith('.md')).map(f => ({ name: rel(f), content: readFileSync(f, 'utf-8') }))
}

/** The installed prompt surface, by class. */
function promptSurface(): CorpusClass[] {
  const commands = requireDistFiles().map(n => ({ name: `dist/commands/${n}`, content: requireDistFile(n) }))
  const agents = [...resolveAllAgents().values()].map(a => ({ name: rel(a.path), content: a.content }))
  return [
    { label: 'commands', files: commands, sentinel: 'dist/commands/implement.md', floor: 14 },
    { label: 'agents', files: agents, sentinel: 'dist/agents/git.md', floor: getAllAgentNames().length },
    { label: 'references', files: readTree('dist/skills'), sentinel: 'dist/skills/git/references/publication-gate.md', floor: 20 },
    { label: 'skills', files: readTree('src/assets/skills'), sentinel: 'src/assets/skills/git/SKILL.md', floor: 30 },
    { label: 'rules', files: readTree('src/assets/rules'), sentinel: 'src/assets/rules/security.md', floor: 4 },
  ]
}

/** Files excused from the rule, with the reason. Empty since the Git agent moved onto the settings line (TP-42). */
const EXEMPT: ReadonlyMap<string, string> = new Map()

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('no compiled prompt reads .devflow/project.json or .devflow/config.json (AC-41)', () => {
  it('reads a real corpus: every class is present, by sentinel and by floor', () => {
    const surface = promptSurface()
    for (const { label, files, sentinel, floor } of surface) {
      const names = files.map(f => f.name)
      expect(names, `${label}: sentinel ${sentinel} not in the corpus — the class was not read`).toContain(sentinel)
      expect(files.length, `${label}: ${files.length} files, below the floor of ${floor}`).toBeGreaterThanOrEqual(floor)
    }
    // Total floor across classes (PF-018): a corpus this size or larger was read.
    expect(surface.flatMap(c => c.files).length).toBeGreaterThanOrEqual(120)
  })

  it('reaches the consumers: the settings partial and its three gates are compiled into the corpus', () => {
    const commands = promptSurface().find(c => c.label === 'commands')!.files
    const carrying = commands.filter(f => f.content.includes('resolve-settings.cjs')).map(f => f.name).sort()
    // The corpus must hold the text most likely to name the paths, or a clean
    // result says nothing about it.
    expect(carrying.length, 'no compiled command carries the settings partial').toBeGreaterThanOrEqual(8)
    expect(carrying).toContain('dist/commands/code-review.md')
    expect(carrying).toContain('dist/commands/explore.md')
  })

  it('no prompt outside the named exemption instructs a read of either file', () => {
    const reads = collectConfigReads(promptSurface().flatMap(c => c.files))
    const unexempt = reads.filter(r => !EXEMPT.has(r.file))
    expect(unexempt.map(r => `${r.file}:${r.line}: ${r.text}`)).toEqual([])
  })

  it('the exemption list is empty (TP-42)', () => {
    expect([...EXEMPT.keys()]).toEqual([])
  })

  it('the Git agent resolves its tracker from the settings line, and reads neither file', () => {
    // The positive half of the empty exemption list: git.md is in the corpus AND
    // carries the resolver invocation, so a clean result is an agent that moved,
    // not one that stopped resolving its tracker.
    const git = promptSurface().find(c => c.label === 'agents')!.files.find(f => f.name === 'dist/agents/git.md')!
    expect(git, 'dist/agents/git.md is not in the agents class').toBeDefined()
    expect(git.content).toContain('node "$HOME/.devflow/scripts/resolve-settings.cjs" "{root}" 2>/dev/null; echo "exit=$?"')
    expect(collectConfigReads([git])).toEqual([])
  })

  it('red probe: a seeded config read in a real compiled command is reported by the same collector', () => {
    const implement = { name: 'dist/commands/implement.md', content: requireDistFile('implement.md') }
    expect(collectConfigReads([implement])).toEqual([])
    const seeded = {
      ...implement,
      content: `${implement.content}\n**Resolve \`REVIEW_PUBLICATION\` per worktree:** Read the current worktree's \`.devflow/config.json\` (a single, direct file read).\n`,
    }
    expect(collectConfigReads([seeded]).map(r => r.file)).toEqual(['dist/commands/implement.md'])
  })

  it('red probes: every read shape is reported', () => {
    const probes = [
      "Read the current worktree's `.devflow/config.json` (a single, direct file read).",
      'Read `{worktree}/.devflow/project.json` and take its `features.knowledge` value.',
      "- **Resolution order — read rungs 1 and 2 BEFORE deciding:** rung 1 NARROWS rung 2 and cannot be evaluated without it. (1) the `tracker` key in the project's `.devflow/config.json`",
      'Open `.devflow/project.json` and check the `evidence` key.',
      'Load the team settings from `$ROOT/.devflow/project.json`.',
      'Parse `.devflow/config.json` for `reviewPublication`.',
      'Consult `.devflow/project.json` before choosing a tracker.',
      'cat .devflow/config.json',
      "jq -r '.reviewPublication // \"auto\"' .devflow/config.json",
      "jq -r '.tracker' \\\n  \"$ROOT/.devflow/project.json\"",
      'node -e \'console.log(require("fs").readFileSync(".devflow/project.json","utf8"))\'',
      'while IFS= read -r line; do echo "$line"; done < "$ROOT/.devflow/config.json"',
      'Read(file_path="/repo/.devflow/config.json")',
      'By reading `.devflow/project.json` you learn the tracker site.',
      'Look at `.devflow/project.json` to find the team tracker.',
      'Check the `features` key in `{worktree}/.devflow/config.json`.',
      'Examine `.devflow/project.json` for a `compliance` list.',
      'grep -o \'"evidence":"[a-z]*"\' .devflow/project.json',
      'node -p "require(\'./.devflow/project.json\').evidence"',
      'SETTINGS=$(<"$ROOT/.devflow/config.json")',
      'Get-Content .devflow/config.json | ConvertFrom-Json',
    ]
    for (const probe of probes) {
      expect(collectConfigReads([{ name: 'probe.md', content: probe }]), probe).toHaveLength(1)
    }
  })

  it('negative controls: mentions that are not reads are not reported', () => {
    const controls = [
      // The settings partial documents its sources in the third person.
      'The accepted line is the only source of these values: the script alone folds the committed `.devflow/project.json`, the personal `.devflow/config.json` and the machine manifest.',
      'The resolver reads `.devflow/project.json` and the personal `.devflow/config.json`.',
      // Negated instructions.
      'Never read `.devflow/config.json` yourself.',
      'Do not open `.devflow/project.json`; use the settings line.',
      'Resolve it without reading `.devflow/config.json`.',
      // Locations, ownership and the gitignore carve-out.
      "| Personal `.devflow/config.json` | This checkout's toplevel | Per-worktree by decision |",
      '!.devflow/project.json',
      '`.devflow/project.json` is git-tracked alongside `features/`; devflow never writes it.',
      // A read verb whose object is another file, with the path too far away to be its object.
      `Read \`~/.devflow/manifest.json\`.${' The machine switch decides.'.repeat(8)} The repository's \`.devflow/config.json\` is not a gate.`,
      // A verb after its object.
      '`.devflow/config.json` holds per-repo facts that the resolver reads.',
    ]
    for (const control of controls) {
      expect(collectConfigReads([{ name: 'control.md', content: control }]), control).toEqual([])
    }
  })
})
