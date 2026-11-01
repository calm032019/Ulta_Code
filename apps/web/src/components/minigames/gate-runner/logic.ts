export const LANES = 3;
export const SETS_PER_STAGE = 8;
export const MAX_COUNT = 99_999;
export const SPAWN_AHEAD = 60;
const DESPAWN_BEHIND = 30;
const START_COUNT = 10;
const LANE_EASE_MS = 80;
const EFFECT_MS = 700;
const SNAPSHOT_VERSION = 1;

export type GateOpKind = "add" | "sub" | "mul" | "div";

export interface GateOp {
  kind: GateOpKind;
  value: number;
}

export interface GateSet {
  kind: "gates";
  x: number;
  ops: Array<GateOp | null>;
  done: boolean;
}

export interface Blades {
  kind: "blades";
  x: number;
  lanes: boolean[];
  damage: number;
  style: "saw" | "bar";
  done: boolean;
}

export interface Enemy {
  kind: "enemy";
  x: number;
  lane: number;
  count: number;
  done: boolean;
}

export interface FinishWall {
  kind: "wall";
  x: number;
  count: number;
  done: boolean;
}

export type Entity = GateSet | Blades | Enemy | FinishWall;

export interface Effect {
  x: number;
  lane: number;
  label: string;
  tone: "good" | "bad";
  age: number;
}

export type Status = "ready" | "running" | "over";

export interface GateRunnerState {
  status: Status;
  width: number;
  height: number;
  rng: number;
  time: number;
  distance: number;
  lane: number;
  targetLane: number;
  count: number;
  stage: number;
  bonus: number;
  best: number;
  entities: Entity[];
  effects: Effect[];
  gen: { nextX: number; stage: number; sets: number };
}

export interface StepInput {
  start?: boolean;
  laneDelta?: number;
  targetLane?: number | null;
}

function nextRandom(state: GateRunnerState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomInt(state: GateRunnerState, min: number, max: number): number {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COUNT, Math.floor(value)));
}

/** ÷2 rounds up so a lone runner survives halving; subtraction floors at zero. */
export function applyGate(count: number, op: GateOp): number {
  const current = clampCount(count);
  const value = Math.max(0, Math.floor(op.value));
  switch (op.kind) {
    case "add":
      return clampCount(current + value);
    case "sub":
      return clampCount(current - value);
    case "mul":
      return clampCount(current * value);
    case "div":
      return value <= 0 ? current : clampCount(Math.ceil(current / value));
  }
}

export function isGoodOp(op: GateOp): boolean {
  return op.kind === "add" || op.kind === "mul";
}

export function formatOp(op: GateOp): string {
  switch (op.kind) {
    case "add":
      return `+${op.value}`;
    case "sub":
      return `−${op.value}`;
    case "mul":
      return `×${op.value}`;
    case "div":
      return `÷${op.value}`;
  }
}

export function speedForStage(stage: number): number {
  return Math.min(19, 8 + (stage - 1) * 1.5);
}

function goodOp(state: GateRunnerState, stage: number): GateOp {
  const roll = nextRandom(state);
  if (roll < 0.06 + Math.min(0.06, stage * 0.01)) return { kind: "mul", value: 3 };
  if (roll < 0.32) return { kind: "mul", value: 2 };
  return { kind: "add", value: randomInt(state, 3, 6 + stage * 4) };
}

function badOp(state: GateRunnerState, stage: number): GateOp {
  if (nextRandom(state) < 0.35) return { kind: "div", value: 2 };
  return { kind: "sub", value: randomInt(state, 2, 2 + stage * 4) };
}

export function generateGateSet(state: GateRunnerState, stage: number, x: number): GateSet {
  const safeLane = randomInt(state, 0, LANES - 1);
  const emptyLane = nextRandom(state) < 0.3 ? randomInt(state, 0, LANES - 1) : -1;
  const goodChance = Math.max(0.15, 0.5 - stage * 0.06);
  const ops: Array<GateOp | null> = [];
  for (let lane = 0; lane < LANES; lane++) {
    if (lane === emptyLane && lane !== safeLane) ops.push(null);
    else if (lane === safeLane || nextRandom(state) < goodChance) ops.push(goodOp(state, stage));
    else ops.push(badOp(state, stage));
  }
  return { kind: "gates", x, ops, done: false };
}

function spawnNext(state: GateRunnerState): void {
  const gen = state.gen;
  const gap = 10 + speedForStage(gen.stage) * 0.5;
  if (gen.sets >= SETS_PER_STAGE) {
    const factor = Math.min(0.85, 0.55 + gen.stage * 0.05);
    const count = Math.max(1, Math.floor(state.count * factor));
    state.entities.push({ kind: "wall", x: gen.nextX, count, done: false });
    gen.nextX += gap * 1.6;
    gen.sets = 0;
    gen.stage += 1;
    return;
  }
  if (gen.sets > 0) {
    const roll = nextRandom(state);
    if (roll < 0.4) {
      const blocked = gen.stage >= 2 && nextRandom(state) < 0.4 ? 2 : 1;
      const lanes = Array.from({ length: LANES }, () => false);
      const start = randomInt(state, 0, LANES - blocked);
      for (let lane = start; lane < start + blocked; lane++) lanes[lane] = true;
      state.entities.push({
        kind: "blades",
        x: gen.nextX,
        lanes,
        damage: randomInt(state, 2, 2 + gen.stage * 2),
        style: nextRandom(state) < 0.6 ? "saw" : "bar",
        done: false,
      });
      gen.nextX += gap;
    } else if (roll < 0.7) {
      state.entities.push({
        kind: "enemy",
        x: gen.nextX,
        lane: randomInt(state, 0, LANES - 1),
        count: randomInt(state, 2, 3 + gen.stage * 5),
        done: false,
      });
      gen.nextX += gap;
    }
  }
  state.entities.push(generateGateSet(state, gen.stage, gen.nextX));
  gen.sets += 1;
  gen.nextX += gap;
}

function fillAhead(state: GateRunnerState): void {
  while (state.gen.nextX < state.distance + SPAWN_AHEAD) spawnNext(state);
}

export function initialState(seed: number, width: number, height: number): GateRunnerState {
  const state: GateRunnerState = {
    status: "ready",
    width,
    height,
    rng: seed >>> 0,
    time: 0,
    distance: 0,
    lane: 1,
    targetLane: 1,
    count: START_COUNT,
    stage: 1,
    bonus: 0,
    best: 0,
    entities: [],
    effects: [],
    gen: { nextX: 22, stage: 1, sets: 0 },
  };
  fillAhead(state);
  return state;
}

export function resize(state: GateRunnerState, width: number, height: number): GateRunnerState {
  return { ...state, width, height };
}

export function scoreOf(state: GateRunnerState): number {
  return Math.floor(state.distance) + state.bonus;
}

function cloneState(state: GateRunnerState): GateRunnerState {
  return {
    ...state,
    entities: state.entities.map((entity) =>
      entity.kind === "gates"
        ? { ...entity, ops: entity.ops.map((op) => (op ? { ...op } : null)) }
        : entity.kind === "blades"
          ? { ...entity, lanes: [...entity.lanes] }
          : { ...entity },
    ),
    effects: state.effects.map((effect) => ({ ...effect })),
    gen: { ...state.gen },
  };
}

function addEffect(state: GateRunnerState, label: string, tone: Effect["tone"], lane: number) {
  state.effects.push({ x: state.distance, lane, label, tone, age: 0 });
}

function endGame(state: GateRunnerState): void {
  state.status = "over";
  state.best = Math.max(state.best, scoreOf(state));
}

export function restart(previous: GateRunnerState): GateRunnerState {
  const state = cloneState(previous);
  const seed = Math.floor(nextRandom(state) * 4294967296);
  const next = initialState(seed, state.width, state.height);
  next.best = Math.max(state.best, scoreOf(state));
  next.status = "running";
  return next;
}

function resolve(state: GateRunnerState, entity: Entity, lane: number): void {
  entity.done = true;
  switch (entity.kind) {
    case "gates": {
      const op = entity.ops[lane];
      if (!op) return;
      state.count = applyGate(state.count, op);
      addEffect(state, formatOp(op), isGoodOp(op) ? "good" : "bad", lane);
      return;
    }
    case "blades": {
      if (!entity.lanes[lane]) return;
      state.count = clampCount(state.count - entity.damage);
      addEffect(state, `−${entity.damage}`, "bad", lane);
      return;
    }
    case "enemy": {
      if (entity.lane !== lane) return;
      const lost = Math.min(state.count, entity.count);
      state.count = clampCount(state.count - entity.count);
      entity.count = 0;
      state.bonus += lost;
      addEffect(state, `−${lost}`, "bad", lane);
      return;
    }
    case "wall": {
      if (state.count > entity.count) {
        state.count = clampCount(state.count - entity.count);
        state.bonus += state.stage * 100;
        state.stage += 1;
        addEffect(state, `Stage ${state.stage}`, "good", lane);
      } else {
        addEffect(state, `${entity.count}`, "bad", lane);
        endGame(state);
      }
      return;
    }
  }
}

export function step(state: GateRunnerState, dtMs: number, input: StepInput = {}): GateRunnerState {
  if (input.start && state.status !== "running") {
    return state.status === "over" ? restart(state) : { ...cloneState(state), status: "running" };
  }
  const s = cloneState(state);
  const dt = Math.max(0, dtMs);
  s.time += dt;
  if (s.status === "over") return s;

  if (input.targetLane !== undefined && input.targetLane !== null) {
    s.targetLane = Math.max(0, Math.min(LANES - 1, Math.round(input.targetLane)));
  }
  if (input.laneDelta) {
    s.targetLane = Math.max(0, Math.min(LANES - 1, s.targetLane + Math.round(input.laneDelta)));
  }
  const diff = s.targetLane - s.lane;
  s.lane =
    Math.abs(diff) < 0.002 ? s.targetLane : s.lane + diff * (1 - Math.exp(-dt / LANE_EASE_MS));

  for (const effect of s.effects) effect.age += dt;
  s.effects = s.effects.filter((effect) => effect.age < EFFECT_MS);

  if (s.status !== "running") return s;

  s.distance += (speedForStage(s.stage) * dt) / 1000;
  const lane = Math.round(s.lane);
  for (const entity of s.entities) {
    if (entity.done || entity.x > s.distance) continue;
    resolve(s, entity, lane);
    if (s.status !== "running") break;
  }
  if (s.status === "running" && s.count <= 0) endGame(s);
  s.entities = s.entities.filter((entity) => entity.x > s.distance - DESPAWN_BEHIND);
  fillAhead(s);
  if (s.status === "running") s.best = Math.max(s.best, scoreOf(s));
  return s;
}

export interface GateRunnerSnapshot {
  v: typeof SNAPSHOT_VERSION;
  state: GateRunnerState;
}

export function toSnapshot(state: GateRunnerState): GateRunnerSnapshot {
  return { v: SNAPSHOT_VERSION, state: cloneState(state) };
}

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isLane = (value: unknown): value is number =>
  isNum(value) && Number.isInteger(value) && value >= 0 && value < LANES;
const isCount = (value: unknown): value is number =>
  isNum(value) && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;

function isOp(value: unknown): value is GateOp {
  return (
    isRec(value) &&
    (value.kind === "add" ||
      value.kind === "sub" ||
      value.kind === "mul" ||
      value.kind === "div") &&
    isCount(value.value)
  );
}

function isEntity(value: unknown): value is Entity {
  if (!isRec(value) || !isNum(value.x) || typeof value.done !== "boolean") return false;
  switch (value.kind) {
    case "gates":
      return (
        Array.isArray(value.ops) &&
        value.ops.length === LANES &&
        value.ops.every((op) => op === null || isOp(op))
      );
    case "blades":
      return (
        Array.isArray(value.lanes) &&
        value.lanes.length === LANES &&
        value.lanes.every((lane) => typeof lane === "boolean") &&
        isCount(value.damage) &&
        (value.style === "saw" || value.style === "bar")
      );
    case "enemy":
      return isLane(value.lane) && isCount(value.count);
    case "wall":
      return isCount(value.count);
    default:
      return false;
  }
}

function isEffect(value: unknown): value is Effect {
  return (
    isRec(value) &&
    isNum(value.x) &&
    isLane(value.lane) &&
    typeof value.label === "string" &&
    (value.tone === "good" || value.tone === "bad") &&
    isNum(value.age)
  );
}

export function fromSnapshot(value: unknown): GateRunnerState | null {
  if (!isRec(value) || value.v !== SNAPSHOT_VERSION || !isRec(value.state)) return null;
  const s = value.state;
  const gen = s.gen;
  if (
    !(s.status === "ready" || s.status === "running" || s.status === "over") ||
    !isNum(s.width) ||
    !isNum(s.height) ||
    !isNum(s.rng) ||
    !isNum(s.time) ||
    !isNum(s.distance) ||
    s.distance < 0 ||
    !isNum(s.lane) ||
    s.lane < 0 ||
    s.lane > LANES - 1 ||
    !isLane(s.targetLane) ||
    !isCount(s.count) ||
    !isNum(s.stage) ||
    !Number.isInteger(s.stage) ||
    s.stage < 1 ||
    !isNum(s.bonus) ||
    !isNum(s.best) ||
    !Array.isArray(s.entities) ||
    !s.entities.every(isEntity) ||
    !Array.isArray(s.effects) ||
    !s.effects.every(isEffect) ||
    !isRec(gen) ||
    !isNum(gen.nextX) ||
    !isNum(gen.stage) ||
    !isNum(gen.sets)
  ) {
    return null;
  }
  return cloneState({
    status: s.status,
    width: s.width,
    height: s.height,
    rng: s.rng >>> 0,
    time: s.time,
    distance: s.distance,
    lane: s.lane,
    targetLane: s.targetLane,
    count: s.count,
    stage: s.stage,
    bonus: s.bonus,
    best: s.best,
    entities: s.entities,
    effects: s.effects,
    gen: { nextX: gen.nextX, stage: gen.stage, sets: gen.sets },
  });
}
