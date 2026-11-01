import type { MiniGame, MiniGameCreateOptions, MiniGameInstance, MiniGameTheme } from "../types";
import { createAudio } from "./audio";
import { parseColor, type Rgba } from "./color";
import { createFx, handleEvents, resetFx, updateFx } from "./fx";
import { computeLayout, dragStep, inside, muteRect, overCard, tapDelta } from "./layout";
import {
  fromSnapshot,
  initialState,
  LANES,
  scoreOf,
  step,
  toggleMute,
  toSnapshot,
  type StepInput,
} from "./logic";
import { createRenderer, type RenderUi } from "./render";

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 250;
const BUTTON_DELAY_MS = 450;

const LEFT_KEYS = new Set(["ArrowLeft", "a", "A"]);
const RIGHT_KEYS = new Set(["ArrowRight", "d", "D"]);
const START_KEYS = new Set([" ", "Spacebar"]);
const MUTE_KEYS = new Set(["m", "M"]);

function createProbe(): (css: string) => Rgba {
  const memo = new Map<string, Rgba>();
  let probe: CanvasRenderingContext2D | null = null;
  return (css) => {
    const known = memo.get(css) ?? parseColor(css);
    if (known) return known;
    probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    let result: Rgba = { r: 128, g: 128, b: 128, a: 1 };
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const [r = 128, g = 128, b = 128, a = 255] = probe.getImageData(0, 0, 1, 1).data;
      result = { r, g, b, a: a / 255 };
    }
    memo.set(css, result);
    return result;
  };
}

function readFont(): string {
  const value =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return value || "system-ui, sans-serif";
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function createGateRunner(canvas: HTMLCanvasElement, options: MiniGameCreateOptions) {
  let theme: MiniGameTheme = options.theme;
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 180;
  let ratio = 1;
  let layout = computeLayout(width, height);
  let state =
    fromSnapshot(options.snapshot) ?? initialState(Math.floor(Math.random() * 4294967296));
  const fx = createFx();
  fx.reducedMotion = prefersReducedMotion();
  resetFx(fx, state);
  const renderer = createRenderer();
  const resolve = createProbe();
  renderer.setTheme(theme, resolve);
  renderer.setFont(readFont());
  const audio = createAudio();
  const ui: RenderUi = { hoverButton: false, hoverMute: false, pressButton: false };
  let frame: number | null = null;
  let lastTime: number | null = null;
  let accumulator = 0;
  let pending: StepInput = {};
  let drag: { x: number; lane: number } | null = null;
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
    renderer.draw(context, state, fx, layout, ui);
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
      if (state.events.length > 0) {
        handleEvents(fx, state.events, state);
        audio.play(state.events, state.muted);
      }
    }
    updateFx(fx, elapsed, state);
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

  const flipMute = () => {
    state = toggleMute(state);
    audio.unlock(state.muted);
    draw();
  };

  const canRestart = () => state.status === "over" && state.statusAge > BUTTON_DELAY_MS;

  report();

  const instance: MiniGameInstance = {
    start: () => {
      if (frame !== null) return;
      lastTime = null;
      accumulator = 0;
      audio.resume();
      frame = requestAnimationFrame(tick);
    },
    pause: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      drag = null;
      ui.pressButton = false;
      audio.suspend();
    },
    snapshot: () => toSnapshot(state),
    resize: (nextWidth, nextHeight, pixelRatio) => {
      width = nextWidth;
      height = nextHeight;
      ratio = pixelRatio;
      layout = computeLayout(width, height);
      draw();
    },
    setTheme: (next) => {
      theme = next;
      renderer.setTheme(theme, resolve);
      renderer.setFont(readFont());
      draw();
    },
    keyDown: (key) => {
      audio.unlock(state.muted);
      if (MUTE_KEYS.has(key)) {
        flipMute();
        return true;
      }
      if (START_KEYS.has(key)) {
        if (state.status === "ready" || canRestart()) queue({ start: true });
        return true;
      }
      if (LEFT_KEYS.has(key)) {
        queue({ laneDelta: -1 });
        return true;
      }
      if (RIGHT_KEYS.has(key)) {
        queue({ laneDelta: 1 });
        return true;
      }
      return false;
    },
    keyUp: () => {},
    pointerDown: (x, y) => {
      audio.unlock(state.muted);
      if (inside(muteRect(layout), x, y)) {
        flipMute();
        return;
      }
      if (state.status === "ready") {
        queue({ start: true });
        return;
      }
      if (state.status === "over") {
        ui.pressButton = inside(overCard(layout).button, x, y);
        return;
      }
      const lane = Math.max(0, Math.min(LANES - 1, state.targetLane + tapDelta(layout, x)));
      drag = { x, lane };
      queue({ targetLane: lane });
    },
    pointerMove: (x, y) => {
      ui.hoverMute = inside(muteRect(layout), x, y);
      ui.hoverButton = state.status === "over" && inside(overCard(layout).button, x, y);
      if (drag) queue({ targetLane: drag.lane + Math.round((x - drag.x) / dragStep(layout)) });
    },
    pointerUp: (x, y) => {
      drag = null;
      if (ui.pressButton && inside(overCard(layout).button, x, y) && canRestart()) {
        queue({ start: true });
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

export const gateRunnerGame: MiniGame = {
  id: "gate-runner",
  title: "Gate Rush",
  controls: "←/→, A/D, tap or drag to steer · M for sound",
  create: createGateRunner,
};
