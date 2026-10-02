// Super Bar: Claude Code's task list as a dotted progress bar above the prompt.
//
// Click the bar, or press 9 at an empty prompt, to open Token Weather under it:
// the context-window forecast from the claude.dev mods tutorial, plan limits,
// the last turn's tokens and what fills the context window. × hides the bar
// until Claude creates the next task; /taskbar brings it back.
//
// Needs the task tools, which Claude Code leaves out on newer models unless you
// start it with CLAUDE_CODE_ENABLE_TODO_TOOLS=1. Without them the bar says so.

import { atom, read, update } from 'claude-code'

// Token Weather, as the tutorial draws it.
const HISTORY = 12
const BARS = '▁▂▃▄▅▆▇█'
const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Clear', color: 'yellow' },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Showers', color: 'blue' },
  { upTo: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Compact soon', color: 'red' },
]

// The bar's palette: violet while tasks run, mint once a batch is done, slate when empty.
const VIOLET = { mark: '#a99cf7', fill: '#9a8af4', pillBg: '#7d6cf0', pillFg: '#ffffff', tick: '#e4dffd' }
const MINT = { mark: '#6fcf97', fill: '#5bbd88', pillBg: '#3f9a68', pillFg: '#ffffff', tick: '#dcf5e7' }
const SLATE = { mark: 'gray', fill: 'gray', pillBg: '#5c5c68', pillFg: '#ffffff', tick: 'gray' }
// Pill text on the light named colours; white on the rest.
const INK = { yellow: 'black', cyan: 'black', green: 'black' }

const TASK_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite']
const STATUSES = ['pending', 'in_progress', 'completed']
const LIMIT_NAMES = { five_hour: '5h limit', seven_day: '7d limit', spend_limit: 'spend' }
const PART_NAMES = {
  Messages: 'messages',
  'System tools': 'tools',
  'MCP tools': 'MCP',
  'Memory files': 'memory',
  'System prompt': 'system',
  'Custom agents': 'agents',
  Skills: 'skills',
  'Slash commands': 'commands',
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CONTROLS = 7 // "9: ▾", "×" and the gaps around them, in cells
const META = 10 // the panel's label column

// Held by the host, so they survive a hot reload of this file.
const board = atom({ plugin: 'super-bar', key: 'board' }, { tasks: [], batch: 1, toolsOn: null })
const view = atom({ plugin: 'super-bar', key: 'view' }, { open: false, hidden: false, doneHidden: 0 })
const weather = atom(
  { plugin: 'super-bar', key: 'weather' },
  { readings: [], lastTurn: null, limits: [], costUsd: null },
)
const detail = atom({ plugin: 'super-bar', key: 'detail' }, null)

export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await checkTools($)
    if ((await read($, board)).tasks.length === 0) await replay($) // claude --resume / --continue
    if ((await read($, weather)).readings.length === 0) await takeReading($, null)
    try {
      await $.command.register({
        name: 'taskbar',
        description: 'Show the Tasks bar again, or toggle its token panel',
        argumentHint: '[tokens|hide]',
        immediate: true,
      })
    } catch {
      // The name is taken: the bar still works, only the command is missing.
    }
    return result
  })

  // /clear, /resume and /branch put $.state back to its defaults.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const result = await next(e)
    await checkTools($)
    if (e.source !== 'clear') await replay($)
    await takeReading($, null)
    return result
  })

  // Watch the task tools: let each call run, then fold its result into the board.
  on('tool.call', { tool: ['TaskCreate', 'TaskUpdate', 'TodoWrite'] }, async ($, e, next) => {
    const r = await next(e)
    try {
      if (r && !r.deny && !r.isError && r.result != null) {
        const { tool, tool_use_id, ...input } = e
        await update($, board, (b) => reduce({ ...b, toolsOn: true }, tool, input, r.result))
        if (tool === 'TaskCreate') await update($, view, (v) => (v.hidden ? { ...v, hidden: false } : v))
      }
    } catch {
      // Never let the bar get in the way of the tool's result.
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await takeReading($, e.usage ?? null) // main-loop turns only, not subagents
      await checkTools($) // /model may have changed which tools exist
      if ((await read($, view)).open) await refreshDetail($)
    }
    return result
  })

  on('command.run', { command: 'taskbar' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'hide') await hide($)
    else if (arg === 'tokens') {
      await update($, view, (v) => ({ ...v, hidden: false }))
      await toggle($)
    } else await update($, view, (v) => ({ ...v, hidden: false }))
    return {}
  })

  // A click on a bar arrives from hooks/bar.mjs as a message.
  on('ui.message', async ($, e, next) => {
    const data = e.data
    if (data && typeof data === 'object' && data.type === 'toggle') {
      await toggle($)
      return {}
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const v = await read($, view)
    if (v.hidden) return next(e)
    const b = await read($, board)
    // Read the panel's values only while it's open, so a closed bar doesn't redraw for them.
    const w = v.open ? await read($, weather) : null
    const d = v.open ? await read($, detail) : null
    const theirs = await next(e) // keep what mods after this one draw in the band
    return band($.ui.resolve(e), e, b, v, w, d, theirs, $)
  })
}

// ── Tasks ───────────────────────────────────────────────────────────────────

// Fold one answered task-tool call into the board. Tasks created after every
// task of the current batch is done start a new batch.
function reduce(b, tool, input, result) {
  const tasks = b.tasks.slice()
  let batch = b.batch
  const current = () => tasks.filter((t) => t.batch === batch)
  const allDone = (list) => list.length > 0 && list.every((t) => t.status === 'completed')

  if (tool === 'TaskCreate') {
    if (allDone(current())) batch += 1
    const id = String(result?.task?.id ?? nextId(tasks))
    const subject = String(input.subject ?? result?.task?.subject ?? 'Task')
    tasks.push({ id, subject, activeForm: text(input.activeForm), status: 'pending', batch })
    return { ...b, tasks, batch }
  }

  if (tool === 'TaskUpdate') {
    if (result?.success === false) return b
    const i = tasks.findIndex((t) => t.id === String(input.taskId ?? result?.taskId ?? ''))
    if (i < 0) return b
    if (input.status === 'deleted') {
      tasks.splice(i, 1)
      return { ...b, tasks }
    }
    const t = { ...tasks[i] }
    if (STATUSES.includes(input.status)) t.status = input.status
    if (typeof input.subject === 'string') t.subject = input.subject
    if (typeof input.activeForm === 'string') t.activeForm = input.activeForm
    tasks[i] = t
    return { ...b, tasks }
  }

  if (tool === 'TodoWrite') {
    const todos = Array.isArray(result?.newTodos) ? result.newTodos : Array.isArray(input.todos) ? input.todos : null
    if (!todos) return b
    const known = new Set(current().map((t) => t.subject))
    if (allDone(current()) && todos.some((t) => !known.has(String(t.content)))) batch += 1
    const list = todos.map((t, k) => ({
      id: `todo-${batch}-${k + 1}`,
      subject: String(t.content ?? ''),
      activeForm: text(t.activeForm),
      status: STATUSES.includes(t.status) ? t.status : 'pending',
      batch,
    }))
    return { ...b, tasks: [...tasks.filter((t) => t.batch !== batch), ...list], batch }
  }

  return b
}

// Rebuild the board from the transcript, after a resume or a fresh load.
async function replay($) {
  let messages
  try {
    messages = await $.session.messages()
  } catch {
    return
  }
  let b = { tasks: [], batch: 1, toolsOn: true }
  let seen = false
  for (const m of messages ?? []) {
    for (const use of m?.toolUses ?? []) {
      if (!TASK_TOOLS.includes(use.tool) || use.isError || use.result == null) continue
      b = reduce(b, use.tool, use.input ?? {}, use.result)
      seen = true
    }
  }
  if (seen) await update($, board, () => b)
}

async function checkTools($) {
  let on
  try {
    const tools = await $.tool.list()
    on = tools.some((t) => t?.name === 'TaskCreate' || t?.name === 'TodoWrite')
  } catch {
    return
  }
  if ((await read($, board)).toolsOn !== on) await update($, board, (b) => ({ ...b, toolsOn: on }))
}

// ── Token Weather ───────────────────────────────────────────────────────────

async function takeReading($, turn) {
  let u
  try {
    u = await $.session.usage()
  } catch {
    return
  }
  const context = u?.context
  await update($, weather, (w) => {
    const next = { ...w }
    if (context?.window) {
      const tokens = context.tokens ?? 0
      const percent = context.percent ?? Math.round((tokens / context.window) * 100)
      next.readings = [...w.readings, { tokens, window: context.window, percent }].slice(-HISTORY)
    }
    next.limits = (u?.rateLimits ?? []).map((l) => ({
      kind: String(l.kind),
      percentUsed: Number(l.percentUsed) || 0,
      resetsAt: l.resetsAt ?? null,
    }))
    next.costUsd = typeof u?.cost?.usd === 'number' ? u.cost.usd : null
    if (turn) {
      next.lastTurn = {
        input: turn.input_tokens ?? 0,
        output: turn.output_tokens ?? 0,
        cacheRead: turn.cache_read_input_tokens ?? 0,
        cacheWrite: turn.cache_creation_input_tokens ?? 0,
        model: turn.model ?? null,
      }
    }
    return next
  })
}

// What fills the context, as /context breaks it down. 'summary' is a local
// estimate: no token-count requests, so it's free to run after every turn.
async function refreshDetail($) {
  let used = []
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    used = (u?.context?.breakdown?.categories ?? [])
      .filter((c) => c.kind === 'used' && c.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
      .map((c) => ({ name: String(c.name), tokens: Math.round(c.tokens) }))
  } catch {
    // Drawn as "not available here".
  }
  await update($, detail, () => ({ used }))
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function toggle($) {
  const v = await update($, view, (x) => ({ ...x, open: !x.open, hidden: false }))
  if (v.open) await refreshDetail($)
}

async function hide($) {
  await update($, view, (x) => ({ ...x, hidden: true, open: false }))
}

async function hideDone($, batch) {
  await update($, view, (x) => ({ ...x, doneHidden: batch }))
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function band({ Box, Text, Button, Client }, e, b, v, w, d, theirs, $) {
  // The band's padding takes a cell on each side, and the first row stays two
  // cells short of the edge, where the terminal draws its close mark.
  const width = Math.max(24, Number(e.props.bodyColumns) || 80) - 4
  const maxRows = Math.max(1, Number(e.props.maxRows) || 12)
  const labelWidth = width >= 70 ? Math.min(32, Math.round(width * 0.3)) : width >= 50 ? 14 : 0

  const bar = (key, row, clickable) =>
    Client({
      key,
      module: './bar.mjs',
      width: width - CONTROLS,
      props: { labelWidth, ...row, rightWidth: 4, cols: width - CONTROLS, clickable },
    })
  const spacer = (n) => Text({ children: [' '.repeat(n)] })

  const rows = []
  rows.push(
    Box({
      flexDirection: 'row',
      width,
      columnGap: 1,
      children: [
        bar('tb-active', progress(b.tasks.filter((t) => t.batch === b.batch), b.toolsOn), true),
        Button({
          key: 'tb-toggle',
          label: v.open ? '▴' : '▾',
          hotkey: '9',
          plain: true,
          dimColor: true,
          onPress: () => toggle($),
        }),
        Button({ key: 'tb-close', label: '×', plain: true, role: 'dismiss', dimColor: true, onPress: () => hide($) }),
      ],
    }),
  )

  // The batch before this one stays as a green row until you dismiss it.
  const prev = b.tasks.filter((t) => t.batch === b.batch - 1)
  if (prev.length > 0 && v.doneHidden !== b.batch - 1 && prev.every((t) => t.status === 'completed')) {
    rows.push(
      Box({
        flexDirection: 'row',
        width,
        columnGap: 1,
        children: [
          bar('tb-done', progress(prev, true), true),
          spacer(4),
          Button({
            key: 'tb-close-done',
            label: '×',
            plain: true,
            dimColor: true,
            onPress: () => hideDone($, b.batch - 1),
          }),
        ],
      }),
    )
  }

  if (v.open && w) {
    const meter = (key, row) =>
      Box({ flexDirection: 'row', width, columnGap: 1, children: [bar(key, row, false), spacer(CONTROLS - 1)] })
    const line = (label, value) =>
      Box({
        flexDirection: 'row',
        paddingLeft: 2,
        children: [
          Text({ dimColor: true, children: [label.padEnd(META + 1)] }),
          Text({ wrap: 'truncate-end', children: [value] }),
        ],
      })
    const now = w.readings[w.readings.length - 1]
    // In priority order: the bottom rows go first when the band is short.
    const panel = []
    if (now) {
      panel.push(forecastLine(Box, Text, w.readings, width))
      panel.push(meter('tb-ctx', contextRow(now)))
    } else {
      panel.push(Text({ dimColor: true, children: ['  Token Weather appears after the first reply.'] }))
    }
    for (const l of w.limits) panel.push(meter(`tb-limit-${l.kind}`, limitRow(l)))
    panel.push(line('last turn', turnText(w)))
    panel.push(line('in context', partsText(d)))
    rows.push(...panel.slice(0, Math.max(1, maxRows - rows.length)))
  }

  return Box({ flexDirection: 'column', paddingX: 1, children: [...rows, theirs] })
}

// One batch of tasks as bar props. The pill names the task you're on and the
// figure is the share done: 2 of 5 done reads "Tasks 3/5" and 40%.
function progress(tasks, toolsOn) {
  const n = tasks.length
  if (n === 0 && toolsOn === false) {
    return {
      mark: '○',
      markColor: SLATE.mark,
      label: 'Tasks off',
      labelDim: true,
      hint: 'set CLAUDE_CODE_ENABLE_TODO_TOOLS=1 and restart Claude Code',
      right: '',
    }
  }
  if (n === 0) {
    return {
      mark: '○',
      markColor: SLATE.mark,
      label: 'No tasks yet',
      labelDim: true,
      fraction: 0,
      ticks: [],
      pill: 'Tasks 0',
      pillShort: '0',
      fill: SLATE.fill,
      pillBg: SLATE.pillBg,
      pillFg: SLATE.pillFg,
      tickColor: SLATE.tick,
      right: '',
    }
  }
  const done = tasks.filter((t) => t.status === 'completed').length
  const ticks = Array.from({ length: n - 1 }, (_, k) => (k + 1) / n)
  if (done === n) {
    return {
      mark: '✓',
      markColor: MINT.mark,
      label: tasks[0].subject,
      fraction: 1,
      ticks,
      pill: `✓ Done ${n}/${n}`,
      pillShort: `✓ ${n}/${n}`,
      fill: MINT.fill,
      pillBg: MINT.pillBg,
      pillFg: MINT.pillFg,
      tickColor: MINT.tick,
      right: '100%',
    }
  }
  const cur =
    tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending') ?? tasks[0]
  const at = Math.min(done + 1, n)
  return {
    mark: '●',
    markColor: VIOLET.mark,
    label: cur.status === 'in_progress' && cur.activeForm ? cur.activeForm : cur.subject,
    fraction: done / n,
    ticks,
    pill: `Tasks ${at}/${n}`,
    pillShort: `${at}/${n}`,
    fill: VIOLET.fill,
    pillBg: VIOLET.pillBg,
    pillFg: VIOLET.pillFg,
    tickColor: VIOLET.tick,
    right: `${Math.round((done / n) * 100)}%`,
  }
}

// The context meter: ticks where the forecast changes, the pill in its colour.
function contextRow(now) {
  const f = forecast(now.percent)
  return {
    mark: ' ',
    label: 'context',
    labelWidth: META,
    labelDim: true,
    fraction: now.percent / 100,
    ticks: [0.25, 0.5, 0.75, 0.9],
    pill: `${f.icon} ${short(now.tokens)}`,
    pillShort: f.icon,
    fill: f.color,
    pillBg: f.color,
    pillFg: INK[f.color] ?? 'white',
    tickColor: 'white',
    right: `${now.percent}%`,
  }
}

function limitRow(l) {
  const pct = Math.max(0, Math.round(l.percentUsed))
  const color = pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'
  const at = resetTime(l)
  return {
    mark: ' ',
    label: LIMIT_NAMES[l.kind] ?? l.kind.replace(/_/g, ' '),
    labelWidth: META,
    labelDim: true,
    fraction: pct / 100,
    ticks: [],
    pill: at ? `resets ${at}` : `${pct}%`,
    pillShort: at ? at.split(' ').pop() : `${pct}%`,
    fill: color,
    pillBg: color,
    pillFg: INK[color] ?? 'white',
    right: `${pct}%`,
  }
}

// Local time: "14:30" for the 5-hour window, "Mon 09:00" for longer ones.
function resetTime(l) {
  if (!l.resetsAt) return ''
  const t = new Date(l.resetsAt)
  if (Number.isNaN(t.getTime())) return ''
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return l.kind === 'five_hour' ? hm : `${DAYS[t.getDay()]} ${hm}`
}

function turnText(w) {
  const cost = typeof w.costUsd === 'number' ? `   ≈ $${w.costUsd.toFixed(2)} this session` : ''
  const t = w.lastTurn
  if (!t) return `no finished turn yet${cost}`
  return `in ${short(t.input)}  out ${short(t.output)}  cache read ${short(t.cacheRead)}  cache write ${short(t.cacheWrite)}${cost}`
}

function partsText(d) {
  if (d === null) return 'measuring…'
  if (d.used.length === 0) return 'not available here'
  return d.used
    .slice(0, 6)
    .map((p) => `${PART_NAMES[p.name] ?? p.name.toLowerCase()} ${short(p.tokens)}`)
    .join('  ')
}

// The tutorial's forecast line, unchanged apart from its indent.
function forecastLine(Box, Text, history, columns) {
  const now = history[history.length - 1]
  const f = forecast(now.percent)
  const parts = [
    Text({ color: f.color, bold: true, children: [`${f.icon}  ${f.word}`] }),
    Text({ children: [`  ${now.percent}% of context`] }),
    Text({ dimColor: true, children: [`  ${short(now.tokens)} / ${short(now.window)}`] }),
  ]
  if (columns >= 60) {
    parts.push(Text({ dimColor: true, children: ['   last turns '] }))
    parts.push(Text({ color: f.color, children: [sparkline(history)] }))
    if (history.length > 1) parts.push(Text({ dimColor: true, children: [trend(history)] }))
  }
  return Box({ flexDirection: 'row', paddingLeft: 2, children: parts })
}

function forecast(percent) {
  return FORECAST.find((b) => percent < b.upTo)
}

function sparkline(history) {
  const top = Math.max(...history.map((r) => r.tokens), 1)
  return history.map((r) => BARS[Math.floor((r.tokens / top) * (BARS.length - 1))]).join('')
}

function trend(history) {
  const delta = history[history.length - 1].tokens - history[history.length - 2].tokens
  if (delta === 0) return '  steady'
  return delta > 0 ? `  ▲ +${short(delta)} last turn` : `  ▼ ${short(-delta)} last turn`
}

function short(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}

function nextId(tasks) {
  return tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value : null
}
