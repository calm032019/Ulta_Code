import type { EnvironmentId, UsagePlanSettings } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";
import {
  computeUsagePlanBudget,
  dayKey,
  dueUsagePlanAlert,
  effectiveUsagePlanReset,
  localDate,
  plannableWindows,
} from "@t3tools/shared/usagePlan";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { providerClients } from "../settings/providerDriverMeta";
import { toastManager } from "../ui/toast";
import { recordUsagePlanAlert, recordUsagePlanReading } from "./usagePlanStore";
import { formatPlanPercent, usagePlanToday } from "./usagePlanView";

function observeUsagePlans(
  environmentId: EnvironmentId,
  presentations: LimitPresentations,
  usagePlan: UsagePlanSettings,
  now: number,
  onAlert: (alert: { title: string; description: string; over: boolean }) => void,
) {
  for (const plannable of plannableWindows(
    collectLimitPools(collectLimitAccounts(presentations), now),
  )) {
    const plan = usagePlan.windows[plannable.key];
    if (!plan) continue;
    const reset = effectiveUsagePlanReset({
      reportedResetAt: plannable.reportedResetAt,
      windowDurationMins: plannable.windowDurationMins,
      schedule: plan.reset,
      timeZone: plan.timeZone,
      now,
    });
    const day = usagePlanToday(plan, now);
    const record = recordUsagePlanReading(environmentId, plannable.key, {
      day,
      usedPercent: plannable.usedPercent,
      windowStartDay:
        reset?.startsAt != null ? dayKey(localDate(reset.startsAt, plan.timeZone)) : null,
    });
    if (!usagePlan.remindersEnabled) continue;
    const budget = computeUsagePlanBudget({
      usedPercent: plannable.usedPercent,
      reportedResetAt: plannable.reportedResetAt,
      windowDurationMins: plannable.windowDurationMins,
      plan,
      baseline: record.days[day]?.start ?? null,
      history: record.days,
      approachingShare: usagePlan.approachingPercent / 100,
      now,
    });
    const alert = budget ? dueUsagePlanAlert(budget.state, record, day) : null;
    if (!budget || !alert) continue;
    recordUsagePlanAlert(environmentId, plannable.key, day, alert);
    const name = `${providerClients.get(plannable.driver)?.label ?? plannable.driver} ${plannable.window.label.toLowerCase()}`;
    onAlert({
      over: alert === "over",
      title:
        alert === "over"
          ? `You're over today's ${name} budget`
          : `You've used ${usagePlan.approachingPercent}% of today's ${name} budget`,
      description: `${formatPlanPercent(budget.usedToday)} used of ${formatPlanPercent(budget.budget)} planned for today.`,
    });
  }
}

/** Reminders are evaluated only when limits arrive; nothing here runs on a timer. */
export function UsagePlanReminders() {
  const usagePlan = usePrimarySettings((settings) => settings.usagePlan);
  return Object.keys(usagePlan.windows).length > 0 ? (
    <ActiveUsagePlanReminders usagePlan={usagePlan} />
  ) : null;
}

function ActiveUsagePlanReminders({ usagePlan }: { readonly usagePlan: UsagePlanSettings }) {
  const environmentId = usePrimaryEnvironmentId();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const navigate = useNavigate();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records per-device baselines and raises toasts when new limit readings arrive
  useEffect(() => {
    if (!environmentId) return;
    observeUsagePlans(
      environmentId,
      presentations,
      usagePlan,
      Date.now(),
      ({ title, description, over }) => {
        const id = toastManager.add({
          type: over ? "warning" : "info",
          title,
          description,
          actionProps: {
            children: "View plan",
            onClick: () => {
              toastManager.close(id);
              void navigate({ to: "/usage", search: { section: "plan" } });
            },
          },
        });
      },
    );
  }, [environmentId, presentations, usagePlan, navigate]);
  return null;
}
