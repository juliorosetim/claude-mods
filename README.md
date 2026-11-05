# claude-mods

[![License: MIT](https://img.shields.io/badge/License-MIT-4f049a.svg)](./LICENSE)
![Claude Code mods](https://img.shields.io/badge/Claude%20Code-mods-d97757.svg)

Mods for [Claude Code](https://code.claude.com/docs/en/plugins/mods/overview), shared as a plugin marketplace.

## Mods

### [What is happening](./whatishappening)

A pane beside the chat that shows what Claude is doing:
- the 5-hour and 7-day usage limits, with their reset times;
- the session tokens;
- the task plan;
- the agents at work and the call each one is making;
- the connectors, files and skills the chat used.

A band above the prompt shows the task progress.

![The What is happening pane](./docs/pane.png)

## Install

In Claude Code:

```
/plugin marketplace add juliorosetim/claude-mods
/plugin install whatishappening@julio-mods
```

Then run `/reload-plugins`, or start a new session, and type `/whatishappening`.

## Updating

See [Updating](./whatishappening/README.md#updating) in the mod's README, and its [CHANGELOG](./whatishappening/CHANGELOG.md).

## Releasing a change

The repository has a pre-commit hook that versions each mod. Turn it on once per clone:

```
git config core.hooksPath .githooks
```

Then, when a commit changes a mod's code:
- the hook raises the patch version in its `plugin.json` (`0.1.0` to `0.1.1`);
- the notes under `## Unreleased` in its `CHANGELOG.md` become that version's section.

For a minor or major release, set the version yourself in the same commit, and the hook keeps it. Changes to docs only (`README.md`, `CHANGELOG.md`, `LICENSE`, `docs/`) leave the version alone.

## License

[MIT](./LICENSE) © Julio Rosetim
