import type { ReactNode } from "react";

import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { formatContextWindowCost } from "../chat/ContextWindowMeter.logic";

function formatPercent(value: number): string {
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

interface Segment {
  readonly label: string;
  readonly tokens: number;
  readonly swatchClassName: string;
}

/** Splits the window into used, the auto-compact reserve, and what is left. */
export function contextWindowSegments(usage: ContextWindowSnapshot): Segment[] | null {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  if (maxTokens === null) return null;
  const used = Math.min(maxTokens, Math.max(0, usage.usedTokens));
  const threshold = usage.autoCompactThreshold ?? null;
  const buffer =
    threshold !== null && threshold > 0 && threshold < maxTokens
      ? Math.min(maxTokens - threshold, maxTokens - used)
      : 0;
  const free = Math.max(0, maxTokens - used - buffer);
  return [
    { label: "Used", tokens: used, swatchClassName: "bg-info" },
    ...(buffer > 0
      ? [{ label: "Autocompact buffer", tokens: buffer, swatchClassName: "bg-muted-foreground/45" }]
      : []),
    { label: "Free space", tokens: free, swatchClassName: "bg-muted-foreground/15" },
  ];
}

function TokenRow(props: {
  readonly label: string;
  readonly value: string;
  readonly share?: string;
  readonly swatchClassName?: string;
}) {
  return (
    <div className="col-span-3 grid grid-cols-subgrid items-center py-1">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {props.swatchClassName ? (
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-xs", props.swatchClassName)} />
        ) : null}
        <span className="truncate">{props.label}</span>
      </span>
      <span className="text-end font-medium text-foreground/80 tabular-nums">{props.value}</span>
      <span className="text-end text-muted-foreground tabular-nums">{props.share ?? ""}</span>
    </div>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-medium text-muted-foreground text-2xs uppercase tracking-wide">
        {props.title}
      </h3>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] gap-x-3 text-xs">
        {props.children}
      </div>
    </section>
  );
}

function optionalRows(
  rows: ReadonlyArray<readonly [label: string, value: number | null | undefined]>,
): Array<readonly [string, number]> {
  return rows.filter((row): row is readonly [string, number] => row[1] != null && row[1] > 0);
}

export function ContextWindowPanel(props: { readonly usage: ContextWindowSnapshot | null }) {
  const { usage } = props;
  if (usage === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm">
        Context usage shows up after the agent's first reply.
      </div>
    );
  }

  const segments = contextWindowSegments(usage);
  const maxTokens = segments === null ? null : (usage.maxTokens ?? null);
  const usedPercentage =
    maxTokens !== null ? Math.min(100, (Math.max(0, usage.usedTokens) / maxTokens) * 100) : null;
  const sessionRows = optionalRows([
    ["Input", usage.inputTokens],
    ["Cached input", usage.cachedInputTokens],
    ["Output", usage.outputTokens],
    ["Reasoning", usage.reasoningOutputTokens],
    ["Total processed", usage.totalProcessedTokens],
  ]);
  const lastTurnRows = optionalRows([
    ["Input", usage.lastInputTokens],
    ["Cached input", usage.lastCachedInputTokens],
    ["Output", usage.lastOutputTokens],
    ["Reasoning", usage.lastReasoningOutputTokens],
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-foreground text-sm tabular-nums">
            {usedPercentage !== null
              ? `${formatPercent(usedPercentage)} used`
              : `${formatContextWindowTokens(usage.usedTokens)} used`}
          </span>
          {maxTokens !== null ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatContextWindowTokens(usage.usedTokens)} / {formatContextWindowTokens(maxTokens)}
            </span>
          ) : null}
        </div>
        {segments !== null && maxTokens !== null ? (
          <>
            <div
              className="flex h-1.5 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Context window usage"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(usedPercentage ?? 0)}
            >
              {segments.map((segment) =>
                segment.tokens > 0 ? (
                  <span
                    key={segment.label}
                    className={segment.swatchClassName}
                    style={{ width: `${(segment.tokens / maxTokens) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_3.5rem] gap-x-3 text-xs">
              {segments.map((segment) => (
                <TokenRow
                  key={segment.label}
                  label={segment.label}
                  swatchClassName={segment.swatchClassName}
                  value={formatContextWindowTokens(segment.tokens)}
                  share={formatPercent((segment.tokens / maxTokens) * 100)}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            This provider does not report its context window size.
          </p>
        )}
      </section>

      {sessionRows.length > 0 || usage.toolUses != null || usage.cost != null ? (
        <Section title="Session">
          {sessionRows.map(([label, value]) => (
            <TokenRow key={label} label={label} value={formatContextWindowTokens(value)} />
          ))}
          {usage.toolUses != null ? (
            <TokenRow label="Tool uses" value={usage.toolUses.toLocaleString("en-US")} />
          ) : null}
          {usage.cost != null ? (
            <TokenRow label="Cost" value={formatContextWindowCost(usage.cost)} />
          ) : null}
        </Section>
      ) : null}

      {lastTurnRows.length > 0 ? (
        <Section title="Last turn">
          {lastTurnRows.map(([label, value]) => (
            <TokenRow key={label} label={label} value={formatContextWindowTokens(value)} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}
