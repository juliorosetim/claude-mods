import { expect, mock, test } from 'claude-code/testing'

import { modelName, serverLabel, sessionGroups, tokenTotals, USAGE_SED } from './register'

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
  /** stdout for a process.run, by its argv; '' when it gives none. */
  run?: (argv: string[]) => string
  /** What $.prompt.fill put in the prompt box. */
  filled?: string[]
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
  on('ui.invalidate', async () => ({ value: undefined }) as never)
  on('ui.open', async ($, e) => {
    opened.push((e as { id: string }).id)
    return { value: { id: (e as { id: string }).id } } as never
  })
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('agent.spawn', async () => ({ model: 'opus', agentId: 'ag1' }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
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
    for (const t of [/GitLab/, /Slack/, /^2 calls$/, /^1 call$/, /app\.ts/, /CLAUDE\.md/, /release-notes/, /house-style/, /^at start$/]) {
      expect(await ui.find({ text: t }), `${t} shows`).toBeDefined()
    }
    expect(await ui.find({ text: /scratch\.txt/ }), 'temp files are not context').toBeUndefined()
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
    expect(await ui.find({ text: /search issues/ }), 'closed at first').toBeUndefined()
    await ui.press({ key: 'c:GitLab' })
    expect(await ui.find({ text: /search issues/ }), 'the call shows').toBeDefined()
    expect(await ui.find({ text: /login bug/ }), 'with its query').toBeDefined()
    await ui.press({ key: 'c:Slack' })
    expect(await ui.find({ text: /search issues/ }), 'one list open at a time').toBeUndefined()
    expect(await ui.find({ text: /send message/ }), 'Slack open').toBeDefined()
    await ui.press({ key: 'c:Slack' })
    expect(await ui.find({ text: /send message/ }), 'second press closes it').toBeUndefined()
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
    expect(await ui.find({ text: /app\.ts/ }), 'folded').toBeUndefined()
    expect(await ui.find({ text: /release-notes|house-style/ }), 'other sections stay open').toBeDefined()
    await ui.press({ key: 'sec-files' })
    expect(await ui.find({ text: /app\.ts/ }), 'open again').toBeDefined()
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
    for (const m of [/^✓$/, /^●$/, /^○$/]) expect((await ui.findAll({ type: 'Text', text: m })).length, `${m} once`).toBe(1)
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
    expect(await ui.find({ text: /completed · Opus 5\.5 · 2 tools · 1\.2k tokens/ }), 'done, with the exact model and its tokens').toBeDefined()
    if (surface === 'terminal') {
      const ended = (await ui.find({ type: 'Client' }))?.props as { props: { since: number; endAt: number | null } } | undefined
      expect((ended?.props.endAt ?? 0) - (ended?.props.since ?? 0), 'the run time stops at the end').toBe(65_000)
    } else expect(await ui.find({ type: 'Text', text: /^1m 05s$/ }), 'the run time stops at the end').toBeDefined()
    expect(await ui.find({ text: /^0 running · 1 done$/ }), 'none running').toBeDefined()
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
    expect(await row(/^Read auth\.ts$/), 'the step it is on').toHaveLength(1)
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
    await call({ tool: 'Grep', tool_use_id: 'x1', agentId: 'w1', pattern: 'a' })
    await call({ tool: 'Grep', tool_use_id: 'x2', agentId: 'w2', pattern: 'b' })
    await clock.settle()
    const wide = { ...(PANE as object), bodyColumns: 64 } as never
    let ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: wide })
    expect(await ui.find({ key: 'cards' }), 'two cards in one row').toBeDefined()
    expect(await ui.find({ key: 'lane:w1' }), 'no lanes yet').toBeUndefined()
    await ui.unmount()

    for (const id of ['w3', 'w4', 'w5']) {
      await clock.advance(5000)
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

  test(`a workflow agent, never in the agent list, stays running (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ ...START, surface } as never)
    await clock.settle()
    await ($.tool.call as unknown as Call)({ tool: 'Grep', tool_use_id: 'w1', agentId: 'wf1', pattern: 'todo' })
    await clock.advance(7000)
    const ui = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'Pane', requestId: 'whatishappening', props: PANE })
    expect(await ui.find({ text: /^1 running · 0 done$/ }), 'still running after two list checks').toBeDefined()
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
      [/53\.3k of 1\.0M/, 'context'], [/^2\.3k$/, 'session total, each message once'], [/out 70/, 'output tokens'],
    ] as const) expect(await ui.find({ text: t }), why).toBeDefined()

    const band = await $.ui.mount({ plugin: 'whatishappening', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /^Tasks 1\/4 25%$/ }), 'band count').toBeDefined()
    expect(await band.find({ text: /^whatishappening$/ }), 'band label').toBeDefined()
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
