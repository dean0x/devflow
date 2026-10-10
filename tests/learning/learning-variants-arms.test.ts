/**
 * The learning arms of the real prompts (D-LEARNING-VARIANTS; AC-127 to AC-131,
 * AC-133, AC-138, AC-153).
 *
 * tests/learning/learning-variants.test.ts holds the splitter and
 * tests/learning/learning-variants-build.test.ts the build wiring, both over fixtures.
 * This file holds the ARMS THE COMMANDS AND AGENTS ACTUALLY CARRY, read from the built
 * tree:
 *
 *   parity        each learning-on variant is the compiled host with every arm resolved
 *                 on, and each learning-off variant the same with every arm resolved off
 *                 (an independent line scanner, not the splitter the build uses);
 *   arms          an on arm is learning text, an off arm never is. A substitution pair
 *                 whose two sides differ only in a list or step number is structural:
 *                 the item follows a learning-only item, so its number depends on the
 *                 variant;
 *   off tree      nothing under dist/learning-off holds a learning token, and no off agent
 *                 preloads apply-decisions. The one thing outside the rule is the settings
 *                 block's grammar line, which names the LEARNING field of the line the
 *                 resolver prints: SETTINGS_LINE_RE is pinned and the field does not
 *                 move, so the 8 off hosts that keep the block keep that line;
 *   completeness  every artifact that holds a token has an off counterpart, the Learning
 *                 agent excepted (it runs only when learning is on);
 *   frontmatter   an off agent's frontmatter is its on frontmatter minus the preload line;
 *   settings      14 hosts carry the settings block when learning is on, 8 when it is off;
 *   anchors       no status-line anchor the sampler reads sits inside an arm, and no off
 *                 arm repeats one, so the frozen fixture is untouched.
 *
 * Counts are test-local constants beside the assertion that uses them.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'fs'
import * as path from 'path'
import { init, compileFile } from '@mdscript/mds'

import {
  ROOT,
  parseFrontmatterSkills,
  requireDistFile,
  requireDistFiles,
  resolveAgentSource,
  resolveLearningOffSource,
  walkFiles,
} from '../helpers.js'
import {
  LEARNING_OFF_FILES,
  LEARNING_VARIANT_HOSTS,
  MDS_COMMAND_HOSTS,
  MDS_GENERATOR_HOSTS,
  SETTINGS_BLOCK_HOSTS,
  SETTINGS_BLOCK_HOSTS_LEARNING_OFF,
} from '../fixtures/mds-manifest.js'
import { LEARNING_OFF_OUTPUT_DIR } from '../../src/core/learning-variants.js'

/** Settings blocks in the learning-on build: all 14 command hosts. */
const ON_BLOCK_COUNT = 14
/** Settings blocks in the learning-off build: the hosts with a consumer other than learning. */
const OFF_BLOCK_COUNT = 8

const TOKEN_RE = /DECISIONS_CONTEXT|decisions_context|apply-decisions|learning\/index\.md|learning\/decisions\.md|LEARNING/
/** What an on arm may hold besides a token: the heading, step and tree wording that names decisions. */
const LEARNING_WORD_RE = /\b[Dd]ecisions?\b|\bADR\b|pitfall/
const MARKER_RE = /^[ \t]*<!-- learning:(on|off|end) -->[ \t]*$/
const SETTINGS_OPENING = '**Resolve the settings line**'
/** The settings grammar paragraph: one line, naming every field of the resolver's output, LEARNING included. */
const SETTINGS_GRAMMAR_LINE_RE = /TRACKER=<github\|jira\|linear>/
const PRELOAD = 'devflow:apply-decisions'

const OFF_DIR = path.join(ROOT, LEARNING_OFF_OUTPUT_DIR)

type Kind = 'commands' | 'agents'
interface Host { readonly kind: Kind; readonly name: string; readonly source: string }

/** Named collector: every host the build compiles into a prompt — the 14 commands and the generator-host agents. */
function collectHosts(): Host[] {
  return [
    ...MDS_COMMAND_HOSTS.map(name => ({ kind: 'commands' as const, name, source: path.join(ROOT, 'src/assets/commands', `${name}.mds`) })),
    ...MDS_GENERATOR_HOSTS.map(name => ({ kind: 'agents' as const, name, source: path.join(ROOT, 'src/assets/agents', `${name}.mds`) })),
  ]
}

// ── An independent reader of the arms ───────────────────────────────────────

/** The body with every arm resolved to one variant: the line scanner the build's splitter is checked against. */
function resolveArms(body: string, variant: 'on' | 'off'): string {
  const out: string[] = []
  let arm: 'on' | 'off' | null = null
  for (const line of body.split('\n')) {
    const marker = MARKER_RE.exec(line)
    if (marker !== null) { arm = marker[1] === 'end' ? null : (marker[1] as 'on' | 'off'); continue }
    if (arm === null || arm === variant) out.push(line)
  }
  return out.join('\n')
}

/** One arm group: the text of its on side and of its off side (null when the group has no such side). */
interface ArmGroup { on: string | null; off: string | null }

/** Named collector: the arm groups of a body, an `off` directly after an `on` being its partner. */
function collectArmGroups(body: string): ArmGroup[] {
  const groups: ArmGroup[] = []
  let current: ArmGroup | null = null
  let side: 'on' | 'off' | null = null
  const buffer: string[] = []
  const flush = (): void => {
    if (current !== null && side !== null) current[side] = buffer.join('\n')
    buffer.length = 0
  }
  for (const line of body.split('\n')) {
    const marker = MARKER_RE.exec(line)
    if (marker === null) { if (side !== null) buffer.push(line); continue }
    if (marker[1] === 'on') { current = { on: null, off: null }; groups.push(current); side = 'on' }
    else if (marker[1] === 'off') {
      flush()
      if (current === null || current.off !== null || side === null) { current = { on: null, off: null }; groups.push(current) }
      side = 'off'
    } else { flush(); side = null; current = null }
  }
  return groups
}

/** Both sides differ only in their numbers: a renumbered list item or step heading. */
function onlyRenumbered(a: string, b: string): boolean {
  return a !== b && a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#')
}

/** Named collector: the arm problems of one body — an on side without learning text, an off side with a token. */
function collectArmDefects(label: string, body: string): string[] {
  const out: string[] = []
  collectArmGroups(body).forEach((group, i) => {
    if (group.on !== null) {
      const learning = TOKEN_RE.test(group.on) || LEARNING_WORD_RE.test(group.on)
      const structural = group.off !== null && onlyRenumbered(group.on, group.off)
      if (!learning && !structural) out.push(`${label}: on arm ${i + 1} holds no learning text — "${group.on.trim().slice(0, 60)}"`)
    }
    if (group.off !== null && TOKEN_RE.test(group.off)) out.push(`${label}: off arm ${i + 1} holds a learning token — "${group.off.trim().slice(0, 60)}"`)
  })
  return out
}

/** The text with the settings grammar paragraph removed: the one place the LEARNING field is named in an off build. */
function withoutSettingsGrammar(text: string): string {
  return text.split('\n').filter(l => !SETTINGS_GRAMMAR_LINE_RE.test(l)).join('\n')
}

/** Named collector: the learning tokens one off-variant text holds, the settings grammar line aside. */
function collectOffTokens(label: string, text: string): string[] {
  return withoutSettingsGrammar(text).split('\n')
    .map((line, i) => [line, i + 1] as const)
    .filter(([line]) => TOKEN_RE.test(line))
    .map(([line, n]) => `${label}:${n}: ${line.trim().slice(0, 70)}`)
}

/** The leading frontmatter block of a text, `---` to `---`, or '' when it opens with none. */
function frontmatterOf(text: string): string {
  if (!text.startsWith('---\n')) return ''
  const end = text.indexOf('\n---\n', 4)
  return end === -1 ? '' : text.slice(0, end + 5)
}

/** The text without its first frontmatter block. */
function withoutFirstBlock(text: string): string {
  const block = frontmatterOf(text)
  return text.slice(block.length)
}

let rawBodies: ReadonlyMap<string, string>

beforeAll(async () => {
  await init()
  const bodies = new Map<string, string>()
  for (const host of collectHosts()) {
    const result = await compileFile(host.source)
    if (result.kind !== 'markdown') throw new Error(`${host.source} did not compile to Markdown`)
    bodies.set(`${host.kind}/${host.name}`, result.output)
  }
  rawBodies = bodies
}, 120_000)

const rawBody = (host: Host): string => {
  const body = rawBodies.get(`${host.kind}/${host.name}`)
  if (body === undefined) throw new Error(`no compiled body for ${host.kind}/${host.name}`)
  return body
}

/** The learning-on file of a host, as the build wrote it. */
const onFile = (host: Host): string => readFileSync(path.join(ROOT, 'dist', host.kind, `${host.name}.md`), 'utf-8')

/**
 * The body a variant file must equal for a raw compiled body, past the first frontmatter block. A command
 * host's first block holds its build-owned keys (the build sheds some, keeps the rest), so the comparison
 * starts after it on both sides; an agent host's first block is its steering block, which the build sheds
 * whole, so only the raw side loses it. Either way an agent keeps its own frontmatter, which AC-131 holds.
 */
function expectedVariant(raw: string, variant: 'on' | 'off'): string {
  return withoutFirstBlock(resolveArms(raw, variant))
}

/** The variant file as it is compared with `expectedVariant`: a command loses its first block as the raw side did. */
function comparable(host: Host, file: string): string {
  return host.kind === 'commands' ? withoutFirstBlock(file) : file
}

describe('the roster of arm-bearing hosts is the hosts whose compiled body carries a marker', () => {
  it('a host has a learning-off variant exactly when its compiled body carries an arm', () => {
    const withArms = collectHosts().filter(h => rawBody(h).split('\n').some(l => MARKER_RE.test(l))).map(h => `${h.kind}/${h.name}`).sort()
    expect(withArms).toEqual([...LEARNING_VARIANT_HOSTS].sort())
  })

  it('git is a generator host with no arm, so it has no variant', () => {
    expect(MDS_GENERATOR_HOSTS).toContain('git')
    expect(LEARNING_VARIANT_HOSTS).not.toContain('agents/git')
  })
})

describe('parity: each variant is the compiled host with its arms resolved (AC-127)', () => {
  it('the learning-on file of every arm-bearing host equals the body with every arm resolved on', () => {
    const hosts = collectHosts().filter(h => LEARNING_VARIANT_HOSTS.includes(`${h.kind}/${h.name}`))
    expect(hosts.length, 'arm-bearing hosts').toBeGreaterThanOrEqual(23)
    for (const host of hosts) {
      const raw = rawBody(host)
      expect(comparable(host, onFile(host)), `${host.kind}/${host.name} learning-on`).toBe(expectedVariant(raw, 'on'))
    }
  })

  it('the learning-off file of every arm-bearing host equals the body with every arm resolved off', () => {
    const hosts = collectHosts().filter(h => LEARNING_VARIANT_HOSTS.includes(`${h.kind}/${h.name}`))
    for (const host of hosts) {
      const off = resolveLearningOffSource(host.kind, host.name)
      expect(off, `${host.kind}/${host.name} has a learning-off file`).not.toBeNull()
      expect(comparable(host, off as string), `${host.kind}/${host.name} learning-off`).toBe(expectedVariant(rawBody(host), 'off'))
    }
  })

  it('known-bad probe: an on file with one extra line, and an off file that kept an on line, are reported', () => {
    const host = collectHosts().find(h => h.kind === 'commands' && h.name === 'research') as Host
    const raw = rawBody(host)
    const on = comparable(host, onFile(host))
    expect(on).toBe(expectedVariant(raw, 'on'))
    expect(`${on}\nstray`).not.toBe(expectedVariant(raw, 'on'))
    const off = comparable(host, resolveLearningOffSource('commands', 'research') as string)
    const leaked = off.replace('### Phase 1: Load Context (Orchestrator-Local)', '### Phase 1: Load Decisions (Orchestrator-Local)')
    expect(leaked).not.toBe(off)
    expect(leaked).not.toBe(expectedVariant(raw, 'off'))
  })

  it('the independent scanner resolves an arm pair, an else and a lone on arm the way the build does', () => {
    const body = ['a', '<!-- learning:on -->', 'x', '<!-- learning:off -->', 'y', '<!-- learning:end -->', 'b', '  <!-- learning:on -->', 'z', '  <!-- learning:end -->', 'c'].join('\n')
    expect(resolveArms(body, 'on')).toBe('a\nx\nb\nz\nc')
    expect(resolveArms(body, 'off')).toBe('a\ny\nb\nc')
  })
})

describe('every on arm is learning text and no off arm is (AC-128)', () => {
  it('holds in every arm-bearing host', () => {
    const defects = collectHosts().flatMap(h => collectArmDefects(`${h.kind}/${h.name}`, rawBody(h)))
    expect(defects).toEqual([])
  })

  it('the arms are found: every host carries at least one group, and the corpus holds both sides', () => {
    const groups = collectHosts().filter(h => LEARNING_VARIANT_HOSTS.includes(`${h.kind}/${h.name}`)).flatMap(h => collectArmGroups(rawBody(h)))
    expect(groups.length, 'arm groups found').toBeGreaterThanOrEqual(100)
    expect(groups.some(g => g.on !== null && g.off !== null), 'a substitution pair').toBe(true)
    expect(groups.some(g => g.on !== null && g.off === null), 'a lone on arm').toBe(true)
  })

  it('known-bad probes: an on arm with unrelated text, an off arm with a token, and an unrelated substitution are reported', () => {
    const wrap = (...parts: string[]): string => parts.join('\n')
    expect(collectArmDefects('p', wrap('<!-- learning:on -->', 'Hello world', '<!-- learning:end -->'))).toEqual([
      'p: on arm 1 holds no learning text — "Hello world"',
    ])
    expect(collectArmDefects('p', wrap('<!-- learning:on -->', 'DECISIONS_CONTEXT: x', '<!-- learning:off -->', 'DECISIONS_CONTEXT: y', '<!-- learning:end -->'))).toEqual([
      'p: off arm 1 holds a learning token — "DECISIONS_CONTEXT: y"',
    ])
    expect(collectArmDefects('p', wrap('<!-- learning:on -->', '4. **Assess**', '<!-- learning:off -->', '3. **Assess**', '<!-- learning:end -->'))).toEqual([])
    expect(collectArmDefects('p', wrap('<!-- learning:on -->', '4. **Assess**', '<!-- learning:off -->', '3. **Weigh**', '<!-- learning:end -->'))).toHaveLength(1)
  })
})

describe('nothing under dist/learning-off holds a learning token, and no off agent preloads apply-decisions (AC-129)', () => {
  const offFiles = (): string[] => walkFiles(OFF_DIR, f => f.endsWith('.md')).map(f => path.relative(OFF_DIR, f).split(path.sep).join('/'))

  it('the tree is non-empty and holds exactly the roster', () => {
    expect(offFiles().sort()).toEqual([...LEARNING_OFF_FILES].sort())
  })

  it('no file holds a token outside the settings grammar line', () => {
    const found = offFiles().flatMap(rel => collectOffTokens(rel, readFileSync(path.join(OFF_DIR, rel), 'utf-8')))
    expect(found).toEqual([])
  })

  it('no off agent preloads apply-decisions, and every agent that declared it still does when learning is on', () => {
    const offAgents = offFiles().filter(rel => rel.startsWith('agents/'))
    expect(offAgents.length, 'off agents').toBe(9)
    for (const rel of offAgents) {
      const name = path.basename(rel, '.md')
      expect(parseFrontmatterSkills(readFileSync(path.join(OFF_DIR, rel), 'utf-8')), `${rel} preload`).not.toContain('apply-decisions')
      expect(readFileSync(path.join(OFF_DIR, rel), 'utf-8'), `${rel} names the skill`).not.toContain(PRELOAD)
      const on = parseFrontmatterSkills(resolveAgentSource(name).content)
      if (['skim'].includes(name)) expect(on, `${name} never preloaded it`).not.toContain('apply-decisions')
      else expect(on, `${name} preloads it when learning is on`).toContain('apply-decisions')
    }
  })

  it('the learning-on tree is the contrast: it holds tokens in every host', () => {
    for (const rel of offFiles()) {
      const text = readFileSync(path.join(ROOT, 'dist', rel), 'utf-8')
      expect(TOKEN_RE.test(withoutSettingsGrammar(text)), `${rel} (learning-on)`).toBe(true)
    }
  })

  it('known-bad probes: a leaked token, a leaked preload and a leaked gate sentence are reported', () => {
    const sample = readFileSync(path.join(OFF_DIR, 'commands/research.md'), 'utf-8')
    expect(collectOffTokens('r', sample)).toEqual([])
    expect(collectOffTokens('r', `${sample}\nPass \`DECISIONS_CONTEXT\` on.`)).toHaveLength(1)
    expect(collectOffTokens('r', `${sample}\nWhen the settings line says \`LEARNING=off\`, skip.`)).toHaveLength(1)
    expect(parseFrontmatterSkills('---\nskills:\n  - devflow:apply-decisions\n---\n')).toContain('apply-decisions')
  })

  it('the settings grammar line is the one exemption: it is exempt only by its template', () => {
    const block = requireDistFile('implement.md').split('\n').filter(l => SETTINGS_GRAMMAR_LINE_RE.test(l))
    expect(block, 'one grammar line in the learning-on implement.md').toHaveLength(1)
    expect(TOKEN_RE.test(block[0])).toBe(true)
    expect(collectOffTokens('r', block[0])).toEqual([])
    expect(collectOffTokens('r', block[0].replace('TRACKER=<github|jira|linear>', 'TRACKER=<x>'))).toHaveLength(1)
  })
})

describe('completeness: every artifact that holds a token has an off counterpart (AC-130)', () => {
  /** The prompts an install lays down: the compiled commands and every agent, compiled or hand-authored. */
  function collectArtifacts(): Array<{ rel: string; text: string }> {
    const commands = requireDistFiles().map(f => ({ rel: `commands/${f}`, text: requireDistFile(f) }))
    const compiled = new Set(readdirSync(path.join(ROOT, 'dist/agents')))
    const handAuthored = readdirSync(path.join(ROOT, 'src/assets/agents')).filter(f => f.endsWith('.md') && !compiled.has(f))
    const agents = [
      ...[...compiled].filter(f => f.endsWith('.md')).map(f => ({ rel: `agents/${f}`, text: readFileSync(path.join(ROOT, 'dist/agents', f), 'utf-8') })),
      ...handAuthored.map(f => ({ rel: `agents/${f}`, text: readFileSync(path.join(ROOT, 'src/assets/agents', f), 'utf-8') })),
    ]
    return [...commands, ...agents]
  }

  /** The one artifact that is allowed to hold learning text and have no variant: it runs only when learning is on. */
  const EXEMPT = 'agents/learning.md'

  function collectMissingCounterparts(artifacts: ReadonlyArray<{ rel: string; text: string }>, hasOff: (rel: string) => boolean): string[] {
    return artifacts
      .filter(a => a.rel !== EXEMPT && TOKEN_RE.test(withoutSettingsGrammar(a.text)) && !hasOff(a.rel))
      .map(a => `${a.rel} holds a learning token and has no learning-off variant`)
  }

  it('every artifact with a token outside the settings grammar has a file under dist/learning-off', () => {
    const artifacts = collectArtifacts()
    expect(artifacts.length, 'artifacts scanned').toBeGreaterThanOrEqual(25)
    expect(artifacts.map(a => a.rel), 'the Learning agent is among them, so the exemption is exercised').toContain(EXEMPT)
    expect(collectMissingCounterparts(artifacts, rel => existsSync(path.join(OFF_DIR, rel)))).toEqual([])
  })

  it('every artifact whose only token is the settings grammar still has a variant when it carries a learning arm', () => {
    const artifacts = collectArtifacts().filter(a => a.rel.startsWith('commands/'))
    for (const a of artifacts) expect(existsSync(path.join(OFF_DIR, a.rel)), a.rel).toBe(true)
  })

  it('known-bad probes: an artifact with a token and no variant is reported, and the Learning agent is not', () => {
    const probe = [
      { rel: 'agents/triage.md', text: 'Use DECISIONS_CONTEXT.' },
      { rel: EXEMPT, text: 'Reads learning/decisions.md.' },
      { rel: 'agents/validate.md', text: 'No token here.' },
    ]
    expect(collectMissingCounterparts(probe, () => false)).toEqual(['agents/triage.md holds a learning token and has no learning-off variant'])
    expect(collectMissingCounterparts(probe, rel => rel === 'agents/triage.md')).toEqual([])
  })
})

describe('an off agent\'s frontmatter is its on frontmatter minus the preload line (AC-131)', () => {
  const AGENTS_WITH_PRELOAD = ['code', 'design', 'diagnose', 'knowledge', 'research', 'review', 'scrutinize', 'triage'] as const

  /** Named collector: how an off frontmatter differs from the on frontmatter beyond the preload line. */
  function collectFrontmatterDefects(name: string, on: string, off: string): string[] {
    const expected = frontmatterOf(on).split('\n').filter(l => l.trim() !== `- ${PRELOAD}`).join('\n')
    const actual = frontmatterOf(off)
    return actual === expected ? [] : [`${name}: the off frontmatter is not the on frontmatter minus the preload line`]
  }

  it('holds for the eight agents that preload the skill, and Skim\'s frontmatter is unchanged', () => {
    for (const name of AGENTS_WITH_PRELOAD) {
      const on = resolveAgentSource(name).content
      const off = resolveLearningOffSource('agents', name) as string
      expect(frontmatterOf(on), `${name} on frontmatter`).toContain(`- ${PRELOAD}`)
      expect(collectFrontmatterDefects(name, on, off), name).toEqual([])
    }
    const skimOn = resolveAgentSource('skim').content
    expect(frontmatterOf(resolveLearningOffSource('agents', 'skim') as string)).toBe(frontmatterOf(skimOn))
  })

  it('known-bad probes: a model change in the off frontmatter, and a kept preload, are reported', () => {
    const on = resolveAgentSource('triage').content
    const off = resolveLearningOffSource('agents', 'triage') as string
    expect(collectFrontmatterDefects('triage', on, off.replace(/^model: \w+$/m, 'model: haiku'))).toHaveLength(1)
    expect(collectFrontmatterDefects('triage', on, on)).toHaveLength(1)
  })
})

describe('settings blocks per variant (AC-138)', () => {
  const carrying = (read: (host: string) => string | null): string[] =>
    MDS_COMMAND_HOSTS.filter(h => (read(h) ?? '').includes(SETTINGS_OPENING)).sort()

  it('the learning-on build carries the block in all 14 hosts, once each', () => {
    expect(carrying(h => requireDistFile(`${h}.md`))).toEqual([...SETTINGS_BLOCK_HOSTS].sort())
    expect(SETTINGS_BLOCK_HOSTS).toHaveLength(ON_BLOCK_COUNT)
    for (const h of MDS_COMMAND_HOSTS) expect(requireDistFile(`${h}.md`).split(SETTINGS_OPENING).length - 1, h).toBe(1)
  })

  it('the learning-off build carries it in the 8 hosts with a consumer other than learning, and the other six sit in the on arm', () => {
    const off = carrying(h => resolveLearningOffSource('commands', h))
    expect(off).toEqual([...SETTINGS_BLOCK_HOSTS_LEARNING_OFF].sort())
    expect(off).toHaveLength(OFF_BLOCK_COUNT)
    const sixOnly = SETTINGS_BLOCK_HOSTS.filter(h => !(SETTINGS_BLOCK_HOSTS_LEARNING_OFF as readonly string[]).includes(h))
    expect(sixOnly).toHaveLength(ON_BLOCK_COUNT - OFF_BLOCK_COUNT)
    for (const h of sixOnly) {
      const group = collectArmGroups(rawBody({ kind: 'commands', name: h, source: '' })).find(g => g.on !== null && g.on.includes(SETTINGS_OPENING))
      expect(group, `${h}: the block sits inside a learning-on arm`).toBeDefined()
      expect(resolveLearningOffSource('commands', h), `${h} (learning-off)`).not.toContain(SETTINGS_OPENING)
    }
  })

  it('each off host that keeps the block has a consumer left that is not learning', () => {
    for (const h of SETTINGS_BLOCK_HOSTS_LEARNING_OFF) {
      const text = resolveLearningOffSource('commands', h) as string
      const consumers = ['**Resolve the compliance lens**', '**Resolve `REVIEW_PUBLICATION` per worktree:**', 'take the settings line resolved above for that root']
      expect(consumers.some(c => text.includes(c)), `${h}: a surviving consumer of the settings line`).toBe(true)
    }
  })

  it('the runtime gate and Skim\'s LEARNING skip live in the learning-on build only', () => {
    for (const h of MDS_COMMAND_HOSTS) {
      expect(requireDistFile(`${h}.md`), `${h} (learning-on)`).toContain('When the settings line says `LEARNING=off`')
      expect(resolveLearningOffSource('commands', h), `${h} (learning-off)`).not.toContain('When the settings line says `LEARNING=off`')
    }
    expect(resolveAgentSource('skim').content).toContain('When `LEARNING` is `off`, skip this step')
    const skimOff = resolveLearningOffSource('agents', 'skim') as string
    expect(skimOff).not.toContain('LEARNING')
    expect(skimOff).not.toContain('### Step 6: Project Knowledge')
    expect(skimOff).toContain('### Step 6: Generate Summary')
    expect(skimOff).not.toContain('### Active Decisions')
  })
})

describe('no status-line anchor sits inside an arm, and no off arm repeats one (AC-153)', () => {
  /** The anchors the status-line sampler reads from a source file, taken from the sampler itself. */
  function collectSamplerAnchors(): Array<{ target: 'code' | 'dynamicBuild' | 'resolveMds'; anchor: string }> {
    const helpers = readFileSync(path.join(ROOT, 'tests/helpers.ts'), 'utf-8')
    return [...helpers.matchAll(/singleLine\((code|dynamicBuild|resolveMds), '((?:[^'\\]|\\.)*)'\)/g)]
      .map(m => ({ target: m[1] as 'code' | 'dynamicBuild' | 'resolveMds', anchor: m[2].replace(/\\'/g, "'") }))
  }

  const SOURCE_OF = {
    code: 'src/assets/agents/code.mds',
    dynamicBuild: 'src/assets/commands/dynamic-build.mds',
    resolveMds: 'src/assets/commands/resolve.mds',
  } as const

  /** Named collector: anchors that are absent, repeated, or inside an arm of their source file. */
  function collectAnchorDefects(anchors: ReadonlyArray<{ target: keyof typeof SOURCE_OF; anchor: string }>, read: (rel: string) => string): string[] {
    const out: string[] = []
    for (const { target, anchor } of anchors) {
      const rel = SOURCE_OF[target]
      const lines = read(rel).split('\n')
      const hits = lines.map((l, i) => [l, i] as const).filter(([l]) => l.includes(anchor)).map(([, i]) => i)
      if (hits.length !== 1) { out.push(`${rel}: "${anchor.slice(0, 50)}" appears ${hits.length} times, expected once`); continue }
      let arm: string | null = null
      for (let i = 0; i < hits[0]; i++) {
        const m = MARKER_RE.exec(lines[i])
        if (m !== null) arm = m[1] === 'end' ? null : m[1]
      }
      if (arm !== null) out.push(`${rel}: "${anchor.slice(0, 50)}" sits inside a learning:${arm} arm`)
    }
    return out
  }

  const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf-8')

  it('the sampler reads 11 source anchors: 3 from code, 2 from dynamic-build and 6 from resolve', () => {
    const anchors = collectSamplerAnchors()
    expect(anchors.filter(a => a.target === 'code')).toHaveLength(3)
    expect(anchors.filter(a => a.target === 'dynamicBuild')).toHaveLength(2)
    expect(anchors.filter(a => a.target === 'resolveMds')).toHaveLength(6)
  })

  it('no anchor is inside an arm and each appears once in its source', () => {
    expect(collectAnchorDefects(collectSamplerAnchors(), read)).toEqual([])
  })

  it('no learning-off file repeats an anchor line, so the sampler reading the on variant meets each once', () => {
    for (const { target, anchor } of collectSamplerAnchors()) {
      const off = target === 'code'
        ? resolveLearningOffSource('agents', 'code')
        : resolveLearningOffSource('commands', target === 'dynamicBuild' ? 'dynamic-build' : 'resolve')
      const copies = (off ?? '').split('\n').filter(l => l.includes(anchor)).length
      expect(copies, `"${anchor.slice(0, 50)}" in the learning-off build`).toBeLessThanOrEqual(1)
    }
  })

  it('known-bad probes: an anchor inside an arm, a repeated anchor and a vanished anchor are reported', () => {
    const anchors = [{ target: 'code' as const, anchor: 'ANCHOR LINE' }]
    const at = (body: string): string[] => collectAnchorDefects(anchors, () => body)
    expect(at('a\nANCHOR LINE\nb')).toEqual([])
    expect(at('a\n<!-- learning:on -->\nANCHOR LINE\n<!-- learning:end -->\nb')).toEqual(['src/assets/agents/code.mds: "ANCHOR LINE" sits inside a learning:on arm'])
    expect(at('ANCHOR LINE\nANCHOR LINE')).toEqual(['src/assets/agents/code.mds: "ANCHOR LINE" appears 2 times, expected once'])
    expect(at('nothing')).toEqual(['src/assets/agents/code.mds: "ANCHOR LINE" appears 0 times, expected once'])
  })
})
