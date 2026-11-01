import { assert, describe, it, vi } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PlainLanguageService from "./PlainLanguageService.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const threadId = ThreadId.make("thread:plain-language");
const projectId = ProjectId.make("project:plain-language");
const titleModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4-mini" } as const;

const message = (id: string, role: "user" | "assistant" | "system", text: string) =>
  ({ id: MessageId.make(id), threadId, role, text, streaming: false }) as Pick<
    OrchestrationV2ConversationMessage,
    "id" | "threadId" | "role" | "text" | "streaming"
  >;

const stored = [
  message("m1", "user", "Why is CI red?"),
  message("m2", "assistant", "The lint step failed on an unused import."),
  message("m3", "system", "internal"),
];

function makeHarness() {
  const explainPlainLanguage = vi.fn<
    TextGeneration.TextGeneration["Service"]["explainPlainLanguage"]
  >(() => Effect.succeed({ explanation: "The automatic checks failed." }));
  const getThreadRecords = vi.fn(
    (
      _threadId: ThreadId,
      _fields: ReadonlyArray<string>,
      filter?: { messageIds?: ReadonlyArray<MessageId>; messageRoles?: ReadonlyArray<string> },
    ) =>
      Effect.succeed({
        thread: { projectId, worktreePath: null },
        messages: stored.filter(
          (candidate) =>
            (filter?.messageIds?.includes(candidate.id) ?? true) &&
            (filter?.messageRoles?.includes(candidate.role) ?? true),
        ),
      } as never),
  );
  const layer = PlainLanguageService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({ getThreadRecords }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () => Effect.succeedSome({ workspaceRoot: "/repo" } as never),
        }),
        Layer.mock(TextGeneration.TextGeneration)({ explainPlainLanguage }),
        ServerSettings.layerTest({ textGenerationModelSelection: titleModel }),
      ),
    ),
  );
  return { layer, explainPlainLanguage, getThreadRecords };
}

const explain = (messageIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const service = yield* PlainLanguageService.PlainLanguageService;
    return yield* service.explain({
      threadId,
      messageIds: messageIds.map((id) => MessageId.make(id)),
    });
  });

describe("PlainLanguageService", () => {
  it.effect("explains the stored text with the thread title model in the workspace", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const result = yield* explain(["m2", "m1"]);

      assert.deepStrictEqual(result, { explanation: "The automatic checks failed." });
      const call = harness.explainPlainLanguage.mock.calls[0]?.[0];
      assert.deepStrictEqual(call?.messages, [
        { role: "user", text: "Why is CI red?" },
        { role: "assistant", text: "The lint step failed on an unused import." },
      ]);
      assert.strictEqual(call?.cwd, "/repo");
      assert.deepInclude(call?.modelSelection, titleModel);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects more than 20 messages before loading anything", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const error = yield* explain(Array.from({ length: 21 }, (_, index) => `m${index}`)).pipe(
        Effect.flip,
      );

      assert.strictEqual(error._tag, "PlainLanguageExplainError");
      assert.strictEqual(harness.getThreadRecords.mock.calls.length, 0);
      assert.strictEqual(harness.explainPlainLanguage.mock.calls.length, 0);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects messages that are not this thread's user or agent messages", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      for (const ids of [["m1", "other-thread-message"], ["m3"]]) {
        const error = yield* explain(ids).pipe(Effect.flip);
        assert.strictEqual(error.message, "Some of these messages are not in this thread.");
      }
      assert.strictEqual(harness.explainPlainLanguage.mock.calls.length, 0);
    }).pipe(Effect.provide(harness.layer));
  });
});
