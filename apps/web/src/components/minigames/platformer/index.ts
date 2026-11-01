import type { MiniGame, MiniGameCreateOptions, MiniGameInstance, MiniGameTheme } from "../types";
import { createAudio } from "./audio";
import { parseColor, type Rgba } from "./color";
import { applyEvents, createEffects, updateEffects } from "./effects";
import {
  fromSnapshot,
  initialState,
  resizeState,
  setMuted,
  step,
  toSnapshot,
  type GameState,
} from "./logic";
import { buildPalette, inside, layout, render, type Palette } from "./render";

const STEP_MS = 1000 / 120;
const MAX_FRAME_MS = 100;
const IDLE_FRAME_MS = 1000 / 30;
const LEFT_KEYS = new Set(["ArrowLeft", "a", "A"]);
const RIGHT_KEYS = new Set(["ArrowRight", "d", "D"]);
const JUMP_KEYS = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);
const MUTE_KEYS = new Set(["m", "M"]);
const SWIPE_PX = 24;

function colourResolver(): (css: string) => Rgba {
  let probe: CanvasRenderingContext2D | null = null;
  return (css) => {
    const parsed = parseColor(css);
    if (parsed) return parsed;
    probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#808080";
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const [r = 128, g = 128, b = 128, a = 255] = probe.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    }
    return { r: 128, g: 128, b: 128, a: 1 };
  };
}

function readFont(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return value || "system-ui, sans-serif";
}

function prefers(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

function create(canvas: HTMLCanvasElement, options: MiniGameCreateOptions): MiniGameInstance {
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 180;
  let ratio = 1;
  const resolve = colourResolver();
  let palette: Palette = buildPalette(options.theme, resolve);
  let font = readFont();
  const motion = !prefers("(prefers-reduced-motion: reduce)");
  let touchHint = prefers("(any-pointer: coarse)");

  let state: GameState =
    fromSnapshot(options.snapshot, width, height) ??
    initialState(Math.floor(Math.random() * 4294967296), width, height);
  const fx = createEffects(state);
  const audio = createAudio();
  audio.setEnabled(!state.muted);

  const held = new Set<string>();
  let jumpPressed = false;
  let pointerActive = false;
  let pointerDir = 0;
  let pointerJump = false;
  let swipeStartY = 0;
  let swipeUsed = false;
  let hoverButton = false;
  let pressButton = false;

  let frame: number | null = null;
  let last: number | null = null;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let accumulator = 0;
  let reportedScore = state.score;

  const draw = () => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    render(context, state, {
      width,
      height,
      font,
      palette,
      fx,
      ui: { hoverButton, pressButton },
      touchHint,
    });
  };

  const readInput = () => {
    let left = pointerDir < 0;
    let right = pointerDir > 0;
    for (const key of held) {
      if (LEFT_KEYS.has(key)) left = true;
      if (RIGHT_KEYS.has(key)) right = true;
    }
    let jumpHeld = pointerJump;
    if (!jumpHeld) for (const key of held) if (JUMP_KEYS.has(key)) jumpHeld = true;
    return { left, right, jumpHeld, jumpPressed };
  };

  const toggleMute = () => {
    state = setMuted(state, !state.muted);
    audio.unlock();
    audio.setEnabled(!state.muted);
    if (frame === null) draw();
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const elapsed = last === null ? 0 : Math.min(MAX_FRAME_MS, now - last);
    last = now;
    if (fx.hitStop > 0) {
      fx.hitStop -= elapsed / 1000;
    } else {
      accumulator += elapsed;
      while (accumulator >= STEP_MS) {
        state = step(state, STEP_MS, readInput());
        jumpPressed = false;
        accumulator -= STEP_MS;
        if (state.events.length === 0) continue;
        applyEvents(fx, state, state.events, motion);
        for (const event of state.events) {
          if (event.kind === "land" && event.value < 9) continue;
          audio.play(event.kind);
        }
        if (fx.hitStop > 0) {
          accumulator = 0;
          break;
        }
      }
    }
    updateEffects(fx, state, elapsed / 1000);
    if (state.score !== reportedScore) {
      reportedScore = state.score;
      options.onScore?.(state.score);
    }
    const idle =
      (state.phase === "title" || state.phase === "over") &&
      state.phaseTime > 0.6 &&
      fx.hitStop <= 0 &&
      fx.shake === 0 &&
      fx.flash === 0 &&
      fx.squash === 0 &&
      !fx.particles.some((particle) => particle.active);
    if (!idle || now - lastDraw >= IDLE_FRAME_MS) {
      lastDraw = now;
      draw();
    }
  };

  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    last = null;
    accumulator = 0;
  };

  options.onScore?.(state.score);
  draw();

  return {
    start() {
      if (frame !== null) return;
      audio.resume();
      frame = requestAnimationFrame(tick);
    },
    pause() {
      stop();
      audio.suspend();
      held.clear();
      pointerActive = false;
      pointerDir = 0;
      pointerJump = false;
    },
    snapshot: () => toSnapshot(state),
    resize(nextWidth, nextHeight, pixelRatio) {
      width = nextWidth;
      height = nextHeight;
      ratio = pixelRatio;
      state = resizeState(state, width, height);
      draw();
    },
    setTheme(theme: MiniGameTheme) {
      palette = buildPalette(theme, resolve);
      font = readFont();
      draw();
    },
    keyDown(key) {
      const isJump = JUMP_KEYS.has(key);
      if (MUTE_KEYS.has(key)) {
        if (!held.has(key)) toggleMute();
        held.add(key);
        return true;
      }
      if (!isJump && !LEFT_KEYS.has(key) && !RIGHT_KEYS.has(key)) return false;
      audio.unlock();
      if (isJump && !held.has(key)) jumpPressed = true;
      held.add(key);
      return true;
    },
    keyUp(key) {
      held.delete(key);
    },
    pointerDown(x, y) {
      audio.unlock();
      const ui = layout(width, height);
      if (state.phase !== "title" && inside(ui.mute, x, y)) {
        toggleMute();
        return;
      }
      if (state.phase !== "playing") {
        pressButton = state.phase === "over" && inside(ui.playAgain, x, y);
        jumpPressed = true;
        return;
      }
      touchHint = true;
      pointerActive = true;
      if (inside(ui.jumpZone, x, y)) {
        pointerJump = true;
        jumpPressed = true;
        return;
      }
      pointerDir = x < width / 2 ? -1 : 1;
      swipeStartY = y;
      swipeUsed = false;
    },
    pointerMove(x, y) {
      const over = state.phase === "over" && inside(layout(width, height).playAgain, x, y);
      if (over !== hoverButton) {
        hoverButton = over;
        if (frame === null) draw();
      }
      if (!pointerActive || pointerDir === 0) return;
      pointerDir = x < width / 2 ? -1 : 1;
      if (!swipeUsed && swipeStartY - y > SWIPE_PX) {
        swipeUsed = true;
        pointerJump = true;
        jumpPressed = true;
      }
    },
    pointerUp() {
      pointerActive = false;
      pointerDir = 0;
      pointerJump = false;
      pressButton = false;
    },
    destroy() {
      stop();
      audio.dispose();
    },
  };
}

export const platformerGame: MiniGame = {
  id: "platformer",
  title: "Skyline Hop",
  controls: "←/→ or A/D to move · Space or ↑ to jump · M for sound",
  create,
};
