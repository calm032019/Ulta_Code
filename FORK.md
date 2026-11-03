# Ulta Code fork

Ulta Code is a fork of [T3 Code](https://github.com/pingdotgg/t3code). We merge upstream `main` into our
branch and keep our changes on top. This file records what we changed and why, so every upstream update
is checked against it: nothing gets applied twice, and nothing undoes a decision below.

## Remotes

- `origin`: https://github.com/calm032019/Ulta_Code (ours)
- `upstream`: https://github.com/pingdotgg/t3code (fetches `main` only, push disabled)

## Syncing

1. Commit or stash your work.
2. `vp run upstream:check` fetches upstream and writes a report: the conflicts the merge would raise,
   upstream commits we already made ourselves, upstream commits touching files we changed, and T3 Code
   branding the merge would bring back. It reads only; nothing is checked out.
3. Check each flagged commit against the ledger below (the `sync-upstream` skill walks an agent through it).
4. `git merge upstream/main`, resolve conflicts by the ledger, rebrand new strings, then regenerate
   `pnpm-lock.yaml` with `vp i` instead of hand-merging it.
5. `vp run check:changed`, then update this ledger if a decision changed.

When upstream ships a feature we already built, keep one: prefer upstream's when it covers ours (less to
carry), and drop our version in the merge commit. Note the decision here.

## Ledger

Each entry: what we changed, the rule a merge must keep, and the commits.

### Brand and identity

- Product name is **Ulta Code** everywhere users see it, with our own logo. New upstream strings saying
  "T3 Code" get rebranded. `t3`/`t3code` identifiers, package names, env vars (`T3CODE_*`) and the
  `t3code://` scheme stay, because mobile pairing and tooling depend on them. Marketing site is untouched.
- Exception: Codex `clientInfo.name` and the originator override stay "T3 Code", the identifier existing
  installs reported to OpenAI. Only its display title says "Ulta Code".
- Desktop has its own identity: app ID `com.calm032019.ultacode`, `~/.ulta` data folder, `ulta-code`
  Electron profile, install folder and compile cache, `Ulta-Code-<version>-<arch>` installers. It never
  adopts or imports a T3 Code profile or local storage.
- Commits: 4689601881, 8180a207ff, d14d638a2a

### Look and feel

- Calm desktop-chat restyle; coral-and-navy palette; Epilogue Light conversation text.
- Dates follow the user's region (`apps/web/src/timestampFormat.ts`).
- Commits: d9d5a87333, cf7395e1c7, 04f809de07

### Chat and threads

- Clearer permissions, simple layout, honest reconnect states; the new-thread permissions pill opens only
  permissions.
- Vertical session timeline with a "you are here" marker; session activity panel for the whole thread,
  kept cheap while scrolling; activity titles drop invisible characters.
- Continue a thread on another machine. Prompt links open in the app that copied them.
- Commits: 08125b7b7f, a9406d74e6, 565a0c7c11, c353e03f28, 5643745e97, a1b68fda79, da25bf21d1, 3f1283cf84

### Dunce Mode

- Explains agent messages, and its own errors, in plain English; bounded and cancellable. Has its own model
  settings (`DunceModeModelSettings`, `PlainLanguageService`).
- Commits: 39f7d046b5, 2f26cb64ec, 6684254561, 463949a4b1

### Code tools

- Ask the agent to edit selected lines from the file preview.
- Find in codebase by meaning from the command palette.
- Problems in thread details with "Fix with agent"; shows every script Run executes and trusts only its own
  exit marker.
- Commits: 83394966fa, ca79c9549a, c3b6184eea, 22d6d4436b, 945cd29e6a

### Connectors and triage

- Settings has a Connectors page listing provider MCP servers; config reads are linear and bounded;
  connector secrets never leak.
- Triage runs against this repo (calm032019/Ulta_Code), not upstream.
- Commits: 7a94b5f33b, 068ecfab3b, 2f5f6663ee, b6348e88f1, 945cd29e6a

### Providers

- Claude instances have an API key field.
- Untrusted text in agent prompts is marked as data; copy does not overpromise.
- Commits: 252f36d0e9, c293ba8a4b

### Usage plan

- Plan daily usage against weekly and monthly limits; a morning reset does not count its own day;
  survives out-of-range resets; readings kept per environment.
- Commits: 913a343358, 69f49b2bcb, e301a49abe, 04f809de07

### Minigames

- Minigame dock in place of the composer while the agent works: Claude Run, Gate Rush, Skyline Hop.
- Must stay cheap: no full-rate repainting when idle, hidden work skipped, no lost runs on pause or focus
  loss.
- Commits: 0bbded353d, edb6691606, 116d9c75d1, 8031054a1a, 7a360721d2, cfc3d3aca7, 8ba7d67015,
  13bc167bf1, 7120891ebf, e3e8a2695f, 440469cf50, 4df19a6304, 16b06cf3c2, 0b425e5e03, c1ffe2a9c8,
  81b4e9f42c, 3f4f4112f6, 8ead0afa57, 58dedf09e4, d95ca92dd8

### Smaller fixes

- Preview explains why the server browser could not start (1c7c0df133).
- Environment-wide switches are read-only in project scope (7ec0cbd016).
- CJK font alias resolves on Windows (59631c08d1).
- Audit follow-ups (977d95bba9, d4b94e8422, eda9a247a5).
