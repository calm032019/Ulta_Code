import type { RuntimeMode } from "@t3tools/contracts";
import { type LucideIcon, LockIcon, PenLineIcon, ShieldOffIcon, SparklesIcon } from "lucide-react";

/** Tints a permissions control by risk, so the mode reads at a glance: green asks, red never asks. */
export const runtimeModeToneClassName: Record<RuntimeMode, string> = {
  "approval-required":
    "bg-success/10 text-success-foreground hover:bg-success/16 hover:text-success-foreground dark:text-success-foreground",
  "auto-accept-edits":
    "bg-info/10 text-info-foreground hover:bg-info/16 hover:text-info-foreground dark:text-info-foreground",
  auto: "bg-warning/10 text-warning-foreground hover:bg-warning/16 hover:text-warning-foreground dark:text-warning-foreground",
  "full-access":
    "bg-error/10 text-error-foreground hover:bg-error/16 hover:text-error-foreground dark:text-error-foreground",
};

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    // An open lock reads like a closed one at small sizes; a crossed shield does not.
    icon: ShieldOffIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

/** The modes a provider supports (all when it reports none) and the mode a thread really runs in. */
export function resolveCompatibleRuntimeMode(
  runtimeMode: RuntimeMode,
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined,
) {
  const modes =
    supportedRuntimeModes && supportedRuntimeModes.length > 0
      ? runtimeModeOptions.filter((mode) => supportedRuntimeModes.includes(mode))
      : runtimeModeOptions;
  return { modes, mode: modes.includes(runtimeMode) ? runtimeMode : (modes[0] ?? runtimeMode) };
}
