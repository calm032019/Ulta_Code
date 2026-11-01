import { laneCenter, type Layout } from "./layout";
import { formatOp, isGoodOp, type GameEvent, type GateRunnerState } from "./logic";

export const MAX_UNITS = 80;
const MAX_PARTICLES = 360;
const MAX_TEXTS = 16;
const GOLDEN_ANGLE = 2.39996;
const CONFETTI: ReadonlyArray<Tone> = ["good", "goodLight", "success", "fg", "bad"];

export type Tone = "good" | "goodLight" | "bad" | "badLight" | "wall" | "success" | "fg";
export type ParticleKind = "dot" | "shard" | "debris" | "confetti" | "ring" | "spark";

export interface UnitSprite {
  alive: boolean;
  dying: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
  scaleV: number;
  delay: number;
  phase: number;
  seed: number;
}

export interface Particle {
  active: boolean;
  kind: ParticleKind;
  tone: Tone;
  x: number;
  y: number;
  vx: number;
  vy: number;
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
  y: number;
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
  spawnX: number;
  spawnY: number;
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
      y: 1,
      vx: 0,
      vy: 0,
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
      vx: 0,
      vy: 0,
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
      y: 0,
      life: 0,
      maxLife: 1,
      size: 12,
    })),
    shown: 0,
    time: 0,
    shake: 0,
    bounce: 0,
    flash: 0,
    slow: 0,
    spawnX: 0.6,
    spawnY: 1,
    cascade: false,
    rand: 0x9e3779b9,
    reducedMotion: false,
  };
}

function random(fx: Fx): number {
  fx.rand = (Math.imul(fx.rand, 1664525) + 1013904223) >>> 0;
  return fx.rand / 4294967296;
}

export function centreBack(shown: number): number {
  return 0.14 + 0.8 * Math.sqrt(shown / MAX_UNITS);
}

export function slotX(index: number, shown: number): number {
  return (
    -centreBack(shown) + Math.cos(index * GOLDEN_ANGLE) * Math.sqrt((index + 0.5) / MAX_UNITS) * 0.8
  );
}

export function slotY(index: number): number {
  return Math.sin(index * GOLDEN_ANGLE) * Math.sqrt((index + 0.5) / MAX_UNITS) * 0.34;
}

/** Places every visible unit straight into formation, e.g. after a restart or resume. */
export function resetFx(fx: Fx, state: GateRunnerState): void {
  const shown = Math.min(MAX_UNITS, state.count);
  fx.shown = shown;
  fx.units.forEach((unit, i) => {
    unit.alive = i < shown;
    unit.dying = false;
    unit.x = slotX(i, shown);
    unit.y = state.lane + slotY(i);
    unit.vx = 0;
    unit.vy = 0;
    unit.scale = 1;
    unit.scaleV = 0;
    unit.delay = 0;
  });
  for (const particle of fx.particles) particle.active = false;
  for (const text of fx.texts) text.active = false;
  fx.shake = 0;
  fx.bounce = 0;
  fx.flash = 0;
}

export function emit(
  fx: Fx,
  kind: ParticleKind,
  tone: Tone,
  x: number,
  y: number,
  speed: number,
  size: number,
  life: number,
  gravity = 0,
  angle = -1,
): void {
  const particle = fx.particles.find((p) => !p.active);
  if (!particle) return;
  const a = angle >= 0 ? angle + (random(fx) - 0.5) * 0.9 : random(fx) * Math.PI * 2;
  const v = speed * (0.4 + random(fx) * 0.8);
  particle.active = true;
  particle.kind = kind;
  particle.tone = tone;
  particle.x = x;
  particle.y = y;
  particle.vx = Math.cos(a) * v;
  particle.vy = Math.sin(a) * v;
  particle.gravity = gravity;
  particle.life = life * (0.7 + random(fx) * 0.5);
  particle.maxLife = particle.life;
  particle.size = size * (0.6 + random(fx) * 0.8);
  particle.rot = random(fx) * Math.PI * 2;
  particle.vrot = (random(fx) - 0.5) * 14;
}

export function floatText(fx: Fx, text: string, tone: Tone, x: number, y: number, size: number) {
  const slot =
    fx.texts.find((t) => !t.active) ??
    fx.texts.reduce((oldest, t) => (t.life < oldest.life ? t : oldest));
  slot.active = true;
  slot.text = text;
  slot.tone = tone;
  slot.x = x;
  slot.y = y;
  slot.life = 0.9;
  slot.maxLife = 0.9;
  slot.size = size;
}

function addShake(fx: Fx, amount: number) {
  if (!fx.reducedMotion) fx.shake = Math.max(fx.shake, amount);
}

export function handleEvents(
  fx: Fx,
  events: ReadonlyArray<GameEvent>,
  state: GateRunnerState,
  layout: Layout,
): void {
  const front = layout.crowdX;
  const unit = layout.laneH;
  const textSize = Math.max(12, Math.min(22, unit * 0.36));
  for (const event of events) {
    switch (event.type) {
      case "start":
        resetFx(fx, state);
        break;
      case "gate": {
        const good = isGoodOp(event.op);
        const tone: Tone = good ? "good" : "bad";
        const light: Tone = good ? "goodLight" : "badLight";
        const y = laneCenter(layout, event.lane);
        fx.spawnX = 0.25;
        fx.spawnY = event.lane;
        fx.cascade = event.op.kind === "mul";
        for (let i = 0; i < 16; i++) {
          emit(
            fx,
            "shard",
            i % 3 === 0 ? light : tone,
            front + 4,
            y,
            unit * 3.2,
            unit * 0.14,
            0.7,
            unit * 4,
          );
        }
        if (fx.cascade) {
          for (let i = 0; i < 14; i++)
            emit(fx, "spark", "goodLight", front, y, unit * 2.6, unit * 0.12, 0.8);
        }
        const label = event.op.kind === "mul" ? `${formatOp(event.op)}!` : formatOp(event.op);
        floatText(fx, label, tone, front + 6, y - unit * 0.3, textSize * (fx.cascade ? 1.25 : 1));
        if (event.combo >= 2) {
          floatText(
            fx,
            `Combo ×${event.combo}`,
            "good",
            front + 6,
            y + unit * 0.25,
            textSize * 0.7,
          );
        }
        fx.bounce = 1;
        fx.flash = event.after >= event.before ? 1 : -1;
        break;
      }
      case "blade": {
        const y = laneCenter(layout, event.lane);
        for (let i = 0; i < 18; i++)
          emit(
            fx,
            "spark",
            i % 2 ? "bad" : "badLight",
            front,
            y,
            unit * 3,
            unit * 0.1,
            0.5,
            unit * 3,
          );
        floatText(fx, `−${event.lost}`, "bad", front + 6, y - unit * 0.3, textSize);
        addShake(fx, 3);
        fx.bounce = 1;
        fx.flash = -1;
        break;
      }
      case "enemy": {
        const y = laneCenter(layout, event.lane);
        const pops = Math.min(24, 6 + event.enemy);
        for (let i = 0; i < pops; i++) {
          emit(
            fx,
            "dot",
            i % 2 ? "bad" : "good",
            front + unit * 0.2,
            y + (random(fx) - 0.5) * unit * 0.6,
            unit * 1.8,
            unit * 0.09,
            0.45,
          );
        }
        emit(fx, "ring", "bad", front + unit * 0.2, y, 0, unit * 0.5, 0.35);
        floatText(fx, `−${event.lost}`, "bad", front + 6, y - unit * 0.3, textSize);
        addShake(fx, 2.5);
        fx.bounce = 1;
        fx.flash = -1;
        break;
      }
      case "wall": {
        const pieces = event.passed ? 56 : 18;
        for (let i = 0; i < pieces; i++) {
          const y = layout.top + random(fx) * layout.roadH;
          emit(
            fx,
            "debris",
            i % 4 === 0 ? "fg" : "wall",
            front + unit * 0.3,
            y,
            unit * 5,
            unit * 0.16,
            1.1,
            unit * 9,
            0,
          );
        }
        addShake(fx, event.passed ? 9 : 5);
        fx.slow = event.passed ? 0.12 : 0;
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
            random(fx) * layout.width,
            -6 - random(fx) * layout.height * 0.5,
            unit * 0.6,
            unit * 0.12,
            2.4,
            unit * 1.4,
            Math.PI / 2,
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
      unit.x = fx.spawnX + random(fx) * 0.15;
      unit.y = fx.spawnY + (random(fx) - 0.5) * 0.3;
      unit.vx = -1.5 - random(fx) * 2;
      unit.vy = (random(fx) - 0.5) * 2;
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

export function updateFx(fx: Fx, dtMs: number, state: GateRunnerState, layout: Layout): void {
  let dt = Math.min(0.05, dtMs / 1000);
  if (fx.slow > 0) {
    fx.slow -= dt;
    dt *= 0.25;
  }
  fx.time += dt;
  syncUnits(fx, state);
  const running = state.status !== "over";
  const step = running && state.freeze <= 0 ? 15 : running ? 7 : 0;
  for (let i = 0; i < MAX_UNITS; i++) {
    const unit = fx.units[i];
    if (!unit?.alive) continue;
    if (unit.delay > 0) {
      unit.delay -= dt;
      continue;
    }
    const k = 70 + unit.seed * 80;
    const c = 2 * Math.sqrt(k) * 0.72;
    const tx = slotX(i, fx.shown);
    const ty = state.lane + slotY(i);
    unit.vx += (k * (tx - unit.x) - c * unit.vx) * dt;
    unit.vy += (k * (ty - unit.y) - c * unit.vy) * dt;
    unit.x += unit.vx * dt;
    unit.y += unit.vy * dt;
    unit.phase += dt * step * (0.85 + unit.seed * 0.3);
    if (unit.dying) {
      unit.scale -= dt * 8;
      if (unit.scale <= 0) {
        unit.alive = false;
        unit.dying = false;
        const px = layout.crowdX + unit.x * layout.laneH;
        const py = laneCenter(layout, unit.y);
        emit(fx, "dot", "good", px, py, layout.laneH * 1.2, layout.laneH * 0.06, 0.3);
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
    const drag = p.kind === "confetti" ? 1.6 : 0.9;
    p.vx -= p.vx * drag * dt;
    p.vy += p.gravity * dt - (p.kind === "confetti" ? p.vy * drag * dt : 0);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
  }
  for (const t of fx.texts) {
    if (!t.active) continue;
    t.life -= dt;
    t.y -= dt * layout.laneH * 0.7;
    if (t.life <= 0) t.active = false;
  }
  fx.shake *= Math.exp(-dt * 9);
  if (fx.shake < 0.2) fx.shake = 0;
  fx.bounce = Math.max(0, fx.bounce - dt * 3.2);
  fx.flash *= Math.exp(-dt * 5);
  if (Math.abs(fx.flash) < 0.02) fx.flash = 0;
}
