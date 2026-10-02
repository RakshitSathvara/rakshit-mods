// Super Bar's desktop track.
//
// The batch as an SVG the band draws as an image, so it needs no Client: a
// pixel fill that thickens towards its edge, a tick between tasks, and a pill
// riding the edge with the count. Adapted from plan-progress by Kirill
// Serditov (https://github.com/zycck/claude-mods), MIT License; see LICENSE.

export const TRACK_H = 22
const NARROW = 360 // below this the pill becomes a dot with the task number

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, m) => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * m))
const rgb = (c) => `rgb(${c.join(',')})`
const hash = (a, b, k) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453
  return x - Math.floor(x)
}

// A string's rough width in CSS pixels, in the desktop's 12px sans.
export const textWidth = (s, px = 6.7) =>
  [...s].reduce(
    (w, ch) =>
      w +
      (/[　-鿿]/.test(ch) ? 12 : /[ilI.,:;'|!]/.test(ch) ? 3.4 : /[mwMWЖМШЩ]/.test(ch) ? 9.5 : px),
    0,
  )

// Where each batch's head was last drawn, so a redraw glides from there.
const lastHead = new Map()

// One batch, W pixels wide: { id, total, finished, color }.
export function trackSvg(t, W) {
  const H = TRACK_H
  const total = Math.max(1, t.total)
  // The fill is exactly the finished share: a fresh batch starts empty.
  const fx = Math.min(1, t.finished / total) * W
  const from = lastHead.get(t.id) ?? fx
  lastHead.set(t.id, fx)

  const acc = hex(t.color)
  const light = mix(acc, [255, 255, 255], 0.32)
  const grey = [132, 130, 138]
  const ease = 'calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"'
  const glide = Math.abs(from - fx) > 0.5

  // Pixels on a 3px grid, 7 rows, denser and closer to the accent towards the head.
  const buckets = [0, 1, 2, 3, 4].map((b) => {
    const m = b / 4
    const dense = 0.22 + 0.78 * Math.pow(m, 1.5)
    return { color: rgb(mix(grey, light, m)), opacity: (0.35 + 0.65 * dense).toFixed(2) }
  })
  let px = ''
  for (let col = 0; col * 3 < fx; col++) {
    const x = col * 3
    const u = Math.min(1, (x + 1.5) / fx)
    const dense = 0.22 + 0.78 * Math.pow(u, 1.5)
    const bucket = Math.min(4, Math.floor(Math.min(1, Math.pow(u, 0.9) * 1.1) * 4.99))
    for (let r = 0; r < 7; r++) {
      if (hash(col, r, 1) > dense + 0.1) continue
      px += `<rect x="${x}" y="${1 + r * 3}" class="b${bucket} t${Math.floor(hash(col, r, 2) * 4)}"/>`
    }
  }

  // A short tick between tasks, brighter once passed.
  let marks = ''
  for (let k = 1; k < total; k++) {
    const x = (k / total) * W
    const passed = x < fx - 1
    const fill = passed ? rgb(mix(light, [255, 255, 255], 0.45)) : '#8A8984'
    marks += `<rect x="${(x - 0.75).toFixed(1)}" y="${(H - 8) / 2}" width="1.5" height="8" rx=".75" fill="${fill}" opacity="${passed ? 0.6 : 0.45}"/>`
  }

  // The knob: a pill with "Tasks 3/5", or a round dot with the number when narrow.
  const number = Math.min(total, t.finished + 1)
  let knob
  let kw = H
  if (W < NARROW) {
    knob = `<circle cx="0" cy="${H / 2}" r="${H / 2}" fill="${t.color}"/><text x="0" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${number}</text>`
  } else {
    const count = `${number}/${total}`
    kw = Math.round(20 + textWidth('Tasks') + 6 + textWidth(count, 6.5))
    knob = `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${t.color}"/>`
    knob += `<text x="${-kw / 2 + 10}" y="${H / 2 + 4.2}" class="kt">Tasks<tspan class="kc" dx="6">${count}</tspan></text>`
  }
  const clampX = (x) => Math.max(kw / 2, Math.min(W - kw / 2, x))
  const kx = clampX(fx)
  const kFrom = clampX(from)

  const style = `<style>
${buckets.map((b, i) => `.b${i}{fill:${b.color};fill-opacity:${b.opacity}}`).join('')}
rect[class]{width:2px;height:2px}
.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}
.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}
.kt{font:500 12px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:#fff}
.kc{font-weight:400;fill-opacity:.75}
@media (prefers-reduced-motion:reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>`
  const glideFill = glide
    ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur=".45s" ${ease} fill="freeze"/>`
    : ''
  const glideKnob = glide
    ? `<animateTransform attributeName="transform" type="translate" from="${kFrom.toFixed(1)} 0" to="${kx.toFixed(1)} 0" dur=".45s" ${ease} fill="freeze"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${style}
<defs><clipPath id="pill"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="fill"><rect width="${fx.toFixed(1)}" height="${H}">${glideFill}</rect></clipPath>
<linearGradient id="base" x1="0" x2="${fx.toFixed(1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rgb(acc)}" stop-opacity=".05"/><stop offset="1" stop-color="${rgb(acc)}" stop-opacity=".33"/></linearGradient></defs>
<g clip-path="url(#pill)"><rect width="${W}" height="${H}" fill="#808080" fill-opacity=".16"/>
<g clip-path="url(#fill)"><rect width="${fx.toFixed(1)}" height="${H}" fill="url(#base)"/>${px}</g>${marks}</g>
<g transform="translate(${kx.toFixed(1)} 0)">${glideKnob}${knob}</g></svg>`
}
