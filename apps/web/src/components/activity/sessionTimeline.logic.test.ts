import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SessionActivityEvent } from "./sessionActivity.logic";
import {
  buildSessionTimeline,
  sessionTimelineItems,
  sessionTimelineMarkerIndex,
  sessionTimelineStepTarget,
  type SessionTimelineItem,
} from "./sessionTimeline.logic";

const runA = RunId.make("run-a");
const runB = RunId.make("run-b");
const event = (id: string, at: string, runId: RunId | null): SessionActivityEvent => ({
  id,
  kind: "read",
  at,
  runId,
  itemId: id,
  title: id,
  detail: null,
  failed: false,
});
// Newest first, as deriveSessionActivity returns them.
const events = [
  event("e4", "2026-11-01T10:04:00.000Z", runB),
  event("e3", "2026-11-01T10:03:00.000Z", runB),
  event("e2", "2026-11-01T10:02:00.000Z", runA),
  event("e1", "2026-11-01T10:01:00.000Z", runA),
];
const runOrdinals = new Map([
  [runA, 1],
  [runB, 2],
]);
function layout(input: {
  readonly events: ReadonlyArray<SessionActivityEvent>;
  readonly viewportAt: string | null;
  readonly atEnd: boolean;
}) {
  const timeline = buildSessionTimeline({ events: input.events, runOrdinals });
  const markerIndex = sessionTimelineMarkerIndex(timeline, input.viewportAt, input.atEnd);
  return { timeline, markerIndex, items: sessionTimelineItems(timeline, markerIndex) };
}
const keys = (items: ReadonlyArray<SessionTimelineItem>) =>
  items.map((item) =>
    item.type === "event" ? item.event.id : item.type === "group" ? item.label : "|",
  );
const eventItem = (items: ReadonlyArray<SessionTimelineItem>, id: string) =>
  items.find((item) => item.type === "event" && item.event.id === id);

describe("buildSessionTimeline", () => {
  it("lists oldest first under turn groups with the marker after the last event when following", () => {
    const timeline = layout({ events, viewportAt: null, atEnd: true });
    expect(keys(timeline.items)).toEqual(["Turn 1", "e1", "e2", "Turn 2", "e3", "e4", "|"]);
    expect(timeline.markerIndex).toBe(3);
    expect(timeline.items.some((item) => item.type === "event" && item.future)).toBe(false);
  });

  it("places the marker at the chat's position and fades later events", () => {
    const timeline = layout({
      events,
      viewportAt: "2026-11-01T10:02:30.000Z",
      atEnd: false,
    });
    expect(keys(timeline.items)).toEqual(["Turn 1", "e1", "e2", "|", "Turn 2", "e3", "e4"]);
    expect(
      timeline.items.flatMap((item) =>
        item.type === "event" && item.future ? [item.event.id] : [],
      ),
    ).toEqual(["e3", "e4"]);
    // Moving the marker keeps the rows it does not pass.
    const followed = sessionTimelineItems(timeline.timeline, 3);
    expect(eventItem(followed, "e1")).toBe(eventItem(timeline.items, "e1"));
    expect(eventItem(followed, "e3")).not.toBe(eventItem(timeline.items, "e3"));
  });

  it("puts the marker before everything when the chat sits before the first event", () => {
    const timeline = layout({
      events,
      viewportAt: "2026-11-01T09:00:00.000Z",
      atEnd: false,
    });
    expect(timeline.markerIndex).toBe(-1);
    expect(timeline.items[0]?.type).toBe("marker");
  });

  it("groups events without a turn under Thread", () => {
    const timeline = layout({
      events: [event("pr", "2026-11-01T10:05:00.000Z", null)],
      viewportAt: null,
      atEnd: true,
    });
    expect(keys(timeline.items)).toEqual(["Thread", "pr", "|"]);
  });
});

describe("sessionTimelineStepTarget", () => {
  it.each([
    [1, "previous", 4, 0],
    [1, "next", 4, 2],
    [1, "first", 4, 0],
    [1, "last", 4, 3],
    [0, "previous", 4, null],
    [3, "next", 4, null],
    [3, "last", 4, null],
    [-1, "next", 4, 0],
    [-1, "previous", 4, null],
    [0, "next", 0, null],
  ] as const)("from %i, %s with %i events goes to %s", (marker, step, length, expected) => {
    expect(sessionTimelineStepTarget(marker, step, length)).toBe(expected);
  });
});
