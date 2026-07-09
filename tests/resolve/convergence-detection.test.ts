import { describe, it, expect } from 'vitest'
import { loadFile, extractSection } from '../helpers'

// -------------------------------------------------------------------------
// resolve.md — byte-stable parser contract literals
//
// /code-review's convergence parser reads the Statistics table rows and
// section headings written by /resolve into resolution-summary.md. These
// byte-stable elements drive fp_ratio computation; a silent rename degrades
// fp_ratio to 0 while CI stays green (parser reads 0 for every count).
//
// Additive-safe sections (## Verification, ## By Design, ## Fix Separately,
// ## Escalations) are already pinned in decisions-citation.test.ts. This
// file pins the UNSAFE-to-rename literals only.
//
// Read target: compiled plugins/devflow-resolve/commands/resolve.md
// (same convention as decisions-citation.test.ts which loads the compiled file)
// -------------------------------------------------------------------------

describe('resolve.md — byte-stable Statistics row labels (parser contract)', () => {
  const content = loadFile('plugins/devflow-resolve/commands/resolve.md')
  const outputArtifact = extractSection(content, '## Output Artifact', null)

  it('Statistics row "| Fixed |" is byte-stable', () => {
    expect(outputArtifact).toContain('| Fixed |')
  })

  it('Statistics row "| False Positive |" is byte-stable', () => {
    expect(outputArtifact).toContain('| False Positive |')
  })

  it('Statistics row "| Deferred |" is byte-stable', () => {
    expect(outputArtifact).toContain('| Deferred |')
  })

  it('section heading "## Fixed Issues" is byte-stable', () => {
    expect(outputArtifact).toContain('## Fixed Issues')
  })

  it('section heading "## False Positives" is byte-stable', () => {
    expect(outputArtifact).toContain('## False Positives')
  })

  it('parser contract note documents the byte-stable requirement', () => {
    // The maintainer note itself must be present — its removal would leave no
    // in-source signal that these labels are coupled to the convergence parser.
    expect(outputArtifact).toContain('keep those labels byte-stable')
  })
})
