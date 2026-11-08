import {
  RIDER_H,
  RIDER_SCREEN_X,
  VIEW_H,
  type EnemyKind,
  type GameEvent,
  type GameState,
  type ObstacleKind,
  type Segment,
  type Zone,
} from "./model";

const MAX_PARTICLES = 400;
const MAX_DECALS = 120;
const MAX_TEXTS = 10;

export const P_BLOOD = 0;
export const P_SPARK = 1;
export const P_DUST = 2;
export const P_DEBRIS = 3;
export const P_SHELL = 4;
export const P_STEAM = 5;
export const P_SMOKE = 6;
export const P_SPARKLE = 7;
export const P_PROP = 8;
export const P_FLASH = 9;

export const D_SPLAT = 0;
export const D_POOL = 1;
export const D_CORPSE = 2;

/** Ground sits this far up the view when the camera is level with it. */
const GROUND_FRAC = 0.7;
/** Camera top edge when the ground is the street (y = 0); the renderer measures depth from here. */
export const CAM_STREET = -VIEW_H * GROUND_FRAC;

const MAX_SHAKE = 5;
const CAM_OMEGA = 6.5;
const LEAD_PER_SPEED = 0.07;
const LEAD_MAX = 22;
const STEAM_RATE = 5;
const GRIND_SPARK_RATE = 45;

export type TextTone = "gold" | "accent" | "red" | "white" | "muted";

export interface Particle {
  active: boolean;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
  gravity: number;
  drag: number;
  /** Collides with the ground line (blood sticks, the rest bounce). */
  ground: boolean;
  resting: boolean;
  prop: ObstacleKind;
  tone: number;
}

export interface Decal {
  active: boolean;
  kind: number;
  x: number;
  y: number;
  size: number;
  rot: number;
  /** Milliseconds since it landed; pools spread and corpses topple while age < grow. */
  age: number;
  grow: number;
  enemy: EnemyKind;
  facing: -1 | 1;
  seed: number;
}

export interface FloatText {
  active: boolean;
  text: string;
  x: number;
  y: number;
  age: number;
  life: number;
  tone: TextTone;
  size: number;
}

/** A tumbling rigid body for the crash ragdoll (rider and board). */
export interface Tumbler {
  active: boolean;
  settled: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  age: number;
}

export interface Fx {
  reducedMotion: boolean;
  time: number;
  /** World x/y of the view's top-left corner. */
  camX: number;
  camY: number;
  camVY: number;
  lead: number;
  viewW: number;
  camSettled: boolean;
  trauma: number;
  shakeX: number;
  shakeY: number;
  hurt: number;
  flash: number;
  landPulse: number;
  particles: Particle[];
  cursor: number;
  decals: Decal[];
  decalHead: number;
  texts: FloatText[];
  banner: { active: boolean; text: string; age: number };
  body: Tumbler;
  board: Tumbler;
  rand: number;
}

const ZONE_NAMES: Record<Zone, ReadonlyArray<string>> = {
  street: ["Bowery", "Canal St", "Delancey St", "Houston St", "Hell's Kitchen", "Mott St"],
  roof: ["Midtown Rooftops", "Tribeca Rooftops", "Above 42nd St", "Garment District Roofs"],
  sewer: ["Under Canal St", "Bowery Sewers", "Below Mulberry St", "The Old Outfall"],
};

const tumbler = (): Tumbler => ({
  active: false,
  settled: true,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  rot: 0,
  vrot: 0,
  age: 0,
});

export function createFx(): Fx {
  return {
    reducedMotion: false,
    time: 0,
    camX: 0,
    camY: CAM_STREET,
    camVY: 0,
    lead: 0,
    viewW: 400,
    camSettled: true,
    trauma: 0,
    shakeX: 0,
    shakeY: 0,
    hurt: 0,
    flash: 0,
    landPulse: 0,
    particles: Array.from({ length: MAX_PARTICLES }, () => ({
      active: false,
      kind: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      rot: 0,
      vrot: 0,
      gravity: 0,
      drag: 0,
      ground: false,
      resting: false,
      prop: "cone" as ObstacleKind,
      tone: 0,
    })),
    cursor: 0,
    decals: Array.from({ length: MAX_DECALS }, () => ({
      active: false,
      kind: 0,
      x: 0,
      y: 0,
      size: 1,
      rot: 0,
      age: 0,
      grow: 0,
      enemy: "thug" as EnemyKind,
      facing: 1 as -1 | 1,
      seed: 0,
    })),
    decalHead: 0,
    texts: Array.from({ length: MAX_TEXTS }, () => ({
      active: false,
      text: "",
      x: 0,
      y: 0,
      age: 0,
      life: 1,
      tone: "white" as TextTone,
      size: 1,
    })),
    banner: { active: false, text: "", age: 0 },
    body: tumbler(),
    board: tumbler(),
    rand: 0x2545f491,
  };
}

/** Index of the segment covering x, or -1. Segments are sorted and contiguous. */
export function segmentIndex(segments: ReadonlyArray<Segment>, x: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (!s) return -1;
    if (x < s.x0) hi = mid - 1;
    else if (x >= s.x1) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function lineY(s: Segment, x: number): number {
  const span = s.x1 - s.x0;
  return span > 0 ? s.y0 + ((x - s.x0) / span) * (s.y1 - s.y0) : s.y0;
}

/** Solid ground height at x, NaN over a gap or outside generated ground. */
export function floorY(segments: ReadonlyArray<Segment>, x: number): number {
  const s = segments[segmentIndex(segments, x)];
  return s && !s.gap ? lineY(s, x) : Number.NaN;
}

/** Ground line height at x including gap edge heights, NaN outside generated ground. */
function edgeY(segments: ReadonlyArray<Segment>, x: number): number {
  const s = segments[segmentIndex(segments, x)];
  return s ? lineY(s, x) : Number.NaN;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function random(fx: Fx): number {
  fx.rand = (Math.imul(fx.rand, 1664525) + 1013904223) >>> 0;
  return fx.rand / 4294967296;
}

const jitter = (fx: Fx, amount: number) => (random(fx) - 0.5) * 2 * amount;

const count = (fx: Fx, n: number) => (fx.reducedMotion ? Math.ceil(n * 0.4) : n);

function cameraTarget(state: GameState): number {
  const r = state.rider;
  const segs = state.segments;
  let ground = edgeY(segs, r.x);
  if (Number.isNaN(ground)) ground = r.y;
  let sum = 0;
  let n = 0;
  for (let d = 70; d <= 210; d += 70) {
    const y = edgeY(segs, r.x + d);
    if (!Number.isNaN(y)) {
      sum += y;
      n++;
    }
  }
  if (n > 0) ground += (sum / n - ground) * 0.45;
  const target = ground - VIEW_H * GROUND_FRAC;
  return clamp(target, r.y - VIEW_H * 0.8, r.y - VIEW_H * 0.28);
}

export function resetFx(fx: Fx, state: GameState): void {
  const r = state.rider;
  fx.lead = 0;
  fx.camX = r.x - RIDER_SCREEN_X * fx.viewW;
  fx.camY = cameraTarget(state);
  fx.camVY = 0;
  fx.camSettled = true;
  fx.trauma = 0;
  fx.shakeX = 0;
  fx.shakeY = 0;
  fx.hurt = 0;
  fx.flash = 0;
  fx.landPulse = 0;
  for (const p of fx.particles) p.active = false;
  for (const d of fx.decals) d.active = false;
  for (const t of fx.texts) t.active = false;
  fx.banner.active = false;
  fx.body.active = false;
  fx.board.active = false;
  if (state.status === "over") {
    const g = floorY(state.segments, r.x);
    settle(fx.body, r.x + 6, Number.isNaN(g) ? r.y : g, Math.PI / 2);
    settle(fx.board, r.x + 16, Number.isNaN(g) ? r.y : g, 0);
  }
}

function settle(t: Tumbler, x: number, y: number, rot: number) {
  t.active = true;
  t.settled = true;
  t.x = x;
  t.y = y;
  t.vx = 0;
  t.vy = 0;
  t.rot = rot;
  t.vrot = 0;
  t.age = 99;
}

function emit(
  fx: Fx,
  kind: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  life: number,
  size: number,
  gravity: number,
  drag: number,
  ground: boolean,
): Particle {
  const pool = fx.particles;
  let slot: Particle | undefined;
  for (let n = 0; n < MAX_PARTICLES; n++) {
    const i = (fx.cursor + n) % MAX_PARTICLES;
    const p = pool[i];
    if (p && !p.active) {
      slot = p;
      fx.cursor = (i + 1) % MAX_PARTICLES;
      break;
    }
  }
  if (!slot) {
    slot = pool[fx.cursor] ?? (pool[0] as Particle);
    fx.cursor = (fx.cursor + 1) % MAX_PARTICLES;
  }
  slot.active = true;
  slot.kind = kind;
  slot.x = x;
  slot.y = y;
  slot.vx = vx;
  slot.vy = vy;
  slot.life = life * (0.75 + random(fx) * 0.5);
  slot.maxLife = slot.life;
  slot.size = size * (0.7 + random(fx) * 0.6);
  slot.rot = random(fx) * Math.PI * 2;
  slot.vrot = jitter(fx, 12);
  slot.gravity = gravity;
  slot.drag = drag;
  slot.ground = ground;
  slot.resting = false;
  slot.tone = random(fx);
  return slot;
}

function addDecal(fx: Fx, kind: number, x: number, y: number, size: number, grow: number): Decal {
  const d = fx.decals[fx.decalHead] ?? (fx.decals[0] as Decal);
  fx.decalHead = (fx.decalHead + 1) % MAX_DECALS;
  d.active = true;
  d.kind = kind;
  d.x = x;
  d.y = y;
  d.size = size;
  d.rot = random(fx);
  d.age = 0;
  d.grow = grow;
  d.seed = random(fx);
  return d;
}

function floatText(fx: Fx, text: string, x: number, y: number, tone: TextTone, size: number) {
  let slot = fx.texts[0] as FloatText;
  for (const t of fx.texts) {
    if (!t.active) {
      slot = t;
      break;
    }
    if (t.age / t.life > slot.age / slot.life) slot = t;
  }
  slot.active = true;
  slot.text = text;
  slot.x = x;
  slot.y = y;
  slot.age = 0;
  slot.life = 1.1;
  slot.tone = tone;
  slot.size = size;
}

function addTrauma(fx: Fx, amount: number) {
  if (!fx.reducedMotion) fx.trauma = Math.min(1, fx.trauma + amount);
}

function direction(event: GameEvent): { dx: number; dy: number } {
  const dx = event.dx ?? 1;
  const dy = event.dy ?? 0;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

function spray(
  fx: Fx,
  kind: number,
  n: number,
  x: number,
  y: number,
  angle: number,
  spread: number,
  speed: number,
  life: number,
  size: number,
  gravity: number,
) {
  for (let i = 0; i < count(fx, n); i++) {
    const a = angle + jitter(fx, spread);
    const v = speed * (0.35 + random(fx) * 0.9);
    emit(fx, kind, x, y, Math.cos(a) * v, Math.sin(a) * v, life, size, gravity, 0.6, true);
  }
}

function dust(fx: Fx, n: number, x: number, y: number, push: number) {
  for (let i = 0; i < count(fx, n); i++) {
    emit(
      fx,
      P_DUST,
      x + jitter(fx, 4),
      y - 1,
      push * random(fx) + jitter(fx, 18),
      -6 - random(fx) * 14,
      0.7,
      3,
      0,
      2.5,
      false,
    );
  }
}

function trickName(event: GameEvent): string {
  const n = Math.max(1, Math.round(event.value ?? 1));
  const name = (event.dx ?? -1) > 0 ? "Frontflip" : "Backflip";
  return n > 1 ? `${name} ×${n}` : name;
}

export function handleEvents(fx: Fx, events: ReadonlyArray<GameEvent>, state: GameState): void {
  const r = state.rider;
  for (const event of events) {
    switch (event.kind) {
      case "start":
        resetFx(fx, state);
        break;
      case "jump":
        dust(fx, 4, event.x, event.y, -30);
        break;
      case "land": {
        const impact = event.value ?? 150;
        dust(fx, Math.round(clamp(impact / 40, 3, 10)), event.x, event.y, -40);
        fx.landPulse = clamp(impact / 320, 0.3, 1);
        addTrauma(fx, clamp(impact / 1600, 0, 0.22));
        break;
      }
      case "trick":
        floatText(fx, trickName(event), event.x, event.y - RIDER_H - 6, "accent", 1.15);
        for (let i = 0; i < count(fx, 10); i++) {
          const a = random(fx) * Math.PI * 2;
          emit(
            fx,
            P_SPARKLE,
            event.x + Math.cos(a) * 8,
            event.y - 12 + Math.sin(a) * 8,
            Math.cos(a) * 30,
            Math.sin(a) * 30,
            0.55,
            2.2,
            0,
            2,
            false,
          );
        }
        break;
      case "grindStart": {
        const { dx } = direction(event);
        spray(
          fx,
          P_SPARK,
          14,
          event.x,
          event.y,
          Math.PI + (dx < 0 ? -1 : 1) * -0.5,
          0.7,
          170,
          0.35,
          1,
          300,
        );
        break;
      }
      case "shoot": {
        const { dx, dy } = direction(event);
        const shell = emit(
          fx,
          P_SHELL,
          event.x - dx * 4,
          event.y - dy * 4,
          -dx * 30 + jitter(fx, 15),
          -70 - random(fx) * 30,
          1.3,
          1,
          420,
          0.3,
          true,
        );
        shell.vrot = 25;
        for (let i = 0; i < count(fx, 3); i++) {
          emit(
            fx,
            P_SMOKE,
            event.x + dx * 2,
            event.y + dy * 2,
            dx * 25 + jitter(fx, 6),
            dy * 25 - 8,
            0.6,
            2.2,
            0,
            2.2,
            false,
          );
        }
        addTrauma(fx, 0.07);
        break;
      }
      case "empty":
        floatText(fx, "Empty", event.x, event.y - RIDER_H - 4, "muted", 0.85);
        break;
      case "hitEnemy": {
        const { dx, dy } = direction(event);
        spray(
          fx,
          P_BLOOD,
          14,
          event.x,
          event.y,
          Math.atan2(dy, dx) - 0.25,
          0.6,
          170,
          0.9,
          1.2,
          380,
        );
        addTrauma(fx, 0.05);
        break;
      }
      case "kill": {
        const { dx, dy } = direction(event);
        spray(fx, P_BLOOD, 26, event.x, event.y, Math.atan2(dy, dx) - 0.35, 0.9, 200, 1, 1.4, 400);
        let gy = floorY(state.segments, event.x);
        for (const e of state.enemies) {
          if (e.state === "dead" && e.x === event.x) gy = e.y;
        }
        if (Number.isNaN(gy)) gy = event.y;
        const kind = event.enemyKind ?? "thug";
        const facing: -1 | 1 = dx >= 0 ? 1 : -1;
        const pool = addDecal(
          fx,
          D_POOL,
          event.x + facing * (kind === "rat" ? 2 : 9),
          gy,
          kind === "rat" ? 4 : 11,
          1600,
        );
        pool.enemy = kind;
        const corpse = addDecal(fx, D_CORPSE, event.x, gy, 1, 320);
        corpse.enemy = kind;
        corpse.facing = facing;
        if (event.value) floatText(fx, `+${event.value}`, event.x, event.y - 22, "red", 1);
        addTrauma(fx, 0.12);
        break;
      }
      case "enemyShot": {
        const { dx, dy } = direction(event);
        emit(fx, P_FLASH, event.x, event.y, 0, 0, 0.08, 9, 0, 0, false);
        emit(fx, P_SMOKE, event.x, event.y, dx * 20, dy * 20 - 6, 0.6, 2.2, 0, 2.2, false);
        addTrauma(fx, 0.06);
        break;
      }
      case "hurt": {
        if (!fx.reducedMotion) fx.hurt = 1;
        const { dx, dy } = direction(event);
        spray(fx, P_BLOOD, 12, event.x, event.y, Math.atan2(dy, dx), 0.8, 140, 0.9, 1.2, 380);
        addTrauma(fx, 0.35);
        break;
      }
      case "knock": {
        const kind = event.obstacleKind ?? "cone";
        const prop = emit(
          fx,
          P_PROP,
          event.x,
          event.y - 4,
          Math.max(60, r.vx * 0.7) + jitter(fx, 20),
          -110 - random(fx) * 60,
          1.8,
          1,
          420,
          0.2,
          true,
        );
        prop.prop = kind;
        prop.vrot = 9 + random(fx) * 8;
        spray(fx, P_DEBRIS, 8, event.x, event.y - 4, -Math.PI / 3, 0.7, 120, 0.8, 1.1, 400);
        addTrauma(fx, 0.1);
        break;
      }
      case "pickup":
        if (event.pickupKind === "ammo") {
          floatText(fx, "+Ammo", event.x, event.y - 6, "white", 0.95);
        } else {
          floatText(fx, `+${event.value ?? 0}`, event.x, event.y - 6, "gold", 1);
        }
        for (let i = 0; i < count(fx, 9); i++) {
          const a = random(fx) * Math.PI * 2;
          emit(
            fx,
            P_SPARKLE,
            event.x,
            event.y,
            Math.cos(a) * 45,
            Math.sin(a) * 45,
            0.5,
            2,
            0,
            3,
            false,
          );
        }
        break;
      case "zone": {
        const names = ZONE_NAMES[event.zone ?? "street"];
        fx.banner.active = true;
        fx.banner.text = names[Math.floor(random(fx) * names.length)] ?? "";
        fx.banner.age = 0;
        break;
      }
      case "crash": {
        const b = fx.body;
        b.active = true;
        b.settled = false;
        b.x = r.x;
        b.y = r.y - 6;
        b.vx = Math.max(40, r.vx * 0.55);
        b.vy = Math.min(r.vy, 0) - 90;
        b.rot = r.angle;
        b.vrot = 7 + random(fx) * 4;
        b.age = 0;
        const d = fx.board;
        d.active = true;
        d.settled = false;
        d.x = r.x;
        d.y = r.y - 2;
        d.vx = Math.max(70, r.vx * 0.85);
        d.vy = -70;
        d.rot = r.angle;
        d.vrot = 16;
        d.age = 0;
        dust(fx, 10, r.x, r.y, 40);
        spray(fx, P_DEBRIS, 10, r.x, r.y - 3, -Math.PI / 2, 1.2, 110, 0.9, 1.1, 400);
        if (event.reason !== "fall") {
          spray(fx, P_BLOOD, 10, r.x, r.y - 10, -Math.PI / 2, 1.2, 110, 0.9, 1.2, 380);
        }
        if (!fx.reducedMotion) fx.flash = 1;
        addTrauma(fx, 0.8);
        break;
      }
      default:
        break;
    }
  }
}

function stepTumbler(t: Tumbler, dt: number, segments: ReadonlyArray<Segment>, lying: number) {
  if (!t.active || t.settled) return;
  t.age += dt;
  t.vy += 430 * dt;
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  t.rot += t.vrot * dt;
  const g = floorY(segments, t.x);
  if (!Number.isNaN(g) && t.y >= g && t.y - t.vy * dt <= g + 3) {
    t.y = g;
    t.vy *= -0.32;
    t.vx *= 0.55;
    t.vrot *= 0.5;
    if (Math.abs(t.vy) < 25 && Math.abs(t.vx) < 18) {
      t.vy = 0;
      t.vx = 0;
      t.vrot = 0;
      const turns = Math.round((t.rot - lying) / Math.PI);
      t.rot = lying + turns * Math.PI;
      t.settled = true;
    }
  }
  if (t.age > 3.5) t.settled = true;
}

export function updateFx(fx: Fx, dtMs: number, state: GameState, viewW: number): void {
  const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
  fx.time += dt;
  fx.viewW = viewW;
  const r = state.rider;
  const segs = state.segments;
  const running = state.status === "running";

  const leadTarget = running ? clamp(r.vx * LEAD_PER_SPEED, 0, LEAD_MAX) : fx.lead;
  fx.lead += (leadTarget - fx.lead) * (1 - Math.exp(-dt * 2.5));
  fx.camX = r.x - RIDER_SCREEN_X * viewW + fx.lead;
  const target = cameraTarget(state);
  fx.camVY += (CAM_OMEGA * CAM_OMEGA * (target - fx.camY) - 2 * CAM_OMEGA * fx.camVY) * dt;
  fx.camY += fx.camVY * dt;
  fx.camSettled =
    Math.abs(target - fx.camY) < 0.05 &&
    Math.abs(fx.camVY) < 0.05 &&
    Math.abs(leadTarget - fx.lead) < 0.05;
  if (fx.camSettled) {
    fx.camY = target;
    fx.camVY = 0;
    fx.lead = leadTarget;
  }

  if (fx.trauma > 0) {
    fx.trauma = Math.max(0, fx.trauma - dt * 1.4);
    const amp = fx.trauma * fx.trauma * MAX_SHAKE;
    const t = fx.time;
    fx.shakeX = amp * (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 91.7 + 1.3) * 0.4);
    fx.shakeY = amp * (Math.sin(t * 53.1 + 2.1) * 0.6 + Math.sin(t * 83.9) * 0.4);
  } else {
    fx.shakeX = 0;
    fx.shakeY = 0;
  }
  fx.hurt = Math.max(0, fx.hurt - dt * 2.2);
  fx.flash = Math.max(0, fx.flash - dt * 4);
  fx.landPulse = Math.max(0, fx.landPulse - dt * 4);

  if (running) {
    const left = fx.camX - 20;
    const right = fx.camX + viewW + 20;
    const rate = (fx.reducedMotion ? STEAM_RATE * 0.4 : STEAM_RATE) * dt;
    for (const d of state.decor) {
      if (d.x < left || d.x > right) continue;
      if (d.kind === "steam") {
        if (random(fx) < rate) {
          emit(
            fx,
            P_STEAM,
            d.x + jitter(fx, 1.5),
            d.y - 40,
            6 + jitter(fx, 5),
            -16 - random(fx) * 10,
            2.2,
            4,
            0,
            0.4,
            false,
          );
        }
      } else if (d.kind === "grate" && random(fx) < rate * 0.6) {
        emit(
          fx,
          P_STEAM,
          d.x + jitter(fx, 6),
          d.y - 4,
          4 + jitter(fx, 4),
          -10 - random(fx) * 8,
          1.8,
          3.5,
          0,
          0.4,
          false,
        );
      }
    }
    if (r.railId !== null) {
      const sparks = (fx.reducedMotion ? GRIND_SPARK_RATE * 0.4 : GRIND_SPARK_RATE) * dt;
      let budget = sparks + random(fx);
      while (budget >= 1) {
        budget -= 1;
        const a = Math.PI + 0.35 + jitter(fx, 0.45);
        const v = 60 + random(fx) * 120;
        emit(
          fx,
          P_SPARK,
          r.x - 3 + jitter(fx, 2),
          r.y,
          Math.cos(a) * v + r.vx * 0.3,
          Math.sin(a) * v,
          0.3,
          1,
          300,
          0.5,
          true,
        );
      }
    }
  }

  for (const p of fx.particles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }
    if (p.resting) continue;
    if (p.drag > 0) {
      const k = 1 - Math.min(1, p.drag * dt);
      p.vx *= k;
      p.vy *= k;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    if (p.ground && p.vy > 0) {
      const g = floorY(segs, p.x);
      if (!Number.isNaN(g) && p.y >= g && p.y - p.vy * dt <= g + 2) {
        if (p.kind === P_BLOOD) {
          if (random(fx) < 0.6) addDecal(fx, D_SPLAT, p.x, g, p.size * (1.2 + random(fx)), 0);
          p.active = false;
          continue;
        }
        p.y = g;
        p.vy *= -0.38;
        p.vx *= 0.6;
        p.vrot *= 0.6;
        if (Math.abs(p.vy) < 20) {
          p.vy = 0;
          p.vx = 0;
          p.vrot = 0;
          p.resting = true;
        }
      }
    }
  }

  const left = fx.camX - 80;
  for (const d of fx.decals) {
    if (!d.active) continue;
    if (d.x < left) {
      d.active = false;
      continue;
    }
    if (d.age < d.grow) d.age = Math.min(d.grow, d.age + dt * 1000);
  }
  for (const t of fx.texts) {
    if (!t.active) continue;
    t.age += dt;
    if (t.age >= t.life) t.active = false;
  }
  if (fx.banner.active) {
    fx.banner.age += dt;
    if (fx.banner.age > 2.6) fx.banner.active = false;
  }
  stepTumbler(fx.body, dt, segs, Math.PI / 2);
  stepTumbler(fx.board, dt, segs, 0);
}

/** True when nothing is animating, so the shell can stop drawing while the game is not running. */
export function fxIdle(fx: Fx): boolean {
  if (fx.trauma > 0 || fx.hurt > 0 || fx.flash > 0 || fx.landPulse > 0) return false;
  if (!fx.camSettled || fx.banner.active) return false;
  if (fx.body.active && !fx.body.settled) return false;
  if (fx.board.active && !fx.board.settled) return false;
  for (const p of fx.particles) if (p.active) return false;
  for (const t of fx.texts) if (t.active) return false;
  for (const d of fx.decals) if (d.active && d.age < d.grow) return false;
  return true;
}
