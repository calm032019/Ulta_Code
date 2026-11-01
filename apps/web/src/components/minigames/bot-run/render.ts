import type { MiniGameTheme } from "../types";
import {
  GROUND_OFFSET,
  ROBOT_DUCK_HEIGHT,
  ROBOT_DUCK_WIDTH,
  ROBOT_HEIGHT,
  ROBOT_WIDTH,
  ROBOT_X,
  viewport,
  type Obstacle,
  type RunState,
} from "./logic";

interface Size {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const TEXT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const DOT_SPACING = 26;

function hash(value: number): number {
  let t = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  t ^= t >>> 13;
  t = Math.imul(t, 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function drawGround(
  context: CanvasRenderingContext2D,
  state: RunState,
  theme: MiniGameTheme,
  groundY: number,
): void {
  context.strokeStyle = theme.muted;
  context.globalAlpha = 0.55;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, groundY + 0.5);
  context.lineTo(state.viewWidth, groundY + 0.5);
  context.stroke();

  context.fillStyle = theme.muted;
  context.globalAlpha = 0.4;
  const first = Math.floor(state.distance / DOT_SPACING);
  const last = first + Math.ceil(state.viewWidth / DOT_SPACING) + 1;
  for (let tile = first; tile <= last; tile += 1) {
    const x = tile * DOT_SPACING + hash(tile) * DOT_SPACING - state.distance;
    const y = groundY + 4 + Math.floor(hash(tile + 7919) * 4) * 3;
    const length = 1 + Math.floor(hash(tile + 104729) * 3);
    context.fillRect(x, y, length, 1);
  }
  context.globalAlpha = 1;
}

function drawCrate(
  context: CanvasRenderingContext2D,
  theme: MiniGameTheme,
  x: number,
  top: number,
  size: number,
): void {
  roundedRect(context, x + 0.5, top + 0.5, size - 1, size - 1, 2);
  context.fillStyle = theme.secondary;
  context.fill();
  context.strokeStyle = theme.muted;
  context.lineWidth = 1;
  context.stroke();
  context.beginPath();
  context.moveTo(x + 3, top + 3);
  context.lineTo(x + size - 3, top + size - 3);
  context.moveTo(x + size - 3, top + 3);
  context.lineTo(x + 3, top + size - 3);
  context.globalAlpha = 0.45;
  context.stroke();
  context.globalAlpha = 1;
}

function drawSpool(
  context: CanvasRenderingContext2D,
  theme: MiniGameTheme,
  obstacle: Obstacle,
  groundY: number,
): void {
  const radius = obstacle.w / 2;
  const cx = obstacle.x + radius;
  const cy = groundY - radius;
  context.beginPath();
  context.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
  context.fillStyle = theme.secondary;
  context.fill();
  context.strokeStyle = theme.muted;
  context.lineWidth = 1;
  context.stroke();
  context.globalAlpha = 0.5;
  for (const ring of [radius - 4, radius - 7]) {
    context.beginPath();
    context.arc(cx, cy, ring, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(cx, cy, 2.5, 0, Math.PI * 2);
  context.fillStyle = theme.muted;
  context.fill();
}

function drawBug(
  context: CanvasRenderingContext2D,
  theme: MiniGameTheme,
  obstacle: Obstacle,
  groundY: number,
  distance: number,
): void {
  const cx = obstacle.x + obstacle.w / 2;
  const cy = groundY - obstacle.y - obstacle.h / 2;
  const wingUp = Math.floor(distance / 12) % 2 === 0;

  context.globalAlpha = 0.35;
  context.fillStyle = theme.danger;
  context.beginPath();
  context.ellipse(
    cx + 1,
    cy - (wingUp ? 6 : 3),
    5,
    wingUp ? 3 : 2,
    wingUp ? -0.5 : -0.2,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.globalAlpha = 1;

  context.beginPath();
  context.ellipse(cx + 1, cy, 7, 5, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(cx - 6, cy - 0.5, 3, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = theme.danger;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(cx - 8, cy - 2.5);
  context.lineTo(cx - 11, cy - 6);
  context.moveTo(cx - 7, cy - 3);
  context.lineTo(cx - 8, cy - 7);
  context.stroke();

  context.fillStyle = theme.surface;
  context.beginPath();
  context.arc(cx - 7, cy - 1, 0.9, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 0.5;
  context.fillRect(cx + 1, cy - 4.5, 0.8, 9);
  context.globalAlpha = 1;
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  theme: MiniGameTheme,
  obstacle: Obstacle,
  groundY: number,
  distance: number,
): void {
  const top = groundY - obstacle.y - obstacle.h;
  switch (obstacle.kind) {
    case "crate":
    case "crates-wide":
    case "crates-tall":
      for (let column = 0; column < obstacle.w; column += 16) {
        for (let row = 0; row < obstacle.h; row += 16) {
          drawCrate(context, theme, obstacle.x + column, top + row, 16);
        }
      }
      return;
    case "crates-stack":
      drawCrate(context, theme, obstacle.x, top + 16, 16);
      drawCrate(context, theme, obstacle.x + 16, top + 16, 16);
      drawCrate(context, theme, obstacle.x + 8, top, 16);
      return;
    case "spool":
      drawSpool(context, theme, obstacle, groundY);
      return;
    case "bug-low":
    case "bug-high":
      drawBug(context, theme, obstacle, groundY, distance);
  }
}

function drawEye(
  context: CanvasRenderingContext2D,
  theme: MiniGameTheme,
  x: number,
  y: number,
  dead: boolean,
): void {
  context.strokeStyle = theme.foreground;
  context.fillStyle = theme.foreground;
  if (dead) {
    context.lineWidth = 1.3;
    context.beginPath();
    context.moveTo(x - 2, y - 2);
    context.lineTo(x + 2, y + 2);
    context.moveTo(x + 2, y - 2);
    context.lineTo(x - 2, y + 2);
    context.stroke();
    return;
  }
  context.beginPath();
  context.arc(x, y, 2.4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = theme.surface;
  context.beginPath();
  context.arc(x + 0.8, y - 0.8, 0.8, 0, Math.PI * 2);
  context.fill();
}

function drawRobot(
  context: CanvasRenderingContext2D,
  state: RunState,
  theme: MiniGameTheme,
  groundY: number,
): void {
  const dead = state.phase === "over";
  const base = groundY - state.robotY;
  const x = ROBOT_X;
  const running = state.phase === "running" && state.grounded;
  const frame = running ? Math.floor(state.distance / 16) % 2 : 0;

  if (state.ducking) {
    const w = ROBOT_DUCK_WIDTH;
    const h = ROBOT_DUCK_HEIGHT;
    context.fillStyle = theme.foreground;
    context.fillRect(x + 6, base - 3 + (frame === 0 ? 0 : -1), 4, 3);
    context.fillRect(x + 18, base - 3 + (frame === 1 ? 0 : -1), 4, 3);

    context.strokeStyle = theme.foreground;
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(x + 6, base - h + 3);
    context.quadraticCurveTo(x + 1, base - h - 1, x - 3, base - h + 1);
    context.stroke();
    context.fillStyle = theme.accent;
    context.beginPath();
    context.arc(x - 3, base - h + 1, 2, 0, Math.PI * 2);
    context.fill();

    roundedRect(context, x + 0.7, base - h + 0.7, w - 1.4, h - 3.4, 5);
    context.fillStyle = theme.surface;
    context.fill();
    context.stroke();
    context.fillStyle = theme.accent;
    roundedRect(context, x + 5, base - 6, 8, 2, 1);
    context.fill();
    drawEye(context, theme, x + 17, base - h + 6, dead);
    drawEye(context, theme, x + 23, base - h + 6, dead);
    return;
  }

  const w = ROBOT_WIDTH;
  const bodyTop = base - ROBOT_HEIGHT + 5;
  const bodyBottom = base - 4.5;
  context.fillStyle = theme.foreground;
  if (state.grounded || state.phase !== "running") {
    context.fillRect(x + 5, base - 5, 4, 5 - (frame === 1 ? 2 : 0));
    context.fillRect(x + 13, base - 5, 4, 5 - (frame === 0 && running ? 2 : 0));
  } else {
    context.fillRect(x + 4, base - 6, 4, 3);
    context.fillRect(x + 14, base - 6, 4, 3);
  }

  context.strokeStyle = theme.foreground;
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(x + w / 2, bodyTop);
  context.lineTo(x + w / 2, bodyTop - 4);
  context.stroke();
  context.fillStyle = theme.accent;
  context.beginPath();
  context.arc(x + w / 2, bodyTop - 5, 2.2, 0, Math.PI * 2);
  context.fill();

  roundedRect(context, x + 0.7, bodyTop, w - 1.4, bodyBottom - bodyTop, 7);
  context.fillStyle = theme.surface;
  context.fill();
  context.stroke();

  context.fillStyle = theme.accent;
  roundedRect(context, x + 6, bodyBottom - 5, 7, 2.2, 1.1);
  context.fill();
  context.globalAlpha = 0.5;
  context.beginPath();
  context.arc(x + 16, bodyBottom - 3.9, 1.1, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  drawEye(context, theme, x + 9, bodyTop + 6.5, dead);
  drawEye(context, theme, x + 16, bodyTop + 6.5, dead);
}

function drawHud(
  context: CanvasRenderingContext2D,
  state: RunState,
  theme: MiniGameTheme,
  size: Size,
): void {
  const fontPx = Math.round(Math.min(13, Math.max(10, size.height / 15)));
  const pad = Math.round(fontPx * 0.9);
  const flashing = state.flashMs > 0 && Math.floor(state.flashMs / 120) % 2 === 1;
  context.font = `500 ${fontPx}px ${FONT_FAMILY}`;
  context.textBaseline = "top";
  context.textAlign = "right";
  context.fillStyle = theme.muted;
  const score = String(state.score).padStart(5, "0");
  const best = `HI ${String(Math.max(state.best, state.phase === "over" ? state.score : 0)).padStart(5, "0")}`;
  if (!flashing) context.fillText(score, size.width - pad, pad);
  const scoreWidth = context.measureText("00000").width;
  context.globalAlpha = 0.7;
  context.fillText(best, size.width - pad - scoreWidth - fontPx, pad);
  context.globalAlpha = 1;

  const message =
    state.phase === "ready"
      ? "Press Space or tap to start"
      : state.phase === "over"
        ? "Game over. Space or tap to restart"
        : null;
  if (!message) return;
  const messagePx = Math.round(Math.min(15, Math.max(12, size.height / 13)));
  context.font = `500 ${messagePx}px ${TEXT_FAMILY}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = theme.foreground;
  context.fillText(message, size.width / 2, Math.round(size.height * 0.38), size.width - 2 * pad);
}

export function render(
  context: CanvasRenderingContext2D,
  state: RunState,
  theme: MiniGameTheme,
  size: Size,
): void {
  context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  context.fillStyle = theme.surface;
  context.fillRect(0, 0, size.width, size.height);

  const view = viewport(size.width, size.height);
  context.save();
  context.scale(view.scale, view.scale);
  const groundY = view.height - GROUND_OFFSET;
  context.lineJoin = "round";
  context.lineCap = "round";
  drawGround(context, state, theme, groundY);
  for (const obstacle of state.obstacles) {
    if (obstacle.x < view.width && obstacle.x + obstacle.w > 0) {
      drawObstacle(context, theme, obstacle, groundY, state.distance);
    }
  }
  drawRobot(context, state, theme, groundY);
  context.restore();

  drawHud(context, state, theme, size);
}
