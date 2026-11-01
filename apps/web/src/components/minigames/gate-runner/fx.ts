import { laneX, LANE_WIDTH, ROAD_HALF } from "./camera";
import { formatOp, isGoodOp, type GameEvent, type GateRunnerState } from "./logic";

export const MAX_UNITS = 80;
const MAX_PARTICLES = 360;
const MAX_TEXTS = 12;
const GOLDEN_ANGLE = 2.39996;
const GRAVITY = -14;
const CAMERA_FOLLOW = 0.45;
const CONFETTI: ReadonlyArray<Tone> = ["good", "goodLight", "success", "fg", "bad"];

export type Tone = "good" | "goodLight" | "bad" | "badLight" | "wall" | "success" | "fg";
export type ParticleKind = "dot" | "shard" | "debris" | "confetti" | "ring" | "spark";

/** A runner in the crowd: `x` is lateral world metres, `z` is metres ahead of the crowd centre. */
export interface UnitSprite {
  alive: boolean;
  dying: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  scale: number;
  scaleV: number;
  delay: number;
  phase: number;
  seed: number;
}

/**
 * World particles use metres with `z` along the run and `y` up. Confetti instead lives in
 * screen fractions (0..1, y down) because it rains over the game-over card.
 */
export interface Particle {
  active: boolean;
  kind: ParticleKind;
  tone: Tone;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
}

export interface FloatText {
  active: boolean;
  text: string;
  tone: Tone;
  x: number;
  life: number;
  maxLife: number;
  size: number;
}

export interface Fx {
  units: UnitSprite[];
  particles: Particle[];
  texts: FloatText[];
  shown: number;
  time: number;
  shake: number;
  bounce: number;
  flash: number;
  slow: number;
  camX: number;
  spawnX: number;
  cascade: boolean;
  rand: number;
  reducedMotion: boolean;
}

export function createFx(): Fx {
  return {
    units: Array.from({ length: MAX_UNITS }, (_, i) => ({
      alive: false,
      dying: false,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      scale: 0,
      scaleV: 0,
      delay: 0,
      phase: i * 1.37,
      seed: ((i * 7919) % 101) / 101,
    })),
    particles: Array.from({ length: MAX_PARTICLES }, () => ({
      active: false,
      kind: "dot" as ParticleKind,
      tone: "good" as Tone,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      rot: 0,
      vrot: 0,
    })),
    texts: Array.from({ length: MAX_TEXTS }, () => ({
      active: false,
      text: "",
      tone: "good" as Tone,
      x: 0,
      life: 0,
      maxLife: 1,
      size: 1,
    })),
    shown: 0,
    time: 0,
    shake: 0,
    bounce: 0,
    flash: 0,
    slow: 0,
    camX: 0,
    spawnX: 0,
    cascade: false,
    rand: 0x9e3779b9,
    reducedMotion: false,
  };
}

function random(fx: Fx): number {
  fx.rand = (Math.imul(fx.rand, 1664525) + 1013904223) >>> 0;
  return fx.rand / 4294967296;
}

const spread = (i: number) => Math.sqrt((i + 0.5) / MAX_UNITS);

/** Lateral offset of formation slot `i` from the crowd centre, in metres. */
const slotX = (i: number) => Math.cos(i * GOLDEN_ANGLE) * spread(i) * 1.05;

/** Depth offset of formation slot `i` from the crowd centre, in metres. */
const slotZ = (i: number) => Math.sin(i * GOLDEN_ANGLE) * spread(i) * 0.8;

/** Places every visible unit straight into formation, e.g. after a restart or resume. */
export function resetFx(fx: Fx, state: GateRunnerState): void {
  const shown = Math.min(MAX_UNITS, state.count);
  const centre = laneX(state.lane);
  fx.shown = shown;
  fx.camX = centre * CAMERA_FOLLOW;
  fx.units.forEach((unit, i) => {
    unit.alive = i < shown;
    unit.dying = false;
    unit.x = centre + slotX(i);
    unit.z = slotZ(i);
    unit.vx = 0;
    unit.vz = 0;
    unit.scale = 1;
    unit.scaleV = 0;
    unit.delay = 0;
  });
  for (const particle of fx.particles) particle.active = false;
  for (const text of fx.texts) text.active = false;
  fx.shake = 0;
  fx.bounce = 0;
  fx.flash = 0;
  fx.slow = 0;
}

function emit(
  fx: Fx,
  kind: ParticleKind,
  tone: Tone,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  size: number,
  life: number,
  gravity = GRAVITY,
): void {
  const particle = fx.particles.find((p) => !p.active);
  if (!particle) return;
  particle.active = true;
  particle.kind = kind;
  particle.tone = tone;
  particle.x = x;
  particle.y = y;
  particle.z = z;
  particle.vx = vx;
  particle.vy = vy;
  particle.vz = vz;
  particle.gravity = gravity;
  particle.life = life * (0.7 + random(fx) * 0.5);
  particle.maxLife = particle.life;
  particle.size = size * (0.6 + random(fx) * 0.8);
  particle.rot = random(fx) * Math.PI * 2;
  particle.vrot = (random(fx) - 0.5) * 14;
}

const jitter = (fx: Fx, amount: number) => (random(fx) - 0.5) * 2 * amount;

function floatText(fx: Fx, text: string, tone: Tone, x: number, size: number) {
  const slot =
    fx.texts.find((t) => !t.active) ??
    fx.texts.reduce((oldest, t) => (t.life < oldest.life ? t : oldest));
  slot.active = true;
  slot.text = text;
  slot.tone = tone;
  slot.x = x;
  slot.life = 0.9;
  slot.maxLife = 0.9;
  slot.size = size;
}

function addShake(fx: Fx, amount: number) {
  if (!fx.reducedMotion) fx.shake = Math.max(fx.shake, amount);
}

function hitStop(fx: Fx, seconds: number) {
  if (!fx.reducedMotion) fx.slow = Math.max(fx.slow, seconds);
}

export function handleEvents(
  fx: Fx,
  events: ReadonlyArray<GameEvent>,
  state: GateRunnerState,
): void {
  const z = state.distance;
  for (const event of events) {
    switch (event.type) {
      case "start":
        resetFx(fx, state);
        break;
      case "gate": {
        const good = isGoodOp(event.op);
        const tone: Tone = good ? "good" : "bad";
        const light: Tone = good ? "goodLight" : "badLight";
        const x = laneX(event.lane);
        fx.spawnX = x;
        fx.cascade = event.op.kind === "mul";
        for (let i = 0; i < 22; i++) {
          emit(
            fx,
            "shard",
            i % 3 === 0 ? light : tone,
            x + jitter(fx, LANE_WIDTH * 0.42),
            0.2 + random(fx) * 1.4,
            z + 0.2,
            jitter(fx, 3.2),
            1 + random(fx) * 4,
            -3 - random(fx) * 9,
            0.22,
            0.9,
          );
        }
        if (fx.cascade) {
          for (let i = 0; i < 14; i++) {
            emit(
              fx,
              "spark",
              "goodLight",
              x + jitter(fx, 0.8),
              0.6 + random(fx) * 0.8,
              z,
              jitter(fx, 2.5),
              1 + random(fx) * 3,
              -2 - random(fx) * 4,
              0.16,
              0.8,
              -4,
            );
          }
        }
        const label = event.op.kind === "mul" ? `${formatOp(event.op)}!` : formatOp(event.op);
        floatText(fx, label, tone, x, fx.cascade ? 1.25 : 1);
        if (event.combo >= 2) floatText(fx, `Combo ×${event.combo}`, "good", x, 0.7);
        fx.bounce = 1;
        fx.flash = event.after >= event.before ? 1 : -1;
        break;
      }
      case "blade": {
        const x = laneX(event.lane);
        for (let i = 0; i < 20; i++) {
          emit(
            fx,
            "spark",
            i % 2 ? "bad" : "badLight",
            x + jitter(fx, 0.6),
            0.4 + random(fx) * 0.8,
            z,
            jitter(fx, 4),
            1 + random(fx) * 4,
            -2 - random(fx) * 6,
            0.12,
            0.55,
          );
        }
        floatText(fx, `−${event.lost}`, "bad", x, 1);
        addShake(fx, 3);
        hitStop(fx, 0.05);
        fx.bounce = 1;
        fx.flash = -1;
        break;
      }
      case "enemy": {
        const x = laneX(event.lane);
        const pops = Math.min(28, 8 + event.enemy);
        for (let i = 0; i < pops; i++) {
          emit(
            fx,
            "dot",
            i % 2 ? "bad" : "good",
            x + jitter(fx, 0.9),
            0.3 + random(fx) * 0.5,
            z + random(fx) * 0.6,
            jitter(fx, 2.2),
            1 + random(fx) * 3,
            -1 - random(fx) * 4,
            0.1,
            0.5,
          );
        }
        emit(fx, "ring", "bad", x, 0.05, z + 0.3, 0, 0, 0, 0.9, 0.35, 0);
        floatText(fx, `−${event.lost}`, "bad", x, 1);
        addShake(fx, 2.5);
        hitStop(fx, 0.06);
        fx.bounce = 1;
        fx.flash = -1;
        break;
      }
      case "wall": {
        const pieces = event.passed ? 70 : 22;
        for (let i = 0; i < pieces; i++) {
          emit(
            fx,
            "debris",
            i % 4 === 0 ? "fg" : "wall",
            jitter(fx, ROAD_HALF),
            random(fx) * 2.2,
            z + 0.4,
            jitter(fx, 4),
            2 + random(fx) * 5,
            event.passed ? -6 - random(fx) * 14 : 1 + random(fx) * 3,
            0.32,
            1.2,
          );
        }
        addShake(fx, event.passed ? 9 : 5);
        hitStop(fx, event.passed ? 0.12 : 0);
        fx.bounce = 1;
        fx.flash = event.passed ? 1 : -1;
        break;
      }
      case "over": {
        if (!event.newBest) break;
        for (let i = 0; i < 110; i++) {
          emit(
            fx,
            "confetti",
            CONFETTI[i % CONFETTI.length] ?? "good",
            random(fx),
            -0.04 - random(fx) * 0.5,
            0,
            jitter(fx, 0.08),
            0.1 + random(fx) * 0.2,
            0,
            1,
            2.4,
            0.6,
          );
        }
        break;
      }
    }
  }
}

function syncUnits(fx: Fx, state: GateRunnerState): void {
  const target = Math.min(MAX_UNITS, state.count);
  if (target > fx.shown) {
    for (let i = fx.shown; i < target; i++) {
      const unit = fx.units[i];
      if (!unit) continue;
      const order = i - fx.shown;
      if (unit.alive && unit.dying) {
        unit.dying = false;
        continue;
      }
      unit.alive = true;
      unit.dying = false;
      unit.x = fx.spawnX + jitter(fx, 0.5);
      unit.z = 0.9 + random(fx) * 0.4;
      unit.vx = jitter(fx, 1.5);
      unit.vz = -1 - random(fx) * 2;
      unit.scale = 0;
      unit.scaleV = 0;
      unit.delay = order * (fx.cascade ? 0.022 : 0.012);
    }
  } else if (target < fx.shown) {
    for (let i = target; i < fx.shown; i++) {
      const unit = fx.units[i];
      if (unit?.alive) unit.dying = true;
    }
  }
  fx.shown = target;
}

export function updateFx(fx: Fx, dtMs: number, state: GateRunnerState): void {
  let dt = Math.min(0.05, dtMs / 1000);
  if (fx.slow > 0) {
    fx.slow -= dt;
    dt *= 0.25;
  }
  fx.time += dt;
  syncUnits(fx, state);
  const centre = laneX(state.lane);
  fx.camX += (centre * CAMERA_FOLLOW - fx.camX) * (1 - Math.exp(-dt * 7));
  const running = state.status !== "over";
  const stride = running && state.freeze <= 0 ? 15 : running ? 7 : 0;
  for (let i = 0; i < MAX_UNITS; i++) {
    const unit = fx.units[i];
    if (!unit?.alive) continue;
    if (unit.delay > 0) {
      unit.delay -= dt;
      continue;
    }
    const k = 70 + unit.seed * 80;
    const c = 2 * Math.sqrt(k) * 0.72;
    unit.vx += (k * (centre + slotX(i) - unit.x) - c * unit.vx) * dt;
    unit.vz += (k * (slotZ(i) - unit.z) - c * unit.vz) * dt;
    unit.x += unit.vx * dt;
    unit.z += unit.vz * dt;
    unit.phase += dt * stride * (0.85 + unit.seed * 0.3);
    if (unit.dying) {
      unit.scale -= dt * 8;
      if (unit.scale <= 0) {
        unit.alive = false;
        unit.dying = false;
        emit(fx, "dot", "good", unit.x, 0.3, state.distance + unit.z, 0, 2, -2, 0.08, 0.3);
      }
    } else {
      unit.scaleV += ((1 - unit.scale) * 260 - unit.scaleV * 16) * dt;
      unit.scale = Math.max(0, unit.scale + unit.scaleV * dt);
    }
  }
  for (const p of fx.particles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }
    if (p.kind === "confetti") {
      p.vx -= p.vx * 1.6 * dt;
      p.vy += p.gravity * dt - p.vy * 1.6 * dt;
    } else {
      p.vx -= p.vx * 0.9 * dt;
      p.vy += p.gravity * dt;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.rot += p.vrot * dt;
    if (p.kind !== "confetti" && p.y < 0) {
      p.y = 0;
      p.vy *= -0.35;
      p.vz *= 0.7;
    }
  }
  for (const t of fx.texts) {
    if (!t.active) continue;
    t.life -= dt;
    if (t.life <= 0) t.active = false;
  }
  fx.shake *= Math.exp(-dt * 9);
  if (fx.shake < 0.2) fx.shake = 0;
  fx.bounce = Math.max(0, fx.bounce - dt * 3.2);
  fx.flash *= Math.exp(-dt * 5);
  if (Math.abs(fx.flash) < 0.02) fx.flash = 0;
}
