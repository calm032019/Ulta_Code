import {
  CULL_BEHIND,
  GEN_AHEAD,
  MAX_HP,
  RIDER_H,
  ROOF_Y,
  SEWER_CEILING,
  SEWER_Y,
  type Bullet,
  type Decor,
  type DecorKind,
  type Enemy,
  type EnemyKind,
  type EnemyState,
  type GameEvent,
  type GameState,
  type Obstacle,
  type ObstacleKind,
  type Pickup,
  type PickupKind,
  type Rail,
  type RailKind,
  type Rider,
  type Segment,
  type StepInput,
  type Zone,
} from "./model";

const GRAVITY = 900;
const JUMP_SPEED = 330;
const JUMP_HOLD_MS = 180;
const JUMP_HOLD_GRAVITY = 0.45;
const START_SPEED = 140;
const CRUISE_START = 200;
const CRUISE_END = 430;
const CRUISE_RAMP_MS = 180_000;
const PUSH = 1.4;
const OVERSPEED_DRAG = 0.3;
const ROLL_FRICTION = 8;
/** Riders pump uphill, so climbs feel only this share of gravity; downhills get all of it. */
const UPHILL_GRAVITY = 0.4;
const MIN_SPEED = 40;
const MAX_SPEED = 620;
const LAUNCH_TURN = 0.6;
const SPIN_DELAY_MS = 60;
const SPIN_ACCEL = 45;
const SPIN_MAX = 8.5;
const SPIN_DAMP_MS = 90;
const BOARD_EASE_MS = 45;
const CLEAN_LANDING = 0.6;
const CRASH_LANDING = 1.1;
const LAND_EVENT_MIN_AIR_MS = 120;
const TRICK_POINTS = 150;
const TRICK_BOOST = 40;
const SLOPPY_SPEED = 0.7;
const KNOCK_SPEED = 0.88;
const FALL_DEPTH = 260;
const WALL_TOLERANCE = 16;
const RIDER_HALF_W = 6;
const CHEST = 14;

const START_AMMO = 12;
const MAX_AMMO = 24;
const AMMO_CRATE = 6;
const SHOT_COOLDOWN_MS = 160;
const BULLET_SPEED = 900;
const BULLET_LIFE_MS = 700;
const AIM_RANGE = 320;
const AIM_CONE = 0.6;
const SLASH_COOLDOWN_MS = 300;
const SLASH_ACTIVE_MS = 150;
const SLASH_RANGE = 34;
const SLASH_DAMAGE = 2;
const INVULN_MS = 1000;
const COMBO_DECAY_MS = 4000;
const RESTART_DELAY_MS = 450;
const GRIND_POINTS_PER_S = 40;
const TOKEN_POINTS = 25;
const PICKUP_RADIUS = 16;
const AGE_CAP_MS = 60_000;

const THUG_SIGHT = 260;
const THUG_SPEED = 120;
const THUG_REACH = 22;
const STAB_FROM_MS = 50;
const STAB_TO_MS = 220;
const STAB_RECOVER_MS = 420;
const GUN_SIGHT = 420;
const GUN_AIM_MS = 650;
const GUN_COOLDOWN_MS = 1100;
const ENEMY_BULLET_SPEED = 420;
const ENEMY_BULLET_LIFE_MS = 1600;
const RAT_SIGHT = 360;
const RAT_SPEED = 70;
const ENEMY_HP: Record<EnemyKind, number> = { thug: 2, gunman: 2, rat: 1 };
const ENEMY_H: Record<EnemyKind, number> = { thug: 26, gunman: 26, rat: 7 };
const KILL_POINTS: Record<EnemyKind, number> = { thug: 200, gunman: 300, rat: 75 };
const MAX_ENEMIES = 24;
const MAX_BULLETS = 48;

const SEG_LEN = 16;
const CALM_START = 500;
const ZONE_MIN = 1200;
const ZONE_MAX = 2500;
const DIFFICULTY_DISTANCE = 25_000;
const SNAPSHOT_VERSION = 1;

type Mut<T> = { -readonly [K in keyof T]: T[K] };
type Reason = NonNullable<GameEvent["reason"]>;

type Work = Mut<
  Omit<
    GameState,
    | "rider"
    | "segments"
    | "rails"
    | "obstacles"
    | "decor"
    | "enemies"
    | "bullets"
    | "pickups"
    | "events"
  >
> & {
  rider: Mut<Rider>;
  segments: Segment[];
  rails: Rail[];
  obstacles: Obstacle[];
  decor: Decor[];
  enemies: Mut<Enemy>[];
  bullets: Mut<Bullet>[];
  pickups: Pickup[];
  events: GameEvent[];
};

function rand(w: Work): number {
  let t = (w.rng = (w.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (w: Work, min: number, max: number) => min + (max - min) * rand(w);
const chance = (w: Work, p: number) => rand(w) < p;
const seedOf = (w: Work) => Math.floor(rand(w) * 1e9);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function normAngle(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
}

function ease(current: number, target: number, dtMs: number, tauMs: number): number {
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

function cruiseSpeed(timeMs: number): number {
  const u = Math.min(1, timeMs / CRUISE_RAMP_MS);
  return CRUISE_START + (CRUISE_END - CRUISE_START) * (1 - (1 - u) * (1 - u));
}

const difficulty = (x: number) => clamp(x / DIFFICULTY_DISTANCE, 0, 1);

function segIndex(segs: ReadonlyArray<Segment>, x: number): number {
  const last = segs.length - 1;
  if (last < 0 || x < segs[0]!.x0 || x > segs[last]!.x1) return -1;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid]!.x0 <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const segY = (s: Segment, x: number) => s.y0 + ((s.y1 - s.y0) * (x - s.x0)) / (s.x1 - s.x0);
const segAngle = (s: Segment) => Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
const railY = (r: Rail, x: number) => r.y0 + ((r.y1 - r.y0) * (x - r.x0)) / (r.x1 - r.x0);
const railAngle = (r: Rail) => Math.atan2(r.y1 - r.y0, r.x1 - r.x0);

function groundY(segs: ReadonlyArray<Segment>, x: number): number | null {
  const s = segs[segIndex(segs, x)];
  return s && !s.gap ? segY(s, x) : null;
}

/** Ground height under x, or the lower edge of a gap, for fall and ceiling checks. */
function floorRef(segs: ReadonlyArray<Segment>, x: number): Segment | undefined {
  return segs[segIndex(segs, x)];
}

/** Averaged slope so stairs and small kinks judge landings by the line, not each step. */
function slopeAt(segs: ReadonlyArray<Segment>, x: number, fallback: number): number {
  const a = groundY(segs, x - 8);
  const b = groundY(segs, x + 8);
  return a === null || b === null ? fallback : Math.atan2(b - a, 16);
}

export function groundAt(state: GameState, x: number): { y: number; zone: Zone } | null {
  const s = state.segments[segIndex(state.segments, x)];
  return s && !s.gap ? { y: segY(s, x), zone: s.zone } : null;
}

export function scoreOf(state: GameState): number {
  return Math.floor(Math.max(0, state.rider.x) / 10 + state.score);
}

const lastY = (w: Work) => w.segments[w.segments.length - 1]!.y1;

function addSeg(w: Work, x1: number, y1: number, zone: Zone, gap = false): void {
  w.segments.push({ x0: w.genX, y0: lastY(w), x1, y1, zone, gap });
  w.genX = x1;
}

function path(
  w: Work,
  len: number,
  zone: Zone | ((y: number) => Zone),
  yAt: (t: number) => number,
  step = SEG_LEN,
): void {
  const x0 = w.genX;
  const n = Math.max(1, Math.round(len / step));
  for (let i = 1; i <= n; i++) {
    const y = yAt(i / n);
    addSeg(w, x0 + (len * i) / n, y, typeof zone === "string" ? zone : zone((lastY(w) + y) / 2));
  }
}

function flat(w: Work, len: number, zone: Zone): void {
  const y = lastY(w);
  path(w, len, zone, () => y, 24);
}

function easeTo(w: Work, len: number, y1: number, zone: Zone | ((y: number) => Zone)): void {
  const y0 = lastY(w);
  path(w, len, zone, (t) => y0 + (y1 - y0) * t * t * (3 - 2 * t));
}

/** A smooth hill (h > 0) or dip (h < 0) that returns to the starting height. */
function hump(w: Work, len: number, h: number, zone: Zone): void {
  const y0 = lastY(w);
  path(w, len, zone, (t) => y0 - (h * (1 - Math.cos(2 * Math.PI * t))) / 2);
}

function addDecor(w: Work, kind: DecorKind, x: number): void {
  const y = groundY(w.segments, x);
  if (y !== null) w.decor.push({ id: w.nextId++, kind, x, y, seed: seedOf(w) });
}

const OBSTACLE_SIZE: Record<ObstacleKind, readonly [number, number]> = {
  taxi: [58, 20],
  barrier: [8, 16],
  cone: [7, 11],
  trash: [11, 15],
  hydrant: [7, 12],
};

function addObstacle(w: Work, kind: ObstacleKind, x: number): Obstacle | null {
  const y = groundY(w.segments, x);
  if (y === null) return null;
  const [ow, oh] = OBSTACLE_SIZE[kind];
  const o: Obstacle = { id: w.nextId++, kind, x, y, w: ow, h: oh, hit: false, seed: seedOf(w) };
  w.obstacles.push(o);
  return o;
}

function addRail(w: Work, kind: RailKind, x0: number, y0: number, x1: number, y1: number): void {
  w.rails.push({ id: w.nextId++, kind, x0, y0, x1, y1 });
}

function addEnemy(w: Work, kind: EnemyKind, x: number): void {
  if (w.enemies.length >= MAX_ENEMIES) return;
  const y = groundY(w.segments, x);
  if (y === null) return;
  w.enemies.push({
    id: w.nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    facing: -1,
    hp: ENEMY_HP[kind],
    state: "idle",
    stateAge: 0,
    aim: 0,
    seed: seedOf(w),
  });
}

function addPickup(w: Work, kind: PickupKind, x: number, y: number): void {
  w.pickups.push({ id: w.nextId++, kind, x, y, taken: false });
}

function tokenRow(w: Work, x0: number, x1: number, lift = 14): void {
  for (let x = x0; x <= x1; x += 28) {
    const y = groundY(w.segments, x);
    if (y !== null) addPickup(w, "token", x, y - lift);
  }
}

/** Tokens on the chest line of a jump taken just before `x` at speed `v`. */
function tokenArc(w: Work, x: number, y: number, v: number, vy = -JUMP_SPEED): void {
  for (let k = 0; k < 5; k++) {
    const t = 0.12 + k * 0.12;
    addPickup(w, "token", x - v * 0.05 + v * t, y + vy * t + 0.5 * GRAVITY * t * t - 12);
  }
}

function maybeAmmo(w: Work, x: number): void {
  if (!chance(w, 0.2)) return;
  const y = groundY(w.segments, x);
  if (y !== null) addPickup(w, "ammo", x, y - 9);
}

const STREET_DECOR: ReadonlyArray<DecorKind> = [
  "trafficLight",
  "subwaySign",
  "steam",
  "fireEscape",
  "graffiti",
  "graffiti",
];
const ROOF_DECOR: ReadonlyArray<DecorKind> = [
  "acUnit",
  "acUnit",
  "waterTower",
  "antenna",
  "billboard",
];
const SEWER_DECOR: ReadonlyArray<DecorKind> = ["drip", "grate", "graffiti", "drip"];

function scatterDecor(w: Work, x0: number, x1: number, zone: Zone): void {
  const pool = zone === "street" ? STREET_DECOR : zone === "roof" ? ROOF_DECOR : SEWER_DECOR;
  let x = x0 + range(w, 10, 60);
  while (x < x1) {
    if (zone === "street" && chance(w, 0.45)) addDecor(w, "lamp", x);
    else if (zone === "sewer" && chance(w, 0.4)) addDecor(w, "sewerLamp", x);
    else addDecor(w, pool[Math.floor(rand(w) * pool.length)]!, x);
    x += range(w, 70, 160);
  }
}

function gapWidth(w: Work, d: number, min: number, max: number, drop: number): number {
  const v = cruiseSpeed(w.time) * 0.9;
  const flight = (JUMP_SPEED + Math.sqrt(JUMP_SPEED * JUMP_SPEED + 2 * GRAVITY * drop)) / GRAVITY;
  const reach = v * flight * 0.55;
  const want = min + (max - min) * clamp(d * 0.8 + rand(w) * 0.35, 0, 1);
  return Math.max(min, Math.min(want, reach));
}

type Feature = (w: Work, d: number) => void;

function pick(w: Work, options: ReadonlyArray<readonly [number, Feature]>, d: number): void {
  let total = 0;
  for (const [weight] of options) total += weight;
  let roll = rand(w) * total;
  for (const [weight, feature] of options) {
    roll -= weight;
    if (roll <= 0) return feature(w, d);
  }
  options[options.length - 1]![1](w, d);
}

const streetFlat: Feature = (w) => {
  const x0 = w.genX;
  flat(w, range(w, 160, 300), "street");
  if (chance(w, 0.4)) tokenRow(w, x0 + 60, x0 + 150);
  maybeAmmo(w, x0 + 120);
  scatterDecor(w, x0, w.genX, "street");
};

const streetHill: Feature = (w) => {
  const x0 = w.genX;
  const y0 = lastY(w);
  const len = range(w, 220, 380);
  if (y0 > 25 || y0 < -25 || chance(w, 0.4)) {
    easeTo(w, len, clamp(range(w, -20, 20), y0 - 0.25 * len, y0 + 0.25 * len), "street");
  } else {
    const h = range(w, 15, Math.min(55, (len * 0.45) / Math.PI)) * (chance(w, 0.6) ? 1 : -1);
    hump(w, len, h, "street");
    if (h > 25 && chance(w, 0.5)) tokenRow(w, x0 + len * 0.4, x0 + len * 0.6, 24);
  }
  scatterDecor(w, x0, w.genX, "street");
};

const streetCurb: Feature = (w) => {
  const x0 = w.genX;
  flat(w, 50, "street");
  const y = lastY(w);
  path(w, 6, "street", (t) => y - 5 * t, 6);
  flat(w, range(w, 18, 40), "street");
  path(w, 6, "street", (t) => y - 5 + 5 * t, 6);
  flat(w, 80, "street");
  scatterDecor(w, x0, w.genX, "street");
};

const streetKicker: Feature = (w) => {
  const x0 = w.genX;
  flat(w, 80, "street");
  const y = lastY(w);
  const h = range(w, 16, 28);
  const len = range(w, 60, 80);
  path(w, len, "street", (t) => y - h * t * t, 10);
  const lipX = w.genX;
  addSeg(w, lipX + 6, y, "street");
  const v = cruiseSpeed(w.time);
  const lip = Math.atan2(2 * h, len);
  tokenArc(w, lipX + v * 0.05, y - h, v * Math.cos(lip), -v * Math.sin(lip) - JUMP_SPEED * 0.6);
  flat(w, 220, "street");
  scatterDecor(w, x0, w.genX, "street");
};

const streetTaxi: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, range(w, 240, 300), "street");
  const taxi = addObstacle(w, "taxi", x0 + range(w, 90, 130));
  if (taxi) {
    const top = taxi.y - taxi.h;
    addRail(w, "car", taxi.x - 2, top, taxi.x + taxi.w + 2, top);
    tokenRow(w, taxi.x + 8, taxi.x + taxi.w - 4, taxi.h + 14);
    if (d > 0.4 && chance(w, 0.35)) addEnemy(w, "thug", taxi.x + taxi.w + 90);
  }
  scatterDecor(w, x0, w.genX, "street");
};

const streetStairs: Feature = (w) => {
  const x0 = w.genX;
  flat(w, 70, "street");
  const xTop = w.genX;
  const yTop = lastY(w);
  const steps = Math.floor(range(w, 4, 8));
  for (let i = 0; i < steps; i++) {
    const y = lastY(w);
    addSeg(w, w.genX + 3, y + 6, "street");
    addSeg(w, w.genX + 16, y + 6, "street");
  }
  const slope = 6 / 19;
  const railX0 = xTop - 10;
  const railX1 = xTop + (steps - 1) * 19 + 10;
  const railAt = (x: number) => yTop - 14 + (x - xTop) * slope;
  addRail(w, "rail", railX0, railAt(railX0), railX1, railAt(railX1));
  for (let x = railX0 + 10; x < railX1; x += 26) addPickup(w, "token", x, railAt(x) - 13);
  flat(w, 160, "street");
  scatterDecor(w, x0, xTop - 20, "street");
};

const streetClutter: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, range(w, 260, 340), "street");
  const kinds: ReadonlyArray<ObstacleKind> = ["cone", "cone", "trash", "hydrant"];
  let x = x0 + range(w, 60, 90);
  const count = 1 + Math.floor(range(w, 1, 3 + d * 2));
  for (let i = 0; i < count && x < w.genX - 60; i++) {
    const kind = chance(w, 0.15 + d * 0.3) ? "barrier" : kinds[Math.floor(rand(w) * kinds.length)]!;
    addObstacle(w, kind, x);
    x += range(w, 60, 110);
  }
  scatterDecor(w, x0, w.genX, "street");
};

const streetThug: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, range(w, 300, 360), "street");
  addEnemy(w, "thug", x0 + range(w, 220, 270));
  if (d > 0.5 && chance(w, 0.4)) addEnemy(w, "thug", x0 + 300);
  maybeAmmo(w, x0 + 80);
  scatterDecor(w, x0, w.genX, "street");
};

const streetGunman: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, range(w, 340, 400), "street");
  addEnemy(w, "gunman", x0 + range(w, 280, 320));
  if (d > 0.6 && chance(w, 0.35)) addEnemy(w, "thug", x0 + 200);
  maybeAmmo(w, x0 + 100);
  scatterDecor(w, x0, w.genX, "street");
};

function streetFeature(w: Work, d: number): void {
  pick(
    w,
    [
      [1, streetFlat],
      [1, streetHill],
      [0.5, streetCurb],
      [0.8, streetKicker],
      [0.7, streetTaxi],
      [0.6, streetStairs],
      [0.4 + 0.8 * d, streetClutter],
      [0.3 + 0.9 * d, streetThug],
      [0.1 + 0.9 * d, streetGunman],
    ],
    d,
  );
}

const roofFlat: Feature = (w) => {
  const x0 = w.genX;
  flat(w, range(w, 180, 300), "roof");
  if (chance(w, 0.35)) tokenRow(w, x0 + 50, x0 + 140);
  maybeAmmo(w, x0 + 100);
  scatterDecor(w, x0, w.genX, "roof");
};

const roofGap: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, 180, "roof");
  scatterDecor(w, x0, w.genX - 40, "roof");
  const y = lastY(w);
  const drop = y < ROOF_Y + 40 ? range(w, 0, 30) : 0;
  const width = gapWidth(w, d, 60, 150, drop);
  const edge = w.genX;
  addSeg(w, edge + width, y + drop, "roof", true);
  tokenArc(w, edge, y, cruiseSpeed(w.time) * 0.9);
  const far = w.genX;
  flat(w, 280, "roof");
  if (chance(w, 0.15 + 0.6 * d)) addEnemy(w, "gunman", far + range(w, 190, 250));
  scatterDecor(w, far + 160, w.genX, "roof");
};

const roofLedge: Feature = (w) => {
  const x0 = w.genX;
  flat(w, range(w, 260, 320), "roof");
  const y = lastY(w) - 10;
  const lx0 = x0 + 50;
  const lx1 = x0 + range(w, 180, 240);
  addRail(w, "ledge", lx0, y, lx1, y);
  for (let x = lx0 + 10; x < lx1; x += 28) addPickup(w, "token", x, y - 13);
  scatterDecor(w, lx1 + 20, w.genX, "roof");
};

const roofRise: Feature = (w) => {
  const x0 = w.genX;
  const dy = Math.max(15, (lastY(w) - ROOF_Y) * range(w, 0.6, 1));
  easeTo(w, Math.max(200, dy * 6), lastY(w) - dy, "roof");
  flat(w, 100, "roof");
  scatterDecor(w, x0, w.genX, "roof");
};

const roofStepDown: Feature = (w) => {
  const x0 = w.genX;
  flat(w, 120, "roof");
  const y = lastY(w);
  addSeg(w, w.genX + 6, y + range(w, 25, 45), "roof");
  flat(w, 200, "roof");
  scatterDecor(w, x0, w.genX, "roof");
};

const roofGunman: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, range(w, 320, 380), "roof");
  addEnemy(w, "gunman", x0 + range(w, 260, 300));
  if (d > 0.5 && chance(w, 0.3)) addEnemy(w, "gunman", x0 + 340);
  maybeAmmo(w, x0 + 80);
  scatterDecor(w, x0, w.genX, "roof");
};

const roofThug: Feature = (w) => {
  const x0 = w.genX;
  flat(w, 320, "roof");
  addEnemy(w, "thug", x0 + range(w, 220, 260));
  scatterDecor(w, x0, w.genX, "roof");
};

function roofFeature(w: Work, d: number): void {
  if (lastY(w) > ROOF_Y + 50) return roofRise(w, d);
  pick(
    w,
    [
      [1.2 + 0.4 * d, roofGap],
      [0.8, roofFlat],
      [0.7, roofLedge],
      [0.4, roofStepDown],
      [0.2 + 0.9 * d, roofGunman],
      [0.1 + 0.4 * d, roofThug],
    ],
    d,
  );
}

const sewerTunnel: Feature = (w) => {
  const x0 = w.genX;
  easeTo(
    w,
    range(w, 180, 280),
    clamp(lastY(w) + range(w, -8, 8), SEWER_Y - 10, SEWER_Y + 10),
    "sewer",
  );
  if (chance(w, 0.35)) tokenRow(w, x0 + 50, x0 + 140);
  maybeAmmo(w, x0 + 120);
  scatterDecor(w, x0, w.genX, "sewer");
};

const sewerChannel: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, 140, "sewer");
  scatterDecor(w, x0, w.genX - 30, "sewer");
  const y = lastY(w);
  const width = gapWidth(w, d, 40, 90, 0);
  const edge = w.genX;
  addSeg(w, edge + width, y, "sewer", true);
  if (chance(w, 0.35)) {
    addRail(w, "pipe", edge - 60, y - 18, w.genX + 60, y - 18);
    for (let x = edge - 50; x < w.genX + 60; x += 28) addPickup(w, "token", x, y - 31);
  } else {
    tokenArc(w, edge, y, cruiseSpeed(w.time) * 0.9);
  }
  flat(w, 160, "sewer");
};

const sewerPipe: Feature = (w) => {
  const x0 = w.genX;
  flat(w, range(w, 260, 320), "sewer");
  const y = lastY(w) - range(w, 16, 22);
  const px0 = x0 + 40;
  const px1 = x0 + range(w, 180, 240);
  addRail(w, "pipe", px0, y, px1, y);
  for (let x = px0 + 10; x < px1; x += 28) addPickup(w, "token", x, y - 13);
  scatterDecor(w, x0, w.genX, "sewer");
};

const sewerRats: Feature = (w, d) => {
  const x0 = w.genX;
  flat(w, range(w, 260, 320), "sewer");
  const count = 1 + Math.floor(range(w, 0, 1.5 + d * 2));
  for (let i = 0; i < count; i++) addEnemy(w, "rat", x0 + 160 + i * range(w, 30, 60));
  scatterDecor(w, x0, w.genX, "sewer");
};

const sewerThug: Feature = (w) => {
  const x0 = w.genX;
  flat(w, 320, "sewer");
  addEnemy(w, "thug", x0 + range(w, 220, 260));
  scatterDecor(w, x0, w.genX, "sewer");
};

function sewerFeature(w: Work, d: number): void {
  pick(
    w,
    [
      [1, sewerTunnel],
      [1 + 0.3 * d, sewerChannel],
      [0.8, sewerPipe],
      [0.5 + 0.6 * d, sewerRats],
      [0.15 + 0.3 * d, sewerThug],
    ],
    d,
  );
}

const sewerDepth = (y: number): Zone => (y >= SEWER_CEILING ? "sewer" : "street");

function transition(w: Work): void {
  const x0 = w.genX;
  if (w.genZone === "street") {
    if (chance(w, 0.55)) {
      flat(w, 150, "street");
      scatterDecor(w, x0, w.genX, "street");
      easeTo(w, 740, ROOF_Y, "street");
      w.genZone = "roof";
      const roof = w.genX;
      flat(w, 420, "roof");
      scatterDecor(w, roof + 60, w.genX, "roof");
    } else {
      flat(w, 120, "street");
      scatterDecor(w, x0, w.genX, "street");
      easeTo(w, 560, SEWER_Y, sewerDepth);
      w.genZone = "sewer";
      const sewer = w.genX;
      flat(w, 300, "sewer");
      scatterDecor(w, sewer, w.genX, "sewer");
    }
    return;
  }
  if (w.genZone === "roof") {
    flat(w, 120, "roof");
    scatterDecor(w, x0, w.genX - 30, "roof");
    const mid = lastY(w) / 2;
    addSeg(w, w.genX + 10, mid, "roof");
    path(w, 520, "street", (t) => mid - mid * t * (2 - t));
  } else {
    flat(w, 150, "sewer");
    scatterDecor(w, x0, w.genX, "sewer");
    easeTo(w, 620, 0, sewerDepth);
  }
  w.genZone = "street";
  const street = w.genX;
  flat(w, 300, "street");
  scatterDecor(w, street, w.genX, "street");
}

function zoneStart(w: Work): number {
  const segs = w.segments;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i]!.zone !== w.genZone) return segs[i]!.x1;
  }
  return Math.max(0, segs[0]!.x0);
}

function generate(w: Work): void {
  while (w.genX < w.rider.x + GEN_AHEAD) {
    const run = w.genX - zoneStart(w);
    if (run > ZONE_MAX || (run > ZONE_MIN && chance(w, 0.3))) {
      transition(w);
      continue;
    }
    const d = difficulty(w.genX);
    if (w.genZone === "street") streetFeature(w, d);
    else if (w.genZone === "roof") roofFeature(w, d);
    else sewerFeature(w, d);
  }
}

export function initialState(seed: number, best = 0, muted = false): GameState {
  const w: Work = {
    version: SNAPSHOT_VERSION,
    seed: seed >>> 0,
    rng: seed >>> 0,
    status: "ready",
    statusAge: 0,
    time: 0,
    score: 0,
    best,
    combo: 1,
    comboAge: 0,
    ammo: START_AMMO,
    kills: 0,
    muted,
    deathReason: null,
    rider: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      spin: 0,
      grounded: true,
      railId: null,
      hp: MAX_HP,
      invuln: 0,
      slashAge: AGE_CAP_MS,
      shotAge: AGE_CAP_MS,
      shotAim: 0,
      airTime: 0,
      flips: 0,
      tucked: false,
    },
    segments: [
      { x0: -CULL_BEHIND, y0: 0, x1: -CULL_BEHIND + 24, y1: 0, zone: "street", gap: false },
    ],
    rails: [],
    obstacles: [],
    decor: [],
    enemies: [],
    bullets: [],
    pickups: [],
    genX: -CULL_BEHIND + 24,
    genZone: "street",
    nextId: 1,
    events: [],
  };
  flat(w, CALM_START + CULL_BEHIND - 24, "street");
  scatterDecor(w, -CULL_BEHIND, CALM_START, "street");
  generate(w);
  return w;
}

export function toggleMute(state: GameState): GameState {
  return { ...state, muted: !state.muted, events: [] };
}

function restart(w: Work): GameState {
  const seed = Math.floor(rand(w) * 4294967296);
  const next = initialState(seed, w.best, w.muted);
  return {
    ...next,
    status: "running",
    rider: { ...next.rider, vx: START_SPEED },
    events: [{ kind: "start", x: next.rider.x, y: next.rider.y }],
  };
}

/** Copies what a running step may change, dropping anything left behind the rider. */
function workFrom(state: GameState): Work {
  const limit = state.rider.x - CULL_BEHIND;
  let first = 0;
  while (first < state.segments.length - 1 && state.segments[first]!.x1 < limit) first++;
  return {
    ...state,
    rider: { ...state.rider },
    segments: state.segments.slice(first),
    rails: state.rails.filter((r) => r.x1 >= limit),
    obstacles: state.obstacles.filter((o) => o.x + o.w >= limit),
    decor: state.decor.filter((d) => d.x >= limit - 60),
    enemies: state.enemies.filter((e) => e.x >= limit).map((e) => ({ ...e })),
    bullets: state.bullets.map((b) => ({ ...b })),
    pickups: state.pickups.filter((p) => p.x >= limit),
    events: [],
  };
}

function crash(w: Work, reason: Reason): void {
  if (w.status !== "running") return;
  const r = w.rider;
  w.status = "over";
  w.statusAge = 0;
  w.deathReason = reason;
  r.vx = 0;
  r.vy = 0;
  r.spin = 0;
  w.events.push({ kind: "crash", x: r.x, y: r.y, reason });
  w.events.push({ kind: "over", x: r.x, y: r.y, reason });
  w.best = Math.max(w.best, scoreOf(w));
}

function hurt(w: Work, reason: Reason, dx: number, dy: number): void {
  const r = w.rider;
  if (r.invuln > 0 || w.status !== "running") return;
  r.hp -= 1;
  r.invuln = INVULN_MS;
  w.combo = 1;
  w.events.push({ kind: "hurt", x: r.x, y: r.y - CHEST, dx, dy, reason });
  if (r.hp <= 0) crash(w, reason);
}

function alongSpeed(w: Work, s: number, sin: number, dt: number): number {
  const cruise = cruiseSpeed(w.time);
  let a = GRAVITY * sin * (sin < 0 ? UPHILL_GRAVITY : 1) - ROLL_FRICTION;
  a += s < cruise ? PUSH * (cruise - s) : -OVERSPEED_DRAG * (s - cruise);
  return clamp(s + a * dt, MIN_SPEED, MAX_SPEED);
}

function leaveGround(r: Mut<Rider>): void {
  r.grounded = false;
  r.railId = null;
  r.airTime = 0;
  r.flips = 0;
  r.spin = 0;
}

function currentRail(w: Work): Rail | undefined {
  const id = w.rider.railId;
  return id === null ? undefined : w.rails.find((rail) => rail.id === id);
}

function jump(w: Work): void {
  const r = w.rider;
  const rail = currentRail(w);
  const seg = w.segments[segIndex(w.segments, r.x)];
  const th = rail ? railAngle(rail) : seg && !seg.gap ? segAngle(seg) : 0;
  let nx = Math.sin(th);
  const ny = -Math.cos(th);
  // Jumping off an up-slope along the true normal would brake hard; keep most of the speed.
  if (nx < 0) nx *= 0.25;
  r.vx += JUMP_SPEED * nx;
  r.vy += JUMP_SPEED * ny;
  leaveGround(r);
  w.events.push({ kind: "jump", x: r.x, y: r.y, dx: nx, dy: ny });
}

function land(w: Work, check: number, th: number, rail: Rail | null): void {
  const r = w.rider;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const impact = Math.abs(-r.vx * sin + r.vy * cos);
  let s = Math.max(MIN_SPEED, r.vx * cos + r.vy * sin);
  const diff = normAngle(r.angle - check);
  const flips = r.flips;
  const air = r.airTime;
  r.grounded = true;
  r.railId = rail ? rail.id : null;
  r.spin = 0;
  r.flips = 0;
  r.tucked = false;
  r.airTime = 0;
  r.angle = check + diff;
  if (Math.abs(diff) > CRASH_LANDING) {
    crash(w, "landing");
    return;
  }
  if (air >= LAND_EVENT_MIN_AIR_MS || flips > 0) {
    w.events.push({ kind: "land", x: r.x, y: r.y, dx: cos, dy: sin, value: impact });
  }
  if (Math.abs(diff) > CLEAN_LANDING) {
    s *= SLOPPY_SPEED;
    w.combo = 1;
  } else if (flips > 0) {
    w.score += TRICK_POINTS * flips * w.combo;
    w.combo += flips;
    w.comboAge = 0;
    s += TRICK_BOOST;
    w.events.push({ kind: "trick", x: r.x, y: r.y, value: flips });
  }
  s = Math.min(MAX_SPEED, s);
  r.vx = s * cos;
  r.vy = s * sin;
  if (rail && (rail.kind === "rail" || rail.kind === "pipe")) {
    w.events.push({ kind: "grindStart", x: r.x, y: r.y, dx: cos, dy: sin });
  }
}

function rideGround(w: Work, dt: number, dtMs: number): void {
  const r = w.rider;
  const segs = w.segments;
  const i = segIndex(segs, r.x);
  const seg = segs[i];
  if (!seg || seg.gap) {
    leaveGround(r);
    return;
  }
  const th = segAngle(seg);
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  let s = alongSpeed(w, r.vx * cos + r.vy * sin, sin, dt);
  const nx = r.x + s * cos * dt;
  const ny = r.y + s * sin * dt;
  const j = segIndex(segs, nx);
  const next = segs[j];
  let gapBetween = false;
  let steepest = -Math.PI;
  for (let k = i + 1; k <= j; k++) {
    const between = segs[k]!;
    if (between.gap) gapBetween = true;
    else steepest = Math.max(steepest, segAngle(between));
  }
  if (!next || next.gap || gapBetween) {
    r.x = nx;
    r.y = ny;
    r.vx = s * cos;
    r.vy = s * sin;
    leaveGround(r);
    return;
  }
  const th2 = segAngle(next);
  if (j !== i) {
    const turn = steepest - th;
    const len = Math.max(4, (seg.x1 - seg.x0 + next.x1 - next.x0) / 2);
    const launches = turn > LAUNCH_TURN || (turn > 0.02 && (s * s * turn) / len > GRAVITY * cos);
    if (launches && segY(next, nx) > ny) {
      r.x = nx;
      r.y = ny;
      r.vx = s * cos;
      r.vy = s * sin;
      leaveGround(r);
      return;
    }
    if (th2 < th) s *= Math.cos(th - th2);
  }
  r.x = nx;
  r.y = segY(next, nx);
  r.vx = s * Math.cos(th2);
  r.vy = s * Math.sin(th2);
  r.angle = ease(r.angle, th2, dtMs, BOARD_EASE_MS);
}

function rideRail(w: Work, dt: number, dtMs: number): void {
  const r = w.rider;
  const rail = currentRail(w);
  if (!rail) {
    leaveGround(r);
    return;
  }
  const th = railAngle(rail);
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const s = alongSpeed(w, r.vx * cos + r.vy * sin, sin, dt);
  const nx = r.x + s * cos * dt;
  r.vx = s * cos;
  r.vy = s * sin;
  if (nx > rail.x1) {
    r.x = nx;
    r.y += s * sin * dt;
    leaveGround(r);
    return;
  }
  r.x = nx;
  r.y = railY(rail, nx);
  r.angle = ease(r.angle, th, dtMs, BOARD_EASE_MS);
  if (rail.kind !== "car") w.score += GRIND_POINTS_PER_S * w.combo * dt;
}

function fly(w: Work, dt: number, dtMs: number, held: boolean): void {
  const r = w.rider;
  const lift = held && r.airTime < JUMP_HOLD_MS && r.vy < 0;
  r.vy += GRAVITY * (lift ? JUMP_HOLD_GRAVITY : 1) * dt;
  if (held && r.airTime >= SPIN_DELAY_MS) r.spin = Math.max(-SPIN_MAX, r.spin - SPIN_ACCEL * dt);
  else r.spin *= Math.exp(-dtMs / SPIN_DAMP_MS);
  r.angle += r.spin * dt;
  r.airTime += dtMs;
  const flips = Math.floor((0.9 - r.angle) / (Math.PI * 2));
  if (flips > r.flips) r.flips = flips;

  const px = r.x;
  const py = r.y;
  const nx = px + r.vx * dt;
  const ny = py + r.vy * dt;
  if (r.vy >= 0) {
    for (const rail of w.rails) {
      if (nx < rail.x0 || nx > rail.x1) continue;
      const ryNext = railY(rail, nx);
      if (py <= railY(rail, clamp(px, rail.x0, rail.x1)) + 1.5 && ny >= ryNext) {
        r.x = nx;
        r.y = ryNext;
        const th = railAngle(rail);
        land(w, th, th, rail);
        return;
      }
    }
  }
  const segs = w.segments;
  const next = segs[segIndex(segs, nx)];
  if (next && !next.gap) {
    const gy = segY(next, nx);
    if (ny >= gy) {
      if (py <= gy + WALL_TOLERANCE) {
        r.x = nx;
        r.y = gy;
        const th = segAngle(next);
        land(w, slopeAt(segs, nx, th), th, null);
        return;
      }
      // Fell short into a wall: slide down its face.
      r.vx = 0;
      r.y = ny;
      return;
    }
  }
  r.x = nx;
  r.y = ny;
  const under = floorRef(segs, nx);
  if (under && under.zone === "sewer") {
    const ceiling = (under.gap ? Math.max(under.y0, under.y1) : segY(under, nx)) - SEWER_CEILING;
    if (r.y > ceiling && r.y - RIDER_H < ceiling) {
      r.y = ceiling + RIDER_H;
      if (r.vy < 0) r.vy = 0;
    }
  }
}

function moveRider(w: Work, dt: number, dtMs: number, input: StepInput): void {
  const r = w.rider;
  if (input.jumpPressed && r.grounded) jump(w);
  if (!r.grounded) fly(w, dt, dtMs, !!input.jumpHeld);
  else if (r.railId !== null) rideRail(w, dt, dtMs);
  else rideGround(w, dt, dtMs);
  r.tucked = !r.grounded && !!input.jumpHeld;
}

function checkFall(w: Work): void {
  const r = w.rider;
  if (r.grounded) return;
  const under = floorRef(w.segments, r.x);
  if (!under) return;
  const ref = under.gap ? Math.max(under.y0, under.y1) : segY(under, r.x);
  if (r.y > ref + FALL_DEPTH) crash(w, "fall");
}

function hitObstacles(w: Work): void {
  const r = w.rider;
  const left = r.x - RIDER_HALF_W;
  const right = r.x + RIDER_HALF_W;
  for (let i = 0; i < w.obstacles.length; i++) {
    const o = w.obstacles[i]!;
    if (o.hit || o.x > right || o.x + o.w < left) continue;
    if (r.y <= o.y - o.h + 2 || r.y - RIDER_H >= o.y) continue;
    if (o.kind === "taxi" || o.kind === "barrier") {
      crash(w, "obstacle");
      return;
    }
    w.obstacles[i] = { ...o, hit: true };
    r.vx *= KNOCK_SPEED;
    r.vy *= KNOCK_SPEED;
    w.combo = 1;
    w.events.push({
      kind: "knock",
      x: o.x + o.w / 2,
      y: o.y - o.h / 2,
      dx: 1,
      dy: -0.6,
      obstacleKind: o.kind,
    });
  }
}

const enemyCentreY = (e: Enemy) => e.y - ENEMY_H[e.kind] / 2;

function damageEnemy(
  w: Work,
  e: Mut<Enemy>,
  damage: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): void {
  e.hp -= damage;
  w.events.push({ kind: "hitEnemy", x, y, dx, dy, enemyKind: e.kind });
  if (e.hp > 0) return;
  e.state = "dead";
  e.stateAge = 0;
  e.vx = 0;
  e.aim = 0;
  const points = KILL_POINTS[e.kind] * w.combo;
  w.score += points;
  w.kills += 1;
  w.combo += 1;
  w.comboAge = 0;
  w.events.push({
    kind: "kill",
    x: e.x,
    y: enemyCentreY(e),
    dx,
    dy,
    value: points,
    enemyKind: e.kind,
  });
}

function shoot(w: Work): void {
  const r = w.rider;
  if (w.ammo <= 0) {
    w.events.push({ kind: "empty", x: r.x, y: r.y - CHEST });
    return;
  }
  if (r.shotAge <= SHOT_COOLDOWN_MS) return;
  const cx = r.x;
  const cy = r.y - CHEST;
  const forward = Math.atan2(r.vy, Math.max(1, r.vx));
  let aim = forward;
  let nearest = AIM_RANGE;
  for (const e of w.enemies) {
    if (e.state === "dead" || e.x <= cx) continue;
    const ex = e.x - cx;
    const ey = enemyCentreY(e) - cy;
    const dist = Math.hypot(ex, ey);
    const angle = Math.atan2(ey, ex);
    if (dist > nearest || Math.abs(normAngle(angle - forward)) > AIM_CONE) continue;
    nearest = dist;
    aim = angle;
  }
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  if (w.bullets.length < MAX_BULLETS) {
    w.bullets.push({
      id: w.nextId++,
      from: "player",
      x: cx + dx * 8,
      y: cy + dy * 8,
      vx: dx * BULLET_SPEED,
      vy: dy * BULLET_SPEED,
      life: BULLET_LIFE_MS,
    });
  }
  w.ammo -= 1;
  r.shotAge = 0;
  r.shotAim = aim;
  w.events.push({ kind: "shoot", x: cx + dx * 8, y: cy + dy * 8, dx, dy });
}

function slash(w: Work, pressed: boolean): void {
  const r = w.rider;
  const cx = r.x;
  const cy = r.y - CHEST;
  if (pressed && r.slashAge > SLASH_COOLDOWN_MS) {
    r.slashAge = 0;
    w.events.push({ kind: "slash", x: cx, y: cy, dx: 1, dy: 0 });
  }
  if (r.slashAge >= SLASH_ACTIVE_MS) return;
  for (const e of w.enemies) {
    if (e.state === "dead") continue;
    const ex = e.x - cx;
    const ey = enemyCentreY(e) - cy;
    const dist = Math.hypot(ex, ey);
    if (dist > SLASH_RANGE) continue;
    const n = Math.max(1, dist);
    damageEnemy(w, e, SLASH_DAMAGE, e.x, enemyCentreY(e), ex / n, ey / n);
  }
}

function setState(e: Mut<Enemy>, state: EnemyState): void {
  e.state = state;
  e.stateAge = 0;
}

/** Walks along the ground line; stops at gaps and walls rather than leaving the surface. */
function walk(w: Work, e: Mut<Enemy>, dt: number): void {
  const nx = e.x + e.vx * dt;
  const y = groundY(w.segments, nx);
  if (y === null || Math.abs(y - e.y) > 8) {
    e.vx = 0;
    return;
  }
  e.x = nx;
  e.y = y;
}

function fireAt(w: Work, e: Mut<Enemy>): void {
  const r = w.rider;
  const mx = e.x - 6;
  const my = e.y - 17;
  const tx = r.x;
  const ty = r.y - CHEST;
  const t = Math.hypot(tx - mx, ty - my) / ENEMY_BULLET_SPEED;
  const px = tx + r.vx * t;
  const py = ty + (r.grounded ? r.vy * t : 0);
  const aim = Math.atan2(py - my, px - mx);
  e.aim = aim;
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  if (w.bullets.length < MAX_BULLETS) {
    w.bullets.push({
      id: w.nextId++,
      from: "enemy",
      x: mx,
      y: my,
      vx: dx * ENEMY_BULLET_SPEED,
      vy: dy * ENEMY_BULLET_SPEED,
      life: ENEMY_BULLET_LIFE_MS,
    });
  }
  w.events.push({ kind: "enemyShot", x: mx, y: my, dx, dy, enemyKind: e.kind });
}

function updateEnemies(w: Work, dt: number, dtMs: number): void {
  const r = w.rider;
  for (const e of w.enemies) {
    e.stateAge = Math.min(AGE_CAP_MS, e.stateAge + dtMs);
    if (e.state === "dead") continue;
    const dx = e.x - r.x;
    if (dx > 900 || dx < -300) continue;
    if (e.kind === "thug") {
      if (e.state === "idle") {
        if (dx > 0 && dx < THUG_SIGHT) setState(e, "charge");
      } else if (e.state === "charge") {
        if (dx < -24) {
          setState(e, "idle");
          e.vx = 0;
        } else {
          e.vx = -THUG_SPEED;
          walk(w, e, dt);
          if (Math.abs(e.x - r.x) <= THUG_REACH + Math.max(0, r.vx) * 0.06) {
            setState(e, "attack");
            e.vx = 0;
          }
        }
      } else if (e.state === "attack") {
        const reach = Math.abs(r.x - e.x) < THUG_REACH && r.y > e.y - 16 && r.y - RIDER_H < e.y;
        if (e.stateAge >= STAB_FROM_MS && e.stateAge <= STAB_TO_MS && reach) {
          hurt(w, "stabbed", -1, -0.3);
        }
        if (e.stateAge >= STAB_RECOVER_MS) setState(e, r.x > e.x + 24 ? "idle" : "charge");
      }
    } else if (e.kind === "gunman") {
      if (dx < 10 || dx > GUN_SIGHT + 40) {
        if (e.state !== "idle") setState(e, "idle");
        e.aim = 0;
      } else if (e.state === "idle") {
        if (dx < GUN_SIGHT) setState(e, "aim");
      } else if (e.state === "aim") {
        e.aim = Math.atan2(r.y - CHEST - (e.y - 17), r.x - (e.x - 6));
        if (e.stateAge >= GUN_AIM_MS) {
          setState(e, "attack");
          fireAt(w, e);
        }
      } else if (e.stateAge >= GUN_COOLDOWN_MS - GUN_AIM_MS) {
        setState(e, "aim");
      }
    } else {
      if (e.state === "idle" && dx > 0 && dx < RAT_SIGHT) setState(e, "charge");
      if (e.state === "charge") {
        e.vx = -RAT_SPEED;
        walk(w, e, dt);
      }
      if (Math.abs(r.x - e.x) < RIDER_HALF_W + 6 && r.y > e.y - 7 && r.y - RIDER_H < e.y) {
        hurt(w, "bitten", -1, -0.5);
      }
    }
    if (w.status !== "running") return;
  }
}

function updateBullets(w: Work, dt: number, dtMs: number): void {
  const r = w.rider;
  const kept: Mut<Bullet>[] = [];
  for (const b of w.bullets) {
    b.life -= dtMs;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.life <= 0) continue;
    const gy = groundY(w.segments, b.x);
    if (gy !== null && b.y > gy) continue;
    const speed = Math.hypot(b.vx, b.vy) || 1;
    const dx = b.vx / speed;
    const dy = b.vy / speed;
    let spent = false;
    if (b.from === "player") {
      for (const e of w.enemies) {
        if (e.state === "dead" || Math.abs(b.x - e.x) > 7) continue;
        if (b.y < e.y - ENEMY_H[e.kind] || b.y > e.y + 1) continue;
        damageEnemy(w, e, 1, b.x, b.y, dx, dy);
        spent = true;
        break;
      }
    } else if (
      r.invuln <= 0 &&
      Math.abs(b.x - r.x) <= RIDER_HALF_W &&
      b.y >= r.y - RIDER_H &&
      b.y <= r.y
    ) {
      hurt(w, "shot", dx, dy);
      spent = true;
    }
    if (!spent) kept.push(b);
  }
  w.bullets = kept;
}

function collectPickups(w: Work): void {
  const r = w.rider;
  const cy = r.y - RIDER_H / 2;
  for (let i = 0; i < w.pickups.length; i++) {
    const p = w.pickups[i]!;
    if (p.taken || Math.abs(p.x - r.x) > PICKUP_RADIUS) continue;
    if (Math.hypot(p.x - r.x, p.y - cy) > PICKUP_RADIUS) continue;
    w.pickups[i] = { ...p, taken: true };
    let value = 0;
    if (p.kind === "token") {
      value = TOKEN_POINTS * w.combo;
      w.score += value;
    } else {
      w.ammo = Math.min(MAX_AMMO, w.ammo + AMMO_CRATE);
    }
    w.events.push({ kind: "pickup", x: p.x, y: p.y, value, pickupKind: p.kind });
  }
}

export function step(state: GameState, dtMs: number, input: StepInput): GameState {
  const ms = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, 50);
  const begin = !!(input.start || input.jumpPressed);
  if (state.status === "ready") {
    if (!begin) return { ...state, statusAge: state.statusAge + ms, events: [] };
    const r = state.rider;
    return {
      ...state,
      status: "running",
      statusAge: 0,
      rider: { ...r, vx: START_SPEED, vy: 0 },
      events: [{ kind: "start", x: r.x, y: r.y }],
    };
  }
  if (state.status === "over") {
    const statusAge = state.statusAge + ms;
    if (begin && statusAge > RESTART_DELAY_MS) {
      return restart({ ...workFrom(state), statusAge });
    }
    return { ...state, statusAge: Math.min(AGE_CAP_MS, statusAge), events: [] };
  }

  const w = workFrom(state);
  const dt = ms / 1000;
  const r = w.rider;
  w.time += ms;
  w.statusAge = Math.min(AGE_CAP_MS, w.statusAge + ms);
  r.invuln = Math.max(0, r.invuln - ms);
  r.slashAge = Math.min(AGE_CAP_MS, r.slashAge + ms);
  r.shotAge = Math.min(AGE_CAP_MS, r.shotAge + ms);
  w.comboAge = Math.min(AGE_CAP_MS, w.comboAge + ms);
  if (w.comboAge > COMBO_DECAY_MS) w.combo = 1;
  const zoneBefore = floorRef(w.segments, r.x)?.zone;

  moveRider(w, dt, ms, input);
  if (w.status === "running") checkFall(w);
  if (w.status === "running") hitObstacles(w);
  if (w.status === "running" && input.shoot) shoot(w);
  if (w.status === "running") slash(w, !!input.slash);
  if (w.status === "running") updateEnemies(w, dt, ms);
  if (w.status === "running") updateBullets(w, dt, ms);
  if (w.status === "running") collectPickups(w);

  const zoneAfter = floorRef(w.segments, r.x)?.zone;
  if (zoneAfter && zoneBefore && zoneAfter !== zoneBefore) {
    w.events.push({ kind: "zone", x: r.x, y: r.y, zone: zoneAfter });
  }
  generate(w);
  return w;
}

export function toSnapshot(state: GameState): unknown {
  const { events: _events, ...rest } = state;
  return rest;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const nums = (r: Rec, keys: ReadonlyArray<string>) => keys.every((k) => isNum(r[k]));
const oneOf =
  <T extends string>(values: ReadonlyArray<T>) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as ReadonlyArray<string>).includes(v);

const isZone = oneOf<Zone>(["street", "roof", "sewer"]);
const isRailKind = oneOf<RailKind>(["rail", "car", "pipe", "ledge"]);
const isObstacleKind = oneOf<ObstacleKind>(["taxi", "barrier", "cone", "trash", "hydrant"]);
const isDecorKind = oneOf<DecorKind>([
  "lamp",
  "trafficLight",
  "steam",
  "subwaySign",
  "fireEscape",
  "waterTower",
  "acUnit",
  "antenna",
  "billboard",
  "sewerLamp",
  "drip",
  "grate",
  "graffiti",
]);
const isEnemyKind = oneOf<EnemyKind>(["thug", "gunman", "rat"]);
const isEnemyState = oneOf<EnemyState>(["idle", "charge", "aim", "attack", "dead"]);
const isPickupKind = oneOf<PickupKind>(["token", "ammo"]);
const isStatus = oneOf<GameState["status"]>(["ready", "running", "over"]);
const isReason = oneOf<Reason>(["landing", "obstacle", "fall", "shot", "stabbed", "bitten"]);

function listOf<T>(v: unknown, check: (r: Rec) => boolean): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const item of v) {
    if (!isRec(item) || !check(item)) return null;
    out.push({ ...item } as T);
  }
  return out;
}

const segmentOk = (s: Rec) =>
  nums(s, ["x0", "y0", "x1", "y1"]) &&
  (s.x1 as number) > (s.x0 as number) &&
  isZone(s.zone) &&
  isBool(s.gap);
const railOk = (r: Rec) =>
  isInt(r.id) &&
  isRailKind(r.kind) &&
  nums(r, ["x0", "y0", "x1", "y1"]) &&
  (r.x1 as number) > (r.x0 as number);
const obstacleOk = (o: Rec) =>
  isInt(o.id) && isObstacleKind(o.kind) && nums(o, ["x", "y", "w", "h", "seed"]) && isBool(o.hit);
const decorOk = (d: Rec) => isInt(d.id) && isDecorKind(d.kind) && nums(d, ["x", "y", "seed"]);
const enemyOk = (e: Rec) =>
  isInt(e.id) &&
  isEnemyKind(e.kind) &&
  isEnemyState(e.state) &&
  (e.facing === 1 || e.facing === -1) &&
  nums(e, ["x", "y", "vx", "vy", "hp", "stateAge", "aim", "seed"]);
const bulletOk = (b: Rec) =>
  isInt(b.id) &&
  (b.from === "player" || b.from === "enemy") &&
  nums(b, ["x", "y", "vx", "vy", "life"]);
const pickupOk = (p: Rec) =>
  isInt(p.id) && isPickupKind(p.kind) && nums(p, ["x", "y"]) && isBool(p.taken);
const riderOk = (r: Rec) =>
  nums(r, [
    "x",
    "y",
    "vx",
    "vy",
    "angle",
    "spin",
    "hp",
    "invuln",
    "slashAge",
    "shotAge",
    "shotAim",
    "airTime",
    "flips",
  ]) &&
  isBool(r.grounded) &&
  isBool(r.tucked) &&
  (r.railId === null || isInt(r.railId));

export function fromSnapshot(value: unknown): GameState | null {
  if (!isRec(value) || value.version !== SNAPSHOT_VERSION) return null;
  const s = value;
  if (
    !nums(s, [
      "seed",
      "rng",
      "statusAge",
      "time",
      "score",
      "best",
      "combo",
      "comboAge",
      "ammo",
      "kills",
      "genX",
      "nextId",
    ]) ||
    !isStatus(s.status) ||
    !isBool(s.muted) ||
    !(s.deathReason === null || isReason(s.deathReason)) ||
    !isZone(s.genZone) ||
    !isRec(s.rider) ||
    !riderOk(s.rider)
  ) {
    return null;
  }
  const segments = listOf<Segment>(s.segments, segmentOk);
  const rails = listOf<Rail>(s.rails, railOk);
  const obstacles = listOf<Obstacle>(s.obstacles, obstacleOk);
  const decor = listOf<Decor>(s.decor, decorOk);
  const enemies = listOf<Enemy>(s.enemies, enemyOk);
  const bullets = listOf<Bullet>(s.bullets, bulletOk);
  const pickups = listOf<Pickup>(s.pickups, pickupOk);
  if (!segments || !rails || !obstacles || !decor || !enemies || !bullets || !pickups) return null;
  if (segments.length === 0) return null;
  for (let i = 1; i < segments.length; i++) {
    if (Math.abs(segments[i]!.x0 - segments[i - 1]!.x1) > 1e-6) return null;
  }
  return {
    version: SNAPSHOT_VERSION,
    seed: (s.seed as number) >>> 0,
    rng: (s.rng as number) >>> 0,
    status: s.status,
    statusAge: s.statusAge as number,
    time: s.time as number,
    score: s.score as number,
    best: s.best as number,
    combo: Math.max(1, s.combo as number),
    comboAge: s.comboAge as number,
    ammo: clamp(s.ammo as number, 0, MAX_AMMO),
    kills: s.kills as number,
    muted: s.muted,
    deathReason: s.deathReason,
    rider: { ...(s.rider as unknown as Rider) },
    segments,
    rails,
    obstacles,
    decor,
    enemies,
    bullets,
    pickups,
    genX: s.genX as number,
    genZone: s.genZone,
    nextId: s.nextId as number,
    events: [],
  };
}
