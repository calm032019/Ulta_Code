import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentRequestInvalidError,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { type ContinueOnMachineTarget, continueOnMachineTargets } from "../lib/continueOnMachine";
import { threadContextAttachment } from "../lib/threadContextAttachment";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProject, readProjects, readThreadShell } from "../state/entities";
import { orchestrationEnvironment } from "../state/orchestration";
import { environmentPresentations, environmentSummaries } from "../state/presentation";
import { readEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useNewThreadHandler } from "./useHandleNewThread";
import { getClientSettings } from "./useSettings";

const isEnvironmentRequestInvalidError = Schema.is(EnvironmentRequestInvalidError);

function machineLabel(environmentId: EnvironmentId): string {
  return (
    appAtomRegistry.get(environmentPresentations.presentationsAtom).get(environmentId)?.entry.target
      .label ?? "this machine"
  );
}

const canOperate = (environmentId: EnvironmentId) =>
  readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);

/** Starts a draft on another machine's copy of the project, carrying the thread's transcript. */
export function useContinueOnMachine() {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const loadThreadTranscript = useAtomCommand(orchestrationEnvironment.threadTranscript, {
    reportFailure: false,
  });

  const readTargets = (threadRef: ScopedThreadRef): ReadonlyArray<ContinueOnMachineTarget> => {
    const thread = readThreadShell(threadRef);
    const sourceProject = thread
      ? readProject(scopeProjectRef(threadRef.environmentId, thread.projectId))
      : null;
    if (!sourceProject) return [];
    return continueOnMachineTargets({
      sourceProject,
      projects: readProjects(),
      groupingSettings: selectProjectGroupingSettings(getClientSettings()),
      connectedEnvironmentIds: appAtomRegistry.get(
        environmentSummaries.connectedEnvironmentIdsAtom,
      ),
      canOperate,
      labelOf: machineLabel,
    });
  };

  const continueOn = async (threadRef: ScopedThreadRef, target: ContinueOnMachineTarget) => {
    const sourceLabel = machineLabel(threadRef.environmentId);
    const fail = (description: string) =>
      toastManager.add({
        type: "error",
        title: `Couldn't continue on ${target.label}`,
        description,
      });
    if (!canOperate(target.environmentId)) {
      fail(`This connection cannot start threads on ${target.label}.`);
      return;
    }
    const loadingToast = toastManager.add({
      type: "loading",
      title: `Bringing this thread to ${target.label}…`,
      timeout: 0,
      data: { hideCopyButton: true },
    });
    try {
      const transcript = await loadThreadTranscript({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (transcript._tag !== "Success") {
        const error = squashAtomCommandFailure(transcript);
        fail(
          isEnvironmentRequestInvalidError(error) && error.reason === "thread_transcript_too_large"
            ? "This thread is too long to carry over as an attachment."
            : `Check that ${sourceLabel} is connected, then try again.`,
        );
        return;
      }
      const file = threadContextAttachment(threadRef.environmentId, transcript.value);
      const opened = await settlePromise(() =>
        handleNewThread(scopeProjectRef(target.environmentId, target.projectId), {
          prompt: `Continue the work from this thread on ${sourceLabel}. `,
        }),
      );
      if (opened._tag === "Failure") {
        const error = squashAtomCommandFailure(opened);
        fail(error instanceof Error ? error.message : "The new thread could not be opened.");
        return;
      }
      if (opened.value === null) return;
      const attached = useComposerDraftStore.getState().addFiles(
        opened.value.draftId,
        [
          {
            type: "file",
            id: randomUUID(),
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            file,
          },
        ],
        { appendReference: true },
      );
      if (attached.length === 0) {
        fail("The draft there has no room for another attachment.");
        return;
      }
      toastManager.add({
        type: "success",
        title: `Continuing on ${target.label}`,
        description: `The transcript is attached to this draft and the original thread is unchanged. Your uncommitted changes stay on ${sourceLabel}.`,
        actionProps: {
          children: "Open original",
          onClick: () => {
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(threadRef),
            });
          },
        },
      });
    } finally {
      toastManager.close(loadingToast);
    }
  };

  return { readTargets, continueOn };
}
