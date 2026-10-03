/**
 * No-config-read guard (#392, AC-41, TP-36) — D-SETTINGS-LINE.
 *
 * Prompts never read the repository's config files. The committed
 * `.devflow/project.json` and the personal `.devflow/config.json` are folded by
 * `resolve-settings.cjs` alone (the shared parser is their only validator),
 * and a prompt learns their values from the one closed-vocabulary
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
 * WHAT A CLEAN RESULT DOES NOT COVER: a path assembled from parts
 * (`.devflow/` + a variable file name), a glob (`.devflow/*.json`), a passive
 * instruction ("… is read at step 1"), a verb that follows its object, a read
 * named on a different line from its path ("read that file"), and any prompt
 * outside the corpus below. Hooks and scripts are plumbing and read these files
 * by design, so only the TEXT a hook hands a model is corpus, never its code.
 *
 * THE CORPUS is the installed prompt surface by class, each with a sentinel:
 * compiled commands, every agent as installed (dist-first, so the compiled
 * `dist/agents/git.md`), the compiled git references, the hand-authored
 * skills and rules, the ambient orchestrator charter the session-start hook
 * injects, and the directive text the hooks emit (#406): the quoted
 * `*_SECTION` / `*_NOTE` / `*_HEADER` / `CONTEXT` literals, the
 * `json_prompt_output` arguments and the `$(cat <<EOF …)` prompt bodies —
 * extracted from the hook source, whose own shell stays out of scope. A
 * non-empty total says nothing about a class that went missing, so every class
 * is asserted by name.
 *
 * THE COMPILED CLASSES MUST BE CURRENT. A dist/ older than its sources is a
 * clean scan of text nobody ships, so the guard first fails by name on any
 * compiled prompt older than an input it is compiled from (#406).
 *
 * NO EXEMPTIONS (TP-42). The Git agent, the last reader, resolves its tracker
 * provider, site and key from the settings line like every other prompt. The
 * list stays declared and asserted empty, so re-admitting a reader is a visible
 * edit to this file rather than a quiet filter, and a git.md carrying the
 * settings line is asserted positively below, so an empty result is not an
 * agent that stopped resolving its tracker at all.
 */

import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
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

const HOOKS_DIR = 'src/assets/scripts/hooks'
const CHARTER = `${HOOKS_DIR}/assets/orchestrator-charter.md`

/** Where a directive literal opens: an assignment to a directive variable, or the prompt-output helper's argument. */
const DIRECTIVE_OPENER_RE = /(?:(?<![A-Za-z0-9_])(?:[A-Z][A-Z0-9_]*_(?:SECTION|NOTE|HEADER)|CONTEXT)=|json_prompt_output\s+)(["'])/g

/** A prompt body captured from a heredoc: `X=$(cat <<EOF` … `EOF`. */
const HEREDOC_PROMPT_RE = /\$\(cat <<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\1\n/g

/** The longest literal read before giving up on a closing quote. */
const MAX_LITERAL = 20_000

/**
 * The body of the shell string literal opening at `start` (just past its quote).
 * Single quotes end at the next quote; double quotes honour backslash escapes and
 * skip quotes nested inside `$( … )`. Bounded by MAX_LITERAL.
 */
function readLiteral(source: string, start: number, quote: string): string {
  const end = Math.min(source.length, start + MAX_LITERAL)
  let depth = 0
  for (let i = start; i < end; i++) {
    const c = source[i]
    if (quote === "'") {
      if (c === "'") return source.slice(start, i)
      continue
    }
    if (c === '\\') {
      i++
      continue
    }
    if (c === '$' && source[i + 1] === '(') {
      depth++
      i++
      continue
    }
    if (depth > 0) {
      if (c === ')') depth--
      continue
    }
    if (c === '"') return source.slice(start, i)
  }
  return source.slice(start, end)
}

/** Named collector: the text a hook hands a model — its directive literals and heredoc prompt bodies. */
function collectDirectiveText(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(DIRECTIVE_OPENER_RE)) {
    const body = readLiteral(source, (m.index ?? 0) + m[0].length, m[1])
    // Prose only: `CONTEXT=""` and `X_NOTE="$Y"` hand a model no words of their own.
    if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(body)) out.push(body)
  }
  for (const m of source.matchAll(HEREDOC_PROMPT_RE)) out.push(m[2])
  return out
}

/** One corpus entry per hook that emits directive text. */
function hookDirectives(): PromptFile[] {
  const dir = path.join(ROOT, HOOKS_DIR)
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && path.extname(e.name) === '')
    .map(e => ({ name: `${HOOKS_DIR}/${e.name}#directives`, text: collectDirectiveText(readFileSync(path.join(dir, e.name), 'utf-8')) }))
    .filter(h => h.text.length > 0)
    .map(h => ({ name: h.name, content: h.text.join('\n') }))
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
    { label: 'charter', files: [{ name: CHARTER, content: readFileSync(path.join(ROOT, CHARTER), 'utf-8') }], sentinel: CHARTER, floor: 1 },
    { label: 'hook directives', files: hookDirectives(), sentinel: `${HOOKS_DIR}/session-start-context#directives`, floor: 4 },
  ]
}

// ---------------------------------------------------------------------------
// Currency: the compiled classes are built from the sources under review
// ---------------------------------------------------------------------------

/**
 * Where agent generator hosts live. Assembled, not spelt: the literal-agent-path
 * guard reserves that spelling for resolveAgentSource, and this is a source
 * directory for an mtime, never an agent read.
 */
const AGENT_HOSTS_DIR = ['src', 'assets', 'agents'].join('/')
/** The Git agent's generator host, for the hermetic currency probe. */
const GIT_HOST = `${AGENT_HOSTS_DIR}/git.mds`

/** A compiled prompt and the sources it is compiled from, repo-relative. */
interface CompiledPrompt {
  readonly output: string
  readonly inputs: readonly string[]
}

/** Repo-relative files under `root/dir` passing `keep`; none when the directory is absent. */
function listFiles(root: string, dir: string, keep: (file: string) => boolean): string[] {
  try {
    return walkFiles(path.join(root, dir), keep).map(f => path.relative(root, f).split(path.sep).join('/'))
  } catch {
    return []
  }
}

/**
 * Every compiled prompt under `root` with its inputs: a command host with every
 * command partial (a partial edit can move any host that imports it), release.md
 * with its hand-authored source, the Git agent with its host, and each generated
 * reference with every reference module.
 */
function compiledPrompts(root: string): CompiledPrompt[] {
  const partials = listFiles(root, 'src/assets/commands/_partials', f => f.endsWith('.mds'))
  const hosts = new Set(listFiles(root, 'src/assets/commands', f => f.endsWith('.mds')))
  const modules = listFiles(root, 'src/assets/mds', f => f.endsWith('.mds'))
  const commands = listFiles(root, 'dist/commands', f => f.endsWith('.md')).map(output => {
    const base = path.basename(output, '.md')
    const host = `src/assets/commands/${base}.mds`
    return { output, inputs: hosts.has(host) ? [host, ...partials] : [`src/assets/commands/${base}.md`] }
  })
  const agents = listFiles(root, 'dist/agents', f => f.endsWith('.md'))
    .map(output => ({ output, inputs: [`${AGENT_HOSTS_DIR}/${path.basename(output, '.md')}.mds`] }))
  const references = listFiles(root, 'dist/skills', f => f.endsWith('.md')).map(output => ({ output, inputs: modules }))
  return [...commands, ...agents, ...references]
}

/** Named collector: each compiled prompt older than one of its inputs, naming the first such input. */
function collectStaleOutputs(root: string): string[] {
  const mtime = (rel: string): number | null => {
    try {
      return statSync(path.join(root, rel)).mtimeMs
    } catch {
      return null
    }
  }
  const out: string[] = []
  for (const { output, inputs } of compiledPrompts(root)) {
    const built = mtime(output)
    if (built === null) continue
    const newer = inputs.filter(i => (mtime(i) ?? -Infinity) > built)
    if (newer.length > 0) out.push(`${output} is STALE: ${newer[0]} changed after it was built`)
  }
  return out
}

/** Files excused from the rule, with the reason. Empty since the Git agent moved onto the settings line (TP-42). */
const EXEMPT: ReadonlyMap<string, string> = new Map()

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('the compiled prompt corpus is current (#406)', () => {
  it('no compiled command, agent or reference is older than a source it is compiled from', () => {
    expect(compiledPrompts(ROOT).length, 'no compiled prompt found — run `npm run build:mds`').toBeGreaterThanOrEqual(40)
    expect(
      collectStaleOutputs(ROOT),
      'dist/ is older than its sources, so every scan below reads text nobody ships — run `npm run build:mds`',
    ).toEqual([])
  })

  it('red probe: sources edited after the build are reported against every output compiled from them', () => {
    // Hermetic: a temp root with hand-stamped mtimes — an order, never a wait.
    const root = mkdtempSync(path.join(tmpdir(), 'no-config-read-currency-'))
    const at = (rel: string, seconds: number): void => {
      const file = path.join(root, ...rel.split('/'))
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, 'probe\n')
      utimesSync(file, seconds, seconds)
    }
    try {
      for (const src of ['src/assets/commands/plan.mds', 'src/assets/commands/release.md', 'src/assets/commands/_partials/_docs_root.mds', GIT_HOST, 'src/assets/mds/git/_pr.mds']) {
        at(src, 1_700_000_000)
      }
      for (const out of ['dist/commands/plan.md', 'dist/commands/release.md', 'dist/agents/git.md', 'dist/skills/git/references/pr/x.md']) {
        at(out, 1_700_001_000)
      }
      expect(collectStaleOutputs(root), 'built after every source: current').toEqual([])
      for (const src of ['src/assets/commands/_partials/_docs_root.mds', 'src/assets/commands/release.md', GIT_HOST, 'src/assets/mds/git/_pr.mds']) {
        at(src, 1_700_002_000)
      }
      expect(collectStaleOutputs(root)).toEqual([
        'dist/commands/plan.md is STALE: src/assets/commands/_partials/_docs_root.mds changed after it was built',
        'dist/commands/release.md is STALE: src/assets/commands/release.md changed after it was built',
        `dist/agents/git.md is STALE: ${GIT_HOST} changed after it was built`,
        'dist/skills/git/references/pr/x.md is STALE: src/assets/mds/git/_pr.mds changed after it was built',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('no compiled prompt reads .devflow/project.json or .devflow/config.json (AC-41)', () => {
  it('reads a real corpus: every class is present, by sentinel and by floor', () => {
    const surface = promptSurface()
    for (const { label, files, sentinel, floor } of surface) {
      const names = files.map(f => f.name)
      expect(names, `${label}: sentinel ${sentinel} not in the corpus — the class was not read`).toContain(sentinel)
      expect(files.length, `${label}: ${files.length} files, below the floor of ${floor}`).toBeGreaterThanOrEqual(floor)
    }
    // Total floor across classes: a corpus this size or larger was read.
    expect(surface.flatMap(c => c.files).length).toBeGreaterThanOrEqual(120)
  })

  it('reaches the hook-emitted text: every directive a hook hands a model, and the charter', () => {
    const directives = promptSurface().find(c => c.label === 'hook directives')!.files
    const text = directives.map(f => f.content).join('\n')
    // One marker per emitter, so an extractor that stopped reading one fails by name.
    for (const marker of [
      '--- TRACKER SETUP ---', '--- LEARNING MAINTENANCE ---', '--- LEARNING PAUSED ---',
      '--- PRE-COMPACT SNAPSHOT', 'Orchestrator reminder:', 'The user\'s prompt is a plan handoff',
      'You are a working memory updater',
    ]) {
      expect(text, `hook directive text is missing ${marker}`).toContain(marker)
    }
    // …and no hook CODE: the extractor reads literals, never the shell around them.
    expect(text).not.toContain('TRACKER_PROJECT_FILE=')
    const charter = promptSurface().find(c => c.label === 'charter')!.files[0]
    expect(charter.content).toContain('--- ORCHESTRATOR CHARTER ---')
  })

  it('red probe: a config read seeded into a hook directive literal is reported, and hook code is not', () => {
    const hook = [
      'TRACKER_PROJECT_FILE="$PROJECT_DEVFLOW_DIR/project.json"',
      'grep -q \'"tracker"\' "$PROJECT_DEVFLOW_DIR/.devflow/project.json" && fork=1',
      'TRACKER_SECTION="--- TRACKER SETUP ---',
      'Read `.devflow/config.json` to learn the personal \\"tracker\\" override before the spawn."',
    ].join('\n')
    const entry = { name: 'src/assets/scripts/hooks/probe#directives', content: collectDirectiveText(hook).join('\n') }
    expect(collectConfigReads([entry]).map(r => r.file)).toEqual(['src/assets/scripts/hooks/probe#directives'])
    // The same read as hook CODE is plumbing and never becomes corpus.
    expect(collectDirectiveText(hook.split('\n').slice(0, 2).join('\n'))).toEqual([])
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
