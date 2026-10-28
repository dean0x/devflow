/**
 * Docs guard for the compliance-off build (#648).
 *
 * The CHANGELOG entry, the architecture doc and the CLI reference describe what a compliance-off install
 * holds. Each check ties a sentence of the docs to the build or to the code it describes:
 *
 *   - The CHANGELOG entry states the new property, gives no enable step, names no ledger identifier and
 *     no advisory, and sits under no released version.
 *   - The list of local result files in architecture.md equals the files the compliance-off command
 *     builds write: nothing missing, nothing extra, and each file under the command that writes it.
 *   - Both docs print the one fixed local line that each off build prints, and the `Posting:` line of
 *     `devflow compliance --status` with the values the code produces.
 *
 * The entry is found by its title, never by the Unreleased label, so the guard keeps passing after a release
 * renames that heading. Every collector is shown to fail on seeded known-bad input, so a guard that stops
 * seeing its subject fails instead of passing vacuously.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { postingStatus } from '../../src/core/installed-variants.js'
import { COMPLIANCE_VARIANT_HOSTS } from '../fixtures/mds-manifest.js'
import { resolveVariantOffSource } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8')

const CHANGELOG = read('CHANGELOG.md')
const ARCHITECTURE = read('docs/reference/architecture.md')
const CLI_REFERENCE = read('docs/cli-reference.md')

// ── The CHANGELOG entry ───────────────────────────────────────────────────────────────────────────────

const ENTRY_TITLE = '- **With compliance off, devflow installs no step or reference that posts to GitHub or a tracker**'
const SECTION_HEADING = '### Behaviour change'
/** The newest released version when the entry was written. The entry never sits under it or an older one. */
const LAST_RELEASED_BEFORE_ENTRY: readonly [number, number, number] = [3, 9, 0]

interface ReleaseSection {
  readonly label: string
  readonly text: string
}

/** Splits the changelog at its `## [` headings. */
function releaseSections(changelog: string): ReleaseSection[] {
  const heads = [...changelog.matchAll(/^## \[([^\]]+)\][^\n]*$/gm)]
  return heads.map((match, index) => {
    const start = match.index ?? 0
    const end = index + 1 < heads.length ? (heads[index + 1].index ?? changelog.length) : changelog.length
    return { label: match[1], text: changelog.slice(start, end) }
  })
}

interface Entry {
  readonly sectionLabel: string
  /** The `### ` heading nearest above the entry. */
  readonly heading: string | null
  /** The entry: its title line and its sub-bullets, up to the next bullet or heading. */
  readonly body: string
}

/** The entry with `title`, or null when no section holds it. */
function entryOf(changelog: string, title: string): Entry | null {
  for (const section of releaseSections(changelog)) {
    const at = section.text.indexOf(title)
    if (at === -1) continue
    const afterTitle = section.text.slice(at + title.length)
    const next = afterTitle.search(/^(?:#{2,3} |- \*\*)/m)
    const body = title + (next === -1 ? afterTitle : afterTitle.slice(0, next))
    const headings = [...section.text.slice(0, at).matchAll(/^### [^\n]*$/gm)]
    const heading = headings.length === 0 ? null : headings[headings.length - 1][0]
    return { sectionLabel: section.label, heading, body }
  }
  return null
}

function parseVersion(label: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(label)
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Whether `version` is at or below `ceiling`, compared part by part. */
function atOrBelow(version: readonly number[], ceiling: readonly number[]): boolean {
  for (let i = 0; i < ceiling.length; i += 1) {
    if (version[i] !== ceiling[i]) return version[i] < ceiling[i]
  }
  return true
}

type NamedPattern = readonly [name: string, pattern: RegExp]

/** What an enable step looks like in text: the flag, an enable verb, or an instruction to install the steps. */
const ENABLE_STEP_PATTERNS: readonly NamedPattern[] = [
  ['the enable flag', /--enable\b/],
  ['an enable verb', /\benabl(?:e|es|ed|ing)\b/i],
  ['an instruction to install the steps', /\bto install these steps\b/i],
]

/** What a ledger identifier, a plan identifier or an advisory looks like in public text. */
const PRIVATE_ID_PATTERNS: readonly NamedPattern[] = [
  ['a ledger identifier', /\b(?:ADR|PF)-\d+\b/],
  ['a plan identifier', /\b(?:AC|TP)-\d+\b/],
  ['a decision tag', /\bD-[A-Z][A-Z0-9-]+\b/],
  ['an advisory identifier', /\bGHSA-[a-z0-9-]+/i],
  ['the word advisory', /\badvisor(?:y|ies)\b/i],
]

/** The names of the patterns that match `text`. */
function collectMatches(text: string, patterns: readonly NamedPattern[]): string[] {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

const ENTRY = entryOf(CHANGELOG, ENTRY_TITLE)

describe('CHANGELOG: the compliance-off entry', () => {
  it('is present once, under a Behaviour change heading', () => {
    expect(ENTRY, 'the entry is missing from CHANGELOG.md').not.toBeNull()
    expect(CHANGELOG.split(ENTRY_TITLE)).toHaveLength(2)
    expect(ENTRY?.heading).toBe(SECTION_HEADING)
  })

  it('sits under no released version', () => {
    const version = parseVersion(ENTRY?.sectionLabel ?? '')
    if (version !== null) expect(atOrBelow(version, LAST_RELEASED_BEFORE_ENTRY), `the entry sits under ${ENTRY?.sectionLabel}`).toBe(false)
    else expect(ENTRY?.sectionLabel).toBe('Unreleased')
  })

  it('states the new property: no posting step and no posting reference is installed, and results stay local', () => {
    const body = ENTRY?.body ?? ''
    expect(body).toContain(
      'devflow installs no step and no reference that posts test-plan evidence, review or resolution summaries, backlog entries, review-thread replies, wave reports, plan artifacts, or release back-links to GitHub or a tracker. Results stay in local files under `.devflow/docs/`.',
    )
  })

  it('states the reference effects: the omitted operation files, the moved recipes, the untouched existing issue', () => {
    const body = ENTRY?.body ?? ''
    expect(body).toContain('devflow installs none of the files for the operations that post')
    expect(body).toContain('Devflow also installs neither the publication-gate document nor the `/implement` reference for the evidence questions.')
    expect(body).toContain('The GitHub posting recipes moved out of the GitHub API reference into a separate reference, `github-posting.md`.')
    expect(body).toContain('That reference installs only with compliance on.')
    expect(body).toContain('With compliance off, devflow no longer adds a link comment to an existing issue.')
    expect(body).toContain('Every change of the compliance switch converges the installed commands, agents and references at once.')
  })

  it('states the publish refusal with both lines, the exit code and the machine record as the only source', () => {
    const body = ENTRY?.body ?? ''
    expect(body).toContain('The evidence publish script refuses to post unless the machine setting has compliance on.')
    expect(body).toContain('It reads only the machine install record. A repository file or an environment variable cannot change its answer.')
    expect(body).toContain('`TRACEABILITY: DEGRADED (compliance off)`')
    expect(body).toContain('`TRACEABILITY: DEGRADED (compliance state unreadable)`')
    expect(body).toContain('it exits with code 2 and makes no GitHub call')
  })

  it('states the rule in words: only the machine switch picks the build, and a repository key never restores a step', () => {
    const body = ENTRY?.body ?? ''
    expect(body).toContain('Only the machine switch picks the installed build.')
    expect(body).toContain('A repository `compliance` key keeps the review lens on, locally, and never brings a posting step back.')
  })

  it('names the correction: the links-only wave block admits KEY-N references', () => {
    const body = ENTRY?.body ?? ''
    expect(body).toContain('It admits `KEY-N` references as well as `#N` references.')
    expect(body).toContain('This corrects the earlier links-only rule, which admitted only `#N` references.')
  })

  it('gives no enable step', () => {
    expect(collectMatches(ENTRY?.body ?? '', ENABLE_STEP_PATTERNS)).toEqual([])
  })

  it('names no ledger identifier, no plan identifier and no advisory', () => {
    expect(collectMatches(ENTRY?.body ?? '', PRIVATE_ID_PATTERNS)).toEqual([])
  })

  it('the entry collectors are live (known-bad probes)', () => {
    const released = `## [Unreleased]\n\n### Behaviour change\n\n${ENTRY_TITLE}\n  - one.\n\n## [3.9.0] - 2026-10-22\n\n### Changed\n\n- **other**\n`
    expect(entryOf(released, ENTRY_TITLE)?.sectionLabel).toBe('Unreleased')
    expect(entryOf(released.replace('## [Unreleased]', '## [3.10.0] - 2026-11-01'), ENTRY_TITLE)?.sectionLabel).toBe('3.10.0')
    expect(entryOf(released, '- **absent**')).toBeNull()
    expect(entryOf(released, ENTRY_TITLE)?.body).not.toContain('other')
    expect(atOrBelow([3, 9, 0], LAST_RELEASED_BEFORE_ENTRY)).toBe(true)
    expect(atOrBelow([3, 8, 9], LAST_RELEASED_BEFORE_ENTRY)).toBe(true)
    expect(atOrBelow([3, 10, 0], LAST_RELEASED_BEFORE_ENTRY)).toBe(false)
    expect(collectMatches('run `devflow compliance --enable` to install these steps', ENABLE_STEP_PATTERNS)).toEqual([
      'the enable flag',
      'an enable verb',
      'an instruction to install the steps',
    ])
    expect(collectMatches('re-enable it', ENABLE_STEP_PATTERNS)).toEqual(['an enable verb'])
    expect(collectMatches('ADR-000, PF-000, AC-00, TP-00, D-SOME-TAG, GHSA-xxxx-xxxx-xxxx and an advisory', PRIVATE_ID_PATTERNS)).toEqual([
      'a ledger identifier',
      'a plan identifier',
      'a decision tag',
      'an advisory identifier',
      'the word advisory',
    ])
    expect(collectMatches('KEY-N and #648 and D10', PRIVATE_ID_PATTERNS)).toEqual([])
  })
})

// ── The local result files ────────────────────────────────────────────────────────────────────────────

/** The local result files each command's compliance-off build writes, as architecture.md lists them. */
const LOCAL_FILES_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  'code-review': ['review-summary.md', '.last-review-head'],
  resolve: ['resolution-summary.md', 'evidence-{branch_slug}.md', 'evidence-result-{branch_slug}.md', 'readiness-{branch_slug}.md'],
  implement: ['evidence-{branch_slug}.md', 'evidence-result-{branch_slug}.md'],
  'dynamic-build': ['wave-report.md', 'evidence-wave-{slug}.md', 'evidence-result-wave-{slug}.md', 'readiness-wave-{slug}.md'],
  'bug-analysis': ['bug-analysis-summary.md', '.last-analysis-head'],
}

/** Every host with a compliance arm that is a command, read from the variant roster; its build exists with compliance off. */
const OFF_COMMANDS: readonly string[] = COMPLIANCE_VARIANT_HOSTS
  .filter(host => host.startsWith('commands/'))
  .map(host => host.slice('commands/'.length))

/** The names a compliance-off build uses for the files it writes, found by shape. */
const LOCAL_FILE_SHAPES: readonly RegExp[] = [
  /\b(?:evidence-result|evidence|readiness)(?:-wave)?-\{(?:branch_slug|slug)\}\.md/g,
  /\b(?:review-summary|resolution-summary|wave-report|bug-analysis-summary)\.md/g,
  /\.last-(?:review|analysis)-head\b/g,
]

/** The distinct local result file names in `text`, found by shape. */
function collectLocalFiles(text: string): string[] {
  const found = new Set<string>()
  for (const shape of LOCAL_FILE_SHAPES) {
    for (const match of text.matchAll(shape)) found.add(match[0])
  }
  return [...found].sort()
}

/** The compliance-off builds of a command: compliance off alone, and, when the host has a curation arm too, both off. */
function offBuilds(name: string): string[] {
  const complianceOff = resolveVariantOffSource('compliance-off', 'commands', name)
  if (complianceOff === null) throw new Error(`the compliance-off build of /${name} is absent: run \`npm run build:mds\``)
  const bothOff = resolveVariantOffSource('both-off', 'commands', name)
  return bothOff === null ? [complianceOff] : [complianceOff, bothOff]
}

/** The architecture paragraph that lists the local result files, or null. */
function localResultsParagraph(architecture: string): string | null {
  return architecture.split('\n').find(line => line.startsWith('**Local results (compliance off)**')) ?? null
}

/** The file names a paragraph names between backticks, from the given set of candidates. */
function namedIn(paragraph: string, candidates: readonly string[]): string[] {
  return candidates.filter(candidate => paragraph.includes(`\`${candidate}\``) || paragraph.includes(`/${candidate}\``))
}

describe('architecture.md: the local result files of the compliance-off builds', () => {
  const paragraph = localResultsParagraph(ARCHITECTURE)
  const listed = [...new Set(Object.values(LOCAL_FILES_BY_COMMAND).flat())].sort()

  it('has the paragraph', () => {
    expect(paragraph, 'architecture.md has no **Local results (compliance off)** paragraph').not.toBeNull()
  })

  it('names every file the table lists, and each command that writes them', () => {
    const text = paragraph ?? ''
    expect(namedIn(text, listed).sort()).toEqual(listed)
    for (const command of [...Object.keys(LOCAL_FILES_BY_COMMAND), 'plan', 'release']) {
      expect(text, `the paragraph does not name /${command}`).toContain(`\`/${command}\``)
    }
  })

  it('has a row for every command whose off build writes a local result file', () => {
    expect(OFF_COMMANDS, 'the roster gave no command').toContain('bug-analysis')
    const writers = OFF_COMMANDS.filter(command => offBuilds(command).some(build => collectLocalFiles(build).length > 0))
    expect(writers.sort()).toEqual(Object.keys(LOCAL_FILES_BY_COMMAND).sort())
  })

  it('lists each file under a command whose off build writes it', () => {
    for (const [command, files] of Object.entries(LOCAL_FILES_BY_COMMAND)) {
      for (const build of offBuilds(command)) {
        for (const file of files) {
          expect(build, `the compliance-off build of /${command} does not name ${file}`).toContain(file)
        }
      }
    }
  })

  it('lists every local result file that an off command build names, and no other', () => {
    const named = new Set<string>()
    for (const command of OFF_COMMANDS) {
      for (const build of offBuilds(command)) for (const file of collectLocalFiles(build)) named.add(file)
    }
    expect([...named].sort()).toEqual(listed)
  })

  it('the collectors are live (known-bad probes)', () => {
    expect(collectLocalFiles('see `.devflow/docs/readiness-wave-{slug}.md` and review-summary.md')).toEqual([
      'readiness-wave-{slug}.md',
      'review-summary.md',
    ])
    expect(collectLocalFiles('writes bug-analysis-summary.md and "$M/.last-analysis-head"')).toEqual([
      '.last-analysis-head',
      'bug-analysis-summary.md',
    ])
    expect(collectLocalFiles('nothing here')).toEqual([])
    expect(collectLocalFiles('a new `evidence-extra-{slug}.md` file')).toEqual([])
    expect(localResultsParagraph('**Other**: x')).toBeNull()
    expect(namedIn('writes `readiness-{branch_slug}.md` only', listed)).toEqual(['readiness-{branch_slug}.md'])
    expect(namedIn('writes `evidence-result-{branch_slug}.md`', ['evidence-{branch_slug}.md'])).toEqual([])
  })
})

// ── What the docs print is what the build and the code print ──────────────────────────────────────────

const OFF_POLICY_LINE = 'TRACEABILITY: DEGRADED (compliance off on this machine; the repository requires evidence)'

/** The four values of the `Posting:` line, as the code produces them. */
function postingValues(): string[] {
  const settled = { curation: true, compliance: true }
  return [
    postingStatus(settled, true),
    postingStatus({ ...settled, compliance: false }, false),
    postingStatus({ ...settled, compliance: false }, true),
    postingStatus(null, true),
  ]
}

describe('the docs agree with the compliance-off build and the status line', () => {
  it('both docs print the fixed local line that every off command build prints', () => {
    expect(ARCHITECTURE).toContain(OFF_POLICY_LINE)
    expect(CLI_REFERENCE).toContain(OFF_POLICY_LINE)
    for (const command of OFF_COMMANDS) {
      for (const build of offBuilds(command)) {
        expect(build, `the compliance-off build of /${command} does not print the line`).toContain(OFF_POLICY_LINE)
      }
    }
  })

  it('both docs print the Posting line with the values the code produces', () => {
    const values = postingValues()
    expect(new Set(values).size).toBe(4)
    const line = `Posting: ${values.join(' | ')}`
    expect(ARCHITECTURE).toContain(line)
    expect(CLI_REFERENCE).toContain(line)
  })

  it('the cli reference names every command that has a compliance-off build', () => {
    const paragraph = CLI_REFERENCE.split('\n').find(l => l.startsWith('**Posting steps.**')) ?? ''
    expect(paragraph, 'the CLI reference has no **Posting steps.** paragraph').not.toBe('')
    for (const command of OFF_COMMANDS) expect(paragraph, `the paragraph does not name /${command}`).toContain(`\`/${command}\``)
  })
})
