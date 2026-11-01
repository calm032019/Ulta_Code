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
  const launch = vi.fn(async (_input: string, _replace: string | null) => "term-2");
  // The marker carries a per-run nonce, so tests read it back from the launched input.
  const marker = () => /__T3_PROBLEMS_EXIT_\w+?__/.exec(launch.mock.calls.at(-1)![0])![0];
  return {
    emit,
    output,
    launch,
    marker,
    run: () => useProblemsRunStore.getState().runByThreadKey[key],
  };
}

describe("startProblemsRun", () => {
  it("parses the run once the exit marker arrives, even split across chunks", async () => {
    const { output, launch, marker, run } = setup();
    await startProblemsRun({ threadRef, command, cwd: "/repo", launch });
    output(`$  ${launch.mock.calls[0]![0]}\r\n`);
    output(`/repo/src/a.ts(1,2): error TS1: bad\r\n${marker().slice(0, 10)}`);
    expect(run()).toEqual({ status: "running", command, terminalId: "term-2" });
    output(`${marker().slice(10)}:2\r\n$ `);
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
    const { emit, launch, run } = setup();
    await startProblemsRun({ threadRef, command, cwd: null, launch });
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

  it("replaces the previous run's terminal and retries in fish syntax", async () => {
    const { output, launch, marker, run } = setup();
    await startProblemsRun({ threadRef, command, cwd: null, launch });
    expect(launch).toHaveBeenLastCalledWith(`${command}; echo "${marker()}:$?"`, null);
    output(`$  ${launch.mock.calls[0]![0]}\r\n`);
    output("fish: $? is not supported. In fish, please use $status.\r\n");
    expect(launch).toHaveBeenLastCalledWith(`${command}; echo "${marker()}:$status"`, "term-2");
    await launch.mock.results.at(-1)?.value;
    output(`${marker()}:0\r\n`);
    expect(run()).toMatchObject({ status: "finished", exitCode: 0, terminalId: "term-2" });

    await startProblemsRun({ threadRef, command, cwd: null, launch });
    expect(launch.mock.calls[2]).toEqual([`${command}; echo "${marker()}:$?"`, "term-2"]);
  });

  it("stops following the terminal when cancelled", async () => {
    const { output, launch, marker, run } = setup();
    await startProblemsRun({ threadRef, command, cwd: null, launch });
    cancelProblemsRun(threadRef);
    output(`${marker()}:0\r\n`);
    expect(run()).toMatchObject({ status: "failed", terminalId: "term-2" });
  });
});
