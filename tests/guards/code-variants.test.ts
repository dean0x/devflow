/**
 * D-CODE-VARIANTS and D-NO-RUNTIME-SKILLS — the shape of the three Code variants (AC-305, AC-306, AC-307).
 *
 * One Code agent paid for every mode's text and skills on every spawn. Three hosts now share one partial
 * (`src/assets/agents/_partials/_code.mds`): Code (implement, issue-fix), Code-fix (validation-fix,
 * alignment-fix, qa-fix, ci-fix) and Code-edit (edit). This file holds what the three must share and what
 * none of them may carry, read from the COMPILED prompts a session loads, in both learning variants:
 *
 *   AC-305  No variant has a Step 0 table, a `DOMAIN` input or a runtime skill-load instruction, so no
 *           variant carries a `Skill(...)` call at all (D-COMPLIANCE-INJECT: the compliance skill's load
 *           reaches a spawn through the command's directive, never through a variant body; the guard in
 *           compliance-injection.test.ts holds that side).
 *   AC-306  Every variant keeps the security-scan block and, with learning on, `apply-decisions` (preload,
 *           input and the instruction to state a decision in words). Only Code preloads
 *           `apply-feature-knowledge` and takes `FEATURE_KNOWLEDGE`: only the implement and issue-fix
 *           spawns pass it.
 *   AC-307  Each variant has a learning-off build, listed in the manifest and present on disk. (The
 *           install of those files is held by the learning-variants install tests, which walk the same
 *           manifest.)
 *
 * No Code-family spawn in a compiled command passes `DOMAIN` either: the input is gone, so a spawn that
 * still names it is dead weight in a prompt.
 *
 * Every arm runs through a named collector, and each known-bad probe feeds the same collector a mutated
 * body, so a collector that stopped seeing a defect fails its own probe instead of passing vacuously.
 *
 * What a green run does NOT prove: it proves the prompts carry and lack the text. It does not prove a
 * model follows them, or that the Skill tool still lets a model pick a skill by its description.
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import * as path from 'path'

import {
  CODE_AGENT_TYPES, ROOT, codeSlugOf, collectCodeSpawnSites, parseFrontmatterSkills,
  requireDistFile, requireDistFiles, resolveAgentSource, resolveLearningOffSource,
} from '../helpers.js'
import { LEARNING_OFF_FILES, MDS_GENERATOR_HOSTS, LEARNING_VARIANT_HOSTS } from '../fixtures/mds-manifest.js'

const SCAN_OPENER = '**Security scan (conditional):**'
const SCAN_CONDITION = 'Only when this session offers a code-scanning tool.'
const SCAN_UNAVAILABLE = 'report `Security scan: unavailable`'

type Variant = 'on' | 'off'

/** A compiled variant body: learning on, or learning off. */
function compiled(agentType: string, variant: Variant): string {
  const slug = codeSlugOf(agentType)
  if (variant === 'on') return resolveAgentSource(slug).content
  const text = resolveLearningOffSource('agents', slug)
  if (text === null) throw new Error(`dist/learning-off/agents/${slug}.md is absent — run \`npm run build\` first`)
  return text
}

/** Named collector: how a variant falls short of AC-305 (no Step 0 table, no DOMAIN, no runtime skill load). */
export function collectRuntimeSkillDefects(text: string): string[] {
  const out: string[] = []
  if (/^## Step 0\b/m.test(text)) out.push('has a "## Step 0" section')
  if (/^\|\s*Mode\s*\|.*devflow:/m.test(text)) out.push('has a mode-by-skill table')
  if (/\bDOMAIN\b/.test(text)) out.push('names DOMAIN')
  if (/Domain hint|[Ll]oad domain skills/.test(text)) out.push('has a domain-skill section')
  for (const m of text.matchAll(/Skill\(skill="([^"]*)"\)/g)) out.push(`loads ${m[1]} at run time`)
  if (/Load one with `Skill\(/.test(text)) out.push('tells the agent to load a mode skill')
  return out
}

/** Named collector: Code-family spawn sites in compiled commands that still pass `DOMAIN`. */
export function collectDomainSpawnDefects(commands: ReadonlyArray<readonly [string, string]>): string[] {
  return commands.flatMap(([file, text]) =>
    collectCodeSpawnSites(file, text)
      .filter(site => /\bDOMAIN\b/.test(site.payload))
      .map(site => `${file}:${site.line}: a ${site.agentType} spawn passes DOMAIN`),
  )
}

/**
 * Named collector: how a variant falls short of AC-306. `takesKnowledge` is true for Code alone. A body is
 * judged on the lines it carries, so a seeded mutation of the real body is enough to trip each clause.
 */
export function collectSharedKeepDefects(text: string, variant: Variant, takesKnowledge: boolean): string[] {
  const out: string[] = []
  const openers = text.split('\n').filter(l => l.trimStart().startsWith(SCAN_OPENER))
  if (openers.length !== 1) out.push(`carries the scan block ${openers.length} times, expected once`)
  else {
    if (!openers[0].includes(SCAN_CONDITION)) out.push('the scan block lost its condition')
    if (!openers[0].includes(SCAN_UNAVAILABLE)) out.push('the scan block lost its unavailable fallback')
  }
  const skills = parseFrontmatterSkills(text)
  if (variant === 'on') {
    if (!skills.includes('apply-decisions')) out.push('does not preload apply-decisions')
    if (!/^- \*\*DECISIONS_CONTEXT\*\*/m.test(text)) out.push('declares no DECISIONS_CONTEXT input')
    if (!text.includes('State every decision or pitfall you apply in words')) out.push('does not say to state a decision in words')
  } else {
    if (skills.includes('apply-decisions')) out.push('preloads apply-decisions under learning off')
    if (text.includes('DECISIONS_CONTEXT')) out.push('names DECISIONS_CONTEXT under learning off')
  }
  const knowledgeSkill = skills.includes('apply-feature-knowledge')
  const knowledgeInput = /^- \*\*FEATURE_KNOWLEDGE\*\*/m.test(text)
  if (takesKnowledge) {
    if (!knowledgeSkill) out.push('does not preload apply-feature-knowledge')
    if (!knowledgeInput) out.push('declares no FEATURE_KNOWLEDGE input')
  } else {
    if (knowledgeSkill) out.push('preloads apply-feature-knowledge')
    if (text.includes('FEATURE_KNOWLEDGE') || text.includes('apply-feature-knowledge')) out.push('names FEATURE_KNOWLEDGE')
  }
  return out
}

describe('no Code variant carries a Step 0 table, a DOMAIN input or a runtime skill load (AC-305, D-NO-RUNTIME-SKILLS)', () => {
  for (const variant of ['on', 'off'] as const) {
    it(`each learning-${variant} variant is free of all three`, () => {
      for (const agentType of CODE_AGENT_TYPES) {
        const text = compiled(agentType, variant)
        expect(text.length, `${agentType}: the body is empty — the guard would pass vacuously`).toBeGreaterThan(4_000)
        expect(collectRuntimeSkillDefects(text), `${agentType} (learning ${variant})`).toEqual([])
      }
    })
  }

  it('no variant carries a Skill(...) call, the compliance load included', () => {
    for (const variant of ['on', 'off'] as const) {
      for (const agentType of CODE_AGENT_TYPES) {
        const calls = [...compiled(agentType, variant).matchAll(/Skill\(skill="([^"]*)"\)/g)].map(m => m[1])
        expect(calls, `${agentType} (learning ${variant})`).toEqual([])
      }
    }
  })

  it('no Code-family spawn in a compiled command passes DOMAIN', () => {
    const commands = requireDistFiles().map(f => [f, requireDistFile(f)] as const)
    const sites = commands.flatMap(([file, text]) => collectCodeSpawnSites(file, text))
    expect(sites.length, 'no Code-family spawn was read').toBeGreaterThan(15)
    expect(collectDomainSpawnDefects(commands)).toEqual([])
  })

  it('known-bad probe: a Step 0 section, a mode table, DOMAIN, a domain-skill list and a stray Skill load, compliance included, are each reported', () => {
    const real = compiled('Code', 'on')
    expect(collectRuntimeSkillDefects(real), 'the real body is clean, so each seed fails for its own reason').toEqual([])
    expect(collectRuntimeSkillDefects(`${real}\n## Step 0: Mode Skills\n`)).toEqual(['has a "## Step 0" section'])
    expect(collectRuntimeSkillDefects(`${real}\n| Mode | devflow:patterns |\n|---|---|\n`)).toEqual(['has a mode-by-skill table'])
    expect(collectRuntimeSkillDefects(`${real}\n- **DOMAIN**: \`backend\`\n`)).toEqual(['names DOMAIN'])
    expect(collectRuntimeSkillDefects(`${real}\n2. **Load domain skills**: x\n`)).toEqual(['has a domain-skill section'])
    expect(collectRuntimeSkillDefects(`${real}\n- \`backend\`: \`Skill(skill="devflow:typescript")\`\n`)).toEqual(['loads devflow:typescript at run time'])
    expect(collectRuntimeSkillDefects(`${real}\n2. Invoke \`Skill(skill="devflow:compliance")\`.\n`)).toEqual(['loads devflow:compliance at run time'])
    expect(collectRuntimeSkillDefects(`${real}\nLoad one with \`Skill(skill="devflow:<name>")\` when it holds.\n`))
      .toEqual(['loads devflow:<name> at run time', 'tells the agent to load a mode skill'])
  })

  it('known-bad probe: a Code-family spawn that passes DOMAIN is reported, whichever variant it names', () => {
    const real = requireDistFile('implement.md')
    expect(collectDomainSpawnDefects([['implement.md', real]]), 'the real text is clean').toEqual([])
    const code = real.replace('"OPERATION: implement\n', '"OPERATION: implement\nDOMAIN: backend\n')
    expect(code, 'the seed must land').not.toBe(real)
    expect(collectDomainSpawnDefects([['implement.md', code]])).toHaveLength(1)
    const fix = real.replace('"OPERATION: alignment-fix\n', '"OPERATION: alignment-fix\n   DOMAIN: backend\n')
    expect(fix, 'the seed must land').not.toBe(real)
    expect(collectDomainSpawnDefects([['implement.md', fix]])).toEqual([expect.stringContaining('a Code-fix spawn passes DOMAIN')])
  })
})

describe('every Code variant keeps the scan and apply-decisions; only Code takes feature knowledge (AC-306)', () => {
  for (const variant of ['on', 'off'] as const) {
    it(`each learning-${variant} variant holds its shared text and exactly its own knowledge input`, () => {
      for (const agentType of CODE_AGENT_TYPES) {
        expect(collectSharedKeepDefects(compiled(agentType, variant), variant, agentType === 'Code'), `${agentType} (learning ${variant})`).toEqual([])
      }
    })
  }

  it('known-bad probe: a lost scan block, a lost decisions preload and a stray knowledge input are each reported', () => {
    const fix = compiled('Code-fix', 'on')
    expect(collectSharedKeepDefects(fix, 'on', false), 'the real body is clean, so each seed fails for its own reason').toEqual([])
    const noScan = fix.replace(SCAN_OPENER, '**Scan:**')
    expect(noScan, 'the seed must land').not.toBe(fix)
    expect(collectSharedKeepDefects(noScan, 'on', false)).toEqual(['carries the scan block 0 times, expected once'])
    const noFallback = fix.replace('report `Security scan: unavailable`', 'say nothing')
    expect(noFallback, 'the seed must land').not.toBe(fix)
    expect(collectSharedKeepDefects(noFallback, 'on', false)).toEqual(['the scan block lost its unavailable fallback'])
    const noPreload = fix.replace('  - devflow:apply-decisions\n', '')
    expect(noPreload, 'the seed must land').not.toBe(fix)
    expect(collectSharedKeepDefects(noPreload, 'on', false)).toEqual(['does not preload apply-decisions'])
    const withKnowledge = fix.replace('- **DECISIONS_CONTEXT**', '- **FEATURE_KNOWLEDGE** (optional): x\n- **DECISIONS_CONTEXT**')
    expect(withKnowledge, 'the seed must land').not.toBe(fix)
    expect(collectSharedKeepDefects(withKnowledge, 'on', false)).toEqual(['names FEATURE_KNOWLEDGE'])
    const withSkill = fix.replace('  - devflow:testing\n', '  - devflow:testing\n  - devflow:apply-feature-knowledge\n')
    expect(withSkill, 'the seed must land').not.toBe(fix)
    expect(collectSharedKeepDefects(withSkill, 'on', false)).toEqual(['preloads apply-feature-knowledge', 'names FEATURE_KNOWLEDGE'])
    // Code, which does take knowledge, is reported when it loses it.
    const code = compiled('Code', 'on')
    const lost = code.replace('  - devflow:apply-feature-knowledge\n', '')
    expect(lost, 'the seed must land').not.toBe(code)
    expect(collectSharedKeepDefects(lost, 'on', true)).toEqual(['does not preload apply-feature-knowledge'])
    // Learning off: a decisions token that survives the arm is reported.
    const off = compiled('Code-edit', 'off')
    expect(collectSharedKeepDefects(off, 'off', false)).toEqual([])
    expect(collectSharedKeepDefects(`${off}\nDECISIONS_CONTEXT: x\n`, 'off', false)).toEqual(['names DECISIONS_CONTEXT under learning off'])
  })
})

describe('each Code variant is a host with a learning-off build (AC-307)', () => {
  it('the manifest lists the three hosts and their three learning-off files, and the files exist', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const slug = codeSlugOf(agentType)
      expect(MDS_GENERATOR_HOSTS, `${slug} is a generator host`).toContain(slug)
      expect(LEARNING_VARIANT_HOSTS, `${slug} has a learning variant`).toContain(`agents/${slug}`)
      expect(LEARNING_OFF_FILES, `${slug} has a learning-off file`).toContain(`agents/${slug}.md`)
      expect(existsSync(path.join(ROOT, 'dist', 'learning-off', 'agents', `${slug}.md`)), `dist/learning-off/agents/${slug}.md is built`).toBe(true)
      expect(resolveAgentSource(slug).origin, `${slug} is read from its compiled host`).toBe('dist')
    }
  })

  it('each variant is named for its slug, so the agent type a spawn names resolves to its file', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      expect(/^name: (\S+)$/m.exec(compiled(agentType, 'on'))?.[1], agentType).toBe(agentType)
      expect(/^name: (\S+)$/m.exec(compiled(agentType, 'off'))?.[1], `${agentType} (learning off)`).toBe(agentType)
    }
  })
})
