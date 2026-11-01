export const SNAPSHOT_VERSION = 1;
export const STEP_MS = 1000 / 120;
export const WORLD_HEIGHT = 180;
export const MIN_WORLD_WIDTH = 400;
export const GROUND_OFFSET = 28;

export const ROBOT_X = 48;
export const ROBOT_WIDTH = 22;
export const ROBOT_HEIGHT = 26;
export const ROBOT_DUCK_WIDTH = 28;
export const ROBOT_DUCK_HEIGHT = 15;
const ROBOT_INSET = 3;
const OBSTACLE_INSET = 2;

export const GRAVITY = 2400;
export const JUMP_VELOCITY = 620;
const HOLD_GRAVITY_FACTOR = 0.7;
const MAX_HOLD_MS = 180;
const FAST_FALL_FACTOR = 3;
const JUMP_BUFFER_MS = 120;
export const TAP_AIRTIME = (2 * JUMP_VELOCITY) / GRAVITY;

export const START_SPEED = 260;
export const MAX_SPEED = 620;
const ACCELERATION = 4;
const DISTANCE_PER_POINT = 25;
const BUG_SCORE = 200;
const FIRST_SPAWN_LEAD = 220;
export const RESTART_DELAY_MS = 350;
const FLASH_MS = 800;
const MAX_STEP_MS = 50;

export type Phase = "ready" | "running" | "over";
export type ObstacleKind =
  | "crate"
  | "crates-wide"
  | "crates-tall"
  | "crates-stack"
  | "spool"
  | "bug-low"
  | "bug-high";

export interface Obstacle {
  readonly kind: ObstacleKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface RunState {
  readonly phase: Phase;
  readonly rng: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly distance: number;
  readonly speed: number;
  readonly score: number;
  readonly best: number;
  readonly robotY: number;
  readonly robotVy: number;
  readonly grounded: boolean;
  readonly ducking: boolean;
  readonly jumpHoldMs: number;
  readonly jumpBufferMs: number;
  readonly obstacles: ReadonlyArray<Obstacle>;
  readonly nextSpawnX: number;
  readonly flashMs: number;
  readonly overMs: number;
}

export interface RunInput {
  readonly jumpHeld: boolean;
  readonly jumpPressed: boolean;
  readonly duckHeld: boolean;
}

export const NO_INPUT: RunInput = { jumpHeld: false, jumpPressed: false, duckHeld: false };

const SHAPES: Record<ObstacleKind, { readonly w: number; readonly h: number; readonly y: number }> =
  {
    crate: { w: 16, h: 16, y: 0 },
    "crates-wide": { w: 32, h: 16, y: 0 },
    "crates-tall": { w: 16, h: 32, y: 0 },
    "crates-stack": { w: 32, h: 32, y: 0 },
    spool: { w: 22, h: 22, y: 0 },
    "bug-low": { w: 18, h: 12, y: 6 },
    "bug-high": { w: 18, h: 12, y: 17 },
  };

const GROUND_KINDS: ReadonlyArray<ObstacleKind> = [
  "crate",
  "crate",
  "crates-wide",
  "crates-tall",
  "crates-stack",
  "spool",
  "spool",
];

function nextRandom(seed: number): { readonly value: number; readonly seed: number } {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

export function viewport(
  width: number,
  height: number,
): { readonly scale: number; readonly width: number; readonly height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(safeHeight / WORLD_HEIGHT, safeWidth / MIN_WORLD_WIDTH);
  return { scale, width: safeWidth / scale, height: safeHeight / scale };
}

/** Minimum clear run between one obstacle's trailing edge and the next one's leading edge. */
export function minimumGap(speed: number): number {
  return speed * (TAP_AIRTIME + 0.16) + 24;
}

export function initialState(seed: number, width: number, height: number, best = 0): RunState {
  const view = viewport(width, height);
  return {
    phase: "ready",
    rng: seed >>> 0,
    viewWidth: view.width,
    viewHeight: view.height,
    distance: 0,
    speed: START_SPEED,
    score: 0,
    best,
    robotY: 0,
    robotVy: 0,
    grounded: true,
    ducking: false,
    jumpHoldMs: 0,
    jumpBufferMs: 0,
    obstacles: [],
    nextSpawnX: view.width + FIRST_SPAWN_LEAD,
    flashMs: 0,
    overMs: 0,
  };
}

export function withViewport(state: RunState, width: number, height: number): RunState {
  const view = viewport(width, height);
  return {
    ...state,
    viewWidth: view.width,
    viewHeight: view.height,
    nextSpawnX:
      state.phase === "ready" && state.obstacles.length === 0
        ? view.width + FIRST_SPAWN_LEAD
        : state.nextSpawnX,
  };
}

export function needsFrames(state: RunState): boolean {
  return (
    state.phase === "running" ||
    state.flashMs > 0 ||
    (state.phase === "over" && state.overMs < RESTART_DELAY_MS)
  );
}

export function robotBox(state: RunState): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} {
  return {
    x: ROBOT_X,
    y: state.robotY,
    w: state.ducking ? ROBOT_DUCK_WIDTH : ROBOT_WIDTH,
    h: state.ducking ? ROBOT_DUCK_HEIGHT : ROBOT_HEIGHT,
  };
}

function collides(state: RunState, obstacle: Obstacle): boolean {
  const robot = robotBox(state);
  return (
    robot.x + ROBOT_INSET < obstacle.x + obstacle.w - OBSTACLE_INSET &&
    robot.x + robot.w - ROBOT_INSET > obstacle.x + OBSTACLE_INSET &&
    robot.y + ROBOT_INSET < obstacle.y + obstacle.h - OBSTACLE_INSET &&
    robot.y + robot.h - ROBOT_INSET > obstacle.y + OBSTACLE_INSET
  );
}

function spawn(
  rng: number,
  score: number,
  speed: number,
  x: number,
): { readonly obstacle: Obstacle; readonly gap: number; readonly rng: number } {
  const kindRoll = nextRandom(rng);
  const pickRoll = nextRandom(kindRoll.seed);
  const gapRoll = nextRandom(pickRoll.seed);
  const bugChance = score < BUG_SCORE ? 0 : Math.min(0.35, 0.15 + (score - BUG_SCORE) / 4000);
  const kind: ObstacleKind =
    kindRoll.value < bugChance
      ? pickRoll.value < 0.5
        ? "bug-low"
        : "bug-high"
      : (GROUND_KINDS[Math.floor(pickRoll.value * GROUND_KINDS.length)] ?? "crate");
  const shape = SHAPES[kind];
  const gap = minimumGap(speed + 20) + gapRoll.value * (160 + speed * 0.5);
  return { obstacle: { kind, x, y: shape.y, w: shape.w, h: shape.h }, gap, rng: gapRoll.seed };
}

function restart(state: RunState): RunState {
  const roll = nextRandom(state.rng);
  const fresh = initialState(Math.floor(roll.value * 4294967296), 1, 1, state.best);
  return {
    ...fresh,
    phase: "running",
    viewWidth: state.viewWidth,
    viewHeight: state.viewHeight,
    nextSpawnX: state.viewWidth + FIRST_SPAWN_LEAD,
  };
}

export function step(state: RunState, dtMs: number, input: RunInput): RunState {
  const dtClamped = Math.min(Math.max(dtMs, 0), MAX_STEP_MS);
  const dt = dtClamped / 1000;
  const flashMs = Math.max(0, state.flashMs - dtClamped);

  if (state.phase === "ready") {
    if (!input.jumpPressed) return state;
    return {
      ...state,
      phase: "running",
      grounded: false,
      ducking: false,
      robotVy: JUMP_VELOCITY,
      jumpHoldMs: 0,
    };
  }

  if (state.phase === "over") {
    const overMs = state.overMs + dtClamped;
    if (input.jumpPressed && state.overMs >= RESTART_DELAY_MS) return restart(state);
    return { ...state, overMs, flashMs };
  }

  let { robotY, robotVy, grounded, jumpHoldMs, jumpBufferMs } = state;
  jumpBufferMs = input.jumpPressed ? JUMP_BUFFER_MS : Math.max(0, jumpBufferMs - dtClamped);

  if (grounded && jumpBufferMs > 0) {
    grounded = false;
    robotVy = JUMP_VELOCITY;
    jumpHoldMs = 0;
    jumpBufferMs = 0;
  }

  if (!grounded) {
    let gravity = GRAVITY;
    if (input.duckHeld) {
      gravity *= FAST_FALL_FACTOR;
    } else if (input.jumpHeld && robotVy > 0 && jumpHoldMs < MAX_HOLD_MS) {
      gravity *= HOLD_GRAVITY_FACTOR;
      jumpHoldMs += dtClamped;
    } else {
      jumpHoldMs = MAX_HOLD_MS;
    }
    robotVy -= gravity * dt;
    robotY += robotVy * dt;
    if (robotY <= 0) {
      robotY = 0;
      robotVy = 0;
      grounded = true;
    }
  }

  const ducking = grounded && input.duckHeld;
  const speed = Math.min(MAX_SPEED, state.speed + ACCELERATION * dt);
  const travel = speed * dt;
  const distance = state.distance + travel;
  const score = Math.floor(distance / DISTANCE_PER_POINT);

  const obstacles: Obstacle[] = [];
  for (const obstacle of state.obstacles) {
    const x = obstacle.x - travel;
    if (x + obstacle.w > -40) obstacles.push({ ...obstacle, x });
  }

  let rng = state.rng;
  let nextSpawnX = state.nextSpawnX - travel;
  while (nextSpawnX < state.viewWidth + 40) {
    const spawned = spawn(rng, score, speed, nextSpawnX);
    obstacles.push(spawned.obstacle);
    rng = spawned.rng;
    nextSpawnX += spawned.obstacle.w + spawned.gap;
  }

  const crossedHundred = Math.floor(score / 100) > Math.floor(state.score / 100);
  const next: RunState = {
    ...state,
    rng,
    distance,
    speed,
    score,
    robotY,
    robotVy,
    grounded,
    ducking,
    jumpHoldMs,
    jumpBufferMs,
    obstacles,
    nextSpawnX,
    flashMs: crossedHundred ? FLASH_MS : flashMs,
  };

  if (obstacles.some((obstacle) => collides(next, obstacle))) {
    return { ...next, phase: "over", overMs: 0, best: Math.max(state.best, score) };
  }
  return next;
}

export function toSnapshot(state: RunState): unknown {
  return {
    version: SNAPSHOT_VERSION,
    ...state,
    obstacles: state.obstacles.map((obstacle) => ({ ...obstacle })),
  };
}

const NUMBER_FIELDS = [
  "rng",
  "viewWidth",
  "viewHeight",
  "distance",
  "speed",
  "score",
  "best",
  "robotY",
  "robotVy",
  "jumpHoldMs",
  "jumpBufferMs",
  "nextSpawnX",
  "flashMs",
  "overMs",
] as const;

const OBSTACLE_KINDS = new Set<string>(Object.keys(SHAPES));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readObstacle(value: unknown): Obstacle | null {
  if (!isRecord(value)) return null;
  const { kind, x, y, w, h } = value;
  if (typeof kind !== "string" || !OBSTACLE_KINDS.has(kind)) return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
    return null;
  }
  return { kind: kind as ObstacleKind, x, y, w, h };
}

export function fromSnapshot(value: unknown): RunState | null {
  if (!isRecord(value) || value.version !== SNAPSHOT_VERSION) return null;
  for (const field of NUMBER_FIELDS) {
    if (!isFiniteNumber(value[field])) return null;
  }
  const { phase, grounded, ducking, obstacles } = value;
  if (phase !== "ready" && phase !== "running" && phase !== "over") return null;
  if (typeof grounded !== "boolean" || typeof ducking !== "boolean") return null;
  if (!Array.isArray(obstacles)) return null;
  const parsed: Obstacle[] = [];
  for (const entry of obstacles) {
    const obstacle = readObstacle(entry);
    if (!obstacle) return null;
    parsed.push(obstacle);
  }
  const numbers = value as Record<(typeof NUMBER_FIELDS)[number], number>;
  if (numbers.viewWidth <= 0 || numbers.viewHeight <= 0 || numbers.speed <= 0) return null;
  return {
    phase,
    rng: numbers.rng >>> 0,
    viewWidth: numbers.viewWidth,
    viewHeight: numbers.viewHeight,
    distance: numbers.distance,
    speed: Math.min(MAX_SPEED, numbers.speed),
    score: Math.max(0, Math.floor(numbers.score)),
    best: Math.max(0, Math.floor(numbers.best)),
    robotY: Math.max(0, numbers.robotY),
    robotVy: numbers.robotVy,
    grounded,
    ducking,
    jumpHoldMs: numbers.jumpHoldMs,
    jumpBufferMs: numbers.jumpBufferMs,
    obstacles: parsed,
    nextSpawnX: numbers.nextSpawnX,
    flashMs: numbers.flashMs,
    overMs: numbers.overMs,
  };
}
