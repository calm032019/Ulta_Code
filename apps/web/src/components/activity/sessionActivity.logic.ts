import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import { checkpointFileTotals } from "@t3tools/client-runtime/state/thread-checkpoints";
import { commandDisplayText } from "@t3tools/client-runtime/work-log/command-label";
import type {
  OrchestrationV2Checkpoint,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  RunId,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { classifyToolActivity, collectToolFilePaths } from "@t3tools/shared/toolActivity";
import * as DateTime from "effect/DateTime";

import { providerErrorPresentation } from "../../session-logic";
import type { MessagesTimelineRow } from "../chat/MessagesTimeline.logic";

export const SESSION_ACTIVITY_KINDS = [
  { kind: "commit", label: "Commits" },
  { kind: "push", label: "Pushes" },
  { kind: "pull-request", label: "Pull requests" },
  { kind: "rerun", label: "Reruns" },
  { kind: "usage-limit", label: "Usage limits" },
  { kind: "error", label: "Errors" },
  { kind: "change", label: "Changes" },
  { kind: "read", label: "Reads" },
  { kind: "command", label: "Commands" },
] as const;

export type SessionActivityKind = (typeof SESSION_ACTIVITY_KINDS)[number]["kind"];

export interface SessionActivityEvent {
  readonly id: string;
  readonly kind: SessionActivityKind;
  /** ISO timestamp. */
  readonly at: string;
  readonly runId: RunId | null;
  /** The timeline entry this came from, when it has one. */
  readonly itemId: string | null;
  readonly title: string;
  readonly detail: string | null;
  readonly failed: boolean;
  readonly diffStat?: {
    readonly files: number;
    readonly additions: number;
    readonly deletions: number;
  };
  readonly url?: string;
}

export interface SessionActivityInput {
  readonly visibleTurnItems: ReadonlyArray<ThreadStructureVisibleTurnItem>;
  readonly runs: ReadonlyArray<
    Pick<OrchestrationV2Run, "id" | "ordinal" | "requestedAt" | "restartContinuationOfRunId">
  >;
  readonly attempts: ReadonlyArray<
    Pick<
      OrchestrationV2RunAttempt,
      "id" | "runId" | "attemptOrdinal" | "reason" | "status" | "startedAt" | "completedAt"
    >
  >;
  readonly checkpoints: ReadonlyArray<
    Pick<
      OrchestrationV2Checkpoint,
      "id" | "runId" | "appRunOrdinal" | "status" | "files" | "filesTotal" | "capturedAt"
    >
  >;
  readonly pullRequests: ReadonlyArray<
    Pick<
      ThreadPullRequestLink,
      "number" | "repository" | "url" | "source" | "linkedAt" | "snapshot"
    >
  >;
}

type GitOperation = "commit" | "push" | "pull-request";

interface CommandActivity {
  readonly git: ReadonlyArray<GitOperation>;
  readonly readPath: string | null;
}

const GIT_GLOBAL_OPTIONS = String.raw`(?:\s+(?:-C|-c|--git-dir|--work-tree)(?:\s+|=)\S+|\s+--no-pager)*`;
const GIT_SEGMENT_PATTERNS: ReadonlyArray<readonly [GitOperation, RegExp]> = [
  ["commit", new RegExp(String.raw`^git${GIT_GLOBAL_OPTIONS}\s+commit\b`)],
  ["push", new RegExp(String.raw`^git${GIT_GLOBAL_OPTIONS}\s+push\b`)],
  ["pull-request", /^(?:gh\s+pr|glab\s+mr)\s+create\b/],
];
const READ_PROGRAMS = new Set(["cat", "head", "tail", "nl", "less", "more", "bat", "sed"]);
const HEAD_TAIL_OPTIONS_WITH_VALUE = new Set(["-n", "-c", "--lines", "--bytes"]);

function shellTokens(segment: string): string[] {
  return Array.from(
    segment.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

function withoutPrefixes(segment: string): string {
  return segment.replace(/^(?:\w+=\S*\s+)*(?:sudo\s+|command\s+|exec\s+)?/, "");
}

function readPathOf(script: string): string | null {
  // A pipeline or chain does more than read, except trailing `| head`, `| tail` or `| sed -n`.
  const [first, ...rest] = script.split(/&&|\|\||;|\n|\|/);
  if (first === undefined) return null;
  if (rest.some((segment) => !/^\s*(?:head|tail|sed\s+-n)\b/.test(segment))) return null;
  const tokens = shellTokens(withoutPrefixes(first.trim()));
  const program = tokens[0]?.split("/").at(-1);
  if (program === undefined || !READ_PROGRAMS.has(program)) return null;
  if (program === "sed" && !tokens.includes("-n")) return null;
  const operands: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.startsWith("-")) {
      if ((program === "head" || program === "tail") && HEAD_TAIL_OPTIONS_WITH_VALUE.has(token)) {
        index += 1;
      }
      continue;
    }
    if (token.startsWith(">") || token.startsWith("<") || token === "2>&1") break;
    operands.push(token);
  }
  // sed's first operand is its script.
  const files = program === "sed" ? operands.slice(1) : operands;
  return files[0] ?? null;
}

export function classifyCommandActivity(command: string): CommandActivity {
  const script = commandDisplayText(command);
  const git = new Set<GitOperation>();
  for (const segment of script.split(/&&|\|\||;|\n|\|/)) {
    const normalized = withoutPrefixes(segment.trim());
    for (const [operation, pattern] of GIT_SEGMENT_PATTERNS) {
      if (pattern.test(normalized)) git.add(operation);
    }
  }
  return {
    git: GIT_SEGMENT_PATTERNS.flatMap(([operation]) => (git.has(operation) ? [operation] : [])),
    readPath: git.size === 0 ? readPathOf(script) : null,
  };
}

/** The subject of a `git commit -m`, including the heredoc form agents use. */
export function commitMessageOf(command: string): string | null {
  const full = commandDisplayText(command);
  const script = full.slice(Math.max(0, full.search(/\bgit\b[^\n]*?\scommit\b/)));
  const heredoc = /<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\b/.exec(script);
  const inline =
    /\s(?:-[a-zA-Z]*m|--message)(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|]+))/.exec(
      script,
    );
  const message = inline ? (inline[1] ?? inline[2] ?? inline[3] ?? "") : null;
  const text = message?.trimStart().startsWith("$(") && heredoc ? heredoc[2]! : message;
  const subject = text
    ?.replaceAll('\\"', '"')
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return subject ?? null;
}

function firstLine(text: string, max = 200): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1) || path;
}

function fileChangeVerb(operation: string | undefined): string {
  switch (operation?.toLowerCase()) {
    case "add":
    case "create":
    case "write":
      return "Created";
    case "delete":
    case "remove":
      return "Deleted";
    case "move":
    case "rename":
      return "Moved";
    default:
      return "Edited";
  }
}

function itemAt(item: ThreadStructureVisibleTurnItem["item"]): string {
  const at =
    item.startedAt ?? item.completedAt ?? ("updatedAt" in item ? item.updatedAt : undefined);
  return at === undefined ? "" : DateTime.formatIso(at);
}

const RERUN_TITLES: Record<Exclude<OrchestrationV2RunAttempt["reason"], "initial">, string> = {
  retry: "Retried turn",
  provider_recovery: "Recovered and resumed turn",
  steering_restart: "Restarted turn to steer",
};

const GIT_FAILURE_TITLES: Record<GitOperation, string> = {
  commit: "Commit failed",
  push: "Push failed",
  "pull-request": "Pull request not opened",
};

/** Typed, chronological activity for a thread from data the client already holds. */
export function deriveSessionActivity(input: SessionActivityInput): SessionActivityEvent[] {
  const events: SessionActivityEvent[] = [];
  const turnLabel = new Map(input.runs.map((run) => [run.id, `Turn ${run.ordinal}`] as const));

  const pushCommand = (
    id: string,
    at: string,
    runId: RunId | null,
    command: string,
    failed: boolean,
  ) => {
    const detail = firstLine(commandDisplayText(command));
    const { git, readPath } = classifyCommandActivity(command);
    for (const operation of git) {
      events.push({
        id: `${id}:${operation}`,
        kind: operation,
        at,
        runId,
        itemId: id,
        title: failed
          ? GIT_FAILURE_TITLES[operation]
          : operation === "commit"
            ? (commitMessageOf(command) ?? "Committed")
            : operation === "push"
              ? "Pushed"
              : "Opened pull request",
        detail,
        failed,
      });
    }
    if (git.length > 0) return;
    events.push(
      readPath === null
        ? { id, kind: "command", at, runId, itemId: id, title: detail, detail: null, failed }
        : {
            id,
            kind: "read",
            at,
            runId,
            itemId: id,
            title: `Read ${baseName(readPath)}`,
            detail: readPath,
            failed,
          },
    );
  };

  for (const { item } of input.visibleTurnItems) {
    const at = itemAt(item);
    const failed = item.status === "failed";
    switch (item.type) {
      case "command_execution":
        pushCommand(
          item.id,
          at,
          item.runId,
          item.input,
          failed || (item.exitCode !== undefined && item.exitCode !== 0),
        );
        break;
      case "file_change": {
        const changes = item.changes ?? [];
        const paths = changes.length > 0 ? changes.map((change) => change.path) : [item.fileName];
        const title =
          paths.length > 1
            ? `Changed ${paths.length} files`
            : `${fileChangeVerb(changes[0]?.operation)} ${baseName(paths[0]!)}`;
        events.push({
          id: item.id,
          kind: "change",
          at,
          runId: item.runId,
          itemId: item.id,
          title,
          detail: paths.join(", "),
          failed,
          ...(item.additions !== undefined || item.deletions !== undefined
            ? {
                diffStat: {
                  files: paths.length,
                  additions: item.additions ?? 0,
                  deletions: item.deletions ?? 0,
                },
              }
            : {}),
        });
        break;
      }
      case "dynamic_tool": {
        const action = classifyToolActivity({
          itemType: "dynamic_tool_call",
          data: { toolName: item.toolName ?? undefined, input: item.input },
        });
        const input = item.input as { readonly command?: unknown } | null;
        if (action === "command" && typeof input?.command === "string") {
          pushCommand(item.id, at, item.runId, input.command, failed);
          break;
        }
        if (action !== "read" && action !== "file_change") break;
        const [path] = collectToolFilePaths({ input: item.input });
        events.push({
          id: item.id,
          kind: action === "read" ? "read" : "change",
          at,
          runId: item.runId,
          itemId: item.id,
          title: `${action === "read" ? "Read" : "Edited"} ${path ? baseName(path) : (item.toolName ?? "file")}`,
          detail: path ?? null,
          failed,
        });
        break;
      }
      case "error": {
        const presentation = providerErrorPresentation(item);
        const usageLimit = item.failure.class === "usage_limit";
        const rateLimited =
          !usageLimit &&
          /rate.?limit|\b429\b/i.test(`${item.failure.code} ${item.failure.message}`);
        events.push({
          id: item.id,
          kind: usageLimit ? "usage-limit" : "error",
          at,
          runId: item.runId,
          itemId: item.id,
          title: rateLimited && item.retry === undefined ? "Rate limited" : presentation.label,
          detail: presentation.detail,
          // A retry that recovered is not a failure the user has to act on.
          failed: item.status !== "completed",
        });
        break;
      }
    }
  }

  for (const attempt of input.attempts) {
    if (attempt.reason === "initial") continue;
    const at = attempt.startedAt ?? attempt.completedAt;
    if (at === null) continue;
    const turn = turnLabel.get(attempt.runId);
    events.push({
      id: `attempt:${attempt.id}`,
      kind: "rerun",
      at: DateTime.formatIso(at),
      runId: attempt.runId,
      itemId: null,
      title: RERUN_TITLES[attempt.reason],
      detail: `${turn ? `${turn}, ` : ""}attempt ${attempt.attemptOrdinal}`,
      failed: attempt.status === "failed",
    });
  }

  for (const run of input.runs) {
    if (run.restartContinuationOfRunId === undefined) continue;
    const previous = turnLabel.get(run.restartContinuationOfRunId);
    events.push({
      id: `run-continuation:${run.id}`,
      kind: "rerun",
      at: DateTime.formatIso(run.requestedAt),
      runId: run.id,
      itemId: null,
      title: "Continued after restart",
      detail: previous ? `Continues ${previous.toLowerCase()}` : null,
      failed: false,
    });
  }

  for (const checkpoint of input.checkpoints) {
    if (checkpoint.appRunOrdinal === null || checkpoint.runId === null) continue;
    const totals = checkpointFileTotals(checkpoint);
    if (totals.count === 0) continue;
    events.push({
      id: `checkpoint:${checkpoint.id}`,
      kind: "change",
      at: DateTime.formatIso(checkpoint.capturedAt),
      runId: checkpoint.runId,
      itemId: null,
      title: `Turn ${checkpoint.appRunOrdinal} changed ${totals.count} ${totals.count === 1 ? "file" : "files"}`,
      detail: checkpoint.files
        .slice(0, 5)
        .map((file) => file.path)
        .join(", "),
      failed: checkpoint.status === "error",
      diffStat: { files: totals.count, additions: totals.additions, deletions: totals.deletions },
    });
  }

  for (const link of input.pullRequests) {
    if (link.source === "stack" || link.source === "stack-dismissed") continue;
    events.push({
      id: `pull-request:${link.repository}#${link.number}`,
      kind: "pull-request",
      at: link.linkedAt,
      runId: null,
      itemId: null,
      title: `${link.source === "created" ? "Opened" : "Linked"} #${link.number}${
        link.snapshot ? ` ${link.snapshot.title}` : ""
      }`,
      detail: link.repository,
      failed: false,
      url: link.url,
    });
  }

  const time = new Map(events.map((event) => [event, Date.parse(event.at) || 0] as const));
  return events
    .map((event, index) => ({ event, index }))
    .toSorted(
      (left, right) => time.get(right.event)! - time.get(left.event)! || right.index - left.index,
    )
    .map(({ event }) => event);
}

export function countSessionActivity(
  events: ReadonlyArray<SessionActivityEvent>,
): Record<SessionActivityKind, number> {
  const counts = Object.fromEntries(SESSION_ACTIVITY_KINDS.map(({ kind }) => [kind, 0])) as Record<
    SessionActivityKind,
    number
  >;
  for (const event of events) counts[event.kind] += 1;
  return counts;
}

export interface TimelineJumpTarget {
  readonly itemId: string | null;
  readonly runId: RunId | null;
  readonly at: string;
}

function rowHoldsItem(row: MessagesTimelineRow, itemId: string): boolean {
  if (row.id === itemId) return true;
  switch (row.kind) {
    case "work":
      return row.groupedEntries.some((entry) => entry.id === itemId);
    case "work-live":
      return row.entry.id === itemId;
    case "event":
    case "message":
      return row.projectedItem?.item.id === itemId;
    default:
      return false;
  }
}

/** The row to scroll to: the item itself, else its turn's fold, else the last row before it. */
export function findTimelineRowIndexForActivity(
  rows: ReadonlyArray<MessagesTimelineRow>,
  target: TimelineJumpTarget,
): number {
  const { itemId, runId } = target;
  if (itemId !== null) {
    const index = rows.findIndex((row) => rowHoldsItem(row, itemId));
    if (index >= 0) return index;
  }
  if (runId !== null) {
    const index = rows.findIndex(
      (row) =>
        ((row.kind === "turn-fold" || row.kind === "attempt-fold") && row.runId === runId) ||
        (row.kind === "message" && row.message.role === "user" && row.message.runId === runId),
    );
    if (index >= 0) return index;
  }
  const at = Date.parse(target.at);
  if (Number.isNaN(at)) return -1;
  return rows.findLastIndex((row) => row.createdAt !== null && Date.parse(row.createdAt) <= at);
}
