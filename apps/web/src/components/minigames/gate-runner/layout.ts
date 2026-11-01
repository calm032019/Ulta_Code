import { LANES } from "./logic";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  /** Height of the scenery band the HUD sits on. */
  sky: number;
  top: number;
  bottom: number;
  roadH: number;
  laneH: number;
  pxPerM: number;
  crowdX: number;
  pill: number;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function computeLayout(width: number, height: number): Layout {
  const sky = Math.round(clamp(height * 0.17, 22, 44));
  const bottom = height - 3;
  const roadH = bottom - sky;
  return {
    width,
    height,
    sky,
    top: sky,
    bottom,
    roadH,
    laneH: roadH / LANES,
    pxPerM: clamp(width / 34, 9, 24),
    crowdX: Math.round(width * 0.24),
    pill: Math.round(clamp(sky - 8, 16, 26)),
  };
}

export const laneCenter = (layout: Layout, lane: number) =>
  layout.top + (lane + 0.5) * layout.laneH;

/** Nearer lanes (lower on screen) draw slightly larger for a sense of depth. */
export const depthAt = (lane: number) => 0.88 + 0.12 * lane;

export const worldToScreen = (layout: Layout, x: number, distance: number) =>
  layout.crowdX + (x - distance) * layout.pxPerM;

export function laneAt(layout: Layout, y: number): number {
  return clamp(Math.floor((y - layout.top) / layout.laneH), 0, LANES - 1);
}

export function muteRect(layout: Layout): Rect {
  const size = layout.pill;
  const pad = Math.max(6, layout.width * 0.012);
  return { x: layout.width - pad - size, y: (layout.sky - size) / 2, w: size, h: size };
}

export interface OverCard {
  card: Rect;
  button: Rect;
  wide: boolean;
}

export function overCard(layout: Layout): OverCard {
  const wide = layout.width >= 480;
  const w = Math.min(layout.width - 16, wide ? 520 : 340);
  const h = Math.min(layout.height - 12, wide ? 132 : 170);
  const card = { x: (layout.width - w) / 2, y: (layout.height - h) / 2, w, h };
  const bh = clamp(h * 0.24, 24, 34);
  const bw = clamp(w * 0.3, 104, 150);
  const button = wide
    ? { x: card.x + w - bw - 16, y: card.y + h - bh - 14, w: bw, h: bh }
    : { x: card.x + (w - bw) / 2, y: card.y + h - bh - 8, w: bw, h: bh };
  return { card, button, wide };
}

export const inside = (rect: Rect, x: number, y: number) =>
  x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
