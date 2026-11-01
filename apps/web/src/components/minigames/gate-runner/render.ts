import type { MiniGameTheme } from "../types";
import { formatOp, isGoodOp, LANES, scoreOf, type GateRunnerState } from "./logic";

const FONT = "ui-sans-serif, system-ui, sans-serif";
const MAX_UNITS = 60;
const GOLDEN_ANGLE = 2.39996;

interface Layout {
  width: number;
  height: number;
  top: number;
  laneH: number;
  pxPerM: number;
  crowdX: number;
  distance: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function hudHeight(height: number): number {
  return Math.round(clamp(height * 0.12, 16, 26));
}

export function laneAt(y: number, height: number): number {
  const top = hudHeight(height);
  return clamp(Math.floor(((y - top) / (height - top)) * LANES), 0, LANES - 1);
}

function layoutFor(state: GateRunnerState, width: number, height: number): Layout {
  const top = hudHeight(height);
  return {
    width,
    height,
    top,
    laneH: (height - top) / LANES,
    pxPerM: clamp(width / 34, 9, 24),
    crowdX: width * 0.22,
    distance: state.distance,
  };
}

const screenX = (layout: Layout, x: number) =>
  layout.crowdX + (x - layout.distance) * layout.pxPerM;
const laneY = (layout: Layout, lane: number) => layout.top + (lane + 0.5) * layout.laneH;

function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  ink: string,
) {
  ctx.font = `700 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 0.9;
  const h = size * 1.45;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + size * 0.04);
}

function cluster(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  count: number,
  front: number,
  y: number,
  time: number,
  colour: string,
  facing: 1 | -1,
) {
  const units = Math.min(MAX_UNITS, count);
  const ry = layout.laneH * 0.34;
  const rx = ry * 1.7;
  const r = Math.max(1.5, layout.laneH * 0.055);
  const spread = Math.sqrt(units / MAX_UNITS);
  const cx = front - facing * rx * spread;
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let k = 0; k < units; k++) {
    const angle = k * GOLDEN_ANGLE;
    const reach = Math.sqrt((k + 0.5) / MAX_UNITS);
    const bob = Math.sin(time * 0.02 + k * 1.7) * r * 0.4;
    const ux = cx + Math.cos(angle) * reach * rx;
    const uy = y + Math.sin(angle) * reach * ry + bob;
    ctx.moveTo(ux + r, uy);
    ctx.arc(ux, uy, r, 0, Math.PI * 2);
  }
  ctx.fill();
  return { cx, top: y - ry * Math.max(spread, 0.2) - r };
}

function drawFloor(ctx: CanvasRenderingContext2D, layout: Layout, theme: MiniGameTheme) {
  const { width, height, top, laneH, pxPerM } = layout;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, top, width, height - top);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, top + 0.5);
  ctx.lineTo(width, top + 0.5);
  ctx.stroke();
  const dash = Math.max(8, pxPerM * 1.2);
  ctx.setLineDash([dash, dash]);
  ctx.lineDashOffset = (layout.distance * pxPerM) % (dash * 2);
  ctx.beginPath();
  for (let lane = 1; lane < LANES; lane++) {
    const y = Math.round(top + lane * laneH) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGates(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  theme: MiniGameTheme,
  state: GateRunnerState,
) {
  const gateW = Math.max(7, layout.pxPerM * 1.1);
  const size = Math.round(clamp(layout.laneH * 0.32, 10, 18));
  for (const entity of state.entities) {
    const sx = screenX(layout, entity.x);
    if (sx < -60 || sx > layout.width + 60) continue;
    ctx.globalAlpha = entity.done ? 0.35 : 1;
    if (entity.kind === "gates") {
      entity.ops.forEach((op, lane) => {
        if (!op) return;
        const good = isGoodOp(op);
        const colour = good ? theme.accent : theme.danger;
        const laneTop = layout.top + lane * layout.laneH;
        const inset = layout.laneH * 0.08;
        ctx.save();
        ctx.globalAlpha *= 0.16;
        ctx.fillStyle = colour;
        ctx.fillRect(sx - gateW / 2, laneTop + inset, gateW, layout.laneH - inset * 2);
        ctx.restore();
        ctx.fillStyle = colour;
        ctx.fillRect(sx - gateW / 2, laneTop + inset, gateW, 2);
        ctx.fillRect(sx - gateW / 2, laneTop + layout.laneH - inset - 2, gateW, 2);
        pill(
          ctx,
          formatOp(op),
          sx,
          laneTop + layout.laneH / 2,
          size,
          colour,
          good ? theme.accentForeground : theme.background,
        );
      });
    } else if (entity.kind === "blades") {
      entity.lanes.forEach((blocked, lane) => {
        if (!blocked) return;
        const cy = laneY(layout, lane);
        if (entity.style === "saw") {
          const radius = layout.laneH * 0.3;
          const spin = state.time * 0.012;
          ctx.strokeStyle = theme.danger;
          ctx.fillStyle = theme.danger;
          ctx.lineWidth = Math.max(1.5, radius * 0.16);
          ctx.beginPath();
          ctx.arc(sx, cy, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = spin + (k * Math.PI) / 3;
            ctx.moveTo(sx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
            ctx.lineTo(
              sx + Math.cos(a + 0.5) * radius * 1.3,
              cy + Math.sin(a + 0.5) * radius * 1.3,
            );
            ctx.lineTo(sx + Math.cos(a + 0.6) * radius, cy + Math.sin(a + 0.6) * radius);
          }
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(spin) * radius, cy + Math.sin(spin) * radius);
          ctx.lineTo(sx - Math.cos(spin) * radius, cy - Math.sin(spin) * radius);
          ctx.stroke();
        } else {
          const h = layout.laneH * 0.7;
          const w = Math.max(6, layout.pxPerM * 0.7);
          ctx.fillStyle = theme.danger;
          ctx.fillRect(sx - w / 2, cy - h / 2, w, h);
          ctx.fillStyle = theme.surface;
          for (let y = cy - h / 2 + h / 8; y < cy + h / 2; y += h / 4) {
            ctx.fillRect(sx - w / 2, y, w, h / 10);
          }
        }
      });
    } else if (entity.kind === "enemy") {
      if (entity.count <= 0) continue;
      const cy = laneY(layout, entity.lane);
      const head = cluster(ctx, layout, entity.count, sx, cy, state.time, theme.danger, -1);
      pill(
        ctx,
        String(entity.count),
        head.cx,
        Math.max(head.top - size * 0.8, layout.top + size * 0.75),
        size * 0.85,
        theme.danger,
        theme.background,
      );
    } else if (!entity.done) {
      const w = Math.max(10, layout.pxPerM * 1.5);
      const h = layout.height - layout.top;
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = theme.foreground;
      ctx.fillRect(sx - w / 2, layout.top, w, h);
      ctx.restore();
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const brick = layout.laneH / 3;
      for (let y = layout.top + brick; y < layout.height; y += brick) {
        ctx.moveTo(sx - w / 2, Math.round(y) + 0.5);
        ctx.lineTo(sx + w / 2, Math.round(y) + 0.5);
      }
      ctx.stroke();
      ctx.fillStyle = theme.foreground;
      ctx.fillRect(sx - w / 2, layout.top, 2, h);
      pill(
        ctx,
        String(entity.count),
        sx,
        layout.top + h / 2,
        size,
        theme.foreground,
        theme.background,
      );
    }
  }
  ctx.globalAlpha = 1;
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  theme: MiniGameTheme,
  state: GateRunnerState,
) {
  const size = Math.round(layout.top * 0.58);
  const y = layout.top / 2 + 0.5;
  const pad = Math.max(8, layout.width * 0.015);
  ctx.textBaseline = "middle";
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillStyle = theme.foreground;
  const score = `Score ${scoreOf(state)}`;
  ctx.fillText(score, pad, y);
  ctx.fillStyle = theme.muted;
  ctx.fillText(`Best ${state.best}`, pad + ctx.measureText(score).width + size, y);
  ctx.textAlign = "right";
  ctx.fillText(`Crowd ${state.count}`, layout.width - pad, y);
  const crowdW = ctx.measureText(`Crowd ${state.count}`).width;
  ctx.fillStyle = theme.foreground;
  ctx.fillText(`Stage ${state.stage}`, layout.width - pad - crowdW - size, y);
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  theme: MiniGameTheme,
  state: GateRunnerState,
) {
  if (state.status === "running") return;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, layout.top, layout.width, layout.height - layout.top);
  ctx.restore();
  const mid = layout.top + (layout.height - layout.top) / 2;
  const size = Math.round(clamp(layout.width / 40, 12, 16));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.foreground;
  ctx.font = `600 ${size}px ${FONT}`;
  if (state.status === "ready") {
    ctx.fillText("Press Space or tap to start", layout.width / 2, mid);
    return;
  }
  ctx.fillText("Game over. Space or tap to restart", layout.width / 2, mid - size * 0.7);
  ctx.fillStyle = theme.muted;
  ctx.font = `500 ${Math.round(size * 0.85)}px ${FONT}`;
  ctx.fillText(
    `Score ${scoreOf(state)} · Best ${state.best} · Stage ${state.stage}`,
    layout.width / 2,
    mid + size * 0.8,
  );
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GateRunnerState,
  theme: MiniGameTheme,
  width: number,
  height: number,
) {
  const layout = layoutFor(state, width, height);
  drawFloor(ctx, layout, theme);
  drawGates(ctx, layout, theme, state);

  const cy = layout.top + (state.lane + 0.5) * layout.laneH;
  const head = cluster(ctx, layout, state.count, layout.crowdX, cy, state.time, theme.accent, 1);
  const size = Math.round(clamp(layout.laneH * 0.28, 10, 15));
  pill(
    ctx,
    String(state.count),
    head.cx,
    Math.max(head.top - size * 0.8, layout.top + size * 0.75),
    size,
    theme.accent,
    theme.accentForeground,
  );

  for (const effect of state.effects) {
    const t = effect.age / 700;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.fillStyle = effect.tone === "good" ? theme.accent : theme.danger;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const y = laneY(layout, effect.lane) - layout.laneH * 0.2 - t * layout.laneH * 0.5;
    ctx.fillText(effect.label, layout.crowdX + size * 0.6, Math.max(layout.top + size, y));
  }
  ctx.globalAlpha = 1;

  drawHud(ctx, layout, theme, state);
  drawOverlay(ctx, layout, theme, state);
}
