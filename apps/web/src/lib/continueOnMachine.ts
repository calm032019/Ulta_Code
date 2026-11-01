import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  deriveLogicalProjectKeyFromSettings,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

type ProjectLike = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch" | "archivedAt"
>;

export interface ContinueOnMachineTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly label: string;
}

/** Other connected machines with the same project, where this client may start threads. */
export function continueOnMachineTargets(input: {
  readonly sourceProject: ProjectLike;
  readonly projects: ReadonlyArray<ProjectLike>;
  readonly groupingSettings: ProjectGroupingSettings;
  readonly connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly canOperate: (environmentId: EnvironmentId) => boolean;
  readonly labelOf: (environmentId: EnvironmentId) => string;
}): ReadonlyArray<ContinueOnMachineTarget> {
  if (input.sourceProject.isScratch) return [];
  const logicalKey = deriveLogicalProjectKeyFromSettings(
    input.sourceProject,
    input.groupingSettings,
  );
  const connected = new Set(input.connectedEnvironmentIds);
  const targets = new Map<EnvironmentId, ContinueOnMachineTarget>();
  for (const project of input.projects) {
    const { environmentId } = project;
    if (
      environmentId === input.sourceProject.environmentId ||
      targets.has(environmentId) ||
      project.archivedAt != null ||
      project.isScratch ||
      !connected.has(environmentId) ||
      deriveLogicalProjectKeyFromSettings(project, input.groupingSettings) !== logicalKey ||
      !input.canOperate(environmentId)
    )
      continue;
    targets.set(environmentId, {
      environmentId,
      projectId: project.id,
      label: input.labelOf(environmentId),
    });
  }
  return [...targets.values()].toSorted((a, b) => a.label.localeCompare(b.label));
}
