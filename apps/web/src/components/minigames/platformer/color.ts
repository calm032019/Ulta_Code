export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function channel(text: string, scale: number): number | null {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return text.trim().endsWith("%") ? (value / 100) * scale : value;
}

function hueToRgb(p: number, q: number, t: number): number {
  const h = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (h < 1 / 6) return p + (q - p) * 6 * h;
  if (h < 1 / 2) return q;
  if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
  return p;
}

function linearToSrgb(value: number): number {
  const v = clamp(value, 0, 1);
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
}

function oklabToRgb(l: number, a: number, b: number, alpha: number): Rgba {
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: linearToSrgb(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1),
    g: linearToSrgb(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1),
    b: linearToSrgb(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1),
    a: alpha,
  };
}

/** Parses hex, rgb(), hsl(), oklab() and oklch() colours; other syntaxes return null. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = [...hex].map((digit) => Number.parseInt(digit + digit, 16));
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a === undefined ? 1 : a / 255 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const value = (index: number) => Number.parseInt(hex.slice(index, index + 2), 16);
      return { r: value(0), g: value(2), b: value(4), a: hex.length === 8 ? value(6) / 255 : 1 };
    }
    return null;
  }
  const fn = /^(rgba?|hsla?|oklab|oklch)\(([^)]*)\)$/.exec(text);
  if (!fn) return null;
  const name = fn[1] ?? "";
  const [main = "", alphaPart] = (fn[2] ?? "").split("/");
  const parts = main.includes(",") ? main.split(",") : main.trim().split(/\s+/);
  const alphaText = alphaPart ?? (parts.length === 4 ? parts[3] : undefined);
  const alpha = alphaText === undefined ? 1 : channel(alphaText, 1);
  if (parts.length < 3 || alpha === null) return null;
  const [first = "", second = "", third = ""] = parts;
  if (name.startsWith("rgb")) {
    const r = channel(first, 255);
    const g = channel(second, 255);
    const b = channel(third, 255);
    if (r === null || g === null || b === null) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(alpha, 0, 1) };
  }
  if (name.startsWith("hsl")) {
    const h = Number.parseFloat(first);
    const sat = channel(second, 1);
    const light = channel(third, 1);
    if (!Number.isFinite(h) || sat === null || light === null) return null;
    const hue = (((h % 360) + 360) % 360) / 360;
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    return {
      r: 255 * hueToRgb(p, q, hue + 1 / 3),
      g: 255 * hueToRgb(p, q, hue),
      b: 255 * hueToRgb(p, q, hue - 1 / 3),
      a: clamp(alpha, 0, 1),
    };
  }
  const l = channel(first, 1);
  if (l === null) return null;
  if (name === "oklab") {
    const a = channel(second, 0.4);
    const b = channel(third, 0.4);
    if (a === null || b === null) return null;
    return oklabToRgb(l, a, b, clamp(alpha, 0, 1));
  }
  const chroma = channel(second, 0.4);
  const hue = Number.parseFloat(third);
  if (chroma === null) return null;
  const radians = ((Number.isFinite(hue) ? hue : 0) * Math.PI) / 180;
  return oklabToRgb(l, chroma * Math.cos(radians), chroma * Math.sin(radians), clamp(alpha, 0, 1));
}

export function mix(from: Rgba, to: Rgba, amount: number): Rgba {
  const t = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: from.a + (to.a - from.a) * t,
  };
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

export const lighten = (color: Rgba, amount: number) =>
  mix(color, { ...WHITE, a: color.a }, amount);
export const darken = (color: Rgba, amount: number) => mix(color, { ...BLACK, a: color.a }, amount);
export const withAlpha = (color: Rgba, alpha: number): Rgba => ({
  ...color,
  a: clamp(alpha, 0, 1),
});

/** WCAG relative luminance, 0 for black and 1 for white. */
export function luminance(color: Rgba): number {
  const linear = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function toCss(color: Rgba): string {
  const r = Math.round(clamp(color.r, 0, 255));
  const g = Math.round(clamp(color.g, 0, 255));
  const b = Math.round(clamp(color.b, 0, 255));
  const a = Math.round(clamp(color.a, 0, 1) * 1000) / 1000;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}
