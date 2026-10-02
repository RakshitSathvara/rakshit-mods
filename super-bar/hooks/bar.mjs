// Super Bar surface module.
//
// Draws one dotted progress row: a mark, a label, a braille-dot bar with tick
// marks and a pill riding the fill's edge, then a figure on the right. When the
// row is clickable, a click on it posts { type: 'toggle' } to the hooks module.
// A surface module has no $: it draws with surface.elements and reaches
// tasks-bar.mjs only through surface.post.

const DOT = '⣿'
const TICK = '│'
const TRACK = 'gray'

export default function Bar(props, surface) {
  const { Box, Text } = surface.elements
  const p = props ?? {}
  const look = surface.state ?? {}
  // The hooks module sizes the region (Client width) and passes the same figure
  // as `cols`, so the row fills it exactly whatever a surface reports first.
  const cols = Math.max(8, Number(p.cols) || surface.columns || 60)
  if (p.clickable) listen(surface, cols)
  return Box({ flexDirection: 'row', children: runs(Text, layout(p, look, cols)) })
}

// A press that starts and ends on the row is a click. Hover lights the row.
function listen(surface, cols) {
  surface.onPointer((ev) => {
    const now = surface.state ?? {}
    if (ev.type === 'enter' || ev.type === 'leave') {
      const hot = ev.type === 'enter'
      if (Boolean(now.hot) !== hot) surface.setState({ ...now, hot })
      return
    }
    if (ev.type === 'down') {
      if (ev.button !== 'right') surface.setState({ ...now, pressed: true })
      return
    }
    if (ev.type === 'up' && now.pressed) {
      const inside = ev.x >= 0 && ev.y >= 0 && ev.x < cols && (surface.rows <= 0 || ev.y < surface.rows)
      surface.setState({ ...now, pressed: false })
      if (inside) surface.post({ type: 'toggle' })
    }
  })
}

// The row as styled segments, left to right, sized to `cols` cells.
function layout(p, look, cols) {
  const segs = []
  const add = (text, style = {}) => {
    if (text) segs.push({ text, ...style })
  }

  const right = String(p.right ?? '')
  const rightW = Math.max(Number(p.rightWidth) || 0, right.length)
  const tail = rightW > 0 ? rightW + 1 : 0
  let pill = ` ${String(p.pill ?? '')} `
  const spare = cols - 2 - tail // what's left after the mark and its space
  const minTrack = pill.length + 8

  // Give the bar room first: shorten the label, then drop it. A hint row keeps
  // its short label only while the whole message fits beside it.
  let labelW = Math.max(0, Number(p.labelWidth) || 0)
  if (p.hint) {
    const own = Array.from(String(p.label ?? '')).length
    labelW = spare - (own + 1) >= Array.from(String(p.hint)).length ? own : 0
  } else {
    if (labelW > 0 && spare - (labelW + 1) < minTrack) labelW = spare - 1 - minTrack
    if (labelW < 8) labelW = 0
  }
  const track = Math.max(0, spare - (labelW > 0 ? labelW + 1 : 0))
  if (track < pill.length + 4 && p.pillShort) pill = ` ${String(p.pillShort)} `

  add(`${String(p.mark ?? ' ')} `, { color: p.markColor })
  if (labelW > 0) {
    const text = fit(String(p.label ?? ''), labelW)
    add(text, { color: p.labelColor, dim: Boolean(p.labelDim), underline: Boolean(look.hot) })
    add(' '.repeat(labelW - Array.from(text).length + 1))
  }
  if (p.hint) add(fit(String(p.hint), track).padEnd(track), { color: TRACK })
  else bar(segs, p, look, track, pill)
  if (rightW > 0) add(` ${right.padStart(rightW)}`, { color: p.rightColor, dim: !p.rightColor })
  return segs
}

// Dots up to the fill's edge, dim dots after it, ticks at the boundaries, and the
// pill centred on the edge so it sits where the work is (clamped at both ends).
function bar(segs, p, look, T, pill) {
  if (T <= 0) return
  const P = Math.min(pill.length, T)
  const filled = Math.round(clamp01(p.fraction) * T)
  const start = Math.max(0, Math.min(T - P, Math.round(filled - P / 2)))
  const ticks = tickCells(p.ticks, T)
  for (let i = 0; i < T; i++) {
    if (i === start) {
      segs.push({ text: pill.slice(0, P), color: p.pillFg, bg: p.pillBg, bold: true })
      i += P - 1
      continue
    }
    const lit = i < filled
    if (ticks.has(i)) segs.push({ text: TICK, color: lit ? p.tickColor : TRACK, dim: !lit && !look.hot })
    else if (lit) segs.push({ text: DOT, color: p.fill, dim: !look.hot && speckle(i) })
    else segs.push({ text: DOT, color: TRACK, dim: !look.hot })
  }
}

// Tick positions in cells, or none when they'd crowd the bar.
function tickCells(fractions, T) {
  const out = new Set()
  if (!Array.isArray(fractions) || fractions.length === 0) return out
  if (T / (fractions.length + 1) < 3) return out
  for (const f of fractions) {
    const i = Math.round(f * T)
    if (i > 0 && i < T) out.add(i)
  }
  return out
}

// About one lit dot in five drawn dim, the same ones every time: the dot-matrix texture.
function speckle(i) {
  return ((i * 2654435761) >>> 0) % 5 === 0
}

function clamp01(n) {
  const x = Number(n)
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
}

function fit(text, w) {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  if (chars.length <= w) return chars.join('')
  return `${chars.slice(0, Math.max(0, w - 1)).join('')}…`
}

// Adjacent segments with the same style become one Text.
function runs(Text, segs) {
  const merged = []
  for (const s of segs) {
    const key = `${s.color ?? ''}|${s.bg ?? ''}|${s.dim ? 1 : 0}|${s.bold ? 1 : 0}|${s.underline ? 1 : 0}`
    const last = merged[merged.length - 1]
    if (last && last.key === key) last.text += s.text
    else merged.push({ ...s, key })
  }
  return merged.map((s) => {
    const props = { children: [s.text] }
    if (s.color) props.color = s.color
    if (s.bg) props.backgroundColor = s.bg
    if (s.dim) props.dimColor = true
    if (s.bold) props.bold = true
    if (s.underline) props.underline = true
    return Text(props)
  })
}
