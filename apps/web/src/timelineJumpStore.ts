import { create } from "zustand";

import type { TimelineJumpTarget } from "./components/activity/sessionActivity.logic";

interface TimelineJumpRequest extends TimelineJumpTarget {
  readonly threadKey: string;
  readonly nonce: number;
}

interface TimelineJumpStoreState {
  readonly request: TimelineJumpRequest | null;
  readonly requestJump: (threadKey: string, target: TimelineJumpTarget) => void;
  readonly settle: (nonce: number) => void;
}

let nextNonce = 1;

/** Asks the timeline showing `threadKey` to scroll to a row; it clears the request once there. */
export const useTimelineJumpStore = create<TimelineJumpStoreState>((set) => ({
  request: null,
  requestJump: (threadKey, target) =>
    set({ request: { ...target, threadKey, nonce: nextNonce++ } }),
  settle: (nonce) => set((state) => (state.request?.nonce === nonce ? { request: null } : state)),
}));
