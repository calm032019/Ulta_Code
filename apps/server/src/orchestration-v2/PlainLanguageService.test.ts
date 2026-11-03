import { assert, describe, it, vi } from "@effect/vitest";
import {
  MessageId,
  TextGenerationError,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import { defaultTextGenerationModel } from "@t3tools/shared/serverSettings";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PlainLanguageService from "./PlainLanguageService.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const threadId = ThreadId.make("thread:plain-language");
const projectId = ProjectId.make("project:plain-language");
const titleModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4-mini" } as const;
const claude = ProviderInstanceId.make("claudeAgent");

const provider = (
  instanceId: ProviderInstanceId,
  auth: ServerProvider["auth"]["status"],
): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make(instanceId),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: auth },
  checkedAt: "2026-11-03T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
});

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

type ExplainPlainLanguage = TextGeneration.TextGeneration["Service"]["explainPlainLanguage"];

function makeHarness(
  generate: ExplainPlainLanguage = () =>
    Effect.succeed({ explanation: "The automatic checks failed." }),
  options: {
    readonly threadProvider?: ProviderInstanceId;
    readonly providers?: ReadonlyArray<ServerProvider>;
  } = {},
) {
  const explainPlainLanguage = vi.fn<ExplainPlainLanguage>(generate);
  const getThreadRecords = vi.fn(
    (
      _threadId: ThreadId,
      _fields: ReadonlyArray<string>,
      filter?: { messageIds?: ReadonlyArray<MessageId>; messageRoles?: ReadonlyArray<string> },
    ) =>
      Effect.succeed({
        thread: {
          projectId,
          worktreePath: null,
          providerInstanceId: options.threadProvider ?? titleModel.instanceId,
        },
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
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed(options.providers ?? []),
        }),
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

  it.effect("explains a Claude thread with Claude when Codex is signed out", () => {
    const harness = makeHarness(undefined, {
      threadProvider: claude,
      providers: [provider(titleModel.instanceId, "unauthenticated"), provider(claude, "unknown")],
    });
    return Effect.gen(function* () {
      yield* explain(["m1"]);

      assert.deepInclude(harness.explainPlainLanguage.mock.calls[0]?.[0].modelSelection, {
        instanceId: claude,
        model: defaultTextGenerationModel(ProviderDriverKind.make("claudeAgent")),
      });
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

  it.effect("keeps the provider and its message but not its cause", () => {
    const harness = makeHarness(() =>
      Effect.fail(
        new TextGenerationError({
          operation: "explainPlainLanguage",
          detail: "Claude CLI command failed: Please run /login",
          cause: new Error("raw stdout"),
        }),
      ),
    );
    return Effect.gen(function* () {
      const error = yield* explain(["m1"]).pipe(Effect.flip);

      assert.strictEqual(error.message, "Claude CLI command failed: Please run /login");
      assert.strictEqual(error.providerInstanceId, titleModel.instanceId);
      assert.notProperty(error, "cause");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("generates at most two explanations at once", () =>
    Effect.gen(function* () {
      const started = yield* Queue.unbounded<void>();
      const release = yield* Deferred.make<void>();
      let active = 0;
      let peak = 0;
      const harness = makeHarness(() =>
        Effect.gen(function* () {
          active++;
          peak = Math.max(peak, active);
          yield* Queue.offer(started, undefined);
          yield* Deferred.await(release);
          active--;
          return { explanation: "done" };
        }),
      );
      yield* Effect.gen(function* () {
        const fibers = yield* Effect.forEach([1, 2, 3], () => Effect.forkChild(explain(["m1"])));
        yield* Queue.take(started);
        yield* Queue.take(started);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.joinAll(fibers);
      }).pipe(Effect.provide(harness.layer));

      assert.strictEqual(peak, 2);
      assert.strictEqual(harness.explainPlainLanguage.mock.calls.length, 3);
    }),
  );
});
