import type { ProviderInstanceConfig } from "@t3tools/contracts";

const CLAUDE_DRIVER = "claudeAgent";
const DEFAULT_INSTANCE_ID = "claudeAgent";

const readConfigString = (instance: ProviderInstanceConfig | undefined, key: string) => {
  const config = instance?.config;
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
};

const claudeConfigDirVariable = (instance: ProviderInstanceConfig | undefined) => {
  const value = instance?.environment?.find(
    (variable) => variable.name === "CLAUDE_CONFIG_DIR",
  )?.value;
  return typeof value === "string" ? value.trim() : "";
};

/** The login folder an entry reads, as configured. Empty means Claude's normal folder. */
const claudeLoginFolder = (instance: ProviderInstanceConfig | undefined): string =>
  readConfigString(instance, "homePath") || claudeConfigDirVariable(instance) || "";

/** Clients see a stored key as a redaction marker or secret reference, never as an empty value. */
export const claudeUsesApiKey = (instance: ProviderInstanceConfig | undefined): boolean => {
  const config = instance?.config;
  const apiKey =
    config !== null && typeof config === "object"
      ? (config as Record<string, unknown>).apiKey
      : undefined;
  return (
    (typeof apiKey === "string" ? apiKey.trim().length > 0 : apiKey != null) ||
    (instance?.environment?.some(
      (variable) =>
        variable.name === "ANTHROPIC_API_KEY" &&
        (variable.valueRedacted === true ||
          typeof variable.value !== "string" ||
          variable.value.trim().length > 0),
    ) ??
      false)
  );
};

/** Where a new Claude account keeps its login, e.g. `~/.claude_personal` for `claudeAgent_personal`. */
export const separateClaudeLoginFolder = (instanceId: string): string => {
  const slug =
    instanceId
      .replace(/^claudeAgent_?/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "account";
  return `~/.claude_${slug}`;
};

/**
 * Names of the other Claude entries that sign in through the same folder as `instanceId`.
 * API-key entries don't use the login, so they never count as sharing it.
 */
export const claudeEntriesSharingLogin = (
  instances: Readonly<Record<string, ProviderInstanceConfig>>,
  instanceId: string,
): ReadonlyArray<string> => {
  const entries: Record<string, ProviderInstanceConfig> = {
    // The built-in entry exists even before anyone saves settings for it.
    [DEFAULT_INSTANCE_ID]: {
      driver: CLAUDE_DRIVER,
      ...instances[DEFAULT_INSTANCE_ID],
    } as ProviderInstanceConfig,
    ...Object.fromEntries(Object.entries(instances).filter(([id]) => id !== DEFAULT_INSTANCE_ID)),
  };
  const self = entries[instanceId];
  if (!self || claudeUsesApiKey(self)) return [];
  const folder = claudeLoginFolder(self);
  return Object.entries(entries)
    .filter(
      ([id, instance]) =>
        id !== instanceId &&
        instance.driver === CLAUDE_DRIVER &&
        instance.enabled !== false &&
        !claudeUsesApiKey(instance) &&
        claudeLoginFolder(instance) === folder,
    )
    .map(
      ([id, instance]) =>
        instance.displayName?.trim() || (id === DEFAULT_INSTANCE_ID ? "Claude" : id),
    );
};
