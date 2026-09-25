/**
 * tests/evidence/seam.ts
 *
 * The one place the evidence suites name their scripts' paths. A test file must
 * never import another test file (vitest would register the imported file's
 * tests a second time), so shared constants live here.
 */

import * as path from 'path'

import { ROOT } from '../helpers.js'

/** The pure core: grammars, markers, ladder, render, splice, trust. */
export const PR_EVIDENCE_SCRIPT = path.join(ROOT, 'src', 'assets', 'scripts', 'pr-evidence.cjs')
