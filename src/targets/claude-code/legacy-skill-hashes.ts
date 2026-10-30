/**
 * The released copies of the bare legacy skills: for each bare name of the legacy skill list that a
 * release installed as `~/.claude/skills/<name>/`, the SHA-256 (lowercase hex) of every distinct
 * `SKILL.md` that a release installed under that name.
 *
 * `devflow init` moves a bare legacy folder out of the shared skills folder only when its
 * `SKILL.md` has one of these hashes (`sweepLegacySkillFolders`). The folder name alone proves
 * nothing: a skill of the user, or of another tool, may carry a name such as `python` or `plan`.
 * A name with no entry here was never installed bare by a release, so no folder of that name is
 * moved.
 *
 * Frozen data, made on 2026-10-30. Source: the 21 published `devflow-kit` packages 0.6.1 to 1.8.3,
 * the releases that installed bare skill folders. (0.4.0 to 0.6.0 installed one nested folder,
 * `skills/devflow/`; 2.0.0 and later install `devflow:`-prefixed folders.) Each package was fetched
 * with `npm pack devflow-kit@<version> --ignore-scripts` and unpacked; no package script or code
 * ran. Every `SKILL.md` below `src/claude/skills/devflow/<name>/` (0.6.1 to 0.9.0) or
 * `plugins/<plugin>/skills/<name>/` (1.0.0 to 1.8.3) was hashed with `shasum -a 256`. Those
 * installers copy a skill file byte for byte, so the installed file has the hash of the packaged
 * file. The comment on each hash gives the first and the last release that held it.
 *
 * The table only grows: a release cannot be un-shipped. tests/guards/legacy-skill-hashes.test.ts
 * proves the shape of the table and its match with tests/fixtures/released-shipped-names.ts.
 */

const hashes = (list: readonly string[]): readonly string[] => Object.freeze([...list]);

export const BARE_LEGACY_SKILL_HASHES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'accessibility': hashes([
    '06434c13344e85bf55f4fcf45e8e794ef26ad0751e7e56cac7363661e1b7b7d4', // 1.0.0 to 1.8.3
  ]),
  'agent-teams': hashes([
    '75591cef45adbc36e95910e08a0db681c56401e1c95db5226afe819dde36ce0c', // 1.0.0 to 1.8.3
  ]),
  'ambient-router': hashes([
    'b4a6bfc188d720ede3afefc3802b2a9192dd67cf1a3694a5ee221b383347cc21', // 1.1.0
    '92a3ee58a6deb50f4dbbd50913527de78f7755ed23d492c6ffc18b42d035a867', // 1.2.0
    'd32ef0392357eff61a47a3f758d2c1674fdf029ca6e74cf465e114723db57497', // 1.3.0 to 1.4.0
    '2d73b902b3610b42455caf6fe0dfe5725dfe92a8590def4a125b280754a6c4f0', // 1.5.0
    'e4221f41c567b04c2785d4127a4fc7f7fe1099afa490fc03f67e537010e8b5e8', // 1.6.0
    '3e6ed6a711dcdf1f710266065684db637d34f15f0a3b2174d4867ea35fcf613b', // 1.6.1 to 1.8.1
    'fb3a7025ce437ca2abc8fb8a71cae10e452f335e0d99adf979c601042e16570b', // 1.8.2 to 1.8.3
  ]),
  'architecture-patterns': hashes([
    'a72ea9c4dcf4083e8f3d8a70dca282a807972e70e163a3e0988a61a875db4101', // 1.0.0 to 1.2.0
    'd5da95e223c024e31c000c0d511e845f308045ae89e5a31cfaf2a0eebf07a238', // 1.3.0 to 1.8.3
  ]),
  'code-smell': hashes([
    '2917880c99f1c2febb596319900c61826f58327ac933860d18eeaf98952b2bee', // 0.6.1 to 0.9.0
  ]),
  'complexity-patterns': hashes([
    '3a6f56e229b19d27938274dc788a02334e5d96d8c56a55a80661b62c431af50f', // 1.0.0 to 1.2.0
    'fc068855bca532e1c1a87d59617d9b093db5fef98064b0a6b0c84add0a4c7163', // 1.3.0 to 1.8.3
  ]),
  'consistency-patterns': hashes([
    'ed270ef6c976d109beb3fda510cc84399a884d84e26f5a5fcf420ceb878444cb', // 1.0.0 to 1.2.0
    '493a8ae10c759bb57a44f833251e77f1c0577e19b701f917ad6474d64bb0e96c', // 1.3.0 to 1.8.3
  ]),
  'core-patterns': hashes([
    '5c1c8272250c06a1e1c0b263f171b04096380385ccdda3a252b830f2179597ba', // 1.0.0 to 1.8.3
  ]),
  'database-patterns': hashes([
    '3cd61ce6b8b005cb72ace5af6fa3620d57f1363166621e88b6da0bb4b9566491', // 1.0.0 to 1.2.0
    '1d28c6cdf41154f284956883c461bc56448342f8cb8d1c1118f9f85b3f4f3486', // 1.3.0 to 1.8.3
  ]),
  'debug': hashes([
    '7199af54865413f2dc4333e6dc83c63e633f98d0ad78bdbdded384b145249f21', // 0.6.1 to 0.9.0
  ]),
  'debug-orchestration': hashes([
    'eb2a5fbf55fc973dff8f5206a093248fde8626c63be967fb819fce15dda8c5cd', // 1.6.0 to 1.8.3
  ]),
  'dependencies-patterns': hashes([
    '7711a6225b764aea7bf4f4d14cb0fe0ec2afbb3ab106ae17595c94cb126174c0', // 1.0.0 to 1.2.0
    '86f89ec146a451aecf320349a2ff71f1f314a43bdeab221163b60e99361e8fbf', // 1.3.0 to 1.8.3
  ]),
  'docs-framework': hashes([
    '7d97aa5d1ea61d5d1a9fa0f24960468c2fd365d25d6632700fdfa5efd9b180a0', // 1.0.0
    '7ec949848e9d73249df1785d1e5e837928062a423c7ad4ee588543bea7d89950', // 1.1.0 to 1.5.0
    '40454b337b552064a58424bf8ea505e486d0c0849a7ff14bd499a5072eb1b168', // 1.6.0
    'e191008ac58722d14d7dadce4d828376585d26aa676b3e74882ea8c90fa8cd2d', // 1.6.1 to 1.8.3
  ]),
  'documentation-patterns': hashes([
    '2cc11fdae2924f862573ef61aba5c42390089e1973b374a181475548d2e6de88', // 1.0.0 to 1.2.0
    'b5eaef09cd851054062f72ecbbd13e9392872ab2fd2867c7c6ee5be380b09904', // 1.3.0 to 1.8.3
  ]),
  'frontend-design': hashes([
    '015bcec670df04b8793bc8ceacf42ca579e87fb4ae9cc826f17d6067f5f39b4f', // 1.0.0 to 1.8.3
  ]),
  'git-safety': hashes([
    'd0af494607b6956e2a31dc27b36fe622c2b606465d012efbac5b51f3cf264efb', // 1.0.0 to 1.8.3
  ]),
  'git-workflow': hashes([
    '8f696c7f8758549e6f9547bdc56cf7370841411bc34f8bfba001951034d391ef', // 1.0.0 to 1.8.3
  ]),
  'github-patterns': hashes([
    '0a93eed85575836e42980ffcc1dcad8679eb41dd0db1eaf428c51f34c101b2fa', // 1.0.0 to 1.8.3
  ]),
  'go': hashes([
    '80b68a2f640b16b2d6a369cfe003ed6366a4a6c6c0a71868451a1652f2ede8d6', // 1.2.0 to 1.8.3
  ]),
  'implementation-orchestration': hashes([
    '023bd2b2b754945daf83b101652e8c9a7c45092d0ebc2dd56dd9f170f6ef2cf2', // 1.6.0 to 1.8.3
  ]),
  'implementation-patterns': hashes([
    '484816f577cb1c2d4fe6bcbe1f8adbc8c02c8a41eff19ecfa5711e2afca0cf54', // 1.0.0 to 1.8.3
  ]),
  'input-validation': hashes([
    '2ce71e678840855d271dc7418b207f50c1d1123de80b9b88488154c5697053dd', // 0.6.1 to 0.9.0
    '2e08b78f98de0e6ae17d455f832672e0a3ddaff9fa13337597f54130f3bc1a6b', // 1.0.0 to 1.8.3
  ]),
  'java': hashes([
    '17cc4b3d476bd3ac9bbd3d367d04a88f4695d0e56f58db434aaaad80d875b6c3', // 1.2.0 to 1.8.3
  ]),
  'knowledge-persistence': hashes([
    '3f43892b11fb2ffefb6ff1f083872338ed5d511b6e2bf6b125fa2c610afa5c79', // 1.6.0 to 1.8.3
  ]),
  'performance-patterns': hashes([
    'bc025c6908ea87fab292cfe37396ee901c7acb1cccfaa27f78d9cd6f5798eea5', // 1.0.0 to 1.2.0
    'bdd93bb51e829460d65a1ee572d0a95f7a0246b7a26bb1034a1c981e79b5ee9d', // 1.3.0 to 1.8.3
  ]),
  'plan-orchestration': hashes([
    'ce940a2d0f2f3d80e9200ca8c4294d6fb26076f4fe6a640a157ffedd8ee37491', // 1.6.0 to 1.8.3
  ]),
  'python': hashes([
    'ff03facdc25a6d6dc5d6e6979d2b3e30206b687ffc064cb0bc69591027ddcbb6', // 1.2.0 to 1.8.3
  ]),
  'react': hashes([
    '3df91866eec7559cbef1e48c74af9b6f23861ef703fbe2bf00822d2d2842f666', // 1.0.0 to 1.1.0
    '671e6a38d811f1eab42a3e0e69445c8528f8222957032c166a77a2b066a1f989', // 1.2.0 to 1.8.3
  ]),
  'regression-patterns': hashes([
    'c4a8cfa79007c3838d5fceab272a7c6cfd808c4f64925385dff557670380b2aa', // 1.0.0 to 1.2.0
    'd3a1a163f20a933d8fefd78e28b602ff34c6d13829fbb99eb78b29f07591f4a5', // 1.3.0 to 1.8.3
  ]),
  'research': hashes([
    '528c0fd4538df7b949a7d355e7daf7a6e96848053f112b437c26477ca2f456fe', // 0.6.1
    '0a9f207dc8028961328521d9eafa2e4e51740cbed4f7560b71a562e480a08503', // 0.7.0 to 0.9.0
  ]),
  'review-methodology': hashes([
    '5cc67590d427510bfab6ba0daca3fd05df5aae74f7efeff4230aba4ec167e053', // 1.0.0 to 1.2.0
    '928ddf64d96488c747552216b7079a943abcb7da2c8174d75a1281c94f61c19e', // 1.3.0 to 1.8.3
  ]),
  'rust': hashes([
    'efee293456d582cc38941102be4052d3a0f352253c6d913b6d1b3a92134093fa', // 1.2.0 to 1.8.3
  ]),
  'search-first': hashes([
    '37d60dc1fa6ab1aa690df450747c9a9e7c9b52ff8826ff3e675e612037d04794', // 1.5.0 to 1.8.3
  ]),
  'security-patterns': hashes([
    '6662d43fa607913db531f8445ceedf7dd17266e64551d59d7d91969082d7c9ac', // 1.0.0 to 1.2.0
    'f52c3b5acc69b2d6764b3aebb955a51f7de417d065ed9c085aae31684a7b7af0', // 1.3.0 to 1.8.3
  ]),
  'self-review': hashes([
    'c7f0b6557316d2abc7cc3229c403d8abb736048a47f1e8d1d993d46351c36033', // 1.0.0 to 1.2.0
    'f405c0f368884a714be309dcc9e85389672b22a7fd8b49bd2d5fd801cc4d9c51', // 1.3.0 to 1.8.3
  ]),
  'test-design': hashes([
    '9c048d74b6387143fce401f0edf271f2e02daef231ea66a6662915d7f0f25a5b', // 0.6.1 to 0.9.0
  ]),
  'test-driven-development': hashes([
    '54abb24907d3cf6c20c96981b4e2d20c80fbb51fb36559a3df9d4ac749af5782', // 1.1.0 to 1.2.0
    '0457cfe9f23d2ba7f7e1faa00d027d8c3500458fcbb9957413be7ffad4c7f874', // 1.3.0 to 1.5.0
    '21abf6a42b294bc3c6a7f51eaf981f08ab7bd6cec2c3c50312fc5d8b37ccba4e', // 1.6.0 to 1.8.3
  ]),
  'test-patterns': hashes([
    '8c75e34c3544824d1f8dc26c407909ec4bf177db583862b34e827bd1aea1f279', // 1.0.0 to 1.8.3
  ]),
  'typescript': hashes([
    'd70fc7facd2bec850c0b4cfb6eeeaa673648674024236a55ee6cbab7c2689241', // 1.0.0 to 1.8.3
  ]),
});
