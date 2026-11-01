import type { MiniGame, MiniGameCreateOptions, MiniGameInstance, MiniGameTheme } from "../types";
import {
  fromSnapshot,
  initialState,
  resize,
  scoreOf,
  step,
  toSnapshot,
  type StepInput,
} from "./logic";
import { laneAt, render } from "./render";

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 250;

const UP_KEYS = new Set(["ArrowUp", "ArrowLeft", "w", "W", "a", "A"]);
const DOWN_KEYS = new Set(["ArrowDown", "ArrowRight", "s", "S", "d", "D"]);
const START_KEYS = new Set([" ", "Spacebar"]);

function createGateRunner(canvas: HTMLCanvasElement, options: MiniGameCreateOptions) {
  let theme: MiniGameTheme = options.theme;
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 180;
  let ratio = 1;
  let state =
    fromSnapshot(options.snapshot) ??
    initialState(Math.floor(Math.random() * 4294967296), width, height);
  state = resize(state, width, height);
  let frame: number | null = null;
  let lastTime: number | null = null;
  let accumulator = 0;
  let pending: StepInput = {};
  let dragging = false;
  let reportedScore: number | null = null;

  const report = () => {
    const score = scoreOf(state);
    if (score === reportedScore) return;
    reportedScore = score;
    options.onScore?.(score);
  };

  const draw = () => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    render(context, state, theme, width, height);
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const elapsed = lastTime === null ? STEP_MS : Math.min(MAX_FRAME_MS, now - lastTime);
    lastTime = now;
    accumulator += elapsed;
    while (accumulator >= STEP_MS) {
      state = step(state, STEP_MS, pending);
      pending = {};
      accumulator -= STEP_MS;
    }
    report();
    draw();
  };

  const queue = (input: StepInput) => {
    pending = {
      start: Boolean(pending.start || input.start),
      laneDelta: (pending.laneDelta ?? 0) + (input.laneDelta ?? 0),
      targetLane: input.targetLane ?? pending.targetLane ?? null,
    };
  };

  report();

  const instance: MiniGameInstance = {
    start: () => {
      if (frame !== null) return;
      lastTime = null;
      accumulator = 0;
      frame = requestAnimationFrame(tick);
    },
    pause: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      dragging = false;
    },
    snapshot: () => toSnapshot(state),
    resize: (nextWidth, nextHeight, pixelRatio) => {
      width = nextWidth;
      height = nextHeight;
      ratio = pixelRatio;
      state = resize(state, width, height);
      draw();
    },
    setTheme: (next) => {
      theme = next;
      draw();
    },
    keyDown: (key) => {
      if (START_KEYS.has(key)) {
        if (state.status !== "running") queue({ start: true });
        return true;
      }
      if (UP_KEYS.has(key)) {
        queue({ laneDelta: -1 });
        return true;
      }
      if (DOWN_KEYS.has(key)) {
        queue({ laneDelta: 1 });
        return true;
      }
      return false;
    },
    keyUp: () => {},
    pointerDown: (_x, y) => {
      if (state.status !== "running") {
        queue({ start: true });
        return;
      }
      dragging = true;
      queue({ targetLane: laneAt(y, height) });
    },
    pointerMove: (_x, y) => {
      if (dragging) queue({ targetLane: laneAt(y, height) });
    },
    pointerUp: () => {
      dragging = false;
    },
    destroy: () => {
      instance.pause();
    },
  };
  draw();
  return instance;
}

export const gateRunnerGame: MiniGame = {
  id: "gate-runner",
  title: "Gate Rush",
  controls: "↑/↓, W/S or drag to steer",
  create: createGateRunner,
};
