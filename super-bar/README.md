# super-bar

A Claude Code mod that draws the session's task list as a progress bar above the prompt: the task Claude is on, a track that fills as tasks finish with a pill naming the count, and the share done.

```
● Running tests      ⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿ Tasks 3/5 ⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿   40% ×
```

The pill names the task Claude is on and the figure is the share done, so two of five done reads `Tasks 3/5` and `40%`. The Desktop app draws the track as a pixel bar; the terminal draws it as dotted text, as above. Once every task in the batch is done the bar goes away, until Claude starts new tasks.

## Before you start

- Claude Code 2.1.287 or later (`claude --version`).
- The task tools. Claude Code only provides them by default on older models (Opus 4–4.7, Sonnet 4–4.6, Haiku 4.5). On newer ones, turn them on in `~/.claude/settings.json`, which covers the terminal and the Desktop app alike:

  ```json
  { "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
  ```

  Merge the `env` key into your existing settings rather than replacing the file. Without the tools the bar says "Tasks off". The tool definitions take some context of their own; `/context` shows how much.

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

- **×** hides the bar until Claude creates the next task.
- **/taskbar** shows a hidden bar, **/taskbar hide** hides it.

## What it reaches

`claude plugin validate ./super-bar` lists every call: `$.command.register`, `$.session.messages`, `$.state`, `$.tool.list` and `$.ui.resolve`. It reads no files, starts no processes, makes no network requests and calls no model, so it spends no tokens.

## Limits

- After `/resume` the tasks are rebuilt from the transcript's newest 4,096 entries.
- A task call from a subagent can't be told apart from one in the main conversation, so it counts too.

## Develop

```sh
claude plugin validate ./super-bar
claude plugin test ./super-bar
```

`hooks/tasks-bar.mjs` handles the events, keeps state and lays out the band. `hooks/track.mjs` draws the Desktop app's pixel track as SVG, and `hooks/bar.mjs` the terminal's dotted bar. Claude Code writes type declarations for your build into `.claude-plugin/types/` the first time it loads the mod.

## Credits

The Desktop app's pixel track is adapted from [plan-progress](https://github.com/zycck/claude-mods) by Kirill Serditov, under the MIT License; `LICENSE` carries its notice.
