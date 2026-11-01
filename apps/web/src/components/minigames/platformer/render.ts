import type { MiniGameTheme } from "../types";
import { darken, lighten, luminance, mix, toCss, withAlpha, type Rgba } from "./color";
import { PARTICLE_CONFETTI, PARTICLE_DUST, PARTICLE_TEXT, type Effects } from "./effects";
import { DRONE_H, DRONE_W, LIFT_H, beaconRect, liftX } from "./level";
import { DOUBLE_JUMP_LEVEL, INTRO_TIME, START_LIVES, type GameState } from "./logic";
import {
  HERO_H,
  HERO_W,
  JUMP_SPEED,
  ROWS,
  TILE_CRATE,
  TILE_ROOF,
  TILE_SPIKE,
  isSolid,
  tileAt,
} from "./physics";

export interface Palette {
  readonly dark: boolean;
  readonly skyTop: string;
  readonly skyBottom: string;
  readonly glow: string;
  readonly glowFade: string;
  readonly far: string;
  readonly farWindow: string;
  readonly bird: string;
  readonly mid: string;
  readonly midDetail: string;
  readonly midLight: string;
  readonly mote: string;
  readonly roof: string;
  readonly roofTop: string;
  readonly roofEdge: string;
  readonly roofSide: string;
  readonly roofWindow: string;
  readonly shadow: string;
  readonly crate: string;
  readonly crateDark: string;
  readonly crateLight: string;
  readonly lift: string;
  readonly liftTrack: string;
  readonly chevron: string;
  readonly spike: string;
  readonly spikeDark: string;
  readonly spikeLight: string;
  readonly star: string;
  readonly starGlow: string;
  readonly starLight: string;
  readonly drone: string;
  readonly droneDark: string;
  readonly droneLight: string;
  readonly rotor: string;
  readonly eye: string;
  readonly accent: string;
  readonly accentDark: string;
  readonly accentLight: string;
  readonly accentGlow: string;
  readonly accentForeground: string;
  readonly hero: string;
  readonly heroSheen: string;
  readonly cap: string;
  readonly satchel: string;
  readonly outline: string;
  readonly foreground: string;
  readonly foregroundSoft: string;
  readonly muted: string;
  readonly pill: string;
  readonly pillBorder: string;
  readonly card: string;
  readonly scrim: string;
  readonly success: string;
  readonly danger: string;
  readonly secondary: string;
  readonly dust: string;
}

/** Derives every colour the game paints from the theme, so light and dark both stay on palette. */
export function buildPalette(theme: MiniGameTheme, resolve: (css: string) => Rgba): Palette {
  const background = resolve(theme.background);
  const surface = resolve(theme.surface);
  const foreground = resolve(theme.foreground);
  const muted = resolve(theme.muted);
  const border = resolve(theme.border);
  const accent = resolve(theme.accent);
  const secondary = resolve(theme.secondary);
  const success = resolve(theme.success);
  const danger = resolve(theme.danger);
  const dark = luminance(background) < 0.3;
  const shade = (color: Rgba, amount: number) =>
    dark ? lighten(color, amount) : darken(color, amount);
  const sink = (color: Rgba, amount: number) =>
    dark ? darken(color, amount) : darken(color, amount * 0.6);
  const roof = mix(mix(secondary, border, 0.4), foreground, dark ? 0.2 : 0.3);
  const sky = mix(background, accent, 0.08);
  return {
    dark,
    skyTop: toCss(dark ? darken(sky, 0.25) : mix(sky, accent, 0.12)),
    skyBottom: toCss(mix(surface, accent, dark ? 0.12 : 0.05)),
    glow: toCss(
      withAlpha(
        dark ? lighten(muted, 0.5) : mix(accent, { r: 255, g: 236, b: 200, a: 1 }, 0.5),
        0.55,
      ),
    ),
    glowFade: toCss(withAlpha(dark ? lighten(muted, 0.5) : accent, 0)),
    far: toCss(mix(background, muted, dark ? 0.16 : 0.14)),
    farWindow: toCss(
      withAlpha(mix(accent, { r: 255, g: 220, b: 150, a: 1 }, 0.5), dark ? 0.75 : 0.45),
    ),
    bird: toCss(withAlpha(mix(muted, background, 0.2), 0.8)),
    mid: toCss(mix(background, muted, dark ? 0.3 : 0.26)),
    midDetail: toCss(mix(background, muted, dark ? 0.38 : 0.34)),
    midLight: toCss(withAlpha(danger, 0.8)),
    mote: toCss(withAlpha(dark ? lighten(muted, 0.4) : darken(muted, 0.1), 0.35)),
    roof: toCss(roof),
    roofTop: toCss(shade(roof, 0.12)),
    roofEdge: toCss(withAlpha(lighten(roof, 0.45), 0.9)),
    roofSide: toCss(sink(roof, 0.22)),
    roofWindow: toCss(withAlpha(sink(roof, 0.28), 0.8)),
    shadow: toCss(withAlpha(darken(background, 0.6), dark ? 0.45 : 0.22)),
    crate: toCss(mix(secondary, accent, 0.18)),
    crateDark: toCss(sink(mix(secondary, accent, 0.18), 0.3)),
    crateLight: toCss(lighten(mix(secondary, accent, 0.18), 0.25)),
    lift: toCss(mix(border, secondary, 0.4)),
    liftTrack: toCss(withAlpha(border, 0.7)),
    chevron: toCss(withAlpha(accent, 0.85)),
    spike: toCss(danger),
    spikeDark: toCss(darken(danger, 0.3)),
    spikeLight: toCss(lighten(danger, 0.55)),
    star: toCss(success),
    starGlow: toCss(withAlpha(success, 0.22)),
    starLight: toCss(lighten(success, 0.7)),
    drone: toCss(danger),
    droneDark: toCss(darken(danger, 0.35)),
    droneLight: toCss(withAlpha(lighten(danger, 0.5), 0.8)),
    rotor: toCss(withAlpha(foreground, 0.28)),
    eye: toCss(lighten(mix(danger, { r: 255, g: 240, b: 200, a: 1 }, 0.7), 0.3)),
    accent: toCss(accent),
    accentDark: toCss(darken(accent, 0.25)),
    accentLight: toCss(lighten(accent, 0.35)),
    accentGlow: toCss(withAlpha(accent, 0.35)),
    accentForeground: theme.accentForeground,
    hero: toCss(dark ? lighten(surface, 0.85) : surface),
    heroSheen: toCss(withAlpha({ r: 255, g: 255, b: 255, a: 1 }, 0.55)),
    cap: toCss(mix(foreground, accent, 0.2)),
    satchel: toCss(mix(secondary, foreground, 0.35)),
    outline: toCss(dark ? darken(background, 0.45) : foreground),
    foreground: toCss(foreground),
    foregroundSoft: toCss(withAlpha(foreground, 0.7)),
    muted: toCss(muted),
    pill: toCss(withAlpha(surface, 0.82)),
    pillBorder: toCss(withAlpha(border, 0.9)),
    card: toCss(withAlpha(surface, 0.95)),
    scrim: toCss(withAlpha(background, 0.78)),
    success: toCss(success),
    danger: toCss(danger),
    secondary: toCss(secondary),
    dust: toCss(withAlpha(mix(muted, foreground, 0.2), 0.55)),
  };
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface UiState {
  readonly hoverButton: boolean;
  readonly pressButton: boolean;
}

interface RenderView {
  readonly width: number;
  readonly height: number;
  readonly font: string;
  readonly palette: Palette;
  readonly fx: Effects;
  readonly ui: UiState;
  readonly touchHint: boolean;
}

export function layout(width: number, height: number) {
  const pill = Math.round(Math.max(18, Math.min(26, height * 0.12)));
  const zone = Math.round(Math.max(38, Math.min(60, height * 0.3)));
  const buttonW = Math.min(150, width * 0.4);
  const buttonH = Math.max(24, Math.min(34, height * 0.15));
  return {
    pill,
    jumpZone: { x: width - zone - 8, y: height - zone - 8, w: zone, h: zone },
    mute: { x: width - pill - 6, y: 6, w: pill, h: pill },
    playAgain: {
      x: width / 2 - buttonW / 2,
      y: height * 0.72 - buttonH / 2,
      w: buttonW,
      h: buttonH,
    },
  };
}

export const inside = (rect: Rect, x: number, y: number) =>
  x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

const LEVEL_NAMES = [
  "First Delivery",
  "Chimney Run",
  "Night Shift",
  "Slate and Drizzle",
  "Rush Hour",
  "Tin Roof Tango",
  "Pigeon Post",
  "Neon Mile",
  "Fog Bank",
  "Last Parcel",
];

function levelName(levelNumber: number): string {
  return LEVEL_NAMES[(levelNumber - 1) % LEVEL_NAMES.length] ?? "";
}

function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function starPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outer: number,
  inner: number,
  rotation: number,
) {
  ctx.beginPath();
  for (let index = 0; index < 10; index++) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = rotation + (index * Math.PI) / 5 - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.85);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.2, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.4, y - s * 0.1, x, y + s * 0.85);
  ctx.closePath();
}

interface Cache {
  key: string;
  sky: CanvasGradient | null;
  glow: CanvasGradient | null;
}

const cache: WeakMap<CanvasRenderingContext2D, Cache> = new WeakMap();

function cached(ctx: CanvasRenderingContext2D, view: RenderView): Cache {
  const key = `${view.width}x${view.height}:${view.palette.skyTop}:${view.palette.glow}`;
  const existing = cache.get(ctx);
  if (existing && existing.key === key) return existing;
  const sky = ctx.createLinearGradient(0, 0, 0, view.height);
  sky.addColorStop(0, view.palette.skyTop);
  sky.addColorStop(1, view.palette.skyBottom);
  const gx = view.width * 0.78;
  const gy = view.height * 0.28;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, view.height * 0.9);
  glow.addColorStop(0, view.palette.glow);
  glow.addColorStop(1, view.palette.glowFade);
  const next = { key, sky, glow };
  cache.set(ctx, next);
  return next;
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
) {
  const { width, height, palette } = view;
  const store = cached(ctx, view);
  ctx.fillStyle = store.sky ?? palette.skyTop;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = store.glow ?? palette.glow;
  ctx.fillRect(0, 0, width, height);
  const orbX = width * 0.78 - state.camX * ts * 0.02;
  const orbY = height * 0.28;
  ctx.fillStyle = palette.glow;
  ctx.beginPath();
  ctx.arc(orbX, orbY, ts * 0.75, 0, Math.PI * 2);
  ctx.fill();
  if (palette.dark) {
    ctx.fillStyle = palette.skyTop;
    ctx.beginPath();
    ctx.arc(orbX + ts * 0.3, orbY - ts * 0.15, ts * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }

  const clock = state.clock;
  ctx.strokeStyle = palette.bird;
  ctx.lineWidth = 1.25;
  for (let index = 0; index < 3; index++) {
    const span = width + 120;
    const bx = ((clock * (14 + index * 5) + index * 260) % span) - 60;
    const by = height * (0.16 + index * 0.08) + Math.sin(clock * 0.7 + index) * 4;
    const flap = Math.sin(clock * 6 + index * 2) * 2.5;
    ctx.beginPath();
    ctx.moveTo(bx - 4, by - flap);
    ctx.quadraticCurveTo(bx - 2, by - 1, bx, by + 1);
    ctx.quadraticCurveTo(bx + 2, by - 1, bx + 4, by - flap);
    ctx.stroke();
  }

  const farScroll = state.camX * ts * 0.12;
  const spacing = ts * 1.9;
  const firstFar = Math.floor(farScroll / spacing) - 1;
  const lastFar = Math.ceil((farScroll + width) / spacing) + 1;
  const window = Math.max(1.5, ts * 0.11);
  for (let index = firstFar; index <= lastFar; index++) {
    const w = ts * (1.2 + hash(index, 1) * 1.1);
    const h = ts * (1.6 + hash(index, 2) * 2.2);
    const x = index * spacing - farScroll + hash(index, 3) * ts * 0.4;
    const y = height - h;
    ctx.fillStyle = palette.far;
    ctx.fillRect(x, y, w, h);
    if (hash(index, 4) < 0.3)
      ctx.fillRect(x + w * 0.45, y - ts * 0.5, Math.max(1, ts * 0.05), ts * 0.5);
    ctx.fillStyle = palette.farWindow;
    const columns = Math.floor((w - window) / (window * 2.4));
    const rows = Math.floor((h - window * 2) / (window * 2.6));
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const seed = hash(index, row * 31 + column, 5);
        const flicker = hash(index, row * 31 + column, Math.floor(clock / 5 + seed * 7));
        if (seed > (palette.dark ? 0.45 : 0.25) || flicker < 0.12) continue;
        ctx.fillRect(
          x + window + column * window * 2.4,
          y + window * 2 + row * window * 2.6,
          window,
          window,
        );
      }
    }
  }

  const midScroll = state.camX * ts * 0.38;
  const midSpacing = ts * 3.4;
  const firstMid = Math.floor(midScroll / midSpacing) - 1;
  const lastMid = Math.ceil((midScroll + width) / midSpacing) + 1;
  for (let index = firstMid; index <= lastMid; index++) {
    const w = ts * (2.4 + hash(index, 11) * 1.4);
    const h = ts * (1 + hash(index, 12) * 1.5);
    const x = index * midSpacing - midScroll;
    const y = height - h;
    ctx.fillStyle = palette.mid;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = palette.midDetail;
    ctx.fillRect(x - ts * 0.05, y, w + ts * 0.1, Math.max(1, ts * 0.08));
    const kind = hash(index, 13);
    if (kind < 0.4) {
      const tx = x + w * (0.2 + hash(index, 14) * 0.4);
      const tw = ts * 0.7;
      const ty = y - ts * 1.05;
      ctx.fillRect(tx + tw * 0.15, ty + ts * 0.6, Math.max(1, ts * 0.05), ts * 0.45);
      ctx.fillRect(tx + tw * 0.8, ty + ts * 0.6, Math.max(1, ts * 0.05), ts * 0.45);
      roundRect(ctx, tx, ty + ts * 0.1, tw, ts * 0.55, ts * 0.08);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx - ts * 0.05, ty + ts * 0.12);
      ctx.lineTo(tx + tw / 2, ty - ts * 0.15);
      ctx.lineTo(tx + tw + ts * 0.05, ty + ts * 0.12);
      ctx.fill();
    } else if (kind < 0.75) {
      const ax = x + w * (0.3 + hash(index, 15) * 0.5);
      ctx.fillRect(ax, y - ts * 1.1, Math.max(1, ts * 0.05), ts * 1.1);
      ctx.fillRect(ax - ts * 0.18, y - ts * 0.8, ts * 0.4, Math.max(1, ts * 0.04));
      if (Math.sin(clock * 2.2 + index) > 0.2) {
        ctx.fillStyle = palette.midLight;
        ctx.beginPath();
        ctx.arc(ax + ts * 0.025, y - ts * 1.12, Math.max(1.2, ts * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillRect(x + w * 0.2, y - ts * 0.3, ts * 0.45, ts * 0.3);
      ctx.fillRect(x + w * 0.6, y - ts * 0.22, ts * 0.3, ts * 0.22);
    }
  }

  ctx.fillStyle = palette.mote;
  for (let index = 0; index < 14; index++) {
    const mx = (hash(index, 21) * width + clock * (6 + hash(index, 22) * 10)) % width;
    const my = hash(index, 23) * height * 0.8 + Math.sin(clock * 0.6 + index) * 6;
    ctx.fillRect(mx, my, 1.5, 1.5);
  }
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
  ox: number,
) {
  const { palette } = view;
  const level = state.level;
  const first = Math.max(0, Math.floor(state.camX) - 1);
  const last = Math.min(level.cols - 1, Math.ceil(state.camX + state.viewCols) + 1);
  const lip = Math.max(2, ts * 0.16);
  for (let col = first; col <= last; col++) {
    const x = Math.round((col - state.camX) * ts + ox);
    const x2 = Math.round((col + 1 - state.camX) * ts + ox);
    const w = x2 - x;
    for (let row = 0; row < ROWS; row++) {
      const tile = tileAt(level, col, row);
      const y = Math.round(row * ts);
      const h = Math.round((row + 1) * ts) - y;
      if (tile === TILE_ROOF) {
        const top = !isSolid(tileAt(level, col, row - 1));
        ctx.fillStyle = palette.roof;
        ctx.fillRect(x, y, w, h);
        if (!top && hash(col, row, 7) < 0.45) {
          ctx.fillStyle = palette.roofWindow;
          ctx.fillRect(x + w * 0.3, y + h * 0.25, w * 0.4, h * 0.42);
        }
        if (!isSolid(tileAt(level, col - 1, row))) {
          ctx.fillStyle = palette.roofSide;
          ctx.fillRect(x, y, Math.max(1, ts * 0.1), h);
        }
        if (!isSolid(tileAt(level, col + 1, row))) {
          ctx.fillStyle = palette.roofSide;
          ctx.fillRect(x2 - Math.max(1, ts * 0.1), y, Math.max(1, ts * 0.1), h);
        }
        if (top) {
          ctx.fillStyle = palette.roofTop;
          ctx.fillRect(x - 1, y, w + 2, lip);
          ctx.fillStyle = palette.roofEdge;
          ctx.fillRect(x - 1, y, w + 2, 1);
          ctx.fillStyle = palette.shadow;
          if (isSolid(tileAt(level, col - 1, row - 1))) ctx.fillRect(x, y - h, w * 0.35, h);
          if (isSolid(tileAt(level, col + 1, row - 1)))
            ctx.fillRect(x2 - w * 0.35, y - h, w * 0.35, h);
          ctx.fillRect(x, y + lip, w, Math.max(1, ts * 0.06));
        }
      } else if (tile === TILE_CRATE) {
        const inset = Math.max(1, ts * 0.04);
        ctx.fillStyle = palette.shadow;
        for (let below = row + 1; below < ROWS; below++) {
          if (!isSolid(tileAt(level, col, below))) continue;
          const sy = below * ts;
          ctx.beginPath();
          ctx.ellipse(x + w / 2, sy, w * 0.5, ts * 0.08, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        ctx.fillStyle = palette.crate;
        ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
        ctx.fillStyle = palette.crateDark;
        ctx.fillRect(x + inset, y + h * 0.33, w - inset * 2, Math.max(1, ts * 0.05));
        ctx.fillRect(x + inset, y + h * 0.66, w - inset * 2, Math.max(1, ts * 0.05));
        ctx.fillRect(
          x + inset,
          y + h - inset - Math.max(1, ts * 0.08),
          w - inset * 2,
          Math.max(1, ts * 0.08),
        );
        ctx.fillStyle = palette.crateLight;
        ctx.fillRect(x + inset, y + inset, w - inset * 2, Math.max(1, ts * 0.06));
        ctx.strokeStyle = palette.crateDark;
        ctx.lineWidth = Math.max(1, ts * 0.06);
        ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
        ctx.beginPath();
        ctx.moveTo(x + inset * 2, y + h - inset * 2);
        ctx.lineTo(x + w - inset * 2, y + inset * 2);
        ctx.stroke();
      } else if (tile === TILE_SPIKE) {
        for (let index = 0; index < 3; index++) {
          const sx = x + (w / 3) * index;
          const sw = w / 3;
          const sy = y + h * 0.35;
          ctx.fillStyle = palette.spike;
          ctx.beginPath();
          ctx.moveTo(sx, y + h);
          ctx.lineTo(sx + sw / 2, sy);
          ctx.lineTo(sx + sw, y + h);
          ctx.fill();
          ctx.fillStyle = palette.spikeDark;
          ctx.beginPath();
          ctx.moveTo(sx + sw / 2, sy);
          ctx.lineTo(sx + sw, y + h);
          ctx.lineTo(sx + sw / 2, y + h);
          ctx.fill();
          ctx.strokeStyle = palette.spikeLight;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + sw * 0.18, y + h - 1);
          ctx.lineTo(sx + sw / 2, sy + 1);
          ctx.stroke();
        }
      }
    }
  }
}

function drawLifts(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
  ox: number,
) {
  const { palette } = view;
  state.level.lifts.forEach((lift) => {
    const x = (liftX(lift, state.time) - state.camX) * ts + ox;
    if (x > view.width + ts * 4 || x + lift.w * ts < -ts * 8) return;
    const trackY = lift.y * ts + LIFT_H * ts * 0.5;
    ctx.strokeStyle = palette.liftTrack;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo((lift.x0 - state.camX) * ts + ox, trackY);
    ctx.lineTo((lift.x1 + lift.w - state.camX) * ts + ox, trackY);
    ctx.stroke();
    ctx.setLineDash([]);
    const y = lift.y * ts;
    const w = lift.w * ts;
    const h = LIFT_H * ts;
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + 2, y + h, w - 4, Math.max(1, ts * 0.08));
    ctx.fillStyle = palette.lift;
    roundRect(ctx, x, y, w, h, h * 0.35);
    ctx.fill();
    ctx.fillStyle = palette.roofEdge;
    ctx.fillRect(x + h * 0.3, y, w - h * 0.6, 1);
    const moving = Math.sin((2 * Math.PI * state.time) / lift.period) >= 0 ? 1 : -1;
    ctx.strokeStyle = palette.chevron;
    ctx.lineWidth = Math.max(1.2, ts * 0.05);
    for (let chevron = 0; chevron < 3; chevron++) {
      const cx = x + w * (0.3 + chevron * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx - moving * h * 0.25, y + h * 0.25);
      ctx.lineTo(cx + moving * h * 0.15, y + h * 0.5);
      ctx.lineTo(cx - moving * h * 0.25, y + h * 0.75);
      ctx.stroke();
    }
  });
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
  ox: number,
) {
  const { palette } = view;
  const clock = state.clock;
  state.level.stars.forEach((star, index) => {
    if (state.starsTaken[index]) return;
    const x = (star.x - state.camX) * ts + ox;
    if (x < -ts || x > view.width + ts) return;
    const y = (star.y + Math.sin(clock * 3 + index) * 0.07) * ts;
    ctx.fillStyle = palette.starGlow;
    ctx.beginPath();
    ctx.arc(x, y, ts * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.star;
    starPath(ctx, x, y, ts * 0.27, ts * 0.12, clock * 1.4 + index);
    ctx.fill();
    ctx.fillStyle = palette.starLight;
    starPath(ctx, x - ts * 0.03, y - ts * 0.03, ts * 0.11, ts * 0.05, clock * 1.4 + index);
    ctx.fill();
    const glint = (clock + index * 0.37) % 2.4;
    if (glint < 0.3) {
      const g = Math.sin((glint / 0.3) * Math.PI) * ts * 0.22;
      ctx.strokeStyle = palette.starLight;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + ts * 0.18 - g, y - ts * 0.18);
      ctx.lineTo(x + ts * 0.18 + g, y - ts * 0.18);
      ctx.moveTo(x + ts * 0.18, y - ts * 0.18 - g);
      ctx.lineTo(x + ts * 0.18, y - ts * 0.18 + g);
      ctx.stroke();
    }
  });
}

function drawDrones(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
  ox: number,
) {
  const { palette } = view;
  const clock = state.clock;
  state.level.drones.forEach((def, index) => {
    const drone = state.drones[index];
    if (!drone || drone.downFor > 0.9) return;
    const cx = (drone.x + DRONE_W / 2 - state.camX) * ts + ox;
    if (cx < -ts * 2 || cx > view.width + ts * 2) return;
    const down = drone.downFor >= 0;
    const bob = down ? drone.downFor * drone.downFor * 14 : Math.sin(clock * 4 + index) * 0.08;
    const cy = (def.y + DRONE_H / 2 + bob) * ts;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(
      down
        ? drone.downFor * 5 * drone.dir
        : drone.dir * 0.12 + Math.sin(clock * 2.3 + index) * 0.06,
    );
    if (down) ctx.globalAlpha = Math.max(0, 1 - drone.downFor / 0.9);
    const w = DRONE_W * ts;
    const h = DRONE_H * ts;
    if (!down) {
      const blur = (0.6 + Math.abs(Math.sin(clock * 40 + index)) * 0.4) * w * 0.55;
      ctx.fillStyle = palette.rotor;
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.62, blur, h * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = palette.droneDark;
    ctx.fillRect(-Math.max(1, ts * 0.03), -h * 0.62, Math.max(2, ts * 0.06), h * 0.2);
    ctx.fillStyle = palette.drone;
    roundRect(ctx, -w / 2, -h / 2, w, h * 0.85, h * 0.4);
    ctx.fill();
    ctx.fillStyle = palette.droneDark;
    roundRect(ctx, -w / 2, h * 0.05, w, h * 0.3, h * 0.15);
    ctx.fill();
    ctx.fillStyle = palette.droneLight;
    ctx.fillRect(-w * 0.3, -h * 0.4, w * 0.35, Math.max(1, h * 0.1));
    ctx.strokeStyle = view.palette.outline;
    ctx.lineWidth = Math.max(1.5, ts * 0.06);
    roundRect(ctx, -w / 2, -h / 2, w, h * 0.85, h * 0.4);
    ctx.stroke();
    const blink = !down && (clock * 1.3 + index * 0.4) % 1 < 0.75;
    ctx.fillStyle = blink ? palette.eye : palette.droneDark;
    ctx.beginPath();
    ctx.arc(drone.dir * w * 0.18, -h * 0.12, Math.max(1.5, h * 0.17), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawBeacon(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
  ox: number,
) {
  const { palette } = view;
  const rect = beaconRect(state.level);
  const cx = (rect.x + rect.w / 2 - state.camX) * ts + ox;
  if (cx < -ts * 4 || cx > view.width + ts * 4) return;
  const base = rect.y + rect.h;
  const lampY = (base - 1.75) * ts;
  const clock = state.clock;
  const pulse = 0.75 + Math.sin(clock * 3) * 0.25;
  const burst = state.phase === "complete" ? Math.min(1, state.phaseTime / 0.8) : 0;
  const glowRadius = ts * (1.4 + pulse * 0.4 + burst * 3);
  const glow = ctx.createRadialGradient(cx, lampY, 0, cx, lampY, glowRadius);
  glow.addColorStop(0, palette.accentGlow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - glowRadius, lampY - glowRadius, glowRadius * 2, glowRadius * 2);

  ctx.fillStyle = palette.accent;
  for (let index = 0; index < 6; index++) {
    const t = (clock * 0.6 + index / 6) % 1;
    const px = cx + Math.sin(index * 2.3 + clock * 1.5) * ts * 0.35;
    const py = lampY - t * ts * 2;
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.fillRect(px - 1, py - 1, 2.5, 2.5);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = palette.roofSide;
  roundRect(ctx, cx - ts * 0.3, (base - 0.3) * ts, ts * 0.6, ts * 0.3, ts * 0.06);
  ctx.fill();
  ctx.fillStyle = palette.outline;
  ctx.fillRect(
    cx - Math.max(1, ts * 0.05),
    lampY,
    Math.max(2, ts * 0.1),
    (base - 0.3) * ts - lampY,
  );
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(cx, lampY, ts * (0.22 + pulse * 0.05), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.accentLight;
  ctx.beginPath();
  ctx.arc(cx - ts * 0.06, lampY - ts * 0.06, ts * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, lampY, ts * (0.22 + pulse * 0.05), 0, Math.PI * 2);
  ctx.stroke();
  if (burst > 0 && burst < 1) {
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 1 - burst;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, lampY, ts * burst * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function groundBelow(state: GameState, x: number, y: number): number | null {
  const level = state.level;
  const col = Math.floor(x);
  for (let row = Math.max(0, Math.floor(y)); row < ROWS; row++) {
    if (isSolid(tileAt(level, col, row))) return row;
  }
  for (const lift of level.lifts) {
    const lx = liftX(lift, state.time);
    if (x >= lx && x <= lx + lift.w && lift.y >= y - 0.01) return lift.y;
  }
  return null;
}

interface HeroPose {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly vx: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly runPhase: number;
  readonly squash: number;
  readonly time: number;
}

function drawScarf(
  ctx: CanvasRenderingContext2D,
  fx: Effects,
  palette: Palette,
  ts: number,
  camX: number,
  ox: number,
) {
  ctx.strokeStyle = palette.outline;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? palette.outline : palette.accent;
    ctx.lineWidth = pass === 0 ? ts * 0.16 + 2.5 : ts * 0.16;
    ctx.beginPath();
    fx.scarf.forEach((point, index) => {
      const px = (point.x - camX) * ts + ox;
      const py = point.y * ts;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
}

/** Draws the courier with feet at (x, y) in screen pixels; shared by the game and the title card. */
function drawCourier(ctx: CanvasRenderingContext2D, palette: Palette, ts: number, pose: HeroPose) {
  const airborne = !pose.grounded;
  const stretch = airborne ? Math.min(0.14, (Math.abs(pose.vy) / JUMP_SPEED) * 0.12) : 0;
  const idle = pose.grounded && Math.abs(pose.vx) < 0.2;
  const breathe = idle ? Math.sin(pose.time * 2.6) * 0.025 : 0;
  const scaleY = 1 + stretch - pose.squash + breathe;
  const scaleX = 1 / Math.max(0.6, scaleY);
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(pose.facing * scaleX * ts, scaleY * ts);
  const line = 2.5 / ts;
  ctx.lineWidth = line;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = palette.outline;

  const swing = pose.grounded && !idle ? Math.sin(pose.runPhase * Math.PI * 2) : 0;
  const ease = Math.sign(swing) * Math.abs(swing) ** 0.7;
  ctx.lineWidth = 0.11;
  for (const side of [-1, 1]) {
    const phase = side * ease;
    const footX = airborne ? side * 0.08 + 0.04 : 0.02 + phase * 0.16 + side * 0.06;
    const footY = airborne ? -0.08 : -Math.max(0, -phase) * 0.06;
    ctx.beginPath();
    ctx.moveTo(side * 0.08, -0.2);
    ctx.lineTo(footX, footY);
    ctx.stroke();
  }
  ctx.lineWidth = line;

  ctx.fillStyle = palette.satchel;
  roundRect(ctx, -0.42, -0.5, 0.2, 0.26, 0.05);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.hero;
  roundRect(ctx, -0.3, -0.8, 0.6, 0.64, 0.24);
  ctx.fill();
  ctx.fillStyle = palette.heroSheen;
  ctx.beginPath();
  ctx.ellipse(-0.1, -0.62, 0.1, 0.06, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  roundRect(ctx, -0.3, -0.8, 0.6, 0.64, 0.24);
  ctx.stroke();

  ctx.strokeStyle = palette.satchel;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(0.18, -0.5);
  ctx.lineTo(-0.28, -0.26);
  ctx.stroke();
  ctx.lineWidth = line;
  ctx.strokeStyle = palette.outline;

  ctx.fillStyle = palette.accent;
  roundRect(ctx, -0.31, -0.5, 0.62, 0.11, 0.05);
  ctx.fill();
  ctx.stroke();

  const blink = pose.time % 3.6 < 0.12;
  ctx.fillStyle = palette.outline;
  if (blink) ctx.fillRect(0.08, -0.62, 0.11, 0.025);
  else {
    ctx.beginPath();
    ctx.ellipse(0.14, -0.62, 0.035, 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = palette.cap;
  ctx.beginPath();
  ctx.moveTo(-0.29, -0.74);
  ctx.quadraticCurveTo(-0.26, -0.98, 0.02, -0.99);
  ctx.quadraticCurveTo(0.27, -0.98, 0.29, -0.76);
  ctx.lineTo(0.44, -0.74);
  ctx.quadraticCurveTo(0.44, -0.69, 0.3, -0.69);
  ctx.lineTo(-0.29, -0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHero(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
  ox: number,
) {
  const { palette, fx } = view;
  const hero = state.hero;
  const centre = hero.x + HERO_W / 2;
  const feet = hero.y + HERO_H;
  const ground = groundBelow(state, centre, feet - 0.05);
  if (ground !== null && state.phase !== "over") {
    const distance = Math.max(0, ground - feet);
    const scale = Math.max(0.2, 1 - distance / 4);
    ctx.fillStyle = palette.shadow;
    ctx.beginPath();
    ctx.ellipse(
      (centre - state.camX) * ts + ox,
      ground * ts,
      ts * 0.32 * scale,
      ts * 0.07 * scale,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  if (state.invulnerable > 0 && Math.floor(state.clock * 14) % 2 === 0) return;
  if (state.phase === "over" && hero.y > ROWS) return;
  drawScarf(ctx, fx, palette, ts, state.camX, ox);
  drawCourier(ctx, palette, ts, {
    x: (centre - state.camX) * ts + ox,
    y: feet * ts,
    facing: state.facing,
    vx: hero.vx,
    vy: hero.vy,
    grounded: hero.grounded,
    runPhase: fx.runPhase,
    squash: fx.squash,
    time: fx.time,
  });
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: RenderView,
  ts: number,
  ox: number,
) {
  const { palette, fx } = view;
  const tints = [
    palette.dust,
    palette.success,
    palette.danger,
    palette.accent,
    palette.foreground,
    palette.secondary,
  ];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const particle of fx.particles) {
    if (!particle.active) continue;
    const x = (particle.x - state.camX) * ts + ox;
    const y = particle.y * ts;
    const fade = particle.life / particle.maxLife;
    ctx.globalAlpha = particle.kind === PARTICLE_CONFETTI ? Math.min(1, fade * 3) : fade;
    ctx.fillStyle = tints[particle.tint] ?? palette.foreground;
    if (particle.kind === PARTICLE_TEXT) {
      ctx.font = `700 ${Math.round(Math.max(10, ts * 0.4))}px ${view.font}`;
      ctx.strokeStyle = palette.card;
      ctx.lineWidth = 3;
      ctx.strokeText(particle.text, x, y);
      ctx.fillText(particle.text, x, y);
    } else if (particle.kind === PARTICLE_CONFETTI) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(particle.rotation);
      ctx.fillRect(
        -particle.size * ts * 0.5,
        -particle.size * ts * 0.25,
        particle.size * ts,
        particle.size * ts * 0.5,
      );
      ctx.restore();
    } else {
      const size =
        particle.size * ts * (particle.kind === PARTICLE_DUST ? 1 + (1 - fade) : fade + 0.3);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, size), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function pill(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = palette.pill;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = palette.pillBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
  ctx.stroke();
}

function speaker(ctx: CanvasRenderingContext2D, palette: Palette, rect: Rect, muted: boolean) {
  pill(ctx, palette, rect.x, rect.y, rect.w, rect.h);
  const s = rect.h / 20;
  const x = rect.x + rect.w / 2 - 4 * s;
  const y = rect.y + rect.h / 2;
  ctx.fillStyle = palette.foreground;
  ctx.beginPath();
  ctx.moveTo(x - 3 * s, y - 2.5 * s);
  ctx.lineTo(x, y - 2.5 * s);
  ctx.lineTo(x + 4 * s, y - 6 * s);
  ctx.lineTo(x + 4 * s, y + 6 * s);
  ctx.lineTo(x, y + 2.5 * s);
  ctx.lineTo(x - 3 * s, y + 2.5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = muted ? palette.danger : palette.foreground;
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  if (muted) {
    ctx.moveTo(x + 7 * s, y - 3 * s);
    ctx.lineTo(x + 12 * s, y + 3 * s);
    ctx.moveTo(x + 12 * s, y - 3 * s);
    ctx.lineTo(x + 7 * s, y + 3 * s);
  } else {
    ctx.arc(x + 5 * s, y, 4 * s, -0.9, 0.9);
    ctx.moveTo(x + 5 * s + 7.5 * s * Math.cos(-0.9), y + 7.5 * s * Math.sin(-0.9));
    ctx.arc(x + 5 * s, y, 7.5 * s, -0.9, 0.9);
  }
  ctx.stroke();
}

const formatNumber = (value: number) => Math.round(value).toLocaleString("en-GB");

function drawHud(ctx: CanvasRenderingContext2D, state: GameState, view: RenderView) {
  const { palette, fx, width, height } = view;
  const ui = layout(width, height);
  const h = ui.pill;
  const pad = h * 0.45;
  const fontSize = Math.round(h * 0.52);
  ctx.font = `600 ${fontSize}px ${view.font}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const y = 6;
  const cy = y + h / 2;
  let x = 6;

  const heartSize = h * 0.5;
  const heartsW = pad * 2 + START_LIVES * heartSize * 1.25 - heartSize * 0.25;
  pill(ctx, palette, x, y, heartsW, h);
  for (let index = 0; index < START_LIVES; index++) {
    const pop = fx.heartPop[index] ?? 0;
    const scale = 1 + Math.sin((pop / 0.5) * Math.PI) * 0.6;
    const hx = x + pad + heartSize / 2 + index * heartSize * 1.25;
    const alive = index < state.lives;
    heartPath(ctx, hx, cy, heartSize * scale);
    if (alive) {
      ctx.fillStyle = palette.danger;
      ctx.fill();
    } else {
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  x += heartsW + 5;

  const levelText = `Level ${state.level.number}`;
  const levelW = ctx.measureText(levelText).width + pad * 2;
  pill(ctx, palette, x, y, levelW, h);
  ctx.fillStyle = palette.foreground;
  ctx.fillText(levelText, x + pad, cy + 0.5);
  x += levelW + 5;

  if (state.level.number >= DOUBLE_JUMP_LEVEL && width >= 420) {
    const chipW = h * 1.3;
    pill(ctx, palette, x, y, chipW, h);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.8;
    const ccx = x + chipW / 2;
    for (const offset of [-0.14, 0.12]) {
      ctx.beginPath();
      ctx.moveTo(ccx - h * 0.2, cy + h * offset + h * 0.08);
      ctx.lineTo(ccx, cy + h * offset - h * 0.08);
      ctx.lineTo(ccx + h * 0.2, cy + h * offset + h * 0.08);
      ctx.stroke();
    }
  }

  let right = width - 6;
  speaker(ctx, palette, ui.mute, state.muted);
  right = ui.mute.x - 5;

  const scoreText = formatNumber(fx.displayScore);
  const scoreW = ctx.measureText(scoreText).width + pad * 2 + h * 0.75;
  const scoreX = right - scoreW;
  pill(ctx, palette, scoreX, y, scoreW, h);
  ctx.fillStyle = palette.success;
  starPath(ctx, scoreX + pad + h * 0.25, cy, h * 0.27, h * 0.12, 0);
  ctx.fill();
  ctx.fillStyle = palette.foreground;
  ctx.fillText(scoreText, scoreX + pad + h * 0.65, cy + 0.5);
  right = scoreX - 5;

  if (width >= 460 && state.best > 0) {
    const bestText = `Best ${formatNumber(state.best)}`;
    ctx.font = `600 ${Math.round(fontSize * 0.9)}px ${view.font}`;
    const bestW = ctx.measureText(bestText).width + pad * 2;
    const bestX = right - bestW;
    ctx.fillStyle = palette.pill;
    roundRect(ctx, bestX, y, bestW, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.2;
    roundRect(ctx, bestX + 0.6, y + 0.6, bestW - 1.2, h - 1.2, h / 2);
    ctx.stroke();
    ctx.fillStyle = palette.foreground;
    ctx.fillText(bestText, bestX + pad, cy + 0.5);
  }
}

function card(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = palette.shadow;
  roundRect(ctx, x + 2, y + 4, w, h, 14);
  ctx.fill();
  ctx.fillStyle = palette.card;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = palette.pillBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14);
  ctx.stroke();
}

function drawTitle(ctx: CanvasRenderingContext2D, state: GameState, view: RenderView) {
  const { palette, width, height, fx } = view;
  ctx.fillStyle = palette.scrim;
  ctx.fillRect(0, 0, width, height);
  const titleSize = Math.round(Math.max(22, Math.min(46, height * 0.22, width * 0.08)));
  const cx = width / 2 + Math.min(40, width * 0.06);
  const ty = height * 0.36;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${titleSize}px ${view.font}`;
  ctx.fillStyle = palette.accent;
  ctx.fillText("Skyline Hop", cx + 2, ty + 3);
  ctx.fillStyle = palette.foreground;
  ctx.fillText("Skyline Hop", cx, ty);
  const textW = ctx.measureText("Skyline Hop").width;
  ctx.fillStyle = palette.accent;
  roundRect(
    ctx,
    cx - textW * 0.3,
    ty + titleSize * 0.55,
    textW * 0.6,
    Math.max(3, titleSize * 0.09),
    2,
  );
  ctx.fill();

  const ts = height / ROWS;
  const heroScale = Math.min(ts * 1.4, height * 0.3);
  const hx = cx - textW / 2 - heroScale * 0.9;
  const roofY = ty + heroScale * 0.55;
  ctx.fillStyle = palette.roof;
  roundRect(ctx, hx - heroScale * 0.7, roofY, heroScale * 1.4, heroScale * 0.25, 3);
  ctx.fill();
  ctx.fillStyle = palette.roofEdge;
  ctx.fillRect(hx - heroScale * 0.7 + 3, roofY, heroScale * 1.4 - 6, 1);
  const hop = Math.abs(Math.sin(fx.time * 3)) * heroScale * 0.25;
  drawCourier(ctx, palette, heroScale, {
    x: hx,
    y: roofY - hop,
    facing: 1,
    vx: 6,
    vy: hop > 1 ? -5 : 0,
    grounded: hop < 2,
    runPhase: fx.time * 2.2,
    squash: hop < 2 ? 0.12 : 0,
    time: fx.time,
  });

  const small = Math.round(Math.max(11, Math.min(15, height * 0.075)));
  ctx.font = `600 ${small}px ${view.font}`;
  ctx.globalAlpha = 0.75 + Math.sin(fx.time * 2.5) * 0.25;
  ctx.fillStyle = palette.foreground;
  ctx.fillText("Press Space or tap to play", cx, height * 0.68);
  ctx.globalAlpha = 1;
  if (state.best > 0) {
    ctx.font = `500 ${Math.round(small * 0.9)}px ${view.font}`;
    ctx.fillStyle = palette.foregroundSoft;
    ctx.fillText(`Best ${formatNumber(state.best)}`, cx, height * 0.83);
  }
}

function drawIntro(ctx: CanvasRenderingContext2D, state: GameState, view: RenderView) {
  const t = state.time;
  if (state.phase !== "playing" || t >= INTRO_TIME) return;
  const appear = Math.min(1, t / 0.3);
  const leave = Math.min(1, (INTRO_TIME - t) / 0.4);
  const amount = Math.min(appear, leave);
  const eased = 1 - (1 - amount) ** 3;
  const { palette, width, height } = view;
  const size = Math.round(Math.max(12, Math.min(18, height * 0.095)));
  ctx.font = `700 ${size}px ${view.font}`;
  const text = `Level ${state.level.number}: ${levelName(state.level.number)}`;
  const w = ctx.measureText(text).width + size * 2;
  const h = size * 2.1;
  const x = width / 2 - w / 2;
  const y = height * 0.3 - h / 2 - (1 - eased) * 16;
  ctx.globalAlpha = eased;
  card(ctx, palette, x, y, w, h);
  ctx.fillStyle = palette.accent;
  roundRect(ctx, x + size * 0.6, y + h / 2 - 3, 6, 6, 3);
  ctx.fill();
  ctx.fillStyle = palette.foreground;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2 + 4, y + h / 2 + 0.5);
  ctx.globalAlpha = 1;
}

function tally(value: number, phaseTime: number, order: number): number {
  return value * Math.max(0, Math.min(1, (phaseTime - 0.35 - order * 0.35) / 0.5));
}

function drawComplete(ctx: CanvasRenderingContext2D, state: GameState, view: RenderView) {
  const clear = state.clear;
  if (!clear) return;
  const { palette, width, height } = view;
  const appear = Math.min(1, state.phaseTime / 0.35);
  const w = Math.min(300, width - 32);
  const h = Math.min(height - 20, 150);
  const x = width / 2 - w / 2;
  const y = height / 2 - h / 2 + (1 - appear) * 12;
  ctx.globalAlpha = appear;
  card(ctx, palette, x, y, w, h);
  const size = Math.round(Math.max(11, Math.min(15, h * 0.11)));
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `800 ${Math.round(size * 1.25)}px ${view.font}`;
  ctx.fillStyle = palette.foreground;
  ctx.fillText(`Level ${state.level.number} delivered`, width / 2, y + h * 0.17);
  const seconds = Math.floor(clear.time);
  const rows: Array<[string, string]> = [
    ["Stars", `${Math.round(tally(clear.stars, state.phaseTime, 0))} / ${clear.totalStars}`],
    ["Time", `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`],
    ["Bonus", `+${formatNumber(tally(clear.bonus, state.phaseTime, 2))}`],
  ];
  ctx.font = `600 ${size}px ${view.font}`;
  rows.forEach(([label, value], index) => {
    const ry = y + h * (0.38 + index * 0.16);
    ctx.textAlign = "left";
    ctx.fillStyle = palette.foregroundSoft;
    ctx.fillText(label, x + w * 0.16, ry);
    ctx.textAlign = "right";
    ctx.fillStyle = index === 2 ? palette.accent : palette.foreground;
    ctx.fillText(value, x + w * 0.84, ry);
  });
  if (state.phaseTime > 1) {
    ctx.textAlign = "center";
    ctx.font = `500 ${Math.round(size * 0.85)}px ${view.font}`;
    ctx.fillStyle = palette.foregroundSoft;
    ctx.fillText("Space or tap to continue", width / 2, y + h * 0.88);
  }
  ctx.globalAlpha = 1;
}

function drawGameOver(ctx: CanvasRenderingContext2D, state: GameState, view: RenderView) {
  const { palette, width, height, ui } = view;
  const appear = Math.min(1, state.phaseTime / 0.4);
  ctx.globalAlpha = appear;
  ctx.fillStyle = palette.scrim;
  ctx.fillRect(0, 0, width, height);
  const size = Math.round(Math.max(11, Math.min(15, height * 0.075)));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(size * 1.6)}px ${view.font}`;
  ctx.fillStyle = palette.foreground;
  ctx.fillText("Game over", width / 2, height * 0.22);
  ctx.font = `600 ${size}px ${view.font}`;
  ctx.fillStyle = palette.foregroundSoft;
  const levels = state.levelsCleared === 1 ? "1 level" : `${state.levelsCleared} levels`;
  ctx.fillText(
    `Score ${formatNumber(state.score)}  ·  Best ${formatNumber(state.best)}  ·  ${levels} cleared`,
    width / 2,
    height * 0.4,
  );
  if (state.score > state.bestAtStart && state.score > 0) {
    const badge = "NEW BEST";
    ctx.font = `800 ${Math.round(size * 0.85)}px ${view.font}`;
    const bw = ctx.measureText(badge).width + size * 1.4;
    const bh = size * 1.6;
    const pulse = 1 + Math.sin(state.clock * 5) * 0.04;
    ctx.save();
    ctx.translate(width / 2, height * 0.54);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = palette.accent;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = palette.accentForeground;
    ctx.fillText(badge, 0, 0.5);
    ctx.restore();
  }
  const button = layout(width, height).playAgain;
  const lift = ui.pressButton ? 1 : 0;
  ctx.fillStyle = palette.accentDark;
  roundRect(ctx, button.x, button.y + 3, button.w, button.h, button.h / 2);
  ctx.fill();
  ctx.fillStyle = ui.hoverButton ? palette.accentLight : palette.accent;
  roundRect(ctx, button.x, button.y + lift * 2, button.w, button.h, button.h / 2);
  ctx.fill();
  ctx.font = `700 ${size}px ${view.font}`;
  ctx.fillStyle = palette.accentForeground;
  ctx.fillText("Play again", width / 2, button.y + button.h / 2 + lift * 2 + 0.5);
  ctx.font = `500 ${Math.round(size * 0.8)}px ${view.font}`;
  ctx.fillStyle = palette.foregroundSoft;
  ctx.fillText(
    "Space or tap to restart",
    width / 2,
    Math.min(height - 8, button.y + button.h + size * 1.2),
  );
  ctx.globalAlpha = 1;
}

function drawJumpZone(ctx: CanvasRenderingContext2D, view: RenderView) {
  const zone = layout(view.width, view.height).jumpZone;
  const { palette } = view;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = palette.pill;
  ctx.beginPath();
  ctx.arc(zone.x + zone.w / 2, zone.y + zone.h / 2, zone.w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.pillBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = palette.foreground;
  ctx.lineWidth = 2;
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  const s = zone.w * 0.16;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.5);
  ctx.lineTo(cx, cy - s * 0.5);
  ctx.lineTo(cx + s, cy + s * 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Paints one frame. The caller has already applied the device pixel ratio transform. */
export function render(ctx: CanvasRenderingContext2D, state: GameState, view: RenderView): void {
  const ts = view.height / ROWS;
  const fx = view.fx;
  const shake = fx.shake * ts * 0.35;
  const ox = shake > 0 ? Math.sin(fx.time * 61) * shake : 0;
  const oy = shake > 0 ? Math.cos(fx.time * 47) * shake * 0.6 : 0;
  ctx.save();
  if (oy !== 0) ctx.translate(0, oy);
  drawBackdrop(ctx, state, view, ts);
  drawLifts(ctx, state, view, ts, ox);
  drawTiles(ctx, state, view, ts, ox);
  drawBeacon(ctx, state, view, ts, ox);
  drawStars(ctx, state, view, ts, ox);
  drawDrones(ctx, state, view, ts, ox);
  if (state.phase !== "title") drawHero(ctx, state, view, ts, ox);
  if (state.phase !== "over") drawParticles(ctx, state, view, ts, ox);
  ctx.restore();
  if (fx.flash > 0) {
    ctx.globalAlpha = fx.flash * 0.45;
    ctx.fillStyle = view.palette.accentLight;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.globalAlpha = 1;
  }
  if (state.phase === "title") {
    drawTitle(ctx, state, view);
    return;
  }
  drawHud(ctx, state, view);
  drawIntro(ctx, state, view);
  if (state.phase === "playing" && view.touchHint) drawJumpZone(ctx, view);
  if (state.phase === "complete") drawComplete(ctx, state, view);
  if (state.phase === "over") {
    drawGameOver(ctx, state, view);
    drawParticles(ctx, state, view, ts, 0);
  }
}
