/**
 * D-SYNTHESIZE-BASE-DIR — a Synthesize agent writes its summary into the directory its command
 * names, so the command must pass that directory under the name the agent's mode reads.
 *
 * `/research` described the summary path in prose and never passed `RESEARCH_BASE_DIR`, the one
 * input the agent's research mode writes through (`mkdir -p ${RESEARCH_BASE_DIR}`), so the summary
 * landed wherever the agent guessed. Review mode (`REVIEW_BASE_DIR`) and bug-analysis mode
 * (`ANALYSIS_BASE_DIR`) were already passed. This guard holds all three: the command's Synthesize
 * spawn for the mode carries the field, the agent writes through the same field, and in `/research`
 * the field names the directory its Research agents write their outputs into.
 */

import { describe, it, expect } from 'vitest'

import { isAgentBlock, parseFences, requireDistFile, resolveAgentSource } from '../helpers.js'

interface ModeRow {
  readonly mode: string
  readonly command: string
  readonly field: string
}

const MODES: readonly ModeRow[] = [
  { mode: 'review', command: 'code-review.md', field: 'REVIEW_BASE_DIR' },
  { mode: 'bug-analysis', command: 'bug-analysis.md', field: 'ANALYSIS_BASE_DIR' },
  { mode: 'research', command: 'research.md', field: 'RESEARCH_BASE_DIR' },
]

/** The Synthesize spawn fence of a mode in a command's text, or undefined. */
function synthesizeSpawn(command: string, mode: string): string | undefined {
  return parseFences(command).find(f => isAgentBlock(f, 'Synthesize') && new RegExp(`^"?Mode: ${mode}\\b`, 'm').test(f))
}

/** Named collector: the modes whose spawn does not pass the field, or whose agent does not write through it. */
export function collectBaseDirDefects(
  rows: readonly ModeRow[],
  readCommand: (file: string) => string,
  agent: string,
): string[] {
  const out: string[] = []
  for (const { mode, command, field } of rows) {
    const spawn = synthesizeSpawn(readCommand(command), mode)
    if (spawn === undefined) out.push(`${command}: no Synthesize spawn in ${mode} mode`)
    else if (!new RegExp(`^${field}: \\S`, 'm').test(spawn)) out.push(`${command}: the ${mode} spawn does not pass ${field}`)
    if (!agent.includes('mkdir -p ${' + field + '}')) out.push(`synthesize: the ${mode} mode does not write through ${field}`)
  }
  return out
}

describe('each Synthesize spawn passes the directory its mode writes through', () => {
  const agent = resolveAgentSource('synthesize').content

  it('review, bug-analysis and research all do', () => {
    expect(collectBaseDirDefects(MODES, requireDistFile, agent)).toEqual([])
  })

  it('known-bad probe: /research without RESEARCH_BASE_DIR is reported', () => {
    const probe = (file: string): string => file === 'research.md'
      ? requireDistFile(file).replace(/^RESEARCH_BASE_DIR: .*\n/m, '')
      : requireDistFile(file)
    expect(collectBaseDirDefects(MODES, probe, agent)).toEqual(['research.md: the research spawn does not pass RESEARCH_BASE_DIR'])
  })

  it('known-bad probe: an agent that writes through another name is reported', () => {
    expect(collectBaseDirDefects(MODES, requireDistFile, agent.replaceAll('${RESEARCH_BASE_DIR}', '${SUMMARY_DIR}'))).toEqual([
      'synthesize: the research mode does not write through RESEARCH_BASE_DIR',
    ])
  })
})

describe('/research: RESEARCH_BASE_DIR is the directory the Research agents write into', () => {
  const research = requireDistFile('research.md')

  it('the spawn\'s directory is the parent of every OUTPUT_PATH, and the summary sits in it', () => {
    const output = /- `OUTPUT_PATH`: `([^`]+)\/\{type\}\.md`/.exec(research)?.[1]
    const spawn = synthesizeSpawn(research, 'research') ?? ''
    const base = /^RESEARCH_BASE_DIR: (\S+)$/m.exec(spawn)?.[1]
    expect(output, 'OUTPUT_PATH is found').toBeDefined()
    expect(base, 'RESEARCH_BASE_DIR is found').toBe(output)
    expect(spawn).toContain(`Output: ${output}/research-summary.md`)
  })

  it('the spawn passes the Research agents\' output paths, which the agent reads', () => {
    expect(synthesizeSpawn(research, 'research')).toMatch(/^RESEARCH_OUTPUTS: \S/m)
    expect(resolveAgentSource('synthesize').content).toContain('RESEARCH_OUTPUTS')
  })
})
