import {
  DRONE_H,
  DRONE_W,
  generateLevel,
  liftX,
  nextRandom,
  overlapsBeacon,
  type Level,
} from "./level";
import {
  HERO_H,
  HERO_W,
  JUMP_SPEED,
  MAX_RUN,
  ROWS,
  TILE_SPIKE,
  isSolid,
  stepHero,
  tileAt,
  touchesSpike,
  type HeroBody,
  type Platform,
} from "./physics";

export const START_LIVES = 3;
export const STAR_POINTS = 10;
export const STOMP_POINTS = 50;
export const DOUBLE_JUMP_LEVEL = 3;
const INVULNERABLE_TIME = 1.5;
export const INTRO_TIME = 2.2;
const COMPLETE_TIME = 3.2;
const SUBSTEP = 1 / 120;
const SNAPSHOT_VERSION = 1;

type Phase = "title" | "playing" | "complete" | "over";

export interface GameInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly jumpHeld: boolean;
  /** True for the step that follows a fresh press; the caller clears it after one step. */
  readonly jumpPressed: boolean;
}

export type GameEventKind =
  | "start"
  | "jump"
  | "airJump"
  | "land"
  | "turn"
  | "skid"
  | "star"
  | "stomp"
  | "hurt"
  | "fall"
  | "complete"
  | "level"
  | "over";

export interface GameEvent {
  readonly kind: GameEventKind;
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

interface DroneState {
  readonly x: number;
  readonly dir: number;
  /** -1 while flying; seconds since it was stomped otherwise. */
  readonly downFor: number;
}

interface LevelClear {
  readonly stars: number;
  readonly totalStars: number;
  readonly time: number;
  readonly bonus: number;
}

export interface GameState {
  readonly rng: number;
  readonly level: Level;
  readonly phase: Phase;
  readonly phaseTime: number;
  readonly clock: number;
  readonly time: number;
  readonly lives: number;
  readonly score: number;
  readonly best: number;
  readonly bestAtStart: number;
  readonly levelsCleared: number;
  readonly hero: HeroBody;
  readonly facing: number;
  readonly safe: { readonly x: number; readonly y: number };
  readonly invulnerable: number;
  readonly starsTaken: ReadonlyArray<boolean>;
  readonly drones: ReadonlyArray<DroneState>;
  readonly combo: number;
  readonly clear: LevelClear | null;
  readonly camX: number;
  readonly viewCols: number;
  readonly muted: boolean;
  readonly events: ReadonlyArray<GameEvent>;
}

function viewColsFor(width: number, height: number): number {
  return Math.max(1, width) / (Math.max(1, height) / ROWS);
}

function restingHero(x: number, y: number): HeroBody {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    grounded: true,
    platform: -1,
    coyote: 0,
    buffer: 0,
    rising: false,
    airJumps: 0,
    jumped: 0,
    blocked: false,
  };
}

function clampCamera(camX: number, level: Level, viewCols: number): number {
  return Math.max(0, Math.min(Math.max(0, level.cols - viewCols), camX));
}

function cameraTarget(hero: HeroBody, level: Level, viewCols: number): number {
  const lookAhead = (hero.vx / MAX_RUN) * Math.min(3, viewCols * 0.15);
  return clampCamera(hero.x + HERO_W / 2 + lookAhead - viewCols * 0.38, level, viewCols);
}

function levelState(state: GameState, level: Level): GameState {
  const hero = restingHero(level.spawn.x, level.spawn.y);
  return {
    ...state,
    level,
    time: 0,
    hero,
    facing: 1,
    safe: level.spawn,
    invulnerable: 0,
    starsTaken: level.stars.map(() => false),
    drones: level.drones.map((drone) => ({ x: drone.x, dir: 1, downFor: -1 })),
    combo: 0,
    clear: null,
    camX: cameraTarget(hero, level, state.viewCols),
  };
}

export function initialState(seed: number, width: number, height: number): GameState {
  const first = nextRandom(seed >>> 0);
  const level = generateLevel(Math.floor(first.value * 4294967296), 1);
  const base: GameState = {
    rng: first.state,
    level,
    phase: "title",
    phaseTime: 0,
    clock: 0,
    time: 0,
    lives: START_LIVES,
    score: 0,
    best: 0,
    bestAtStart: 0,
    levelsCleared: 0,
    hero: restingHero(level.spawn.x, level.spawn.y),
    facing: 1,
    safe: level.spawn,
    invulnerable: 0,
    starsTaken: [],
    drones: [],
    combo: 0,
    clear: null,
    camX: 0,
    viewCols: viewColsFor(width, height),
    muted: true,
    events: [],
  };
  return levelState(base, level);
}

export function resizeState(state: GameState, width: number, height: number): GameState {
  const viewCols = viewColsFor(width, height);
  return { ...state, viewCols, camX: clampCamera(state.camX, state.level, viewCols) };
}

export function setMuted(state: GameState, muted: boolean): GameState {
  return { ...state, muted };
}

/** Points for a stomp: each stomp chained without touching the ground multiplies the reward. */
export function stompPoints(combo: number): number {
  return STOMP_POINTS * Math.max(1, combo);
}

/** Level bonus: a base for the level number plus points for every second under par. */
function levelBonus(levelNumber: number, cols: number, time: number): number {
  const par = cols / 3.2;
  return 100 * levelNumber + Math.max(0, Math.round((par - time) * 5));
}

function maxAirJumps(levelNumber: number): number {
  return levelNumber >= DOUBLE_JUMP_LEVEL ? 1 : 0;
}

function newGame(state: GameState): GameState {
  const roll = nextRandom(state.rng);
  const level = generateLevel(Math.floor(roll.value * 4294967296), 1);
  return levelState(
    {
      ...state,
      rng: roll.state,
      phase: "playing",
      phaseTime: 0,
      lives: START_LIVES,
      score: 0,
      bestAtStart: state.best,
      levelsCleared: 0,
    },
    level,
  );
}

function nextLevel(state: GameState): GameState {
  const roll = nextRandom(state.rng);
  const level = generateLevel(Math.floor(roll.value * 4294967296), state.level.number + 1);
  return levelState({ ...state, rng: roll.state, phase: "playing", phaseTime: 0 }, level);
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function isSafeSpot(state: GameState, hero: HeroBody): { x: number; y: number } | null {
  if (!hero.grounded || hero.platform >= 0) return null;
  const level = state.level;
  const col = Math.floor(hero.x + HERO_W / 2);
  const row = Math.round(hero.y + HERO_H);
  for (const c of [col - 1, col, col + 1]) {
    if (!isSolid(tileAt(level, c, row)) || isSolid(tileAt(level, c, row - 1))) return null;
    if (tileAt(level, c, row - 1) === TILE_SPIKE) return null;
  }
  for (let index = 0; index < level.drones.length; index++) {
    const def = level.drones[index];
    const drone = state.drones[index];
    if (!def || !drone || drone.downFor >= 0) continue;
    if (
      Math.abs(def.y + DRONE_H - row) < 1.2 &&
      def.minX - 1.5 < col + 1 &&
      def.maxX + DRONE_W + 1.5 > col
    ) {
      return null;
    }
  }
  return { x: col + 0.5 - HERO_W / 2, y: row - HERO_H };
}

/** Advances the game by `dtMs`; pure, so the same inputs always produce the same state. */
export function step(state: GameState, dtMs: number, input: GameInput): GameState {
  const total = Math.max(0, Math.min(dtMs, 250)) / 1000;
  const count = Math.max(1, Math.ceil(total / SUBSTEP - 1e-9));
  const dt = total / count;
  const events: GameEvent[] = [];
  let current: GameState = { ...state, events };
  for (let index = 0; index < count; index++) {
    current = substep(current, dt, index === 0 ? input : { ...input, jumpPressed: false }, events);
  }
  const best = Math.max(current.best, current.score);
  return best === current.best ? current : { ...current, best };
}

function substep(state: GameState, dt: number, input: GameInput, events: GameEvent[]): GameState {
  const clock = state.clock + dt;
  const phaseTime = state.phaseTime + dt;
  if (state.phase === "title") {
    if (!input.jumpPressed) return { ...state, clock, phaseTime };
    events.push({ kind: "start", x: state.hero.x, y: state.hero.y, value: 0 });
    return { ...newGame(state), clock };
  }
  if (state.phase === "over") {
    if (!input.jumpPressed || phaseTime < 0.6) return { ...state, clock, phaseTime };
    events.push({ kind: "start", x: state.hero.x, y: state.hero.y, value: 0 });
    return { ...newGame(state), clock };
  }
  if (state.phase === "complete") {
    const done = phaseTime >= COMPLETE_TIME || (input.jumpPressed && phaseTime > 1);
    if (!done) {
      const camX =
        state.camX +
        (cameraTarget(state.hero, state.level, state.viewCols) - state.camX) * Math.min(1, dt * 4);
      return { ...state, clock, phaseTime, camX };
    }
    const next = nextLevel(state);
    events.push({ kind: "level", x: next.hero.x, y: next.hero.y, value: next.level.number });
    return { ...next, clock };
  }
  return playStep({ ...state, clock, phaseTime }, dt, input, events);
}

function launch(hero: HeroBody, vx: number, vy: number, rising: boolean): HeroBody {
  return { ...hero, vx, vy, rising, grounded: false };
}

function playStep(state: GameState, dt: number, input: GameInput, events: GameEvent[]): GameState {
  const level = state.level;
  const time = state.time + dt;
  const platforms: Platform[] = level.lifts.map((lift) => {
    const x = liftX(lift, time);
    return { x, y: lift.y, w: lift.w, dx: x - liftX(lift, state.time) };
  });
  const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const previous = state.hero;
  let hero = stepHero(
    previous,
    {
      move,
      jumpHeld: input.jumpHeld,
      jumpPressed: input.jumpPressed,
      maxAirJumps: maxAirJumps(level.number),
    },
    dt,
    level,
    platforms,
  );
  const centreX = hero.x + HERO_W / 2;
  const feetY = hero.y + HERO_H;
  if (hero.jumped === 1) events.push({ kind: "jump", x: centreX, y: feetY, value: 0 });
  if (hero.jumped === 2) events.push({ kind: "airJump", x: centreX, y: feetY, value: 0 });
  if (hero.grounded && !previous.grounded)
    events.push({ kind: "land", x: centreX, y: feetY, value: previous.vy });
  if (
    hero.grounded &&
    move !== 0 &&
    Math.sign(previous.vx) === -move &&
    Math.abs(previous.vx) > MAX_RUN * 0.6
  ) {
    events.push({ kind: "turn", x: centreX, y: feetY, value: move });
  }
  if (!hero.grounded && hero.blocked && move !== 0 && hero.vy > 0) {
    events.push({
      kind: "skid",
      x: move > 0 ? hero.x + HERO_W : hero.x,
      y: hero.y + HERO_H / 2,
      value: move,
    });
  }

  let { lives, score, invulnerable, combo, safe } = state;
  invulnerable = Math.max(0, invulnerable - dt);
  const facing = move !== 0 ? move : state.facing;
  if (hero.grounded) combo = 0;
  safe = isSafeSpot(state, hero) ?? safe;

  const loseLife = (kind: "hurt" | "fall"): GameState => {
    lives--;
    events.push({ kind, x: centreX, y: Math.min(feetY, ROWS), value: lives });
    if (lives <= 0) {
      events.push({ kind: "over", x: centreX, y: feetY, value: score });
      return {
        ...state,
        time,
        hero,
        facing,
        lives: 0,
        score,
        combo: 0,
        phase: "over",
        phaseTime: 0,
      };
    }
    return {
      ...state,
      time,
      lives,
      score,
      combo: 0,
      facing,
      safe,
      hero: restingHero(safe.x, safe.y),
      invulnerable: INVULNERABLE_TIME,
    };
  };

  if (hero.y > ROWS + 0.5) return loseLife("fall");
  if (touchesSpike(level, hero.x, hero.y, HERO_W, HERO_H) && invulnerable === 0)
    return loseLife("fall");

  const drones = state.drones.map((drone, index) => {
    const def = level.drones[index];
    if (!def) return drone;
    if (drone.downFor >= 0) return { ...drone, downFor: drone.downFor + dt };
    let x = drone.x + drone.dir * def.speed * dt;
    let dir = drone.dir;
    if (x > def.maxX) {
      x = def.maxX;
      dir = -1;
    } else if (x < def.minX) {
      x = def.minX;
      dir = 1;
    }
    return { x, dir, downFor: -1 };
  });

  for (let index = 0; index < drones.length; index++) {
    const def = level.drones[index];
    const drone = drones[index];
    if (!def || !drone || drone.downFor >= 0) continue;
    if (!rectsOverlap(hero.x, hero.y, HERO_W, HERO_H, drone.x, def.y, DRONE_W, DRONE_H)) continue;
    if (hero.vy > 0 && previous.y + HERO_H <= def.y + 0.3) {
      combo++;
      const points = stompPoints(combo);
      score += points;
      drones[index] = { ...drone, downFor: 0 };
      hero = launch(hero, hero.vx, -JUMP_SPEED * 0.72, input.jumpHeld);
      events.push({ kind: "stomp", x: drone.x + DRONE_W / 2, y: def.y, value: combo });
    } else if (invulnerable === 0) {
      lives--;
      invulnerable = INVULNERABLE_TIME;
      const away = hero.x + HERO_W / 2 < drone.x + DRONE_W / 2 ? -1 : 1;
      hero = launch(hero, away * MAX_RUN * 0.9, -7, false);
      events.push({ kind: "hurt", x: centreX, y: hero.y + HERO_H / 2, value: lives });
      if (lives <= 0) {
        events.push({ kind: "over", x: centreX, y: feetY, value: score });
        return {
          ...state,
          time,
          hero,
          drones,
          lives: 0,
          score,
          phase: "over",
          phaseTime: 0,
          combo: 0,
        };
      }
    }
  }

  const starsTaken = state.starsTaken.slice();
  level.stars.forEach((star, index) => {
    if (starsTaken[index]) return;
    if (!rectsOverlap(hero.x, hero.y, HERO_W, HERO_H, star.x - 0.3, star.y - 0.3, 0.6, 0.6)) return;
    starsTaken[index] = true;
    score += STAR_POINTS;
    events.push({ kind: "star", x: star.x, y: star.y, value: STAR_POINTS });
  });

  const camX =
    state.camX + (cameraTarget(hero, level, state.viewCols) - state.camX) * Math.min(1, dt * 5);
  const next: GameState = {
    ...state,
    time,
    hero,
    facing,
    lives,
    score,
    invulnerable,
    combo,
    safe,
    drones,
    starsTaken,
    camX,
  };

  if (overlapsBeacon(level, hero.x, hero.y)) {
    const stars = starsTaken.filter(Boolean).length;
    const bonus = levelBonus(level.number, level.cols, time);
    events.push({
      kind: "complete",
      x: level.beacon.col + 0.5,
      y: level.beacon.row - 1.5,
      value: bonus,
    });
    return {
      ...next,
      hero: { ...hero, vx: 0, vy: 0 },
      score: score + bonus,
      phase: "complete",
      phaseTime: 0,
      levelsCleared: state.levelsCleared + 1,
      clear: { stars, totalStars: level.stars.length, time, bonus },
    };
  }
  return next;
}

export function toSnapshot(state: GameState) {
  return {
    version: SNAPSHOT_VERSION,
    rng: state.rng,
    levelSeed: state.level.seed,
    levelNumber: state.level.number,
    phase: state.phase,
    phaseTime: state.phaseTime,
    clock: state.clock,
    time: state.time,
    lives: state.lives,
    score: state.score,
    best: state.best,
    bestAtStart: state.bestAtStart,
    levelsCleared: state.levelsCleared,
    hero: state.hero,
    facing: state.facing,
    safe: state.safe,
    invulnerable: state.invulnerable,
    starsTaken: state.starsTaken,
    drones: state.drones,
    combo: state.combo,
    clear: state.clear,
    camX: state.camX,
    muted: state.muted,
  };
}

type Unknown = Record<string, unknown>;
const isRecord = (value: unknown): value is Unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isInt = (value: unknown, min: number): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= min;

function readHero(value: unknown): HeroBody | null {
  if (!isRecord(value)) return null;
  const numbers = [
    "x",
    "y",
    "vx",
    "vy",
    "platform",
    "coyote",
    "buffer",
    "airJumps",
    "jumped",
  ] as const;
  if (!numbers.every((key) => isNumber(value[key]))) return null;
  const flags = ["grounded", "rising", "blocked"] as const;
  if (!flags.every((key) => typeof value[key] === "boolean")) return null;
  return {
    x: value.x as number,
    y: value.y as number,
    vx: value.vx as number,
    vy: value.vy as number,
    grounded: value.grounded as boolean,
    platform: value.platform as number,
    coyote: value.coyote as number,
    buffer: value.buffer as number,
    rising: value.rising as boolean,
    airJumps: value.airJumps as number,
    jumped: value.jumped as number,
    blocked: value.blocked as boolean,
  };
}

function readClear(value: unknown): LevelClear | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { stars, totalStars, time, bonus } = value;
  if (!isInt(stars, 0) || !isInt(totalStars, 0) || !isNumber(time) || !isInt(bonus, 0))
    return undefined;
  return { stars, totalStars, time, bonus };
}

/** Restores a snapshot from `toSnapshot`; returns null for anything it does not recognise. */
export function fromSnapshot(value: unknown, width: number, height: number): GameState | null {
  if (!isRecord(value) || value.version !== SNAPSHOT_VERSION) return null;
  const {
    rng,
    levelSeed,
    levelNumber,
    phase,
    lives,
    score,
    best,
    bestAtStart,
    levelsCleared,
    combo,
  } = value;
  if (!isInt(rng, 0) || rng > 0xffffffff || !isInt(levelSeed, 0) || levelSeed > 0xffffffff)
    return null;
  if (!isInt(levelNumber, 1) || levelNumber > 999) return null;
  if (phase !== "title" && phase !== "playing" && phase !== "complete" && phase !== "over")
    return null;
  if (!isInt(lives, 0) || lives > START_LIVES || !isInt(score, 0) || !isInt(best, 0)) return null;
  if (!isInt(bestAtStart, 0) || !isInt(levelsCleared, 0) || !isInt(combo, 0)) return null;
  const numbers = ["phaseTime", "clock", "time", "facing", "invulnerable", "camX"] as const;
  if (!numbers.every((key) => isNumber(value[key]))) return null;
  if (typeof value.muted !== "boolean") return null;
  const hero = readHero(value.hero);
  const safe = value.safe;
  if (!hero || !isRecord(safe) || !isNumber(safe.x) || !isNumber(safe.y)) return null;
  const clear = readClear(value.clear);
  if (clear === undefined) return null;

  const level = generateLevel(levelSeed, levelNumber);
  const starsTaken = value.starsTaken;
  if (!Array.isArray(starsTaken) || starsTaken.length !== level.stars.length) return null;
  if (!starsTaken.every((taken) => typeof taken === "boolean")) return null;
  const drones = value.drones;
  if (!Array.isArray(drones) || drones.length !== level.drones.length) return null;
  const droneStates: DroneState[] = [];
  for (const drone of drones) {
    if (!isRecord(drone) || !isNumber(drone.x) || !isNumber(drone.dir) || !isNumber(drone.downFor))
      return null;
    droneStates.push({ x: drone.x, dir: drone.dir, downFor: drone.downFor });
  }
  if (hero.platform >= level.lifts.length) return null;

  return {
    rng,
    level,
    phase,
    phaseTime: value.phaseTime as number,
    clock: value.clock as number,
    time: value.time as number,
    lives,
    score,
    best: Math.max(best, score),
    bestAtStart,
    levelsCleared,
    hero,
    facing: (value.facing as number) < 0 ? -1 : 1,
    safe: { x: safe.x, y: safe.y },
    invulnerable: value.invulnerable as number,
    starsTaken: starsTaken as boolean[],
    drones: droneStates,
    combo,
    clear,
    camX: value.camX as number,
    viewCols: viewColsFor(width, height),
    muted: value.muted,
    events: [],
  };
}
