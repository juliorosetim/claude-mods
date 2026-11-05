# Changelog

All notable changes to this mod. Versions follow [Semantic Versioning](https://semver.org).

## Unreleased

## 0.1.1 - 2026-11-05

- New look on desktop and VS Code: section titles instead of native buttons, the 5-hour and 7-day limits as two tiles with rounded bars, and the latest call under each connector.
- Meters turn amber from 70% and red from 90%.
- Colors follow the Claude Code theme.
- New section order: Usage, To-do, Context files, Connectors, Agents, Skills.
- Each agent is a card of its own: its type and run time, its task, the model, tool calls and tokens, then its latest steps (✓ done, ● the one it is on). When the agent keeps its own to-do list, the card shows that list with a progress bar instead.
- The plan tool, called by a subagent, saves that agent's list on its card and leaves the main chat's list alone.
- The plan tool and its reminders have new wording.
- Session tokens are read every 30 s, so they show during a long first turn.
- The home folder shows as `~` in what an agent is doing, so the pane never shows the account's full path.

## 0.1.0 - 2026-11-05

First release.

- **What is happening** pane with Usage, To-do, Agents, Connectors, Context files and Skills sections.
- Usage shows the 5-hour and 7-day limits with the time left and the reset time, the context, and the session tokens.
- Progress band above the prompt, drawn as an image outside the terminal.
- `mcp__whatishappening__plan` tool, with reminders when Claude works without a plan.
- Counts rebuilt from the chat history after `/reload-plugins`, so they never double.
