import {
  BotIcon,
  Building2Icon,
  EllipsisIcon,
  MessageSquareIcon,
  PauseIcon,
  PlayIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { getDocumentActivity, subscribeDocumentActivity } from "~/lib/documentActivity";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { ComposerSurface } from "../chat/ComposerSurface";
import { Button } from "../ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  formatWorkDuration,
  sameTheme,
  shouldAutoPause,
  shouldRunLoop,
  themeFromVariables,
} from "./dockLogic";
import {
  clearMiniGameDockStart,
  readMiniGameSnapshot,
  saveMiniGameSnapshot,
  selectMiniGame,
  useMiniGameDockStore,
} from "./miniGameDockStore";
import { MINI_GAMES, miniGameById } from "./registry";
import type { MiniGameId, MiniGameInstance, MiniGameTheme } from "./types";

const MAX_PIXEL_RATIO = 2;
const COUNTDOWN_FROM = 3;
/** Matches the `.minigame-dock[data-closing]` animation in index.css. */
const CLOSE_DURATION_MS = 180;
const AUTO_PAUSE_LABEL = "Auto-pause when the agent finishes";
const GAME_ICONS: Record<MiniGameId, LucideIcon> = {
  "claude-run": BotIcon,
  platformer: Building2Icon,
  "gate-runner": UsersIcon,
};

function readDocumentVisible(): boolean {
  return getDocumentActivity().visible;
}

/** Resolves theme variables to concrete colours, since canvas cannot read var() or every CSS colour syntax. */
function readMiniGameTheme(): MiniGameTheme {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.append(probe);
  try {
    return themeFromVariables((name) => {
      const raw = rootStyle.getPropertyValue(name).trim();
      if (!raw) return "";
      probe.style.color = "";
      probe.style.color = raw;
      if (!probe.style.color) return "";
      return getComputedStyle(probe).color;
    }, root.classList.contains("dark"));
  } finally {
    probe.remove();
  }
}

export function MiniGameDock(props: {
  isWorking: boolean;
  /** The thread's latest run, for the "Worked for" summary once the agent finishes. */
  latestRun: { readonly startedAt: string | null; readonly completedAt: string | null } | null;
  onBackToChat: () => void;
}) {
  const { isWorking, latestRun, onBackToChat } = props;
  const gameId = useMiniGameDockStore((state) => state.selectedGameId);
  const game = miniGameById(gameId);
  const autoPauseEnabled = useClientSettings((settings) => settings.minigameAutoPauseEnabled);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visible = useSyncExternalStore(subscribeDocumentActivity, readDocumentVisible, () => true);
  const [paused, setPaused] = useState(() => !useMiniGameDockStore.getState().startOnShow);
  const [autoPausedForFinish, setAutoPausedForFinish] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [previousWorking, setPreviousWorking] = useState(isWorking);
  const [previousVisible, setPreviousVisible] = useState(visible);
  if (previousWorking !== isWorking) {
    setPreviousWorking(isWorking);
    if (shouldAutoPause(previousWorking, isWorking, autoPauseEnabled)) {
      setPaused(true);
      setCountdown(null);
      setAutoPausedForFinish(true);
    }
  }
  if (previousVisible !== visible) {
    setPreviousVisible(visible);
    if (!visible) {
      setPaused(true);
      setCountdown(null);
    }
  }

  const worked = latestRun ? formatWorkDuration(latestRun.startedAt, latestRun.completedAt) : null;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const instanceRef = useRef<MiniGameInstance | null>(null);
  const running = shouldRunLoop({ open: true, paused, visible, onScreen, autoPausedForFinish });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the canvas on open and marks the explicit open as used, so a later return to this thread starts paused
  useLayoutEffect(() => {
    clearMiniGameDockStart();
    canvasRef.current?.focus({ preventScroll: true });
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the game instance bound to the canvas: creation, sizing, theme, and the snapshot saved when it goes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (scoreRef.current) scoreRef.current.textContent = "0";
    let theme = readMiniGameTheme();
    const instance = miniGameById(gameId).create(canvas, {
      theme,
      snapshot: readMiniGameSnapshot(gameId),
      onScore: (score) => {
        if (scoreRef.current) scoreRef.current.textContent = String(score);
      },
    });
    instanceRef.current = instance;

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      instance.resize(width, height, ratio);
    };
    resize();
    const stopResize = observeResize(canvas, resize);

    let themeFrame: number | null = null;
    const themeObserver = new MutationObserver(() => {
      if (themeFrame !== null) return;
      themeFrame = requestAnimationFrame(() => {
        themeFrame = null;
        const next = readMiniGameTheme();
        if (sameTheme(next, theme)) return;
        theme = next;
        instance.setTheme(next);
      });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme-id"],
    });

    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            const entry = entries.at(-1);
            if (entry) setOnScreen(entry.isIntersecting);
          });
    intersection?.observe(canvas);

    return () => {
      intersection?.disconnect();
      themeObserver.disconnect();
      if (themeFrame !== null) cancelAnimationFrame(themeFrame);
      stopResize();
      instance.pause();
      saveMiniGameSnapshot(gameId, instance.snapshot());
      instance.destroy();
      if (instanceRef.current === instance) instanceRef.current = null;
    };
  }, [gameId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts and stops the game's frame loop, saving where the player left off on every pause
  useEffect(() => {
    const instance = instanceRef.current;
    if (!running || !instance) return;
    instance.start();
    return () => {
      if (instanceRef.current !== instance) return;
      instance.pause();
      saveMiniGameSnapshot(gameId, instance.snapshot());
    };
  }, [gameId, running]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ticks the resume countdown on a timer; the game stays paused until it reaches zero
  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }
      setCountdown(null);
      setPaused(false);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands back to the composer once the close animation has played; a timer, so a skipped animation cannot strand the dock
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onBackToChat, CLOSE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onBackToChat]);

  const pause = () => {
    setCountdown(null);
    setPaused(true);
  };

  const resume = () => {
    setAutoPausedForFinish(false);
    canvasRef.current?.focus({ preventScroll: true });
    if (reducedMotion) setPaused(false);
    else setCountdown(COUNTDOWN_FROM);
  };

  const backToChat = () => {
    if (reducedMotion) {
      onBackToChat();
      return;
    }
    setPaused(true);
    setCountdown(null);
    setClosing(true);
  };

  const handleRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    backToChat();
  };

  const handleCanvasKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!running) {
      if ((event.key === " " || event.key === "Enter") && countdown === null) {
        event.preventDefault();
        resume();
      }
      return;
    }
    if (instanceRef.current?.keyDown(event.key)) event.preventDefault();
  };

  const pointerPosition = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  };

  const setAutoPause = (checked: boolean) => {
    void updateClientSettings({ minigameAutoPauseEnabled: checked });
  };
  const selectedIndex = Math.max(
    0,
    MINI_GAMES.findIndex((entry) => entry.id === gameId),
  );
  const selectGame = (nextId: MiniGameId) => {
    if (nextId !== gameId) selectMiniGame(nextId);
  };

  return (
    <ComposerSurface.Shell
      data-minigame-dock="true"
      data-closing={closing || undefined}
      className="minigame-dock"
      onKeyDown={handleRootKeyDown}
    >
      <ComposerSurface.Host>
        <div className="minigame-dock-body flex h-[170px] flex-col overflow-hidden rounded-2xl sm:h-[200px]">
          <div className="flex min-w-0 flex-nowrap items-center gap-2 px-2 pt-2 pb-1.5">
            <div
              role="radiogroup"
              aria-label="Game"
              className="relative grid shrink-0 grid-cols-3 rounded-lg bg-input/40 p-0.5"
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const step = event.key === "ArrowRight" ? 1 : MINI_GAMES.length - 1;
                const next = MINI_GAMES[(selectedIndex + step) % MINI_GAMES.length];
                if (!next) return;
                selectGame(next.id);
                event.currentTarget
                  .querySelector<HTMLElement>(`[data-game-id="${next.id}"]`)
                  ?.focus();
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0.5 left-0.5 w-[calc((100%-0.25rem)/3)] rounded-md bg-background shadow-xs/10 transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-input/72"
                style={{ transform: `translateX(${selectedIndex * 100}%)` }}
              />
              {MINI_GAMES.map((entry) => {
                const Icon = GAME_ICONS[entry.id];
                const selected = entry.id === gameId;
                return (
                  <Tooltip key={entry.id}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={entry.title}
                          tabIndex={selected ? 0 : -1}
                          data-game-id={entry.id}
                          onClick={() => {
                            selectGame(entry.id);
                            canvasRef.current?.focus({ preventScroll: true });
                          }}
                          className={cn(
                            "relative z-10 flex h-6 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                            selected
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        />
                      }
                    >
                      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="hidden truncate @min-[520px]/composer-surface:inline">
                        {entry.title}
                      </span>
                    </TooltipTrigger>
                    <TooltipPopup side="top">{entry.controls}</TooltipPopup>
                  </Tooltip>
                );
              })}
            </div>
            <span className="flex shrink-0 items-baseline gap-1 text-xs">
              <span className="text-muted-foreground">Score</span>
              <span ref={scoreRef} className="font-medium text-foreground tabular-nums">
                0
              </span>
            </span>
            <div className="ms-auto flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="hidden items-center gap-1.5 px-1.5 text-muted-foreground text-xs @min-[520px]/composer-surface:flex" />
                  }
                >
                  <Switch
                    size="sm"
                    checked={autoPauseEnabled}
                    onCheckedChange={(checked) => setAutoPause(Boolean(checked))}
                    aria-label={AUTO_PAUSE_LABEL}
                  />
                  <span aria-hidden="true">Auto-pause</span>
                </TooltipTrigger>
                <TooltipPopup side="top">{AUTO_PAUSE_LABEL}</TooltipPopup>
              </Tooltip>
              <div className="@min-[520px]/composer-surface:hidden">
                <Menu>
                  <MenuTrigger
                    render={<Button variant="ghost" size="icon-xs" aria-label="Game options" />}
                  >
                    <EllipsisIcon />
                  </MenuTrigger>
                  <MenuPopup align="end" side="top">
                    <MenuCheckboxItem
                      variant="switch"
                      checked={autoPauseEnabled}
                      onCheckedChange={(checked) => setAutoPause(Boolean(checked))}
                    >
                      {AUTO_PAUSE_LABEL}
                    </MenuCheckboxItem>
                  </MenuPopup>
                </Menu>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={running ? "Pause" : "Resume"}
                      disabled={countdown !== null}
                      onClick={() => (running ? pause() : resume())}
                    />
                  }
                >
                  {running || countdown !== null ? <PauseIcon /> : <PlayIcon />}
                </TooltipTrigger>
                <TooltipPopup side="top">{running ? "Pause" : "Resume"}</TooltipPopup>
              </Tooltip>
              <Button variant="ghost" size="xs" aria-label="Back to chat" onClick={backToChat}>
                <MessageSquareIcon />
                <span className="hidden @min-[520px]/composer-surface:inline">Back to chat</span>
              </Button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <canvas
              ref={canvasRef}
              tabIndex={0}
              aria-label={`${game.title}. ${game.controls}`}
              className="absolute inset-0 size-full touch-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              onKeyDown={handleCanvasKeyDown}
              onKeyUp={(event) => instanceRef.current?.keyUp(event.key)}
              onPointerDown={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                if (!running) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                instanceRef.current?.pointerDown(...pointerPosition(event));
              }}
              onPointerMove={(event) => {
                if (running) instanceRef.current?.pointerMove(...pointerPosition(event));
              }}
              onPointerUp={(event) => {
                if (running) instanceRef.current?.pointerUp(...pointerPosition(event));
              }}
            />
            {countdown !== null ? (
              <div
                aria-live="polite"
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/30"
              >
                <span className="font-semibold text-4xl text-foreground tabular-nums">
                  {countdown}
                </span>
              </div>
            ) : !running && (paused || autoPausedForFinish) ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 p-3 backdrop-blur-sm not-supports-[backdrop-filter:blur(1px)]:bg-background/90">
                <div
                  role={autoPausedForFinish ? "status" : undefined}
                  className="flex max-w-full flex-col items-center gap-2.5 rounded-xl border border-border/70 bg-popover px-5 py-3.5 text-center shadow-lg/5"
                >
                  <div className="grid gap-0.5">
                    <p className="font-medium text-foreground text-sm">
                      {autoPausedForFinish ? "Your agent has finished" : "Paused"}
                    </p>
                    {autoPausedForFinish && worked ? (
                      <p className="text-muted-foreground text-xs">Worked for {worked}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {autoPausedForFinish ? (
                      <Button size="sm" onClick={backToChat}>
                        Back to chat
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant={autoPausedForFinish ? "outline" : "default"}
                      onClick={resume}
                    >
                      <PlayIcon />
                      {autoPausedForFinish ? "Keep playing" : "Resume"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="pointer-events-none absolute right-2 bottom-1.5 text-2xs text-muted-foreground/70">
                {game.controls}
              </p>
            )}
          </div>
        </div>
      </ComposerSurface.Host>
    </ComposerSurface.Shell>
  );
}
