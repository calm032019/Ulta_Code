import type {
  ServerProvider,
  UsagePlanResetSchedule,
  UsagePlanWindowSettings,
} from "@t3tools/contracts";

import * as DateTime from "effect/DateTime";

import type { LimitPool, LimitPoolWindow } from "./usageLimits.ts";

const MINUTE = 60_000;
const MAX_STRIP_DAYS = 35;

export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedFields(at: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    const options = {
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    } as const;
    try {
      formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
    } catch {
      // A zone saved on another device may be unknown here; UTC keeps the plan readable.
      formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    }
    formatters.set(timeZone, formatter);
  }
  const fields = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter.formatToParts(at)) {
    if (part.type in fields) fields[part.type as keyof typeof fields] = Number(part.value);
  }
  // Some engines print midnight as 24 even with h23.
  if (fields.hour === 24) fields.hour = 0;
  return fields;
}

function offsetAt(at: number, timeZone: string): number {
  const fields = zonedFields(at, timeZone);
  const wall = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  return wall - Math.floor(at / 1000) * 1000;
}

export function localDate(at: number, timeZone: string): CivilDate {
  const { year, month, day } = zonedFields(at, timeZone);
  return { year, month, day };
}

/** Times inside a spring-forward gap land after it; repeated autumn times take the later one. */
export function zonedTime(date: CivilDate, minuteOfDay: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  return second;
}

const utcParts = (at: number) => DateTime.toPartsUtc(DateTime.makeUnsafe(at));

function addDays(date: CivilDate, days: number): CivilDate {
  const { year, month, day } = utcParts(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year, month, day };
}

function weekdayOf(date: CivilDate): number {
  return utcParts(Date.UTC(date.year, date.month - 1, date.day)).weekDay;
}

export function dayKey(date: CivilDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return utcParts(Date.UTC(year, month, 0)).day;
}

function monthlyReset(
  schedule: Extract<UsagePlanResetSchedule, { kind: "monthly" }>,
  year: number,
  month: number,
  timeZone: string,
): number {
  const { year: y, month: m } = utcParts(Date.UTC(year, month - 1, 1));
  const day = schedule.day === "last" ? daysInMonth(y, m) : schedule.day;
  return zonedTime({ year: y, month: m, day }, schedule.minuteOfDay, timeZone);
}

export function nextScheduledReset(
  schedule: UsagePlanResetSchedule,
  timeZone: string,
  now: number,
): number {
  const today = localDate(now, timeZone);
  if (schedule.kind === "weekly") {
    for (let offset = 0; ; offset += 1) {
      const date = addDays(today, offset);
      if (weekdayOf(date) !== schedule.weekday) continue;
      const at = zonedTime(date, schedule.minuteOfDay, timeZone);
      if (at > now) return at;
    }
  }
  for (let offset = 0; ; offset += 1) {
    const at = monthlyReset(schedule, today.year, today.month + offset, timeZone);
    if (at > now) return at;
  }
}

function previousScheduledReset(
  schedule: UsagePlanResetSchedule,
  timeZone: string,
  reset: number,
): number {
  const date = localDate(reset, timeZone);
  return schedule.kind === "weekly"
    ? zonedTime(addDays(date, -7), schedule.minuteOfDay, timeZone)
    : monthlyReset(schedule, date.year, date.month - 1, timeZone);
}

export interface UsagePlanReset {
  readonly at: number;
  readonly startsAt: number | null;
  readonly source: "reported" | "configured";
}

/** A configured schedule wins; a stale reported reset rolls forward by the window length. */
export function effectiveUsagePlanReset(input: {
  readonly reportedResetAt: number | null;
  readonly windowDurationMins: number | undefined;
  readonly schedule: UsagePlanResetSchedule | undefined;
  readonly timeZone: string;
  readonly now: number;
}): UsagePlanReset | null {
  const { reportedResetAt, windowDurationMins, schedule, timeZone, now } = input;
  if (schedule) {
    const at = nextScheduledReset(schedule, timeZone, now);
    return { at, startsAt: previousScheduledReset(schedule, timeZone, at), source: "configured" };
  }
  if (reportedResetAt === null) return null;
  const length = windowDurationMins ? windowDurationMins * MINUTE : 0;
  if (reportedResetAt > now) {
    return {
      at: reportedResetAt,
      startsAt: length ? reportedResetAt - length : null,
      source: "reported",
    };
  }
  if (!length) return null;
  const at = reportedResetAt + Math.ceil((now - reportedResetAt + 1) / length) * length;
  return { at, startsAt: at - length, source: "reported" };
}

export type UsagePlanState = "ok" | "approaching" | "over" | "rest" | "exhausted";

export interface UsagePlanDayRecord {
  readonly start: number;
  readonly end: number;
}

export interface UsagePlanDay {
  readonly day: string;
  readonly weekday: number;
  readonly working: boolean;
  readonly when: "past" | "today" | "future";
  readonly planned: number | null;
  readonly actual: number | null;
}

export interface UsagePlanBudget {
  readonly reset: UsagePlanReset;
  readonly today: string;
  readonly workingDaysLeft: number;
  readonly remainingAtStartOfToday: number;
  readonly budget: number;
  readonly usedToday: number;
  readonly share: number;
  readonly state: UsagePlanState;
  readonly days: readonly UsagePlanDay[];
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Today's budget splits what was left at the start of today evenly over the working days left
 * before the reset, today included. With no working day left, all of it is today's.
 */
export function computeUsagePlanBudget(input: {
  readonly usedPercent: number;
  readonly reportedResetAt: number | null;
  readonly windowDurationMins: number | undefined;
  readonly plan: UsagePlanWindowSettings;
  readonly baseline: number | null;
  readonly history?: Readonly<Record<string, UsagePlanDayRecord>> | undefined;
  readonly approachingShare: number;
  readonly now: number;
}): UsagePlanBudget | null {
  const { plan, now } = input;
  const reset = effectiveUsagePlanReset({
    reportedResetAt: input.reportedResetAt,
    windowDurationMins: input.windowDurationMins,
    schedule: plan.reset,
    timeZone: plan.timeZone,
    now,
  });
  if (!reset) return null;
  const working = new Set(plan.workingDays);
  const used = clampPercent(input.usedPercent);
  const baseline =
    input.baseline === null || input.baseline > used ? used : clampPercent(input.baseline);
  const today = localDate(now, plan.timeZone);
  const todayKey = dayKey(today);
  const lastDay = dayKey(localDate(reset.at - 1, plan.timeZone));
  const todayWorking = working.has(weekdayOf(today));

  let workingDaysLeft = 0;
  for (let offset = 0; offset < 62; offset += 1) {
    const date = addDays(today, offset);
    if (dayKey(date) > lastDay) break;
    if (working.has(weekdayOf(date))) workingDaysLeft += 1;
  }

  const remainingAtStartOfToday = 100 - baseline;
  const usedToday = used - baseline;
  const rest = !todayWorking && workingDaysLeft > 0;
  const budget = rest
    ? 0
    : workingDaysLeft > 0
      ? remainingAtStartOfToday / workingDaysLeft
      : remainingAtStartOfToday;
  const share = budget > 0 ? usedToday / budget : 0;
  const state: UsagePlanState =
    remainingAtStartOfToday <= 0
      ? "exhausted"
      : rest
        ? "rest"
        : share >= 1
          ? "over"
          : share >= input.approachingShare
            ? "approaching"
            : "ok";

  const futureWorkingDays = workingDaysLeft - (todayWorking ? 1 : 0);
  const afterToday = remainingAtStartOfToday - Math.max(usedToday, budget);
  const futureDaily = futureWorkingDays > 0 ? Math.max(0, afterToday) / futureWorkingDays : 0;
  const firstDay = reset.startsAt === null ? today : localDate(reset.startsAt, plan.timeZone);
  const earliest = addDays(today, -(MAX_STRIP_DAYS - 1));
  let cursor = dayKey(firstDay) < dayKey(earliest) ? earliest : firstDay;
  const days: UsagePlanDay[] = [];
  while (dayKey(cursor) <= lastDay && days.length < MAX_STRIP_DAYS * 2) {
    const key = dayKey(cursor);
    const weekday = weekdayOf(cursor);
    const isWorking = working.has(weekday);
    const record = input.history?.[key];
    days.push(
      key < todayKey
        ? {
            day: key,
            weekday,
            working: isWorking,
            when: "past",
            planned: null,
            actual: record ? Math.max(0, record.end - record.start) : null,
          }
        : key === todayKey
          ? {
              day: key,
              weekday,
              working: isWorking,
              when: "today",
              planned: budget,
              actual: usedToday,
            }
          : {
              day: key,
              weekday,
              working: isWorking,
              when: "future",
              planned: isWorking ? futureDaily : 0,
              actual: null,
            },
    );
    cursor = addDays(cursor, 1);
  }

  return {
    reset,
    today: todayKey,
    workingDaysLeft,
    remainingAtStartOfToday,
    budget,
    usedToday,
    share,
    state,
    days,
  };
}

export type UsagePlanAlert = "approaching" | "over";

export interface UsagePlanWindowRecord {
  readonly days: Readonly<Record<string, UsagePlanDayRecord>>;
  readonly notifiedDay: string | null;
  readonly notified: readonly UsagePlanAlert[];
}

/**
 * The first reading of a local day is its baseline. A drop means the window reset, so the
 * reading becomes the new baseline and earlier days, which belong to the old window, go.
 */
export function observeUsagePlan(
  previous: UsagePlanWindowRecord | undefined,
  observation: {
    readonly day: string;
    readonly usedPercent: number;
    readonly windowStartDay: string | null;
  },
): UsagePlanWindowRecord {
  const { day, windowStartDay } = observation;
  const used = clampPercent(observation.usedPercent);
  const existing = previous?.days[day];
  const dropped = existing !== undefined && used < existing.end;
  if (previous && existing?.end === used && previous.notifiedDay === day) return previous;
  const kept = Object.entries(dropped ? {} : (previous?.days ?? {}))
    .filter(([key]) => key < day && (windowStartDay === null || key >= windowStartDay))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-(MAX_STRIP_DAYS - 1));
  const today =
    existing && !dropped ? { start: existing.start, end: used } : { start: used, end: used };
  return {
    days: Object.fromEntries([...kept, [day, today]]),
    notifiedDay: day,
    notified: previous?.notifiedDay === day ? previous.notified : [],
  };
}

/** At most one reminder per reading; over implies approaching so a later dip cannot re-fire it. */
export function dueUsagePlanAlert(
  state: UsagePlanState,
  record: UsagePlanWindowRecord,
  day: string,
): UsagePlanAlert | null {
  const notified = record.notifiedDay === day ? record.notified : [];
  if (notified.includes("over")) return null;
  if (state === "over") return "over";
  if (state === "approaching" && !notified.includes("approaching")) return "approaching";
  return null;
}

export function markUsagePlanAlert(
  record: UsagePlanWindowRecord,
  day: string,
  alert: UsagePlanAlert,
): UsagePlanWindowRecord {
  const notified = record.notifiedDay === day ? record.notified : [];
  const next: UsagePlanAlert[] = alert === "over" ? ["approaching", "over"] : ["approaching"];
  return {
    ...record,
    notifiedDay: day,
    notified: [...new Set([...notified, ...next])],
  };
}

function usagePlanKey(driver: ServerProvider["driver"], windowId: string): string {
  return `${driver}:${windowId}`;
}

export interface PlannableWindow {
  readonly key: string;
  readonly driver: ServerProvider["driver"];
  readonly window: LimitPoolWindow;
  readonly usedPercent: number;
  readonly reportedResetAt: number | null;
  readonly windowDurationMins: number | undefined;
}

/** Session windows are too short to plan by the day. */
export function plannableWindows(pools: readonly LimitPool[]): readonly PlannableWindow[] {
  return pools.flatMap((pool) =>
    pool.windows.flatMap((window) => {
      const windowDurationMins = window.members.find(
        (member) => member.window.windowDurationMins !== undefined,
      )?.window.windowDurationMins;
      const plannable =
        window.kind === "weekly" ||
        window.kind === "monthly" ||
        (window.kind === "other" && (windowDurationMins ?? 0) >= 24 * 60);
      if (!plannable || window.members.length === 0) return [];
      return [
        {
          key: usagePlanKey(pool.driver, window.id),
          driver: pool.driver,
          window,
          usedPercent:
            window.members.reduce((sum, member) => sum + member.window.usedPercent, 0) /
            window.members.length,
          reportedResetAt: window.resets[0]?.at ?? null,
          windowDurationMins,
        },
      ];
    }),
  );
}

export const DEFAULT_USAGE_PLAN_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];
