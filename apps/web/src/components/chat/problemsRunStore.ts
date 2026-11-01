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
  isFishStatusError,
  parseProblems,
  problemsTerminalCommand,
  readProblemsRunOutput,
  type Problem,
  type ProblemsShell,
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

type ProblemsLaunch = (
  terminalInput: string,
  replaceTerminalId: string | null,
) => Promise<string | null>;

/**
 * Runs a check through `launch` (the project-script terminal path) and follows that
 * terminal read-only until the exit marker arrives, so the result outlives the panel.
 * The previous run's terminal is replaced so repeated checks do not pile up shells.
 */
export async function startProblemsRun(input: {
  readonly threadRef: ScopedThreadRef;
  readonly command: string;
  readonly cwd: string | null;
  readonly launch: ProblemsLaunch;
}): Promise<void> {
  const key = scopedThreadKey(input.threadRef);
  const previousTerminalId = useProblemsRunStore.getState().runByThreadKey[key]?.terminalId ?? null;
  stopWatching(key);
  await followProblemsRun(input, key, "posix", previousTerminalId);
}

async function followProblemsRun(
  input: Parameters<typeof startProblemsRun>[0],
  key: string,
  shell: ProblemsShell,
  replaceTerminalId: string | null,
): Promise<void> {
  const starting: ProblemsRun = { status: "running", command: input.command, terminalId: null };
  setRun(key, starting);
  const terminalId = await input.launch(
    problemsTerminalCommand(input.command, shell),
    replaceTerminalId,
  );
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
  let done = false;
  let unsubscribe: (() => void) | undefined;
  const stop = () => {
    done = true;
    unsubscribe?.();
    if (watchers.get(key) === stop) watchers.delete(key);
  };
  watchers.set(key, stop);
  const finish = (run: ProblemsRun) => {
    stop();
    setRun(key, run);
  };
  const onBuffer = (buffer: TerminalBufferState) => {
    const update = readTerminalOutputUpdate(buffer.output, cursor);
    cursor = update.cursor;
    if (update.type === "reset") text = update.data;
    else if (update.type === "append") text += update.data;
    const unread = update.type === "none" ? "" : text.slice(-(update.data.length + 64));
    if (shell === "posix" && isFishStatusError(unread)) {
      stop();
      void followProblemsRun(input, key, "fish", terminalId);
      return;
    }
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

  const subscription = appAtomRegistry.subscribe(
    terminalEnvironment.observe({
      environmentId: input.threadRef.environmentId,
      input: { threadId: input.threadRef.threadId, terminalId },
    }),
    (result) => {
      if (done) return;
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
  unsubscribe = subscription;
  // The immediate callback may already have finished the run.
  if (done) subscription();
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
