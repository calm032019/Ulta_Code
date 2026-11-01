import { formatDuration } from "@t3tools/shared/orchestrationTiming";

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  return formatDuration(elapsedSeconds * 1_000);
}

/** How long a running turn can go without new activity before the working row says so. */
const QUIET_TURN_NOTICE_AFTER_MS = 120_000;

export function formatQuietTurnNow(lastActivityIso: string): string {
  const quietMs = Date.now() - Date.parse(lastActivityIso);
  if (!Number.isFinite(quietMs) || quietMs < QUIET_TURN_NOTICE_AFTER_MS) return "";
  return ` · no updates for ${formatDuration(Math.floor(quietMs / 60_000) * 60_000)}`;
}

export function formatWorkingTimerNow(startIso: string): string {
  return formatWorkingTimer(startIso, new Date().toISOString()) ?? "0s";
}
