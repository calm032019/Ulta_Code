import { describe, expect, it } from "vite-plus/test";

import {
  GRAVITY,
  JUMP_VELOCITY,
  DISTANCE_PER_POINT,
  MAX_SPEED,
  NO_INPUT,
  ROBOT_WIDTH,
  ROBOT_X,
  STEP_MS,
  TAP_AIRTIME,
  fromSnapshot,
  initialState,
  makeObstacle,
  minimumGap,
  NEAR_MISS_BONUS,
  step,
  toSnapshot,
  type RunInput,
  type RunState,
} from "./logic";

const PRESS: RunInput = { jumpHeld: true, jumpPressed: true, duckHeld: false };
const DUCK: RunInput = { jumpHeld: false, jumpPressed: false, duckHeld: true };

function running(seed = 1, overrides: Partial<RunState> = {}): RunState {
  const state = step(initialState(seed, 640, 180), STEP_MS, PRESS);
  return {
    ...state,
    grounded: true,
    robotVy: 0,
    robotY: 0,
    obstacles: [],
    nextSpawnX: 1e9,
    ...overrides,
  };
}

function runFor(state: RunState, ms: number, input: RunInput = NO_INPUT): RunState {
  let current = state;
  for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) current = step(current, STEP_MS, input);
  return current;
}

function riseTime(height: number): number {
  const discriminant = JUMP_VELOCITY ** 2 - 2 * GRAVITY * height;
  return (JUMP_VELOCITY - Math.sqrt(Math.max(0, discriminant))) / GRAVITY;
}

function autopilot(state: RunState): RunInput {
  const ahead = state.obstacles.find((obstacle) => obstacle.x + obstacle.w > ROBOT_X);
  if (!ahead) return NO_INPUT;
  const lead = ahead.x + 2 - (ROBOT_X + ROBOT_WIDTH - 3);
  if (ahead.kind === "bug-high") {
    return lead < 40 ? DUCK : NO_INPUT;
  }
  const clearHeight = ahead.y + ahead.h - 5;
  const trigger = state.speed * (riseTime(clearHeight) + 0.03) + 8;
  return state.grounded && lead <= trigger ? PRESS : NO_INPUT;
}

describe("claude run logic", () => {
  it("starts on the first press and stays put before it", () => {
    const ready = initialState(7, 640, 180);
    expect(step(ready, STEP_MS, NO_INPUT)).toBe(ready);
    const started = step(ready, STEP_MS, PRESS);
    expect(started.phase).toBe("running");
    expect(started.grounded).toBe(false);
  });

  it("lands a tapped jump after the expected arc", () => {
    let state = step(running(), STEP_MS, PRESS);
    let apex = 0;
    let airborneMs = 0;
    while (!state.grounded) {
      state = step(state, STEP_MS, NO_INPUT);
      apex = Math.max(apex, state.robotY);
      airborneMs += STEP_MS;
    }
    expect(state.robotY).toBe(0);
    expect(apex).toBeGreaterThan(62);
    expect(apex).toBeLessThan(78);
    expect(Math.abs(airborneMs / 1000 - TAP_AIRTIME)).toBeLessThan(0.05);
  });

  it("jumps higher while the key is held", () => {
    const peak = (input: RunInput) => {
      let state = step(running(), STEP_MS, PRESS);
      let apex = 0;
      while (!state.grounded) {
        state = step(state, STEP_MS, input);
        apex = Math.max(apex, state.robotY);
      }
      return apex;
    };
    const held = peak({ jumpHeld: true, jumpPressed: false, duckHeld: false });
    expect(held).toBeGreaterThan(peak(NO_INPUT) + 15);
  });

  it("ends the run on collision, keeps best, and restarts after the delay", () => {
    const state = running(3, { obstacles: [makeObstacle("crate", ROBOT_X + 30)], best: 2 });
    const over = runFor(state, 200);
    expect(over.phase).toBe("over");
    expect(over.best).toBe(2);
    expect(step(over, STEP_MS, PRESS).phase).toBe("over");
    const restarted = step(runFor(over, 400), STEP_MS, PRESS);
    expect(restarted.phase).toBe("running");
    expect(restarted.distance).toBe(0);
    expect(restarted.best).toBe(2);
  });

  it("records the score as best when it beats the previous one", () => {
    const state = running(3, {
      distance: 5000,
      score: 200,
      obstacles: [makeObstacle("crate", ROBOT_X + 30)],
    });
    expect(runFor(state, 200).best).toBe(200);
  });

  it("ducks under a high bug that hits a standing robot", () => {
    const state = running(5, { obstacles: [makeObstacle("bug-high", ROBOT_X + 40)] });
    expect(runFor(state, 400).phase).toBe("over");
    const ducked = runFor(state, 400, DUCK);
    expect(ducked.phase).toBe("running");
    expect(ducked.obstacles[0]!.x + ducked.obstacles[0]!.w).toBeLessThan(ROBOT_X);
  });

  it("always spaces obstacles far enough apart to clear at top speed", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      let state = running(seed, {
        speed: MAX_SPEED,
        distance: 25_000,
        score: 1000,
        nextSpawnX: 700,
      });
      for (let elapsed = 0; elapsed < 45_000 && state.phase === "running"; elapsed += STEP_MS) {
        const sorted = state.obstacles;
        for (let index = 1; index < sorted.length; index += 1) {
          const previous = sorted[index - 1]!;
          const gap = sorted[index]!.x - (previous.x + previous.w);
          expect(gap).toBeGreaterThanOrEqual(minimumGap(MAX_SPEED) - 1e-6);
        }
        state = step(state, STEP_MS, autopilot(state));
      }
      expect({ seed, phase: state.phase }).toEqual({ seed, phase: "running" });
    }
  });

  it("builds a combo across consecutive clean jumps and resets it after a wasted jump", () => {
    const clear = (state: RunState) => {
      let current = state;
      for (let elapsed = 0; elapsed < 2000 && current.phase === "running"; elapsed += STEP_MS) {
        current = step(current, STEP_MS, autopilot(current));
      }
      return current;
    };
    const first = clear(running(11, { obstacles: [makeObstacle("crate", ROBOT_X + 120)] }));
    expect(first.phase).toBe("running");
    expect(first.combo).toBe(1);
    expect(first.bonus).toBe(0);

    const second = clear({ ...first, obstacles: [makeObstacle("crate", ROBOT_X + 120)] });
    expect(second.combo).toBe(2);
    expect(second.bonus).toBe(2);
    expect(second.score).toBe(Math.floor(second.distance / DISTANCE_PER_POINT) + 2);

    const wasted = runFor(step(second, STEP_MS, PRESS), 1200);
    expect(wasted.combo).toBe(0);
    expect(wasted.bestCombo).toBe(2);
  });

  it("awards a near-miss bonus only for a close clearance", () => {
    const skim = (robotY: number) =>
      runFor(
        running(13, {
          speed: MAX_SPEED,
          grounded: false,
          robotY,
          robotVy: 60,
          obstacles: [makeObstacle("crate", ROBOT_X + 20)],
        }),
        120,
      );
    const close = skim(16);
    expect(close.phase).toBe("running");
    expect(close.nearMisses).toBe(1);
    expect(close.bonus).toBe(NEAR_MISS_BONUS);
    const clear = skim(40);
    expect(clear.nearMisses).toBe(0);
    expect(clear.bonus).toBe(0);
  });

  it("is deterministic for a seed and resumes identically from a snapshot", () => {
    const drive = (state: RunState, ms: number) => {
      let current = state;
      for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
        current = step(current, STEP_MS, autopilot(current));
      }
      return current;
    };
    const midway = drive(step(initialState(99, 640, 180), STEP_MS, PRESS), 8000);
    expect(drive(step(initialState(99, 640, 180), STEP_MS, PRESS), 8000)).toEqual(midway);

    const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(midway))));
    expect(toSnapshot(restored!)).toEqual(toSnapshot(midway));
    expect(drive(restored!, 5000)).toEqual(drive(midway, 5000));
  });

  it("rejects snapshots it does not recognise", () => {
    const valid = toSnapshot(running()) as Record<string, unknown>;
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      "claude",
      [],
      {},
      { ...valid, version: 3 },
      { ...valid, phase: "paused" },
      { ...valid, distance: "far" },
      { ...valid, speed: Number.NaN },
      { ...valid, grounded: 1 },
      { ...valid, obstacles: "none" },
      {
        ...valid,
        obstacles: [{ kind: "dragon", x: 1, y: 0, w: 1, h: 1, passed: false, closest: 1 }],
      },
      { ...valid, obstacles: [{ kind: "crate", x: 1, y: 0, w: 1, h: 1, passed: false }] },
      { ...valid, version: 1 },
      { ...valid, newBest: "yes" },
    ];
    for (const value of garbage) expect(fromSnapshot(value)).toBeNull();
    expect(fromSnapshot(valid)).not.toBeNull();
  });
});
