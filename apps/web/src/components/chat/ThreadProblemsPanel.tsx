import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { CircleXIcon, TriangleAlertIcon } from "lucide-react";

import { useEnvironmentScope } from "../../state/session";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  buildFixProblemsPrompt,
  groupProblemsByFile,
  MAX_FIX_PROBLEMS,
  problemsScriptBody,
  suggestProblemsCommands,
  type Problem,
} from "./problems.logic";
import { cancelProblemsRun, startProblemsRun, useProblemsRunStore } from "./problemsRunStore";

const MAX_SHOWN_PROBLEMS = 200;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Runs the project's own checker in a terminal and turns its errors into agent prompts. */
export function ThreadProblemsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly onRunCommand: (
    terminalInput: string,
    replaceTerminalId: string | null,
  ) => Promise<string | null>;
  readonly onFixWithAgent: (prompt: string) => void;
}) {
  const threadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const key = scopedThreadKey(threadRef);
  const canOperate = useEnvironmentScope(props.environmentId, AuthTerminalOperateScope);
  const canRead = useEnvironmentScope(props.environmentId, AuthTerminalReadScope);
  const storedCommand = useProblemsRunStore((state) => state.commandByThreadKey[key]);
  const run = useProblemsRunStore((state) => state.runByThreadKey[key]);
  const setCommand = useProblemsRunStore((state) => state.setCommand);
  const packageJson = useProjectFileQuery(props.environmentId, props.cwd, "package.json");
  const packageJsonText =
    packageJson.data && !packageJson.data.truncated ? packageJson.data.contents : null;
  const suggestions = suggestProblemsCommands(packageJsonText);
  const command = storedCommand ?? suggestions[0] ?? "";
  const scriptBody = problemsScriptBody(packageJsonText, command);
  const running = run?.status === "running";
  const canRun = canOperate && canRead && command.trim().length > 0 && !running;

  const runCheck = () => {
    if (!canRun) return;
    void startProblemsRun({
      threadRef,
      command: command.trim(),
      cwd: props.cwd,
      launch: props.onRunCommand,
    });
  };

  const problems = run?.status === "finished" ? run.problems : [];
  const shown = problems.slice(0, MAX_SHOWN_PROBLEMS);
  const groups = groupProblemsByFile(shown);
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const fix = (selected: ReadonlyArray<Problem>) =>
    props.onFixWithAgent(buildFixProblemsPrompt(selected, run?.command ?? command));

  return (
    <ThreadDetailsSection
      headingId="thread-details-problems-heading"
      title="Problems"
      actions={
        running ? (
          <ThreadDetailsControl
            size="xs"
            variant="ghost"
            part="meta"
            onClick={() => cancelProblemsRun(threadRef)}
          >
            Stop waiting
          </ThreadDetailsControl>
        ) : (
          <ThreadDetailsControl
            size="xs"
            variant="ghost"
            part="meta"
            disabled={!canRun}
            onClick={runCheck}
          >
            Run
          </ThreadDetailsControl>
        )
      }
    >
      <div className="flex flex-col gap-1.5 px-2.5">
        <Input
          size="compact"
          font="mono"
          aria-label="Command to check for problems"
          placeholder="Command, e.g. npm run lint"
          value={command}
          disabled={running}
          onChange={(event) => setCommand(threadRef, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runCheck();
          }}
        />
        {suggestions.length > 1 && !running ? (
          <div className="flex flex-wrap gap-1">
            {suggestions
              .filter((suggestion) => suggestion !== command)
              .map((suggestion) => (
                <ThreadDetailsControl
                  key={suggestion}
                  size="xs"
                  variant="ghost"
                  part="meta"
                  onClick={() => setCommand(threadRef, suggestion)}
                >
                  {suggestion}
                </ThreadDetailsControl>
              ))}
          </div>
        ) : null}
        {scriptBody !== null && !running ? (
          <p className="m-0 min-w-0 text-2xs text-muted-foreground">
            Runs this project's script (and any pre or post hooks):{" "}
            <code className="break-all font-mono">{scriptBody}</code>
          </p>
        ) : null}
        <p className="m-0 text-2xs text-muted-foreground" role="status">
          {!canOperate || !canRead
            ? "You need terminal access on this environment to run checks."
            : run === undefined
              ? "Runs in a new terminal in this thread's workspace."
              : run.status === "running"
                ? "Running in a terminal…"
                : run.status === "failed"
                  ? run.error
                  : problems.length > 0
                    ? `${plural(errors, "error")}, ${plural(problems.length - errors, "warning")} in ${plural(
                        groupProblemsByFile(problems).length,
                        "file",
                      )}${problems.length > shown.length ? ` (showing ${shown.length})` : ""}.`
                    : run.exitCode === 0
                      ? "No problems found."
                      : `Exited with code ${run.exitCode ?? "unknown"}, but no problems were recognised in the output.`}
        </p>
      </div>
      {groups.length > 0 ? (
        <>
          <div className="px-2.5 pt-1.5">
            <ThreadDetailsControl
              size="xs"
              variant="ghost"
              part="meta"
              onClick={() => fix(shown.slice(0, MAX_FIX_PROBLEMS))}
            >
              {shown.length > MAX_FIX_PROBLEMS
                ? `Fix first ${MAX_FIX_PROBLEMS} with agent`
                : "Fix all shown with agent"}
            </ThreadDetailsControl>
          </div>
          <div className="mt-1 max-h-72 overflow-y-auto">
            {groups.map((group) => (
              <details key={group.file} open={groups.length <= 3}>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-medium text-foreground/85 hover:bg-black/[0.035] dark:hover:bg-white/[0.08]">
                  <span className="min-w-0 flex-1 truncate font-mono">{group.file}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {group.problems.length}
                  </span>
                </summary>
                <ul className="m-0 list-none p-0">
                  {group.problems.map((problem) => (
                    <li key={`${problem.line}:${problem.column}:${problem.message}`}>
                      <Tooltip>
                        <TooltipTrigger
                          delay={300}
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="row"
                              multiline
                              aria-label={`Fix with agent: ${group.file}:${problem.line} ${problem.message}`}
                              onClick={() => fix([problem])}
                            />
                          }
                        >
                          {problem.severity === "error" ? (
                            <CircleXIcon aria-hidden className="size-3.5 text-destructive" />
                          ) : (
                            <TriangleAlertIcon aria-hidden className="size-3.5 text-warning" />
                          )}
                          <span className="min-w-0 flex-1 text-xs font-normal leading-4 whitespace-normal text-foreground/85">
                            <span className="me-1.5 font-mono text-muted-foreground tabular-nums">
                              {problem.line}
                              {problem.column === null ? "" : `:${problem.column}`}
                            </span>
                            {problem.message}
                          </span>
                        </TooltipTrigger>
                        <TooltipPopup side="left">
                          Fix with agent: adds a prompt to the composer
                        </TooltipPopup>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </>
      ) : null}
    </ThreadDetailsSection>
  );
}
