export interface PreviewServerSuggestion {
  readonly name: string;
  readonly command: string;
  readonly previewUrl: string;
}

const SERVER_SCRIPT_NAMES = ["dev", "start", "serve", "preview", "storybook", "docs:dev"];

// Checked in order, so a more specific tool wins over one it wraps (`vite preview` before `vite`).
const DEFAULT_PORTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bstorybook\b/, 6006],
  [/\bvite\s+preview\b/, 4173],
  [/\b(vite|vp|svelte-kit|vitepress)\b/, 5173],
  [/\bastro\b/, 4321],
  [/\bng\s+serve\b/, 4200],
  [/\bgatsby\b/, 8000],
  [/\bexpo\b/, 8081],
  [/\b(webpack(-dev-server)?\s+serve|webpack-dev-server|http-server|eleventy|parcel)\b/, 8080],
];

function packageScriptRunner(packageManager: unknown): (script: string) => string {
  const name = typeof packageManager === "string" ? packageManager.split("@")[0] : null;
  if (name === "pnpm") return (script) => `pnpm run ${script}`;
  if (name === "yarn") return (script) => `yarn run ${script}`;
  if (name === "bun") return (script) => `bun run ${script}`;
  return (script) => `npm run ${script}`;
}

export function guessScriptPort(body: string): number {
  const explicit =
    /(?:--port[=\s]+|\s-p\s+|\bPORT=)(\d{2,5})\b/.exec(body)?.[1] ??
    /\blocalhost:(\d{2,5})\b/.exec(body)?.[1];
  if (explicit) return Number.parseInt(explicit, 10);
  return DEFAULT_PORTS.find(([pattern]) => pattern.test(body))?.[1] ?? 3000;
}

/** Package scripts that look like they serve a page, minus commands already saved as servers. */
export function suggestPreviewServers(
  packageJson: string | null,
  existingCommands: ReadonlyArray<string>,
): ReadonlyArray<PreviewServerSuggestion> {
  if (packageJson === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const { scripts, packageManager } = parsed as { scripts?: unknown; packageManager?: unknown };
  if (typeof scripts !== "object" || scripts === null) return [];
  const run = packageScriptRunner(packageManager);
  const existing = new Set(existingCommands.map((command) => command.trim()));
  return SERVER_SCRIPT_NAMES.flatMap((name) => {
    const body = (scripts as Record<string, unknown>)[name];
    if (typeof body !== "string") return [];
    const command = run(name);
    if (existing.has(command)) return [];
    return [{ name, command, previewUrl: `http://localhost:${guessScriptPort(body)}` }];
  });
}
