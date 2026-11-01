import { CAMERA_BACK, createLens, LANE_WIDTH, type Lens } from "./camera";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  /** Height of the band at the top the HUD sits in. */
  hud: number;
  pill: number;
  lens: Lens;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function computeLayout(width: number, height: number): Layout {
  const hud = Math.round(clamp(height * 0.17, 22, 44));
  return {
    width,
    height,
    hud,
    pill: Math.round(clamp(hud - 8, 16, 26)),
    lens: createLens(width, height, hud),
  };
}

/** Taps in the outer thirds step one lane that way; the middle third does nothing. */
export function tapDelta(layout: Layout, x: number): number {
  if (x < layout.width / 3) return -1;
  if (x > (layout.width * 2) / 3) return 1;
  return 0;
}

/** Horizontal drag distance that moves the crowd one lane: a lane's width under the crowd. */
export function dragStep(layout: Layout): number {
  return Math.max(24, (LANE_WIDTH * layout.lens.fx) / CAMERA_BACK);
}

export function muteRect(layout: Layout): Rect {
  const size = layout.pill;
  const pad = Math.max(6, layout.width * 0.012);
  return { x: layout.width - pad - size, y: (layout.hud - size) / 2, w: size, h: size };
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
