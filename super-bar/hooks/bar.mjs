// Super Bar's terminal bar.
//
// Draws one dotted progress row: a mark, a label, a braille-dot bar with tick
// marks and a pill riding the fill's edge, then a figure on the right. The
// hooks module draws it straight into the band with its own element table;
// the desktop draws track.mjs's SVG instead.

const DOT = '⣿'
const TICK = '│'
const TRACK = 'gray'

// The row as Text runs in a Box, sized to `cols` cells.
export function textRow({ Box, Text }, props, cols) {
  return Box({ flexDirection: 'row', children: runs(Text, layout(props ?? {}, Math.max(8, cols))) })
}

// The row as styled segments, left to right, sized to `cols` cells.
function layout(p, cols) {
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
    add(text, { color: p.labelColor, dim: Boolean(p.labelDim) })
    add(' '.repeat(labelW - Array.from(text).length + 1))
  }
  if (p.hint) add(fit(String(p.hint), track).padEnd(track), { color: TRACK })
  else bar(segs, p, track, pill)
  if (rightW > 0) add(` ${right.padStart(rightW)}`, { color: p.rightColor, dim: !p.rightColor })
  return segs
}

// Dots up to the fill's edge, dim dots after it, ticks at the boundaries, and the
// pill centred on the edge so it sits where the work is (clamped at both ends).
function bar(segs, p, T, pill) {
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
    if (ticks.has(i)) segs.push({ text: TICK, color: lit ? p.tickColor : TRACK, dim: !lit })
    else if (lit) segs.push({ text: DOT, color: p.fill, dim: speckle(i) })
    else segs.push({ text: DOT, color: TRACK, dim: true })
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
    const key = `${s.color ?? ''}|${s.bg ?? ''}|${s.dim ? 1 : 0}|${s.bold ? 1 : 0}`
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
    return Text(props)
  })
}
