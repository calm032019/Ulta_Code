export const FIND_IN_CODEBASE_PROMPT_PREFIX = "Find in codebase: ";

/** The first message of a "Find in codebase" thread; its first line becomes the thread title. */
export function buildFindInCodebasePrompt(question: string): string {
  const trimmed = question.trim();
  const titleLine = trimmed.split("\n", 1)[0]!.trim();
  return [
    `${FIND_IN_CODEBASE_PROMPT_PREFIX}${titleLine}`,
    "",
    "Question:",
    trimmed,
    "",
    "This is a read-only search. Do not create, edit, move or delete any files, and do not run commands that change anything. Only read and search.",
    "",
    "Search by meaning, not only by exact keywords: follow names, call sites, types and related concepts until you are confident you have found where this lives.",
    "",
    "Answer with a list of the most relevant places, most relevant first, at most ten. Write each one as:",
    "",
    "- `path/to/file.ts:12-48`: one line on why it is relevant",
    "",
    "Use paths relative to the project root and line ranges that cover the relevant code. Finish with one or two sentences that answer the question directly. If nothing in the codebase matches, say so instead of guessing.",
  ].join("\n");
}
