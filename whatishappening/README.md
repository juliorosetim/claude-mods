# What is happening

[![License: MIT](https://img.shields.io/badge/License-MIT-4f049a.svg)](../LICENSE)
![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-d97757.svg)
![Surfaces](https://img.shields.io/badge/runs%20in-terminal%20%7C%20desktop%20%7C%20VS%20Code-2563eb.svg)

**See at a glance what your Claude Code chat is doing.** It shows how much of your plan you have used, where the task stands, which agents are working and what they touch, all in a pane beside the chat.

![The What is happening pane in the terminal](../docs/pane.png)

## Why

A long Claude Code session hides a lot: how close you are to the usage limit, which step of the job Claude is on, what each subagent is doing right now, and which connectors and files it pulled in. Usually you scroll back or guess. *What is happening* keeps all of it on screen and updates it live.

## Features

### At a glance
- **The NOW line** on top says what is happening this second: the step Claude is on, how many agents are at work and the 5-hour usage. With nothing running it reads IDLE.
- **Each section has its own color,** from your Claude Code theme, so light, dark and colorblind themes all read. Its header carries a summary (`2/4 · 50%`, `2 running · 1 done`), and its border dims while nothing in it moves.
- **Sections with nothing to show take no room.**

### Usage
- **5-hour and 7-day limits:** the percentage used, a bar that turns amber at 70% and red at 90%, the time left and the exact reset time (`in 2h15 · 14:30`).
- **Context:** how full the context window is.
- **Session tokens:** input, output, cache read and cache write, each API response counted once. No dollar values.

### Task progress
- **To-do:** the plan for the current job, with ✓ done, ● in progress and ○ pending.
- **Progress band:** a line above the prompt, `Tasks 3/5 60%` with a bar, so you can follow the job without opening the pane. It stays at 100% for 20 seconds after the last step, then hides.

![The progress band above the prompt](../docs/band.png)

### Agents
Every subagent the chat starts gets a card of its own, live ones first:

```
╭──────────────────────────────────────────╮
│ ● Explore                       ◐ 1m 05s │
│ Find the auth code                       │
│ Opus 5.5 · 6 tools · 12.4k tokens        │
│                                          │
│ ✓ Read todo.py                           │
│ ✓ Grep "def add"                         │
│ ● Bash python -m pytest -q               │
╰──────────────────────────────────────────╯
```

- **Top of the card:** the agent type and how long it has run, then its task. In the terminal the clock ticks by itself.
- **Facts:** the model, how many tool calls it made and the tokens it spent.
- **Latest steps:** ✓ for the ones it finished, ● for the one it is on.
- **Its own to-do list:** when the agent keeps one (TodoWrite, the Task tools or the plan tool), the card shows that list with a progress bar instead. An agent does not say in advance how many steps it will take, so there is no made-up percentage.
- **Layout:**
  - two or three agents sit side by side when the pane is wide enough;
  - with more than three, each agent gets an **activity lane** on a shared time axis.

```
● Map the hooks     ▂▅█▇▃·····              ◐ 0m 42s
✓ Review README     ▃▆▄▂                       0m 18s
● Count tests          ·▁▃▅▇█▆▃▁            ◐ 0m 31s
```

A bar's height is how many calls the agent made in that moment, so you can see who is busy, who is waiting and who is done.

Agents started by workflows show too.

### Connectors, files and skills
- **Connectors:** each MCP server the chat called, with the number of calls. Press a name to see its latest calls and their arguments.
- **Context files:** the files Claude read, plus the ones loaded at start, such as `CLAUDE.md`.
- **Skills:** the skills used and how many times, by the Skill tool or by a typed slash command.

Every section folds with its header.

![The pane in VS Code](../docs/vscode.png)

### Timeline
What happened, prompt by prompt, at the bottom of the pane:

```
09:41  look at the parser            1m 30s · 2 calls
14:02  now fix it                                live
›  Read 3 files: a.ts, c.ts +1
✎  Edited a.ts
◆  Check the tests  · Explore
›  Read parser.test.ts  · Explore
$  Ran npm test
✓  Step done: Fix the parser
```

- **Earlier prompts:** one line each, with how long Claude took, the calls it made, the edits and the errors.
- **The latest prompt:** event by event. Events in a row of one kind become one line, so five reads are `Read 5 files`, not five lines.
- **Marks:** ✎ edit, $ command, ⌕ search, › read, ◍ web, ⇄ connector, ◆ agent started, ◇ agent finished, ✓ step done, ✗ failed, ⊘ blocked. A subagent's events carry its type.

### Sessions
`/sessions` opens a second pane with your recent sessions, grouped by the folder each one ran in, this folder first. Each row has the session's title, or its first prompt, and how long ago it ran. The chat you are in is marked.

- **A session of this folder:** press it, and `/resume <id>` lands in the prompt box. Press Enter to pick it up.
- **A session of another folder:** `/resume` only finds the sessions of the folder Claude Code started in, so the pane shows the command to run in a terminal instead: `cd <folder> && claude --resume <id>`.
- **↻** reads the list again.

## Install

In Claude Code:

```
/plugin marketplace add juliorosetim/claude-mods
/plugin install whatishappening@julio-mods
```

Run `/reload-plugins`, or start a new session. The pane opens by itself the first time the chat uses a connector, file, skill, agent or plan. You can also open it any time with:

```
/whatishappening
```

## Updating

Claude Code keeps a copy of each installed mod and checks the version in `plugin.json` to decide whether there is a new one. See the [CHANGELOG](./CHANGELOG.md) for what changed in each version.

**Automatic (recommended):** run `/plugin`, open the **Marketplaces** tab, select `julio-mods` and choose **Enable auto-update**. It is off by default for marketplaces that are not Anthropic's official ones. Once it is on, Claude Code checks for new versions in the background after the first message of a session, within about ten minutes, and the new version loads in your next session or after `/reload-plugins`.

**By hand,** from a shell:

```
claude plugin marketplace update julio-mods
claude plugin update whatishappening@julio-mods
```

The new version loads in your next session, or after `/reload-plugins` in a running one.

## The plan tool

The mod gives Claude a tool, `mcp__whatishappening__plan`, and asks it to use the tool for any job with three or more steps. Claude sends the whole list each time a step starts or finishes, and the To-do section and the band draw from it. Claude Code's own `TodoWrite`, `TaskCreate` and `TaskUpdate` also feed the list.

If Claude works without a plan, or leaves the plan untouched for eight tool calls, the mod adds a short reminder to the tool result. Only the model sees it. Subagents are never asked to plan.

## Privacy

Everything runs on your machine. The mod reads the session through the Claude Code mod API and reads token counts from the session transcript in `~/.claude/projects`. It sends nothing anywhere. Errors go to `~/.claude/mods-logs/whatishappening.log`.

## Notes

- Works in the terminal, the desktop app and VS Code. Outside the terminal the progress bar is drawn as an image, so it keeps its width.
- After `/reload-plugins` the counts are rebuilt from the chat history, so they never double. They also survive `/compact`.
- Subagents' tokens are not in the session total yet; only the main chat's are.

## Development

```
claude plugin validate whatishappening
claude plugin test whatishappening
```

The hooks live in `hooks/register.tsx`, the stored state is typed in `types/index.d.ts`, and the tests are in `hooks/register.test.tsx`.

## License

[MIT](../LICENSE) © Julio Rosetim
