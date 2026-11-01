import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

/** Claude's `local` scope is per user and per project, kept in its user config. */
export const McpConnectorScope = Schema.Literals(["user", "project", "local"]);
export type McpConnectorScope = typeof McpConnectorScope.Type;

export const McpConnectorTransport = Schema.Literals(["stdio", "http", "sse"]);
export type McpConnectorTransport = typeof McpConnectorTransport.Type;

export const McpConnectorProject = Schema.Struct({
  id: ProjectId,
  title: Schema.String,
  workspaceRoot: Schema.String,
});
export type McpConnectorProject = typeof McpConnectorProject.Type;

export const McpConnectorProviderUse = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: Schema.String,
  configPath: Schema.String,
  enabled: Schema.Boolean,
});
export type McpConnectorProviderUse = typeof McpConnectorProviderUse.Type;

/** Values that may hold credentials never cross the wire: env and headers are names only. */
export const McpConnector = Schema.Struct({
  name: TrimmedNonEmptyString,
  transport: McpConnectorTransport,
  target: Schema.String,
  envNames: Schema.Array(Schema.String),
  headerNames: Schema.Array(Schema.String),
  scope: McpConnectorScope,
  project: Schema.NullOr(McpConnectorProject),
  providers: Schema.Array(McpConnectorProviderUse),
});
export type McpConnector = typeof McpConnector.Type;

export const McpConnectorConfigIssue = Schema.Struct({
  instanceId: ProviderInstanceId,
  configPath: Schema.String,
  message: Schema.String,
});
export type McpConnectorConfigIssue = typeof McpConnectorConfigIssue.Type;

export const McpConnectorsResult = Schema.Struct({
  connectors: Schema.Array(McpConnector),
  issues: Schema.Array(McpConnectorConfigIssue),
  readAt: IsoDateTime,
});
export type McpConnectorsResult = typeof McpConnectorsResult.Type;
