import { normalizeTerminalOutput, terminalOutputPlainText } from "@t3tools/shared/terminalOutput";

export type ProblemSeverity = "error" | "warning";

export interface Problem {
  readonly file: string;
  readonly line: number;
  readonly column: number | null;
  readonly severity: ProblemSeverity;
  readonly code: string | null;
  readonly message: string;
}

export interface ProblemFileGroup {
  readonly file: string;
  readonly problems: ReadonlyArray<Problem>;
  readonly errors: number;
  readonly warnings: number;
}

export const MAX_FIX_PROBLEMS = 20;
export const MAX_PARSED_PROBLEMS = 1_000;
const MAX_OUTPUT_CHARS = 1024 * 1024;

const TSC_CLASSIC = /(\S+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/;
const TSC_PRETTY = /(\S+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s*(.*)$/;
const STYLISH_FILE = /^(?:\/|[A-Za-z]:[\\/]|\.{1,2}[\\/])?[^\s:]+\.[A-Za-z0-9]+$/;
const STYLISH_ROW = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/;
// oxlint/miette ("  x rule(name): msg") and rustc ("error[E0308]: msg") headers precede a location line.
const DIAGNOSTIC_HEADER =
  /^\s*(?:([x×!⚠‼])\s+(?:([\w@/-]+\([\w@/-]+\)):\s+)?|(error|warning)(?:\[(\w+)\])?:\s+)(.+)$/;
const DIAGNOSTIC_LOCATION = /^\s*(?:,-|╭─|-->)\s*\[?([^\s[\]]+?):(\d+):(\d+)\]?\s*$/;
const GENERIC = /(?:^|\s)([^\s:()[\]'"]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?(?::|\s+-)?\s+(.+)$/;
const SEVERITY_PREFIX = /^(fatal error|error|warning|warn)\b:?\s*/i;
const ESLINT_UNIX_SUFFIX = /\s*\[(Error|Warning)\/([^\]]+)\]\s*$/;

function normalizeFile(file: string, cwd: string | null): string {
  let next = file.replace(/:$/, "");
  if (cwd) {
    const root = cwd.replace(/[\\/]+$/, "");
    if (next.startsWith(`${root}/`) || next.startsWith(`${root}\\`)) {
      next = next.slice(root.length + 1);
    }
  }
  return next.replace(/^\.[\\/]/, "");
}

function severityOf(value: string | undefined): ProblemSeverity {
  return value !== undefined && /^(warn|warning|!|⚠)$/i.test(value) ? "warning" : "error";
}

function genericProblem(match: RegExpExecArray, cwd: string | null): Problem | null {
  const [, file, line, column, rest] = match;
  let message = rest!.trim();
  let severity: ProblemSeverity = "error";
  let code: string | null = null;
  const prefix = SEVERITY_PREFIX.exec(message);
  if (prefix) {
    severity = severityOf(prefix[1]!.replace(/^fatal /i, ""));
    message = message.slice(prefix[0].length);
  }
  const eslintSuffix = ESLINT_UNIX_SUFFIX.exec(message);
  if (eslintSuffix) {
    severity = severityOf(eslintSuffix[1]);
    code = eslintSuffix[2]!;
    message = message.slice(0, eslintSuffix.index);
  }
  if (message.length === 0) return null;
  return {
    file: normalizeFile(file!, cwd),
    line: Number(line),
    column: column === undefined ? null : Number(column),
    severity,
    code,
    message,
  };
}

/** Reads problems from plain checker output; lines no format recognises are ignored. */
export function parseProblems(output: string, options?: { cwd?: string | null }): Problem[] {
  const cwd = options?.cwd ?? null;
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const add = (problem: Problem) => {
    const key = `${problem.file}\0${problem.line}\0${problem.column}\0${problem.message}`;
    if (seen.has(key) || problems.length >= MAX_PARSED_PROBLEMS) return;
    seen.add(key);
    problems.push(problem);
  };

  let stylishFile: string | null = null;
  let pending: Omit<Problem, "file" | "line" | "column"> | null = null;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trimEnd();
    if (line.trim().length === 0) {
      stylishFile = null;
      continue;
    }
    const previous = pending;
    pending = null;

    const tsc = TSC_CLASSIC.exec(line) ?? TSC_PRETTY.exec(line);
    if (tsc) {
      const [, file, row, column, severity, code, message] = tsc;
      add({
        file: normalizeFile(file!, cwd),
        line: Number(row),
        column: Number(column),
        severity: severityOf(severity),
        code: code!,
        message: message!.trim(),
      });
      continue;
    }

    if (stylishFile !== null) {
      const row = STYLISH_ROW.exec(line);
      if (row) {
        const [, lineNumber, column, severity, message, rule] = row;
        add({
          file: stylishFile,
          line: Number(lineNumber),
          column: Number(column),
          severity: severityOf(severity),
          code: rule ?? null,
          message: message!.trim(),
        });
        continue;
      }
    }

    const location = DIAGNOSTIC_LOCATION.exec(line);
    if (location) {
      if (previous) {
        add({
          ...previous,
          file: normalizeFile(location[1]!, cwd),
          line: Number(location[2]),
          column: Number(location[3]),
        });
      }
      continue;
    }

    const header = DIAGNOSTIC_HEADER.exec(line);
    if (header) {
      const [, glyph, rule, word, rustCode, message] = header;
      pending = {
        severity: severityOf(glyph ?? word),
        code: rule ?? rustCode ?? null,
        message: message!.trim(),
      };
      continue;
    }

    if (STYLISH_FILE.test(line)) {
      stylishFile = normalizeFile(line, cwd);
      continue;
    }

    const generic = GENERIC.exec(line);
    if (generic) {
      const problem = genericProblem(generic, cwd);
      if (problem) add(problem);
    }
  }
  return problems;
}

export function groupProblemsByFile(problems: ReadonlyArray<Problem>): ProblemFileGroup[] {
  const groups = new Map<string, Problem[]>();
  for (const problem of problems) {
    const group = groups.get(problem.file);
    if (group) group.push(problem);
    else groups.set(problem.file, [problem]);
  }
  return Array.from(groups, ([file, entries]) => {
    const errors = entries.filter((problem) => problem.severity === "error").length;
    return { file, problems: entries, errors, warnings: entries.length - errors };
  });
}

export function formatProblemLocation(problem: Problem): string {
  return `${problem.file}:${problem.line}${problem.column === null ? "" : `:${problem.column}`}`;
}

function formatProblem(problem: Problem): string {
  const code = problem.code === null ? "" : ` ${problem.code}`;
  return `- ${formatProblemLocation(problem)} ${problem.severity}${code}: ${problem.message}`;
}

export function buildFixProblemsPrompt(problems: ReadonlyArray<Problem>, command: string): string {
  const shown = problems.slice(0, MAX_FIX_PROBLEMS);
  const single = shown.length === 1;
  return [
    single
      ? `Fix this problem reported by \`${command}\`:`
      : `Fix these ${shown.length} problems reported by \`${command}\`:`,
    "",
    ...shown.map(formatProblem),
    "",
    single
      ? `Keep the change focused on this problem, then rerun \`${command}\` to confirm it is fixed.`
      : `Keep the changes focused on these problems, then rerun \`${command}\` to confirm they are fixed.`,
  ].join("\n");
}

const PROBLEMS_SCRIPT_NAMES = ["typecheck", "type-check", "check", "lint"];

function packageScriptRunner(packageManager: unknown): (script: string) => string {
  const name = typeof packageManager === "string" ? packageManager.split("@")[0] : null;
  if (name === "pnpm") return (script) => `pnpm run ${script}`;
  if (name === "yarn") return (script) => `yarn run ${script}`;
  if (name === "bun") return (script) => `bun run ${script}`;
  return (script) => `npm run ${script}`;
}

/** Commands for the package.json scripts that usually report problems, most likely first. */
export function suggestProblemsCommands(packageJson: string | null): string[] {
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
  return PROBLEMS_SCRIPT_NAMES.filter(
    (name) => typeof (scripts as Record<string, unknown>)[name] === "string",
  ).map(run);
}

const PROBLEMS_EXIT_MARKER = "__T3_PROBLEMS_EXIT__";
const PROBLEMS_EXIT_PATTERN = new RegExp(`${PROBLEMS_EXIT_MARKER}:(\\d+|True|False)`);

/** Shell input that runs the check and then prints a marker carrying its exit status. */
export function problemsTerminalCommand(command: string): string {
  return `${command.trim()}; echo "${PROBLEMS_EXIT_MARKER}:$?"`;
}

export interface ProblemsRunOutput {
  readonly exitCode: number | null;
  readonly output: string;
}

/** The finished run's plain output, or null while the exit marker has not been printed. */
export function readProblemsRunOutput(terminalText: string): ProblemsRunOutput | null {
  const plain = terminalOutputPlainText(
    normalizeTerminalOutput(terminalText, MAX_OUTPUT_CHARS).text,
  );
  const exit = PROBLEMS_EXIT_PATTERN.exec(plain);
  if (!exit) return null;
  // The echoed input line holds the marker unexpanded; output starts after it.
  const echoed = plain.lastIndexOf(`${PROBLEMS_EXIT_MARKER}:$?`, exit.index);
  const start = echoed === -1 ? 0 : plain.indexOf("\n", echoed) + 1;
  const status = exit[1]!;
  return {
    exitCode: /^\d+$/.test(status) ? Number(status) : status === "True" ? 0 : 1,
    output: plain.slice(start, exit.index),
  };
}

/** Cheap raw-text check so callers only normalise once the marker has arrived. */
export function hasProblemsExitMarker(terminalText: string): boolean {
  return PROBLEMS_EXIT_PATTERN.test(terminalText);
}
