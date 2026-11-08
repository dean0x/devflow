/**
 * The never-cut prompt items stay in every build.
 *
 * A prompt cut that trims text must not remove a rule that no other test pins. NEVER_CUT_ITEMS is the one
 * closed list of those rules: each entry names the rule, the source file that holds its text, one short
 * exact span that carries the rule, and the builds that must hold it. The compiled builds are read, never
 * the sources alone, because the compiled file is what a user installs. A build holds a span exactly once.
 *
 * Doctrine, as in the other prompt guards: one named collector (collectNeverCutDefects), known-bad probes
 * driven through that same collector, and loud corpus reads. A missing manifest, host or build file is an
 * error, never a skip, and a list entry that names no build is a defect, never a pass.
 *
 * What a green run does NOT prove: it proves the files carry the text. It does not prove that a model
 * follows it. Other tests keep their own pins of the same text; this list does not replace them.
 */

import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import {
  VARIANT_MANIFEST_REL_PATH,
  VARIANT_MANIFEST_VERSION,
  emittedVariantKeys,
  parseVariantManifest,
  variantArm,
  type VariantKey,
  type VariantKind,
} from '../../src/core/curation-variants.js'
import { ROOT, countOf, requireDistFile, resolveAgentSource, resolveVariantOffSource, seedOnce } from '../helpers.js'

interface Build {
  readonly key: VariantKey
  readonly label: string
  readonly text: string
}

// ---------------------------------------------------------------------------
// 1. The builds: read from the build's own manifest, so a new variant cannot escape the list
// ---------------------------------------------------------------------------

/** The variant keys the build writes for a host. A missing manifest or host is an error. */
function emittedKeys(kind: VariantKind, name: string, root: string): readonly VariantKey[] {
  let raw: string
  try {
    raw = readFileSync(path.join(root, VARIANT_MANIFEST_REL_PATH), 'utf-8')
  } catch {
    throw new Error(`${VARIANT_MANIFEST_REL_PATH} is absent: run \`npm run build:mds\``)
  }
  const manifest = parseVariantManifest(raw)
  if (!manifest.ok) throw new Error(`${VARIANT_MANIFEST_REL_PATH} is unreadable (${manifest.error.kind}): run \`npm run build:mds\``)
  const host = manifest.value.find(h => h.kind === kind && h.name === name)
  if (host === undefined) throw new Error(`${kind}/${name} is not in ${VARIANT_MANIFEST_REL_PATH}: run \`npm run build:mds\``)
  return emittedVariantKeys(host.axes)
}

/** Every compiled build of a command or agent: the on build, then each variant tree that holds it. */
function compiledBuilds(kind: VariantKind, name: string, root: string = ROOT): Build[] {
  return emittedKeys(kind, name, root).map(key => {
    const onText = kind === 'commands' ? requireDistFile(`${name}.md`, root) : resolveAgentSource(name, root).content
    const text = key === 'on' ? onText : resolveVariantOffSource(key, kind, name, root)
    if (text === null) throw new Error(`the ${key} build of ${kind}/${name} is absent: run \`npm run build:mds\``)
    return { key, label: `${name} (${key})`, text }
  })
}

type BuildSetName = 'implement' | 'implement (compliance on)' | 'plan' | 'code' | 'evaluate' | 'docs-framework'

const IMPLEMENT = compiledBuilds('commands', 'implement')

const CORPUS: ReadonlyMap<BuildSetName, readonly Build[]> = new Map<BuildSetName, readonly Build[]>([
  ['implement', IMPLEMENT],
  ['implement (compliance on)', IMPLEMENT.filter(b => variantArm(b.key, 'compliance') === 'on')],
  ['plan', compiledBuilds('commands', 'plan')],
  ['code', compiledBuilds('agents', 'code')],
  // Evaluate is hand-authored and installs as is, so its one build is the file the size tests read.
  ['evaluate', [{ key: 'on', label: 'evaluate (on)', text: resolveAgentSource('evaluate').content }]],
  // A skill installs as is: the source file is the build.
  [
    'docs-framework',
    [
      {
        key: 'on',
        label: 'docs-framework (skill)',
        text: readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'docs-framework', 'SKILL.md'), 'utf-8'),
      },
    ],
  ],
])

// ---------------------------------------------------------------------------
// 2. The list
// ---------------------------------------------------------------------------

interface NeverCutItem {
  /** The rule, said as the defect that reports it lost. */
  readonly name: string
  /** The file under src/assets that holds the text: where a deliberate change is made. */
  readonly source: string
  /** One exact span that carries the rule. */
  readonly text: string
  /** The builds that must hold it, each exactly once. */
  readonly builds: BuildSetName
}

// A cut never removes an item here; a deliberate change of an item updates this list in the same commit.
export const NEVER_CUT_ITEMS: readonly NeverCutItem[] = [
  {
    name: 'the evidence file lead does not say it stays after the PR exists, so a cleanup could delete it',
    source: 'commands/implement.mds',
    text: 'it stays after the PR exists',
    builds: 'implement',
  },
  {
    name: 'the issue token is not forwarded unclassified, routed by shape alone',
    source: 'commands/implement.mds',
    text: 'The issue token is forwarded **unclassified**: routing is by SHAPE alone.',
    builds: 'implement',
  },
  {
    name: 'a `starts with #` test is not named a github test that reads other providers references as task descriptions',
    source: 'commands/implement.mds',
    text: 'a `starts with #` test is a github test: it reads `PROJ-12` and `ENG-12` as task descriptions',
    builds: 'implement',
  },
  {
    name: 'a misrouted reference does not take its branch from prose, fetch no issue and report nothing',
    source: 'commands/implement.mds',
    text: 'the branch comes from prose, no issue is fetched and nothing reports it.',
    builds: 'implement',
  },
  {
    name: 'the token count is not the provider-neutral gate',
    source: 'commands/implement.mds',
    text: 'Token COUNT is provider-neutral: every issue spelling is one token and no free-text description is.',
    builds: 'implement',
  },
  {
    name: 'a `.md` path is not a plan document that is never an issue reference',
    source: 'commands/implement.mds',
    text: '**Extension.** A path ending in `.md` is a plan document, never an issue reference:',
    builds: 'implement',
  },
  {
    name: 'a plan document gives ISSUE_INPUT its frontmatter issue, never the path',
    source: 'commands/implement.mds',
    text: "`ISSUE_INPUT` carries the plan's frontmatter `issue`, never the path.",
    builds: 'implement',
  },
  {
    name: 'a plan document path does not go to PLAN_ARTIFACT_PATH only',
    source: 'commands/implement.mds',
    text: 'it goes to `PLAN_ARTIFACT_PATH` only,',
    builds: 'implement (compliance on)',
  },
  {
    name: 'forwarding the first token alone is not named as the way the request is dropped',
    source: 'commands/implement.mds',
    text: 'Forwarding the FIRST token alone sends `/implement fix the login bug` as `ISSUE_INPUT: fix` with no description, so the request is dropped.',
    builds: 'implement',
  },
  {
    name: 'a DEGRADED status line is not barred from being read as issue content',
    source: 'commands/plan.mds',
    text: 'infer no issue content from the status line.',
    builds: 'plan',
  },
  {
    name: 'issue-fix does not bar re-litigating the Triage dispositions',
    source: 'agents/code.mds',
    text: 'You fix the issues the Triage agent marked FIX_NOW. Do not re-litigate dispositions.',
    builds: 'code',
  },
  {
    name: 'issue-fix does not put same-file issues in one commit, so two Code agents could edit one file at once',
    source: 'agents/code.mds',
    text: 'Same-file issues → one commit (never two Code agents editing the same file concurrently)',
    builds: 'code',
  },
  {
    name: 'issue-fix does not let a Return block in the spawn replace the return report shape',
    source: 'agents/code.mds',
    text: '**Return report** (a Return block in the spawn replaces this shape):',
    builds: 'code',
  },
  {
    name: 'Evaluate has no Report as MISALIGNED list',
    source: 'agents/evaluate.md',
    text: '**Report as MISALIGNED:**',
    builds: 'evaluate',
  },
  {
    name: 'Evaluate does not report missing plan steps or acceptance criteria as MISALIGNED',
    source: 'agents/evaluate.md',
    text: '- Any missing plan steps or acceptance criteria',
    builds: 'evaluate',
  },
  {
    name: 'Evaluate does not report out-of-scope additions as MISALIGNED',
    source: 'agents/evaluate.md',
    text: '- Out-of-scope additions not justified by design',
    builds: 'evaluate',
  },
  {
    name: 'Evaluate does not report partial implementations as MISALIGNED',
    source: 'agents/evaluate.md',
    text: '- Partial implementations',
    builds: 'evaluate',
  },
  {
    name: 'Evaluate does not report intent drift as MISALIGNED',
    source: 'agents/evaluate.md',
    text: '- Intent drift',
    builds: 'evaluate',
  },
  {
    name: 'the design document name has no example',
    source: 'skills/docs-framework/SKILL.md',
    text: '`42-jwt-auth.2026-04-07_1430.md`',
    builds: 'docs-framework',
  },
]

// ---------------------------------------------------------------------------
// 3. The collector
// ---------------------------------------------------------------------------

const defectOf = (label: string, item: NeverCutItem): string => `${label}: ${item.name} [${item.source}]`

const noBuildDefectOf = (item: NeverCutItem): string => `${item.builds}: no build is read for: ${item.name} [${item.source}]`

/** Named collector: each build that does not hold an item's text exactly once, and each item whose set holds no build. */
export function collectNeverCutDefects(
  corpus: ReadonlyMap<BuildSetName, readonly Build[]>,
  items: readonly NeverCutItem[],
): string[] {
  const defects: string[] = []
  for (const item of items) {
    const builds = corpus.get(item.builds) ?? []
    if (builds.length === 0) {
      defects.push(noBuildDefectOf(item))
      continue
    }
    for (const build of builds) {
      if (countOf(build.text, item.text) !== 1) defects.push(defectOf(build.label, item))
    }
  }
  return defects
}

/** The corpus with the builds of one set replaced. */
function withBuilds(
  corpus: ReadonlyMap<BuildSetName, readonly Build[]>,
  set: BuildSetName,
  builds: readonly Build[],
): ReadonlyMap<BuildSetName, readonly Build[]> {
  return new Map<BuildSetName, readonly Build[]>([...corpus, [set, builds]])
}

// ---------------------------------------------------------------------------
// 4. The tests
// ---------------------------------------------------------------------------

/** The probes start from the live builds, so a live defect is reported once, by the test that owns it. */
function requireCleanBaseline(): void {
  expect(
    collectNeverCutDefects(CORPUS, NEVER_CUT_ITEMS),
    'a live build already lacks an item, so the probes cannot start: fix the build first',
  ).toEqual([])
}

describe('the never-cut prompt items are in every build', () => {
  it('reads each target in the builds that the build writes', () => {
    const labels = (set: BuildSetName): string[] => (CORPUS.get(set) ?? []).map(b => b.label)
    expect(labels('implement')).toEqual(['implement (on)', 'implement (curation-off)', 'implement (compliance-off)', 'implement (both-off)'])
    expect(labels('implement (compliance on)')).toEqual(['implement (on)', 'implement (curation-off)'])
    expect(labels('plan')).toEqual(['plan (on)', 'plan (curation-off)', 'plan (compliance-off)', 'plan (both-off)'])
    expect(labels('code')).toEqual(['code (on)', 'code (curation-off)', 'code (tdd-off)', 'code (curation-tdd-off)'])
    expect(labels('evaluate')).toEqual(['evaluate (on)'])
    expect(labels('docs-framework')).toEqual(['docs-framework (skill)'])
    for (const builds of CORPUS.values()) {
      for (const build of builds) expect(build.text.length, `${build.label} is read: an empty build would pass nothing`).toBeGreaterThan(1_000)
    }
  })

  it('the list is closed: every item has a distinct name, a text and a set that is read', () => {
    expect(NEVER_CUT_ITEMS, 'an item was added or removed: update this count in the same commit').toHaveLength(19)
    expect(new Set(NEVER_CUT_ITEMS.map(i => i.name)).size, 'two items share a name').toBe(NEVER_CUT_ITEMS.length)
    for (const item of NEVER_CUT_ITEMS) {
      expect(item.text.length, `${item.name}: an empty text would match anywhere`).toBeGreaterThan(10)
      expect(CORPUS.has(item.builds), `${item.name}: the set ${item.builds} is not read`).toBe(true)
    }
  })

  it('every item text is present exactly once in each build that the item names', () => {
    expect(collectNeverCutDefects(CORPUS, NEVER_CUT_ITEMS)).toEqual([])
  })

  it('known-bad probes: a text cut from any one build reports exactly that item in that build', () => {
    requireCleanBaseline()
    for (const item of NEVER_CUT_ITEMS) {
      const builds = CORPUS.get(item.builds) ?? []
      builds.forEach((build, at) => {
        const cut = builds.map((b, i) => (i === at ? { ...b, text: seedOnce(b.text, item.text, '') } : b))
        expect(collectNeverCutDefects(withBuilds(CORPUS, item.builds, cut), NEVER_CUT_ITEMS), `${item.name} cut from ${build.label}`).toEqual([
          defectOf(build.label, item),
        ])
      })
    }
  })

  it('known-bad probe: a text that occurs twice in a build is reported', () => {
    requireCleanBaseline()
    const item = NEVER_CUT_ITEMS[0]
    const [first, ...rest] = CORPUS.get(item.builds) ?? []
    const doubled = { ...first, text: `${first.text}\n${item.text}` }
    expect(collectNeverCutDefects(withBuilds(CORPUS, item.builds, [doubled, ...rest]), NEVER_CUT_ITEMS)).toEqual([defectOf(doubled.label, item)])
  })

  it('known-bad probe: an item whose set holds no build is reported, never passed', () => {
    requireCleanBaseline()
    const item = NEVER_CUT_ITEMS.find(i => i.builds === 'plan')
    expect(item, 'the plan item is in the list').toBeDefined()
    expect(collectNeverCutDefects(withBuilds(CORPUS, 'plan', []), NEVER_CUT_ITEMS)).toEqual([noBuildDefectOf(item as NeverCutItem)])
    expect(collectNeverCutDefects(new Map(), NEVER_CUT_ITEMS)).toHaveLength(NEVER_CUT_ITEMS.length)
  })

  it('a missing manifest, host or build file fails and never skips', () => {
    expect(() => compiledBuilds('commands', 'implement', path.join(ROOT, 'no-such-root'))).toThrow(/npm run build:mds/)
    const root = mkdtempSync(path.join(tmpdir(), 'never-cut-'))
    try {
      mkdirSync(path.join(root, 'dist', 'commands'), { recursive: true })
      const hosts = { 'commands/implement': { curation: true, compliance: false, tdd: false } }
      writeFileSync(path.join(root, VARIANT_MANIFEST_REL_PATH), JSON.stringify({ version: VARIANT_MANIFEST_VERSION, hosts }))
      writeFileSync(path.join(root, 'dist', 'commands', 'implement.md'), 'the on build')
      expect(() => compiledBuilds('commands', 'implement', root)).toThrow(/the curation-off build of commands\/implement is absent/)
      expect(() => compiledBuilds('commands', 'plan', root)).toThrow(/commands\/plan is not in/)
    } finally {
      rmSync(root, { recursive: true })
    }
  })
})
