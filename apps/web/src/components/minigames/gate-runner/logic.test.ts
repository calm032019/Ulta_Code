import { describe, expect, it } from "vite-plus/test";

import {
  applyGate,
  CLEAR_FREEZE_MS,
  comboBonus,
  fromSnapshot,
  generateGateSet,
  initialState,
  isGoodOp,
  LANES,
  scoreOf,
  step,
  toggleMute,
  toSnapshot,
  type Entity,
  type GateOp,
  type GateRunnerState,
} from "./logic";

const FRAME = 1000 / 60;

const gateSet = (ops: Array<GateOp | null>, z = 0.05): Entity => ({
  kind: "gates",
  z,
  ops,
  taken: null,
  done: false,
});

function running(seed: number, entities: Entity[], count: number): GateRunnerState {
  const state = step(initialState(seed), 0, { start: true });
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

describe("comboBonus", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 10],
    [5, 25],
    [10, 50],
    [40, 50],
  ])("streak %d pays %d", (combo, bonus) => {
    expect(comboBonus(combo)).toBe(bonus);
  });
});

describe("gate generation", () => {
  it("always offers a lane that does not lose units", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = initialState(seed);
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
    let state = step(initialState(7), 0, { start: true });
    const seen = new Map<number, Entity["kind"]>();
    for (let frame = 0; frame < 60 * 60; frame++) {
      state = { ...step(state, FRAME), count: 500, status: "running" };
      for (const entity of state.entities) seen.set(entity.z, entity.kind);
    }
    const kinds = [...seen].sort(([a], [b]) => a - b).map(([, kind]) => kind);
    const firstWall = kinds.indexOf("wall");
    const secondWall = kinds.indexOf("wall", firstWall + 1);
    expect(secondWall).toBeGreaterThan(firstWall);
    expect(kinds.slice(firstWall, secondWall).filter((kind) => kind === "gates")).toHaveLength(8);
    expect(kinds.slice(0, firstWall).filter((kind) => kind === "gates")).toHaveLength(8);
  });

  it("is deterministic for a seed", () => {
    let a = step(initialState(42), 0, { start: true });
    let b = step(initialState(42), 0, { start: true });
    for (let frame = 0; frame < 600; frame++) {
      a = step(a, FRAME, { laneDelta: frame % 90 === 0 ? 1 : 0 });
      b = step(b, FRAME, { laneDelta: frame % 90 === 0 ? 1 : 0 });
    }
    expect(a).toEqual(b);
  });
});

describe("step", () => {
  it("passes a finish wall when the crowd is bigger and advances the stage", () => {
    const state = running(1, [{ kind: "wall", z: 0.05, count: 10, done: false }], 11);
    const next = step(state, FRAME);
    expect(next.status).toBe("running");
    expect(next.stage).toBe(2);
    expect(next.count).toBe(1);
    expect(next.bonus).toBe(state.bonus + 100);
    expect(next.clear).toMatchObject({ stage: 1, wall: 10, crowd: 1, bonus: 100 });
    expect(next.events).toContainEqual(expect.objectContaining({ type: "wall", passed: true }));
    let frozen = next;
    for (let ms = 0; ms < CLEAR_FREEZE_MS - FRAME; ms += FRAME) frozen = step(frozen, FRAME);
    expect(frozen.distance).toBe(next.distance);
    for (let frame = 0; frame < 3; frame++) frozen = step(frozen, FRAME);
    expect(frozen.distance).toBeGreaterThan(next.distance);
  });

  it("ends the game at a finish wall the crowd cannot beat", () => {
    const state = running(1, [{ kind: "wall", z: 0.05, count: 10, done: false }], 10);
    const next = step(state, FRAME);
    expect(next.status).toBe("over");
    expect(next.stage).toBe(1);
    expect(next.events.map((event) => event.type)).toEqual(["wall", "over"]);
  });

  it("ends the game when the crowd reaches zero and records the best score", () => {
    const blades: Entity = {
      kind: "blades",
      z: 0.05,
      lanes: [false, true, false],
      damage: 9,
      style: "saw",
      done: false,
    };
    const next = step({ ...running(1, [blades], 5), distance: 300, bonus: 40 }, FRAME);
    expect(next.count).toBe(0);
    expect(next.status).toBe("over");
    expect(next.best).toBe(scoreOf(next));
    expect(next.events).toContainEqual({ type: "over", newBest: true });
    const frozen = step(next, FRAME);
    expect(frozen.distance).toBe(next.distance);
  });

  it("only hits obstacles and enemies in the crowd's lane", () => {
    const entities: Entity[] = [
      { kind: "enemy", z: 0.05, lane: 0, count: 50, done: false },
      { kind: "blades", z: 0.05, lanes: [true, false, true], damage: 9, style: "bar", done: false },
      { kind: "enemy", z: 0.05, lane: 1, count: 8, done: false },
    ];
    const next = step(running(1, entities, 20), FRAME);
    expect(next.count).toBe(12);
    expect(next.status).toBe("running");
  });

  it("applies the gate in the crowd's lane", () => {
    const gates = gateSet([{ kind: "sub", value: 5 }, { kind: "mul", value: 3 }, null]);
    const next = step(running(1, [gates], 4), FRAME);
    expect(next.count).toBe(12);
    expect(next.maxCount).toBe(12);
    expect(next.entities[0]).toMatchObject({ kind: "gates", taken: 1, done: true });
  });

  it("builds a combo from consecutive good gates and resets it on a bad one", () => {
    const good: GateOp = { kind: "add", value: 1 };
    const bad: GateOp = { kind: "sub", value: 1 };
    const lanes = (op: GateOp) => [op, op, op];
    let state = running(
      1,
      [
        gateSet(lanes(good), 0.05),
        gateSet(lanes(good), 0.3),
        gateSet([null, null, null], 0.55),
        gateSet(lanes(good), 0.8),
        gateSet(lanes(bad), 1.05),
      ],
      10,
    );
    const combos: number[] = [];
    const bonuses: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      const before = state.bonus;
      state = step(state, FRAME);
      for (const event of state.events) {
        if (event.type !== "gate") continue;
        combos.push(event.combo);
        bonuses.push(state.bonus - before);
      }
    }
    expect(combos).toEqual([1, 2, 3, 0]);
    expect(bonuses).toEqual([0, comboBonus(2), comboBonus(3), 0]);
    expect(state.combo).toBe(0);
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
    expect(next.runBest).toBe(900);
    expect(next.events).toEqual([{ type: "start" }]);
  });

  it("keeps the mute choice across restarts", () => {
    const unmuted = toggleMute(running(3, [], 0));
    expect(unmuted.muted).toBe(false);
    const next = step({ ...unmuted, status: "over" }, FRAME, { start: true });
    expect(next.muted).toBe(false);
  });
});

describe("snapshots", () => {
  it("round-trips through JSON and resumes identically", () => {
    let state = step(initialState(99), 0, { start: true });
    for (let frame = 0; frame < 400; frame++) {
      state = step(state, FRAME, { laneDelta: frame === 30 ? -1 : 0 });
    }
    state = toggleMute(state);
    const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(state))));
    expect(restored).toEqual({ ...state, events: [] });
    expect(restored?.muted).toBe(false);
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
    const valid = toSnapshot(initialState(1));
    const broken: unknown[] = [
      null,
      undefined,
      42,
      "state",
      [],
      {},
      { ...valid, v: 1 },
      { ...valid, v: 2 },
      {
        v: 3,
        state: { ...valid.state, entities: [{ kind: "wall", x: 30, count: 5, done: false }] },
      },
      { v: 3, state: { ...valid.state, gen: { nextX: 40, stage: 1, sets: 0 } } },
      { v: 3, state: null },
      { v: 3, state: { ...valid.state, status: "paused" } },
      { v: 3, state: { ...valid.state, count: -1 } },
      { v: 3, state: { ...valid.state, count: Number.NaN } },
      { v: 3, state: { ...valid.state, lane: 7 } },
      { v: 3, state: { ...valid.state, stage: 0 } },
      { v: 3, state: { ...valid.state, entities: [{ kind: "dragon", z: 1, done: false }] } },
      {
        v: 3,
        state: {
          ...valid.state,
          entities: [{ kind: "gates", z: 1, done: false, ops: [{ kind: "pow", value: 2 }] }],
        },
      },
      { v: 3, state: { ...valid.state, gen: undefined } },
      { v: 3, state: { ...valid.state, muted: "no" } },
      { v: 3, state: { ...valid.state, clear: { stage: 1 } } },
      { v: 3, state: { ...valid.state, entities: [{ ...gateSet([null, null, null]), taken: 5 }] } },
    ];
    for (const value of broken) expect(fromSnapshot(value)).toBeNull();
    expect(fromSnapshot(valid)).toEqual({ ...valid.state, events: [] });
  });
});
