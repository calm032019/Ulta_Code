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
  RotateCcwIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type MouseEvent } from "react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { cn } from "~/lib/utils";
import { useQuietThreadProjection, useThreadHistory } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useTimelineJumpStore } from "~/timelineJumpStore";
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

function ActivityRow({
  event,
  onSelect,
}: {
  event: SessionActivityEvent;
  onSelect: (event: SessionActivityEvent, mouse: MouseEvent<HTMLElement>) => void;
}) {
  const Icon = KIND_ICONS[event.kind];
  const content = (
    <>
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          event.failed ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
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
  const className =
    "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring";
  return event.url ? (
    <a href={event.url} className={className} onClick={(mouse) => onSelect(event, mouse)}>
      {content}
    </a>
  ) : (
    <button type="button" className={className} onClick={(mouse) => onSelect(event, mouse)}>
      {content}
    </button>
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

  const select = (event: SessionActivityEvent, mouse: MouseEvent<HTMLElement>) => {
    if (event.url) {
      openPrLink(mouse, event.url, threadRef);
      return;
    }
    useTimelineJumpStore.getState().requestJump(threadKey, {
      itemId: event.itemId,
      runId: event.runId,
      at: event.at,
    });
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
      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <ActivityIcon aria-hidden className="size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No activity yet</p>
          <p className="max-w-60 text-xs text-muted-foreground">
            Commits, pushes, retries, errors, file changes, reads and commands from this thread
            appear here.
          </p>
        </div>
      ) : (
        // Long threads run thousands of commands; only rows in view are mounted.
        <LegendList<SessionActivityEvent>
          data={shown}
          keyExtractor={(event) => event.id}
          extraData={threadKey}
          renderItem={({ item }) => <ActivityRow event={item} onSelect={select} />}
          estimatedItemSize={44}
          drawDistance={440}
          className="min-h-0 flex-1 overscroll-contain p-1.5"
        />
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
