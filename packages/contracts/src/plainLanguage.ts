import * as Schema from "effect/Schema";

import { MessageId, ThreadId } from "./baseSchemas.ts";

export const PLAIN_LANGUAGE_MAX_MESSAGES = 20;

export const PlainLanguageExplainInput = Schema.Struct({
  threadId: ThreadId,
  messageIds: Schema.Array(MessageId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PLAIN_LANGUAGE_MAX_MESSAGES),
  ),
});
export type PlainLanguageExplainInput = typeof PlainLanguageExplainInput.Type;

export const PlainLanguageExplainResult = Schema.Struct({
  explanation: Schema.String,
});
export type PlainLanguageExplainResult = typeof PlainLanguageExplainResult.Type;

export class PlainLanguageExplainError extends Schema.TaggedError<PlainLanguageExplainError>()(
  "PlainLanguageExplainError",
  {
    message: Schema.String,
  },
) {}
