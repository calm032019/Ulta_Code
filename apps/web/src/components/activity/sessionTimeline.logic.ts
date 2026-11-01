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

export interface SessionTimeline {
  readonly items: ReadonlyArray<SessionTimelineItem>;
  /** Oldest first. */
  readonly chronological: ReadonlyArray<SessionActivityEvent>;
  /** The last event at or before the chat's position; -1 when the chat sits before every event. */
  readonly markerIndex: number;
}

/**
 * Lays activity out as a vertical history: oldest at the top, grouped by turn, with a marker at
 * the point the chat is scrolled to. `viewportAt` is the newest timestamp visible in the chat;
 * `atEnd` means the chat is following the latest output, so the marker sits after everything.
 */
export function buildSessionTimeline(input: {
  readonly events: ReadonlyArray<SessionActivityEvent>;
  readonly runOrdinals: ReadonlyMap<RunId, number>;
  readonly viewportAt: string | null;
  readonly atEnd: boolean;
}): SessionTimeline {
  const chronological = input.events.toReversed();
  const viewportMs = input.viewportAt === null ? Number.NaN : Date.parse(input.viewportAt);
  const markerIndex =
    input.atEnd || Number.isNaN(viewportMs)
      ? chronological.length - 1
      : chronological.findLastIndex((event) => (Date.parse(event.at) || 0) <= viewportMs);
  const atEnd = markerIndex === chronological.length - 1;

  const items: SessionTimelineItem[] = [];
  if (markerIndex === -1 && chronological.length > 0) {
    items.push({ type: "marker", key: "marker", atEnd: false });
  }
  let previousGroup: string | undefined;
  chronological.forEach((event, index) => {
    const group = event.runId ?? "thread";
    if (group !== previousGroup) {
      const ordinal = event.runId === null ? undefined : input.runOrdinals.get(event.runId);
      items.push({
        type: "group",
        key: `group:${group}:${index}`,
        label: ordinal === undefined ? "Thread" : `Turn ${ordinal}`,
        at: event.at,
      });
      previousGroup = group;
    }
    items.push({
      type: "event",
      key: event.id,
      event,
      index,
      future: index > markerIndex,
    });
    if (index === markerIndex) items.push({ type: "marker", key: "marker", atEnd });
  });
  return { items, chronological, markerIndex };
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
