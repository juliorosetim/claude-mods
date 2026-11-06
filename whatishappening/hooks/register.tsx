import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { AgentRow, BackgroundTask, CallRow, LimitRow, Plan, PlanStep, SessionList, SessionRow, Tally, UsageView, Used } from '../types'

const PLUGIN = 'whatishappening'
const PANE = 'whatishappening'
const TITLE = 'What is happening'
const SECTIONS = ['usage', 'todo', 'background', 'files', 'connectors', 'agents', 'skills'] as const
type Kind = 'connectors' | 'files' | 'skills'

const ACCENT = '#d97757'
const INFO = '#2563eb'
// The status steps of the dataviz palette: a meter's fill turns warning, then critical.
const CRITICAL = '#d03b3b'
// Desktop pixels per pane column, to size the pictures to the pane.
const PX_PER_COL = 7.6

// Rows each list shows before "+N more", and calls kept per connector.
const MAX_ROWS = 15
const MAX_CALLS = 30
const MAX_AGENTS = 30
// Steps kept per agent for its card, the last one the step it is on.
const TRAIL = 12
// Call times kept per agent, for its activity lane.
const BEATS = 120
// Each section's own color, a theme key, so light, dark and colorblind themes all read.
const SECTION_COLOR = { usage: 'suggestion', todo: 'claude', background: 'warning', files: 'merged', connectors: 'success', agents: 'permission', skills: 'warning' } as const
// Narrowest agent card that still reads; below it the cards stack.
const MIN_CARD = 26
// The bars of an activity lane, from a quiet moment to the busiest.
const LEVELS = '▁▂▃▄▅▆▇█'
// $.session.messages() returns at most this many entries: a history that long may be cut.
const MESSAGES_CAP = 4096
const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])

const OWN_PLAN_TOOL = 'mcp__whatishappening__plan'
const PLAN_TOOLS = new Set([OWN_PLAN_TOOL, 'TodoWrite', 'TaskCreate', 'TaskUpdate'])
const PLAN_PROMPT =
  `When a job takes three or more steps, write its to-do list with ${OWN_PLAN_TOOL} before you start working: ` +
  'all the steps, with the first one marked in_progress. The person follows it in a bar above the prompt. ' +
  'Each time a step ends or begins, send the whole list again; every call replaces the last one. ' +
  'Finish by marking the last step completed. A batch of subagents counts as a single step. ' +
  'A short answer that needs only a few tool calls needs no list.'

// Reminders added after a main-chat tool's result, read by the model only.
const NUDGE_AFTER = 1
const STALE_AFTER = 8
const NUDGE_NEW = `Reminder from What is happening: this job has no to-do list. Send its steps to ${OWN_PLAN_TOOL} so the person can follow along.`
const NUDGE_CONT = `Reminder from What is happening: the to-do list is from an earlier prompt. For a new job send its steps to ${OWN_PLAN_TOOL}; if the job goes on, send the list as it stands now.`
const NUDGE_STALE = `Reminder from What is happening: the to-do list has not moved for a while. If a step is done, send the whole list to ${OWN_PLAN_TOOL} again.`
let backgroundTimer: unknown = null
let turnCalls = 0
let turnPlanned = false
let nudged = false
let sincePlan = 0
let staleNudged = false

function notePlanned() {
  turnPlanned = true
  sincePlan = 0
  staleNudged = false
}

/** The note to add after one main-chat tool call, or null. `live` is a plan with work left in it. */
export function nudgeFor(live: boolean): string | null {
  turnCalls++
  sincePlan++
  if (!turnPlanned && !nudged && turnCalls >= NUDGE_AFTER) {
    nudged = true
    return live ? NUDGE_CONT : NUDGE_NEW
  }
  if (live && !staleNudged && sincePlan >= STALE_AFTER) {
    staleNudged = true
    return NUDGE_STALE
  }
  return null
}

const NOTHING: Used = { connectors: {}, files: {}, skills: {} }
const usedAtom = atom({ plugin: 'whatishappening', key: 'used' } as const, NOTHING)
const NO_PLAN: Plan = { title: '', steps: [], updatedAt: 0 }
const planAtom = atom({ plugin: 'whatishappening', key: 'plan' } as const, NO_PLAN)
const openAtom = atom({ plugin: 'whatishappening', key: 'open' } as const, '')
const foldedAtom = atom({ plugin: 'whatishappening', key: 'folded' } as const, [] as string[])
const agentsAtom = atom({ plugin: 'whatishappening', key: 'agents' } as const, [] as AgentRow[])
const NO_USAGE: UsageView = { fiveHour: null, sevenDay: null, contextTokens: 0, contextWindow: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, at: 0 }
const usageAtom = atom({ plugin: 'whatishappening', key: 'usage' } as const, NO_USAGE)
const NO_SESSIONS: SessionList = { groups: [], at: 0 }
const sessionsAtom = atom({ plugin: 'whatishappening', key: 'sessions' } as const, NO_SESSIONS)
// The session whose resume command is shown (one from another folder); '' for none.
const shownAtom = atom({ plugin: 'whatishappening', key: 'shown' } as const, '')
// The folders whose every session the Sessions pane lists, not only the latest few.
const expandedAtom = atom({ plugin: 'whatishappening', key: 'expanded' } as const, [] as string[])
const SESSIONS_PANE = 'whatishappening-sessions'
const backgroundAtom = atom({ plugin: 'whatishappening', key: 'background' } as const, [] as BackgroundTask[])
// shortcut: a task whose report never came (Claude Code restarted) drops after a day; read the engine's list if it offers one.
const BACKGROUND_TTL = 24 * 3600_000
// shortcut: ~2 s to read 150 transcripts on open; read one folder's older sessions on demand if that grows slow.
const MAX_SESSIONS = 150
const PER_FOLDER = 8

// Module variables start over on a reload; what must last lives in $.state.
let home = ''
let order = 0
let autoOpened = false
let syncTimer: unknown
let usageTimer: unknown
let transcript = ''
// Skill names the session knows, from the context breakdown.
const skillNames = new Set<string>()
// tool_use ids already counted, so a call is never counted twice.
const counted = new Set<string>()
// Uses recorded while the history is recounted: the recount reads an older history, so they go back on top.
let duringSeed: Stamped[] | null = null
// The finished plan whose redraw is already booked, by its updatedAt.
let holdFor = -1
const DONE_HOLD_MS = 20_000
const BAR_PX = 160
const BAR_H = 18

// ---------- small helpers ----------

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (ms: number) => (ms ? `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}` : '')
const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`)
const kTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const short = (s: string, n = 60) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
// The home folder written as ~: a full path names the person's account.
const homeless = (s: string) => (home ? s.split(home).join('~') : s)
const fileName = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const tilde = (p: string) => (home && p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)

/** Splits text into lines of at most `width` characters, at spaces where it can. */
function wrap(s: string, width: number): string[] {
  const w = Math.max(8, width)
  const out: string[] = []
  let line = ''
  for (let word of s.split(/\s+/).filter(Boolean)) {
    while (word.length > w) {
      if (line) out.push(line)
      line = ''
      out.push(word.slice(0, w))
      word = word.slice(w)
    }
    if (!word) continue
    if (line && line.length + 1 + word.length > w) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line || !out.length) out.push(line)
  return out
}

/** "45s", "3m 05s", "1h 02m": how long something ran. */
function runText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(sec / 60)
  return min >= 60 ? `${Math.floor(min / 60)}h ${pad(min % 60)}m` : min ? `${min}m ${pad(sec % 60)}s` : `${sec}s`
}

/** "claude-opus-5-5" is "Opus 5.5", "claude-sonnet-4-5-20250929" "Sonnet 4.5", an alias "haiku" "Haiku". */
export function modelName(id: string): string {
  const m = /(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d{1,2})(?!\d))?)?/i.exec(id)
  if (!m) return id
  const family = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase()
  return m[2] ? `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : family
}

/** "2h15", "3d23h", "12m": time left until a reset. */
function untilText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return d ? `${d}d${pad(h)}h` : h ? `${h}h${pad(m)}` : `${m}m`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "14:30" today, else "Mon 09:00". */
function resetText(at: number, now: number): string {
  const d = new Date(at)
  return `${new Date(now).toDateString() === d.toDateString() ? '' : `${WEEKDAYS[d.getDay()]} `}${hhmm(at)}`
}

// An agent's own color, so each card reads as one agent at a glance. Bright enough on dark and light themes, and
// none of them the red that means a failure.
const AGENT_COLORS = ['#3e9bff', '#30a46c', '#f76b15', '#a463e8', '#12a594', '#d6409f', '#e6a700', '#6e6ef0', '#7fa83a', '#e5734c']

/** A color for each agent: picked by its id, so it stays the same on every redraw and reload, and moved to the next
 * free one when two agents on screen would share it. */
export function agentColors(ids: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set<number>()
  for (const id of [...ids].sort()) {
    let h = 0
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    let i = h % AGENT_COLORS.length
    for (let k = 0; k < AGENT_COLORS.length && taken.has(i); k++) i = (i + 1) % AGENT_COLORS.length
    taken.add(i)
    out.set(id, AGENT_COLORS[i]!)
  }
  return out
}

export type ActionKind = 'read' | 'edit' | 'run' | 'search' | 'web' | 'connector' | 'other'

/** The mark for one step of an agent, read from its words ("Read auth.ts", "Bash npm test"). */
export function actionMark(action: string): ActionKind {
  const tool = action.split(' ')[0] ?? ''
  if (/:$/.test(tool)) return 'connector'
  if (tool === 'Read') return 'read'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'edit'
  if (tool === 'Bash') return 'run'
  if (tool === 'Grep' || tool === 'Glob') return 'search'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  return 'other'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** When something happened: the time today, the date and time before. */
export function whenText(at: number, now: number): string {
  const d = new Date(at)
  return new Date(now).toDateString() === d.toDateString() ? hhmm(at) : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hhmm(at)}`
}

async function logError($: EngineInterface, where: string, err: unknown) {
  try {
    const dir = `${home}/.claude/mods-logs`
    const path = `${dir}/${PLUGIN}.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    if (!old) await $.process.run(['mkdir', '-p', dir])
    const line = `${new Date(await $.clock.now()).toISOString()} ${where}: ${err instanceof Error ? err.message : String(err)}\n`
    await $.fs.write(path, old + line)
  } catch {
    // The log itself failed: nothing more to do.
  }
}

// ---------- what a tool call used ----------

/** A readable name for an MCP server: "plugin_x_slack" is Slack, "claude_ai_Claude_Docs" is Claude Docs. */
export function serverLabel(server: string): string {
  const bare = server.replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/i, '') || server
  // claude.ai connectors can show a random id as their server; a short piece of it tells them apart.
  if (/^[0-9a-f]{8}-/i.test(bare)) return `Connector ${bare.slice(0, 4)}`
  return bare
    .split(/[-_]+/)
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

/** "mcp__gitlab__search_issues" is "search issues". */
const toolWords = (tool: string) => tool.split('__').slice(2).join(' ').replace(/[-_]+/g, ' ').trim() || tool

// Input fields worth showing as a call's argument, best first.
const ARG_FIELDS = ['query', 'q', 'url', 'file_path', 'path', 'pattern', 'name', 'title', 'id', 'command', 'prompt', 'skill', 'description']
// Fields the engine adds to every call, never the call's own argument.
const ENGINE_FIELDS = new Set(['tool', 'tool_use_id', 'agentId', 'session_id', 'transcript_path', 'hook_event_name', 'permission_mode', 'cwd', 'surface'])

/** One short value that says what the call was about. */
function argOf(input: Record<string, unknown>): string {
  const field = ARG_FIELDS.find(k => text(input[k])) ?? Object.keys(input).find(k => !ENGINE_FIELDS.has(k) && text(input[k]))
  if (!field) return ''
  const v = text(input[field])
  return short(/path$/i.test(field) ? fileName(v) : homeless(v))
}

type Hit = { kind: Kind; name: string; call?: Omit<CallRow, 'at'> }

/** The connector, file or skill one tool call used, if any. */
function usesOf(tool: string, input: Record<string, unknown>): Hit[] {
  if (tool === OWN_PLAN_TOOL) return []
  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? ''
    return server ? [{ kind: 'connectors', name: serverLabel(server), call: { what: toolWords(tool), arg: argOf(input) } }] : []
  }
  if (tool === 'Skill' && text(input.skill)) return [{ kind: 'skills', name: text(input.skill).replace(/^\//, '') }]
  const path = tool === 'Read' ? text(input.file_path) : ''
  if (!path) return []
  const skill = /\/([^/]+)\/SKILL\.md$/.exec(path)?.[1]
  if (skill) return [{ kind: 'skills', name: skill }]
  // Claude's own spill files are not context the person gave it.
  if (/\/tool-results\/|^\/tmp\/|^\/private\/tmp\//.test(path)) return []
  return [{ kind: 'files', name: path }]
}

/** "Read auth.ts", "Gitlab: search issues login": what one call of an agent is doing. */
function actionOf(tool: string, input: Record<string, unknown>): string {
  if (PLAN_TOOLS.has(tool)) return 'Update its to-do list'
  if (tool === 'SubagentHandback') return 'Hand back its report'
  const name = tool.startsWith('mcp__') ? `${serverLabel(tool.split('__')[1] ?? '')}: ${toolWords(tool)}` : tool
  const arg = tool === 'Bash' ? short(homeless(text(input.command)), 50) : argOf(input)
  return arg ? `${name} ${arg}` : name
}

type Stamped = { hit: Hit; order: number; at: number }

/** The lists with one more use counted. */
function count(used: Used, { hit, order: n, at }: Stamped): Used {
  const was = used[hit.kind][hit.name]
  const calls = hit.call ? [...(was?.calls ?? []), { ...hit.call, at }].slice(-MAX_CALLS) : was?.calls
  const row: Tally = { ...was, count: (was?.count ?? 0) + 1, last: n, ...(calls ? { calls } : {}) }
  return { ...used, [hit.kind]: { ...used[hit.kind], [hit.name]: row } }
}

const stamp = (hit: Hit, at: number): Stamped => ({ hit, order: ++order, at })

/** The recount, with every stored count that is higher (or that the recount lacks) kept. */
export function keepHigher(stored: Used, fresh: Used): Used {
  const merge = (a: Record<string, Tally>, b: Record<string, Tally>) => {
    const out = { ...a, ...b }
    for (const [name, row] of Object.entries(a)) if (b[name] && row.count > b[name].count) out[name] = { ...b[name], count: row.count }
    return out
  }
  return { connectors: merge(stored.connectors, fresh.connectors), files: merge(stored.files, fresh.files), skills: merge(stored.skills, fresh.skills) }
}

/** Only what the chat loaded at start, counts at zero: where a recount begins. */
function startOnly(used: Used): Used {
  const keep = (rows: Record<string, Tally>) =>
    Object.fromEntries(Object.entries(rows).filter(([, r]) => r.auto).map(([k, r]) => [k, { ...r, count: 0 }]))
  return { connectors: {}, files: keep(used.files), skills: keep(used.skills) }
}

async function note($: EngineInterface, id: string, hits: Hit[]) {
  if (!hits.length || (id && counted.has(id))) return
  if (id) counted.add(id)
  const at = await $.clock.now()
  const stamped = hits.map(h => stamp(h, at))
  await update($, usedAtom, used => stamped.reduce(count, used))
  duringSeed?.push(...stamped)
  openOnce($)
}

async function isPaneInSight($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)
  } catch {
    return false
  }
}

function openOnce($: EngineInterface) {
  if (autoOpened) return
  autoOpened = true
  void $.ui.open({ id: PANE, title: TITLE }).catch(err => logError($, 'open', err))
}

/** The context files and skills the chat loaded at start. */
async function loadStart($: EngineInterface) {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (!b) return
  for (const s of b.skills?.skillFrontmatter ?? []) skillNames.add(s.name)
  const paths = b.memoryFiles.map(m => m.path).filter(Boolean)
  if (!paths.length) return
  await update($, usedAtom, used => {
    const files = { ...used.files }
    const skills = { ...used.skills }
    for (const p of paths) {
      const skill = /\/([^/]+)\/SKILL\.md$/.exec(p)?.[1]
      const rows = skill ? skills : files
      const name = skill ?? p
      rows[name] = { count: 0, last: 0, ...rows[name], auto: true }
    }
    return { ...used, files, skills }
  })
}

// ---------- the plan ----------

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']
const statusOf = (v: unknown) => (STATUSES.includes(v as string) ? (v as PlanStep['status']) : 'pending')

/** Steps from a tool's list, the step's words under `field`. */
function stepsFrom(list: unknown, field: string): PlanStep[] {
  if (!Array.isArray(list)) return []
  return list.flatMap(item => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const words = text(o[field])
    if (!words) return []
    const active = text(o.activeForm)
    return [{ text: words, status: statusOf(o.status), ...(active ? { active } : {}) }]
  })
}

/** The new plan a plan tool call makes, or null when it changes nothing. */
function planAfter(cur: Plan, tool: string, input: Record<string, unknown>, result: unknown, at: number): Plan | null {
  if (tool === OWN_PLAN_TOOL) return { title: typeof input.title === 'string' ? input.title.trim() : cur.title, steps: stepsFrom(input.steps, 'text'), updatedAt: at }
  if (tool === 'TodoWrite') return { ...cur, steps: stepsFrom(input.todos, 'content'), updatedAt: at }
  if (tool === 'TaskCreate') {
    const subject = text(input.subject)
    if (!subject) return null
    const given = (result as { task?: { id?: unknown } } | undefined)?.task?.id
    const id = given === undefined ? String(cur.steps.length + 1) : String(given)
    const active = text(input.activeForm)
    return { ...cur, steps: [...cur.steps, { text: subject, status: 'pending', id, ...(active ? { active } : {}) }], updatedAt: at }
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    const i = cur.steps.findIndex(st => st.id === id)
    if (i < 0) return null
    if (input.status === 'deleted') return { ...cur, steps: cur.steps.filter((_, j) => j !== i), updatedAt: at }
    const old = cur.steps[i]!
    const step: PlanStep = {
      ...old,
      text: text(input.subject) || old.text,
      status: input.status === undefined ? old.status : statusOf(input.status),
      ...(text(input.activeForm) ? { active: text(input.activeForm) } : {}),
    }
    return { ...cur, steps: cur.steps.map((st, j) => (j === i ? step : st)), updatedAt: at }
  }
  return null
}

/** Applies a main-chat plan tool call. True when the plan changed. */
async function watchPlan($: EngineInterface, call: Record<string, unknown> & { tool: string }, result: unknown) {
  if (!PLAN_TOOLS.has(call.tool) || call.agentId) return false
  const now = await $.clock.now()
  let changed = false
  await update($, planAtom, cur => {
    const next = planAfter(cur, call.tool, call, result, Math.max(now, cur.updatedAt + 1))
    changed = next !== null
    return next ?? cur
  })
  return changed
}

// ---------- usage ----------

function limitOf(list: readonly { kind: string; percentUsed: number; resetsAt?: string }[], kind: string): LimitRow | null {
  const w = list.find(r => r.kind === kind)
  if (!w) return null
  const at = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  return { percent: w.percentUsed, resetsAt: Number.isFinite(at) ? at : 0 }
}

/** Token totals of a transcript: one count per API message id, as a message is written once per content block. */
export function tokenTotals(jsonl: string) {
  const byId = new Map<string, [number, number, number, number]>()
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    const id = /"id":"(msg_[^"]+)"/.exec(line)?.[1]
    const u = /"usage":\{([^{}]*)/.exec(line)?.[1]
    if (!id || !u) continue
    const n = (k: string) => Number(new RegExp(`"${k}":(\\d+)`).exec(u)?.[1] ?? 0)
    byId.set(id, [n('input_tokens'), n('output_tokens'), n('cache_read_input_tokens'), n('cache_creation_input_tokens')])
  }
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0
  for (const [i, o, r, w] of byId.values()) {
    input += i
    output += o
    cacheRead += r
    cacheWrite += w
  }
  return { input, output, cacheRead, cacheWrite }
}

/** This chat's transcript file. Its folder is named for the cwd the chat started in, which a later cd does not move. */
async function transcriptPath($: EngineInterface): Promise<string> {
  if (transcript && (await $.fs.exists(transcript))) return transcript
  const sid = await $.session.id()
  const guess = `${home}/.claude/projects/${(await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')}/${sid}.jsonl`
  if (await $.fs.exists(guess)) return (transcript = guess)
  try {
    const found = (await $.process.run(['find', `${home}/.claude/projects`, '-maxdepth', '2', '-name', `${sid}.jsonl`])).stdout.split('\n')[0]?.trim()
    if (found) return (transcript = found)
  } catch {
    // Fall back to the guess.
  }
  return guess
}

// $.fs.read refuses files over 4 MB, and a long chat's transcript is bigger. sed cuts each assistant line down to
// what tokenTotals reads (the message id and the usage block), so one parser serves both roads.
export const USAGE_SED = 's/.*\\("id":"msg_[^"]*"\\).*\\("usage":{[^{}]*\\).*/\\1 \\2 "assistant"/p'

async function totalsOf($: EngineInterface, path: string) {
  try {
    const r = await $.process.run(['sed', '-n', `/"type":"assistant"/${USAGE_SED}`, path])
    if (r.exitCode === 0 && r.stdout.includes('"usage"')) return tokenTotals(r.stdout)
  } catch {
    // No sed: read the file, which works under 4 MB.
  }
  return tokenTotals(String(await $.fs.read(path)))
}

/** When each tool call was made, by its id, from `grep -o` of the transcript: a line's tool_use ids come before its
 * timestamp. */
export function callTimes(out: string): Map<string, number> {
  const times = new Map<string, number>()
  let waiting: string[] = []
  for (const l of out.split('\n')) {
    const id = /"id":"(toolu_[^"]+)"/.exec(l)?.[1]
    if (id) waiting.push(id)
    const ts = /"timestamp":"([^"]+)"/.exec(l)?.[1]
    if (!ts) continue
    const at = Date.parse(ts)
    if (at) for (const w of waiting) times.set(w, at)
    waiting = []
  }
  return times
}

/** The main chat's call times; empty when the transcript cannot be read (its calls then show no time). */
async function timesOf($: EngineInterface): Promise<Map<string, number>> {
  try {
    const r = await $.process.run(['grep', '-oE', '"tool_use","id":"toolu_[^"]+"|"timestamp":"[^"]+"', await transcriptPath($)])
    return callTimes(r.stdout)
  } catch {
    return new Map()
  }
}

/** Reads limits, context and, when asked, the transcript's token totals. Never throws. */
async function refreshUsage($: EngineInterface, withTokens: boolean) {
  try {
    const u = await $.session.usage()
    let tokens = {}
    if (withTokens) {
      // shortcut: main transcript only, subagents' tokens are not counted; read their transcripts when that matters.
      const path = await transcriptPath($)
      if (await $.fs.exists(path)) tokens = await totalsOf($, path)
    }
    const at = await $.clock.now()
    let fiveHour = limitOf(u.rateLimits, 'five_hour')
    let sevenDay = limitOf(u.rateLimits, 'seven_day')
    if (fiveHour || sevenDay) {
      // Kept across sessions, so a new session shows the limits before its first reply.
      await $.store.set('limits', { fiveHour, sevenDay, at }).catch(() => undefined)
    } else {
      // No reading yet in this session: the latest one any session saw, marked with when it was taken.
      const cur = await read($, usageAtom)
      const kept = (await $.store.get('limits').catch(() => undefined)) as { fiveHour: LimitRow | null; sevenDay: LimitRow | null; at: number } | undefined
      const stale = (l: LimitRow | null | undefined) => (l ? { ...l, asOf: kept?.at ?? 0 } : null)
      fiveHour = cur.fiveHour ?? stale(kept?.fiveHour)
      sevenDay = cur.sevenDay ?? stale(kept?.sevenDay)
    }
    await update($, usageAtom, cur => ({
      ...cur,
      ...tokens,
      fiveHour,
      sevenDay,
      contextTokens: u.context.tokens ?? cur.contextTokens,
      contextWindow: u.context.window,
      at,
    }))
  } catch (err) {
    await logError($, 'usage', err)
  }
}

// ---------- agents ----------

/** Merges a change into one agent's row, adding the row when it is new. */
async function upsertAgent($: EngineInterface, id: string, change: (old: AgentRow) => Partial<AgentRow>) {
  const now = await $.clock.now()
  const seq = ++order
  await update($, agentsAtom, rows => {
    const old = rows.find(r => r.id === id) ?? { id, type: 'agent', description: '', status: 'running', doing: '', tools: 0, startedAt: now, seq }
    return [...rows.filter(r => r.id !== id), { ...old, ...change(old), seq }].slice(-MAX_AGENTS)
  })
}

/** An agent the chat started (seen by agent.spawn, the engine's list or the history), not one of the engine's own
 * forks (compaction, memory), whose calls carry an agent id too. Rows stored before `known` existed go by their type,
 * which only the spawn, the list or the history set. */
export const isKnown = (r: AgentRow) => Boolean(r.known || r.listed || r.type !== 'agent')

/** Takes status, type and description from the engine's agent list. An agent the list dropped, and once named, has ended. */
async function syncAgents($: EngineInterface) {
  try {
    const rows = await read($, agentsAtom)
    const list = await $.agent.list()
    if (!rows.length && !list.length) return
    const byId = new Map(list.map(a => [a.id, a]))
    const now = await $.clock.now()
    await update($, agentsAtom, cur => {
      const known = new Set(cur.map(r => r.id))
      const merged = cur.map(r => {
        const a = byId.get(r.id)
        const ended = (row: AgentRow): AgentRow => (LIVE.has(row.status) ? { ...row, endedAt: undefined } : { ...row, endedAt: row.endedAt ?? now })
        if (a) return ended({ ...r, status: a.status, type: a.type || r.type, description: a.description || r.description, listed: true })
        // A workflow's agents are never in the list, so only one the list once named has ended when it leaves.
        return r.listed && LIVE.has(r.status) ? ended({ ...r, status: 'completed' }) : r
      })
      const added = list
        .filter(a => !known.has(a.id))
        .map(a => ({ id: a.id, type: a.type, description: a.description, status: a.status, doing: '', tools: 0, startedAt: now, seq: ++order, listed: true }))
      const out = [...merged, ...added].slice(-MAX_AGENTS)
      return JSON.stringify(out) === JSON.stringify(cur) ? cur : out
    })
  } catch (err) {
    await logError($, 'agents', err)
  }
}

// ---------- the history, after a reload or a resume ----------

// A typed slash command: "/name", or the <command-name> tag the transcript wraps it in.
const TYPED = /^\/([\w:.-]+)|<command-name>\/?([\w:.-]+)<\/command-name>/

async function seed($: EngineInterface): Promise<void> {
  duringSeed = []
  try {
    await recount($)
  } finally {
    duringSeed = null
  }
}

async function recount($: EngineInterface) {
  const stored = await read($, usedAtom)
  const agentRows = await read($, agentsAtom)
  // `order` starts over on a reload while stored rows keep theirs: carry on above them, so new rows sort first.
  const lasts = [...Object.values(stored.connectors), ...Object.values(stored.files), ...Object.values(stored.skills)].map(r => r.last)
  order = Math.max(order, 0, ...lasts, ...agentRows.map(r => r.seq))

  const main = await $.session.messages()
  const all: SessionMessage[] = [...main]
  for (const m of main) {
    for (const u of m.toolUses) {
      if (!u.agentId) continue
      const child = await $.session.messages({ agentId: u.agentId })
      const kids = Array.isArray(child) ? child : []
      all.push(...kids)
      const uses = kids.flatMap(c => c.toolUses)
      const lastUse = uses[uses.length - 1]
      // An agent from before the reload: done, unless the engine's list says otherwise (syncAgents).
      await upsertAgent($, u.agentId, old => ({
        known: true,
        // A row first seen in the history: when it started is unknown, so no run time is shown.
        startedAt: old.type === 'agent' && !old.tools ? 0 : old.startedAt,
        type: old.type !== 'agent' ? old.type : text(u.input.subagent_type) || 'general-purpose',
        description: old.description || text(u.input.description),
        status: old.doing ? old.status : 'completed',
        doing: old.doing || (lastUse ? actionOf(lastUse.tool, lastUse.input) : ''),
        trail: old.trail?.length ? old.trail : uses.slice(-TRAIL).map(x => actionOf(x.tool, x.input)),
        plan: old.plan?.length
          ? old.plan
          : uses.reduce((pl, x) => (PLAN_TOOLS.has(x.tool) ? (planAfter(pl, x.tool, x.input, undefined, 1) ?? pl) : pl), NO_PLAN).steps,
        tools: Math.max(old.tools, uses.length),
      }))
    }
  }

  // A plan the state lost (a resumed chat) is rebuilt from the plan calls in the history.
  if (!(await read($, planAtom)).steps.length) {
    let plan = NO_PLAN
    for (const m of main) for (const u of m.toolUses) if (!u.agentId && PLAN_TOOLS.has(u.tool)) plan = planAfter(plan, u.tool, u.input, undefined, 1) ?? plan
    if (plan.steps.length) await update($, planAtom, cur => (cur.steps.length ? cur : plan))
  }

  const hits: Stamped[] = []
  const times = await timesOf($)
  for (const m of all) {
    if (m.role === 'user' && typeof m.text === 'string') {
      const typed = TYPED.exec(m.text.trim())
      const name = typed?.[1] ?? typed?.[2]
      if (name && skillNames.has(name)) hits.push(stamp({ kind: 'skills', name }, 0))
    }
    for (const u of m.toolUses) {
      if (counted.has(u.tool_use_id)) continue
      const found = usesOf(u.tool, u.input)
      if (!found.length) continue
      counted.add(u.tool_use_id)
      hits.push(...found.map(h => stamp(h, times.get(u.tool_use_id) ?? 0)))
    }
  }
  if (!hits.length) return
  // The chat already used things before the reload: the pane stays as the person left it.
  autoOpened = true
  // Counted from the history, never on top of the stored counts ($.state outlives a reload, `counted` does not).
  // A history at the cap may be cut, so then the stored counts, which saw the older calls, win where higher.
  const whole = main.length < MESSAGES_CAP
  await update($, usedAtom, used => {
    const fresh = [...hits, ...(duringSeed ?? [])].reduce(count, startOnly(used))
    return whole ? fresh : keepHigher(used, fresh)
  })
}

// ---------- the band's bar ----------

/** A rounded bar as a picture: `part` filled in `color`, the track a light step of the same color. `boxH` is the
 * picture's height, the 8 px bar in its middle (a band row is 18 px: a shorter picture sat at the top of the row). */
function barSvg(part: number, color: string, w: number, boxH: number, track = color): string {
  const fill = Math.round(Math.min(1, Math.max(0, part)) * w)
  const y = (boxH - 8) / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${boxH}" width="${w}" height="${boxH}">` +
    `<rect y="${y}" width="${w}" height="8" rx="4" fill="${track}" fill-opacity="${track === color ? 0.2 : 0.35}"/>` +
    (fill ? `<rect y="${y}" width="${Math.max(8, fill)}" height="8" rx="4" fill="${color}"/>` : '') +
    '</svg>'
  )
}

const DONE_GREEN = '#30a46c'

/** How many columns each step's segment gets in a bar `cols` wide: as even as it goes, the extra columns to the
 * first steps, one column between segments when each has at least two of its own. */
export function segmentWidths(steps: number, cols: number): { widths: number[]; gap: number } {
  if (steps <= 0) return { widths: [], gap: 0 }
  const gap = cols - (steps - 1) >= steps * 2 ? 1 : 0
  const room = Math.max(steps, cols - gap * (steps - 1))
  const base = Math.floor(room / steps)
  return { widths: Array.from({ length: steps }, (_, i) => base + (i < room % steps ? 1 : 0)), gap }
}

/** The plan as a bar of one segment per step: green done, orange the one in progress, faint the ones to come. */
function stepsSvg(steps: readonly PlanStep[], w: number, boxH: number): string {
  const gap = 3
  const seg = Math.max(2, (w - gap * (steps.length - 1)) / steps.length)
  const y = (boxH - 8) / 2
  const rects = steps
    .map((st, i) => {
      const fill = st.status === 'completed' ? DONE_GREEN : st.status === 'in_progress' ? ACCENT : '#80808055'
      return `<rect x="${(i * (seg + gap)).toFixed(1)}" y="${y}" width="${seg.toFixed(1)}" height="8" rx="3" fill="${fill}"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${boxH}" width="${w}" height="${boxH}">${rects}</svg>`
}

/** Which stretch of a meter a cell sits in: green before the middle, orange past it, red near the end. */
export function cellZone(i: number, cells: number): 'low' | 'mid' | 'high' {
  const at = (i + 0.5) / cells
  return at < 0.5 ? 'low' : at < 0.8 ? 'mid' : 'high'
}
const ZONE_TEXT = { low: 'success', mid: 'claude', high: 'error' } as const
const ZONE_HEX = { low: DONE_GREEN, mid: ACCENT, high: CRITICAL } as const
const METER_CELLS = 10

/** A meter as square cells, `part` of them lit, each in the color of its stretch. */
function cellsSvg(part: number, w: number, boxH: number): string {
  const lit = Math.round(Math.min(1, Math.max(0, part)) * METER_CELLS)
  const gap = 3
  const cell = (w - gap * (METER_CELLS - 1)) / METER_CELLS
  const size = Math.min(cell, boxH)
  const y = (boxH - size) / 2
  const rects = Array.from({ length: METER_CELLS }, (_, i) => {
    const fill = i < lit ? ZONE_HEX[cellZone(i, METER_CELLS)] : '#80808045'
    return `<rect x="${(i * (cell + gap)).toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${size.toFixed(1)}" rx="2" fill="${fill}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${boxH}" width="${w}" height="${boxH}">${rects}</svg>`
}

/** The same bar in text, `cols` wide; `Text` is the surface's own. */
function stepsText(Text: (p: Record<string, unknown>) => unknown, steps: readonly PlanStep[], cols: number) {
  const { widths, gap } = segmentWidths(steps.length, cols)
  return (
    <Text>
      {steps.flatMap((st, i) => {
        const w = widths[i]!
        const cell =
          st.status === 'pending' ? (
            <Text key={`s${i}`} dimColor>
              {'░'.repeat(w)}
            </Text>
          ) : (
            <Text key={`s${i}`} color={st.status === 'completed' ? 'success' : 'claude'}>
              {'█'.repeat(w)}
            </Text>
          )
        return i && gap ? [<Text key={`g${i}`}> </Text>, cell] : [cell]
      })}
    </Text>
  )
}


// ---------- background commands ----------

/** The id a background command's result names: "Command running in background with ID: bw783gssg." */
export function startedTaskId(result: unknown): string | null {
  const out = typeof result === 'string' ? result : JSON.stringify(result ?? '')
  return /running in background with ID: (\w+)/.exec(out)?.[1] ?? null
}

/** The task a `<task-notification>` reports the end of. */
export function endedTaskId(text: string): string | null {
  return text.includes('<task-notification') ? (/<task-id>\s*(\w+)\s*<\/task-id>/.exec(text)?.[1] ?? null) : null
}

async function endTask($: EngineInterface, id: string | null) {
  if (id) await update($, backgroundAtom, list => (list.some(t => t.id === id) ? list.filter(t => t.id !== id) : list))
}

/** Ends the background commands whose report reached a running answer. Read from the history: under a Team or
 *  Enterprise login Claude Code's own guard skips a user's mod on the event that keeps it. Reads nothing while
 *  no command runs. */
async function checkBackground($: EngineInterface) {
  if (!(await read($, backgroundAtom)).length) return
  // A report is among the latest messages when it lands; the last 40 cover the calls made since.
  for (const m of (await $.session.messages()).slice(-40)) if (m.role === 'user' && typeof m.text === 'string') await endTask($, endedTaskId(m.text))
}

/** A file's folder, short; where another listed file has the same name, as many folders as tell the two apart. */
export function folderLabel(path: string, all: readonly string[]): string {
  const dirOf = (p: string) => tilde(p.slice(0, Math.max(1, p.lastIndexOf('/'))))
  const folder = dirOf(path)
  const parts = folder.split('/').filter(Boolean)
  const twins = all.filter(o => o !== path && fileName(o) === fileName(path)).map(o => dirOf(o).split('/').filter(Boolean))
  const tail = (n: number) => parts.slice(-n).join('/')
  if (!twins.length) return folder.length > 28 && parts.length > 1 ? `…/${tail(1)}` : folder
  let n = 1
  while (n < parts.length && twins.some(tw => tw.slice(-n).join('/') === tail(n))) n += 1
  return n >= parts.length ? folder : `…/${tail(n)}`
}

// ---------- other sessions ----------

// One line per session file, newest first: modified time, path, its first cwd, its latest title and its first prompt.
// grep reads the files where $.fs.read would refuse a long one, and only the two fields come back.
const SESSIONS_SH = [
  'cd "$1" 2>/dev/null || exit 0',
  `find . -mindepth 2 -maxdepth 2 -name '*.jsonl' -printf '%T@\\t%p\\n' | sort -rn | head -n ${MAX_SESSIONS} |`,
  'while IFS="$(printf \'\\t\')" read -r t f; do',
  '  c=$(grep -m1 -o \'"cwd":"[^"]*"\' "$f")',
  // The name the person gave with /rename wins: Claude Code writes its own title again after it, in pairs.
  '  n=$(grep -o \'"customTitle":"[^"]*"\' "$f" | tail -n 1)',
  '  [ -n "$n" ] || n=$(grep -o \'"aiTitle":"[^"]*"\' "$f" | tail -n 1)',
  // With no title yet, the first prompt the person typed (one that opens with "<" is a command's record).
  '  u=$(grep -m1 -o \'"role":"user","content":"[^"<][^"]*"\' "$f" | cut -c1-300 | sed \'s/^"role":"user",//\')',
  '  printf \'%s\\t%s\\t%s\\t%s\\t%s\\n\' "$t" "$f" "$c" "$n" "$u"',
  'done',
].join('\n')

/** The sessions in the script's output, grouped by the folder each ran in, the most recent folder first. */
export function sessionGroups(out: string): SessionList['groups'] {
  const field = (pair: string) => {
    try {
      return Object.values(JSON.parse(`{${pair}}`) as Record<string, string>)[0] ?? ''
    } catch {
      return ''
    }
  }
  const byFolder = new Map<string, SessionRow[]>()
  for (const row of out.split('\n')) {
    const [t = '', path = '', cwd = '', title = '', prompt = ''] = row.split('\t')
    const id = /([0-9a-f-]{36})\.jsonl$/.exec(path)?.[1]
    const folder = field(cwd)
    if (!id || !folder) continue
    const list = byFolder.get(folder) ?? []
    // A prompt cut at 300 characters may end inside an escape: then it is read as written, unescaped by hand.
    const first = field(prompt) || prompt.replace(/^"content":"/, '').replace(/"$/, '').replace(/\\n/g, ' ')
    list.push({ id, title: field(title) || short(first, 60), at: Math.round(Number(t) * 1000) || 0 })
    byFolder.set(folder, list)
  }
  return [...byFolder].map(([cwd, items]) => ({ cwd, items: items.sort((a, b) => b.at - a.at) })).sort((a, b) => (b.items[0]?.at ?? 0) - (a.items[0]?.at ?? 0))
}

async function loadSessions($: EngineInterface) {
  try {
    const out = (await $.process.run(['sh', '-c', SESSIONS_SH, 'sh', `${home}/.claude/projects`])).stdout
    const at = await $.clock.now()
    await update($, sessionsAtom, () => ({ groups: sessionGroups(out), at }))
  } catch (err) {
    await logError($, 'sessions', err)
  }
}

/** A session of this folder: `/resume <id>` in the prompt box, one Enter away. Another folder's: its command, shown. */
async function pickSession($: EngineInterface, id: string) {
  const list = await read($, sessionsAtom)
  const cwd = await $.session.cwd()
  const group = list.groups.find(g => g.items.some(it => it.id === id))
  if (group?.cwd === cwd) {
    await $.prompt.fill({ text: `/resume ${id}` })
    try {
      $.ui.toast('Press Enter to pick that session up.')
    } catch {
      // The toast is only a hint.
    }
    return
  }
  await update($, shownAtom, cur => (cur === id ? '' : id))
}

/** "4m", "3h", "8d", "2mo": how long ago. */
function ageText(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000))
  if (min < 60) return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}h`
  if (min < 43200) return `${Math.floor(min / 1440)}d`
  return `${Math.floor(min / 43200)}mo`
}

const byNewest = (rows: Record<string, Tally>) => Object.entries(rows).sort(([, a], [, b]) => b.last - a.last)

export const register: Register = on => {
  // The band hides while the pane is in sight: redraw it when the pane opens or closes.
  on('ui.open', async ($, e, next) => {
    const done = await next(e)
    void $.ui.invalidate('ui.render')
    return done
  }).catch(($, e, next) => next(e))
  on('ui.close', async ($, e, next) => {
    const done = await next(e)
    void $.ui.invalidate('ui.render')
    return done
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    // An installed copy may sit outside ~/.claude (a local marketplace): ask the shell for the home folder.
    try {
      const out = (await $.process.run(['printenv', 'HOME'])).stdout.trim()
      if (out.startsWith('/')) home = out
    } catch {
      // Keep the guess.
    }
    await $.tool
      .register({
        name: 'plan',
        description:
          'Keeps the to-do list of the current job, shown to the person as a progress bar above the prompt. ' +
          'Pass every step, first to last, each with its status; each call replaces the whole list.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'What the job is called, in two to five words.' },
            steps: {
              type: 'array',
              description: 'The full list, first step first.',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'What the step does, briefly.' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                },
                required: ['text', 'status'],
              },
            },
          },
          required: ['steps'],
        },
        // Listed up front: a deferred tool waits behind a search the model rarely makes.
        isDeferred: false,
      })
      .catch(err => logError($, 'register plan tool', err))
    await $.command.register({ name: 'whatishappening', description: 'Show what this chat is doing: usage, tasks, agents, connectors, files and skills', immediate: true })
    await $.command.register({ name: 'sessions', description: 'List your recent Claude Code sessions by folder, to pick one up again', immediate: true })
    if (!syncTimer) syncTimer = $.clock.every(3000, () => void syncAgents($))
    // Every 30 s: limits move, the countdowns tick and the tokens are read again, so a long first turn shows them too.
    if (!usageTimer) usageTimer = $.clock.every(30000, () => void refreshUsage($, true))
    // A background command's report may land while Claude waits with no call to make: look every few seconds,
    // only while one runs.
    if (!backgroundTimer) backgroundTimer = $.clock.every(5000, () => void checkBackground($).catch(err => logError($, 'background', err)))
    void refreshUsage($, true)
    // The skill names first: the recount needs them to tell a typed skill from another slash command.
    void loadStart($)
      .catch(err => logError($, 'start', err))
      .then(() => seed($))
      .catch(err => logError($, 'seed', err))
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await loadSessions($)
    await $.ui.open({ id: SESSIONS_PANE, title: 'Sessions' })
    return { text: 'Opened the Sessions pane.' }
  })

  on('command.run', { command: 'whatishappening' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Opened the What is happening pane.' }
  })

  // A slash command that is a skill counts as a use of it.
  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (e.command !== 'whatishappening' && e.command !== 'sessions' && skillNames.has(e.command)) await note($, '', [{ kind: 'skills', name: e.command }])
    } catch (err) {
      await logError($, 'command', err)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Our plan tool: the mod answers it, saving the list the band and the To-do draw.
  on('tool.call', { tool: OWN_PLAN_TOOL } as never, async ($, e) => {
    const call = e as unknown as Record<string, unknown> & { tool: string; agentId?: string }
    if (call.agentId) {
      const now0 = await $.clock.now()
      // A subagent's list goes on its own card; the main chat's list stays as it is.
      const steps = planAfter(NO_PLAN, OWN_PLAN_TOOL, call, undefined, now0)?.steps ?? []
      if (!steps.length) return { result: 'Nothing saved: each step needs a text and a status.' } as never
      await upsertAgent($, call.agentId, () => ({ plan: steps }))
      return { result: `Your to-do list is on your card: ${steps.filter(st => st.status === 'completed').length}/${steps.length} completed.` } as never
    }
    const now = await $.clock.now()
    let saved: Plan | null = null
    await update($, planAtom, cur => {
      saved = planAfter(cur, OWN_PLAN_TOOL, call, undefined, Math.max(now, cur.updatedAt + 1))
      return saved ?? cur
    })
    const plan = saved as Plan | null
    if (!plan || !plan.steps.length) return { result: 'Nothing saved: each step needs a text and a status.' } as never
    notePlanned()
    openOnce($)
    const done = plan.steps.filter(st => st.status === 'completed').length
    return { result: `To-do list updated: ${done}/${plan.steps.length} completed.` } as never
  }).catch(() => ({ result: 'The to-do list could not be saved this time. Go on with your work.' }) as never)

  // A background command's report that starts an answer of its own ends that command.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await endTask($, endedTaskId(e.text))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new prompt is a new task: the reminders count from zero.
  on('prompt.submit', async ($, e, next) => {
    turnCalls = 0
    turnPlanned = false
    nudged = false
    sincePlan = 0
    staleNudged = false
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (e.traits.includes('teammate') || e.traits.includes('bare')) return r
    return { sections: [...r.sections, { id: 'whatishappening:plan', text: PLAN_PROMPT, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // A response moved a limit or the context.
  on('session.measure', async ($, e, next) => {
    void refreshUsage($, false)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new subagent: a row at once, before its first tool call.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (!ran.agentId) return ran
    try {
      await upsertAgent($, ran.agentId, () => ({ type: e.subagentType || 'general-purpose', description: e.description, status: 'running', model: ran.model, known: true }))
      openOnce($)
    } catch (err) {
      await logError($, 'agent.spawn', err)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // The main chat's turn ended: read the tokens. A subagent's answer ends its run, unless a message wakes it.
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) {
      void refreshUsage($, true)
      await checkBackground($).catch(err => logError($, 'background', err))
      return ran
    }
    if (!(await read($, agentsAtom)).some(r => r.id === e.agentId)) return ran
    const u = e.usage
    const spent = u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    const now = await $.clock.now()
    await upsertAgent($, e.agentId, old => ({
      status: e.isAborted ? 'killed' : 'completed',
      endedAt: now,
      tokens: (old.tokens ?? 0) + spent,
      ...(u?.model ? { model: u.model } : {}),
    }))
    return ran
  }).catch(($, e, next) => next(e))

  // Every tool call, in the main chat and in subagents: the call runs first, then it is counted.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as Record<string, unknown> & { tool: string; tool_use_id: string; agentId?: string }
    // A subagent's call is what it is doing now: shown before it runs, so long calls show too.
    if (call.agentId) {
      const action = actionOf(call.tool, call)
      const beat = await $.clock.now()
      await upsertAgent($, call.agentId, old => ({
        beats: [...(old.beats ?? []), beat].slice(-BEATS),
        doing: action,
        trail: [...(old.trail ?? []), action].slice(-TRAIL),
        tools: old.tools + 1,
        status: 'running',
        endedAt: undefined,
      })).catch(err =>
        logError($, 'agent tool', err),
      )
    }
    if (!call.agentId) await checkBackground($).catch(err => logError($, 'background', err))
    const ran = await next(e)
    try {
      if ((ran as { deny?: unknown }).deny !== undefined) return ran
      const row = call.agentId ? (await read($, agentsAtom)).find(r => r.id === call.agentId) : undefined
      // The engine's own forks read and run things too; they are not the chat's work.
      if (call.agentId && !(row && isKnown(row))) return ran
      await note($, call.tool_use_id, usesOf(call.tool, call))
      if (await watchPlan($, call, (ran as { result?: unknown }).result)) openOnce($)
      if (call.agentId) {
        // Its own TodoWrite or Task list goes on its card (the plan tool answers for itself above).
        if (PLAN_TOOLS.has(call.tool) && call.tool !== OWN_PLAN_TOOL) {
          const result = (ran as { result?: unknown }).result
          await upsertAgent($, call.agentId, old => {
            const after = planAfter({ ...NO_PLAN, steps: old.plan ?? [] }, call.tool, call, result, 1)
            return after ? { plan: after.steps } : {}
          })
        }
        return ran
      }
      if (call.tool === 'Bash' && call.run_in_background === true) {
        const id = startedTaskId((ran as { result?: unknown }).result)
        const at = await $.clock.now()
        const what = text(call.description) || short(homeless(text(call.command)), 60)
        if (id) await update($, backgroundAtom, list => [...list.filter(t => t.id !== id && at - t.startedAt < BACKGROUND_TTL), { id, what, startedAt: at }])
      }
      if (call.tool === 'TaskStop' || call.tool === 'KillShell') await endTask($, text(call.task_id) || text(call.shell_id))
      if (PLAN_TOOLS.has(call.tool)) notePlanned()
      else {
        const plan = await read($, planAtom)
        const note = nudgeFor(plan.steps.some(st => st.status !== 'completed'))
        const had = (ran as { context?: readonly string[] }).context ?? []
        if (note) return { ...ran, context: [...had, note] } as typeof ran
      }
    } catch (err) {
      await logError($, 'tool.call', err)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Presses in the pane: "sec-<id>" folds a section, "c:<name>" shows or hides a connector's calls, "ag:<id>" an agent's steps.
  on('ui.press', { plugin: 'whatishappening' }, async ($, e) => {
    const el = e.element
    if (el.startsWith('sec-')) {
      const id = el.slice(4)
      await update($, foldedAtom, cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]))
    } else if (el.startsWith('c:') || el.startsWith('ag:')) {
      const name = el.startsWith('c:') ? el.slice(2) : el
      await update($, openAtom, cur => (cur === name ? '' : name))
    } else if (el === 'sess-refresh') {
      await loadSessions($)
    } else if (el.startsWith('more:')) {
      const dir = el.slice(5)
      await update($, expandedAtom, cur => (cur.includes(dir) ? cur.filter(x => x !== dir) : [...cur, dir]))
    } else if (el.startsWith('sess:')) {
      await pickSession($, el.slice(5))
    }
    return { element: el }
  })

  // The plan's progress in the band above the prompt. Other plugins' bands stay below it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const plan = await read($, planAtom)
    if (!plan.steps.length) return below
    // The pane's To-do already shows the same bar: the band is for when the pane is not in sight.
    if (await isPaneInSight($)) return below
    // A finished plan shows at 100% for a while, then the band goes back to the others'.
    if (plan.steps.every(st => st.status === 'completed')) {
      const left = plan.updatedAt + DONE_HOLD_MS - (await $.clock.now())
      if (left <= 0) return below
      if (holdFor !== plan.updatedAt) {
        holdFor = plan.updatedAt
        $.clock.after(left + 50, () => $.ui.invalidate('ui.render'))
      }
    }
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // Desktop and VS Code draw block glyphs wider than a cell, so a text bar wraps and the band scrolls:
    // there the bar is a fixed-size picture.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const cols = Math.max(30, e.props.bodyColumns)
    const done = plan.steps.filter(st => st.status === 'completed').length
    const pct = Math.round((done / plan.steps.length) * 100)
    const label = `Tasks ${done}/${plan.steps.length} ${pct}%`
    // One segment per step, then the step Claude is on, which a narrow band cuts first.
    const current = plan.steps.find(st => st.status === 'in_progress')
    const barCols = Math.max(8, Math.min(plan.steps.length * 6, 40, cols - PLUGIN.length - label.length - 6))
    return (
      <Box flexDirection="column">
        <Box key="wih-band" flexDirection="row" width={cols} height={1} gap={1}>
          <Text color={ACCENT}>●</Text>
          <Box flexShrink={0}>
            <Text bold>{PLUGIN}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={ACCENT} bold>{label}</Text>
          </Box>
          {Svg ? (
            <Svg source={stepsSvg(plan.steps, BAR_PX, BAR_H)} alt={`${done} of ${plan.steps.length} steps done`} width={BAR_PX} height={BAR_H} />
          ) : (
            <Box flexShrink={0} height={1}>
              {stepsText(Text as never, plan.steps, barCols) as never}
            </Box>
          )}
          {current ? (
            <Box flexShrink={1} overflow="hidden" height={1}>
              <Text wrap="truncate-end">{current.active || current.text}</Text>
            </Box>
          ) : null}
        </Box>
        {(below ?? null) as never}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Desktop and VS Code draw type sizes and pictures, and a Button there is a native button whatever its props:
    // they get headings and SVG bars and no Buttons. The terminal keeps its text drawing and its fold arrows.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const width = Math.max(24, e.props.bodyColumns)
    const inner = width - 4
    // One row tall, on the terminal only: elsewhere a row is as tall as its text, and a fixed height let text spill
    // over the next card.
    const H1 = Svg ? undefined : 1
    const px = (cols: number) => Math.max(40, Math.round(cols * PX_PER_COL))
    const used = await read($, usedAtom)
    const plan = await read($, planAtom)
    const folded = await read($, foldedAtom)
    const openName = await read($, openAtom)
    const usage = await read($, usageAtom)
    const agents = (await read($, agentsAtom)).filter(isKnown).sort((a, b) => Number(LIVE.has(b.status)) - Number(LIVE.has(a.status)) || b.seq - a.seq)

    const line = (key: string, left: unknown, right?: unknown) => (
      <Box key={key} flexDirection="row" width={inner} height={H1} gap={1}>
        <Box flexGrow={1} flexShrink={1} height={H1} overflow="hidden">
          {left as never}
        </Box>
        {right ? <Box flexShrink={0}>{right as never}</Box> : null}
      </Box>
    )
    const note = (key: string, s: string) => (
      <Text key={key} size="caption" color="subtle" wrap="truncate-end">
        {s}
      </Text>
    )
    const capped = (key: string, rows: unknown[]) =>
      rows.length > MAX_ROWS ? [...rows.slice(0, MAX_ROWS), note(`${key}-more`, `+${rows.length - MAX_ROWS} more`)] : rows
    // A section: its color on the border, the dot and the summary; the border dims while nothing in it is moving.
    const block = (id: (typeof SECTIONS)[number], title: string, right: string, body: unknown, isActive = true, bar?: unknown) => {
      const shut = !Svg && folded.includes(id)
      const tint = SECTION_COLOR[id]
      const head = Svg ? (
        <Box key="head" flexDirection="row" justifyContent="space-between" width={inner} marginBottom={1}>
          <Text>
            <Text color={tint}>● </Text>
            <Text weight="semibold">{title}</Text>
          </Text>
          {bar ? (bar as never) : null}
          {right ? (
            <Text size="caption" color={tint} tabular>
              {right}
            </Text>
          ) : null}
        </Box>
      ) : (
        <Box key="head" flexDirection="row" justifyContent="space-between" width={inner}>
          <Button key={`sec-${id}`} plain onPress={() => undefined}>
            <Text color={tint}>{shut ? '▸ ' : '▾ '}</Text>
            <Text bold>{title}</Text>
          </Button>
          {bar ? (bar as never) : null}
          {right ? <Text color={tint}>{right}</Text> : null}
        </Box>
      )
      return (
        <Box key={id} flexDirection="column" borderStyle="round" borderColor={tint} borderDimColor={!isActive} paddingX={1} paddingY={Svg ? 1 : 0} width={width} flexShrink={0}>
          {head}
          {shut ? null : (body as never)}
        </Box>
      )
    }
    const nothing = note('none', 'None used yet')

    // ---------- Usage ----------
    const now = usage.at || (await $.clock.now())
    const pctOf = (l: LimitRow) => Math.round(l.percent)
    // A reading from an earlier session whose window has reset since says nothing about now.
    const isOver = (l: LimitRow) => Boolean(l.asOf && l.resetsAt && l.resetsAt <= now)
    const tailOf = (l: LimitRow) =>
      isOver(l)
        ? `reset at ${resetText(l.resetsAt, now)}`
        : `${l.resetsAt ? `in ${untilText(l.resetsAt - now)} · ${resetText(l.resetsAt, now)}` : ''}${l.asOf ? `${l.resetsAt ? ' · ' : ''}as of ${hhmm(l.asOf)}` : ''}`
    const ctxPct = usage.contextWindow ? (usage.contextTokens / usage.contextWindow) * 100 : 0
    const ctxTail = `${kTokens(usage.contextTokens)} of ${kTokens(usage.contextWindow)}`
    const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite
    const tokenParts = `in ${kTokens(usage.input)} · out ${kTokens(usage.output)} · cache ${kTokens(usage.cacheRead)} read, ${kTokens(usage.cacheWrite)} write`
    let usageBody: unknown[]
    if (Svg) {
      // Two stat tiles side by side, then the context bar and the tokens.
      const tileCols = Math.floor((inner - 2) / 2)
      const tile = (key: string, label: string, l: LimitRow | null) => (
        <Box key={key} flexDirection="column" width={tileCols} flexShrink={0}>
          {note('label', label)}
          <Text key="value" size="heading" weight="semibold" tabular dimColor={Boolean(l?.asOf)}>
            {l && !isOver(l) ? `${pctOf(l)}%` : '–'}
          </Text>
          {l && !isOver(l) ? <Svg key="bar" source={cellsSvg(l.percent / 100, px(tileCols), 10)} alt={`${label}: ${pctOf(l)}% used`} width={px(tileCols)} height={10} /> : null}
          {note('reset', l ? tailOf(l) || ' ' : 'no reading yet')}
          {l && isOver(l) ? note('next', 'new reading after the next reply') : null}
        </Box>
      )
      usageBody = [
        <Box key="limits" flexDirection="row" width={inner} gap={2}>
          {tile('l5', '5-hour limit', usage.fiveHour)}
          {tile('l7', '7-day limit', usage.sevenDay)}
        </Box>,
        usage.contextWindow ? (
          <Box key="ctx" flexDirection="column" width={inner} marginTop={1}>
            {line('ctx-figs', note('l', `Context · ${Math.round(ctxPct)}%`), note('r', ctxTail))}
            <Svg key="bar" source={cellsSvg(ctxPct / 100, px(inner), 10)} alt={`Context: ${Math.round(ctxPct)}% full`} width={px(inner)} height={10} />
          </Box>
        ) : null,
        <Box key="tok" flexDirection="column" width={inner} marginTop={1}>
          {line(
            'tok-figs',
            note('l', 'Session tokens'),
            <Text weight="semibold" tabular>
              {kTokens(total)}
            </Text>,
          )}
          {note('parts', tokenParts)}
        </Box>,
      ]
    } else {
      // Compact: one row for the context and one for the two limits (side by side when they fit).
      const BAR = METER_CELLS
      const meter = (key: string, label: string, pct: number, tail: string) => {
        const fill = Math.round((Math.min(100, Math.max(0, pct)) / 100) * BAR)
        return (
          <Text key={key} wrap="truncate-end">
            <Text dimColor>{`${label.padEnd(4)}`}</Text>
            {Array.from({ length: BAR }, (_, i) =>
              i < fill ? (
                <Text key={`c${i}`} color={ZONE_TEXT[cellZone(i, BAR)]}>
                  ■
                </Text>
              ) : (
                <Text key={`c${i}`} dimColor>
                  ■
                </Text>
              ),
            )}
            <Text> </Text>
            <Text bold>{`${Math.round(pct)}%`}</Text>
            {tail ? <Text dimColor>{` ${tail}`}</Text> : null}
          </Text>
        )
      }
      const limit = (key: string, label: string, l: LimitRow | null) =>
        l && !isOver(l) ? meter(key, label, l.percent, tailOf(l)) : <Text key={key} dimColor wrap="truncate-end">{`${label.padEnd(4)}${l ? tailOf(l) : 'no reading yet'}`}</Text>
      const row = (key: string, ...cells: unknown[]) => (
        <Box key={key} flexDirection="row" width={inner} height={H1} gap={3} overflow="hidden">
          {cells as never}
        </Box>
      )
      // Each limit takes about 36 columns with its reset time.
      const limits = [limit('l5', '5h', usage.fiveHour), limit('l7', '7d', usage.sevenDay)]
      usageBody = [
        usage.contextWindow ? row('ctx', meter('m', 'ctx', ctxPct, ctxTail)) : null,
        ...(inner >= 75 ? [row('lim', ...limits)] : limits.map((m, i) => row(`lim${i}`, m))),
      ]
    }

    // ---------- To-do: a mark in a fixed column, the step's words wrapped beside it ----------
    const done = plan.steps.filter(st => st.status === 'completed').length
    const stepRow = (st: PlanStep, i: number, cols = inner) => {
      const isDone = st.status === 'completed'
      const isNow = st.status === 'in_progress'
      return (
        <Box key={`step${i}`} flexDirection="row" width={cols} flexShrink={0}>
          <Box width={2} flexShrink={0}>
            {isDone ? <Text color="success">✓</Text> : isNow ? <Text color="claude">●</Text> : <Text dimColor>○</Text>}
          </Box>
          <Box flexDirection="column" width={cols - 2} flexShrink={0}>
            {wrap(isNow && st.active ? st.active : st.text, cols - 2).map((l, j) => (
              <Text key={`w${j}`} wrap="truncate-end" dimColor={isDone} strikethrough={isDone} bold={isNow}>
                {l}
              </Text>
            ))}
          </Box>
        </Box>
      )
    }
    const todoBody = plan.steps.length
      ? [...(plan.title ? wrap(plan.title, inner).map((l, i) => note(`title${i}`, l)) : []), ...plan.steps.map((st, i) => stepRow(st, i))]
      : wrap('No to-do list yet. Claude makes one for jobs with 3 or more steps.', inner).map((l, i) => (
          <Text key={`noplan${i}`} dimColor wrap="truncate-end">
            {l}
          </Text>
        ))

    // ---------- Context files: the name, then its folder ----------
    const files = byNewest(used.files)
    const folderOf = (path: string) => folderLabel(path, files.map(([p]) => p))
    const fileBody = files.length
      ? capped(
          'files',
          files.map(([path, t]) =>
            line(
              `f:${path}`,
              <Text wrap="truncate-end">
                <Text weight="medium">{fileName(path)}</Text>
                <Text color="subtle">{`  ${folderOf(path)}`}</Text>
              </Text>,
              t.auto ? (
                <Text size="caption" color="suggestion">
                  at start
                </Text>
              ) : t.count > 1 ? (
                <Text size="caption" color="subtle" tabular>
                  {`${t.count}×`}
                </Text>
              ) : null,
            ),
          ),
        )
      : nothing

    // ---------- Connectors: one row each, with its latest call ----------
    const nowMs = await $.clock.now()
    // ---------- Background: the commands Claude left running, each with its clock ----------
    const background = (await read($, backgroundAtom)).filter(t => nowMs - t.startedAt < BACKGROUND_TTL)
    const backgroundBody = background.map(t =>
      line(
        `bg:${t.id}`,
        <Text wrap="truncate-end">
          <Text color="warning">$ </Text>
          <Text weight="medium">{t.what}</Text>
        </Text>,
        e.surface === 'terminal' && 'Client' in els ? (
          <els.Client key={`clock:${t.id}`} module="./clock.tsx" props={{ since: t.startedAt, now: nowMs, endAt: null }} />
        ) : (
          <Text key={`clock:${t.id}`} size="caption" color="subtle" tabular>
            {runText(nowMs - t.startedAt)}
          </Text>
        ),
      ),
    )
    const conns = byNewest(used.connectors)
    const callLine = (c: CallRow) => `${c.what}${c.arg ? ` · ${c.arg}` : ''}`
    const callRows = (name: string, calls: CallRow[]) =>
      [...calls].reverse().slice(0, 10).map((c, i) =>
        line(`call:${name}:${i}`, <Text wrap="truncate-end">{`  ${callLine(c)}`}</Text>, c.at ? <Text dimColor>{whenText(c.at, nowMs)}</Text> : null),
      )
    const connBody = conns.length
      ? capped(
          'conns',
          conns.map(([name, t]) => {
            const latest = t.calls?.[t.calls.length - 1]
            // When it was last used, where known.
            const count = (
              <Text size="caption" color="claude" tabular>
                {`${plural(t.count, 'call')}${latest?.at ? ` · ${whenText(latest.at, nowMs)}` : ''}`}
              </Text>
            )
            return Svg ? (
              <Box key={`c-${name}`} flexDirection="column" width={inner} flexShrink={0}>
                {line('name', <Text weight="medium">{name}</Text>, count)}
                {latest ? (
                  <Text key="latest" size="caption" color="subtle" mono wrap="truncate-end">
                    {`↳ ${callLine(latest)}`}
                  </Text>
                ) : null}
              </Box>
            ) : (
              <Box key={`c-${name}`} flexDirection="column" width={inner} flexShrink={0}>
                {line(
                  'name',
                  <Button key={`c:${name}`} plain onPress={() => undefined}>
                    {`${openName === name ? '▾' : '▸'} ${name}`}
                  </Button>,
                  count,
                )}
                {openName === name ? (callRows(name, t.calls ?? []) as never) : null}
              </Box>
            )
          }),
        )
      : nothing

    const MARKS: Record<ActionKind, [string, string]> = {
      read: ['›', 'subtle'],
      edit: ['✎', 'warning'],
      run: ['$', 'suggestion'],
      search: ['⌕', 'subtle'],
      web: ['◍', 'suggestion'],
      connector: ['⇄', 'success'],
      other: ['•', 'subtle'],
    }
    // ---------- Agents: live ones first, each with its task and its latest action ----------
    const live = agents.filter(a => LIVE.has(a.status)).length
    const mark = (s: string) =>
      s === 'running' ? <Text color="claude">●</Text>
      : s === 'completed' ? <Text color="success">✓</Text>
      : s === 'failed' || s === 'killed' ? <Text color="error">✗</Text>
      : <Text color="suggestion">◌</Text>
    // shortcut: a live run time moves when the pane redraws (each call, each 30 s usage read); add a 1 s timer if that is too coarse.
    const ranFor = (a: AgentRow) =>
      !a.startedAt ? '' : LIVE.has(a.status) ? runText(nowMs - a.startedAt) : a.endedAt ? runText(a.endedAt - a.startedAt) : ''
    // The run time: a live clock where the surface runs one (it ticks without a redraw), else the figure at this redraw.
    const clock = (a: AgentRow) => {
      if (!ranFor(a)) return null
      const endAt = LIVE.has(a.status) ? null : (a.endedAt ?? null)
      // The ticking clock runs where it is known to draw, the terminal; elsewhere the figure at this redraw.
      return e.surface === 'terminal' && 'Client' in els ? (
        <els.Client key={`clock:${a.id}`} module="./clock.tsx" props={{ since: a.startedAt, now: nowMs, endAt }} />
      ) : (
        <Text key={`clock:${a.id}`} size="caption" color="subtle" tabular>
          {ranFor(a)}
        </Text>
      )
    }
    // One agent as a card `w` columns wide, in the agent's own color. A live one shows its to-do list or its latest
    // steps; a finished one folds to one line of figures, its steps a press away (in the terminal).
    const colors = agentColors(agents.map(a => a.id))
    const stepMarks = (list: string[], cols: number, liveLast: boolean) => (
      <Box key="trail" flexDirection="column" width={cols} marginTop={1}>
        {list.map((step, i) => {
          const isNow = liveLast && i === list.length - 1
          const [glyph, tint] = isNow ? ['●', 'claude'] : MARKS[actionMark(step)]
          return (
            <Box key={`t${i}`} flexDirection="row" width={cols} height={H1}>
              <Box width={2} flexShrink={0}>
                <Text color={tint}>{glyph}</Text>
              </Box>
              <Box width={cols - 2} flexShrink={0} height={H1} overflow="hidden">
                <Text size="caption" mono wrap="truncate-end" color={isNow ? undefined : 'subtle'} bold={isNow}>
                  {step}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
    const agentCard = (a: AgentRow, w: number) => {
      const cols = w - 4
      const narrow = w < 40
      const isLive = LIVE.has(a.status)
      const color = colors.get(a.id) ?? SECTION_COLOR.agents
      const steps = a.plan ?? []
      const stepsDone = steps.filter(st => st.status === 'completed').length
      const trail = a.trail?.length ? a.trail : a.doing ? [a.doing] : []
      const barCols = Math.max(4, cols - 6)
      const fillCols = steps.length ? Math.round((stepsDone / steps.length) * barCols) : 0
      const isOpen = openName === `ag:${a.id}`
      const figures = [a.model ? modelName(a.model) : '', plural(a.tools, 'tool'), a.tokens ? `${kTokens(a.tokens)} tokens` : ''].filter(Boolean).join(' · ')
      const progress = steps.length
        ? [
            <Box key="progress" flexDirection="row" width={cols} gap={1} marginTop={1}>
              {Svg ? (
                <Svg key="bar" source={barSvg(stepsDone / steps.length, color, px(barCols), 8)} alt={`${stepsDone} of ${steps.length} steps done`} width={px(barCols)} height={8} />
              ) : (
                <Text key="bar">
                  <Text color={color}>{'█'.repeat(fillCols)}</Text>
                  <Text dimColor>{'░'.repeat(barCols - fillCols)}</Text>
                </Text>
              )}
              <Text size="caption" color="subtle" tabular>{`${stepsDone}/${steps.length}`}</Text>
            </Box>,
            ...(isLive || isOpen ? steps.slice(0, narrow ? 3 : 8).map((st, i) => stepRow(st, i, cols)) : []),
          ]
        : []
      const body = isLive
        ? steps.length
          ? progress
          : trail.length
            ? [stepMarks(trail.slice(narrow ? -2 : -5), cols, true)]
            : [note('trail', 'Starting…')]
        : [...progress, isOpen && !steps.length && trail.length ? stepMarks(trail, cols, false) : null]
      return (
        <Box key={`a:${a.id}`} flexDirection="column" borderStyle="round" borderColor={color} borderDimColor={!isLive} paddingX={1} width={w} flexShrink={0}>
          <Box key="who" flexDirection="row" width={cols} height={H1} gap={1}>
            <Box flexGrow={1} flexShrink={1} height={H1} overflow="hidden">
              <Text wrap="truncate-end">
                {mark(a.status)}
                <Text weight="semibold" bold color={color}>{` ${a.type}`}</Text>
              </Text>
            </Box>
            <Box flexShrink={0}>{clock(a) as never}</Box>
          </Box>
          {a.description
            ? wrap(a.description, cols)
                .slice(0, narrow || !isLive ? 1 : 2)
                .map((l, i) => (
                  <Text key={`task${i}`} wrap="truncate-end" dimColor={!isLive}>
                    {l}
                  </Text>
                ))
            : null}
          {note('facts', isLive ? figures : [a.status === 'completed' ? '' : a.status, figures].filter(Boolean).join(' · '))}
          {!isLive && a.endedAt ? note('ended', `${a.status === 'completed' ? 'Finished' : 'Ended'} ${whenText(a.endedAt, nowMs)}`) : null}
          {body as never}
        </Box>
      )
    }
    // More than three agents: one activity lane each on a shared time axis. A bar's height is how many calls the agent
    // made in that slice of time, so a lane shows when each one was busy, idle or done, side by side with the others.
    const lanes = (list: AgentRow[]) => {
      const t0 = Math.min(...list.map(a => a.startedAt || nowMs))
      const span = Math.max(1000, nowMs - t0)
      const nameCols = Math.min(16, Math.max(8, Math.floor(inner / 4)))
      const laneCols = Math.max(8, inner - 2 - nameCols - 9 - 2)
      const slot = (ms: number) => Math.min(laneCols - 1, Math.max(0, Math.floor(((ms - t0) / span) * laneCols)))
      const rows = list.map(a => {
        const counts = new Array<number>(laneCols).fill(0)
        for (const b of a.beats ?? []) counts[slot(b)]! += 1
        const from = a.startedAt ? slot(a.startedAt) : 0
        const to = LIVE.has(a.status) ? laneCols - 1 : a.endedAt ? slot(a.endedAt) : laneCols - 1
        return { a, counts, from, to }
      })
      const peak = Math.max(1, ...rows.flatMap(r => r.counts))
      const level = (n: number) => LEVELS[Math.min(LEVELS.length - 1, Math.ceil((n / peak) * (LEVELS.length - 1)))]!
      const laneSvg = (r: (typeof rows)[number]) => {
        const cell = px(laneCols) / laneCols
        const bars = r.counts
          .map((n, i) => {
            if (i < r.from || i > r.to) return ''
            const h = n ? Math.max(3, Math.round((n / peak) * 14)) : 1
            return `<rect x="${(i * cell).toFixed(1)}" y="${16 - h}" width="${Math.max(1, cell - 1).toFixed(1)}" height="${h}" rx="1" fill="${n ? (colors.get(r.a.id) ?? INFO) : '#80808060'}"/>`
          })
          .join('')
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(laneCols)} 16" width="${px(laneCols)}" height="16">${bars}</svg>`
      }
      return [
        ...rows.map(r => (
          <Box key={`lane:${r.a.id}`} flexDirection="row" width={inner} gap={1} height={Svg ? undefined : 1} flexShrink={0}>
            <Box width={2} flexShrink={0}>
              {mark(r.a.status)}
            </Box>
            <Box width={nameCols} flexShrink={0} overflow="hidden" height={H1}>
              <Text wrap="truncate-end" weight="semibold" bold color={colors.get(r.a.id)}>
                {r.a.description || r.a.type}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} overflow="hidden" height={Svg ? undefined : 1}>
              {Svg ? (
                <Svg source={laneSvg(r)} alt={`${r.a.description || r.a.type}: ${plural(r.a.tools, 'tool call')}`} width={px(laneCols)} height={16} />
              ) : (
                <Text>
                  {r.counts.map((n, i) => (
                    <Text key={`c${i}`} color={n ? colors.get(r.a.id) : undefined} dimColor={!n}>
                      {i < r.from || i > r.to ? ' ' : n ? level(n) : '·'}
                    </Text>
                  ))}
                </Text>
              )}
            </Box>
            <Box flexShrink={0}>{clock(r.a) as never}</Box>
          </Box>
        )),
        note('lanes-key', `Busy over the last ${runText(span)}: the taller the bar, the more calls in that moment.`),
      ]
    }
    const cardsAcross = Math.min(3, Math.max(1, Math.floor((inner + 1) / (MIN_CARD + 1))))
    // Cards side by side when they fit, else one under the other.
    const cards = (list: AgentRow[], key: string) =>
      list.length > 1 && cardsAcross >= list.length
        ? [
            <Box key={key} flexDirection="row" width={inner} gap={1}>
              {list.map(a => agentCard(a, Math.floor((inner - (list.length - 1)) / list.length)))}
            </Box>,
          ]
        : list.map(a => agentCard(a, inner))
    // A finished agent is one line in its color, however many there are; in the terminal a press opens its card.
    const doneRow = (a: AgentRow) => {
      const color = colors.get(a.id) ?? SECTION_COLOR.agents
      const isOpen = openName === `ag:${a.id}`
      const name = (
        <Text wrap="truncate-end">
          <Text color={a.status === 'completed' ? 'success' : 'error'}>{a.status === 'completed' ? '✓ ' : '✗ '}</Text>
          <Text bold weight="semibold" color={color}>{a.type}</Text>
          <Text>{a.description ? `  ${a.description}` : ''}</Text>
        </Text>
      )
      const figs = [ranFor(a), a.tokens ? kTokens(a.tokens) : '', a.endedAt ? whenText(a.endedAt, nowMs) : ''].filter(Boolean).join(' · ')
      return (
        <Box key={`done:${a.id}`} flexDirection="column" width={inner} flexShrink={0}>
          {line(
            'row',
            Svg ? name : (
              <Button key={`ag:${a.id}`} plain onPress={() => undefined}>
                <Text color={color}>{isOpen ? '▾ ' : '▸ '}</Text>
                {name}
              </Button>
            ),
            figs ? <Text size="caption" color="subtle" tabular>{figs}</Text> : null,
          )}
          {isOpen ? agentCard(a, inner) : null}
        </Box>
      )
    }
    const atWork = agents.filter(a => LIVE.has(a.status))
    const finished = agents.filter(a => !LIVE.has(a.status))
    const group = (key: string, label: string, tint: string, list: AgentRow[], rows: unknown[]) =>
      list.length
        ? [
            <Text key={`g:${key}`} color={tint} bold wrap="truncate-end">{`${label} · ${list.length} ${'─'.repeat(Math.max(0, inner - label.length - String(list.length).length - 4))}`}</Text>,
            ...rows,
          ]
        : []
    // More than three agents at work: their activity lanes; the finished ones still get their folded cards.
    const agentBody = !agents.length
      ? note('none', 'No agents yet')
      : [
          ...group('run', 'Running', 'claude', atWork, atWork.length > 3 ? lanes(atWork) : cards(atWork, 'run-cards')),
          ...group('done', 'Finished', 'success', finished, capped('done', finished.map(doneRow))),
        ]
    const agentTokens = agents.reduce((n, a) => n + (a.tokens ?? 0), 0)
    const agentSummary = [`${live} running`, `${agents.length - live} done`, agentTokens ? `${kTokens(agentTokens)} tokens` : ''].filter(Boolean).join(' · ')

    // ---------- Skills ----------
    const skills = byNewest(used.skills)
    const skillBody = skills.length
      ? capped(
          'skills',
          skills.map(([name, t]) =>
            line(
              `s:${name}`,
              <Text wrap="truncate-end">
                <Text color="claude">/</Text>
                <Text weight="medium">{name}</Text>
              </Text>,
              <Text size="caption" color="subtle">
                {[t.auto ? 'at start' : '', t.count ? plural(t.count, 'use') : ''].filter(Boolean).join(' · ')}
              </Text>,
            ),
          ),
        )
      : nothing

    // The line on top: what the chat is doing right now, in one glance.
    const running = agents.filter(a => a.status === 'running').length
    const current = plan.steps.find(st => st.status === 'in_progress')
    const isWorking = Boolean(current) || running > 0 || background.length > 0
    const waiting = background.length ? `${background.length} in background` : ''
    const headline = current
      ? current.active || current.text
      : plan.steps.length && done === plan.steps.length
        ? `Done: ${plan.title || 'every step'}`
        : running
          ? `${plural(running, 'agent')} at work`
          : background.length
            ? `Waiting on ${plural(background.length, 'background command')}`
            : 'Waiting for the next job'
    const aside = [current && running ? plural(running, 'agent') : '', current || running ? waiting : '', usage.fiveHour ? `5h ${pctOf(usage.fiveHour)}%` : ''].filter(Boolean).join(' · ')
    const totalCalls = conns.reduce((n, [, t]) => n + t.count, 0)
    const pctDone = plan.steps.length ? Math.round((done / plan.steps.length) * 100) : 0
    // The To-do header's own bar, between its title and its count: one segment per step.
    const todoBarCols = Math.max(0, inner - 'To-do'.length - 2 - `${done}/${plan.steps.length} · ${pctDone}%`.length - 4)
    const todoBar = !plan.steps.length || todoBarCols < plan.steps.length
      ? null
      : Svg ? (
          <Svg key="steps" source={stepsSvg(plan.steps, px(todoBarCols), 16)} alt={`${done} of ${plan.steps.length} steps done`} width={px(todoBarCols)} height={16} />
        ) : (
          <Box key="steps" flexShrink={0} height={1}>
            {stepsText(Text as never, plan.steps, todoBarCols) as never}
          </Box>
        )
    const limits = [usage.fiveHour ? `5h ${pctOf(usage.fiveHour)}%` : '', usage.sevenDay ? `7d ${pctOf(usage.sevenDay)}%` : ''].filter(Boolean).join(' · ')

    return (
      <Box flexDirection="column" width={width} gap={Svg ? 1 : 0}>
        {Svg ? (
          <Box key="now" flexDirection="column" width={width} paddingX={1}>
            <Box key="now-top" flexDirection="row" justifyContent="space-between" width={width - 2}>
              <Text color={isWorking ? 'claude' : 'subtle'} weight="semibold">
                {isWorking ? '▶ NOW' : '■ IDLE'}
              </Text>
              {aside ? (
                <Text size="caption" color="subtle" tabular>
                  {aside}
                </Text>
              ) : null}
            </Box>
            {wrap(headline, width - 2)
              .slice(0, 2)
              .map((l, i) => (
                <Text key={`now${i}`} weight="medium" dimColor={!isWorking} wrap="truncate-end">
                  {l}
                </Text>
              ))}
          </Box>
        ) : (
          <Box key="now" flexDirection="row" width={width} paddingX={1} gap={1} height={1} flexShrink={0}>
            <Box flexShrink={0}>
              <Text color={isWorking ? 'claude' : 'subtle'} weight="semibold">
                {isWorking ? '▶ NOW' : '■ IDLE'}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
              <Text wrap="truncate-end" weight="medium" dimColor={!isWorking}>
                {headline}
              </Text>
            </Box>
            {aside ? (
              <Box flexShrink={0}>
                <Text size="caption" color="subtle" tabular>
                  {aside}
                </Text>
              </Box>
            ) : null}
          </Box>
        )}
        {block('usage', 'Usage', limits, usageBody)}
        {/* Sections with nothing to show take no room. */}
        {plan.steps.length ? block('todo', 'To-do', `${done}/${plan.steps.length} · ${pctDone}%`, todoBody, done < plan.steps.length, todoBar) : null}
        {background.length ? block('background', 'Background', `${background.length} running`, backgroundBody) : null}
        {files.length ? block('files', 'Context files', plural(files.length, 'file'), fileBody) : null}
        {conns.length ? block('connectors', 'Connectors', `${conns.length} · ${plural(totalCalls, 'call')}`, connBody) : null}
        {agents.length ? block('agents', 'Agents', agentSummary, agentBody, live > 0) : null}
        {skills.length ? block('skills', 'Skills', plural(skills.length, 'skill'), skillBody) : null}
      </Box>
    )
  })
  // The Sessions pane: recent sessions grouped by folder, this folder first. A press picks one up (see pickSession).
  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(24, e.props.bodyColumns)
    const inner = width - 4
    const H1 = e.surface === 'terminal' ? 1 : undefined
    const list = await read($, sessionsAtom)
    const shown = await read($, shownAtom)
    const expanded = await read($, expandedAtom)
    const cwd = await $.session.cwd()
    const self = await $.session.id()
    const now = list.at || (await $.clock.now())
    const groups = [...list.groups].sort((a, b) => Number(b.cwd === cwd) - Number(a.cwd === cwd))
    const folder = (p: string) => tilde(p) || p
    const quote = (p: string) => (/^[\w~@./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`)
    const body = groups.length
      ? groups.map(g => {
          const here = g.cwd === cwd
          const isOpen = expanded.includes(g.cwd)
          const items = isOpen ? g.items : g.items.slice(0, PER_FOLDER)
          const more = g.items.length - PER_FOLDER
          return (
            <Box key={`g:${g.cwd}`} flexDirection="column" borderStyle="round" borderColor={here ? 'claude' : undefined} borderDimColor={!here} paddingX={1} width={width} flexShrink={0}>
              <Box key="head" flexDirection="row" justifyContent="space-between" width={inner}>
                <Text wrap="truncate-end">
                  <Text color={here ? 'claude' : 'subtle'}>▣ </Text>
                  <Text weight="semibold">{folder(g.cwd)}</Text>
                </Text>
                <Text size="caption" color={here ? 'claude' : 'subtle'}>
                  {here ? 'this folder' : plural(g.items.length, 'session')}
                </Text>
              </Box>
              {items.map(it => {
                const isSelf = it.id === self
                const label = it.title || `Untitled · ${it.id.slice(0, 8)}`
                return (
                  <Box key={`s:${it.id}`} flexDirection="column" width={inner} flexShrink={0}>
                    <Box key="row" flexDirection="row" width={inner} height={H1} gap={1}>
                      <Box flexGrow={1} flexShrink={1} height={H1} overflow="hidden">
                        {isSelf ? (
                          <Text wrap="truncate-end">
                            <Text color="claude">● </Text>
                            <Text weight="semibold">{label}</Text>
                          </Text>
                        ) : (
                          <Button key={`sess:${it.id}`} plain dimColor={!here} onPress={() => undefined}>
                            {`○ ${label}`}
                          </Button>
                        )}
                      </Box>
                      <Box flexShrink={0}>
                        <Text size="caption" color="subtle" tabular>
                          {isSelf ? 'this chat' : ageText(now - it.at)}
                        </Text>
                      </Box>
                    </Box>
                    {shown === it.id ? (
                      <Box key="cmd" flexDirection="column" width={inner} paddingLeft={2}>
                        <Text size="caption" color="subtle">
                          From another folder. In a terminal, run:
                        </Text>
                        <Text mono wrap="wrap">{`cd ${quote(folder(g.cwd))} && claude --resume ${it.id}`}</Text>
                      </Box>
                    ) : null}
                  </Box>
                )
              })}
              {more > 0 ? (
                <Button key={`more:${g.cwd}`} plain dimColor onPress={() => undefined}>
                  {isOpen ? '▴ Show fewer' : `▾ +${more} older`}
                </Button>
              ) : null}
            </Box>
          )
        })
      : [
          <Text key="none" color="subtle">
            No sessions found yet.
          </Text>,
        ]
    return (
      <Box flexDirection="column" width={width} gap={e.surface === 'terminal' ? 0 : 1}>
        <Box key="top" flexDirection="row" justifyContent="space-between" width={width} paddingX={1}>
          <Text size="caption" color="subtle">
            Press a session of this folder to pick it up.
          </Text>
          <Button key="sess-refresh" plain dimColor onPress={() => undefined}>
            ↻
          </Button>
        </Box>
        {body as never}
      </Box>
    )
  })
}
