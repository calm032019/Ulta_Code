import {
  CheckpointId,
  MessageId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "../chat/MessagesTimeline.logic";
import {
  classifyCommandActivity,
  commitMessageOf,
  countSessionActivity,
  deriveSessionActivity,
  findTimelineRowIndexForActivity,
  type SessionActivityInput,
} from "./sessionActivity.logic";

const threadId = ThreadId.make("thread-1");
const runId = RunId.make("run-1");
const iso = (second: number) => `2026-10-06T10:00:${String(second).padStart(2, "0")}.000Z`;
const at = (second: number) => DateTime.makeUnsafe(iso(second));

function base(id: string, second: number) {
  return {
    id: TurnItemId.make(id),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: second,
    title: null,
    status: "completed" as const,
    startedAt: at(second),
    completedAt: at(second),
    updatedAt: at(second),
  };
}

function projected(item: OrchestrationV2TurnItem): OrchestrationV2ProjectedTurnItem {
  return {
    position: item.ordinal,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: item.id,
    item,
  };
}

function command(id: string, second: number, input: string, exitCode = 0) {
  return projected({ ...base(id, second), type: "command_execution", input, exitCode });
}

function activity(overrides: Partial<SessionActivityInput>): SessionActivityInput {
  return {
    visibleTurnItems: [],
    runs: [],
    attempts: [],
    checkpoints: [],
    pullRequests: [],
    ...overrides,
  };
}

describe("classifyCommandActivity", () => {
  it.each([
    ["git commit -m 'fix: thing'", ["commit"], null],
    ["git -C repo commit -am wip", ["commit"], null],
    ["git add -A && git commit -m x && git push -u origin HEAD", ["commit", "push"], null],
    ["GIT_TRACE=1 git push --force-with-lease", ["push"], null],
    ["gh pr create --fill", ["pull-request"], null],
    ["/bin/bash -lc 'git push origin main'", ["push"], null],
    ["echo 'git push'", [], null],
    ["git status", [], null],
    ["git log --grep=commit", [], null],
    ["cat src/index.ts", [], "src/index.ts"],
    ["sed -n '1,80p' apps/web/src/a.ts", [], "apps/web/src/a.ts"],
    ["head -n 40 README.md", [], "README.md"],
    ['/bin/zsh -lc "nl -ba src/main.rs | head -n 50"', [], "src/main.rs"],
    ["nl -ba src/a.ts | sed -n '1,120p'", [], "src/a.ts"],
    ["cat -n src/a.ts", [], "src/a.ts"],
    ["tail -c 200 log.txt", [], "log.txt"],
    ["sed -i 's/a/b/' file.ts", [], null],
    ["cat a.ts | grep foo", [], null],
    ["rg foo src", [], null],
  ])("%s", (input, git, readPath) => {
    expect(classifyCommandActivity(input)).toEqual({ git, readPath });
  });
});

describe("commitMessageOf", () => {
  it("reads inline and heredoc messages", () => {
    expect(commitMessageOf('git commit -m "fix(web): stop the spinner"')).toBe(
      "fix(web): stop the spinner",
    );
    expect(commitMessageOf("git commit --message=wip")).toBe("wip");
    expect(commitMessageOf("python -m pytest && git commit -m done")).toBe("done");
    expect(
      commitMessageOf("git commit -m \"$(cat <<'EOF'\nfeat: add activity\n\nBody line\nEOF\n)\""),
    ).toBe("feat: add activity");
    expect(commitMessageOf("git commit --amend --no-edit")).toBeNull();
  });
});

describe("deriveSessionActivity", () => {
  it("turns thread data into typed events, newest first", () => {
    const events = deriveSessionActivity(
      activity({
        visibleTurnItems: [
          command("read", 1, "cat package.json"),
          projected({
            ...base("edit", 2),
            type: "file_change",
            fileName: "src/a.ts",
            additions: 3,
            deletions: 1,
            changes: [{ operation: "add", path: "src/a.ts" }],
          }),
          projected({
            ...base("tool-read", 3),
            type: "dynamic_tool",
            toolName: "Read",
            input: { file_path: "/repo/src/b.ts" },
          }),
          command("ship", 4, 'git commit -m "feat: ship it" && git push'),
          command("push-fail", 5, "git push", 1),
          command("tests", 6, "vp test run"),
          projected({
            ...base("limit", 7),
            status: "failed",
            type: "error",
            failure: {
              class: "usage_limit",
              message: "You've hit your limit.",
              code: null,
              retryable: false,
            },
          }),
          projected({
            ...base("rate", 8),
            status: "failed",
            type: "error",
            failure: {
              class: "provider_error",
              message: "429 Too Many Requests",
              code: null,
              retryable: true,
            },
          }),
          projected({
            ...base("assistant", 9),
            type: "assistant_message",
            messageId: MessageId.make("m"),
            text: "Done",
            streaming: false,
          }),
        ],
        runs: [
          { id: runId, ordinal: 1, requestedAt: at(0) },
          {
            id: RunId.make("run-2"),
            ordinal: 2,
            requestedAt: at(12),
            restartContinuationOfRunId: runId,
          },
        ],
        attempts: [
          {
            id: RunAttemptId.make("a1"),
            runId,
            attemptOrdinal: 1,
            reason: "initial",
            status: "failed",
            startedAt: at(0),
            completedAt: at(9),
          },
          {
            id: RunAttemptId.make("a2"),
            runId,
            attemptOrdinal: 2,
            reason: "retry",
            status: "completed",
            startedAt: at(10),
            completedAt: at(11),
          },
        ],
        checkpoints: [
          {
            id: CheckpointId.make("baseline"),
            runId: null,
            appRunOrdinal: null,
            status: "ready",
            files: [],
            capturedAt: at(0),
          },
          {
            id: CheckpointId.make("cp1"),
            runId,
            appRunOrdinal: 1,
            status: "ready",
            files: [
              { path: "src/a.ts", kind: "added", additions: 3, deletions: 1 },
              { path: "src/c.ts", kind: "modified", additions: 2, deletions: 2 },
            ],
            capturedAt: at(11),
          },
        ],
        pullRequests: [
          {
            number: 42,
            repository: "acme/app",
            url: "https://github.com/acme/app/pull/42",
            source: "created",
            linkedAt: iso(13),
            snapshot: null,
          },
          {
            number: 41,
            repository: "acme/app",
            url: "https://github.com/acme/app/pull/41",
            source: "stack",
            linkedAt: iso(13),
            snapshot: null,
          },
        ],
      }),
    );

    expect(events.map((event) => [event.kind, event.title, event.failed])).toEqual([
      ["pull-request", "Opened #42", false],
      ["rerun", "Continued after restart", false],
      ["change", "Turn 1 changed 2 files", false],
      ["rerun", "Retried turn", false],
      ["error", "Rate limited", true],
      ["usage-limit", "Usage limit reached", true],
      ["command", "vp test run", false],
      ["push", "Push failed", true],
      ["push", "Pushed", false],
      ["commit", "feat: ship it", false],
      ["read", "Read b.ts", false],
      ["change", "Created a.ts", false],
      ["read", "Read package.json", false],
    ]);
    expect(events.find((event) => event.id === "checkpoint:cp1")?.diffStat).toEqual({
      files: 2,
      additions: 5,
      deletions: 3,
    });
    expect(events.find((event) => event.kind === "commit")).toMatchObject({
      itemId: "ship",
      runId,
    });
    expect(countSessionActivity(events)).toEqual({
      commit: 1,
      push: 2,
      "pull-request": 1,
      rerun: 2,
      "usage-limit": 1,
      error: 1,
      change: 2,
      read: 2,
      command: 1,
    });
  });

  it("re-derives a turn item when its object changes", () => {
    const running = projected({
      ...base("run", 1),
      status: "running",
      type: "command_execution",
      input: "git push",
    });
    const kept = command("kept", 2, "cat a.ts");
    const before = deriveSessionActivity(activity({ visibleTurnItems: [running, kept] }));
    const after = deriveSessionActivity(
      activity({ visibleTurnItems: [command("run", 1, "git push", 1), kept] }),
    );
    expect(before.map((event) => [event.title, event.failed])).toEqual([
      ["Read a.ts", false],
      ["Pushed", false],
    ]);
    expect(after.map((event) => [event.title, event.failed])).toEqual([
      ["Read a.ts", false],
      ["Push failed", true],
    ]);
    expect(after[0]).toBe(before[0]);
  });
});

describe("findTimelineRowIndexForActivity", () => {
  const userRow = {
    kind: "message",
    id: "user",
    createdAt: iso(0),
    message: {
      id: MessageId.make("user"),
      role: "user",
      text: "Go",
      runId,
      createdAt: iso(0),
      streaming: false,
    },
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  } as MessagesTimelineRow;
  const workRow = {
    kind: "work",
    id: "work-group:a",
    createdAt: iso(2),
    groupedEntries: [{ id: "edit", createdAt: iso(2), label: "Edit", tone: "tool" }],
    isExpandedToolGroup: false,
  } as MessagesTimelineRow;
  const laterRow = { kind: "working", id: "working", createdAt: iso(20) } as MessagesTimelineRow;
  const rows = [userRow, workRow, laterRow];

  it("finds the item, else its turn, else the last row before it", () => {
    expect(findTimelineRowIndexForActivity(rows, { itemId: "edit", runId, at: iso(2) })).toBe(1);
    expect(findTimelineRowIndexForActivity(rows, { itemId: "hidden", runId, at: iso(5) })).toBe(0);
    expect(
      findTimelineRowIndexForActivity(rows, {
        itemId: null,
        runId: RunId.make("other"),
        at: iso(5),
      }),
    ).toBe(1);
    expect(findTimelineRowIndexForActivity([], { itemId: null, runId: null, at: iso(5) })).toBe(-1);
  });
});
