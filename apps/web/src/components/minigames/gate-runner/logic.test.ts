import { describe, expect, it } from "vite-plus/test";

import {
  applyGate,
  fromSnapshot,
  generateGateSet,
  initialState,
  isGoodOp,
  LANES,
  scoreOf,
  step,
  toSnapshot,
  type Entity,
  type GateOp,
  type GateRunnerState,
} from "./logic";

const FRAME = 1000 / 60;

function running(seed: number, entities: Entity[], count: number): GateRunnerState {
  const state = step(initialState(seed, 640, 180), 0, { start: true });
  return { ...state, entities, count };
}

describe("applyGate", () => {
  it.each<[number, GateOp, number]>([
    [10, { kind: "add", value: 5 }, 15],
    [10, { kind: "sub", value: 4 }, 6],
    [3, { kind: "sub", value: 9 }, 0],
    [7, { kind: "mul", value: 2 }, 14],
    [7, { kind: "mul", value: 3 }, 21],
    [9, { kind: "div", value: 2 }, 5],
    [8, { kind: "div", value: 2 }, 4],
    [1, { kind: "div", value: 2 }, 1],
    [0, { kind: "div", value: 2 }, 0],
    [0, { kind: "mul", value: 3 }, 0],
    [4.7, { kind: "add", value: 2.9 }, 6],
    [-5, { kind: "add", value: 2 }, 2],
    [60_000, { kind: "mul", value: 3 }, 99_999],
  ])("%d with %o is %d", (count, op, expected) => {
    expect(applyGate(count, op)).toBe(expected);
  });
});

describe("gate generation", () => {
  it("always offers a lane that does not lose units", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = initialState(seed, 640, 180);
      for (let stage = 1; stage <= 15; stage++) {
        const set = generateGateSet(state, stage, 0);
        expect(set.ops).toHaveLength(LANES);
        const safe = set.ops.some(
          (op) =>
            op === null ||
            (isGoodOp(op) && [0, 1, 7, 50, 999].every((count) => applyGate(count, op) >= count)),
        );
        expect(safe).toBe(true);
      }
    }
  });

  it("spawns a finish wall after every eighth gate set", () => {
    let state = step(initialState(7, 640, 180), 0, { start: true });
    const seen = new Map<number, Entity["kind"]>();
    for (let frame = 0; frame < 60 * 60; frame++) {
      state = { ...step(state, FRAME), count: 500, status: "running" };
      for (const entity of state.entities) seen.set(entity.x, entity.kind);
    }
    const kinds = [...seen].sort(([a], [b]) => a - b).map(([, kind]) => kind);
    const firstWall = kinds.indexOf("wall");
    const secondWall = kinds.indexOf("wall", firstWall + 1);
    expect(secondWall).toBeGreaterThan(firstWall);
    expect(kinds.slice(firstWall, secondWall).filter((kind) => kind === "gates")).toHaveLength(8);
    expect(kinds.slice(0, firstWall).filter((kind) => kind === "gates")).toHaveLength(8);
  });

  it("is deterministic for a seed", () => {
    let a = step(initialState(42, 640, 180), 0, { start: true });
    let b = step(initialState(42, 640, 180), 0, { start: true });
    for (let frame = 0; frame < 600; frame++) {
      a = step(a, FRAME, { laneDelta: frame % 90 === 0 ? 1 : 0 });
      b = step(b, FRAME, { laneDelta: frame % 90 === 0 ? 1 : 0 });
    }
    expect(a).toEqual(b);
  });
});

describe("step", () => {
  it("passes a finish wall when the crowd is bigger and advances the stage", () => {
    const state = running(1, [{ kind: "wall", x: 0.05, count: 10, done: false }], 11);
    const next = step(state, FRAME);
    expect(next.status).toBe("running");
    expect(next.stage).toBe(2);
    expect(next.count).toBe(1);
    expect(next.bonus).toBeGreaterThan(state.bonus);
  });

  it("ends the game at a finish wall the crowd cannot beat", () => {
    const state = running(1, [{ kind: "wall", x: 0.05, count: 10, done: false }], 10);
    const next = step(state, FRAME);
    expect(next.status).toBe("over");
    expect(next.stage).toBe(1);
  });

  it("ends the game when the crowd reaches zero and records the best score", () => {
    const blades: Entity = {
      kind: "blades",
      x: 0.05,
      lanes: [false, true, false],
      damage: 9,
      style: "saw",
      done: false,
    };
    const next = step({ ...running(1, [blades], 5), distance: 300, bonus: 40 }, FRAME);
    expect(next.count).toBe(0);
    expect(next.status).toBe("over");
    expect(next.best).toBe(scoreOf(next));
    const frozen = step(next, FRAME);
    expect(frozen.distance).toBe(next.distance);
  });

  it("only hits obstacles and enemies in the crowd's lane", () => {
    const entities: Entity[] = [
      { kind: "enemy", x: 0.05, lane: 0, count: 50, done: false },
      { kind: "blades", x: 0.05, lanes: [true, false, true], damage: 9, style: "bar", done: false },
      { kind: "enemy", x: 0.05, lane: 1, count: 8, done: false },
    ];
    const next = step(running(1, entities, 20), FRAME);
    expect(next.count).toBe(12);
    expect(next.status).toBe("running");
  });

  it("applies the gate in the crowd's lane", () => {
    const gates: Entity = {
      kind: "gates",
      x: 0.05,
      ops: [{ kind: "sub", value: 5 }, { kind: "mul", value: 3 }, null],
      done: false,
    };
    expect(step(running(1, [gates], 4), FRAME).count).toBe(12);
  });

  it("eases between lanes and stays within bounds", () => {
    let state = running(1, [], 10);
    state = step(state, FRAME, { laneDelta: 5 });
    expect(state.targetLane).toBe(LANES - 1);
    expect(state.lane).toBeGreaterThan(1);
    expect(state.lane).toBeLessThan(2);
    for (let frame = 0; frame < 60; frame++) state = step(state, FRAME);
    expect(state.lane).toBe(2);
    state = step(state, FRAME, { targetLane: -3 });
    expect(state.targetLane).toBe(0);
  });

  it("restarts with a fresh run and keeps the best score", () => {
    const over = { ...running(3, [], 0), status: "over" as const, best: 900 };
    const next = step(over, FRAME, { start: true });
    expect(next.status).toBe("running");
    expect(next.count).toBeGreaterThan(0);
    expect(next.distance).toBe(0);
    expect(next.best).toBe(900);
  });
});

describe("snapshots", () => {
  it("round-trips through JSON and resumes identically", () => {
    let state = step(initialState(99, 640, 180), 0, { start: true });
    for (let frame = 0; frame < 400; frame++) {
      state = step(state, FRAME, { laneDelta: frame === 30 ? -1 : 0 });
    }
    const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(state))));
    expect(restored).toEqual(state);
    if (!restored) return;
    let a = state;
    let b = restored;
    for (let frame = 0; frame < 300; frame++) {
      a = step(a, FRAME);
      b = step(b, FRAME);
    }
    expect(b).toEqual(a);
  });

  it("rejects garbage", () => {
    const valid = toSnapshot(initialState(1, 640, 180));
    const broken: unknown[] = [
      null,
      undefined,
      42,
      "state",
      [],
      {},
      { ...valid, v: 2 },
      { v: 1, state: null },
      { v: 1, state: { ...valid.state, status: "paused" } },
      { v: 1, state: { ...valid.state, count: -1 } },
      { v: 1, state: { ...valid.state, count: Number.NaN } },
      { v: 1, state: { ...valid.state, lane: 7 } },
      { v: 1, state: { ...valid.state, stage: 0 } },
      { v: 1, state: { ...valid.state, entities: [{ kind: "dragon", x: 1, done: false }] } },
      {
        v: 1,
        state: {
          ...valid.state,
          entities: [{ kind: "gates", x: 1, done: false, ops: [{ kind: "pow", value: 2 }] }],
        },
      },
      { v: 1, state: { ...valid.state, gen: undefined } },
    ];
    for (const value of broken) expect(fromSnapshot(value)).toBeNull();
    expect(fromSnapshot(valid)).toEqual(valid.state);
  });
});
