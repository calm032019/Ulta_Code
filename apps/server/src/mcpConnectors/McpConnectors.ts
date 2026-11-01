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
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
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

  const list = Effect.gen(function* () {
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
    const resolve = (value: string) => path.resolve(expandHomePath(value, home));

    const readFile = (provider: ServerProvider, configPath: string) =>
      fileSystem.readFileString(configPath).pipe(
        Effect.asSome,
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
        Effect.catch((error) =>
          Effect.sync(() => {
            issues.push({
              instanceId: provider.instanceId,
              configPath,
              message: error.message,
            });
            return Option.none<string>();
          }),
        ),
      );

    const parse = <A>(provider: ServerProvider, configPath: string, run: () => A): A | null => {
      try {
        return run();
      } catch (error) {
        issues.push({
          instanceId: provider.instanceId,
          configPath,
          message: `Could not parse this file: ${error instanceof Error ? error.message : String(error)}`,
        });
        return null;
      }
    };

    const readServers = Effect.fn("McpConnectors.readServers")(function* (
      provider: ServerProvider,
      configPath: string,
      scope: McpConnectorScope,
      project: McpConnectorProject | null,
      parser: (text: string) => ReadonlyArray<ParsedMcpServer>,
    ) {
      const text = yield* readFile(provider, configPath);
      if (Option.isNone(text)) return [];
      const servers = parse(provider, configPath, () => parser(text.value));
      return servers === null || servers.length === 0
        ? []
        : [{ scope, project, configPath, servers } satisfies FoundServers];
    });

    const forProjects = (
      provider: ServerProvider,
      relativePaths: ReadonlyArray<string>,
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
        ({ project, configPath }) => readServers(provider, configPath, "project", project, parser),
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
          const userText = yield* readFile(provider, userConfigPath);
          const userConfig = Option.isNone(userText)
            ? null
            : parse(provider, userConfigPath, () => parseClaudeUserConfig(userText.value));
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
          return [...found, ...(yield* forProjects(provider, [".mcp.json"], parseMcpJsonFile))];
        }
        case CODEX: {
          const codexHome = instanceHomeSetting(entry, "CODEX_HOME", hostEnvironment);
          const configPath = path.join(
            codexHome === undefined ? path.join(home, ".codex") : resolve(codexHome),
            "config.toml",
          );
          const text = yield* readFile(provider, configPath);
          const config = Option.isNone(text)
            ? null
            : parse(provider, configPath, () => parseCodexConfig(text.value));
          const user: FoundServers[] =
            config === null || config.servers.length === 0
              ? []
              : [{ scope: "user", project: null, configPath, servers: config.servers }];
          // Codex reads a project's own config only once the user trusts that project.
          const trusted = config?.trustedProjects ?? new Set<string>();
          const project = yield* forProjects(
            provider,
            [path.join(".codex", "config.toml")],
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
            parseMcpJsonFile,
          );
          const project = yield* forProjects(
            provider,
            [path.join(".cursor", "mcp.json")],
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
            readServers(provider, configPath, "user", null, parseOpenCodeConfig),
          );
          const project = yield* forProjects(
            provider,
            ["opencode.json", "opencode.jsonc"],
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
    const readAt = DateTime.formatIso(yield* DateTime.now);
    return { connectors, issues, readAt } satisfies McpConnectorsResult;
  }).pipe(Effect.withSpan("McpConnectors.list"));

  return McpConnectors.of({ list });
});

export const layer = Layer.effect(McpConnectors, make);
