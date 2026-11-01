// @effect-diagnostics nodeBuiltinImport:off - FileSystem does not expose no-follow
// or non-blocking open flags, and the read must use the descriptor it checked.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";

import {
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type McpConnector,
  type McpConnectorConfigIssue,
  type McpConnectorProject,
  type McpConnectorProviderUse,
  type McpConnectorScope,
  type McpConnectorsResult,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  configFileSkipReason,
  describeConfigParseError,
  parseClaudeUserConfig,
  parseCodexConfig,
  parseMcpJsonFile,
  parseOpenCodeConfig,
  type ParsedMcpServer,
} from "./mcpConnectorConfig.ts";

export class McpConnectors extends Context.Service<
  McpConnectors,
  {
    readonly list: Effect.Effect<McpConnectorsResult>;
  }
>()("t3/mcpConnectors/McpConnectors") {}

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");
const CURSOR = ProviderDriverKind.make("cursor");
const OPENCODE = ProviderDriverKind.make("opencode");

const SCOPE_ORDER: Record<McpConnectorScope, number> = { user: 0, local: 1, project: 2 };

// Repos ship project configs, so they get a tight cap; ~/.claude.json holds history and can be large.
const PROJECT_CONFIG_MAX_BYTES = 1024 * 1024;
const USER_CONFIG_MAX_BYTES = 64 * 1024 * 1024;

// The file is opened by its resolved path, so legitimate symlinks are already followed.
// Windows lacks these flags.
const OPEN_FLAGS =
  NodeFS.constants.O_RDONLY |
  (NodeFS.constants.O_NOFOLLOW ?? 0) |
  (NodeFS.constants.O_NONBLOCK ?? 0);

/** Reads at most `maxBytes + 1` bytes, so a file that grew past the cap is detectable. */
async function readUpTo(handle: NodeFSP.FileHandle, size: number, maxBytes: number) {
  const buffer = Buffer.alloc(Math.min(size, maxBytes) + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

const errorCode = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;

type CachedParse =
  | { readonly stamp: string; readonly value: unknown }
  | { readonly stamp: string; readonly error: string };

interface FoundServers {
  readonly scope: McpConnectorScope;
  readonly project: McpConnectorProject | null;
  readonly configPath: string;
  readonly servers: ReadonlyArray<ParsedMcpServer>;
}

function instanceHomeSetting(
  entry: ProviderInstanceConfig | undefined,
  variable: string,
  hostEnvironment: NodeJS.ProcessEnv,
): string | undefined {
  const config = entry?.config;
  if (typeof config === "object" && config !== null && "homePath" in config) {
    const homePath = config.homePath;
    if (typeof homePath === "string" && homePath.trim() !== "") return homePath.trim();
  }
  const fromInstance = entry?.environment?.find((item) => item.name === variable)?.value;
  if (typeof fromInstance === "string" && fromInstance.trim() !== "") return fromInstance.trim();
  const inherited = hostEnvironment[variable]?.trim();
  return inherited === undefined || inherited === "" ? undefined : inherited;
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  // Parse results by parser and path, reused until the file's size or modified time changes.
  const parsedConfigCache = new Map<string, CachedParse>();
  let inFlight: Deferred.Deferred<McpConnectorsResult> | undefined;

  const scan = Effect.gen(function* () {
    const home = yield* HostProcess.HomeDirectory;
    const hostEnvironment = yield* HostProcess.Environment;
    const providers = yield* providerRegistry.getProviders;
    const settings = yield* serverSettings.getSettings.pipe(Effect.option);
    const projects = (yield* projectStore.listShells().pipe(Effect.orElseSucceed(() => [])))
      .filter((project) => project.archivedAt == null)
      .map((project): McpConnectorProject => ({
        id: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
      }));
    const issues: McpConnectorConfigIssue[] = [];
    const visitedCacheKeys = new Set<string>();
    const resolve = (value: string) => path.resolve(expandHomePath(value, home));
    const realRoots = new Map(
      yield* Effect.forEach(
        projects,
        ({ workspaceRoot }) =>
          fileSystem.realPath(workspaceRoot).pipe(
            Effect.orElseSucceed(() => workspaceRoot),
            Effect.map((real) => [workspaceRoot, real] as const),
          ),
        { concurrency: 8 },
      ),
    );

    // Skips non-regular files, files over the cap, and project files resolving outside the
    // project, so a cloned repo cannot point discovery at a device, a huge file, or elsewhere.
    // The resolved path is checked, then opened once without following links, so a swap after
    // the check cannot redirect the read.
    const load = Effect.fn("McpConnectors.load")(function* <A>(
      provider: ServerProvider,
      configPath: string,
      options: { readonly maxBytes: number; readonly root?: string },
      parserKey: string,
      parser: (text: string) => A,
    ) {
      const report = (message: string) =>
        Effect.sync(() => {
          issues.push({ instanceId: provider.instanceId, configPath, message });
          return null;
        });
      const reportCause = (cause: unknown) =>
        report(cause instanceof Error ? cause.message : String(cause));
      const real = yield* fileSystem.realPath(configPath).pipe(
        Effect.asSome,
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
        Effect.catch((error) => report(error.message).pipe(Effect.as(Option.none()))),
      );
      if (Option.isNone(real)) return null;
      if (options.root !== undefined) {
        const outside = configFileSkipReason({
          type: "File",
          size: 0,
          maxBytes: options.maxBytes,
          relativeToRoot: path.relative(realRoots.get(options.root) ?? options.root, real.value),
        });
        if (outside !== null) return yield* report(outside);
      }
      const opened = yield* Effect.acquireRelease(
        Effect.tryPromise(() => NodeFSP.open(real.value, OPEN_FLAGS)).pipe(
          Effect.asSome,
          Effect.catch(({ cause }) => {
            const code = errorCode(cause);
            if (code === "ENOENT") return Effect.succeedNone;
            return (
              code === "ELOOP"
                ? report("Not a regular file, so it was skipped.")
                : reportCause(cause)
            ).pipe(Effect.as(Option.none()));
          }),
        ),
        (handle) =>
          Option.isSome(handle) ? Effect.promise(() => handle.value.close()) : Effect.void,
      );
      if (Option.isNone(opened)) return null;
      const handle = opened.value;
      const info = yield* Effect.tryPromise(() => handle.stat()).pipe(
        Effect.asSome,
        Effect.catch(({ cause }) => reportCause(cause).pipe(Effect.as(Option.none()))),
      );
      if (Option.isNone(info)) return null;
      const skip = configFileSkipReason({
        type: info.value.isFile() ? "File" : "Other",
        size: info.value.size,
        maxBytes: options.maxBytes,
      });
      if (skip !== null) return yield* report(skip);
      const stamp = `${info.value.size}:${info.value.mtimeMs}`;
      const cacheKey = `${parserKey}\u0000${configPath}`;
      visitedCacheKeys.add(cacheKey);
      const cached = parsedConfigCache.get(cacheKey);
      if (cached !== undefined && cached.stamp === stamp) {
        return "error" in cached ? yield* report(cached.error) : (cached.value as A);
      }
      const bytes = yield* Effect.tryPromise(() =>
        readUpTo(handle, info.value.size, options.maxBytes),
      ).pipe(
        Effect.asSome,
        Effect.catch(({ cause }) => reportCause(cause).pipe(Effect.as(Option.none()))),
      );
      if (Option.isNone(bytes)) return null;
      const grown = configFileSkipReason({
        type: "File",
        size: bytes.value.length,
        maxBytes: options.maxBytes,
      });
      if (grown !== null) return yield* report(grown);
      const parsed = yield* Effect.try({
        try: () => parser(bytes.value.toString("utf8")),
        catch: describeConfigParseError,
      }).pipe(
        Effect.asSome,
        Effect.catch((error) => {
          parsedConfigCache.set(cacheKey, { stamp, error });
          return report(error).pipe(Effect.as(Option.none<A>()));
        }),
      );
      if (Option.isNone(parsed)) return null;
      parsedConfigCache.set(cacheKey, { stamp, value: parsed.value });
      return parsed.value;
    }, Effect.scoped);

    const readServers = Effect.fn("McpConnectors.readServers")(function* (
      provider: ServerProvider,
      configPath: string,
      scope: McpConnectorScope,
      project: McpConnectorProject | null,
      parserKey: string,
      parser: (text: string) => ReadonlyArray<ParsedMcpServer>,
    ) {
      const servers = yield* load(
        provider,
        configPath,
        project === null
          ? { maxBytes: USER_CONFIG_MAX_BYTES }
          : { maxBytes: PROJECT_CONFIG_MAX_BYTES, root: project.workspaceRoot },
        parserKey,
        parser,
      );
      return servers === null || servers.length === 0
        ? []
        : [{ scope, project, configPath, servers } satisfies FoundServers];
    });

    const forProjects = (
      provider: ServerProvider,
      relativePaths: ReadonlyArray<string>,
      parserKey: string,
      parser: (text: string) => ReadonlyArray<ParsedMcpServer>,
      include: (project: McpConnectorProject) => boolean = () => true,
    ) =>
      Effect.forEach(
        projects.filter(include).flatMap((project) =>
          relativePaths.map((relative) => ({
            project,
            configPath: path.join(project.workspaceRoot, relative),
          })),
        ),
        ({ project, configPath }) =>
          readServers(provider, configPath, "project", project, parserKey, parser),
        { concurrency: 8 },
      ).pipe(Effect.map((found) => found.flat()));

    const discover = Effect.fn("McpConnectors.discover")(function* (provider: ServerProvider) {
      const entry = Option.getOrUndefined(settings)?.providerInstances[provider.instanceId];
      switch (provider.driver) {
        case CLAUDE: {
          const configDir = instanceHomeSetting(entry, "CLAUDE_CONFIG_DIR", hostEnvironment);
          const userConfigPath = path.join(
            configDir === undefined ? home : resolve(configDir),
            ".claude.json",
          );
          const userConfig = yield* load(
            provider,
            userConfigPath,
            { maxBytes: USER_CONFIG_MAX_BYTES },
            "claude-user",
            parseClaudeUserConfig,
          );
          const found: FoundServers[] = [];
          if (userConfig !== null) {
            if (userConfig.user.length > 0) {
              found.push({
                scope: "user",
                project: null,
                configPath: userConfigPath,
                servers: userConfig.user,
              });
            }
            for (const project of projects) {
              const servers = userConfig.localByProject.get(project.workspaceRoot);
              if (servers !== undefined) {
                found.push({ scope: "local", project, configPath: userConfigPath, servers });
              }
            }
          }
          return [
            ...found,
            ...(yield* forProjects(provider, [".mcp.json"], "mcp-json", parseMcpJsonFile)),
          ];
        }
        case CODEX: {
          const codexHome = instanceHomeSetting(entry, "CODEX_HOME", hostEnvironment);
          const configPath = path.join(
            codexHome === undefined ? path.join(home, ".codex") : resolve(codexHome),
            "config.toml",
          );
          const config = yield* load(
            provider,
            configPath,
            { maxBytes: USER_CONFIG_MAX_BYTES },
            "codex",
            parseCodexConfig,
          );
          const user: FoundServers[] =
            config === null || config.servers.length === 0
              ? []
              : [{ scope: "user", project: null, configPath, servers: config.servers }];
          // Codex reads a project's own config only once the user trusts that project.
          const trusted = config?.trustedProjects ?? new Set<string>();
          const project = yield* forProjects(
            provider,
            [path.join(".codex", "config.toml")],
            "codex-servers",
            (projectText) => parseCodexConfig(projectText).servers,
            (candidate) => trusted.has(candidate.workspaceRoot),
          );
          return [...user, ...project];
        }
        case CURSOR: {
          const user = yield* readServers(
            provider,
            path.join(home, ".cursor", "mcp.json"),
            "user",
            null,
            "mcp-json",
            parseMcpJsonFile,
          );
          const project = yield* forProjects(
            provider,
            [path.join(".cursor", "mcp.json")],
            "mcp-json",
            parseMcpJsonFile,
          );
          return [...user, ...project];
        }
        case OPENCODE: {
          const xdgConfigHome = hostEnvironment.XDG_CONFIG_HOME?.trim();
          const configDir = path.join(
            xdgConfigHome === undefined || xdgConfigHome === ""
              ? path.join(home, ".config")
              : resolve(xdgConfigHome),
            "opencode",
          );
          const customConfig = hostEnvironment.OPENCODE_CONFIG?.trim();
          const userPaths = [
            path.join(configDir, "opencode.json"),
            path.join(configDir, "opencode.jsonc"),
            ...(customConfig === undefined || customConfig === "" ? [] : [resolve(customConfig)]),
          ];
          const user = yield* Effect.forEach(userPaths, (configPath) =>
            readServers(provider, configPath, "user", null, "opencode", parseOpenCodeConfig),
          );
          const project = yield* forProjects(
            provider,
            ["opencode.json", "opencode.jsonc"],
            "opencode",
            parseOpenCodeConfig,
          );
          return [...user.flat(), ...project];
        }
        default:
          return [];
      }
    });

    const supported = providers.filter(
      (provider) =>
        provider.installed &&
        (provider.driver === CLAUDE ||
          provider.driver === CODEX ||
          provider.driver === CURSOR ||
          provider.driver === OPENCODE),
    );
    const perProvider = yield* Effect.forEach(
      supported,
      (provider) => discover(provider).pipe(Effect.map((found) => ({ provider, found }))),
      { concurrency: 4 },
    );

    const grouped = new Map<string, { connector: McpConnector; uses: McpConnectorProviderUse[] }>();
    for (const { provider, found } of perProvider) {
      const use: Omit<McpConnectorProviderUse, "configPath"> = {
        instanceId: provider.instanceId,
        driver: provider.driver,
        displayName:
          provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.instanceId,
        enabled: provider.enabled,
      };
      for (const { scope, project, configPath, servers } of found) {
        for (const server of servers) {
          const key = [
            scope,
            project?.id ?? "",
            server.name,
            server.transport,
            server.target,
            server.envNames.join(","),
            server.headerNames.join(","),
          ].join("\u0000");
          let group = grouped.get(key);
          if (group === undefined) {
            group = { connector: { ...server, scope, project, providers: [] }, uses: [] };
            grouped.set(key, group);
          }
          if (!group.uses.some((existing) => existing.instanceId === use.instanceId)) {
            group.uses.push({ ...use, configPath });
          }
        }
      }
    }

    const connectors = [...grouped.values()]
      .map(({ connector, uses }) => ({ ...connector, providers: uses }))
      .toSorted(
        (left, right) =>
          SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope] ||
          (left.project?.title ?? "").localeCompare(right.project?.title ?? "") ||
          left.name.localeCompare(right.name),
      );
    for (const key of parsedConfigCache.keys()) {
      if (!visitedCacheKeys.has(key)) parsedConfigCache.delete(key);
    }
    const readAt = DateTime.formatIso(yield* DateTime.now);
    return { connectors, issues, readAt } satisfies McpConnectorsResult;
  }).pipe(Effect.withSpan("McpConnectors.list"));

  // Concurrent callers share one pass, detached so one caller leaving cannot cancel the others'.
  const list = Effect.uninterruptible(
    Effect.suspend(() => {
      if (inFlight !== undefined) return Effect.succeed(inFlight);
      const created = Deferred.makeUnsafe<McpConnectorsResult>();
      inFlight = created;
      return scan.pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            inFlight = undefined;
          }).pipe(Effect.andThen(Deferred.done(created, exit))),
        ),
        Effect.forkDetach,
        Effect.as(created),
      );
    }),
  ).pipe(Effect.flatMap(Deferred.await));

  return McpConnectors.of({ list });
});

export const layer = Layer.effect(McpConnectors, make);
