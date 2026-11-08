import type { MiniGameTheme } from "../types";
import {
  CAM_STREET,
  D_CORPSE,
  D_POOL,
  D_SPLAT,
  P_BLOOD,
  P_DEBRIS,
  P_DUST,
  P_FLASH,
  P_PROP,
  P_SHELL,
  P_SMOKE,
  P_SPARK,
  P_SPARKLE,
  P_STEAM,
  floorY,
  lineY,
  segmentIndex,
  type Decal,
  type Fx,
  type Tumbler,
} from "./fx";
import {
  MAX_HP,
  SEWER_CEILING,
  SEWER_Y,
  VIEW_H,
  type Enemy,
  type GameState,
  type Obstacle,
  type ObstacleKind,
  type Rail,
  type Rider,
  type Segment,
  type Zone,
} from "./model";

export interface RenderUi {
  hoverButton: boolean;
  hoverMute: boolean;
  pressButton: boolean;
  touch: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Rgb = readonly [number, number, number];

const TAU = Math.PI * 2;
/** One golden hour, dusk, night, dawn loop of running time. */
const DAY_MS = 240_000;
const BUCKETS = 96;
const TILE_W = 1024;
const TILE_EXT = 0.42;
/** Rider speed (world units/s) where speed lines start, and how far above that they peak. */
const SPEED_FX_MIN = 330;
const SPEED_FX_RANGE = 200;
/** Gunman aim duration the laser sight ramps over; logic's GUN_AIM_MS. */
const AIM_MS = 650;
const CAM_SEWER = SEWER_Y + CAM_STREET;
const SEWER_TOP = SEWER_Y - SEWER_CEILING;
const BACK: Record<Zone, number> = { street: 13, roof: 5, sewer: 3 };
const SEWER_LIGHT: Rgb = [0.5, 0.56, 0.5];
const CEILING_PIPES = [
  [6, 3, "pipeDark"],
  [6, 2.2, "pipe"],
  [5.4, 0.6, "pipeHi"],
  [11, 1.8, "pipeDark"],
  [11, 1.2, "steel"],
] as const;

const REASONS: Record<NonNullable<GameState["deathReason"]>, string> = {
  landing: "Ate the pavement",
  obstacle: "Wiped out",
  fall: "Fell between buildings",
  shot: "Shot down",
  stabbed: "Got stabbed",
  bitten: "Rat bite",
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const css = (c: Rgb, a = 1) =>
  a >= 1
    ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const shade = (a: Rgb, k: number): Rgb => [
  Math.min(255, a[0] * k),
  Math.min(255, a[1] * k),
  Math.min(255, a[2] * k),
];
const light = (a: Rgb, k: Rgb): Rgb => [
  Math.min(255, a[0] * k[0]),
  Math.min(255, a[1] * k[1]),
  Math.min(255, a[2] * k[2]),
];
const lum = (k: Rgb) => k[0] * 0.3 + k[1] * 0.59 + k[2] * 0.11;

function hash(n: number): number {
  let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  x ^= x >>> 15;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** Stable 0..1 values from an entity seed, whatever range the generator uses for seeds. */
const seedHash = (seed: number, k: number) => hash(Math.floor(seed * 9973) + k * 7919);

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface SkyKey {
  at: number;
  top: Rgb;
  mid: Rgb;
  low: Rgb;
  ambient: Rgb;
  night: number;
  sun: number;
  cloud: number;
}

const SKY_KEYS: ReadonlyArray<SkyKey> = [
  {
    at: 0,
    top: [70, 104, 160],
    mid: [226, 156, 120],
    low: [255, 204, 140],
    ambient: [1.02, 0.88, 0.74],
    night: 0,
    sun: 0.22,
    cloud: 0.5,
  },
  {
    at: 0.17,
    top: [52, 58, 118],
    mid: [196, 98, 122],
    low: [255, 142, 92],
    ambient: [0.82, 0.62, 0.64],
    night: 0.15,
    sun: -0.05,
    cloud: 0.6,
  },
  {
    at: 0.3,
    top: [22, 26, 66],
    mid: [70, 58, 120],
    low: [168, 92, 128],
    ambient: [0.54, 0.52, 0.7],
    night: 0.7,
    sun: -0.35,
    cloud: 0.25,
  },
  {
    at: 0.42,
    top: [8, 10, 28],
    mid: [20, 22, 56],
    low: [78, 42, 92],
    ambient: [0.42, 0.44, 0.62],
    night: 1,
    sun: -0.6,
    cloud: 0.12,
  },
  {
    at: 0.7,
    top: [8, 10, 28],
    mid: [22, 22, 60],
    low: [86, 46, 96],
    ambient: [0.42, 0.44, 0.62],
    night: 1,
    sun: -0.6,
    cloud: 0.12,
  },
  {
    at: 0.82,
    top: [44, 56, 104],
    mid: [152, 122, 160],
    low: [255, 176, 146],
    ambient: [0.72, 0.7, 0.82],
    night: 0.35,
    sun: -0.05,
    cloud: 0.45,
  },
  {
    at: 0.92,
    top: [84, 128, 192],
    mid: [200, 186, 190],
    low: [255, 218, 168],
    ambient: [0.98, 0.94, 0.9],
    night: 0,
    sun: 0.3,
    cloud: 0.45,
  },
  {
    at: 1,
    top: [70, 104, 160],
    mid: [226, 156, 120],
    low: [255, 204, 140],
    ambient: [1.02, 0.88, 0.74],
    night: 0,
    sun: 0.22,
    cloud: 0.5,
  },
];

interface Tod {
  top: Rgb;
  mid: Rgb;
  low: Rgb;
  ambient: Rgb;
  night: number;
  sun: number;
  cloud: number;
}

function skyPair(phase: number): { a: SkyKey; b: SkyKey; t: number } {
  let a = SKY_KEYS[0] as SkyKey;
  let b = SKY_KEYS[1] as SkyKey;
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const k0 = SKY_KEYS[i];
    const k1 = SKY_KEYS[i + 1];
    if (k0 && k1 && phase >= k0.at && phase <= k1.at) {
      a = k0;
      b = k1;
      break;
    }
  }
  return { a, b, t: smooth(clamp((phase - a.at) / (b.at - a.at || 1), 0, 1)) };
}

function sampleSky(phase: number): Tod {
  const { a, b, t } = skyPair(phase);
  return {
    top: mix(a.top, b.top, t),
    mid: mix(a.mid, b.mid, t),
    low: mix(a.low, b.low, t),
    ambient: mix(a.ambient, b.ambient, t),
    night: lerp(a.night, b.night, t),
    sun: lerp(a.sun, b.sun, t),
    cloud: lerp(a.cloud, b.cloud, t),
  };
}

const WORLD = {
  asphalt: [64, 66, 74],
  laneLine: [206, 200, 182],
  sidewalk: [150, 146, 140],
  curb: [178, 174, 166],
  curbFace: [110, 106, 102],
  earth: [52, 46, 46],
  manhole: [44, 44, 48],
  manholeRim: [104, 104, 108],
  tar: [56, 56, 62],
  tarLine: [96, 96, 102],
  coping: [170, 160, 142],
  brick: [124, 66, 50],
  brickDark: [72, 38, 32],
  window: [34, 42, 56],
  iron: [30, 32, 36],
  steel: [104, 112, 124],
  steelHi: [214, 224, 236],
  steelDark: [40, 44, 52],
  pipe: [92, 96, 84],
  pipeHi: [176, 182, 160],
  pipeDark: [36, 38, 32],
  ledge: [152, 148, 140],
  ledgeHi: [204, 200, 190],
  ledgeDark: [96, 92, 88],
  taxi: [250, 190, 30],
  taxiDark: [168, 112, 10],
  glass: [52, 72, 92],
  glassHi: [170, 200, 220],
  tire: [24, 24, 26],
  chrome: [196, 200, 206],
  cone: [244, 112, 30],
  white: [236, 236, 230],
  red: [212, 48, 40],
  bag: [30, 30, 36],
  bagHi: [84, 88, 100],
  hydrant: [200, 40, 34],
  hydrantCap: [232, 192, 64],
  pole: [46, 64, 56],
  poleHi: [96, 120, 108],
  stack: [236, 112, 36],
  tank: [124, 86, 58],
  tankDark: [78, 54, 36],
  ac: [170, 172, 176],
  acDark: [104, 106, 112],
  board: [160, 100, 52],
  wheel: [236, 226, 196],
  jeans: [46, 60, 96],
  shoe: [232, 232, 228],
  beanie: [36, 36, 42],
  skin: [214, 160, 124],
  skinB: [160, 108, 76],
  skinC: [104, 70, 50],
  thugA: [64, 78, 58],
  thugB: [96, 44, 48],
  thugC: [74, 74, 82],
  pants: [38, 38, 46],
  coat: [84, 62, 44],
  coatB: [44, 44, 52],
  gun: [28, 28, 32],
  blade: [226, 232, 238],
  rat: [96, 86, 80],
  ratPink: [196, 136, 136],
  blood: [138, 12, 18],
  bloodDark: [80, 4, 10],
  token: [224, 178, 70],
  tokenDark: [150, 108, 30],
  ammo: [96, 108, 58],
  brass: [218, 168, 70],
  billboard: [58, 58, 66],
  sign: [24, 26, 28],
} as const satisfies Record<string, Rgb>;

const SEWER = {
  sewerFloor: [62, 66, 56],
  sewerFloorHi: [128, 140, 112],
  sewerSlab: [34, 34, 38],
  sewerWater: [36, 70, 50],
  sewerWaterDeep: [8, 22, 16],
} as const satisfies Record<string, Rgb>;

type ColourKey = keyof typeof WORLD | keyof typeof SEWER;

interface Palette {
  c: Record<ColourKey, string>;
  hoodie: string;
  hoodieDark: string;
  ink: string;
  rim: string;
  lum: number;
  depthShade: CanvasGradient;
  roofShade: CanvasGradient;
  sewerShade: CanvasGradient;
  sewerWall: CanvasGradient;
  alley: CanvasGradient;
  pit: CanvasGradient;
  water: CanvasGradient;
  vault: CanvasGradient;
}

interface LayerSpec {
  parallax: number;
  /** Tallest building as a fraction of the view height. */
  top: number;
  /** Screen height fraction of the building bases when the camera is at street level. */
  base: number;
  tone: Rgb;
  haze: number;
  fog: number;
  seed: number;
  kind: 0 | 1 | 2 | 3;
}

const LAYER_SPECS: ReadonlyArray<LayerSpec> = [
  {
    parallax: 0.08,
    top: 0.96,
    base: 0.68,
    tone: [98, 106, 134],
    haze: 0.58,
    fog: 0.5,
    seed: 11,
    kind: 0,
  },
  {
    parallax: 0.2,
    top: 0.6,
    base: 0.7,
    tone: [76, 80, 102],
    haze: 0.4,
    fog: 0.42,
    seed: 23,
    kind: 1,
  },
  {
    parallax: 0.4,
    top: 0.3,
    base: 0.72,
    tone: [86, 64, 60],
    haze: 0.24,
    fog: 0.32,
    seed: 37,
    kind: 2,
  },
  {
    parallax: 0.65,
    top: 0.46,
    base: 0.745,
    tone: [70, 46, 42],
    haze: 0.12,
    fog: 0.24,
    seed: 53,
    kind: 3,
  },
];

interface Layer {
  spec: LayerSpec;
  base: HTMLCanvasElement;
  tinted: HTMLCanvasElement;
  windows: HTMLCanvasElement;
  h: number;
  baseLine: number;
  bottom: string;
}

interface Sprites {
  warm: HTMLCanvasElement;
  cool: HTMLCanvasElement;
  green: HTMLCanvasElement;
  red: HTMLCanvasElement;
  pink: HTMLCanvasElement;
  cyan: HTMLCanvasElement;
  amber: HTMLCanvasElement;
  sun: HTMLCanvasElement;
  muzzle: HTMLCanvasElement;
  puff: HTMLCanvasElement;
  dust: HTMLCanvasElement;
  smoke: HTMLCanvasElement;
  cone: HTMLCanvasElement;
}

interface PatternSources {
  facade: HTMLCanvasElement;
  lit: HTMLCanvasElement;
  sewer: HTMLCanvasElement;
}

interface Patterns {
  facade: CanvasPattern;
  lit: CanvasPattern;
  sewer: CanvasPattern;
}

function canvas2d(
  wCss: number,
  hCss: number,
  ratio: number,
): {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
} {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(wCss * ratio));
  c.height = Math.max(1, Math.ceil(hCss * ratio));
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D is unavailable");
  g.scale(ratio, ratio);
  return { c, g };
}

function glowSprite(rgb: Rgb, ratio: number, size = 64, core = 0.45): HTMLCanvasElement {
  const { c, g } = canvas2d(size, size, ratio);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, css(rgb, 1));
  grad.addColorStop(0.18, css(rgb, core));
  grad.addColorStop(0.5, css(rgb, core * 0.28));
  grad.addColorStop(1, css(rgb, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function puffSprite(rgb: Rgb, ratio: number): HTMLCanvasElement {
  const { c, g } = canvas2d(32, 32, ratio);
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, css(rgb, 0.85));
  grad.addColorStop(0.55, css(rgb, 0.4));
  grad.addColorStop(1, css(rgb, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function coneSprite(ratio: number): HTMLCanvasElement {
  const { c, g } = canvas2d(64, 128, ratio);
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, "rgba(255,206,140,0.55)");
  v.addColorStop(0.7, "rgba(255,190,120,0.16)");
  v.addColorStop(1, "rgba(255,180,110,0)");
  g.fillStyle = v;
  g.beginPath();
  g.moveTo(26, 0);
  g.lineTo(38, 0);
  g.lineTo(64, 128);
  g.lineTo(0, 128);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = "destination-in";
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, "rgba(0,0,0,0)");
  h.addColorStop(0.35, "rgba(0,0,0,1)");
  h.addColorStop(0.65, "rgba(0,0,0,1)");
  h.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 128);
  return c;
}

function buildSprites(ratio: number): Sprites {
  return {
    warm: glowSprite([255, 196, 120], ratio),
    cool: glowSprite([180, 210, 255], ratio),
    green: glowSprite([90, 255, 140], ratio),
    red: glowSprite([255, 60, 50], ratio),
    pink: glowSprite([255, 80, 190], ratio),
    cyan: glowSprite([70, 230, 255], ratio),
    amber: glowSprite([255, 170, 40], ratio),
    sun: glowSprite([255, 220, 160], ratio, 128, 0.6),
    muzzle: glowSprite([255, 236, 170], ratio, 32, 0.8),
    puff: puffSprite([236, 238, 240], ratio),
    dust: puffSprite([170, 160, 148], ratio),
    smoke: puffSprite([130, 130, 136], ratio),
    cone: coneSprite(ratio),
  };
}

const LIT_COLOURS = ["#ffd38a", "#ffc070", "#ffe4b0", "#a8d4ff", "#ffcf7a", "#8fb8ff", "#ffb3e6"];

function windowGrid(
  base: CanvasRenderingContext2D | null,
  lit: CanvasRenderingContext2D,
  rand: () => number,
  x: number,
  y: number,
  w: number,
  bottom: number,
  cellW: number,
  cellH: number,
  winW: number,
  winH: number,
  litChance: number,
  warm: boolean,
) {
  const cols = Math.max(1, Math.floor((w - 1) / cellW));
  const x0 = x + (w - cols * cellW) / 2 + (cellW - winW) / 2;
  for (let yy = y + cellH * 0.5; yy + winH < bottom; yy += cellH) {
    const rowLit = rand() < 0.4;
    for (let i = 0; i < cols; i++) {
      const xx = x0 + i * cellW;
      if (base) base.fillRect(xx, yy, winW, winH);
      if (rand() < (rowLit ? litChance : litChance * 0.15)) {
        const pick = rand();
        lit.fillStyle =
          LIT_COLOURS[warm ? Math.floor(pick * 3) : pick < 0.6 ? 3 + Math.floor(pick * 3) : 6] ??
          "#ffd38a";
        lit.fillRect(xx, yy, winW, winH);
      }
    }
  }
}

function block(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  bottom: number,
  colour: Rgb,
) {
  g.fillStyle = css(colour);
  g.fillRect(x, y, w, bottom - y);
  g.fillStyle = css(shade(colour, 0.8));
  g.fillRect(x, y, Math.max(1, w * 0.22), bottom - y);
  const rim = Math.max(0.8, w * 0.05);
  g.fillStyle = css(shade(colour, 1.28));
  g.fillRect(x + w - rim, y, rim, bottom - y);
  g.fillStyle = css(shade(colour, 1.45));
  g.fillRect(x, y, w, 0.8);
}

function waterTank(
  g: CanvasRenderingContext2D,
  cx: number,
  roof: number,
  size: number,
  colour: Rgb,
) {
  const w = 10 * size;
  const legs = 6 * size;
  const body = 9 * size;
  g.fillStyle = css(shade(colour, 0.6));
  g.fillRect(cx - w * 0.4, roof - legs, 0.7, legs);
  g.fillRect(cx + w * 0.4 - 0.7, roof - legs, 0.7, legs);
  g.fillRect(cx - 0.35, roof - legs, 0.7, legs);
  g.fillRect(cx - w * 0.45, roof - legs * 0.55, w * 0.9, 0.5);
  g.fillStyle = css(colour);
  g.fillRect(cx - w / 2, roof - legs - body, w, body);
  g.fillStyle = css(shade(colour, 1.3));
  g.fillRect(cx + w / 2 - 1, roof - legs - body, 1, body);
  g.fillStyle = css(shade(colour, 0.55));
  g.fillRect(cx - w / 2, roof - legs - body * 0.3, w, 0.5);
  g.fillRect(cx - w / 2, roof - legs - body * 0.7, w, 0.5);
  g.fillStyle = css(shade(colour, 0.85));
  g.beginPath();
  g.moveTo(cx - w / 2 - 0.5, roof - legs - body);
  g.lineTo(cx, roof - legs - body - 4.5 * size);
  g.lineTo(cx + w / 2 + 0.5, roof - legs - body);
  g.closePath();
  g.fill();
}

function bakeLayer(spec: LayerSpec, H: number, ratio: number): Layer {
  const baseLine = Math.round(H * (spec.top + 0.05));
  const h = Math.ceil(baseLine + H * TILE_EXT);
  const base = canvas2d(TILE_W, h, ratio);
  const lit = canvas2d(TILE_W, h, ratio);
  const tinted = canvas2d(TILE_W, h, ratio);
  const g = base.g;
  const wg = lit.g;
  const rand = rng(spec.seed * 7919 + 13);
  const tone = spec.tone;

  if (spec.kind === 0) {
    const bridgeA = 560;
    const bridgeB = 880;
    let x = 0;
    while (x < TILE_W) {
      const inBridge = x + 56 > bridgeA - 10 && x < bridgeB + 10;
      const landmark = !inBridge && rand() < 0.08;
      let w = Math.round(16 + rand() * 38);
      if (landmark) w = Math.max(w, 32);
      if (TILE_W - (x + w) < 14) w = TILE_W - x;
      const hFrac = inBridge
        ? 0.03 + rand() * 0.07
        : landmark
          ? 0.72 + rand() * 0.16
          : 0.14 + Math.pow(rand(), 1.5) * 0.5;
      const top = baseLine - hFrac * H;
      const colour = shade(tone, 0.86 + rand() * 0.26);
      const tiers = landmark ? 3 : rand() < 0.4 ? 2 : 1;
      const tierH = (baseLine - top) * 0.2;
      const warm = rand() < 0.45;
      for (let t = 0; t < tiers; t++) {
        const tw = w * (1 - t * 0.26);
        const tx = x + (w - tw) / 2;
        const ty = top + tierH * (tiers - 1 - t);
        block(g, tx, ty, tw, h, colour);
        g.fillStyle = css(shade(colour, 1.12));
        g.globalAlpha = 0.35;
        for (let sx = tx + 2.5; sx < tx + tw - 1.5; sx += 3)
          g.fillRect(sx, ty + 2, 0.6, h - ty - 2);
        g.globalAlpha = 1;
        const lower = t === 0 ? baseLine : top + tierH * (tiers - t);
        windowGrid(null, wg, rand, tx + 1, ty + 2, tw - 2, lower, 3, 3.4, 1.3, 1.6, 0.55, warm);
      }
      const topW = w * (1 - (tiers - 1) * 0.26);
      const cx = x + w / 2;
      g.fillStyle = css(colour);
      if (landmark && rand() < 0.5) {
        for (let k = 0; k < 4; k++) {
          const rw = topW * (0.5 - k * 0.1);
          g.beginPath();
          g.ellipse(cx, top - k * topW * 0.13, rw, rw * 0.9, 0, Math.PI, 0);
          g.fill();
          wg.strokeStyle = "rgba(255,226,170,0.9)";
          wg.lineWidth = 0.6;
          wg.beginPath();
          wg.ellipse(cx, top - k * topW * 0.13, rw * 0.8, rw * 0.7, 0, Math.PI + 0.2, -0.2);
          wg.stroke();
        }
        g.beginPath();
        g.moveTo(cx - 1.4, top - topW * 0.42);
        g.lineTo(cx, top - topW * 0.42 - H * 0.13);
        g.lineTo(cx + 1.4, top - topW * 0.42);
        g.closePath();
        g.fill();
      } else if (landmark) {
        const step = H * 0.025;
        for (let k = 1; k <= 3; k++) {
          const sw = topW * (1 - k * 0.24);
          g.fillRect(cx - sw / 2, top - step * k, sw, step);
        }
        g.fillRect(cx - 0.7, top - step * 3 - H * 0.12, 1.4, H * 0.12);
        wg.fillStyle = "#ff4a3a";
        wg.fillRect(cx - 0.8, top - step * 3 - H * 0.12 - 1, 1.6, 1.6);
      } else {
        const roll = rand();
        if (roll < 0.28) {
          const len = 6 + rand() * 18;
          g.fillRect(cx + (rand() - 0.5) * topW * 0.5, top - len, 0.8, len);
        } else if (roll < 0.45) {
          g.beginPath();
          g.moveTo(cx - topW / 2, top);
          g.lineTo(cx, top - topW * 0.38);
          g.lineTo(cx + topW / 2, top);
          g.closePath();
          g.fill();
        } else if (roll < 0.7) {
          g.fillRect(cx - topW * 0.3, top - 3, topW * 0.25, 3);
          g.fillRect(cx + topW * 0.05, top - 2, topW * 0.2, 2);
        }
      }
      x += w + (rand() < 0.22 ? Math.round(2 + rand() * 6) : 0);
    }
    const deck = baseLine - H * 0.1;
    const towerTop = baseLine - H * 0.34;
    const t1 = bridgeA + 50;
    const t2 = bridgeB - 50;
    const col = css(shade(tone, 0.9));
    g.fillStyle = col;
    g.strokeStyle = col;
    g.fillRect(bridgeA - 40, deck, bridgeB - bridgeA + 80, 2.4);
    for (const tx of [t1, t2]) {
      g.fillRect(tx - 5, towerTop, 3, h - towerTop);
      g.fillRect(tx + 2, towerTop, 3, h - towerTop);
      g.fillRect(tx - 5.5, towerTop - 1, 11, 2.5);
      g.fillRect(tx - 5, deck - 14, 10, 2);
      g.fillRect(tx - 5, deck + 4, 10, 2);
    }
    const low = deck - 3;
    const cy = 2 * low - towerTop;
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(t1, towerTop + 1);
    g.quadraticCurveTo((t1 + t2) / 2, cy, t2, towerTop + 1);
    g.moveTo(bridgeA - 40, deck);
    g.quadraticCurveTo(bridgeA - 10, deck - 4, t1, towerTop + 1);
    g.moveTo(t2, towerTop + 1);
    g.quadraticCurveTo(bridgeB + 10, deck - 4, bridgeB + 40, deck);
    g.stroke();
    g.globalAlpha = 0.6;
    g.lineWidth = 0.5;
    g.beginPath();
    for (let k = 1; k <= 4; k++) {
      g.moveTo(t1, towerTop + 3);
      g.lineTo(t1 + k * 16, deck);
      g.moveTo(t2, towerTop + 3);
      g.lineTo(t2 - k * 16, deck);
    }
    g.stroke();
    g.globalAlpha = 1;
    for (let sx = t1 + 4; sx < t2 - 3; sx += 4) {
      const t = (sx - t1) / (t2 - t1);
      const yy = (1 - t) * (1 - t) * (towerTop + 1) + 2 * t * (1 - t) * cy + t * t * (towerTop + 1);
      g.fillRect(sx, yy, 0.45, deck - yy);
      if (Math.round(sx) % 8 < 4) {
        wg.fillStyle = "#fff2d6";
        wg.fillRect(sx - 0.5, yy - 0.5, 1.1, 1.1);
      }
    }
    wg.fillStyle = "#ffcf7a";
    for (let sx = bridgeA - 36; sx < bridgeB + 36; sx += 6) wg.fillRect(sx, deck + 0.6, 1, 0.9);
  } else if (spec.kind === 1) {
    let x = 0;
    while (x < TILE_W) {
      let w = Math.round(22 + rand() * 44);
      if (TILE_W - (x + w) < 18) w = TILE_W - x;
      const top = baseLine - (0.12 + Math.pow(rand(), 1.3) * 0.44) * H;
      const colour = shade(tone, 0.82 + rand() * 0.34);
      const tiers = rand() < 0.25 ? 2 : 1;
      const tierH = (baseLine - top) * 0.18;
      const warm = rand() < 0.6;
      for (let t = 0; t < tiers; t++) {
        const tw = w * (1 - t * 0.3);
        const tx = x + (w - tw) / 2;
        const ty = top + tierH * (tiers - 1 - t);
        block(g, tx, ty, tw, h, colour);
        g.fillStyle = css(shade(colour, 0.7));
        g.fillRect(tx - 0.6, ty + 1.5, tw + 1.2, 1.2);
        g.fillStyle = css(shade(colour, 0.78));
        const lower = t === 0 ? baseLine : top + tierH * (tiers - t);
        windowGrid(g, wg, rand, tx + 1.5, ty + 4, tw - 3, lower, 4, 5, 2, 2.6, 0.5, warm);
      }
      const topW = w * (1 - (tiers - 1) * 0.3);
      const cx = x + w / 2;
      const roll = rand();
      if (roll < 0.25) waterTank(g, cx + (rand() - 0.5) * topW * 0.4, top, 0.8, [92, 70, 52]);
      else if (roll < 0.6) {
        g.fillStyle = css(shade(colour, 0.9));
        g.fillRect(cx - topW * 0.32, top - 4, topW * 0.3, 4);
      } else if (roll < 0.72) {
        g.fillStyle = css(colour);
        g.fillRect(cx, top - 14, 0.7, 14);
      }
      x += w + (rand() < 0.3 ? Math.round(1 + rand() * 4) : 0);
    }
  } else if (spec.kind === 2) {
    let x = 0;
    while (x < TILE_W) {
      let w = Math.round(18 + rand() * 14);
      if (TILE_W - (x + w) < 14) w = TILE_W - x;
      const top = baseLine - (0.12 + rand() * 0.14) * H;
      const colour = mix(shade(tone, 0.8 + rand() * 0.4), [96, 60, 44], rand() * 0.4);
      block(g, x, top, w, h, colour);
      g.fillStyle = css(shade(colour, 0.6));
      g.fillRect(x - 0.6, top, w + 1.2, 2);
      g.fillStyle = css(shade(colour, 1.5));
      g.fillRect(x - 0.6, top, w + 1.2, 0.6);
      g.fillStyle = css(shade(colour, 0.45));
      windowGrid(
        g,
        wg,
        rand,
        x + 2,
        top + 5,
        w - 4,
        baseLine,
        w / 3 > 7 ? w / 3 : 7,
        9,
        3.2,
        5,
        0.5,
        true,
      );
      const roll = rand();
      if (roll < 0.22) waterTank(g, x + w * (0.3 + rand() * 0.4), top, 1, [110, 78, 54]);
      else if (roll < 0.45) {
        g.fillStyle = css(shade(colour, 0.75));
        g.fillRect(x + w * (0.15 + rand() * 0.6), top - 4, 2.5, 4);
      }
      x += w;
    }
  } else {
    let x = 0;
    while (x < TILE_W) {
      let w = Math.round(40 + rand() * 36);
      if (TILE_W - (x + w) < 30) w = TILE_W - x;
      const top = baseLine - (0.24 + rand() * 0.2) * H;
      const colour = mix(
        shade(tone, 0.8 + rand() * 0.4),
        rand() < 0.5 ? [90, 44, 34] : [80, 66, 50],
        rand() * 0.5,
      );
      block(g, x, top, w, h, colour);
      g.fillStyle = css(shade(colour, 0.55));
      g.fillRect(x - 0.8, top, w + 1.6, 3.2);
      g.fillStyle = css(shade(colour, 1.5));
      g.fillRect(x - 0.8, top, w + 1.6, 0.7);
      g.fillStyle = css(shade(colour, 0.7));
      for (let dx = x + 1; dx < x + w - 1; dx += 2.4) g.fillRect(dx, top + 3.2, 1.1, 1);
      const storey = 10.5;
      g.fillStyle = css(shade(colour, 0.4));
      windowGrid(g, wg, rand, x + 3, top + 7, w - 6, baseLine, 8, storey, 4, 6.5, 0.45, true);
      if (rand() < 0.65) {
        const fx0 = x + w * 0.22;
        const fx1 = x + w * 0.72;
        g.fillStyle = "rgb(22,20,22)";
        g.strokeStyle = "rgb(22,20,22)";
        g.lineWidth = 0.7;
        g.beginPath();
        let flip = false;
        for (let py = top + 7 + storey * 1.05; py < baseLine - storey * 0.5; py += storey) {
          g.fillRect(fx0, py, fx1 - fx0, 0.9);
          g.fillRect(fx0, py - 3.4, fx1 - fx0, 0.45);
          for (let px = fx0; px <= fx1; px += 3) g.fillRect(px, py - 3.4, 0.4, 3.4);
          g.moveTo(flip ? fx1 - 2 : fx0 + 2, py);
          g.lineTo(flip ? fx0 + 4 : fx1 - 4, py + storey);
          flip = !flip;
        }
        g.stroke();
      }
      if (rand() < 0.3) waterTank(g, x + w * (0.25 + rand() * 0.5), top, 1.4, [104, 72, 50]);
      x += w;
    }
  }
  return {
    spec,
    base: base.c,
    tinted: tinted.c,
    windows: lit.c,
    h,
    baseLine,
    bottom: "#000",
  };
}

function bakeClouds(ratio: number, H: number, puff: HTMLCanvasElement) {
  const h = Math.ceil(H * 0.5);
  const base = canvas2d(TILE_W, h, ratio);
  const tinted = canvas2d(TILE_W, h, ratio);
  const rand = rng(4242);
  for (let i = 0; i < 9; i++) {
    const cx = rand() * TILE_W;
    const cy = h * (0.15 + rand() * 0.7);
    const len = 50 + rand() * 150;
    for (let k = 0; k < 12; k++) {
      const px = cx + (rand() - 0.5) * len;
      const r = 6 + rand() * 14;
      base.g.globalAlpha = 0.22 + rand() * 0.2;
      for (const shift of [0, -TILE_W, TILE_W]) {
        base.g.drawImage(
          puff,
          px - r * 2 + shift,
          cy - r * 0.45 + (rand() - 0.5) * 6,
          r * 4,
          r * 0.9,
        );
      }
    }
  }
  base.g.globalAlpha = 1;
  return { base: base.c, tinted: tinted.c, h };
}

function bakePatterns(s: number, ratio: number): PatternSources {
  const k = s * ratio;
  const fw = 120;
  const fh = 78;
  const facade = canvas2d(fw * k, fh * k, 1);
  const lit = canvas2d(fw * k, fh * k, 1);
  const fg = facade.g;
  const lg = lit.g;
  fg.scale(k, k);
  lg.scale(k, k);
  const brick = WORLD.brick;
  fg.fillStyle = css(brick);
  fg.fillRect(0, 0, fw, fh);
  fg.fillStyle = css(shade(brick, 0.82));
  for (let y = 1.6; y < fh; y += 2.2) fg.fillRect(0, y, fw, 0.35);
  const rand = rng(77);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const wx = col * 30 + 9;
      const wy = row * 26 + 6;
      fg.fillStyle = css(shade(brick, 1.25));
      fg.fillRect(wx - 1, wy - 1.6, 14, 1.6);
      fg.fillRect(wx - 0.6, wy + 14, 13.2, 1.1);
      fg.fillStyle = css(WORLD.window);
      fg.fillRect(wx, wy, 12, 14);
      fg.fillStyle = css(shade(WORLD.window, 1.6));
      fg.fillRect(wx + 5.6, wy, 0.8, 14);
      fg.fillRect(wx, wy + 6.6, 12, 0.8);
      if (rand() < 0.3) {
        fg.fillStyle = css([150, 140, 120]);
        fg.fillRect(wx + 0.6, wy + 0.6, 10.8, 4 + rand() * 6);
      }
      if (rand() < 0.42) {
        lg.fillStyle = LIT_COLOURS[Math.floor(rand() * 4)] ?? "#ffd38a";
        lg.fillRect(wx, wy, 12, 14);
        lg.fillStyle = "rgba(60,30,10,0.35)";
        lg.fillRect(wx + 5.6, wy, 0.8, 14);
        lg.fillRect(wx, wy + 6.6, 12, 0.8);
      }
    }
  }
  const sw = 48;
  const sh = 24;
  const sewer = canvas2d(sw * k, sh * k, 1);
  const sg = sewer.g;
  sg.scale(k, k);
  sg.fillStyle = "rgb(30,30,26)";
  sg.fillRect(0, 0, sw, sh);
  const srand = rng(91);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 6 : 0;
    for (let col = -1; col < 4; col++) {
      const v = 0.8 + srand() * 0.4;
      sg.fillStyle = css(shade([78, 62, 48], v));
      sg.fillRect(col * 12 + off + 0.5, row * 6 + 0.5, 11, 5);
      if (srand() < 0.18) {
        sg.fillStyle = "rgba(70,110,50,0.45)";
        sg.fillRect(col * 12 + off + 0.5, row * 6 + 3.5, 11, 2);
      }
    }
  }
  return { facade: facade.c, lit: lit.c, sewer: sewer.c };
}

function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.42);
  ctx.bezierCurveTo(cx - s * 1.05, cy - s * 0.2, cx - s * 0.5, cy - s * 0.95, cx, cy - s * 0.38);
  ctx.bezierCurveTo(cx + s * 0.5, cy - s * 0.95, cx + s * 1.05, cy - s * 0.2, cx, cy + s * 0.42);
  ctx.closePath();
}

function hudMetrics(width: number, height: number) {
  const hud = Math.round(clamp(height * 0.16, 24, 36));
  return { hud, pill: hud - 8, pad: Math.max(6, Math.round(width * 0.012)) };
}

export function muteRect(width: number, height: number): Rect {
  const { hud, pill, pad } = hudMetrics(width, height);
  return { x: width - pad - pill, y: (hud - pill) / 2, w: pill, h: pill };
}

function overLayout(width: number, height: number) {
  const wide = width >= 460;
  const w = Math.min(width - 16, wide ? 480 : 320);
  const h = Math.min(height - 12, wide ? 120 : 158);
  const card = { x: (width - w) / 2, y: (height - h) / 2, w, h };
  const bh = clamp(h * 0.24, 24, 32);
  const bw = clamp(w * 0.28, 96, 132);
  const button = wide
    ? { x: card.x + w - bw - 14, y: card.y + h - bh - 14, w: bw, h: bh }
    : { x: card.x + (w - bw) / 2, y: card.y + h - bh - 10, w: bw, h: bh };
  return { card, button, wide };
}

export function restartButtonRect(width: number, height: number): Rect {
  return overLayout(width, height).button;
}

export function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

const IK = { x: 0, y: 0 };

/** Two-bone joint position; bend 1 puts the joint toward +x of the hip-to-end line, -1 the other way. */
function joint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  l1: number,
  l2: number,
  bend: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.max(0.001, Math.min(Math.hypot(dx, dy), l1 + l2 - 0.001));
  const a = Math.atan2(dy, dx);
  const off = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const ang = a - bend * off;
  IK.x = ax + Math.cos(ang) * l1;
  IK.y = ay + Math.sin(ang) * l1;
}

function limb(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  width: number,
  colour: string,
  ink: string,
) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.lineWidth = width + 0.9;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function drawBoard(ctx: CanvasRenderingContext2D, p: Palette) {
  ctx.fillStyle = p.c.steelDark;
  ctx.fillRect(-5.2, -2.4, 1.7, 1);
  ctx.fillRect(3.5, -2.4, 1.7, 1);
  ctx.fillStyle = p.c.wheel;
  ctx.beginPath();
  ctx.arc(-4.4, -0.95, 0.95, 0, TAU);
  ctx.moveTo(5.35, -0.95);
  ctx.arc(4.4, -0.95, 0.95, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-7.4, -3.7);
  ctx.quadraticCurveTo(-6.6, -2.4, -5.2, -2.4);
  ctx.lineTo(5.2, -2.4);
  ctx.quadraticCurveTo(6.6, -2.4, 7.4, -3.7);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = p.ink;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = p.c.board;
  ctx.stroke();
}

function drawPistol(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  x: number,
  y: number,
  angle: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = p.c.gun;
  ctx.fillRect(-0.4, -0.75, 3, 1.15);
  ctx.fillRect(-0.3, -0.1, 0.95, 1.5);
  ctx.restore();
}

function muzzleFlash(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  angle: number,
  k: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = k;
  ctx.drawImage(sprite, x - 7, y - 7, 14, 14);
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#fff6d0";
  ctx.beginPath();
  ctx.moveTo(0, -1.3);
  ctx.lineTo(4.5 * k + 1.5, 0);
  ctx.lineTo(0, 1.3);
  ctx.lineTo(1, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRider(ctx: CanvasRenderingContext2D, p: Palette, sprites: Sprites, r: Rider, fx: Fx) {
  const speed = clamp(r.vx / 320, 0, 1);
  let c = 0.16 + speed * 0.12 + fx.landPulse * 0.5;
  if (!r.grounded) c = r.tucked ? 1 : Math.max(c, 0.32);
  c = clamp(c, 0, 1);
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(r.angle);
  if (r.invuln > 0 && Math.floor(r.invuln / 90) % 2 === 0) ctx.globalAlpha = 0.35;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  drawBoard(ctx, p);

  const footY = -3;
  const backFoot = -3.7;
  const frontFoot = 3.5;
  const hipX = -0.5 + c * 0.6;
  const hipY = footY - (8.7 - c * 4.2);
  const lean = 0.1 + speed * 0.14 + c * 0.5;
  const shX = hipX + Math.sin(lean) * 6.6;
  const shY = hipY - Math.cos(lean) * 6.6;
  const hx = shX + Math.sin(lean * 0.5) * 2.9 + 0.2;
  const hy = shY - Math.cos(lean * 0.5) * 2.9;
  const slashing = r.slashAge < 220;
  const shooting = r.shotAge < 400;
  const tuck = c > 0.85;
  const ink = p.ink;

  joint(hipX, hipY, backFoot, footY, 4.7, 4.7, 1);
  limb(ctx, hipX, hipY, IK.x, IK.y, backFoot, footY - 0.5, 2.3, p.c.jeans, ink);
  ctx.fillStyle = p.c.shoe;
  ctx.fillRect(backFoot - 1.3, footY - 1.1, 2.8, 1.2);

  if (!slashing) {
    const bx = tuck ? frontFoot * 0.2 : shX - 4.4;
    const by = tuck ? footY - 2.8 : shY + 4.4;
    joint(shX, shY, bx, by, 3.5, 3.4, -1);
    limb(ctx, shX, shY, IK.x, IK.y, bx, by, 1.8, p.hoodieDark, ink);
    dot(ctx, bx, by, 0.8, p.c.skin);
  }

  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(shX, shY);
  ctx.lineWidth = 4.7;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = 3.8;
  ctx.strokeStyle = p.hoodie;
  ctx.stroke();
  dot(ctx, shX - 1.4, shY - 0.4, 1.5, p.hoodieDark);
  ctx.beginPath();
  ctx.moveTo(hipX + Math.cos(lean) * 1.5, hipY + Math.sin(lean) * 1.5);
  ctx.lineTo(shX + Math.cos(lean) * 1.5, shY + Math.sin(lean) * 1.5);
  ctx.lineWidth = 0.55;
  ctx.strokeStyle = p.rim;
  ctx.stroke();

  dot(ctx, hx, hy, 2.6, ink);
  dot(ctx, hx, hy, 2.15, p.c.skin);
  ctx.fillStyle = p.c.beanie;
  ctx.beginPath();
  ctx.arc(hx, hy - 0.1, 2.35, Math.PI + 0.15, -0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p.hoodie;
  ctx.fillRect(hx - 2.3, hy - 0.7, 4.5, 0.75);
  dot(ctx, hx - 1.3, hy - 2.5, 0.8, p.c.beanie);
  dot(ctx, hx + 1.1, hy + 0.1, 0.32, ink);
  ctx.beginPath();
  ctx.arc(hx, hy, 2.15, -1.2, 0.5);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = p.rim;
  ctx.stroke();

  joint(hipX, hipY, frontFoot, footY, 4.7, 4.7, 1);
  limb(ctx, hipX, hipY, IK.x, IK.y, frontFoot, footY - 0.5, 2.3, p.c.jeans, ink);
  ctx.fillStyle = p.c.shoe;
  ctx.fillRect(frontFoot - 1.3, footY - 1.1, 2.8, 1.2);

  if (shooting) {
    const la = r.shotAim - r.angle;
    const hx2 = shX + Math.cos(la) * 6.4;
    const hy2 = shY + Math.sin(la) * 6.4;
    limb(ctx, shX, shY, (shX + hx2) / 2, (shY + hy2) / 2, hx2, hy2, 1.8, p.hoodie, ink);
    drawPistol(ctx, p, hx2, hy2, la);
    dot(ctx, hx2, hy2, 0.8, p.c.skin);
    if (r.shotAge < 80) {
      muzzleFlash(
        ctx,
        sprites.muzzle,
        hx2 + Math.cos(la) * 3,
        hy2 + Math.sin(la) * 3,
        la,
        1 - r.shotAge / 80,
      );
    }
  } else {
    const fhx = tuck ? frontFoot * 0.75 : shX + 4.3;
    const fhy = tuck ? footY - 2.4 : shY + 4.6;
    joint(shX, shY, fhx, fhy, 3.5, 3.4, -1);
    limb(ctx, shX, shY, IK.x, IK.y, fhx, fhy, 1.8, p.hoodie, ink);
    dot(ctx, fhx, fhy, 0.8, p.c.skin);
  }

  if (slashing) {
    const t = r.slashAge / 220;
    const e = 1 - (1 - t) * (1 - t);
    const a0 = -1.9;
    const a = a0 + (0.95 - a0) * e;
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha *= 0.55 * (1 - t);
    ctx.beginPath();
    ctx.arc(shX, shY, 11, a0 + (a - a0) * 0.25, a);
    ctx.arc(shX, shY, 7, a, a0 + (a - a0) * 0.25, true);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = r.invuln > 0 && Math.floor(r.invuln / 90) % 2 === 0 ? 0.35 : 1;
    const kx = shX + Math.cos(a) * 6.3;
    const ky = shY + Math.sin(a) * 6.3;
    limb(ctx, shX, shY, (shX + kx) / 2, (shY + ky) / 2, kx, ky, 1.8, p.hoodieDark, ink);
    ctx.beginPath();
    ctx.moveTo(kx, ky);
    ctx.lineTo(kx + Math.cos(a) * 3.6, ky + Math.sin(a) * 3.6);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = p.c.blade;
    ctx.stroke();
    dot(ctx, kx, ky, 0.8, p.c.skin);
  }
  ctx.restore();
}

function drawRagdoll(ctx: CanvasRenderingContext2D, p: Palette, body: Tumbler, board: Tumbler) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (board.active) {
    ctx.save();
    ctx.translate(board.x, board.y);
    ctx.rotate(board.rot);
    drawBoard(ctx, p);
    ctx.restore();
  }
  if (!body.active) return;
  ctx.save();
  ctx.translate(body.x, body.y - 2.2);
  ctx.rotate(body.rot);
  const ink = p.ink;
  limb(ctx, 0, 0, 2.2, 4.4, 1.2, 8.8, 2.3, p.c.jeans, ink);
  limb(ctx, 0, 0, -1.2, 4.6, -0.4, 9, 2.3, p.c.jeans, ink);
  limb(ctx, 0, -6, 3, -4, 5, -1.5, 1.8, p.hoodieDark, ink);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -6.4);
  ctx.lineWidth = 4.7;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = 3.8;
  ctx.strokeStyle = p.hoodie;
  ctx.stroke();
  limb(ctx, 0, -6, -3.4, -4.6, -5.6, -2, 1.8, p.hoodie, ink);
  dot(ctx, 0.4, -9.3, 2.6, ink);
  dot(ctx, 0.4, -9.3, 2.15, p.c.skin);
  ctx.fillStyle = p.c.beanie;
  ctx.beginPath();
  ctx.arc(0.4, -9.4, 2.35, Math.PI + 0.15, -0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTaxi(ctx: CanvasRenderingContext2D, p: Palette, o: Obstacle) {
  const { x, y, w, h } = o;
  const front = seedHash(o.seed, 1) < 0.5 ? 1 : -1;
  const wr = Math.min(h * 0.2, w * 0.075);
  const bodyTop = y - h * 0.55;
  const sill = y - wr * 0.7;
  const roof = y - h;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y, w * 0.52, 1.3, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = p.c.taxi;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, bodyTop);
  ctx.lineTo(x + w * 0.31, roof);
  ctx.lineTo(x + w * 0.71, roof);
  ctx.lineTo(x + w * 0.84, bodyTop);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, bodyTop, w, sill - bodyTop, Math.min(2, h * 0.12));
  ctx.fill();
  ctx.fillStyle = p.c.glass;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.24, bodyTop - 0.5);
  ctx.lineTo(x + w * 0.325, roof + 1.1);
  ctx.lineTo(x + w * 0.695, roof + 1.1);
  ctx.lineTo(x + w * 0.79, bodyTop - 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = p.c.glassHi;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.36, bodyTop - 0.8);
  ctx.lineTo(x + w * 0.42, roof + 1.4);
  ctx.moveTo(x + w * 0.58, bodyTop - 0.8);
  ctx.lineTo(x + w * 0.63, roof + 1.4);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.c.taxi;
  ctx.fillRect(x + w * 0.5 - 0.6, roof + 1, 1.2, bodyTop - roof - 1.2);
  ctx.fillStyle = p.c.taxiDark;
  ctx.fillRect(x + 0.5, sill - 1.5, w - 1, 1.5);
  ctx.fillRect(x + w * 0.04, bodyTop + (sill - bodyTop) * 0.38, w * 0.92, 0.6);
  ctx.fillRect(x + w * 0.5 - 0.2, bodyTop + 0.4, 0.4, sill - bodyTop - 1.8);
  ctx.fillRect(x + w * 0.27, bodyTop + 0.4, 0.4, sill - bodyTop - 1.8);
  ctx.fillStyle = p.c.white;
  ctx.fillRect(x + w * 0.45, roof - 2.1, w * 0.1, 2.1);
  ctx.fillStyle = p.c.chrome;
  ctx.fillRect(x - 0.7, sill - 2.4, 1.8, 1.8);
  ctx.fillRect(x + w - 1.1, sill - 2.4, 1.8, 1.8);
  const fxp = front > 0 ? x + w - 1.3 : x;
  const bxp = front > 0 ? x : x + w - 1.3;
  ctx.fillStyle = "#fff4c4";
  ctx.fillRect(fxp, bodyTop + 1, 1.3, 1.5);
  ctx.fillStyle = "#d42828";
  ctx.fillRect(bxp, bodyTop + 1, 1.3, 1.5);
  for (const wx of [x + w * 0.2, x + w * 0.8]) {
    dot(ctx, wx, y - wr, wr + 0.7, p.c.tire);
    dot(ctx, wx, y - wr, wr, p.c.tire);
    dot(ctx, wx, y - wr, wr * 0.45, p.c.chrome);
  }
}

function drawBarrier(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.strokeStyle = p.c.steelDark;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x + 1, y);
  ctx.lineTo(x + 2.5, y - h * 0.9);
  ctx.lineTo(x + 4, y);
  ctx.moveTo(x + w - 4, y);
  ctx.lineTo(x + w - 2.5, y - h * 0.9);
  ctx.lineTo(x + w - 1, y);
  ctx.stroke();
  const by = y - h * 0.86;
  const bh = h * 0.32;
  ctx.fillStyle = p.c.white;
  ctx.fillRect(x, by, w, bh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, by, w, bh);
  ctx.clip();
  ctx.fillStyle = p.c.red;
  ctx.beginPath();
  for (let sx = x - bh; sx < x + w; sx += 4) {
    ctx.moveTo(sx, by + bh);
    ctx.lineTo(sx + bh, by);
    ctx.lineTo(sx + bh + 2, by);
    ctx.lineTo(sx + 2, by + bh);
  }
  ctx.fill();
  ctx.restore();
  dot(ctx, x + w / 2, by - 1.2, 1.1, "#f0a020");
}

function drawCone(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = p.c.cone;
  ctx.fillRect(x, y - 1, w, 1);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.12, y - 1);
  ctx.lineTo(x + w * 0.38, y - h);
  ctx.lineTo(x + w * 0.62, y - h);
  ctx.lineTo(x + w * 0.88, y - 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p.c.white;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.25, y - h * 0.38);
  ctx.lineTo(x + w * 0.31, y - h * 0.58);
  ctx.lineTo(x + w * 0.69, y - h * 0.58);
  ctx.lineTo(x + w * 0.75, y - h * 0.38);
  ctx.closePath();
  ctx.fill();
}

function drawTrash(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
) {
  const a = 0.85 + seedHash(seed, 3) * 0.3;
  ctx.fillStyle = p.c.bag;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.3, y - h * 0.4, w * 0.3 * a, h * 0.42, 0, 0, TAU);
  ctx.moveTo(x + w, y - h * 0.36);
  ctx.ellipse(x + w * 0.68, y - h * 0.36, w * 0.32, h * 0.38 * a, 0, 0, TAU);
  ctx.moveTo(x + w * 0.74, y - h * 0.68);
  ctx.ellipse(x + w * 0.5, y - h * 0.68, w * 0.24, h * 0.3, 0.3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = p.c.bagHi;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(x + w * 0.26, y - h * 0.5, w * 0.16, -2.4, -1.2);
  ctx.moveTo(x + w * 0.62, y - h * 0.6);
  ctx.arc(x + w * 0.66, y - h * 0.44, w * 0.16, -2.2, -1);
  ctx.stroke();
}

function drawHydrant(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = p.c.hydrant;
  ctx.fillRect(x + w * 0.05, y - 1.2, w * 0.9, 1.2);
  ctx.fillRect(x + w * 0.22, y - h * 0.82, w * 0.56, h * 0.82);
  ctx.beginPath();
  ctx.arc(x + w / 2, y - h * 0.82, w * 0.28, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x, y - h * 0.6, w, h * 0.16);
  ctx.fillStyle = p.c.hydrantCap;
  ctx.fillRect(x + w * 0.4, y - h - 0.6, w * 0.2, 1.2);
  ctx.fillRect(x + w * 0.18, y - h * 0.78, w * 0.64, 0.8);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(x + w * 0.6, y - h * 0.8, w * 0.1, h * 0.7);
}

function drawObstacleShape(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  kind: ObstacleKind,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
) {
  switch (kind) {
    case "barrier":
      drawBarrier(ctx, p, x, y, w, h);
      break;
    case "cone":
      drawCone(ctx, p, x, y, w, h);
      break;
    case "trash":
      drawTrash(ctx, p, x, y, w, h, seed);
      break;
    case "hydrant":
      drawHydrant(ctx, p, x, y, w, h);
      break;
    default:
      break;
  }
}

function enemySkin(p: Palette, seed: number): string {
  const v = seedHash(seed, 5);
  return v < 0.4 ? p.c.skin : v < 0.75 ? p.c.skinB : p.c.skinC;
}

function drawThug(ctx: CanvasRenderingContext2D, p: Palette, sprites: Sprites, e: Enemy) {
  const v = seedHash(e.seed, 2);
  const hoodie = v < 0.33 ? p.c.thugA : v < 0.66 ? p.c.thugB : p.c.thugC;
  const running = e.state === "charge";
  const phase = e.x * 0.32;
  const swing = running ? Math.sin(phase) * 0.8 : 0;
  const lean = running ? 0.32 : e.state === "attack" ? 0.22 : 0.05;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(e.facing, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const ink = p.ink;
  const hipX = 0;
  const hipY = -9.4;
  const f1x = Math.sin(swing) * 5;
  const f2x = -f1x;
  const lift1 = running ? Math.max(0, Math.cos(phase)) * 1.6 : 0;
  const lift2 = running ? Math.max(0, -Math.cos(phase)) * 1.6 : 0;
  joint(hipX, hipY, f2x, -lift2, 4.9, 4.9, 1);
  limb(ctx, hipX, hipY, IK.x, IK.y, f2x, -lift2, 2.3, p.c.pants, ink);
  const shX = hipX + Math.sin(lean) * 6.8;
  const shY = hipY - Math.cos(lean) * 6.8;
  const bx = shX - Math.sin(swing) * 4;
  const by = shY + 5.2;
  joint(shX, shY, bx, by, 3.5, 3.4, -1);
  limb(ctx, shX, shY, IK.x, IK.y, bx, by, 1.8, hoodie, ink);
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(shX, shY);
  ctx.lineWidth = 4.8;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = 3.9;
  ctx.strokeStyle = hoodie;
  ctx.stroke();
  const hx = shX + Math.sin(lean * 0.5) * 2.9 + 0.3;
  const hy = shY - Math.cos(lean * 0.5) * 2.9;
  dot(ctx, hx, hy, 2.7, ink);
  dot(ctx, hx, hy, 2.2, enemySkin(p, e.seed));
  ctx.fillStyle = hoodie;
  ctx.beginPath();
  ctx.arc(hx - 0.3, hy - 0.1, 2.7, Math.PI * 0.55, Math.PI * 2.05);
  ctx.lineTo(hx + 1.2, hy - 1);
  ctx.closePath();
  ctx.fill();
  dot(ctx, hx + 1.2, hy + 0.2, 0.32, ink);
  joint(hipX, hipY, f1x, -lift1, 4.9, 4.9, 1);
  limb(ctx, hipX, hipY, IK.x, IK.y, f1x, -lift1, 2.3, p.c.pants, ink);
  const thrust = e.state === "attack" ? clamp(e.stateAge / 120, 0, 1) : 0;
  const fhx = shX + 3.6 + thrust * 2.6;
  const fhy = shY + 3.4 - thrust * 1.4;
  joint(shX, shY, fhx, fhy, 3.5, 3.4, -1);
  limb(ctx, shX, shY, IK.x, IK.y, fhx, fhy, 1.8, hoodie, ink);
  ctx.beginPath();
  ctx.moveTo(fhx, fhy);
  ctx.lineTo(fhx + 3.2, fhy - 1.4);
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = p.c.blade;
  ctx.stroke();
  dot(ctx, fhx, fhy, 0.8, enemySkin(p, e.seed));
  if ((e.stateAge + seedHash(e.seed, 9) * 900) % 900 < 120) {
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(sprites.cool, fhx + 3.2 - 2.5, fhy - 1.4 - 2.5, 5, 5);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

function gunmanShoulder(e: Enemy) {
  return { x: e.x + e.facing * 0.6, y: e.y - 15.8 };
}

function drawGunman(ctx: CanvasRenderingContext2D, p: Palette, sprites: Sprites, e: Enemy) {
  const coat = seedHash(e.seed, 2) < 0.5 ? p.c.coat : p.c.coatB;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(e.facing, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const ink = p.ink;
  limb(ctx, 0, -9.2, -1, -4.6, -2, 0, 2.2, p.c.pants, ink);
  limb(ctx, 0, -9.2, 1.4, -4.6, 2, 0, 2.2, p.c.pants, ink);
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-2.7, -10.6);
  ctx.lineTo(2.7, -10.6);
  ctx.lineTo(3.4, -3.8);
  ctx.lineTo(-3.2, -3.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-2.2, -10.6);
  ctx.lineTo(2.2, -10.6);
  ctx.lineTo(2.9, -4.3);
  ctx.lineTo(-2.7, -4.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -9.2);
  ctx.lineTo(0.6, -15.8);
  ctx.lineWidth = 5;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = 4.1;
  ctx.strokeStyle = coat;
  ctx.stroke();
  const hx = 1;
  const hy = -18.7;
  dot(ctx, hx, hy, 2.6, ink);
  dot(ctx, hx, hy, 2.15, enemySkin(p, e.seed));
  ctx.fillStyle = p.c.gun;
  ctx.beginPath();
  ctx.arc(hx, hy - 0.4, 2.3, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(hx - 0.4, hy - 0.9, 3.4, 0.7);
  dot(ctx, hx + 1.2, hy + 0.2, 0.32, ink);
  const aiming = e.state === "aim" || e.state === "attack";
  const la = aiming ? Math.atan2(Math.sin(e.aim), Math.cos(e.aim) * e.facing) : 1.25;
  const handX = 0.6 + Math.cos(la) * 6.2;
  const handY = -15.8 + Math.sin(la) * 6.2;
  limb(ctx, 0.6, -15.8, (0.6 + handX) / 2, (-15.8 + handY) / 2, handX, handY, 1.9, coat, ink);
  drawPistol(ctx, p, handX, handY, la);
  dot(ctx, handX, handY, 0.8, enemySkin(p, e.seed));
  if (e.state === "attack" && e.stateAge < 80) {
    muzzleFlash(
      ctx,
      sprites.muzzle,
      handX + Math.cos(la) * 3,
      handY + Math.sin(la) * 3,
      la,
      1 - e.stateAge / 80,
    );
  }
  ctx.restore();
}

function drawRat(ctx: CanvasRenderingContext2D, p: Palette, e: Enemy) {
  const phase = e.x * 0.9;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(e.facing, 1);
  ctx.strokeStyle = p.c.ratPink;
  ctx.lineWidth = 0.55;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-3.4, -1.6);
  ctx.quadraticCurveTo(-6.5, 0.4, -9, -1.2 + Math.sin(phase) * 1.1);
  ctx.stroke();
  ctx.strokeStyle = p.c.rat;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const lx = -2.2 + i * 1.5;
    const s = Math.sin(phase + i * 1.6) * 0.8;
    ctx.moveTo(lx, -1);
    ctx.lineTo(lx + s, 0);
  }
  ctx.stroke();
  ctx.fillStyle = p.c.rat;
  ctx.beginPath();
  ctx.ellipse(0, -2, 3.8, 1.9, 0, 0, TAU);
  ctx.moveTo(5.4, -2.1);
  ctx.ellipse(3.8, -2.2, 1.9, 1.25, 0.15, 0, TAU);
  ctx.fill();
  dot(ctx, 2.8, -3.3, 0.8, p.c.ratPink);
  dot(ctx, 5.5, -2, 0.35, p.c.ratPink);
  dot(ctx, 4.2, -2.6, 0.3, "#ff3030");
  ctx.restore();
}

function drawCorpse(ctx: CanvasRenderingContext2D, p: Palette, d: Decal) {
  const k = d.grow > 0 ? clamp(d.age / d.grow, 0, 1) : 1;
  const e = k * k;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const ink = p.ink;
  if (d.enemy === "rat") {
    ctx.translate(d.x, d.y);
    ctx.fillStyle = p.c.rat;
    ctx.beginPath();
    ctx.ellipse(0, -1.5, 3.6, 1.6, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = p.c.rat;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(-2 + i * 1.4, -2.8);
      ctx.lineTo(-2.3 + i * 1.4, -4.2 * e - 2.8 * (1 - e));
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.translate(d.x, d.y - 1.6 * e);
  ctx.rotate(d.facing * e * (Math.PI / 2));
  const top =
    d.enemy === "gunman"
      ? d.seed < 0.5
        ? p.c.coat
        : p.c.coatB
      : d.seed < 0.5
        ? p.c.thugA
        : p.c.thugC;
  limb(ctx, 0, -9.3, 1.2, -4.8, 0.6, 0, 2.3, p.c.pants, ink);
  limb(ctx, 0, -9.3, -1.6, -4.4, -1.2, 0, 2.3, p.c.pants, ink);
  ctx.beginPath();
  ctx.moveTo(0, -9.3);
  ctx.lineTo(0, -16);
  ctx.lineWidth = 4.8;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = 3.9;
  ctx.strokeStyle = top;
  ctx.stroke();
  limb(ctx, 0, -15.5, -2.5, -13, -4.8, -11, 1.8, top, ink);
  dot(ctx, 0.3, -18.6, 2.6, ink);
  dot(ctx, 0.3, -18.6, 2.15, p.c.skinB);
  ctx.restore();
}

export function createRenderer() {
  let width = 0;
  let height = 0;
  let ratio = 1;
  let theme: MiniGameTheme | null = null;
  let accent: Rgb = [92, 140, 255];
  let font = "system-ui, sans-serif";
  let layers: Layer[] = [];
  let clouds: { base: HTMLCanvasElement; tinted: HTMLCanvasElement; h: number } | null = null;
  let sprites: Sprites | null = null;
  let stars: Path2D | null = null;
  let brightStars: Path2D | null = null;
  let patternSources: PatternSources | null = null;
  let patterns: Patterns | null = null;
  let skyBucket = -1;
  let skyGrad: CanvasGradient | null = null;
  let sunColour = "#fff";
  let tod: Tod = sampleSky(0);
  let paletteKey = -1;
  let pal: Palette | null = null;
  let vignette: CanvasGradient | null = null;
  let redVignette: CanvasGradient | null = null;
  const view = { s: 1, left: 0, right: 0, top: 0, bottom: 0 };

  const fontOf = (weight: number, size: number, italic = false) =>
    `${italic ? "italic " : ""}${weight} ${Math.max(1, Math.round(size))}px ${font}`;

  function bake() {
    if (typeof document === "undefined" || width <= 0 || height <= 0) return;
    const bakeRatio = Math.min(ratio, 2);
    sprites = buildSprites(bakeRatio);
    layers = LAYER_SPECS.map((spec) => bakeLayer(spec, height, bakeRatio));
    clouds = bakeClouds(bakeRatio, height, sprites.puff);
    patternSources = bakePatterns(height / VIEW_H, bakeRatio);
    patterns = null;
    const rand = rng(1337);
    stars = new Path2D();
    brightStars = new Path2D();
    const count = Math.round(width / 9);
    for (let i = 0; i < count; i++) {
      const x = rand() * width;
      const y = Math.pow(rand(), 1.4) * height * 0.62;
      if (rand() < 0.15) brightStars.rect(x, y, 1.4, 1.4);
      else stars.rect(x, y, 0.9, 0.9);
    }
    skyBucket = -1;
    paletteKey = -1;
    vignette = null;
    redVignette = null;
  }

  function retint() {
    const haze = mix(tod.low, tod.mid, 0.35 + tod.night * 0.25);
    const fog = mix(tod.low, tod.mid, 0.15 + tod.night * 0.4);
    const dark = (1 - lum(tod.ambient)) * 0.85;
    for (const layer of layers) {
      const g = layer.tinted.getContext("2d");
      if (!g) continue;
      const cw = layer.tinted.width;
      const ch = layer.tinted.height;
      const k = ch / layer.h;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "copy";
      g.drawImage(layer.base, 0, 0);
      g.globalCompositeOperation = "source-atop";
      if (dark > 0.01) {
        g.globalAlpha = dark;
        g.fillStyle = "rgb(8,8,22)";
        g.fillRect(0, 0, cw, ch);
      }
      g.globalAlpha = layer.spec.haze;
      g.fillStyle = css(haze);
      g.fillRect(0, 0, cw, ch);
      g.globalAlpha = 1;
      const y0 = (layer.baseLine - height * 0.3) * k;
      const grad = g.createLinearGradient(0, y0, 0, layer.baseLine * k);
      grad.addColorStop(0, css(fog, 0));
      grad.addColorStop(1, css(fog, layer.spec.fog));
      g.fillStyle = grad;
      g.fillRect(0, y0, cw, ch - y0);
      g.globalCompositeOperation = "source-over";
      const body = mix(
        mix(shade(layer.spec.tone, 1 - dark), haze, layer.spec.haze),
        fog,
        layer.spec.fog,
      );
      layer.bottom = css(body);
    }
    if (clouds) {
      const g = clouds.tinted.getContext("2d");
      if (g) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "copy";
        g.drawImage(clouds.base, 0, 0);
        g.globalCompositeOperation = "source-atop";
        g.globalAlpha = 0.7;
        g.fillStyle = css(mix(mix(tod.low, [255, 250, 245], 0.45), tod.mid, tod.night * 0.7));
        g.fillRect(0, 0, clouds.tinted.width, clouds.tinted.height);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }
    }
  }

  function ensureSky(ctx: CanvasRenderingContext2D, bucket: number) {
    if (bucket === skyBucket && skyGrad) return;
    skyBucket = bucket;
    tod = sampleSky((bucket + 0.5) / BUCKETS);
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, css(tod.top));
    g.addColorStop(0.5, css(tod.mid));
    g.addColorStop(0.78, css(tod.low));
    g.addColorStop(1, css(mix(tod.low, tod.mid, 0.3)));
    skyGrad = g;
    sunColour = css(mix(tod.low, [255, 250, 232], 0.55));
    retint();
    paletteKey = -1;
  }

  function unit(ctx: CanvasRenderingContext2D, stops: ReadonlyArray<readonly [number, string]>) {
    const g = ctx.createLinearGradient(0, 0, 0, 1);
    for (const [at, colour] of stops) g.addColorStop(at, colour);
    return g;
  }

  function ensurePalette(ctx: CanvasRenderingContext2D, depth: number) {
    const key = skyBucket * 16 + Math.round(depth * 8);
    if (key === paletteKey && pal) return pal;
    paletteKey = key;
    const amb = mix(tod.ambient, SEWER_LIGHT, Math.round(depth * 8) / 8);
    const c = {} as Record<ColourKey, string>;
    for (const name of Object.keys(WORLD) as Array<keyof typeof WORLD>)
      c[name] = css(light(WORLD[name], amb));
    for (const name of Object.keys(SEWER) as Array<keyof typeof SEWER>) c[name] = css(SEWER[name]);
    const rimRgb = mix(mix(tod.low, [255, 240, 210], 0.4), [150, 180, 255], tod.night);
    const shadeA = clamp(1 - lum(amb), 0, 0.85);
    const dark: Rgb = [8, 10, 26];
    pal = {
      c,
      hoodie: css(light(accent, mix(amb, [1, 1, 1], 0.35))),
      hoodieDark: css(shade(light(accent, mix(amb, [1, 1, 1], 0.35)), 0.72)),
      ink: "rgba(10,10,16,0.92)",
      rim: css(rimRgb, 0.75),
      lum: lum(amb),
      depthShade: unit(ctx, [
        [0, "rgba(0,0,0,0)"],
        [0.55, "rgba(0,0,0,0.2)"],
        [1, "rgba(0,0,0,0.65)"],
      ]),
      roofShade: unit(ctx, [
        [0, css(dark, shadeA * 0.6)],
        [1, css(dark, Math.min(0.95, shadeA + 0.45))],
      ]),
      sewerShade: unit(ctx, [
        [0, "rgba(0,0,0,0.35)"],
        [1, "rgba(0,0,0,0.85)"],
      ]),
      sewerWall: unit(ctx, [
        [0, "rgba(0,0,0,0.78)"],
        [0.35, "rgba(0,0,0,0.42)"],
        [0.85, "rgba(0,0,0,0.5)"],
        [1, "rgba(0,0,0,0.7)"],
      ]),
      alley: unit(ctx, [
        [0, css(light([30, 30, 40], amb))],
        [0.25, "rgb(10,10,16)"],
        [1, css(mix([10, 10, 16], [120, 72, 36], 0.45 + tod.night * 0.25))],
      ]),
      pit: unit(ctx, [
        [0, "rgb(26,24,26)"],
        [1, "rgb(4,4,6)"],
      ]),
      water: unit(ctx, [
        [0, css(SEWER.sewerWater)],
        [1, css(SEWER.sewerWaterDeep)],
      ]),
      vault: unit(ctx, [
        [0, "rgba(0,0,0,0.7)"],
        [1, "rgba(0,0,0,0)"],
      ]),
    };
    return pal;
  }

  function ensureStatic(ctx: CanvasRenderingContext2D) {
    if (!patterns && patternSources) {
      const facade = ctx.createPattern(patternSources.facade, "repeat");
      const lit = ctx.createPattern(patternSources.lit, "repeat");
      const sewer = ctx.createPattern(patternSources.sewer, "repeat");
      if (facade && lit && sewer) patterns = { facade, lit, sewer };
    }
    if (!vignette) {
      const v = ctx.createRadialGradient(0, 0, 0.2, 0, 0, 1);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(0.55, "rgba(0,0,0,0.25)");
      v.addColorStop(1, "rgba(0,0,0,0.92)");
      vignette = v;
      const r = ctx.createRadialGradient(0, 0, 0.3, 0, 0, 1);
      r.addColorStop(0, "rgba(200,0,0,0)");
      r.addColorStop(0.6, "rgba(200,10,10,0.25)");
      r.addColorStop(1, "rgba(160,0,0,0.85)");
      redVignette = r;
    }
  }

  function fillUnit(ctx: CanvasRenderingContext2D, g: CanvasGradient, y: number, h: number) {
    ctx.save();
    ctx.translate(0, y);
    ctx.scale(1, h);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function fillPattern(ctx: CanvasRenderingContext2D, pattern: CanvasPattern) {
    const k = 1 / (view.s * Math.min(ratio, 2));
    ctx.save();
    ctx.scale(k, k);
    ctx.fillStyle = pattern;
    ctx.fill();
    ctx.restore();
  }

  function screenFill(ctx: CanvasRenderingContext2D, g: CanvasGradient, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(width / 2, height / 2);
    ctx.scale(width * 0.72, height * 1.15);
    ctx.fillStyle = g;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }

  function drawSky(ctx: CanvasRenderingContext2D, phase: number, elev: number, camX: number) {
    if (!skyGrad || !sprites) return;
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);
    const night = tod.night;
    if (night > 0.02 && stars && brightStars) {
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = night * 0.55;
      ctx.fill(stars);
      ctx.globalAlpha = night * 0.9;
      ctx.fill(brightStars);
      const mr = Math.max(5, height * 0.042);
      const mx = width * 0.2;
      const my = height * 0.2;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = night * 0.35;
      ctx.drawImage(sprites.cool, mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = night;
      dot(ctx, mx, my, mr, "#f4f0e2");
      ctx.globalAlpha = night * 0.88;
      dot(ctx, mx + mr * 0.5, my - mr * 0.22, mr * 0.9, css(tod.top));
      ctx.globalAlpha = 1;
    }
    if (elev > -0.25) {
      const vis = clamp((elev + 0.25) / 0.3, 0, 1);
      const sx = width * (phase < 0.55 ? 0.74 : 0.26);
      const sy = height * (0.66 - elev * 1.2);
      const r = height * 0.065;
      ctx.globalAlpha = vis * 0.9;
      ctx.drawImage(sprites.sun, sx - r * 8, sy - r * 8, r * 16, r * 16);
      ctx.globalAlpha = vis;
      dot(ctx, sx, sy, r, sunColour);
      ctx.globalAlpha = 1;
    }
    if (clouds && tod.cloud > 0.01) {
      const scroll = camX * 0.03 * view.s;
      ctx.globalAlpha = tod.cloud;
      for (let x = Math.floor(scroll / TILE_W) * TILE_W - scroll; x < width; x += TILE_W) {
        ctx.drawImage(clouds.tinted, Math.round(x), height * 0.02, TILE_W, clouds.h);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawLayers(ctx: CanvasRenderingContext2D, camX: number, camY: number) {
    const s = view.s;
    for (const layer of layers) {
      const p = layer.spec.parallax;
      const top =
        Math.round(
          (height * layer.spec.base - layer.baseLine + (CAM_STREET - camY) * p * s) * ratio,
        ) / ratio;
      if (top >= height) continue;
      const scroll = camX * p * s;
      const first = Math.floor(scroll / TILE_W);
      const glow = tod.night * (1 - layer.spec.haze * 0.5);
      for (let pass = 0; pass < (glow > 0.02 ? 2 : 1); pass++) {
        const img = pass === 0 ? layer.tinted : layer.windows;
        ctx.globalAlpha = pass === 0 ? 1 : glow;
        let k = first;
        for (let x = k * TILE_W - scroll; x < width; x += TILE_W, k++) {
          const rx = Math.round(x * ratio) / ratio;
          if (k & 1) {
            ctx.save();
            ctx.translate(rx + TILE_W, top);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0, TILE_W, layer.h);
            ctx.restore();
          } else {
            ctx.drawImage(img, rx, top, TILE_W, layer.h);
          }
        }
      }
      ctx.globalAlpha = 1;
      const bottom = top + layer.h;
      if (bottom < height) {
        ctx.fillStyle = layer.bottom;
        ctx.fillRect(0, bottom - 1, width, height - bottom + 1);
      }
    }
  }

  function strip(
    ctx: CanvasRenderingContext2D,
    segs: ReadonlyArray<Segment>,
    i: number,
    j: number,
    top: number,
    bottom: number,
  ) {
    ctx.beginPath();
    for (let k = i; k < j; k++) {
      const s = segs[k];
      if (!s) continue;
      if (k === i) ctx.moveTo(s.x0, s.y0 + top);
      else ctx.lineTo(s.x0, s.y0 + top);
      ctx.lineTo(s.x1, s.y1 + top);
    }
    for (let k = j - 1; k >= i; k--) {
      const s = segs[k];
      if (!s) continue;
      ctx.lineTo(s.x1, bottom === Infinity ? view.bottom : s.y1 + bottom);
      ctx.lineTo(s.x0, bottom === Infinity ? view.bottom : s.y0 + bottom);
    }
    ctx.closePath();
  }

  function edge(
    ctx: CanvasRenderingContext2D,
    segs: ReadonlyArray<Segment>,
    i: number,
    j: number,
    off: number,
  ) {
    ctx.beginPath();
    for (let k = i; k < j; k++) {
      const s = segs[k];
      if (!s) continue;
      if (k === i) ctx.moveTo(s.x0, s.y0 + off);
      else ctx.lineTo(s.x0, s.y0 + off);
      ctx.lineTo(s.x1, s.y1 + off);
    }
  }

  function drawRun(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    segs: ReadonlyArray<Segment>,
    i: number,
    j: number,
    zone: Zone,
  ) {
    const first = segs[i];
    const last = segs[j - 1];
    if (!first || !last) return;
    const night = tod.night;
    if (zone === "street") {
      strip(ctx, segs, i, j, 2.4, Infinity);
      ctx.fillStyle = p.c.earth;
      ctx.fill();
      fillUnit(ctx, p.depthShade, view.top, VIEW_H);
      strip(ctx, segs, i, j, 2.4, 5.5);
      ctx.fillStyle = p.c.curbFace;
      ctx.fill();
      strip(ctx, segs, i, j, 0, 2.4);
      ctx.fillStyle = p.c.curb;
      ctx.fill();
      strip(ctx, segs, i, j, -16, 0);
      ctx.fillStyle = p.c.sidewalk;
      ctx.fill();
      strip(ctx, segs, i, j, -11, 0);
      ctx.fillStyle = p.c.asphalt;
      ctx.fill();
      strip(ctx, segs, i, j, -11.8, -11);
      ctx.fillStyle = p.c.curbFace;
      ctx.fill();
      const x0 = Math.max(first.x0, view.left);
      const x1 = Math.min(last.x1, view.right);
      ctx.fillStyle = p.c.laneLine;
      ctx.globalAlpha = 0.75;
      let k = i;
      for (let x = Math.ceil(x0 / 26) * 26; x < x1; x += 26) {
        while (k < j - 1 && (segs[k]?.x1 ?? Infinity) <= x) k++;
        const s = segs[k];
        if (!s) break;
        ctx.fillRect(x, lineY(s, x) - 6.1, 10, 0.8);
      }
      ctx.globalAlpha = 1;
      for (let cell = Math.floor(x0 / 150); cell * 150 < x1; cell++) {
        if (hash(cell * 31 + 7) > 0.4) continue;
        const mx = cell * 150 + 30 + hash(cell + 77) * 80;
        if (mx < first.x0 || mx > last.x1) continue;
        const idx = segmentIndex(segs, mx);
        const s = segs[idx];
        if (!s || s.gap || s.zone !== "street") continue;
        const my = lineY(s, mx) - 3.8;
        ctx.fillStyle = p.c.manhole;
        ctx.beginPath();
        ctx.ellipse(mx, my, 5.5, 1.5, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = p.c.manholeRim;
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }
    } else if (zone === "roof") {
      strip(ctx, segs, i, j, 2.2, Infinity);
      if (patterns) fillPattern(ctx, patterns.facade);
      fillUnit(ctx, p.roofShade, first.y0, 80);
      if (patterns && night > 0.02) {
        ctx.globalAlpha = night;
        fillPattern(ctx, patterns.lit);
        ctx.globalAlpha = 1;
      }
      strip(ctx, segs, i, j, 0, 2.2);
      ctx.fillStyle = p.c.coping;
      ctx.fill();
      strip(ctx, segs, i, j, -8, 0);
      ctx.fillStyle = p.c.tar;
      ctx.fill();
      strip(ctx, segs, i, j, -8.6, -8);
      ctx.fillStyle = p.c.tarLine;
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(first.x0, first.y0, 1.6, view.bottom - first.y0);
      ctx.fillRect(last.x1 - 1.6, last.y1, 1.6, view.bottom - last.y1);
      ctx.fillStyle = p.rim;
      ctx.fillRect(last.x1 - 0.5, last.y1, 0.5, 30);
    } else {
      strip(ctx, segs, i, j, 2, Infinity);
      if (patterns) fillPattern(ctx, patterns.sewer);
      fillUnit(ctx, p.sewerShade, first.y0, 60);
      strip(ctx, segs, i, j, -6, 0);
      ctx.fillStyle = p.c.sewerFloor;
      ctx.fill();
      strip(ctx, segs, i, j, 0, 2);
      ctx.fillStyle = p.c.sewerFloorHi;
      ctx.fill();
    }
    edge(ctx, segs, i, j, 0);
    ctx.strokeStyle = p.rim;
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = zone === "sewer" ? 0.25 : 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function firstVisible(segs: ReadonlyArray<Segment>): number {
    const i = segmentIndex(segs, view.left);
    if (i >= 0) return i;
    const s = segs[0];
    return s && s.x0 > view.left ? 0 : segs.length;
  }

  function drawTerrain(ctx: CanvasRenderingContext2D, p: Palette, segs: ReadonlyArray<Segment>) {
    let i = firstVisible(segs);
    while (i < segs.length) {
      const s = segs[i];
      if (!s || s.x0 > view.right) break;
      if (s.gap) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < segs.length) {
        const t = segs[j];
        if (!t || t.gap || t.zone !== s.zone || t.x0 > view.right) break;
        j++;
      }
      drawRun(ctx, p, segs, i, j, s.zone);
      i = j;
    }
  }

  function drawUnderlay(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    segs: ReadonlyArray<Segment>,
    time: number,
  ) {
    const start = firstVisible(segs);
    let cut = false;
    ctx.beginPath();
    for (let i = start; i < segs.length; i++) {
      const s = segs[i];
      if (!s || s.x0 > view.right) break;
      if (s.zone !== "street" || s.gap || Math.max(s.y0, s.y1) < 18) continue;
      cut = true;
      ctx.moveTo(s.x0, 0);
      ctx.lineTo(s.x1, 0);
      ctx.lineTo(s.x1, Math.max(0, s.y1 - 15));
      ctx.lineTo(s.x0, Math.max(0, s.y0 - 15));
      ctx.closePath();
    }
    if (cut) {
      ctx.fillStyle = p.c.ledgeDark;
      ctx.fill();
      fillUnit(ctx, p.depthShade, 0, SEWER_Y);
    }
    let sewer = false;
    ctx.beginPath();
    for (let i = start; i < segs.length; i++) {
      const s = segs[i];
      if (!s || s.x0 > view.right) break;
      if (s.zone !== "sewer") continue;
      sewer = true;
      const c0 = Math.max(0, s.y0 - SEWER_CEILING);
      const c1 = Math.max(0, s.y1 - SEWER_CEILING);
      ctx.moveTo(s.x0, c0);
      ctx.lineTo(s.x1, c1);
      ctx.lineTo(s.x1, view.bottom);
      ctx.lineTo(s.x0, view.bottom);
      ctx.closePath();
    }
    if (sewer) {
      if (patterns) fillPattern(ctx, patterns.sewer);
      fillUnit(ctx, p.sewerWall, SEWER_TOP, SEWER_CEILING);
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      ctx.strokeStyle = "rgba(255,214,170,0.07)";
      ctx.lineWidth = 2.4;
      for (let cell = Math.floor(view.left / 110); cell * 110 < view.right; cell++) {
        const ax = cell * 110 + 30;
        const s = segs[segmentIndex(segs, ax + 22)];
        if (!s || s.zone !== "sewer" || s.gap) continue;
        const yb = lineY(s, ax + 22) - 6;
        const ceil = Math.max(0, yb + 6 - SEWER_CEILING) + 24;
        if (yb - ceil < 30) continue;
        ctx.beginPath();
        ctx.moveTo(ax, yb);
        ctx.lineTo(ax, ceil + 22);
        ctx.arc(ax + 22, ceil + 22, 22, Math.PI, 0);
        ctx.lineTo(ax + 44, yb);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      const slabTop = Math.max(0, view.top - 4);
      ctx.beginPath();
      for (let i = start; i < segs.length; i++) {
        const s = segs[i];
        if (!s || s.x0 > view.right) break;
        if (s.zone !== "sewer") continue;
        const c0 = Math.max(0, s.y0 - SEWER_CEILING);
        const c1 = Math.max(0, s.y1 - SEWER_CEILING);
        if (c0 <= slabTop && c1 <= slabTop) continue;
        ctx.moveTo(s.x0, slabTop);
        ctx.lineTo(s.x1, slabTop);
        ctx.lineTo(s.x1, c1);
        ctx.lineTo(s.x0, c0);
        ctx.closePath();
      }
      ctx.fillStyle = p.c.sewerSlab;
      ctx.fill();
      ctx.beginPath();
      for (let i = start; i < segs.length; i++) {
        const s = segs[i];
        if (!s || s.x0 > view.right) break;
        if (s.zone !== "sewer") continue;
        const c0 = Math.max(0, s.y0 - SEWER_CEILING);
        const c1 = Math.max(0, s.y1 - SEWER_CEILING);
        ctx.moveTo(s.x0, c0);
        ctx.lineTo(s.x1, c1);
        ctx.lineTo(s.x1, c1 + 26);
        ctx.lineTo(s.x0, c0 + 26);
        ctx.closePath();
      }
      fillUnit(ctx, p.vault, SEWER_TOP, 26);
      ctx.lineCap = "butt";
      for (const [off, width2, key] of CEILING_PIPES) {
        const colour = p.c[key];
        ctx.beginPath();
        for (let i = start; i < segs.length; i++) {
          const s = segs[i];
          if (!s || s.x0 > view.right) break;
          if (s.zone !== "sewer") continue;
          ctx.moveTo(s.x0, Math.max(0, s.y0 - SEWER_CEILING) + off);
          ctx.lineTo(s.x1, Math.max(0, s.y1 - SEWER_CEILING) + off);
        }
        ctx.lineWidth = width2;
        ctx.strokeStyle = colour;
        ctx.stroke();
      }
      if (view.top < 3) {
        ctx.beginPath();
        for (let i = start; i < segs.length; i++) {
          const s = segs[i];
          if (!s || s.x0 > view.right) break;
          if (s.zone !== "sewer") continue;
          ctx.rect(s.x0, -0.5, s.x1 - s.x0, 3);
        }
        ctx.fillStyle = p.c.asphalt;
        ctx.fill();
      }
    }
    for (let i = start; i < segs.length; i++) {
      const s = segs[i];
      if (!s || s.x0 > view.right) break;
      if (!s.gap) continue;
      const w = s.x1 - s.x0;
      const hi = Math.min(s.y0, s.y1);
      const lo = Math.max(s.y0, s.y1);
      ctx.beginPath();
      if (s.zone === "roof") {
        ctx.rect(s.x0, hi + 2, w, view.bottom - hi);
        fillUnit(ctx, p.alley, hi, 120);
        const n = Math.floor(w / 9);
        for (let k = 0; k < n; k++) {
          const hv = hash(Math.floor(s.x0) * 13 + k);
          if (hv > 0.35 + tod.night * 0.3) continue;
          ctx.fillStyle = LIT_COLOURS[k % 3] ?? "#ffd38a";
          ctx.globalAlpha = 0.15 + tod.night * 0.6;
          ctx.fillRect(s.x0 + 3 + k * 9, hi + 14 + hash(k + 99) * 40, 2.2, 3.2);
        }
        ctx.globalAlpha = 1;
      } else if (s.zone === "sewer") {
        const wy = lo + 10;
        ctx.rect(s.x0, wy, w, view.bottom - wy);
        fillUnit(ctx, p.water, wy, 70);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(s.x0, wy - 3, w, 3);
        ctx.fillStyle = "rgb(150,200,150)";
        ctx.globalAlpha = 0.5;
        const drift = (time * 14) % 13;
        for (let x = s.x0 + drift; x < s.x1 - 4; x += 13) {
          ctx.fillRect(
            x,
            wy + 0.4 + hash(Math.floor(x)) * 0.4,
            4 + hash(Math.floor(x) + 3) * 3,
            0.45,
          );
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.rect(s.x0, hi, w, view.bottom - hi);
        fillUnit(ctx, p.pit, hi, 60);
      }
    }
  }

  function decorZone(segs: ReadonlyArray<Segment>, x: number): Zone {
    return segs[segmentIndex(segs, x)]?.zone ?? "street";
  }

  function drawBackDecor(ctx: CanvasRenderingContext2D, p: Palette, state: GameState) {
    const segs = state.segments;
    const night = tod.night;
    for (const d of state.decor) {
      if (d.x < view.left - 80 || d.x > view.right + 80) continue;
      const zone = decorZone(segs, d.x);
      const base = d.y - BACK[zone];
      if (d.kind === "fireEscape") {
        const w = 56 + seedHash(d.seed, 1) * 30;
        const h = 96 + seedHash(d.seed, 2) * 56;
        const x = d.x - w / 2;
        const top = base - h;
        ctx.fillStyle = p.c.brickDark;
        ctx.fillRect(x, top, w, h);
        ctx.fillStyle = p.c.brick;
        ctx.fillRect(x + 1.5, top + 4, w - 3, h - 4);
        ctx.fillStyle = p.c.coping;
        ctx.fillRect(x - 1.5, top, w + 3, 3);
        ctx.fillStyle = p.rim;
        ctx.fillRect(x + w - 0.8, top, 0.8, h);
        const cols = Math.max(2, Math.floor(w / 14));
        const cw = (w - 6) / cols;
        for (let row = 0; top + 10 + row * 17 + 10 < base - 4; row++) {
          for (let col = 0; col < cols; col++) {
            const wx = x + 3 + col * cw + cw * 0.2;
            const wy = top + 10 + row * 17;
            ctx.fillStyle = p.c.window;
            ctx.fillRect(wx, wy, cw * 0.6, 10);
            if (night > 0.02 && hash(Math.floor(d.seed * 999) + row * 17 + col) < 0.45) {
              ctx.globalAlpha = night;
              ctx.fillStyle = LIT_COLOURS[(row + col) % 3] ?? "#ffd38a";
              ctx.fillRect(wx, wy, cw * 0.6, 10);
              ctx.globalAlpha = 1;
            }
          }
        }
        const fx0 = x + w * 0.2;
        const fx1 = x + w * 0.8;
        ctx.fillStyle = p.c.iron;
        ctx.strokeStyle = p.c.iron;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        let flip = false;
        for (let py = top + 21; py < base - 14; py += 17) {
          ctx.fillRect(fx0, py, fx1 - fx0, 1.1);
          ctx.fillRect(fx0, py - 5, fx1 - fx0, 0.5);
          for (let px = fx0; px <= fx1; px += 3.5) ctx.fillRect(px, py - 5, 0.4, 5);
          ctx.moveTo(flip ? fx1 - 3 : fx0 + 3, py);
          ctx.lineTo(flip ? fx0 + 6 : fx1 - 6, py + 17);
          flip = !flip;
        }
        ctx.stroke();
      } else if (d.kind === "billboard") {
        const w = 48;
        const h = 22;
        const x = d.x - w / 2;
        const top = base - 16 - h;
        ctx.fillStyle = p.c.iron;
        ctx.fillRect(x + 6, top + h, 1.4, base - top - h);
        ctx.fillRect(x + w - 7.4, top + h, 1.4, base - top - h);
        ctx.fillRect(x + 3, top + h + 4, w - 6, 0.8);
        ctx.fillStyle = p.c.billboard;
        ctx.fillRect(x - 1, top - 1, w + 2, h + 2);
        const hue = Math.floor(seedHash(d.seed, 3) * 4);
        const panel: Rgb =
          hue === 0
            ? [232, 72, 96]
            : hue === 1
              ? [40, 150, 210]
              : hue === 2
                ? [250, 196, 40]
                : [120, 70, 200];
        const bright = mix(tod.ambient, [1, 1, 1], night * 0.7);
        ctx.fillStyle = css(light(panel, bright));
        ctx.fillRect(x, top, w, h);
        ctx.fillStyle = css(light([250, 246, 236], bright));
        ctx.beginPath();
        ctx.arc(x + w * 0.24, top + h * 0.5, h * 0.32, 0, TAU);
        ctx.fill();
        ctx.fillRect(x + w * 0.48, top + h * 0.28, w * 0.42, h * 0.16);
        ctx.fillRect(x + w * 0.48, top + h * 0.56, w * 0.28, h * 0.12);
        ctx.fillStyle = css(light(shade(panel, 0.5), bright));
        ctx.fillRect(x, top + h - 3, w, 3);
      } else if (d.kind === "graffiti") {
        let ty = base - 26;
        if (zone === "street") {
          ctx.fillStyle = p.c.ledgeDark;
          ctx.fillRect(d.x - 32, base - 38, 64, 38);
          ctx.fillStyle = p.c.ledge;
          ctx.fillRect(d.x - 32, base - 38, 64, 2);
          ty = base - 18;
        }
        const ca = seedHash(d.seed, 4);
        const fill: Rgb =
          ca < 0.25
            ? [255, 70, 160]
            : ca < 0.5
              ? [60, 220, 240]
              : ca < 0.75
                ? [150, 240, 60]
                : [255, 150, 40];
        const amb = zone === "sewer" ? SEWER_LIGHT : tod.ambient;
        ctx.fillStyle = css(light(fill, amb));
        ctx.strokeStyle = css(light([20, 20, 30], amb));
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const bx = d.x - 16 + k * 10.5;
          const by = ty + Math.sin(k * 1.7 + d.seed * 10) * 2;
          ctx.moveTo(bx + 5.4, by);
          ctx.ellipse(bx, by, 5.4, 6.4 - (k % 2), (k - 1.5) * 0.12, 0, TAU);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = css(light([255, 255, 255], amb), 0.7);
        for (let k = 0; k < 4; k++) ctx.fillRect(d.x - 18 + k * 10.5, ty - 3.5, 1.4, 1.4);
        ctx.fillStyle = css(light(fill, amb));
        for (let k = 0; k < 3; k++)
          ctx.fillRect(d.x - 12 + k * 11, ty + 5, 0.6, 3 + hash(k + Math.floor(d.seed * 50)) * 4);
      }
    }
  }

  function drawDecor(ctx: CanvasRenderingContext2D, p: Palette, state: GameState, time: number) {
    const segs = state.segments;
    for (const d of state.decor) {
      if (d.x < view.left - 40 || d.x > view.right + 40) continue;
      const zone = decorZone(segs, d.x);
      const base = d.y - BACK[zone];
      const x = d.x;
      switch (d.kind) {
        case "lamp": {
          ctx.fillStyle = p.c.pole;
          ctx.fillRect(x - 0.8, base - 64, 1.6, 64);
          ctx.fillRect(x - 1.7, base - 7, 3.4, 7);
          ctx.fillStyle = p.c.poleHi;
          ctx.fillRect(x + 0.3, base - 64, 0.5, 64);
          ctx.strokeStyle = p.c.pole;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, base - 63);
          ctx.quadraticCurveTo(x + 2, base - 69, x + 11, base - 66);
          ctx.stroke();
          ctx.fillStyle = p.c.pole;
          ctx.beginPath();
          ctx.moveTo(x + 8, base - 66.5);
          ctx.lineTo(x + 14, base - 66.5);
          ctx.lineTo(x + 13, base - 63.5);
          ctx.lineTo(x + 9, base - 63.5);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = tod.night > 0.3 ? "#ffe2a8" : p.c.white;
          ctx.fillRect(x + 9.3, base - 63.6, 3.4, 0.8);
          break;
        }
        case "trafficLight": {
          ctx.fillStyle = p.c.steelDark;
          ctx.fillRect(x - 0.8, base - 50, 1.6, 50);
          ctx.fillRect(x, base - 50, 20, 1.2);
          ctx.fillRect(x + 15.5, base - 49, 4, 10);
          const lit = Math.floor(seedHash(d.seed, 1) * 3);
          const colours = ["#ff4030", "#ffb020", "#30e070"];
          for (let k = 0; k < 3; k++) {
            dot(
              ctx,
              x + 17.5,
              base - 47 + k * 3,
              1,
              k === lit ? (colours[k] ?? "#fff") : "rgba(0,0,0,0.5)",
            );
          }
          break;
        }
        case "steam": {
          const top = base - 30;
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = k % 2 ? p.c.white : p.c.stack;
            ctx.fillRect(x - 2.6, top + k * 7.5, 5.2, 7.5);
          }
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(x - 2.6, top, 1.4, 30);
          ctx.fillStyle = p.c.steelDark;
          ctx.fillRect(x - 3.2, top - 1.4, 6.4, 1.6);
          break;
        }
        case "subwaySign": {
          ctx.fillStyle = p.c.pole;
          ctx.fillRect(x - 13, base - 7, 26, 0.9);
          for (let px = x - 13; px <= x + 13; px += 2.6) ctx.fillRect(px, base - 7, 0.5, 7);
          ctx.fillRect(x - 13.6, base - 15, 1.2, 15);
          ctx.fillRect(x + 12.4, base - 15, 1.2, 15);
          dot(ctx, x - 13, base - 16.6, 1.9, "#4fd27e");
          dot(ctx, x + 13, base - 16.6, 1.9, "#4fd27e");
          ctx.fillStyle = p.c.sign;
          ctx.fillRect(x - 8, base - 12, 16, 3.6);
          ctx.fillStyle = p.c.white;
          ctx.fillRect(x - 7.4, base - 11.2, 14.8, 0.35);
          dot(ctx, x - 5, base - 10, 0.9, "#ee352e");
          dot(ctx, x - 2.6, base - 10, 0.9, "#00933c");
          dot(ctx, x - 0.2, base - 10, 0.9, "#fccc0a");
          break;
        }
        case "waterTower":
          ctx.save();
          ctx.translate(x, base);
          ctx.scale(1.3, 1.3);
          waterTankWorld(ctx, p);
          ctx.restore();
          break;
        case "acUnit": {
          ctx.fillStyle = p.c.acDark;
          ctx.fillRect(x - 7.5, base - 9.5, 15, 9.5);
          ctx.fillStyle = p.c.ac;
          ctx.fillRect(x - 7, base - 9, 14, 8.5);
          dot(ctx, x + 2.5, base - 4.8, 3.2, p.c.acDark);
          ctx.strokeStyle = p.c.ac;
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.moveTo(x + 2.5, base - 8);
          ctx.lineTo(x + 2.5, base - 1.6);
          ctx.moveTo(x - 0.7, base - 4.8);
          ctx.lineTo(x + 5.7, base - 4.8);
          ctx.stroke();
          ctx.fillStyle = p.c.acDark;
          for (let k = 0; k < 4; k++) ctx.fillRect(x - 6, base - 8 + k * 1.8, 4.5, 0.5);
          break;
        }
        case "antenna": {
          ctx.strokeStyle = p.c.steelDark;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(x, base);
          ctx.lineTo(x, base - 36);
          ctx.moveTo(x - 4, base - 28);
          ctx.lineTo(x + 4, base - 28);
          ctx.moveTo(x - 3, base - 21);
          ctx.lineTo(x + 3, base - 21);
          ctx.moveTo(x - 2, base - 14);
          ctx.lineTo(x + 2, base - 14);
          ctx.stroke();
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.moveTo(x, base - 30);
          ctx.lineTo(x - 11, base);
          ctx.moveTo(x, base - 30);
          ctx.lineTo(x + 11, base);
          ctx.stroke();
          dot(ctx, x, base - 36.5, 0.8, "#ff3a2a");
          break;
        }
        case "sewerLamp": {
          ctx.fillStyle = p.c.iron;
          ctx.fillRect(x - 0.6, base - 46, 4.6, 1);
          ctx.fillRect(x - 1, base - 49, 1, 6);
          dot(ctx, x + 3.6, base - 43.6, 1.8, "#ffd89a");
          ctx.strokeStyle = p.c.iron;
          ctx.lineWidth = 0.35;
          ctx.beginPath();
          ctx.moveTo(x + 1.8, base - 43.6);
          ctx.lineTo(x + 5.4, base - 43.6);
          ctx.moveTo(x + 3.6, base - 45.4);
          ctx.lineTo(x + 3.6, base - 41.8);
          ctx.stroke();
          break;
        }
        case "drip": {
          const ceil = Math.max(0, d.y - SEWER_CEILING);
          ctx.fillStyle = "rgba(60,90,50,0.6)";
          ctx.fillRect(x - 1.2, ceil, 2.4, 3);
          const period = 1.6;
          const ph = ((time + d.seed * 7) % period) / period;
          ctx.fillStyle = "rgba(170,220,190,0.85)";
          if (ph < 0.3) {
            dot(ctx, x, ceil + 3, 0.3 + ph * 2, "rgba(170,220,190,0.85)");
          } else {
            const fall = (ph - 0.3) / 0.7;
            const yy = ceil + 3 + fall * fall * (base - ceil - 3);
            ctx.beginPath();
            ctx.ellipse(x, yy, 0.55, 1, 0, 0, TAU);
            ctx.fill();
            if (fall > 0.93) {
              ctx.strokeStyle = "rgba(170,220,190,0.6)";
              ctx.lineWidth = 0.3;
              ctx.beginPath();
              ctx.ellipse(x, base, 1 + (fall - 0.93) * 50, 0.5, 0, 0, TAU);
              ctx.stroke();
            }
          }
          ctx.fillStyle = "rgba(120,160,140,0.25)";
          ctx.beginPath();
          ctx.ellipse(x, base + 0.5, 5, 0.8, 0, 0, TAU);
          ctx.fill();
          break;
        }
        case "grate": {
          const gy = d.y - 5;
          ctx.fillStyle = p.c.iron;
          ctx.fillRect(x - 8, gy, 16, 1.6);
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          for (let k = 0; k < 7; k++) ctx.fillRect(x - 7.2 + k * 2.3, gy + 0.3, 1.2, 1);
          break;
        }
        default:
          break;
      }
    }
  }

  function waterTankWorld(ctx: CanvasRenderingContext2D, p: Palette) {
    ctx.fillStyle = p.c.iron;
    ctx.fillRect(-5.5, -9, 0.8, 9);
    ctx.fillRect(4.7, -9, 0.8, 9);
    ctx.fillRect(-0.4, -9, 0.8, 9);
    ctx.fillRect(-5, -5, 10, 0.5);
    ctx.fillStyle = p.c.tank;
    ctx.fillRect(-6.5, -21, 13, 12);
    ctx.fillStyle = p.c.tankDark;
    ctx.fillRect(-6.5, -21, 2.5, 12);
    ctx.fillRect(-6.5, -18, 13, 0.6);
    ctx.fillRect(-6.5, -12.5, 13, 0.6);
    ctx.fillStyle = p.rim;
    ctx.fillRect(5.9, -21, 0.6, 12);
    ctx.fillStyle = p.c.tankDark;
    ctx.beginPath();
    ctx.moveTo(-7.2, -21);
    ctx.lineTo(0, -27);
    ctx.lineTo(7.2, -21);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-0.3, -28.5, 0.6, 1.6);
  }

  function drawRails(ctx: CanvasRenderingContext2D, p: Palette, state: GameState) {
    const segs = state.segments;
    ctx.lineCap = "round";
    for (const r of state.rails) {
      if (r.x1 < view.left || r.x0 > view.right || r.kind === "car") continue;
      if (r.kind === "rail") drawRail(ctx, p, r, segs);
      else if (r.kind === "pipe") drawPipe(ctx, p, r, segs);
      else drawLedge(ctx, p, r, segs);
    }
    ctx.lineCap = "butt";
  }

  function railY(r: Rail, x: number) {
    const span = r.x1 - r.x0;
    return span > 0 ? r.y0 + ((x - r.x0) / span) * (r.y1 - r.y0) : r.y0;
  }

  function drawRail(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    r: Rail,
    segs: ReadonlyArray<Segment>,
  ) {
    ctx.strokeStyle = p.c.steelDark;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    const n = Math.max(1, Math.round((r.x1 - r.x0) / 18));
    for (let k = 0; k <= n; k++) {
      const x = r.x0 + 1.5 + ((r.x1 - r.x0 - 3) * k) / n;
      const y = railY(r, x);
      const g = floorY(segs, x);
      ctx.moveTo(x, y);
      ctx.lineTo(x, Number.isNaN(g) || g < y ? y + 20 : g);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0);
    ctx.lineTo(r.x1, r.y1);
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = p.c.steelDark;
    ctx.stroke();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = p.c.steel;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0 - 0.35);
    ctx.lineTo(r.x1, r.y1 - 0.35);
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = p.c.steelHi;
    ctx.stroke();
  }

  function drawPipe(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    r: Rail,
    segs: ReadonlyArray<Segment>,
  ) {
    ctx.fillStyle = p.c.pipeDark;
    for (let x = r.x0 + 12; x < r.x1 - 6; x += 60) {
      const y = railY(r, x);
      const g = floorY(segs, x);
      if (!Number.isNaN(g) && g > y) ctx.fillRect(x - 0.9, y, 1.8, g - y);
    }
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0 + 2.2);
    ctx.lineTo(r.x1, r.y1 + 2.2);
    ctx.lineCap = "butt";
    ctx.lineWidth = 5.2;
    ctx.strokeStyle = p.c.pipeDark;
    ctx.stroke();
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = p.c.pipe;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0 + 3.6);
    ctx.lineTo(r.x1, r.y1 + 3.6);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0 + 0.9);
    ctx.lineTo(r.x1, r.y1 + 0.9);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = p.c.pipeHi;
    ctx.stroke();
    ctx.fillStyle = p.c.pipeDark;
    for (let x = r.x0 + 20; x < r.x1 - 4; x += 40)
      ctx.fillRect(x - 0.8, railY(r, x) - 0.6, 1.6, 5.6);
    ctx.lineCap = "round";
  }

  function drawLedge(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    r: Rail,
    segs: ReadonlyArray<Segment>,
  ) {
    const g0 = floorY(segs, r.x0 + 1);
    const g1 = floorY(segs, r.x1 - 1);
    const box = !Number.isNaN(g0) && !Number.isNaN(g1) && g0 - r.y0 < 40 && g1 - r.y1 < 40;
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0);
    ctx.lineTo(r.x1, r.y1);
    ctx.lineTo(r.x1, box ? g1 : r.y1 + 4);
    ctx.lineTo(r.x0, box ? g0 : r.y0 + 4);
    ctx.closePath();
    ctx.fillStyle = p.c.ledgeDark;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0);
    ctx.lineTo(r.x1, r.y1);
    ctx.lineTo(r.x1, r.y1 + 3);
    ctx.lineTo(r.x0, r.y0 + 3);
    ctx.closePath();
    ctx.fillStyle = p.c.ledge;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0 + 0.3);
    ctx.lineTo(r.x1, r.y1 + 0.3);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = p.c.ledgeHi;
    ctx.stroke();
  }

  function drawObstacles(ctx: CanvasRenderingContext2D, p: Palette, state: GameState) {
    for (const o of state.obstacles) {
      if (o.hit || o.x + o.w < view.left || o.x > view.right) continue;
      if (o.kind === "taxi") drawTaxi(ctx, p, o);
      else drawObstacleShape(ctx, p, o.kind, o.x, o.y, o.w, o.h, o.seed);
    }
  }

  function drawPickups(ctx: CanvasRenderingContext2D, p: Palette, state: GameState, time: number) {
    if (!sprites) return;
    for (const k of state.pickups) {
      if (k.taken || k.x < view.left || k.x > view.right) continue;
      const bob = Math.sin(time * 4 + k.x * 0.1) * 1.4;
      const y = k.y + bob;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = k.kind === "token" ? 0.55 : 0.3;
      ctx.drawImage(k.kind === "token" ? sprites.amber : sprites.green, k.x - 9, y - 9, 18, 18);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (k.kind === "token") {
        const spin = Math.abs(Math.cos(time * 3 + k.x));
        const rx = 0.6 + 2.6 * spin;
        ctx.fillStyle = p.c.tokenDark;
        ctx.beginPath();
        ctx.ellipse(k.x, y, rx + 0.5, 3.1, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = p.c.token;
        ctx.beginPath();
        ctx.ellipse(k.x, y, rx, 2.6, 0, 0, TAU);
        ctx.fill();
        if (spin > 0.35) {
          ctx.fillStyle = p.c.tokenDark;
          ctx.fillRect(k.x - rx * 0.12, y - 1.3, rx * 0.24, 2.6);
          ctx.fillRect(k.x - rx * 0.45, y - 0.15, rx * 0.9, 0.3);
        }
      } else {
        ctx.fillStyle = p.c.ammo;
        ctx.fillRect(k.x - 3, y - 1.5, 6, 4);
        ctx.fillStyle = p.c.brass;
        for (let b = 0; b < 3; b++) ctx.fillRect(k.x - 2.4 + b * 1.8, y - 3.4, 1.1, 2);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(k.x - 3, y - 1.5, 6, 0.6);
      }
    }
  }

  function drawEnemies(ctx: CanvasRenderingContext2D, p: Palette, state: GameState) {
    if (!sprites) return;
    const r = state.rider;
    for (const e of state.enemies) {
      if (e.state === "dead" || e.x < view.left - 10 || e.x > view.right + 10) continue;
      if (e.kind === "thug") drawThug(ctx, p, sprites, e);
      else if (e.kind === "gunman") drawGunman(ctx, p, sprites, e);
      else drawRat(ctx, p, e);
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const e of state.enemies) {
      if (e.kind !== "gunman" || e.state !== "aim" || e.x < view.left || e.x > view.right + 40)
        continue;
      const sh = gunmanShoulder(e);
      const mx = sh.x + Math.cos(e.aim) * 9;
      const my = sh.y + Math.sin(e.aim) * 9;
      const dist = Math.min(600, Math.hypot(r.x - mx, r.y - 12 - my));
      const k = clamp(e.stateAge / AIM_MS, 0, 1);
      const ex = mx + Math.cos(e.aim) * dist;
      const ey = my + Math.sin(e.aim) * dist;
      ctx.globalAlpha = 0.25 + 0.75 * k * k;
      ctx.strokeStyle = "#ff2a2a";
      ctx.lineWidth = 0.35 + k * 0.4;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.drawImage(sprites.red, ex - 3 - k * 2, ey - 3 - k * 2, 6 + k * 4, 6 + k * 4);
    }
    ctx.restore();
  }

  function drawDecals(ctx: CanvasRenderingContext2D, p: Palette, fx: Fx) {
    ctx.fillStyle = p.c.bloodDark;
    ctx.beginPath();
    let any = false;
    for (const d of fx.decals) {
      if (!d.active || d.kind !== D_POOL || d.x < view.left - 20 || d.x > view.right + 20) continue;
      const k = d.grow > 0 ? clamp(d.age / d.grow, 0, 1) : 1;
      const rx = d.size * (1 - (1 - k) * (1 - k));
      if (rx < 0.2) continue;
      ctx.moveTo(d.x + rx, d.y - rx * 0.1);
      ctx.ellipse(d.x, d.y - rx * 0.1, rx, rx * 0.2, 0, 0, TAU);
      any = true;
    }
    if (any) {
      ctx.globalAlpha = 0.92;
      ctx.fill();
    }
    ctx.fillStyle = p.c.blood;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const d of fx.decals) {
      if (!d.active || d.kind !== D_SPLAT || d.x < view.left || d.x > view.right) continue;
      ctx.moveTo(d.x + d.size, d.y - 0.3);
      ctx.ellipse(d.x, d.y - 0.3, d.size, d.size * 0.28, 0, 0, TAU);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    for (const d of fx.decals) {
      if (!d.active || d.kind !== D_CORPSE || d.x < view.left - 20 || d.x > view.right + 20)
        continue;
      drawCorpse(ctx, p, d);
    }
  }

  function drawParticles(ctx: CanvasRenderingContext2D, p: Palette, fx: Fx) {
    if (!sprites) return;
    const parts = fx.particles;
    ctx.fillStyle = p.c.blood;
    ctx.beginPath();
    for (const q of parts) {
      if (!q.active || q.kind !== P_BLOOD) continue;
      const s = q.size;
      ctx.rect(q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.fill();
    for (const q of parts) {
      if (!q.active) continue;
      const t = q.life / q.maxLife;
      switch (q.kind) {
        case P_DUST:
        case P_STEAM:
        case P_SMOKE: {
          const age = 1 - t;
          const r = q.size * (1 + age * (q.kind === P_STEAM ? 2.4 : 1.4));
          const a = Math.min(1, age * 6) * t;
          ctx.globalAlpha =
            a * (q.kind === P_STEAM ? 0.5 : q.kind === P_DUST ? 0.55 * (0.4 + p.lum * 0.6) : 0.45);
          const img =
            q.kind === P_STEAM ? sprites.puff : q.kind === P_DUST ? sprites.dust : sprites.smoke;
          ctx.drawImage(img, q.x - r, q.y - r, r * 2, r * 2);
          break;
        }
        case P_DEBRIS: {
          ctx.globalAlpha = Math.min(1, t * 3);
          ctx.fillStyle = q.tone < 0.5 ? p.c.curbFace : p.c.ledge;
          const w = q.size * (0.4 + 0.6 * Math.abs(Math.cos(q.rot)));
          ctx.fillRect(q.x - w / 2, q.y - q.size / 2, w, q.size * 0.7);
          break;
        }
        case P_SHELL: {
          ctx.globalAlpha = Math.min(1, t * 3);
          ctx.fillStyle = p.c.brass;
          const w = 0.4 + 0.6 * Math.abs(Math.cos(q.rot));
          ctx.fillRect(q.x - w / 2, q.y - 0.25, w, 0.5);
          break;
        }
        case P_PROP: {
          ctx.globalAlpha = Math.min(1, t * 4);
          ctx.save();
          ctx.translate(q.x, q.y);
          ctx.rotate(q.rot);
          if (q.prop === "cone") drawCone(ctx, p, -3, 4.5, 6, 9);
          else if (q.prop === "hydrant") drawHydrant(ctx, p, -2.5, 4.5, 5, 9);
          else drawTrash(ctx, p, -5, 4, 10, 8, 0.4);
          ctx.restore();
          break;
        }
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#ffd27a";
    ctx.lineWidth = 0.55;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const q of parts) {
      if (!q.active || q.kind !== P_SPARK) continue;
      const k = 0.022 * (q.life / q.maxLife);
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - q.vx * k, q.y - q.vy * k);
    }
    ctx.stroke();
    for (const q of parts) {
      if (!q.active) continue;
      const t = q.life / q.maxLife;
      if (q.kind === P_SPARKLE) {
        const s = q.size * t;
        ctx.globalAlpha = t;
        ctx.fillStyle = "#fff0b0";
        ctx.fillRect(q.x - s, q.y - 0.2, s * 2, 0.4);
        ctx.fillRect(q.x - 0.2, q.y - s, 0.4, s * 2);
      } else if (q.kind === P_FLASH) {
        const s = q.size * (0.5 + t);
        ctx.globalAlpha = t;
        ctx.drawImage(sprites.muzzle, q.x - s, q.y - s, s * 2, s * 2);
      }
    }
    ctx.restore();
  }

  function drawBullets(ctx: CanvasRenderingContext2D, state: GameState) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const from of ["player", "enemy"] as const) {
      ctx.beginPath();
      for (const b of state.bullets) {
        if (b.from !== from || b.x < view.left || b.x > view.right) continue;
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
      }
      ctx.strokeStyle = from === "player" ? "rgba(255,226,150,0.95)" : "rgba(255,70,50,0.95)";
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLights(ctx: CanvasRenderingContext2D, state: GameState, depth: number) {
    if (!sprites) return;
    const night = tod.night;
    const segs = state.segments;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const d of state.decor) {
      if (d.x < view.left - 70 || d.x > view.right + 70) continue;
      const zone = decorZone(segs, d.x);
      const base = d.y - BACK[zone];
      const x = d.x;
      switch (d.kind) {
        case "lamp":
          if (night < 0.05) break;
          ctx.globalAlpha = night * 0.8;
          ctx.drawImage(sprites.cone, x - 9, base - 64, 40, d.y - base + 64);
          ctx.globalAlpha = night;
          ctx.drawImage(sprites.warm, x + 11 - 10, base - 64 - 10, 20, 20);
          ctx.globalAlpha = night * 0.6;
          ctx.drawImage(sprites.warm, x - 14, d.y - 7, 50, 9);
          break;
        case "trafficLight": {
          if (night < 0.05) break;
          const lit = Math.floor(seedHash(d.seed, 1) * 3);
          ctx.globalAlpha = night * 0.8;
          ctx.drawImage(
            lit === 0 ? sprites.red : lit === 1 ? sprites.amber : sprites.green,
            x + 17.5 - 6,
            base - 47 + lit * 3 - 6,
            12,
            12,
          );
          break;
        }
        case "subwaySign":
          ctx.globalAlpha = 0.25 + night * 0.65;
          ctx.drawImage(sprites.green, x - 13 - 8, base - 16.6 - 8, 16, 16);
          ctx.drawImage(sprites.green, x + 13 - 8, base - 16.6 - 8, 16, 16);
          break;
        case "antenna":
          if (night < 0.05) break;
          ctx.globalAlpha = night * 0.9;
          ctx.drawImage(sprites.red, x - 5, base - 36.5 - 5, 10, 10);
          break;
        case "billboard": {
          if (night < 0.05) break;
          const neon = seedHash(d.seed, 6) < 0.5 ? sprites.pink : sprites.cyan;
          ctx.globalAlpha = night * 0.55;
          ctx.drawImage(neon, x - 36, base - 16 - 22 - 18, 72, 54);
          ctx.globalAlpha = night * 0.9;
          ctx.strokeStyle = seedHash(d.seed, 6) < 0.5 ? "#ff6ad0" : "#5ae8ff";
          ctx.lineWidth = 0.7;
          ctx.strokeRect(x - 25.5, base - 16 - 23.5, 51, 25);
          break;
        }
        case "sewerLamp":
          ctx.globalAlpha = 0.85;
          ctx.drawImage(sprites.warm, x + 3.6 - 34, base - 43.6 - 34, 68, 68);
          ctx.globalAlpha = 0.55;
          ctx.drawImage(sprites.warm, x - 26, d.y - 9, 60, 12);
          break;
        case "steam":
          if (night < 0.05) break;
          ctx.globalAlpha = night * 0.3;
          ctx.drawImage(sprites.amber, x - 6, base - 36, 12, 12);
          break;
        default:
          break;
      }
    }
    if (night > 0.05) {
      for (const o of state.obstacles) {
        if (o.hit || o.x + o.w < view.left - 40 || o.x > view.right + 40) continue;
        if (o.kind === "taxi") {
          const front = seedHash(o.seed, 1) < 0.5 ? 1 : -1;
          const hy = o.y - o.h * 0.55 + 1.7;
          const fxp = front > 0 ? o.x + o.w : o.x;
          const bxp = front > 0 ? o.x : o.x + o.w;
          ctx.globalAlpha = night * 0.9;
          ctx.drawImage(sprites.warm, fxp - 8, hy - 8, 16, 16);
          ctx.globalAlpha = night * 0.35;
          ctx.drawImage(sprites.warm, front > 0 ? fxp - 4 : fxp - 40, hy - 5, 44, 12);
          ctx.globalAlpha = night * 0.8;
          ctx.drawImage(sprites.red, bxp - 5, hy - 5, 10, 10);
          ctx.globalAlpha = night * 0.7;
          ctx.drawImage(sprites.warm, o.x + o.w * 0.5 - 6, o.y - o.h - 7, 12, 12);
        } else if (o.kind === "barrier") {
          ctx.globalAlpha = night * 0.8;
          ctx.drawImage(sprites.amber, o.x + o.w / 2 - 6, o.y - o.h * 0.86 - 1.2 - 6, 12, 12);
        }
      }
    }
    if (depth > 0.05 || night > 0.3) {
      ctx.globalAlpha = Math.max(depth, night) * 0.6;
      for (const e of state.enemies) {
        if (e.kind !== "rat" || e.state === "dead" || e.x < view.left || e.x > view.right) continue;
        ctx.drawImage(sprites.red, e.x + e.facing * 4.2 - 1.5, e.y - 2.6 - 1.5, 3, 3);
      }
    }
    ctx.restore();
  }

  function drawSpeedLines(ctx: CanvasRenderingContext2D, r: Rider, fx: Fx) {
    if (fx.reducedMotion) return;
    const k = clamp((r.vx - SPEED_FX_MIN) / SPEED_FX_RANGE, 0, 1);
    if (k <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.35;
    ctx.globalAlpha = 0.35 * k;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const y = r.y - 3 - i * 3.6 - hash(i) * 2;
      const run = (fx.time * 260 + hash(i + 9) * 90) % 90;
      const x = r.x - 8 - run;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 10 - 16 * k, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTexts(ctx: CanvasRenderingContext2D, fx: Fx) {
    if (!theme) return;
    const s = view.s;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const t of fx.texts) {
      if (!t.active) continue;
      const k = t.age / t.life;
      const pop = k < 0.12 ? 1.3 - (k / 0.12) * 0.3 : 1;
      const size = clamp(height * 0.075, 11, 16) * t.size * pop;
      const x = (t.x - fx.camX) * s;
      const y = (t.y - fx.camY) * s - (1 - (1 - k) * (1 - k)) * 22 * s;
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = fontOf(900, size, true);
      ctx.lineWidth = Math.max(2, size * 0.22);
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle =
        t.tone === "gold"
          ? "#ffd166"
          : t.tone === "accent"
            ? theme.accent
            : t.tone === "red"
              ? "#ff5a5f"
              : t.tone === "muted"
                ? "rgba(255,255,255,0.7)"
                : "#ffffff";
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
    const banner = fx.banner;
    if (banner.active) {
      const a =
        banner.age < 0.3
          ? banner.age / 0.3
          : banner.age > 2.2
            ? Math.max(0, (2.6 - banner.age) / 0.4)
            : 1;
      const { hud } = hudMetrics(width, height);
      const size = clamp(height * 0.068, 10, 13);
      ctx.font = fontOf(800, size);
      const label = banner.text.toUpperCase();
      const tw = ctx.measureText(label).width;
      const w = tw + size * 2.4;
      const h = size * 2;
      const x = (width - w) / 2;
      const y = hud + 4 - (1 - a) * 8;
      ctx.fillStyle = theme.surface;
      ctx.globalAlpha = a * 0.86;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x + size * 0.8, y + h * 0.3, 2, h * 0.4);
      ctx.fillStyle = theme.foreground;
      ctx.textAlign = "left";
      ctx.fillText(label, x + size * 1.4, y + h / 2 + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  function pillBg(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    border: string,
  ) {
    if (!theme) return;
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function speaker(ctx: CanvasRenderingContext2D, rect: Rect, muted: boolean) {
    if (!theme) return;
    const s = rect.h * 0.5;
    const cx = rect.x + rect.w / 2 - s * 0.2;
    const cy = rect.y + rect.h / 2;
    ctx.fillStyle = theme.foreground;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy - s * 0.2);
    ctx.lineTo(cx - s * 0.2, cy - s * 0.2);
    ctx.lineTo(cx + s * 0.15, cy - s * 0.5);
    ctx.lineTo(cx + s * 0.15, cy + s * 0.5);
    ctx.lineTo(cx - s * 0.2, cy + s * 0.2);
    ctx.lineTo(cx - s * 0.5, cy + s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, s * 0.13);
    ctx.lineCap = "round";
    ctx.beginPath();
    if (muted) {
      ctx.strokeStyle = theme.muted;
      ctx.moveTo(cx + s * 0.35, cy - s * 0.22);
      ctx.lineTo(cx + s * 0.75, cy + s * 0.22);
      ctx.moveTo(cx + s * 0.75, cy - s * 0.22);
      ctx.lineTo(cx + s * 0.35, cy + s * 0.22);
    } else {
      ctx.strokeStyle = theme.foreground;
      ctx.arc(cx + s * 0.15, cy, s * 0.4, -0.8, 0.8);
      ctx.moveTo(cx + s * 0.15 + Math.cos(-0.8) * s * 0.72, cy + Math.sin(-0.8) * s * 0.72);
      ctx.arc(cx + s * 0.15, cy, s * 0.72, -0.8, 0.8);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  function drawHud(ctx: CanvasRenderingContext2D, state: GameState, ui: RenderUi) {
    if (!theme) return;
    const mute = muteRect(width, height);
    pillBg(ctx, mute.x, mute.y, mute.w, mute.h, ui.hoverMute ? theme.accent : theme.border);
    speaker(ctx, mute, state.muted);
    if (state.status === "ready") return;
    const { hud, pill, pad } = hudMetrics(width, height);
    const y = (hud - pill) / 2;
    const heart = pill * 0.3;
    const step = heart * 2.5;
    const textSize = pill * 0.55;
    ctx.font = fontOf(800, textSize);
    const ammo = String(state.ammo);
    const tw = ctx.measureText(ammo).width;
    const w = pill * 0.45 + MAX_HP * step + pill * 0.25 + pill * 0.3 + 4 + tw + pill * 0.45;
    pillBg(ctx, pad, y, w, pill, theme.border);
    let x = pad + pill * 0.45 + heart;
    const cy = y + pill / 2;
    for (let i = 0; i < MAX_HP; i++) {
      heartPath(ctx, x, cy + heart * 0.15, heart * 1.15);
      if (i < state.rider.hp) {
        ctx.fillStyle = theme.danger;
        ctx.fill();
      } else {
        ctx.strokeStyle = theme.muted;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      x += step;
    }
    x += pill * 0.25 - heart;
    const bw = pill * 0.3;
    const bh = pill * 0.56;
    ctx.fillStyle = state.ammo > 0 ? "#d9a441" : theme.muted;
    ctx.fillRect(x, cy - bh * 0.15, bw, bh * 0.65);
    ctx.beginPath();
    ctx.moveTo(x, cy - bh * 0.15);
    ctx.quadraticCurveTo(x, cy - bh * 0.5, x + bw / 2, cy - bh * 0.5);
    ctx.quadraticCurveTo(x + bw, cy - bh * 0.5, x + bw, cy - bh * 0.15);
    ctx.closePath();
    ctx.fillStyle = state.ammo > 0 ? "#b87333" : theme.muted;
    ctx.fill();
    ctx.fillStyle = state.ammo > 0 ? theme.foreground : theme.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(ammo, x + bw + 4, cy + 0.5);
    if (state.combo > 1) {
      const label = `×${state.combo}`;
      ctx.font = fontOf(900, textSize, true);
      const cw = ctx.measureText(label).width + pill * 0.8;
      const cxp = pad + w + 6;
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.roundRect(cxp, y, cw, pill, pill / 2);
      ctx.fill();
      ctx.fillStyle = theme.accentForeground;
      ctx.textAlign = "center";
      ctx.fillText(label, cxp + cw / 2, cy + 0.5);
    }
  }

  function fitFont(
    ctx: CanvasRenderingContext2D,
    text: string,
    weight: number,
    size: number,
    maxW: number,
    italic = false,
  ) {
    ctx.font = fontOf(weight, size, italic);
    const w = ctx.measureText(text).width;
    if (w > maxW) ctx.font = fontOf(weight, Math.max(8, (size * maxW) / w), italic);
  }

  function drawReady(ctx: CanvasRenderingContext2D, state: GameState, ui: RenderUi) {
    if (!theme) return;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, width, height);
    const w = Math.min(width - 24, 400);
    const h = Math.min(height - 16, 116);
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const title = clamp(h * 0.25, 16, 28);
    fitFont(ctx, "Concrete Drift", 900, title, w - 24, true);
    const tw = ctx.measureText("Concrete Drift").width;
    ctx.fillStyle = theme.accent;
    ctx.save();
    ctx.translate(width / 2 - tw / 2 - 10, y + h * 0.3);
    ctx.transform(1, 0, -0.3, 1, 0, 0);
    ctx.fillRect(-2, -title * 0.4, 4, title * 0.8);
    ctx.restore();
    ctx.fillStyle = theme.foreground;
    ctx.fillText("Concrete Drift", width / 2, y + h * 0.3);
    const small = clamp(h * 0.11, 10, 13);
    const controls = ui.touch
      ? "Tap left: jump/flip · Tap right: shoot · near enemies it slashes"
      : "Space jump · hold to flip · F shoot · D knife";
    fitFont(ctx, controls, 600, small, w - 20);
    ctx.fillStyle = theme.muted;
    ctx.fillText(controls, width / 2, y + h * 0.58);
    const start = `${ui.touch ? "Tap to start" : "Press Space to start"}${state.best > 0 ? ` · Best ${state.best}` : ""}`;
    fitFont(ctx, start, 800, small, w - 20);
    ctx.fillStyle = theme.accent;
    ctx.fillText(start, width / 2, y + h * 0.8);
  }

  function drawOver(ctx: CanvasRenderingContext2D, state: GameState, ui: RenderUi) {
    if (!theme) return;
    const t = Math.min(1, state.statusAge / 350);
    const ease = 1 - (1 - t) * (1 - t) * (1 - t);
    ctx.globalAlpha = ease;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(0, 0, width, height);
    const { card, button, wide } = overLayout(width, height);
    ctx.save();
    ctx.translate(0, (1 - ease) * 12);
    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.roundRect(card.x, card.y, card.w, card.h, 12);
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    const title = clamp(card.h * 0.17, 14, 22);
    const reason = REASONS[state.deathReason ?? "obstacle"];
    const newBest = state.score > 0 && state.score >= state.best;
    ctx.textBaseline = "middle";
    const titleY = card.y + 12 + title / 2;
    fitFont(ctx, reason, 900, title, card.w - 32 - (newBest ? 90 : 0), true);
    const titleW = ctx.measureText(reason).width;
    const badge = title * 0.55;
    const titleX = wide
      ? card.x + 16
      : card.x + (card.w - titleW - (newBest ? badge * 7.5 : 0)) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = theme.foreground;
    ctx.fillText(reason, titleX, titleY);
    if (newBest) {
      ctx.font = fontOf(900, badge);
      const bw = ctx.measureText("NEW BEST").width + badge * 1.4;
      const bx = titleX + titleW + 8;
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.roundRect(bx, titleY - badge * 0.85, bw, badge * 1.7, badge * 0.85);
      ctx.fill();
      ctx.fillStyle = theme.accentForeground;
      ctx.fillText("NEW BEST", bx + badge * 0.7, titleY + 0.5);
    }
    const stats: ReadonlyArray<readonly [string, string]> = [
      ["Score", String(state.score)],
      ["Best", String(state.best)],
      ["Kills", String(state.kills)],
    ];
    const statsW = wide ? card.w - button.w - 48 : card.w - 24;
    const statsX = card.x + (wide ? 16 : 12);
    const value = clamp(card.h * 0.15, 13, 20);
    const label = clamp(value * 0.55, 9, 11);
    const statsY = wide ? card.y + card.h * 0.6 : card.y + card.h * 0.42;
    const col = statsW / stats.length;
    const th = theme;
    stats.forEach(([name, amount], i) => {
      const sx = statsX + col * i + (wide ? 0 : col / 2);
      ctx.textAlign = wide ? "left" : "center";
      ctx.font = fontOf(800, value);
      ctx.fillStyle = i === 0 ? th.accent : th.foreground;
      ctx.fillText(amount, sx, statsY);
      ctx.font = fontOf(600, label);
      ctx.fillStyle = th.muted;
      ctx.fillText(name, sx, statsY + value * 0.95);
    });
    const ready = state.statusAge > 450;
    const pressed = ui.pressButton && ready;
    const hovered = ui.hoverButton && ready;
    const by = button.y + (pressed ? 1.5 : 0);
    ctx.fillStyle = theme.accent;
    if (!pressed) {
      ctx.globalAlpha = ease * 0.45;
      ctx.beginPath();
      ctx.roundRect(button.x, button.y + 2.5, button.w, button.h, button.h / 2);
      ctx.fill();
    }
    ctx.globalAlpha = ease * (ready ? 1 : 0.6);
    ctx.beginPath();
    ctx.roundRect(button.x, by, button.w, button.h, button.h / 2);
    ctx.fill();
    if (hovered && !pressed) {
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fill();
    }
    const fs = clamp(button.h * 0.42, 11, 15);
    ctx.font = fontOf(800, fs);
    const text = "Restart";
    const lw = ctx.measureText(text).width;
    const sx = button.x + (button.w - lw - fs * 1.2) / 2;
    const cy = by + button.h / 2;
    ctx.strokeStyle = theme.accentForeground;
    ctx.fillStyle = theme.accentForeground;
    ctx.lineWidth = Math.max(1.4, fs * 0.13);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(sx + fs * 0.4, cy, fs * 0.33, -0.4, Math.PI * 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + fs * 0.4 + fs * 0.42, cy - fs * 0.32);
    ctx.lineTo(sx + fs * 0.4 + fs * 0.34, cy + fs * 0.02);
    ctx.lineTo(sx + fs * 0.4 + fs * 0.06, cy - fs * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = "butt";
    ctx.textAlign = "left";
    ctx.fillText(text, sx + fs * 1.2, cy + 0.5);
    if (wide) {
      ctx.globalAlpha = ease;
      ctx.font = fontOf(500, label);
      ctx.fillStyle = theme.muted;
      ctx.textAlign = "center";
      ctx.fillText("or press Space", button.x + button.w / 2, button.y - label);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  return {
    setTheme(next: MiniGameTheme) {
      theme = next;
      accent = resolveRgb(next.accent, accent);
      paletteKey = -1;
    },
    setFont(next: string) {
      font = next;
    },
    resize(nextWidth: number, nextHeight: number, nextRatio: number) {
      const changed = nextWidth !== width || nextHeight !== height || nextRatio !== ratio;
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio > 0 ? nextRatio : 1;
      if (changed || layers.length === 0) bake();
    },
    draw(ctx: CanvasRenderingContext2D, state: GameState, fx: Fx, ui: RenderUi) {
      if (width <= 0 || height <= 0) {
        const r = ratio || 1;
        width = ctx.canvas.width / r;
        height = ctx.canvas.height / r;
        bake();
      }
      if (!sprites || width <= 0 || height <= 0) return;
      const s = height / VIEW_H;
      view.s = s;
      const camX = fx.camX;
      const camY = fx.camY;
      view.left = camX - 30;
      view.right = camX + width / s + 30;
      view.top = camY;
      view.bottom = camY + VIEW_H + 6;
      const phase = (((state.time % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
      ensureSky(ctx, Math.floor(phase * BUCKETS));
      ensureStatic(ctx);
      const depth = clamp((camY - CAM_STREET) / (CAM_SEWER - CAM_STREET), 0, 1);
      const p = ensurePalette(ctx, depth);
      const time = fx.time;

      ctx.save();
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      const { a, b, t } = skyPair(phase);
      const elev = lerp(a.sun, b.sun, t);
      drawSky(ctx, phase, elev, camX);
      drawLayers(ctx, camX, camY);
      const bloom = clamp((elev + 0.15) / 0.3, 0, 1) * (1 - depth);
      if (bloom > 0.01) {
        const sx = width * (phase < 0.55 ? 0.74 : 0.26);
        const sy = height * (0.66 - elev * 1.2);
        const r = height * 0.6;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = bloom * 0.22;
        ctx.drawImage(sprites.sun, sx - r, sy - r, r * 2, r * 2);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      if (depth > 0.01) {
        ctx.fillStyle = "rgb(6,8,8)";
        ctx.globalAlpha = Math.min(0.95, depth * 1.1);
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }

      ctx.save();
      ctx.scale(s, s);
      ctx.translate(-camX + fx.shakeX, -camY + fx.shakeY);
      const segs = state.segments;
      drawUnderlay(ctx, p, segs, time);
      drawBackDecor(ctx, p, state);
      drawTerrain(ctx, p, segs);
      drawDecals(ctx, p, fx);
      drawDecor(ctx, p, state, time);
      drawRails(ctx, p, state);
      drawObstacles(ctx, p, state);
      drawPickups(ctx, p, state, time);
      drawEnemies(ctx, p, state);
      const crashed = fx.body.active;
      if (crashed) drawRagdoll(ctx, p, fx.body, fx.board);
      else {
        if (state.status === "running") drawSpeedLines(ctx, state.rider, fx);
        drawRider(ctx, p, sprites, state.rider, fx);
      }
      drawBullets(ctx, state);
      drawParticles(ctx, p, fx);
      drawLights(ctx, state, depth);
      ctx.restore();

      if (vignette) screenFill(ctx, vignette, Math.max(depth * 0.9, tod.night * 0.35, 0.14));
      if (redVignette && fx.hurt > 0) screenFill(ctx, redVignette, fx.hurt * 0.8);
      if (fx.flash > 0) {
        ctx.globalAlpha = fx.flash * 0.3;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }
      drawTexts(ctx, fx);
      if (state.status === "ready") drawReady(ctx, state, ui);
      else if (state.status === "over") drawOver(ctx, state, ui);
      drawHud(ctx, state, ui);
      ctx.restore();
    },
  };
}

let probe: CanvasRenderingContext2D | null = null;

function resolveRgb(colour: string, fallback: Rgb): Rgb {
  if (typeof document === "undefined") return fallback;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = colour;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? fallback[0], d[1] ?? fallback[1], d[2] ?? fallback[2]];
}

export type Renderer = ReturnType<typeof createRenderer>;
