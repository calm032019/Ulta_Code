import {
  type UsagePlanAlert,
  type UsagePlanWindowRecord,
  markUsagePlanAlert,
  observeUsagePlan,
} from "@t3tools/shared/usagePlan";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";
import { failSafeStorage } from "../minigames/dockLogic";

const STORAGE_KEY = "t3code:usage-plan-baselines:v1";

const PersistedRecords = Schema.Record(
  Schema.String,
  Schema.Struct({
    days: Schema.Record(Schema.String, Schema.Struct({ start: Schema.Number, end: Schema.Number })),
    notifiedDay: Schema.NullOr(Schema.String),
    notified: Schema.Array(Schema.Literals(["approaching", "over"])),
  }),
);
const decodeRecords = Schema.decodeUnknownOption(PersistedRecords);

interface UsagePlanBaselineState {
  readonly windows: Readonly<Record<string, UsagePlanWindowRecord>>;
}

/** Baselines are per device: each client records the first reading it sees each day. */
export const useUsagePlanBaselineStore = create<UsagePlanBaselineState>()(
  persist((): UsagePlanBaselineState => ({ windows: {} }), {
    name: STORAGE_KEY,
    version: 1,
    storage: createJSONStorage(() =>
      failSafeStorage(
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    ),
    merge: (persisted, current) => {
      const windows =
        typeof persisted === "object" && persisted !== null && "windows" in persisted
          ? decodeRecords(persisted.windows)
          : undefined;
      return { ...current, windows: windows?._tag === "Some" ? windows.value : current.windows };
    },
  }),
);

export function recordUsagePlanReading(
  key: string,
  reading: Parameters<typeof observeUsagePlan>[1],
): UsagePlanWindowRecord {
  const previous = useUsagePlanBaselineStore.getState().windows[key];
  const next = observeUsagePlan(previous, reading);
  if (next === previous) return next;
  useUsagePlanBaselineStore.setState((state) => ({ windows: { ...state.windows, [key]: next } }));
  return next;
}

export function recordUsagePlanAlert(key: string, day: string, alert: UsagePlanAlert): void {
  useUsagePlanBaselineStore.setState((state) => {
    const record = state.windows[key];
    return record
      ? { windows: { ...state.windows, [key]: markUsagePlanAlert(record, day, alert) } }
      : state;
  });
}
