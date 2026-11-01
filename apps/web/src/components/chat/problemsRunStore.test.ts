import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  applyTerminalAttachStreamEvent,
  nextTerminalAttachSeedState,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import { EnvironmentId, ThreadId, type TerminalAttachStreamEvent } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { problemsTerminalCommand } from "./problems.logic";
import { cancelProblemsRun, startProblemsRun, useProblemsRunStore } from "./problemsRunStore";

const terminal = vi.hoisted(() => ({
  atom: null as unknown as Atom.Writable<AsyncResult.AsyncResult<TerminalBufferState, unknown>>,
}));

vi.mock(import("../../state/terminal"), () => ({
  terminalEnvironment: { observe: () => terminal.atom } as never,
}));

const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
const key = scopedThreadKey(threadRef);
const command = "pnpm run typecheck";

function setup() {
  let buffer = nextTerminalAttachSeedState();
  terminal.atom = Atom.make<AsyncResult.AsyncResult<TerminalBufferState, unknown>>(
    AsyncResult.success(buffer),
  );
  useProblemsRunStore.setState({ runByThreadKey: {}, commandByThreadKey: {} });
  const emit = (event: TerminalAttachStreamEvent) => {
    buffer = applyTerminalAttachStreamEvent(buffer, event);
    appAtomRegistry.set(terminal.atom, AsyncResult.success(buffer));
  };
  const output = (data: string) =>
    emit({ type: "output", threadId: threadRef.threadId, terminalId: "term-2", data });
  return { emit, output, run: () => useProblemsRunStore.getState().runByThreadKey[key] };
}

describe("startProblemsRun", () => {
  it("parses the run once the exit marker arrives, even split across chunks", async () => {
    const { output, run } = setup();
    await startProblemsRun({ threadRef, command, cwd: "/repo", launch: async () => "term-2" });
    output(`$  ${problemsTerminalCommand(command)}\r\n`);
    output("/repo/src/a.ts(1,2): error TS1: bad\r\n__T3_PROB");
    expect(run()).toEqual({ status: "running", command, terminalId: "term-2" });
    output("LEMS_EXIT__:2\r\n$ ");
    expect(run()).toEqual({
      status: "finished",
      command,
      terminalId: "term-2",
      exitCode: 2,
      problems: [
        {
          file: "src/a.ts",
          line: 1,
          column: 2,
          severity: "error",
          code: "TS1",
          message: "bad",
        },
      ],
    });
    output("src/b.ts(1,1): error TS2: later output is ignored\r\n");
    expect(run()).toMatchObject({ status: "finished", problems: [{ file: "src/a.ts" }] });
  });

  it("fails when the terminal exits before the marker or cannot start", async () => {
    const { emit, run } = setup();
    await startProblemsRun({ threadRef, command, cwd: null, launch: async () => "term-2" });
    emit({
      type: "exited",
      threadId: threadRef.threadId,
      terminalId: "term-2",
      exitCode: 1,
      exitSignal: null,
    });
    expect(run()).toMatchObject({ status: "failed", terminalId: "term-2" });

    await startProblemsRun({ threadRef, command, cwd: null, launch: async () => null });
    expect(run()).toMatchObject({ status: "failed", terminalId: null });
  });

  it("stops following the terminal when cancelled", async () => {
    const { output, run } = setup();
    await startProblemsRun({ threadRef, command, cwd: null, launch: async () => "term-2" });
    cancelProblemsRun(threadRef);
    output("__T3_PROBLEMS_EXIT__:0\r\n");
    expect(run()).toMatchObject({ status: "failed", terminalId: "term-2" });
  });
});
