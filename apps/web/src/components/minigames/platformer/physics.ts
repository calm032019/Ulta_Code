export const ROWS = 6;

export const TILE_EMPTY = 0;
export const TILE_ROOF = 1;
export const TILE_CRATE = 2;
export const TILE_SPIKE = 3;

export const HERO_W = 0.6;
export const HERO_H = 0.8;

const GRAVITY = 42;
export const JUMP_SPEED = 13.8;
const JUMP_CUT = 0.45;
export const MAX_RUN = 6.5;
const GROUND_ACCEL = 45;
const AIR_ACCEL = 30;
const GROUND_FRICTION = 38;
const AIR_DRAG = 6;
const MAX_FALL = 18;
export const COYOTE_TIME = 0.09;
const JUMP_BUFFER = 0.12;
const AIR_JUMP_SPEED = 11.5;

const EPSILON = 1e-4;

export interface TileMap {
  readonly cols: number;
  readonly tiles: ReadonlyArray<number>;
}

/** A one-way platform (a lift) for this physics step; `dx` is how far it moved during the step. */
export interface Platform {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly dx: number;
}

export interface HeroBody {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly platform: number;
  readonly coyote: number;
  readonly buffer: number;
  readonly rising: boolean;
  readonly airJumps: number;
  /** 0 when the hero did not jump this step, 1 for a jump from the ground, 2 for a mid-air jump. */
  readonly jumped: number;
  /** True when a wall stopped the hero's horizontal movement this step. */
  readonly blocked: boolean;
}

interface HeroControl {
  readonly move: number;
  readonly jumpHeld: boolean;
  readonly jumpPressed: boolean;
  readonly maxAirJumps: number;
}

export function tileAt(map: TileMap, col: number, row: number): number {
  if (row < 0 || row >= ROWS) return TILE_EMPTY;
  if (col < 0 || col >= map.cols) return TILE_ROOF;
  return map.tiles[row * map.cols + col] ?? TILE_EMPTY;
}

export function isSolid(tile: number): boolean {
  return tile === TILE_ROOF || tile === TILE_CRATE;
}

function overlapsSolid(map: TileMap, x: number, y: number, w: number, h: number): boolean {
  const c0 = Math.floor(x);
  const c1 = Math.floor(x + w - EPSILON);
  const r0 = Math.floor(y);
  const r1 = Math.floor(y + h - EPSILON);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (isSolid(tileAt(map, col, row))) return true;
    }
  }
  return false;
}

export function touchesSpike(map: TileMap, x: number, y: number, w: number, h: number): boolean {
  const c0 = Math.floor(x);
  const c1 = Math.floor(x + w - EPSILON);
  const r0 = Math.floor(y);
  const r1 = Math.floor(y + h - EPSILON);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (tileAt(map, col, row) !== TILE_SPIKE) continue;
      if (x < col + 0.85 && x + w > col + 0.15 && y + h > row + 0.45 && y < row + 1) return true;
    }
  }
  return false;
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function moveX(map: TileMap, x: number, y: number, dx: number): { x: number; blocked: boolean } {
  const next = x + dx;
  if (!overlapsSolid(map, next, y, HERO_W, HERO_H)) return { x: next, blocked: false };
  if (dx > 0) return { x: Math.floor(next + HERO_W - EPSILON) - HERO_W - EPSILON, blocked: true };
  if (dx < 0) return { x: Math.floor(next) + 1 + EPSILON, blocked: true };
  return { x, blocked: true };
}

/** Advances the hero by one small fixed step; shared by the game and the level validator. */
export function stepHero(
  body: HeroBody,
  control: HeroControl,
  dt: number,
  map: TileMap,
  platforms: ReadonlyArray<Platform>,
): HeroBody {
  let buffer = control.jumpPressed ? JUMP_BUFFER : Math.max(0, body.buffer - dt);
  let coyote = body.grounded ? COYOTE_TIME : Math.max(0, body.coyote - dt);
  let { vx, vy, rising } = body;
  let grounded = body.grounded;
  let airJumps = grounded ? control.maxAirJumps : body.airJumps;
  let jumped = 0;

  const target = control.move * MAX_RUN;
  if (control.move !== 0) {
    const turning = vx !== 0 && Math.sign(vx) !== Math.sign(control.move);
    const accel = (grounded ? GROUND_ACCEL : AIR_ACCEL) + (turning ? GROUND_FRICTION : 0);
    vx = approach(vx, target, accel * dt);
  } else {
    vx = approach(vx, 0, (grounded ? GROUND_FRICTION : AIR_DRAG) * dt);
  }

  if (buffer > 0 && coyote > 0) {
    vy = -JUMP_SPEED;
    grounded = false;
    coyote = 0;
    buffer = 0;
    rising = true;
    jumped = 1;
  } else if (buffer > 0 && !grounded && airJumps > 0) {
    vy = -AIR_JUMP_SPEED;
    airJumps--;
    buffer = 0;
    rising = true;
    jumped = 2;
  }
  if (rising && (vy >= 0 || !control.jumpHeld)) {
    if (vy < 0) vy *= JUMP_CUT;
    rising = false;
  }
  vy = Math.min(MAX_FALL, vy + GRAVITY * dt);

  let x = body.x;
  let y = body.y;
  const riding = grounded ? platforms[body.platform] : undefined;
  if (riding && riding.dx !== 0) x = moveX(map, x, y, riding.dx).x;
  const horizontal = moveX(map, x, y, vx * dt);
  x = horizontal.x;
  if (horizontal.blocked) vx = 0;
  if (x < 0) {
    x = 0;
    vx = 0;
  }
  if (x > map.cols - HERO_W) {
    x = map.cols - HERO_W;
    vx = 0;
  }

  const previousBottom = y + HERO_H;
  y += vy * dt;
  grounded = false;
  let platform = -1;
  if (vy > 0) {
    if (overlapsSolid(map, x, y, HERO_W, HERO_H)) {
      y = Math.floor(y + HERO_H - EPSILON) - HERO_H;
      vy = 0;
      grounded = true;
    } else {
      for (let index = 0; index < platforms.length; index++) {
        const candidate = platforms[index];
        if (!candidate) continue;
        const overlapsX = x < candidate.x + candidate.w && x + HERO_W > candidate.x;
        if (overlapsX && previousBottom <= candidate.y + 0.02 && y + HERO_H >= candidate.y) {
          y = candidate.y - HERO_H;
          vy = 0;
          grounded = true;
          platform = index;
          break;
        }
      }
    }
  } else if (vy < 0) {
    if (overlapsSolid(map, x, y, HERO_W, HERO_H)) {
      y = Math.floor(y) + 1;
      vy = 0;
      rising = false;
    } else if (y < 0) {
      y = 0;
      vy = 0;
      rising = false;
    }
  }

  return {
    x,
    y,
    vx,
    vy,
    grounded,
    platform,
    coyote,
    buffer,
    rising,
    airJumps,
    jumped,
    blocked: horizontal.blocked,
  };
}
