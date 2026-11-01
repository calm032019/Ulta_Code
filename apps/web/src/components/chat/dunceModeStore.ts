import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { orchestrationEnvironment } from "../../state/orchestration";
import { selectMessageRange } from "./dunceMode.logic";

export interface DunceMessage {
  readonly id: MessageId;
  readonly updatedAt: string;
  readonly streaming: boolean;
}

export interface PlainEnglishCard {
  readonly key: string;
  readonly threadRef: ScopedThreadRef;
  readonly messageIds: ReadonlyArray<MessageId>;
  readonly anchorMessageId: MessageId;
  readonly capped: boolean;
  readonly result:
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly explanation: string }
    | { readonly status: "error"; readonly message: string };
}

interface DunceDrag {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly messages: ReadonlyArray<DunceMessage>;
  readonly anchorId: MessageId;
  readonly selected: ReadonlySet<string>;
  readonly capped: boolean;
}

interface DunceModeState {
  readonly drag: DunceDrag | null;
  /** The hat last pressed in each thread, where a Shift+click range starts. */
  readonly rangeAnchors: Readonly<Record<string, MessageId>>;
  readonly cards: Readonly<Record<string, PlainEnglishCard>>;
}

export const useDunceModeStore = create<DunceModeState>(() => ({
  drag: null,
  rangeAnchors: {},
  cards: {},
}));

const explanations = new Map<string, string>();

export function isDunceMessageSelected(
  state: DunceModeState,
  threadKey: string,
  messageId: string,
): boolean {
  if (state.drag?.threadKey === threadKey) return state.drag.selected.has(messageId);
  return state.cards[threadKey]?.messageIds.includes(messageId as MessageId) ?? false;
}

function explainable(messages: ReadonlyArray<DunceMessage>) {
  return messages.filter((message) => !message.streaming);
}

function rangeOf(messages: ReadonlyArray<DunceMessage>, anchorId: string, currentId: string) {
  const range = selectMessageRange(
    messages.map((message) => message.id),
    anchorId,
    currentId,
  );
  return { ...range, selected: new Set(range.ids) };
}

export function startDunceDrag(input: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly messages: ReadonlyArray<DunceMessage>;
  readonly anchorId: MessageId;
}) {
  const messages = explainable(input.messages);
  const { selected, capped } = rangeOf(messages, input.anchorId, input.anchorId);
  useDunceModeStore.setState((state) => ({
    drag: { ...input, messages, selected, capped },
    rangeAnchors: { ...state.rangeAnchors, [input.threadKey]: input.anchorId },
  }));
}

export function extendDunceDrag(messageId: string) {
  const drag = useDunceModeStore.getState().drag;
  if (drag === null || !drag.messages.some((message) => message.id === messageId)) return;
  const { selected, capped } = rangeOf(drag.messages, drag.anchorId, messageId);
  if (selected.size === drag.selected.size && [...selected].every((id) => drag.selected.has(id))) {
    return;
  }
  useDunceModeStore.setState({ drag: { ...drag, selected, capped } });
}

export function cancelDunceDrag() {
  if (useDunceModeStore.getState().drag !== null) useDunceModeStore.setState({ drag: null });
}

export function finishDunceDrag() {
  const drag = useDunceModeStore.getState().drag;
  if (drag === null) return;
  useDunceModeStore.setState({ drag: null });
  explainMessages({
    threadKey: drag.threadKey,
    threadRef: drag.threadRef,
    messages: drag.messages.filter((message) => drag.selected.has(message.id)),
    capped: drag.capped,
  });
}

/** Explains one message, or with `extendRange` the run from the thread's last pressed hat. */
export function explainFromHat(input: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly messages: ReadonlyArray<DunceMessage>;
  readonly messageId: MessageId;
  readonly extendRange: boolean;
}) {
  const messages = explainable(input.messages);
  const anchor = input.extendRange
    ? (useDunceModeStore.getState().rangeAnchors[input.threadKey] ?? input.messageId)
    : input.messageId;
  const { selected, capped } = rangeOf(messages, anchor, input.messageId);
  if (!input.extendRange) {
    useDunceModeStore.setState((state) => ({
      rangeAnchors: { ...state.rangeAnchors, [input.threadKey]: input.messageId },
    }));
  }
  explainMessages({
    threadKey: input.threadKey,
    threadRef: input.threadRef,
    messages: messages.filter((message) => selected.has(message.id)),
    capped,
  });
}

function explainMessages(input: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly messages: ReadonlyArray<DunceMessage>;
  readonly capped: boolean;
}) {
  const last = input.messages.at(-1);
  if (last === undefined) return;
  const key = [
    input.threadKey,
    ...input.messages.map((message) => `${message.id}@${message.updatedAt}`),
  ].join("\n");
  const cached = explanations.get(key);
  const card: PlainEnglishCard = {
    key,
    threadRef: input.threadRef,
    messageIds: input.messages.map((message) => message.id),
    anchorMessageId: last.id,
    capped: input.capped,
    result: cached === undefined ? { status: "loading" } : { status: "ready", explanation: cached },
  };
  useDunceModeStore.setState((state) => ({ cards: { ...state.cards, [input.threadKey]: card } }));
  if (cached === undefined) void request(input.threadKey, card);
}

async function request(threadKey: string, card: PlainEnglishCard) {
  const result = await runAtomCommand(
    appAtomRegistry,
    orchestrationEnvironment.explainPlainLanguage,
    {
      environmentId: card.threadRef.environmentId,
      input: { threadId: card.threadRef.threadId, messageIds: card.messageIds },
    },
    { reportFailure: false },
  );
  if (result._tag === "Success") explanations.set(card.key, result.value.explanation);
  const current = useDunceModeStore.getState().cards[threadKey];
  if (current?.key !== card.key) return;
  const error =
    result._tag === "Failure" && !isAtomCommandInterrupted(result)
      ? squashAtomCommandFailure(result)
      : null;
  const next: PlainEnglishCard = {
    ...current,
    result:
      result._tag === "Success"
        ? { status: "ready", explanation: result.value.explanation }
        : {
            status: "error",
            message:
              error instanceof Error && error.message
                ? error.message
                : "Could not explain these messages.",
          },
  };
  useDunceModeStore.setState((state) => ({ cards: { ...state.cards, [threadKey]: next } }));
}

export function retryPlainEnglishCard(threadKey: string) {
  const card = useDunceModeStore.getState().cards[threadKey];
  if (card === undefined || card.result.status !== "error") return;
  const loading: PlainEnglishCard = { ...card, result: { status: "loading" } };
  useDunceModeStore.setState((state) => ({ cards: { ...state.cards, [threadKey]: loading } }));
  void request(threadKey, loading);
}

export function closePlainEnglishCard(threadKey: string) {
  useDunceModeStore.setState((state) => {
    const { [threadKey]: _closed, ...cards } = state.cards;
    return { cards };
  });
}
