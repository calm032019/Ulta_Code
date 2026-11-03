import { useNavigate } from "@tanstack/react-router";
import type { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  useScopedSettings,
  useScopedSettingsEnvironmentWide,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import { providerInstanceEntriesFor } from "../../providerInstances";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { toastManager } from "../ui/toast";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow } from "./settingsLayout";
import { ScopedSwitch } from "./ScopedSwitch";
import { searchableSetting } from "./settingsSearch";

export function DunceModeModelRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments, target } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const mixed = useScopedSettingsMixed(["dunceModeModelSelection"]);
  const environmentWide = useScopedSettingsEnvironmentWide(["dunceModeModelSelection"]);

  const explainingProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const instanceEntries = providerInstanceEntriesFor(
    explainingProviders,
    settings,
    target?.projectId ?? null,
  );
  const usesChosenModel = settings.dunceModeModelSelection !== null;
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection:
        settings.dunceModeModelSelection ?? settings.textGenerationModelSelection,
    },
    explainingProviders,
  );
  const instanceEntry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
  const canChooseModel = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    explainingProviders,
    selection.instanceId,
    selection.model,
  );
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);

  const save = (instanceId: ProviderInstanceId, model: string, options = selection.options) => {
    const reason = modelDisabledReason(instanceId, model);
    if (reason) {
      toastManager.add({
        type: "error",
        title: "Explanation model not saved",
        description: reason,
      });
      return;
    }
    updateSettings({
      dunceModeModelSelection: createModelSelection(instanceId, model, options),
    });
  };

  return (
    <SettingsRow
      serverScoped
      settingKeys={["dunceModeModelSelection"]}
      {...searchableSetting("dunce-mode-model")}
      description="Model that writes the explanations. Off uses the thread's own provider, then your text generation model."
      control={
        connectedEnvironments.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            Connect an environment to choose its explanation model.
          </span>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(usesChosenModel || mixed) && !environmentWide ? (
              <ProviderModelPicker
                environmentId={environmentId}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel="Explanation model"
                {...(mixed ? { triggerLabel: "Mixed" } : {})}
                getModelDisabledReason={modelDisabledReason}
                {...(environmentId
                  ? {
                      onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                        void navigate({
                          to: "/settings/providers",
                          search: { environmentId, instanceId },
                        });
                      },
                    }
                  : {})}
                onInstanceModelChange={(instanceId, model) => save(instanceId, model, undefined)}
              />
            ) : null}
            {usesChosenModel && !mixed && !environmentWide && instanceEntry ? (
              <TraitsPicker
                provider={instanceEntry.driverKind}
                models={instanceEntry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                planModeEnabled={settings.planModeEnabled || selectsPlanAgent(selection.options)}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  save(selection.instanceId, selection.model, options)
                }
              />
            ) : null}
            <ScopedSwitch
              settingKeys={["dunceModeModelSelection"]}
              checked={usesChosenModel}
              disabled={!usesChosenModel && !canChooseModel}
              onCheckedChange={(checked) => {
                if (!checked) {
                  updateSettings({ dunceModeModelSelection: null });
                  return;
                }
                save(selection.instanceId, selection.model);
              }}
              aria-label="Choose the explanation model"
            />
          </div>
        )
      }
    />
  );
}
