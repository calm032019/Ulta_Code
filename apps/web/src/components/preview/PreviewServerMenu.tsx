import type { EnvironmentId, ProjectScript } from "@t3tools/contracts";
import { Play, Plus, Server, SettingsIcon, SquareArrowOutUpRight } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { isLocalServerLive, useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

/** A project action with a preview URL: a named command that serves a page. */
export type PreviewServer = ProjectScript & { readonly previewUrl: string };

export interface PreviewServerControls {
  readonly servers: ReadonlyArray<PreviewServer>;
  readonly configuredUrls: ReadonlyArray<string>;
  /** Unset when this client cannot run terminal commands. */
  readonly onStart: ((server: PreviewServer, live: boolean) => void) | undefined;
  readonly onAdd: () => void;
  readonly onEdit: (server: PreviewServer) => void;
  readonly startingId: string | null;
}

export function previewServersFromScripts(
  scripts: ReadonlyArray<ProjectScript>,
): ReadonlyArray<PreviewServer> {
  return scripts.filter((script): script is PreviewServer => Boolean(script.previewUrl));
}

export function previewServerPortLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port ? `:${parsed.port}` : parsed.host;
  } catch {
    return url;
  }
}

export function PreviewServerMenu({
  environmentId,
  controls,
}: {
  readonly environmentId: EnvironmentId;
  readonly controls: PreviewServerControls;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={<Button variant="ghost" size="icon-xs" type="button" aria-label="Servers" />}
            />
          }
        >
          {controls.startingId ? <Spinner /> : <Server />}
        </TooltipTrigger>
        <TooltipPopup>Servers</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" className="min-w-56">
        <PreviewServerMenuItems environmentId={environmentId} controls={controls} />
      </MenuPopup>
    </Menu>
  );
}

// Mounted only while the menu is open, so the port scan runs only while someone is looking.
function PreviewServerMenuItems({
  environmentId,
  controls,
}: {
  readonly environmentId: EnvironmentId;
  readonly controls: PreviewServerControls;
}) {
  const live = useDiscoveredLocalServers({
    environmentId,
    configuredUrls: controls.configuredUrls,
  });
  return (
    <>
      {controls.servers.length > 0 ? (
        <>
          <MenuGroup>
            <MenuGroupLabel>Servers</MenuGroupLabel>
            {controls.servers.map((server) => {
              const running = isLocalServerLive(live, server.previewUrl);
              const starting = controls.startingId === server.id;
              return (
                <MenuItem
                  key={server.id}
                  className="group"
                  disabled={!controls.onStart || starting}
                  onClick={() => controls.onStart?.(server, running)}
                >
                  <span
                    aria-hidden
                    className={
                      running
                        ? "size-2 shrink-0 rounded-full bg-success"
                        : "size-2 shrink-0 rounded-full bg-muted-foreground/30"
                    }
                  />
                  <MenuItemLabel>{server.name}</MenuItemLabel>
                  <MenuShortcut>{previewServerPortLabel(server.previewUrl)}</MenuShortcut>
                  <span className="flex opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${server.name}`}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        controls.onEdit(server);
                      }}
                    >
                      <SettingsIcon className="size-3.5" />
                    </Button>
                  </span>
                  <span className="flex size-6 items-center justify-center text-muted-foreground">
                    {starting ? (
                      <Spinner size="sm" />
                    ) : running ? (
                      <SquareArrowOutUpRight className="size-3.5" aria-label="Open" />
                    ) : (
                      <Play className="size-3.5" aria-label="Start" />
                    )}
                  </span>
                </MenuItem>
              );
            })}
          </MenuGroup>
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem onClick={controls.onAdd}>
        <Plus className="size-4" />
        <MenuItemLabel>Add server</MenuItemLabel>
      </MenuItem>
    </>
  );
}
