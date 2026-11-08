import { ProviderDriverKind, type ProviderInstanceConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { claudeEntriesSharingLogin, separateClaudeLoginFolder } from "./ClaudeAccountSection.logic";

const claude = (patch: Partial<ProviderInstanceConfig> = {}): ProviderInstanceConfig => ({
  driver: ProviderDriverKind.make("claudeAgent"),
  ...patch,
});

describe("claudeEntriesSharingLogin", () => {
  it("reports the built-in Claude when a second entry has no folder of its own", () => {
    const instances = { claudeAgent_work: claude({ displayName: "Work" }) };
    expect(claudeEntriesSharingLogin(instances, "claudeAgent_work")).toEqual(["Claude"]);
    expect(claudeEntriesSharingLogin(instances, "claudeAgent")).toEqual(["Work"]);
  });

  it.each([
    ["its own folder", claude({ config: { homePath: "~/.claude_work" } })],
    [
      "a folder from its environment",
      claude({
        environment: [{ name: "CLAUDE_CONFIG_DIR", value: "~/.claude_work", sensitive: false }],
      }),
    ],
    ["an API key", claude({ config: { apiKey: "<redacted>" } })],
    [
      "a redacted API key variable",
      claude({
        environment: [
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: true, valueRedacted: true },
        ],
      }),
    ],
    ["being turned off", claude({ enabled: false })],
  ])("does not share when the second entry has %s", (_name, second) => {
    expect(claudeEntriesSharingLogin({ claudeAgent_work: second }, "claudeAgent")).toEqual([]);
  });
});

describe("separateClaudeLoginFolder", () => {
  it.each([
    ["claudeAgent_personal", "~/.claude_personal"],
    ["claudeAgent", "~/.claude_account"],
    ["claudeAgent_Side Gig", "~/.claude_side_gig"],
  ])("puts %s in %s", (instanceId, folder) => {
    expect(separateClaudeLoginFolder(instanceId)).toBe(folder);
  });
});
