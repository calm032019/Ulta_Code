import type { ServerSettings } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { Switch } from "../ui/switch";
import { useScopedSettingsEnvironmentWide, useScopedSettingsMixed } from "./useScopedSettings";

export function ScopedSwitch({
  settingKeys,
  checked,
  disabled,
  ...props
}: ComponentProps<typeof Switch> & { settingKeys: readonly (keyof ServerSettings)[] }) {
  const mixed = useScopedSettingsMixed(settingKeys);
  const environmentWide = useScopedSettingsEnvironmentWide(settingKeys);
  return (
    <Switch
      {...props}
      mixed={mixed}
      checked={mixed ? false : checked}
      disabled={disabled || environmentWide}
    />
  );
}
