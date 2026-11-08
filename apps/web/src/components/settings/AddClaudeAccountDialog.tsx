import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useState } from "react";

import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../hooks/useSettings";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { deriveAvailableInstanceId } from "./AddProviderInstanceDialog.logic";
import { ClaudeAccountSection } from "./ClaudeAccountSection";
import { separateClaudeLoginFolder } from "./ClaudeAccountSection.logic";
import { SettingsRow } from "./settingsLayout";

const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const API_KEYS_URL = "https://console.anthropic.com/settings/keys";

export type AddClaudeMode = "account" | "apiKey";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

/**
 * Adds one more Claude to the model picker: either a Claude account with its own login, so it
 * never picks up the account that is already signed in, or an Anthropic API key.
 */
export function AddClaudeAccountDialog({
  environmentId,
  mode,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly mode: AddClaudeMode;
  readonly onClose: () => void;
}) {
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const settings = useEnvironmentSettings(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const persistProviderInstance = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const [name, setName] = useState(mode === "account" ? "Personal" : "API credits");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const provider = providers?.find((candidate) => candidate.instanceId === instanceId);
  const signedIn = provider?.auth.status === "authenticated";
  const displayName = `Claude - ${name.trim()}`;
  const canSubmit =
    !pending && name.trim().length > 0 && (mode === "account" || apiKey.trim().length > 0);

  const create = async () => {
    if (!canSubmit || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setPending(true);
    const id = ProviderInstanceId.make(
      deriveAvailableInstanceId(
        (label) => `claudeAgent_${slugify(label) || "account"}`,
        name,
        new Set(["claudeAgent", ...Object.keys(settings.providerInstances ?? {})]),
      ),
    );
    const result = await persistProviderInstance({
      operation: "create",
      instanceId: id,
      instance: {
        driver: CLAUDE_DRIVER_KIND,
        displayName,
        enabled: true,
        config:
          mode === "account"
            ? { homePath: separateClaudeLoginFolder(id) }
            : { apiKey: apiKey.trim() },
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Couldn't add Claude",
        description: error instanceof Error ? error.message : "The settings update failed.",
      });
      return;
    }
    if (mode === "apiKey") {
      toastManager.add({
        type: "success",
        title: `${displayName} added`,
        description: "Pick it in the model picker to use your API credits.",
      });
      onClose();
      return;
    }
    setInstanceId(id);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title={
            instanceId
              ? `Sign in to ${displayName}`
              : mode === "account"
                ? "Add a Claude account"
                : "Add an Anthropic API key"
          }
          description={
            mode === "account"
              ? "Uses a Claude Pro or Max subscription. It gets its own sign-in, so the Claude you already have stays signed in as it is."
              : "Pays per use from Anthropic API credits instead of a subscription."
          }
        />
        <WizardPanel>
          {instanceId ? (
            <ClaudeAccountSection
              environmentId={environmentId}
              instanceId={instanceId}
              provider={provider}
              usesApiKey={false}
              sharedWith={[]}
              readOnly={!canManageProviders}
            />
          ) : (
            <form
              id="add-claude"
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <SettingsRow
                title="Name"
                description="How it shows up in the model picker."
                control={
                  <Input
                    aria-label="Name"
                    value={name}
                    disabled={pending}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={mode === "account" ? "e.g. Personal or Work" : "e.g. API credits"}
                  />
                }
              />
              {mode === "apiKey" ? (
                <SettingsRow
                  title="API key"
                  description={
                    <>
                      Starts with <code>sk-ant-</code>. Create one at{" "}
                      <a
                        href={API_KEYS_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        console.anthropic.com
                      </a>
                      . It stays on the machine running Ulta Code.
                    </>
                  }
                  control={
                    <Input
                      aria-label="API key"
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      disabled={pending}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="sk-ant-…"
                    />
                  }
                />
              ) : null}
            </form>
          )}
        </WizardPanel>
        <WizardFooter>
          {instanceId ? (
            <Button variant={signedIn ? "default" : "outline"} onClick={onClose}>
              {signedIn ? "Done" : "Finish later"}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form="add-claude" disabled={!canSubmit || !canManageProviders}>
                {pending ? "Adding…" : mode === "account" ? "Continue" : "Add API key"}
              </Button>
            </>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
