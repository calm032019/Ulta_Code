import type { EnvironmentId } from "@t3tools/contracts";
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
import { usePrimaryEnvironmentId } from "~/state/environments";
import { failSafeStorage } from "../minigames/dockLogic";

const STORAGE_KEY = "t3code:usage-plan-baselines:v1";

const PersistedRecords = Schema.Record(
  Schema.String,
  Schema.Record(
    Schema.String,
    Schema.Struct({
      days: Schema.Record(
        Schema.String,
        Schema.Struct({ start: Schema.Number, end: Schema.Number }),
      ),
      notifiedDay: Schema.NullOr(Schema.String),
      notified: Schema.Array(Schema.Literals(["approaching", "over"])),
    }),
  ),
);
const decodeRecords = Schema.decodeUnknownOption(PersistedRecords);

type WindowRecords = Readonly<Record<string, UsagePlanWindowRecord>>;

interface UsagePlanBaselineState {
  readonly environments: Readonly<Record<string, WindowRecords>>;
}

const NO_RECORDS: WindowRecords = {};

/**
 * Baselines are per device: each client records the first reading it sees each day. They are
 * scoped to the primary environment, whose settings own the plans, so a shared browser keeps
 * each environment's readings apart.
 */
const useUsagePlanBaselineStore = create<UsagePlanBaselineState>()(
  persist((): UsagePlanBaselineState => ({ environments: {} }), {
    name: STORAGE_KEY,
    version: 2,
    migrate: () => ({ environments: {} }),
    storage: createJSONStorage(() =>
      failSafeStorage(
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    ),
    merge: (persisted, current) => {
      const environments =
        typeof persisted === "object" && persisted !== null && "environments" in persisted
          ? decodeRecords(persisted.environments)
          : undefined;
      return {
        ...current,
        environments: environments?._tag === "Some" ? environments.value : current.environments,
      };
    },
  }),
);

export function useUsagePlanRecords(): WindowRecords {
  const environmentId = usePrimaryEnvironmentId();
  return useUsagePlanBaselineStore(
    (state) => (environmentId && state.environments[environmentId]) || NO_RECORDS,
  );
}

function updateRecord(
  environmentId: EnvironmentId,
  key: string,
  update: (record: UsagePlanWindowRecord | undefined) => UsagePlanWindowRecord | undefined,
): void {
  useUsagePlanBaselineStore.setState((state) => {
    const records = state.environments[environmentId] ?? NO_RECORDS;
    const previous = records[key];
    const next = update(previous);
    return next === undefined || next === previous
      ? state
      : { environments: { ...state.environments, [environmentId]: { ...records, [key]: next } } };
  });
}

export function recordUsagePlanReading(
  environmentId: EnvironmentId,
  key: string,
  reading: Parameters<typeof observeUsagePlan>[1],
): UsagePlanWindowRecord {
  const previous = useUsagePlanBaselineStore.getState().environments[environmentId]?.[key];
  const next = observeUsagePlan(previous, reading);
  updateRecord(environmentId, key, () => next);
  return next;
}

export function recordUsagePlanAlert(
  environmentId: EnvironmentId,
  key: string,
  day: string,
  alert: UsagePlanAlert,
): void {
  updateRecord(environmentId, key, (record) =>
    record ? markUsagePlanAlert(record, day, alert) : record,
  );
}
