---
feature: installer-shadowing-backups
name: Install Backup Session & Legacy Sweeps
description: "Use when changing the install backup session, shipped set, retired name lists, folder swaps or the bare legacy skill hash gate. Keywords: install-backups, retired, hash gate, swap."
category: architecture
directories: [src/targets/claude-code/install-backup.ts, src/targets/claude-code/shipped-set.ts, src/targets/claude-code/folder-swap.ts, src/targets/claude-code/rules-folder.ts, src/targets/claude-code/legacy-skill-hashes.ts, src/cli/commands/backup-session.ts, src/cli/commands/legacy-sweep.ts, src/core/retired-shipped-names.ts, src/core/path-set.ts]
created: 2026-10-30
updated: 2026-10-30
---

# Install Backup Session & Legacy Sweeps

## Rules

- **KB-AP-1** Never remove an install folder with a recursive `rm` of the tree: move what devflow did not ship to the backup run folder, remove the listed entries, then a non-recursive `rmdir`. A folder that still holds a file stays.
- **KB-AP-2** Never swap a folder while any entry in it is kept (a failed move, a capped folder, an unscannable folder) or the aside name is taken: write the new files into the old folder in place, and remove only listed leftovers after the write.
- **KB-AP-3** Never move or remove a bare legacy skill folder by its name: the shared skills folder holds skills of the user and of other tools under names such as `python` and `plan`. Only a `SKILL.md` whose SHA-256 is a released hash proves devflow made it.
- **KB-AP-4** A delete list holds only names that some release shipped: `RETIRED_SHIPPED` and `BARE_LEGACY_SKILL_HASHES` are built from published packages, never from a guess or a pattern. A name devflow ships again leaves the retired list in the same change.
- **KB-AP-5** Never build the shipped set from the selection of one run or from what an earlier install left on disk: a set that lacks a shipped file sends that file to the backup folder.
- **KB-AP-6** A file whose name only looks like a retired one (a user file such as a `*-teams.md`) is never matched by pattern: the pre-pass moves it aside and names it. `removeExact` takes exact paths from the frozen lists only.
- **KB-AP-7** Never read, move or remove through a link: `lstat` decides, a link is unlinked as the entry it is, and the folder it points to is untouched.
- **KB-INV-1** The backup session moves unshipped files to `~/.devflow/install-backups/<stamp>-<hex>/` before any removal in a folder devflow installs into. A move is one `rename`, with no copy, so a failed rename leaves the file where it is.
- **KB-INV-2** A refused root (a link that stays, or a path that is not a folder) gets no move and no removal, and so does any target below a linked ancestor (`linked-ancestor`).
- **KB-INV-3** Failures are records in the session snapshot, never throws; every kept path is named in the run report, printed once even when a step throws.
- **KB-INV-4** If the shipped set cannot be built, `devflow init` prints the reason, exits non-zero and changes nothing.
- **KB-INV-5** A name in both the shipped set and the retired set is shipped. The count floors in `tests/fixtures/numeric-floors.json` keep the retired lists and the hash table from losing names or hashes.
- **KB-INV-6** Uninstall removes a bare legacy skill folder only on the same hash check as init (`judgeBareLegacySkill`); the install backups folder is user content there.

## Overview

Before this layer, the installer wiped devflow folders with recursive removals, so a file the user had put in `commands/devflow`, `rules/devflow` or a skill folder was lost on the next `devflow init`. A backup session now sits in front of every removal. It classifies each entry in a folder as shipped, retired, sidecar, junk or unknown. Unknown entries move to the run folder. Only the entries the scan listed are removed, then the folder goes with a plain `rmdir`.

One session serves one command run. `devflow init`, `curation`, `compliance` and `rules` each open it with `openBackupSession` (`src/cli/commands/backup-session.ts`) before the first change, share it with the install and the converge steps, and print its record once with `runWithBackupReport` or `runWithLateBackupReport`.

## The Shipped Set and the Retired Set

Both are `PathSet` values (`src/core/path-set.ts`): file paths relative to the Claude dir with `/` separators; `holds(folder)` is true for a listed path and for every folder above one.

- **Shipped set** (`shipped-set.ts`, `loadShippedSet`): every file some install of this build can write into `commands/devflow`, `agents/devflow`, `rules/devflow` and `skills/devflow:*`. It comes from the full registries and all four variants (compliance and curation, on and off), the package skill source, the compliance-on reference manifest, the workflow folder files, the tracker agent, and the listing of each valid skill shadow beside the listing it replaces. It errs toward too large. The listing is bounded by file, depth and folder limits, and a breach or read error is a failed load with a reason, never a smaller set.
- **Retired set** (`retired-shipped-names.ts`, `retiredPathSet`): files an earlier release shipped and this one does not. `RETIRED_SHIPPED` is a frozen literal that imports no `LEGACY_*` list, because those lists are cleanup manifests that a change may prune while this one only grows. Lists: `commands`, `agents`, `rules` (names without `.md`), `skillFiles` (a skill folder that exists today mapped to the released files the build dropped) and `skills` (whole folders). Files in the retired set are removed and named; folders in `skills` move whole.
- `tests/guards/install-backup-sets.test.ts` proves each listed file was shipped by some release, against `tests/fixtures/released-shipped-names.ts`.

## Classification and the Pre-pass

`classify(rel, kind, sets)` runs in fixed order: shipped, retired, sidecar, junk, unknown. A directory or link is named when the set holds the path; a file is named only at a listed file path. Sidecars are what an interrupted write leaves: a `.tmp.<pid>` file, a `.tmp`, `.old` or `.<pid>-<time>.tmp` folder, the curation and workflow swap scratch folders, and the pr-host and cross-cutting overlay scratch folders. Only a `.DS_Store` file is junk; any other dot file is unknown.

`prepass(targets)` scans each folder (bounded by an entry cap and a depth bound) and moves unknown entries into the run folder, keeping their path relative to the Claude dir. A `PrepassTarget` may carry `include` (an entry it refuses is left whole and is not listed for removal) and `displacedFrom` (a folder renamed away, scanned as if it still stood at its shipped path). `removeListed(folder)` then removes the listed entries that were not kept and `rmdir`s the scanned folders. `moveWhole(entry)` is one rename with no walk. `isKept` and `keptUnder` tell callers what stays; every caller that writes or removes consults them.

The run folder is `YYYYMMDDTHHMMSSZ-<8 hex>` under the backup root, made owner-only when the first move is ready. A run that moves nothing leaves nothing behind. A backup root that is a link or not a folder, or one that overlaps the Claude dir, refuses every move for the run.

## Folder Swaps and the Rules Folder

`swapFolderIn` (`folder-swap.ts`) replaces a folder devflow owns (the curation and compliance skill converges use it). It runs the pre-pass on the old folder first. If anything is kept, or the aside name is taken by a folder that keeps a file, it takes the in-place path: `mergeInto` writes the new files, then a second pre-pass with a filter that spares every staged path, every kept entry and everything below a kept folder lets `removeListed` take only the leftovers and the shipped files the new release dropped. If the staged listing is incomplete, nothing is removed. Otherwise the old folder renames to the aside name, the new one renames in, and `discardDisplacedFolder` scans the aside folder again (a file can arrive between the scan and the rename) before a plain `rmdir`. A file at the aside name moves to the backup folder first; a link there makes the swap throw. A swap that cannot finish throws and the caller reports it.

`removeRulesFolder` (`rules-folder.ts`) is the rules-off path: it returns `absent`, `removed`, `unlinked`, `kept` or `refused` and never throws.

The reference overlay (`installer-shadowing-reference-overlay`) shares the session: a unit whose folder holds a kept entry stays in place, and its prune delegate keeps a kept entry, moves an unknown one whole and removes a listed one.

## Legacy Sweeps and the Hash Gate

`src/cli/commands/legacy-sweep.ts` runs from init after the install:

- `sweepLegacyDevflowFiles` removes, by exact name through `removeExact`, the retired and legacy command and rule files. It skips a name shipped today, and skips a folder the install refused, that the session kept, or that is a link now.
- `sweepLegacySkillFolders` walks `LEGACY_SKILL_NAMES`. A name with a `skillFiles` listing goes by the listing: listed files are removed, the rest of the folder moves. A `devflow:`-prefixed name moves whole. A bare name moves only on the hash gate.
- `judgeBareLegacySkill(folder, name)` reads at most one file and answers `absent`, `devflow` (a regular `SKILL.md` whose SHA-256 is in `BARE_LEGACY_SKILL_HASHES`), `other` (a different file, or one too large to be a release copy) or `unknown` (no `SKILL.md`, not a regular file, the folder or file is a link, or a read failed). Init moves on `devflow`, says nothing on `other`, and returns `unknown` folders in `kept` so the run names them. A name with no table entry was never installed bare by a release, so its folder is `other`.
- `legacy-skill-hashes.ts` is frozen data built by hashing every `SKILL.md` in the published `devflow-kit` packages that installed bare skill folders. The table only grows; `tests/guards/legacy-skill-hashes.test.ts` proves its shape, its match with the released-names fixture and its floors.
- The `devflow:*` registry-diff sweep in the installer removes nothing itself: the pre-pass already moved every unregistered `devflow:*` folder that holds a user file, and a retired folder goes by its listed files.

## Gotchas

- **KB-AP-3** A bare legacy folder that is not a release copy stays without a word; only an undecidable one is named. Do not treat silence as a bug.
- **KB-INV-2** The containment checks compare paths as text and do not see a link. The ancestor walk (`checkAncestors`) is the only guard, and a walk that ends at its step bound refuses.
- **KB-AP-5** A shipped set is a set of file paths: a new generated or conditional file the build can write must be added to `shippedPaths`, or the next init moves it aside.
- **KB-AP-1** `sweepOrphanedAssets` takes a `removal` mode: `recursive` (uninstall) or `unlink` (a caller that admits only files after one `lstat`, so an entry that turns into a folder is never deleted with its content).
- `src/core/orphan-sweep.ts` callers in the installer pass a `mayRemove` that admits only entries the session classifies as devflow's own (`removesOnlyDevflowFiles`).

## Key Files

- `src/targets/claude-code/install-backup.ts` — `createBackupSession`, `classify`, `BackupSession`, `runFolderName`, `BACKUP_ROOT_NAME`
- `src/targets/claude-code/shipped-set.ts` — `shippedPaths`, `buildShippedSet`, `loadShippedSet`
- `src/targets/claude-code/folder-swap.ts` — `swapFolderIn`, `discardDisplacedFolder`
- `src/targets/claude-code/rules-folder.ts` — `removeRulesFolder`
- `src/targets/claude-code/legacy-skill-hashes.ts` — `BARE_LEGACY_SKILL_HASHES`
- `src/core/retired-shipped-names.ts` — `RETIRED_SHIPPED`, `retiredPathSet`; `src/core/path-set.ts` — `PathSet`, `createPathSet`
- `src/cli/commands/backup-session.ts` — `openBackupSession`, `runWithBackupReport`; `src/cli/commands/legacy-sweep.ts` — the two sweeps and `judgeBareLegacySkill`
- `tests/guards/install-backup-sets.test.ts`, `tests/guards/legacy-skill-hashes.test.ts`, `tests/guards/install-backup-callers.test.ts`, `tests/guards/install-backup-isolation.test.ts` — the pins

## Related

- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — hub: the install pipeline, the registry-diff sweeps and the legacy symbol split
- `.devflow/features/installer-shadowing-uninstall/KNOWLEDGE.md` — uninstall removes a bare legacy skill folder on the same hash check
- `.devflow/features/installer-shadowing-reference-overlay/KNOWLEDGE.md` — the overlay units and prune that share the session
- `.devflow/features/installer-shadowing-init-seed/KNOWLEDGE.md` — init order around the session
