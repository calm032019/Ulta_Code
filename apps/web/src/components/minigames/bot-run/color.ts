export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;
  if (expanded.length !== 6 && expanded.length !== 8) return null;
  const channel = (index: number) => Number.parseInt(expanded.slice(index, index + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: expanded.length === 8 ? channel(6) / 255 : 1,
  };
}

function parseChannel(token: string): number | null {
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return null;
  return clamp(token.endsWith("%") ? (value / 100) * 255 : value, 0, 255);
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return null;
  return clamp(token.endsWith("%") ? value / 100 : value, 0, 1);
}

/** Parses hex and rgb()/rgba() colours, the forms canvas reads back; returns null for anything else. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase();
  if (text.startsWith("#")) return parseHex(text.slice(1));
  const match = /^rgba?\((.*)\)$/.exec(text);
  if (!match?.[1]) return null;
  const tokens = match[1]
    .replace(/\s*\/\s*/, " / ")
    .split(/[\s,]+/)
    .filter((token) => token.length > 0 && token !== "/");
  if (tokens.length !== 3 && tokens.length !== 4) return null;
  const [r, g, b] = tokens.slice(0, 3).map(parseChannel);
  const a = parseAlpha(tokens[3]);
  if (r == null || g == null || b == null || a === null) return null;
  return { r, g, b, a };
}

function formatColor(color: Rgba): string {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  const a = Math.round(color.a * 1000) / 1000;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function mixRgba(from: Rgba, to: Rgba, amount: number): Rgba {
  const t = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: from.a + (to.a - from.a) * t,
  };
}

function resolve(color: Rgba | string): Rgba | null {
  return typeof color === "string" ? parseColor(color) : color;
}

/** Mixes two colours; an unparseable input falls back to whichever side the mix leans towards. */
export function mix(from: Rgba | string, to: Rgba | string, amount: number): string {
  const a = resolve(from);
  const b = resolve(to);
  if (!a || !b) {
    const pick = amount < 0.5 ? from : to;
    return typeof pick === "string" ? pick : formatColor(pick);
  }
  return formatColor(mixRgba(a, b, amount));
}

export function lighten(color: Rgba | string, amount: number): string {
  return mix(color, WHITE, amount);
}

export function darken(color: Rgba | string, amount: number): string {
  return mix(color, BLACK, amount);
}

export function withAlpha(color: Rgba | string, alpha: number): string {
  const parsed = resolve(color);
  if (!parsed) return typeof color === "string" ? color : formatColor(color);
  return formatColor({ ...parsed, a: clamp(alpha, 0, 1) });
}

/** Relative luminance in 0..1 (WCAG); unknown colours count as mid-grey. */
export function luminance(color: Rgba | string): number {
  const parsed = resolve(color);
  if (!parsed) return 0.5;
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(parsed.r) + 0.7152 * linear(parsed.g) + 0.0722 * linear(parsed.b);
}
