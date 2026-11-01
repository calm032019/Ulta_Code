import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LegendList } from "@legendapp/list/react";
import {
  ActivityIcon,
  ArrowUpFromLineIcon,
  CircleAlertIcon,
  FilePenLineIcon,
  FileTextIcon,
  GaugeIcon,
  GitCommitHorizontalIcon,
  GripHorizontalIcon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SquareTerminalIcon,
  StepBackIcon,
  StepForwardIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type MouseEvent, type PointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { cn } from "~/lib/utils";
import { useQuietThreadProjection, useThreadHistory } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useTimelineJumpStore } from "~/timelineJumpStore";
import { useTimelineViewportStore } from "~/timelineViewportStore";
import { DiffStatLabel } from "../chat/DiffStatLabel";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import {
  countSessionActivity,
  deriveSessionActivity,
  SESSION_ACTIVITY_KINDS,
  type SessionActivityEvent,
  type SessionActivityKind,
} from "./sessionActivity.logic";
import {
  buildSessionTimeline,
  sessionTimelineStepTarget,
  type SessionTimelineItem,
  type SessionTimelineStep,
} from "./sessionTimeline.logic";

const KIND_ICONS: Record<SessionActivityKind, LucideIcon | typeof PullRequestGlyph.pullRequest> = {
  commit: GitCommitHorizontalIcon,
  push: ArrowUpFromLineIcon,
  "pull-request": PullRequestGlyph.pullRequest,
  rerun: RotateCcwIcon,
  "usage-limit": GaugeIcon,
  error: CircleAlertIcon,
  change: FilePenLineIcon,
  read: FileTextIcon,
  command: SquareTerminalIcon,
};

const EMPTY_EVENTS: ReadonlyArray<SessionActivityEvent> = [];

/** Node tints by kind; failures always read as errors. */
const KIND_NODE_CLASS: Record<SessionActivityKind, string> = {
  commit: "bg-success/14 text-success-foreground",
  push: "bg-success/14 text-success-foreground",
  "pull-request": "bg-info/14 text-info-foreground",
  rerun: "bg-warning/16 text-warning-foreground",
  "usage-limit": "bg-destructive/12 text-destructive-foreground",
  error: "bg-destructive/12 text-destructive-foreground",
  change: "bg-primary/12 text-primary",
  read: "bg-muted text-muted-foreground",
  command: "bg-muted text-foreground",
};

/** The rail runs through every row, so it stays continuous while rows are virtualised. */
const RAIL_CLASS =
  "before:pointer-events-none before:absolute before:inset-y-0 before:start-[1.375rem] before:w-0.5 before:-translate-x-1/2 before:bg-border";

function TimelineEventRow({
  item,
  dragTarget,
  onSelect,
}: {
  item: Extract<SessionTimelineItem, { type: "event" }>;
  dragTarget: boolean;
  onSelect: (event: SessionActivityEvent, mouse: MouseEvent<HTMLElement>) => void;
}) {
  const { event } = item;
  const Icon = KIND_ICONS[event.kind];
  const content = (
    <>
      <span
        className={cn(
          "relative z-1 flex size-7 shrink-0 items-center justify-center rounded-lg ring-4 ring-background",
          event.failed ? KIND_NODE_CLASS.error : KIND_NODE_CLASS[event.kind],
        )}
      >
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium",
              event.failed && "text-destructive-foreground",
            )}
          >
            {event.title}
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
            <RelativeTime timestamp={event.at} />
          </span>
        </span>
        {event.detail || event.diffStat ? (
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {event.detail ? (
              <span className="min-w-0 flex-1 truncate font-mono text-2xs">{event.detail}</span>
            ) : (
              <span className="flex-1" />
            )}
            {event.diffStat ? (
              <DiffStatLabel
                layout="inline"
                additions={event.diffStat.additions}
                deletions={event.diffStat.deletions}
              />
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  );
  const className = cn(
    "relative flex w-full min-w-0 items-center gap-3 rounded-lg py-1.5 ps-2 pe-2 text-left transition-opacity hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
    RAIL_CLASS,
    item.future && "opacity-45 hover:opacity-100",
    dragTarget && "bg-accent opacity-100",
  );
  return event.url ? (
    <a
      href={event.url}
      data-timeline-index={item.index}
      className={className}
      onClick={(mouse) => onSelect(event, mouse)}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      data-timeline-index={item.index}
      className={className}
      onClick={(mouse) => onSelect(event, mouse)}
    >
      {content}
    </button>
  );
}

function TimelineGroupRow({ item }: { item: Extract<SessionTimelineItem, { type: "group" }> }) {
  return (
    <div className={cn("relative flex items-center gap-2 pt-3 pb-1 ps-11", RAIL_CLASS)}>
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {item.label}
      </span>
      <span className="text-2xs text-muted-foreground/80 tabular-nums">
        <RelativeTime timestamp={item.at} />
      </span>
    </div>
  );
}

function TimelineMarkerRow({
  atEnd,
  onDragStart,
  onKeyStep,
}: {
  atEnd: boolean;
  onDragStart: (pointer: PointerEvent<HTMLButtonElement>) => void;
  onKeyStep: (step: SessionTimelineStep) => void;
}) {
  return (
    <div className="relative flex h-5 items-center">
      <span aria-hidden className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 bg-primary" />
      <button
        type="button"
        aria-label="Timeline position. Drag, or use the arrow keys, to move through the chat."
        className="relative z-1 ms-3 flex h-4 w-7 cursor-grab touch-none items-center justify-center rounded-sm bg-primary text-primary-foreground shadow-sm active:cursor-grabbing focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        onPointerDown={onDragStart}
        onKeyDown={(key) => {
          const step: SessionTimelineStep | null =
            key.key === "ArrowUp"
              ? "previous"
              : key.key === "ArrowDown"
                ? "next"
                : key.key === "Home"
                  ? "first"
                  : key.key === "End"
                    ? "last"
                    : null;
          if (step === null) return;
          key.preventDefault();
          onKeyStep(step);
        }}
      >
        <GripHorizontalIcon aria-hidden className="size-3" />
      </button>
      <span className="relative ms-auto me-2 bg-background px-1 text-2xs font-medium text-primary">
        {atEnd ? "Latest" : "You are here"}
      </span>
    </div>
  );
}

export function SessionActivityPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useQuietThreadProjection(threadRef);
  const history = useThreadHistory(threadRef);
  const loadEarlier = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: true,
  });
  const openPrLink = useOpenPrLink(threadRef);
  const [filter, setFilter] = useState<SessionActivityKind | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const projection = thread?.projection;
  const events = projection
    ? deriveSessionActivity({
        visibleTurnItems: projection.visibleTurnItems,
        runs: projection.runs,
        attempts: projection.attempts,
        checkpoints: projection.checkpoints,
        pullRequests: projection.thread.pullRequests ?? [],
      })
    : EMPTY_EVENTS;
  const counts = countSessionActivity(events);
  const shown = filter === null ? events : events.filter((event) => event.kind === filter);
  const threadKey = scopedThreadKey(threadRef);
  const viewport = useTimelineViewportStore(
    useShallow((state) =>
      state.threadKey === threadKey
        ? { at: state.at, atEnd: state.atEnd }
        : { at: null, atEnd: true },
    ),
  );
  const runOrdinals = new Map(projection?.runs.map((run) => [run.id, run.ordinal] as const));
  const timeline = buildSessionTimeline({
    events: shown,
    runOrdinals,
    viewportAt: viewport.at,
    atEnd: viewport.atEnd,
  });
  const markerEvent = timeline.chronological[timeline.markerIndex];
  const markerTurn = markerEvent?.runId ? runOrdinals.get(markerEvent.runId) : undefined;

  const jumpTo = (event: SessionActivityEvent) =>
    useTimelineJumpStore.getState().requestJump(threadKey, {
      itemId: event.itemId,
      runId: event.runId,
      at: event.at,
    });

  const select = (event: SessionActivityEvent, mouse: MouseEvent<HTMLElement>) => {
    if (event.url) {
      openPrLink(mouse, event.url, threadRef);
      return;
    }
    jumpTo(event);
  };

  const step = (direction: SessionTimelineStep) => {
    const target = sessionTimelineStepTarget(
      timeline.markerIndex,
      direction,
      timeline.chronological.length,
    );
    const event = target === null ? undefined : timeline.chronological[target];
    if (event) jumpTo(event);
  };

  // Dragging the marker previews the drop target and moves the chat on release.
  const startDrag = (pointer: PointerEvent<HTMLButtonElement>) => {
    const handle = pointer.currentTarget;
    handle.setPointerCapture(pointer.pointerId);
    let target: number | null = null;
    const indexAt = (x: number, y: number) => {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-timeline-index]");
      const index = row ? Number(row.dataset.timelineIndex) : Number.NaN;
      return Number.isNaN(index) ? null : index;
    };
    const move = (next: globalThis.PointerEvent) => {
      target = indexAt(next.clientX, next.clientY) ?? target;
      setDragIndex(target);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragIndex(null);
      const event = target === null ? undefined : timeline.chronological[target];
      if (event) jumpTo(event);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label="Filter activity"
        className="flex flex-wrap gap-1 border-b border-border/60 p-1.5"
      >
        <Toggle
          size="segmented"
          variant="segmented"
          pressed={filter === null}
          onPressedChange={() => setFilter(null)}
        >
          All {events.length}
        </Toggle>
        {SESSION_ACTIVITY_KINDS.filter(({ kind }) => counts[kind] > 0).map(({ kind, label }) => (
          <Toggle
            key={kind}
            size="segmented"
            variant="segmented"
            pressed={filter === kind}
            onPressedChange={(pressed) => setFilter(pressed ? kind : null)}
          >
            {label} {counts[kind]}
          </Toggle>
        ))}
      </div>
      {timeline.chronological.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <ActivityIcon aria-hidden className="size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No activity yet</p>
          <p className="max-w-60 text-xs text-muted-foreground">
            Commits, pushes, retries, errors, file changes, reads and commands from this thread
            appear here.
          </p>
        </div>
      ) : (
        <>
          <div
            role="toolbar"
            aria-label="Step through the session"
            className="flex items-center gap-0.5 border-b border-border/60 px-1.5 py-1"
          >
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="First event"
              onClick={() => step("first")}
            >
              <SkipBackIcon aria-hidden />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous event"
              onClick={() => step("previous")}
            >
              <StepBackIcon aria-hidden />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next event"
              onClick={() => step("next")}
            >
              <StepForwardIcon aria-hidden />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Latest event"
              onClick={() => step("last")}
            >
              <SkipForwardIcon aria-hidden />
            </Button>
            <span className="ms-auto pe-1 text-2xs text-muted-foreground tabular-nums">
              {timeline.markerIndex < 0
                ? `Before event 1 of ${timeline.chronological.length}`
                : `Event ${timeline.markerIndex + 1} of ${timeline.chronological.length}${
                    markerTurn === undefined ? "" : ` · Turn ${markerTurn}`
                  }`}
            </span>
          </div>
          {/* Long threads run thousands of commands; only rows in view are mounted. */}
          <LegendList<SessionTimelineItem>
            data={timeline.items}
            keyExtractor={(item) => item.key}
            extraData={dragIndex}
            renderItem={({ item }) =>
              item.type === "group" ? (
                <TimelineGroupRow item={item} />
              ) : item.type === "marker" ? (
                <TimelineMarkerRow atEnd={item.atEnd} onDragStart={startDrag} onKeyStep={step} />
              ) : (
                <TimelineEventRow
                  item={item}
                  dragTarget={dragIndex === item.index}
                  onSelect={select}
                />
              )
            }
            estimatedItemSize={44}
            drawDistance={440}
            className="min-h-0 flex-1 overscroll-contain px-1.5 pb-3"
          />
        </>
      )}
      {history.hasMoreHistory ? (
        <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-1.5 text-2xs text-muted-foreground">
          <span>Older history is not loaded yet.</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={history.loading}
            onClick={() =>
              void loadEarlier({
                environmentId: threadRef.environmentId,
                input: { threadId: threadRef.threadId },
              })
            }
          >
            Load earlier
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
