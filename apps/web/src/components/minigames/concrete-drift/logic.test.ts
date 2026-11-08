import { describe, expect, it } from "vite-plus/test";

import { fromSnapshot, groundAt, initialState, scoreOf, step, toSnapshot } from "./logic";
import { GEN_AHEAD, type GameEvent, type GameState, type Segment, type StepInput } from "./model";

const STEP = 1000 / 120;

function running(seed = 7): GameState {
  return step(initialState(seed), STEP, { start: true });
}

function run(
  state: GameState,
  steps: number,
  input: StepInput | ((s: GameState) => StepInput) = {},
): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    s = step(s, STEP, typeof input === "function" ? input(s) : input);
    events.push(...s.events);
  }
  return { state: s, events };
}

/** Rider in the air above the calm flat street the run starts on. */
function airborne(height: number, angle: number, vy = 150): GameState {
  const s = running();
  return {
    ...s,
    rider: { ...s.rider, x: -600, y: -height, vx: 200, vy, angle, grounded: false, airTime: 400 },
  };
}

const finite = (value: unknown): boolean =>
  typeof value === "number"
    ? Number.isFinite(value)
    : Array.isArray(value)
      ? value.every(finite)
      : typeof value === "object" && value !== null
        ? Object.values(value).every(finite)
        : true;

describe("world generation", () => {
  it("is deterministic per seed", () => {
    expect(toSnapshot(initialState(42))).toEqual(toSnapshot(initialState(42)));
    expect(toSnapshot(initialState(42))).not.toEqual(toSnapshot(initialState(43)));
  });

  it("stays contiguous, finite and bounded over a long scripted run with restarts", () => {
    let s = running(3);
    let overs = 0;
    for (let i = 0; i < 8_000; i++) {
      const input: StepInput = {
        jumpPressed: i % 70 === 0,
        jumpHeld: i % 70 < 20,
        shoot: i % 45 === 0,
        slash: i % 90 === 0,
      };
      const before = s.status;
      s = step(s, STEP, input);
      if (before === "running" && s.status === "over") overs++;
      if (i % 20 === 0) expect(finite(toSnapshot(s))).toBe(true);
      const segs = s.segments;
      const seams = segs.slice(1).filter((seg, k) => seg.x0 !== segs[k]!.x1);
      expect(seams).toEqual([]);
      expect(s.genX).toBe(segs[segs.length - 1]!.x1);
      expect(s.genX).toBeGreaterThanOrEqual(s.rider.x + GEN_AHEAD);
      expect(segs.length).toBeLessThan(600);
      expect(s.enemies.length + s.bullets.length).toBeLessThan(100);
    }
    expect(overs).toBeGreaterThan(0);
    expect(s.best).toBeGreaterThan(0);
  });
});

describe("landing", () => {
  it("lands a level board cleanly and crashes an upside-down one", () => {
    const clean = run(airborne(2, 0), 4);
    expect(clean.state.status).toBe("running");
    expect(clean.state.rider.grounded).toBe(true);

    const flipped = run(airborne(2, Math.PI), 4);
    expect(flipped.state.status).toBe("over");
    expect(flipped.state.deathReason).toBe("landing");
    expect(flipped.events.map((e) => e.kind)).toEqual(["crash", "over"]);
  });

  it("scores a held backflip that is released in time", () => {
    const start = { ...airborne(260, 0, -200), combo: 1, score: 0 };
    const { state, events } = run(start, 240, (s) => ({
      jumpHeld: !s.rider.grounded && s.rider.angle > -Math.PI * 2 + 1.1,
    }));
    expect(state.status).toBe("running");
    expect(events.find((e) => e.kind === "trick")?.value).toBe(1);
    expect(state.combo).toBe(2);
    expect(state.score).toBe(150);
  });
});

describe("gaps", () => {
  it("has no ground over a gap and drops a rider who never jumps", () => {
    const s = running();
    const segments: Segment[] = [
      { x0: -700, y0: 0, x1: 0, y1: 0, zone: "roof", gap: false },
      { x0: 0, y0: 0, x1: 140, y1: 0, zone: "roof", gap: true },
      { x0: 140, y0: 0, x1: s.genX, y1: 0, zone: "roof", gap: false },
    ];
    const world: GameState = {
      ...s,
      segments,
      rider: { ...s.rider, x: -40, vx: 250 },
      enemies: [],
      obstacles: [],
    };
    expect(groundAt(world, -10)).toEqual({ y: 0, zone: "roof" });
    expect(groundAt(world, 70)).toBeNull();
    const { state } = run(world, 240);
    expect(state.status).toBe("over");
    expect(state.deathReason).toBe("fall");
  });
});

describe("combat", () => {
  it("kills a thug with two pistol shots and leaves the corpse", () => {
    const s = running();
    const thug = {
      id: 9_999,
      kind: "thug" as const,
      x: s.rider.x + 150,
      y: 0,
      vx: 0,
      vy: 0,
      facing: -1 as const,
      hp: 2,
      state: "idle" as const,
      stateAge: 0,
      aim: 0,
      seed: 1,
    };
    const { state, events } = run({ ...s, enemies: [thug], obstacles: [] }, 40, { shoot: true });
    const hits = events.filter((e) => e.kind === "hitEnemy");
    expect(hits).toHaveLength(2);
    expect(hits[0]!.dx).toBeGreaterThan(0.9);
    expect(events.find((e) => e.kind === "kill")).toMatchObject({ value: 200, enemyKind: "thug" });
    expect(state.enemies.find((e) => e.id === thug.id)?.state).toBe("dead");
    expect(state.kills).toBe(1);
    expect(state.combo).toBe(2);
    expect(state.ammo).toBeLessThan(12);
    expect(scoreOf(state)).toBeGreaterThanOrEqual(200);
  });
});

describe("snapshots", () => {
  it("round-trips through JSON and rejects anything malformed", () => {
    const { state } = run(running(11), 600, (s) => ({ jumpPressed: s.time % 900 < STEP }));
    const json = JSON.stringify(toSnapshot(state));
    const restored = fromSnapshot(JSON.parse(json));
    expect(restored).not.toBeNull();
    expect(JSON.stringify(toSnapshot(restored!))).toBe(json);
    expect(restored!.events).toEqual([]);

    const snap = JSON.parse(json) as Record<string, unknown>;
    expect(fromSnapshot(null)).toBeNull();
    expect(fromSnapshot({})).toBeNull();
    expect(fromSnapshot({ ...snap, version: 2 })).toBeNull();
    expect(fromSnapshot({ ...snap, score: Number.NaN })).toBeNull();
    expect(fromSnapshot({ ...snap, segments: [{ x0: 0 }] })).toBeNull();
    expect(fromSnapshot({ ...snap, rider: { ...(snap.rider as object), railId: "x" } })).toBeNull();
  });
});
