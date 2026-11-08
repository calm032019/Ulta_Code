import {
  ProviderSetupError,
  type ClaudeSettings,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { makeClaudeEnvironment } from "./ClaudeHome.ts";

const SIGN_IN_METHOD_ID = "claudeai";
const LOGIN_URL_PATTERN = /https:\/\/\S+\/oauth\/authorize\?\S+/;

/** `claude auth login` prints the manual sign-in link when it cannot rely on its own browser tab. */
export const findClaudeLoginUrl = (output: string): string | undefined =>
  output.match(LOGIN_URL_PATTERN)?.[0];

/** People paste the `code#state` text Claude shows, or the whole page address. Claude wants the former. */
export const normalizeClaudeLoginCode = (pasted: string): string => {
  const trimmed = pasted.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (code) return state ? `${code}#${state}` : code;
  } catch {
    // Not a URL after all; hand it to Claude unchanged.
  }
  return trimmed;
};

/** Claude prints its reason after the paste prompt on the same line, e.g. `> Login failed: …`. */
export const claudeLoginFailure = (output: string): string => {
  const reason = output
    .replaceAll("Paste code here if prompted >", "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !LOGIN_URL_PATTERN.test(line))
    .at(-1)
    ?.replace(/^Login failed:\s*/i, "");
  return reason || "Claude didn't accept the sign-in. Try again.";
};

export const makeClaudeAuth = Effect.fn("makeClaudeAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly settings: ClaudeSettings;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly configDir: string;
  readonly cwd: string;
  /** Re-probe the account once the login on disk changes. */
  readonly onChanged: Effect.Effect<void>;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail });

  const runClaude = Effect.fnUntraced(function* (
    args: ReadonlyArray<string>,
    stdin?: Stream.Stream<string>,
  ) {
    const env = yield* makeClaudeEnvironment(options.settings, options.processEnv).pipe(
      Effect.provideService(Path.Path, path),
    );
    // An API key outranks the subscription login, so signing in would change nothing.
    delete env.ANTHROPIC_API_KEY;
    // Claude opens BROWSER instead of the system browser. A missing command stops it opening a
    // tab on the server, so every client follows the same open-page-then-paste-code flow.
    env.BROWSER = "ulta-code-opens-sign-in";
    const spawnCommand = yield* resolveSpawnCommand(options.settings.binaryPath, args, { env });
    return yield* spawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env,
          cwd: options.cwd,
          shell: spawnCommand.shell,
          ...(stdin ? { stdin: { stream: Stream.encodeText(stdin) } } : {}),
          forceKillAfter: "1 second",
        }),
      )
      .pipe(
        Effect.mapError(() =>
          failure("start", "Claude Code is not installed on this machine, so it can't sign in."),
        ),
      );
  });

  const authenticate = Effect.fn("ClaudeAuth.authenticate")(function* (
    _methodId: string,
    context: ProviderAuthFlow.ProviderAuthFlowContext,
  ) {
    if (options.settings.apiKey.length > 0)
      return yield* failure(
        "start",
        "This Claude uses an API key, so it doesn't need a Claude sign-in. Remove the key to sign in with an account instead.",
      );
    const codes = yield* Queue.unbounded<string>();
    const child = yield* runClaude(["auth", "login", "--claudeai"], Stream.fromQueue(codes));
    const linkShown = yield* Deferred.make<void>();
    let output = "";
    yield* child.all.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          output = (output + chunk).slice(-16_384);
          const url = findClaudeLoginUrl(output);
          if (!url || (yield* Deferred.isDone(linkShown))) return;
          yield* Deferred.succeed(linkShown, undefined);
          yield* context.setInteraction(
            {
              type: "browser",
              id: "claude-login",
              url,
              requiresConsent: false,
              acceptsCallback: true,
            },
            undefined,
            (pasted) => {
              const code = normalizeClaudeLoginCode(pasted);
              return code.length === 0
                ? Effect.fail(failure("complete", "Paste the code Claude showed you."))
                : Queue.offer(codes, `${code}\n`).pipe(Effect.andThen(context.verifying));
            },
          );
        }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    );
    const exitCode = yield* child.exitCode.pipe(
      Effect.mapError(() => failure("start", "Claude sign-in stopped unexpectedly. Try again.")),
    );
    if (exitCode !== 0) {
      return yield* failure("start", claudeLoginFailure(output));
    }
    yield* context.verifying;
    yield* options.onChanged;
  });

  const logout = Effect.scoped(
    Effect.gen(function* () {
      const child = yield* runClaude(["auth", "logout"]);
      const exitCode = yield* child.exitCode.pipe(Effect.orElseSucceed(() => 1));
      if (exitCode !== 0) return yield* failure("logout", "Claude could not sign out. Try again.");
      yield* options.onChanged;
    }),
  );

  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    // Instances that share a config directory share one Claude login.
    credentialBinding: { owner: "provider", key: `claude:${options.configDir}` },
    methods: Effect.succeed([
      {
        id: SIGN_IN_METHOD_ID,
        name: "Claude account",
        description: "Sign in with your Claude Pro or Max subscription.",
        type: "agent",
      },
    ]),
    defaultMethodId: SIGN_IN_METHOD_ID,
    authenticate,
    logout,
    timeoutMs: 600_000,
  });
});
