import { describe, expect, it } from "@effect/vitest";

import {
  REDACTED,
  parseClaudeUserConfig,
  parseCodexConfig,
  parseMcpJsonFile,
  parseOpenCodeConfig,
  redactCommandLine,
  redactUrl,
} from "./mcpConnectorConfig.ts";

describe("redaction", () => {
  it.each([
    ["https://mcp.example.com/mcp", "https://mcp.example.com/mcp"],
    ["https://user:pw@mcp.example.com/sse", `https://${REDACTED}@mcp.example.com/sse`],
    [
      "https://mcp.example.com/mcp?api_key=abc&region=eu",
      `https://mcp.example.com/mcp?api_key=${REDACTED}&region=${REDACTED}`,
    ],
    [
      "https://mcp.zapier.com/api/mcp/s/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg/mcp",
      `https://mcp.zapier.com/api/mcp/s/${REDACTED}/mcp`,
    ],
  ])("redacts url %s", (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  it("keeps ordinary arguments and hides secret ones", () => {
    expect(
      redactCommandLine("npx", [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/me/My Projects",
        "--api-key",
        "plain-looking",
        "--token=abc",
        "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "--header",
        "Authorization: Bearer whatever",
        "sk-ant-api03-abcdefghijklmnop",
        "postgres://admin:hunter2@db.local:5432/app",
      ]),
    ).toBe(
      [
        "npx -y @modelcontextprotocol/server-filesystem",
        JSON.stringify("/Users/me/My Projects"),
        `--api-key ${REDACTED}`,
        `--token=${REDACTED}`,
        `GITHUB_TOKEN=${REDACTED}`,
        "--header",
        JSON.stringify(`Authorization: ${REDACTED}`),
        REDACTED,
        `postgres://${REDACTED}@db.local:5432/app`,
      ].join(" "),
    );
  });
});

describe("Claude config", () => {
  it("reads user and per-project local servers, names only for env and headers", () => {
    const config = parseClaudeUserConfig(
      JSON.stringify({
        mcpServers: {
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: "Bearer ghp_secret" },
          },
          fs: { command: "npx", args: ["-y", "server-fs"], env: { HOME_DIR: "/secret/path" } },
          off: { command: "x", disabled: true },
        },
        projects: {
          "/work/app": { mcpServers: { db: { type: "sse", url: "https://db.local/sse" } } },
          "/work/empty": { mcpServers: {} },
        },
      }),
    );
    expect(config.user).toEqual([
      {
        name: "github",
        transport: "http",
        target: "https://api.githubcopilot.com/mcp/",
        envNames: [],
        headerNames: ["Authorization"],
      },
      {
        name: "fs",
        transport: "stdio",
        target: "npx -y server-fs",
        envNames: ["HOME_DIR"],
        headerNames: [],
      },
    ]);
    expect([...config.localByProject.keys()]).toEqual(["/work/app"]);
    expect(config.localByProject.get("/work/app")?.[0]).toMatchObject({
      name: "db",
      transport: "sse",
    });
    expect(JSON.stringify(config)).not.toContain("ghp_secret");
    expect(JSON.stringify(config)).not.toContain("/secret/path");
  });

  it("reads .mcp.json and Cursor mcp.json, with comments and trailing commas", () => {
    expect(
      parseMcpJsonFile(`{
        // project servers
        "mcpServers": { "remote": { "url": "https://x.dev/mcp", }, },
      }`),
    ).toEqual([
      {
        name: "remote",
        transport: "http",
        target: "https://x.dev/mcp",
        envNames: [],
        headerNames: [],
      },
    ]);
  });

  it("rejects malformed json", () => {
    expect(() => parseMcpJsonFile("{ nope")).toThrow();
  });
});

describe("Codex config", () => {
  it("reads enabled mcp_servers and trusted projects", () => {
    const config = parseCodexConfig(`
model = "gpt-5"

[projects."/work/app"]
trust_level = "trusted"

[projects."/work/other"]
trust_level = "untrusted"

[mcp_servers.docs]
command = "uvx"
args = ["docs-mcp", "--api-key", "secret-value"]
env = { DOCS_TOKEN = "t0ps3cret" }

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
bearer_token_env_var = "LINEAR_TOKEN"
http_headers = { "X-Team" = "eng" }

[mcp_servers.disabled]
command = "nope"
enabled = false
`);
    expect([...config.trustedProjects]).toEqual(["/work/app"]);
    expect(config.servers).toEqual([
      {
        name: "docs",
        transport: "stdio",
        target: `uvx docs-mcp --api-key ${REDACTED}`,
        envNames: ["DOCS_TOKEN"],
        headerNames: [],
      },
      {
        name: "linear",
        transport: "http",
        target: "https://mcp.linear.app/mcp",
        envNames: [],
        headerNames: ["Authorization", "X-Team"],
      },
    ]);
  });

  it("rejects malformed toml", () => {
    expect(() => parseCodexConfig("[mcp_servers.x\ncommand =")).toThrow();
  });
});

describe("OpenCode config", () => {
  it("reads local and remote servers and skips disabled ones", () => {
    expect(
      parseOpenCodeConfig(`{
        "$schema": "https://opencode.ai/config.json",
        "mcp": {
          "local": { "type": "local", "command": ["bun", "x", "my-mcp"], "environment": { "KEY": "v" } },
          "remote": { "type": "remote", "url": "https://r.dev/mcp", "headers": { "Authorization": "Bearer x" } },
          "off": { "type": "local", "command": ["x"], "enabled": false }
        }
      }`),
    ).toEqual([
      {
        name: "local",
        transport: "stdio",
        target: "bun x my-mcp",
        envNames: ["KEY"],
        headerNames: [],
      },
      {
        name: "remote",
        transport: "http",
        target: "https://r.dev/mcp",
        envNames: [],
        headerNames: ["Authorization"],
      },
    ]);
  });
});
