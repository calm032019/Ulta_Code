import { LANES } from "./logic";

export const LANE_WIDTH = 2.4;
export const KERB = 0.5;
/** Half the track width including the kerbs, in metres. */
export const ROAD_HALF = (LANE_WIDTH * LANES) / 2 + KERB;
const CAMERA_HEIGHT = 3;
/** How far behind the crowd the camera rides. */
export const CAMERA_BACK = 8.5;
export const NEAR = 1.2;

/**
 * A shift-lens chase camera: it looks level down the track with the horizon raised, so the road
 * converges to a vanishing point at (cx, horizon). Lateral and vertical focal lengths differ so
 * three lanes fill a short, wide strip without the track collapsing into a thin wedge.
 */
export interface Lens {
  width: number;
  height: number;
  cx: number;
  horizon: number;
  /** Screen y of the road under the crowd. */
  ground: number;
  fx: number;
  fy: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Pixels per metre for upright, uniformly scaled sprites at this depth. */
  s: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createLens(width: number, height: number, hud: number): Lens {
  const horizon = Math.round(Math.max(hud + 6, height * 0.25));
  const ground = height - Math.max(12, height * 0.11);
  const drop = Math.max(8, ground - horizon);
  const roadHalfPx = Math.min(width * 0.36, drop * 2.6);
  return {
    width,
    height,
    cx: width / 2,
    horizon,
    ground,
    fx: (roadHalfPx * CAMERA_BACK) / ROAD_HALF,
    fy: (drop * CAMERA_BACK) / CAMERA_HEIGHT,
  };
}

export const laneX = (lane: number) => (lane - (LANES - 1) / 2) * LANE_WIDTH;

/** Depth ahead of the camera for something at `z` along the run. */
export const depthOf = (z: number, distance: number) => z - distance + CAMERA_BACK;

/**
 * Projects a point `x` metres right of the camera, `y` metres up and `dz` metres ahead into
 * `out`. Returns false, leaving `out` untouched, for points behind the near plane.
 */
export function project(lens: Lens, x: number, y: number, dz: number, out: Projected): boolean {
  if (!(dz >= NEAR)) return false;
  const inv = 1 / dz;
  out.x = lens.cx + x * lens.fx * inv;
  out.y = lens.horizon + (CAMERA_HEIGHT - y) * lens.fy * inv;
  out.s = lens.fy * inv;
  return true;
}

/** 1 when clear, falling to 0 as the haze swallows distant things. */
export function fogFade(dz: number, start = 34, end = 72): number {
  const t = clamp((dz - start) / (end - start), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}
