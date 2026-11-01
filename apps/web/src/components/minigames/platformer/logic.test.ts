import { describe, expect, it } from "vite-plus/test";

import { DRONE_H, type DroneDef, type Level } from "./level";
import {
  STOMP_POINTS,
  fromSnapshot,
  initialState,
  step,
  stompPoints,
  toSnapshot,
  type GameInput,
  type GameState,
} from "./logic";
import { HERO_H, ROWS, TILE_EMPTY, TILE_ROOF } from "./physics";

const IDLE: GameInput = { left: false, right: false, jumpHeld: false, jumpPressed: false };
const FRAME = 1000 / 120;

function testLevel(options: {
  gaps?: ReadonlyArray<number>;
  drones?: ReadonlyArray<DroneDef>;
  number?: number;
}): Level {
  const cols = 40;
  const gaps = new Set(options.gaps ?? []);
  const tiles = Array.from({ length: cols * ROWS }, (_, index) =>
    Math.floor(index / cols) >= 4 && !gaps.has(index % cols) ? TILE_ROOF : TILE_EMPTY,
  );
  return {
    seed: 1,
    number: options.number ?? 1,
    cols,
    tiles,
    stars: [],
    drones: options.drones ?? [],
    lifts: [],
    spawn: { x: 2.2, y: 4 - HERO_H },
    beacon: { col: 38, row: 4 },
  };
}

function playing(level: Level, heroX = 2.2): GameState {
  const base = initialState(1, 640, 180);
  return {
    ...base,
    level,
    phase: "playing",
    hero: { ...base.hero, x: heroX, y: 4 - HERO_H, vx: 0, vy: 0, grounded: true, platform: -1 },
    safe: { x: heroX, y: 4 - HERO_H },
    starsTaken: [],
    drones: level.drones.map((drone) => ({ x: drone.x, dir: 1, downFor: -1 })),
  };
}

function run(state: GameState, frames: number, input: GameInput = IDLE): GameState {
  let current = state;
  for (let index = 0; index < frames; index++) current = step(current, FRAME, input);
  return current;
}

const drone = (x: number): DroneDef => ({ x, y: 4 - DRONE_H - 0.1, minX: x, maxX: x, speed: 0 });

describe("platformer logic", () => {
  it("starts from the title on a jump press", () => {
    const state = initialState(5, 640, 180);
    expect(state.phase).toBe("title");
    expect(run(state, 10).phase).toBe("title");
    expect(step(state, FRAME, { ...IDLE, jumpPressed: true }).phase).toBe("playing");
  });

  it("defeats a drone stomped from above and chains a combo", () => {
    const level = testLevel({ drones: [drone(10), drone(20)] });
    const above = (state: GameState, x: number): GameState => ({
      ...state,
      hero: { ...state.hero, x, y: 4 - DRONE_H - 0.1 - HERO_H - 0.4, vy: 4, grounded: false },
    });
    let state = run(above(playing(level), 10.1), 20);
    expect(state.drones[0]?.downFor).toBeGreaterThanOrEqual(0);
    expect(state.lives).toBe(3);
    expect(state.score).toBe(STOMP_POINTS);
    expect(state.combo).toBe(1);

    state = run(above(state, 20.1), 20);
    expect(state.drones[1]?.downFor).toBeGreaterThanOrEqual(0);
    expect(state.combo).toBe(2);
    expect(state.score).toBe(STOMP_POINTS + stompPoints(2));
    expect(stompPoints(3)).toBe(STOMP_POINTS * 3);
  });

  it("loses a life when a drone is touched from the side", () => {
    let state = playing(testLevel({ drones: [drone(10)] }), 7);
    for (let frame = 0; frame < 120 && state.lives === 3; frame++) {
      state = step(state, FRAME, { ...IDLE, right: true });
    }
    expect(state.lives).toBe(2);
    expect(state.events.map((event) => event.kind)).toContain("hurt");
    expect(state.invulnerable).toBeGreaterThan(0);
    expect(state.drones[0]?.downFor).toBe(-1);
    expect(state.hero.vx).toBeLessThan(0);
  });

  it("loses a life and respawns on safe ground after falling into a gap", () => {
    let state = playing(testLevel({ gaps: [14, 15, 16, 17, 18, 19] }), 6);
    let fell: GameState | null = null;
    for (let frame = 0; frame < 400 && !fell; frame++) {
      state = step(state, FRAME, { ...IDLE, right: true });
      if (state.events.some((event) => event.kind === "fall")) fell = state;
    }
    expect(fell).not.toBeNull();
    expect(fell?.lives).toBe(2);
    expect(fell?.hero.y).toBeCloseTo(4 - HERO_H);
    expect(fell?.hero.x).toBeLessThan(14);
    expect(fell?.hero.grounded).toBe(true);
  });

  it("jumps higher while the jump is held", () => {
    const apex = (holdFrames: number) => {
      let state = step(playing(testLevel({})), FRAME, {
        ...IDLE,
        jumpPressed: true,
        jumpHeld: true,
      });
      let top = state.hero.y;
      for (let frame = 1; frame < 120; frame++) {
        state = step(state, FRAME, { ...IDLE, jumpHeld: frame < holdFrames });
        top = Math.min(top, state.hero.y);
      }
      return 4 - HERO_H - top;
    };
    const full = apex(1000);
    const short = apex(4);
    expect(full).toBeGreaterThan(2);
    expect(short).toBeLessThan(full - 1);
  });

  it("allows one mid-air jump from level 3 only", () => {
    const airJump = (levelNumber: number) => {
      let state = step(playing(testLevel({ number: levelNumber })), FRAME, {
        ...IDLE,
        jumpPressed: true,
        jumpHeld: true,
      });
      state = run(state, 30, { ...IDLE, jumpHeld: true });
      state = step(state, FRAME, { ...IDLE, jumpPressed: true, jumpHeld: true });
      return state.events.some((event) => event.kind === "airJump");
    };
    expect(airJump(1)).toBe(false);
    expect(airJump(3)).toBe(true);
  });

  it("resumes identically from a snapshot", () => {
    const inputs = (frame: number): GameInput => ({
      left: frame % 97 > 80,
      right: frame % 97 < 70,
      jumpHeld: frame % 41 < 20,
      jumpPressed: frame % 41 === 0,
    });
    let original = step(initialState(99, 640, 180), FRAME, { ...IDLE, jumpPressed: true });
    for (let frame = 0; frame < 300; frame++) original = step(original, FRAME, inputs(frame));
    const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(original))), 640, 180);
    expect(restored).not.toBeNull();
    let resumed = restored as GameState;
    for (let frame = 300; frame < 600; frame++) {
      original = step(original, FRAME, inputs(frame));
      resumed = step(resumed, FRAME, inputs(frame));
    }
    expect(toSnapshot(resumed)).toEqual(toSnapshot(original));
  });

  it("rejects garbage snapshots", () => {
    const valid = toSnapshot(initialState(3, 640, 180));
    for (const value of [
      null,
      undefined,
      42,
      "save",
      [],
      {},
      { ...valid, version: 2 },
      { ...valid, lives: 9 },
      { ...valid, score: -1 },
      { ...valid, hero: { x: 1 } },
      { ...valid, starsTaken: [...valid.starsTaken, true] },
      { ...valid, drones: "none" },
      { ...valid, phase: "paused" },
      { ...valid, muted: "yes" },
    ]) {
      expect(fromSnapshot(value, 640, 180)).toBeNull();
    }
    expect(fromSnapshot(valid, 640, 180)).not.toBeNull();
  });
});
