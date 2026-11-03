import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import {
  isProviderTextGenerationCapable,
  isProviderUsable,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import {
  defaultTextGenerationModel,
  fallbackTextGenerationModelSelection,
} from "@t3tools/shared/serverSettings";
import * as ServerSettings from "../serverSettings.ts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";

export type {
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ReviewGuideGenerationInput,
  ReviewGuideGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateReviewGuide"
  | "explainPlainLanguage";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

const AUTH_FAILURE_PATTERN =
  /\b401\b|unauthori[sz]ed|unauthenticated|not (?:logged|signed) in|log ?in again|run \/login|invalid api key|expired (?:token|session|credentials)/i;

const looksLikeAuthFailure = (error: TextGenerationError): boolean =>
  AUTH_FAILURE_PATTERN.test(error.detail) ||
  (error.cause instanceof Error && AUTH_FAILURE_PATTERN.test(error.cause.message));

// Review guides investigate the checkout read-only; the other drivers reject that request.
const INVESTIGATING_DRIVERS = new Set(["codex", "claudeAgent"]);

/** @public */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const listSnapshots = registry.listInstances.pipe(
    Effect.flatMap((instances) =>
      Effect.forEach(instances, (instance) => instance.snapshot.getSnapshot),
    ),
  );
  const fallbackFor = Effect.fn("TextGeneration.fallbackFor")(function* (
    operation: TextGenerationOp,
    selection: ModelSelection,
    snapshots: ReadonlyArray<ServerProvider>,
    now: number,
  ) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "Could not read fallback model settings.",
            cause,
          }),
      ),
    );
    return fallbackTextGenerationModelSelection(
      settings.providerInstances,
      (instanceId, driver) => {
        const provider = snapshots.find((candidate) => candidate.instanceId === instanceId);
        return (
          instanceId !== selection.instanceId &&
          provider !== undefined &&
          provider.installed &&
          isProviderUsable(provider) &&
          resolveProjectProviderInstanceEnabled(settings, null, instanceId) &&
          isProviderTextGenerationCapable(provider) &&
          (operation !== "generateReviewGuide" || INVESTIGATING_DRIVERS.has(driver)) &&
          !exhaustedUsageWindow(provider, now, defaultTextGenerationModel(driver))
        );
      },
      { includeConfiguredInstances: true },
    );
  });
  const generate = Effect.fn("TextGeneration.generate")(function* <A>(
    operation: TextGenerationOp,
    selection: ModelSelection,
    invoke: (
      service: ProviderTextGeneration,
      modelSelection: ModelSelection,
    ) => Effect.Effect<A, TextGenerationError>,
  ) {
    const snapshots = yield* listSnapshots;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const chosen = snapshots.find((provider) => provider.instanceId === selection.instanceId);
    if (
      (chosen !== undefined &&
        (!isProviderUsable(chosen) || !isProviderTextGenerationCapable(chosen))) ||
      exhaustedUsageWindow(chosen, now, selection.model)
    ) {
      selection = (yield* fallbackFor(operation, selection, snapshots, now)) ?? selection;
    }
    const attempted = selection;
    return yield* resolveInstance(registry, operation, attempted.instanceId).pipe(
      Effect.flatMap((service) => invoke(service, attempted)),
      Effect.catch((error) =>
        // A cached snapshot can still say "authenticated" after the login expired.
        Effect.gen(function* () {
          if (!looksLikeAuthFailure(error)) return yield* error;
          const instance = yield* registry.getInstance(attempted.instanceId);
          const refreshed = instance ? yield* instance.snapshot.refresh : undefined;
          if (refreshed === undefined || isProviderUsable(refreshed)) return yield* error;
          const fallback = yield* fallbackFor(
            operation,
            attempted,
            snapshots.map((provider) =>
              provider.instanceId === refreshed.instanceId ? refreshed : provider,
            ),
            now,
          );
          if (fallback === null) return yield* error;
          return yield* resolveInstance(registry, operation, fallback.instanceId).pipe(
            Effect.flatMap((service) => invoke(service, fallback)),
          );
        }),
      ),
    );
  });
  return TextGeneration.of({
    generateCommitMessage: Effect.fn("TextGeneration.generateCommitMessage")(function (input) {
      return generate("generateCommitMessage", input.modelSelection, (service, modelSelection) =>
        service.generateCommitMessage({ ...input, modelSelection }),
      );
    }),
    generatePrContent: Effect.fn("TextGeneration.generatePrContent")(function (input) {
      return generate("generatePrContent", input.modelSelection, (service, modelSelection) =>
        service.generatePrContent({ ...input, modelSelection }),
      );
    }),
    generateBranchName: Effect.fn("TextGeneration.generateBranchName")(function (input) {
      return generate("generateBranchName", input.modelSelection, (service, modelSelection) =>
        service.generateBranchName({ ...input, modelSelection }),
      );
    }),
    generateReviewGuide: Effect.fn("TextGeneration.generateReviewGuide")(function (input) {
      return generate("generateReviewGuide", input.modelSelection, (service, modelSelection) =>
        service.generateReviewGuide({ ...input, modelSelection }),
      );
    }),
    explainPlainLanguage: Effect.fn("TextGeneration.explainPlainLanguage")(function (input) {
      return generate("explainPlainLanguage", input.modelSelection, (service, modelSelection) =>
        service.explainPlainLanguage({ ...input, modelSelection }),
      );
    }),
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function (input) {
      return generate(
        "generateThreadTitle",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          Effect.gen(function* () {
            const linkedContext =
              input.linkedContext ??
              (yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
                Effect.provideService(
                  SourceControlProviderRegistry.SourceControlProviderRegistry,
                  sourceControl,
                ),
              ));
            return yield* textGeneration.generateThreadTitle({
              ...input,
              linkedContext,
              modelSelection,
            });
          }),
      );
    }),
  });
});

export const layer = Layer.effect(TextGeneration, make);
