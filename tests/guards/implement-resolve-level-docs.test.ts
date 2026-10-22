/**
 * The doc sites of the /implement and /resolve level references (TP-6, an item of the test plan of PR #574, which
 * implements #481). The sites are the `devflow gates` text, README.md, docs/cli-reference.md and
 * docs/commands.md. Each site that covers a command states the effect of each shipped row of that command exactly once,
 * and no site keeps a retired "no rows" claim. The check runs through the named collector `collectDocSiteDefects`, and
 * known-bad probes run over the same collector.
 *
 * The check proves that a site carries the effect phrase once. It does not prove which command the phrase names: a site
 * that covers both commands and names one satisfies the check for both. It does not prove which level the phrase names
 * at a site that covers every level, so a README line that names only `lean` passes. The init hints are no site: each is one
 * short line that fits an 80-column terminal, so it states no effect of a row. The facet rows of
 * `tests/gate-level-prompts.test.ts` tie the levels whose hint says "no Polish" to the `devflow gates` clause that names them.
 *
 * Two more checks sit beside it. A `ROW_EFFECTS` entry that names no shipped row is reported, so a retired row sends
 * someone back to the docs. The three sites that state the lean Harden skip in detail (the README, docs/cli-reference.md
 * and the /implement section of docs/commands.md) each state the two report notes of the `harden-scope` bullet once, and
 * state the skip in a sentence that names `lean` and neither `standard` nor `full`. The two docs hold the same block.
 * The `5 Alignment Check` row (`pass level; apply: single-pass`) has the effect "one Evaluate pass": each site that covers
 * `/implement` says it once. Two more phrases of the route
 * after that pass are checked on their own: the README, docs/cli-reference.md and the /implement section of docs/commands.md
 * each state "one Fix round" once, and the two docs state the route of a Fix round that does not complete ("anything other
 * than COMPLETE") once. The README leaves that sentence out. This is a known limit, so the check does not hold it to one.
 * The `2 Global Triage` row of the /resolve reference (`pass level`) has the effect "applies severity tiers" (or "severity tiers in
 * /resolve"): each site that covers `/resolve` says it once.
 *
 * Each doc is read at import. A missing file, paragraph or section throws, so the guard never skips. The decided rows
 * and the two references come from `level-guard-helpers.ts`. `implement-resolve-levels.test.ts` holds the other arms.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { GATE_LEVEL_EFFECT } from '../../src/cli/commands/gates.js'
import { ROOT } from '../helpers.js'
import { DECIDED_ROWS, LEVELS, LEVEL_CMDS, OPEN, REFS, countOf, levelCell, parseRef, referenceRows, rowCells, sectionOf, seed, seedOnce, withRows, type LevelCmd, type LevelColumn } from './level-guard-helpers.js'

/** The clauses that say the references hold no rows. No doc site keeps one once any table has a row. */
const RETIRED_CLAIMS = ['no phase rules yet', 'no rows yet'] as const

/** What a doc site says when it states that Polish is skipped: "skip Polish", "skips Polish" or "no Polish". */
const POLISH_SKIP = /\b(?:skips?|no) Polish\b/

/** What a doc site says when it states the severity tiers of the `2 Global Triage` row: "applies severity tiers" or "severity tiers in /resolve". Case matters, and a hyphenated file name does not count. A mention that states no effect ("no severity tiers", "severity tiers in /implement") does not count. */
const SEVERITY_TIERS = /\bapplies severity tiers\b|\bseverity tiers in \/resolve\b/

/** What a doc site says when it states the lean Harden skip: "skip Harden on a docs-only diff" or "skips Harden on a docs-only diff". */
const HARDEN_DOCS_SKIP = /\bskips? Harden on a docs-only diff\b/

/** What a doc site says when it states the single Evaluate pass of the `5 Alignment Check` row: "runs one Evaluate pass". */
const EVALUATE_SINGLE_PASS = /\bone Evaluate pass\b/

/** What a doc site says when it states the Fix round that follows the single Evaluate pass: "one Fix round runs". */
const EVALUATE_ONE_FIX_ROUND = /\bone Fix round\b/

/** What a doc site says when it states where a Fix round that does not complete goes: "anything other than COMPLETE". */
const EVALUATE_FIX_ROUTE = /\banything other than COMPLETE\b/

/** What no text about the tiers says: "in batches" or "in a batch". Phase 3 of /resolve batches every FIX_NOW item by file at every level, so a batching mode is no effect of a tier. A prose-only item differs by its text-only edit. */
const BATCHING = /\bin (?:a )?batch(?:es)?\b/

/**
 * What a doc site must say for each shipped row, keyed by `${cmd}:` plus the full row line. A change to one cell is a new
 * key, so it sends someone back to the docs. A row with no entry here is reported.
 */
const ROW_EFFECTS: ReadonlyMap<string, RegExp> = new Map([
  ['implement:| 3 Polish | skip | skip |', POLISH_SKIP],
  ['implement:| 4 Self-Review | - | apply: harden-scope |', HARDEN_DOCS_SKIP],
  ['implement:| 5 Alignment Check | pass level; apply: single-pass | pass level; apply: single-pass |', EVALUATE_SINGLE_PASS],
  ['resolve:| 2 Global Triage | pass level | pass level |', SEVERITY_TIERS],
  ['resolve:| 6 Polish | skip | skip |', POLISH_SKIP],
])

/** The row with its last cell changed: a row that ends in `skip` ends in `-` instead, and any other row ends in `skip`. */
const changeLastCell = (row: string): string => (row.endsWith(' skip |') ? row.replace(/ skip \|$/, ' - |') : row.replace(/ [^|]+ \|$/, ' skip |'))

/**
 * One text that states what the levels do, named as a defect names it, with the commands whose rows it covers. A site that
 * describes one level carries `level`, and owes the effect of a row only when its cell for that level is not `-`.
 */
interface DocSite { readonly label: string; readonly text: string; readonly cmds: ReadonlyArray<LevelCmd>; readonly level?: LevelColumn }

/** The rows that the reference of one command holds, as the table lists them. */
interface ShippedRows { readonly cmd: LevelCmd; readonly rows: readonly string[] }

/** How many times `re` matches `text`. The count rebuilds `re` as global, so it does not depend on the flags of `re`. */
const matchCount = (text: string, re: RegExp): number => [...text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))].length

/** The rows that the reference of each command holds. */
const shippedOf = (refs: Readonly<Record<string, string>>): ShippedRows[] => LEVEL_CMDS.map(cmd => ({ cmd, rows: referenceRows(refs[cmd]) }))

/**
 * Whether `site` is read as one level and the cell of `row` for that level is `-`: the row does not apply there, so the site
 * states nothing of it. A site read as no level, and a row whose cells cannot be read, are barred at no level.
 */
const barredAt = (site: DocSite, row: string): boolean => site.level !== undefined && levelCell(row, site.level) === '-'

/** Whether `site` owes the effect of `row` of `cmd`: it covers the command, and no level bars the row. The one statement of the rule. */
const owes = (site: DocSite, cmd: LevelCmd, row: string): boolean => site.cmds.includes(cmd) && !barredAt(site, row)

/** Check 1 of the doc sites: a shipped row with no entry in `effects`. */
function collectUnregisteredRowDefects(shipped: readonly ShippedRows[], effects: ReadonlyMap<string, RegExp>): string[] {
  return shipped.flatMap(({ cmd, rows }) => rows.filter(row => !effects.has(`${cmd}:${row}`)).map(row => `the ${cmd} row ${row} has no ROW_EFFECTS entry`))
}

/** Check 2 of the doc sites: a retired claim at `site`, reported once any table has a row. `withRow` names the commands whose table has one. */
function collectRetiredClaimDefects(site: DocSite, withRow: readonly string[]): string[] {
  if (withRow.length === 0) return []
  return RETIRED_CLAIMS.filter(claim => site.text.includes(claim)).map(claim => `a table has a row (${withRow.join(', ')}), but ${site.label} still says "${claim}"`)
}

/**
 * Check 3 of the doc sites: `site` states the effect of each shipped row of its own commands exactly once. A row with no entry is check 1's to report.
 * A site read as one level owes nothing for a row whose cell for that level is `-`, and a match there is a defect. A row whose cells cannot be read
 * owes its effect at every level.
 */
function collectEffectCountDefects(site: DocSite, shipped: readonly ShippedRows[], effects: ReadonlyMap<string, RegExp>): string[] {
  return shipped.filter(({ cmd }) => site.cmds.includes(cmd)).flatMap(({ cmd, rows }) => rows.flatMap(row => {
    const effect = effects.get(`${cmd}:${row}`)
    if (effect === undefined) return []
    const times = matchCount(site.text, effect)
    if (barredAt(site, row)) {
      return times === 0 ? [] : [`${site.label} states the effect of the ${cmd} row ${row}, whose ${site.level} cell is -`]
    }
    if (times === 0) return [`${site.label} does not state the effect of the ${cmd} row ${row}: it must match ${effect}`]
    return times > 1 ? [`${site.label} states the effect of the ${cmd} row ${row} ${times} times, expected once`] : []
  }))
}

/**
 * TP-6: every shipped row has an entry in `effects`, and each site that covers the command of a shipped row states the
 * effect of that row exactly once. Once any table has a row, no site keeps a retired claim. While no table has a row, no
 * site owes an effect and none is barred a retired claim. The match is on a phrase: it does not tell which command the
 * phrase names, so a site that covers both commands and names one satisfies the check for both. It does not tell which
 * level the phrase names either, so a README line that names only `lean` passes. A site read as one level (`level`) states the effect of
 * a row only when its cell for that level is not `-`; no shipped site is read that way.
 * The defects come in this order: the unregistered rows, then for each site its retired claims and its effect counts.
 */
export function collectDocSiteDefects(sites: readonly DocSite[], refs: Readonly<Record<string, string>>, effects: ReadonlyMap<string, RegExp> = ROW_EFFECTS): string[] {
  const shipped = shippedOf(refs)
  const withRow = shipped.filter(({ rows }) => rows.length > 0).map(({ cmd }) => cmd)
  return [
    ...collectUnregisteredRowDefects(shipped, effects),
    ...sites.flatMap(site => [...collectRetiredClaimDefects(site, withRow), ...collectEffectCountDefects(site, shipped, effects)]),
  ]
}

/**
 * Check 4 of the doc sites, run on its own: a `effects` entry that names no shipped row. A retired row, or a row with one
 * changed cell, leaves its entry behind, and the entry sends someone back to the docs. `collectDocSiteDefects` leaves this
 * check out, because its probes pass tables that ship fewer rows than `ROW_EFFECTS` holds.
 */
export function collectStaleEffectDefects(refs: Readonly<Record<string, string>>, effects: ReadonlyMap<string, RegExp> = ROW_EFFECTS): string[] {
  const shipped = new Set(shippedOf(refs).flatMap(({ cmd, rows }) => rows.map(row => `${cmd}:${row}`)))
  return [...effects.keys()].filter(key => !shipped.has(key)).map(key => `the ROW_EFFECTS entry ${key} names no shipped row`)
}

/** The sentences of a doc text: it splits after a full stop that a space, then a capital letter or a backtick, follows. A full stop inside a file name has no space after it. */
const sentencesOf = (text: string): string[] => text.split(/(?<=\.) (?=[A-Z`])/)

/** The levels that the sentence which states the Harden skip never names: it skips at `lean` only. */
const HARDEN_BARRED_LEVELS = ['standard', 'full'] as const

/** Check 5 of the doc sites, part 1: `site` states each report note of the `harden-scope` bullet, in backticks, exactly once. */
function collectHardenNoteDefects(site: DocSite, notes: readonly string[]): string[] {
  return notes.flatMap(note => {
    const times = countOf(site.text, `\`${note}\``)
    if (times === 1) return []
    return [times === 0 ? `${site.label} does not state the report note \`${note}\`` : `${site.label} states the report note \`${note}\` ${times} times, expected once`]
  })
}

/**
 * Check 5, part 2: each sentence of `site` that states the Harden skip names `lean` and neither `standard` nor `full`, each in
 * backticks. The text is split per sentence, so the sentence that tells a reader how to keep Harden on every diff names the
 * other levels without a defect. A site with no such sentence is check 3's to report.
 */
function collectHardenLevelDefects(site: DocSite): string[] {
  return sentencesOf(site.text).filter(sentence => HARDEN_DOCS_SKIP.test(sentence)).flatMap(sentence => [
    ...(sentence.includes('`lean`') ? [] : [`${site.label} states the Harden skip in a sentence that does not name \`lean\``]),
    ...HARDEN_BARRED_LEVELS.filter(level => sentence.includes(`\`${level}\``)).map(level => `${site.label} states the Harden skip in a sentence that names \`${level}\``),
  ])
}

/** The block of a doc text that states the Harden skip: from the sentence that skips Harden through the last sentence that holds a report note; null when the text holds none. */
function hardenBlockOf(text: string, notes: readonly string[]): string | null {
  const sentences = sentencesOf(text)
  const from = sentences.findIndex(sentence => HARDEN_DOCS_SKIP.test(sentence))
  const to = sentences.reduce((last, sentence, i) => (notes.some(note => sentence.includes(`\`${note}\``)) ? i : last), -1)
  return from === -1 || to < from ? null : sentences.slice(from, to + 1).join(' ')
}

/** Check 5, part 3: each of `sites` holds a Harden block, and every block is the text of the first one. */
function collectHardenBlockDefects(sites: readonly DocSite[], notes: readonly string[]): string[] {
  const blocks = sites.map(site => ({ site, block: hardenBlockOf(site.text, notes) }))
  const missing = blocks.filter(({ block }) => block === null).map(({ site }) => `${site.label} holds no Harden block, from the sentence that skips Harden to the sentence that holds its last report note`)
  const found = blocks.flatMap(({ site, block }) => (block === null ? [] : [{ site, block }]))
  const differing = found.slice(1).filter(({ block }) => block !== found[0].block).map(({ site }) => `${found[0].site.label} and ${site.label} hold different Harden blocks`)
  return [...missing, ...differing]
}

/**
 * Check 5 of the doc sites, run on its own: the lean Harden skip as the detailed sites state it. Each of `detailed` states each
 * report note once and states the skip at `lean` only. The `shared` sites hold one block, the same text at each. The notes
 * come from the `harden-scope` bullet of the shipped reference. The defects come in this order: for each detailed site its
 * notes and then its level, then the blocks.
 */
export function collectHardenDetailDefects(detailed: readonly DocSite[], shared: readonly DocSite[], notes: readonly string[]): string[] {
  return [
    ...detailed.flatMap(site => [...collectHardenNoteDefects(site, notes), ...collectHardenLevelDefects(site)]),
    ...collectHardenBlockDefects(shared, notes),
  ]
}

/** One phrase of the route after the single Evaluate pass, with what it says (for a defect line) and the sites that owe it. */
interface RouteCheck { readonly what: string; readonly re: RegExp; readonly sites: readonly DocSite[] }

/**
 * Check 6 of the doc sites, run on its own: the route after the single Evaluate pass. Each site of a check states its phrase
 * exactly once. The defects come in the order of the checks, then of their sites.
 */
export function collectEvaluateRouteDefects(checks: readonly RouteCheck[]): string[] {
  return checks.flatMap(({ what, re, sites }) => sites.flatMap(site => {
    const times = matchCount(site.text, re)
    if (times === 1) return []
    return [times === 0 ? `${site.label} does not state ${what}` : `${site.label} states ${what} ${times} times, expected once`]
  }))
}

/** The report notes that the `harden-scope` bullet of a /implement reference sets, each in backticks as `Harden: <word>`. A missing bullet or a bullet with no note throws at import, so the check never reads nothing. */
function hardenNotesOf(ref: string): string[] {
  const bullets = (sectionOf(parseRef(ref), '## Rules')?.lines ?? []).filter(line => line.startsWith('- **harden-scope:**'))
  if (bullets.length !== 1) throw new Error(`the /implement reference holds ${bullets.length} harden-scope bullets, expected 1`)
  const notes = [...bullets[0].matchAll(/`(Harden: [^`]+)`/g)].map(match => match[1])
  if (notes.length === 0) throw new Error('the harden-scope bullet sets no report note')
  return notes
}

/** The one paragraph of a doc that opens with `opener`. A missing or repeated paragraph throws at import, so the guard never skips. */
function paragraphOf(file: string, text: string, opener: string): string {
  const found = text.split('\n\n').filter(paragraph => paragraph.startsWith(opener))
  if (found.length !== 1) throw new Error(`${file} holds ${found.length} paragraphs that open "${opener}", expected 1`)
  return found[0]
}

/** The `## ` section of a doc, from its heading to the next `## ` heading. A missing section throws at import, so the guard never skips. */
function sectionOfDoc(file: string, text: string, heading: string): string {
  const from = text.indexOf(`\n${heading}\n`)
  if (from === -1) throw new Error(`${file} has no "${heading}" section`)
  const next = text.indexOf('\n## ', from + heading.length + 2)
  return text.slice(from + 1, next === -1 ? undefined : next)
}

/** A doc site as the product carries it, with the length below which the read has surely failed. */
interface ReadSite extends DocSite { readonly min: number }
const README_TEXT = readFileSync(path.join(ROOT, 'README.md'), 'utf-8')
const CLI_REFERENCE_TEXT = readFileSync(path.join(ROOT, 'docs', 'cli-reference.md'), 'utf-8')
const COMMANDS_DOC_TEXT = readFileSync(path.join(ROOT, 'docs', 'commands.md'), 'utf-8')
const CHANGELOG_TEXT = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8')

/** The `### ` section of CHANGELOG.md that opens with `heading`, to the next `### ` heading. A missing or repeated section throws at import, so the guard never skips. */
function changelogSectionOf(heading: string): string {
  const found = CHANGELOG_TEXT.split('\n### ').filter(part => part.startsWith(heading))
  if (found.length !== 1) throw new Error(`CHANGELOG.md holds ${found.length} sections that open "### ${heading}", expected 1`)
  return found[0]
}
const BOTH_COMMANDS: DocSite['cmds'] = ['implement', 'resolve']
/** The texts that say what a level does to /implement and /resolve. Only the README, cli-reference and commands doc paragraphs and sections that name the level are read, so a "no Polish" elsewhere in a file cannot satisfy the check. */
const README_SITE: ReadSite = { label: 'the README.md Gate level paragraph', text: paragraphOf('README.md', README_TEXT, OPEN), cmds: BOTH_COMMANDS, min: 500 }
const CLI_REFERENCE_SITE: ReadSite = { label: 'the docs/cli-reference.md What reads it paragraph', text: paragraphOf('docs/cli-reference.md', CLI_REFERENCE_TEXT, '**What reads it.**'), cmds: BOTH_COMMANDS, min: 500 }
const CHANGELOG_TIERS_SITE: ReadSite = { label: 'the CHANGELOG.md severity tiers upgrade note', text: changelogSectionOf('Upgrade notes — Severity tiers by level'), cmds: ['resolve'], min: 500 }
const COMMANDS_IMPLEMENT_SITE: ReadSite = { label: 'the docs/commands.md /implement section', text: sectionOfDoc('docs/commands.md', COMMANDS_DOC_TEXT, '## /implement'), cmds: ['implement'], min: 500 }
const DOC_SITES: readonly ReadSite[] = [
  { label: 'the devflow gates text', text: GATE_LEVEL_EFFECT, cmds: BOTH_COMMANDS, min: 150 },
  README_SITE,
  CLI_REFERENCE_SITE,
  COMMANDS_IMPLEMENT_SITE,
  { label: 'the docs/commands.md /resolve section', text: sectionOfDoc('docs/commands.md', COMMANDS_DOC_TEXT, '## /resolve'), cmds: ['resolve'], min: 500 },
]
/** The sites that state the lean Harden skip in detail: the report notes and the level are checked at each. */
const HARDEN_DETAIL_SITES: readonly ReadSite[] = [README_SITE, CLI_REFERENCE_SITE, COMMANDS_IMPLEMENT_SITE]
/** The two docs of the commands that carry one block for the Harden skip: the block is the same text at both. */
const HARDEN_SHARED_SITES: readonly ReadSite[] = [CLI_REFERENCE_SITE, COMMANDS_IMPLEMENT_SITE]
const HARDEN_NOTES: readonly string[] = hardenNotesOf(REFS.implement)
/** The sites that state the Fix round after the single Evaluate pass: the README and the two docs. */
const FIX_ROUND_SITES: readonly ReadSite[] = [README_SITE, CLI_REFERENCE_SITE, COMMANDS_IMPLEMENT_SITE]
/** The sites that state the route of a Fix round that does not complete: the two docs. The README leaves the sentence out, a known limit. */
const FIX_ROUTE_SITES: readonly ReadSite[] = [CLI_REFERENCE_SITE, COMMANDS_IMPLEMENT_SITE]
/** The checks of the route after the single Evaluate pass, over the real sites. */
const EVALUATE_ROUTE_CHECKS: readonly RouteCheck[] = [
  { what: 'the one Fix round after the single Evaluate pass', re: EVALUATE_ONE_FIX_ROUND, sites: FIX_ROUND_SITES },
  { what: 'the route of a Fix round that does not complete', re: EVALUATE_FIX_ROUTE, sites: FIX_ROUTE_SITES },
]

describe('the doc sites state the effect of each shipped row and keep no retired claim (TP-6)', () => {
  /** Test-only sites: the probes do not depend on what the real docs say, so they hold before and after the rows ship. */
  const effect = 'At standard and lean they skip Polish, and full keeps it.'
  const site = (text: string, cmds: DocSite['cmds'] = BOTH_COMMANDS): DocSite => ({ label: 'the probe site', text, cmds })
  const none = { implement: withRows(REFS.implement, []), resolve: withRows(REFS.resolve, []) }
  const both = { implement: withRows(REFS.implement, ['| 3 Polish | skip | skip |']), resolve: withRows(REFS.resolve, ['| 6 Polish | skip | skip |']) }
  const onlyResolve = { implement: none.implement, resolve: both.resolve }

  it('the sites are the registered ones, each read from the product, and the shipped tables leave no defect', () => {
    expect(DOC_SITES.map(s => `${s.label}: ${s.cmds.join(', ')}`)).toEqual([
      'the devflow gates text: implement, resolve',
      'the README.md Gate level paragraph: implement, resolve',
      'the docs/cli-reference.md What reads it paragraph: implement, resolve',
      'the docs/commands.md /implement section: implement',
      'the docs/commands.md /resolve section: resolve',
    ])
    expect(DOC_SITES.map(s => s.level), 'no shipped site is read as one level').toEqual([undefined, undefined, undefined, undefined, undefined])
    for (const { label, text, min } of DOC_SITES) expect(text.length, `${label}: nothing read`).toBeGreaterThan(min)
    expect(collectDocSiteDefects(DOC_SITES, REFS)).toEqual([])
  })

  it('the shared cell parser reads the phase, standard and lean cells of a row, and nothing from a line that is not a row', () => {
    expect(rowCells('| 3 Polish | skip | skip |')).toEqual(['3 Polish', 'skip', 'skip'])
    expect(rowCells('|  4 Self-Review |  - |  apply: x  |')).toEqual(['4 Self-Review', '-', 'apply: x'])
    for (const level of LEVELS) expect(levelCell('| 4 Self-Review | - | skip |', level), level).toBe(level === 'standard' ? '-' : 'skip')
    expect(levelCell('Not a row', 'lean'), 'a line that is not a row has no cell').toBeUndefined()
    for (const line of ['3 Polish | skip | skip |', '| 3 Polish | skip | skip', 'Not a row']) expect(rowCells(line), line).toBeNull()
  })

  it('every ROW_EFFECTS key is a command and a row line, and POLISH_SKIP reads the three wordings of a skip', () => {
    for (const key of ROW_EFFECTS.keys()) expect(key, key).toMatch(/^(?:implement|resolve):\| \d+[a-z]? \S.* \| \S.* \| \S.* \|$/)
    for (const text of ['they skip Polish', 'it skips Polish', 'and no Polish (the default)']) expect(POLISH_SKIP.test(text), text).toBe(true)
    for (const text of ['Polish is skipped', 'keeps Polish', 'the full plan shape and Polish', 'noPolish']) expect(POLISH_SKIP.test(text), text).toBe(false)
  })

  it('EVALUATE_SINGLE_PASS reads "one Evaluate pass", and nothing less', () => {
    for (const text of ['runs one Evaluate pass', 'one Evaluate pass in /implement']) expect(EVALUATE_SINGLE_PASS.test(text), text).toBe(true)
    for (const text of ['one Evaluate run', 'Evaluate passes once', 'one evaluate pass', 'oneEvaluate pass']) expect(EVALUATE_SINGLE_PASS.test(text), text).toBe(false)
  })

  it('SEVERITY_TIERS reads a statement of the tiers, and nothing less', () => {
    for (const text of ['applies severity tiers', 'severity tiers in /resolve', '/resolve also applies severity tiers;']) expect(SEVERITY_TIERS.test(text), text).toBe(true)
    for (const text of ['no severity tiers', 'severity tiers in /implement', 'one severity tier', 'severity-tiers.md', 'Severity tiers', 'severity tiered', 'noseverity tiers', 'applies severity tier', 'severity tiers in /resolved']) expect(SEVERITY_TIERS.test(text), text).toBe(false)
  })

  it('BATCHING reads "in batches" and "in a batch", and nothing less', () => {
    for (const text of ['keeps in batches', 'fixed in a batch', 'in batch']) expect(BATCHING.test(text), text).toBe(true)
    for (const text of ['one batch per file', 'batching', 'in a batcher', 'inbatches']) expect(BATCHING.test(text), text).toBe(false)
  })

  it('no doc site and no upgrade note describes the tiers by a batching mode', () => {
    for (const { label, text } of [...DOC_SITES, CHANGELOG_TIERS_SITE]) expect(text, label).not.toMatch(BATCHING)
  })

  it('HARDEN_DOCS_SKIP reads a skip of Harden on a docs-only diff, and nothing less', () => {
    for (const text of ['skips Harden on a docs-only diff', 'skip Harden on a docs-only diff', 'lean skips Harden on a docs-only diff.']) expect(HARDEN_DOCS_SKIP.test(text), text).toBe(true)
    for (const text of ['SKIPPED on a docs-only diff', 'skips Harden', 'runs Harden on a docs-only diff', 'skips Harden on a docs only diff']) expect(HARDEN_DOCS_SKIP.test(text), text).toBe(false)
  })

  it('the sentences of a doc text split after a full stop, and not inside a file name', () => {
    expect(sentencesOf('At `lean`, it skips Harden. The `README.md` file stays. `devflow gates` keeps it.')).toEqual(['At `lean`, it skips Harden.', 'The `README.md` file stays.', '`devflow gates` keeps it.'])
    expect(sentencesOf('One sentence only')).toEqual(['One sentence only'])
  })

  describe('the detailed sites state the report notes and the level of the Harden skip, and the two docs hold one block', () => {
    const notes = ['Harden: SKIPPED (docs-only diff)', 'Harden: ran']
    const skipSentence = 'At `lean`, `/implement` skips Harden on a docs-only diff when every path is a docs path.'
    const noteSentence = 'The report says `Harden: SKIPPED (docs-only diff)` on a skip, and `Harden: ran` otherwise.'
    const keepSentence = 'Run `devflow gates --set standard` or `--set full` to keep Harden on every diff.'
    const detailText = `${skipSentence} ${noteSentence} ${keepSentence}`
    const probe = (text: string, label = 'the probe site'): DocSite => ({ label, text, cmds: ['implement'] })
    const detailDefects = (text: string): string[] => collectHardenDetailDefects([probe(text)], [], notes)
    const sharedDefects = (...texts: string[]): string[] => collectHardenDetailDefects([], texts.map((text, i) => probe(text, `probe site ${i + 1}`)), notes)

    it('known-bad probes (test-only sites): a site with each note once and the skip at lean is clean, and the keep-Harden sentence is not read as the skip', () => {
      expect(detailDefects(detailText)).toEqual([])
      expect(detailDefects(`${detailText} ${keepSentence}`), 'a second keep-Harden sentence').toEqual([])
    })

    it('known-bad probes (test-only sites): a wrong, missing or repeated report note is reported', () => {
      expect(detailDefects(detailText.replace('`Harden: SKIPPED (docs-only diff)`', '`Harden: SKIPPED (docs only)`')), 'a wrong literal').toEqual(['the probe site does not state the report note `Harden: SKIPPED (docs-only diff)`'])
      expect(detailDefects(detailText.replace(', and `Harden: ran` otherwise', '')), 'the ran note dropped').toEqual(['the probe site does not state the report note `Harden: ran`'])
      expect(detailDefects(`${detailText} ${noteSentence}`), 'both notes twice').toEqual([
        'the probe site states the report note `Harden: SKIPPED (docs-only diff)` 2 times, expected once',
        'the probe site states the report note `Harden: ran` 2 times, expected once',
      ])
      expect(detailDefects('Nothing about Harden.'), 'a site with no skip sentence owes the notes only: the effect count owns the skip').toEqual([
        'the probe site does not state the report note `Harden: SKIPPED (docs-only diff)`',
        'the probe site does not state the report note `Harden: ran`',
      ])
    })

    it('known-bad probes (test-only sites): a skip sentence that does not name lean, or names standard or full, is reported', () => {
      expect(detailDefects(detailText.replace('`lean`', '`standard`')), 'standard skips Harden').toEqual([
        'the probe site states the Harden skip in a sentence that does not name `lean`',
        'the probe site states the Harden skip in a sentence that names `standard`',
      ])
      expect(detailDefects(detailText.replace('At `lean`,', 'At `lean` and `full`,')), 'full skips Harden').toEqual(['the probe site states the Harden skip in a sentence that names `full`'])
      expect(detailDefects(detailText.replace('At `lean`,', 'At every level,')), 'no level named').toEqual(['the probe site states the Harden skip in a sentence that does not name `lean`'])
    })

    it('known-bad probes (test-only sites): two docs hold the same block from the skip sentence to the last report note, and text outside it is free', () => {
      expect(sharedDefects(detailText, detailText)).toEqual([])
      expect(sharedDefects(detailText, `Intro text. ${detailText} Other text.`), 'text outside the block').toEqual([])
      expect(sharedDefects(detailText, detailText.replace('docs path', 'path')), 'a condition changed in one doc').toEqual(['probe site 1 and probe site 2 hold different Harden blocks'])
      expect(sharedDefects(detailText, detailText.replace(' when every path is a docs path', '')), 'a condition dropped in one doc').toEqual(['probe site 1 and probe site 2 hold different Harden blocks'])
      expect(sharedDefects(detailText, 'Nothing about Harden.'), 'a doc with no block').toEqual(['probe site 2 holds no Harden block, from the sentence that skips Harden to the sentence that holds its last report note'])
    })
  })

  it('known-bad probes (test-only sites): while no table has a row, no effect is owed and a retired claim is allowed', () => {
    expect(collectDocSiteDefects([site('Nothing about the levels.')], none)).toEqual([])
    expect(collectDocSiteDefects([site(RETIRED_CLAIMS.join(' and '))], none)).toEqual([])
    expect(collectDocSiteDefects([site(effect)], none), 'an effect with no row to state').toEqual([])
  })

  it('known-bad probes (test-only sites): a site that states the effect once is clean, and a site without it, or with it twice, is reported', () => {
    expect(collectDocSiteDefects([site(effect)], both)).toEqual([])
    expect(collectDocSiteDefects([site('Nothing about Polish here.')], both)).toEqual([
      `the probe site does not state the effect of the implement row | 3 Polish | skip | skip |: it must match ${POLISH_SKIP}`,
      `the probe site does not state the effect of the resolve row | 6 Polish | skip | skip |: it must match ${POLISH_SKIP}`,
    ])
    expect(collectDocSiteDefects([site(`${effect} ${effect}`)], both)).toEqual([
      'the probe site states the effect of the implement row | 3 Polish | skip | skip | 2 times, expected once',
      'the probe site states the effect of the resolve row | 6 Polish | skip | skip | 2 times, expected once',
    ])
  })

  it('known-bad probes (test-only sites): a site owes the effect of the rows of its own commands only', () => {
    expect(collectDocSiteDefects([site('No effect here.', ['implement'])], onlyResolve), 'an /implement site while only /resolve has a row').toEqual([])
    expect(collectDocSiteDefects([site('No effect here.', ['resolve'])], onlyResolve)).toEqual([
      `the probe site does not state the effect of the resolve row | 6 Polish | skip | skip |: it must match ${POLISH_SKIP}`,
    ])
    expect(collectDocSiteDefects([site(effect, ['resolve'])], onlyResolve)).toEqual([])
  })

  it('known-bad probes (test-only sites): a site read as one level owes the effect of a row only when its cell for that level is not -', () => {
    const probeEffect = /\bprobe effect\b/
    const probeRow = '| 4 Self-Review | - | apply: x |'
    const refs = { implement: withRows(REFS.implement, ['| 3 Polish | skip | skip |', probeRow]), resolve: none.resolve }
    const effects = new Map<string, RegExp>([...ROW_EFFECTS, [`implement:${probeRow}`, probeEffect]])
    const at = (text: string, level?: DocSite['level']): DocSite => ({ label: 'the probe site', text, cmds: ['implement'], level })
    const stated = `${effect} The probe effect.`
    const cellDefect = `the probe site states the effect of the implement row ${probeRow}, whose standard cell is -`
    const missingDefect = `the probe site does not state the effect of the implement row ${probeRow}: it must match ${probeEffect}`
    expect(collectDocSiteDefects([at(stated, 'standard')], refs, effects), 'a standard site with the phrase').toEqual([cellDefect])
    expect(collectDocSiteDefects([at(`${stated} The probe effect again.`, 'standard')], refs, effects), 'a standard site with the phrase twice').toEqual([cellDefect])
    expect(collectDocSiteDefects([at(effect, 'standard')], refs, effects), 'a standard site without the phrase').toEqual([])
    expect(collectDocSiteDefects([at(effect, 'lean')], refs, effects), 'a lean site without the phrase').toEqual([missingDefect])
    expect(collectDocSiteDefects([at(stated, 'lean')], refs, effects), 'a lean site with the phrase once').toEqual([])
    expect(collectDocSiteDefects([at(`${stated} The probe effect again.`, 'lean')], refs, effects), 'a lean site with the phrase twice').toEqual([
      `the probe site states the effect of the implement row ${probeRow} 2 times, expected once`,
    ])
    expect(collectDocSiteDefects([at(effect)], refs, effects), 'a level-blind site without the phrase').toEqual([missingDefect])
    expect(collectDocSiteDefects([at(stated)], refs, effects), 'a level-blind site with the phrase once').toEqual([])
  })

  it('known-bad probes (test-only sites): a row whose cells cannot be read owes its effect at every level', () => {
    const unreadable = '| 4 Self-Review | apply: x |'
    const refs = { implement: withRows(REFS.implement, ['| 3 Polish | skip | skip |', unreadable]), resolve: none.resolve }
    const effects = new Map<string, RegExp>([...ROW_EFFECTS, [`implement:${unreadable}`, /\bprobe effect\b/]])
    for (const level of ['standard', 'lean'] as const) {
      const defects = collectDocSiteDefects([{ label: 'the probe site', text: effect, cmds: ['implement'], level }], refs, effects)
      expect(defects, level).toEqual([`the probe site does not state the effect of the implement row ${unreadable}: it must match /\\bprobe effect\\b/`])
    }
  })

  it('known-bad probes (test-only sites): once any table has a row, each retired claim at a site is reported', () => {
    for (const claim of RETIRED_CLAIMS) {
      expect(collectDocSiteDefects([site(`${effect} The references hold ${claim}.`)], both), claim).toEqual([`a table has a row (implement, resolve), but the probe site still says "${claim}"`])
      expect(collectDocSiteDefects([site(`${effect} ${claim}`, ['implement'])], onlyResolve), `${claim}, a site of the command with no row`).toEqual([`a table has a row (resolve), but the probe site still says "${claim}"`])
    }
  })

  it('known-bad probes (test-only sites): a shipped row with no ROW_EFFECTS entry is reported, and one changed cell is a new row', () => {
    const unregistered = withRows(REFS.implement, ['| 3 Polish | skip | skip |', '| 5 Alignment Check | pass level | - |'])
    expect(collectDocSiteDefects([site(effect)], { ...both, implement: unregistered })).toEqual(['the implement row | 5 Alignment Check | pass level | - | has no ROW_EFFECTS entry'])
    const changed = withRows(REFS.implement, ['| 3 Polish | skip | - |'])
    expect(collectDocSiteDefects([site(effect)], { ...both, implement: changed })).toEqual(['the implement row | 3 Polish | skip | - | has no ROW_EFFECTS entry'])
    const other = new Map([['implement:| 3 Polish | skip | skip |', /\bleaves out Polish\b/]])
    expect(collectDocSiteDefects([site(effect, ['implement'])], both, other), 'a registered effect that the site lacks').toEqual([
      'the resolve row | 6 Polish | skip | skip | has no ROW_EFFECTS entry',
      'the probe site does not state the effect of the implement row | 3 Polish | skip | skip |: it must match /\\bleaves out Polish\\b/',
    ])
  })

  it('known-bad probes (test-only sites): a ROW_EFFECTS entry that names no shipped row is reported', () => {
    const polishEntries = new Map<string, RegExp>([['implement:| 3 Polish | skip | skip |', POLISH_SKIP], ['resolve:| 6 Polish | skip | skip |', POLISH_SKIP]])
    expect(collectStaleEffectDefects(both, polishEntries), 'an entry for each shipped row').toEqual([])
    expect(collectStaleEffectDefects(none, polishEntries), 'no table has a row').toEqual([
      'the ROW_EFFECTS entry implement:| 3 Polish | skip | skip | names no shipped row',
      'the ROW_EFFECTS entry resolve:| 6 Polish | skip | skip | names no shipped row',
    ])
    expect(collectStaleEffectDefects(onlyResolve, polishEntries), 'the /implement row retired').toEqual(['the ROW_EFFECTS entry implement:| 3 Polish | skip | skip | names no shipped row'])
    const changed = { ...both, implement: withRows(REFS.implement, ['| 3 Polish | skip | - |']) }
    expect(collectStaleEffectDefects(changed, polishEntries), 'one cell of the row changed').toEqual(['the ROW_EFFECTS entry implement:| 3 Polish | skip | skip | names no shipped row'])
    expect(collectStaleEffectDefects(both, new Map([...polishEntries, ['implement:| 3 Polish | - | skip |', POLISH_SKIP]])), 'an entry for a row that was never shipped').toEqual(['the ROW_EFFECTS entry implement:| 3 Polish | - | skip | names no shipped row'])
  })

  // The probes over the real sites need the rows to ship, so they ride with them. The pin test below fixes `shippedRows`,
  // so an empty `DECIDED_ROWS` fails there instead of passing on an empty loop.
  const shippedRows = LEVEL_CMDS.flatMap(cmd => DECIDED_ROWS[cmd].map(row => ({ cmd, row })))
  const withRowCmds = LEVEL_CMDS.filter(cmd => DECIDED_ROWS[cmd].length > 0)

  it('known-bad probes (real sites): the decided rows are the ones the probes loop over', () => {
    expect(shippedRows.map(({ cmd, row }) => `${cmd}:${row}`)).toEqual([
      'implement:| 3 Polish | skip | skip |',
      'implement:| 4 Self-Review | - | apply: harden-scope |',
      'implement:| 5 Alignment Check | pass level; apply: single-pass | pass level; apply: single-pass |',
      'resolve:| 2 Global Triage | pass level | pass level |',
      'resolve:| 6 Polish | skip | skip |',
    ])
    expect(withRowCmds).toEqual(['implement', 'resolve'])
  })

  const effectOf = (cmd: LevelCmd, row: string): RegExp => {
    const found = ROW_EFFECTS.get(`${cmd}:${row}`)
    if (found === undefined) throw new Error(`the shipped ${cmd} row ${row} has no ROW_EFFECTS entry`)
    return found
  }

  it('known-bad probes (real sites): a real site with an effect phrase that it owes taken out is reported for the rows of that effect only', () => {
    const covered = new Set<string>()
    for (const real of DOC_SITES) {
      const owed = shippedRows.filter(({ cmd, row }) => owes(real, cmd, row))
      expect(owed.length, `${real.label}: no shipped row to state`).toBeGreaterThan(0)
      const groups = new Map<RegExp, Array<{ cmd: LevelCmd; row: string }>>()
      for (const entry of owed) {
        const effect = effectOf(entry.cmd, entry.row)
        groups.set(effect, [...(groups.get(effect) ?? []), entry])
      }
      for (const [effect, rows] of groups) {
        const without: DocSite = { ...real, text: seed(real.text, effect, 'does nothing special') }
        expect(collectDocSiteDefects([without], REFS), `${real.label}: ${effect}`).toEqual(
          rows.map(({ cmd, row }) => `${real.label} does not state the effect of the ${cmd} row ${row}: it must match ${effect}`),
        )
        for (const { cmd, row } of rows) covered.add(`${cmd}:${row}`)
      }
    }
    expect(covered.size, 'every shipped row was probed at a real site').toBe(shippedRows.length)
  })

  it('known-bad probes (real sites): a retired claim put back at any real site is reported', () => {
    for (const real of DOC_SITES) {
      for (const claim of RETIRED_CLAIMS) {
        const putBack: DocSite = { ...real, text: `${real.text} The references hold ${claim}.` }
        expect(collectDocSiteDefects([putBack], REFS), `${real.label}: ${claim}`).toEqual([`a table has a row (${withRowCmds.join(', ')}), but ${real.label} still says "${claim}"`])
      }
    }
  })

  it('a changed cell is a row ending in skip made -, or any other row made skip', () => {
    expect(changeLastCell('| 3 Polish | skip | skip |')).toBe('| 3 Polish | skip | - |')
    expect(changeLastCell('| 4 Self-Review | - | apply: harden-scope |')).toBe('| 4 Self-Review | - | skip |')
  })

  it('known-bad probes (real sites): an unregistered row or one changed cell in a shipped table is reported against the real sites', () => {
    const extra: Readonly<Record<string, string>> = { implement: '| 5 Alignment Check | pass level | - |', resolve: '| 2 Global Triage | pass level | - |' }
    for (const { cmd, row } of shippedRows) {
      const rows = DECIDED_ROWS[cmd]
      const added = withRows(REFS[cmd], [...rows, extra[cmd]])
      expect(collectDocSiteDefects(DOC_SITES, { ...REFS, [cmd]: added }), `${cmd}: an unregistered row`).toEqual([`the ${cmd} row ${extra[cmd]} has no ROW_EFFECTS entry`])
      const changed = changeLastCell(row)
      expect(changed, `${cmd}: the cell change landed`).not.toBe(row)
      const edited = withRows(REFS[cmd], rows.map(each => (each === row ? changed : each)))
      expect(collectDocSiteDefects(DOC_SITES, { ...REFS, [cmd]: edited }), `${cmd}: one changed cell`).toEqual([`the ${cmd} row ${changed} has no ROW_EFFECTS entry`])
    }
  })

  it('known-bad probes (real sites): a retired row leaves its ROW_EFFECTS entry stale, and the shipped tables leave none', () => {
    expect(collectStaleEffectDefects(REFS)).toEqual([])
    for (const { cmd, row } of shippedRows) {
      const kept = DECIDED_ROWS[cmd].filter(each => each !== row)
      const retired = withRows(REFS[cmd], kept)
      expect(collectStaleEffectDefects({ ...REFS, [cmd]: retired }), `${cmd}: the row ${row} retired`).toEqual([`the ROW_EFFECTS entry ${cmd}:${row} names no shipped row`])
    }
  })

  it('the detailed Harden sites are the registered ones, the notes are the ones the shipped bullet sets, and the real texts leave no defect', () => {
    expect(HARDEN_DETAIL_SITES.map(s => s.label)).toEqual([
      'the README.md Gate level paragraph',
      'the docs/cli-reference.md What reads it paragraph',
      'the docs/commands.md /implement section',
    ])
    expect(HARDEN_SHARED_SITES.map(s => s.label)).toEqual(['the docs/cli-reference.md What reads it paragraph', 'the docs/commands.md /implement section'])
    for (const detailed of [...HARDEN_DETAIL_SITES, ...HARDEN_SHARED_SITES]) expect(DOC_SITES, detailed.label).toContain(detailed)
    expect(HARDEN_NOTES, 'the notes of the harden-scope bullet').toEqual(['Harden: SKIPPED (docs-only diff)', 'Harden: ran'])
    expect(collectHardenDetailDefects(HARDEN_DETAIL_SITES, HARDEN_SHARED_SITES, HARDEN_NOTES)).toEqual([])
  })

  it('known-bad probes (real sites): a detailed site with a wrong report note or a skip at standard is reported, and so are two docs that hold different blocks', () => {
    const edit = (real: ReadSite, from: string, to: string): ReadSite => ({ ...real, text: seedOnce(real.text, from, to) })
    for (const real of HARDEN_DETAIL_SITES) {
      expect(collectHardenDetailDefects([edit(real, '`Harden: SKIPPED (docs-only diff)`', '`Harden: SKIPPED (docs only)`')], [], HARDEN_NOTES), `${real.label}: a wrong literal`).toEqual([
        `${real.label} does not state the report note \`Harden: SKIPPED (docs-only diff)\``,
      ])
      expect(collectHardenDetailDefects([edit(real, '`Harden: ran`', '`Harden: ran later`')], [], HARDEN_NOTES), `${real.label}: the ran note changed`).toEqual([
        `${real.label} does not state the report note \`Harden: ran\``,
      ])
      const sentence = sentencesOf(real.text).filter(each => HARDEN_DOCS_SKIP.test(each))
      expect(sentence.length, `${real.label}: one sentence states the skip`).toBe(1)
      expect(collectHardenDetailDefects([edit(real, sentence[0], sentence[0].replaceAll('`lean`', '`standard`'))], [], HARDEN_NOTES), `${real.label}: standard skips Harden`).toEqual([
        `${real.label} states the Harden skip in a sentence that does not name \`lean\``,
        `${real.label} states the Harden skip in a sentence that names \`standard\``,
      ])
    }
    const [cli, commands] = HARDEN_SHARED_SITES
    const dropped = edit(cli, 'The compliance lens is exactly `off`. ', '')
    expect(collectHardenDetailDefects([], [dropped, commands], HARDEN_NOTES), 'a condition dropped from one doc').toEqual([`${cli.label} and ${commands.label} hold different Harden blocks`])
    expect(collectHardenDetailDefects([], [cli, edit(commands, 'No loaded instruction, rules or imported file names the path. ', '')], HARDEN_NOTES), 'a condition dropped from the other doc').toEqual([`${cli.label} and ${commands.label} hold different Harden blocks`])
  })

  it('EVALUATE_ONE_FIX_ROUND and EVALUATE_FIX_ROUTE read their wording, and nothing less', () => {
    for (const text of ['one Fix round runs', 'On a misalignment, one Fix round runs and Evaluate does not run again.']) expect(EVALUATE_ONE_FIX_ROUND.test(text), text).toBe(true)
    for (const text of ['one fix round', 'up to two Fix rounds', 'one Fix rounds', 'oneFix round']) expect(EVALUATE_ONE_FIX_ROUND.test(text), text).toBe(false)
    for (const text of ['reports anything other than COMPLETE', 'If the Fix round reports anything other than COMPLETE, it asks you.']) expect(EVALUATE_FIX_ROUTE.test(text), text).toBe(true)
    for (const text of ['anything other than complete', 'other than COMPLETE', 'anything other than COMPLETED', 'anythingother than COMPLETE']) expect(EVALUATE_FIX_ROUTE.test(text), text).toBe(false)
  })

  describe('the sites state the Fix round and the Fix route of the single Evaluate pass', () => {
    const roundSentence = 'On a misalignment, one Fix round runs and Evaluate does not run again.'
    const routeSentence = 'If the Fix round reports anything other than COMPLETE, `/implement` reports the misalignments to you for a decision.'
    const probe = (text: string, label = 'the probe site'): DocSite => ({ label, text, cmds: ['implement'] })
    const roundCheck = (...sites: DocSite[]): RouteCheck => ({ what: 'the Fix round probe', re: EVALUATE_ONE_FIX_ROUND, sites })
    const routeCheck = (...sites: DocSite[]): RouteCheck => ({ what: 'the Fix route probe', re: EVALUATE_FIX_ROUTE, sites })

    it('known-bad probes (test-only sites): a site with its phrase once is clean, and a site without it, or with it twice, is reported', () => {
      expect(collectEvaluateRouteDefects([roundCheck(probe(roundSentence)), routeCheck(probe(routeSentence))])).toEqual([])
      expect(collectEvaluateRouteDefects([roundCheck(probe(routeSentence))]), 'no Fix round').toEqual(['the probe site does not state the Fix round probe'])
      expect(collectEvaluateRouteDefects([routeCheck(probe(roundSentence))]), 'no Fix route').toEqual(['the probe site does not state the Fix route probe'])
      expect(collectEvaluateRouteDefects([roundCheck(probe(`${roundSentence} ${roundSentence}`))]), 'the Fix round twice').toEqual(['the probe site states the Fix round probe 2 times, expected once'])
      expect(collectEvaluateRouteDefects([routeCheck(probe(`${routeSentence} ${routeSentence}`))]), 'the Fix route twice').toEqual(['the probe site states the Fix route probe 2 times, expected once'])
    })

    it('known-bad probes (test-only sites): a site owes only the phrases of the checks that name it, and the defects follow the order of the checks and their sites', () => {
      expect(collectEvaluateRouteDefects([routeCheck(probe(routeSentence)), roundCheck(probe(roundSentence))]), 'a site of one check owes nothing of the other').toEqual([])
      expect(collectEvaluateRouteDefects([]), 'no check').toEqual([])
      expect(collectEvaluateRouteDefects([roundCheck(probe('Nothing.', 'site 1'), probe(roundSentence, 'site 2'), probe('Nothing.', 'site 3')), routeCheck(probe('Nothing.', 'site 4'))])).toEqual([
        'site 1 does not state the Fix round probe',
        'site 3 does not state the Fix round probe',
        'site 4 does not state the Fix route probe',
      ])
    })

    it('known-bad probes (real sites): the checks cover the README and the two docs for the Fix round, the two docs for the route, and the real texts leave no defect', () => {
      expect(FIX_ROUND_SITES.map(s => s.label)).toEqual([
        'the README.md Gate level paragraph',
        'the docs/cli-reference.md What reads it paragraph',
        'the docs/commands.md /implement section',
      ])
      expect(FIX_ROUTE_SITES.map(s => s.label)).toEqual(['the docs/cli-reference.md What reads it paragraph', 'the docs/commands.md /implement section'])
      expect(EVALUATE_ROUTE_CHECKS.map(check => check.re)).toEqual([EVALUATE_ONE_FIX_ROUND, EVALUATE_FIX_ROUTE])
      for (const real of [...FIX_ROUND_SITES, ...FIX_ROUTE_SITES]) expect(DOC_SITES, real.label).toContain(real)
      expect(collectEvaluateRouteDefects(EVALUATE_ROUTE_CHECKS)).toEqual([])
    })

    it('known-bad probes (real sites): a real site with its Fix round or Fix route phrase taken out or repeated is reported', () => {
      for (const check of EVALUATE_ROUTE_CHECKS) {
        for (const real of check.sites) {
          const without: DocSite = { ...real, text: seed(real.text, check.re, 'does nothing special') }
          expect(collectEvaluateRouteDefects([{ ...check, sites: [without] }]), `${real.label}: ${check.what} taken out`).toEqual([`${real.label} does not state ${check.what}`])
          const phrase = real.text.match(check.re)
          expect(phrase, `${real.label}: the phrase is there`).not.toBeNull()
          const repeated: DocSite = { ...real, text: `${real.text} ${phrase?.[0] ?? ''}` }
          expect(collectEvaluateRouteDefects([{ ...check, sites: [repeated] }]), `${real.label}: ${check.what} repeated`).toEqual([`${real.label} states ${check.what} 2 times, expected once`])
        }
      }
    })
  })
})
