import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";
import { failSafeStorage, sanitizePersistedDockState } from "./dockLogic";
import { MINI_GAME_IDS, type MiniGameId } from "./types";

const MINI_GAME_DOCK_STORAGE_KEY = "t3code:minigame-dock:v1";

// Ids only: importing the registry here would pull every game into the main bundle.
const KNOWN_GAME_IDS = MINI_GAME_IDS;
const DEFAULT_GAME_ID: MiniGameId = KNOWN_GAME_IDS[0] ?? "claude-run";

interface MiniGameDockState {
  /** The thread whose composer the dock replaces; the dock is open nowhere else. */
  readonly threadKey: string | null;
  /** Set by an explicit open so the game starts at once; a dock shown again after leaving the thread starts paused. */
  readonly startOnShow: boolean;
  readonly selectedGameId: MiniGameId;
  readonly snapshots: Partial<Record<MiniGameId, unknown>>;
}

export const useMiniGameDockStore = create<MiniGameDockState>()(
  persist(
    (): MiniGameDockState => ({
      threadKey: null,
      startOnShow: false,
      selectedGameId: DEFAULT_GAME_ID,
      snapshots: {},
    }),
    {
      name: MINI_GAME_DOCK_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        failSafeStorage(
          resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
        ),
      ),
      partialize: (state) => ({
        selectedGameId: state.selectedGameId,
        snapshots: state.snapshots,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedDockState(persisted, KNOWN_GAME_IDS, DEFAULT_GAME_ID),
      }),
    },
  ),
);

export function openMiniGameDock(threadKey: string): void {
  useMiniGameDockStore.setState({ threadKey, startOnShow: true });
}

export function closeMiniGameDock(): void {
  useMiniGameDockStore.setState({ threadKey: null, startOnShow: false });
}

export function clearMiniGameDockStart(): void {
  if (useMiniGameDockStore.getState().startOnShow) {
    useMiniGameDockStore.setState({ startOnShow: false });
  }
}

export function selectMiniGame(gameId: MiniGameId): void {
  useMiniGameDockStore.setState({ selectedGameId: gameId });
}

export function saveMiniGameSnapshot(gameId: MiniGameId, snapshot: unknown): void {
  useMiniGameDockStore.setState((state) => ({
    snapshots: { ...state.snapshots, [gameId]: snapshot },
  }));
}

export function readMiniGameSnapshot(gameId: MiniGameId): unknown {
  return useMiniGameDockStore.getState().snapshots[gameId];
}

export function useMiniGameDockOpen(threadKey: string | null): boolean {
  const openThreadKey = useMiniGameDockStore((state) => state.threadKey);
  return threadKey !== null && openThreadKey === threadKey;
}
