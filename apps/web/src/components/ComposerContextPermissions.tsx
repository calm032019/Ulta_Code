import type { RuntimeMode } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";

import { shortcutLabelForCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import { ComposerControl } from "./chat/ComposerControl";
import { ComposerPermissionsSection } from "./chat/ComposerFooterControls";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { runtimeModeConfig, runtimeModeToneClassName } from "./chat/runtimeModeConfig";
import { cn } from "~/lib/utils";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** The new-thread strip names the permissions the first send will use; clicking opens just them. */
export function ComposerContextPermissions(props: {
  runtimeMode: RuntimeMode;
  runtimeModes: ReadonlyArray<RuntimeMode>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const shortcutLabel = shortcutLabelForCommand(
    useAtomValue(primaryServerKeybindingsAtom),
    "composer.mode",
  );
  const menuProps = useComposerMenuProps();
  const { icon: Icon, label } = runtimeModeConfig[props.runtimeMode];
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  size="xs"
                  className={cn(
                    "ms-auto min-w-0 shrink-0",
                    runtimeModeToneClassName[props.runtimeMode],
                  )}
                  aria-label={`Permissions: ${label}`}
                  data-composer-context-control
                />
              }
            />
          }
        >
          <Icon aria-hidden="true" className="size-3" />
          <ComposerContextLabel>{label}</ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup>Permissions{shortcutLabel ? ` · ${shortcutLabel}` : null}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" {...menuProps}>
        <ComposerPermissionsSection
          runtimeMode={props.runtimeMode}
          runtimeModeOptions={props.runtimeModes.map((mode) => ({
            mode,
            ...runtimeModeConfig[mode],
          }))}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />
      </MenuPopup>
    </Menu>
  );
}
