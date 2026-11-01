import type { UsagePlanWindowSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  computeUsagePlanBudget,
  dueUsagePlanAlert,
  effectiveUsagePlanReset,
  markUsagePlanAlert,
  nextScheduledReset,
  observeUsagePlan,
  type UsagePlanWindowRecord,
  zonedTime,
} from "./usagePlan.ts";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? ms : DateTime.formatIso(DateTime.makeUnsafe(ms));
const WEEK_MINS = 7 * 24 * 60;
const weekdays: UsagePlanWindowSettings = { timeZone: "UTC", workingDays: [1, 2, 3, 4, 5] };

describe("nextScheduledReset", () => {
  it.each([
    // Thursday 3 September 2026, London on BST.
    ["weekly in BST", "Europe/London", "2026-09-03T12:00:00Z", 1, 540, "2026-09-07T08:00:00.000Z"],
    [
      "weekly across the October change",
      "Europe/London",
      "2026-10-22T12:00:00Z",
      1,
      540,
      "2026-10-26T09:00:00.000Z",
    ],
    [
      "later the same day",
      "Europe/London",
      "2026-09-07T07:00:00Z",
      1,
      540,
      "2026-09-07T08:00:00.000Z",
    ],
    [
      "exactly at the reset",
      "Europe/London",
      "2026-09-07T08:00:00Z",
      1,
      540,
      "2026-09-14T08:00:00.000Z",
    ],
    ["Tokyo", "Asia/Tokyo", "2026-09-03T12:00:00Z", 1, 540, "2026-09-07T00:00:00.000Z"],
    [
      "Los Angeles",
      "America/Los_Angeles",
      "2026-09-03T12:00:00Z",
      1,
      540,
      "2026-09-07T16:00:00.000Z",
    ],
  ])("%s", (_name, timeZone, now, weekday, minuteOfDay, expected) => {
    expect(
      iso(nextScheduledReset({ kind: "weekly", weekday, minuteOfDay }, timeZone, at(now))),
    ).toBe(expected);
  });

  it.each([
    [
      "last day of February",
      "UTC",
      "2026-02-10T00:00:00Z",
      "last",
      1380,
      "2026-02-28T23:00:00.000Z",
    ],
    [
      "rolls into a 31-day month",
      "UTC",
      "2026-02-28T23:30:00Z",
      "last",
      1380,
      "2026-03-31T23:00:00.000Z",
    ],
    [
      "New York after DST ends",
      "America/New_York",
      "2026-10-20T00:00:00Z",
      15,
      540,
      "2026-11-15T14:00:00.000Z",
    ],
    [
      "New York in daylight time",
      "America/New_York",
      "2026-09-20T00:00:00Z",
      15,
      540,
      "2026-10-15T13:00:00.000Z",
    ],
    ["into next year", "UTC", "2026-12-20T00:00:00Z", 1, 0, "2027-01-01T00:00:00.000Z"],
  ] as const)("monthly %s", (_name, timeZone, now, day, minuteOfDay, expected) => {
    expect(iso(nextScheduledReset({ kind: "monthly", day, minuteOfDay }, timeZone, at(now)))).toBe(
      expected,
    );
  });

  it("reads an unknown time zone as UTC", () => {
    expect(
      iso(
        nextScheduledReset(
          { kind: "weekly", weekday: 1, minuteOfDay: 540 },
          "Not/AZone",
          at("2026-09-03T12:00:00Z"),
        ),
      ),
    ).toBe("2026-09-07T09:00:00.000Z");
  });

  it("moves a time in the spring-forward gap past it", () => {
    expect(iso(zonedTime({ year: 2026, month: 3, day: 29 }, 90, "Europe/London"))).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });
});

describe("effectiveUsagePlanReset", () => {
  const base = { schedule: undefined, timeZone: "UTC", now: at("2026-09-03T12:00:00Z") };

  it("rolls a passed reported reset forward by the window length", () => {
    const reset = effectiveUsagePlanReset({
      ...base,
      reportedResetAt: at("2026-08-31T00:00:00Z"),
      windowDurationMins: WEEK_MINS,
    });
    expect(iso(reset?.at)).toBe("2026-09-07T00:00:00.000Z");
    expect(iso(reset?.startsAt)).toBe("2026-08-31T00:00:00.000Z");
    expect(reset?.source).toBe("reported");
  });

  it("needs a reset time when a passed reset has no length", () => {
    expect(
      effectiveUsagePlanReset({
        ...base,
        reportedResetAt: at("2026-08-31T00:00:00Z"),
        windowDurationMins: undefined,
      }),
    ).toBeNull();
    expect(
      effectiveUsagePlanReset({ ...base, reportedResetAt: null, windowDurationMins: undefined }),
    ).toBeNull();
  });

  it("prefers a configured schedule over the reported reset", () => {
    const reset = effectiveUsagePlanReset({
      ...base,
      schedule: { kind: "weekly", weekday: 5, minuteOfDay: 0 },
      reportedResetAt: at("2026-09-07T00:00:00Z"),
      windowDurationMins: WEEK_MINS,
    });
    expect(iso(reset?.at)).toBe("2026-09-04T00:00:00.000Z");
    expect(iso(reset?.startsAt)).toBe("2026-08-28T00:00:00.000Z");
    expect(reset?.source).toBe("configured");
  });
});

describe("computeUsagePlanBudget", () => {
  // Thursday, with the window resetting at the start of Monday.
  const thursday = {
    usedPercent: 50,
    reportedResetAt: at("2026-09-07T00:00:00Z"),
    windowDurationMins: WEEK_MINS,
    plan: weekdays,
    baseline: 40,
    approachingShare: 0.8,
    now: at("2026-09-03T12:00:00Z"),
  };

  it("splits what was left this morning over the working days left", () => {
    const budget = computeUsagePlanBudget(thursday)!;
    expect(budget).toMatchObject({
      today: "2026-09-03",
      workingDaysLeft: 2,
      remainingAtStartOfToday: 60,
      budget: 30,
      usedToday: 10,
      state: "ok",
    });
    expect(budget.share).toBeCloseTo(1 / 3);
  });

  it.each([
    [65, "approaching"],
    [69, "approaching"],
    [70, "over"],
    [90, "over"],
  ] as const)("at %d%% used the state is %s", (usedPercent, state) => {
    expect(computeUsagePlanBudget({ ...thursday, usedPercent })?.state).toBe(state);
  });

  it("uses the first reading as the baseline when none is recorded", () => {
    expect(computeUsagePlanBudget({ ...thursday, baseline: null })).toMatchObject({
      budget: 25,
      usedToday: 0,
      state: "ok",
    });
  });

  it("starts again from the current reading after a mid-day reset", () => {
    expect(computeUsagePlanBudget({ ...thursday, baseline: 80, usedPercent: 5 })).toMatchObject({
      remainingAtStartOfToday: 95,
      budget: 47.5,
      usedToday: 0,
    });
  });

  it("gives a rest day no budget while working days remain", () => {
    expect(
      computeUsagePlanBudget({
        ...thursday,
        reportedResetAt: at("2026-09-09T00:00:00Z"),
        now: at("2026-09-05T12:00:00Z"),
      }),
    ).toMatchObject({ workingDaysLeft: 2, budget: 0, state: "rest" });
  });

  it("gives today everything left when no working day remains before the reset", () => {
    expect(computeUsagePlanBudget({ ...thursday, now: at("2026-09-05T12:00:00Z") })).toMatchObject({
      workingDaysLeft: 0,
      budget: 60,
      state: "ok",
    });
  });

  it("reports an exhausted window", () => {
    expect(computeUsagePlanBudget({ ...thursday, baseline: 100, usedPercent: 100 })).toMatchObject({
      budget: 0,
      state: "exhausted",
    });
  });

  it("rolls a passed reset forward and needs one when it cannot", () => {
    expect(
      computeUsagePlanBudget({ ...thursday, reportedResetAt: at("2026-08-31T00:00:00Z") })?.reset
        .at,
    ).toBe(at("2026-09-07T00:00:00Z"));
    expect(
      computeUsagePlanBudget({
        ...thursday,
        reportedResetAt: at("2026-08-31T00:00:00Z"),
        windowDurationMins: undefined,
      }),
    ).toBeNull();
  });

  it("plans the window's days with actuals, today's budget and the even split after it", () => {
    const budget = computeUsagePlanBudget({
      ...thursday,
      history: { "2026-09-02": { start: 30, end: 40 } },
    })!;
    expect(
      budget.days.map(({ day, when, working, planned, actual }) => [
        day,
        when,
        working,
        planned,
        actual,
      ]),
    ).toEqual([
      ["2026-08-31", "past", true, null, null],
      ["2026-09-01", "past", true, null, null],
      ["2026-09-02", "past", true, null, 10],
      ["2026-09-03", "today", true, 30, 10],
      ["2026-09-04", "future", true, 30, null],
      ["2026-09-05", "future", false, 0, null],
      ["2026-09-06", "future", false, 0, null],
    ]);
  });

  it("shrinks later days after an over-budget day", () => {
    const budget = computeUsagePlanBudget({ ...thursday, usedPercent: 85 })!;
    expect(budget.days.find((day) => day.day === "2026-09-04")?.planned).toBe(15);
  });

  it("counts the long autumn Sunday once in its own time zone", () => {
    const budget = computeUsagePlanBudget({
      ...thursday,
      reportedResetAt: null,
      windowDurationMins: undefined,
      plan: {
        timeZone: "Europe/London",
        workingDays: [0, 1, 2, 3, 4, 5, 6],
        reset: { kind: "weekly", weekday: 1, minuteOfDay: 0 },
      },
      baseline: 60,
      usedPercent: 60,
      now: at("2026-10-24T12:00:00Z"),
    })!;
    expect(iso(budget.reset.at)).toBe("2026-10-26T00:00:00.000Z");
    expect(budget.workingDaysLeft).toBe(2);
    expect(budget.budget).toBe(20);
    expect(budget.days.map((day) => day.day)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });

  it("plans a monthly window up to the end of a short month", () => {
    const budget = computeUsagePlanBudget({
      ...thursday,
      reportedResetAt: null,
      plan: { ...weekdays, reset: { kind: "monthly", day: "last", minuteOfDay: 0 } },
      now: at("2026-02-26T12:00:00Z"),
    })!;
    expect(iso(budget.reset.at)).toBe("2026-02-28T00:00:00.000Z");
    expect(budget.workingDaysLeft).toBe(2);
    expect(budget.days[0]?.day).toBe("2026-01-31");
    expect(budget.days.at(-1)?.day).toBe("2026-02-27");
  });

  it("reads today in the plan's time zone", () => {
    // 23:30 UTC on Thursday is already Friday in Tokyo, and the reset falls at 09:00 Monday there.
    const budget = computeUsagePlanBudget({
      ...thursday,
      plan: { ...weekdays, timeZone: "Asia/Tokyo" },
      now: at("2026-09-03T23:30:00Z"),
    })!;
    expect(budget.today).toBe("2026-09-04");
    expect(budget.workingDaysLeft).toBe(2);
  });
});

describe("observeUsagePlan", () => {
  const observe = (
    previous: UsagePlanWindowRecord | undefined,
    day: string,
    usedPercent: number,
    windowStartDay: string | null = null,
  ) => observeUsagePlan(previous, { day, usedPercent, windowStartDay });

  it("keeps the first reading of the day as its baseline", () => {
    const first = observe(undefined, "2026-09-03", 40);
    const later = observe(first, "2026-09-03", 47);
    expect(later.days).toEqual({ "2026-09-03": { start: 40, end: 47 } });
    expect(observe(later, "2026-09-03", 47)).toBe(later);
  });

  it("starts a new day from its own first reading", () => {
    const next = observe(observe(undefined, "2026-09-02", 30), "2026-09-03", 41);
    expect(next.days).toEqual({
      "2026-09-02": { start: 30, end: 30 },
      "2026-09-03": { start: 41, end: 41 },
    });
  });

  it("treats a drop as a reset and forgets the old window", () => {
    const before = observe(observe(undefined, "2026-09-02", 30), "2026-09-03", 60);
    expect(observe(before, "2026-09-03", 2).days).toEqual({
      "2026-09-03": { start: 2, end: 2 },
    });
  });

  it("prunes days before the window", () => {
    const before = observe(observe(undefined, "2026-08-30", 90), "2026-08-31", 5);
    expect(Object.keys(observe(before, "2026-09-01", 9, "2026-08-31").days)).toEqual([
      "2026-08-31",
      "2026-09-01",
    ]);
  });
});

describe("dueUsagePlanAlert", () => {
  const day = "2026-09-03";
  const fresh = observeUsagePlan(undefined, { day, usedPercent: 10, windowStartDay: null });

  it("fires each threshold once a day", () => {
    expect(dueUsagePlanAlert("ok", fresh, day)).toBeNull();
    expect(dueUsagePlanAlert("approaching", fresh, day)).toBe("approaching");
    const warned = markUsagePlanAlert(fresh, day, "approaching");
    expect(dueUsagePlanAlert("approaching", warned, day)).toBeNull();
    expect(dueUsagePlanAlert("over", warned, day)).toBe("over");
    const over = markUsagePlanAlert(warned, day, "over");
    expect(dueUsagePlanAlert("over", over, day)).toBeNull();
    expect(dueUsagePlanAlert("approaching", over, day)).toBeNull();
  });

  it("skips straight to over and does not warn about approaching after it", () => {
    expect(dueUsagePlanAlert("over", fresh, day)).toBe("over");
    expect(
      dueUsagePlanAlert("approaching", markUsagePlanAlert(fresh, day, "over"), day),
    ).toBeNull();
  });

  it("never fires on rest or exhausted days", () => {
    expect(dueUsagePlanAlert("rest", fresh, day)).toBeNull();
    expect(dueUsagePlanAlert("exhausted", fresh, day)).toBeNull();
  });

  it("forgets yesterday's reminders on a new day", () => {
    const yesterday = markUsagePlanAlert(fresh, day, "over");
    const today = observeUsagePlan(yesterday, {
      day: "2026-09-04",
      usedPercent: 60,
      windowStartDay: null,
    });
    expect(today.notified).toEqual([]);
    expect(dueUsagePlanAlert("approaching", today, "2026-09-04")).toBe("approaching");
  });
});
