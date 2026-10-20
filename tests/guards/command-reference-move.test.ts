/**
 * D-CMD-REF-HAND (#456, AC-405, AC-406): a command moves a rare branch out of its own text into a
 * hand-authored file under `src/assets/skills/agent-references/references/commands/` and keeps only the
 * condition and the read path. A run that never takes the branch then never carries its text.
 *
 * What each arm holds:
 *   - Byte-identity. Every moved section equals the text `main` held before the move, pinned by length and
 *     SHA-256 (a digest, because a guard that shells out to `git show main:` reads nothing on a shallow
 *     clone). A deliberate later edit of a section updates its digest in the same commit.
 *   - Read semantics. The sections are found by a fence-aware reader (the exception grammar's template
 *     fence holds a `## ` line), so a moved block is read back through the extractor the guards use, not
 *     only compared as bytes.
 *   - Scope of the move. Only text with no learning arm and no Git-spawn fence moves: a learning arm cannot
 *     be split across files, and a Git fence is read by guards that scan the command.
 *   - Read paths. Every path a command names exists in the skill sources, every reference is named by a
 *     command, the read resolves the config directory in Bash first, and the compiled command carries it.
 *     A host may read a reference on its default path (`/code-review` at `standard` or `lean`) as well as on
 *     a rare branch; either way the read site passes through one named collector.
 *   - Installation. The skill belongs to `devflow-core-skills` alone, which every selection installs, so a
 *     selection of any plugin that uses a reference installs it; the install goldens list each file.
 *   - D-10: no plugin lists `agent-references` in `requires:`. A command reads the file by path, which the
 *     closure guard does not see, and a `requires:` entry would install the skill for a plugin that does
 *     not own it.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe run through the
 * same collector.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import * as path from 'path'

import {
  AGENT_REFERENCES_SKILL, RETIRED_INLINE_EXPANSION, ROOT, SANCTIONED_RESOLUTION, SANCTIONED_RESOLUTION_PRINT, agentReferencePath, commandReferenceSections, loadGolden, readAgentReference,
  requireDistFile,
} from '../helpers.js'
import { DEVFLOW_PLUGINS, skillsOf } from '../../src/core/plugins.js'
import { resolvePluginsToInstall } from '../../src/cli/commands/init-seed.js'

const REFERENCE_DIR = 'commands'
const COMMANDS_DIR = path.join(ROOT, 'src', 'assets', 'commands')
/** The root a read site resolves first: the sanctioned resolution line. */
const READ_ROOTS = [SANCTIONED_RESOLUTION] as const
const READ_PATH_RE = /skills\/devflow:agent-references\/references\/commands\/([a-z0-9-]+\.md)/g

/** One section a command lost and a reference now holds, exactly. */
interface Moved {
  readonly reference: string
  readonly heading: string
  /** UTF-8 length of the removed text without its trailing newline. */
  readonly bytes: number
  /** SHA-256 of those bytes, taken from `main:src/assets/commands/implement.mds` and `_partials/_evidence_policy.mds`. The continuation path is re-pinned to its edited text: #452 turned its diff step into a guarded `BASE_BRANCH` record that Phases 3-7 read for the branch diff, and the lean lint pack added a step that takes `GATE_LEVEL` from the Phase 1 settings step for Phase 6. */
  readonly sha256: string
  readonly was: string
}

const MOVED: readonly Moved[] = [
  { reference: 'commands/implement-evidence-asks.md', heading: 'Ticket link ask', bytes: 1028, sha256: '438a2876f9ebcfc76694d8f0e4ce9b2fd2e5698eda65e4ec2f03b0c50348ae0c', was: 'implement.mds, the ticket-link ask and its two options' },
  { reference: 'commands/implement-evidence-asks.md', heading: 'Exception grammar', bytes: 1451, sha256: 'a9ab21080bbe77f0ea187471bf6d3d241cd69b11748cd37b95d119e5dad1260c', was: '_evidence_policy.mds, the body of evidence_exception()' },
  { reference: 'commands/implement-evidence-asks.md', heading: 'Record the exception', bytes: 566, sha256: '458cf3e415744aab954b2686f16d4c9fb5f1f3b9bfed1790e32a6a429d821ba8', was: 'implement.mds, the record paragraph' },
  { reference: 'commands/implement-evidence-asks.md', heading: 'Missing test plan ask', bytes: 1358, sha256: '032972c8f3a0443a7aed0863ce248e68393f26b666a940da80c1b0284558d59d', was: 'implement.mds, the missing-test-plan ask and its two options' },
  { reference: 'commands/implement-revalidate.md', heading: 'Continuation path', bytes: 1281, sha256: '182e5d9d84be0cf778dc9a578042d3c60416a9ae605cf6a6697be5cb689b07b8', was: 'implement.mds, the re-validation continuation path' },
]

const digest = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex')

/** Named collector: the moved sections whose text is absent or no longer what `main` held. */
export function collectMoveDefects(
  moved: readonly Moved[],
  read: (reference: string) => string,
): string[] {
  const out: string[] = []
  for (const m of moved) {
    const section = commandReferenceSections(read(m.reference)).find(s => s.heading === m.heading)
    if (section === undefined) { out.push(`${m.reference}: no \`## ${m.heading}\` section (was ${m.was})`); continue }
    const bytes = Buffer.byteLength(section.body, 'utf-8')
    if (bytes !== m.bytes) out.push(`${m.reference} ## ${m.heading}: ${bytes} bytes, main held ${m.bytes}`)
    else if (digest(section.body) !== m.sha256) out.push(`${m.reference} ## ${m.heading}: same length, different bytes`)
  }
  return out
}

describe('AC-405: the moved text is byte-identical to the text main held', () => {
  it('every moved section equals its pinned digest', () => {
    expect(MOVED.length, 'the move table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(5)
    expect(collectMoveDefects(MOVED, readAgentReference)).toEqual([])
  })

  it('known-bad probes: one changed character, a lost section and a re-wrapped line are each reported', () => {
    const asks = readAgentReference('commands/implement-evidence-asks.md')
    const changed = asks.replace('closed set; no other kind', 'closed set; on other kind')
    expect(changed, 'the seed must land').not.toBe(asks)
    expect(collectMoveDefects(MOVED, ref => (ref.endsWith('asks.md') ? changed : readAgentReference(ref)))).toEqual([
      'commands/implement-evidence-asks.md ## Exception grammar: same length, different bytes',
    ])
    expect(collectMoveDefects(MOVED, ref => (ref.endsWith('asks.md') ? asks.replace('## Record the exception', '## Record') : readAgentReference(ref)))).toEqual([
      'commands/implement-evidence-asks.md: no `## Record the exception` section (was implement.mds, the record paragraph)',
    ])
    const wrapped = asks.replace('Render it with the grammar below, as kind `ticket-link`;', 'Render it with the grammar below,\nas kind `ticket-link`;')
    expect(wrapped, 'the seed must land').not.toBe(asks)
    expect(collectMoveDefects(MOVED, ref => (ref.endsWith('asks.md') ? wrapped : readAgentReference(ref)))).toEqual([
      'commands/implement-evidence-asks.md ## Ticket link ask: same length, different bytes',
    ])
  })

  it('the fence-aware reader keeps the exception grammar whole across its `## ` template line', () => {
    const grammar = commandReferenceSections(readAgentReference('commands/implement-evidence-asks.md')).find(s => s.heading === 'Exception grammar')
    expect(grammar?.body).toContain('## Evidence Exceptions\n- `<kind>` self-attested by')
    expect(grammar?.body).toContain('the requester authors the reason.')
    expect(commandReferenceSections('## A\nx\n```\n## B\n```\ny\n## C\nz')).toEqual([
      { heading: 'A', body: 'x\n```\n## B\n```\ny' },
      { heading: 'C', body: 'z' },
    ])
  })
})

/** The `references/commands/` files, sorted. */
function referenceFiles(): string[] {
  return readdirSync(agentReferencePath(REFERENCE_DIR)).filter(f => f.endsWith('.md')).sort()
}

/** Every `.mds` under `src/assets/commands/` (hosts and partials), as {name, content}. */
function commandSources(): Array<{ name: string; content: string }> {
  const out: Array<{ name: string; content: string }> = []
  for (const dir of [COMMANDS_DIR, path.join(COMMANDS_DIR, '_partials')]) {
    for (const f of readdirSync(dir).filter(n => n.endsWith('.mds')).sort()) {
      out.push({ name: f.replace(/\.mds$/, ''), content: readFileSync(path.join(dir, f), 'utf-8') })
    }
  }
  return out
}

/** Named collector: the reference files a text names by read path. */
export function namedReferences(text: string): string[] {
  return [...new Set([...text.matchAll(READ_PATH_RE)].map(m => m[1]))].sort()
}

/** Named collector: what is wrong with one paragraph that names a reference by read path. */
export function collectReadSiteDefects(name: string, paragraph: string): string[] {
  const out: string[] = []
  const at = paragraph.search(/skills\/devflow:agent-references\//)
  const roots = READ_ROOTS.map(r => paragraph.indexOf(r)).filter(i => i >= 0)
  if (roots.length === 0) out.push(`${name}.mds: the read site must resolve a config-directory root before the path`)
  else if (Math.min(...roots) > at) out.push(`${name}.mds: the root comes after the path`)
  if (!paragraph.includes('with the Read tool')) out.push(`${name}.mds: the read goes through the Read tool`)
  return out
}

describe('AC-406: every read path exists, is read, and resolves the config directory first', () => {
  it('each path a command names is a file of the skill, and each file is named by a command', () => {
    const files = referenceFiles()
    expect(files, 'the reference directory is empty, so this guard proves nothing').toEqual(['code-review-levels.md', 'implement-evidence-asks.md', 'implement-levels.md', 'implement-revalidate.md', 'plan-levels.md', 'resolve-levels.md'])
    const named = new Map(commandSources().map(s => [s.name, namedReferences(s.content)] as const).filter(([, refs]) => refs.length > 0))
    expect([...named.keys()], 'only a host reads a reference, never a shared partial').toEqual(['code-review', 'implement', 'plan', 'resolve'])
    const all = [...new Set([...named.values()].flat())].sort()
    expect(all.filter(f => !existsSync(agentReferencePath(`${REFERENCE_DIR}/${f}`))), 'a named path with no file').toEqual([])
    expect(files.filter(f => !all.includes(f)), 'a reference no command reads').toEqual([])
  })

  it('each read site resolves the config directory in Bash first, and the compiled command carries the path', () => {
    for (const { name, content } of commandSources()) {
      const paragraphs = content.split('\n\n').filter(p => namedReferences(p).length > 0)
      for (const p of paragraphs) expect(collectReadSiteDefects(name, p)).toEqual([])
      if (paragraphs.length > 0) {
        const built = requireDistFile(`${name}.md`)
        expect(namedReferences(built), `${name}: the compiled command names the same files`).toEqual(namedReferences(content))
      }
    }
    expect(namedReferences(requireDistFile('implement.md'))).toEqual(['implement-evidence-asks.md', 'implement-levels.md', 'implement-revalidate.md'])
    expect(namedReferences(requireDistFile('code-review.md'))).toEqual(['code-review-levels.md'])
    expect(namedReferences(requireDistFile('plan.md'))).toEqual(['plan-levels.md'])
    expect(namedReferences(requireDistFile('resolve.md'))).toEqual(['resolve-levels.md'])
  })

  it('known-bad probes: a path with no file and a read without the config-directory step are told apart', () => {
    expect(namedReferences('Read `<d>/skills/devflow:agent-references/references/commands/nope.md`')).toEqual(['nope.md'])
    expect(existsSync(agentReferencePath(`${REFERENCE_DIR}/nope.md`))).toBe(false)
    expect(namedReferences('no path here')).toEqual([])
  })

  it('known-bad probes: no root, a root after the path and a missing Read-tool phrase are each reported, and the sanctioned resolution line is accepted as the read root', () => {
    const target = 'skills/devflow:agent-references/references/commands/x.md'
    const sanctioned = READ_ROOTS[0]
    expect(collectReadSiteDefects('probe', `Read \`<d>/${target}\` with the Read tool.`))
      .toEqual(['probe.mds: the read site must resolve a config-directory root before the path'])
    expect(collectReadSiteDefects('probe', `Read \`<d>/${target}\` with the Read tool, after resolving ${sanctioned}.`))
      .toEqual(['probe.mds: the root comes after the path'])
    expect(collectReadSiteDefects('probe', `Resolve ${sanctioned} in Bash and Read \`<d>/${target}\`.`))
      .toEqual(['probe.mds: the read goes through the Read tool'])
    expect(collectReadSiteDefects('probe', `Run \`d="$HOME/.claude";\` in Bash and Read \`<d>/${target}\` with the Read tool.`))
      .toEqual(['probe.mds: the read site must resolve a config-directory root before the path'])
    expect(collectReadSiteDefects('probe', `Resolve ${RETIRED_INLINE_EXPANSION} in Bash and Read \`<d>/${target}\` with the Read tool.`))
      .toEqual(['probe.mds: the read site must resolve a config-directory root before the path'])
    expect(collectReadSiteDefects('probe', `Run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash and Read \`<d>/${target}\` with the Read tool.`)).toEqual([])
  })

  it('a selection of any plugin that uses a reference installs the skill, and the install goldens list each file', () => {
    const hosts = commandSources().filter(s => namedReferences(s.content).length > 0).map(s => s.name)
    expect(hosts.length).toBeGreaterThanOrEqual(1)
    for (const host of hosts) {
      const users = DEVFLOW_PLUGINS.filter(p => p.commands.includes(`/${host}`))
      expect(users.map(p => p.name), `${host}: no plugin owns the command`).not.toEqual([])
      for (const plugin of users) {
        const installed = resolvePluginsToInstall([plugin.name], false, DEVFLOW_PLUGINS)
        expect(installed.map(p => p.name), `${plugin.name}: devflow-core-skills joins every selection`).toContain('devflow-core-skills')
        expect(skillsOf(installed).has(AGENT_REFERENCES_SKILL), `${plugin.name}: the skill is in its install closure`).toBe(true)
      }
    }
    for (const config of ['github', 'jira-hipaa']) {
      const golden = loadGolden(`install-snapshot-${config}.txt`)
      for (const f of referenceFiles()) {
        expect(golden, `install-snapshot-${config}.txt lists ${f}`).toContain(`- .claude/skills/devflow:agent-references/references/commands/${f}`)
      }
    }
  })
})

describe('the moved text carries no learning arm and no Git spawn (D-10)', () => {
  it('no reference holds a learning marker or a Git agent fence', () => {
    const files = referenceFiles()
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const f of files) {
      const text = readAgentReference(`${REFERENCE_DIR}/${f}`)
      expect(text, `${f}: a learning arm cannot be split across files`).not.toMatch(/<!-- learning:/)
      expect(text, `${f}: a Git spawn fence is read by guards that scan the command`).not.toMatch(/Agent\(subagent_type="Git"\)/)
    }
  })

  it('no plugin lists agent-references in requires, and only devflow-core-skills owns it', () => {
    expect(DEVFLOW_PLUGINS.length).toBeGreaterThanOrEqual(10)
    expect(DEVFLOW_PLUGINS.filter(p => p.requires.includes(AGENT_REFERENCES_SKILL)).map(p => p.name)).toEqual([])
    expect(DEVFLOW_PLUGINS.filter(p => p.skills.includes(AGENT_REFERENCES_SKILL)).map(p => p.name)).toEqual(['devflow-core-skills'])
  })
})
