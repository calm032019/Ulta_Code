import { describe, expect, it } from "vite-plus/test";

import { generateLevel, isCompletable } from "./level";
import { ROWS, TILE_ROOF, tileAt } from "./physics";

describe("generateLevel", () => {
  it("builds completable levels for many seeds across levels 1 to 10", () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (let levelNumber = 1; levelNumber <= 10; levelNumber++) {
        const level = generateLevel(seed * 2654435761, levelNumber);
        expect(isCompletable(level), `seed ${seed} level ${levelNumber}`).toBe(true);
        expect(level.tiles).toHaveLength(level.cols * ROWS);
        expect(level.cols, "fell back to the flat level").toBeGreaterThan(40);
        expect(tileAt(level, level.beacon.col, level.beacon.row)).toBe(TILE_ROOF);
      }
    }
  });

  it("is deterministic and grows harder", () => {
    expect(generateLevel(42, 3)).toEqual(generateLevel(42, 3));
    const early = generateLevel(42, 1);
    const late = generateLevel(42, 9);
    expect(late.cols).toBeGreaterThan(early.cols);
  });

  it("rejects a level whose beacon sits beyond an impossible gap", () => {
    const level = generateLevel(7, 1);
    const tiles = level.tiles.map((tile, index) => {
      const col = index % level.cols;
      return col >= level.beacon.col - 12 && col < level.beacon.col - 2 ? 0 : tile;
    });
    expect(isCompletable({ ...level, tiles, lifts: [] })).toBe(false);
  });
});
