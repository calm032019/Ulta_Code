import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { DunceMessage } from "./dunceModeStore";

type Options = { readonly signal: AbortSignal };
const { signals } = vi.hoisted(() => ({ signals: [] as AbortSignal[] }));
vi.mock("../../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../../state/orchestration", () => ({
  orchestrationEnvironment: { explainPlainLanguage: {} },
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: (_registry: unknown, _command: unknown, _input: unknown, options: Options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  },
  isAtomCommandInterrupted: () => false,
  squashAtomCommandFailure: () => null,
}));

const threadKey = "environment-1:thread-1";
const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const messages: ReadonlyArray<DunceMessage> = ["m1", "m2"].map((id) => ({
  id: MessageId.make(id),
  updatedAt: "2026-01-01T00:00:00.000Z",
  streaming: false,
}));

async function setup() {
  signals.length = 0;
  vi.resetModules();
  const store = await import("./dunceModeStore");
  return {
    store,
    clickHat: (id: string) =>
      store.explainFromHat({
        threadKey,
        threadRef,
        messages,
        messageId: MessageId.make(id),
        extendRange: false,
      }),
  };
}

describe("dunce mode explanations", () => {
  it("reuses a loading request and cancels it when the card is replaced or closed", async () => {
    const { store, clickHat } = await setup();

    clickHat("m1");
    clickHat("m1");
    expect(signals).toHaveLength(1);

    clickHat("m2");
    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);

    store.closePlainEnglishCard(threadKey);
    expect(signals[1]?.aborted).toBe(true);
  });
});
