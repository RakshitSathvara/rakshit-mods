# rakshit-mods

Claude Code mods by Rakshit.

```sh
claude plugin marketplace add RakshitSathvara/rakshit-mods
claude plugin install super-bar@rakshit-mods --scope user
```

Run `/reload-plugins` in any open session. When a new version comes out, run `claude plugin marketplace update rakshit-mods`, then `claude plugin update super-bar@rakshit-mods`.

## Mods

- [super-bar](super-bar/README.md): Claude Code's task list as a dotted progress bar above the prompt. Click it for Token Weather: context, plan limits, the last turn's tokens and what fills context. Needs Claude Code 2.1.287 or later, and on newer models the task tools; its README says how to turn them on.
