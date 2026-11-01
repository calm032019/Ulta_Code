import type { MiniGame, MiniGameInstance, MiniGameTheme } from "../types";
import {
  STEP_MS,
  fromSnapshot,
  initialState,
  needsFrames,
  step,
  toSnapshot,
  withViewport,
  type RunState,
} from "./logic";
import { render } from "./render";

const MAX_FRAME_MS = 100;
const JUMP_KEYS = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);
const DUCK_KEYS = new Set(["ArrowDown", "s", "S"]);

function createClaudeRun(
  canvas: HTMLCanvasElement,
  options: Parameters<MiniGame["create"]>[1],
): MiniGameInstance {
  let theme: MiniGameTheme = options.theme;
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 180;
  let pixelRatio = 1;
  let state: RunState = withViewport(
    fromSnapshot(options.snapshot) ?? initialState((Math.random() * 4294967296) >>> 0, 1, 1),
    width,
    height,
  );
  let jumpHeld = false;
  let jumpPressed = false;
  let duckHeld = false;
  let started = false;
  let frame: number | null = null;
  let lastTime: number | null = null;
  let accumulator = 0;
  let reportedScore = -1;

  const draw = () => {
    const context = canvas.getContext("2d");
    if (context) render(context, state, theme, { width, height, pixelRatio });
    if (state.score !== reportedScore) {
      reportedScore = state.score;
      options.onScore?.(state.score);
    }
  };

  const tick = (time: number) => {
    frame = null;
    const elapsed = lastTime === null ? STEP_MS : Math.min(time - lastTime, MAX_FRAME_MS);
    lastTime = time;
    accumulator += elapsed;
    while (accumulator >= STEP_MS) {
      state = step(state, STEP_MS, { jumpHeld, jumpPressed, duckHeld });
      jumpPressed = false;
      accumulator -= STEP_MS;
    }
    draw();
    if (started && needsFrames(state)) {
      frame = requestAnimationFrame(tick);
    } else {
      lastTime = null;
      accumulator = 0;
    }
  };

  const wake = () => {
    if (started && frame === null) frame = requestAnimationFrame(tick);
  };

  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastTime = null;
    accumulator = 0;
  };

  const pressJump = () => {
    if (!jumpHeld) jumpPressed = true;
    jumpHeld = true;
    wake();
  };

  draw();

  return {
    start: () => {
      started = true;
      wake();
    },
    pause: () => {
      started = false;
      jumpHeld = false;
      jumpPressed = false;
      duckHeld = false;
      cancel();
    },
    snapshot: () => toSnapshot(state),
    resize: (nextWidth, nextHeight, nextPixelRatio) => {
      width = nextWidth;
      height = nextHeight;
      pixelRatio = nextPixelRatio;
      state = withViewport(state, width, height);
      draw();
    },
    setTheme: (next) => {
      theme = next;
      draw();
    },
    keyDown: (key) => {
      if (JUMP_KEYS.has(key)) {
        pressJump();
        return true;
      }
      if (DUCK_KEYS.has(key)) {
        duckHeld = true;
        wake();
        return true;
      }
      return false;
    },
    keyUp: (key) => {
      if (JUMP_KEYS.has(key)) jumpHeld = false;
      if (DUCK_KEYS.has(key)) duckHeld = false;
    },
    pointerDown: () => pressJump(),
    pointerMove: () => {},
    pointerUp: () => {
      jumpHeld = false;
    },
    destroy: () => {
      started = false;
      cancel();
    },
  };
}

export const claudeRunGame: MiniGame = {
  id: "claude-run",
  title: "Claude Run",
  controls: "Space, ↑ or tap to jump · ↓ to duck",
  create: createClaudeRun,
};
