import type { UsagePlanSettings, UsagePlanWindowSettings } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";
import {
  computeUsagePlanBudget,
  dayKey,
  DEFAULT_USAGE_PLAN_WORKING_DAYS,
  localDate,
  plannableWindows,
  type PlannableWindow,
  type UsagePlanBudget,
  type UsagePlanWindowRecord,
} from "@t3tools/shared/usagePlan";

import { providerClients } from "../settings/providerDriverMeta";

export interface PlannedWindowView {
  readonly plannable: PlannableWindow;
  readonly providerLabel: string;
  readonly windowLabel: string;
  readonly plan: UsagePlanWindowSettings | undefined;
  readonly budget: UsagePlanBudget | null;
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function defaultUsagePlan(): UsagePlanWindowSettings {
  return { timeZone: deviceTimeZone(), workingDays: DEFAULT_USAGE_PLAN_WORKING_DAYS };
}

export function usagePlanToday(plan: UsagePlanWindowSettings, now: number): string {
  return dayKey(localDate(now, plan.timeZone));
}

export function evaluateUsagePlans(
  presentations: LimitPresentations,
  settings: UsagePlanSettings,
  records: Readonly<Record<string, UsagePlanWindowRecord>>,
  now: number,
): readonly PlannedWindowView[] {
  return plannableWindows(collectLimitPools(collectLimitAccounts(presentations), now)).map(
    (plannable) => {
      const plan = settings.windows[plannable.key];
      const record = records[plannable.key];
      const today = plan ? usagePlanToday(plan, now) : null;
      return {
        plannable,
        providerLabel: providerClients.get(plannable.driver)?.label ?? String(plannable.driver),
        windowLabel:
          (plannable.driver === "cursor"
            ? cursorUsageWindowDetails(plannable.window.id)?.label
            : undefined) ?? plannable.window.label,
        plan,
        budget:
          plan && today
            ? computeUsagePlanBudget({
                usedPercent: plannable.usedPercent,
                reportedResetAt: plannable.reportedResetAt,
                windowDurationMins: plannable.windowDurationMins,
                plan,
                baseline: record?.days[today]?.start ?? null,
                history: record?.days,
                approachingShare: settings.approachingPercent / 100,
                now,
              })
            : null,
      };
    },
  );
}

/** Small budgets need a decimal to stay readable; larger ones round. */
export function formatPlanPercent(value: number): string {
  const clamped = Math.max(0, value);
  return clamped < 10 ? `${Number(clamped.toFixed(1))}%` : `${Math.round(clamped)}%`;
}

export function usagePlanSummary(budget: UsagePlanBudget): string {
  switch (budget.state) {
    case "rest":
      return "Rest day. Nothing is planned for today.";
    case "exhausted":
      return "Nothing left until the reset.";
    default:
      return `Today: ${formatPlanPercent(budget.usedToday)} of your ${formatPlanPercent(budget.budget)} budget used`;
  }
}
