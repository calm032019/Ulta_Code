import { describe, expect, it } from "@effect/vitest";

import { claudeLoginFailure, findClaudeLoginUrl, normalizeClaudeLoginCode } from "./ClaudeAuth.ts";

const LOGIN_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=xyz";

describe("findClaudeLoginUrl", () => {
  it("reads the manual sign-in link from claude auth login output", () => {
    const output = `Opening browser to sign in…\nIf the browser didn't open, visit: ${LOGIN_URL}\nPaste code here if prompted > `;
    expect(findClaudeLoginUrl(output)).toBe(LOGIN_URL);
  });

  it("waits until the whole line has arrived", () => {
    expect(findClaudeLoginUrl("Opening browser to sign in…\n")).toBeUndefined();
  });
});

describe("claudeLoginFailure", () => {
  it("reports Claude's reason, not the sign-in link printed before it", () => {
    const output = `Opening browser to sign in…\nIf the browser didn't open, visit: ${LOGIN_URL}\nPaste code here if prompted > Login failed: That code wasn't accepted. Sign in again to get a new code.\n`;
    expect(claudeLoginFailure(output)).toBe(
      "That code wasn't accepted. Sign in again to get a new code.",
    );
  });

  it("falls back to a plain message when Claude says nothing", () => {
    expect(claudeLoginFailure(`visit: ${LOGIN_URL}\nPaste code here if prompted > `)).toBe(
      "Claude didn't accept the sign-in. Try again.",
    );
  });
});

describe("normalizeClaudeLoginCode", () => {
  it.each([
    ["the code Claude shows", "  abc123#state456 \n", "abc123#state456"],
    [
      "the callback page address",
      "https://platform.claude.com/oauth/code/callback?code=abc123&state=state456",
      "abc123#state456",
    ],
    [
      "an address without state",
      "https://platform.claude.com/oauth/code/callback?code=abc123",
      "abc123",
    ],
  ])("accepts %s", (_name, pasted, expected) => {
    expect(normalizeClaudeLoginCode(pasted)).toBe(expected);
  });
});
