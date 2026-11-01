import type { ScopedProjectRef } from "@t3tools/contracts";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { useComposerDraftStore } from "../composerDraftStore";
import type { NewThreadHandler } from "../hooks/useHandleNewThread";
import {
  buildFindInCodebasePrompt,
  FIND_IN_CODEBASE_PROMPT_PREFIX,
} from "../lib/findInCodebasePrompt";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Request = {
  readonly projectTitle: string;
  readonly resolve: (question: string | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function requestFindInCodebaseQuestion(projectTitle: string): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { projectTitle, resolve } }));
}

function finish(question: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(question);
}

/**
 * Opens a new draft in `projectRef` holding the search prompt, in Plan mode with
 * Supervised permissions. The composer narrows both to what the chosen provider
 * supports: Plan falls back to Build, Supervised to the provider's most restrictive mode.
 */
export async function startFindInCodebaseThread(
  handleNewThread: NewThreadHandler,
  projectRef: ScopedProjectRef,
  question: string,
): Promise<void> {
  const prompt = buildFindInCodebasePrompt(question);
  const opened = await handleNewThread(projectRef, { prompt });
  if (!opened) return;
  const store = useComposerDraftStore.getState();
  // A draft the user had already written in keeps its text and modes.
  if (!store.getComposerDraft(opened.draftId)?.prompt.startsWith(FIND_IN_CODEBASE_PROMPT_PREFIX)) {
    return;
  }
  store.setInteractionMode(opened.draftId, "plan");
  store.setRuntimeMode(opened.draftId, "approval-required");
}

export function FindInCodebaseDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves a pending request with null when the host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <FindInCodebaseDialog projectTitle={request.projectTitle} /> : null;
}

function FindInCodebaseDialog({ projectTitle }: { readonly projectTitle: string }) {
  const id = useId();
  const [question, setQuestion] = useState("");
  const trimmed = question.trim();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length > 0) finish(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>Find in codebase</DialogTitle>
            <DialogDescription>
              Ask the agent where something lives in {projectTitle}. It opens a new thread in Plan
              mode with Supervised permissions, so the agent asks before any command or edit.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-question`}>
              Question
              <Input
                nativeInput
                autoFocus
                id={`${id}-question`}
                placeholder="Where do we handle refunds?"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </Label>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed.length === 0}>
              Open thread
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
