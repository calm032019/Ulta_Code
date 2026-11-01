import type { MiniGameTheme } from "../types";
import { darken, lighten, luminance, mix, parseColor, withAlpha } from "./color";
import {
  BANNER_MS,
  POPUP_MS,
  TAIL_POINTS,
  isBlinking,
  shakeOffset,
  type Fx,
  type Particle,
} from "./fx";
import {
  GROUND_OFFSET,
  ROBOT_DUCK_WIDTH,
  ROBOT_WIDTH,
  ROBOT_X,
  viewport,
  type Obstacle,
  type RunState,
} from "./logic";

export interface Size {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface Ui {
  readonly hover: boolean;
  readonly pressed: boolean;
  readonly muted: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const DUSK_STEPS = 16;
const DUSK_DISTANCE = 45_000;

export interface Palette {
  readonly font: string;
  readonly skyTop: ReadonlyArray<string>;
  readonly skyBottom: ReadonlyArray<string>;
  readonly sun: string;
  readonly duskTint: string;
  readonly cloud: string;
  readonly cloudShade: string;
  readonly hillFar: string;
  readonly skyline: string;
  readonly windowLight: string;
  readonly hillNear: string;
  readonly mote: string;
  readonly groundTop: string;
  readonly groundBottom: string;
  readonly groundLine: string;
  readonly groundDot: string;
  readonly shadow: string;
  readonly outline: string;
  readonly bodyTop: string;
  readonly bodyBottom: string;
  readonly sheen: string;
  readonly rim: string;
  readonly visor: string;
  readonly eye: string;
  readonly eyeGlow: string;
  readonly hot: string;
  readonly crate: string;
  readonly crateDark: string;
  readonly crateLight: string;
  readonly crateEdge: string;
  readonly bracket: string;
  readonly spoolFlange: string;
  readonly spoolRim: string;
  readonly spoolCable: string;
  readonly bugLight: string;
  readonly bugDark: string;
  readonly bugGlow: string;
  readonly wing: string;
  readonly speedLine: string;
  readonly vignette: string;
  readonly vignetteClear: string;
  readonly pill: string;
  readonly pillBorder: string;
  readonly text: string;
  readonly strong: string;
  readonly badge: string;
  readonly badgeText: string;
  readonly scrim: string;
  readonly panel: string;
  readonly panelShadow: string;
  readonly button: string;
  readonly buttonHover: string;
  readonly buttonPressed: string;
  readonly buttonShadow: string;
  readonly buttonText: string;
  readonly particles: ReadonlyArray<string>;
}

/** Converts any CSS colour the browser understands (oklch, named, …) to rgba via a 1×1 canvas. */
export function normaliseTheme(theme: MiniGameTheme): MiniGameTheme {
  if (typeof document === "undefined") return theme;
  let context: CanvasRenderingContext2D | null = null;
  const normalise = (value: string) => {
    if (parseColor(value)) return value;
    context ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext(
      "2d",
      { willReadFrequently: true },
    );
    if (!context) return value;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  };
  return {
    background: normalise(theme.background),
    surface: normalise(theme.surface),
    foreground: normalise(theme.foreground),
    muted: normalise(theme.muted),
    border: normalise(theme.border),
    accent: normalise(theme.accent),
    accentForeground: normalise(theme.accentForeground),
    secondary: normalise(theme.secondary),
    success: normalise(theme.success),
    danger: normalise(theme.danger),
  };
}

export function buildPalette(theme: MiniGameTheme, font: string): Palette {
  const bg = theme.background;
  const surface = theme.surface;
  const fg = theme.foreground;
  const dark = luminance(bg) < 0.3;
  const hot =
    Math.abs(luminance(theme.accent) - luminance(bg)) > 0.08 ? theme.accent : theme.danger;
  const ink = dark ? darken(bg, 0.55) : fg;
  const skyTop: string[] = [];
  const skyBottom: string[] = [];
  for (let index = 0; index <= DUSK_STEPS; index += 1) {
    const t = index / DUSK_STEPS;
    skyTop.push(dark ? darken(bg, 0.22 + t * 0.2) : mix(mix(bg, fg, 0.05), mix(bg, fg, 0.17), t));
    skyBottom.push(mix(surface, hot, 0.06 + t * 0.18));
  }
  const horizon = skyBottom[0]!;
  const crate = dark ? mix(theme.secondary, fg, 0.16) : mix(theme.secondary, theme.muted, 0.24);
  const spoolFlange = dark
    ? mix(theme.secondary, fg, 0.22)
    : mix(theme.secondary, theme.muted, 0.32);
  const vignette = withAlpha(ink, dark ? 0.4 : 0.1);
  return {
    font,
    skyTop,
    skyBottom,
    sun: mix(surface, hot, dark ? 0.45 : 0.32),
    duskTint: hot,
    cloud: dark ? mix(surface, fg, 0.14) : lighten(surface, 0.7),
    cloudShade: dark ? mix(surface, fg, 0.06) : mix(surface, fg, 0.07),
    hillFar: mix(horizon, ink, dark ? 0.18 : 0.07),
    skyline: mix(horizon, ink, dark ? 0.3 : 0.11),
    windowLight: mix(hot, "#ffffff", 0.45),
    hillNear: mix(horizon, ink, dark ? 0.4 : 0.15),
    mote: dark ? mix(fg, hot, 0.2) : mix(theme.muted, hot, 0.3),
    groundTop: mix(bg, ink, dark ? 0.3 : 0.05),
    groundBottom: mix(bg, ink, dark ? 0.5 : 0.11),
    groundLine: mix(theme.muted, bg, 0.25),
    groundDot: theme.muted,
    shadow: withAlpha(dark ? "#000000" : fg, dark ? 0.4 : 0.18),
    outline: fg,
    bodyTop: dark ? mix(surface, fg, 0.22) : lighten(surface, 0.8),
    bodyBottom: dark ? mix(surface, fg, 0.06) : mix(surface, fg, 0.09),
    sheen: withAlpha("#ffffff", dark ? 0.28 : 0.9),
    rim: withAlpha(hot, 0.55),
    visor: dark ? darken(bg, 0.5) : mix(fg, "#000000", 0.15),
    eye: mix(hot, "#ffffff", 0.5),
    eyeGlow: withAlpha(hot, 0.9),
    hot,
    crate,
    crateDark: mix(crate, ink, dark ? 0.35 : 0.2),
    crateLight: lighten(crate, dark ? 0.12 : 0.45),
    crateEdge: mix(theme.muted, fg, dark ? 0.1 : 0.3),
    bracket: mix(theme.muted, fg, dark ? 0.25 : 0.45),
    spoolFlange,
    spoolRim: lighten(spoolFlange, dark ? 0.2 : 0.55),
    spoolCable: mix(theme.muted, fg, dark ? 0.05 : 0.2),
    bugLight: lighten(theme.danger, 0.15),
    bugDark: darken(theme.danger, 0.3),
    bugGlow: withAlpha(theme.danger, 0.55),
    wing: withAlpha(mix(surface, theme.danger, 0.15), 0.75),
    speedLine: withAlpha(theme.muted, 0.5),
    vignette,
    vignetteClear: withAlpha(ink, 0),
    pill: withAlpha(surface, 0.86),
    pillBorder: mix(theme.border, fg, 0.1),
    text: theme.muted,
    strong: fg,
    badge: withAlpha(hot, dark ? 0.24 : 0.14),
    badgeText: dark ? mix(hot, "#ffffff", 0.35) : mix(hot, fg, 0.3),
    scrim: withAlpha(bg, 0.4),
    panel: withAlpha(surface, 0.97),
    panelShadow: withAlpha("#000000", dark ? 0.45 : 0.14),
    button: hot,
    buttonHover: dark ? lighten(hot, 0.12) : darken(hot, 0.06),
    buttonPressed: darken(hot, 0.16),
    buttonShadow: darken(hot, 0.32),
    buttonText: theme.accentForeground,
    particles: [
      mix(theme.muted, bg, 0.2),
      crate,
      mix(crate, ink, 0.3),
      hot,
      theme.danger,
      theme.success,
      theme.muted,
      mix(hot, "#ffffff", 0.4),
    ],
  };
}

function hash(value: number): number {
  let t = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  t ^= t >>> 13;
  t = Math.imul(t, 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeOutBack(t: number): number {
  const c = 1.6;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function duskAmount(state: RunState): number {
  const t = Math.min(1, state.distance / DUSK_DISTANCE);
  return t * t * (3 - 2 * t);
}

function drawBackdrop(
  context: CanvasRenderingContext2D,
  state: RunState,
  fx: Fx,
  palette: Palette,
  width: number,
  height: number,
  groundY: number,
): void {
  const dusk = duskAmount(state);
  const step = Math.round(dusk * DUSK_STEPS);
  const sky = context.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, palette.skyTop[step]!);
  sky.addColorStop(1, palette.skyBottom[step]!);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const sunX = width * 0.74;
  const sunY = groundY * (0.36 + dusk * 0.3);
  context.fillStyle = palette.sun;
  context.globalAlpha = 0.18;
  context.beginPath();
  context.arc(sunX, sunY, 26, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 0.6;
  context.beginPath();
  context.arc(sunX, sunY, 15, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  const scroll = state.distance;
  const cloudShift = scroll * 0.12 + (fx.reducedMotion ? 0 : fx.time * 0.006);
  const cloudTile = 170;
  const firstCloud = Math.floor(cloudShift / cloudTile) - 1;
  for (let tile = firstCloud; tile <= firstCloud + Math.ceil(width / cloudTile) + 2; tile += 1) {
    if (hash(tile * 3) > 0.65) continue;
    const cx = tile * cloudTile + hash(tile * 5) * 80 - cloudShift;
    const cy = groundY * (0.16 + hash(tile * 7) * 0.3);
    const s = 0.7 + hash(tile * 9) * 0.6;
    for (const [fill, dy] of [
      [palette.cloudShade, 2],
      [palette.cloud, 0],
    ] as const) {
      context.fillStyle = fill;
      context.beginPath();
      context.arc(cx, cy + dy, 7 * s, 0, Math.PI * 2);
      context.arc(cx + 9 * s, cy - 3 * s + dy, 9 * s, 0, Math.PI * 2);
      context.arc(cx + 19 * s, cy + dy, 6.5 * s, 0, Math.PI * 2);
      context.fill();
      roundedRect(context, cx - 2 * s, cy + dy, 24 * s, 7 * s, 3.5 * s);
      context.fill();
    }
  }

  const farShift = scroll * 0.06;
  context.fillStyle = palette.hillFar;
  context.beginPath();
  context.moveTo(0, groundY);
  for (let x = 0; x <= width + 6; x += 6) {
    const wx = x + farShift;
    const y =
      groundY -
      20 -
      10 * Math.sin(wx * 0.011 + 1) -
      6 * Math.sin(wx * 0.027 + 2) -
      3 * Math.sin(wx * 0.053);
    context.lineTo(x, y);
  }
  context.lineTo(width, groundY);
  context.closePath();
  context.fill();

  const cityShift = scroll * 0.2;
  const cityTile = 26;
  const firstBuilding = Math.floor(cityShift / cityTile) - 1;
  for (
    let tile = firstBuilding;
    tile <= firstBuilding + Math.ceil(width / cityTile) + 2;
    tile += 1
  ) {
    if (hash(tile) > 0.6) continue;
    const w = 14 + hash(tile + 11) * 12;
    const h = 10 + hash(tile + 23) * 30;
    const x = tile * cityTile - cityShift;
    context.fillStyle = palette.skyline;
    roundedRect(context, x, groundY - h, w, h + 1, 1.5);
    context.fill();
    if (hash(tile + 31) > 0.8) context.fillRect(x + w / 2 - 0.5, groundY - h - 6, 1, 6);
    if (dusk > 0.05) {
      context.fillStyle = palette.windowLight;
      context.globalAlpha = dusk * 0.7;
      for (let row = 0; row < Math.floor((h - 6) / 6); row += 1) {
        for (let column = 0; column < Math.floor((w - 4) / 5); column += 1) {
          if (hash(tile * 97 + row * 13 + column) < 0.3) {
            context.fillRect(x + 3 + column * 5, groundY - h + 4 + row * 6, 1.6, 1.8);
          }
        }
      }
      context.globalAlpha = 1;
    }
  }

  const nearShift = scroll * 0.35;
  context.fillStyle = palette.hillNear;
  context.beginPath();
  context.moveTo(0, groundY + 1);
  for (let x = 0; x <= width + 6; x += 6) {
    const wx = x + nearShift;
    context.lineTo(x, groundY - 5 - 5 * Math.sin(wx * 0.019) - 3 * Math.sin(wx * 0.047 + 1));
  }
  context.lineTo(width, groundY + 1);
  context.closePath();
  context.fill();

  context.fillStyle = palette.mote;
  for (let index = 0; index < 12; index += 1) {
    const drift = fx.reducedMotion ? 0 : fx.time * 0.01 * (0.5 + hash(index + 3));
    const x = positiveModulo(
      hash(index) * width * 1.3 - drift - scroll * 0.15 * (0.5 + hash(index + 5)),
      width,
    );
    const bob = fx.reducedMotion ? 0 : Math.sin(fx.time * 0.0012 + index) * 4;
    const y = groundY * (0.12 + hash(index + 9) * 0.72) + bob;
    context.globalAlpha = 0.18 + hash(index + 13) * 0.2;
    context.beginPath();
    context.arc(x, y, 0.8 + hash(index + 17) * 0.9, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  if (dusk > 0) {
    context.fillStyle = palette.duskTint;
    context.globalAlpha = dusk * 0.07;
    context.fillRect(0, 0, width, groundY);
    context.globalAlpha = 1;
  }
}

function drawGround(
  context: CanvasRenderingContext2D,
  state: RunState,
  palette: Palette,
  width: number,
  height: number,
  groundY: number,
): void {
  const ground = context.createLinearGradient(0, groundY, 0, height);
  ground.addColorStop(0, palette.groundTop);
  ground.addColorStop(1, palette.groundBottom);
  context.fillStyle = ground;
  context.fillRect(0, groundY, width, height - groundY);

  context.fillStyle = palette.groundLine;
  context.fillRect(0, groundY, width, 1.2);

  context.fillStyle = palette.groundDot;
  for (const [tileSize, rowY, alpha, seed] of [
    [17, 5, 0.45, 0],
    [29, 11, 0.3, 7919],
    [41, 17, 0.2, 104_729],
  ] as const) {
    context.globalAlpha = alpha;
    const first = Math.floor(state.distance / tileSize) - 1;
    for (let tile = first; tile <= first + Math.ceil(width / tileSize) + 2; tile += 1) {
      const x = tile * tileSize + hash(tile + seed) * tileSize - state.distance;
      const length = 1 + Math.floor(hash(tile * 3 + seed) * 3);
      context.fillRect(x, groundY + rowY + hash(tile + seed + 1) * 2, length, 1);
    }
  }
  context.globalAlpha = 0.5;
  context.strokeStyle = palette.groundDot;
  context.lineWidth = 0.9;
  context.beginPath();
  const first = Math.floor(state.distance / 47) - 1;
  for (let tile = first; tile <= first + Math.ceil(width / 47) + 2; tile += 1) {
    if (hash(tile + 55) > 0.45) continue;
    const x = tile * 47 + hash(tile + 61) * 40 - state.distance;
    context.moveTo(x - 1.5, groundY - 2.5);
    context.lineTo(x, groundY);
    context.lineTo(x + 0.4, groundY - 3.2);
    context.moveTo(x + 2, groundY - 2);
    context.lineTo(x + 1, groundY);
  }
  context.stroke();
  context.globalAlpha = 1;
}

function drawContactShadow(
  context: CanvasRenderingContext2D,
  palette: Palette,
  cx: number,
  groundY: number,
  width: number,
): void {
  context.fillStyle = palette.shadow;
  context.beginPath();
  context.ellipse(cx, groundY + 0.8, width / 2, 2, 0, 0, Math.PI * 2);
  context.fill();
}

function drawCrate(
  context: CanvasRenderingContext2D,
  palette: Palette,
  x: number,
  top: number,
  size: number,
): void {
  roundedRect(context, x + 0.6, top + 0.6, size - 1.2, size - 1.2, 1.6);
  context.fillStyle = palette.crate;
  context.fill();
  context.fillStyle = palette.crateDark;
  context.globalAlpha = 0.35;
  context.fillRect(x + size - 4, top + 1.5, 2.6, size - 3);
  context.globalAlpha = 1;
  context.fillStyle = palette.crateLight;
  context.fillRect(x + 2, top + 1.6, size - 4, 1.2);

  context.strokeStyle = palette.crateDark;
  context.lineWidth = 0.9;
  context.beginPath();
  context.moveTo(x + 1.5, top + size / 3);
  context.lineTo(x + size - 1.5, top + size / 3);
  context.moveTo(x + 1.5, top + (size * 2) / 3);
  context.lineTo(x + size - 1.5, top + (size * 2) / 3);
  context.stroke();
  context.lineWidth = 1.6;
  context.beginPath();
  context.moveTo(x + 3, top + size - 3);
  context.lineTo(x + size - 3, top + 3);
  context.stroke();

  roundedRect(context, x + 0.6, top + 0.6, size - 1.2, size - 1.2, 1.6);
  context.strokeStyle = palette.crateEdge;
  context.lineWidth = 1.1;
  context.stroke();

  context.fillStyle = palette.bracket;
  const b = 3.2;
  for (const [bx, by] of [
    [x + 0.6, top + 0.6],
    [x + size - 0.6 - b, top + 0.6],
    [x + 0.6, top + size - 0.6 - b],
    [x + size - 0.6 - b, top + size - 0.6 - b],
  ] as const) {
    roundedRect(context, bx, by, b, b, 0.8);
    context.fill();
  }
}

function drawSpool(
  context: CanvasRenderingContext2D,
  palette: Palette,
  obstacle: Obstacle,
  groundY: number,
): void {
  const radius = obstacle.w / 2;
  const cx = obstacle.x + radius;
  const cy = groundY - radius;
  context.beginPath();
  context.arc(cx, cy, radius - 0.6, 0, Math.PI * 2);
  context.fillStyle = palette.spoolFlange;
  context.fill();
  context.strokeStyle = palette.crateEdge;
  context.lineWidth = 1.1;
  context.stroke();

  context.beginPath();
  context.arc(cx, cy, radius - 3.6, 0, Math.PI * 2);
  context.fillStyle = palette.spoolCable;
  context.fill();
  context.strokeStyle = palette.spoolFlange;
  context.lineWidth = 0.8;
  context.globalAlpha = 0.6;
  for (const ring of [radius - 5.2, radius - 6.8]) {
    context.beginPath();
    context.arc(cx, cy, ring, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.beginPath();
  context.arc(cx, cy, 3, 0, Math.PI * 2);
  context.fillStyle = palette.spoolFlange;
  context.fill();
  context.strokeStyle = palette.bracket;
  context.lineWidth = 1;
  context.stroke();

  context.strokeStyle = palette.spoolRim;
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(cx, cy, radius - 1.6, Math.PI * 1.05, Math.PI * 1.6);
  context.stroke();

  context.strokeStyle = palette.spoolCable;
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(cx + radius - 3.6, cy + 1);
  context.quadraticCurveTo(cx + radius + 3, cy + radius - 2, cx + radius + 6, groundY - 0.6);
  context.stroke();
}

function drawBug(
  context: CanvasRenderingContext2D,
  palette: Palette,
  obstacle: Obstacle,
  groundY: number,
  fx: Fx,
): void {
  const cx = obstacle.x + obstacle.w / 2 + 1;
  const bob = fx.reducedMotion ? 0 : Math.sin(fx.time * 0.008 + obstacle.x * 0.05) * 1.2;
  const cy = groundY - obstacle.y - obstacle.h / 2 + bob;
  const flap = Math.sin(fx.time * 0.06 + obstacle.x);

  context.strokeStyle = palette.bugDark;
  context.lineWidth = 0.9;
  context.beginPath();
  for (const offset of [-3, 0, 3]) {
    context.moveTo(cx + offset, cy + 3);
    context.lineTo(cx + offset - 1.5, cy + 6);
  }
  context.moveTo(cx - 8, cy - 2);
  context.quadraticCurveTo(cx - 11, cy - 7, cx - 13, cy - 6);
  context.moveTo(cx - 7, cy - 3);
  context.quadraticCurveTo(cx - 8, cy - 8, cx - 10, cy - 9);
  context.stroke();

  context.save();
  context.shadowColor = palette.bugGlow;
  context.shadowBlur = 8;
  const shell = context.createLinearGradient(cx, cy - 5, cx, cy + 5);
  shell.addColorStop(0, palette.bugLight);
  shell.addColorStop(1, palette.bugDark);
  context.fillStyle = shell;
  context.beginPath();
  context.ellipse(cx + 1, cy, 7.5, 5, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = palette.bugDark;
  context.beginPath();
  context.arc(cx - 6.5, cy - 0.5, 3.2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.bugDark;
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(cx + 1, cy - 4.8);
  context.lineTo(cx + 1, cy + 4.8);
  context.stroke();
  context.fillStyle = palette.sheen;
  context.beginPath();
  context.ellipse(cx + 3.5, cy - 2.6, 2.2, 1, -0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.eye;
  context.beginPath();
  context.arc(cx - 7.5, cy - 1.2, 1, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.wing;
  for (const side of [0, 1]) {
    context.beginPath();
    context.ellipse(
      cx + (side === 0 ? -1 : 3),
      cy - 5 - flap * 1.5,
      5.5,
      2 + Math.abs(flap) * 1.6,
      (side === 0 ? -0.5 : -0.2) - flap * 0.3,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  palette: Palette,
  obstacle: Obstacle,
  groundY: number,
  fx: Fx,
): void {
  const top = groundY - obstacle.y - obstacle.h;
  switch (obstacle.kind) {
    case "crate":
    case "crates-wide":
    case "crates-tall":
      drawContactShadow(context, palette, obstacle.x + obstacle.w / 2, groundY, obstacle.w + 4);
      for (let column = 0; column < obstacle.w; column += 16) {
        for (let row = obstacle.h - 16; row >= 0; row -= 16) {
          drawCrate(context, palette, obstacle.x + column, top + row, 16);
        }
      }
      return;
    case "crates-stack":
      drawContactShadow(context, palette, obstacle.x + 16, groundY, 36);
      drawCrate(context, palette, obstacle.x, top + 16, 16);
      drawCrate(context, palette, obstacle.x + 16, top + 16, 16);
      drawCrate(context, palette, obstacle.x + 8, top, 16);
      return;
    case "spool":
      drawContactShadow(context, palette, obstacle.x + obstacle.w / 2, groundY, obstacle.w);
      drawSpool(context, palette, obstacle, groundY);
      return;
    case "bug-low":
    case "bug-high":
      context.globalAlpha = 0.5;
      drawContactShadow(context, palette, obstacle.x + obstacle.w / 2, groundY, 12);
      context.globalAlpha = 1;
      drawBug(context, palette, obstacle, groundY, fx);
  }
}

function drawEyes(
  context: CanvasRenderingContext2D,
  palette: Palette,
  positions: ReadonlyArray<readonly [number, number]>,
  dead: boolean,
  blink: boolean,
): void {
  if (dead) {
    context.strokeStyle = palette.eye;
    context.lineWidth = 1.3;
    context.beginPath();
    for (const [x, y] of positions) {
      context.moveTo(x - 1.7, y - 1.7);
      context.lineTo(x + 1.7, y + 1.7);
      context.moveTo(x + 1.7, y - 1.7);
      context.lineTo(x - 1.7, y + 1.7);
    }
    context.stroke();
    return;
  }
  context.save();
  context.shadowColor = palette.eyeGlow;
  context.shadowBlur = 6;
  context.fillStyle = palette.eye;
  const h = blink ? 0.8 : 4.6;
  for (const [x, y] of positions) {
    roundedRect(context, x - 1.5, y - h / 2, 3, h, 1.5);
    context.fill();
  }
  context.restore();
}

function drawTail(
  context: CanvasRenderingContext2D,
  palette: Palette,
  fx: Fx,
  groundY: number,
): void {
  const tail = fx.tail;
  context.beginPath();
  context.moveTo(tail[0]!, groundY - tail[1]!);
  for (let index = 1; index < TAIL_POINTS; index += 1) {
    const offset = index * 4;
    const previous = (index - 1) * 4;
    const midX = (tail[previous]! + tail[offset]!) / 2;
    const midY = groundY - (tail[previous + 1]! + tail[offset + 1]!) / 2;
    context.quadraticCurveTo(tail[previous]!, groundY - tail[previous + 1]!, midX, midY);
  }
  const end = (TAIL_POINTS - 1) * 4;
  context.lineTo(tail[end]!, groundY - tail[end + 1]!);
  context.strokeStyle = palette.outline;
  context.lineWidth = 2.6;
  context.stroke();
  context.strokeStyle = palette.hot;
  context.lineWidth = 1.1;
  context.stroke();
  context.fillStyle = palette.outline;
  context.beginPath();
  context.arc(tail[end]!, groundY - tail[end + 1]!, 1.9, 0, Math.PI * 2);
  context.fill();
}

function drawRobot(
  context: CanvasRenderingContext2D,
  state: RunState,
  fx: Fx,
  palette: Palette,
  groundY: number,
): void {
  const dead = state.phase === "over";
  const blink = isBlinking(fx) && !dead;
  const ducking = state.ducking;
  const cx = ROBOT_X + (ducking ? ROBOT_DUCK_WIDTH : ROBOT_WIDTH) / 2;
  const base = groundY - state.robotY;
  const idleBob =
    state.phase === "ready" && !fx.reducedMotion ? Math.sin(fx.time * 0.004) * 0.6 : 0;

  const shadowScale = Math.max(0.35, 1 - state.robotY / 110);
  context.globalAlpha = shadowScale;
  drawContactShadow(context, palette, cx, groundY, (ducking ? 30 : 22) * shadowScale);
  context.globalAlpha = 1;

  drawTail(context, palette, fx, groundY);

  const squash = Math.max(-0.3, Math.min(0.3, fx.squash));
  context.save();
  context.translate(cx, base);
  context.scale(1 - squash * 0.6, 1 + squash);
  context.translate(0, idleBob);

  const airborne = !state.grounded && state.phase !== "ready";
  const swing = state.phase === "running" && state.grounded ? Math.sin(fx.legPhase) : 0;
  context.strokeStyle = palette.outline;
  context.lineWidth = 2.6;
  context.beginPath();
  const hipY = ducking ? -3 : -5.5;
  for (const [hipX, phase] of [
    [ducking ? -7 : -4.5, swing],
    [ducking ? 7 : 4.5, -swing],
  ] as const) {
    const angle = airborne ? -0.55 : phase * 0.55;
    const length = airborne ? 4.2 : ducking ? 3 : 5.5;
    const lift = airborne ? 0 : Math.max(0, phase) * 1.4;
    context.moveTo(hipX, hipY);
    context.lineTo(hipX + Math.sin(angle) * length, hipY + Math.cos(angle) * length - lift);
  }
  context.stroke();

  const bodyLeft = ducking ? -14 : -11;
  const bodyWidth = ducking ? 28 : 22;
  const bodyTop = ducking ? -15 : -25;
  const bodyHeight = ducking ? 12.5 : 20;
  const radius = ducking ? 6 : 8;

  const antennaBaseX = ducking ? -6 : 0;
  const antennaAngle = fx.antenna + (ducking ? -1 : 0);
  const tipX = antennaBaseX + Math.sin(antennaAngle) * 7;
  const tipY = bodyTop - Math.cos(antennaAngle) * 7;
  context.lineWidth = 1.7;
  context.beginPath();
  context.moveTo(antennaBaseX, bodyTop + 1);
  context.quadraticCurveTo(antennaBaseX, bodyTop - 3, tipX, tipY);
  context.stroke();
  context.save();
  context.shadowColor = palette.eyeGlow;
  context.shadowBlur = 5;
  context.fillStyle = palette.hot;
  context.beginPath();
  context.arc(tipX, tipY, 2.3, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const body = context.createLinearGradient(0, bodyTop, 0, bodyTop + bodyHeight);
  body.addColorStop(0, palette.bodyTop);
  body.addColorStop(1, palette.bodyBottom);
  roundedRect(context, bodyLeft, bodyTop, bodyWidth, bodyHeight, radius);
  context.fillStyle = body;
  context.fill();

  context.save();
  roundedRect(context, bodyLeft, bodyTop, bodyWidth, bodyHeight, radius);
  context.clip();
  roundedRect(context, bodyLeft - 1.6, bodyTop - 1.6, bodyWidth, bodyHeight, radius);
  context.strokeStyle = palette.rim;
  context.lineWidth = 2.4;
  context.stroke();
  context.fillStyle = palette.sheen;
  context.beginPath();
  context.ellipse(bodyLeft + 6, bodyTop + 3.6, 4.6, 2, -0.35, 0, Math.PI * 2);
  context.fill();
  context.restore();

  roundedRect(context, bodyLeft, bodyTop, bodyWidth, bodyHeight, radius);
  context.strokeStyle = palette.outline;
  context.lineWidth = 2.5;
  context.stroke();

  const visorX = ducking ? 1 : -8;
  const visorY = bodyTop + (ducking ? 2.6 : 4);
  const visorW = ducking ? 11.5 : 16;
  const visorH = ducking ? 7 : 9;
  roundedRect(context, visorX, visorY, visorW, visorH, visorH / 2);
  context.fillStyle = palette.visor;
  context.fill();
  const eyeY = visorY + visorH / 2;
  drawEyes(
    context,
    palette,
    ducking
      ? [
          [visorX + 4, eyeY],
          [visorX + 8.5, eyeY],
        ]
      : [
          [visorX + 5, eyeY],
          [visorX + 11.5, eyeY],
        ],
    dead,
    blink,
  );

  if (!ducking) {
    context.fillStyle = palette.hot;
    roundedRect(context, -3, bodyTop + bodyHeight - 5.5, 6, 2, 1);
    context.fill();
  }
  context.restore();
}

function drawParticles(
  context: CanvasRenderingContext2D,
  particles: ReadonlyArray<Particle>,
  palette: Palette,
  groundY: number,
): void {
  for (const particle of particles) {
    if (!particle.active) continue;
    const t = particle.age / particle.life;
    context.globalAlpha = Math.max(0, 1 - t * t);
    context.fillStyle = palette.particles[particle.colour] ?? palette.strong;
    const y = groundY - particle.y;
    if (particle.square) {
      context.save();
      context.translate(particle.x, y);
      context.rotate(particle.angle);
      context.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.66);
      context.restore();
    } else {
      context.beginPath();
      context.arc(particle.x, y, particle.size * (1 + t * 0.6), 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalAlpha = 1;
}

function drawSpeedLines(
  context: CanvasRenderingContext2D,
  state: RunState,
  fx: Fx,
  palette: Palette,
  width: number,
  groundY: number,
): void {
  if (fx.reducedMotion || state.phase !== "running" || state.speed < 430) return;
  const strength = Math.min(1, (state.speed - 430) / 190);
  context.strokeStyle = palette.speedLine;
  context.lineWidth = 0.8;
  context.globalAlpha = strength * 0.7;
  context.beginPath();
  const span = width + 80;
  for (let index = 0; index < 7; index += 1) {
    const x =
      positiveModulo(hash(index) * span - state.distance * (1.4 + hash(index + 1)), span) - 40;
    const y = groundY * (0.2 + hash(index + 2) * 0.7);
    context.moveTo(x, y);
    context.lineTo(x + 18 + hash(index + 3) * 30, y);
  }
  context.stroke();
  context.globalAlpha = 1;
}

function font(palette: Palette, weight: number, size: number): string {
  return `${weight} ${size}px ${palette.font}`;
}

function pill(
  context: CanvasRenderingContext2D,
  palette: Palette,
  rect: Rect,
  fill = palette.pill,
): void {
  roundedRect(context, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = palette.pillBorder;
  context.lineWidth = 1;
  context.stroke();
}

function hudMetrics(height: number) {
  return {
    pad: Math.round(Math.min(12, Math.max(8, height / 18))),
    pillHeight: Math.round(Math.min(26, Math.max(20, height * 0.12))),
    textSize: Math.round(Math.min(13, Math.max(11, height / 15))),
  };
}

export function muteButtonRect(height: number): Rect {
  const { pad, pillHeight } = hudMetrics(height);
  return { x: pad, y: pad, w: pillHeight, h: pillHeight };
}

export function cardLayout(width: number, height: number) {
  const compact = height < 190;
  const pad = compact ? 10 : 14;
  const panelW = Math.min(width - 24, 380);
  const panelH = compact ? Math.min(height - 16, 116) : 142;
  const panel = { x: (width - panelW) / 2, y: (height - panelH) / 2, w: panelW, h: panelH };
  const buttonH = compact ? 24 : 28;
  const button = { x: width / 2 - 58, y: panel.y + panelH - pad - buttonH, w: 116, h: buttonH };
  return { compact, pad, panel, button };
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function drawSpeaker(
  context: CanvasRenderingContext2D,
  palette: Palette,
  rect: Rect,
  muted: boolean,
): void {
  pill(context, palette, rect);
  const cx = rect.x + rect.w / 2 - 2;
  const cy = rect.y + rect.h / 2;
  const s = rect.h / 22;
  context.fillStyle = palette.text;
  context.beginPath();
  context.moveTo(cx - 5 * s, cy - 2.5 * s);
  context.lineTo(cx - 2 * s, cy - 2.5 * s);
  context.lineTo(cx + 2 * s, cy - 6 * s);
  context.lineTo(cx + 2 * s, cy + 6 * s);
  context.lineTo(cx - 2 * s, cy + 2.5 * s);
  context.lineTo(cx - 5 * s, cy + 2.5 * s);
  context.closePath();
  context.fill();
  context.strokeStyle = palette.text;
  context.lineWidth = 1.3;
  context.lineCap = "round";
  context.beginPath();
  if (muted) {
    context.moveTo(cx + 4.5 * s, cy - 2.5 * s);
    context.lineTo(cx + 9 * s, cy + 2.5 * s);
    context.moveTo(cx + 9 * s, cy - 2.5 * s);
    context.lineTo(cx + 4.5 * s, cy + 2.5 * s);
  } else {
    context.arc(cx + 2.5 * s, cy, 4 * s, -0.8, 0.8);
    context.moveTo(cx + 2.5 * s + Math.cos(-0.8) * 7 * s, cy + Math.sin(-0.8) * 7 * s);
    context.arc(cx + 2.5 * s, cy, 7 * s, -0.8, 0.8);
  }
  context.stroke();
}

function drawTitle(
  context: CanvasRenderingContext2D,
  state: RunState,
  palette: Palette,
  size: Size,
): void {
  const { width, height } = size;
  const titleSize = Math.round(Math.min(40, Math.max(22, height * 0.17)));
  const centreY = height * (height < 170 ? 0.3 : 0.32);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = font(palette, 800, titleSize);
  context.fillStyle = palette.strong;
  context.fillText("Claude Run", width / 2, centreY);

  const subtitleSize = Math.round(Math.min(14, Math.max(11, height / 14)));
  const subtitleY = centreY + titleSize * 0.62 + subtitleSize * 0.4;
  context.font = font(palette, 500, subtitleSize);
  context.fillStyle = palette.text;
  context.fillText("Press Space or tap to play", width / 2, subtitleY);

  if (state.best > 0) {
    context.font = font(palette, 600, subtitleSize - 1);
    const text = `BEST ${state.best}`;
    const w = context.measureText(text).width + 18;
    const h = subtitleSize + 8;
    const y = subtitleY + subtitleSize;
    roundedRect(context, width / 2 - w / 2, y, w, h, h / 2);
    context.fillStyle = palette.badge;
    context.fill();
    context.fillStyle = palette.badgeText;
    context.fillText(text, width / 2, y + h / 2 + 0.5);
  }
}

function drawCard(
  context: CanvasRenderingContext2D,
  state: RunState,
  fx: Fx,
  palette: Palette,
  size: Size,
  ui: Ui,
): void {
  const { width, height } = size;
  const appear = Math.min(1, fx.cardMs / 260);
  const grow = fx.reducedMotion ? 1 : 0.92 + 0.08 * easeOutBack(appear);
  const { compact, pad, panel, button } = cardLayout(width, height);

  context.globalAlpha = appear;
  context.fillStyle = palette.scrim;
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(width / 2, height / 2);
  context.scale(grow, grow);
  context.translate(-width / 2, -height / 2);

  context.save();
  context.shadowColor = palette.panelShadow;
  context.shadowBlur = 18;
  context.shadowOffsetY = 4;
  roundedRect(context, panel.x, panel.y, panel.w, panel.h, 14);
  context.fillStyle = palette.panel;
  context.fill();
  context.restore();
  context.strokeStyle = palette.pillBorder;
  context.lineWidth = 1;
  roundedRect(context, panel.x, panel.y, panel.w, panel.h, 14);
  context.stroke();

  const titleSize = compact ? 15 : 17;
  const titleY = panel.y + pad + titleSize / 2 + 1;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.font = font(palette, 750, titleSize);
  context.fillStyle = palette.strong;
  context.fillText("Game over", panel.x + pad + 2, titleY);
  const titleWidth = context.measureText("Game over").width;

  if (state.newBest) {
    const pulse = fx.reducedMotion ? 1 : 1 + 0.08 * Math.max(0, 1 - fx.cardMs / 900);
    context.font = font(palette, 750, 10);
    const w = context.measureText("NEW BEST").width + 12;
    const x = panel.x + pad + 2 + titleWidth + 8;
    context.save();
    context.translate(x + w / 2, titleY);
    context.scale(pulse, pulse);
    roundedRect(context, -w / 2, -8, w, 16, 8);
    context.fillStyle = palette.button;
    context.fill();
    context.fillStyle = palette.buttonText;
    context.textAlign = "center";
    context.fillText("NEW BEST", 0, 0.5);
    context.restore();
  }

  if (panel.w >= 330) {
    context.font = font(palette, 500, 11);
    context.textAlign = "right";
    context.fillStyle = palette.text;
    context.fillText("Space or tap to restart", panel.x + panel.w - pad - 2, titleY);
  }

  const stats: ReadonlyArray<readonly [string, string]> = [
    ["Score", String(state.score)],
    ["Best", String(state.best)],
    ["Distance", `${Math.floor(state.distance / 10)} m`],
    ["Near misses", String(state.nearMisses)],
  ];
  const statsTop = panel.y + pad + titleSize + (compact ? 6 : 10);
  const column = (panel.w - pad * 2) / stats.length;
  context.textAlign = "center";
  stats.forEach(([label, value], index) => {
    const x = panel.x + pad + column * index + column / 2;
    context.font = font(palette, 550, 10.5);
    context.fillStyle = palette.text;
    context.fillText(label, x, statsTop + 5);
    context.font = font(palette, 700, compact ? 15 : 17);
    context.fillStyle = palette.strong;
    context.fillText(value, x, statsTop + (compact ? 20 : 23));
  });

  const pressed = ui.pressed;
  if (!pressed) {
    roundedRect(context, button.x, button.y + 2, button.w, button.h, button.h / 2);
    context.fillStyle = palette.buttonShadow;
    context.fill();
  }
  const offset = pressed ? 1.5 : 0;
  roundedRect(context, button.x, button.y + offset, button.w, button.h, button.h / 2);
  context.fillStyle = pressed
    ? palette.buttonPressed
    : ui.hover
      ? palette.buttonHover
      : palette.button;
  context.fill();
  context.font = font(palette, 700, 12.5);
  context.fillStyle = palette.buttonText;
  context.fillText("Play again", button.x + button.w / 2, button.y + button.h / 2 + offset + 0.5);

  context.restore();
  context.globalAlpha = 1;
}

function drawHud(
  context: CanvasRenderingContext2D,
  state: RunState,
  fx: Fx,
  palette: Palette,
  size: Size,
  ui: Ui,
  scale: number,
  groundY: number,
): void {
  const { width, height } = size;
  const { pad, pillHeight, textSize } = hudMetrics(height);
  context.textBaseline = "middle";
  context.lineJoin = "round";

  drawSpeaker(context, palette, muteButtonRect(height), ui.muted);

  if (state.phase !== "ready") {
    context.font = font(palette, 650, textSize + 1);
    const scoreText = String(Math.round(fx.displayScore));
    const scoreWidth = Math.max(context.measureText(scoreText).width, textSize * 2) + pillHeight;
    const scoreRect = { x: width - pad - scoreWidth, y: pad, w: scoreWidth, h: pillHeight };
    pill(context, palette, scoreRect);
    context.fillStyle = palette.strong;
    context.textAlign = "center";
    context.fillText(scoreText, scoreRect.x + scoreRect.w / 2, scoreRect.y + pillHeight / 2 + 0.5);

    context.font = font(palette, 600, textSize - 1);
    const bestText = `BEST ${state.best}`;
    const bestWidth = context.measureText(bestText).width + pillHeight * 0.8;
    const bestRect = {
      x: scoreRect.x - 6 - bestWidth,
      y: pad + 2,
      w: bestWidth,
      h: pillHeight - 4,
    };
    roundedRect(context, bestRect.x, bestRect.y, bestRect.w, bestRect.h, bestRect.h / 2);
    context.fillStyle = palette.badge;
    context.fill();
    context.fillStyle = palette.badgeText;
    context.fillText(bestText, bestRect.x + bestRect.w / 2, bestRect.y + bestRect.h / 2 + 0.5);

    if (state.combo >= 2 && state.phase === "running") {
      context.textAlign = "right";
      context.fillText(`Combo ×${state.combo}`, width - pad - 4, pad + pillHeight + textSize);
    }
  }

  for (const item of fx.popups) {
    if (!item.active) continue;
    const t = item.age / POPUP_MS;
    const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.4 : 1;
    context.save();
    context.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    context.translate(
      Math.min(width - 50, Math.max(50, item.x * scale)),
      Math.max(pad + pillHeight + textSize, (groundY - item.y) * scale - easeOutCubic(t) * 20),
    );
    context.scale(pop, pop);
    context.font = font(palette, 700, textSize);
    context.textAlign = "center";
    context.strokeStyle = palette.panel;
    context.lineWidth = 3;
    context.strokeText(item.text, 0, 0);
    context.fillStyle = item.accent ? palette.badgeText : palette.strong;
    context.fillText(item.text, 0, 0);
    context.restore();
  }

  if (fx.bannerMs > 0) {
    const t = 1 - fx.bannerMs / BANNER_MS;
    const enter = easeOutBack(Math.min(1, t / 0.2));
    context.font = font(palette, 700, textSize);
    const w = context.measureText(fx.bannerText).width + pillHeight;
    const rect = { x: width / 2 - w / 2, y: pad - 10 + enter * 10, w, h: pillHeight };
    context.globalAlpha = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;
    pill(context, palette, rect, palette.button);
    context.fillStyle = palette.buttonText;
    context.textAlign = "center";
    context.fillText(fx.bannerText, width / 2, rect.y + rect.h / 2 + 0.5);
    context.globalAlpha = 1;
  }

  if (state.phase === "ready") drawTitle(context, state, palette, size);
  if (state.phase === "over" && fx.hitStopMs <= 0) drawCard(context, state, fx, palette, size, ui);
}

export function render(
  context: CanvasRenderingContext2D,
  state: RunState,
  fx: Fx,
  palette: Palette,
  size: Size,
  ui: Ui,
): void {
  const view = viewport(size.width, size.height);
  const groundY = view.height - GROUND_OFFSET;
  const shake = shakeOffset(fx);
  const ratio = size.pixelRatio;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = palette.skyBottom[0]!;
  context.fillRect(0, 0, size.width, size.height);

  context.setTransform(
    ratio * view.scale,
    0,
    0,
    ratio * view.scale,
    shake.x * ratio,
    shake.y * ratio,
  );
  context.lineCap = "round";
  context.lineJoin = "round";
  drawBackdrop(context, state, fx, palette, view.width + 8, view.height + 8, groundY);
  drawGround(context, state, palette, view.width + 8, view.height + 8, groundY);
  for (const obstacle of state.obstacles) {
    if (obstacle.x < view.width + 10 && obstacle.x + obstacle.w > -10) {
      drawObstacle(context, palette, obstacle, groundY, fx);
    }
  }
  drawRobot(context, state, fx, palette, groundY);
  drawParticles(context, fx.particles, palette, groundY);
  drawSpeedLines(context, state, fx, palette, view.width, groundY);

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const vignette = context.createRadialGradient(
    size.width / 2,
    size.height * 0.45,
    Math.min(size.width, size.height) * 0.35,
    size.width / 2,
    size.height * 0.45,
    Math.max(size.width, size.height) * 0.75,
  );
  vignette.addColorStop(0, palette.vignetteClear);
  vignette.addColorStop(1, palette.vignette);
  context.fillStyle = vignette;
  context.fillRect(0, 0, size.width, size.height);

  drawHud(context, state, fx, palette, size, ui, view.scale, groundY);
}
