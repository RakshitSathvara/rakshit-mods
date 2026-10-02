# super-bar

A Claude Code mod that draws the session's task list as a dotted progress bar above the prompt. Click the bar to open Token Weather under it: how full the context window is, your plan limits, the last turn's tokens, and what fills the context.

```
● Running tests      ⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿ Tasks 3/5 ⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿   40% 9: ▴ ×
  ☂  Showers  67% of context  134.4k / 200k   last turns ▂▃▅█  ▲ +98.3k last turn
  context    ⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿│⣿⣿⣿⣿ ☂ 134.4k ⣿│⣿⣿⣿   67%
  5h limit   ⣿⣿⣿⣿⣿⣿ resets 14:30 ⣿⣿⣿⣿⣿⣿⣿⣿⣿   38%
  7d limit   ⣿ resets Mon 09:00 ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿   12%
  last turn  in 2.1k  out 1.8k  cache read 128.9k  cache write 1.6k   ≈ $1.84 this session
  in context messages 98.2k  tools 18.1k  MCP 9.4k  memory 3.1k  system 2.9k
```

The pill names the task Claude is on and the figure is the share done, so two of five done reads `Tasks 3/5` and `40%`. A finished batch turns green (`✓ Done 9/9`) and stays as its own row once Claude starts new tasks, until you dismiss it.

## Before you start

- Claude Code 2.1.287 or later (`claude --version`).
- The task tools. Claude Code only provides them by default on older models (Opus 4–4.7, Sonnet 4–4.6, Haiku 4.5). On newer ones, turn them on in `~/.claude/settings.json`, which covers the terminal and the Desktop app alike:

  ```json
  { "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
  ```

  Merge the `env` key into your existing settings rather than replacing the file. Without the tools the bar says "Tasks off" and Token Weather still works. The tool definitions take some context of their own; open the panel and the "tools" figure in the "in context" row shows how much.

## Try it

```sh
claude --plugin-dir ./super-bar
```

The folder is watched, so saving a file reloads the mod in place.

## Install it for every session

```sh
claude plugin marketplace add RakshitSathvara/rakshit-mods
claude plugin install super-bar@rakshit-mods --scope user
```

Run `/reload-plugins` in any open session. When a new version comes out, run `claude plugin marketplace update rakshit-mods`, then `claude plugin update super-bar@rakshit-mods`.

## Use it

- **Click the bar** (Desktop app, or a terminal in fullscreen rendering, which is where mouse support lives) to open or close Token Weather.
- **Press 9** at an empty prompt to do the same from the keyboard.
- **×** hides the bar until Claude creates the next task. On a finished batch's row it hides that row.
- **/taskbar** shows a hidden bar, **/taskbar tokens** opens the panel, **/taskbar hide** hides it.

## What it reaches

`claude plugin validate ./super-bar` lists every call: `$.command.register`, `$.session.messages`, `$.session.usage`, `$.state`, `$.tool.list` and `$.ui.resolve`. It reads no files, starts no processes, makes no network requests and calls no model, so it spends no tokens. The "in context" row uses the local `summary` estimate, which sends no token-count requests.

## Limits

- After `/resume` the tasks are rebuilt from the transcript's newest 4,096 entries.
- A task call from a subagent can't be told apart from one in the main conversation, so it counts too.
- Plan limits show on a subscription; with an API key the panel has no limit rows.
- The cost is the API-equivalent figure `/cost` reports; on a subscription it's notional.

## Develop

```sh
claude plugin validate ./super-bar
claude plugin test ./super-bar
```

`hooks/tasks-bar.mjs` handles the events, keeps state and lays out the band. `hooks/bar.mjs` is the `Client` module that draws each dotted row and turns a click into a message. Claude Code writes type declarations for your build into `.claude-plugin/types/` the first time it loads the mod.
