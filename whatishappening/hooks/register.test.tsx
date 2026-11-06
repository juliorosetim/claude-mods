import { expect, mock, test } from 'claude-code/testing'

import { actionMark, agentColors, cellZone, segmentWidths, callTimes, folderLabel, whenText, cleanLog, endedTaskId, startedTaskId, logEventOf, noticeOf, plainWords, modelName, promptLabel, serverLabel, sessionGroups, storyLine, storyOf, tokenTotals, USAGE_SED } from './register'

type On = Parameters<NonNullable<Parameters<typeof test>[2]>>[1]
type Call = (input: Record<string, unknown>) => Promise<{ result?: unknown; context?: string[] }>

const START = { source: 'startup', cwd: '/home/dev/project', isInteractive: true }
const SURFACES = ['desktop', 'terminal'] as const
const PANE = { title: 'What is happening', isFocused: false, bodyColumns: 48, placement: 'dock' } as never
const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never

/** Keys a path the same wherever the mod thinks home is: everything from /.claude/ on. */
const key = (p: string) => (p.includes('/.claude/') ? `~${p.slice(p.indexOf('/.claude/'))}` : p)

type World = {
  files?: Record<string, string>
  opened?: string[]
  history?: unknown[] | (() => Promise<unknown[]>)
  noLimits?: boolean
  /** The panes `$.ui.panes()` lists. */
  panes?: { id: string; isShown: boolean; isPlaced: boolean }[]
  /** stdout for a process.run, by its argv; '' when it gives none. */
  run?: (argv: string[]) => string
  /** What $.prompt.fill put in the prompt box. */
  filled?: string[]
  /** A tool's result, by its name; 'ok' for the rest. */
  results?: Record<string, string>
}

/** Answers every $ call the mod makes, from a fake disk and a fixed session. */
function world(on: On, w: World = {}) {
  const files = w.files ?? {}
  const opened = w.opened ?? []
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: { tool: 'mcp__whatishappening__plan' } }) as never)
  on('session.id', async () => ({ value: 'sid' }) as never)
  on('session.cwd', async () => ({ value: '/home/dev/project' }) as never)
  on('session.messages', async () => ({ value: typeof w.history === 'function' ? await w.history() : (w.history ?? []) }) as never)
  on('session.usage', async () =>
    ({
      value: {
        context: {
          tokens: 53_300,
          window: 1_000_000,
          breakdown: {
            memoryFiles: [
              { path: '/home/dev/project/CLAUDE.md', type: 'Project', tokens: 500 },
              { path: '/home/dev/.claude/skills/house-style/SKILL.md', type: 'User', tokens: 300 },
            ],
            skills: { totalSkills: 1, includedSkills: 1, tokens: 10, skillFrontmatter: [{ name: 'release-notes', source: 'userSettings', tokens: 10 }] },
          },
        },
        rateLimits: w.noLimits ? [] : [
          { kind: 'five_hour', percentUsed: 11, resetsAt: new Date(1_000_000 + 135 * 60000).toISOString() },
          { kind: 'seven_day', percentUsed: 6, resetsAt: new Date(1_000_000 + (3 * 1440 + 23 * 60) * 60000).toISOString() },
        ],
      },
    }) as never,
  )
  on('fs.exists', async ($, e) => ({ value: key((e as { path: string }).path) in files }) as never)
  on('fs.read', async ($, e) => ({ value: files[key((e as { path: string }).path)] ?? '' }) as never)
  on('fs.write', async ($, e) => {
    const { path, text } = e as { path: string; text: string }
    files[key(path)] = text
    return { value: undefined } as never
  })
  on('process.run', async ($, e) => ({ value: { exitCode: 0, stdout: w.run?.([...(e as { argv: readonly string[] }).argv]) ?? '', stderr: '' } }) as never)
  on('prompt.fill', async ($, e) => {
    w.filled?.push((e as { text: string }).text)
    return { isFilled: true } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('ui.panes', async () => ({ value: (w.panes ?? []).map(p => ({ title: p.id, isFocused: false, ...p })) }) as never)
  on('ui.invalidate', async () => ({ value: undefined }) as never)
  on('ui.open', async ($, e) => {
    opened.push((e as { id: string }).id)
    return { value: { id: (e as { id: string }).id } } as never
  })
  on('tool.call', async ($, e) => ({ result: w.results?.[(e as { tool: string }).tool] ?? 'ok' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  // A test names the id a spawn answers with `id`; ag1 when it does not.
  on('agent.spawn', async ($, e) => ({ model: 'opus', agentId: (e as { id?: string }).id ?? 'ag1' }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('turn.start', async ($, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('prompt.submit', async ($, e) => e as never)
  // The engine's own band, which ours must keep below it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return (<Text>engine band</Text>) as never
  })
  return mock.clock(on, { now: 1_000_000 })
}

/** A $.state value that already holds what an earlier run wrote, so a reload meets it. */
function stored(on: On, name: string, value: unknown) {
  const box = { value, version: 1 }
  on('state.get', async ($, e, next) => ((e as { key?: string }).key === name ? ({ value: { ...box } } as never) : next(e)))
  on('state.set', async ($, e, next) => {
    const w = e as unknown as { key: string; value: unknown; ifVersion?: number }
    if (w.key !== name) return next(e)
    if (w.ifVersion !== undefined && w.ifVersion !== box.version) return { value: { isSet: false, version: box.version } } as never
    box.value = w.value
    box.version += 1
    return { value: { isSet: true, version: box.version } } as never
  })
  return box
}

const ISSUES = 'mcp__claude_ai_GitLab__search_issues'

test('model ids read as names', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-4-5-20250929'), 'the date is not a version').toBe('Sonnet 4.5')
  expect(modelName('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelName('haiku'), 'an alias').toBe('Haiku')
  expect(modelName('some-other-model'), 'unknown stays as it is').toBe('some-other-model')
})

const SID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`
const SESSIONS_OUT = [
  `1700000300.5\t./-home-dev-project/${SID(1)}.jsonl\t"cwd":"/home/dev/project"\t"aiTitle":"Fix the parser"\t`,
  `1700000200.0\t./-home-dev-other/${SID(2)}.jsonl\t"cwd":"/home/dev/other"\t\t"content":"set up the build"`,
  `1700000100.0\t./-home-dev-project/${SID(3)}.jsonl\t"cwd":"/home/dev/project"\t"customTitle":"Release notes"\t`,
].join('\n')

test('sessions are grouped by folder, the most recent folder first, titled or named by their first prompt', () => {
  const groups = sessionGroups(SESSIONS_OUT)
  expect(groups.map(g => g.cwd)).toEqual(['/home/dev/project', '/home/dev/other'])
  expect(groups[0]!.items.map(it => it.title), 'newest first').toEqual(['Fix the parser', 'Release notes'])
  expect(groups[1]!.items[0]!.title, 'no title: its first prompt').toBe('set up the build')
  expect(groups[0]!.items[0]!.at).toBe(1_700_000_300_500)
  expect(sessionGroups('garbage\n\n'), 'a line that is no session is skipped').toEqual([])
})

test('call times come from the transcript: each tool_use id gets its line\'s timestamp', () => {
  const out = ['"tool_use","id":"toolu_a"', '"tool_use","id":"toolu_b"', '"timestamp":"2026-11-05T14:00:00.000Z"', '"timestamp":"2026-11-05T14:01:00.000Z"', '"tool_use","id":"toolu_c"', '"timestamp":"2026-11-05T14:02:00.000Z"'].join('\n')
  const t = callTimes(out)
  expect(t.get('toolu_a'), 'two calls in one line share its time').toBe(Date.parse('2026-11-05T14:00:00.000Z'))
  expect(t.get('toolu_b')).toBe(Date.parse('2026-11-05T14:00:00.000Z'))
  expect(t.get('toolu_c'), 'a line without calls moves nothing').toBe(Date.parse('2026-11-05T14:02:00.000Z'))
  expect(callTimes('').size).toBe(0)
  const now = new Date(2026, 10, 6, 15, 0).getTime()
  expect(whenText(new Date(2026, 10, 6, 9, 5).getTime(), now), 'today: the time').toBe('09:05')
  expect(whenText(new Date(2026, 10, 5, 11, 12).getTime(), now), 'before: the date too').toBe('Nov 5, 11:12')
})

test('each agent gets a color of its own, the same on every redraw', () => {
  const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']
  const c = agentColors(ids)
  expect(new Set(c.values()).size, 'no two agents share one').toBe(ids.length)
  expect(agentColors([...ids].reverse()).get('c3'), 'order does not move it').toBe(c.get('c3'))
  expect(actionMark('Bash npm test')).toBe('run')
  expect(actionMark('GitLab: search issues login')).toBe('connector')
  expect(actionMark('Hand back its report')).toBe('other')
})

test('the step bar splits its columns among the steps, with a gap when there is room', () => {
  const sum = (r: { widths: number[]; gap: number }) => r.widths.reduce((a, b) => a + b, 0) + r.gap * (r.widths.length - 1)
  expect(segmentWidths(5, 30), 'five even segments, four gaps').toEqual({ widths: [6, 5, 5, 5, 5], gap: 1 })
  expect(sum(segmentWidths(5, 30)), 'fills the bar exactly').toBe(30)
  expect(segmentWidths(12, 20).gap, 'no room for gaps').toBe(0)
  expect(segmentWidths(0, 20).widths).toEqual([])
})

test('a meter\'s cells: green before the middle, orange past it, red near the end', () => {
  expect(Array.from({ length: 10 }, (_, i) => cellZone(i, 10))).toEqual(['low', 'low', 'low', 'low', 'low', 'mid', 'mid', 'mid', 'high', 'high'])
})

test('the clean log: what Claude said, each run of calls as one line of counts, a subagent\'s calls left to its card', () => {
  const ev = (kind: string, text: string, who?: string) => ({ at: 1, kind, text, ...(who ? { who } : {}) }) as never
  const log = cleanLog([
    ev('read', 'a.ts'), ev('run', 'npm test'), ev('connector', 'GitLab: get job 1'), ev('run', 'ls'), ev('connector', 'GitLab: get job 2'),
    ev('read', 'd.ts', 'Explore'), ev('error', 'Bash x', 'Explore'),
    ev('say', 'The job is stuck, so I cancel it.'),
    ev('notice', 'Background command "Wait" completed (exit code 0)'),
    ev('edit', 'a.ts'), ev('step', 'Ship it'), ev('error', 'Bash npm test'),
  ])
  expect(log.map(l => `${l.kind}|${l.text}`)).toEqual([
    'tools|Read 1 file · ran 2 commands · called GitLab 2 times',
    'say|The job is stuck, so I cancel it.',
    'notice|Background command "Wait" completed (exit code 0)',
    'tools|Edited 1 file',
    'step|Step done: Ship it',
    'error|Failed: Bash npm test',
  ])
  expect(plainWords('## Done\n\nThe **docker deploy** of `RC2` is up.\n```sh\nls\n```')).toBe('Done The docker deploy of RC2 is up.')
  expect(noticeOf('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "Wait" completed (exit code 0)</summary>\n</task-notification>')).toBe('Background command "Wait" completed (exit code 0)')
  expect(noticeOf('fix the parser')).toBeNull()
  const skipped = '<task-notification>\nwhatishappening: its session.append hook was skipped.\n</task-notification>'
  expect(logEventOf('user', skipped), "the engine's own notice is no background report").toBeNull()
  expect(logEventOf('user', 'fix  the\nscreen'), 'a prompt typed while Claude answers').toEqual({ kind: 'prompt', text: 'fix the screen' })
  expect(logEventOf('user', '<system-reminder>x'), 'a reminder').toBeNull()
  expect(logEventOf('assistant', ''), 'a reply with calls only').toBeNull()
  expect(storyOf('Bash', { command: 'npm test' }, { isError: true, result: '' }), 'a failed call').toEqual({ kind: 'error', text: 'Bash npm test' })
  expect(storyOf('Edit', { file_path: '/x/a.ts' }, { deny: 'no' }), 'a blocked call').toEqual({ kind: 'deny', text: 'Edit a.ts' })
  expect(storyOf('TodoWrite', {}, { result: '' }), 'told as steps instead').toBeNull()
})

test('a background command: its id from the result, its end from the report', () => {
  expect(startedTaskId('Command running in background with ID: bw783gssg. Output is being written to: /tmp/x')).toBe('bw783gssg')
  expect(startedTaskId({ stdout: 'ok' }), 'a call that ran in the foreground').toBeNull()
  expect(endedTaskId('<task-notification>\n<task-id>bw783gssg</task-id>\n<status>completed</status>')).toBe('bw783gssg')
  expect(endedTaskId('<task-id>x</task-id>'), 'only a report').toBeNull()
})

test('a prompt an agent or the engine sent reads as words', () => {
  const agents = [{ id: 'a18e', type: 'claude-code-guide', description: 'Verify plugin update docs' }] as never
  expect(promptLabel('<agent-message from="a18e"> [Subagent hand-back] The text', agents)).toBe('Report from claude-code-guide: Verify plugin update docs')
  expect(promptLabel('<agent-message from="zzz"> report', agents), 'an agent no longer listed').toBe('Report from an agent')
  expect(promptLabel('<task-notification><task-id>x', agents)).toBe('A background task finished')
  expect(promptLabel('<task-notification><summary>Background command "Build" failed</summary>', agents), 'its summary when it has one').toBe('Background command "Build" failed')
  expect(promptLabel('fix the parser', agents), 'a typed prompt stays as it is').toBe('fix the parser')
})

test('two files of one name show as many folders as tell them apart', () => {
  const all = ['/home/dev/work/app/hooks/register.tsx', '/home/dev/work/lib/hooks/register.tsx', '/home/dev/project/src/app.ts']
  expect(folderLabel(all[0]!, all)).toBe('…/app/hooks')
  expect(folderLabel(all[1]!, all)).toBe('…/lib/hooks')
  expect(folderLabel(all[2]!, all), 'a name of its own keeps the short folder').toBe('/home/dev/project/src')
})

test('server names read as words, a random id as a short tag', () => {
  expect(serverLabel('plugin_engineering_slack'), 'plugin prefix dropped').toBe('Slack')
  expect(serverLabel('claude_ai_Claude_Docs'), 'claude.ai prefix dropped').toBe('Claude Docs')
  expect(serverLabel('chrome-devtools'), 'dashes become spaces').toBe('Chrome Devtools')
  expect(serverLabel('3f2a9c1d-0000-4000-8000-000000000000'), 'never the raw id').toBe('Connector 3f2a')
})

for (const surface of SURFACES) {
  test(`the pane lists connectors, files and skills (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const opened: string[] = []
    const clock = world(on, { opened })
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    await call({ tool: ISSUES, tool_use_id: 't1', query: 'login bug' })
    await call({ tool: ISSUES, tool_use_id: 't2', query: 'crash' })
    await call({ tool: 'mcp__plugin_engineering_slack__send_message', tool_use_id: 't3', channel: 'dev' })
    await call({ tool: 'Read', tool_use_id: 't4', file_path: '/home/dev/project/src/app.ts' })
    await call({ tool: 'Read', tool_use_id: 't5', file_path: '/tmp/scratch.txt' })
    await call({ tool: 'Skill', tool_use_id: 't6', skill: 'release-notes' })
    await clock.settle()
    expect(opened, 'the pane opened by itself').toContain('whatishappening')

    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    for (const t of [/GitLab/, /Slack/, /^2 calls · \d\d:\d\d$/, /^1 call( · \d\d:\d\d)?$/, /app\.ts/, /CLAUDE\.md/, /release-notes/, /house-style/, /^at start$/]) {
      expect(await ui.find({ text: t }), `${t} shows`).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^scratch\.txt$/ }), 'temp files are not context (the timeline still tells the read)').toBeUndefined()
    expect(await ui.find({ text: /SKILL\.md/ }), 'a SKILL.md is a skill, not a file').toBeUndefined()
  })

  if (surface === 'desktop')
    test('desktop: no native buttons, the latest call under each connector, the new order', { timeoutMs: 30000 }, async ($, on) => {
      const clock = world(on)
      await $.session.start({ ...START, surface } as never)
      await clock.settle()
      await ($.tool.call as unknown as Call)({ tool: ISSUES, tool_use_id: 't1', query: 'login bug' })
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
      expect((await ui.findAll({ type: 'Button' })).length, 'a desktop Button is a green native button').toBe(0)
      const fixed = (await ui.findAll({ type: 'Box' })).filter(b => b.props.height === 1)
      expect(fixed.length, 'no one-row heights off the terminal: text taller than a row spilled over the next card').toBe(0)
      expect(await ui.find({ text: /↳ search issues · login bug/ }), 'the latest call shows without a press').toBeDefined()
      expect((await ui.findAll({ type: 'Svg' })).length, 'the 5h, 7d and context bars are pictures').toBe(3)
      const titles = (await ui.findAll({ type: 'Text', text: /^(Usage|To-do|Context files|Connectors|Agents|Skills)$/ })).map(t => String(t.text))
      expect(titles, 'the sections in order, the empty ones (To-do, Agents) left out').toEqual(['Usage', 'Context files', 'Connectors', 'Skills'])
      expect(await ui.find({ text: /^▶ NOW$|^■ IDLE$/ }), 'the line on top').toBeDefined()
    })

  if (surface === 'terminal')
  test(`pressing a connector lists its calls; pressing again hides them (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    await call({ tool: ISSUES, tool_use_id: 't1', query: 'login bug' })
    await call({ tool: 'mcp__plugin_engineering_slack__send_message', tool_use_id: 't2', channel: 'dev' })
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ text: /^\s+search issues/ }), 'closed at first').toBeUndefined()
    await ui.press({ key: 'c:GitLab' })
    expect(await ui.find({ text: /^\s+search issues/ }), 'the call shows').toBeDefined()
    expect(await ui.find({ text: /login bug/ }), 'with its query').toBeDefined()
    await ui.press({ key: 'c:Slack' })
    expect(await ui.find({ text: /^\s+search issues/ }), 'one list open at a time').toBeUndefined()
    expect(await ui.find({ text: /^\s+send message/ }), 'Slack open').toBeDefined()
    await ui.press({ key: 'c:Slack' })
    expect(await ui.find({ text: /^\s+send message/ }), 'second press closes it').toBeUndefined()
  })

  if (surface === 'terminal')
  test(`a section header folds and unfolds it (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    await ($.tool.call as unknown as Call)({ tool: 'Read', tool_use_id: 'r1', file_path: '/home/dev/project/src/app.ts' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    await ui.press({ key: 'sec-files' })
    expect(await ui.find({ type: 'Text', text: /^app\.ts$/ }), 'folded').toBeUndefined()
    expect(await ui.find({ text: /release-notes|house-style/ }), 'other sections stay open').toBeDefined()
    await ui.press({ key: 'sec-files' })
    expect(await ui.find({ type: 'Text', text: /^app\.ts$/ }), 'open again').toBeDefined()
  })

  test(`a TodoWrite list draws its marks, and no plan shows one dim line (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    let ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ type: 'Text', text: /^To-do$/ }), 'no list, no section').toBeUndefined()
    expect(await ui.find({ text: /^■ IDLE$/ }), 'idle on top').toBeDefined()
    await ui.unmount()

    await ($.tool.call as unknown as Call)({
      tool: 'TodoWrite',
      tool_use_id: 'w1',
      todos: [
        { content: 'Sketch the schema', status: 'completed', activeForm: 'Sketching the schema' },
        { content: 'Build the parser', status: 'in_progress', activeForm: 'Building the parser' },
        { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' },
      ],
    })
    await clock.settle()
    ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ type: 'Text', text: /^1\/3 · 33%$/ }), 'count').toBeDefined()
    expect(await ui.find({ text: /^Building the parser$/ }), 'the step in progress is the headline').toBeDefined()
    for (const m of [/^●$/, /^○$/]) expect((await ui.findAll({ type: 'Text', text: m })).length, `${m} once`).toBe(1)
    expect((await ui.findAll({ type: 'Text', text: /^✓$/ })).length, 'the done step, in the To-do and as a timeline event').toBe(2)
    expect((await ui.find({ type: 'Text', text: /^Sketch the schema$/ }))?.props.strikethrough, 'done is struck through').toBe(true)
    expect((await ui.findAll({ type: 'Text', text: /^Building the parser$/ })).some(t => t.props.bold), 'the running step, in its -ing form').toBe(true)
  })

  test(`TaskCreate adds steps and TaskUpdate moves them (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    await call({ tool: 'TaskCreate', tool_use_id: 'c1', subject: 'First' })
    await call({ tool: 'TaskCreate', tool_use_id: 'c2', subject: 'Second' })
    await call({ tool: 'TaskUpdate', tool_use_id: 'u1', taskId: '1', status: 'completed' })
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /^Tasks 1\/2 50%$/ }), 'one of two done').toBeDefined()
  })

  test(`a subagent shows its task and what it is doing, then done (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    await $.agent.spawn({ prompt: 'look', description: 'Find the auth code', subagentType: 'Explore' } as never)
    const call = $.tool.call as unknown as Call
    await call({ tool: 'Grep', tool_use_id: 'g1', agentId: 'ag1', pattern: 'login' })
    await call({ tool: 'Read', tool_use_id: 'g2', agentId: 'ag1', file_path: '/home/dev/project/auth.ts' })
    await clock.advance(65_000)
    let ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    for (const t of [/Explore/, /Find the auth code/, /Read auth\.ts/, /Opus · 2 tools$/, /^1 running · 0 done$/]) expect(await ui.find({ text: t }), `${t}`).toBeDefined()
    if (surface === 'terminal') {
      const live = (await ui.find({ type: 'Client' }))?.props as { module: string; props: { since: number; now: number; endAt: number | null } } | undefined
      expect(live?.module, 'a live clock').toMatch(/clock\.tsx$/)
      expect(live?.props.now - (live?.props.since ?? 0), 'it reads 65 s, then ticks by itself').toBe(65_000)
      expect(live?.props.endAt, 'still running').toBeNull()
    } else {
      expect(await ui.find({ type: 'Client' }), 'no Client off the terminal: VS Code draws none').toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^1m 05s$/ }), 'the time as text').toBeDefined()
    }
    await ui.unmount()

    const usage = { model: 'claude-opus-5-5', input_tokens: 200, output_tokens: 800, cache_read_input_tokens: 150, cache_creation_input_tokens: 50 }
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'ag1', reason: 'answer', usage } as never)
    await clock.advance(30_000)
    ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ text: /^0 running · 1 done · 1\.2k tokens$/ }), 'none running, with the agents\' tokens').toBeDefined()
    expect(await ui.find({ text: /^Finished · 1/ }), 'in the Finished group').toBeDefined()
    expect(await ui.find({ text: /^1m 05s · 1\.2k · \d\d:\d\d$/ }), 'one line: how long, its tokens, when it finished').toBeDefined()
    expect(await ui.find({ text: /^Grep login$/ }), 'a finished agent is folded').toBeUndefined()
    if (surface === 'terminal') {
      await ui.press({ key: 'ag:ag1' })
      expect(await ui.find({ text: /^Opus 5\.5 · 2 tools · 1\.2k tokens$/ }), 'a press opens its card: the exact model and its tokens').toBeDefined()
      expect(await ui.find({ text: /^Finished \d\d:\d\d$/ }), 'when it finished').toBeDefined()
      expect(await ui.find({ text: /^Grep login$/ }), 'and its steps').toBeDefined()
      const ended = (await ui.find({ type: 'Client' }))?.props as { props: { since: number; endAt: number | null } } | undefined
      expect((ended?.props.endAt ?? 0) - (ended?.props.since ?? 0), 'the run time stops at the end').toBe(65_000)
    }
  })

  test(`each agent is a card: its steps as a trail, or its own to-do list with a count (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    await $.agent.spawn({ prompt: 'look', description: 'Find the auth code', subagentType: 'Explore' } as never)
    const call = $.tool.call as unknown as Call
    await call({ tool: 'Grep', tool_use_id: 'g1', agentId: 'ag1', pattern: 'login' })
    await call({ tool: 'Read', tool_use_id: 'g2', agentId: 'ag1', file_path: '/home/dev/project/auth.ts' })
    await clock.settle()
    let ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    const row = async (re: RegExp) => (await ui.findAll({ type: 'Text', text: re })).map(t => String(t.text))
    expect(await row(/^Grep login$/), 'the earlier step').toHaveLength(1)
    expect(await row(/^Read auth\.ts$/), 'the step it is on, on the card; the timeline leaves it there').toHaveLength(1)
    expect((await ui.findAll({ type: 'Text', text: /^●$/ })).length, 'one live mark for the type, one for the step').toBe(2)
    await ui.unmount()

    await call({ tool: 'TodoWrite', tool_use_id: 'g3', agentId: 'ag1', todos: [
      { content: 'Find the login code', status: 'completed', activeForm: 'Finding it' },
      { content: 'Check the token expiry', status: 'in_progress', activeForm: 'Checking the token expiry' },
    ] })
    await clock.settle()
    ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ type: 'Text', text: /^1\/2$/ }), 'its own count').toBeDefined()
    expect(await ui.find({ text: /Checking the token expiry/ }), 'its step in progress').toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^To-do$/ }), "the main chat's list is untouched").toBeUndefined()
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(v => String(v.props.alt) === '1 of 2 steps done'), 'its bar').toBe(true)
  })

  test(`two agents sit side by side; more than three become activity lanes (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    const spawn = (id: string) => $.agent.spawn({ prompt: 'p', description: `job ${id}`, subagentType: 'Explore', id } as never)
    for (const id of ['w1', 'w2']) await spawn(id)
    await call({ tool: 'Grep', tool_use_id: 'x1', agentId: 'w1', pattern: 'a' })
    await call({ tool: 'Grep', tool_use_id: 'x2', agentId: 'w2', pattern: 'b' })
    await clock.settle()
    const wide = { ...(PANE as object), bodyColumns: 64 } as never
    let ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: wide })
    expect(await ui.find({ key: 'run-cards' }), 'two cards in one row').toBeDefined()
    expect(await ui.find({ key: 'lane:w1' }), 'no lanes yet').toBeUndefined()
    await ui.unmount()

    for (const id of ['w3', 'w4', 'w5']) {
      await clock.advance(5000)
      await spawn(id)
      await call({ tool: 'Read', tool_use_id: `r-${id}`, agentId: id, file_path: `/home/dev/project/${id}.ts` })
    }
    await call({ tool: 'Grep', tool_use_id: 'x3', agentId: 'w5', pattern: 'c' })
    await clock.settle()
    ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: wide })
    for (const id of ['w1', 'w2', 'w3', 'w4', 'w5']) expect(await ui.find({ key: `lane:${id}` }), `a lane for ${id}`).toBeDefined()
    expect(await ui.find({ key: 'cards' }), 'no cards row').toBeUndefined()
    expect(await ui.find({ text: /^Busy over the last 15s/ }), 'what the lanes measure').toBeDefined()
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).filter(v => /tool call/.test(String(v.props.alt))).length, 'one picture per lane').toBe(5)
    else expect(await ui.find({ text: /^█$/ }), 'the busiest moment is a full bar').toBeDefined()
  })

  test(`a workflow agent, never in the agent list, stays running; an engine fork is no agent (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    // A workflow script's agent() goes through agent.spawn, with no type.
    await $.agent.spawn({ prompt: 'p', description: 'wf step', id: 'wf1' } as never)
    await ($.tool.call as unknown as Call)({ tool: 'Grep', tool_use_id: 'w1', agentId: 'wf1', pattern: 'todo' })
    // An engine fork (compaction, memory) carries an agent id too, but no spawn ever named it.
    await ($.tool.call as unknown as Call)({ tool: 'Bash', tool_use_id: 'f1', agentId: 'fork1', command: 'true' })
    await ($.tool.call as unknown as Call)({ tool: 'Read', tool_use_id: 'f2', agentId: 'fork1', file_path: '/home/dev/project/secret-notes.md' })
    await clock.advance(7000)
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ text: /^1 running · 0 done$/ }), 'still running after two list checks, and the fork is no agent').toBeDefined()
    expect(await ui.find({ text: /secret-notes/ }), 'nor are its reads context files').toBeUndefined()
    expect(await ui.find({ text: /Ran true/ }), 'nor its commands in the timeline').toBeUndefined()
  })

  test(`after a reload a new agent sorts above older ones (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    stored(on, 'agents', [{ id: 'old', type: 'Plan', description: 'older job', status: 'completed', doing: '', tools: 3, startedAt: 0, seq: 500, listed: true }])
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    await $.agent.spawn({ prompt: 'p', description: 'newer job', subagentType: 'Explore' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'ag1' } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    const texts = (await ui.findAll({ type: 'Text', text: /older job|newer job/ })).map(t => String(t.text))
    expect(texts.findIndex(t => t.includes('newer')), 'the new agent first').toBeLessThan(texts.findIndex(t => t.includes('older')))
  })

  test(`Usage shows the limits with their reset, the context and the tokens; the band shows the plan (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const msg = (id: string, i: number, o: number) =>
      JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: i, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: o } } })
    const files = { '~/.claude/projects/-home-dev-project/sid.jsonl': [msg('msg_a', 2, 50), msg('msg_a', 2, 50), msg('msg_b', 3, 20)].join('\n') }
    const clock = world(on, { files })
    await $.session.start({ ...START, surface } as never)
    await ($.tool.call as unknown as Call)({
      tool: 'mcp__whatishappening__plan',
      tool_use_id: 'p1',
      steps: [
        { text: 'one', status: 'completed' },
        { text: 'two', status: 'in_progress' },
        { text: 'three', status: 'pending' },
        { text: 'four', status: 'pending' },
      ],
    })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    for (const [t, why] of [
      [/^11%$/, '5h used'], [/in 2h15 · /, '5h countdown and reset'], [/^6%$/, '7d used'], [/in 3d23h/, '7d countdown'],
      [/53\.3k of 1\.0M/, 'context'],
    ] as const) expect(await ui.find({ text: t }), why).toBeDefined()
    // The terminal leaves the session tokens out, to keep Usage short.
    expect(await ui.find({ text: /^2\.3k$/ }), 'session total, each message once').toEqual(surface === 'terminal' ? undefined : expect.anything())
    expect(await ui.find({ text: /out 70/ }), 'output tokens').toEqual(surface === 'terminal' ? undefined : expect.anything())

    const band = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /^Tasks 1\/4 25%$/ }), 'band count').toBeDefined()
    expect(await band.find({ text: /^whatishappening$/ }), 'band label').toBeDefined()
    expect(await band.find({ text: /^two$/ }), 'the step Claude is on').toBeDefined()
    expect(await band.find({ text: /engine band/ }), 'other bands stay below').toBeDefined()
    if (surface === 'desktop') {
      expect((await band.findAll({ type: 'Svg' })).length, 'desktop draws the bar as a picture').toBe(1)
      expect(await band.find({ text: /█/ }), 'no text bar to wrap').toBeUndefined()
    } else expect(await band.find({ text: /█/ }), 'the terminal keeps the text bar').toBeDefined()
  })

  test(`the plan tool saves the list and answers the model; a subagent's list goes on its card (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    const steps = [
      { text: 'Read the code', status: 'completed' },
      { text: 'Write the fix', status: 'in_progress' },
      { text: 'Run tests', status: 'pending' },
    ]
    expect(String((await call({ tool: 'mcp__whatishappening__plan', tool_use_id: 'p1', title: 'Fix it', steps })).result)).toBe('To-do list updated: 1/3 completed.')
    const fromAgent = await call({ tool: 'mcp__whatishappening__plan', tool_use_id: 'p2', agentId: 'ag9', steps: [{ text: 'x', status: 'pending' }] })
    expect(String(fromAgent.result), 'saved on its card').toContain('on your card: 0/1')
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ text: /Fix it/ }), 'the title').toBeDefined()
    expect(await ui.find({ text: /^1\/3 · 33%$/ }), 'the subagent changed nothing').toBeDefined()
    expect(await ui.find({ text: /Whatishappening/ }), 'the plan tool is not a connector').toBeUndefined()
  })

  test(`the reminders: no plan yet, stale after 8 calls, reset by a new prompt (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    const submit = $.prompt.submit as unknown as (input: Record<string, unknown>) => Promise<unknown>
    const notes = (r: { context?: string[] }) => (r.context ?? []).join(' ')

    await submit({ text: 'do the job' })
    expect(notes(await call({ tool: 'Read', tool_use_id: 'n1', file_path: '/x/a.ts' })), 'first call').toContain('has no to-do list')
    expect(notes(await call({ tool: 'Read', tool_use_id: 'n2', file_path: '/x/b.ts' })), 'once per turn').toBe('')
    await call({ tool: 'mcp__whatishappening__plan', tool_use_id: 'n3', steps: [{ text: 'a', status: 'in_progress' }, { text: 'b', status: 'pending' }] })
    for (let i = 0; i < 7; i++) expect(notes(await call({ tool: 'Grep', tool_use_id: `g${i}`, pattern: 'x' })), `call ${i + 1}`).toBe('')
    expect(notes(await call({ tool: 'Grep', tool_use_id: 'g8', pattern: 'x' })), 'eighth call').toContain('has not moved for a while')

    await submit({ text: 'next job' })
    expect(notes(await call({ tool: 'Read', tool_use_id: 'n4', file_path: '/x/c.ts' })), 'a live plan').toContain('is from an earlier prompt')
    expect(notes(await call({ tool: 'Grep', tool_use_id: 's1', agentId: 'ag1', pattern: 'x' })), 'none for a subagent').toBe('')
  })

  test(`a new session shows the limits an earlier one saw, marked with their time, until its own reading (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const kept = {
      fiveHour: { percent: 7, resetsAt: 1_000_000 + 90 * 60000 },
      sevenDay: { percent: 8, resetsAt: 1_000_000 - 60000 },
      at: 1_000_000 - 30 * 60000,
    }
    on('store.get', async ($, e) => ({ value: (e as { key: string }).key === 'limits' ? kept : undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    // This session has no reading of its own yet.
    const clock = world(on, { noLimits: true })
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ text: /^7%$/ }), 'the kept 5h reading').toBeDefined()
    expect(await ui.find({ text: /as of \d\d:\d\d/ }), 'marked with when it was taken').toBeDefined()
    expect(await ui.find({ text: /^8%$/ }), 'a 7d reading whose window reset since is not shown').toBeUndefined()
    expect(await ui.find({ text: /reset at/ }), 'it says the window reset').toBeDefined()
  })

  test(`/sessions lists sessions by folder; a press puts /resume in the prompt or shows the command for another folder (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const opened: string[] = []
    const filled: string[] = []
    const clock = world(on, { opened, filled, run: argv => (argv[0] === 'sh' && argv[2]?.includes('aiTitle') ? SESSIONS_OUT : '') })
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const ran = (await $.command.run({ command: 'sessions', args: '' } as never)) as { text?: string }
    expect(ran.text, 'the command answers').toContain('Sessions pane')
    expect(opened, 'the pane opens').toContain('whatishappening-sessions')
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening-sessions', props: PANE })
    const heads = (await ui.findAll({ type: 'Text', text: /^~?\/home\/dev\/(project|other)$|^\/home\/dev\/(project|other)$/ })).map(t => String(t.text))
    expect(heads, 'this folder first').toEqual(['/home/dev/project', '/home/dev/other'])
    expect(await ui.find({ text: /^this folder$/ }), 'marked').toBeDefined()
    await ui.press({ key: `sess:${SID(1)}` })
    expect(filled, 'a session of this folder: /resume in the prompt box').toEqual([`/resume ${SID(1)}`])
    await ui.press({ key: `sess:${SID(2)}` })
    expect(await ui.find({ text: new RegExp(`cd /home/dev/other && claude --resume ${SID(2)}`) }), "another folder's: the command to run").toBeDefined()
    expect(filled, 'nothing typed for it').toHaveLength(1)
  })

  test(`the timeline tells the latest prompt as a clean log and earlier ones in one line (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const msgs: { role: string; text: string; toolUses: unknown[] }[] = []
    const clock = world(on, { history: () => msgs })
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    const start = $.turn.start as unknown as (input: Record<string, unknown>) => Promise<unknown>
    const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
    await start({ text: 'look at the parser', turnId: 't1' })
    await call({ tool: 'Read', tool_use_id: 'a1', file_path: '/home/dev/project/a.ts' })
    await call({ tool: 'Read', tool_use_id: 'a2', file_path: '/home/dev/project/b.ts' })
    await clock.advance(90_000)
    await end()
    await start({ text: 'now fix it', turnId: 't2' })
    await call({ tool: 'Read', tool_use_id: 'b1', file_path: '/home/dev/project/a.ts' })
    await call({ tool: 'Read', tool_use_id: 'b2', file_path: '/home/dev/project/c.ts' })
    await call({ tool: 'Read', tool_use_id: 'b3', file_path: '/home/dev/project/d.ts' })
    await call({ tool: 'Edit', tool_use_id: 'b4', file_path: '/home/dev/project/a.ts' })
    msgs.push(
      { role: 'user', text: 'now fix it', toolUses: [] },
      { role: 'assistant', text: 'The **parser** is fixed.', toolUses: [] },
      { role: 'user', text: '<task-notification><summary>Background command "Wait" completed (exit code 0)</summary></task-notification>', toolUses: [] },
      { role: 'user', text: '<task-notification>\nwhatishappening: its session.append hook was skipped.\n</task-notification>', toolUses: [] },
      { role: 'user', text: 'also check the screen', toolUses: [] },
    )
    await call({ tool: 'Read', tool_use_id: 'b5', file_path: '/home/dev/project/e.ts' })
    // One reply that gains a call after it was seen, then a second reply: both are told.
    msgs.push({ role: 'assistant', text: 'Checking the branch first.', toolUses: [{ tool: 'Bash', tool_use_id: 'c1', input: {} }] })
    await call({ tool: 'Bash', tool_use_id: 'c1', command: 'git log' })
    msgs[msgs.length - 1]!.toolUses.push({ tool: 'Bash', tool_use_id: 'c2', input: {} })
    msgs.push({ role: 'assistant', text: 'It is not there yet, so I open the MR.', toolUses: [{ tool: 'Bash', tool_use_id: 'c3', input: {} }] })
    await call({ tool: 'Bash', tool_use_id: 'c3', command: 'glab mr create' })
    await $.agent.spawn({ prompt: 'p', description: 'Check the tests', subagentType: 'Explore' } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ type: 'Text', text: /^Timeline$/ }), 'the section').toBeDefined()
    expect(await ui.find({ text: /^The parser is fixed\.$/ }), "Claude's words, without the markdown").toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^Background command "Wait" completed \(exit code 0\)$/ }), 'the background report, once').toHaveLength(1)
    expect(await ui.find({ text: /^also check the screen$/ }), 'a prompt typed while Claude answered').toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^Checking the branch first\.$/ }), 'the first reply, once').toHaveLength(1)
    expect(await ui.find({ text: /^It is not there yet, so I open the MR\.$/ }), 'the second reply too').toBeDefined()
    expect(await ui.find({ text: /\d\d:\d\d  look at the parser$/ }), 'the earlier prompt, with its time').toBeDefined()
    expect(await ui.find({ text: /^\s+1m 30s · 2 calls$/ }), 'under it: how long, how many calls').toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^now fix it$/ }), 'the latest prompt, as its header only').toHaveLength(1)
    expect(await ui.find({ text: /hook was skipped|A background task finished/ }), "Claude Code's own notice is left out").toBeUndefined()
    expect((await ui.findAll({ text: /^live$/ })).length, "still running, said once, in the section's header").toBe(1)
    expect(await ui.find({ text: /^Read 3 files · edited 1 file$/ }), 'the calls, one line of counts').toBeDefined()
    expect(await ui.find({ text: /^Check the tests$/ }), 'the agent it started').toBeDefined()
  })

  test(`a background command shows until its report comes or it is stopped (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const msgs: { role: string; text: string; toolUses: unknown[] }[] = []
    const clock = world(on, { history: async () => msgs, results: { Bash: 'Command running in background with ID: bw1. Output is being written to: /tmp/bw1.output' } })
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const call = $.tool.call as unknown as Call
    await ($.turn.start as unknown as (i: Record<string, unknown>) => Promise<unknown>)({ text: 'ship it', turnId: 't1' })
    await call({ tool: 'Bash', tool_use_id: 'w1', command: 'sleep 300', description: 'Wait for the pipeline', run_in_background: true })
    await clock.settle()
    let ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ type: 'Text', text: /^Background$/ }), 'the section').toBeDefined()
    expect(await ui.find({ text: /^Wait for the pipeline$/ }), 'the command, by its description').toBeDefined()
    expect(await ui.find({ text: /Waiting on 1 background command/ }), 'the NOW line').toBeDefined()
    await ui.unmount()
    msgs.push({ role: 'user', text: '<task-notification><task-id>bw1</task-id><status>completed</status><summary>Background command "Wait for the pipeline" completed (exit code 0)</summary></task-notification>', toolUses: [] })
    await call({ tool: 'Read', tool_use_id: 'r1', file_path: '/home/dev/project/a.ts' })
    await clock.settle()
    ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ type: 'Text', text: /^Background$/ }), 'gone once it reported').toBeUndefined()
  })

  test(`the band hides while the pane is in sight (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on, { panes: [{ id: 'whatishappening', isShown: true, isPlaced: true }] })
    await $.session.start({ ...START, surface } as never)
    await ($.tool.call as unknown as Call)({ tool: 'mcp__whatishappening__plan', tool_use_id: 'p1', steps: [{ text: 'one', status: 'in_progress' }] })
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /^Tasks/ }), 'the pane already shows it').toBeUndefined()
    expect(await band.find({ text: /engine band/ }), 'the others stay').toBeDefined()
  })

  test(`a finished plan stays at 100% for 20 s, then leaves the band (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    await ($.tool.call as unknown as Call)({ tool: 'mcp__whatishappening__plan', tool_use_id: 'd1', steps: [{ text: 'a', status: 'completed' }, { text: 'b', status: 'completed' }] })
    await clock.settle()
    let band = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /^Tasks 2\/2 100%$/ }), 'at 100% first').toBeDefined()
    await band.unmount()
    await clock.advance(21_000)
    band = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /Tasks/ }), 'gone after the hold').toBeUndefined()
    expect(await band.find({ text: /engine band/ }), 'the others still draw').toBeDefined()
  })

  test(`a reload recounts the history instead of adding it again (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const history = [
      { role: 'user', text: '/release-notes', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool: ISSUES, tool_use_id: 'h1', input: { query: 'login bug' } }] },
    ]
    const clock = world(on, { history })
    // What the run before the reload stored, from the same history.
    const box = stored(on, 'used', {
      connectors: { GitLab: { count: 1, last: 1, calls: [{ what: 'search issues', arg: 'login bug', at: 0 }] } },
      files: {},
      skills: { 'release-notes': { count: 1, last: 2 } },
    })
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const used = box.value as { connectors: Record<string, { count: number }>; skills: Record<string, { count: number }> }
    expect(used.connectors.GitLab?.count, 'GitLab still one call').toBe(1)
    expect(used.skills['release-notes']?.count, 'the typed skill still one use').toBe(1)
  })

  test(`a cut history keeps the stored counts it can no longer see (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    // 4096 messages, the engine's cap: older ones may be missing. GitLab is in it once; Slack only in what was stored.
    const history = [
      ...Array.from({ length: 4095 }, () => ({ role: 'assistant', text: 'ok', toolUses: [] })),
      { role: 'assistant', text: '', toolUses: [{ tool: ISSUES, tool_use_id: 'c1', input: { query: 'x' } }] },
    ]
    const clock = world(on, { history })
    const box = stored(on, 'used', { connectors: { GitLab: { count: 1, last: 1 }, Slack: { count: 3, last: 2 } }, files: {}, skills: {} })
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    const rows = (box.value as { connectors: Record<string, { count: number }> }).connectors
    expect(rows.Slack?.count, 'Slack, only in the stored counts, stays').toBe(3)
    expect(rows.GitLab?.count, 'GitLab not counted twice').toBe(1)
  })

  test(`a call made while the history is read is not lost by the recount (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const history = [{ role: 'assistant', text: '', toolUses: [{ tool: ISSUES, tool_use_id: 'old1', input: { query: 'a' } }] }]
    let release = () => {}
    const gate = new Promise<void>(r => (release = r))
    const clock = world(on, { history: async () => (await gate, history) })
    const box = stored(on, 'used', { connectors: {}, files: {}, skills: {} })
    await $.session.start({ ...START, surface } as never)
    // The history read still waits when a new call comes in.
    await ($.tool.call as unknown as Call)({ tool: ISSUES, tool_use_id: 'live1', query: 'b' })
    release()
    await clock.settle()
    expect((box.value as { connectors: Record<string, { count: number }> }).connectors.GitLab?.count, 'the old call and the live one').toBe(2)
  })
}

// The lines sed keeps (USAGE_SED) give the same totals as the whole transcript, each message once.
test('sed-cut lines and whole lines sum the same', async () => {
  const usage = (i: number, o: number) => `"usage":{"input_tokens":${i},"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":${o},"output_tokens_details":{"thinking_tokens":1}}`
  const whole = [
    `{"type":"assistant","message":{"model":"m","id":"msg_a","role":"assistant","content":[],${usage(2, 50)}}}`,
    `{"type":"assistant","message":{"model":"m","id":"msg_a","role":"assistant","content":[],${usage(2, 50)}}}`,
    `{"type":"assistant","message":{"model":"m","id":"msg_b","role":"assistant","content":[],${usage(3, 20)}}}`,
  ].join('\n')
  const cut = whole
    .split('\n')
    .map(l => `${/"id":"msg_[^"]*"/.exec(l)![0]} ${/"usage":\{[^{}]*/.exec(l)![0]} "assistant"`)
    .join('\n')
  const want = { input: 5, output: 70, cacheRead: 2000, cacheWrite: 200 }
  expect(tokenTotals(whole), 'whole lines').toEqual(want)
  expect(tokenTotals(cut), 'sed-cut lines').toEqual(want)
  expect(USAGE_SED, 'the sed keeps the id and the usage block').toContain('"usage":{[^{}]*')
})
