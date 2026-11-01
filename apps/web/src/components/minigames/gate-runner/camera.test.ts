import { describe, expect, it } from "vite-plus/test";

import {
  CAMERA_BACK,
  createLens,
  fogFade,
  laneX,
  NEAR,
  project,
  ROAD_HALF,
  type Projected,
} from "./camera";

const point = (): Projected => ({ x: 0, y: 0, s: 0 });

describe("chase camera", () => {
  it.each([
    [640, 180, 31],
    [320, 140, 24],
    [1100, 260, 44],
  ])("at %dx%d puts the horizon high and the crowd near the bottom", (width, height, hud) => {
    const lens = createLens(width, height, hud);
    expect(lens.horizon).toBeGreaterThan(hud);
    expect(lens.horizon / height).toBeGreaterThanOrEqual(0.2);
    expect(lens.horizon / height).toBeLessThanOrEqual(0.3);
    const crowd = point();
    expect(project(lens, 0, 0, CAMERA_BACK, crowd)).toBe(true);
    expect(crowd.y).toBeCloseTo(lens.ground);
    expect(crowd.y).toBeLessThan(height);
    const left = point();
    const right = point();
    project(lens, -ROAD_HALF, 0, CAMERA_BACK, left);
    project(lens, ROAD_HALF, 0, CAMERA_BACK, right);
    expect(right.x - left.x).toBeGreaterThan(width * 0.4);
    expect(right.x - left.x).toBeLessThan(width);
  });

  it("projects further things higher and smaller", () => {
    const lens = createLens(640, 180, 31);
    const near = point();
    const far = point();
    project(lens, laneX(2), 0, 10, near);
    project(lens, laneX(2), 0, 40, far);
    expect(far.y).toBeLessThan(near.y);
    expect(far.y).toBeGreaterThan(lens.horizon);
    expect(far.s).toBeLessThan(near.s);
    expect(Math.abs(far.x - lens.cx)).toBeLessThan(Math.abs(near.x - lens.cx));
  });

  it("centres the middle lane and mirrors the outer lanes", () => {
    const lens = createLens(640, 180, 31);
    const centre = point();
    const left = point();
    const right = point();
    for (const dz of [3, CAMERA_BACK, 25, 60]) {
      project(lens, laneX(1), 0.5, dz, centre);
      project(lens, laneX(0), 0.5, dz, left);
      project(lens, laneX(2), 0.5, dz, right);
      expect(centre.x).toBeCloseTo(320);
      expect(left.x + right.x).toBeCloseTo(640);
      expect(left.y).toBeCloseTo(right.y);
    }
  });

  it("culls points behind the near plane", () => {
    const lens = createLens(640, 180, 31);
    const out = point();
    expect(project(lens, 0, 0, NEAR * 0.5, out)).toBe(false);
    expect(project(lens, 0, 0, -4, out)).toBe(false);
    expect(project(lens, 0, 0, Number.NaN, out)).toBe(false);
    expect(out).toEqual(point());
  });

  it("fades distant things into the haze", () => {
    expect(fogFade(10)).toBe(1);
    expect(fogFade(50)).toBeGreaterThan(0);
    expect(fogFade(50)).toBeLessThan(1);
    expect(fogFade(200)).toBe(0);
  });
});
