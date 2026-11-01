import type { MiniGame } from "../types";
import { createPlaceholderGame } from "../placeholderGame";

export const claudeRunGame: MiniGame = {
  id: "claude-run",
  title: "Claude Run",
  controls: "Coming soon",
  create: createPlaceholderGame("Claude Run"),
};
