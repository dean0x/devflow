/**
 * spawn-no-hardcoded-model — no spawn in the shipped prompt corpus names a model.
 *
 * D-SPAWN-NO-MODEL: the model of an agent is its installed frontmatter `model:`,
 * and that is where `devflow agents` applies a user's override. A spawn that
 * names a model of its own overrides the frontmatter at spawn time, so a user's
 * override for that agent never reaches the spawn. Five `Validate` spawns did
 * exactly that with `model="haiku"`, which equals the shipped tier today and is
 * invisible until a user overrides `validate`. The rule is the same one the
 * workflow preamble states for `agent()` options (omit `opts.model` whenever
 * `agentType` is set), and this guard is the mechanical form of both. The spawn
 * lines themselves carry no marker: an HTML comment survives into
 * `dist/commands`, so a marker there would cost prompt tokens on every run.
 *
 * What it asserts
 * ---------------
 * Over `src/assets/{commands,agents,skills,mds}` and `dist/{commands,agents}`
 * (`.md` and `.mds` files):
 *   - no `Agent(` spawn has a `model=` (or `model:`) among its arguments, and
 *   - no workflow `agent(` call has a `model` key in its options object.
 * Argument text is read with string and template-literal bodies blanked, so a
 * `model=` quoted inside a prompt is not an argument; the prompt that follows an
 * `Agent(...):` line sits outside the parentheses and is never scanned.
 *
 * Hook scripts sit outside the scan by design: the Tracker directive pins its
 * model, and the Learning directive emits one only under the precedence the
 * session-start hook documents.
 *
 * Why a green run is not enough on its own (and what backs it)
 * -----------------------------------------------------------
 *  - Reach: every scanned root must contribute files, and the roots that hold
 *    spawns must contribute sites, so a root that goes missing fails by name
 *    instead of leaving the others to look sufficient.
 *  - Matcher: both forms are seeded as known-bad and must be flagged, beside
 *    compliant and prose-only controls that must not be.
 *  - Count: the scan must find at least AGENT_SITE_FLOOR `Agent(` sites, the
 *    count measured when the guard was added. A parser that stops finding spawns
 *    would otherwise pass vacuously. The floor is registered in
 *    tests/fixtures/numeric-floors.json and only rises.
 *
 * What a green run does NOT prove: a spawn assembled at runtime (a model value
 * passed in a variable options object, a string-built call) and prose that merely
 * describes a spawn are not matches, and a call whose parentheses never balance
 * within MAX_CALL_CHARS is read up to that bound only.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js'


/** The trees the guard reads, relative to the repository root. */
const SCANNED_ROOTS = [
  'src/assets/commands',
  'src/assets/agents',
  'src/assets/skills',
  'src/assets/mds',
  'dist/commands',
  'dist/agents',
] as const

/** The roots that hold spawns: each must contribute at least one `Agent(` site. */
const SPAWN_HOLDING_ROOTS = ['src/assets/commands', 'dist/commands'] as const

const SCANNED_EXTENSIONS = ['.md', '.mds']

/**
 * The fewest `Agent(` sites the scan must find across SCANNED_ROOTS, as measured
 * when the guard was added. It only rises (tests/fixtures/numeric-floors.json).
 */
const AGENT_SITE_FLOOR = 167

/** An argument list is read up to this many characters from its opening parenthesis. */
const MAX_CALL_CHARS = 20_000


type CallForm = 'Agent' | 'agent'

interface SpawnSite {
  path: string
  line: number
  form: CallForm
  /** The argument text as written, for reports and for reading the agent type. */
  raw: string
  /** The argument text with string and template-literal bodies blanked. */
  code: string
  /** True when the arguments carry a model. */
  hasModel: boolean
  /** False when the call's parentheses never balanced within MAX_CALL_CHARS. */
  balanced: boolean
}


/**
 * Index just after the string literal that starts at `i`, a quote or backtick.
 * A quote that never closes on its own line is prose (an apostrophe), not a
 * string, and is stepped over alone. A template literal's `${ … }` is skipped
 * whole, nested strings and templates included.
 */
function skipString(text: string, i: number, limit: number): number {
  const quote = text[i]
  let j = i + 1
  while (j < limit) {
    const c = text[j]
    if (c === '\\') { j += 2; continue }
    if (c === quote) return j + 1
    if (c === '\n' && quote !== '`') return i + 1
    if (quote === '`' && c === '$' && text[j + 1] === '{') {
      const after = skipCode(text, j + 2, '}', limit)
      if (after < 0) return i + 1
      j = after
      continue
    }
    j++
  }
  return i + 1
}

/**
 * Index just after the bracket that closes the code starting at `i`, which must be
 * `closer`, or -1 when the brackets do not balance before `limit`.
 */
function skipCode(text: string, i: number, closer: string, limit: number): number {
  let depth = 0
  let j = i
  while (j < limit) {
    const c = text[j]
    if (c === '"' || c === "'" || c === '`') { j = skipString(text, j, limit); continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return c === closer ? j + 1 : -1
      depth--
    }
    j++
  }
  return -1
}

/** `text[from, to)` with every string and template-literal body replaced by an empty literal. */
function blankStrings(text: string, from: number, to: number): string {
  let out = ''
  let j = from
  while (j < to) {
    const c = text[j]
    if (c === '"' || c === "'" || c === '`') {
      const after = Math.min(skipString(text, j, to), to)
      out += after === j + 1 ? c : '""'
      j = after
      continue
    }
    out += c
    j++
  }
  return out
}

/** A `model` argument or option: `model=`, `model:`, or the bare shorthand key. */
const MODEL_ARGUMENT = /(?<![\w$.])model(?:\s*[=:]|(?=\s*[,}]))/

const CALL_PATTERNS: ReadonlyArray<{ form: CallForm; pattern: RegExp }> = [
  { form: 'Agent', pattern: /(?<![\w$])Agent\(/g },
  { form: 'agent', pattern: /(?<![\w$])agent\(/g },
]

/**
 * Every `Agent(` spawn and workflow `agent(` call in `corpus`, with whether its
 * arguments carry a model. Pure — the live arm and the seeded probes run this
 * same function.
 */
function findSpawnSites(corpus: readonly CorpusEntry[]): SpawnSite[] {
  const sites: SpawnSite[] = []
  for (const entry of corpus) {
    for (const { form, pattern } of CALL_PATTERNS) {
      for (const match of entry.content.matchAll(pattern)) {
        const open = match.index + match[0].length - 1
        const limit = Math.min(entry.content.length, open + MAX_CALL_CHARS)
        const close = skipCode(entry.content, open + 1, ')', limit)
        const end = close < 0 ? limit : close - 1
        const code = blankStrings(entry.content, open + 1, end)
        sites.push({
          path: entry.path,
          line: entry.content.slice(0, match.index).split('\n').length,
          form,
          raw: entry.content.slice(open + 1, end),
          code,
          hasModel: MODEL_ARGUMENT.test(code),
          balanced: close >= 0,
        })
      }
    }
  }
  return sites
}

/** The sites whose arguments carry a model. */
function modelOffenders(sites: readonly SpawnSite[]): SpawnSite[] {
  return sites.filter(site => site.hasModel)
}

function describeOffender(site: SpawnSite): string {
  return `${site.path}:${site.line}: ${site.form}(${site.raw.trim().slice(0, 80)}) names a model — omit it; ` +
    'the installed agent frontmatter decides, and a user override reaches the spawn only that way'
}


/** The scanned corpus, one entry per file, keyed by its root. */
function readCorpus(): Map<string, CorpusEntry[]> {
  const corpus = new Map<string, CorpusEntry[]>()
  for (const root of SCANNED_ROOTS) {
    const dir = path.join(ROOT, root)
    if (!existsSync(dir)) {
      // A guard that skips an absent build artifact is not a guard.
      const hint = root.startsWith('dist/') ? ' — run `npm run build` first' : ''
      throw new Error(`${root}/ is absent${hint}`)
    }
    const files = walkFiles(dir, file => SCANNED_EXTENSIONS.includes(path.extname(file)))
    corpus.set(root, files.map(file => ({
      path: path.relative(ROOT, file).split(path.sep).join('/'),
      content: readFileSync(file, 'utf-8'),
    })))
  }
  return corpus
}

const corpusByRoot = readCorpus()
const corpus = [...corpusByRoot.values()].flat()
const sites = findSpawnSites(corpus)
const agentSites = sites.filter(site => site.form === 'Agent')


describe('no spawn names a model of its own (D-SPAWN-NO-MODEL)', () => {
  it('every scanned root contributes files, so none can go missing unseen', () => {
    for (const root of SCANNED_ROOTS) {
      expect(corpusByRoot.get(root)?.length, `${root}/ contributed no .md or .mds file`).toBeGreaterThan(0)
    }
  })

  it('the roots that hold spawns each contribute Agent( sites', () => {
    for (const root of SPAWN_HOLDING_ROOTS) {
      const here = agentSites.filter(site => site.path.startsWith(`${root}/`))
      expect(here.length, `${root}/ contributed no Agent( site — the parser lost them`).toBeGreaterThan(0)
    }
  })

  it('finds at least the floor of Agent( sites', () => {
    expect(agentSites.length).toBeGreaterThanOrEqual(AGENT_SITE_FLOOR)
  })

  it('finds workflow agent() calls, and sees their options', () => {
    const workflowCalls = sites.filter(site => site.form === 'agent' && /\bagentType\s*:/.test(site.code))
    expect(workflowCalls.length, 'no workflow agent() call with an agentType was read').toBeGreaterThan(0)
  })

  it('every call in the corpus is read whole: its parentheses balance', () => {
    expect(sites.filter(site => !site.balanced).map(site => `${site.path}:${site.line}`)).toEqual([])
  })

  it('no Agent( spawn carries model=, and no workflow agent() call carries a model option', () => {
    expect(modelOffenders(sites).map(describeOffender)).toEqual([])
  })

  it('no Validate spawn in dist/commands names a model', () => {
    const validateSpawns = agentSites.filter(
      site => site.path.startsWith('dist/commands/') && /subagent_type\s*=\s*"Validate"/.test(site.raw) && site.hasModel,
    )
    expect(validateSpawns.map(describeOffender)).toEqual([])
  })
})


describe('spawn-no-hardcoded-model guard: seeded probes', () => {
  const FILE = 'src/assets/commands/example.mds'
  const sitesIn = (content: string): SpawnSite[] => findSpawnSites([{ path: FILE, content }])

  const KNOWN_BAD: ReadonlyArray<{ name: string; content: string; form: CallForm }> = [
    {
      name: 'an Agent( spawn with model=',
      content: 'Agent(subagent_type="Validate", model="haiku"):\n"Run the build."\n',
      form: 'Agent',
    },
    {
      name: 'an indented Agent( spawn with model=',
      content: '   Agent(subagent_type="Validate", model="haiku"):\n   "Run the build."\n',
      form: 'Agent',
    },
    {
      name: 'a spawn that mixes argument styles',
      content: 'Agent(subagent_type="Learning", model="opus", run_in_background: true, prompt: "go")\n',
      form: 'Agent',
    },
    {
      name: 'model= on a continuation line',
      content: 'Agent(subagent_type="Validate",\n      model="haiku"):\n',
      form: 'Agent',
    },
    {
      name: 'an inline-code spawn in prose',
      content: 'Spawn `Agent(subagent_type="Validate", model="haiku")` for the build.\n',
      form: 'Agent',
    },
    {
      name: 'a workflow agent() call with a model option',
      content: 'const r = await agent("Run the build.", { agentType: "Validate", model: "haiku" });\n',
      form: 'agent',
    },
    {
      name: 'a workflow agent() call with a template-literal prompt and a model option',
      content: 'await agent(`Fix ${BRANCH}: don\'t guess`, { agentType: "Code", model: "opus" });\n',
      form: 'agent',
    },
    {
      name: 'a multi-line workflow agent() call with a model option',
      content: 'agent(\n  `Review ${focus}`,\n  {\n    agentType: "Review",\n    model: "opus",\n  },\n);\n',
      form: 'agent',
    },
    {
      name: 'a workflow agent() call with the shorthand model option',
      content: 'agent("Go.", { agentType: "Code", model });\n',
      form: 'agent',
    },
  ]

  for (const probe of KNOWN_BAD) {
    it(`flags ${probe.name}`, () => {
      const offenders = modelOffenders(sitesIn(probe.content))
      expect(offenders.map(o => o.form)).toEqual([probe.form])
    })
  }

  const CLEAN: ReadonlyArray<{ name: string; content: string }> = [
    { name: 'an Agent( spawn with no model', content: 'Agent(subagent_type="Validate"):\n"Run the build."\n' },
    {
      name: 'an Agent( spawn with run_in_background and no model',
      content: 'Agent(subagent_type="Git", run_in_background=false):\n"Open the PR."\n',
    },
    {
      name: 'model= in the prompt that follows the call, outside its parentheses',
      content: 'Agent(subagent_type="Validate"):\n"Report which model=haiku run this was."\n',
    },
    {
      name: 'model= quoted inside the arguments',
      content: 'Agent(subagent_type="Code", prompt: "Never pass model=opus here.")\n',
    },
    { name: 'a workflow agent() call with no model', content: 'agent("Go.", { agentType: "Code" });\n' },
    {
      name: 'opts.model in prose about agent()',
      content: 'OMIT `opts.model` in all `agent()` calls; see agent(prompt, opts).\n',
    },
    {
      name: 'a model key quoted inside a template-literal prompt',
      content: 'agent(`Reply as {"model": "x"} JSON. ${a}`, { agentType: "Review" });\n',
    },
    { name: 'a name that merely ends in Agent', content: 'subAgent(subagent_type="X", model="haiku")\nsetAgent(model="x")\n' },
    { name: 'a name that merely ends in agent', content: 'spawnagent("p", { model: "x" })\nfooAgent(model: 1)\n' },
  ]

  for (const probe of CLEAN) {
    it(`does not flag ${probe.name}`, () => {
      expect(modelOffenders(sitesIn(probe.content))).toEqual([])
    })
  }

  it('reads the site it flags at the line it starts on', () => {
    const found = modelOffenders(sitesIn('# heading\n\nAgent(subagent_type="Validate", model="haiku"):\n'))
    expect(found.map(f => f.line)).toEqual([3])
  })

  it('counts a clean spawn too, so the floor measures spawns and not offenders', () => {
    expect(sitesIn('Agent(subagent_type="Validate"):\nAgent(subagent_type="Code"):\n').filter(s => s.form === 'Agent')).toHaveLength(2)
  })

  it('an unbalanced call is read up to the bound and does not hang or throw', () => {
    const unbalanced = 'Agent(subagent_type="Validate"\n' + 'x'.repeat(50)
    expect(() => sitesIn(unbalanced)).not.toThrow()
  })
})
