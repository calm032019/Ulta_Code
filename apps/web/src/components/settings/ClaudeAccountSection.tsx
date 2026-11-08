import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useRef, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsRow } from "./settingsLayout";

function Step(props: {
  readonly number: number;
  readonly title: string;
  readonly done?: boolean;
  readonly children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary"
      >
        {props.done ? <CheckIcon className="size-3.5" /> : props.number}
      </span>
      <div className="grid min-w-0 flex-1 gap-2">
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        {props.children}
      </div>
    </li>
  );
}

/**
 * Signs a Claude instance in to a Claude subscription without a terminal. The server runs
 * `claude auth login`; this shows its sign-in page and takes the code Claude hands back.
 */
export function ClaudeAccountSection({
  environmentId,
  instanceId,
  provider,
  usesApiKey,
  sharedWith,
  onSeparateAccount,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly usesApiKey: boolean;
  /** Names of other Claude entries that read the same login, so signing in here changes them too. */
  readonly sharedWith: ReadonlyArray<string>;
  /** Gives this entry its own login folder. Resolves false when that failed. */
  readonly onSeparateAccount?: (() => Promise<boolean>) | undefined;
  readonly readOnly: boolean;
}) {
  const target = { environmentId, input: { instanceId } };
  const query = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const commands = { reportFailure: false, reportDefect: false };
  const start = useAtomCommand(serverEnvironment.startProviderAuth, commands);
  const complete = useAtomCommand(serverEnvironment.completeProviderAuth, commands);
  const cancel = useAtomCommand(serverEnvironment.cancelProviderAuth, commands);
  const logout = useAtomCommand(serverEnvironment.logoutProviderAuth, commands);
  const [code, setCode] = useState({ flowId: "", value: "" });
  const [pageOpened, setPageOpened] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const auth = query.data;
  const active =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const signedIn = !usesApiKey && provider?.auth.status === "authenticated";
  const email = provider?.auth.email?.trim();
  const url = auth?.interaction?.type === "browser" ? auth.interaction.url : null;
  const flowId = auth?.flowId ?? "";
  const codeValue = code.flowId === flowId ? code.value : "";
  const disabled = readOnly || pending || query.error !== null;
  const notInstalled = provider !== undefined && !provider.installed;

  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let succeeded = false;
    try {
      const result = await command();
      if (result._tag === "Success") succeeded = true;
      else if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
      }
    } catch {
      setError("Sign-in failed. Try again.");
    }
    pendingRef.current = false;
    setPending(false);
    return succeeded;
  }

  const mustSeparate = sharedWith.length > 0 && onSeparateAccount !== undefined;

  async function signIn() {
    await run(() => start(target));
  }

  async function separate() {
    if (!onSeparateAccount || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const saved = await onSeparateAccount().catch(() => false);
    if (!saved) setError("Couldn't give this Claude its own login. Try again.");
    pendingRef.current = false;
    setPending(false);
  }

  async function openPage() {
    if (!url) return;
    try {
      await ensureLocalApi().shell.openExternal(url);
      setPageOpened(flowId);
    } catch {
      setError("Couldn't open your browser. Copy the link below into it instead.");
    }
  }

  const description = usesApiKey
    ? "This Claude uses an API key, so it doesn't need a Claude account."
    : active
      ? auth?.phase === "verifying"
        ? "Checking your account…"
        : auth?.phase === "starting"
          ? "Getting the Claude sign-in page ready…"
          : "Follow the two steps below."
      : signedIn
        ? null
        : notInstalled
          ? "Claude Code isn't installed on this computer yet."
          : "Not signed in. Sign in with your Claude Pro or Max account to use it here.";

  return (
    <SettingsRow
      title="Claude account"
      description={
        signedIn && !active ? (
          <span>
            Signed in as{" "}
            {email ? (
              <RedactedSensitiveText
                key={email}
                value={email}
                ariaLabel="Toggle account email visibility"
                revealTooltip="Click to reveal email"
                hideTooltip="Click to hide email"
                className="max-w-full truncate"
              />
            ) : (
              "your Claude account"
            )}
            .
          </span>
        ) : (
          <span role="status">{description}</span>
        )
      }
      status={
        auth?.phase === "failed" && auth.message && !active ? (
          <p role="status" className="[overflow-wrap:anywhere]">
            {auth.message}
          </p>
        ) : undefined
      }
      control={
        usesApiKey ? null : mustSeparate && !active ? (
          <Button size="sm" disabled={disabled} onClick={() => void separate()}>
            Use a different account
          </Button>
        ) : active && flowId ? (
          <Button
            size="sm"
            variant="ghost-muted"
            disabled={disabled}
            onClick={() => void run(() => cancel({ environmentId, input: { instanceId, flowId } }))}
          >
            Cancel
          </Button>
        ) : signedIn ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => void signIn()}>
              Switch account
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                void ensureLocalApi()
                  .dialogs.confirm(
                    `Sign out of ${email ?? "this Claude account"}? Running Claude threads that use this account stop. Their history is kept.`,
                  )
                  .then((confirmed) => {
                    if (confirmed) void run(() => logout(target));
                  });
              }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            disabled={disabled || notInstalled || provider?.enabled === false}
            onClick={() => void signIn()}
          >
            {auth?.phase === "failed" ? "Try again" : "Sign in with Claude"}
          </Button>
        )
      }
    >
      {!usesApiKey && !active && sharedWith.length > 0 ? (
        <p className="pb-2 text-xs text-muted-foreground">
          This shares its Claude login with {sharedWith.join(", ")}, so both show the same account.{" "}
          {mustSeparate
            ? "Choose Use a different account, then sign in. The other stays signed in as it is."
            : "Signing in here changes the account for both."}
        </p>
      ) : null}
      {auth?.phase === "waiting" && url ? (
        <ol className="grid gap-4 py-3">
          <Step number={1} title="Sign in on the Claude website" done={pageOpened === flowId}>
            <p className="text-xs text-muted-foreground">
              Use the Claude account you want here. You can sign in to a different account than the
              one in your browser.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={disabled} onClick={() => void openPage()}>
                Open Claude sign-in page
              </Button>
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Page didn't open?</summary>
              <p className="pt-1">Copy this link into your browser:</p>
              <Input
                size="sm"
                readOnly
                value={url}
                aria-label="Claude sign-in link"
                onFocus={(event) => event.currentTarget.select()}
              />
            </details>
          </Step>
          <Step number={2} title="Copy the code Claude shows you and paste it here">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!codeValue.trim()) return;
                void run(() =>
                  complete({
                    environmentId,
                    input: { instanceId, flowId, callbackUrl: codeValue.trim() },
                  }),
                );
              }}
            >
              <Input
                size="sm"
                className="min-w-0 flex-1"
                placeholder="Paste the code here"
                aria-label="Code from Claude"
                autoComplete="off"
                value={codeValue}
                disabled={disabled}
                maxLength={16_384}
                onChange={(event) => setCode({ flowId, value: event.target.value })}
              />
              <Button type="submit" size="sm" disabled={disabled || !codeValue.trim()}>
                Finish sign-in
              </Button>
            </form>
          </Step>
        </ol>
      ) : null}
      {error || query.error ? (
        <p role="alert" className="py-2 text-xs text-destructive">
          {error ?? query.error}
        </p>
      ) : null}
    </SettingsRow>
  );
}
