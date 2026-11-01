import type { StateStorage } from "~/lib/storage";
import type { MiniGameId, MiniGameTheme } from "./types";

export function shouldAutoPause(
  previousWorking: boolean,
  working: boolean,
  enabled: boolean,
): boolean {
  return enabled && previousWorking && !working;
}

export function shouldRunLoop(state: {
  readonly open: boolean;
  readonly paused: boolean;
  readonly visible: boolean;
  readonly onScreen: boolean;
  readonly autoPausedForFinish: boolean;
}): boolean {
  return (
    state.open && !state.paused && state.visible && state.onScreen && !state.autoPausedForFinish
  );
}

/** A "4m 12s" style duration; null unless both times are known and in order. */
/** The auto-pause card's headline, so a failed or stopped run is never reported as finished. */
export function agentFinishTitle(status: string | null | undefined): string {
  if (status === "failed") return "Your agent hit an error";
  if (status === "interrupted" || status === "cancelled") return "Your agent was stopped";
  return "Your agent has finished";
}

export function formatWorkDuration(
  startedAt: string | null,
  endedAt: string | null,
): string | null {
  if (startedAt === null || endedAt === null) return null;
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs <= startedAtMs) {
    return null;
  }
  const totalSeconds = Math.max(1, Math.round((endedAtMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Reads a CSS colour variable, returning "" when the theme does not define it. */
export type ThemeVariableReader = (name: string) => string;

const FALLBACK_THEME: Record<"light" | "dark", MiniGameTheme> = {
  light: {
    background: "#ffffff",
    surface: "#ffffff",
    foreground: "#171717",
    muted: "#737373",
    border: "#e5e5e5",
    accent: "#171717",
    accentForeground: "#ffffff",
    secondary: "#f5f5f5",
    success: "#059669",
    danger: "#dc2626",
  },
  dark: {
    background: "#0a0a0a",
    surface: "#171717",
    foreground: "#fafafa",
    muted: "#a3a3a3",
    border: "#262626",
    accent: "#fafafa",
    accentForeground: "#171717",
    secondary: "#262626",
    success: "#34d399",
    danger: "#f87171",
  },
};

export function themeFromVariables(read: ThemeVariableReader, dark: boolean): MiniGameTheme {
  const fallback = FALLBACK_THEME[dark ? "dark" : "light"];
  const pick = (names: ReadonlyArray<string>, fallbackValue: string) => {
    for (const name of names) {
      const value = read(name).trim();
      if (value) return value;
    }
    return fallbackValue;
  };
  // The composer card paints --card in light mode and --surface-raised in dark mode.
  const surfaceNames = dark ? ["--surface-raised", "--card"] : ["--card", "--surface-raised"];
  return {
    background: pick(["--background"], fallback.background),
    surface: pick(surfaceNames, fallback.surface),
    foreground: pick(["--foreground"], fallback.foreground),
    muted: pick(["--muted-foreground"], fallback.muted),
    border: pick(["--border"], fallback.border),
    accent: pick(["--primary"], fallback.accent),
    accentForeground: pick(["--primary-foreground"], fallback.accentForeground),
    secondary: pick(["--secondary"], fallback.secondary),
    success: pick(["--success"], fallback.success),
    danger: pick(["--destructive"], fallback.danger),
  };
}

export function sameTheme(a: MiniGameTheme, b: MiniGameTheme): boolean {
  return (Object.keys(a) as Array<keyof MiniGameTheme>).every((key) => a[key] === b[key]);
}

export interface PersistedMiniGameDockState {
  readonly selectedGameId: MiniGameId;
  readonly snapshots: Partial<Record<MiniGameId, unknown>>;
}

/** Keeps only known games from whatever storage held, so a corrupt entry starts the dock fresh. */
export function sanitizePersistedDockState(
  raw: unknown,
  knownIds: ReadonlyArray<MiniGameId>,
  defaultGameId: MiniGameId,
): PersistedMiniGameDockState {
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const isKnown = (value: unknown): value is MiniGameId =>
    typeof value === "string" && (knownIds as ReadonlyArray<string>).includes(value);
  const rawSnapshots =
    record.snapshots !== null && typeof record.snapshots === "object"
      ? (record.snapshots as Record<string, unknown>)
      : {};
  const snapshots: Partial<Record<MiniGameId, unknown>> = {};
  for (const [id, snapshot] of Object.entries(rawSnapshots)) {
    if (isKnown(id) && snapshot !== undefined && snapshot !== null) snapshots[id] = snapshot;
  }
  return {
    selectedGameId: isKnown(record.selectedGameId) ? record.selectedGameId : defaultGameId,
    snapshots,
  };
}

/** Storage whose failures (quota, private mode, blocked access) read as empty and drop writes. */
export function failSafeStorage(base: StateStorage): StateStorage<void> {
  return {
    getItem: (name) => {
      try {
        const value = base.getItem(name);
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        base.setItem(name, value);
      } catch {}
    },
    removeItem: (name) => {
      try {
        base.removeItem(name);
      } catch {}
    },
  };
}
