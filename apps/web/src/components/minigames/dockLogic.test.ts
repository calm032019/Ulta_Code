import { describe, expect, it } from "vite-plus/test";

import { createMemoryStorage } from "~/lib/storage";
import {
  failSafeStorage,
  formatWorkDuration,
  sanitizePersistedDockState,
  shouldAutoPause,
  shouldRunLoop,
  themeFromVariables,
} from "./dockLogic";
import type { MiniGameId } from "./types";

const IDS: ReadonlyArray<MiniGameId> = ["claude-run", "platformer", "gate-runner"];

describe("shouldAutoPause", () => {
  it.each([
    [true, false, true, true],
    [true, false, false, false],
    [false, false, true, false],
    [false, true, true, false],
    [true, true, true, false],
  ])("previous %s, working %s, enabled %s -> %s", (previous, working, enabled, expected) => {
    expect(shouldAutoPause(previous, working, enabled)).toBe(expected);
  });
});

describe("shouldRunLoop", () => {
  const running = {
    open: true,
    paused: false,
    visible: true,
    onScreen: true,
    autoPausedForFinish: false,
  };

  it("runs only when every condition allows it", () => {
    expect(shouldRunLoop(running)).toBe(true);
    expect(shouldRunLoop({ ...running, open: false })).toBe(false);
    expect(shouldRunLoop({ ...running, paused: true })).toBe(false);
    expect(shouldRunLoop({ ...running, visible: false })).toBe(false);
    expect(shouldRunLoop({ ...running, onScreen: false })).toBe(false);
    expect(shouldRunLoop({ ...running, autoPausedForFinish: true })).toBe(false);
  });
});

describe("formatWorkDuration", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const at = (seconds: number) => new Date(Date.parse(start) + seconds * 1000).toISOString();

  it.each([
    [0.4, "1s"],
    [45, "45s"],
    [252, "4m 12s"],
    [3_780, "1h 3m"],
  ])("%ss -> %s", (seconds, expected) => {
    expect(formatWorkDuration(start, at(seconds))).toBe(expected);
  });

  it("has no summary without a usable start", () => {
    expect(formatWorkDuration(null, at(10))).toBeNull();
    expect(formatWorkDuration("not a date", at(10))).toBeNull();
    expect(formatWorkDuration(start, null)).toBeNull();
    expect(formatWorkDuration(start, at(0))).toBeNull();
  });
});

describe("themeFromVariables", () => {
  const variables: Record<string, string> = {
    "--background": "rgb(1, 1, 1)",
    "--card": "rgb(2, 2, 2)",
    "--surface-raised": "rgb(3, 3, 3)",
    "--foreground": "rgb(4, 4, 4)",
    "--muted-foreground": "rgb(5, 5, 5)",
    "--border": "rgb(6, 6, 6)",
    "--primary": "rgb(7, 7, 7)",
    "--primary-foreground": "rgb(8, 8, 8)",
    "--secondary": "rgb(9, 9, 9)",
    "--success": "rgb(10, 10, 10)",
    "--destructive": "rgb(11, 11, 11)",
  };

  it("maps app variables to game colours, using the composer's surface for each mode", () => {
    const read = (name: string) => variables[name] ?? "";
    expect(themeFromVariables(read, false)).toEqual({
      background: "rgb(1, 1, 1)",
      surface: "rgb(2, 2, 2)",
      foreground: "rgb(4, 4, 4)",
      muted: "rgb(5, 5, 5)",
      border: "rgb(6, 6, 6)",
      accent: "rgb(7, 7, 7)",
      accentForeground: "rgb(8, 8, 8)",
      secondary: "rgb(9, 9, 9)",
      success: "rgb(10, 10, 10)",
      danger: "rgb(11, 11, 11)",
    });
    expect(themeFromVariables(read, true).surface).toBe("rgb(3, 3, 3)");
  });

  it("falls back for missing variables so games always get a colour", () => {
    const theme = themeFromVariables(() => "", true);
    expect(Object.values(theme).every((value) => value.length > 0)).toBe(true);
    expect(themeFromVariables((name) => (name === "--card" ? "red" : ""), true).surface).toBe(
      "red",
    );
  });
});

describe("sanitizePersistedDockState", () => {
  it("keeps known games and their snapshots", () => {
    expect(
      sanitizePersistedDockState(
        { selectedGameId: "platformer", snapshots: { platformer: { x: 3 }, "claude-run": 1 } },
        IDS,
        "claude-run",
      ),
    ).toEqual({
      selectedGameId: "platformer",
      snapshots: { platformer: { x: 3 }, "claude-run": 1 },
    });
  });

  it.each([null, undefined, "garbage", 42, [], { snapshots: "nope", selectedGameId: 7 }])(
    "starts fresh from %j",
    (raw) => {
      expect(sanitizePersistedDockState(raw, IDS, "claude-run")).toEqual({
        selectedGameId: "claude-run",
        snapshots: {},
      });
    },
  );

  it("drops games that no longer exist", () => {
    expect(
      sanitizePersistedDockState(
        { selectedGameId: "retired", snapshots: { retired: {}, "gate-runner": null } },
        IDS,
        "claude-run",
      ),
    ).toEqual({ selectedGameId: "claude-run", snapshots: {} });
  });
});

describe("failSafeStorage", () => {
  it("passes reads and writes through", () => {
    const storage = failSafeStorage(createMemoryStorage());
    storage.setItem("key", "value");
    expect(storage.getItem("key")).toBe("value");
    storage.removeItem("key");
    expect(storage.getItem("key")).toBeNull();
  });

  it("reads as empty and drops writes when storage throws", () => {
    const fail = () => {
      throw new Error("blocked");
    };
    const storage = failSafeStorage({ getItem: fail, setItem: fail, removeItem: fail });
    expect(storage.getItem("key")).toBeNull();
    expect(() => storage.setItem("key", "value")).not.toThrow();
    expect(() => storage.removeItem("key")).not.toThrow();
  });
});
