import { describe, expect, it } from "vite-plus/test";

import {
  contrast,
  darken,
  inkOn,
  lighten,
  mix,
  hueDistance,
  parseColor,
  pickDistinct,
  pickVivid,
  toCss,
  withAlpha,
  type Rgba,
} from "./color";

const rounded = (color: Rgba | null) =>
  color && {
    r: Math.round(color.r),
    g: Math.round(color.g),
    b: Math.round(color.b),
    a: Math.round(color.a * 100) / 100,
  };

describe("parseColor", () => {
  it.each<[string, Rgba]>([
    ["#fbf6f1", { r: 251, g: 246, b: 241, a: 1 }],
    ["#FFF", { r: 255, g: 255, b: 255, a: 1 }],
    ["#0000ff80", { r: 0, g: 0, b: 255, a: 0.5 }],
    ["#f008", { r: 255, g: 0, b: 0, a: 0.53 }],
    ["rgb(223 212 201)", { r: 223, g: 212, b: 201, a: 1 }],
    ["rgb(255 255 255 / 8%)", { r: 255, g: 255, b: 255, a: 0.08 }],
    ["rgba(10, 20, 30, 0.25)", { r: 10, g: 20, b: 30, a: 0.25 }],
    ["rgb(100%, 0%, 50%)", { r: 255, g: 0, b: 128, a: 1 }],
    ["hsl(0, 100%, 50%)", { r: 255, g: 0, b: 0, a: 1 }],
    ["hsl(120deg 100% 25% / 0.5)", { r: 0, g: 128, b: 0, a: 0.5 }],
    ["oklch(62.8% 0.2577 29.23)", { r: 255, g: 0, b: 0, a: 1 }],
    ["oklch(1 0 0)", { r: 255, g: 255, b: 255, a: 1 }],
    ["oklab(0 0 0 / 50%)", { r: 0, g: 0, b: 0, a: 0.5 }],
    ["  White ", { r: 255, g: 255, b: 255, a: 1 }],
    ["transparent", { r: 0, g: 0, b: 0, a: 0 }],
  ])("%s", (input, expected) => {
    expect(rounded(parseColor(input))).toEqual(expected);
  });

  it.each([
    "",
    "#12",
    "#ggg",
    "rgb(1 2)",
    "rgb(a b c)",
    "var(--accent)",
    "color-mix(in srgb, red, blue)",
    "papayawhip",
  ])("rejects %j", (input) => {
    expect(parseColor(input)).toBeNull();
  });
});

describe("mixing", () => {
  const red: Rgba = { r: 200, g: 0, b: 0, a: 1 };

  it("mixes, lightens and darkens without changing alpha", () => {
    expect(mix(red, { r: 0, g: 0, b: 200, a: 1 }, 0.5)).toEqual({ r: 100, g: 0, b: 100, a: 1 });
    expect(lighten(withAlpha(red, 0.5), 1)).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(darken(red, 0.5)).toEqual({ r: 100, g: 0, b: 0, a: 1 });
    expect(mix(red, red, 7)).toEqual(red);
  });

  it("serialises to rgba()", () => {
    expect(toCss({ r: 12.4, g: 0, b: 255, a: 0.12345 })).toBe("rgba(12,0,255,0.123)");
  });

  it("picks a colour that stands out and readable ink", () => {
    const white: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const paleAccent: Rgba = { r: 243, g: 235, b: 227, a: 1 };
    const green: Rgba = { r: 22, g: 120, b: 60, a: 1 };
    expect(pickVivid([paleAccent, green], white)).toBe(green);
    expect(pickVivid([green, paleAccent], white)).toBe(green);
    expect(inkOn(green, white, black)).toBe(white);
    expect(inkOn(paleAccent, white, black)).toBe(black);
    expect(contrast(white, black)).toBeCloseTo(21, 0);
  });

  it("keeps good and bad colours apart when the accent shares the danger hue", () => {
    const surface: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    const accent = parseColor("#b9575a");
    const danger = parseColor("#d23c3c");
    const success = parseColor("#2f8f5b");
    const blue = parseColor("#2563eb");
    if (!accent || !danger || !success || !blue) throw new Error("fixture colours");
    expect(hueDistance(accent, danger)).toBeLessThan(45);
    expect(pickDistinct([accent, success], surface, danger)).toBe(success);
    expect(pickDistinct([blue, success], surface, danger)).toBe(blue);
    expect(pickDistinct([accent], surface, danger)).toBe(accent);
  });
});
