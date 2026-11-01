import {
  PLAIN_LANGUAGE_MAX_MESSAGES,
  PlainLanguageExplainError,
  type PlainLanguageExplainInput,
  type PlainLanguageExplainResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export class PlainLanguageService extends Context.Service<
  PlainLanguageService,
  {
    readonly explain: (
      input: PlainLanguageExplainInput,
    ) => Effect.Effect<PlainLanguageExplainResult, PlainLanguageExplainError>;
  }
>()("t3/orchestration-v2/PlainLanguageService") {}

const fail = (message: string, cause?: unknown) =>
  Effect.fail(
    new PlainLanguageExplainError({ message, ...(cause === undefined ? {} : { cause }) }),
  );

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const explain: PlainLanguageService["Service"]["explain"] = Effect.fn(
    "PlainLanguageService.explain",
  )(function* (input) {
    const messageIds = [...new Set(input.messageIds)];
    if (messageIds.length === 0) {
      return yield* fail("Choose at least one message to explain.");
    }
    if (messageIds.length > PLAIN_LANGUAGE_MAX_MESSAGES) {
      return yield* fail(
        `You can explain up to ${PLAIN_LANGUAGE_MAX_MESSAGES} messages at a time.`,
      );
    }

    const loaded = yield* Effect.gen(function* () {
      const records = yield* threads.getThreadRecords(input.threadId, ["messages"], {
        messageIds,
        messageRoles: ["user", "assistant"],
      });
      const project = yield* projects.get(records.thread.projectId);
      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        records.thread.projectId,
      ).settings;
      return { records, project, settings };
    }).pipe(Effect.catch((cause) => fail("Could not load these messages.", cause)));

    const { records, project, settings } = loaded;
    if (records.messages.length !== messageIds.length) {
      return yield* fail("Some of these messages are not in this thread.");
    }
    if (records.messages.some((message) => message.streaming)) {
      return yield* fail("Wait for the message to finish before explaining it.");
    }
    const messages = records.messages.flatMap((message) =>
      message.role === "system" || message.text.trim().length === 0
        ? []
        : [{ role: message.role, text: message.text }],
    );
    if (messages.length === 0) {
      return yield* fail("These messages have no text to explain.");
    }

    const cwd =
      records.thread.worktreePath ??
      Option.match(project, { onNone: () => null, onSome: (row) => row.workspaceRoot });
    if (cwd === null) {
      return yield* fail("This thread's project is no longer available.");
    }

    return yield* textGeneration
      .explainPlainLanguage({
        cwd,
        messages,
        modelSelection: settings.textGenerationModelSelection,
      })
      .pipe(Effect.catch((error) => fail(error.detail, error)));
  });

  return PlainLanguageService.of({ explain });
});

export const layer = Layer.effect(PlainLanguageService, make);
