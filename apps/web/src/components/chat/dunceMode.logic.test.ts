import { describe, expect, it } from "vite-plus/test";

import { selectMessageRange } from "./dunceMode.logic";

const ids = ["a", "b", "c", "d", "e"];

describe("selectMessageRange", () => {
  it.each([
    ["a click", "c", "c", ["c"]],
    ["a drag down", "b", "d", ["b", "c", "d"]],
    ["a drag up", "d", "b", ["b", "c", "d"]],
    ["a pointer over something that is not a message", "c", "missing", ["c"]],
    ["an anchor no longer in the timeline", "missing", "c", []],
  ])("selects %s in timeline order", (_name, anchor, current, expected) => {
    expect(selectMessageRange(ids, anchor, current)).toEqual({ ids: expected, capped: false });
  });

  it("caps a long run at the messages nearest the anchor", () => {
    expect(selectMessageRange(ids, "b", "e", 2)).toEqual({ ids: ["b", "c"], capped: true });
    expect(selectMessageRange(ids, "d", "a", 2)).toEqual({ ids: ["c", "d"], capped: true });
  });
});
