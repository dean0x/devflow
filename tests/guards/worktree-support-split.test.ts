/**
 * D-WORKTREE-DISCOVERY-ON-DEMAND — `worktree-support` preloads what every agent needs and
 * loads the rest on demand.
 *
 * The skill rides in the preload of every agent. Path resolution and the protected-branch list are
 * read by all of them, but the seven-step discovery algorithm and the multi-worktree table are used
 * only by `/code-review` and `/resolve`, which run in the main thread. So the algorithm lives in
 * `references/discovery.md`, and those two commands send their reader there through the skill: they
 * invoke `devflow:worktree-support`, then Read `references/discovery.md` from the skill's base
 * directory. No install path is named, and the protected-branch list stays in the skill's canonical
 * section, which `tests/git.test.ts` holds equal to `TRUNK_BRANCHES`: `discovery.md` points at that
 * section and copies none of it (the single-authority rule).
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import * as path from 'path'

import { requireDistFile } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SKILL_DIR = path.join(ROOT, 'src', 'assets', 'skills', 'worktree-support')
const read = (rel: string): string => readFileSync(path.join(SKILL_DIR, rel), 'utf-8')

/** The preload is billed on every agent spawn, so the skill file has a byte cap. */
const SKILL_MAX_BYTES = 1_900

const CANONICAL_HEADING = '## Protected Branches (Canonical List)'

/** The backtick tokens on the first non-empty line under the canonical heading. */
function canonicalBranches(skill: string): string[] {
  const lines = skill.split('\n')
  const at = lines.indexOf(CANONICAL_HEADING)
  const list = lines.slice(at + 1).find(l => l.trim() !== '') ?? ''
  return [...list.matchAll(/`([^`]+)`/g)].map(m => m[1])
}

/** Named collector: what the skill file keeps or moves wrongly. */
export function collectSkillDefects(skill: string): string[] {
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need(`over ${SKILL_MAX_BYTES} bytes`, Buffer.byteLength(skill) <= SKILL_MAX_BYTES)
  need('lost the Iron Law', skill.includes('WORKTREE_PATH IS A PREFIX, NOT A FLAG'))
  need('lost the path-resolution table', skill.includes('## Agent Path Resolution') && skill.includes('| Git commands |'))
  need('lost the canonical protected-branch section', skill.includes(CANONICAL_HEADING) && canonicalBranches(skill).length >= 8)
  need('lost the HUD mirror note', skill.includes('`TRUNK_BRANCHES`'))
  need('still holds the discovery algorithm', !skill.includes('## Worktree Discovery Algorithm'))
  need('still holds the multi-worktree table', !skill.includes('## Multi-Worktree Mode'))
  const ext = skill.slice(skill.indexOf('## Extended References'))
  need('no Extended References section', skill.includes('## Extended References'))
  need('Extended References lacks discovery.md', ext.includes('`references/discovery.md`'))
  need('Extended References lacks roots.md', ext.includes('`references/roots.md`'))
  return out
}

/** Named collector: how the moved reference falls short, or copies the list it must point to. */
export function collectDiscoveryDefects(discovery: string, branches: readonly string[]): string[] {
  const out: string[] = []
  for (let n = 1; n <= 7; n++) {
    if (!new RegExp(`^### Step ${n}: `, 'm').test(discovery)) out.push(`no "### Step ${n}: " heading`)
  }
  if (!discovery.includes('## Multi-Worktree Mode')) out.push('no multi-worktree section')
  if (!discovery.includes(CANONICAL_HEADING)) out.push('does not point at the canonical protected-branch section')
  const copied = branches.filter(b => discovery.includes(`\`${b}\``))
  if (copied.length > 0) out.push(`copies protected branches: ${copied.join(', ')}`)
  return out
}

describe('worktree-support keeps the preload small (D-WORKTREE-DISCOVERY-ON-DEMAND)', () => {
  it('SKILL.md keeps the path resolution and the canonical list, and moves the algorithm out', () => {
    expect(collectSkillDefects(read('SKILL.md'))).toEqual([])
  })

  it('references/discovery.md holds all seven steps and the multi-worktree table, and copies no branch name', () => {
    expect(existsSync(path.join(SKILL_DIR, 'references', 'discovery.md'))).toBe(true)
    expect(collectDiscoveryDefects(read('references/discovery.md'), canonicalBranches(read('SKILL.md')))).toEqual([])
  })

  it('roots.md names discovery.md at both back-pointers and no longer sends its reader to SKILL.md for discovery', () => {
    const roots = read('references/roots.md')
    expect(roots).toContain('Companion to the worktree discovery algorithm in `discovery.md`')
    expect(roots).toContain('(discovery Step 3 in `discovery.md`)')
    expect(roots).not.toMatch(/discovery[^\n]*`SKILL\.md`/)
  })

  it('/code-review and /resolve send the reader to references/discovery.md through the skill, with no install path', () => {
    for (const host of ['code-review.md', 'resolve.md']) {
      const text = requireDistFile(host)
      expect(text, `${host}: the pointer`).toContain(
        'Invoke the `devflow:worktree-support` skill, then Read its `references/discovery.md` from the skill\'s base directory',
      )
      expect(text, `${host}: an install path`).not.toMatch(/skills\/devflow:worktree-support/)
      expect(text, `${host}: the old pointer`).not.toContain('See the `devflow:worktree-support` skill for the full 7-step algorithm')
    }
  })

  it('known-bad probe: each way of undoing the split is reported by the same collectors', () => {
    const skill = read('SKILL.md')
    const bloated = `${skill}\n## Multi-Worktree Mode\n\n${'x'.repeat(SKILL_MAX_BYTES)}\n`
    expect(collectSkillDefects(bloated)).toEqual([
      `over ${SKILL_MAX_BYTES} bytes`,
      'still holds the multi-worktree table',
    ])
    expect(collectSkillDefects(skill.replace('- `references/discovery.md`', '- `references/other.md`'))).toEqual([
      'Extended References lacks discovery.md',
    ])
    const branches = canonicalBranches(skill)
    expect(branches, 'the canonical list was not read').toContain('main')
    const discovery = read('references/discovery.md')
    expect(collectDiscoveryDefects(`${discovery}\nExclude \`main\` and \`trunk\`.\n`, branches)).toEqual([
      'copies protected branches: main, trunk',
    ])
    expect(collectDiscoveryDefects(discovery.replace('### Step 4: ', '### Stage 4: '), branches)).toEqual([
      'no "### Step 4: " heading',
    ])
  })
})
