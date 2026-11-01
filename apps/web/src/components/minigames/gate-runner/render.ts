import type { MiniGameTheme } from "../types";
import {
  CAMERA_BACK,
  depthOf,
  fogFade,
  KERB,
  LANE_WIDTH,
  laneX,
  project,
  ROAD_HALF,
  type Lens,
  type Projected,
} from "./camera";
import {
  BLACK,
  WHITE,
  darken,
  inkOn,
  lighten,
  luminance,
  mix,
  parseColor,
  pickDistinct,
  pickVivid,
  toCss,
  withAlpha,
  type Rgba,
} from "./color";
import { MAX_UNITS, type Fx, type Tone } from "./fx";
import { clamp, muteRect, overCard, type Layout, type Rect } from "./layout";
import {
  CLEAR_MS,
  formatOp,
  isGoodOp,
  scoreOf,
  speedForStage,
  type Entity,
  type GateOp,
  type GateRunnerState,
} from "./logic";

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = 2.39996;
const ENEMY_MAX = 30;
const MAX_FIGURES = MAX_UNITS + ENEMY_MAX;
const FAR = 90;
const ROAD_FAR = 400;
const ROAD_NEAR = 1.4;
const GATE_TOP = 2;
const PANEL_TOP = 1.82;
const PANEL_BOTTOM = 0.1;
const WALL_H = 2.3;
const FIGURE_UNIT = 0.17;
const KERB_BLOCK = 1.6;
const DASH_GAP = 6;
const DASH_LEN = 2.4;
const SCENERY_GAP = 7;

export interface RenderUi {
  hoverButton: boolean;
  pressButton: boolean;
  hoverMute: boolean;
}

interface ToneSet {
  base: string;
  light: string;
  dark: string;
  ink: string;
  text: string;
  glow: string;
  head: string;
  highlight: string;
  glassTop: string;
  glassMid: string;
  glassBottom: string;
  rim: string;
}

interface Palette {
  dark: boolean;
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  border: string;
  good: ToneSet;
  bad: ToneSet;
  ui: ToneSet;
  success: string;
  wall: string;
  wallLight: string;
  wallDark: string;
  mortar: string;
  shadow: string;
  shadowClear: string;
  pill: string;
  overlay: string;
  skyTop: string;
  skyBottom: string;
  glow: string;
  glowClear: string;
  hillFar: string;
  hillNear: string;
  haze: string;
  hazeClear: string;
  vergeFar: string;
  vergeNear: string;
  roadFar: string;
  roadNear: string;
  band: string;
  edge: string;
  kerbA: string;
  kerbB: string;
  kerbSide: string;
  dash: string;
  trunk: string;
  leaf: string;
  leafLight: string;
  lamp: string;
  streak: string;
  face: string;
  eye: string;
  vignette: string;
  vignetteClear: string;
  tones: Record<Tone, string>;
}

interface Figure {
  x: number;
  y: number;
  s: number;
  bob: number;
  lean: number;
  phase: number;
  depth: number;
}

interface Cache {
  key: string;
  sky: CanvasGradient;
  glow: CanvasGradient;
  verge: CanvasGradient;
  road: CanvasGradient;
  haze: CanvasGradient;
  vignette: CanvasGradient;
  shadow: CanvasGradient;
  glassGood: CanvasGradient;
  glassBad: CanvasGradient;
  saw: CanvasGradient;
  logo: CanvasGradient;
  hillsFar: Path2D;
  hillsNear: Path2D;
}

export interface Renderer {
  setTheme(theme: MiniGameTheme, resolve: (css: string) => Rgba): void;
  setFont(family: string): void;
  draw(
    ctx: CanvasRenderingContext2D,
    state: GateRunnerState,
    fx: Fx,
    layout: Layout,
    ui: RenderUi,
  ): void;
}

function toneSet(base: Rgba, bg: Rgba, fg: Rgba, dark: boolean): ToneSet {
  const light = lighten(base, 0.42);
  return {
    base: toCss(base),
    light: toCss(light),
    dark: toCss(darken(base, 0.38)),
    ink: toCss(inkOn(base, lighten(bg, 0.9), darken(fg, 0.6))),
    text: toCss(dark ? lighten(base, 0.45) : darken(base, 0.25)),
    glow: toCss(withAlpha(base, 0.8)),
    head: toCss(lighten(base, 0.22)),
    highlight: toCss(withAlpha(lighten(base, 0.75), 0.9)),
    glassTop: toCss(withAlpha(light, dark ? 0.5 : 0.62)),
    glassMid: toCss(withAlpha(base, dark ? 0.22 : 0.18)),
    glassBottom: toCss(withAlpha(base, 0.42)),
    rim: toCss(withAlpha(lighten(base, 0.55), 0.95)),
  };
}

const SCENE = {
  coral: hex("#c96567"),
  blush: hex("#e8ada0"),
  sage: hex("#b9d4c9"),
  teal: hex("#3c8e99"),
  navy: hex("#222f52"),
  peach: hex("#f6c9a8"),
  cream: hex("#fbf1e6"),
  sand: hex("#e8cfb0"),
};

function hex(value: string): Rgba {
  return parseColor(value) ?? BLACK;
}

function buildPalette(theme: MiniGameTheme, resolve: (css: string) => Rgba): Palette {
  const bg = resolve(theme.background);
  const surface = resolve(theme.surface);
  const fg = resolve(theme.foreground);
  const border = resolve(theme.border);
  const success = resolve(theme.success);
  const dark = luminance(bg) < 0.3;
  const { coral, blush, sage, teal, navy, peach, cream, sand } = SCENE;
  const ink = dark ? cream : navy;
  const paper = dark ? navy : cream;
  const good = dark ? lighten(teal, 0.18) : teal;
  const bad = dark ? lighten(coral, 0.1) : coral;
  const uiBad = pickVivid([resolve(theme.danger), fg], surface, 1.8);
  const uiGood = pickDistinct([resolve(theme.accent), success, fg], surface, uiBad);
  const wall = dark ? mix(navy, sand, 0.5) : mix(sand, navy, 0.22);
  const shade = dark ? BLACK : navy;
  const good_ = toneSet(good, paper, ink, dark);
  const bad_ = toneSet(bad, paper, ink, dark);
  const haze = dark ? mix(navy, peach, 0.32) : mix(peach, cream, 0.45);
  const roadFar = dark ? mix(navy, sand, 0.3) : mix(sand, cream, 0.45);
  const roadNear = dark ? mix(navy, sand, 0.12) : mix(sand, navy, 0.16);
  return {
    dark,
    bg: toCss(bg),
    surface: toCss(surface),
    fg: toCss(fg),
    muted: toCss(resolve(theme.muted)),
    border: toCss(border),
    good: good_,
    bad: bad_,
    ui: toneSet(uiGood, bg, fg, dark),
    success: toCss(dark ? sage : teal),
    wall: toCss(wall),
    wallLight: toCss(mix(wall, cream, 0.4)),
    wallDark: toCss(mix(wall, navy, 0.35)),
    mortar: toCss(mix(wall, dark ? navy : cream, 0.5)),
    shadow: toCss(withAlpha(shade, dark ? 0.5 : 0.24)),
    shadowClear: toCss(withAlpha(shade, 0)),
    pill: toCss(withAlpha(surface, 0.94)),
    overlay: toCss(withAlpha(bg, 0.62)),
    skyTop: toCss(dark ? darken(navy, 0.32) : mix(sage, cream, 0.3)),
    skyBottom: toCss(dark ? mix(navy, coral, 0.32) : mix(peach, cream, 0.25)),
    glow: toCss(withAlpha(peach, dark ? 0.6 : 0.95)),
    glowClear: toCss(withAlpha(peach, 0)),
    hillFar: toCss(dark ? mix(navy, blush, 0.3) : mix(blush, cream, 0.3)),
    hillNear: toCss(dark ? mix(navy, teal, 0.32) : mix(sage, teal, 0.28)),
    haze: toCss(withAlpha(haze, 0.92)),
    hazeClear: toCss(withAlpha(haze, 0)),
    vergeFar: toCss(dark ? mix(navy, teal, 0.3) : mix(sage, cream, 0.3)),
    vergeNear: toCss(dark ? darken(mix(navy, teal, 0.25), 0.25) : mix(sage, teal, 0.32)),
    roadFar: toCss(roadFar),
    roadNear: toCss(roadNear),
    band: toCss(withAlpha(shade, dark ? 0.1 : 0.045)),
    edge: toCss(dark ? mix(cream, navy, 0.2) : WHITE),
    kerbA: toCss(dark ? lighten(coral, 0.05) : coral),
    kerbB: toCss(dark ? mix(cream, navy, 0.15) : cream),
    kerbSide: toCss(dark ? darken(coral, 0.45) : darken(coral, 0.3)),
    dash: toCss(withAlpha(dark ? mix(cream, sage, 0.3) : WHITE, dark ? 0.75 : 0.9)),
    trunk: toCss(dark ? mix(navy, sand, 0.25) : mix(navy, sand, 0.45)),
    leaf: toCss(dark ? mix(navy, teal, 0.55) : mix(teal, sage, 0.25)),
    leafLight: toCss(dark ? mix(teal, sage, 0.35) : mix(sage, cream, 0.15)),
    lamp: toCss(peach),
    streak: toCss(withAlpha(dark ? cream : WHITE, dark ? 0.35 : 0.75)),
    face: toCss(dark ? mix(peach, coral, 0.2) : peach),
    eye: toCss(navy),
    vignette: toCss(withAlpha(shade, dark ? 0.42 : 0.1)),
    vignetteClear: toCss(withAlpha(shade, 0)),
    tones: {
      good: good_.base,
      goodLight: good_.light,
      bad: bad_.base,
      badLight: bad_.light,
      wall: toCss(wall),
      success: toCss(dark ? sage : teal),
      fg: toCss(ink),
    },
  };
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function hillPaths(width: number, horizon: number): { far: Path2D; near: Path2D } {
  const far = new Path2D();
  const near = new Path2D();
  const left = -40;
  const right = width + 40;
  far.moveTo(left, horizon + 1);
  near.moveTo(left, horizon + 1);
  for (let x = left; x <= right; x += 6) {
    const t = (x / width) * TAU;
    const lift = horizon * (0.2 + Math.sin(t * 1.3 + 0.6) * 0.09 + Math.sin(t * 3.7 + 2) * 0.04);
    far.lineTo(x, horizon - lift);
  }
  let x = left;
  let i = 0;
  while (x < right) {
    const w = 8 + hash(i) * 20;
    const h = horizon * (0.05 + hash(i + 40) * 0.1);
    if (hash(i + 80) > 0.55) {
      near.lineTo(x, horizon - h);
      near.lineTo(x + w, horizon - h);
    } else {
      near.quadraticCurveTo(x + w / 2, horizon - h * 1.9, x + w, horizon - h * 0.6);
    }
    x += w;
    i += 1;
  }
  far.lineTo(right, horizon + 1);
  far.closePath();
  near.lineTo(right, horizon + 1);
  near.closePath();
  return { far, near };
}

const easeOutBack = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

const ENEMY_SLOTS = Array.from({ length: ENEMY_MAX }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / ENEMY_MAX);
  return { x: Math.cos(i * GOLDEN_ANGLE) * r * 0.95, z: Math.sin(i * GOLDEN_ANGLE) * r * 0.8, i };
});

export function createRenderer(): Renderer {
  let palette: Palette | null = null;
  let themeVersion = 0;
  let font = "system-ui, sans-serif";
  let cache: Cache | null = null;
  const figures: Figure[] = Array.from({ length: MAX_FIGURES }, () => ({
    x: 0,
    y: 0,
    s: 0,
    bob: 0,
    lean: 0,
    phase: 0,
    depth: 0,
  }));
  const order = new Int16Array(MAX_FIGURES);
  const A: Projected = { x: 0, y: 0, s: 0 };
  const B: Projected = { x: 0, y: 0, s: 0 };
  const C: Projected = { x: 0, y: 0, s: 0 };
  const D: Projected = { x: 0, y: 0, s: 0 };
  const crowdAnchor = { x: 0, top: 0 };

  const fontOf = (weight: number, size: number, italic = false) =>
    `${italic ? "italic " : ""}${weight} ${Math.max(1, Math.round(size))}px ${font}`;

  function ensureCache(ctx: CanvasRenderingContext2D, p: Palette, layout: Layout): Cache {
    const key = `${themeVersion}:${layout.width}x${layout.height}`;
    if (cache?.key === key) return cache;
    const { horizon, ground } = layout.lens;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyBottom);
    const unitRadial = (inner: string, outer: string) => {
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, inner);
      gradient.addColorStop(1, outer);
      return gradient;
    };
    const verge = ctx.createLinearGradient(0, horizon, 0, layout.height);
    verge.addColorStop(0, p.vergeFar);
    verge.addColorStop(1, p.vergeNear);
    const road = ctx.createLinearGradient(0, horizon, 0, layout.height);
    road.addColorStop(0, p.roadFar);
    road.addColorStop(0.35, p.roadFar);
    road.addColorStop(1, p.roadNear);
    const haze = ctx.createLinearGradient(0, horizon - 2, 0, horizon + (ground - horizon) * 0.3);
    haze.addColorStop(0, p.haze);
    haze.addColorStop(1, p.hazeClear);
    const vignette = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.3);
    vignette.addColorStop(0, p.vignetteClear);
    vignette.addColorStop(1, p.vignette);
    const glass = (set: ToneSet) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, 1);
      gradient.addColorStop(0, set.glassTop);
      gradient.addColorStop(0.45, set.glassMid);
      gradient.addColorStop(1, set.glassBottom);
      return gradient;
    };
    const saw = ctx.createRadialGradient(-0.25, -0.25, 0.05, 0, 0, 1);
    saw.addColorStop(0, p.bad.light);
    saw.addColorStop(0.6, p.bad.base);
    saw.addColorStop(1, p.bad.dark);
    const title = titleMetrics(layout);
    const logo = ctx.createLinearGradient(0, title.y - title.size / 2, 0, title.y + title.size / 2);
    logo.addColorStop(0, p.good.light);
    logo.addColorStop(1, p.good.base);
    const hills = hillPaths(layout.width, horizon);
    cache = {
      key,
      sky,
      glow: unitRadial(p.glow, p.glowClear),
      verge,
      road,
      haze,
      vignette,
      shadow: unitRadial(p.shadow, p.shadowClear),
      glassGood: glass(p.good),
      glassBad: glass(p.bad),
      saw,
      logo,
      hillsFar: hills.far,
      hillsNear: hills.near,
    };
    return cache;
  }

  function titleMetrics(layout: Layout) {
    const { horizon, ground } = layout.lens;
    const size = Math.min((ground - horizon) * 0.4, layout.width / 9);
    return { size, y: horizon + (ground - horizon) * 0.3 };
  }

  function pill(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke: string | null,
  ) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function softShadow(
    ctx: CanvasRenderingContext2D,
    c: Cache,
    x: number,
    y: number,
    rx: number,
    ry: number,
  ) {
    if (rx <= 0 || ry <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    ctx.fillStyle = c.shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Adds the ground quad between lateral x0..x1 and depths z0..z1 to the current path. */
  function groundQuad(
    ctx: CanvasRenderingContext2D,
    lens: Lens,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y = 0,
  ) {
    if (!project(lens, x0, y, z0, A) || !project(lens, x1, y, z0, B)) return;
    if (!project(lens, x1, y, z1, C) || !project(lens, x0, y, z1, D)) return;
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(C.x, C.y);
    ctx.lineTo(D.x, D.y);
    ctx.closePath();
  }

  function drawBackdrop(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    state: GateRunnerState,
    camX: number,
  ) {
    const { width, height } = layout;
    const lens = layout.lens;
    const { horizon } = lens;
    ctx.fillStyle = c.sky;
    ctx.fillRect(0, 0, width, horizon + 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, horizon + 1);
    ctx.clip();
    ctx.translate(lens.cx - camX * 4, horizon);
    ctx.scale(width * 0.55, horizon * 1.25);
    ctx.fillStyle = c.glow;
    ctx.fillRect(-1, -1, 2, 1);
    ctx.restore();

    ctx.save();
    ctx.translate(-camX * 3, 0);
    ctx.fillStyle = p.hillFar;
    ctx.fill(c.hillsFar);
    ctx.translate(-camX * 3, 0);
    ctx.fillStyle = p.hillNear;
    ctx.fill(c.hillsNear);
    ctx.restore();

    ctx.fillStyle = c.verge;
    ctx.fillRect(0, horizon, width, height - horizon);

    const d = state.distance;
    const inner = ROAD_HALF - KERB;
    ctx.fillStyle = c.road;
    ctx.beginPath();
    groundQuad(ctx, lens, -ROAD_HALF - camX, ROAD_HALF - camX, ROAD_NEAR, ROAD_FAR);
    ctx.fill();

    ctx.fillStyle = p.band;
    ctx.beginPath();
    const bandGap = 8;
    for (let k = Math.floor((d - CAMERA_BACK) / bandGap); ; k++) {
      const z0 = depthOf(k * bandGap, d);
      if (z0 > 60) break;
      if (z0 + bandGap * 0.5 < ROAD_NEAR) continue;
      groundQuad(
        ctx,
        lens,
        -inner - camX,
        inner - camX,
        Math.max(ROAD_NEAR, z0),
        z0 + bandGap * 0.5,
      );
    }
    ctx.fill();

    ctx.fillStyle = p.kerbSide;
    ctx.beginPath();
    groundQuad(ctx, lens, -ROAD_HALF - 0.25 - camX, -ROAD_HALF - camX, ROAD_NEAR, ROAD_FAR);
    groundQuad(ctx, lens, ROAD_HALF - camX, ROAD_HALF + 0.25 - camX, ROAD_NEAR, ROAD_FAR);
    ctx.fill();
    ctx.fillStyle = p.kerbB;
    ctx.beginPath();
    groundQuad(ctx, lens, -ROAD_HALF - camX, -inner - camX, ROAD_NEAR, ROAD_FAR);
    groundQuad(ctx, lens, inner - camX, ROAD_HALF - camX, ROAD_NEAR, ROAD_FAR);
    ctx.fill();
    ctx.fillStyle = p.kerbA;
    ctx.beginPath();
    for (let k = Math.floor((d - CAMERA_BACK) / (KERB_BLOCK * 2)); ; k++) {
      const z0 = depthOf(k * KERB_BLOCK * 2, d);
      if (z0 > 45) break;
      if (z0 + KERB_BLOCK < ROAD_NEAR) continue;
      const near = Math.max(ROAD_NEAR, z0);
      groundQuad(ctx, lens, -ROAD_HALF - camX, -inner - camX, near, z0 + KERB_BLOCK);
      groundQuad(ctx, lens, inner - camX, ROAD_HALF - camX, near, z0 + KERB_BLOCK);
    }
    ctx.fill();

    ctx.fillStyle = p.edge;
    ctx.beginPath();
    groundQuad(ctx, lens, -inner - camX, -inner + 0.12 - camX, ROAD_NEAR, ROAD_FAR);
    groundQuad(ctx, lens, inner - 0.12 - camX, inner - camX, ROAD_NEAR, ROAD_FAR);
    ctx.fill();

    ctx.fillStyle = p.dash;
    ctx.beginPath();
    for (let k = Math.floor((d - CAMERA_BACK) / DASH_GAP); ; k++) {
      const z0 = depthOf(k * DASH_GAP, d);
      if (z0 > 60) break;
      if (z0 + DASH_LEN < ROAD_NEAR) continue;
      const near = Math.max(ROAD_NEAR, z0);
      for (const side of [-1, 1]) {
        const x = (side * LANE_WIDTH) / 2 - camX;
        groundQuad(ctx, lens, x - 0.08, x + 0.08, near, z0 + DASH_LEN);
      }
    }
    ctx.fill();

    drawScenery(ctx, p, c, layout, d, camX);

    ctx.fillStyle = c.haze;
    ctx.fillRect(0, horizon - 2, width, (lens.ground - horizon) * 0.3 + 2);
  }

  function drawScenery(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    d: number,
    camX: number,
  ) {
    const lens = layout.lens;
    const first = Math.floor((d - CAMERA_BACK + 2) / SCENERY_GAP);
    const last = Math.floor((d - CAMERA_BACK + 80) / SCENERY_GAP);
    for (let k = last; k >= first; k--) {
      const dz = depthOf(k * SCENERY_GAP, d);
      if (dz < 2.2) continue;
      const fade = fogFade(dz, 30, 80) * clamp((dz - 2.2) / 4, 0, 1);
      if (fade < 0.02) continue;
      for (const side of [-1, 1]) {
        const seed = k * 2 + (side > 0 ? 1 : 0);
        const x = side * (ROAD_HALF + 1.3 + hash(seed) * 2.4) - camX;
        if (!project(lens, x, 0, dz, A)) continue;
        const s = A.s;
        if (A.x < -3 * s || A.x > layout.width + 3 * s) continue;
        ctx.globalAlpha = fade;
        const kind = hash(seed + 17);
        softShadow(ctx, c, A.x, A.y, 0.8 * s, 0.16 * s);
        if (kind < 0.68) {
          ctx.fillStyle = p.trunk;
          ctx.fillRect(A.x - 0.09 * s, A.y - 1 * s, 0.18 * s, 1 * s);
          const r = (0.6 + hash(seed + 5) * 0.35) * s;
          ctx.fillStyle = p.leaf;
          ctx.beginPath();
          ctx.arc(A.x, A.y - 1 * s - r * 0.7, r, 0, TAU);
          ctx.arc(A.x - side * r * 0.55, A.y - 1 * s - r * 0.2, r * 0.7, 0, TAU);
          ctx.fill();
          ctx.fillStyle = p.leafLight;
          ctx.globalAlpha = fade * 0.55;
          ctx.beginPath();
          ctx.arc(A.x - r * 0.3, A.y - 1 * s - r * 1.05, r * 0.42, 0, TAU);
          ctx.fill();
        } else {
          const top = 2.6 * s;
          ctx.fillStyle = p.trunk;
          ctx.fillRect(A.x - 0.05 * s, A.y - top, 0.1 * s, top);
          ctx.fillRect(
            Math.min(A.x, A.x - side * 0.7 * s),
            A.y - top,
            0.7 * s,
            Math.max(1, 0.07 * s),
          );
          ctx.fillStyle = p.lamp;
          ctx.beginPath();
          ctx.ellipse(A.x - side * 0.7 * s, A.y - top + 0.1 * s, 0.22 * s, 0.1 * s, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawStreaks(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    state: GateRunnerState,
    time: number,
    camX: number,
  ) {
    if (state.status !== "running" || state.freeze > 0) return;
    const speed = speedForStage(state.stage);
    const intensity = clamp((speed - 9.5) / 6, 0, 1);
    if (intensity <= 0) return;
    ctx.strokeStyle = p.streak;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, layout.height / 140);
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (ROAD_HALF + 0.3 + hash(i + 3) * 3) - camX;
      const y = 0.4 + hash(i + 9) * 2.6;
      const dz = 50 - ((time * speed * 1.8 + hash(i + 21) * 50) % 48);
      if (!project(layout.lens, x, y, dz, A) || !project(layout.lens, x, y, dz + 4, B)) continue;
      ctx.globalAlpha = intensity * 0.7 * (1 - dz / 50);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  /** Runners anchored at their feet; `front` faces the camera, otherwise we see their backs. */
  function drawFigures(
    ctx: CanvasRenderingContext2D,
    count: number,
    set: ToneSet,
    p: Palette,
    front: boolean,
  ) {
    if (count <= 0) return;
    let total = 0;
    for (let i = 0; i < count; i++) total += figures[order[i] ?? 0]?.s ?? 0;
    const avg = total / count;
    const at = (i: number) => figures[order[i] ?? 0];

    ctx.fillStyle = p.shadow;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      ctx.moveTo(f.x + f.s * 0.7, f.y);
      ctx.ellipse(f.x, f.y, f.s * 0.7, f.s * 0.22, 0, 0, TAU);
    }
    ctx.fill();

    ctx.strokeStyle = set.dark;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, avg * 0.36);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      const hip = f.y - 1.25 * f.s - f.bob;
      const swing = Math.sin(f.phase);
      ctx.moveTo(f.x - 0.2 * f.s, hip);
      ctx.lineTo(f.x - 0.26 * f.s, f.y - Math.max(0, swing) * 0.5 * f.s);
      ctx.moveTo(f.x + 0.2 * f.s, hip);
      ctx.lineTo(f.x + 0.26 * f.s, f.y - Math.max(0, -swing) * 0.5 * f.s);
      const shoulder = f.y - 2.35 * f.s - f.bob;
      ctx.moveTo(f.x - 0.42 * f.s, shoulder);
      ctx.lineTo(f.x - 0.66 * f.s, shoulder + (0.65 + swing * 0.25) * f.s);
      ctx.moveTo(f.x + 0.42 * f.s, shoulder);
      ctx.lineTo(f.x + 0.66 * f.s, shoulder + (0.65 - swing * 0.25) * f.s);
    }
    ctx.stroke();
    ctx.lineCap = "butt";

    ctx.lineWidth = Math.max(0.75, avg * 0.16);
    ctx.fillStyle = set.base;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      const cx = f.x + f.lean * f.s * 0.3;
      const cy = f.y - 1.95 * f.s - f.bob;
      const rot = f.lean * 0.3;
      const rx = f.s * 0.55;
      ctx.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx);
      ctx.ellipse(cx, cy, rx, f.s * 0.78, rot, 0, TAU);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = set.head;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      const hx = f.x + f.lean * f.s * 0.6;
      const hy = f.y - 3.05 * f.s - f.bob;
      ctx.moveTo(hx + f.s * 0.5, hy);
      ctx.arc(hx, hy, f.s * 0.5, 0, TAU);
    }
    ctx.fill();
    ctx.stroke();

    if (front) {
      ctx.fillStyle = p.face;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const f = at(i);
        if (!f || f.s < 2.2) continue;
        const hx = f.x + f.lean * f.s * 0.6;
        const hy = f.y - 2.95 * f.s - f.bob;
        ctx.moveTo(hx + f.s * 0.34, hy);
        ctx.ellipse(hx, hy, f.s * 0.34, f.s * 0.3, 0, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = p.eye;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const f = at(i);
        if (!f || f.s < 3) continue;
        const hx = f.x + f.lean * f.s * 0.6;
        const hy = f.y - 3.0 * f.s - f.bob;
        for (const side of [-1, 1]) {
          ctx.moveTo(hx + side * f.s * 0.14 + f.s * 0.07, hy);
          ctx.arc(hx + side * f.s * 0.14, hy, f.s * 0.07, 0, TAU);
        }
      }
      ctx.fill();
    } else {
      ctx.fillStyle = set.highlight;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const f = at(i);
        if (!f) continue;
        const hx = f.x + f.lean * f.s * 0.6 - f.s * 0.16;
        const hy = f.y - 3.22 * f.s - f.bob;
        ctx.moveTo(hx + f.s * 0.17, hy);
        ctx.arc(hx, hy, f.s * 0.17, 0, TAU);
      }
      ctx.fill();
    }
  }

  function sortFigures(count: number) {
    for (let i = 0; i < count; i++) order[i] = i;
    for (let i = 1; i < count; i++) {
      const value = order[i] ?? 0;
      const depth = figures[value]?.depth ?? 0;
      let j = i - 1;
      while (j >= 0 && (figures[order[j] ?? 0]?.depth ?? 0) < depth) {
        order[j + 1] = order[j] ?? 0;
        j -= 1;
      }
      order[j + 1] = value;
    }
  }

  function drawCrowd(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
    camX: number,
  ) {
    const lens = layout.lens;
    const centre = laneX(state.lane) - camX;
    const spread = Math.sqrt(fx.shown / MAX_UNITS);
    project(lens, centre, 0, CAMERA_BACK, A);
    crowdAnchor.x = A.x;
    crowdAnchor.top = A.y - 3.6 * FIGURE_UNIT * A.s;
    project(lens, centre, 0, CAMERA_BACK + 0.8 * spread + 0.3, B);
    project(lens, centre, 0, CAMERA_BACK - 0.8 * spread - 0.3, C);
    softShadow(
      ctx,
      c,
      A.x,
      (B.y + C.y) / 2,
      ((1.05 * spread + 0.45) * lens.fx) / CAMERA_BACK,
      Math.max(2, (C.y - B.y) / 2),
    );
    let n = 0;
    for (let i = 0; i < MAX_UNITS; i++) {
      const unit = fx.units[i];
      const f = figures[n];
      if (!unit?.alive || unit.delay > 0 || unit.scale < 0.04 || !f) continue;
      const dz = CAMERA_BACK + unit.z;
      if (!project(lens, unit.x - camX, 0, dz, A)) continue;
      f.x = A.x;
      f.y = A.y;
      f.s = A.s * FIGURE_UNIT * Math.min(1.35, unit.scale);
      f.depth = dz;
      f.phase = unit.phase;
      f.bob = Math.abs(Math.sin(unit.phase)) * f.s * 0.4;
      f.lean = clamp(unit.vx * 0.25, -0.7, 0.7);
      crowdAnchor.top = Math.min(crowdAnchor.top, f.y - 3.6 * f.s - f.bob);
      n += 1;
    }
    sortFigures(n);
    drawFigures(ctx, n, p.good, p, false);
  }

  function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  }

  function labelSize(layout: Layout, projected: number) {
    const min = clamp(layout.height * 0.062, 9, 14);
    const max = clamp(layout.height * 0.2, 18, 46);
    const alpha = clamp((projected - min * 0.42) / (min * 0.35), 0, 1);
    return { size: clamp(projected, min, max), alpha };
  }

  function drawLabel(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    text: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    glow: string | null,
  ) {
    ctx.font = fontOf(900, size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2.5, size * 0.18);
    ctx.strokeStyle = p.bg;
    ctx.strokeText(text, x, y);
    if (glow && size > 13) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = size * 0.45;
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  function drawGate(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    x: number,
    dz: number,
    op: GateOp,
    seed: number,
    time: number,
    alpha: number,
  ) {
    const lens = layout.lens;
    const half = LANE_WIDTH * 0.45;
    if (!project(lens, x - half, 0, dz, A) || !project(lens, x + half, GATE_TOP, dz, B)) return;
    const x0 = A.x;
    const x1 = B.x;
    if (x1 < -20 || x0 > layout.width + 20) return;
    const good = isGoodOp(op);
    const set = good ? p.good : p.bad;
    const s = A.s;
    const yb = A.y;
    const yt = B.y;
    const w = x1 - x0;
    const py0 = yt + (GATE_TOP - PANEL_TOP) * s;
    const py1 = yb - PANEL_BOTTOM * s;
    ctx.globalAlpha = alpha;
    softShadow(ctx, c, (x0 + x1) / 2, yb, w * 0.55, Math.max(1.5, 0.22 * s));

    ctx.save();
    ctx.translate(x0, py0);
    ctx.scale(w, py1 - py0);
    ctx.fillStyle = good ? c.glassGood : c.glassBad;
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, py0, w, py1 - py0);
    ctx.clip();
    const band = w * 0.35;
    const sweep = ((time * 0.9 + seed * 0.37) % 2.6) / 2.6;
    const bx = x0 - band * 2 + sweep * (w + band * 3);
    ctx.fillStyle = set.rim;
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    ctx.moveTo(bx, py1);
    ctx.lineTo(bx + band * 0.6, py0);
    ctx.lineTo(bx + band * 1.3, py0);
    ctx.lineTo(bx + band * 0.7, py1);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;

    ctx.strokeStyle = set.rim;
    ctx.lineWidth = Math.max(1, 0.035 * s);
    ctx.strokeRect(x0 + 0.5, py0 + 0.5, w - 1, py1 - py0 - 1);

    const post = Math.max(2, 0.13 * s);
    const beam = Math.max(2, 0.15 * s);
    if (
      project(lens, x - half, GATE_TOP, dz + 0.3, C) &&
      project(lens, x + half, GATE_TOP, dz + 0.3, D)
    ) {
      ctx.fillStyle = set.light;
      ctx.beginPath();
      ctx.moveTo(x0 - post / 2, yt - beam / 2);
      ctx.lineTo(x1 + post / 2, yt - beam / 2);
      ctx.lineTo(D.x + post / 2, D.y - beam / 2);
      ctx.lineTo(C.x - post / 2, C.y - beam / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = set.base;
    ctx.beginPath();
    ctx.roundRect(x0 - post / 2, yt - beam / 2, post, yb - yt + beam / 2, post / 2);
    ctx.roundRect(x1 - post / 2, yt - beam / 2, post, yb - yt + beam / 2, post / 2);
    ctx.roundRect(x0 - post / 2, yt - beam / 2, w + post, beam, beam / 2);
    ctx.fill();
    ctx.fillStyle = set.highlight;
    ctx.fillRect(x0 - post * 0.25, yt, Math.max(0.75, post * 0.22), yb - yt - post * 0.5);
    ctx.fillRect(x1 - post * 0.25, yt, Math.max(0.75, post * 0.22), yb - yt - post * 0.5);

    const { size, alpha: textAlpha } = labelSize(layout, 0.8 * s);
    if (textAlpha > 0.01) {
      const cx = (x0 + x1) / 2;
      const cy = (py0 + py1) / 2;
      ctx.globalAlpha = alpha * textAlpha;
      drawLabel(ctx, p, formatOp(op), cx, cy, size, set.text, set.glow);
      if (op.kind === "mul" && alpha > 0.5) {
        const stars = op.value >= 3 ? 5 : 3;
        ctx.fillStyle = set.light;
        for (let k = 0; k < stars; k++) {
          const a = time * 1.6 + (k * TAU) / stars + seed;
          const twinkle = 0.5 + 0.5 * Math.sin(time * 7 + k * 1.9 + seed);
          ctx.globalAlpha = alpha * textAlpha * twinkle;
          drawSparkle(
            ctx,
            cx + Math.cos(a) * w * 0.36,
            cy + Math.sin(a) * (py1 - py0) * 0.36,
            size * 0.16 * (0.6 + twinkle * 0.6),
          );
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSaw(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    x: number,
    dz: number,
    time: number,
    alpha: number,
  ) {
    const lens = layout.lens;
    if (!project(lens, x, 0.62, dz, A)) return;
    const r = 0.6 * A.s;
    const cx = A.x;
    const cy = A.y;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.wallDark;
    ctx.beginPath();
    groundQuad(ctx, lens, x - 0.8, x + 0.8, dz - 0.18, dz + 0.18);
    ctx.fill();
    softShadow(ctx, c, cx, cy + r * 1.05, r * 1.2, r * 0.22);
    ctx.strokeStyle = p.wallDark;
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.9, cy + r * 1.05);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + r * 0.9, cy + r * 1.05);
    ctx.stroke();
    const spin = time * 16;
    const teeth = 12;
    for (let ghost = 2; ghost >= 0; ghost--) {
      const a0 = spin - ghost * 0.11;
      ctx.globalAlpha = alpha * (ghost === 0 ? 1 : 0.22 / ghost);
      ctx.fillStyle = ghost === 0 ? p.bad.base : p.bad.light;
      ctx.beginPath();
      for (let k = 0; k < teeth; k++) {
        const a = a0 + (k * TAU) / teeth;
        ctx.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
        ctx.lineTo(cx + Math.cos(a + 0.2) * r * 1.15, cy + Math.sin(a + 0.2) * r * 1.15);
        ctx.lineTo(cx + Math.cos(a + 0.36) * r * 0.82, cy + Math.sin(a + 0.36) * r * 0.82);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r * 0.86, r * 0.86);
    ctx.fillStyle = c.saw;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = p.bad.dark;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, spin, spin + 2);
    ctx.stroke();
    ctx.fillStyle = p.surface;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBarrier(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    x: number,
    dz: number,
    time: number,
    seed: number,
    alpha: number,
  ) {
    const lens = layout.lens;
    const half = LANE_WIDTH * 0.46;
    const pivotY = 2.45;
    const arm = 1.55;
    if (!project(lens, x - half, 0, dz, A) || !project(lens, x + half, pivotY + 0.1, dz, B)) return;
    const s = A.s;
    ctx.globalAlpha = alpha;
    const angle = Math.sin(time * 3.2 + seed) * 0.75;
    const bx = x + Math.sin(angle) * arm;
    const by = pivotY - Math.cos(angle) * arm;
    project(lens, bx, 0, dz, D);
    softShadow(ctx, c, D.x, D.y, 0.6 * s, 0.14 * s);
    const post = Math.max(1.5, 0.1 * s);
    ctx.fillStyle = p.wallDark;
    ctx.fillRect(A.x - post / 2, B.y, post, A.y - B.y);
    ctx.fillRect(B.x - post / 2, B.y, post, A.y - B.y);
    ctx.fillRect(A.x - post / 2, B.y, B.x - A.x + post, Math.max(2, 0.12 * s));
    project(lens, x, pivotY, dz, C);
    project(lens, bx, by, dz, D);
    ctx.strokeStyle = p.wallDark;
    ctx.lineWidth = Math.max(1.5, 0.07 * s);
    ctx.beginPath();
    ctx.moveTo(C.x, C.y);
    ctx.lineTo(D.x, D.y);
    ctx.stroke();
    const bw = 1.0 * s;
    const bh = 0.5 * s;
    ctx.save();
    ctx.translate(D.x, D.y);
    ctx.rotate(-angle);
    ctx.fillStyle = p.bad.base;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, Math.min(4, bh * 0.3));
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = p.kerbB;
    for (let k = -3; k < 4; k++) {
      const sx = k * bh * 0.9;
      ctx.beginPath();
      ctx.moveTo(sx, -bh / 2);
      ctx.lineTo(sx + bh * 0.4, -bh / 2);
      ctx.lineTo(sx + bh * 0.05, bh / 2);
      ctx.lineTo(sx - bh * 0.35, bh / 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = p.bad.dark;
    ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawEnemy(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    x: number,
    dz: number,
    count: number,
    time: number,
    alpha: number,
  ) {
    const lens = layout.lens;
    const shown = Math.min(ENEMY_MAX, count);
    const spread = Math.sqrt(shown / ENEMY_MAX);
    if (!project(lens, x, 0, dz, A)) return;
    ctx.globalAlpha = alpha;
    softShadow(ctx, c, A.x, A.y, ((0.95 * spread + 0.4) * lens.fx) / dz, Math.max(1.5, 0.3 * A.s));
    let n = 0;
    let top = A.y;
    for (const slot of ENEMY_SLOTS) {
      if (slot.i >= shown) continue;
      const f = figures[n];
      if (!f) break;
      const fz = dz + slot.z;
      if (!project(lens, x + slot.x, 0, fz, B)) continue;
      f.x = B.x;
      f.y = B.y;
      f.s = B.s * FIGURE_UNIT;
      f.depth = fz;
      f.phase = time * 9 + slot.i * 1.3;
      f.bob = Math.abs(Math.sin(f.phase)) * f.s * 0.3;
      f.lean = 0;
      top = Math.min(top, f.y - 3.6 * f.s);
      n += 1;
    }
    sortFigures(n);
    drawFigures(ctx, n, p.bad, p, true);
    const { size, alpha: textAlpha } = labelSize(layout, 0.55 * A.s);
    if (textAlpha > 0.01) {
      ctx.globalAlpha = alpha * textAlpha;
      ctx.font = fontOf(900, size);
      const text = String(count);
      const w = ctx.measureText(text).width + size * 1.1;
      const h = size * 1.45;
      const by = top - h / 2 - Math.max(3, size * 0.25) + Math.sin(time * 5) * 1.2;
      ctx.fillStyle = p.bad.dark;
      ctx.beginPath();
      ctx.roundRect(A.x - w / 2, by - h / 2 + 1.5, w, h, h / 2);
      ctx.fill();
      pill(ctx, A.x - w / 2, by - h / 2, w, h, p.bad.base, null);
      ctx.beginPath();
      ctx.moveTo(A.x - size * 0.25, by + h / 2 - 0.5);
      ctx.lineTo(A.x, by + h / 2 + size * 0.3);
      ctx.lineTo(A.x + size * 0.25, by + h / 2 - 0.5);
      ctx.fill();
      ctx.fillStyle = p.bad.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, A.x, by + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawWall(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    camX: number,
    dz: number,
    count: number,
    alpha: number,
  ) {
    const lens = layout.lens;
    const left = -ROAD_HALF - 0.2 - camX;
    const right = ROAD_HALF + 0.2 - camX;
    if (!project(lens, left, 0, dz, A) || !project(lens, right, WALL_H, dz, B)) return;
    const s = A.s;
    const x0 = A.x;
    const x1 = B.x;
    const yb = A.y;
    const yt = B.y;
    const w = x1 - x0;
    const h = yb - yt;
    ctx.globalAlpha = alpha;
    softShadow(ctx, c, (x0 + x1) / 2, yb, w * 0.55, Math.max(2, 0.3 * s));
    if (project(lens, left, WALL_H, dz + 0.6, C) && project(lens, right, WALL_H, dz + 0.6, D)) {
      ctx.fillStyle = p.wallLight;
      ctx.beginPath();
      ctx.moveTo(x0, yt);
      ctx.lineTo(x1, yt);
      ctx.lineTo(D.x, D.y);
      ctx.lineTo(C.x, C.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = p.mortar;
    ctx.fillRect(x0, yt, w, h);
    const rows = 6;
    const bh = h / rows;
    const cols = Math.max(4, Math.round(w / Math.max(10, bh * 2.4)));
    const bw = w / cols;
    const gap = Math.max(0.6, Math.min(2, bh * 0.08));
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? bw / 2 : 0;
      for (let k = -1; k < cols; k++) {
        const bx0 = Math.max(x0, x0 + offset + k * bw);
        const bx1 = Math.min(x1, x0 + offset + (k + 1) * bw);
        if (bx1 - bx0 < gap * 2) continue;
        ctx.rect(bx0 + gap, yt + r * bh + gap, bx1 - bx0 - gap * 2, bh - gap * 2);
      }
    }
    ctx.fill();
    ctx.fillStyle = p.wallLight;
    for (let r = 0; r < rows; r++) ctx.fillRect(x0, yt + r * bh + gap, w, Math.max(0.75, bh * 0.1));
    const check = Math.max(3, bh * 0.55);
    const squares = Math.ceil(w / check);
    for (let k = 0; k < squares; k++) {
      const cw = Math.min(check, x1 - (x0 + k * check));
      ctx.fillStyle = k % 2 ? p.fg : p.surface;
      ctx.fillRect(x0 + k * check, yt - check, cw, check);
      ctx.fillStyle = k % 2 ? p.surface : p.fg;
      ctx.fillRect(x0 + k * check, yt - check * 2, cw, check);
    }
    const { size, alpha: textAlpha } = labelSize(layout, 0.85 * s);
    if (textAlpha > 0.01 && project(lens, -camX, WALL_H * 0.7, dz, C)) {
      ctx.globalAlpha = alpha * textAlpha;
      ctx.font = fontOf(900, size);
      const text = String(count);
      const tw = ctx.measureText(text).width + size * 1.1;
      const th = size * 1.5;
      ctx.fillStyle = p.fg;
      ctx.beginPath();
      ctx.roundRect(C.x - tw / 2, C.y - th / 2, tw, th, Math.min(8, th * 0.3));
      ctx.fill();
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = p.bg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, C.x, C.y + 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawEntity(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    entity: Entity,
    dz: number,
    time: number,
    camX: number,
  ) {
    const fade = fogFade(dz);
    if (fade < 0.02) return;
    switch (entity.kind) {
      case "gates": {
        const passing = clamp((dz - 3) / (CAMERA_BACK - 3), 0, 1);
        const alpha = entity.done ? fade * 0.35 * Math.min(1, passing * 1.5) : fade;
        entity.ops.forEach((op, lane) => {
          if (op && entity.taken !== lane)
            drawGate(ctx, p, c, layout, laneX(lane) - camX, dz, op, entity.z, time, alpha);
        });
        return;
      }
      case "blades":
        entity.lanes.forEach((blocked, lane) => {
          if (!blocked) return;
          const x = laneX(lane) - camX;
          if (entity.style === "saw") drawSaw(ctx, p, c, layout, x, dz, time, fade);
          else drawBarrier(ctx, p, c, layout, x, dz, time, entity.z + lane, fade);
        });
        return;
      case "enemy":
        if (entity.count > 0)
          drawEnemy(ctx, p, c, layout, laneX(entity.lane) - camX, dz, entity.count, time, fade);
        return;
      case "wall":
        drawWall(ctx, p, c, layout, camX, dz, entity.count, fade);
    }
  }

  function drawWorld(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
    camX: number,
  ) {
    const time = fx.time;
    const entities = state.entities;
    const visibleWall = (entity: Entity) =>
      entity.kind !== "wall" || !entity.done || state.status === "over";
    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i];
      if (!entity || !visibleWall(entity)) continue;
      let dz = depthOf(entity.z, state.distance);
      if (entity.kind === "wall" && entity.done) dz = Math.max(dz, CAMERA_BACK + 1);
      if (dz <= CAMERA_BACK || dz > FAR) continue;
      drawEntity(ctx, p, c, layout, entity, dz, time, camX);
    }
    drawCrowd(ctx, p, c, layout, state, fx, camX);
    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i];
      if (entity?.kind !== "gates") continue;
      const dz = depthOf(entity.z, state.distance);
      if (dz > CAMERA_BACK || dz < 3) continue;
      drawEntity(ctx, p, c, layout, entity, dz, time, camX);
    }
  }

  function drawParticles(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
    camX: number,
    confetti: boolean,
  ) {
    const lens = layout.lens;
    const maxSize = layout.height * 0.09;
    for (const q of fx.particles) {
      if (!q.active || (q.kind === "confetti") !== confetti) continue;
      const t = q.life / q.maxLife;
      let x: number;
      let y: number;
      let size: number;
      let alpha = Math.min(1, t * 1.6);
      if (confetti) {
        x = q.x * layout.width;
        y = q.y * layout.height;
        size = clamp(layout.height * 0.03, 3, 8) * q.size;
      } else {
        const dz = depthOf(q.z, state.distance);
        if (!project(lens, q.x - camX, q.y, dz, A)) continue;
        x = A.x;
        y = A.y;
        size = Math.min(maxSize, Math.max(1, q.size * A.s));
        alpha *= fogFade(dz);
      }
      ctx.globalAlpha = alpha;
      const colour = p.tones[q.tone];
      const cos = Math.cos(q.rot);
      const sin = Math.sin(q.rot);
      switch (q.kind) {
        case "dot":
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.arc(x, y, size * (0.5 + t * 0.5), 0, TAU);
          ctx.fill();
          break;
        case "ring":
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(
            x,
            y,
            size * (1 + (1 - t) * 1.6),
            size * 0.35 * (1 + (1 - t) * 1.6),
            0,
            0,
            TAU,
          );
          ctx.stroke();
          break;
        case "spark":
          ctx.fillStyle = colour;
          drawSparkle(ctx, x, y, size * (0.6 + t));
          break;
        case "shard": {
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.moveTo(x + cos * size, y + sin * size);
          ctx.lineTo(
            x - sin * size * 0.5 - cos * size * 0.4,
            y + cos * size * 0.5 - sin * size * 0.4,
          );
          ctx.lineTo(
            x + sin * size * 0.5 - cos * size * 0.6,
            y - cos * size * 0.5 - sin * size * 0.6,
          );
          ctx.fill();
          break;
        }
        case "debris":
        case "confetti": {
          const sx =
            size * (q.kind === "confetti" ? Math.abs(Math.cos(q.rot * 1.7)) * 0.6 + 0.1 : 1);
          const sy = size * (q.kind === "confetti" ? 0.5 : 0.7);
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.moveTo(x + cos * sx - sin * sy, y + sin * sx + cos * sy);
          ctx.lineTo(x - cos * sx - sin * sy, y - sin * sx + cos * sy);
          ctx.lineTo(x - cos * sx + sin * sy, y - sin * sx - cos * sy);
          ctx.lineTo(x + cos * sx + sin * sy, y + sin * sx - cos * sy);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTexts(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    fx: Fx,
    camX: number,
  ) {
    const base = clamp(layout.height * 0.11, 12, 26);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const t of fx.texts) {
      if (!t.active) continue;
      const k = t.life / t.maxLife;
      const pop = k > 0.8 ? 1 + (k - 0.8) * 2 : 1;
      const size = base * t.size * pop;
      project(layout.lens, t.x - camX, 0, CAMERA_BACK, A);
      const x = clamp(A.x, size * 1.5, layout.width - size * 1.5);
      const above = crowdAnchor.top - pillHeight(layout) - base * (t.size < 1 ? 1.6 : 0.7);
      const y = Math.max(layout.hud + size / 2, above - (1 - k) * layout.height * 0.14);
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = fontOf(900, size);
      ctx.lineWidth = Math.max(2.5, size * 0.18);
      ctx.strokeStyle = p.bg;
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = p.tones[t.tone];
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function pillHeight(layout: Layout) {
    return clamp(layout.height * 0.075, 10, 17) * 1.95;
  }

  function drawCrowdPill(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
  ) {
    const size = clamp(layout.height * 0.075, 10, 17);
    const h = size * 1.5;
    const cx = clamp(crowdAnchor.x, h * 2, layout.width - h * 2);
    const cy = Math.max(layout.hud + h / 2 + 2, crowdAnchor.top - h / 2 - size * 0.45);
    const scale = 1 + 0.32 * Math.sin(fx.bounce * Math.PI) * fx.bounce;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.font = fontOf(800, size);
    const text = String(state.count);
    const w = ctx.measureText(text).width + size * 1.9;
    ctx.fillStyle = p.good.dark;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2 + 1.5, w, h, h / 2);
    ctx.fill();
    pill(ctx, -w / 2, -h / 2, w, h, p.good.base, null);
    if (fx.flash !== 0) {
      ctx.globalAlpha = Math.min(1, Math.abs(fx.flash));
      pill(ctx, -w / 2, -h / 2, w, h, fx.flash > 0 ? p.success : p.bad.base, null);
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, h / 2);
    ctx.lineTo(0, h / 2 + size * 0.35);
    ctx.lineTo(size * 0.3, h / 2);
    ctx.fillStyle = fx.flash > 0.4 ? p.success : fx.flash < -0.4 ? p.bad.base : p.good.base;
    ctx.fill();
    ctx.fillStyle = p.good.ink;
    figureIcon(ctx, -w / 2 + size * 0.75, 0, size * 0.8);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, -w / 2 + size * 1.35, 1);
    ctx.restore();
  }

  function figureIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    ctx.beginPath();
    ctx.arc(x, y - size * 0.28, size * 0.22, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.22, size * 0.28, size * 0.3, 0, Math.PI, 0);
    ctx.fill();
  }

  function starIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function speakerIcon(ctx: CanvasRenderingContext2D, rect: Rect, p: Palette, muted: boolean) {
    const s = rect.h * 0.5;
    const cx = rect.x + rect.w / 2 - s * 0.2;
    const cy = rect.y + rect.h / 2;
    ctx.fillStyle = p.fg;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy - s * 0.2);
    ctx.lineTo(cx - s * 0.2, cy - s * 0.2);
    ctx.lineTo(cx + s * 0.15, cy - s * 0.5);
    ctx.lineTo(cx + s * 0.15, cy + s * 0.5);
    ctx.lineTo(cx - s * 0.2, cy + s * 0.2);
    ctx.lineTo(cx - s * 0.5, cy + s * 0.2);
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, s * 0.13);
    ctx.lineCap = "round";
    ctx.beginPath();
    if (muted) {
      ctx.strokeStyle = p.muted;
      ctx.moveTo(cx + s * 0.35, cy - s * 0.22);
      ctx.lineTo(cx + s * 0.75, cy + s * 0.22);
      ctx.moveTo(cx + s * 0.75, cy - s * 0.22);
      ctx.lineTo(cx + s * 0.35, cy + s * 0.22);
    } else {
      ctx.strokeStyle = p.fg;
      ctx.arc(cx + s * 0.15, cy, s * 0.4, -0.8, 0.8);
      ctx.moveTo(cx + s * 0.15 + Math.cos(-0.8) * s * 0.72, cy + Math.sin(-0.8) * s * 0.72);
      ctx.arc(cx + s * 0.15, cy, s * 0.72, -0.8, 0.8);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  function drawHud(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    state: GateRunnerState,
    ui: RenderUi,
  ) {
    const h = layout.pill;
    const y = (layout.hud - h) / 2;
    const pad = Math.max(6, layout.width * 0.012);
    const size = h * 0.52;
    const gap = 6;
    ctx.font = fontOf(700, size);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const items = [
      { text: String(scoreOf(state)), icon: "flag", side: "left", priority: 3 },
      { text: String(state.best), icon: "star", side: "left", priority: 1 },
      { text: `Stage ${state.stage}`, icon: "", side: "right", priority: 3 },
      { text: String(state.count), icon: "figure", side: "right", priority: 2 },
    ] as const;
    const widths = items.map(
      (item) => ctx.measureText(item.text).width + h * 0.8 + (item.icon ? h * 0.7 : 0),
    );
    const mute = muteRect(layout);
    const budget = layout.width - pad * 2 - mute.w - gap;
    const visible = items.map(() => true);
    const total = () => widths.reduce((sum, w, i) => sum + (visible[i] ? w + gap : 0), 0);
    for (const level of [1, 2]) {
      if (total() <= budget) break;
      items.forEach((item, i) => {
        if (item.priority === level) visible[i] = false;
      });
    }
    let left = pad;
    let right = mute.x - gap;
    items.forEach((item, i) => {
      if (!visible[i]) return;
      const w = widths[i] ?? 0;
      const x = item.side === "left" ? left : right - w;
      if (item.side === "left") left += w + gap;
      else right -= w + gap;
      const highlight = item.icon === "star";
      pill(ctx, x, y, w, h, highlight ? p.ui.base : p.pill, highlight ? null : p.border);
      const ink = highlight ? p.ui.ink : p.fg;
      let tx = x + h * 0.4;
      ctx.fillStyle = item.icon === "figure" ? p.ui.base : ink;
      if (item.icon === "flag") {
        ctx.fillStyle = p.ui.base;
        ctx.fillRect(tx + h * 0.1, y + h * 0.22, h * 0.07, h * 0.56);
        ctx.beginPath();
        ctx.moveTo(tx + h * 0.17, y + h * 0.22);
        ctx.lineTo(tx + h * 0.5, y + h * 0.33);
        ctx.lineTo(tx + h * 0.17, y + h * 0.46);
        ctx.fill();
      } else if (item.icon === "star") {
        starIcon(ctx, tx + h * 0.28, y + h / 2, h * 0.27);
      } else if (item.icon === "figure") {
        figureIcon(ctx, tx + h * 0.28, y + h / 2, h * 0.6);
      }
      if (item.icon) tx += h * 0.7;
      ctx.font = fontOf(700, size);
      ctx.fillStyle = ink;
      ctx.textAlign = "left";
      ctx.fillText(item.text, tx, y + h / 2 + 0.5);
    });
    pill(ctx, mute.x, mute.y, mute.w, mute.h, p.pill, ui.hoverMute ? p.ui.base : p.border);
    speakerIcon(ctx, mute, p, state.muted);
  }

  function drawTitle(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
  ) {
    const { size, y: cy } = titleMetrics(layout);
    const cx = layout.width / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = fontOf(900, size, true);
    ctx.lineJoin = "round";
    ctx.fillStyle = p.good.dark;
    ctx.fillText("GATE RUSH", cx + size * 0.05, cy + size * 0.09);
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.strokeStyle = p.good.dark;
    ctx.strokeText("GATE RUSH", cx, cy);
    ctx.fillStyle = c.logo;
    ctx.fillText("GATE RUSH", cx, cy);
    const small = clamp(size * 0.34, 11, 15);
    ctx.globalAlpha = 0.72 + 0.28 * Math.sin(fx.time * 3.2);
    ctx.font = fontOf(700, small);
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.bg;
    ctx.strokeText("Press Space or tap to play", cx, cy + size * 0.55 + small);
    ctx.fillStyle = p.fg;
    ctx.fillText("Press Space or tap to play", cx, cy + size * 0.55 + small);
    ctx.globalAlpha = 1;
    if (state.best > 0 && layout.height > 200) {
      ctx.font = fontOf(600, small * 0.9);
      ctx.fillStyle = p.muted;
      ctx.fillText(`Best ${state.best}`, cx, cy + size * 0.55 + small * 2.4);
    }
  }

  function drawClear(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    state: GateRunnerState,
  ) {
    const clear = state.clear;
    if (!clear) return;
    const { horizon, ground } = layout.lens;
    const appear = easeOutBack(Math.min(1, clear.age / 280));
    const fade = clear.age > CLEAR_MS - 350 ? Math.max(0, (CLEAR_MS - clear.age) / 350) : 1;
    const cy = horizon + (ground - horizon) * 0.4;
    const bandH = (ground - horizon) * 0.62;
    ctx.globalAlpha = fade * Math.min(1, clear.age / 120);
    ctx.fillStyle = p.overlay;
    ctx.fillRect(0, cy - bandH / 2, layout.width, bandH);
    ctx.fillStyle = p.good.base;
    ctx.fillRect(0, cy - bandH / 2, layout.width, 2);
    ctx.fillRect(0, cy + bandH / 2 - 2, layout.width, 2);
    const size = Math.min(bandH * 0.44, layout.width / 11);
    ctx.save();
    ctx.translate(layout.width / 2, cy - bandH * 0.1);
    ctx.scale(appear, appear);
    ctx.font = fontOf(900, size, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.strokeStyle = p.good.dark;
    ctx.strokeText("STAGE CLEAR", 0, 0);
    ctx.shadowColor = p.good.glow;
    ctx.shadowBlur = size * 0.4;
    ctx.fillStyle = p.good.light;
    ctx.fillText("STAGE CLEAR", 0, 0);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.restore();
    ctx.font = fontOf(600, clamp(size * 0.36, 10, 14));
    ctx.fillStyle = p.fg;
    ctx.textAlign = "center";
    ctx.fillText(
      `Wall of ${clear.wall} smashed · ${clear.crowd} left · +${clear.bonus}`,
      layout.width / 2,
      cy + bandH * 0.3,
    );
    ctx.globalAlpha = 1;
  }

  function drawOver(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
    ui: RenderUi,
  ) {
    const t = Math.min(1, state.statusAge / 350);
    const ease = 1 - (1 - t) ** 3;
    ctx.globalAlpha = ease;
    ctx.fillStyle = p.overlay;
    ctx.fillRect(0, 0, layout.width, layout.height);
    const { card, button, wide } = overCard(layout);
    ctx.save();
    ctx.translate(0, (1 - ease) * 14);
    ctx.shadowColor = p.shadow;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = p.surface;
    ctx.beginPath();
    ctx.roundRect(card.x, card.y, card.w, card.h, 12);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    const title = clamp(card.h * 0.15, 14, 22);
    const score = scoreOf(state);
    const newBest = score > state.runBest && score > 0;
    ctx.textBaseline = "middle";
    ctx.font = fontOf(900, title);
    const titleY = card.y + 12 + title / 2;
    const titleText = "Game over";
    const titleW = ctx.measureText(titleText).width;
    const bs = title * 0.55;
    ctx.font = fontOf(900, bs);
    const bw = ctx.measureText("NEW BEST").width + bs * 2.2;
    const rowW = titleW + (newBest ? bw + 8 : 0);
    const titleX = wide ? card.x + 16 : card.x + (card.w - rowW) / 2;
    ctx.font = fontOf(900, title);
    ctx.textAlign = "left";
    ctx.fillStyle = p.fg;
    ctx.fillText(titleText, titleX, titleY);
    if (newBest) {
      const pulse = 1 + 0.06 * Math.sin(fx.time * 6);
      ctx.font = fontOf(900, bs);
      ctx.save();
      ctx.translate(titleX + titleW + 8 + bw / 2, titleY);
      ctx.scale(pulse, pulse);
      pill(ctx, -bw / 2, -bs * 0.85, bw, bs * 1.7, p.ui.base, null);
      ctx.fillStyle = p.ui.ink;
      starIcon(ctx, -bw / 2 + bs * 0.75, 0, bs * 0.45);
      ctx.textAlign = "left";
      ctx.fillText("NEW BEST", -bw / 2 + bs * 1.35, 0.5);
      ctx.restore();
    }

    const stats: Array<[string, string]> = [
      ["Score", String(score)],
      ["Best", String(state.best)],
      ["Stage", String(state.stage)],
      ["Biggest crowd", String(state.maxCount)],
    ];
    const statsW = wide ? card.w - button.w - 48 : card.w - 24;
    const statsX = card.x + (wide ? 16 : 12);
    const value = clamp(card.h * 0.14, 13, 20);
    const label = clamp(value * 0.55, 9, 11);
    const statsY = wide ? card.y + card.h * 0.6 : card.y + card.h * 0.44;
    const col = statsW / stats.length;
    stats.forEach(([name, amount], i) => {
      const x = statsX + col * i + (wide ? 0 : col / 2);
      ctx.textAlign = wide ? "left" : "center";
      ctx.font = fontOf(800, value);
      ctx.fillStyle = i === 0 ? p.ui.text : p.fg;
      ctx.fillText(amount, x, statsY);
      ctx.font = fontOf(600, label);
      ctx.fillStyle = p.muted;
      ctx.fillText(name, x, statsY + value * 0.95);
    });

    const ready = state.statusAge > 450;
    const pressed = ui.pressButton && ready;
    const hovered = ui.hoverButton && ready;
    const by = button.y + (pressed ? 1.5 : 0);
    if (!pressed) {
      ctx.fillStyle = p.ui.dark;
      ctx.beginPath();
      ctx.roundRect(button.x, button.y + 2.5, button.w, button.h, button.h / 2);
      ctx.fill();
    }
    pill(
      ctx,
      button.x,
      by,
      button.w,
      button.h,
      pressed ? p.ui.dark : hovered ? p.ui.light : p.ui.base,
      null,
    );
    const fs = clamp(button.h * 0.42, 11, 15);
    ctx.font = fontOf(800, fs);
    const label2 = "Play again";
    const lw = ctx.measureText(label2).width;
    const startX = button.x + (button.w - lw - fs * 1.1) / 2;
    ctx.fillStyle = hovered && !pressed ? p.ui.dark : p.ui.ink;
    ctx.beginPath();
    ctx.moveTo(startX, by + button.h / 2 - fs * 0.38);
    ctx.lineTo(startX + fs * 0.62, by + button.h / 2);
    ctx.lineTo(startX, by + button.h / 2 + fs * 0.38);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillText(label2, startX + fs * 1.1, by + button.h / 2 + 0.5);
    if (wide) {
      ctx.font = fontOf(500, label);
      ctx.fillStyle = p.muted;
      ctx.textAlign = "center";
      ctx.fillText("or press Space", button.x + button.w / 2, button.y - label);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  return {
    setTheme(theme, resolve) {
      palette = buildPalette(theme, resolve);
      themeVersion += 1;
    },
    setFont(family) {
      font = family;
    },
    draw(ctx, state, fx, layout, ui) {
      const p = palette;
      if (!p) return;
      const c = ensureCache(ctx, p, layout);
      const time = fx.time;
      const camX = fx.camX;
      ctx.save();
      if (fx.shake > 0) {
        ctx.translate(Math.sin(time * 91) * fx.shake, Math.cos(time * 77) * fx.shake * 0.6);
      }
      drawBackdrop(ctx, p, c, layout, state, camX);
      drawStreaks(ctx, p, layout, state, time, camX);
      drawWorld(ctx, p, c, layout, state, fx, camX);
      if (state.status === "ready") {
        ctx.fillStyle = p.overlay;
        ctx.fillRect(0, layout.hud, layout.width, layout.height - layout.hud);
      }
      if (state.status !== "over") drawParticles(ctx, p, layout, state, fx, camX, false);
      if (state.status !== "ready") drawCrowdPill(ctx, p, layout, state, fx);
      drawTexts(ctx, p, layout, fx, camX);
      ctx.restore();

      ctx.save();
      ctx.translate(layout.width / 2, layout.height / 2);
      ctx.scale(layout.width / 2, layout.height / 2);
      ctx.fillStyle = c.vignette;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();

      drawHud(ctx, p, layout, state, ui);
      if (state.status === "ready") drawTitle(ctx, p, c, layout, state, fx);
      drawClear(ctx, p, layout, state);
      if (state.status === "over") {
        drawOver(ctx, p, layout, state, fx, ui);
        drawParticles(ctx, p, layout, state, fx, camX, true);
      }
    },
  };
}
