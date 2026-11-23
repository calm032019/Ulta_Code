import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import {
  isOrchestrationV2WorkActive,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { ArrowLeftIcon, BotIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { cn } from "../../lib/utils";
import { hostRightPanel } from "../../rightPanelStore";
import { useThreadProjection } from "../../state/entities";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { Button } from "../ui/button";
import { DiscoveryList, DiscoveryListRow } from "../ui/discovery-list";

type SubagentStatus = OrchestrationV2Subagent["status"];

const STATUS_LABELS: Record<SubagentStatus, string> = {
  idle: "Idle",
  pending: "Starting",
  running: "Running",
  waiting: "Waiting",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

function subagentTitle(agent: OrchestrationV2Subagent): string {
  const title = agent.title?.trim() || agent.prompt.split("\n")[0]?.trim() || "Subagent";
  return formatSubagentDisplayTitle(title);
}

function StatusDot({ status }: { readonly status: SubagentStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        isOrchestrationV2WorkActive(status)
          ? "bg-info"
          : status === "completed"
            ? "bg-success"
            : status === "failed"
              ? "bg-destructive"
              : "bg-muted-foreground/40",
      )}
    />
  );
}

/** Live first, then most recently touched. */
function orderSubagents(
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
): ReadonlyArray<OrchestrationV2Subagent> {
  return subagents.toSorted((left, right) => {
    const liveDelta =
      Number(isOrchestrationV2WorkActive(right.status)) -
      Number(isOrchestrationV2WorkActive(left.status));
    if (liveDelta !== 0) return liveDelta;
    return DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt);
  });
}

/** The thread's subagents; one opens to its own thinking, tool calls and tasks. */
export function BackgroundTasksPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly parentPanel: SideChatParentPanel;
}) {
  const { threadRef } = props;
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const subagents = orderSubagents(projection?.subagents ?? []);
  const selected =
    selectedId === null ? null : (subagents.find((agent) => agent.id === selectedId) ?? null);

  if (selected !== null) {
    return (
      <SubagentDetail
        parentRef={threadRef}
        agent={selected}
        parentPanel={props.parentPanel}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  if (subagents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm">
        Subagents this thread starts will show up here.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <DiscoveryList>
        {subagents.map((agent) => (
          <DiscoveryListRow
            key={agent.id}
            onClick={() => setSelectedId(agent.id)}
            icon={<BotIcon className="size-4 shrink-0 text-muted-foreground" />}
            title={subagentTitle(agent)}
            description={agent.progress?.trim() || agent.model || agent.driver}
            action={
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot status={agent.status} />
                {STATUS_LABELS[agent.status]}
              </span>
            }
          />
        ))}
      </DiscoveryList>
    </div>
  );
}

function SubagentDetail(props: {
  readonly parentRef: ScopedThreadRef;
  readonly agent: OrchestrationV2Subagent;
  readonly parentPanel: SideChatParentPanel;
  readonly onBack: () => void;
}) {
  const { parentRef, agent } = props;
  const childThreadId = agent.childThreadId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the parent panel as host for the embedded subagent thread
  useEffect(() => {
    if (childThreadId === null) return;
    return hostRightPanel(scopeThreadRef(parentRef.environmentId, childThreadId), parentRef);
  }, [parentRef, childThreadId]);

  return (
    <div data-side-chat-pane className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pr-3 pl-1">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="All background tasks"
          onClick={props.onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{subagentTitle(agent)}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot status={agent.status} />
          {STATUS_LABELS[agent.status]}
        </span>
      </div>
      {childThreadId === null ? (
        <SubagentSummary agent={agent} />
      ) : (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              key={childThreadId}
              environmentId={parentRef.environmentId}
              threadId={childThreadId}
              routeKind="server"
              embedded={props.parentPanel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      )}
    </div>
  );
}

/** For tasks with no transcript here (a linked environment, or a provider that keeps none). */
function SubagentSummary({ agent }: { readonly agent: OrchestrationV2Subagent }) {
  const sections = [
    ["Prompt", agent.prompt],
    ["Progress", agent.progress],
    ["Result", agent.result],
  ] as const;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
      {sections.map(([label, text]) =>
        text?.trim() ? (
          <section key={label} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
            <p className="whitespace-pre-wrap break-words text-foreground">{text}</p>
          </section>
        ) : null,
      )}
    </div>
  );
}
