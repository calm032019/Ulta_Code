import type {
  ProviderInstanceId,
  ServerProvider,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { collectProviderUsageLimits, remainingPercent } from "@t3tools/shared/usageLimits";
import { GaugeIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { LimitWindows } from "../usage/UsageLimits";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";

/** Usage left on the selected provider instance's own account, beside the model picker. */
export function ComposerUsageIndicator(props: {
  readonly instanceId: ProviderInstanceId;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly onOpen: () => void;
}) {
  // Only reset countdowns read the clock; refreshed each time the tooltip opens.
  const [now, setNow] = useState(Date.now);
  const report = collectProviderUsageLimits(props.instanceId, props.providers, props.sources, now);
  // The report spans every account of this driver; prefer the one this instance signs in with.
  const account =
    report?.accounts.find((candidate) => candidate.instanceId === props.instanceId) ??
    report?.accounts.find((candidate) => candidate.limits.windows.length > 0);
  const windows = account?.limits.windows ?? [];
  if (!account || windows.length === 0) return null;
  const left = Math.min(...windows.map(remainingPercent));
  return (
    <Tooltip onOpenChange={(open) => open && setNow(Date.now())}>
      <TooltipTrigger
        render={
          <ComposerControl
            data-composer-usage-indicator
            onClick={props.onOpen}
            aria-label={`Usage limits: ${left}% left`}
            className={cn(
              "min-w-0 tabular-nums",
              left <= 10 ? "text-destructive" : left <= 25 ? "text-warning" : null,
            )}
          />
        }
      >
        <ComposerControlIcon icon={GaugeIcon} size="sm" className="text-current" />
        <span data-composer-control-label>{left}% left</span>
      </TooltipTrigger>
      <TooltipPopup side="top" className="w-80">
        <LimitWindows
          compact
          driver={account.driver}
          accentColor={account.accentColor}
          windows={windows}
          now={now}
        />
      </TooltipPopup>
    </Tooltip>
  );
}
