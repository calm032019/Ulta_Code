# Claude

Ulta Code uses Claude Code's login and configuration. Start with the default provider
for one account; [provider setup](./install.md#providers) covers installation and
shared provider settings.

## Sign in

Open **Settings > Providers**, select Claude, and choose **Sign in with Claude** under
**Claude account**. Then:

1. Choose **Open Claude sign-in page** and sign in with the account you want.
2. Claude shows a code. Copy it, paste it into Ulta Code, and choose **Finish sign-in**.

The sign-in page can use a different account from the one your browser is already
signed in to. On a remote connection, the login is saved on the connected server.

## A second Claude account

Choose **Add provider**, pick Claude, then **Sign in with a Claude account**. Give it a
name such as Personal, then sign in as above. Each account added this way gets its own
login folder, so your first Claude stays signed in as it is. Both appear in the model
picker.

If a second Claude shows the same email as the first, the two share a login folder.
Open it in **Settings > Providers** and choose **Use a different account**, then sign in.

Threads can switch only between Claude entries that share a login. Separate accounts
keep their own conversation history.

To set the folder yourself, put a path such as `~/.claude_personal` in
**CLAUDE_CONFIG_DIR path**. An empty path uses Claude Code's normal configuration.

For presets that differ only in endpoints, use the instance's **Environment variables**.
Variable assignments do not belong in **Launch arguments**.

## Subscription and API credits side by side

To keep your subscription and also pay per use with Anthropic API credits, choose
**Add provider**, pick Claude, then **Use an API key**. Paste a key from
[console.anthropic.com](https://console.anthropic.com/settings/keys); it starts with
`sk-ant-`. Both appear in the model picker, and a thread can switch between them.
The key stays on the machine running Ulta Code. To change it later, edit the **API key**
field in that Claude's settings.

Claude Code's verbose mode can stay enabled when you use Claude for text generation, including
thread titles, branch names, commit messages, and pull request descriptions. On a remote connection,
Ulta Code uses the Claude configuration on the connected server.

## Compact long conversations

Set **Auto-compact after** in the Claude provider settings to an integer between
`100000` and `1000000`. For example, `300000` asks Claude to summarize at about
300,000 tokens. This changes when compaction happens, not the model's context
window. Leave it empty for Claude Code's default.

You can also send `/compact` in an existing conversation. Web and desktop offer
**Compact context** from the context meter. The meter is off by default; see
[commands and skills](./composer.md#commands-and-skills) to enable it. Claude Code
compacts automatically whether the meter is on or off.

When you return to a large thread after Claude's prompt cache expires, a
**Compact** chip with the thread's token count shows
next to the send button. While it is on, Enter summarizes the history first, then
sends your message. Click the chip to switch it to **Full** and keep the full
history for that message. The cache lasts about an hour on a Claude
subscription and 5 minutes with an API key, Bedrock, or Vertex. See [commands and skills](./composer.md#commands-and-skills) for using
composer commands.

**Compact idle threads** in **Settings > Providers > Advanced** controls this for threads
over 200,000 tokens. Each Claude provider's settings can override it:

- **When you return** shows the **Compact** chip described above. This is the default.
- **Before the cache expires (beta)** compacts an idle thread shortly before its
  prompt cache expires, so coming back does not reprocess the whole conversation.
  The compaction appears in the thread as a `/compact` turn sent by Ulta Code.
- **Never** skips idle compaction and Claude's resume prompt. **Auto-compact after**
  still applies, and you can still compact by hand.

## Usage limits

If your Claude subscription runs out of usage mid-turn, the thread shows which
limit was reached and the remaining wait when Claude provides a reset time.
Claude Code holds the turn until that window reopens, so it can keep showing as
working. Wait for the reset, or stop the turn and continue later. The warning's
timestamp shows when the displayed wait started.

## Skills

Claude skills come from the config directory's `skills` folder and the project's
`.claude/skills` folder. If both define the same name, the config-directory copy
wins. Skills disabled in Claude's settings do not appear in the composer.

Use `$` in the composer to select a skill. Enabled installed Claude plugins also
contribute skills under names such as `plugin:review`. Skills marked `disable-model-invocation`
can still be started by you. Invoke those one per message: Claude directly runs
only the last named skill and may try to start earlier ones through its Skill
tool, which refuses skills reserved for manual invocation.

## Task lists

To show Claude task lists in the web and desktop apps, add
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` under **Variables** in the Claude instance's
**Environment** section in **Settings > Providers**. Each update shows as a Tasks
row in the thread; open it to see every step.

## OpenRouter

Create a Claude instance with its own config directory, such as
`~/.claude_openrouter`, and keep **Binary path** set to `claude`. In that instance's
**Environment variables**, use:

| Variable               | Value                                     |
| ---------------------- | ----------------------------------------- |
| `ANTHROPIC_BASE_URL`   | `https://openrouter.ai/api`               |
| `ANTHROPIC_AUTH_TOKEN` | Your OpenRouter API key, marked Sensitive |
| `ANTHROPIC_API_KEY`    | An explicitly empty value                 |

If that Claude config directory has a cached Anthropic login, run `/logout` in a
Claude Code session using that directory before starting the router setup. Cached
login credentials can conflict with the router token.

Select the model you want in Ulta Code. For an OpenRouter model outside the built-in
list, open that Claude instance in **Settings > Providers** and add its full model
ID with **Add custom model**. Then select it in the chat model picker.
`ANTHROPIC_DEFAULT_*_MODEL` variables map Claude Code aliases such as `sonnet`; they
do not replace the explicit model ID selected in Ulta Code. Custom models may have
fewer effort, thinking, or context controls than built-in models.

Verify the model used in OpenRouter's activity dashboard. For current compatibility
requirements, use the
[OpenRouter Claude Code guide](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration).

## Other routers

A local router uses an ordinary Claude provider instance. Give it a separate
config directory and put the router's endpoint and credential variables in that
instance's **Environment variables**. The router must run where the environment
can reach it. Follow the [Claude Code Router instructions](https://github.com/musistudio/claude-code-router)
for its installation and routing configuration.
