import { ROBOT_X, type RunEvent, type RunState } from "./logic";

export const MAX_PARTICLES = 150;
const MAX_POPUPS = 2;
export const TAIL_POINTS = 6;
const TAIL_SEGMENT = 3.4;
export const HIT_STOP_MS = 70;
const SHAKE_MS = 280;
export const POPUP_MS = 950;
export const BANNER_MS = 1500;

export const ParticleColour = {
  Dust: 0,
  Crate: 1,
  CrateDark: 2,
  Accent: 3,
  Danger: 4,
  Success: 5,
  Muted: 6,
  Spark: 7,
} as const;
export type ParticleColour = (typeof ParticleColour)[keyof typeof ParticleColour];

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  gravity: number;
  angle: number;
  spin: number;
  colour: ParticleColour;
  square: boolean;
}

export interface Popup {
  active: boolean;
  text: string;
  x: number;
  y: number;
  age: number;
}

/** Visual-only animation state. Mutated in place each frame so the loop allocates nothing. */
export interface Fx {
  readonly reducedMotion: boolean;
  time: number;
  seed: number;
  particles: Particle[];
  popups: Popup[];
  shakeMs: number;
  hitStopMs: number;
  squash: number;
  squashVelocity: number;
  antenna: number;
  antennaVelocity: number;
  lastVy: number;
  tail: Float64Array;
  blinkAt: number;
  blinkMs: number;
  displayScore: number;
  legPhase: number;
  lastDistance: number;
  dustDistance: number;
  bannerText: string;
  bannerMs: number;
  cardMs: number;
}

function random(fx: Fx): number {
  fx.seed = (fx.seed + 0x6d2b79f5) >>> 0;
  let t = fx.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function tailAnchor(state: RunState): { readonly x: number; readonly y: number } {
  return state.ducking
    ? { x: ROBOT_X + 1, y: state.robotY + 9 }
    : { x: ROBOT_X + 1.5, y: state.robotY + 13 };
}

export function createFx(reducedMotion: boolean, seed: number, state: RunState): Fx {
  const fx: Fx = {
    reducedMotion,
    time: 0,
    seed: seed >>> 0,
    particles: Array.from({ length: MAX_PARTICLES }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      life: 1,
      size: 1,
      gravity: 0,
      angle: 0,
      spin: 0,
      colour: ParticleColour.Dust,
      square: false,
    })),
    popups: Array.from({ length: MAX_POPUPS }, () => ({
      active: false,
      text: "",
      x: 0,
      y: 0,
      age: 0,
    })),
    shakeMs: 0,
    hitStopMs: 0,
    squash: 0,
    squashVelocity: 0,
    antenna: 0,
    antennaVelocity: 0,
    lastVy: state.robotVy,
    tail: new Float64Array(TAIL_POINTS * 4),
    blinkAt: 1800,
    blinkMs: 0,
    displayScore: state.score,
    legPhase: 0,
    lastDistance: state.distance,
    dustDistance: 0,
    bannerText: "",
    bannerMs: 0,
    cardMs: state.phase === "over" ? 1000 : 0,
  };
  resetTail(fx, state);
  return fx;
}

function resetTail(fx: Fx, state: RunState): void {
  const anchor = tailAnchor(state);
  for (let index = 0; index < TAIL_POINTS; index += 1) {
    const offset = index * 4;
    fx.tail[offset] = anchor.x - index * TAIL_SEGMENT;
    fx.tail[offset + 1] = anchor.y - index;
    fx.tail[offset + 2] = fx.tail[offset]!;
    fx.tail[offset + 3] = fx.tail[offset + 1]!;
  }
}

function emitParticle(
  fx: Fx,
  x: number,
  y: number,
  vx: number,
  vy: number,
  life: number,
  size: number,
  gravity: number,
  colour: ParticleColour,
  square: boolean,
): void {
  const particle = fx.particles.find((candidate) => !candidate.active);
  if (!particle) return;
  particle.active = true;
  particle.x = x;
  particle.y = y;
  particle.vx = vx;
  particle.vy = vy;
  particle.age = 0;
  particle.life = life;
  particle.size = size;
  particle.gravity = gravity;
  particle.angle = random(fx) * Math.PI;
  particle.spin = (random(fx) - 0.5) * 14;
  particle.colour = colour;
  particle.square = square;
}

function burst(fx: Fx, count: number): number {
  return fx.reducedMotion ? Math.ceil(count / 3) : count;
}

function dust(fx: Fx, x: number, count: number, strength: number): void {
  for (let index = 0; index < burst(fx, count); index += 1) {
    const direction = index % 2 === 0 ? -1 : 1;
    emitParticle(
      fx,
      x + (random(fx) - 0.5) * 10,
      1 + random(fx) * 2,
      direction * (20 + random(fx) * 50) * strength - 60,
      (15 + random(fx) * 35) * strength,
      380 + random(fx) * 260,
      1.6 + random(fx) * 2.2,
      -60,
      ParticleColour.Dust,
      false,
    );
  }
}

function popup(fx: Fx, text: string, x: number, y: number): void {
  const slot =
    fx.popups.find((candidate) => !candidate.active) ??
    fx.popups.reduce((oldest, candidate) => (candidate.age > oldest.age ? candidate : oldest));
  slot.active = true;
  slot.text = text;
  slot.x = x;
  slot.y = y;
  slot.age = 0;
}

export function handleEvent(fx: Fx, event: RunEvent, state: RunState): void {
  const feetX = ROBOT_X + 11;
  switch (event.type) {
    case "start":
    case "restart":
      fx.cardMs = 0;
      fx.displayScore = state.score;
      fx.lastDistance = state.distance;
      for (const particle of fx.particles) {
        if (particle.colour !== ParticleColour.Dust) particle.active = false;
      }
      resetTail(fx, state);
      return;
    case "jump":
      fx.squash = 0.2;
      fx.squashVelocity = 2;
      dust(fx, feetX, 4, 0.6);
      return;
    case "land": {
      const strength = Math.min(1, event.impact / 700);
      fx.squash = -0.12 - 0.14 * strength;
      fx.squashVelocity = 0;
      dust(fx, feetX, 4 + Math.round(5 * strength), 0.5 + strength);
      return;
    }
    case "clear":
      return;
    case "near-miss":
      popup(fx, `+${event.bonus} Close!`, Math.max(event.x, ROBOT_X + 40) + 8, event.y + 18);
      for (let index = 0; index < burst(fx, 8); index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        emitParticle(
          fx,
          event.x,
          event.y + 4,
          Math.cos(angle) * 70 - 80,
          Math.sin(angle) * 70,
          420,
          1.6,
          0,
          ParticleColour.Spark,
          false,
        );
      }
      return;
    case "milestone":
      fx.bannerText = `${event.score} points`;
      fx.bannerMs = BANNER_MS;
      return;
    case "crash":
      fx.hitStopMs = HIT_STOP_MS;
      fx.shakeMs = fx.reducedMotion ? 0 : SHAKE_MS;
      fx.cardMs = 0;
      for (let index = 0; index < burst(fx, 20); index += 1) {
        const colour =
          index % 3 === 0
            ? ParticleColour.Accent
            : index % 3 === 1
              ? ParticleColour.Crate
              : ParticleColour.CrateDark;
        emitParticle(
          fx,
          event.x + 6,
          event.y,
          (random(fx) - 0.3) * 260,
          80 + random(fx) * 240,
          900 + random(fx) * 500,
          1.8 + random(fx) * 2.6,
          900,
          colour,
          true,
        );
      }
      if (event.newBest) {
        const colours: ReadonlyArray<ParticleColour> = [
          ParticleColour.Accent,
          ParticleColour.Danger,
          ParticleColour.Success,
          ParticleColour.Muted,
        ];
        for (let index = 0; index < burst(fx, 48); index += 1) {
          emitParticle(
            fx,
            state.viewWidth * (0.2 + random(fx) * 0.6),
            state.viewHeight - 20 + random(fx) * 20,
            (random(fx) - 0.5) * 160,
            -20 - random(fx) * 40,
            1600 + random(fx) * 900,
            2 + random(fx) * 1.8,
            90,
            colours[index % colours.length]!,
            true,
          );
        }
      }
  }
}

export function updateFx(fx: Fx, state: RunState, elapsedMs: number): void {
  const dt = elapsedMs / 1000;
  fx.time += elapsedMs;
  fx.shakeMs = Math.max(0, fx.shakeMs - elapsedMs);
  fx.bannerMs = Math.max(0, fx.bannerMs - elapsedMs);
  for (const item of fx.popups) {
    if (!item.active) continue;
    item.age += elapsedMs;
    if (item.age >= POPUP_MS) item.active = false;
  }

  if (fx.hitStopMs > 0) {
    fx.hitStopMs = Math.max(0, fx.hitStopMs - elapsedMs);
    return;
  }
  if (state.phase === "over") fx.cardMs += elapsedMs;

  fx.squashVelocity += (-260 * fx.squash - 16 * fx.squashVelocity) * dt;
  fx.squash += fx.squashVelocity * dt;

  const accel = dt > 0 ? (state.robotVy - fx.lastVy) / dt : 0;
  fx.lastVy = state.robotVy;
  const lean = state.phase === "running" ? -(state.speed - 200) / 1400 : 0;
  fx.antennaVelocity +=
    (-180 * (fx.antenna - lean) -
      7 * fx.antennaVelocity +
      Math.max(-4000, Math.min(4000, accel)) * 0.004) *
    dt;
  fx.antenna = Math.max(-1.1, Math.min(1.1, fx.antenna + fx.antennaVelocity * dt));

  const travelled = Math.max(0, state.distance - fx.lastDistance);
  fx.lastDistance = state.distance;
  if (state.grounded && state.phase === "running") {
    fx.legPhase += travelled / 6;
    fx.dustDistance += travelled;
    if (fx.dustDistance > 64 && !fx.reducedMotion) {
      fx.dustDistance = 0;
      dust(fx, ROBOT_X + 4, 1, 0.4);
    }
  }

  if (fx.blinkMs > 0) {
    fx.blinkMs = Math.max(0, fx.blinkMs - elapsedMs);
  } else if (fx.time >= fx.blinkAt) {
    fx.blinkMs = 140;
    fx.blinkAt = fx.time + 1800 + random(fx) * 2800;
  }

  const scoreGap = state.score - fx.displayScore;
  fx.displayScore =
    Math.abs(scoreGap) < 0.5 ? state.score : fx.displayScore + scoreGap * Math.min(1, dt * 10);

  updateTail(fx, state, dt);

  for (const particle of fx.particles) {
    if (!particle.active) continue;
    particle.age += elapsedMs;
    if (particle.age >= particle.life) {
      particle.active = false;
      continue;
    }
    particle.vy -= particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.angle += particle.spin * dt;
    if (particle.y < 0 && particle.gravity > 0) {
      particle.y = 0;
      particle.vy *= -0.35;
      particle.vx *= 0.6;
    }
  }
}

function updateTail(fx: Fx, state: RunState, dt: number): void {
  const anchor = tailAnchor(state);
  const tail = fx.tail;
  const wind = state.phase === "running" ? state.speed : 40 + Math.sin(fx.time / 500) * 30;
  const damping = 0.9;
  for (let index = 1; index < TAIL_POINTS; index += 1) {
    const offset = index * 4;
    const x = tail[offset]!;
    const y = tail[offset + 1]!;
    const vx = (x - tail[offset + 2]!) * damping;
    const vy = (y - tail[offset + 3]!) * damping;
    tail[offset + 2] = x;
    tail[offset + 3] = y;
    tail[offset] = x + vx - wind * 0.06 * dt;
    tail[offset + 1] = Math.max(0.8, y + vy - 3000 * dt * dt);
  }
  tail[0] = anchor.x;
  tail[1] = anchor.y;
  tail[2] = anchor.x;
  tail[3] = anchor.y;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (let index = 1; index < TAIL_POINTS; index += 1) {
      const a = (index - 1) * 4;
      const b = index * 4;
      const dx = tail[b]! - tail[a]!;
      const dy = tail[b + 1]! - tail[a + 1]!;
      const length = Math.hypot(dx, dy) || 1;
      const correction = (length - TAIL_SEGMENT) / length;
      if (index === 1) {
        tail[b] = tail[b]! - dx * correction;
        tail[b + 1] = tail[b + 1]! - dy * correction;
      } else {
        tail[a] = tail[a]! + dx * correction * 0.5;
        tail[a + 1] = tail[a + 1]! + dy * correction * 0.5;
        tail[b] = tail[b]! - dx * correction * 0.5;
        tail[b + 1] = tail[b + 1]! - dy * correction * 0.5;
      }
    }
  }
}

export function shakeOffset(fx: Fx): { readonly x: number; readonly y: number } {
  if (fx.shakeMs <= 0) return { x: 0, y: 0 };
  const strength = (fx.shakeMs / SHAKE_MS) ** 2 * 4;
  return {
    x: Math.sin(fx.time * 0.11) * strength,
    y: Math.cos(fx.time * 0.137) * strength * 0.6,
  };
}

export function isBlinking(fx: Fx): boolean {
  return fx.blinkMs > 0;
}

export function hasActiveEffects(fx: Fx): boolean {
  return (
    fx.shakeMs > 0 ||
    fx.hitStopMs > 0 ||
    fx.bannerMs > 0 ||
    Math.abs(fx.squash) > 0.01 ||
    fx.particles.some((particle) => particle.active) ||
    fx.popups.some((item) => item.active)
  );
}
