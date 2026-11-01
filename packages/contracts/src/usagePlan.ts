import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** 0 is Sunday, matching `Date.prototype.getDay`. */
export const UsagePlanWeekday = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));
export type UsagePlanWeekday = typeof UsagePlanWeekday.Type;

const MinuteOfDay = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 * 60 - 1 }));

/** Wall-clock times in the plan's time zone. Monthly days stop at 28 so every month has one. */
export const UsagePlanResetSchedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    weekday: UsagePlanWeekday,
    minuteOfDay: MinuteOfDay,
  }),
  Schema.Struct({
    kind: Schema.Literal("monthly"),
    day: Schema.Union([
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 28 })),
      Schema.Literal("last"),
    ]),
    minuteOfDay: MinuteOfDay,
  }),
]);
export type UsagePlanResetSchedule = typeof UsagePlanResetSchedule.Type;

/** Without `reset` the provider's reported reset is used. */
export const UsagePlanWindowSettings = Schema.Struct({
  reset: Schema.optionalKey(UsagePlanResetSchedule),
  timeZone: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  workingDays: Schema.Array(UsagePlanWeekday).check(Schema.isMinLength(1), Schema.isUnique()),
});
export type UsagePlanWindowSettings = typeof UsagePlanWindowSettings.Type;

const MAX_USAGE_PLAN_WINDOWS = 64;
const MIN_USAGE_PLAN_APPROACHING_PERCENT = 50;
export const MAX_USAGE_PLAN_APPROACHING_PERCENT = 95;
const UsagePlanApproachingPercent = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_USAGE_PLAN_APPROACHING_PERCENT,
    maximum: MAX_USAGE_PLAN_APPROACHING_PERCENT,
  }),
);

/** Windows are keyed by `usagePlanKey` (driver and pooled window id), stable across machines. */
export const UsagePlanSettings = Schema.Struct({
  remindersEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  approachingPercent: UsagePlanApproachingPercent.pipe(
    Schema.withDecodingDefault(Effect.succeed(80)),
  ),
  windows: Schema.Record(TrimmedNonEmptyString, UsagePlanWindowSettings)
    .check(Schema.isMaxProperties(MAX_USAGE_PLAN_WINDOWS))
    .pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type UsagePlanSettings = typeof UsagePlanSettings.Type;

/** Window entries merge one by one; null removes a plan. */
export const UsagePlanSettingsPatch = Schema.Struct({
  remindersEnabled: Schema.optionalKey(Schema.Boolean),
  approachingPercent: Schema.optionalKey(UsagePlanApproachingPercent),
  windows: Schema.optionalKey(
    Schema.Record(TrimmedNonEmptyString, Schema.NullOr(UsagePlanWindowSettings)).check(
      Schema.isMaxProperties(MAX_USAGE_PLAN_WINDOWS),
    ),
  ),
});
export type UsagePlanSettingsPatch = typeof UsagePlanSettingsPatch.Type;
