/**
 * MDS name manifests — the single definition of *which* files the build owns.
 *
 * Four assertion sites used to spell a bare count literal (`toHaveLength(13)`,
 * `toHaveLength(11)`, `toBe(14)` twice). A count answers "how many?", which stays
 * green when one host is renamed and another added in the same commit. These
 * manifests answer "which?", and every one of those sites now compares against
 * them in both directions.
 *
 * Bidirectional-registry model, mirroring src/core/compliance-compose.ts:20/:36/:50
 * ("every token here must exist in the template; every template token must be
 * listed here"). The enforcing tests, named here so a reader of the manifest can
 * find its guard:
 *
 *   - tests/build-mds.test.ts        "MDS host discovery"  — hosts and partials, both directions
 *   - tests/build-mds.test.ts        "script happy path"   — the dist/commands/*.md output set
 *   - tests/packaging.test.ts        Guard 6               — the same set inside the tarball
 *   - tests/build-mds-generator-hosts.test.ts §6           — the counts the build itself prints
 *
 * Length floors (`>= 13`, `>= 11`) are asserted alongside the set-equality in
 * tests/build-mds.test.ts and registered in tests/fixtures/numeric-floors.json.
 * A floor never decreases; a manifest entry may only be added or renamed in step
 * with the file on disk.
 */

/** The 9 knowledge-workflow command hosts (src/assets/commands/<name>.mds). */
export const KNOWLEDGE_COMMAND_HOSTS = [
  'bug-analysis',
  'code-review',
  'debug',
  'explore',
  'implement',
  'plan',
  'research',
  'resolve',
  'self-review',
] as const;

/** The 4 dynamic-workflow command hosts (src/assets/commands/<name>.mds). */
export const DYNAMIC_COMMAND_HOSTS = [
  'dynamic-build',
  'dynamic-plan',
  'dynamic-profile',
  'dynamic-tickets',
] as const;

/** All 13 command hosts compiled into dist/commands/. */
export const MDS_COMMAND_HOSTS = [
  ...KNOWLEDGE_COMMAND_HOSTS,
  ...DYNAMIC_COMMAND_HOSTS,
] as const;

/**
 * The 11 partials in src/assets/commands/_partials/. A partial declares no
 * `output-dir:`, so the build skips it — it is imported by hosts instead.
 * The `_` prefix is the partial convention (and is refused by validateOutputName,
 * so a partial can never become an output filename by accident).
 */
export const MDS_PARTIALS = [
  '_compliance',
  '_decisions',
  '_engine',
  '_factory',
  '_knowledge',
  '_plan_contract',
  '_preamble',
  '_publication',
  '_roster',
  '_ticket_template',
  '_wave',
] as const;

/**
 * Generator hosts: .mds sources outside src/assets/commands/ that compile to a
 * destination other than dist/commands. Today exactly one — the Git agent,
 * src/assets/agents/git.mds → dist/agents/git.md.
 */
export const MDS_GENERATOR_HOSTS = ['git'] as const;

/**
 * Hand-authored files copied verbatim into dist/commands/. release.md inlines its
 * own COMPLIANCE gate and is not MDS-compiled; the divergence is permanent (SG-13).
 */
export const HAND_AUTHORED_COMMAND_FILES = ['release.md'] as const;

/**
 * The 14 files that must exist in dist/commands/ after a build: the 13 compiled
 * hosts plus release.md. This is DIST_FILES — deployed-behaviour scope (§14.5).
 */
export const DIST_COMMAND_FILES: readonly string[] = [
  ...MDS_COMMAND_HOSTS.map(h => `${h}.md`),
  ...HAND_AUTHORED_COMMAND_FILES,
];

/** Total hosts the build discovers and compiles: command hosts + generator hosts. */
export const ALL_MDS_HOSTS: readonly string[] = [
  ...MDS_COMMAND_HOSTS,
  ...MDS_GENERATOR_HOSTS,
];
