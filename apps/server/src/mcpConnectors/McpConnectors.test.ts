import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpConnectors from "./McpConnectors.ts";

const cursor = {
  instanceId: ProviderInstanceId.make("cursor"),
  driver: ProviderDriverKind.make("cursor"),
  status: "ready",
  enabled: true,
  installed: true,
  auth: { status: "authenticated" },
  checkedAt: "2026-04-14T00:00:00.000Z",
  version: null,
  models: [],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;

const mcpJson = (name: string) =>
  JSON.stringify({ mcpServers: { [name]: { url: "https://x.dev/mcp" } } });

describe("McpConnectors", () => {
  it.effect(
    "reads resolved files, skips links out of a project, and shares concurrent passes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        const home = path.join(dir, "home");
        const project = path.join(dir, "project");
        const broken = path.join(dir, "broken");
        yield* fs.makeDirectory(path.join(home, ".cursor"), { recursive: true });
        yield* fs.makeDirectory(path.join(project, ".cursor"), { recursive: true });
        yield* fs.makeDirectory(path.join(broken, ".cursor"), { recursive: true });
        yield* fs.writeFileString(path.join(broken, ".cursor", "mcp.json"), "{ nope");
        yield* fs.writeFileString(path.join(dir, "dotfiles.json"), mcpJson("dotfiles"));
        yield* fs.symlink(path.join(dir, "dotfiles.json"), path.join(home, ".cursor", "mcp.json"));
        yield* fs.writeFileString(path.join(dir, "outside.json"), mcpJson("outside"));
        yield* fs.symlink(
          path.join(dir, "outside.json"),
          path.join(project, ".cursor", "mcp.json"),
        );

        let providerReads = 0;
        const layer = McpConnectors.layer.pipe(
          Layer.provide(
            Layer.mock(ProviderRegistry.ProviderRegistry)({
              getProviders: Effect.sync(() => {
                providerReads += 1;
                return [cursor];
              }),
            }),
          ),
          Layer.provide(
            Layer.mock(ProjectStore.ProjectStoreV2)({
              listShells: () =>
                Effect.succeed(
                  [project, broken].map((workspaceRoot, index) => ({
                    id: ProjectId.make(`project-${index}`),
                    title: `Project ${index}`,
                    workspaceRoot,
                    defaultModelSelection: null,
                    scripts: [],
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  })),
                ),
            }),
          ),
          Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
        );

        const [first, second, later] = yield* Effect.gen(function* () {
          const connectors = yield* McpConnectors.McpConnectors;
          const shared = yield* Effect.all([connectors.list, connectors.list], { concurrency: 2 });
          return [...shared, yield* connectors.list] as const;
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(HostProcess.HomeDirectory, home),
          Effect.provideService(HostProcess.Environment, {}),
        );

        assert.strictEqual(providerReads, 2);
        assert.strictEqual(first, second);
        assert.deepStrictEqual(
          first.connectors.map((connector) => connector.name),
          ["dotfiles"],
        );
        for (const result of [first, later]) {
          assert.deepStrictEqual(result.issues.map((issue) => issue.message).toSorted(), [
            "Could not parse this file. Fix the syntax, then refresh.",
            "Points outside its project, so it was skipped.",
          ]);
        }
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("a refresh after a pass has started gets its own later pass", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const configPath = path.join(home, ".cursor", "mcp.json");
      yield* fs.makeDirectory(path.join(home, ".cursor"), { recursive: true });
      yield* fs.writeFileString(configPath, mcpJson("before"));

      const firstPassStarted = yield* Deferred.make<void>();
      const releaseFirstPass = yield* Deferred.make<void>();
      let providerReads = 0;
      const layer = McpConnectors.layer.pipe(
        Layer.provide(
          Layer.mock(ProviderRegistry.ProviderRegistry)({
            getProviders: Effect.suspend(() => {
              providerReads += 1;
              return providerReads > 1
                ? Effect.succeed([cursor])
                : Deferred.succeed(firstPassStarted, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseFirstPass)),
                    Effect.as([cursor]),
                  );
            }),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
        ),
        Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
      );

      const [stale, fresh, sharesFresh] = yield* Effect.gen(function* () {
        const connectors = yield* McpConnectors.McpConnectors;
        const first = yield* Effect.forkChild(connectors.list);
        yield* Deferred.await(firstPassStarted);
        yield* fs.writeFileString(configPath, mcpJson("after"));
        const second = yield* Effect.forkChild(connectors.list);
        const third = yield* Effect.forkChild(connectors.list);
        yield* Deferred.succeed(releaseFirstPass, undefined);
        return [
          yield* Fiber.join(first),
          yield* Fiber.join(second),
          yield* Fiber.join(third),
        ] as const;
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(HostProcess.HomeDirectory, home),
        Effect.provideService(HostProcess.Environment, {}),
      );

      // The gate sits before any file is read, so the first pass may see either version. What
      // matters is that later callers get one shared pass that starts after their request.
      assert.include(["before", "after"], stale.connectors[0]?.name);
      assert.deepStrictEqual(
        fresh.connectors.map((connector) => connector.name),
        ["after"],
      );
      assert.strictEqual(fresh, sharesFresh);
      assert.strictEqual(providerReads, 2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
