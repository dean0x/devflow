/**
 * Docs-root guard (#406, item 7) — D-DOCS-ROOT, extending D-PROMPT-ROOT.
 *
 * Every `.devflow/docs/` artifact a command reads or writes belongs to the
 * checkout's toplevel (`_partials/_docs_root.mds`). A relative
 * `.devflow/docs/…` path resolves against the session's cwd, so a run started in
 * `packages/app` wrote a second `.devflow/docs/` tree there — a design document
 * `/implement` never found, a review head marker the next `/code-review` never
 * read, an evidence file the PR's test plan never saw.
 *
 * WHAT IS ALLOWED, per occurrence of `.devflow/docs` in a compiled command:
 * - ROOTED: directly preceded by `/` — `{worktree}/.devflow/docs/…`,
 *   `{integration worktree root}/…`, `${ROOT}/…` in an authored workflow script.
 * - A REPO-RELATIVE AGENT FIELD: a spawn-block line `NAME: .devflow/docs/…`
 *   whose fence also hands the agent a `WORKTREE_PATH:`, which the agent resolves
 *   the path under. These fields reach PR and issue comments, where an absolute
 *   path would publish the author's filesystem layout, so relative is the
 *   contract there, not an omission.
 * - A NAMED EXEMPTION below, each with its reason, each asserted live so a stale
 *   one fails rather than silently widening the rule.
 *
 * WHAT A CLEAN RESULT DOES NOT COVER: a path assembled from parts
 * (`.devflow/` + `docs`), a docs path an agent composes from a relative variable
 * the command set elsewhere, and the agents' own prompts (their WORKTREE_PATH
 * handling is `devflow:worktree-support`'s contract). The partial's resolution
 * command itself is exercised on real git in tests/commands/partials-root.test.ts.
 */

import { describe, it, expect } from 'vitest'

import { requireDistFile, requireDistFiles } from '../helpers.js'
import { DIST_COMMAND_FILES } from '../fixtures/mds-manifest.js'

const DOCS = '.devflow/docs'

/** The docs root's own rule sentence: it names the tree it roots. */
const RULE_LEAD = '**Docs root (D-DOCS-ROOT).**'

/** A spawn-block field carrying a repo-relative docs path. */
const RELATIVE_FIELD_RE = /^\s*[A-Z][A-Z0-9_]*: \.devflow\/docs\//

/** A fence line handing the agent the checkout its relative paths resolve under. */
const WORKTREE_FIELD_RE = /^\s*WORKTREE_PATH: \{/m

interface Exemption {
  readonly file: string
  /** A substring that identifies the line. */
  readonly line: string
  readonly reason: string
}

/** Relative docs mentions that are correct as written. */
const EXEMPTIONS: readonly Exemption[] = [
  {
    file: 'dist/commands/implement.md',
    line: '/implement .devflow/docs/design/',
    reason: 'a usage example of a path the user types; it resolves against the user\'s cwd, as typed',
  },
  {
    file: 'dist/commands/implement.md',
    line: '- Plan document path: `.devflow/docs/design/',
    reason: 'describes $ARGUMENTS as the user supplies it, not a path this command composes',
  },
  {
    file: 'dist/commands/resolve.md',
    line: '`TARGET_DIR_REL` to the same directory relative to the worktree root',
    reason: 'the repo-relative display form — the only form of the directory that may reach a PR comment',
  },
]

interface RelativeDocsUse {
  readonly file: string
  readonly line: number
  readonly text: string
}

/** The fenced block (```…```) containing line `index`, or null outside any fence. */
function enclosingFence(lines: readonly string[], index: number): string | null {
  let open = -1
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith('```')) continue
    if (open === -1) {
      open = i
      continue
    }
    if (open < index && index < i) return lines.slice(open, i + 1).join('\n')
    open = -1
  }
  return null
}

/** Whether every `.devflow/docs` on this line is rooted. */
function allRooted(text: string): boolean {
  let at = text.indexOf(DOCS)
  while (at !== -1) {
    if (text[at - 1] !== '/') return false
    at = text.indexOf(DOCS, at + DOCS.length)
  }
  return true
}

/** Named collector: every line of a compiled command naming a relative docs path outside the allowed forms. */
function collectRelativeDocs(corpus: ReadonlyArray<{ name: string; content: string }>): RelativeDocsUse[] {
  const out: RelativeDocsUse[] = []
  for (const { name, content } of corpus) {
    const lines = content.split('\n')
    lines.forEach((text, index) => {
      if (!text.includes(DOCS) || allRooted(text)) return
      if (text.startsWith(RULE_LEAD)) return
      if (EXEMPTIONS.some(e => e.file === name && text.includes(e.line))) return
      if (RELATIVE_FIELD_RE.test(text)) {
        const fence = enclosingFence(lines, index)
        if (fence !== null && WORKTREE_FIELD_RE.test(fence)) return
      }
      out.push({ file: name, line: index + 1, text: text.trim().slice(0, 240) })
    })
  }
  return out
}

const commands = () => requireDistFiles().map(n => ({ name: `dist/commands/${n}`, content: requireDistFile(n) }))

/** The hosts that write docs artifacts, and so must carry the docs root. */
const DOCS_ROOT_HOSTS = [
  'bug-analysis.md', 'dynamic-build.md', 'dynamic-plan.md', 'dynamic-tickets.md', 'implement.md', 'plan.md', 'research.md',
]


describe('no compiled command reads or writes a relative .devflow/docs path (D-DOCS-ROOT)', () => {
  it('reads a real corpus: every compiled command, and docs paths in it', () => {
    const corpus = commands()
    expect(corpus.map(c => c.name.replace('dist/commands/', '')).sort()).toEqual([...DIST_COMMAND_FILES].sort())
    const mentions = corpus.reduce((n, c) => n + c.content.split(DOCS).length - 1, 0)
    // Non-vacuity: the corpus carries the paths this guard is about.
    expect(mentions).toBeGreaterThanOrEqual(60)
  })

  it('every docs-writing host carries the docs root, and nothing else resolves it', () => {
    const carrying = commands().filter(c => c.content.includes(RULE_LEAD)).map(c => c.name.replace('dist/commands/', ''))
    expect(carrying.sort()).toEqual([...DOCS_ROOT_HOSTS].sort())
  })

  it('every docs path is rooted, a repo-relative agent field beside WORKTREE_PATH, or a named exemption', () => {
    expect(collectRelativeDocs(commands()).map(u => `${u.file}:${u.line}: ${u.text}`)).toEqual([])
  })

  it('every exemption is live: its line exists in its file and still names a relative docs path', () => {
    const byName = new Map(commands().map(c => [c.name, c.content]))
    for (const { file, line } of EXEMPTIONS) {
      const hit = (byName.get(file) ?? '').split('\n').find(l => l.includes(line))
      expect(hit, `${file}: exempted line "${line}" is gone — drop the exemption`).toBeDefined()
      expect(allRooted(hit!), `${file}: "${line}" is rooted now — drop the exemption`).toBe(false)
    }
  })

  it('/implement keeps its handoff and evidence file names, rooted (the workflow reads them by name)', () => {
    const implement = requireDistFile('implement.md')
    expect(implement).toContain('HANDOFF_FILE: {worktree}/.devflow/docs/handoff-{branch_slug}.md')
    expect(implement).toContain('check tp "{worktree}/.devflow/docs/evidence-{branch_slug}.md"')
    expect(implement).toContain('render --plan "{worktree}/.devflow/docs/evidence-{branch_slug}.md"')
  })

  it('red probe: the superseded relative evidence check, seeded into the real compiled command, is reported', () => {
    const implement = { name: 'dist/commands/implement.md', content: requireDistFile('implement.md') }
    expect(collectRelativeDocs([implement])).toEqual([])
    const seeded = {
      ...implement,
      content: `${implement.content}\nnode "$HOME/.devflow/scripts/verify-evidence.cjs" check tp .devflow/docs/evidence-{branch_slug}.md; echo "exit=$?"\n`,
    }
    expect(collectRelativeDocs([seeded]).map(u => u.file)).toEqual(['dist/commands/implement.md'])
  })

  it('red probes: every relative shape is reported', () => {
    const probes = [
      '3. Create timestamped analysis directory: `mkdir -p .devflow/docs/bug-analysis/{branch-slug}/{timestamp}/`',
      '1. List `.devflow/docs/design/*.md` — sort descending by filename',
      '- `OUTPUT_PATH`: `.devflow/docs/research/{topic-slug}/{YYYY-MM-DD_HHMM}/{type}.md`',
      'const OUTDIR = `.devflow/docs/design/${slug}/${ts}`;',
      'Write the handoff to ".devflow/docs/handoff-{branch_slug}.md".',
      // Rooted once and relative once on the same line: the relative one is reported.
      'Copy `{worktree}/.devflow/docs/a.md` to `.devflow/docs/b.md`.',
      // A relative field in a fence that hands the agent no WORKTREE_PATH.
      '```\nAgent(subagent_type="Git"):\n"OPERATION: update-pr-evidence\nEVIDENCE_FILE: .devflow/docs/evidence-{branch_slug}.md"\n```',
      // A relative field outside any fence.
      'HANDOFF_FILE: .devflow/docs/handoff-{branch_slug}.md',
    ]
    for (const probe of probes) {
      expect(collectRelativeDocs([{ name: 'dist/commands/probe.md', content: probe }]), probe).toHaveLength(1)
    }
  })

  it('negative controls: rooted paths, relative fields beside WORKTREE_PATH and the rule sentence are not reported', () => {
    const controls = [
      '1. Check `{worktree}/.devflow/docs/bug-analysis/{branch-slug}/.last-analysis-head`:',
      'const OUTDIR = `${ROOT}/.devflow/docs/tickets/${slug}/${ts}`;',
      'node "$HOME/.devflow/scripts/verify-evidence.cjs" check tp "{integration worktree root}/.devflow/docs/evidence-wave-{slug}.md"',
      '```\nAgent(subagent_type="Git"):\n"OPERATION: update-pr-evidence\nEVIDENCE_FILE: .devflow/docs/evidence-{branch_slug}.md\nWORKTREE_PATH: {worktree}\n"\n```',
      `${RULE_LEAD} Every \`.devflow/docs/\` path this command reads or writes lives at the checkout's toplevel.`,
    ]
    for (const control of controls) {
      expect(collectRelativeDocs([{ name: 'dist/commands/control.md', content: control }]), control).toEqual([])
    }
  })
})
