/**
 * The settings partial (#392, D-SETTINGS-LINE) — `_partials/_settings.mds`
 * `settings_resolve()`, the one way a prompt learns the repository's settings.
 *
 *   wiring    Exactly the 14 command hosts import it, each as an ALIAS import
 *             (a selective import deep-clones the imported scope into
 *             every define of the importer), and no partial does: the gates
 *             (`_compliance`, `_knowledge`, `_publication`, `_decisions`) take the
 *             line their host resolved above. A host expands the block ONCE
 *             (D-SETTINGS-LINE), immediately before the earliest of its consumers:
 *             its decisions gate, compliance lens, publication gate, knowledge
 *             write-back Step 1 or a Skim spawn that takes `LEARNING`.
 *   grammar   The accepted line written out in the prompt names the fields of the
 *             script's SETTINGS_LINE_RE in the same order, with the same closed
 *             value sets, and the fallback is SETTINGS_FAIL_CLOSED_LINE byte for
 *             byte. The grammar is required from the script, never transcribed,
 *             so a change there moves these pins with it.
 *
 * NOT covered: whether the model applies the shape check it is told to apply —
 * that is behaviour, not text. The script's own output gate
 * (isCoherentSettingsLine) is the first line of defence; this prose is the second.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile, requireDistFiles, walkFiles } from '../helpers.js'
import { COMPLIANCE_FRAMEWORKS } from '../../src/core/compliance.js'
import { SETTINGS_SCRIPT } from '../evidence-policy/scripted-shim.js'
import { SETTINGS_BLOCK_HOSTS } from '../fixtures/mds-manifest.js'

const SETTINGS = createRequire(import.meta.url)(SETTINGS_SCRIPT) as {
  readonly SETTINGS_LINE_RE: RegExp
  readonly SETTINGS_FAIL_CLOSED_LINE: string
}

const PARTIAL = 'src/assets/commands/_partials/_settings.mds'
const ALIAS_IMPORT = '@import "./_partials/_settings.mds" as settings'
const OPENING = '**Resolve the settings line**'
const INVOCATION = 'node "$HOME/.devflow/scripts/resolve-settings.cjs" "{root}" 2>/dev/null; echo "exit=$?"'

/** The consumers of the line, by the sentence each compiles to. A host's block precedes the earliest it carries. */
const CONSUMER_ANCHORS: ReadonlyArray<readonly [string, string]> = [
  ['the decisions gate', 'When the settings line says `LEARNING=off`'],
  ['the compliance lens', '**Resolve the compliance lens**'],
  ['the publication gate', '**Resolve `REVIEW_PUBLICATION` per worktree:**'],
  ['the write-back Step 1', 'take the settings line resolved above for that root'],
  ['a Skim spawn taking LEARNING', '`LEARNING` from the settings line'],
  ['a fenced Skim spawn taking LEARNING', 'LEARNING: {LEARNING from the settings line}'],
]

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

/** The body between `@define <name>():` and its `@end`. */
function defineBody(text: string, name: string): string {
  const lines = text.split('\n')
  const start = lines.indexOf(`@define ${name}():`)
  const end = lines.indexOf('@end', start + 1)
  if (start === -1 || end === -1) throw new Error(`no @define ${name}() block`)
  return lines.slice(start + 1, end).join('\n')
}

/** Named collector: every .mds under src/ that imports the settings partial, with the import line. */
function collectSettingsImports(): Array<{ file: string; line: string }> {
  const out: Array<{ file: string; line: string }> = []
  for (const abs of walkFiles(path.join(ROOT, 'src'), f => f.endsWith('.mds'))) {
    for (const line of readFileSync(abs, 'utf-8').split('\n')) {
      if (line.startsWith('@import') && line.includes('_settings.mds')) {
        out.push({ file: path.relative(ROOT, abs).split(path.sep).join('/'), line })
      }
    }
  }
  return out
}

/**
 * Named collector: the problems in one compiled host's settings block. The host
 * carries exactly one, and it sits before every consumer the host carries.
 */
function collectBlockProblems(file: string, text: string): string[] {
  const blocks = text.split(OPENING).length - 1
  if (blocks !== 1) return [`${file}: ${blocks} settings blocks (expected 1)`]
  const block = text.indexOf(OPENING)
  return CONSUMER_ANCHORS
    .map(([label, anchor]) => [label, text.indexOf(anchor)] as const)
    .filter(([, at]) => at !== -1 && at < block)
    .map(([label]) => `${file}: the block follows "${label}"`)
}

/** The source of one named capture group of SETTINGS_LINE_RE, without the group itself. */
function groupSource(group: string): string {
  const src = SETTINGS.SETTINGS_LINE_RE.source
  const open = `(?<${group}>`
  const start = src.indexOf(open)
  if (start === -1) throw new Error(`SETTINGS_LINE_RE has no (?<${group}>…) group`)
  let depth = 1
  for (let i = start + open.length; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] === '(') depth++
    if (src[i] === ')' && --depth === 0) return src.slice(start + open.length, i)
  }
  throw new Error(`SETTINGS_LINE_RE's (?<${group}>…) group is unbalanced`)
}

/** Field keys and group names of SETTINGS_LINE_RE, in order. */
function scriptFields(): Array<{ key: string; group: string }> {
  return [...SETTINGS.SETTINGS_LINE_RE.source.matchAll(/([A-Z][A-Z_]*)=\(\?<(\w+)>/g)].map(m => ({ key: m[1], group: m[2] }))
}

/** The accepted-line template the partial writes out: the one code span that opens with `TRACKER=<`. */
function template(text: string): string {
  const spans = [...text.matchAll(/`(TRACKER=<[^`]+)`/g)].map(m => m[1])
  if (spans.length !== 1) throw new Error(`expected one line template, found ${spans.length}`)
  return spans[0]
}

/** `KEY=<…>` pairs of a template, splitting on the top-level `|` of each outer <…>. */
function templateFields(t: string): Array<{ key: string; values: string[] }> {
  const out: Array<{ key: string; values: string[] }> = []
  for (const m of t.matchAll(/([A-Z][A-Z_]*)=</g)) {
    let depth = 1
    let i = (m.index ?? 0) + m[0].length
    const bodyStart = i
    for (; i < t.length && depth > 0; i++) {
      if (t[i] === '<') depth++
      if (t[i] === '>') depth--
    }
    const body = t.slice(bodyStart, i - 1)
    const values: string[] = []
    let level = 0
    let cur = ''
    for (const ch of body) {
      if (ch === '<') level++
      if (ch === '>') level--
      if (ch === '|' && level === 0) { values.push(cur); cur = ''; continue }
      cur += ch
    }
    values.push(cur)
    out.push({ key: m[1], values })
  }
  return out
}

/** Named collector: template/script disagreements on the closed value sets and field order. */
function collectGrammarDrift(t: string): string[] {
  const drift: string[] = []
  const script = scriptFields()
  const fields = templateFields(t)
  const keys = fields.map(f => f.key)
  if (keys.join(' ') !== script.map(s => s.key).join(' ')) drift.push(`field order: ${keys.join(' ')}`)
  for (const { key, group } of script) {
    const field = fields.find(f => f.key === key)
    if (field === undefined) continue
    const alternatives = groupSource(group).split('|')
    // A closed set is a group whose every alternative is a bare word.
    if (alternatives.every(a => /^[a-z]+$/.test(a)) && field.values.join('|') !== alternatives.join('|')) {
      drift.push(`${key}: <${field.values.join('|')}> vs (${alternatives.join('|')})`)
    }
  }
  return drift
}

describe('settings partial wiring', () => {
  it('the partial holds exactly one define and no imports', () => {
    const text = source(PARTIAL)
    expect([...text.matchAll(/^@define (\w+)\(/gm)].map(m => m[1])).toEqual(['settings_resolve'])
    expect(text).not.toMatch(/^@import/m)
  })

  it('exactly the SETTINGS_BLOCK_HOSTS import it, each as an alias import, and no partial does', () => {
    const imports = collectSettingsImports()
    expect(imports.map(i => i.file).sort()).toEqual(
      [...SETTINGS_BLOCK_HOSTS].map(h => `src/assets/commands/${h}.mds`).sort(),
    )
    for (const { file, line } of imports) expect(line, file).toBe(ALIAS_IMPORT)
    expect(imports.filter(i => i.file.includes('/_partials/')), 'a partial imports the settings partial').toEqual([])
  })

  it('every compiled host carries one block, before every consumer it carries', () => {
    const files = requireDistFiles()
    expect(files, 'the compiled corpus is the SETTINGS_BLOCK_HOSTS roster').toHaveLength(SETTINGS_BLOCK_HOSTS.length)
    for (const file of files) {
      expect(collectBlockProblems(file, requireDistFile(file)), file).toEqual([])
    }
  })

  it('every compiled host carries at least one consumer, so the order check is not vacuous', () => {
    for (const file of requireDistFiles()) {
      const text = requireDistFile(file)
      expect(CONSUMER_ANCHORS.some(([, anchor]) => text.includes(anchor)), `${file}: no consumer of the settings line`).toBe(true)
    }
  })

  it('known-bad probes: a second block, a block after its consumer and a host with no block are each reported', () => {
    const block = `${OPENING} once per worktree root`
    const gate = 'When the settings line says `LEARNING=off`'
    expect(collectBlockProblems('p.md', `${block}\n${gate}\n${block}`)).toEqual(['p.md: 2 settings blocks (expected 1)'])
    expect(collectBlockProblems('p.md', `${gate}\n${block}`)).toEqual(['p.md: the block follows "the decisions gate"'])
    expect(collectBlockProblems('p.md', gate)).toEqual(['p.md: 0 settings blocks (expected 1)'])
    expect(collectBlockProblems('p.md', `${block}\n${gate}`)).toEqual([])
  })

  it('exactly the SETTINGS_BLOCK_HOSTS roster carries the block (both directions)', () => {
    const carrying = requireDistFiles().filter(f => requireDistFile(f).includes(OPENING)).map(f => f.replace(/\.md$/, '')).sort()
    expect(carrying).toEqual([...SETTINGS_BLOCK_HOSTS].sort())
    // release and dynamic-profile carry the block beside the six that loaded decisions before.
    for (const host of ['release', 'dynamic-profile', 'bug-analysis', 'research', 'dynamic-plan', 'dynamic-tickets']) {
      expect(carrying, host).toContain(host)
    }
  })

  it('every compiled block invokes the resolver with the same bytes', () => {
    const lines = requireDistFiles()
      .flatMap(f => requireDistFile(f).split('\n'))
      .filter(l => l.includes('resolve-settings.cjs'))
    // One invocation per host: the count is the roster's, restated here on purpose.
    expect(lines.length).toBe(14)
    expect([...new Set(lines)]).toEqual([INVOCATION])
  })
})

describe('the accepted line is SETTINGS_LINE_RE written out', () => {
  const body = defineBody(source(PARTIAL), 'settings_resolve')

  it('the template names the script\'s fields, in order, with the same closed value sets', () => {
    expect(scriptFields(), 'no fields parsed from SETTINGS_LINE_RE — the comparison is vacuous').toHaveLength(10)
    expect(collectGrammarDrift(template(body))).toEqual([])
  })

  it('the compliance ids are the script\'s and the registry\'s, in registry order', () => {
    const ids = COMPLIANCE_FRAMEWORKS.map(f => f.id)
    const prose = /each `<id>` is one of ((?:`[a-z0-9-]+`(?:, )?)+)/.exec(body)?.[1] ?? ''
    expect([...prose.matchAll(/`([a-z0-9-]+)`/g)].map(m => m[1])).toEqual(ids)
    const scriptIds = /^off\|generic\|\(\?:([a-z0-9|-]+)\)/.exec(groupSource('compliance'))?.[1].split('|')
    expect(scriptIds).toEqual(ids)
  })

  it('the key and host rules in prose match the script\'s groups', () => {
    expect(groupSource('key')).toBe('none|[A-Z][A-Z0-9_]{1,9}')
    expect(body).toContain('`<key>` is 2–10 of `A-Z`, `0-9` and `_` starting with a letter')
    expect(groupSource('site').startsWith('none|https:\\/\\/[a-z0-9]')).toBe(true)
    expect(body).toContain('`<host>` is a lowercase dotted host name alone')
  })

  it('the fallback is SETTINGS_FAIL_CLOSED_LINE byte for byte, and it is itself an accepted line', () => {
    expect(body).toContain(`use \`${SETTINGS.SETTINGS_FAIL_CLOSED_LINE}\` instead`)
    expect(SETTINGS.SETTINGS_LINE_RE.test(SETTINGS.SETTINGS_FAIL_CLOSED_LINE)).toBe(true)
  })

  it('known-bad probes: a dropped field, a reordered field and a narrowed value set are reported', () => {
    const t = template(body)
    expect(collectGrammarDrift(t.replace(' LEARNING=<on|off>', ''))).toHaveLength(1)
    expect(collectGrammarDrift(t.replace('MEMORY=<on|off> LEARNING=<on|off>', 'LEARNING=<on|off> MEMORY=<on|off>'))).toHaveLength(1)
    expect(collectGrammarDrift(t.replace('TRACKER_WARN=<none|mismatch|invalid>', 'TRACKER_WARN=<none|invalid>'))).toEqual([
      'TRACKER_WARN: <none|invalid> vs (none|mismatch|invalid)',
    ])
  })
})

describe('the learning gate keeps its rationale out of the expanded prompt', () => {
  const DECISIONS = 'src/assets/commands/_partials/_decisions.mds'

  it('an unresolvable settings line keeps LEARNING=on, so a failed resolution loads decisions as before', () => {
    expect(SETTINGS.SETTINGS_FAIL_CLOSED_LINE.split(' ')).toContain('LEARNING=on')
  })

  it('the _decisions.mds header, before its first define, holds the rationale', () => {
    const text = source(DECISIONS)
    const header = text.slice(0, text.indexOf('@define'))
    for (const phrase of ['D-DECISIONS-LEARNING-GATE', 'D-FEATURES-NARROW-ONLY', '`LEARNING=on`', 'advisory context']) {
      expect(header, phrase).toContain(phrase)
    }
  })

  it('the expanded gate is the one sentence: no rationale, no fail-closed wording', () => {
    const gate = defineBody(source(DECISIONS), 'decisions_gate')
    expect(gate).toBe(
      'When the settings line says `LEARNING=off`, set `DECISIONS_CONTEXT` to `(none)` and skip this step, locating no ledger and reading no index.',
    )
    expect(gate).not.toMatch(/fail-closed|advisory|NARROW/)
  })
})
