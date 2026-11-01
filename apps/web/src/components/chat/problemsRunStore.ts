import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  readTerminalOutputUpdate,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { create } from "zustand";

import { formatEnvironmentQueryError } from "../../state/query";
import { terminalEnvironment } from "../../state/terminal";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  hasProblemsExitMarker,
  parseProblems,
  readProblemsRunOutput,
  type Problem,
} from "./problems.logic";

export type ProblemsRun =
  | { readonly status: "running"; readonly command: string; readonly terminalId: string | null }
  | {
      readonly status: "finished";
      readonly command: string;
      readonly terminalId: string;
      readonly exitCode: number | null;
      readonly problems: ReadonlyArray<Problem>;
    }
  | {
      readonly status: "failed";
      readonly command: string;
      readonly terminalId: string | null;
      readonly error: string;
    };

interface ProblemsRunState {
  readonly commandByThreadKey: Readonly<Record<string, string>>;
  readonly runByThreadKey: Readonly<Record<string, ProblemsRun>>;
  readonly setCommand: (threadRef: ScopedThreadRef, command: string) => void;
}

export const useProblemsRunStore = create<ProblemsRunState>()((set) => ({
  commandByThreadKey: {},
  runByThreadKey: {},
  setCommand: (threadRef, command) =>
    set((state) => ({
      commandByThreadKey: { ...state.commandByThreadKey, [scopedThreadKey(threadRef)]: command },
    })),
}));

const watchers = new Map<string, () => void>();

function setRun(key: string, run: ProblemsRun) {
  useProblemsRunStore.setState((state) => ({
    runByThreadKey: { ...state.runByThreadKey, [key]: run },
  }));
}

function stopWatching(key: string) {
  watchers.get(key)?.();
  watchers.delete(key);
}

/**
 * Runs a check through `launch` (the project-script terminal path) and follows that
 * terminal read-only until the exit marker arrives, so the result outlives the panel.
 */
export async function startProblemsRun(input: {
  readonly threadRef: ScopedThreadRef;
  readonly command: string;
  readonly cwd: string | null;
  readonly launch: (command: string) => Promise<string | null>;
}): Promise<void> {
  const key = scopedThreadKey(input.threadRef);
  stopWatching(key);
  const starting: ProblemsRun = { status: "running", command: input.command, terminalId: null };
  setRun(key, starting);
  const terminalId = await input.launch(input.command);
  // Cancelled or replaced while the terminal was opening.
  if (useProblemsRunStore.getState().runByThreadKey[key] !== starting) return;
  if (terminalId === null) {
    setRun(key, {
      status: "failed",
      command: input.command,
      terminalId: null,
      error: "The check could not start in a terminal.",
    });
    return;
  }
  setRun(key, { status: "running", command: input.command, terminalId });

  let cursor = INITIAL_TERMINAL_OUTPUT_CURSOR;
  let text = "";
  const finish = (run: ProblemsRun) => {
    stopWatching(key);
    setRun(key, run);
  };
  const onBuffer = (buffer: TerminalBufferState) => {
    const update = readTerminalOutputUpdate(buffer.output, cursor);
    cursor = update.cursor;
    if (update.type === "reset") text = update.data;
    else if (update.type === "append") text += update.data;
    const unread = update.type === "none" ? "" : text.slice(-(update.data.length + 64));
    if (hasProblemsExitMarker(unread)) {
      const result = readProblemsRunOutput(text);
      if (result) {
        finish({
          status: "finished",
          command: input.command,
          terminalId,
          exitCode: result.exitCode,
          problems: parseProblems(result.output, { cwd: input.cwd }),
        });
        return;
      }
    }
    if (buffer.status === "exited" || buffer.status === "error") {
      finish({
        status: "failed",
        command: input.command,
        terminalId,
        error: buffer.error ?? "The terminal stopped before the check finished.",
      });
    }
  };

  let settled = false;
  const unsubscribe = appAtomRegistry.subscribe(
    terminalEnvironment.observe({
      environmentId: input.threadRef.environmentId,
      input: { threadId: input.threadRef.threadId, terminalId },
    }),
    (result) => {
      if (settled) return;
      if (AsyncResult.isSuccess(result)) onBuffer(result.value);
      else if (AsyncResult.isFailure(result)) {
        finish({
          status: "failed",
          command: input.command,
          terminalId,
          error: formatEnvironmentQueryError(result.cause),
        });
      }
    },
    { immediate: true },
  );
  watchers.set(key, () => {
    settled = true;
    unsubscribe();
  });
  // The immediate callback may have finished before the watcher was registered.
  if (useProblemsRunStore.getState().runByThreadKey[key]?.status !== "running") stopWatching(key);
}

export function cancelProblemsRun(threadRef: ScopedThreadRef) {
  const key = scopedThreadKey(threadRef);
  const run = useProblemsRunStore.getState().runByThreadKey[key];
  stopWatching(key);
  if (run?.status === "running") {
    setRun(key, {
      status: "failed",
      command: run.command,
      terminalId: run.terminalId,
      error: "Stopped waiting for the check. It may still be running in its terminal.",
    });
  }
}
