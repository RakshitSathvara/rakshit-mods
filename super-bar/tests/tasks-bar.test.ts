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

type Options = {
  tools?: string[]
  messages?: unknown[]
}

// Answer everything the mod asks Claude Code for. Call before the first $ call.
function stubs(on: any, { tools, messages = [] }: Options = {}) {
  const names = tools ?? ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'Bash', 'Read']
  let id = 0
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: undefined }))
  on('tool.list', () => ({ value: names.map((name) => ({ name, description: '', mcp: false })) }))
  on('session.messages', () => ({ value: messages }))
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
// The desktop's track: an image, read through its markup and alt text.
const track = async (ui: any) =>
  (await ui.find({ type: 'Svg' }))?.props as { source: string; alt: string } | undefined

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

test("terminal: the pill names the task you're on and the figure is the share done", async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks 3\/5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /40%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Running tests/ })).toBeDefined()
  expect(await ui.find({ key: 'tb-close' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('desktop: the track is a picture with the pill, between the task and the share done', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('desktop'))
  const t = await track(ui)
  expect(t?.source).toMatch(/>Tasks<tspan[^>]*>3\/5</)
  expect(t?.source).toContain('#8B7CF6')
  expect(t?.alt).toBe('Running tests: task 3 of 5, 40% done')
  expect(await ui.find({ type: 'Text', text: /Running tests/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /40%/ })).toBeDefined()
  expect(await ui.find({ key: 'tb-close' })).toBeDefined()
  // No Client anywhere: the desktop app doesn't run surface modules today.
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('a finished batch turns green, and the next batch takes its place', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  for (const id of ['3', '4', '5']) await mark($, id, 'completed')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ Done 5\/5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /100%/ })).toBeDefined()

  await create($, 'Open the pull request')
  expect(await ui.find({ type: 'Text', text: /Tasks 1\/1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Done/ })).toBeUndefined()
  await ui.unmount()
})

test('desktop: a finished batch shows a check and Done on a green track', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  for (const id of ['3', '4', '5']) await mark($, id, 'completed')
  const ui = await $.ui.mount(band('desktop'))
  const t = await track(ui)
  expect(t?.source).toMatch(/>Done<tspan[^>]*>5\/5</)
  expect(t?.source).toContain('#30A46C')
  expect(t?.alt).toBe('Read the auth module: all 5 tasks done')
  expect(await ui.find({ type: 'Text', text: /100%/ })).toBeDefined()
  await ui.unmount()
})

test('× hides the bar until Claude creates the next task', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'tb-close' })
  expect(await ui.find({ key: 'tb-active' })).toBeUndefined()

  await create($, 'One more thing')
  expect(await ui.find({ type: 'Text', text: /Tasks 3\/6/ })).toBeDefined()
  await ui.unmount()
})

test('/taskbar brings a dismissed bar back, and /taskbar hide hides it', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('desktop'))
  await ui.press({ key: 'tb-close' })
  expect(await ui.find({ key: 'tb-active' })).toBeUndefined()

  expect(await $.command.run({ command: 'taskbar', args: '' } as any)).toEqual({})
  expect(await ui.find({ key: 'tb-active' })).toBeDefined()

  await $.command.run({ command: 'taskbar', args: 'hide' } as any)
  expect(await ui.find({ key: 'tb-active' })).toBeUndefined()
  await ui.unmount()
})

test('without the task tools the bar says how to turn them on', async ($, on) => {
  stubs(on, { tools: ['Bash', 'Read', 'Edit'] })
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ type: 'Text', text: /Tasks off/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CLAUDE_CODE_ENABLE_TODO_TOOLS=1/ })).toBeDefined()
    await ui.unmount()
  }
})

test('on a narrow band the tools-off hint drops its label and keeps the variable whole', async ($, on) => {
  stubs(on, { tools: ['Bash'] })
  await start($)
  const ui = await $.ui.mount(band('terminal', 60))
  expect(await ui.find({ type: 'Text', text: /Tasks off/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /set CLAUDE_CODE_ENABLE_TODO_TOOLS=1 / })).toBeDefined()
  await ui.unmount()
})

test('before any task the band stays empty', async ($, on) => {
  stubs(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ key: 'tb-active' })).toBeUndefined()
    await ui.unmount()
  }
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
  expect(await ui.find({ type: 'Text', text: /Tasks 2\/3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Building/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /33%/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /Tasks 2\/3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Building/ })).toBeDefined()
  await ui.unmount()
})

test('a deleted task leaves the count', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  await mark($, '5', 'deleted')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks 3\/4/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /50%/ })).toBeDefined()
  await ui.unmount()
})

test('a survey gets the band to itself', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal', 110, { hasSurvey: true }))
  expect(await ui.find({ key: 'tb-active' })).toBeUndefined()
  await ui.unmount()
})

test('a narrow band drops the label and keeps the pill and figure', async ($, on) => {
  stubs(on)
  await start($)
  await fiveTasks($)
  const ui = await $.ui.mount(band('terminal', 40))
  expect(await ui.find({ type: 'Text', text: /3\/5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /40%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Running tests/ })).toBeUndefined()
  await ui.unmount()
})

test('a failed or refused task call leaves the bar as it was', async ($, stub) => {
  const on = stub as any
  let id = 0
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.list', () => ({ value: [{ name: 'TaskCreate', description: '', mcp: false }] }))
  on('session.messages', () => ({ value: [] }))
  on('tool.call', ($: any, e: any) =>
    e.subject === 'boom' ? { deny: 'refused' } : { result: { task: { id: String(++id), subject: e.subject } } },
  )
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  await start($)
  await create($, 'Real task')
  await create($, 'boom')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /Tasks 1\/1/ })).toBeDefined()
  await ui.unmount()
})
