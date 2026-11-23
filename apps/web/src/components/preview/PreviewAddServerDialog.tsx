import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Play, Plus, Server, SquareArrowOutUpRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { DiscoveryList, DiscoveryListRow } from "../ui/discovery-list";
import { Spinner } from "../ui/spinner";
import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import {
  previewServerPortLabel,
  type PreviewServer,
  type PreviewServerControls,
} from "./PreviewServerMenu";
import { suggestPreviewServers, type PreviewServerSuggestion } from "./previewServerSuggestions";
import { isLocalServerLive, useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

export function PreviewAddServerDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly threadRef: ScopedThreadRef | null;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly controls: PreviewServerControls;
  readonly onAddSuggestion: (suggestion: PreviewServerSuggestion) => Promise<boolean>;
  readonly onOpenUrl: (url: string) => void;
  readonly onCustom: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add server</DialogTitle>
          <DialogDescription>Pick a server to start it and open it here.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the port scan and package.json read run only then. */}
        {props.open ? <PreviewAddServerDialogBody {...props} /> : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={props.onCustom}>
            <Plus />
            Custom command
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function PreviewAddServerDialogBody({
  threadRef,
  environmentId,
  cwd,
  controls,
  onAddSuggestion,
  onOpenUrl,
  onOpenChange,
}: Parameters<typeof PreviewAddServerDialog>[0]) {
  const [adding, setAdding] = useState<string | null>(null);
  const live = useDiscoveredLocalServers({
    environmentId,
    configuredUrls: controls.configuredUrls,
  });
  const packageJson = useProjectFileQuery(environmentId, cwd ?? "", "package.json", cwd !== null);
  const packageJsonText =
    packageJson.data && !packageJson.data.truncated ? packageJson.data.contents : null;
  const suggestions = suggestPreviewServers(
    packageJsonText,
    controls.servers.map((server) => server.command),
  );
  const otherLive = live.filter(
    (server) => !controls.servers.some((saved) => isLocalServerLive([server], saved.previewUrl)),
  );
  const close = () => onOpenChange(false);

  const start = (server: PreviewServer, running: boolean) => {
    controls.onStart?.(server, running);
    close();
  };
  const add = async (suggestion: PreviewServerSuggestion) => {
    setAdding(suggestion.command);
    const added = await onAddSuggestion(suggestion);
    setAdding(null);
    if (added) close();
  };

  const hasCurrent = controls.servers.length > 0 || otherLive.length > 0;

  return (
    <DialogPanel>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Current servers</h3>
          {hasCurrent ? (
            <DiscoveryList>
              {controls.servers.map((server) => {
                const running = isLocalServerLive(live, server.previewUrl);
                const starting = controls.startingId === server.id;
                const port = previewServerPortLabel(server.previewUrl);
                return (
                  <DiscoveryListRow
                    key={server.id}
                    disabled={!controls.onStart || starting}
                    onClick={() => start(server, running)}
                    icon={
                      <span
                        aria-hidden
                        className={
                          running
                            ? "size-2 shrink-0 rounded-full bg-success"
                            : "size-2 shrink-0 rounded-full bg-muted-foreground/30"
                        }
                      />
                    }
                    title={server.name}
                    description={
                      starting
                        ? "Starting…"
                        : running
                          ? `Running on ${port}`
                          : `Not running · ${port}`
                    }
                    action={
                      <RowAction>
                        {starting ? (
                          <Spinner size="sm" />
                        ) : running ? (
                          <SquareArrowOutUpRight className="size-4" aria-label="Open" />
                        ) : (
                          <Play className="size-4" aria-label="Start" />
                        )}
                      </RowAction>
                    }
                  />
                );
              })}
              {threadRef
                ? otherLive.map((server) => (
                    <PreviewLocalServerCard
                      key={`${server.host}:${server.port}`}
                      threadRef={threadRef}
                      server={server}
                      onOpen={() => {
                        onOpenUrl(server.requestedUrl);
                        close();
                      }}
                    />
                  ))
                : null}
            </DiscoveryList>
          ) : (
            <p className="px-1 text-sm text-muted-foreground">No servers yet.</p>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Suggested</h3>
          {suggestions.length > 0 ? (
            <DiscoveryList>
              {suggestions.map((suggestion) => (
                <DiscoveryListRow
                  key={suggestion.command}
                  disabled={adding !== null || !controls.onStart}
                  onClick={() => void add(suggestion)}
                  icon={<Server className="size-4 shrink-0 text-muted-foreground" />}
                  title={suggestion.command}
                  description={previewServerPortLabel(suggestion.previewUrl)}
                  action={
                    <RowAction>
                      {adding === suggestion.command ? (
                        <Spinner size="sm" />
                      ) : (
                        <Plus className="size-4" aria-label="Add and start" />
                      )}
                    </RowAction>
                  }
                />
              ))}
            </DiscoveryList>
          ) : (
            <p className="px-1 text-sm text-muted-foreground">
              {packageJson.isPending
                ? "Looking for dev scripts…"
                : "No dev scripts found in package.json."}
            </p>
          )}
        </section>
      </div>
    </DialogPanel>
  );
}

function RowAction({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
      {children}
    </span>
  );
}
