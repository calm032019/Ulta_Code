import { describe, expect, it } from "vite-plus/test";

import { guessScriptPort, suggestPreviewServers } from "./previewServerSuggestions";

describe("guessScriptPort", () => {
  it.each([
    ["vite", 5173],
    ["vite preview", 4173],
    ["next dev -p 4000", 4000],
    ["next dev", 3000],
    ["astro dev --port=4500", 4500],
    ["PORT=8888 node server.js", 8888],
    ["storybook dev", 6006],
    ["ng serve", 4200],
    ["webpack serve --mode development", 8080],
  ])("%s → %i", (body, port) => {
    expect(guessScriptPort(body)).toBe(port);
  });
});

describe("suggestPreviewServers", () => {
  it("suggests serving scripts with the package manager's runner, skipping saved ones", () => {
    const packageJson = JSON.stringify({
      packageManager: "pnpm@9.0.0",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview", start: "node ." },
    });
    expect(suggestPreviewServers(packageJson, ["pnpm run start"])).toEqual([
      { name: "dev", command: "pnpm run dev", previewUrl: "http://localhost:5173" },
      { name: "preview", command: "pnpm run preview", previewUrl: "http://localhost:4173" },
    ]);
  });

  it("returns nothing for a missing or unreadable package.json", () => {
    expect(suggestPreviewServers(null, [])).toEqual([]);
    expect(suggestPreviewServers("{not json", [])).toEqual([]);
  });
});
