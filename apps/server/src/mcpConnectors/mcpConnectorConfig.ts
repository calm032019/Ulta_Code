import type { McpConnectorTransport } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Schema from "effect/Schema";
import { parse as parseToml } from "smol-toml";

export interface ParsedMcpServer {
  readonly name: string;
  readonly transport: McpConnectorTransport;
  readonly target: string;
  readonly envNames: ReadonlyArray<string>;
  readonly headerNames: ReadonlyArray<string>;
}

export const REDACTED = "[redacted]";

const SECRET_NAME = /token|secret|pass|pwd|key|auth|credential|bearer|session|cookie|signature/i;
const SECRET_FLAG = /^(-p|--password)$/;
const HEADER_FLAG = /^(-H|--header|--headers)$/;
const KNOWN_SECRET_PREFIX =
  /^(sk-|sk_|pk_live_|rk_live_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[abprs]-|AKIA|ASIA|AIza|ya29\.|eyJ|shpat_|lin_api_|ntn_|npm_)/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_\-+=.]{32,}$/;

function looksLikeSecret(value: string): boolean {
  if (value.length >= 16 && KNOWN_SECRET_PREFIX.test(value)) return true;
  return OPAQUE_TOKEN.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value);
}

/** Drops credentials, every query value, and token-shaped path segments. */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return looksLikeSecret(raw) ? REDACTED : raw;
  }
  const userInfo = url.username !== "" || url.password !== "" ? `${REDACTED}@` : "";
  const path = url.pathname
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {}
      return looksLikeSecret(decoded) ? REDACTED : segment;
    })
    .join("/");
  const query = [...url.searchParams.keys()].map((key) => `${key}=${REDACTED}`).join("&");
  const host = url.host === "" ? "" : `//${userInfo}${url.host}`;
  return `${url.protocol}${host}${path}${query === "" ? "" : `?${query}`}`;
}

function redactArg(arg: string, previous: string | undefined): string {
  if (
    previous !== undefined &&
    /^--?[\w-]+$/.test(previous) &&
    (SECRET_FLAG.test(previous) || SECRET_NAME.test(previous))
  ) {
    return REDACTED;
  }
  if (/^\s*[{[]/.test(arg)) return REDACTED;
  if (previous !== undefined && HEADER_FLAG.test(previous)) {
    const header = /^([\w-]+):/.exec(arg);
    return header ? `${header[1]}: ${REDACTED}` : REDACTED;
  }
  if (arg.includes(";") && arg.includes("=")) {
    return arg
      .split(";")
      .map((part) => {
        const pair = /^([^=]*)=(.*)$/s.exec(part);
        if (!pair) return part;
        const [, name = "", value = ""] = pair;
        return SECRET_NAME.test(name) || looksLikeSecret(value.trim())
          ? `${name}=${REDACTED}`
          : part;
      })
      .join(";");
  }
  const assignment = /^(--?[\w.-]+|[A-Za-z_][\w.-]*)=(.*)$/s.exec(arg);
  if (assignment) {
    const [, name = "", value = ""] = assignment;
    if (SECRET_NAME.test(name)) return `${name}=${REDACTED}`;
    return `${name}=${redactArg(value, undefined)}`;
  }
  const header = /^([\w-]+):\s*(.*)$/s.exec(arg);
  if (header && !/^[a-z][\w+.-]*:\/\//i.test(arg)) {
    const [, name = "", value = ""] = header;
    if (SECRET_NAME.test(name)) return `${name}: ${REDACTED}`;
    if (looksLikeSecret(value)) return `${name}: ${REDACTED}`;
  }
  if (/^[a-z][\w+.-]*:\/\//i.test(arg)) return redactUrl(arg);
  return looksLikeSecret(arg) ? REDACTED : arg;
}

function quoteArg(arg: string): string {
  return arg === "" || /[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg;
}

export function redactCommandLine(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args]
    .map((arg, index, all) => quoteArg(redactArg(arg, index === 0 ? undefined : all[index - 1])))
    .join(" ");
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const keysOf = (value: unknown): ReadonlyArray<string> =>
  isRecord(value) ? Object.keys(value).toSorted() : [];

const decodeLenientJson = Schema.decodeUnknownSync(fromLenientJson(Schema.Unknown));

function parseJsonConfig(text: string): unknown {
  return decodeLenientJson(text);
}

/** Claude `.mcp.json`, `~/.claude.json`, and Cursor `mcp.json` share the `mcpServers` shape. */
function parseMcpServersRecord(value: unknown): ReadonlyArray<ParsedMcpServer> {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([name, entry]): ParsedMcpServer[] => {
    if (!isRecord(entry) || name.trim() === "") return [];
    if (entry.disabled === true) return [];
    const type = typeof entry.type === "string" ? entry.type : undefined;
    const headerNames = keysOf(entry.headers);
    const envNames = keysOf(entry.env);
    if (typeof entry.url === "string" && type !== "stdio") {
      return [
        {
          name,
          transport: type === "sse" ? "sse" : "http",
          target: redactUrl(entry.url),
          envNames,
          headerNames,
        },
      ];
    }
    if (typeof entry.command === "string") {
      return [
        {
          name,
          transport: "stdio",
          target: redactCommandLine(entry.command, stringArray(entry.args)),
          envNames,
          headerNames,
        },
      ];
    }
    return [];
  });
}

export interface ClaudeUserConfig {
  readonly user: ReadonlyArray<ParsedMcpServer>;
  readonly localByProject: ReadonlyMap<string, ReadonlyArray<ParsedMcpServer>>;
}

export function parseClaudeUserConfig(text: string): ClaudeUserConfig {
  const document = parseJsonConfig(text);
  if (!isRecord(document)) return { user: [], localByProject: new Map() };
  const localByProject = new Map<string, ReadonlyArray<ParsedMcpServer>>();
  if (isRecord(document.projects)) {
    for (const [root, project] of Object.entries(document.projects)) {
      if (!isRecord(project)) continue;
      const servers = parseMcpServersRecord(project.mcpServers);
      if (servers.length > 0) localByProject.set(root, servers);
    }
  }
  return { user: parseMcpServersRecord(document.mcpServers), localByProject };
}

export function parseMcpJsonFile(text: string): ReadonlyArray<ParsedMcpServer> {
  const document = parseJsonConfig(text);
  return isRecord(document) ? parseMcpServersRecord(document.mcpServers) : [];
}

export interface CodexConfig {
  readonly servers: ReadonlyArray<ParsedMcpServer>;
  readonly trustedProjects: ReadonlySet<string>;
}

export function parseCodexConfig(text: string): CodexConfig {
  const document: unknown = parseToml(text);
  if (!isRecord(document)) return { servers: [], trustedProjects: new Set() };
  const trustedProjects = new Set<string>();
  if (isRecord(document.projects)) {
    for (const [root, project] of Object.entries(document.projects)) {
      if (isRecord(project) && project.trust_level === "trusted") trustedProjects.add(root);
    }
  }
  const servers = isRecord(document.mcp_servers)
    ? Object.entries(document.mcp_servers).flatMap(([name, entry]): ParsedMcpServer[] => {
        if (!isRecord(entry) || entry.enabled === false || name.trim() === "") return [];
        const envNames = [...keysOf(entry.env), ...stringArray(entry.env_vars)].toSorted();
        const headerNames = [
          ...keysOf(entry.http_headers),
          ...keysOf(entry.env_http_headers),
          ...(typeof entry.bearer_token_env_var === "string" ? ["Authorization"] : []),
        ].toSorted();
        if (typeof entry.url === "string") {
          return [{ name, transport: "http", target: redactUrl(entry.url), envNames, headerNames }];
        }
        if (typeof entry.command === "string") {
          return [
            {
              name,
              transport: "stdio",
              target: redactCommandLine(entry.command, stringArray(entry.args)),
              envNames,
              headerNames,
            },
          ];
        }
        return [];
      })
    : [];
  return { servers, trustedProjects };
}

export function parseOpenCodeConfig(text: string): ReadonlyArray<ParsedMcpServer> {
  const document = parseJsonConfig(text);
  if (!isRecord(document) || !isRecord(document.mcp)) return [];
  return Object.entries(document.mcp).flatMap(([name, entry]): ParsedMcpServer[] => {
    if (!isRecord(entry) || entry.enabled === false || name.trim() === "") return [];
    if (entry.type === "remote" && typeof entry.url === "string") {
      return [
        {
          name,
          transport: "http",
          target: redactUrl(entry.url),
          envNames: [],
          headerNames: keysOf(entry.headers),
        },
      ];
    }
    const [command, ...args] = stringArray(entry.command);
    if (entry.type === "local" && command !== undefined) {
      return [
        {
          name,
          transport: "stdio",
          target: redactCommandLine(command, args),
          envNames: keysOf(entry.environment),
          headerNames: [],
        },
      ];
    }
    return [];
  });
}
