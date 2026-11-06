/** One call to a connector. */
export type CallRow = {
  /** The tool in plain words: "search issues". */
  what: string
  /** Its main argument, short; '' when it has none. */
  arg: string
  /** Milliseconds since the epoch; 0 when unknown (calls read back from the history). */
  at: number
}

/** How often one connector, file or skill was used. */
export type Tally = {
  count: number
  /** When it was last used, as a running count: the higher, the more recent. */
  last: number
  /** Connectors only: the latest calls, oldest first. */
  calls?: CallRow[]
  /** Loaded when the chat started (a CLAUDE.md, or a skill it imports). */
  auto?: boolean
}

/** What this chat used, by name. */
export type Used = {
  connectors: Record<string, Tally>
  files: Record<string, Tally>
  skills: Record<string, Tally>
}

export type PlanStep = {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  /** TodoWrite's present-tense text, shown while the step runs. */
  active?: string
  /** The id TaskCreate gave it, which TaskUpdate names the step by. */
  id?: string
}

export type Plan = {
  title: string
  steps: PlanStep[]
  /** Epoch milliseconds of the latest change, or 0 while nothing changed. */
  updatedAt: number
}

/** One subagent of this chat and what it is doing. */
export type AgentRow = {
  id: string
  /** general-purpose, Explore, ... */
  type: string
  description: string
  /** running, waiting, idle, completed, failed, killed, pending. */
  status: string
  /** Its latest tool call, short: "Read register.tsx". */
  doing: string
  tools: number
  /** When it was first seen; 0 for a row rebuilt from the history, whose start is unknown. */
  startedAt: number
  /** Order of last activity: higher is newer. */
  seq: number
  /** True once agent.spawn or the history named it: the chat started it, so it is no engine fork. */
  known?: boolean
  /** True once $.agent.list() named it; a workflow's agents never are, so leaving the list is no sign they ended. */
  listed?: boolean
  /** What it runs on, as the engine names it: "claude-opus-5-5", or an alias such as "haiku". */
  model?: string
  /** Tokens its finished runs spent: input, output and cache, summed. */
  tokens?: number
  /** When its run ended; absent while it runs. */
  endedAt?: number
  /** Its latest steps, oldest first; while it runs, the last is the one it is on. */
  trail?: string[]
  /** Its own to-do list, when it keeps one (TodoWrite, TaskCreate or the plan tool). */
  plan?: PlanStep[]
  /** When it made its latest tool calls, oldest first, for its activity lane. */
  beats?: number[]
}

/** One rate-limit window. */
export type LimitRow = {
  /** 0 to 100. */
  percent: number
  /** Epoch milliseconds, or 0 when not known. */
  resetsAt: number
  /** Set on a reading kept from an earlier session: when it was taken. */
  asOf?: number
}

export type UsageView = {
  fiveHour: LimitRow | null
  sevenDay: LimitRow | null
  contextTokens: number
  contextWindow: number
  /** Tokens the main transcript spent, one count per API response. */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** When the figures were read; the countdowns count from it. */
  at: number
}

/** One thing that happened, for the timeline. */
export type StoryEvent = {
  /** Epoch milliseconds. */
  at: number
  /** `say`: what Claude wrote to the person between its calls; `prompt`: one typed while it answered; `notice`: a background task's report. */
  kind: 'read' | 'edit' | 'run' | 'search' | 'web' | 'connector' | 'agent' | 'agent-done' | 'step' | 'error' | 'deny' | 'other' | 'say' | 'notice' | 'prompt'
  /** What it was about, short: a file name, a command, a step, Claude's words. */
  text: string
  /** The agent type, for an event of a subagent's. */
  who?: string
}

/** A command Claude left running in the background, until its report comes or it is stopped. */
export type BackgroundTask = {
  /** The engine's task id, as its result and its report name it. */
  id: string
  /** Its description, or the command. */
  what: string
  startedAt: number
}

/** One prompt of the main chat and what happened while Claude answered it. */
export type StoryTurn = {
  id: string
  /** The prompt's start, short; '' for the entry opened after a reload. */
  prompt: string
  startedAt: number
  /** When the answer ended; absent while it runs. */
  endedAt?: number
  /** Oldest first; capped. */
  events: StoryEvent[]
}

/** One earlier Claude Code session. */
export type SessionRow = {
  id: string
  /** Its title as Claude Code named it (or the person renamed it); '' when it has none yet. */
  title: string
  /** When its transcript last changed, epoch milliseconds. */
  at: number
}

/** The recent sessions, grouped by the folder each ran in, the most recent folder first. */
export type SessionList = {
  groups: { cwd: string; items: SessionRow[] }[]
  /** When the list was read; 0 before the first read. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'whatishappening': {
      used: Used
      agents: AgentRow[]
      usage: UsageView
      plan: Plan
      /** The connector whose calls are shown; '' for none. */
      open: string
      /** Sections the person closed. */
      folded: string[]
      /** The timeline: the latest prompts and what happened during each. */
      story: StoryTurn[]
      /** The main chat's commands running in the background. */
      background: BackgroundTask[]
      /** The recent sessions the Sessions pane lists. */
      sessions: SessionList
      /** The session from another folder whose resume command is shown; '' for none. */
      shown: string
    }
  }
}
