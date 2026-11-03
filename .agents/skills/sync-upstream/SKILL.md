---
name: sync-upstream
description: Bring upstream T3 Code changes into the Ulta Code fork without doubling up or undoing our changes. Use when asked to sync, update from, or merge upstream / T3 Code, or to check what upstream changed.
---

# Sync upstream T3 Code

Ulta Code merges `upstream/main` (pingdotgg/t3code) into its branch. [FORK.md](../../../FORK.md) is the
ledger of what we changed and the rule each change must keep. Read it first; it decides every judgment call.

## 1. Report

Stop if the working tree has uncommitted changes the user has not asked you to commit. Then:

```bash
vp run upstream:check --out .t3/upstream-check.md
```

It reads only. Sections: conflicts, upstream commits already in our tree, upstream commits touching files we
changed (with our commits on each file), and T3 Code branding the merge would bring back.

## 2. Judge each flagged commit

For every commit under "touching files we changed" and every conflict, read the upstream diff
(`git show <sha>`) next to ours and put it in one bucket:

- **Independent**: different behavior that happens to share a file. Merge as-is.
- **Duplicate**: upstream built something we already have (same feature, maybe a different shape, maybe
  in other files). Keep one. Prefer upstream's when it covers ours, and remove ours in the merge. A clean
  textual merge does not rule this out, so also scan upstream subjects in "Untouched by us" for features
  named in the ledger.
- **Contradiction**: upstream undoes or changes a ledger rule (rebranding back, sharing T3 Code's profile,
  repointing triage upstream, restyling over ours, extra repainting work in minigames). Keep our rule, but
  take upstream's surrounding fixes.

"Already in our tree" commits need nothing; git resolves identical changes. Never cherry-pick them again.

Show the user the duplicates and contradictions with your proposed resolution, and wait for their answer
before merging. Independent commits need no sign-off.

## 3. Merge

```bash
git merge upstream/main
```

- Resolve each conflict by the bucket above. `merge.conflictStyle zdiff3` shows the base, so you can see
  what each side changed.
- `pnpm-lock.yaml`: take upstream's, then run `vp i` to regenerate it.
- Rebrand the strings the report listed (user-visible "T3 Code" → "Ulta Code"), honoring the ledger's
  exceptions. Commit that as part of the merge.
- `vp run check:changed`. Fix what breaks.

Commit the merge with a body listing duplicates dropped and contradictions kept. Update FORK.md when a
decision changed (a feature now upstream's, a new exception). Do not push unless asked.
