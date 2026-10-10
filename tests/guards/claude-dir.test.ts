/**
 * Claude-directory guard (#406, item 2) — D-CLAUDE-DIR-PROMPTS.
 *
 * Claude Code reads `CLAUDE_CONFIG_DIR` when it is set to an absolute path, else
 * `~/.claude` (D-CLAUDE-CONFIG-DIR, src/targets/claude-code/claude-paths.ts), and
 * the installer writes skills there by the same rule. A prompt that probes or
 * reads `~/.claude/…` directly disagrees with both the moment the variable is
 * set: `/dynamic-profile` mined an empty or stale `~/.claude/projects`.
 *
 * THE SANCTIONED FORM is one shell line that resolves the directory the way the
 * installer does, and a prompt names paths under the result (`$d/…`,
 * `{claude_dir}/…`):
 *
 *   d="${CLAUDE_CONFIG_DIR:-}"; case "$d" in /*) ;; *) d="$HOME/.claude" ;; esac;
 *
 * WHAT COUNTS AS A VIOLATION (the matcher):
 * - a path INTO the home Claude directory — `~/.claude/x`, `$HOME/.claude/x`,
 *   `${HOME}/.claude/x`: a read or an existence check of something under it,
 *   whatever verb surrounds it, because no use of such a path is correct when
 *   `CLAUDE_CONFIG_DIR` is set;
 * - the directory ITSELF on a line that does not name `CLAUDE_CONFIG_DIR` — a
 *   listing or a glob root handed over without the rule that picks it.
 * The directory named beside `CLAUDE_CONFIG_DIR` (the sanctioned line, or prose
 * stating the rule: "else `$HOME/.claude`") is the rule, not a bypass of it.
 *
 * WHAT A CLEAN RESULT DOES NOT COVER: a path assembled from parts
 * (`$HOME` + `/.claude`), a variable holding the literal, an absolute path spelt
 * with the user's own home (`/Users/x/.claude`), and anything outside the corpus
 * below. Hooks and the TypeScript CLI are not prompts: they resolve the directory
 * in code (getClaudeDirectory) and are held to it by their own tests.
 *
 * THE CORPUS is the installed prompt surface by class, each with a sentinel and a
 * floor so a class that went missing fails by name: compiled commands, every
 * agent as installed (dist-first), the compiled git references, and the
 * hand-authored skills and rules.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { ROOT, requireDistFile, requireDistFiles, resolveAllAgents, walkFiles } from '../helpers.js'
import { DEVFLOW_PLUGINS, buildScopedSkillsMap, getAllAgentNames } from '../../src/core/plugins.js'
import { installViaFileCopy } from '../../src/targets/claude-code/installer.js'

/** The resolution line every compiled probe of the Claude directory must use. */
const SANCTIONED_RESOLUTION = 'd="${CLAUDE_CONFIG_DIR:-}"; case "$d" in /*) ;; *) d="$HOME/.claude" ;; esac;'

/** A path under the home Claude directory: `~/.claude/x`, `$HOME/.claude/x`, `${HOME}/.claude/x`. */
const PATH_UNDER_HOME_CLAUDE = /(?:~|\$HOME|\$\{HOME\})\/\.claude\/[^\s`'")]/

/** The home Claude directory itself, not followed by more of a name. */
const HOME_CLAUDE_DIR = /(?:~|\$HOME|\$\{HOME\})\/\.claude(?![\w.-])/

interface PromptFile {
  readonly name: string
  readonly content: string
}

interface ClaudeDirUse {
  readonly file: string
  readonly line: number
  readonly text: string
}

/** Whether one line reaches the home Claude directory outside the resolution rule. */
function isUnresolvedClaudeDir(text: string): boolean {
  if (PATH_UNDER_HOME_CLAUDE.test(text)) return true
  return HOME_CLAUDE_DIR.test(text) && !text.includes('CLAUDE_CONFIG_DIR')
}

/** Named collector: every line in the corpus that names the home Claude directory outside the rule. */
function collectUnresolvedClaudeDir(corpus: readonly PromptFile[]): ClaudeDirUse[] {
  const out: ClaudeDirUse[] = []
  for (const { name, content } of corpus) {
    content.split('\n').forEach((text, index) => {
      if (isUnresolvedClaudeDir(text)) out.push({ file: name, line: index + 1, text: text.trim().slice(0, 240) })
    })
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
  ]
}


describe('no prompt reaches ~/.claude outside the CLAUDE_CONFIG_DIR rule (D-CLAUDE-DIR-PROMPTS)', () => {
  it('reads a real corpus: every class is present, by sentinel and by floor', () => {
    for (const { label, files, sentinel, floor } of promptSurface()) {
      expect(files.map(f => f.name), `${label}: sentinel ${sentinel} not in the corpus`).toContain(sentinel)
      expect(files.length, `${label}: ${files.length} files, below the floor of ${floor}`).toBeGreaterThanOrEqual(floor)
    }
  })

  it('no prompt names a path under the home Claude directory, or the directory without the rule', () => {
    const found = collectUnresolvedClaudeDir(promptSurface().flatMap(c => c.files))
    expect(found.map(u => `${u.file}:${u.line}: ${u.text}`)).toEqual([])
  })

  it('the consumer carries the sanctioned resolution: /dynamic-profile', () => {
    // The positive half: a clean scan must mean the probe moved onto the rule,
    // not that it was deleted.
    const profile = requireDistFile('dynamic-profile.md')
    expect(profile).toContain(`${SANCTIONED_RESOLUTION} printf '%s\\n' "$d"`)
    for (const sub of ['{claude_dir}/projects/', '{claude_dir}/history.jsonl', '{claude_dir}/rules/']) {
      expect(profile, `dynamic-profile reads ${sub} under the resolved directory`).toContain(sub)
    }
  })

  it('/code-review no longer probes the Claude directory: its language gate is the install-time stamp (D-LANGUAGE-FOCUS-STAMP)', async () => {
    // The positive half for the command whose probe moved: the compiled command carries the
    // stamp rule and the stamp line, and nothing in it resolves or names the Claude directory;
    // the installed copy carries the list. tests/installer/language-stamp*.test.ts holds the
    // rest of the installer side.
    const review = requireDistFile('code-review.md')
    expect(review).toContain('A language focus is spawned only when its file-type condition above fires AND its name appears in that stamped line.')
    expect(review.split('\n').filter(line => line.startsWith('Installed language focuses: '))).toHaveLength(1)
    expect(review).not.toContain(SANCTIONED_RESOLUTION)
    expect(review).not.toContain('CLAUDE_CONFIG_DIR')
    expect(review).not.toContain('{claude_dir}')

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

  it('the sanctioned line resolves CLAUDE_CONFIG_DIR only when absolute, as getClaudeDirectory does', async () => {
    const { spawnSync } = await import('child_process')
    const run = (env: Record<string, string | undefined>): string => {
      const clean: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: '/home/probe' }
      for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v
      return spawnSync('bash', ['-c', `${SANCTIONED_RESOLUTION} printf '%s' "$d"`], { encoding: 'utf-8', env: clean }).stdout
    }
    expect(run({})).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: '' })).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: 'relative/dir' })).toBe('/home/probe/.claude')
    expect(run({ CLAUDE_CONFIG_DIR: '/opt/claude config' })).toBe('/opt/claude config')
  })

  it('red probe: the superseded presence gate, seeded into the real compiled command, is reported', () => {
    const review = { name: 'dist/commands/code-review.md', content: requireDistFile('code-review.md') }
    expect(collectUnresolvedClaudeDir([review])).toEqual([])
    const seeded = {
      ...review,
      content: `${review.content}\nfor each language focus, check whether \`~/.claude/skills/devflow:{focus}/SKILL.md\` exists (one file-existence check per candidate focus).\n`,
    }
    expect(collectUnresolvedClaudeDir([seeded]).map(u => u.file)).toEqual(['dist/commands/code-review.md'])
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
    for (const probe of probes) {
      expect(collectUnresolvedClaudeDir([{ name: 'probe.md', content: probe }]), probe).toHaveLength(1)
    }
  })

  it('negative controls: the rule itself and paths under the resolved directory are not reported', () => {
    const controls = [
      SANCTIONED_RESOLUTION,
      "`{claude_dir}` is Claude Code's directory: `CLAUDE_CONFIG_DIR` when that is set to an absolute path, else `$HOME/.claude`.",
      'rg -l "AskUserQuestion" "{claude_dir}/projects/" 2>/dev/null | head -50',
      'test -f "$d/skills/devflow:{focus}/SKILL.md"',
      'deploy.ts          # AI editors (.claude/, .cursor/ dirs)',
      'the installed copies under `~/.devflow` are produced from these',
    ]
    for (const control of controls) {
      expect(collectUnresolvedClaudeDir([{ name: 'control.md', content: control }]), control).toEqual([])
    }
  })
})
