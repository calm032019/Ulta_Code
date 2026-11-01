import type { MiniGame, MiniGameInstance, MiniGameTheme } from "./types";

/** Temporary stand-in used until each game's real implementation lands. */
export function createPlaceholderGame(title: string): MiniGame["create"] {
  return (canvas, options): MiniGameInstance => {
    let theme: MiniGameTheme = options.theme;
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    let ratio = 1;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = theme.surface;
      context.fillRect(0, 0, width, height);
      context.fillStyle = theme.muted;
      context.font = "14px sans-serif";
      context.textAlign = "center";
      context.fillText(`${title} is on its way`, width / 2, height / 2);
    };
    return {
      start: draw,
      pause: () => {},
      snapshot: () => null,
      resize: (nextWidth, nextHeight, pixelRatio) => {
        width = nextWidth;
        height = nextHeight;
        ratio = pixelRatio;
        draw();
      },
      setTheme: (next) => {
        theme = next;
        draw();
      },
      keyDown: () => false,
      keyUp: () => {},
      pointerDown: () => {},
      pointerMove: () => {},
      pointerUp: () => {},
      destroy: () => {},
    };
  };
}
