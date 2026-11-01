import type { MiniGame, MiniGameCreateOptions, MiniGameInstance } from "../types";
import { createSound, type SoundName } from "./audio";
import { createFx, handleEvent, hasActiveEffects, updateFx } from "./fx";
import {
  RESTART_DELAY_MS,
  STEP_MS,
  fromSnapshot,
  initialState,
  step,
  toSnapshot,
  withViewport,
  type RunEvent,
  type RunState,
} from "./logic";
import {
  buildPalette,
  cardLayout,
  contains,
  muteButtonRect,
  normaliseTheme,
  render,
  type Palette,
} from "./render";

const MAX_FRAME_MS = 100;
const IDLE_FRAME_MS = 1000 / 30;
const JUMP_KEYS = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);
const DUCK_KEYS = new Set(["ArrowDown", "s", "S"]);
const MUTE_KEYS = new Set(["m", "M"]);

function readFont(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return family || "system-ui, -apple-system, sans-serif";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function soundFor(event: RunEvent): readonly [SoundName, number] | null {
  switch (event.type) {
    case "jump":
      return ["jump", 1];
    case "land":
      return ["land", event.impact / 700];
    case "clear":
      return event.bonus > 0 ? ["combo", event.combo] : null;
    case "near-miss":
      return ["near-miss", 1];
    case "crash":
      return ["crash", 1];
    case "milestone":
      return ["milestone", 1];
    default:
      return null;
  }
}

function createClaudeRun(
  canvas: HTMLCanvasElement,
  options: MiniGameCreateOptions,
): MiniGameInstance {
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 180;
  let pixelRatio = 1;
  let palette: Palette = buildPalette(normaliseTheme(options.theme), readFont());
  const saved = options.snapshot;
  let muted = !(
    typeof saved === "object" &&
    saved !== null &&
    "muted" in saved &&
    saved.muted === false
  );
  let state: RunState = withViewport(
    fromSnapshot(saved) ?? initialState((Math.random() * 4294967296) >>> 0, 1, 1),
    width,
    height,
  );
  const fx = createFx(prefersReducedMotion(), (Math.random() * 4294967296) >>> 0, state);
  const sound = createSound(() => muted);

  let jumpHeld = false;
  let jumpPressed = false;
  let duckHeld = false;
  let pointerOnCard = false;
  let hover = false;
  let started = false;
  let frame: number | null = null;
  let lastTime: number | null = null;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let accumulator = 0;
  let reportedScore = -1;

  const draw = () => {
    const context = canvas.getContext("2d");
    if (context) {
      render(
        context,
        state,
        fx,
        palette,
        { width, height, pixelRatio },
        {
          hover,
          pressed: pointerOnCard && hover,
          muted,
        },
      );
    }
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
      for (const event of state.events) {
        handleEvent(fx, event, state);
        const cue = soundFor(event);
        if (cue) sound.play(cue[0], cue[1]);
      }
    }
    updateFx(fx, state, elapsed);
    const idle = state.phase !== "running" && !hasActiveEffects(fx);
    if (!idle || time - lastDraw >= IDLE_FRAME_MS) {
      lastDraw = time;
      draw();
    }
    if (started) frame = requestAnimationFrame(tick);
  };

  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastTime = null;
    accumulator = 0;
  };

  const userGesture = () => {
    if (!muted) sound.unlock();
  };

  const pressJump = () => {
    userGesture();
    if (!jumpHeld) jumpPressed = true;
    jumpHeld = true;
  };

  const toggleMute = () => {
    muted = !muted;
    if (!muted) {
      sound.unlock();
      sound.play("toggle");
    }
    if (!started) draw();
  };

  const overCardHit = (x: number, y: number) =>
    state.phase === "over" && contains(cardLayout(width, height).button, x, y);

  draw();

  return {
    start: () => {
      if (started) return;
      started = true;
      sound.resume();
      frame = requestAnimationFrame(tick);
    },
    pause: () => {
      started = false;
      jumpHeld = false;
      jumpPressed = false;
      duckHeld = false;
      pointerOnCard = false;
      cancel();
      sound.suspend();
    },
    snapshot: () => ({ ...toSnapshot(state), muted }),
    resize: (nextWidth, nextHeight, nextPixelRatio) => {
      width = nextWidth;
      height = nextHeight;
      pixelRatio = nextPixelRatio;
      state = withViewport(state, width, height);
      draw();
    },
    setTheme: (next) => {
      palette = buildPalette(normaliseTheme(next), readFont());
      draw();
    },
    keyDown: (key) => {
      if (JUMP_KEYS.has(key)) {
        pressJump();
        return true;
      }
      if (DUCK_KEYS.has(key)) {
        userGesture();
        duckHeld = true;
        return true;
      }
      if (MUTE_KEYS.has(key)) {
        toggleMute();
        return true;
      }
      return false;
    },
    keyUp: (key) => {
      if (JUMP_KEYS.has(key)) jumpHeld = false;
      if (DUCK_KEYS.has(key)) duckHeld = false;
    },
    pointerDown: (x, y) => {
      if (contains(muteButtonRect(height), x, y)) {
        toggleMute();
        return;
      }
      if (state.phase === "over") {
        userGesture();
        pointerOnCard = true;
        hover = overCardHit(x, y);
        return;
      }
      pressJump();
    },
    pointerMove: (x, y) => {
      hover = overCardHit(x, y);
    },
    pointerUp: (x, y) => {
      if (pointerOnCard) {
        pointerOnCard = false;
        hover = overCardHit(x, y);
        if (state.phase === "over" && state.overMs >= RESTART_DELAY_MS) jumpPressed = true;
        return;
      }
      jumpHeld = false;
    },
    destroy: () => {
      started = false;
      cancel();
      sound.close();
    },
  };
}

export const claudeRunGame: MiniGame = {
  id: "claude-run",
  title: "Claude Run",
  controls: "Space, ↑ or tap to jump · ↓ to duck · M for sound",
  create: createClaudeRun,
};
