---
name: sync-upstream
description: Bring the latest stable T3 Code release into the Ulta Code fork without doubling up or touching our changes and branding. Use when asked to sync with, update from, or merge T3 Code / upstream releases, or to check what a T3 Code release would change.
---

# Sync with T3 Code releases

[FORK.md](../../../FORK.md) holds the **Sync rules** and the **ledger** of our changes. Read both first. The
rules are not defaults to weigh: our changes and branding are never touched without the user's OK.

## 1. Report (changes nothing)

Stop if the working tree has uncommitted changes the user has not asked you to commit. Then:

```bash
vp run upstream:check --out .t3/upstream-check.md
```

It fetches the latest stable `vX.Y.Z` release into `upstream/release`. If it says "Nothing to sync", tell the
user and stop. Never sync to nightly, preview or `upstream/main`.

## 2. Sort every flagged commit

The report flags conflicts, commits already in our tree, commits touching files we changed, and branding.
Read each flagged upstream diff (`git show <sha>`) next to ours, and also scan the subjects of the unflagged
commits for features the ledger names, since a duplicate can live in different files. Sort into:

- **Independent**: shares a file, different behavior. Merge as-is.
- **Duplicate**: upstream built what we have. Keep ours; do not merge a second copy.
- **Contradiction**: undoes a ledger rule, adds T3 Code branding or links, or points at T3 Code's identity
  or config locations. Keep ours; take only upstream's unrelated fixes around it.
- **Needs adaptation**: merges cleanly but our code must change to keep working (renamed APIs, new
  required arguments). These are the silent breakages, so look for them in non-conflicting hunks too.

For large reports, split the reading across read-only subagents (conflicts, flagged commits, unflagged
subjects) and give each FORK.md plus the report.

## 3. Get sign-off

Show the user every duplicate, contradiction and needs-adaptation item with its proposed resolution, and
the conflicts with how each will be resolved. Wait for their answer. Do not merge before it.

## 4. Merge

```bash
git merge upstream/release
```

- Resolve exactly as agreed. `merge.conflictStyle zdiff3` shows the base of each conflict.
- `pnpm-lock.yaml`: take upstream's, run `vp i`, confirm our added dependencies are still in it.
- Rebrand every new user-visible "T3 Code", honoring the ledger's exceptions. Before committing,
  `git diff --cached HEAD | grep '^+.*T3 Code'` must show only those exceptions and `apps/marketing`.
- `vp run check:changed` must pass.

Commit the merge with a body listing what was kept, dropped and adapted. Update FORK.md for any new
decision. Do not push unless asked.
