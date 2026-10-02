// Super Bar: Claude Code's task list as a progress bar above the prompt.
//
// One bar for the batch of tasks Claude is working through: the task it's on, a
// track that fills as tasks finish with a pill naming the count, and the share
// done. It goes once every task in the batch is done. The desktop draws the
// track as an SVG (track.mjs), the terminal as dotted text (bar.mjs). × hides
// the bar until Claude creates the next task; /taskbar brings it back.
//
// Needs the task tools, which Claude Code leaves out on newer models unless you
// start it with CLAUDE_CODE_ENABLE_TODO_TOOLS=1. Without them the bar says so.

import { atom, read, update } from 'claude-code'
import { textRow } from './bar.mjs'
import { TRACK_H, textWidth, trackSvg } from './track.mjs'

// The desktop track's accent, and the terminal bar's palette in the same violet.
const ACCENT = '#8B7CF6'
const VIOLET = { mark: '#a99cf7', fill: '#9a8af4', pillBg: '#7d6cf0', pillFg: '#ffffff', tick: '#e4dffd' }

const TASK_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite']
const STATUSES = ['pending', 'in_progress', 'completed']
const CLOSE = 2 // "×" and the gap before it, in cells
// A space as wide as a digit, so '  0%' and '100%' take the same room.
const FIGURE_SPACE = String.fromCharCode(0x2007)

// Held by the host, so they survive a hot reload of this file.
const board = atom({ plugin: 'super-bar', key: 'board' }, { tasks: [], batch: 1, toolsOn: null })
const view = atom({ plugin: 'super-bar', key: 'view' }, { hidden: false })

export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await checkTools($)
    if ((await read($, board)).tasks.length === 0) await replay($) // claude --resume / --continue
    try {
      await $.command.register({
        name: 'taskbar',
        description: 'Show the task bar again, or hide it',
        argumentHint: '[hide]',
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

  // /model may have changed which tools exist.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await checkTools($) // main-loop turns only, not subagents
    return result
  })

  on('command.run', { command: 'taskbar' }, async ($, e) => {
    const hidden = String(e.args ?? '').trim().toLowerCase() === 'hide'
    await update($, view, (v) => ({ ...v, hidden }))
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if ((await read($, view)).hidden) return next(e)
    const b = await read($, board)
    const tasks = b.tasks.filter((t) => t.batch === b.batch)
    // Nothing to show before Claude's first task (unless the tools are off), or
    // once every task in the batch is done.
    if (tasks.length === 0 && b.toolsOn !== false) return next(e)
    if (tasks.length > 0 && tasks.every((t) => t.status === 'completed')) return next(e)
    const theirs = await next(e) // keep what mods after this one draw in the band
    return band($.ui.resolve(e), e, tasks, b.batch, theirs, $)
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

async function hide($) {
  await update($, view, (x) => ({ ...x, hidden: true }))
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function band(ui, e, tasks, batch, theirs, $) {
  const { Box, Button } = ui
  // The band's padding takes a cell on each side, and the row stays two cells
  // short of the edge, where the terminal draws its close mark.
  const width = Math.max(24, Number(e.props.bodyColumns) || 80) - 4
  const p = tasks.length > 0 ? progress(tasks) : null
  const close = Button({ key: 'tb-close', label: '×', plain: true, role: 'dismiss', dimColor: true, onPress: () => hide($) })
  // Every surface but the terminal draws Svg, so they get the pixel track and the
  // terminal gets text. Ask the surface: the table holds every constructor.
  const row =
    p && e.surface !== 'terminal'
      ? Box({ key: 'tb-active', flexDirection: 'row', alignItems: 'center', gap: 1, children: [...trackRow(ui, e, p, batch), close] })
      : Box({
          key: 'tb-active',
          flexDirection: 'row',
          width,
          columnGap: 1,
          children: [Box({ width: width - CLOSE, children: [textRow(ui, p ? textProps(p, width) : toolsOff(), width - CLOSE)] }), close],
        })
  return Box({ flexDirection: 'column', paddingX: 1, children: [row, theirs] })
}

// One batch as the bar shows it. The pill names the task you're on and the
// figure is the share done: 2 of 5 done reads "Tasks 3/5" and 40%.
function progress(tasks) {
  const n = tasks.length
  const done = tasks.filter((t) => t.status === 'completed').length
  const cur =
    tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending') ?? tasks[0]
  return {
    n,
    done,
    at: Math.min(done + 1, n),
    pct: Math.round((done / n) * 100),
    label: cur.status === 'in_progress' && cur.activeForm ? cur.activeForm : cur.subject,
  }
}

// The desktop row, as plan-progress lays it out: the state, the task, then the
// track pinned right at a width that fits, and the share done. The desktop
// reports about 8 CSS pixels per column.
function trackRow({ Box, Text, Svg }, e, p, batch) {
  const total = Math.max(320, (Number(e.props.bodyColumns) || 100) * 8)
  const titleW = Math.min(Math.round(total * 0.3), Math.round(textWidth(p.label, 6.4)))
  const trackW = Math.max(120, Math.min(1400, total - titleW - 140))
  const alt = `${p.label}: task ${p.at} of ${p.n}, ${p.pct}% done`
  const source = trackSvg({ id: String(batch), total: p.n, finished: p.done, color: ACCENT }, trackW)
  return [
    Text({ color: ACCENT, children: ['●'] }),
    Text({ wrap: 'truncate', children: [p.label] }),
    Box({ flexGrow: 1 }),
    Svg({ source, alt, width: trackW, height: TRACK_H }),
    Text({ dimColor: true, children: [`${String(p.pct).padStart(3, FIGURE_SPACE)}%`] }),
  ]
}

// The terminal row's props for bar.mjs.
function textProps(p, width) {
  return {
    mark: '●',
    markColor: VIOLET.mark,
    label: p.label,
    labelWidth: width >= 70 ? Math.min(32, Math.round(width * 0.3)) : width >= 50 ? 14 : 0,
    fraction: p.done / p.n,
    ticks: Array.from({ length: p.n - 1 }, (_, k) => (k + 1) / p.n),
    pill: `Tasks ${p.at}/${p.n}`,
    pillShort: `${p.at}/${p.n}`,
    fill: VIOLET.fill,
    pillBg: VIOLET.pillBg,
    pillFg: VIOLET.pillFg,
    tickColor: VIOLET.tick,
    right: `${p.pct}%`,
    rightWidth: 4,
  }
}

function toolsOff() {
  return {
    mark: '○',
    markColor: 'gray',
    label: 'Tasks off',
    labelDim: true,
    hint: 'set CLAUDE_CODE_ENABLE_TODO_TOOLS=1 and restart Claude Code',
    right: '',
  }
}

function nextId(tasks) {
  return tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value : null
}
