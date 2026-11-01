import { describe, expect, it } from "vite-plus/test";

import { darken, lighten, luminance, mix, parseColor, toCss, withAlpha } from "./color";

describe("colour helper", () => {
  it("parses the syntaxes themes use", () => {
    expect(parseColor("#fbf6f1")).toEqual({ r: 251, g: 246, b: 241, a: 1 });
    expect(parseColor("#fff8")).toEqual({ r: 255, g: 255, b: 255, a: 136 / 255 });
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(toCss(parseColor("hsl(120 100% 50%)")!)).toBe("rgb(0, 255, 0)");
    expect(toCss(parseColor("oklch(1 0 0)")!)).toBe("rgb(255, 255, 255)");
    expect(toCss(parseColor("oklch(0.628 0.2577 29.23)")!)).toBe("rgb(255, 0, 0)");
    expect(parseColor("var(--accent)")).toBeNull();
    expect(parseColor("#12")).toBeNull();
  });

  it("mixes, lightens and darkens", () => {
    const red = { r: 200, g: 0, b: 0, a: 1 };
    expect(mix(red, { r: 0, g: 0, b: 200, a: 1 }, 0.5)).toEqual({ r: 100, g: 0, b: 100, a: 1 });
    expect(toCss(lighten(red, 1))).toBe("rgb(255, 255, 255)");
    expect(toCss(darken(red, 0.5))).toBe("rgb(100, 0, 0)");
    expect(toCss(withAlpha(red, 0.25))).toBe("rgba(200, 0, 0, 0.25)");
    expect(luminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
    expect(luminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1);
  });
});
