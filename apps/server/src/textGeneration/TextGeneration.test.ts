import { assert, describe, it, vi } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  TextGenerationError,
} from "@t3tools/contracts";
import { defaultTextGenerationModel } from "@t3tools/shared/serverSettings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TextGeneration from "./TextGeneration.ts";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");

const snapshot = (
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

type Explain = TextGeneration.TextGeneration["Service"]["explainPlainLanguage"];

function makeInstance(
  current: ServerProvider,
  explain: Explain,
  refreshed: ServerProvider = current,
) {
  const explainPlainLanguage = vi.fn<Explain>(explain);
  const refresh = vi.fn(() => Effect.succeed(refreshed));
  return {
    explainPlainLanguage,
    refresh,
    instance: {
      instanceId: current.instanceId,
      snapshot: { getSnapshot: Effect.succeed(current), refresh: Effect.suspend(refresh) },
      textGeneration: { explainPlainLanguage },
    } as never,
  };
}

function makeLayer(instances: ReadonlyArray<ReturnType<typeof makeInstance>>) {
  const byId = new Map(
    instances.map((entry) => [(entry.instance as { instanceId: string }).instanceId, entry]),
  );
  return TextGeneration.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: (id) => Effect.succeed(byId.get(id)?.instance),
          listInstances: Effect.succeed(instances.map((entry) => entry.instance)),
        }),
        Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
          resolveLink: () => Effect.die("unused"),
        }),
        ServerSettings.layerTest(),
      ),
    ),
  );
}

const explain = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration.TextGeneration;
  return yield* textGeneration.explainPlainLanguage({
    cwd: "/repo",
    messages: [{ role: "assistant", text: "Done." }],
    modelSelection: { instanceId: codex, model: "gpt-5.4-mini" },
  });
});

const succeed: Explain = () => Effect.succeed({ explanation: "ok" });

describe("TextGeneration", () => {
  it.effect("skips a chosen provider that is not signed in", () => {
    const signedOut = makeInstance(snapshot(codex, "unauthenticated"), succeed);
    const fallback = makeInstance(snapshot(claude, "authenticated"), succeed);
    return Effect.gen(function* () {
      yield* explain;

      assert.strictEqual(signedOut.explainPlainLanguage.mock.calls.length, 0);
      assert.deepInclude(fallback.explainPlainLanguage.mock.calls[0]?.[0].modelSelection, {
        instanceId: claude,
        model: defaultTextGenerationModel(ProviderDriverKind.make("claudeAgent")),
      });
    }).pipe(Effect.provide(makeLayer([signedOut, fallback])));
  });

  it.effect("rechecks sign-in after an auth failure and retries once elsewhere", () => {
    const expired = makeInstance(
      snapshot(codex, "authenticated"),
      () =>
        Effect.fail(
          new TextGenerationError({
            operation: "explainPlainLanguage",
            detail: "401 Unauthorized",
          }),
        ),
      snapshot(codex, "unauthenticated"),
    );
    const fallback = makeInstance(snapshot(claude, "authenticated"), succeed);
    return Effect.gen(function* () {
      const result = yield* explain;

      assert.deepStrictEqual(result, { explanation: "ok" });
      assert.strictEqual(expired.refresh.mock.calls.length, 1);
      assert.strictEqual(fallback.explainPlainLanguage.mock.calls.length, 1);
    }).pipe(Effect.provide(makeLayer([expired, fallback])));
  });

  it.effect("keeps other failures without rechecking the provider", () => {
    const failing = makeInstance(snapshot(codex, "authenticated"), () =>
      Effect.fail(
        new TextGenerationError({ operation: "explainPlainLanguage", detail: "Invalid JSON" }),
      ),
    );
    const fallback = makeInstance(snapshot(claude, "authenticated"), succeed);
    return Effect.gen(function* () {
      const error = yield* explain.pipe(Effect.flip);

      assert.strictEqual(error.detail, "Invalid JSON");
      assert.strictEqual(failing.refresh.mock.calls.length, 0);
      assert.strictEqual(fallback.explainPlainLanguage.mock.calls.length, 0);
    }).pipe(Effect.provide(makeLayer([failing, fallback])));
  });
});
