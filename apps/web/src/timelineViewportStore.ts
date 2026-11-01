import { create } from "zustand";

interface TimelineViewportState {
  readonly threadKey: string | null;
  /** Newest timestamp visible in the chat timeline. */
  readonly at: string | null;
  readonly atEnd: boolean;
  readonly publish: (threadKey: string, at: string | null, atEnd: boolean) => void;
}

/** Where the chat timeline is scrolled, so the session timeline can mark "you are here". */
export const useTimelineViewportStore = create<TimelineViewportState>((set) => ({
  threadKey: null,
  at: null,
  atEnd: true,
  publish: (threadKey, at, atEnd) =>
    set((state) =>
      state.threadKey === threadKey && state.at === at && state.atEnd === atEnd
        ? state
        : { threadKey, at, atEnd },
    ),
}));
