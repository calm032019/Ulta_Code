import type { MiniGameTheme } from "../types";
import {
  BLACK,
  WHITE,
  darken,
  inkOn,
  lighten,
  luminance,
  mix,
  pickDistinct,
  pickVivid,
  toCss,
  withAlpha,
  type Rgba,
} from "./color";
import { centreBack, MAX_UNITS, type Fx, type Tone } from "./fx";
import {
  clamp,
  depthAt,
  laneCenter,
  muteRect,
  overCard,
  worldToScreen,
  type Layout,
  type Rect,
} from "./layout";
import {
  CLEAR_MS,
  formatOp,
  isGoodOp,
  LANES,
  scoreOf,
  type Entity,
  type GateOp,
  type GateRunnerState,
} from "./logic";

const TAU = Math.PI * 2;
const MAX_FIGURES = MAX_UNITS + 40;

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
  success: string;
  wall: string;
  wallLight: string;
  wallDark: string;
  mortar: string;
  roadTop: string;
  roadBottom: string;
  rail: string;
  railLight: string;
  laneMark: string;
  shadow: string;
  shadowClear: string;
  sheen: string;
  sheenClear: string;
  pill: string;
  overlay: string;
  skyTop: string;
  skyBottom: string;
  far: string;
  near: string;
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
}

interface Cache {
  key: string;
  road: CanvasGradient;
  sky: CanvasGradient;
  vignette: CanvasGradient;
  shadow: CanvasGradient;
  sheen: CanvasGradient;
  glassGood: CanvasGradient;
  glassBad: CanvasGradient;
  saw: CanvasGradient;
  logo: CanvasGradient;
  far: Path2D;
  near: Path2D;
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
    text: toCss(dark ? lighten(base, 0.3) : darken(base, 0.12)),
    glow: toCss(withAlpha(base, 0.8)),
    head: toCss(lighten(base, 0.22)),
    highlight: toCss(withAlpha(lighten(base, 0.75), 0.9)),
    glassTop: toCss(withAlpha(light, dark ? 0.42 : 0.55)),
    glassMid: toCss(withAlpha(base, 0.14)),
    glassBottom: toCss(withAlpha(base, 0.36)),
    rim: toCss(withAlpha(lighten(base, 0.55), 0.95)),
  };
}

function buildPalette(theme: MiniGameTheme, resolve: (css: string) => Rgba): Palette {
  const bg = resolve(theme.background);
  const surface = resolve(theme.surface);
  const fg = resolve(theme.foreground);
  const border = resolve(theme.border);
  const success = resolve(theme.success);
  const dark = luminance(bg) < 0.3;
  const bad = pickVivid([resolve(theme.danger), fg], surface, 1.8);
  const good = pickDistinct([resolve(theme.accent), success, fg], surface, bad);
  const wall = mix(surface, fg, dark ? 0.34 : 0.3);
  const shade = dark ? BLACK : fg;
  const good_ = toneSet(good, bg, fg, dark);
  const bad_ = toneSet(bad, bg, fg, dark);
  return {
    dark,
    bg: toCss(bg),
    surface: toCss(surface),
    fg: toCss(fg),
    muted: toCss(resolve(theme.muted)),
    border: toCss(border),
    good: good_,
    bad: bad_,
    success: toCss(success),
    wall: toCss(wall),
    wallLight: toCss(mix(wall, surface, 0.35)),
    wallDark: toCss(mix(wall, fg, 0.25)),
    mortar: toCss(mix(surface, fg, 0.12)),
    roadTop: toCss(mix(surface, fg, dark ? 0.02 : 0.05)),
    roadBottom: toCss(dark ? lighten(surface, 0.05) : mix(surface, bg, 0.6)),
    rail: toCss(mix(border, fg, 0.3)),
    railLight: toCss(dark ? lighten(border, 0.15) : lighten(surface, 0.7)),
    laneMark: toCss(withAlpha(mix(surface, fg, 0.4), 0.5)),
    shadow: toCss(withAlpha(shade, dark ? 0.45 : 0.18)),
    shadowClear: toCss(withAlpha(shade, 0)),
    sheen: toCss(withAlpha(WHITE, dark ? 0.04 : 0.4)),
    sheenClear: toCss(withAlpha(WHITE, 0)),
    pill: toCss(withAlpha(surface, 0.94)),
    overlay: toCss(withAlpha(bg, 0.62)),
    skyTop: toCss(bg),
    skyBottom: toCss(mix(bg, good, 0.07)),
    far: toCss(mix(mix(bg, fg, 0.06), good, 0.05)),
    near: toCss(mix(mix(bg, fg, dark ? 0.12 : 0.1), good, 0.08)),
    vignette: toCss(withAlpha(shade, dark ? 0.42 : 0.1)),
    vignetteClear: toCss(withAlpha(shade, 0)),
    tones: {
      good: good_.base,
      goodLight: good_.light,
      bad: bad_.base,
      badLight: bad_.light,
      wall: toCss(wall),
      success: toCss(success),
      fg: toCss(fg),
    },
  };
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function sceneryPaths(width: number, sky: number): { far: Path2D; near: Path2D } {
  const far = new Path2D();
  far.moveTo(0, sky);
  for (let x = 0; x <= width; x += 8) {
    const t = (x / width) * TAU;
    far.lineTo(x, sky * (0.5 - Math.sin(t * 2) * 0.12 - Math.sin(t * 5 + 1) * 0.06));
  }
  far.lineTo(width, sky);
  far.closePath();
  const near = new Path2D();
  near.moveTo(0, sky);
  let x = 0;
  let i = 0;
  while (x < width) {
    const w = Math.min(width - x, 10 + hash(i) * 22);
    const h = sky * (0.22 + hash(i + 50) * 0.4);
    near.lineTo(x, sky - h);
    if (hash(i + 90) > 0.6) {
      near.lineTo(x + w * 0.45, sky - h);
      near.lineTo(x + w * 0.45, sky - h - sky * 0.12);
      near.lineTo(x + w * 0.55, sky - h - sky * 0.12);
      near.lineTo(x + w * 0.55, sky - h);
    }
    near.lineTo(x + w, sky - h);
    x += w;
    i += 1;
  }
  near.lineTo(width, sky);
  near.closePath();
  return { far, near };
}

const easeOutBack = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

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
  }));
  const order = new Int16Array(MAX_UNITS);

  const fontOf = (weight: number, size: number, italic = false) =>
    `${italic ? "italic " : ""}${weight} ${Math.max(1, Math.round(size))}px ${font}`;

  function ensureCache(ctx: CanvasRenderingContext2D, p: Palette, layout: Layout): Cache {
    const key = `${themeVersion}:${layout.width}x${layout.height}`;
    if (cache?.key === key) return cache;
    const road = ctx.createLinearGradient(0, layout.top, 0, layout.bottom);
    road.addColorStop(0, p.roadTop);
    road.addColorStop(1, p.roadBottom);
    const sky = ctx.createLinearGradient(0, 0, 0, layout.sky);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyBottom);
    const vignette = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.3);
    vignette.addColorStop(0, p.vignetteClear);
    vignette.addColorStop(1, p.vignette);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    shadow.addColorStop(0, p.shadow);
    shadow.addColorStop(1, p.shadowClear);
    const sheen = ctx.createLinearGradient(0, 0, 1, 0);
    sheen.addColorStop(0, p.sheenClear);
    sheen.addColorStop(0.5, p.sheen);
    sheen.addColorStop(1, p.sheenClear);
    const panelH = layout.laneH * 0.82;
    const glass = (set: ToneSet) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, panelH);
      gradient.addColorStop(0, set.glassTop);
      gradient.addColorStop(0.45, set.glassMid);
      gradient.addColorStop(1, set.glassBottom);
      return gradient;
    };
    const saw = ctx.createRadialGradient(-0.25, -0.25, 0.05, 0, 0, 1);
    saw.addColorStop(0, p.bad.light);
    saw.addColorStop(0.6, p.bad.base);
    saw.addColorStop(1, p.bad.dark);
    const logoSize = Math.min(layout.roadH * 0.36, layout.width / 9);
    const logoY = layout.top + layout.roadH * 0.36;
    const logo = ctx.createLinearGradient(0, logoY - logoSize / 2, 0, logoY + logoSize / 2);
    logo.addColorStop(0, p.good.light);
    logo.addColorStop(1, p.good.base);
    const paths = sceneryPaths(layout.width, layout.sky);
    cache = {
      key,
      road,
      sky,
      vignette,
      shadow,
      sheen,
      glassGood: glass(p.good),
      glassBad: glass(p.bad),
      saw,
      logo,
      far: paths.far,
      near: paths.near,
    };
    return cache;
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

  function drawBackdrop(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    state: GateRunnerState,
  ) {
    const { width, sky, top, bottom, roadH, laneH, pxPerM } = layout;
    const travel = state.distance * pxPerM;
    ctx.fillStyle = c.sky;
    ctx.fillRect(0, 0, width, sky);
    const layer = (path: Path2D, colour: string, factor: number) => {
      const offset = (travel * factor) % width;
      ctx.fillStyle = colour;
      ctx.save();
      ctx.translate(-offset, 0);
      ctx.fill(path);
      ctx.translate(width, 0);
      ctx.fill(path);
      ctx.restore();
    };
    layer(c.far, p.far, 0.04);
    layer(c.near, p.near, 0.12);

    ctx.fillStyle = c.road;
    ctx.fillRect(0, top, width, roadH);
    const sheenW = width * 0.6;
    const sheenX = width - ((travel * 0.25) % (width + sheenW));
    ctx.save();
    ctx.translate(sheenX, 0);
    ctx.scale(sheenW, 1);
    ctx.fillStyle = c.sheen;
    ctx.fillRect(0, top, 1, roadH);
    ctx.restore();

    ctx.strokeStyle = p.laneMark;
    ctx.lineCap = "round";
    for (let lane = 1; lane < LANES; lane++) {
      const y = top + lane * laneH;
      const depth = depthAt(lane - 0.5);
      const dash = Math.max(10, pxPerM * 1.6) * depth;
      ctx.lineWidth = 2 * depth;
      ctx.setLineDash([dash, dash * 0.9]);
      ctx.lineDashOffset = travel % (dash * 1.9);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineCap = "butt";

    ctx.fillStyle = p.rail;
    ctx.fillRect(0, top - 1, width, 3);
    ctx.fillRect(0, bottom, width, layout.height - bottom);
    ctx.fillStyle = p.railLight;
    ctx.fillRect(0, top - 1, width, 1);
    ctx.fillRect(0, bottom, width, 1);
    const post = Math.max(28, pxPerM * 3);
    ctx.fillStyle = p.rail;
    for (let x = -(travel % post); x < width; x += post) {
      ctx.fillRect(x, top - 4, 2, 4);
    }
  }

  function drawFigures(
    ctx: CanvasRenderingContext2D,
    count: number,
    set: ToneSet,
    p: Palette,
    facing: 1 | -1,
    indices: Int16Array | null,
  ) {
    if (count <= 0) return;
    let total = 0;
    for (let i = 0; i < count; i++) total += figures[i]?.s ?? 0;
    const avg = total / count;
    const at = (i: number) => figures[indices ? (indices[i] ?? 0) : i];

    ctx.fillStyle = p.shadow;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      ctx.moveTo(f.x + f.s * 0.85, f.y + f.s * 1.5);
      ctx.ellipse(f.x, f.y + f.s * 1.5, f.s * 0.85, f.s * 0.26, 0, 0, TAU);
    }
    ctx.fill();

    ctx.strokeStyle = set.dark;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, avg * 0.36);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      const hipY = f.y + f.s * 0.45 - f.bob;
      const stride = Math.sin(f.phase) * f.s * 0.55 * facing;
      ctx.moveTo(f.x, hipY);
      ctx.lineTo(f.x + stride, f.y + f.s * 1.4);
      ctx.moveTo(f.x, hipY);
      ctx.lineTo(f.x - stride, f.y + f.s * 1.4);
    }
    ctx.stroke();
    ctx.lineCap = "butt";

    ctx.lineWidth = Math.max(0.75, avg * 0.2);
    ctx.fillStyle = set.base;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      const cx = f.x + f.lean * f.s * 0.25;
      const cy = f.y - f.bob;
      const rot = f.lean * 0.5 + 0.18 * facing;
      const rx = f.s * 0.5;
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
      const hx = f.x + f.lean * f.s * 0.6 + facing * f.s * 0.16;
      const hy = f.y - f.bob - f.s * 1.18;
      ctx.moveTo(hx + f.s * 0.48, hy);
      ctx.arc(hx, hy, f.s * 0.48, 0, TAU);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = set.highlight;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = at(i);
      if (!f) continue;
      const hx = f.x + f.lean * f.s * 0.6 + facing * f.s * 0.16 - f.s * 0.14;
      const hy = f.y - f.bob - f.s * 1.34;
      ctx.moveTo(hx + f.s * 0.17, hy);
      ctx.arc(hx, hy, f.s * 0.17, 0, TAU);
    }
    ctx.fill();
  }

  function softShadow(
    ctx: CanvasRenderingContext2D,
    c: Cache,
    x: number,
    y: number,
    rx: number,
    ry: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    ctx.fillStyle = c.shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCrowd(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
  ) {
    const { laneH } = layout;
    const spread = Math.sqrt(fx.shown / MAX_UNITS);
    softShadow(
      ctx,
      c,
      layout.crowdX - centreBack(fx.shown) * laneH,
      laneCenter(layout, state.lane) + laneH * 0.22,
      (0.25 + spread * 0.85) * laneH,
      (0.12 + spread * 0.14) * laneH,
    );
    let n = 0;
    for (let i = 0; i < MAX_UNITS; i++) {
      const unit = fx.units[i];
      const f = figures[n];
      if (!unit?.alive || unit.delay > 0 || unit.scale < 0.04 || !f) continue;
      const depth = depthAt(clamp(unit.y, 0, LANES - 1));
      f.x = layout.crowdX + unit.x * laneH;
      f.y = laneCenter(layout, unit.y);
      f.s = laneH * 0.085 * depth * Math.min(1.35, unit.scale);
      f.bob = Math.abs(Math.sin(unit.phase)) * f.s * 0.45;
      f.lean = clamp(unit.vy * 0.18 + unit.vx * 0.05, -0.6, 0.6);
      f.phase = unit.phase;
      order[n] = n;
      n += 1;
    }
    for (let i = 1; i < n; i++) {
      const value = order[i] ?? 0;
      const y = figures[value]?.y ?? 0;
      let j = i - 1;
      while (j >= 0 && (figures[order[j] ?? 0]?.y ?? 0) > y) {
        order[j + 1] = order[j] ?? 0;
        j -= 1;
      }
      order[j + 1] = value;
    }
    drawFigures(ctx, n, p.good, p, 1, order);
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

  function drawGate(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    sx: number,
    lane: number,
    op: GateOp,
    seed: number,
    time: number,
    faded: boolean,
  ) {
    const good = isGoodOp(op);
    const set = good ? p.good : p.bad;
    const depth = depthAt(lane);
    const h = layout.laneH * 0.82;
    const w = Math.max(10, layout.pxPerM * 1.25) * depth;
    const x0 = sx - w / 2;
    const y0 = laneCenter(layout, lane) - h / 2;
    ctx.globalAlpha = faded ? 0.35 : 1;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.min(5, w / 3));
    ctx.fillStyle = good ? c.glassGood : c.glassBad;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const band = w * 0.7;
    const sweep = ((time * 1.4 + seed * 3.7) % 2.4) / 2.4;
    const bx = -band + sweep * (w + band * 2);
    ctx.fillStyle = set.rim;
    ctx.globalAlpha *= 0.28;
    ctx.beginPath();
    ctx.moveTo(bx, h);
    ctx.lineTo(bx + band * 0.4, 0);
    ctx.lineTo(bx + band, 0);
    ctx.lineTo(bx + band * 0.6, h);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = set.rim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(0.75, 0.75, w - 1.5, h - 1.5, Math.min(5, w / 3));
    ctx.stroke();
    ctx.fillStyle = set.base;
    ctx.beginPath();
    ctx.roundRect(-2, -2, w + 4, 4, 2);
    ctx.roundRect(-2, h - 2, w + 4, 4, 2);
    ctx.fill();
    ctx.restore();

    const size = clamp(layout.laneH * 0.44, 12, 28) * depth;
    const text = formatOp(op);
    const cy = y0 + h / 2;
    ctx.font = fontOf(900, size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2.5, size * 0.16);
    ctx.strokeStyle = p.bg;
    ctx.strokeText(text, sx, cy);
    ctx.shadowColor = set.glow;
    ctx.shadowBlur = size * 0.5;
    ctx.fillStyle = set.text;
    ctx.fillText(text, sx, cy);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    if (op.kind === "mul" && !faded) {
      const stars = op.value >= 3 ? 5 : 3;
      ctx.fillStyle = set.light;
      for (let k = 0; k < stars; k++) {
        const a = time * 1.6 + (k * TAU) / stars + seed;
        const twinkle = 0.5 + 0.5 * Math.sin(time * 7 + k * 1.9 + seed);
        ctx.globalAlpha = twinkle;
        drawSparkle(
          ctx,
          sx + Math.cos(a) * size * 1.05,
          cy + Math.sin(a) * size * 0.75,
          size * 0.18 * (0.6 + twinkle * 0.6),
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSaw(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    sx: number,
    lane: number,
    time: number,
  ) {
    const depth = depthAt(lane);
    const r = layout.laneH * 0.3 * depth;
    const cy = laneCenter(layout, lane);
    const laneTop = cy - layout.laneH / 2;
    softShadow(ctx, c, sx, cy + r * 1.05, r * 1.1, r * 0.25);
    ctx.strokeStyle = p.rail;
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(sx, laneTop + 2);
    ctx.lineTo(sx, cy);
    ctx.stroke();
    const spin = time * 16;
    const teeth = 10;
    for (let ghost = 2; ghost >= 0; ghost--) {
      const a0 = spin - ghost * 0.11;
      ctx.globalAlpha = ghost === 0 ? 1 : 0.22 / ghost;
      ctx.fillStyle = ghost === 0 ? p.bad.base : p.bad.light;
      ctx.beginPath();
      for (let k = 0; k < teeth; k++) {
        const a = a0 + (k * TAU) / teeth;
        ctx.lineTo(sx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
        ctx.lineTo(sx + Math.cos(a + 0.22) * r * 1.18, cy + Math.sin(a + 0.22) * r * 1.18);
        ctx.lineTo(sx + Math.cos(a + 0.42) * r * 0.82, cy + Math.sin(a + 0.42) * r * 0.82);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(sx, cy);
    ctx.scale(r * 0.86, r * 0.86);
    ctx.fillStyle = c.saw;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = p.bad.dark;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(sx, cy, r * 0.55, spin, spin + 2);
    ctx.stroke();
    ctx.fillStyle = p.surface;
    ctx.beginPath();
    ctx.arc(sx, cy, r * 0.18, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  function drawBarrier(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    sx: number,
    lane: number,
    time: number,
    seed: number,
  ) {
    const depth = depthAt(lane);
    const laneTop = laneCenter(layout, lane) - layout.laneH / 2;
    const length = layout.laneH * 0.52;
    const angle = Math.sin(time * 3.2 + seed) * 0.6;
    const ex = sx + Math.sin(angle) * length;
    const ey = laneTop + 4 + Math.cos(angle) * length;
    softShadow(ctx, c, ex, laneTop + layout.laneH * 0.93, layout.laneH * 0.22, layout.laneH * 0.06);
    ctx.strokeStyle = p.rail;
    ctx.lineWidth = Math.max(2, 2.5 * depth);
    ctx.beginPath();
    ctx.moveTo(sx, laneTop + 4);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = p.rail;
    ctx.fillRect(sx - 6, laneTop + 1, 12, 4);
    const bw = Math.max(9, layout.pxPerM * 0.9) * depth;
    const bh = layout.laneH * 0.34 * depth;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(-angle);
    ctx.fillStyle = p.bad.base;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh * 0.3, bw, bh, 3);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = p.bad.light;
    for (let k = -2; k < 4; k++) {
      ctx.beginPath();
      const y = -bh * 0.3 + k * bh * 0.32;
      ctx.moveTo(-bw / 2, y);
      ctx.lineTo(bw / 2, y - bh * 0.25);
      ctx.lineTo(bw / 2, y - bh * 0.1);
      ctx.lineTo(-bw / 2, y + bh * 0.15);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = p.bad.dark;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemy(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    sx: number,
    lane: number,
    count: number,
    time: number,
  ) {
    const shown = Math.min(36, count);
    const cy = laneCenter(layout, lane);
    const { laneH } = layout;
    const spread = Math.sqrt(shown / 36);
    softShadow(
      ctx,
      c,
      sx + spread * laneH * 0.4,
      cy + laneH * 0.22,
      (0.2 + spread * 0.5) * laneH,
      0.14 * laneH,
    );
    const depth = depthAt(lane);
    for (let i = 0; i < shown; i++) {
      const f = figures[i];
      if (!f) continue;
      const a = i * 2.39996;
      const r = Math.sqrt((i + 0.5) / 36);
      f.x = sx + spread * laneH * 0.4 + Math.cos(a) * r * laneH * 0.5;
      f.y = cy + Math.sin(a) * r * laneH * 0.3;
      f.s = laneH * 0.08 * depth;
      f.phase = time * 9 + i * 1.3;
      f.bob = Math.abs(Math.sin(f.phase)) * f.s * 0.3;
      f.lean = -0.15;
    }
    drawFigures(ctx, shown, p.bad, p, -1, null);
    const poleX = sx + spread * laneH * 0.4;
    const poleTop = Math.max(layout.top + 2, cy - laneH * 0.62);
    ctx.strokeStyle = p.bad.dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(poleX, cy - laneH * 0.15);
    ctx.lineTo(poleX, poleTop);
    ctx.stroke();
    const size = clamp(laneH * 0.28, 10, 16);
    ctx.font = fontOf(800, size);
    const text = String(count);
    const w = ctx.measureText(text).width + size * 0.8;
    const wave = Math.sin(time * 5) * 1.5;
    ctx.fillStyle = p.bad.base;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.lineTo(poleX + w, poleTop + wave);
    ctx.lineTo(poleX + w - size * 0.3, poleTop + size * 0.65);
    ctx.lineTo(poleX + w, poleTop + size * 1.3 + wave);
    ctx.lineTo(poleX, poleTop + size * 1.3);
    ctx.fill();
    ctx.fillStyle = p.bad.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, poleX + size * 0.3, poleTop + size * 0.67);
  }

  function drawWall(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    sx: number,
    count: number,
  ) {
    const w = Math.max(16, layout.pxPerM * 1.9);
    const x0 = sx - w / 2;
    const { top, roadH } = layout;
    softShadow(ctx, c, sx + w * 0.4, layout.bottom - 2, w * 0.9, 4);
    const rows = 6;
    const bh = roadH / rows;
    ctx.fillStyle = p.mortar;
    ctx.fillRect(x0, top, w, roadH);
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? w / 4 : 0;
      for (let k = -1; k < 2; k++) {
        const bx = Math.max(x0, x0 + offset + k * (w / 2));
        const bx1 = Math.min(x0 + w, x0 + offset + (k + 1) * (w / 2));
        if (bx1 - bx < 2) continue;
        ctx.roundRect(bx + 1, top + r * bh + 1, bx1 - bx - 2, bh - 2, 2);
      }
    }
    ctx.fill();
    ctx.fillStyle = p.wallLight;
    for (let r = 0; r < rows; r++)
      ctx.fillRect(x0 + 1, top + r * bh + 1, w - 2, Math.max(1, bh * 0.12));
    ctx.fillStyle = p.wallDark;
    ctx.fillRect(x0 + w - 3, top, 3, roadH);
    const check = Math.max(4, w / 4);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = k % 2 ? p.fg : p.surface;
      ctx.fillRect(x0 + k * check, top - check, check, check);
      ctx.fillStyle = k % 2 ? p.surface : p.fg;
      ctx.fillRect(x0 + k * check, top - check * 2, check, check);
    }
    const size = clamp(layout.laneH * 0.42, 13, 26);
    ctx.font = fontOf(900, size);
    const text = String(count);
    const tw = Math.max(w + 6, ctx.measureText(text).width + size * 0.9);
    const cy = top + roadH / 2;
    ctx.fillStyle = p.fg;
    ctx.beginPath();
    ctx.roundRect(sx - tw / 2, cy - size * 0.8, tw, size * 1.6, 5);
    ctx.fill();
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = p.bg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, sx, cy + 1);
  }

  function drawEntity(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    c: Cache,
    layout: Layout,
    state: GateRunnerState,
    entity: Entity,
    time: number,
  ) {
    const sx = worldToScreen(layout, entity.x, state.distance);
    if (sx < -80 || sx > layout.width + 80) return;
    switch (entity.kind) {
      case "gates":
        entity.ops.forEach((op, lane) => {
          if (op && entity.taken !== lane)
            drawGate(ctx, p, c, layout, sx, lane, op, entity.x, time, entity.done);
        });
        return;
      case "blades":
        entity.lanes.forEach((blocked, lane) => {
          if (!blocked) return;
          if (entity.style === "saw") drawSaw(ctx, p, c, layout, sx, lane, time);
          else drawBarrier(ctx, p, c, layout, sx, lane, time, entity.x);
        });
        return;
      case "enemy":
        if (entity.count > 0) drawEnemy(ctx, p, c, layout, sx, entity.lane, entity.count, time);
        return;
      case "wall":
        if (!entity.done) drawWall(ctx, p, c, layout, sx, entity.count);
    }
  }

  function drawParticles(ctx: CanvasRenderingContext2D, p: Palette, fx: Fx) {
    for (const q of fx.particles) {
      if (!q.active) continue;
      const t = q.life / q.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      const colour = p.tones[q.tone];
      const cos = Math.cos(q.rot);
      const sin = Math.sin(q.rot);
      switch (q.kind) {
        case "dot":
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.size * (0.5 + t * 0.5), 0, TAU);
          ctx.fill();
          break;
        case "ring":
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.size * (1 + (1 - t) * 1.6), 0, TAU);
          ctx.stroke();
          break;
        case "spark":
          ctx.fillStyle = colour;
          drawSparkle(ctx, q.x, q.y, q.size * (0.6 + t));
          break;
        case "shard": {
          const s = q.size;
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.moveTo(q.x + cos * s, q.y + sin * s);
          ctx.lineTo(q.x - sin * s * 0.5 - cos * s * 0.4, q.y + cos * s * 0.5 - sin * s * 0.4);
          ctx.lineTo(q.x + sin * s * 0.5 - cos * s * 0.6, q.y - cos * s * 0.5 - sin * s * 0.6);
          ctx.fill();
          break;
        }
        case "debris":
        case "confetti": {
          const sx =
            q.size * (q.kind === "confetti" ? Math.abs(Math.cos(q.rot * 1.7)) * 0.6 + 0.1 : 1);
          const sy = q.size * (q.kind === "confetti" ? 0.5 : 0.8);
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.moveTo(q.x + cos * sx - sin * sy, q.y + sin * sx + cos * sy);
          ctx.lineTo(q.x - cos * sx - sin * sy, q.y - sin * sx + cos * sy);
          ctx.lineTo(q.x - cos * sx + sin * sy, q.y - sin * sx - cos * sy);
          ctx.lineTo(q.x + cos * sx + sin * sy, q.y + sin * sx - cos * sy);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTexts(ctx: CanvasRenderingContext2D, p: Palette, fx: Fx) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const t of fx.texts) {
      if (!t.active) continue;
      const k = t.life / t.maxLife;
      const pop = k > 0.8 ? 1 + (k - 0.8) * 2 : 1;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = fontOf(900, t.size * pop);
      ctx.lineWidth = Math.max(2.5, t.size * 0.18);
      ctx.strokeStyle = p.bg;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = p.tones[t.tone];
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawCrowdPill(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    layout: Layout,
    state: GateRunnerState,
    fx: Fx,
  ) {
    const { laneH } = layout;
    const spread = Math.sqrt(fx.shown / MAX_UNITS);
    const cx = layout.crowdX - centreBack(fx.shown) * laneH;
    const size = clamp(laneH * 0.28, 10, 16);
    const h = size * 1.5;
    const centre = laneCenter(layout, state.lane);
    const above = centre - laneH * (0.38 + spread * 0.34) - h / 2;
    const cy =
      above >= layout.top + h * 0.5 + 2 ? above : centre + laneH * (0.3 + spread * 0.2) + h / 2;
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
    const y = (layout.sky - h) / 2;
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
      pill(ctx, x, y, w, h, highlight ? p.good.base : p.pill, highlight ? null : p.border);
      const ink = highlight ? p.good.ink : p.fg;
      let tx = x + h * 0.4;
      ctx.fillStyle = item.icon === "figure" ? p.good.base : ink;
      if (item.icon === "flag") {
        ctx.fillStyle = p.good.base;
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
    pill(ctx, mute.x, mute.y, mute.w, mute.h, p.pill, ui.hoverMute ? p.good.base : p.border);
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
    const size = Math.min(layout.roadH * 0.36, layout.width / 9);
    const cx = Math.max(layout.width * 0.58, layout.crowdX + size * 3.2);
    const cy = layout.top + layout.roadH * 0.36;
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
    ctx.fillStyle = p.fg;
    ctx.fillText("Press Space or tap to play", cx, cy + size * 0.55 + small);
    ctx.globalAlpha = 1;
    if (state.best > 0 && layout.roadH > 100) {
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
    const appear = easeOutBack(Math.min(1, clear.age / 280));
    const fade = clear.age > CLEAR_MS - 350 ? Math.max(0, (CLEAR_MS - clear.age) / 350) : 1;
    const cy = layout.top + layout.roadH * 0.5;
    const bandH = layout.roadH * 0.5;
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
      pill(ctx, -bw / 2, -bs * 0.85, bw, bs * 1.7, p.good.base, null);
      ctx.fillStyle = p.good.ink;
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
      ctx.fillStyle = i === 0 ? p.good.text : p.fg;
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
      ctx.fillStyle = p.good.dark;
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
      pressed ? p.good.dark : hovered ? p.good.light : p.good.base,
      null,
    );
    const fs = clamp(button.h * 0.42, 11, 15);
    ctx.font = fontOf(800, fs);
    const label2 = "Play again";
    const lw = ctx.measureText(label2).width;
    const startX = button.x + (button.w - lw - fs * 1.1) / 2;
    ctx.fillStyle = hovered && !pressed ? p.good.dark : p.good.ink;
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
      ctx.save();
      if (fx.shake > 0) {
        ctx.translate(Math.sin(time * 91) * fx.shake, Math.cos(time * 77) * fx.shake * 0.6);
      }
      drawBackdrop(ctx, p, c, layout, state);
      for (const entity of state.entities) drawEntity(ctx, p, c, layout, state, entity, time);
      if (state.status === "ready") {
        ctx.fillStyle = p.overlay;
        ctx.fillRect(0, layout.top, layout.width, layout.roadH);
      }
      drawCrowd(ctx, p, c, layout, state, fx);
      if (state.status !== "over") drawParticles(ctx, p, fx);
      if (state.status !== "ready") drawCrowdPill(ctx, p, layout, state, fx);
      drawTexts(ctx, p, fx);
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
        drawParticles(ctx, p, fx);
      }
    },
  };
}
