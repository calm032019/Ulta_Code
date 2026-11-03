// @effect-diagnostics nodeBuiltinImport:off - a read-only git report, kept free of the app runtime.
// Compares the latest stable T3 Code release (remote `upstream`, tags vX.Y.Z,
// never nightly or preview) against this fork before merging it, so an update
// is checked against what we changed:
//   - conflicts the merge would raise (git merge-tree, nothing is checked out)
//   - upstream commits we already made ourselves, fully or per file
//   - upstream commits touching files we changed, with our commits on each file
//   - T3 Code branding the merge would bring back
// FORK.md records why each of our changes exists; read it alongside this report.
//
//   vp run upstream:check                      fetch the latest stable release and print the report
//   vp run upstream:check --no-fetch           reuse the release fetched last time
//   vp run upstream:check --ref upstream/main  preview another ref instead (not for syncing)
//   vp run upstream:check --out <file>         also write the report to <file>
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const RELEASE_REF = "refs/remotes/upstream/release";
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
// Our commits that only swapped the product name. Files they alone touched are left to the branding scan.
const REBRAND_SUBJECT = /\brebrand\b/i;
const BRAND_SCAN_EXCLUDES = [
  ".repos/",
  "apps/marketing/",
  ".github/",
  "/fixtures/",
  "CHANGELOG",
  "AGENTS.md",
];

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outFile = outIndex === -1 ? undefined : args[outIndex + 1];
const refIndex = args.indexOf("--ref");
const UPSTREAM = refIndex === -1 ? "upstream/release" : args[refIndex + 1]!;
let target = UPSTREAM;

function git(
  gitArgs: ReadonlyArray<string>,
  options: { input?: string; env?: NodeJS.ProcessEnv; allowFail?: boolean } = {},
) {
  try {
    return NodeChildProcess.execFileSync("git", gitArgs, {
      encoding: "utf8",
      input: options.input,
      env: options.env ?? process.env,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    if (options.allowFail) return null;
    throw error;
  }
}

function lines(text: string | null) {
  return (text ?? "").split("\n").filter((line) => line.length > 0);
}

if (!lines(git(["remote"])).includes("upstream")) {
  console.error(
    "No `upstream` remote. Add it with:\n  git remote add upstream https://github.com/pingdotgg/t3code.git",
  );
  process.exit(1);
}
if (!args.includes("--no-fetch")) {
  process.stderr.write("Fetching upstream...\n");
  git(["fetch", "upstream", "main", "--no-tags"]);
  if (refIndex === -1) {
    const latest = lines(git(["ls-remote", "--tags", "--refs", "upstream"]))
      .map((line) => line.split("\t")[1]!.replace("refs/tags/", ""))
      .filter((tag) => STABLE_TAG.test(tag))
      .map((tag) => ({ tag, version: tag.match(STABLE_TAG)!.slice(1).map(Number) }))
      .toSorted((a, b) => compareVersions(a.version, b.version))
      .at(-1);
    if (!latest) {
      console.error("Upstream has no stable vX.Y.Z release tag.");
      process.exit(1);
    }
    git(["fetch", "upstream", "--no-tags", `+refs/tags/${latest.tag}:${RELEASE_REF}`]);
    target = `${latest.tag} (latest stable release)`;
  }
}

function compareVersions(a: ReadonlyArray<number>, b: ReadonlyArray<number>) {
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

process.stderr.write("Comparing upstream commits with ours...\n");
const head = git(["rev-parse", "HEAD"])!.trim();
const mergeBase = git(["merge-base", "HEAD", UPSTREAM])!.trim();
const ourCommits = lines(git(["rev-list", "--no-merges", `${mergeBase}..HEAD`]));
const incoming = lines(
  git(["log", "--no-merges", "--reverse", "--format=%H%x09%h%x09%s", `${mergeBase}..${UPSTREAM}`]),
).map((line) => {
  const [sha, short, subject] = line.split("\t");
  return { sha: sha!, short: short!, subject: subject ?? "" };
});
const dirty = lines(git(["status", "--porcelain", "--untracked-files=no"]));
if (incoming.length === 0) {
  const text = `# Upstream check\n\nNothing to sync: this branch already includes ${target}.\n`;
  console.log(text);
  if (outFile) NodeFS.writeFileSync(outFile, text);
  process.exit(0);
}

// Our side of the fork: every file we changed, with the commits that changed it.
const ourCommitsByFile = new Map<string, Array<string>>();
let currentCommit = "";
for (const line of lines(
  git(["log", "--no-merges", "--format=@%h %s", "--name-only", `${mergeBase}..HEAD`]),
)) {
  if (line.startsWith("@")) {
    currentCommit = line.slice(1);
    continue;
  }
  const list = ourCommitsByFile.get(line) ?? [];
  list.push(currentCommit);
  ourCommitsByFile.set(line, list);
}

// A throwaway index holding HEAD lets `git apply --cached -R` test each upstream
// patch against our tree without touching the working tree or the real index.
const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upstream-check-"));
const scratchEnv = { ...process.env, GIT_INDEX_FILE: NodePath.join(scratch, "index") };
git(["read-tree", head], { env: scratchEnv });

function reverseApplies(patch: string, include?: string) {
  const applyArgs = ["apply", "--cached", "--check", "-R"];
  if (include) applyArgs.push(`--include=${include}`);
  return git(applyArgs, { input: patch, env: scratchEnv, allowFail: true }) !== null;
}

type Overlap = {
  short: string;
  subject: string;
  files: Array<string>;
  presentFiles: Array<string>;
};
const alreadyPresent: Array<{ short: string; subject: string }> = [];
const overlaps: Array<Overlap> = [];
let rebrandOnlyOverlaps = 0;
const isRebrandOnly = (file: string) =>
  ourCommitsByFile.get(file)!.every((commit) => REBRAND_SUBJECT.test(commit));

for (const commit of incoming) {
  const files = lines(git(["diff-tree", "--no-commit-id", "--name-only", "-r", commit.sha]));
  const touched = files.filter((file) => ourCommitsByFile.has(file));
  if (touched.length === 0) continue;
  const patch = git(["diff-tree", "-p", "--binary", "--no-commit-id", commit.sha])!;
  if (patch.length > 0 && reverseApplies(patch)) {
    alreadyPresent.push(commit);
    continue;
  }
  const featureFiles = touched.filter((file) => !isRebrandOnly(file));
  if (featureFiles.length === 0) {
    rebrandOnlyOverlaps += 1;
    continue;
  }
  overlaps.push({
    short: commit.short,
    subject: commit.subject,
    files: featureFiles,
    presentFiles: featureFiles.filter((file) => reverseApplies(patch, file)),
  });
}
NodeFS.rmSync(scratch, { recursive: true, force: true });

// Patch-id equivalents catch cherry-picks the reverse-apply check misses once later commits move the lines.
const cherryPicked = lines(git(["cherry", UPSTREAM, "HEAD", mergeBase])).filter((line) =>
  line.startsWith("-"),
);

// merge-tree exits 1 when there are conflicts but still prints the merged tree and the conflicted paths.
let mergeTreeOutput: Array<string>;
try {
  mergeTreeOutput = lines(
    git(["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", UPSTREAM]),
  );
} catch (error) {
  mergeTreeOutput = lines((error as { stdout?: string }).stdout ?? "");
}
const mergedTree = mergeTreeOutput[0]!;
const conflicts = mergeTreeOutput.slice(1);

// Branding the merge would add back, read from the merged tree itself.
const brandHits: Array<string> = [];
let brandFile = "";
for (const line of (git(["diff", "--unified=0", "--no-color", head, mergedTree]) ?? "").split(
  "\n",
)) {
  if (line.startsWith("+++ ")) {
    brandFile = line.replace(/^\+\+\+ (b\/)?/, "");
    continue;
  }
  if (!line.startsWith("+") || !/T3 Code/.test(line)) continue;
  if (
    BRAND_SCAN_EXCLUDES.some((prefix) => brandFile.startsWith(prefix) || brandFile.includes(prefix))
  )
    continue;
  brandHits.push(`${brandFile}: ${line.slice(1).trim().slice(0, 140)}`);
}

const report: Array<string> = [];
const section = (title: string, items: Array<string>, empty: string, count = items.length) => {
  report.push(`## ${title} (${count})`, "", ...(items.length ? items : [empty]), "");
};

report.push(
  "# Upstream check",
  "",
  `- Target: ${target}`,
  `- Fork point: ${git(["log", "-1", "--format=%h %ad %s", "--date=short", mergeBase])!.trim()}`,
  `- Ours: ${ourCommits.length} commits on top. Upstream: ${incoming.length} new commits, to ${git(["log", "-1", "--format=%h %ad", "--date=short", UPSTREAM])!.trim()}`,
  `- Untouched by us: ${incoming.length - overlaps.length - alreadyPresent.length - rebrandOnlyOverlaps} commits (merge as-is unless FORK.md says otherwise)`,
  `- Touching only files we rebranded: ${rebrandOnlyOverlaps} commits (the branding scan below covers them)`,
  "",
);
if (dirty.length > 0)
  report.push(
    `> Working tree has ${dirty.length} uncommitted changes. Commit or stash them before merging.`,
    "",
  );

section(
  "Conflicts the merge will raise",
  conflicts.map(
    (file) =>
      `- \`${file}\` — ours: ${(ourCommitsByFile.get(file) ?? ["(not ours)"]).slice(0, 3).join("; ")}`,
  ),
  "None. The merge applies cleanly.",
);
section(
  "Already in our tree (would double up if re-applied by hand)",
  [
    ...alreadyPresent.map((commit) => `- ${commit.short} ${commit.subject}`),
    ...cherryPicked.map(
      (line) => `- ours ${line.slice(2, 12)} is a patch-identical copy of an upstream commit`,
    ),
  ],
  "None.",
);
section(
  "Upstream commits touching files we changed (check each against FORK.md)",
  overlaps.flatMap((overlap) => [
    `- **${overlap.short} ${overlap.subject}**`,
    ...overlap.files.map((file) => {
      const present = overlap.presentFiles.includes(file)
        ? " _(this file's change is already in our tree)_"
        : "";
      return `  - \`${file}\`${present} — ours: ${ourCommitsByFile.get(file)!.slice(0, 3).join("; ")}`;
    }),
  ]),
  "None.",
  overlaps.length,
);
section(
  "T3 Code branding the merge would bring back",
  brandHits.slice(0, 80).map((hit) => `- ${hit}`),
  "None.",
);
if (brandHits.length > 80) report.push(`…and ${brandHits.length - 80} more.`, "");

const text = report.join("\n");
console.log(text);
if (outFile) NodeFS.writeFileSync(outFile, text);
