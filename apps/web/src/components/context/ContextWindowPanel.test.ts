import { describe, expect, it } from "vitest";

import type { ContextWindowSnapshot } from "~/lib/contextWindow";
import { contextWindowSegments } from "./ContextWindowPanel";

function usage(
  overrides: Pick<ContextWindowSnapshot, "usedTokens" | "maxTokens" | "autoCompactThreshold">,
): ContextWindowSnapshot {
  return { ...overrides } as ContextWindowSnapshot;
}

const tokensOf = (snapshot: ContextWindowSnapshot) =>
  contextWindowSegments(snapshot)?.map((segment) => [segment.label, segment.tokens]) ?? null;

describe("contextWindowSegments", () => {
  it.each([
    {
      name: "splits used, the auto-compact reserve and free space",
      input: { usedTokens: 208_100, maxTokens: 1_000_000, autoCompactThreshold: 967_000 },
      expected: [
        ["Used", 208_100],
        ["Autocompact buffer", 33_000],
        ["Free space", 758_900],
      ],
    },
    {
      name: "shrinks the reserve once usage runs into it",
      input: { usedTokens: 990_000, maxTokens: 1_000_000, autoCompactThreshold: 967_000 },
      expected: [
        ["Used", 990_000],
        ["Autocompact buffer", 10_000],
        ["Free space", 0],
      ],
    },
    {
      name: "has no reserve without a threshold below the window",
      input: { usedTokens: 50_000, maxTokens: 200_000, autoCompactThreshold: null },
      expected: [
        ["Used", 50_000],
        ["Free space", 150_000],
      ],
    },
    {
      name: "is unavailable without a window size",
      input: { usedTokens: 50_000, maxTokens: null, autoCompactThreshold: null },
      expected: null,
    },
  ])("$name", ({ input, expected }) => {
    expect(tokensOf(usage(input))).toEqual(expected);
  });
});
