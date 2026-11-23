export const COMMIT_PROMPT = `---
name: commit
description: Commit this session's work safely through the shared commit queue. Use whenever the user says "commit", "commit this", "add to commit queue", "queue a commit", or asks to commit in any form. Several sessions edit this repo at once, so never use plain git add / git commit here.
---

# Commit through the queue

Several Claude sessions edit this working tree at the same time. A plain
\`git add\` / \`git commit\` sweeps up other sessions' edits, or reshuffles the
staging they've set up. Always commit with \`commit-queue.sh\`, which:

- waits its turn behind any other session's queued commit,
- builds the commit from the **current** HEAD plus **only your patch** in a
  private index, so other sessions' edits and staging are never touched,
- syncs the shared index afterwards.

Never run \`git add\`, \`git commit -a\`, \`git stash\`, \`git reset\` or \`git checkout\`
on files here to "clean up" first. The other changes belong to other sessions.

## Steps

1. **Work out what's yours.** List the files and hunks *this session* changed
   (from your own edits in this conversation). Run \`git status --short\` and
   \`git diff HEAD -- <file>\` for each one. If a file also holds changes you
   didn't make, those hunks are not yours. Leave them out.

2. **Write the patch** to a temp file (\`P=$(mktemp --suffix=.patch)\`):
   - Files only you touched: \`git diff HEAD -- <files> > "$P"\`
   - New untracked files you created:
     \`git diff --no-index -- /dev/null <file> >> "$P"\` (exit code 1 is normal)
   - Files that mix your changes with others': \`git diff -U1 HEAD -- <file>\`,
     then keep only your hunks. Delete whole hunks freely, because the script
     applies with \`--recount\`. If one hunk mixes both, drop the other session's
     \`+\` lines and turn its \`-\` lines into context lines (leading space).
   - Read the patch back and check that every hunk is yours.

3. **Write the message** to a temp file, in the repo's style
   (\`QNT-<n>: <what changed, in plain words>\`), ending with the attribution
   line(s) from the system reminder.

4. **Queue it.** Run in the background so the user isn't blocked:
   \`bash .claude/skills/commit/commit-queue.sh "$P" "$M"\`
   with \`run_in_background: true\`, then wait on it (\`t3_background_wait\` when
   available). It prints who it's waiting behind. If you run it in the
   foreground instead, give it a long timeout (600000).

5. **Report** by exit code:
   - \`0\`: committed. Give the hash and subject, and say what was left uncommitted.
   - \`2\`: patch doesn't apply. Another session committed changes to the same
     lines. Rebuild the patch against the new HEAD (step 2) and queue again.
   - \`3\`: timed out in the queue. Tell the user who it was waiting behind.
   - \`4\`: a hook rejected the commit. Show the output, fix, and re-queue.

Don't push unless asked.
`;
