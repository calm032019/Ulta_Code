export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

const NAMED: Record<string, Rgba> = {
  black: BLACK,
  white: WHITE,
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(%|deg|turn|rad)?$/;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function parseHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const expand = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  if (expand.length !== 6 && expand.length !== 8) return null;
  const at = (i: number) => parseInt(expand.slice(i, i + 2), 16);
  return { r: at(0), g: at(2), b: at(4), a: expand.length === 8 ? at(6) / 255 : 1 };
}

/** Parses a number token; `percent` is what 100% maps to. */
function num(token: string | undefined, percent: number): number | null {
  if (token === undefined) return null;
  if (token === "none") return 0;
  const match = NUMBER.exec(token);
  if (!match) return null;
  const value = parseFloat(token);
  switch (match[3]) {
    case "%":
      return (value / 100) * percent;
    case "turn":
      return value * 360;
    case "rad":
      return (value * 180) / Math.PI;
    default:
      return value;
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t0: number) => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
}

function oklabToRgb(l: number, a: number, b: number): [number, number, number] {
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (x: number) => {
    const v = clamp(x, 0, 1);
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  return [
    encode(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1),
    encode(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1),
    encode(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1),
  ];
}

/** Parses hex, rgb(), hsl(), oklch() and oklab() in legacy or modern syntax; null otherwise. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase();
  const named = NAMED[text];
  if (named) return { ...named };
  if (text.startsWith("#")) return parseHex(text.slice(1));
  const match = /^([a-z]+)\(([^()]*)\)$/.exec(text);
  if (!match) return null;
  const fn = match[1] ?? "";
  const tokens = (match[2] ?? "").replace(/,/g, " ").replace(/\//g, " / ").split(/\s+/);
  const parts = tokens.filter(Boolean);
  const slash = parts.indexOf("/");
  const channels = slash >= 0 ? parts.slice(0, slash) : parts.slice(0, 3);
  const alphaToken = slash >= 0 ? parts[slash + 1] : parts[3];
  if (channels.length !== 3) return null;
  const alpha = alphaToken === undefined ? 1 : num(alphaToken, 1);
  const [c0, c1, c2] = channels;
  let rgb: [number, number, number] | null = null;
  if (fn === "rgb" || fn === "rgba") {
    const r = num(c0, 255);
    const g = num(c1, 255);
    const b = num(c2, 255);
    if (r !== null && g !== null && b !== null) rgb = [r, g, b];
  } else if (fn === "hsl" || fn === "hsla") {
    const h = num(c0, 360);
    const s = num(c1, 1);
    const l = num(c2, 1);
    if (h !== null && s !== null && l !== null) {
      rgb = hslToRgb(h, c1?.endsWith("%") ? s : s / 100, c2?.endsWith("%") ? l : l / 100);
    }
  } else if (fn === "oklch") {
    const l = num(c0, 1);
    const c = num(c1, 0.4);
    const h = num(c2, 360);
    if (l !== null && c !== null && h !== null) {
      const rad = (h * Math.PI) / 180;
      rgb = oklabToRgb(l, c * Math.cos(rad), c * Math.sin(rad));
    }
  } else if (fn === "oklab") {
    const l = num(c0, 1);
    const a = num(c1, 0.4);
    const b = num(c2, 0.4);
    if (l !== null && a !== null && b !== null) rgb = oklabToRgb(l, a, b);
  }
  if (!rgb || alpha === null) return null;
  return {
    r: clamp(rgb[0], 0, 255),
    g: clamp(rgb[1], 0, 255),
    b: clamp(rgb[2], 0, 255),
    a: clamp(alpha, 0, 1),
  };
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

export const lighten = (color: Rgba, amount: number): Rgba =>
  mix(color, { ...WHITE, a: color.a }, amount);

export const darken = (color: Rgba, amount: number): Rgba =>
  mix(color, { ...BLACK, a: color.a }, amount);

export const withAlpha = (color: Rgba, a: number): Rgba => ({ ...color, a: clamp(a, 0, 1) });

export function toCss(color: Rgba): string {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  const a = Math.round(clamp(color.a, 0, 1) * 1000) / 1000;
  return `rgba(${r},${g},${b},${a})`;
}

export function luminance(color: Rgba): number {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The first candidate that stands out from `against`, else the one with most contrast. */
export function pickVivid(candidates: ReadonlyArray<Rgba>, against: Rgba, minimum = 2): Rgba {
  let best = candidates[0] ?? BLACK;
  for (const candidate of candidates) {
    if (contrast(candidate, against) >= minimum) return candidate;
    if (contrast(candidate, against) > contrast(best, against)) best = candidate;
  }
  return best;
}

export function hue(color: Rgba): number {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const raw =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

export function hueDistance(a: Rgba, b: Rgba): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

/** Like `pickVivid`, but skips candidates whose hue is too close to `avoid`. */
export function pickDistinct(
  candidates: ReadonlyArray<Rgba>,
  against: Rgba,
  avoid: Rgba,
  minimumHue = 45,
): Rgba {
  const distinct = candidates.filter((candidate) => hueDistance(candidate, avoid) >= minimumHue);
  return pickVivid(distinct.length > 0 ? distinct : candidates, against);
}

/** Whichever ink reads better on `background`. */
export function inkOn(background: Rgba, light: Rgba, dark: Rgba): Rgba {
  return contrast(background, light) >= contrast(background, dark) ? light : dark;
}
