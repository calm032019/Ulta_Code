import type { McpConnector, McpConnectorScope } from "@t3tools/contracts";
import { resolveUsageAccess } from "@t3tools/client-runtime/state/usage-access";
import { PlugIcon, TriangleAlertIcon } from "lucide-react";

import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

const SCOPE_LABELS: Record<McpConnectorScope, string> = {
  user: "User",
  local: "Local",
  project: "Project",
};

const SCOPE_DESCRIPTIONS: Record<McpConnectorScope, string> = {
  user: "Loaded in every project.",
  local: "Private to you in this project, kept in your Claude config.",
  project: "Checked into this project's folder.",
};

interface ConnectorGroup {
  readonly key: string;
  readonly title: string;
  readonly connectors: McpConnector[];
}

function groupConnectors(connectors: ReadonlyArray<McpConnector>): ConnectorGroup[] {
  const groups = new Map<string, ConnectorGroup>();
  for (const connector of connectors) {
    const key = connector.project?.id ?? "";
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        title: connector.project === null ? "All projects" : connector.project.title,
        connectors: [],
      };
      groups.set(key, group);
    }
    group.connectors.push(connector);
  }
  return [...groups.values()];
}

function ConnectorRow({ connector }: { connector: McpConnector }) {
  const providerNames = connector.providers.map((provider) =>
    provider.enabled ? provider.displayName : `${provider.displayName} (off)`,
  );
  const configPaths = [...new Set(connector.providers.map((provider) => provider.configPath))];
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-3 sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="truncate text-sm font-medium text-foreground">{connector.name}</span>
        <Badge variant="outline" size="sm">
          {connector.transport === "stdio" ? "stdio" : connector.transport.toUpperCase()}
        </Badge>
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant="secondary" size="sm">
                {SCOPE_LABELS[connector.scope]}
              </Badge>
            }
          />
          <TooltipPopup side="top">{SCOPE_DESCRIPTIONS[connector.scope]}</TooltipPopup>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {connector.target}
            </span>
          }
        />
        <TooltipPopup side="top" variant="code">
          {connector.target}
        </TooltipPopup>
      </Tooltip>
      <p className="text-xs text-muted-foreground">
        Used by {providerNames.join(", ")}
        {connector.envNames.length > 0 ? ` · Env: ${connector.envNames.join(", ")}` : ""}
        {connector.headerNames.length > 0 ? ` · Headers: ${connector.headerNames.join(", ")}` : ""}
      </p>
      <p className="break-all font-mono text-2xs text-muted-foreground/70">
        {configPaths.join(", ")}
      </p>
    </div>
  );
}

export function ConnectorsSettingsPanel() {
  const { environment } = useSettingsScope();
  return <ConnectorsSettingsBody key={environment?.environmentId ?? ""} />;
}

function ConnectorsSettingsBody() {
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const session = useEnvironmentQuery(
    environmentId === null ? null : environmentSession.sessionStateAtom(environmentId),
  );
  const access = resolveUsageAccess({
    connectionPhase: environment?.connection.phase ?? "available",
    session: session.data,
    hasSessionError: session.error !== null,
  });
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null || !access.canReadDiagnostics
      ? null
      : serverEnvironment.mcpConnectors({ environmentId, input: {} }),
  );

  if (!access.canReadDiagnostics) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          {environmentId === null
            ? "Connect an environment to see its MCP servers."
            : access.isPending
              ? "Checking access…"
              : access.error}
        </p>
      </SettingsPageContainer>
    );
  }

  const groups = data === null ? [] : groupConnectors(data.connectors);
  const refreshButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            disabled={isPending}
            onClick={refresh}
            aria-label="Refresh MCP servers"
          >
            <RefreshIcon refreshing={isPending} />
          </Button>
        }
      />
      <TooltipPopup side="top">Re-read provider config files</TooltipPopup>
    </Tooltip>
  );

  return (
    <SettingsPageContainer>
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        MCP servers that Claude, Codex, Cursor and OpenCode on this environment load from their own
        config files. Secrets, environment values and header values are hidden. To add or change a
        server, edit the provider&apos;s config file.
      </p>
      {error !== null ? (
        <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p>
      ) : null}
      {data !== null && data.issues.length > 0 ? (
        <SettingsSection title="Unreadable config files" icon={<TriangleAlertIcon />}>
          {data.issues.map((issue) => (
            <div
              key={`${issue.instanceId}:${issue.configPath}`}
              className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5 sm:px-4"
            >
              <span className="truncate font-mono text-xs text-foreground">{issue.configPath}</span>
              <span className="text-xs text-muted-foreground">{issue.message}</span>
            </div>
          ))}
        </SettingsSection>
      ) : null}
      {data !== null && groups.length === 0 ? (
        <SettingsSection title="MCP servers" headerAction={refreshButton}>
          <Empty>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No MCP servers configured</EmptyTitle>
              <EmptyDescription>
                None of the installed providers on this environment list an MCP server.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        groups.map((group, index) => (
          <SettingsSection
            key={group.key}
            title={group.title}
            {...(index === 0 ? { headerAction: refreshButton } : {})}
          >
            {group.connectors.map((connector) => (
              <ConnectorRow
                key={JSON.stringify([
                  connector.scope,
                  connector.name,
                  connector.transport,
                  connector.target,
                  connector.envNames,
                  connector.headerNames,
                ])}
                connector={connector}
              />
            ))}
          </SettingsSection>
        ))
      )}
      {data === null && error === null ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">Reading config files…</p>
      ) : null}
    </SettingsPageContainer>
  );
}
