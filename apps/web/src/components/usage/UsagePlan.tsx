import {
  MAX_USAGE_PLAN_APPROACHING_PERCENT,
  type UsagePlanResetSchedule,
  type UsagePlanWindowSettings,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UsagePlanBudget, UsagePlanDay } from "@t3tools/shared/usagePlan";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import {
  usePrimarySettings,
  usePrimarySettingsAvailable,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { appLocale, formatUpcomingTimestamp, resolveHour12 } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useUsagePlanBaselineStore } from "./usagePlanStore";
import {
  defaultUsagePlan,
  deviceTimeZone,
  evaluateUsagePlans,
  formatPlanPercent,
  type PlannedWindowView,
  usagePlanSummary,
} from "./usagePlanView";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const APPROACHING_OPTIONS = [50, 60, 70, 80, 90].filter(
  (value) => value <= MAX_USAGE_PLAN_APPROACHING_PERCENT,
);

function formatMinuteOfDay(minuteOfDay: number, hour12: boolean): string {
  return new Intl.DateTimeFormat(appLocale, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: "UTC",
  }).format(Date.UTC(1970, 0, 1, 0, minuteOfDay));
}

function scheduleLabel(schedule: UsagePlanResetSchedule, hour12: boolean): string {
  const time = formatMinuteOfDay(schedule.minuteOfDay, hour12);
  if (schedule.kind === "weekly") return `every ${WEEKDAY_NAMES[schedule.weekday]} at ${time}`;
  return schedule.day === "last"
    ? `on the last day of each month at ${time}`
    : `on day ${schedule.day} of each month at ${time}`;
}

function scheduleKind(view: PlannedWindowView): UsagePlanResetSchedule["kind"] {
  if (view.plannable.window.kind === "monthly") return "monthly";
  if (view.plannable.window.kind === "weekly") return "weekly";
  return (view.plannable.windowDurationMins ?? 0) >= 28 * 24 * 60 ? "monthly" : "weekly";
}

/** The plan section on the Usage page's Limits view. `now` advances only on refresh. */
export function UsagePlanSection({
  hiddenDrivers,
  now,
  focusRequested,
}: {
  readonly hiddenDrivers: ReadonlySet<ServerProvider["driver"]>;
  readonly now: number;
  readonly focusRequested: boolean;
}) {
  const usagePlan = usePrimarySettings((settings) => settings.usagePlan);
  const available = usePrimarySettingsAvailable();
  const updateSettings = useUpdatePrimarySettings();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const records = useUsagePlanBaselineStore((state) => state.windows);
  const sectionRef = useRef<HTMLElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the DOM to the plan when the command palette asks for it
  useEffect(() => {
    if (focusRequested) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [focusRequested]);

  const views = evaluateUsagePlans(presentations, usagePlan, records, now).filter(
    (view) => !hiddenDrivers.has(view.plannable.driver),
  );
  const savePlan = (key: string, plan: UsagePlanWindowSettings | null) =>
    updateSettings({ usagePlan: { windows: { [key]: plan } } });

  return (
    <section ref={sectionRef} aria-labelledby="usage-plan-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="usage-plan-heading" className="text-sm font-medium text-foreground">
            Plan
          </h2>
          <p className="text-xs text-muted-foreground">
            Spread a weekly or monthly limit over the days you work and get a budget for each day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Label>
            <Switch
              size="sm"
              checked={usagePlan.remindersEnabled}
              disabled={!available}
              onCheckedChange={(checked) =>
                updateSettings({ usagePlan: { remindersEnabled: checked } })
              }
            />
            Daily budget reminders
          </Label>
          <Select
            value={String(usagePlan.approachingPercent)}
            disabled={!available || !usagePlan.remindersEnabled}
            onValueChange={(value) =>
              updateSettings({ usagePlan: { approachingPercent: Number(value) } })
            }
          >
            <SelectTrigger aria-label="Warn when today's budget is this full" size="xs">
              <SelectValue>{`Warn at ${usagePlan.approachingPercent}%`}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {APPROACHING_OPTIONS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {`Warn at ${value}%`}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>
      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">No weekly or monthly limits to plan yet.</p>
      ) : (
        views.map((view) => (
          <PlanWindowCard
            key={view.plannable.key}
            view={view}
            now={now}
            editable={available}
            onSave={(plan) => savePlan(view.plannable.key, plan)}
          />
        ))
      )}
    </section>
  );
}

function PlanWindowCard({
  view,
  now,
  editable,
  onSave,
}: {
  readonly view: PlannedWindowView;
  readonly now: number;
  readonly editable: boolean;
  readonly onSave: (plan: UsagePlanWindowSettings | null) => void;
}) {
  const { plannable, plan, budget, providerLabel, windowLabel } = view;
  const [editingReset, setEditingReset] = useState(false);
  const title = `${providerLabel} · ${windowLabel}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderInstanceIcon
          driverKind={plannable.driver}
          displayName={providerLabel}
          indicatorBackground="var(--background)"
          className="size-5"
          iconClassName="size-4 text-foreground/80"
        />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatPlanPercent(100 - plannable.usedPercent)} left
        </span>
        <Button
          size="xs"
          variant={plan ? "ghost" : "outline"}
          className="ms-auto"
          disabled={!editable}
          onClick={() => onSave(plan ? null : defaultUsagePlan())}
        >
          {plan ? "Stop planning" : "Plan this window"}
        </Button>
      </div>
      {plan ? (
        <>
          <ResetRow
            view={view}
            plan={plan}
            now={now}
            editable={editable}
            onEdit={() => setEditingReset(true)}
            onUseReported={() => onSave({ timeZone: plan.timeZone, workingDays: plan.workingDays })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-xs text-muted-foreground">Working days</span>
            <ToggleGroup
              multiple
              variant="outline"
              size="xs"
              aria-label={`Working days for ${title}`}
              disabled={!editable}
              value={plan.workingDays.map(String)}
              onValueChange={(values) => {
                if (values.length === 0) return;
                onSave({
                  ...plan,
                  workingDays: values.map(Number).sort((left, right) => left - right),
                });
              }}
            >
              {WEEKDAY_ORDER.map((day) => (
                <Toggle key={day} value={String(day)} aria-label={WEEKDAY_NAMES[day]}>
                  {WEEKDAY_NAMES[day].slice(0, 2)}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          {budget ? (
            <>
              <TodayBudget budget={budget} />
              <PlanStrip days={budget.days} todayState={budget.state} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Set a reset time to get a daily budget.</p>
          )}
          <ResetDialog
            open={editingReset}
            onOpenChange={setEditingReset}
            kind={scheduleKind(view)}
            initial={plan.reset ?? derivedSchedule(scheduleKind(view), plannable.reportedResetAt)}
            onSave={(reset) => {
              setEditingReset(false);
              onSave({ ...plan, reset, timeZone: deviceTimeZone() });
            }}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Plan this window to get a daily budget and gentle reminders.
        </p>
      )}
    </div>
  );
}

function ResetRow({
  view,
  plan,
  now,
  editable,
  onEdit,
  onUseReported,
}: {
  readonly view: PlannedWindowView;
  readonly plan: UsagePlanWindowSettings;
  readonly now: number;
  readonly editable: boolean;
  readonly onEdit: () => void;
  readonly onUseReported: () => void;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const hour12 = resolveHour12(timestampFormat);
  const reset = view.budget?.reset ?? null;
  const next = reset
    ? formatUpcomingTimestamp(new Date(reset.at).toISOString(), timestampFormat, now)
    : null;
  const reported = view.plannable.reportedResetAt !== null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="w-24 text-muted-foreground">Resets</span>
      <span className="min-w-0 text-foreground">
        {plan.reset
          ? `${scheduleLabel(plan.reset, hour12)} (${plan.timeZone})`
          : next
            ? next
            : "Not reported"}
        {plan.reset && next ? (
          <span className="text-muted-foreground">{` · next ${next}`}</span>
        ) : null}
        {!plan.reset && reset ? (
          <span className="text-muted-foreground">{` · Reported by ${view.providerLabel}`}</span>
        ) : null}
      </span>
      <span className="ms-auto flex gap-1">
        {plan.reset && reported ? (
          <Button size="xs" variant="ghost" disabled={!editable} onClick={onUseReported}>
            Use reported time
          </Button>
        ) : null}
        <Button size="xs" variant="outline" disabled={!editable} onClick={onEdit}>
          {plan.reset ? "Change" : reported ? "Override" : "Set reset time"}
        </Button>
      </span>
    </div>
  );
}

const STATE_BAR: Record<UsagePlanBudget["state"], string> = {
  ok: "bg-success/80",
  approaching: "bg-warning/80",
  over: "bg-destructive",
  rest: "bg-muted-foreground/40",
  exhausted: "bg-muted-foreground/40",
};

function TodayBudget({ budget }: { readonly budget: UsagePlanBudget }) {
  const filled =
    budget.budget > 0 ? Math.min(100, budget.share * 100) : budget.usedToday > 0 ? 100 : 0;
  const summary = usagePlanSummary(budget);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
        <span className="text-foreground tabular-nums">{summary}</span>
        <span className="text-muted-foreground tabular-nums">
          {budget.workingDaysLeft === 1
            ? "1 working day left"
            : `${budget.workingDaysLeft} working days left`}
        </span>
      </div>
      <div
        role="meter"
        aria-label={summary}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(filled)}
        className="relative h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", STATE_BAR[budget.state])}
          style={{ width: `${filled}%` }}
        />
      </div>
    </div>
  );
}

function dayLabel(day: UsagePlanDay): string {
  const date = new Date(`${day.day}T00:00:00Z`);
  const name = new Intl.DateTimeFormat(appLocale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const parts = [
    day.planned !== null ? `${formatPlanPercent(day.planned)} planned` : null,
    day.actual !== null ? `${formatPlanPercent(day.actual)} used` : null,
    !day.working ? "rest day" : null,
  ].filter(Boolean);
  return `${name}${day.when === "today" ? " (today)" : ""}: ${parts.join(", ") || "no reading"}`;
}

const LABELLED_DAY_LIMIT = 10;

function dayAxisLabel(day: UsagePlanDay, index: number, total: number): string | null {
  const date = new Date(`${day.day}T00:00:00Z`);
  if (total <= LABELLED_DAY_LIMIT) {
    return new Intl.DateTimeFormat(appLocale, { weekday: "short", timeZone: "UTC" }).format(date);
  }
  return index % 7 === 0
    ? new Intl.DateTimeFormat(appLocale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(date)
    : null;
}

function PlanStrip({
  days,
  todayState,
}: {
  readonly days: readonly UsagePlanDay[];
  readonly todayState: UsagePlanBudget["state"];
}) {
  const scale = Math.max(1, ...days.map((day) => Math.max(day.planned ?? 0, day.actual ?? 0)));
  return (
    <div className="flex flex-col gap-1">
      <div role="list" aria-label="Days in this window" className="flex items-start gap-0.5">
        {days.map((day, index) => {
          const label = dayLabel(day);
          const axisLabel = dayAxisLabel(day, index, days.length);
          const actual = day.actual ?? 0;
          const over = day.planned !== null && actual > day.planned + 0.05;
          return (
            <Tooltip key={day.day}>
              <TooltipTrigger
                render={
                  <div
                    role="listitem"
                    aria-label={label}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col gap-1",
                      !day.working && "opacity-50",
                    )}
                  />
                }
              >
                <div
                  className={cn(
                    "relative h-10 overflow-hidden rounded-sm bg-muted",
                    day.when === "today" && "ring-1 ring-foreground/60",
                  )}
                >
                  {day.planned ? (
                    <div
                      className={cn(
                        "absolute inset-x-0 bottom-0 border-t-2 border-dashed border-foreground/45",
                        day.when === "future" && "bg-success/15",
                      )}
                      style={{ height: `${(day.planned / scale) * 100}%` }}
                    />
                  ) : null}
                  {actual > 0 ? (
                    <div
                      className={cn(
                        "absolute inset-x-0 bottom-0",
                        over
                          ? "bg-destructive"
                          : day.when === "today"
                            ? STATE_BAR[todayState]
                            : "bg-foreground/60",
                      )}
                      style={{ height: `${(actual / scale) * 100}%` }}
                    />
                  ) : null}
                </div>
                <span
                  aria-hidden
                  className={cn(
                    "h-3 truncate text-center text-2xs leading-3 tabular-nums",
                    day.when === "today" ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {axisLabel}
                </span>
              </TooltipTrigger>
              <TooltipPopup side="top">{label}</TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
      <p className="text-2xs text-muted-foreground">
        Each bar is a day. The fill is what you used, as seen on this device, and the dashed line is
        the plan for today and the days ahead.
      </p>
    </div>
  );
}

function derivedSchedule(
  kind: UsagePlanResetSchedule["kind"],
  reportedResetAt: number | null,
): UsagePlanResetSchedule {
  if (reportedResetAt === null) {
    return kind === "weekly"
      ? { kind, weekday: 1, minuteOfDay: 9 * 60 }
      : { kind, day: 1, minuteOfDay: 0 };
  }
  const date = new Date(reportedResetAt);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  return kind === "weekly"
    ? { kind, weekday: date.getDay(), minuteOfDay }
    : { kind, day: Math.min(28, date.getDate()), minuteOfDay };
}

function ResetDialog({
  open,
  onOpenChange,
  kind,
  initial,
  onSave,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly kind: UsagePlanResetSchedule["kind"];
  readonly initial: UsagePlanResetSchedule;
  readonly onSave: (schedule: UsagePlanResetSchedule) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <ResetDialogPopup kind={kind} initial={initial} onSave={onSave} /> : null}
    </Dialog>
  );
}

function ResetDialogPopup({
  kind,
  initial,
  onSave,
}: {
  readonly kind: UsagePlanResetSchedule["kind"];
  readonly initial: UsagePlanResetSchedule;
  readonly onSave: (schedule: UsagePlanResetSchedule) => void;
}) {
  const [weekday, setWeekday] = useState(initial.kind === "weekly" ? initial.weekday : 1);
  const [day, setDay] = useState<number | "last">(initial.kind === "monthly" ? initial.day : 1);
  const [time, setTime] = useState(
    `${String(Math.floor(initial.minuteOfDay / 60)).padStart(2, "0")}:${String(initial.minuteOfDay % 60).padStart(2, "0")}`,
  );
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const minuteOfDay = match ? Number(match[1]) * 60 + Number(match[2]) : null;
  const valid = minuteOfDay !== null && minuteOfDay < 24 * 60;
  return (
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Set reset time</DialogTitle>
        <DialogDescription>
          {`When this limit refills, in your time zone (${deviceTimeZone()}). Other devices show the same moment.`}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-wrap items-end gap-3">
          {kind === "weekly" ? (
            <div className="flex flex-col gap-1.5">
              <Label id="usage-plan-reset-weekday">Day</Label>
              <Select value={String(weekday)} onValueChange={(value) => setWeekday(Number(value))}>
                <SelectTrigger aria-labelledby="usage-plan-reset-weekday" className="w-40">
                  <SelectValue>{WEEKDAY_NAMES[weekday]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {WEEKDAY_ORDER.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {WEEKDAY_NAMES[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label id="usage-plan-reset-day">Day of the month</Label>
              <Select
                value={String(day)}
                onValueChange={(value) => setDay(value === "last" ? "last" : Number(value))}
              >
                <SelectTrigger aria-labelledby="usage-plan-reset-day" className="w-40">
                  <SelectValue>{day === "last" ? "Last day" : String(day)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {Array.from({ length: 28 }, (_, index) => index + 1).map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {String(value)}
                    </SelectItem>
                  ))}
                  <SelectItem value="last">Last day</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="usage-plan-reset-time">Time</Label>
            <Input
              id="usage-plan-reset-time"
              type="time"
              nativeInput
              className="w-32"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button
          disabled={!valid}
          onClick={() => {
            if (minuteOfDay === null || !valid) return;
            onSave(kind === "weekly" ? { kind, weekday, minuteOfDay } : { kind, day, minuteOfDay });
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </DialogPopup>
  );
}

const STATE_TEXT: Record<UsagePlanBudget["state"], string> = {
  ok: "text-muted-foreground",
  approaching: "text-warning-foreground",
  over: "text-destructive-foreground",
  rest: "text-muted-foreground",
  exhausted: "text-muted-foreground",
};

/** Today's budget for the driver's planned windows, for the composer's usage limits panel. */
export function UsagePlanTodaySummary({
  driver,
  now,
}: {
  readonly driver: ServerProvider["driver"];
  readonly now: number;
}) {
  const usagePlan = usePrimarySettings((settings) => settings.usagePlan);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const records = useUsagePlanBaselineStore((state) => state.windows);
  const planned =
    Object.keys(usagePlan.windows).length === 0
      ? []
      : evaluateUsagePlans(presentations, usagePlan, records, now).filter(
          (view) => view.plannable.driver === driver,
        );
  return planned.map(({ plannable, windowLabel, budget }) =>
    budget ? (
      <span key={plannable.key} className={cn("text-xs", STATE_TEXT[budget.state])}>
        {`${windowLabel} plan · ${usagePlanSummary(budget)}`}
      </span>
    ) : null,
  );
}
