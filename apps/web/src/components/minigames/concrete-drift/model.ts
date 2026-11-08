/**
 * Shared state contract for Concrete Drift: logic.ts owns every value here, render.ts and fx.ts
 * only read it. World units: y grows downward like canvas; the view is VIEW_H units tall and the
 * renderer scales that to the canvas height. Everything is plain JSON so the state can be snapshotted.
 */

export const VIEW_H = 200;
/** Where the rider sits horizontally, as a fraction of the view width. */
export const RIDER_SCREEN_X = 0.3;
/** World generation keeps this far ahead of the rider and culls this far behind. */
export const GEN_AHEAD = 2200;
export const CULL_BEHIND = 700;
/** Street ground sits around y = 0, rooftops around ROOF_Y, sewers around SEWER_Y. */
export const ROOF_Y = -240;
export const SEWER_Y = 170;
/** Sewer tunnels have a ceiling this far above the ground line. */
export const SEWER_CEILING = 125;
export const RIDER_H = 22;
export const MAX_HP = 3;

export type Zone = "street" | "roof" | "sewer";

/**
 * A straight piece of the ground line from (x0, y0) to (x1, y1). Segments are contiguous in x and
 * sorted. A gap segment has no ground (a drop between buildings, a sewer water channel); its y
 * values are the edge heights either side, for drawing.
 */
export interface Segment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly zone: Zone;
  readonly gap: boolean;
}

/** A one-way surface the rider can land on and ride: grind rails, taxi roofs, sewer pipes, ledges. */
export type RailKind = "rail" | "car" | "pipe" | "ledge";
export interface Rail {
  readonly id: number;
  readonly kind: RailKind;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Things on the ground in the rider's way. `taxi` and `barrier` crash the rider on contact from the
 * side (a taxi always has a `car` rail on its roof); `cone`, `trash` and `hydrant` get knocked
 * flying (`hit` becomes true) with a small speed loss. `x` is the left edge, `y` the ground line.
 */
export type ObstacleKind = "taxi" | "barrier" | "cone" | "trash" | "hydrant";
export interface Obstacle {
  readonly id: number;
  readonly kind: ObstacleKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly hit: boolean;
  /** Stable per-object randomness for the renderer (taxi number, dent, trash bag shape). */
  readonly seed: number;
}

/** Non-interactive scenery placed by the generator. `x` is the centre, `y` the ground line. */
export type DecorKind =
  | "lamp"
  | "trafficLight"
  | "steam"
  | "subwaySign"
  | "fireEscape"
  | "waterTower"
  | "acUnit"
  | "antenna"
  | "billboard"
  | "sewerLamp"
  | "drip"
  | "grate"
  | "graffiti";
export interface Decor {
  readonly id: number;
  readonly kind: DecorKind;
  readonly x: number;
  readonly y: number;
  readonly seed: number;
}

/**
 * thug: carries a knife, sprints at the rider and stabs at close range.
 * gunman: stands still, aims (`state: "aim"` for a visible telegraph), then fires at the rider.
 * rat: small, scurries along sewer ground; contact hurts.
 */
export type EnemyKind = "thug" | "gunman" | "rat";
export type EnemyState = "idle" | "charge" | "aim" | "attack" | "dead";
export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly x: number;
  /** Feet position: on the ground line or a rail/roof surface. */
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** -1 faces left (toward an approaching rider), 1 faces right. */
  readonly facing: -1 | 1;
  readonly hp: number;
  readonly state: EnemyState;
  /** Milliseconds spent in the current state; drives aim telegraphs and animation. */
  readonly stateAge: number;
  /** Aim angle in radians while aiming or attacking (gunman), 0 otherwise. */
  readonly aim: number;
  readonly seed: number;
}

export interface Bullet {
  readonly id: number;
  readonly from: "player" | "enemy";
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Milliseconds left before it disappears. */
  readonly life: number;
}

/** `token` is a subway token worth points; `ammo` refills the pistol. `y` is its centre. */
export type PickupKind = "token" | "ammo";
export interface Pickup {
  readonly id: number;
  readonly kind: PickupKind;
  readonly x: number;
  readonly y: number;
  readonly taken: boolean;
}

export interface Rider {
  /** Position of the board's contact point (between the wheels). */
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Board angle in radians; 0 is level, positive rotates clockwise (nose down). */
  readonly angle: number;
  /** Angular velocity in radians per second while airborne. */
  readonly spin: number;
  readonly grounded: boolean;
  /** The rail being ridden, or null on the ground line or in the air. */
  readonly railId: number | null;
  readonly hp: number;
  /** Milliseconds of invulnerability left after a hit. */
  readonly invuln: number;
  /** Milliseconds since the last knife swing started; the swing anim plays for the first ~220ms. */
  readonly slashAge: number;
  /** Milliseconds since the last shot; the muzzle flash plays for the first ~80ms. */
  readonly shotAge: number;
  /** Aim angle of the last shot, radians, for the arm pose. */
  readonly shotAim: number;
  readonly airTime: number;
  /** Full rotations completed in the current jump. */
  readonly flips: number;
  /** True while the jump button is held during a jump (crouch/tuck pose). */
  readonly tucked: boolean;
}

export type GameEventKind =
  | "start"
  | "jump"
  | "land"
  | "trick"
  | "grindStart"
  | "shoot"
  | "empty"
  | "slash"
  | "hitEnemy"
  | "kill"
  | "enemyShot"
  | "hurt"
  | "knock"
  | "pickup"
  | "zone"
  | "crash"
  | "over";

/**
 * Emitted during a step and cleared at the start of the next one. Positions are world units.
 * `dx`/`dy` give a direction for sprays (bullet travel for blood, board direction for sparks).
 */
export interface GameEvent {
  readonly kind: GameEventKind;
  readonly x: number;
  readonly y: number;
  readonly dx?: number;
  readonly dy?: number;
  /** trick: flips landed; pickup/kill: points scored; land: impact speed. */
  readonly value?: number;
  readonly zone?: Zone;
  readonly enemyKind?: EnemyKind;
  readonly pickupKind?: PickupKind;
  readonly obstacleKind?: ObstacleKind;
  /** crash: why the run ended, shown on the game-over card. */
  readonly reason?: "landing" | "obstacle" | "fall" | "shot" | "stabbed" | "bitten";
}

export type Status = "ready" | "running" | "over";

export interface GameState {
  readonly version: 1;
  readonly seed: number;
  readonly rng: number;
  readonly status: Status;
  readonly statusAge: number;
  /** Milliseconds of running time this run. */
  readonly time: number;
  readonly score: number;
  readonly best: number;
  /** Multiplier from chained tricks and kills; resets on a hit or a sloppy landing. */
  readonly combo: number;
  readonly comboAge: number;
  readonly ammo: number;
  readonly kills: number;
  readonly muted: boolean;
  /** How the last run ended, for the game-over card. */
  readonly deathReason: GameEvent["reason"] | null;
  readonly rider: Rider;
  readonly segments: ReadonlyArray<Segment>;
  readonly rails: ReadonlyArray<Rail>;
  readonly obstacles: ReadonlyArray<Obstacle>;
  readonly decor: ReadonlyArray<Decor>;
  readonly enemies: ReadonlyArray<Enemy>;
  readonly bullets: ReadonlyArray<Bullet>;
  readonly pickups: ReadonlyArray<Pickup>;
  /** World x up to which the generator has produced content. */
  readonly genX: number;
  readonly genZone: Zone;
  readonly nextId: number;
  readonly events: ReadonlyArray<GameEvent>;
}

/**
 * Input for one fixed step. `jumpHeld` is level-triggered; the `*Pressed` flags are edges the
 * shell latches between steps.
 */
export interface StepInput {
  readonly start?: boolean;
  readonly jumpPressed?: boolean;
  readonly jumpHeld?: boolean;
  readonly shoot?: boolean;
  readonly slash?: boolean;
}

/** Ground line height at world x, or null over a gap or outside generated segments. */
export type GroundAt = (state: GameState, x: number) => { y: number; zone: Zone } | null;
