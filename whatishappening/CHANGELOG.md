# Changelog

All notable changes to this mod. Versions follow [Semantic Versioning](https://semver.org).

## Unreleased

## 0.4.2 - 2026-11-06

- Timeline: a message an agent or Claude Code sent in place of a prompt reads as words, such as `Report from Explore: Find the auth code`, not as its raw tags.
- Context files: two files of one name show as many folders as tell them apart (`…/app/hooks`, `…/lib/hooks`), so they no longer look like the same file twice.

## 0.4.1 - 2026-11-05

- Timeline: "live" shows once, in the section's header, and each prompt's recap sits on its own line under it, so a long prompt no longer pushes it onto a line of its own.

## 0.4.0 - 2026-11-05

- **Timeline section:** what happened, prompt by prompt. The latest prompt is told event by event, and the earlier ones in one line each (`1m 30s · 12 calls · 2 edits · 1 error`).
- Events in a row of one kind read as one line: `Read 3 files: a.ts, c.ts +1`, `Ran 4 commands, last: npm test`.
- Each event has a mark of its own (✎ edit, $ command, ⌕ search, ⇄ connector, ◆ agent started, ◇ agent finished, ✓ step done, ✗ failed, ⊘ blocked), and a subagent's events carry its type.

## 0.3.0 - 2026-11-05

- **`/sessions`** opens a Sessions pane: your recent Claude Code sessions grouped by the folder each ran in, this folder first, each with its title (or its first prompt) and how long ago it ran.
- Press a session of this folder to get `/resume <id>` in the prompt box, one Enter away. A session of another folder shows the command to run in a terminal, `cd <folder> && claude --resume <id>`, since `/resume` only finds the sessions of the folder Claude Code started in.

## 0.2.0 - 2026-11-05

- **NOW line** on top of the pane: the step Claude is on, how many agents are at work and the 5-hour usage, or IDLE when nothing runs.
- **A color per section** (Usage blue, To-do orange, Context files purple, Connectors green, Agents indigo, Skills amber), from the Claude Code theme, on its border, its dot and its summary. A section's border dims while nothing in it moves.
- **Summaries in each header:** `5h 2% · 7d 8%`, `2/4 · 50%`, `3 · 38 calls`, `2 running · 1 done`.
- **Empty sections take no room.**
- The Usage bars fill in the mod's purple, `#4f049a`, until 70%.
- A new session shows the 5-hour and 7-day limits right away, from the latest reading any session saw, marked `as of 15:02` until its own first reply. A window that has reset since shows `reset at 18:20` instead of an old number.
- **Live agent clocks** in the terminal, ticking each second by themselves with a turning mark while the agent works. The desktop app and VS Code show the time at each redraw.
- **Agents side by side:** two or three agents sit in one row when the pane is wide enough.
- **Activity lanes:** with more than three agents, each one gets a lane on a shared time axis, and its bars show how many calls it made in each moment.

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
