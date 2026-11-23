import type { EnvironmentId, ProjectScript, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useEffect, useState, type ReactNode } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "~/components/ui/toast";
import { useStableCallback } from "~/hooks/useStableCallback";
import { serverEnvironment } from "~/state/server";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "../projectScriptEditor";
import { nextProjectScriptId, buildProjectScript } from "~/projectScripts";
import { PreviewAddServerDialog } from "./PreviewAddServerDialog";
import type { PreviewServerSuggestion } from "./previewServerSuggestions";
import {
  previewServersFromScripts,
  type PreviewServer,
  type PreviewServerControls,
} from "./PreviewServerMenu";
import { isLocalServerLive, useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

/** The active project's actions, as the browser panel needs them to start servers. */
export interface PreviewProjectServers {
  readonly scripts: ReadonlyArray<ProjectScript>;
  /** Where the project's package.json is read from for server suggestions. */
  readonly cwd: string | null;
  readonly onRun: ((script: ProjectScript) => Promise<string | null>) | undefined;
  readonly onAdd: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  readonly onUpdate: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  readonly onDelete: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

const NEW_SERVER_INPUT: NewProjectScriptInput = {
  ...EMPTY_PROJECT_SCRIPT_INPUT,
  previewUrl: "http://localhost:3000",
};

export function usePreviewServers(input: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly projectServers: PreviewProjectServers | undefined;
  readonly openUrl: (url: string) => void;
}): {
  readonly controls: PreviewServerControls | null;
  readonly elements: ReactNode;
  /** Stops waiting on a starting server, so it won't navigate away from a page opened since. */
  readonly cancelPendingOpen: () => void;
} {
  const { environmentId, threadRef, projectServers, openUrl } = input;
  const keybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const [editorRequest, setEditorRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState<PreviewServer | null>(null);

  const servers = previewServersFromScripts(projectServers?.scripts ?? []);
  const configuredUrls = servers.map((server) => server.previewUrl);
  const onRun = projectServers?.onRun;

  const start = async (server: PreviewServer, live: boolean) => {
    if (live) {
      setStarting(null);
      openUrl(server.previewUrl);
      return;
    }
    if (!onRun) return;
    setStarting(server);
    const terminalId = await onRun(server);
    if (terminalId === null) setStarting((current) => (current?.id === server.id ? null : current));
  };
  const handleLive = useStableCallback(() => {
    if (!starting) return;
    setStarting(null);
    openUrl(starting.previewUrl);
  });

  const addSuggestion = async (suggestion: PreviewServerSuggestion): Promise<boolean> => {
    if (!projectServers) return false;
    const serverInput = {
      ...EMPTY_PROJECT_SCRIPT_INPUT,
      name: suggestion.name,
      command: suggestion.command,
      previewUrl: suggestion.previewUrl,
    };
    const result = await projectServers.onAdd(serverInput);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not add server",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      return false;
    }
    // Same id the save just used, so the run is remembered as this server's.
    const id = nextProjectScriptId(
      suggestion.name,
      projectServers.scripts.map((script) => script.id),
    );
    const server = buildProjectScript(id, serverInput);
    if (server.previewUrl) void start({ ...server, previewUrl: server.previewUrl }, false);
    return true;
  };

  const cancelPendingOpen = () => setStarting(null);
  if (!projectServers) return { controls: null, elements: null, cancelPendingOpen };

  const controls: PreviewServerControls = {
    servers,
    configuredUrls,
    onStart: onRun ? (server, live) => void start(server, live) : undefined,
    onAdd: () => setPickerOpen(true),
    onEdit: (server) => setEditorRequest(editorRequestForScript(server, keybindings)),
    startingId: starting?.id ?? null,
  };

  return {
    controls,
    cancelPendingOpen,
    elements: (
      <>
        {starting ? (
          <PreviewServerStartWatcher
            environmentId={environmentId}
            configuredUrls={configuredUrls}
            url={starting.previewUrl}
            onLive={handleLive}
          />
        ) : null}
        <PreviewAddServerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          threadRef={threadRef}
          environmentId={environmentId}
          cwd={projectServers.cwd}
          controls={controls}
          onAddSuggestion={addSuggestion}
          onOpenUrl={openUrl}
          onCustom={() => {
            setPickerOpen(false);
            setEditorRequest({ scriptId: null, initial: NEW_SERVER_INPUT });
          }}
        />
        <ProjectScriptEditorDialog
          environmentId={environmentId}
          request={editorRequest}
          scripts={projectServers.scripts}
          onSubmit={(scriptId, next) =>
            scriptId === null ? projectServers.onAdd(next) : projectServers.onUpdate(scriptId, next)
          }
          onDelete={(scriptId) => void projectServers.onDelete(scriptId)}
          onClose={() => setEditorRequest(null)}
        />
      </>
    ),
  };
}

function PreviewServerStartWatcher(props: {
  readonly environmentId: EnvironmentId;
  readonly configuredUrls: ReadonlyArray<string>;
  readonly url: string;
  readonly onLive: () => void;
}) {
  const { onLive } = props;
  const live = isLocalServerLive(
    useDiscoveredLocalServers({
      environmentId: props.environmentId,
      configuredUrls: props.configuredUrls,
    }),
    props.url,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the page once the port scanner sees the started server listening
  useEffect(() => {
    if (live) onLive();
  }, [live, onLive]);
  return null;
}
