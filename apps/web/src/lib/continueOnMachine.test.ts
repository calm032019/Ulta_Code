import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { continueOnMachineTargets } from "./continueOnMachine";

const desktop = EnvironmentId.make("env-desktop");
const laptop = EnvironmentId.make("env-laptop");
const server = EnvironmentId.make("env-server");
const labels = new Map([
  [desktop, "Desktop"],
  [laptop, "Laptop"],
  [server, "Build server"],
]);

function project(
  environmentId: EnvironmentId,
  id: string,
  options: { remote?: string; archived?: boolean; scratch?: boolean } = {},
) {
  const remote = options.remote ?? "github.com/acme/app";
  return {
    environmentId,
    id: ProjectId.make(id),
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: {
      canonicalKey: remote,
      locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: remote },
    },
    archivedAt: options.archived ? "2026-01-01T00:00:00.000Z" : null,
    ...(options.scratch ? { isScratch: true as const } : {}),
  };
}

function targets(input: {
  projects: ReturnType<typeof project>[];
  connected?: EnvironmentId[];
  canOperate?: (environmentId: EnvironmentId) => boolean;
}) {
  return continueOnMachineTargets({
    sourceProject: input.projects[0]!,
    projects: input.projects,
    groupingSettings: {
      sidebarProjectGroupingMode: "repository",
      sidebarProjectGroupingOverrides: {},
    },
    connectedEnvironmentIds: input.connected ?? [desktop, laptop, server],
    canOperate: input.canOperate ?? (() => true),
    labelOf: (environmentId) => labels.get(environmentId) ?? environmentId,
  });
}

describe("continueOnMachineTargets", () => {
  it("offers each other machine with the same repository once, sorted by name", () => {
    expect(
      targets({
        projects: [
          project(desktop, "source"),
          project(laptop, "laptop-a"),
          project(laptop, "laptop-b"),
          project(server, "server-a"),
          project(desktop, "desktop-other-checkout"),
        ],
      }),
    ).toEqual([
      { environmentId: server, projectId: ProjectId.make("server-a"), label: "Build server" },
      { environmentId: laptop, projectId: ProjectId.make("laptop-a"), label: "Laptop" },
    ]);
  });

  it("skips other repositories, archived copies, disconnected machines and read-only grants", () => {
    expect(
      targets({
        projects: [
          project(desktop, "source"),
          project(laptop, "other-repo", { remote: "github.com/acme/other" }),
          project(laptop, "archived", { archived: true }),
          project(server, "server-a"),
        ],
        canOperate: (environmentId) => environmentId !== server,
      }),
    ).toEqual([]);
    expect(
      targets({
        projects: [project(desktop, "source"), project(server, "server-a")],
        connected: [desktop],
      }),
    ).toEqual([]);
  });

  it("offers nothing for a thread without a project", () => {
    expect(
      targets({
        projects: [project(desktop, "scratch", { scratch: true }), project(laptop, "laptop-a")],
      }),
    ).toEqual([]);
  });
});
