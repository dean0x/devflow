import { describe, it, expect } from 'vitest'
import { extractSection } from './helpers'

describe('extractSection', () => {
  const content = [
    '## Introduction',
    'intro content',
    '## Section A',
    'content of A',
    'more A content',
    '## Section B',
    'content of B',
    '## Section C',
    'content of C',
  ].join('\n')

  it('extracts content between two anchors', () => {
    const result = extractSection(content, '## Section A', '## Section B')
    expect(result).toContain('content of A')
    expect(result).toContain('more A content')
    expect(result).not.toContain('content of B')
  })

  it('starts result at the start anchor (inclusive)', () => {
    const result = extractSection(content, '## Section A', '## Section B')
    expect(result.startsWith('## Section A')).toBe(true)
  })

  it('extracts to end of string when endAnchor is null', () => {
    const result = extractSection(content, '## Section B', null)
    expect(result).toContain('content of B')
    expect(result).toContain('content of C')
    expect(result).toContain('## Section C')
  })

  it('throws when start anchor is absent', () => {
    expect(() => extractSection(content, '## Missing Section', '## Section B')).toThrow(
      'Anchor not found: "## Missing Section"'
    )
  })

  it('throws when end anchor is absent after the start anchor', () => {
    expect(() => extractSection(content, '## Section A', '## Nonexistent')).toThrow(
      'End anchor not found after "## Section A": "## Nonexistent"'
    )
  })

  it('does not include content from before the start anchor', () => {
    const result = extractSection(content, '## Section A', '## Section B')
    expect(result).not.toContain('intro content')
    expect(result).not.toContain('## Introduction')
  })

  it('finds end anchor only after the start anchor position', () => {
    // Duplicate anchors: end anchor appearing before start should not match
    const duplicate = '## Section A\nfirst\n## Section A\nsecond\n## Section B\nend'
    const result = extractSection(duplicate, '## Section A', '## Section B')
    expect(result).toContain('first')
    expect(result).toContain('second')
    expect(result).not.toContain('end')
  })

  it('matches substring anchors within longer heading lines', () => {
    // Convergence tests use anchors like 'Step 0d-i' that appear inside
    // '#### Step 0d-i: Load Prior' — indexOf substring matching must work.
    const content = '#### Step 0d-i: Load Prior\nstep content\n#### Step 0d-ii: Convergence\nmore'
    const result = extractSection(content, 'Step 0d-i', 'Step 0d-ii')
    expect(result).toContain('step content')
    expect(result).not.toContain('more')
  })
})
