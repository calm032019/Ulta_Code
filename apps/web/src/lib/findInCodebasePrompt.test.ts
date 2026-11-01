import { describe, expect, it } from "vite-plus/test";

import { buildFindInCodebasePrompt } from "./findInCodebasePrompt";

describe("buildFindInCodebasePrompt", () => {
  it("leads with the question, keeps it whole, and asks for a read-only file list", () => {
    const prompt = buildFindInCodebasePrompt(
      "  where do we handle refunds?\nespecially partial ones  ",
    );
    const lines = prompt.split("\n");

    expect(lines[0]).toBe("Find in codebase: where do we handle refunds?");
    expect(prompt).toContain("Question:\nwhere do we handle refunds?\nespecially partial ones\n");
    expect(prompt).toContain("Do not create, edit, move or delete any files");
    expect(prompt).toContain("- `path/to/file.ts:12-48`: one line on why it is relevant");
  });
});
