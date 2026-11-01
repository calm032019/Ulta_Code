import { describe, expect, it } from "vite-plus/test";

import { darken, lighten, luminance, mix, parseColor, withAlpha } from "./color";

describe("bot-run colour helper", () => {
  it("parses the hex and rgb forms canvas and themes produce", () => {
    expect(parseColor("#fbf6f1")).toEqual({ r: 251, g: 246, b: 241, a: 1 });
    expect(parseColor("#FFF")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#00000080")?.a).toBeCloseTo(0.5, 2);
    expect(parseColor("rgb(35, 48, 82)")).toEqual({ r: 35, g: 48, b: 82, a: 1 });
    expect(parseColor("rgba(35,48,82,0.4)")).toEqual({ r: 35, g: 48, b: 82, a: 0.4 });
    expect(parseColor("rgb(35 48 82 / 50%)")).toEqual({ r: 35, g: 48, b: 82, a: 0.5 });
    expect(parseColor("rgb(100% 0% 0%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("rejects colours it cannot read", () => {
    for (const value of ["oklch(0.6 0.1 30)", "red", "#12", "#ggg", "rgb(1, 2)", ""]) {
      expect(parseColor(value)).toBeNull();
    }
  });

  it("mixes, lightens, darkens and sets alpha", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    expect(mix("#233052", "#fbf6f1", 0)).toBe("rgb(35, 48, 82)");
    expect(mix("#233052", "#fbf6f1", 2)).toBe("rgb(251, 246, 241)");
    expect(lighten("#000000", 0.25)).toBe("rgb(64, 64, 64)");
    expect(darken("#ffffff", 0.25)).toBe("rgb(191, 191, 191)");
    expect(withAlpha("#233052", 0.3)).toBe("rgba(35, 48, 82, 0.3)");
  });

  it("falls back to the nearer input when a colour is unreadable", () => {
    expect(mix("oklch(0.6 0.1 30)", "#ffffff", 0.2)).toBe("oklch(0.6 0.1 30)");
    expect(mix("#000000", "oklch(0.6 0.1 30)", 0.8)).toBe("oklch(0.6 0.1 30)");
    expect(withAlpha("oklch(0.6 0.1 30)", 0.5)).toBe("oklch(0.6 0.1 30)");
  });

  it("tells light themes from dark ones", () => {
    expect(luminance("#fbf6f1")).toBeGreaterThan(0.85);
    expect(luminance("#1f2b4a")).toBeLessThan(0.05);
  });
});
