import { expect, test } from 'claude-code/testing'

// What Claude Code passes to the band's ui.render hook, apart from the app.
const band = (surface: 'terminal' | 'desktop', bodyColumns = 110, extra: Record<string, unknown> = {}) =>
  ({
    plugin: 'super-bar',
    surface,
    component: 'AbovePrompt',
    viewport: { columns: bodyColumns, rows: 40, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
      ...extra,
    },
  }) as any

// /context's categories for a 200k window two-thirds full.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 2_900, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 18_100, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 9_400, color: 'suggestion', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 3_100, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 98_200, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 52_000, color: 'promptBorder', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 16_300, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 131_700,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'model',
  percentage: 66,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
}

type Options = {
  tokens?: () => number
  tools?: string[]
  messages?: unknown[]
}

// Answer everything the mod asks Claude Code for. Call before the first $ call.
function stubs(on: any, { tokens = () => 36_100, tools, messages = [] }: Options = {}) {
  const names = tools ?? ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'Bash', 'Read']
  let id = 0
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: undefined }))
  on('tool.list', () => ({ value: names.map((name) => ({ name, description: '', mcp: false })) }))
  on('session.messages', () => ({ value: messages }))
  on('session.usage', ($: any, e: any) => {
    const t = tokens()
    return {
      value: {
        startedAt: 0,
        context: {
          tokens: t,
          window: 200_000,
          percent: Math.round(t / 2_000),
          ...(e?.breakdown ? { breakdown: BREAKDOWN } : {}),
        },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 38, resetsAt: '2026-10-02T09:00:00Z' },
          { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-05T03:30:00Z' },
        ],
        cost: { usd: 1.84 },
      },
    }
  })
  on('tool.call', ($: any, e: any) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++id), subject: e.subject } } }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  // What Claude Code draws in the band itself: nothing.
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
const create = ($: any, subject: string, activeForm?: string) =>
  $.tool.call({ tool: 'TaskCreate', subject, description: subject, ...(activeForm ? { activeForm } : {}) } as any)
const mark = ($: any, taskId: string, status: string) => $.tool.call({ tool: 'TaskUpdate', taskId, status } as any)
const turn = ($: any, usage: unknown) =>
  $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage } as any)
const click = async (ui: any, key: string) => {
  await ui.pointer({ type: 'down', x: 4, y: 0, button: 'left', in: key })
  await ui.pointer({ type: 'up', x: 4, y: 0, button: 'left', in: key })
}

// Five tasks: two done, the third running.
async function fiveTasks($: any) {
  await create($, 'Read the auth module')
  await create($, 'Write the failing test')
  await create($, 'Run the tests', 'Running tests')
  await create($, 'Fix the token refresh')
  await create($, 'Update the changelog')
  await mark($, '1', 'completed')
  await mark($, '2', 'completed')
  await mark($, '3', 'in_progress')
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pill names the task you're on and the figure is the share done`, async ($, on) => {
    stubs(on)
    await start($)
    await fiveTasks($)
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ type: 'Text', text: /Tasks 3\/5/, in: 'tb-active' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /40%/, in: 'tb-active' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Running tests/, in: 'tb-active' })).toBeDefined()
    expect(await ui.find({ key: 'tb-toggle' })).toBeDefined()
    expect(await ui.find({ key: 'tb-close' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a click on the bar opens Token Weather, and another closes it`, async ($, on) => {
    let tokens = 36_100
    stubs(on, { tokens: () => tokens })
    await start($)
    await fiveTasks($)
    tokens = 134_400
    await turn($, {
      input_tokens: 2_100,
      output_tokens: 1_800,
      cache_read_input_tokens: 128_900,
      cache_creation_input_tokens: 1_600,
      model: 'claude-opus-5-5',
    })
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ type: 'Text', text: /Showers/ })).toBeUndefined()

    await click(ui, 'tb-active')
    expect(await ui.find({ type: 'Text', text: /☂ {2}Showers/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /67% of context/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /134\.4k \/ 200k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▲ \+98\.3k last turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /☂ 134\.4k/, in: 'tb-ctx' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /67%/, in: 'tb-ctx' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h limit/, in: 'tb-limit-five_hour' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /38%/, in: 'tb-limit-five_hour' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /12%/, in: 'tb-limit-seven_day' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache read 128\.9k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /≈ \$1\.84 this session/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^messages 98\.2k {2}tools 18\.1k {2}MCP 9\.4k/ })).toBeDefined()
    expect(await ui.find({ key: 'tb-toggle', text: '▴' })).toBeDefined()

    await click(ui, 'tb-active')
    expect(await ui.find({ type: 'Text', text: /Showers/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('a batch turns green when done, then stays as its own row when new tasks start', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  for (const id of ['3', '4', '5']) await mark($, id, 'completed')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ Done 5\/5/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /100%/, in: 'tb-active' })).toBeDefined()

  await create($, 'Open the pull request')
  expect(await ui.find({ type: 'Text', text: /Tasks 1\/1/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0%/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ Done 5\/5/, in: 'tb-done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read the auth module/, in: 'tb-done' })).toBeDefined()

  await ui.press({ key: 'tb-close-done' })
  expect(await ui.find({ key: 'tb-close-done' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Tasks 1\/1/, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})

test('the 9 button toggles the panel, and × hides the bar until the next task', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal'))

  await ui.press({ key: 'tb-toggle' })
  expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeDefined()
  await ui.press({ key: 'tb-toggle' })
  expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeUndefined()

  await ui.press({ key: 'tb-close' })
  expect(await ui.find({ key: 'tb-toggle' })).toBeUndefined()

  await create($, 'One more thing')
  expect(await ui.find({ type: 'Text', text: /Tasks 3\/6/, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})

test('/taskbar brings a dismissed bar back, and /taskbar tokens opens the panel', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'tb-close' })
  expect(await ui.find({ key: 'tb-toggle' })).toBeUndefined()

  expect(await $.command.run({ command: 'taskbar', args: '' } as any)).toEqual({})
  expect(await ui.find({ key: 'tb-toggle' })).toBeDefined()

  await $.command.run({ command: 'taskbar', args: 'tokens' } as any)
  expect(await ui.find({ type: 'Text', text: /of context/ })).toBeDefined()

  await $.command.run({ command: 'taskbar', args: 'hide' } as any)
  expect(await ui.find({ key: 'tb-toggle' })).toBeUndefined()
  await ui.unmount()
})

test('without the task tools the bar says how to turn them on, and still opens the panel', async ($, on) => {
  stubs(on, { tools: ['Bash', 'Read', 'Edit'] })
  await start($)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks off/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CLAUDE_CODE_ENABLE_TODO_TOOLS=1/, in: 'tb-active' })).toBeDefined()
  await click(ui, 'tb-active')
  expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeDefined()
  await ui.unmount()
})

test('on a narrow band the tools-off hint drops its label and keeps the variable whole', async ($, on) => {
  stubs(on, { tools: ['Bash'] })
  await start($)
  const ui = await $.ui.mount(band('terminal', 60))
  expect(await ui.find({ type: 'Text', text: /Tasks off/, in: 'tb-active' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /set CLAUDE_CODE_ENABLE_TODO_TOOLS=1 /, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})

test('before any task it shows an empty bar', async ($, on) => {
  stubs(on)
  await start($)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /No tasks yet/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Tasks 0/, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})

test('after /resume the tasks come back from the transcript', async ($, on) => {
  const use = (tool: string, input: Record<string, unknown>, result: unknown) => ({
    tool_use_id: `tu-${Math.random()}`,
    tool,
    input,
    result,
  })
  stubs(on, {
    messages: [
      {
        role: 'assistant',
        text: '',
        toolUses: [
          use('TaskCreate', { subject: 'Plan', description: '' }, { task: { id: '1', subject: 'Plan' } }),
          use('TaskCreate', { subject: 'Build', description: '' }, { task: { id: '2', subject: 'Build' } }),
          use('TaskCreate', { subject: 'Ship', description: '' }, { task: { id: '3', subject: 'Ship' } }),
        ],
      },
      {
        role: 'assistant',
        text: '',
        toolUses: [
          use('TaskUpdate', { taskId: '1', status: 'completed' }, { success: true, taskId: '1', updatedFields: [] }),
          use('TaskUpdate', { taskId: '2', status: 'in_progress', activeForm: 'Building' }, { success: true, taskId: '2', updatedFields: [] }),
        ],
      },
    ],
  })
  await $.classic.SessionStart({ source: 'resume' } as any)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks 2\/3/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Building/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /33%/, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})

test('TodoWrite, when task tools are set to the older checklist, drives the same bar', async ($, on) => {
  stubs(on, { tools: ['TodoWrite', 'Bash'] })
  await start($)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Plan', status: 'completed', activeForm: 'Planning' },
      { content: 'Build', status: 'in_progress', activeForm: 'Building' },
      { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
    ],
  } as any)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks 2\/3/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Building/, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})

test('a deleted task leaves the count', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  await mark($, '5', 'deleted')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks 3\/4/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /50%/, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})

test('a survey gets the band to itself', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal', 110, { hasSurvey: true }))
  expect(await ui.find({ key: 'tb-toggle' })).toBeUndefined()
  await ui.unmount()
})

test('a narrow band drops the label and keeps the pill and figure', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal', 40))
  expect(await ui.find({ type: 'Text', text: /3\/5/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /40%/, in: 'tb-active' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Running tests/, in: 'tb-active' })).toBeUndefined()
  await ui.unmount()
})

test('a failed or refused task call leaves the bar as it was', async ($, stub) => {
  const on = stub as any
  let id = 0
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.list', () => ({ value: [{ name: 'TaskCreate', description: '', mcp: false }] }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('tool.call', ($: any, e: any) =>
    e.subject === 'boom' ? { deny: 'refused' } : { result: { task: { id: String(++id), subject: e.subject } } },
  )
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  await start($)
  await create($, 'Real task')
  await create($, 'boom')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks 1\/1/, in: 'tb-active' })).toBeDefined()
  await ui.unmount()
})
