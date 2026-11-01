import { PLAIN_LANGUAGE_MAX_MESSAGES } from "@t3tools/contracts";

/**
 * The contiguous run of messages from the anchor to the current one, in timeline order. A run
 * longer than the cap keeps the messages nearest the anchor.
 */
export function selectMessageRange(
  orderedIds: ReadonlyArray<string>,
  anchorId: string,
  currentId: string,
  max: number = PLAIN_LANGUAGE_MAX_MESSAGES,
): { readonly ids: ReadonlyArray<string>; readonly capped: boolean } {
  const anchor = orderedIds.indexOf(anchorId);
  if (anchor < 0) return { ids: [], capped: false };
  const current = orderedIds.indexOf(currentId);
  const target = current < 0 ? anchor : current;
  const capped = Math.abs(target - anchor) + 1 > max;
  const end = capped ? anchor + Math.sign(target - anchor) * (max - 1) : target;
  return {
    ids: orderedIds.slice(Math.min(anchor, end), Math.max(anchor, end) + 1),
    capped,
  };
}
