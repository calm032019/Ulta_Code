import { GitCommitHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { COMMIT_PROMPT } from "./commitPrompt";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";

export function CommitComposerButton(props: { onSend: (text: string) => Promise<void> }) {
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      await props.onSend(COMMIT_PROMPT);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not send the commit request",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setSending(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl aria-label="Commit" disabled={sending} onClick={() => void send()} />
        }
      >
        <ComposerControlIcon icon={GitCommitHorizontalIcon} />
        <span data-composer-control-label>Commit</span>
      </TooltipTrigger>
      <TooltipPopup side="top">Ask the agent to commit this session's work</TooltipPopup>
    </Tooltip>
  );
}
