/** Colours a game paints with, read from the app theme so games follow light and dark mode. */
export interface MiniGameTheme {
  readonly background: string;
  readonly surface: string;
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly secondary: string;
  readonly success: string;
  readonly danger: string;
}

export interface MiniGameCreateOptions {
  readonly theme: MiniGameTheme;
  /** A value previously returned by `snapshot()`; games start fresh when it is missing or unrecognised. */
  readonly snapshot?: unknown;
  /** Reports the score so the shell can show it beside the game title. */
  readonly onScore?: (score: number) => void;
}

/**
 * A running game bound to one canvas. The shell owns the canvas size, focus, and when the game
 * runs; a game draws only while started and never schedules frames while paused.
 */
export interface MiniGameInstance {
  /** Begins or resumes the frame loop. */
  start(): void;
  /** Stops the frame loop and leaves the last frame on screen. */
  pause(): void;
  /** JSON-serialisable state that `create` can resume from. */
  snapshot(): unknown;
  /** Canvas size in CSS pixels; the shell has already applied device pixel ratio to the backing store. */
  resize(width: number, height: number, pixelRatio: number): void;
  setTheme(theme: MiniGameTheme): void;
  /** Keyboard input while the canvas is focused; return true when the game used the key. */
  keyDown(key: string): boolean;
  keyUp(key: string): void;
  /** Pointer input in CSS pixels relative to the canvas. */
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(x: number, y: number): void;
  destroy(): void;
}

export const MINI_GAME_IDS = ["claude-run", "platformer", "gate-runner"] as const;

export type MiniGameId = (typeof MINI_GAME_IDS)[number];

export interface MiniGame {
  readonly id: MiniGameId;
  readonly title: string;
  /** One line shown in the picker, e.g. "Space or tap to jump". */
  readonly controls: string;
  create(canvas: HTMLCanvasElement, options: MiniGameCreateOptions): MiniGameInstance;
}
