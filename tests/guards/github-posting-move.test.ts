/**
 * The posting recipes moved verbatim (#648, AC-43): the comment recipes, the review recipe, the
 * thread-reply and resolve recipes and the inline-post examples left `github-api.md`, which installs
 * in every state, for `github-posting.md`, which installs only with compliance on.
 *
 * What each arm holds:
 *   - Byte-identity. Every moved block equals the text `github-api.md` held before the move, pinned by
 *     length and SHA-256 (a digest, because a guard that shells out to `git show main:` reads nothing on
 *     a shallow clone). A deliberate later edit of a block updates its digest in the same commit.
 *   - One owner. The old file holds no first line of a moved block, so a block is moved and not copied.
 *   - Nothing else. The new file is excluded from the PR-host byte budget as a verbatim move, so its
 *     whole length and the text outside the blocks (header and headings) are pinned too: a line added
 *     anywhere fails here, not silently through the exclusion.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe run through the
 * same collector.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT } from '../helpers.js'

const REFERENCES_DIR = path.join(ROOT, 'src', 'assets', 'skills', 'git', 'references')

/** One block `github-api.md` lost and `github-posting.md` now holds, exactly. */
interface Moved {
  readonly heading: string
  /** The block's first line, exactly as it stands in both files. */
  readonly firstLine: string
  /** How many lines the block spans from its first line. */
  readonly lines: number
  /** UTF-8 length of the block without its trailing newline. */
  readonly bytes: number
  /** SHA-256 of those bytes as `github-api.md` held them before the move. */
  readonly sha256: string
}

const MOVED: readonly Moved[] = [
  { heading: 'PR Comments (rules, inline comment, line check, format template)', firstLine: '## PR Comments', lines: 64, bytes: 1680, sha256: '11991a8433c5934855132ab538105a70403624733696b11260e58ea7479de845' },
  { heading: 'PR Review', firstLine: '### PR Review', lines: 20, bytes: 801, sha256: '8e25f8ed339df2fd07caabe30714281471985ffbfe697fe70a8aff9e40e59482' },
  { heading: 'inline-post violation examples', firstLine: '# VIOLATION: Comment on line not in diff', lines: 10, bytes: 426, sha256: '20b817001c5b56aae31e091cdd21c025d09ec7716fddfad22f42b4aa6f96d11c' },
  { heading: 'Reply to a Review Thread', firstLine: '### Reply to a Review Thread', lines: 20, bytes: 492, sha256: 'cc3e882a4e3baba39e9db37e5398d06a64ec0fedcf3aa159b556700ac5e0082d' },
  { heading: 'Resolve a Review Thread', firstLine: '### Resolve a Review Thread', lines: 16, bytes: 373, sha256: '9ece24956a1f8b77d99fa8d8a981dc558c10daa4fd4eac2dbf7e02c2a62fbf84' },
]

/** The block starting at `firstLine`, or null when the text has no such line. */
function sliceBlock(text: string, block: Moved): string | null {
  const lines = text.split('\n')
  const at = lines.indexOf(block.firstLine)
  return at < 0 ? null : lines.slice(at, at + block.lines).join('\n')
}

/**
 * The whole-file pin. `github-posting.md` is excluded from the PR-host byte budget
 * (LOADED_SET_WRITTEN_EXCLUSIONS) on the ground that it is the verbatim move of text `github-api.md`
 * held under the same exclusion. That holds only while the file stays that move, so the file is pinned
 * whole: its UTF-8 length, and the text outside the five blocks (the header and the headings between
 * blocks) by length and SHA-256. A line added anywhere, in a block, in the header or after the last
 * block, moves one of these. A deliberate edit re-pins them in the same commit, with the char pin in
 * tests/tracker/byte-budget.test.ts.
 */
const WHOLE_FILE = {
  bytes: 4178,
  remainder: { bytes: 401, sha256: '388d82e50ceb053c29b679297c9355332b493fd1f20d371af4c7ee00db5909dd' },
} as const

/** Every line outside the pinned blocks, joined as the file joins them. */
function remainderOf(text: string, blocks: readonly Moved[] = MOVED): string {
  const lines = text.split('\n')
  const inBlock = new Set<number>()
  for (const block of blocks) {
    const at = lines.indexOf(block.firstLine)
    if (at < 0) continue
    for (let i = at; i < Math.min(at + block.lines, lines.length); i++) inBlock.add(i)
  }
  return lines.filter((_, i) => !inBlock.has(i)).join('\n')
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf-8').digest('hex')

/** Named collector: ways the file as a whole differs from the header plus the pinned blocks. */
function collectWholeFileDefects(text: string, blocks: readonly Moved[] = MOVED): string[] {
  const defects: string[] = []
  const bytes = Buffer.byteLength(text, 'utf-8')
  if (bytes !== WHOLE_FILE.bytes) defects.push(`file length ${bytes}, pinned ${WHOLE_FILE.bytes}`)
  const rest = remainderOf(text, blocks)
  const restBytes = Buffer.byteLength(rest, 'utf-8')
  if (restBytes !== WHOLE_FILE.remainder.bytes) defects.push(`text outside the blocks: length ${restBytes}, pinned ${WHOLE_FILE.remainder.bytes}`)
  else if (sha256(rest) !== WHOLE_FILE.remainder.sha256) defects.push('text outside the blocks: the digest differs')
  return defects
}

/** Named collector: moved blocks the new file does not hold byte for byte. */
function collectMoveDefects(posting: string, blocks: readonly Moved[] = MOVED): string[] {
  const defects: string[] = []
  for (const block of blocks) {
    const text = sliceBlock(posting, block)
    if (text === null) defects.push(`${block.heading}: the first line is gone`)
    else if (Buffer.byteLength(text, 'utf-8') !== block.bytes) defects.push(`${block.heading}: length ${Buffer.byteLength(text, 'utf-8')}, pinned ${block.bytes}`)
    else if (sha256(text) !== block.sha256) defects.push(`${block.heading}: the digest differs`)
  }
  return defects
}

/** Named collector: moved blocks whose first line the old file still holds, so the block was copied and not moved. */
function collectCopiedBlocks(apiText: string, blocks: readonly Moved[] = MOVED): string[] {
  const lines = new Set(apiText.split('\n'))
  return blocks.filter(block => lines.has(block.firstLine)).map(block => block.heading)
}

const posting = readFileSync(path.join(REFERENCES_DIR, 'github-posting.md'), 'utf-8')
const api = readFileSync(path.join(REFERENCES_DIR, 'github-api.md'), 'utf-8')

describe('github-posting.md holds the moved posting recipes byte for byte (AC-43)', () => {
  it('pins five blocks', () => {
    expect(MOVED).toHaveLength(5)
  })

  it('every moved block equals the text github-api.md held, by length and SHA-256', () => {
    expect(collectMoveDefects(posting)).toEqual([])
  })

  it('github-api.md holds no moved block: the recipes have one owner', () => {
    expect(collectCopiedBlocks(api)).toEqual([])
  })

  it('the file holds nothing but the header and the pinned blocks, by length and SHA-256', () => {
    expect(collectWholeFileDefects(posting)).toEqual([])
  })

  it('known-bad probe: a line appended, a line added in the header and a line added in a block are each reported', () => {
    expect(collectWholeFileDefects(`${posting}One more line.\n`)).toEqual([
      expect.stringContaining('file length'),
      expect.stringContaining('text outside the blocks'),
    ])
    expect(collectWholeFileDefects(posting.replace('# GitHub Posting Recipes\n', '# GitHub Posting Recipes\nNew line.\n'))).toEqual([
      expect.stringContaining('file length'),
      expect.stringContaining('text outside the blocks'),
    ])
    expect(collectWholeFileDefects(posting.replace('### PR Review\n', '### PR Review\nNew line.\n'))).toEqual([
      expect.stringContaining('file length'),
      expect.stringContaining('text outside the blocks'),
    ])
    expect(collectWholeFileDefects(posting)).toEqual([])
  })

  it('known-bad probe: an edited block, a lost first line and a copy left behind are each reported', () => {
    const edited = posting.replace('Deduplicate before posting (same file + line = keep one)', 'Deduplicate before posting')
    expect(collectMoveDefects(edited)).toEqual([expect.stringContaining('PR Comments')])
    expect(collectMoveDefects(posting.replace('### PR Review\n', '### Review\n'))).toEqual([expect.stringContaining('PR Review: the first line is gone')])
    expect(collectMoveDefects(posting)).toEqual([])
    expect(collectCopiedBlocks(`${api}\n### PR Review\n`)).toEqual(['PR Review'])
  })
})
