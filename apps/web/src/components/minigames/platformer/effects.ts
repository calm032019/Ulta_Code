import type { GameEvent, GameState } from "./logic";
import { STAR_POINTS, START_LIVES, stompPoints } from "./logic";
import { HERO_H, HERO_W } from "./physics";

const MAX_PARTICLES = 200;
const SCARF_POINTS = 6;
const SCARF_SEGMENT = 0.11;

export const PARTICLE_DUST = 0;
const PARTICLE_SPARK = 1;
export const PARTICLE_TEXT = 2;
export const PARTICLE_CONFETTI = 3;

/** Colour slots particles paint with; render maps them to the palette. */
const TINT_DUST = 0;
const TINT_SUCCESS = 1;
const TINT_DANGER = 2;
const TINT_ACCENT = 3;
const TINT_FOREGROUND = 4;
const TINT_SECONDARY = 5;

interface Particle {
  active: boolean;
  kind: number;
  tint: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  spin: number;
  text: string;
}

interface ScarfPoint {
  x: number;
  y: number;
  px: number;
  py: number;
}

/** Visual-only state layered over the game: never snapshotted and never read by the logic. */
export interface Effects {
  readonly particles: Particle[];
  cursor: number;
  readonly scarf: ScarfPoint[];
  time: number;
  squash: number;
  shake: number;
  hitStop: number;
  flash: number;
  runPhase: number;
  skidTimer: number;
  displayScore: number;
  readonly heartPop: number[];
  seed: number;
}

export function createEffects(state: GameState): Effects {
  const particles: Particle[] = [];
  for (let index = 0; index < MAX_PARTICLES; index++) {
    particles.push({
      active: false,
      kind: 0,
      tint: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      life: 0,
      maxLife: 1,
      size: 0,
      rotation: 0,
      spin: 0,
      text: "",
    });
  }
  const fx: Effects = {
    particles,
    cursor: 0,
    scarf: Array.from({ length: SCARF_POINTS }, () => ({ x: 0, y: 0, px: 0, py: 0 })),
    time: 0,
    squash: 0,
    shake: 0,
    hitStop: 0,
    flash: 0,
    runPhase: 0,
    skidTimer: 0,
    displayScore: state.score,
    heartPop: Array.from({ length: START_LIVES }, () => 0),
    seed: 1,
  };
  resetScarf(fx, state);
  return fx;
}

function random(fx: Effects): number {
  fx.seed = (fx.seed * 1664525 + 1013904223) >>> 0;
  return fx.seed / 4294967296;
}

function spawn(
  fx: Effects,
  kind: number,
  tint: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  life: number,
  size: number,
  gravity: number,
  text = "",
): void {
  const particle = fx.particles[fx.cursor];
  fx.cursor = (fx.cursor + 1) % MAX_PARTICLES;
  if (!particle) return;
  particle.active = true;
  particle.kind = kind;
  particle.tint = tint;
  particle.x = x;
  particle.y = y;
  particle.vx = vx;
  particle.vy = vy;
  particle.life = life;
  particle.maxLife = life;
  particle.size = size;
  particle.gravity = gravity;
  particle.rotation = random(fx) * Math.PI * 2;
  particle.spin = (random(fx) - 0.5) * 12;
  particle.text = text;
}

function burst(
  fx: Effects,
  tint: number,
  x: number,
  y: number,
  count: number,
  speed: number,
): void {
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2 + random(fx) * 0.5;
    const velocity = speed * (0.5 + random(fx) * 0.6);
    spawn(
      fx,
      PARTICLE_SPARK,
      tint,
      x,
      y,
      Math.cos(angle) * velocity,
      Math.sin(angle) * velocity,
      0.45,
      0.07,
      6,
    );
  }
}

function dust(
  fx: Effects,
  x: number,
  y: number,
  count: number,
  spread: number,
  direction = 0,
): void {
  for (let index = 0; index < count; index++) {
    const side = direction === 0 ? (random(fx) < 0.5 ? -1 : 1) : direction;
    spawn(
      fx,
      PARTICLE_DUST,
      TINT_DUST,
      x + (random(fx) - 0.5) * 0.3,
      y - 0.05,
      side * spread * (0.4 + random(fx)),
      -0.6 - random(fx) * 0.8,
      0.35 + random(fx) * 0.25,
      0.07 + random(fx) * 0.06,
      -1,
    );
  }
}

function floatText(fx: Effects, tint: number, x: number, y: number, text: string): void {
  spawn(fx, PARTICLE_TEXT, tint, x, y, 0, -1.4, 0.9, 0, 0, text);
}

function resetScarf(fx: Effects, state: GameState): void {
  const anchorX = state.hero.x + HERO_W / 2;
  const anchorY = state.hero.y + HERO_H * 0.45;
  fx.scarf.forEach((point, index) => {
    point.x = anchorX - state.facing * index * SCARF_SEGMENT;
    point.y = anchorY;
    point.px = point.x;
    point.py = point.y;
  });
}

export function applyEvents(
  fx: Effects,
  state: GameState,
  events: ReadonlyArray<GameEvent>,
  motion: boolean,
) {
  for (const event of events) {
    switch (event.kind) {
      case "start":
      case "level":
        resetScarf(fx, state);
        fx.flash = 0;
        break;
      case "jump":
        dust(fx, event.x, event.y, 3, 1.2);
        break;
      case "airJump":
        burst(fx, TINT_ACCENT, event.x, event.y, 8, 2.4);
        break;
      case "land": {
        const impact = Math.min(1, event.value / 16);
        if (impact > 0.25) dust(fx, event.x, event.y, 2 + Math.round(impact * 5), 1.6 * impact);
        fx.squash = Math.max(fx.squash, impact * 0.32);
        break;
      }
      case "turn":
        dust(fx, event.x, event.y, 3, 1.4, -event.value);
        break;
      case "skid":
        if (fx.skidTimer <= 0) {
          dust(fx, event.x, event.y, 1, 0.5, -event.value);
          fx.skidTimer = 0.06;
        }
        break;
      case "star":
        burst(fx, TINT_SUCCESS, event.x, event.y, 8, 2.6);
        floatText(fx, TINT_SUCCESS, event.x, event.y - 0.3, `+${STAR_POINTS}`);
        break;
      case "stomp": {
        burst(fx, TINT_DANGER, event.x, event.y, 12, 3.4);
        const points = stompPoints(event.value);
        floatText(
          fx,
          event.value > 1 ? TINT_ACCENT : TINT_FOREGROUND,
          event.x,
          event.y - 0.4,
          event.value > 1 ? `×${event.value} +${points}` : `+${points}`,
        );
        if (motion) fx.shake = Math.max(fx.shake, 0.12);
        break;
      }
      case "hurt":
      case "fall":
        fx.heartPop[Math.max(0, Math.min(START_LIVES - 1, event.value))] = 0.5;
        burst(fx, TINT_DANGER, event.x, event.y, 10, 3);
        fx.hitStop = 0.06;
        if (motion) fx.shake = Math.max(fx.shake, 0.35);
        if (event.kind === "fall") resetScarf(fx, state);
        break;
      case "complete":
        fx.flash = 1;
        burst(fx, TINT_ACCENT, event.x, event.y, 24, 5);
        break;
      case "over":
        if (state.score > state.bestAtStart && state.score > 0) {
          for (let index = 0; index < 70; index++) {
            spawn(
              fx,
              PARTICLE_CONFETTI,
              index % 4 === 0
                ? TINT_ACCENT
                : index % 4 === 1
                  ? TINT_SUCCESS
                  : index % 4 === 2
                    ? TINT_DANGER
                    : TINT_SECONDARY,
              state.camX + random(fx) * state.viewCols,
              -0.5 - random(fx) * 2,
              (random(fx) - 0.5) * 2,
              random(fx) * 2,
              2.6 + random(fx),
              0.09,
              3,
            );
          }
        }
        break;
    }
  }
}

/** Advances the visual effects by one rendered frame. */
export function updateEffects(fx: Effects, state: GameState, dt: number): void {
  fx.time += dt;
  fx.squash = Math.max(0, fx.squash - dt * 2.2);
  fx.shake = Math.max(0, fx.shake - dt * 1.6);
  fx.flash = Math.max(0, fx.flash - dt * 1.4);
  fx.skidTimer -= dt;
  for (let index = 0; index < fx.heartPop.length; index++) {
    fx.heartPop[index] = Math.max(0, (fx.heartPop[index] ?? 0) - dt);
  }
  const gap = state.score - fx.displayScore;
  fx.displayScore = Math.abs(gap) < 0.5 ? state.score : fx.displayScore + gap * Math.min(1, dt * 7);
  const hero = state.hero;
  if (hero.grounded && Math.abs(hero.vx) > 0.2) fx.runPhase += Math.abs(hero.vx) * dt * 0.55;

  for (const particle of fx.particles) {
    if (!particle.active) continue;
    particle.life -= dt;
    if (particle.life <= 0) {
      particle.active = false;
      continue;
    }
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.rotation += particle.spin * dt;
    if (particle.kind === PARTICLE_DUST) particle.vx *= 1 - Math.min(1, dt * 3);
  }

  const anchor = fx.scarf[0];
  if (!anchor) return;
  anchor.x = hero.x + HERO_W / 2 - state.facing * 0.14;
  anchor.y = hero.y + HERO_H * 0.42;
  anchor.px = anchor.x;
  anchor.py = anchor.y;
  const step = Math.min(dt, 1 / 30);
  const wind = -state.facing * 4 + Math.sin(fx.time * 7) * 1.5;
  for (let index = 1; index < fx.scarf.length; index++) {
    const point = fx.scarf[index];
    if (!point) continue;
    const vx = (point.x - point.px) * 0.9;
    const vy = (point.y - point.py) * 0.9;
    point.px = point.x;
    point.py = point.y;
    point.x += vx + wind * step * step;
    point.y += vy + 9 * step * step + Math.sin(fx.time * 9 + index) * 0.002;
  }
  for (let iteration = 0; iteration < 3; iteration++) {
    for (let index = 1; index < fx.scarf.length; index++) {
      const a = fx.scarf[index - 1];
      const b = fx.scarf[index];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1e-6;
      const correction = (distance - SCARF_SEGMENT) / distance;
      if (index === 1) {
        b.x -= dx * correction;
        b.y -= dy * correction;
      } else {
        a.x += dx * correction * 0.5;
        a.y += dy * correction * 0.5;
        b.x -= dx * correction * 0.5;
        b.y -= dy * correction * 0.5;
      }
    }
  }
}
