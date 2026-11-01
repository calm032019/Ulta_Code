import { PLAIN_LANGUAGE_MAX_MESSAGES, type MessageId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { use, type PointerEvent } from "react";

import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { DunceCapIcon } from "../Icons";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  cancelDunceDrag,
  closePlainEnglishCard,
  explainFromHat,
  extendDunceDrag,
  finishDunceDrag,
  isDunceMessageSelected,
  retryPlainEnglishCard,
  startDunceDrag,
  useDunceModeStore,
} from "./dunceModeStore";
import { MessageCopyButton } from "./MessageCopyButton";
import { TimelineRowCtx } from "./timelineRowContext";

function messageIdAt(clientX: number, clientY: number): string | null {
  const target = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-dunce-message-id],[data-message-id]");
  return target?.dataset.dunceMessageId ?? target?.dataset.messageId ?? null;
}

const cancelOnEscape = (event: KeyboardEvent) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  cancelDunceDrag();
};

/** Sits in the gutter beside a message, outside the lane, so turning it on moves nothing. */
export function DunceHat({
  messageId,
  streaming,
}: {
  readonly messageId: MessageId;
  readonly streaming: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const threadKey = ctx.routeThreadKey;
  const selected = useDunceModeStore((state) =>
    isDunceMessageSelected(state, threadKey, messageId),
  );
  const threadRef = ctx.threadRef;
  if (ctx.dunceMessages === null || threadRef === null) return null;
  const getMessages = ctx.dunceMessages;
  const label = streaming ? "Wait for this message to finish" : "Explain in plain English";

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (streaming || event.button !== 0) return;
    event.preventDefault();
    if (event.shiftKey) {
      explainFromHat({
        threadKey,
        threadRef,
        messages: getMessages(),
        messageId,
        extendRange: true,
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    window.addEventListener("keydown", cancelOnEscape);
    startDunceDrag({ threadKey, threadRef, messages: getMessages(), anchorId: messageId });
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>, explain: boolean) => {
    window.removeEventListener("keydown", cancelOnEscape);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (explain) finishDunceDrag();
    else cancelDunceDrag();
  };

  return (
    <>
      {selected ? <div aria-hidden="true" className="dunce-row-highlight" /> : null}
      <div className="dunce-hat-slot">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={label}
                aria-disabled={streaming || undefined}
                data-dunce-message-id={messageId}
                data-scroll-anchor-ignore
                className={cn(
                  "flex size-6 touch-none select-none items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
                  streaming
                    ? "cursor-not-allowed text-muted-foreground/40"
                    : selected
                      ? "cursor-pointer bg-accent text-foreground"
                      : "cursor-pointer text-muted-foreground/60 hover:bg-accent hover:text-foreground",
                )}
                onPointerDown={onPointerDown}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  const id = messageIdAt(event.clientX, event.clientY);
                  if (id !== null) extendDunceDrag(id);
                }}
                onPointerUp={(event) => endDrag(event, true)}
                onPointerCancel={(event) => endDrag(event, false)}
                onLostPointerCapture={() => {
                  window.removeEventListener("keydown", cancelOnEscape);
                  cancelDunceDrag();
                }}
                onClick={(event) => {
                  // Pointer clicks already explained on release; this is Enter or Space.
                  if (event.detail !== 0 || streaming) return;
                  explainFromHat({
                    threadKey,
                    threadRef,
                    messages: getMessages(),
                    messageId,
                    extendRange: event.shiftKey,
                  });
                }}
              />
            }
          >
            <DunceCapIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="left">{label}</TooltipPopup>
        </Tooltip>
      </div>
    </>
  );
}

export function PlainEnglishCardSlot({ messageId }: { readonly messageId: MessageId }) {
  const ctx = use(TimelineRowCtx);
  const threadKey = ctx.routeThreadKey;
  const card = useDunceModeStore((state) => {
    const candidate = state.cards[threadKey];
    return candidate?.anchorMessageId === messageId ? candidate : null;
  });
  if (card === null || ctx.dunceMessages === null) return null;
  const count = card.messageIds.length;

  return (
    <section
      aria-label="Plain English explanation"
      className="mx-1 mt-2 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-3"
    >
      <header className="flex items-center gap-2 text-muted-foreground text-xs">
        <DunceCapIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="font-medium text-foreground">Plain English</span>
        <span className="tabular-nums">
          {count === 1 ? "1 message" : `${count} messages`}
          {card.capped ? ` (the first ${PLAIN_LANGUAGE_MAX_MESSAGES} you selected)` : ""}
        </span>
        <span className="ms-auto flex items-center gap-0.5">
          {card.result.status === "ready" ? (
            <MessageCopyButton
              text={card.result.explanation}
              label="Copy explanation"
              size="icon-xs"
              variant="ghost"
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Close explanation"
                  onClick={() => closePlainEnglishCard(threadKey)}
                />
              }
            >
              <XIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup>Close</TooltipPopup>
          </Tooltip>
        </span>
      </header>
      {card.result.status === "loading" ? (
        <div
          role="status"
          aria-label="Writing a plain English explanation"
          className="space-y-2 pt-3"
        >
          <Skeleton shape="pill" className="h-2.5 w-11/12" />
          <Skeleton shape="pill" className="h-2.5 w-4/5" />
          <Skeleton shape="pill" className="h-2.5 w-3/5" />
        </div>
      ) : null}
      {card.result.status === "ready" ? (
        <div className="pt-1">
          <ChatMarkdown
            text={card.result.explanation}
            cwd={ctx.markdownCwd}
            threadRef={ctx.threadRef ?? undefined}
          />
        </div>
      ) : null}
      {card.result.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 pt-2 text-sm">
          <p className="min-w-0 flex-1 text-destructive-foreground">{card.result.message}</p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => retryPlainEnglishCard(threadKey)}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </section>
  );
}
