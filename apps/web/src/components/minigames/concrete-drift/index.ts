import type { MiniGame, MiniGameCreateOptions, MiniGameInstance } from "../types";
import { createAudio } from "./audio";
import { createFx, fxIdle, handleEvents, resetFx, updateFx } from "./fx";
import { fromSnapshot, initialState, scoreOf, step, toggleMute, toSnapshot } from "./logic";
import { VIEW_H, type GameState, type StepInput } from "./model";
import { createRenderer, inside, muteRect, restartButtonRect, type RenderUi } from "./render";

const STEP_MS = 1000 / 120;
const MAX_FRAME_MS = 100;
const IDLE_FRAME_MS = 1000 / 30;
const RESTART_DELAY_MS = 450;
/** A right-side tap slashes instead of shooting when an enemy is this close (world units). */
const TAP_SLASH_RANGE = 46;

const JUMP_KEYS = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);
const SHOOT_KEYS = new Set(["f", "F", "j", "J", "ArrowRight"]);
const SLASH_KEYS = new Set(["d", "D", "k", "K", "x", "X", "ArrowDown"]);
const MUTE_KEYS = new Set(["m", "M"]);

function readFont(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return value || "system-ui, sans-serif";
}

function prefers(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

function enemyClose(state: GameState): boolean {
  const { x, y } = state.rider;
  return state.enemies.some(
    (enemy) =>
      enemy.state !== "dead" &&
      Math.abs(enemy.x - x) < TAP_SLASH_RANGE &&
      Math.abs(enemy.y - y) < 40,
  );
}

function create(canvas: HTMLCanvasElement, options: MiniGameCreateOptions): MiniGameInstance {
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 180;
  let ratio = 1;
  let state: GameState =
    fromSnapshot(options.snapshot) ?? initialState(Math.floor(Math.random() * 4294967296));
  const fx = createFx();
  fx.reducedMotion = prefers("(prefers-reduced-motion: reduce)");
  resetFx(fx, state);
  const renderer = createRenderer();
  renderer.setTheme(options.theme);
  renderer.setFont(readFont());
  renderer.resize(width, height, ratio);
  const audio = createAudio();
  const ui: RenderUi = {
    hoverButton: false,
    hoverMute: false,
    pressButton: false,
    touch: prefers("(any-pointer: coarse)"),
  };

  const heldKeys = new Set<string>();
  let pointerJump: number | null = null;
  let pending: { start: boolean; jumpPressed: boolean; shoot: boolean; slash: boolean } = {
    start: false,
    jumpPressed: false,
    shoot: false,
    slash: false,
  };
  let frame: number | null = null;
  let lastTime: number | null = null;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let accumulator = 0;
  let reportedScore: number | null = null;

  const viewWidth = () => width / (height / VIEW_H);

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
    renderer.draw(context, state, fx, ui);
  };

  const jumpHeld = () => pointerJump !== null || [...heldKeys].some((key) => JUMP_KEYS.has(key));

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const elapsed = lastTime === null ? STEP_MS : Math.min(MAX_FRAME_MS, now - lastTime);
    lastTime = now;
    accumulator += elapsed;
    while (accumulator >= STEP_MS) {
      const before = state.status;
      const input: StepInput = { ...pending, jumpHeld: jumpHeld() };
      pending = { start: false, jumpPressed: false, shoot: false, slash: false };
      state = step(state, STEP_MS, input);
      accumulator -= STEP_MS;
      if (before === "over" && state.status !== "over") resetFx(fx, state);
      if (state.events.length > 0) {
        handleEvents(fx, state.events, state);
        audio.play(state.events, state.muted);
      }
    }
    updateFx(fx, elapsed, state, viewWidth());
    report();
    const idle = state.status !== "running" && state.statusAge > RESTART_DELAY_MS && fxIdle(fx);
    if (!idle || now - lastDraw >= IDLE_FRAME_MS) {
      lastDraw = now;
      draw();
    }
  };

  const canRestart = () => state.status === "over" && state.statusAge > RESTART_DELAY_MS;

  const flipMute = () => {
    state = toggleMute(state);
    if (state.muted) audio.suspend();
    else audio.unlock(false);
    draw();
  };

  const attack = (preferSlash: boolean) => {
    if (preferSlash) pending.slash = true;
    else pending.shoot = true;
  };

  report();

  const instance: MiniGameInstance = {
    start: () => {
      if (frame !== null) return;
      lastTime = null;
      accumulator = 0;
      audio.resume(state.muted);
      frame = requestAnimationFrame(tick);
    },
    pause: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      heldKeys.clear();
      pointerJump = null;
      ui.pressButton = false;
      audio.suspend();
    },
    snapshot: () => toSnapshot(state),
    resize: (nextWidth, nextHeight, pixelRatio) => {
      width = nextWidth;
      height = nextHeight;
      ratio = pixelRatio;
      renderer.resize(width, height, ratio);
      updateFx(fx, 0, state, viewWidth());
      draw();
    },
    setTheme: (theme) => {
      renderer.setTheme(theme);
      renderer.setFont(readFont());
      draw();
    },
    keyDown: (key) => {
      audio.unlock(state.muted);
      if (MUTE_KEYS.has(key)) {
        flipMute();
        return true;
      }
      if (JUMP_KEYS.has(key)) {
        if (!heldKeys.has(key)) {
          if (state.status === "running") pending.jumpPressed = true;
          else if (state.status === "ready" || canRestart()) pending.start = true;
        }
        heldKeys.add(key);
        return true;
      }
      if (SHOOT_KEYS.has(key)) {
        if (!heldKeys.has(key)) attack(false);
        heldKeys.add(key);
        return true;
      }
      if (SLASH_KEYS.has(key)) {
        if (!heldKeys.has(key)) attack(true);
        heldKeys.add(key);
        return true;
      }
      return false;
    },
    keyUp: (key) => {
      heldKeys.delete(key);
    },
    pointerDown: (x, y) => {
      audio.unlock(state.muted);
      if (inside(muteRect(width, height), x, y)) {
        flipMute();
        return;
      }
      if (state.status === "ready") {
        pending.start = true;
        return;
      }
      if (state.status === "over") {
        ui.pressButton = inside(restartButtonRect(width, height), x, y);
        return;
      }
      if (x < width / 2) {
        pointerJump = 1;
        pending.jumpPressed = true;
      } else {
        attack(enemyClose(state));
      }
    },
    pointerMove: (x, y) => {
      ui.hoverMute = inside(muteRect(width, height), x, y);
      ui.hoverButton = state.status === "over" && inside(restartButtonRect(width, height), x, y);
    },
    pointerUp: (x, y) => {
      pointerJump = null;
      if (ui.pressButton && inside(restartButtonRect(width, height), x, y) && canRestart()) {
        pending.start = true;
      }
      ui.pressButton = false;
    },
    destroy: () => {
      instance.pause();
      audio.close();
    },
  };
  draw();
  return instance;
}

export const concreteDriftGame: MiniGame = {
  id: "concrete-drift",
  title: "Concrete Drift",
  controls: "Space jump, hold to flip · F shoot · D knife · tap left jump, right attack · M sound",
  create,
};
