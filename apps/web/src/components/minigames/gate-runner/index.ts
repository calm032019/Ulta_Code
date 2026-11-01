import type { MiniGame } from "../types";
import { createPlaceholderGame } from "../placeholderGame";

export const gateRunnerGame: MiniGame = {
  id: "gate-runner",
  title: "Gate Rush",
  controls: "Coming soon",
  create: createPlaceholderGame("Gate Rush"),
};
