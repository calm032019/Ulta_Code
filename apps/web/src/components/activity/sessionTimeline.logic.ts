import type { RunId } from "@t3tools/contracts";

import type { SessionActivityEvent } from "./sessionActivity.logic";

export type SessionTimelineItem =
  | { readonly type: "group"; readonly key: string; readonly label: string; readonly at: string }
  | {
      readonly type: "event";
      readonly key: string;
      readonly event: SessionActivityEvent;
      /** Position in chronological order, used by the step controls. */
      readonly index: number;
      /** After the chat's current position, drawn faded like a rolled-back history. */
      readonly future: boolean;
    }
  | { readonly type: "marker"; readonly key: "marker"; readonly atEnd: boolean };

type SessionTimelineEventItem = Extract<SessionTimelineItem, { type: "event" }>;

type SessionTimelineRow =
  | Extract<SessionTimelineItem, { type: "group" }>
  | {
      readonly type: "event";
      readonly index: number;
      readonly past: SessionTimelineEventItem;
      readonly future: SessionTimelineEventItem;
    };

export interface SessionTimeline {
  /** Oldest first. */
  readonly chronological: ReadonlyArray<SessionActivityEvent>;
  readonly times: ReadonlyArray<number>;
  readonly rows: ReadonlyArray<SessionTimelineRow>;
}

/**
 * Lays activity out as a vertical history: oldest at the top, grouped by turn. `events` must be
 * newest first, as deriveSessionActivity returns them. Each event item exists in its faded and
 * current form, so moving the marker swaps only the rows it passes.
 */
export function buildSessionTimeline(input: {
  readonly events: ReadonlyArray<SessionActivityEvent>;
  readonly runOrdinals: ReadonlyMap<RunId, number>;
}): SessionTimeline {
  const chronological = input.events.toReversed();
  const rows: SessionTimelineRow[] = [];
  let previousGroup: string | undefined;
  chronological.forEach((event, index) => {
    const group = event.runId ?? "thread";
    if (group !== previousGroup) {
      const ordinal = event.runId === null ? undefined : input.runOrdinals.get(event.runId);
      rows.push({
        type: "group",
        key: `group:${group}:${index}`,
        label: ordinal === undefined ? "Thread" : `Turn ${ordinal}`,
        at: event.at,
      });
      previousGroup = group;
    }
    const item = { type: "event", key: event.id, event, index } as const;
    rows.push({
      type: "event",
      index,
      past: { ...item, future: false },
      future: { ...item, future: true },
    });
  });
  return {
    chronological,
    times: chronological.map((event) => Date.parse(event.at) || 0),
    rows,
  };
}

/**
 * The last event at or before the chat's position; -1 when the chat sits before every event.
 * `viewportAt` is the newest timestamp visible in the chat; `atEnd` means the chat is following
 * the latest output, so the marker sits after everything.
 */
export function sessionTimelineMarkerIndex(
  timeline: SessionTimeline,
  viewportAt: string | null,
  atEnd: boolean,
): number {
  const { times } = timeline;
  const viewportMs = viewportAt === null ? Number.NaN : Date.parse(viewportAt);
  if (atEnd || Number.isNaN(viewportMs)) return times.length - 1;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (times[middle]! <= viewportMs) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** The rows to draw: the marker after `markerIndex`, and later events faded. */
export function sessionTimelineItems(
  timeline: SessionTimeline,
  markerIndex: number,
): SessionTimelineItem[] {
  const atEnd = markerIndex === timeline.chronological.length - 1;
  const items: SessionTimelineItem[] = [];
  if (markerIndex === -1 && timeline.chronological.length > 0) {
    items.push({ type: "marker", key: "marker", atEnd: false });
  }
  for (const row of timeline.rows) {
    if (row.type === "group") {
      items.push(row);
      continue;
    }
    items.push(row.index > markerIndex ? row.future : row.past);
    if (row.index === markerIndex) items.push({ type: "marker", key: "marker", atEnd });
  }
  return items;
}

export type SessionTimelineStep = "first" | "previous" | "next" | "last";

/** The event a step control moves to from the marker, or null when there is nowhere to go. */
export function sessionTimelineStepTarget(
  markerIndex: number,
  step: SessionTimelineStep,
  length: number,
): number | null {
  if (length === 0) return null;
  const target =
    step === "first"
      ? 0
      : step === "last"
        ? length - 1
        : step === "previous"
          ? markerIndex - 1
          : markerIndex + 1;
  if (target < 0 || target >= length || target === markerIndex) return null;
  return target;
}
