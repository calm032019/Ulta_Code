import {
  COYOTE_TIME,
  HERO_H,
  HERO_W,
  MAX_RUN,
  ROWS,
  TILE_CRATE,
  TILE_EMPTY,
  TILE_ROOF,
  TILE_SPIKE,
  isSolid,
  stepHero,
  tileAt,
  touchesSpike,
  type HeroBody,
  type Platform,
  type TileMap,
} from "./physics";

interface StarDef {
  readonly x: number;
  readonly y: number;
}

export interface DroneDef {
  readonly x: number;
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly speed: number;
}

interface LiftDef {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
  readonly w: number;
  readonly period: number;
}

export interface Level extends TileMap {
  readonly seed: number;
  readonly number: number;
  readonly stars: ReadonlyArray<StarDef>;
  readonly drones: ReadonlyArray<DroneDef>;
  readonly lifts: ReadonlyArray<LiftDef>;
  readonly spawn: { readonly x: number; readonly y: number };
  readonly beacon: { readonly col: number; readonly row: number };
}

export const DRONE_W = 0.8;
export const DRONE_H = 0.55;
export const LIFT_H = 0.35;

export function nextRandom(state: number): { readonly value: number; readonly state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

export function liftX(lift: LiftDef, time: number): number {
  return lift.x0 + (lift.x1 - lift.x0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * time) / lift.period));
}

/** Beacon hit box: one column wide, two tall, standing on the roof at `row`. */
export function beaconRect(level: Level): { x: number; y: number; w: number; h: number } {
  return { x: level.beacon.col + 0.15, y: level.beacon.row - 2, w: 0.7, h: 2 };
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;
}

export function overlapsBeacon(level: Level, x: number, y: number): boolean {
  return rectsOverlap(x, y, HERO_W, HERO_H, beaconRect(level));
}

interface Builder {
  readonly surface: number[];
  readonly crates: Array<{ col: number; row: number }>;
  readonly spikes: number[];
  readonly stars: StarDef[];
  readonly drones: DroneDef[];
  readonly lifts: LiftDef[];
}

function build(seed: number, levelNumber: number): Level {
  let rngState = seed >>> 0;
  const random = () => {
    const result = nextRandom(rngState);
    rngState = result.state;
    return result.value;
  };
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  const difficulty = Math.min(1, (levelNumber - 1) / 9);
  const length = Math.min(220, 64 + levelNumber * 14);
  const maxGap = 2 + Math.min(2, Math.floor(levelNumber / 3));
  const droneChance = 0.25 + difficulty * 0.5;
  const spikeChance = levelNumber < 2 ? 0 : 0.2 + difficulty * 0.4;
  const droneSpeed = Math.min(3.6, 1.4 + levelNumber * 0.22);

  const b: Builder = { surface: [], crates: [], spikes: [], stars: [], drones: [], lifts: [] };
  let s = 4;
  const ground = (count: number) => {
    for (let index = 0; index < count; index++) b.surface.push(s);
  };
  const gap = (count: number) => {
    for (let index = 0; index < count; index++) b.surface.push(-1);
  };
  const nudgeSurface = (options: ReadonlyArray<number>) => {
    s = Math.max(3, Math.min(5, s + (options[Math.floor(random() * options.length)] ?? 0)));
  };

  ground(7);
  while (b.surface.length < length - 10) {
    const roll = random();
    const start = b.surface.length;
    if (roll < 0.3) {
      const count = between(4, 8);
      ground(count);
      if (count >= 5 && random() < droneChance) {
        b.drones.push({
          x: start + 1,
          y: s - DRONE_H - 0.1,
          minX: start + 0.5,
          maxX: start + count - 0.5 - DRONE_W,
          speed: droneSpeed * (0.8 + random() * 0.4),
        });
      } else if (count >= 5 && random() < spikeChance) {
        const col = start + between(2, count - 3);
        b.spikes.push(col);
        if (random() < difficulty && count >= 7) b.spikes.push(col + 1);
        b.stars.push({ x: col + 0.5, y: s - 2.2 });
      }
      if (s >= 4 && random() < 0.35) {
        const col = start + between(1, count - 2);
        b.crates.push({ col, row: s - 2 });
        b.stars.push({ x: col + 0.5, y: s - 2.6 });
      } else if (random() < 0.6) {
        for (let index = 1; index < count - 1; index += 2)
          b.stars.push({ x: start + index + 0.5, y: s - 0.6 });
      }
    } else if (roll < 0.55) {
      const count = between(1, maxGap);
      gap(count);
      b.stars.push({ x: start + count / 2, y: s - 2 });
      nudgeSurface(count >= 4 ? [0, 1] : [-1, 0, 0, 1, 1]);
      ground(between(2, 5));
    } else if (roll < 0.7) {
      nudgeSurface([-1, -1, 1, 2]);
      ground(between(2, 4));
    } else if (roll < 0.85 && levelNumber >= 2) {
      const count = between(5, 6 + Math.floor(difficulty * 2));
      gap(count);
      b.lifts.push({
        x0: start,
        x1: start + count - 2,
        y: s,
        w: 2,
        period: Math.max(2.6, 4.6 - difficulty * 1.6) * (count / 6),
      });
      b.stars.push({ x: start + count / 2, y: s - 1.4 });
      ground(between(3, 5));
    } else {
      const count = between(4, 5 + Math.floor(difficulty * 2));
      gap(count);
      const row = s >= 4 ? s - between(0, 1) : s;
      const col = start + Math.floor(count / 2) - (random() < 0.5 ? 1 : 0);
      b.crates.push({ col, row });
      if (count >= 5) b.crates.push({ col: col + 1, row });
      b.stars.push({ x: col + 0.5, y: row - 0.6 });
      nudgeSurface([-1, 0, 0, 1]);
      ground(between(2, 4));
    }
  }
  ground(10);

  const cols = b.surface.length;
  const tiles: number[] = Array.from({ length: cols * ROWS }, () => TILE_EMPTY);
  b.surface.forEach((top, col) => {
    if (top < 0) return;
    for (let row = top; row < ROWS; row++) tiles[row * cols + col] = TILE_ROOF;
  });
  for (const crate of b.crates) tiles[crate.row * cols + crate.col] = TILE_CRATE;
  for (const col of b.spikes) {
    const top = b.surface[col] ?? -1;
    if (top > 0) tiles[(top - 1) * cols + col] = TILE_SPIKE;
  }

  const beaconCol = cols - 4;
  const beaconRow = b.surface[beaconCol] ?? 4;
  return {
    seed,
    number: levelNumber,
    cols,
    tiles,
    stars: b.stars,
    drones: b.drones,
    lifts: b.lifts,
    spawn: { x: 2 + 0.5 - HERO_W / 2, y: (b.surface[2] ?? 4) - HERO_H },
    beacon: { col: beaconCol, row: beaconRow },
  };
}

function flatLevel(seed: number, levelNumber: number): Level {
  const cols = 40;
  const tiles: number[] = Array.from({ length: cols * ROWS }, (_, index) =>
    Math.floor(index / cols) >= 4 ? TILE_ROOF : TILE_EMPTY,
  );
  return {
    seed,
    number: levelNumber,
    cols,
    tiles,
    stars: [],
    drones: [],
    lifts: [],
    spawn: { x: 2 + 0.5 - HERO_W / 2, y: 4 - HERO_H },
    beacon: { col: cols - 4, row: 4 },
  };
}

function standable(map: TileMap, col: number, row: number): boolean {
  if (row < 1) return false;
  const above = tileAt(map, col, row - 1);
  return isSolid(tileAt(map, col, row)) && !isSolid(above) && above !== TILE_SPIKE;
}

interface Segment {
  readonly row: number;
  readonly c0: number;
  readonly c1: number;
}

const SIM_DT = 1 / 60;
const SIM_STEPS = 120;
const JUMP_HOLDS: ReadonlyArray<number> = [Infinity, 0.1, -1];

/**
 * Explores the level with the real hero physics but no mid-air jump, so levels never depend on
 * it: from every place the hero can stand it tries runs and jumps in both directions. Lifts count
 * at both ends of their track because the hero can wait for them, and drones are ignored because
 * they can be stomped.
 */
export function isCompletable(level: Level): boolean {
  const segments: Segment[] = [];
  const segmentAt = new Map<number, number>();
  for (let row = 1; row < ROWS; row++) {
    let col = 0;
    while (col < level.cols) {
      if (!standable(level, col, row)) {
        col++;
        continue;
      }
      const c0 = col;
      while (col + 1 < level.cols && standable(level, col + 1, row)) col++;
      for (let index = c0; index <= col; index++)
        segmentAt.set(row * level.cols + index, segments.length);
      segments.push({ row, c0, c1: col });
      col++;
    }
  }

  const platforms: Platform[] = [];
  for (const lift of level.lifts) {
    platforms.push({ x: lift.x0, y: lift.y, w: lift.w, dx: 0 });
    platforms.push({ x: lift.x1, y: lift.y, w: lift.w, dx: 0 });
  }
  const platformNode = (index: number) => segments.length + index;
  const nodeCount = segments.length + platforms.length;

  const landingNode = (body: HeroBody): number | null => {
    if (body.platform >= 0) return platformNode(body.platform);
    const row = Math.round(body.y + HERO_H);
    for (const col of [
      Math.floor(body.x + HERO_W / 2),
      Math.floor(body.x),
      Math.floor(body.x + HERO_W - 1e-4),
    ]) {
      const node = segmentAt.get(row * level.cols + col);
      if (node !== undefined) return node;
    }
    return null;
  };

  const startNode = landingNode({
    x: level.spawn.x,
    y: level.spawn.y,
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
  });
  const goalNode = segmentAt.get(level.beacon.row * level.cols + level.beacon.col);
  if (startNode === null || goalNode === undefined) return false;

  const hasLedgeAbove = (row: number, col: number) => {
    for (let r = row - 3; r < row; r++) {
      for (let c = col - 3; c <= col + 3; c++) if (standable(level, c, r)) return true;
    }
    return false;
  };

  type Outcome = { kind: "goal" } | { kind: "land"; node: number } | { kind: "none" };
  const simulate = (
    x: number,
    y: number,
    vx: number,
    dir: number,
    hold: number,
    platform: number,
  ): Outcome => {
    let body: HeroBody = {
      x,
      y,
      vx,
      vy: 0,
      grounded: true,
      platform,
      coyote: COYOTE_TIME,
      buffer: 0,
      rising: false,
      airJumps: 0,
      jumped: 0,
      blocked: false,
    };
    let airborne = false;
    for (let index = 0; index < SIM_STEPS; index++) {
      const time = index * SIM_DT;
      body = stepHero(
        body,
        {
          move: dir,
          jumpPressed: index === 0 && hold >= 0,
          jumpHeld: hold >= 0 && time < hold,
          maxAirJumps: 0,
        },
        SIM_DT,
        level,
        platforms,
      );
      if (overlapsBeacon(level, body.x, body.y)) return { kind: "goal" };
      if (body.y > ROWS || touchesSpike(level, body.x, body.y, HERO_W, HERO_H))
        return { kind: "none" };
      if (!body.grounded) airborne = true;
      else if (airborne || body.vx === 0 || (body.platform >= 0 && body.platform !== platform)) {
        const node = landingNode(body);
        return node === null ? { kind: "none" } : { kind: "land", node };
      }
    }
    return { kind: "none" };
  };

  const starts = (
    node: number,
  ): Array<{ x: number; y: number; vx: number; dir: number; platform: number }> => {
    const list: Array<{ x: number; y: number; vx: number; dir: number; platform: number }> = [];
    const segment = segments[node];
    if (segment) {
      const y = segment.row - HERO_H;
      const run = segment.c1 > segment.c0 ? MAX_RUN * 0.7 : 0;
      for (let col = segment.c0; col <= segment.c1; col++) {
        if (!hasLedgeAbove(segment.row, col)) continue;
        for (const dir of [-1, 1])
          list.push({ x: col + 0.5 - HERO_W / 2, y, vx: 0, dir, platform: -1 });
      }
      for (const back of segment.c1 > segment.c0 ? [0, 0.7] : [0]) {
        list.push({ x: segment.c1 + 1 - HERO_W - 1e-3 - back, y, vx: run, dir: 1, platform: -1 });
        list.push({ x: segment.c0 + 1e-3 + back, y, vx: -run, dir: -1, platform: -1 });
      }
      return list;
    }
    const index = node - segments.length;
    const platform = platforms[index];
    if (!platform) return list;
    const y = platform.y - HERO_H;
    list.push({ x: platform.x + platform.w - HERO_W, y, vx: 0, dir: 1, platform: index });
    list.push({ x: platform.x, y, vx: 0, dir: -1, platform: index });
    list.push({ x: platform.x + platform.w / 2 - HERO_W / 2, y, vx: 0, dir: 1, platform: index });
    list.push({ x: platform.x + platform.w / 2 - HERO_W / 2, y, vx: 0, dir: -1, platform: index });
    return list;
  };

  const visited = Array.from({ length: nodeCount }, () => false);
  const queue = [startNode];
  visited[startNode] = true;
  while (queue.length > 0) {
    const node = queue.shift() as number;
    if (node === goalNode) return true;
    const neighbours: number[] = [];
    const platformIndex = node - segments.length;
    if (platformIndex >= 0) neighbours.push(platformNode(platformIndex ^ 1));
    for (const start of starts(node)) {
      for (const hold of JUMP_HOLDS) {
        const outcome = simulate(start.x, start.y, start.vx, start.dir, hold, start.platform);
        if (outcome.kind === "goal") return true;
        if (outcome.kind === "land") neighbours.push(outcome.node);
      }
    }
    for (const next of neighbours) {
      if (visited[next]) continue;
      visited[next] = true;
      queue.push(next);
    }
  }
  return false;
}

/** Builds a level for this seed and number, moving to the next seed until the beacon is reachable. */
export function generateLevel(seed: number, levelNumber: number): Level {
  for (let attempt = 0; attempt < 24; attempt++) {
    const level = build((seed + attempt * 0x9e3779b9) >>> 0, levelNumber);
    if (isCompletable(level)) return level;
  }
  return flatLevel(seed, levelNumber);
}
