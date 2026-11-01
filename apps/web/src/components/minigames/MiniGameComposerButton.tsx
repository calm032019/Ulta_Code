import { Gamepad2Icon } from "lucide-react";

import { ComposerControl, ComposerControlIcon } from "../chat/ComposerControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const LABEL = "Play a game while you wait";

export function MiniGameComposerButton(props: { onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl data-minigame-open="true" aria-label={LABEL} onClick={props.onOpen} />
        }
      >
        <ComposerControlIcon icon={Gamepad2Icon} />
      </TooltipTrigger>
      <TooltipPopup side="top">{LABEL}</TooltipPopup>
    </Tooltip>
  );
}
