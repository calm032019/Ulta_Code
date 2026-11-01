import type { MiniGame } from "../types";
import { createPlaceholderGame } from "../placeholderGame";

export const platformerGame: MiniGame = {
  id: "platformer",
  title: "Skyline Hop",
  controls: "Coming soon",
  create: createPlaceholderGame("Skyline Hop"),
};
