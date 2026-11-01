import { claudeRunGame } from "./bot-run";
import { gateRunnerGame } from "./gate-runner";
import { platformerGame } from "./platformer";
import type { MiniGame, MiniGameId } from "./types";

export const MINI_GAMES: ReadonlyArray<MiniGame> = [claudeRunGame, platformerGame, gateRunnerGame];

export function miniGameById(id: MiniGameId): MiniGame {
  return MINI_GAMES.find((game) => game.id === id) ?? claudeRunGame;
}
